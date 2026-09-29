// Backdoor Grill — booking site + back office
// Node + Express + Postgres. Deploy on Render (see render.yaml / README.md).
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");
const makeBackoffice = require("./backoffice");

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }
if (!ADMIN_PASSWORD) console.warn("WARNING: ADMIN_PASSWORD is not set — back office login is disabled.");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: /render\.com|sslmode=require/.test(DATABASE_URL) ? { rejectUnauthorized: false } : false,
});

const DEFAULTS = {
  price: 349, capacity: 40, maxPax: 10, daysAhead: 14,
  cutoffHour: 12, cutoffDaysBefore: 0,
  gcashName: "(set GCash name in admin)", gcashNumber: "09XX XXX XXXX",
  timeLabel: "6:00–8:30 PM", openDays: [0, 1, 2, 3, 4, 5, 6], closedDates: [],
  depositPct: 20,
  maxMoves: 1,
};
const STATUSES = ["pending", "confirmed", "arrived", "noshow", "cancelled"];

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (id INT PRIMARY KEY, data JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS bookings (
      code TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      pax INT NOT NULL,
      price INT NOT NULL,
      total INT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      gcash_ref TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS bookings_date_idx ON bookings(date);
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit INT;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS balance INT;
    UPDATE bookings SET deposit = total, balance = 0 WHERE deposit IS NULL;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS moves INT NOT NULL DEFAULT 0;
  `);
  await backoffice.migrate();
  await pool.query(`INSERT INTO config(id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`, [DEFAULTS]);
}

const depositFor = (total, cfg) => Math.min(total, Math.ceil(total * (Number(cfg.depositPct) || 0) / 100));

async function getConfig(client = pool) {
  const r = await client.query("SELECT data FROM config WHERE id = 1");
  return { ...DEFAULTS, ...(r.rows[0] ? r.rows[0].data : {}) };
}

// ---- Manila date helpers (UTC+8, no DST) ----
function todayManila() { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); }
function addDays(s, n) { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function dowOf(s) { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
function cutoffInstant(s, cfg) { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d - (cfg.cutoffDaysBefore || 0), (cfg.cutoffHour ?? 12) - 8); }
function isValidDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s; }

function dayClosedReason(date, cfg) {
  if (!cfg.openDays.includes(dowOf(date)) || (cfg.closedDates || []).includes(date)) return "That night is closed.";
  if (Date.now() >= cutoffInstant(date, cfg)) return "Booking for that night is already closed (past the cut-off).";
  const last = addDays(todayManila(), cfg.daysAhead - 1);
  if (date < todayManila() || date > last) return "That date is not open for booking yet.";
  return null;
}

// ---- Admin session (signed cookie, 12 hours) ----
function sign(v) { return crypto.createHmac("sha256", SESSION_SECRET).update(v).digest("hex"); }
function makeToken(role = "admin") { const body = role + "-" + (Date.now() + 14 * 3600e3); return body + "." + sign(body); }
// Returns the role ("admin" / "cashier") of a valid token, or null.
function tokenRole(t) {
  if (!t) return null;
  const i = t.lastIndexOf(".");
  const body = t.slice(0, i), sig = t.slice(i + 1);
  if (i < 1 || sig.length !== 64) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(body)))) return null;
  const [role, exp] = body.split("-");
  return Number(exp) > Date.now() && (role === "admin" || role === "cashier") ? role : null;
}
const validToken = t => tokenRole(t) === "admin";
function readCookie(req, name) {
  const m = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function requireAdmin(req, res, next) {
  if (validToken(readCookie(req, "adm"))) return next();
  res.status(401).json({ error: "Please log in." });
}
function requireCashier(req, res, next) {
  if (tokenRole(readCookie(req, "csh")) === "cashier" || validToken(readCookie(req, "adm"))) return next();
  res.status(401).json({ error: "Please log in." });
}

// ---- Simple rate limit per IP ----
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const key = req.path + "|" + (req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
    const now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: "Too many attempts. Please wait a few minutes." });
    arr.push(now); hits.set(key, arr); next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

const app = express();
const backoffice = makeBackoffice(pool, { todayManila, addDays, isValidDate });
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" });
  next();
});
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- Pages ----
const page = f => (req, res) => res.sendFile(path.join(__dirname, f));
app.get("/", page("index.html"));
app.get("/admin", page("admin.html"));
app.get("/cashier", page("cashier.html"));
app.get("/style.css", page("style.css"));
app.get("/healthz", (req, res) => res.send("ok"));

// ---- Public API ----
app.get("/api/public", wrap(async (req, res) => {
  const cfg = await getConfig();
  const from = todayManila(), to = addDays(from, cfg.daysAhead - 1);
  const r = await pool.query(
    `SELECT date, SUM(pax)::int AS heads FROM bookings WHERE status <> 'cancelled' AND date BETWEEN $1 AND $2 GROUP BY date`, [from, to]);
  const heads = Object.fromEntries(r.rows.map(x => [x.date, x.heads]));
  const days = [];
  for (let i = 0; i < cfg.daysAhead; i++) {
    const d = addDays(from, i), reason = dayClosedReason(d, cfg), left = Math.max(0, cfg.capacity - (heads[d] || 0));
    days.push({ date: d, left, status: reason ? (Date.now() >= cutoffInstant(d, cfg) ? "cutoff" : "closed") : (left > 0 ? "open" : "full") });
  }
  const { price, maxPax, cutoffHour, cutoffDaysBefore, gcashName, gcashNumber, timeLabel, capacity, depositPct, maxMoves } = cfg;
  res.json({ config: { price, maxPax, cutoffHour, cutoffDaysBefore, gcashName, gcashNumber, timeLabel, capacity, depositPct, maxMoves }, days, today: from });
}));

app.post("/api/bookings", limit(8, 15 * 60e3), wrap(async (req, res) => {
  const b = req.body || {};
  const date = String(b.date || ""), pax = parseInt(b.pax, 10);
  const name = String(b.name || "").trim().slice(0, 80);
  const phone = String(b.phone || "").trim().slice(0, 20);
  const note = String(b.note || "").trim().slice(0, 200);
  const gcashRef = String(b.gcashRef || "").replace(/\s/g, "").slice(0, 30);
  if (!isValidDate(date)) return res.status(400).json({ error: "Invalid date." });
  if (!name) return res.status(400).json({ error: "Please enter your name." });
  if (phone.replace(/\D/g, "").length < 10) return res.status(400).json({ error: "Please enter a valid mobile number." });
  if (gcashRef.length < 6) return res.status(400).json({ error: "Please enter your GCash reference number." });
  if (!b.agree) return res.status(400).json({ error: "Please agree to the rules (non-refundable)." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One booking at a time per night, so two people can't take the last slots together.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["night:" + date]);
    const cfg = await getConfig(client);
    if (!Number.isInteger(pax) || pax < 1 || pax > cfg.maxPax) { await client.query("ROLLBACK"); return res.status(400).json({ error: `Each booking can have 1 to ${cfg.maxPax} guests.` }); }
    const reason = dayClosedReason(date, cfg);
    if (reason) { await client.query("ROLLBACK"); return res.status(409).json({ error: reason }); }
    const used = (await client.query(`SELECT COALESCE(SUM(pax),0)::int AS h FROM bookings WHERE date = $1 AND status <> 'cancelled'`, [date])).rows[0].h;
    const left = cfg.capacity - used;
    if (pax > left) { await client.query("ROLLBACK"); return res.status(409).json({ error: left > 0 ? `Only ${left} seat(s) left for that night.` : "That night is fully booked." }); }
    const dup = await client.query("SELECT 1 FROM bookings WHERE gcash_ref = $1", [gcashRef]);
    if (dup.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ error: "This GCash reference was already used. Please check the number." }); }

    let code;
    for (let i = 0; i < 5; i++) {
      code = "SG-" + Array.from(crypto.randomBytes(4)).map(x => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("");
      const ex = await client.query("SELECT 1 FROM bookings WHERE code = $1", [code]);
      if (!ex.rowCount) break;
    }
    const total = pax * cfg.price, deposit = depositFor(total, cfg), balance = total - deposit;
    await client.query(
      `INSERT INTO bookings(code, date, pax, price, total, name, phone, note, gcash_ref, deposit, balance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [code, date, pax, cfg.price, total, name, phone, note, gcashRef, deposit, balance]);
    await client.query("COMMIT");
    res.json({ code, date, pax, total, deposit, balance, timeLabel: cfg.timeLabel, status: "pending" });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
}));

