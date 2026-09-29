// Backdoor Grill — back office: items, inventory, purchases, expenses, income, capital, P&L, cash flow.
module.exports = function makeBackoffice(pool, { todayManila, addDays, isValidDate }) {

  const CATEGORIES = ["Meat", "Produce", "Banchan", "Sauces & seasoning", "Rice & drinks", "Supplies", "Utensils", "Equipment"];
  const EXPENSE_CATS = ["Staff wages", "Rent", "Electricity", "Water", "LPG / fuel", "Transport & delivery",
    "Marketing & ads", "Permits & fees", "Repairs & maintenance", "Other"];

  // Starter list. Costs are estimates (edit them in Inventory); per_head = estimated use per guest.
  // kind: "consumable" is tracked as stock and used up; "asset" is bought once (utensils/equipment).
  const SEED = [
    // name, category, kind, unit, per_head, need_qty, cost
    ["Pork belly (samgyupsal)", "Meat", "consumable", "kg", 0.20, 0, 360],
    ["Pork shoulder / kasim (marinated)", "Meat", "consumable", "kg", 0.08, 0, 300],
    ["Beef bulgogi slices", "Meat", "consumable", "kg", 0.04, 0, 520],
    ["Chicken thigh (spicy)", "Meat", "consumable", "kg", 0.06, 0, 220],
    ["Rice (uncooked)", "Rice & drinks", "consumable", "kg", 0.12, 0, 55],
    ["Iced tea powder", "Rice & drinks", "consumable", "pack", 0.10, 0, 30],
    ["Drinking water (5-gal refill)", "Rice & drinks", "consumable", "gal", 0.08, 0, 30],
    ["Lettuce", "Produce", "consumable", "kg", 0.06, 0, 180],
    ["Cucumber", "Produce", "consumable", "kg", 0.03, 0, 80],
    ["Garlic", "Produce", "consumable", "kg", 0.01, 0, 160],
    ["Onion", "Produce", "consumable", "kg", 0.015, 0, 140],
    ["Chili (siling haba)", "Produce", "consumable", "kg", 0.005, 0, 200],
    ["Kimchi", "Banchan", "consumable", "kg", 0.05, 0, 250],
    ["Potato (for gamja jorim)", "Banchan", "consumable", "kg", 0.03, 0, 90],
    ["Fish cake (eomuk)", "Banchan", "consumable", "kg", 0.03, 0, 260],
    ["Bean sprouts (togue)", "Banchan", "consumable", "kg", 0.03, 0, 70],
    ["Eggs (steamed egg)", "Banchan", "consumable", "pc", 0.5, 0, 9],
    ["Cheese (quickmelt/mozzarella)", "Banchan", "consumable", "kg", 0.02, 0, 420],
    ["Gochujang", "Sauces & seasoning", "consumable", "kg", 0.01, 0, 450],
    ["Ssamjang", "Sauces & seasoning", "consumable", "kg", 0.01, 0, 380],
    ["Sesame oil", "Sauces & seasoning", "consumable", "L", 0.005, 0, 400],
    ["Soy sauce", "Sauces & seasoning", "consumable", "L", 0.01, 0, 60],
    ["Sugar", "Sauces & seasoning", "consumable", "kg", 0.005, 0, 75],
    ["Salt & pepper", "Sauces & seasoning", "consumable", "kg", 0.003, 0, 60],
    ["Cooking oil", "Sauces & seasoning", "consumable", "L", 0.01, 0, 120],
    ["Butane canister", "Supplies", "consumable", "pc", 0.25, 0, 65],
    ["Grill paper / foil sheets", "Supplies", "consumable", "pc", 0.25, 0, 10],
    ["Table napkins / tissue", "Supplies", "consumable", "pack", 0.05, 0, 45],
    ["Disposable gloves", "Supplies", "consumable", "pc", 0.3, 0, 2],
    ["Dishwashing liquid", "Supplies", "consumable", "L", 0.005, 0, 90],
    ["Garbage bags", "Supplies", "consumable", "pc", 0.03, 0, 8],
    ["Portable butane stove", "Equipment", "asset", "pc", 0, 10, 950],
    ["Samgyup grill pan", "Equipment", "asset", "pc", 0, 10, 650],
    ["Rice cooker (large)", "Equipment", "asset", "pc", 0, 2, 2500],
    ["Cooler / ice box", "Equipment", "asset", "pc", 0, 1, 1800],
    ["Fire extinguisher", "Equipment", "asset", "pc", 0, 1, 1500],
    ["String lights (ambience)", "Equipment", "asset", "set", 0, 2, 450],
    ["Tarpaulin / signage", "Equipment", "asset", "pc", 0, 1, 600],
    ["Tongs", "Utensils", "asset", "pc", 0, 20, 60],
    ["Kitchen scissors", "Utensils", "asset", "pc", 0, 10, 120],
    ["Stainless chopsticks (pairs)", "Utensils", "asset", "pair", 0, 50, 25],
    ["Spoons", "Utensils", "asset", "pc", 0, 50, 15],
    ["Banchan side dishes (small)", "Utensils", "asset", "pc", 0, 120, 25],
    ["Plates", "Utensils", "asset", "pc", 0, 50, 45],
    ["Rice bowls", "Utensils", "asset", "pc", 0, 50, 35],
    ["Drinking glasses", "Utensils", "asset", "pc", 0, 50, 30],
    ["Pitchers", "Utensils", "asset", "pc", 0, 10, 120],
    ["Meat platters", "Utensils", "asset", "pc", 0, 10, 90],
    ["Serving trays", "Utensils", "asset", "pc", 0, 6, 150],
    ["Kitchen knives", "Utensils", "asset", "pc", 0, 3, 350],
    ["Cutting boards", "Utensils", "asset", "pc", 0, 3, 250],
    ["Staff aprons", "Utensils", "asset", "pc", 0, 6, 120],
  ];

  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, kind TEXT NOT NULL,
        unit TEXT NOT NULL, per_head NUMERIC NOT NULL DEFAULT 0, need_qty NUMERIC NOT NULL DEFAULT 0,
        cost NUMERIC NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true, note TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS purchases (
        id SERIAL PRIMARY KEY, date TEXT NOT NULL, item_id INT REFERENCES items(id), description TEXT NOT NULL,
        qty NUMERIC NOT NULL DEFAULT 1, unit_cost NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL,
        supplier TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS stock_moves (
        id SERIAL PRIMARY KEY, date TEXT NOT NULL, item_id INT NOT NULL REFERENCES items(id),
        type TEXT NOT NULL, qty NUMERIC NOT NULL, unit_cost NUMERIC NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY, date TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        amount NUMERIC NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS other_income (
        id SERIAL PRIMARY KEY, date TEXT NOT NULL, description TEXT NOT NULL, amount NUMERIC NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS capital (
        id SERIAL PRIMARY KEY, date TEXT NOT NULL, type TEXT NOT NULL, amount NUMERIC NOT NULL,
        note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS arrived_on TEXT;
      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY, type TEXT NOT NULL, message TEXT NOT NULL, code TEXT, date TEXT,
        seen BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS addons (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Drinks', price NUMERIC NOT NULL,
        item_id INT REFERENCES items(id), item_qty NUMERIC NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true,
        sort INT NOT NULL DEFAULT 0);
      ALTER TABLE other_income ADD COLUMN IF NOT EXISTS code TEXT;
      ALTER TABLE other_income ADD COLUMN IF NOT EXISTS items JSONB;
      ALTER TABLE other_income ADD COLUMN IF NOT EXISTS tendered NUMERIC;
      ALTER TABLE other_income ADD COLUMN IF NOT EXISTS change_given NUMERIC;
      ALTER TABLE other_income ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE other_income ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
    `);
    const ac = await pool.query("SELECT COUNT(*)::int AS n FROM addons");
    if (ac.rows[0].n === 0) {
      // Starter menu: prices are placeholders; the owner sets real prices in Back office → Add-on menu.
      const START = [["Soft drink (can)", "Drinks", 60], ["Bottled water", "Drinks", 25], ["Beer (San Miguel)", "Drinks", 80],
        ["Soju (bottle)", "Drinks", 180], ["Extra cheese", "Add-ons", 50], ["Leftover charge (per 100g)", "Charges", 100]];
      for (const [i, [name, category, price]] of START.entries())
        await pool.query("INSERT INTO addons(name, category, price, sort) VALUES ($1,$2,$3,$4)", [name, category, price, i]);
    }
    const c = await pool.query("SELECT COUNT(*)::int AS n FROM items");
    if (c.rows[0].n === 0) {
      for (const [name, category, kind, unit, per_head, need_qty, cost] of SEED)
        await pool.query("INSERT INTO items(name, category, kind, unit, per_head, need_qty, cost) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [name, category, kind, unit, per_head, need_qty, cost]);
    }
  }

  const num = (v, dflt = 0) => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };
  const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
  const bad = (res, msg) => res.status(400).json({ error: msg });
  const monthRange = q => {
    const from = isValidDate(q.from) ? q.from : todayManila().slice(0, 8) + "01";
    let to = isValidDate(q.to) ? q.to : addDays(addDays(from.slice(0, 8) + "01", 32).slice(0, 8) + "01", -1);
    if (to < from) to = from;
    return { from, to };
  };

  // Stock on hand per item = bought - used - wasted + adjustments
  const ITEMS_SQL = `
    SELECT i.*,
      COALESCE((SELECT SUM(qty) FROM purchases p WHERE p.item_id = i.id), 0)::float AS bought,
      COALESCE((SELECT SUM(CASE WHEN type='adjust' THEN qty ELSE -qty END) FROM stock_moves m WHERE m.item_id = i.id), 0)::float AS moved
    FROM items i WHERE i.active ORDER BY array_position($1::text[], i.category), i.name`;
  async function listItems() {
    const r = await pool.query(ITEMS_SQL, [CATEGORIES]);
    return r.rows.map(x => ({
      id: x.id, name: x.name, category: x.category, kind: x.kind, unit: x.unit, note: x.note,
      perHead: Number(x.per_head), needQty: Number(x.need_qty), cost: Number(x.cost),
      stock: Math.round((x.bought + x.moved) * 1000) / 1000, bought: x.bought,
    }));
  }

  // Revenue recognised per booking night: arrived = full total, no-show = down payment kept.
  async function salesByNight(from, to) {
    const r = await pool.query(`
      SELECT date,
        SUM(CASE WHEN status='arrived' THEN total WHEN status='noshow' THEN deposit ELSE 0 END)::float AS revenue,
        SUM(CASE WHEN status='arrived' THEN pax ELSE 0 END)::int AS guests,
        SUM(CASE WHEN status='noshow' THEN pax ELSE 0 END)::int AS noshow_guests
      FROM bookings WHERE date BETWEEN $1 AND $2 GROUP BY date ORDER BY date`, [from, to]);
    return r.rows;
  }

  // Cash events: down payments (GCash) on booking day once verified; balances (cash) on arrival night.
  async function cashEvents(from, to) {
    const q = (sql, args) => pool.query(sql, args).then(r => r.rows);
    const [dp, bal, inc, cap, pur, exp] = await Promise.all([
      q(`SELECT to_char(created_at AT TIME ZONE 'Asia/Manila','YYYY-MM-DD') AS date, SUM(deposit)::float AS amt
         FROM bookings WHERE status IN ('confirmed','arrived','noshow')
         AND to_char(created_at AT TIME ZONE 'Asia/Manila','YYYY-MM-DD') BETWEEN $1 AND $2 GROUP BY 1`, [from, to]),
      q(`SELECT COALESCE(arrived_on, date) AS date, SUM(balance)::float AS amt FROM bookings
         WHERE status='arrived' AND COALESCE(arrived_on, date) BETWEEN $1 AND $2 GROUP BY 1`, [from, to]),
      q(`SELECT date, SUM(amount)::float AS amt FROM other_income WHERE paid AND date BETWEEN $1 AND $2 GROUP BY 1`, [from, to]),
      q(`SELECT date, SUM(CASE WHEN type='in' THEN amount ELSE 0 END)::float AS cin, SUM(CASE WHEN type='out' THEN amount ELSE 0 END)::float AS cout
         FROM capital WHERE date BETWEEN $1 AND $2 GROUP BY 1`, [from, to]),
      q(`SELECT date, SUM(total)::float AS amt FROM purchases WHERE date BETWEEN $1 AND $2 GROUP BY 1`, [from, to]),
      q(`SELECT date, SUM(amount)::float AS amt FROM expenses WHERE date BETWEEN $1 AND $2 GROUP BY 1`, [from, to]),
    ]);
    const days = {};
    const d = k => (days[k] = days[k] || { date: k, downPayments: 0, balances: 0, otherIncome: 0, capitalIn: 0, purchases: 0, expenses: 0, ownerDraw: 0 });
    dp.forEach(x => d(x.date).downPayments += x.amt);
    bal.forEach(x => d(x.date).balances += x.amt);
    inc.forEach(x => d(x.date).otherIncome += x.amt);
    cap.forEach(x => { d(x.date).capitalIn += x.cin; d(x.date).ownerDraw += x.cout; });
    pur.forEach(x => d(x.date).purchases += x.amt);
    exp.forEach(x => d(x.date).expenses += x.amt);
    return Object.values(days).sort((a, b) => a.date.localeCompare(b.date));
  }
  const netOf = x => x.downPayments + x.balances + x.otherIncome + x.capitalIn - x.purchases - x.expenses - x.ownerDraw;

  // Alerts shown in the back office (new bookings, guests changing dates, ...)
  async function alert(type, message, code = null, date = null) {
    try { await pool.query("INSERT INTO alerts(type, message, code, date) VALUES ($1,$2,$3,$4)", [type, message, code, date]); }
    catch (e) { console.error("alert failed", e.message); }
  }

  function routes(app, requireAdmin, wrap) {
    const A = (method, path, fn) => app[method]("/api/admin/" + path, requireAdmin, wrap(fn));

    A("get", "alerts", async (req, res) => {
      const r = await pool.query(`SELECT id, type, message, code, date, seen, created_at AS "createdAt" FROM alerts ORDER BY id DESC LIMIT 50`);
      const u = await pool.query("SELECT COUNT(*)::int AS n FROM alerts WHERE NOT seen");
      res.json({ unseen: u.rows[0].n, rows: r.rows });
    });
    A("post", "alerts/seen", async (req, res) => { await pool.query("UPDATE alerts SET seen = true WHERE NOT seen"); res.json({ ok: true }); });
    // Keep the table small
    pool.query("DELETE FROM alerts WHERE created_at < now() - interval '90 days'").catch(() => {});

    // ---- Add-on menu (drinks, extras, charges the cashier can sell) ----
    const ADDON_CATS = ["Drinks", "Add-ons", "Charges", "Others"];
    A("get", "addons", async (req, res) => {
      const r = await pool.query(`SELECT a.id, a.name, a.category, a.price::float, a.item_id AS "itemId", a.item_qty::float AS "itemQty", a.active, a.sort,
        i.name AS "itemName", i.unit AS "itemUnit", i.cost::float AS "itemCost" FROM addons a LEFT JOIN items i ON i.id = a.item_id
        ORDER BY array_position($1::text[], a.category), a.sort, a.name`, [ADDON_CATS]);
      res.json({ rows: r.rows, categories: ADDON_CATS });
    });
    const addonBody = b => ({
      name: str(b.name, 60), category: ADDON_CATS.includes(b.category) ? b.category : "Others", price: Math.max(0, num(b.price)),
      itemId: parseInt(b.itemId, 10) || null, itemQty: Math.max(0, num(b.itemQty)), active: b.active !== false,
    });
    A("post", "addons", async (req, res) => {
      const a = addonBody(req.body || {}); if (!a.name) return bad(res, "Enter the item name."); if (!(a.price > 0)) return bad(res, "Enter the selling price.");
      await pool.query("INSERT INTO addons(name, category, price, item_id, item_qty, active) VALUES ($1,$2,$3,$4,$5,$6)", [a.name, a.category, a.price, a.itemId, a.itemQty, a.active]);
      res.json({ ok: true });
    });
    A("put", "addons/:id", async (req, res) => {
      const a = addonBody(req.body || {}); if (!a.name) return bad(res, "Enter the item name."); if (!(a.price > 0)) return bad(res, "Enter the selling price.");
      await pool.query("UPDATE addons SET name=$1, category=$2, price=$3, item_id=$4, item_qty=$5, active=$6 WHERE id=$7",
        [a.name, a.category, a.price, a.itemId, a.itemQty, a.active, parseInt(req.params.id, 10)]);
      res.json({ ok: true });
    });
    A("delete", "addons/:id", async (req, res) => { await pool.query("DELETE FROM addons WHERE id=$1", [parseInt(req.params.id, 10)]); res.json({ ok: true }); });

    A("get", "meta", async (req, res) => res.json({ categories: CATEGORIES, expenseCategories: EXPENSE_CATS, today: todayManila() }));

    // ---- Items ----
    A("get", "items", async (req, res) => res.json({ items: await listItems() }));
    const itemBody = b => ({
      name: str(b.name, 80), category: CATEGORIES.includes(b.category) ? b.category : "Supplies",
      kind: b.kind === "asset" ? "asset" : "consumable", unit: str(b.unit, 12) || "pc",
      perHead: Math.max(0, num(b.perHead)), needQty: Math.max(0, num(b.needQty)), cost: Math.max(0, num(b.cost)), note: str(b.note, 200),
    });
    A("post", "items", async (req, res) => {
      const i = itemBody(req.body || {}); if (!i.name) return bad(res, "Item name is required.");
      const r = await pool.query("INSERT INTO items(name, category, kind, unit, per_head, need_qty, cost, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        [i.name, i.category, i.kind, i.unit, i.perHead, i.needQty, i.cost, i.note]);
      res.json({ id: r.rows[0].id });
    });
    A("put", "items/:id", async (req, res) => {
      const i = itemBody(req.body || {}); if (!i.name) return bad(res, "Item name is required.");
      await pool.query("UPDATE items SET name=$1, category=$2, kind=$3, unit=$4, per_head=$5, need_qty=$6, cost=$7, note=$8 WHERE id=$9",
        [i.name, i.category, i.kind, i.unit, i.perHead, i.needQty, i.cost, i.note, parseInt(req.params.id, 10)]);
      res.json({ ok: true });
    });
    A("delete", "items/:id", async (req, res) => {
      await pool.query("UPDATE items SET active=false WHERE id=$1", [parseInt(req.params.id, 10)]); res.json({ ok: true });
    });

    // ---- Prep & shopping list for one night ----
    A("get", "prep", async (req, res) => {
      const date = isValidDate(req.query.date) ? req.query.date : todayManila();
      const h = await pool.query(`SELECT COALESCE(SUM(pax),0)::int AS heads FROM bookings WHERE date=$1 AND status IN ('pending','confirmed','arrived')`, [date]);
      const heads = h.rows[0].heads;
      const extra = Math.max(0, Math.min(100, num(req.query.buffer, 10))) / 100;
      const items = await listItems();
      const consumables = items.filter(i => i.kind === "consumable").map(i => {
        const need = Math.round(i.perHead * heads * (1 + extra) * 100) / 100;
        const toBuy = Math.max(0, Math.round((need - Math.max(0, i.stock)) * 100) / 100);
        return { ...i, need, toBuy, estCost: Math.round(toBuy * i.cost) };
      });
      const assets = items.filter(i => i.kind === "asset").map(i => {
        const toBuy = Math.max(0, i.needQty - i.stock);
        return { ...i, toBuy, estCost: Math.round(toBuy * i.cost) };
      });
      // Estimated cost per guest from the item list (use per guest × cost per unit)
      const cfgRow = (await pool.query("SELECT data FROM config WHERE id = 1")).rows[0];
      const price = Number((cfgRow && cfgRow.data.price) || 0);
      const perGuestFood = consumables.filter(i => i.category !== "Supplies").reduce((s, i) => s + i.perHead * i.cost, 0);
      const perGuestSupplies = consumables.filter(i => i.category === "Supplies").reduce((s, i) => s + i.perHead * i.cost, 0);
      const perGuest = perGuestFood + perGuestSupplies;
      const r2 = x => Math.round(x * 100) / 100;
      res.json({ date, heads, buffer: extra * 100, consumables, assets,
        cost: { price, perGuestFood: r2(perGuestFood), perGuestSupplies: r2(perGuestSupplies), perGuest: r2(perGuest),
          foodCostPct: price ? r2(perGuest / price * 100) : 0,
          nightCost: r2(perGuest * heads), nightSales: price * heads, nightGross: r2((price - perGuest) * heads) } });
    });

    // ---- Purchases ----
    A("get", "purchases", async (req, res) => {
      const { from, to } = monthRange(req.query);
      const r = await pool.query(`SELECT p.id, p.date, p.item_id AS "itemId", p.description, p.qty::float, p.unit_cost::float AS "unitCost",
        p.total::float, p.supplier, i.unit, i.kind FROM purchases p LEFT JOIN items i ON i.id = p.item_id
        WHERE p.date BETWEEN $1 AND $2 ORDER BY p.date DESC, p.id DESC`, [from, to]);
      res.json({ from, to, rows: r.rows });
    });
    A("post", "purchases", async (req, res) => {
      const b = req.body || {};
      const lines = Array.isArray(b.lines) ? b.lines : [b];
      const date = isValidDate(b.date) ? b.date : todayManila();
      const supplier = str(b.supplier, 80);
      let n = 0;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const l of lines.slice(0, 100)) {
          const itemId = parseInt(l.itemId, 10) || null;
          const qty = num(l.qty, 1), total = num(l.total, NaN);
          const unitCost = Number.isFinite(total) && qty ? total / qty : num(l.unitCost);
          const amount = Number.isFinite(total) ? total : qty * unitCost;
          if (!(amount > 0) || !(qty > 0)) continue;
          let desc = str(l.description, 120);
          if (itemId && !desc) desc = (await client.query("SELECT name FROM items WHERE id=$1", [itemId])).rows[0]?.name || "Item";
          if (!desc) continue;
          await client.query("INSERT INTO purchases(date, item_id, description, qty, unit_cost, total, supplier) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            [date, itemId, desc, qty, unitCost, amount, supplier]);
          if (itemId) await client.query("UPDATE items SET cost=$1 WHERE id=$2", [unitCost, itemId]);
          n++;
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
      if (!n) return bad(res, "Nothing saved. Enter a quantity and cost.");
      res.json({ ok: true, saved: n });
    });
    A("delete", "purchases/:id", async (req, res) => { await pool.query("DELETE FROM purchases WHERE id=$1", [parseInt(req.params.id, 10)]); res.json({ ok: true }); });

    // ---- Stock moves: usage, waste, count adjustments ----
    A("get", "moves", async (req, res) => {
      const { from, to } = monthRange(req.query);
      const r = await pool.query(`SELECT m.id, m.date, m.type, m.qty::float, m.unit_cost::float AS "unitCost", m.note, i.name, i.unit
        FROM stock_moves m JOIN items i ON i.id=m.item_id WHERE m.date BETWEEN $1 AND $2 ORDER BY m.date DESC, m.id DESC`, [from, to]);
      res.json({ from, to, rows: r.rows });
    });
    A("post", "moves", async (req, res) => {
      const b = req.body || {};
      const date = isValidDate(b.date) ? b.date : todayManila();
      const type = ["usage", "waste", "adjust", "count"].includes(b.type) ? b.type : "usage";
      const items = Object.fromEntries((await listItems()).map(i => [i.id, i]));
      let n = 0;
      for (const l of (Array.isArray(b.lines) ? b.lines : []).slice(0, 200)) {
        const it = items[parseInt(l.itemId, 10)]; if (!it) continue;
        let qty = num(l.qty, NaN); if (!Number.isFinite(qty)) continue;
        let t = type;
        if (type === "count") { qty = qty - it.stock; t = "adjust"; if (Math.abs(qty) < 1e-9) continue; }
        else if (qty <= 0) continue;
        await pool.query("INSERT INTO stock_moves(date, item_id, type, qty, unit_cost, note) VALUES ($1,$2,$3,$4,$5,$6)",
          [date, it.id, t, qty, it.cost, str(l.note || b.note, 120)]);
        n++;
      }
      res.json({ ok: true, saved: n });
    });
    A("delete", "moves/:id", async (req, res) => { await pool.query("DELETE FROM stock_moves WHERE id=$1", [parseInt(req.params.id, 10)]); res.json({ ok: true }); });

    // ---- Expenses, other income, owner capital ----
    const ledger = (path, table, cols, mapIn) => {
      A("get", path, async (req, res) => {
        const { from, to } = monthRange(req.query);
        const r = await pool.query(`SELECT id, date, ${cols.join(", ")}, amount::float FROM ${table} WHERE date BETWEEN $1 AND $2 ORDER BY date DESC, id DESC`, [from, to]);
        res.json({ from, to, rows: r.rows });
      });
      A("post", path, async (req, res) => {
        const b = req.body || {};
        const v = mapIn(b); if (typeof v === "string") return bad(res, v);
        const amount = num(b.amount); if (!(amount > 0)) return bad(res, "Enter an amount greater than zero.");
        const date = isValidDate(b.date) ? b.date : todayManila();
        const keys = Object.keys(v);
        await pool.query(`INSERT INTO ${table}(date, amount, ${keys.join(", ")}) VALUES ($1, $2, ${keys.map((_, i) => "$" + (i + 3)).join(", ")})`,
          [date, amount, ...Object.values(v)]);
        res.json({ ok: true });
      });
      A("delete", path + "/:id", async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (table === "other_income") await pool.query("DELETE FROM stock_moves WHERE note = $1", ["sale#" + id]);
        await pool.query(`DELETE FROM ${table} WHERE id=$1`, [id]); res.json({ ok: true });
      });
    };
    ledger("expenses", "expenses", ["category", "description"], b =>
      EXPENSE_CATS.includes(b.category) ? { category: b.category, description: str(b.description, 120) } : "Choose an expense category.");
    ledger("income", "other_income", ["description"], b => str(b.description, 120) ? { description: str(b.description, 120) } : "Describe the income (e.g. drinks, add-ons).");
    ledger("capital", "capital", ["type", "note"], b =>
      ["in", "out"].includes(b.type) ? { type: b.type, note: str(b.note, 120) } : "Choose capital in or owner withdrawal.");

    // ---- Reports: P&L and cash flow ----
    A("get", "report", async (req, res) => {
      const { from, to } = monthRange(req.query);
      const q = (sql, a) => pool.query(sql, a).then(r => r.rows);
      const [nights, other, cogsRows, expRows, purRows, openRows] = await Promise.all([
        salesByNight(from, to),
        q(`SELECT COALESCE(SUM(amount),0)::float AS amt FROM other_income WHERE date BETWEEN $1 AND $2`, [from, to]),
        // Used + wasted, plus stock missing at count time (a count above the book figure lowers the cost).
        q(`SELECT i.category, SUM(CASE WHEN m.type='adjust' THEN -m.qty ELSE m.qty END * m.unit_cost)::float AS amt
           FROM stock_moves m JOIN items i ON i.id=m.item_id
           WHERE m.date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [from, to]),
        q(`SELECT category, SUM(amount)::float AS amt FROM expenses WHERE date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC`, [from, to]),
        q(`SELECT COALESCE(i.kind,'other') AS kind, SUM(p.total)::float AS amt FROM purchases p LEFT JOIN items i ON i.id=p.item_id
           WHERE p.date BETWEEN $1 AND $2 GROUP BY 1`, [from, to]),
        cashEvents("0000-01-01", addDays(from, -1)),
      ]);
      const waste = (await q(`SELECT COALESCE(SUM(qty*unit_cost),0)::float AS amt FROM stock_moves WHERE type='waste' AND date BETWEEN $1 AND $2`, [from, to]))[0].amt;
      const bookingSales = nights.reduce((s, x) => s + x.revenue, 0);
      const otherIncome = other[0].amt;
      const revenue = bookingSales + otherIncome;
      const cogs = cogsRows.reduce((s, x) => s + x.amt, 0);
      const opex = expRows.reduce((s, x) => s + x.amt, 0);
      const guests = nights.reduce((s, x) => s + x.guests, 0);
      const noshowGuests = nights.reduce((s, x) => s + x.noshow_guests, 0);
      const byKind = Object.fromEntries(purRows.map(x => [x.kind, x.amt]));

      const days = await cashEvents(from, to);
      const opening = openRows.reduce((s, x) => s + netOf(x), 0);
      let run = opening;
      const daily = days.map(x => { const net = netOf(x); run += net; return { ...x, net, balance: run }; });
      const sum = k => days.reduce((s, x) => s + x[k], 0);
      const cash = {
        opening, downPayments: sum("downPayments"), balances: sum("balances"), otherIncome: sum("otherIncome"), capitalIn: sum("capitalIn"),
        purchases: sum("purchases"), expenses: sum("expenses"), ownerDraw: sum("ownerDraw"),
      };
      cash.totalIn = cash.downPayments + cash.balances + cash.otherIncome + cash.capitalIn;
      cash.totalOut = cash.purchases + cash.expenses + cash.ownerDraw;
      cash.closing = opening + cash.totalIn - cash.totalOut;

      res.json({
        from, to,
        pnl: {
          bookingSales, otherIncome, revenue, cogsByCategory: cogsRows, cogs, waste, grossProfit: revenue - cogs,
          expensesByCategory: expRows, opex, netProfit: revenue - cogs - opex,
          guests, noshowGuests, nights: nights.filter(x => x.guests || x.noshow_guests).length,
          foodCostPct: revenue ? cogs / revenue * 100 : 0,
          equipmentBought: byKind.asset || 0, stockBought: (byKind.consumable || 0) + (byKind.other || 0),
        },
        cash, daily,
      });
    });
  }

  return { migrate, routes, alert };
};
