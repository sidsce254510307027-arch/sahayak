// Phone OTP + JWT auth.
// In dev mode the OTP is returned in the API response so you can test without an
// SMS provider. Plug in MSG91 / Twilio in sendOtp() for production.
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import { db } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const OTP_TTL_MS = 5 * 60 * 1000;
const otpStore = new Map(); // phone:role -> { code, expires }

export function requestOtp(phone, role) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(`${phone}:${role}`, { code, expires: Date.now() + OTP_TTL_MS });
  // Always show OTP in response for demo/staging.
  // Set ENABLE_DEV_OTP=false in Render env vars to disable once real SMS is wired.
  const hideOtp = process.env.ENABLE_DEV_OTP === "false";
  return hideOtp ? {} : { devOtp: code };
}

/* `expect` comes from the welcome gate:
     "existing" — the person tapped "I already have an account", so a number with
                  no account is a typo, not a signup. Never create a row for it.
     "any"      — signup path (and the worker app), unchanged behaviour.
   Existence is only revealed AFTER a correct OTP, so this is not a way to probe
   which numbers are registered. */
export function verifyOtp(phone, role, code, expect = "any") {
  const key = `${phone}:${role}`;
  const entry = otpStore.get(key);
  if (!entry || entry.expires < Date.now() || entry.code !== code) return null;

  let user = db
    .prepare("SELECT * FROM users WHERE phone = ? AND role = ? AND deleted_at IS NULL")
    .get(phone, role);

  // Leave the OTP unspent so "create one instead" works without a re-send.
  if (!user && expect === "existing") return { noAccount: true };

  otpStore.delete(key);
  const isNew = !user;

  if (!user) {
    const id = nanoid();
    db.prepare("INSERT INTO users (id, phone, role) VALUES (?, ?, ?)").run(id, phone, role);
    if (role === "worker") {
      db.prepare("INSERT INTO worker_profiles (user_id) VALUES (?)").run(id);
    }
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  }
  if (user.suspended) return { suspended: true };

  const token = jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, {
    expiresIn: "30d",
  });
  return { token, user, isNew };
}

/* Admin logs in with a shared owner password (set ADMIN_PASSWORD in env),
   never a phone/OTP. Only owners who know the password can reach the console. */
export function adminLogin(password) {
  const expected = process.env.ADMIN_PASSWORD || "sahayak-admin";
  if (!password || password !== expected) return null;

  // Ensure a single canonical admin user row exists
  let admin = db.prepare("SELECT * FROM users WHERE role = 'admin' AND deleted_at IS NULL").get();
  if (!admin) {
    const id = nanoid();
    db.prepare("INSERT INTO users (id, phone, role, name) VALUES (?, ?, 'admin', 'Owner')")
      .run(id, "0000000000");
    admin = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  }
  const token = jwt.sign({ sub: admin.id, role: "admin" }, JWT_SECRET, { expiresIn: "7d" });
  return { token, user: admin };
}

export function authMiddleware(requiredRole) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "Missing token" });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
      if (!user || user.suspended)
        return res.status(401).json({ ok: false, error: "Account unavailable" });
      if (requiredRole && user.role !== requiredRole)
        return res.status(403).json({ ok: false, error: "Forbidden" });
      req.user = user;
      next();
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }
  };
}

export function verifySocketToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub) || null;
  } catch {
    return null;
  }
}