app.get("/api/bookings/:code", limit(30, 15 * 60e3), wrap(async (req, res) => {
  const r = await pool.query("SELECT code, date, pax, total, deposit, balance, status FROM bookings WHERE code = $1", [String(req.params.code).toUpperCase()]);
  if (!r.rowCount) return res.status(404).json({ error: "Booking code not found." });
  res.json(r.rows[0]);
}));

// ---- Admin API ----
app.post("/api/admin/login", limit(10, 15 * 60e3), (req, res) => {
  const pw = String((req.body || {}).password || "");
  const ok = ADMIN_PASSWORD && pw.length === ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(ADMIN_PASSWORD));
  if (!ok) return res.status(401).json({ error: "Wrong password." });
  const secure = req.secure ? "; Secure" : "";
  res.set("Set-Cookie", `adm=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
  res.json({ ok: true });
});
app.post("/api/admin/logout", (req, res) => { res.set("Set-Cookie", "adm=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); res.json({ ok: true }); });
app.get("/api/admin/me", (req, res) => res.json({ loggedIn: validToken(readCookie(req, "adm")) }));

app.get("/api/admin/bookings", requireAdmin, wrap(async (req, res) => {
  const date = String(req.query.date || todayManila());
  if (!isValidDate(date)) return res.status(400).json({ error: "Invalid date." });
  const r = await pool.query(
    `SELECT code, date, pax, price, total, deposit, balance, moves, name, phone, note, gcash_ref AS "gcashRef", status, created_at AS "createdAt"
     FROM bookings WHERE date = $1 ORDER BY created_at`, [date]);
  const totals = await pool.query(
    `SELECT date, SUM(pax)::int AS heads, COUNT(*) FILTER (WHERE status='pending')::int AS pending
     FROM bookings WHERE status <> 'cancelled' AND date >= $1 GROUP BY date ORDER BY date`, [addDays(todayManila(), -30)]);
  res.json({ date, bookings: r.rows, nights: totals.rows, config: await getConfig(), today: todayManila() });
}));

app.patch("/api/admin/bookings/:code", requireAdmin, wrap(async (req, res) => {
  const status = String((req.body || {}).status || "");
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status." });
  const r = await pool.query("UPDATE bookings SET status = $1, arrived_on = CASE WHEN $1 = 'arrived' THEN COALESCE(arrived_on, $3) ELSE NULL END, updated_at = now() WHERE code = $2 RETURNING code", [status, req.params.code, todayManila()]);
  if (!r.rowCount) return res.status(404).json({ error: "Booking not found." });
  res.json({ ok: true });
}));

// Move a booking to another night (owner/manager). Checks seats on the new night.
app.post("/api/admin/bookings/:code/move", requireAdmin, wrap(async (req, res) => {
  const date = String((req.body || {}).date || "");
  if (!isValidDate(date)) return res.status(400).json({ error: "Choose a valid date." });
  if (date < todayManila()) return res.status(400).json({ error: "You cannot move a booking to a past date." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["night:" + date]);
    const cfg = await getConfig(client);
    const b = (await client.query("SELECT pax, date, status, moves FROM bookings WHERE code = $1 FOR UPDATE", [req.params.code])).rows[0];
    if (!b) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Booking not found." }); }
    if (b.date === date) { await client.query("ROLLBACK"); return res.json({ ok: true }); }
    if (["arrived", "cancelled"].includes(b.status)) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Only pending, confirmed or no-show bookings can be moved." }); }
    const maxMoves = Number(cfg.maxMoves ?? 1);
    if (b.moves >= maxMoves) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: maxMoves ? `This booking was already moved ${b.moves} time(s). The limit is ${maxMoves}.` : "Moving bookings is turned off in Settings." });
    }
    const used = (await client.query(`SELECT COALESCE(SUM(pax),0)::int AS h FROM bookings WHERE date = $1 AND status <> 'cancelled'`, [date])).rows[0].h;
    if (b.pax > cfg.capacity - used && !(req.body || {}).force) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Only ${Math.max(0, cfg.capacity - used)} seat(s) left on that night.`, full: true });
    }
    const newStatus = b.status === "noshow" ? "confirmed" : b.status;
    await client.query("UPDATE bookings SET date = $1, status = $2, moves = moves + 1, note = TRIM(note || ' (moved from ' || $3 || ')'), updated_at = now() WHERE code = $4",
      [date, newStatus, b.date, req.params.code]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}));

