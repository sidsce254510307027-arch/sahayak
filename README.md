# Sahayak — Local Worker Marketplace

Three separate apps sharing one backend, like Blinkit's consumer + partner apps:

| App | Folder | Dev URL | Play Store name |
|---|---|---|---|
| Customer app | `customer-app/` | http://localhost:5173 | **Sahayak** |
| Worker app | `worker-app/` | http://localhost:5174 | **Sahayak Partner** |
| Admin dashboard | `admin/` | http://localhost:5175 | (web only) |
| Backend API | `server/` | http://localhost:3001 | — |

## Run it (needs Node.js LTS v22)

```bash
npm install
npm run setup     # installs all apps + seeds demo data
npm run dev       # starts server + all three apps
```

Then open:
- **Customer:** http://localhost:5173
- **Partner:** http://localhost:5174
- **Admin:** http://localhost:5175

### Demo flow (two windows side by side)
1. Open the Customer app, log in with any 10-digit phone (OTP shows on screen in dev mode).
2. Open the Partner app in a second window, log in as a seeded worker: **9000000001** (electrician), 9000000002 (plumber), 9000000003 (carpenter), 9000000004 (painter), 9000000005 (cleaner), 9000000006 (AC repair).
3. Post a job as the customer → watch it appear instantly on the partner screen.
4. Accept as the partner → select them as the customer → share the 4-digit start code → complete → pay → rate.
5. Admin (any phone, role auto-granted in dev) shows live stats, users, payments, commission control.

## Production single-port deployment

```bash
npm run build     # builds all three apps
npm start         # serves everything from :3001
```

- Customer app → `/`
- Partner app → `/partner`
- Admin → `/admin`

## Play Store (two separate apps, like Blinkit)

Each app wraps into its own Android app with Capacitor:

```bash
# Customer app ("Sahayak")
cd customer-app
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Sahayak" "com.sahayak.customer" --web-dir=dist
npm run build && npx cap add android && npx cap sync

# Worker app ("Sahayak Partner")
cd ../worker-app
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Sahayak Partner" "com.sahayak.partner" --web-dir=dist
npm run build && npx cap add android && npx cap sync
```

Before building for production, point each app at your hosted API: replace the Vite dev proxy with your server URL (set a base URL in `src/api.js`) and host `server/` somewhere public (any Node host; swap SQLite for Postgres via the notes in `server/src/db.js`).

Android Studio (or the command-line Android SDK) is only needed at this final packaging step to produce the signed `.aab` files — one per app, uploaded as **two separate Play Store listings**.

## Plug-in points (currently mocked for dev)
- **SMS OTP** → `server/src/auth.js` (dev mode returns OTP in the response; wire MSG91/Twilio here)
- **Payments** → `server/src/routes/customer.js` pay endpoint (wire Razorpay here)
- **Push notifications** → `server/src/sockets.js` notify() (wire FCM here)
- **Maps** → `LiveMap` in each app's `src/ui.jsx` (wire Google Maps SDK here)
- **Commission** → never hardcoded; admin-configurable, stored in the `settings` table
