// Database layer — SQLite for MVP, schema designed to port cleanly to PostgreSQL.
// UUID keys, timestamps, soft-delete flags, indexed lookup columns.
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "sahayak.db");

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','worker','admin')),
  name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  photo_url TEXT DEFAULT '',
  suspended INTEGER DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (phone, role)
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone);

CREATE TABLE IF NOT EXISTS worker_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  bio TEXT DEFAULT '',
  languages TEXT DEFAULT '[]',        -- JSON array
  skills TEXT DEFAULT '[]',           -- JSON array of service slugs
  experience_years INTEGER DEFAULT 0,
  radius_km REAL DEFAULT 5,
  lat REAL, lng REAL,
  available INTEGER DEFAULT 0,
  last_availability_toggle TEXT DEFAULT (datetime('now')),
  work_start TEXT DEFAULT '08:00',
  work_end TEXT DEFAULT '20:00',
  rating_sum INTEGER DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  jobs_completed INTEGER DEFAULT 0,
  contact_phone TEXT DEFAULT '',
  alt_phone TEXT DEFAULT '',
  emergency_phone TEXT DEFAULT '',
  aadhaar TEXT DEFAULT '',
  area TEXT DEFAULT '',
  home_address TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_worker_geo ON worker_profiles (lat, lng);
CREATE INDEX IF NOT EXISTS idx_worker_available ON worker_profiles (available);

CREATE TABLE IF NOT EXISTS services (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  icon TEXT DEFAULT '',
  price_min INTEGER DEFAULT 0,
  price_max INTEGER DEFAULT 0,
  duration_min INTEGER DEFAULT 60,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  service TEXT NOT NULL REFERENCES services(slug),
  description TEXT DEFAULT '',
  urgency TEXT DEFAULT 'normal' CHECK (urgency IN ('normal','urgent')),
  lat REAL NOT NULL, lng REAL NOT NULL,
  address TEXT DEFAULT '',
  price_offered INTEGER NOT NULL,
  pay_mode TEXT DEFAULT 'cash' CHECK (pay_mode IN ('cash','upi','card','wallet')),
  preferred_time TEXT DEFAULT 'ASAP',
  preferred_worker_id TEXT REFERENCES users(id),
  status TEXT DEFAULT 'open' CHECK (status IN ('open','assigned','in_progress','completed','cancelled','expired')),
  worker_id TEXT REFERENCES users(id),
  otp_code TEXT,
  cancel_fee INTEGER DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  assigned_at TEXT, started_at TEXT, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs (customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_worker ON jobs (worker_id);
CREATE INDEX IF NOT EXISTS idx_jobs_service ON jobs (service);

CREATE TABLE IF NOT EXISTS job_acceptances (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  worker_id TEXT NOT NULL REFERENCES users(id),
  eta_min INTEGER DEFAULT 20,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','selected','rejected')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (job_id, worker_id)
);
CREATE INDEX IF NOT EXISTS idx_acc_job ON job_acceptances (job_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  amount INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('cash','upi','card','wallet')),
  commission_pct REAL NOT NULL,
  commission_amount INTEGER NOT NULL,
  net_worker_amount INTEGER NOT NULL,
  status TEXT DEFAULT 'paid' CHECK (status IN ('paid','pending','refunded')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pay_job ON payments (job_id);

CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  worker_id TEXT NOT NULL REFERENCES users(id),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  review TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (user_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id),
  reporter_id TEXT NOT NULL REFERENCES users(id),
  reporter_role TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('dispute','sos','other')),
  reason TEXT DEFAULT '',
  status TEXT DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_job ON messages (job_id);
`);

// ---- Migrations for existing databases (safe to re-run)
const migrate = (sql) => { try { db.exec(sql); } catch { /* column already exists */ } };
migrate("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''");
migrate("ALTER TABLE services ADD COLUMN price_min INTEGER DEFAULT 0");
migrate("ALTER TABLE services ADD COLUMN price_max INTEGER DEFAULT 0");
migrate("ALTER TABLE jobs ADD COLUMN pay_mode TEXT DEFAULT 'cash'");
migrate("ALTER TABLE jobs ADD COLUMN preferred_worker_id TEXT");
migrate("ALTER TABLE jobs ADD COLUMN cancel_fee INTEGER DEFAULT 0");
migrate("ALTER TABLE jobs ADD COLUMN slot TEXT DEFAULT ''");
migrate("ALTER TABLE services ADD COLUMN duration_min INTEGER DEFAULT 60");
migrate("ALTER TABLE worker_profiles ADD COLUMN contact_phone TEXT DEFAULT ''");
migrate("ALTER TABLE worker_profiles ADD COLUMN alt_phone TEXT DEFAULT ''");
migrate("ALTER TABLE worker_profiles ADD COLUMN emergency_phone TEXT DEFAULT ''");
migrate("ALTER TABLE worker_profiles ADD COLUMN aadhaar TEXT DEFAULT ''");
migrate("ALTER TABLE worker_profiles ADD COLUMN area TEXT DEFAULT ''");
migrate("ALTER TABLE worker_profiles ADD COLUMN home_address TEXT DEFAULT ''");

// Defaults
const setDefault = db.prepare(
  "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
);
setDefault.run("commission_pct", "12");
setDefault.run("cancel_fee", "50");          // ₹ fee for cancelling after a worker is assigned
setDefault.run("job_expiry_min", "30");      // open jobs auto-expire after this many minutes

// slug, label, icon, suggested price range (₹) — guidance shown to customers
// slug, label, icon, price range (₹), typical duration (minutes)
const SERVICES = [
  ["electrician", "Electrician", "\u26a1", 200, 800, 60],
  ["plumber", "Plumber", "\ud83d\udd27", 200, 700, 60],
  ["carpenter", "Carpenter", "\ud83e\udeb5", 300, 1200, 120],
  ["painter", "Painter", "\ud83c\udfa8", 500, 3000, 240],
  ["cleaner", "Cleaner", "\ud83e\uddf9", 200, 900, 90],
  ["mechanic", "Mechanic", "\ud83d\udee0\ufe0f", 250, 1000, 90],
  ["ac-repair", "AC Repair", "\u2744\ufe0f", 400, 1500, 90],
  ["appliance-repair", "Appliance Repair", "\ud83d\udd0c", 250, 1200, 60],
  ["ro-service", "RO Service", "\ud83d\udca7", 300, 900, 60],
  ["cctv", "CCTV Installation", "\ud83d\udcf7", 800, 4000, 180],
  ["mason", "Mason", "\ud83e\uddf1", 500, 1500, 240],
  ["welder", "Welder", "\ud83d\udd25", 300, 1200, 120],
  ["interior", "Interior Work", "\ud83d\udecb\ufe0f", 1000, 8000, 240],
  ["gardening", "Gardening", "\ud83c\udf3f", 200, 800, 90],
];
const insertService = db.prepare(
  "INSERT OR IGNORE INTO services (slug, label, icon, price_min, price_max, duration_min) VALUES (?, ?, ?, ?, ?, ?)"
);
for (const s of SERVICES) insertService.run(...s);
// Keep price guidance current for existing rows too
const updPrice = db.prepare("UPDATE services SET price_min = ?, price_max = ?, duration_min = ? WHERE slug = ?");
for (const [slug, , , mn, mx, dur] of SERVICES) updPrice.run(mn, mx, dur, slug);

export function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}
export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}