app.put("/api/admin/config", requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const int = (v, lo, hi, dflt) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt; };
  const cur = await getConfig();
  const next = {
    price: int(b.price, 1, 100000, cur.price),
    capacity: int(b.capacity, 1, 1000, cur.capacity),
    maxPax: int(b.maxPax, 1, 100, cur.maxPax),
    daysAhead: int(b.daysAhead, 1, 60, cur.daysAhead),
    cutoffHour: int(b.cutoffHour, 0, 23, cur.cutoffHour),
    cutoffDaysBefore: int(b.cutoffDaysBefore, 0, 7, cur.cutoffDaysBefore),
    gcashName: String(b.gcashName ?? cur.gcashName).slice(0, 80),
    gcashNumber: String(b.gcashNumber ?? cur.gcashNumber).slice(0, 30),
    timeLabel: String(b.timeLabel || cur.timeLabel).slice(0, 40),
    depositPct: int(b.depositPct, 0, 100, cur.depositPct),
    maxMoves: int(b.maxMoves, 0, 10, cur.maxMoves ?? 1),
    cashierPin: /^\d{4,8}$/.test(String(b.cashierPin || "")) ? String(b.cashierPin) : (b.cashierPin === "" ? "" : (cur.cashierPin || "")),
    openDays: Array.isArray(b.openDays) ? [...new Set(b.openDays.map(Number).filter(n => n >= 0 && n <= 6))] : cur.openDays,
    closedDates: Array.isArray(b.closedDates) ? b.closedDates.map(String).filter(isValidDate).slice(0, 100) : cur.closedDates,
  };
  await pool.query("UPDATE config SET data = $1 WHERE id = 1", [next]);
  res.json({ ok: true, config: next });
}));

