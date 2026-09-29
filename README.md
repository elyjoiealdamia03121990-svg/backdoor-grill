# Backdoor Grill — Booking + Back Office

Unli samgyup buffet night: customers mo-book online, bayad daan sa GCash (non-refundable), limited slots matag gabii, naay cut-off.

- `/` — booking page para sa customers (pili og gabii, pila ka ulo, GCash ref no., check sa booking code)
- `/admin` — back office (login, i-verify ang GCash, mark Niabot / No-show, settings, CSV download)

## Files (tanan sa root sa repo)
`server.js`, `package.json`, `render.yaml`, `index.html`, `admin.html`, `style.css`, `README.md`

## Deploy sa Render
1. Himo og bag-o nga GitHub repo (private), i-upload ang tanan files sa root.
2. Sa Render: **New → Blueprint** → pili ang repo. Himoon niya ang web service `backdoor-grill` ug database `backdoor-grill-db`.
3. Mangayo siya og `ADMIN_PASSWORD` — ibutang ang password para sa back office.
4. Hulata nga **Live**. Ablihi ang `/admin`, login, ug i-set sa Settings ang GCash name/number ug max heads matag gabii.

## Pahinumdom
- Ang free Postgres sa Render naay expiry. Inig live na gyud, i-upgrade ang database sa paid plan aron dili mawala ang bookings.
- Ang free web service matulog kung walay bisita; ang unang pag-abli mahimong hinay og pipila ka segundo.
- Cut-off ug oras kay Philippine time (UTC+8).