app.get("/api/admin/export.csv", requireAdmin, wrap(async (req, res) => {
  const r = await pool.query(`SELECT code, date, pax, total, deposit, balance, name, phone, note, gcash_ref, status, created_at FROM bookings ORDER BY date, created_at`);
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["code,date,pax,total,down_payment,balance_at_venue,name,phone,note,gcash_ref,status,created_at", ...r.rows.map(x => [x.code, x.date, x.pax, x.total, x.deposit, x.balance, x.name, x.phone, x.note, x.gcash_ref, x.status, x.created_at.toISOString()].map(esc).join(","))];
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="backdoor-grill-bookings-${todayManila()}.csv"` });
  res.send("﻿" + lines.join("\n"));
}));

backoffice.routes(app, requireAdmin, wrap);

// ---- Cashier window (tonight only: check-in, collect balance, walk-ins, extra sales) ----
app.post("/api/cashier/login", limit(10, 15 * 60e3), wrap(async (req, res) => {
  const cfg = await getConfig();
  const pin = String((req.body || {}).pin || "");
  const good = String(cfg.cashierPin || "");
  const ok = good.length >= 4 && pin.length === good.length && crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(good));
  if (!ok) return res.status(401).json({ error: good ? "Wrong PIN." : "No cashier PIN yet. Ask the owner to set one in Back office → Settings." });
  const secure = req.secure ? "; Secure" : "";
  res.set("Set-Cookie", `csh=${makeToken("cashier")}; HttpOnly; SameSite=Strict; Path=/; Max-Age=50400${secure}`);
  res.json({ ok: true });
}));
app.post("/api/cashier/logout", (req, res) => { res.set("Set-Cookie", "csh=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); res.json({ ok: true }); });
app.get("/api/cashier/me", (req, res) => res.json({ loggedIn: tokenRole(readCookie(req, "csh")) === "cashier" || validToken(readCookie(req, "adm")) }));

app.get("/api/cashier/tonight", requireCashier, wrap(async (req, res) => {
  const date = todayManila(), cfg = await getConfig();
  const b = await pool.query(`SELECT code, pax, total, deposit, balance, name, phone, note, status, gcash_ref LIKE 'WALKIN-%' AS walkin
    FROM bookings WHERE date = $1 AND status <> 'cancelled' ORDER BY name`, [date]);
  const x = await pool.query(`SELECT id, description, amount::float FROM other_income WHERE date = $1 ORDER BY id DESC`, [date]);
  res.json({ date, timeLabel: cfg.timeLabel, capacity: cfg.capacity, price: cfg.price, bookings: b.rows, extras: x.rows });
}));

app.post("/api/cashier/checkin/:code", requireCashier, wrap(async (req, res) => {
  const action = (req.body || {}).action;
  if (!["arrived", "noshow", "confirmed"].includes(action)) return res.status(400).json({ error: "Invalid action." });
  const r = await pool.query(`UPDATE bookings SET status = $1, arrived_on = CASE WHEN $1 = 'arrived' THEN $3 ELSE NULL END, updated_at = now()
    WHERE code = $2 AND date = $3 AND status IN ('confirmed','arrived','noshow') RETURNING code`, [action, req.params.code, todayManila()]);
  if (!r.rowCount) return res.status(409).json({ error: "This booking is not confirmed yet. Ask the manager to verify the GCash down payment." });
  res.json({ ok: true });
}));

app.post("/api/cashier/walkin", requireCashier, wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "Walk-in").trim().slice(0, 80) || "Walk-in";
  const pax = parseInt(b.pax, 10);
  const date = todayManila();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["night:" + date]);
    const cfg = await getConfig(client);
    if (!Number.isInteger(pax) || pax < 1 || pax > 50) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Enter the number of guests." }); }
    const used = (await client.query(`SELECT COALESCE(SUM(pax),0)::int AS h FROM bookings WHERE date = $1 AND status <> 'cancelled'`, [date])).rows[0].h;
    if (pax > cfg.capacity - used && !b.force) { await client.query("ROLLBACK"); return res.status(409).json({ error: `Only ${Math.max(0, cfg.capacity - used)} seat(s) left tonight.`, full: true }); }
    const code = "WI-" + Array.from(crypto.randomBytes(4)).map(x => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("");
    const total = pax * cfg.price;
    await client.query(`INSERT INTO bookings(code, date, pax, price, total, name, phone, note, gcash_ref, deposit, balance, status, arrived_on)
      VALUES ($1,$2,$3,$4,$5,$6,'',$7,$8,0,$5,'arrived',$2)`, [code, date, pax, cfg.price, total, name, "Walk-in", "WALKIN-" + code]);
    await client.query("COMMIT");
    res.json({ ok: true, code, total });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}));

app.post("/api/cashier/extra", requireCashier, wrap(async (req, res) => {
  const description = String((req.body || {}).description || "").trim().slice(0, 120);
  const amount = Number((req.body || {}).amount);
  if (!description) return res.status(400).json({ error: "What was sold? (e.g. extra drinks, leftover charge)" });
  if (!(amount > 0)) return res.status(400).json({ error: "Enter the amount." });
  await pool.query("INSERT INTO other_income(date, description, amount) VALUES ($1,$2,$3)", [todayManila(), description, amount]);
  res.json({ ok: true });
}));
app.delete("/api/cashier/extra/:id", requireCashier, wrap(async (req, res) => {
  await pool.query("DELETE FROM other_income WHERE id = $1 AND date = $2", [parseInt(req.params.id, 10), todayManila()]);
  res.json({ ok: true });
}));

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Server error. Please try again." }); });

migrate().then(() => app.listen(PORT, () => console.log("Backdoor Grill running on port " + PORT)))
  .catch(e => { console.error("DB setup failed:", e); process.exit(1); });
