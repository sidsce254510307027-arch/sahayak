import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requestOtp, verifyOtp, adminLogin, authMiddleware } from "../auth.js";
import { db } from "../db.js";
import { maskId } from "../crypto.js";

const router = Router();

const phoneSchema = z.object({
  phone: z.string().regex(/^\d{10}$/, "Enter a 10-digit phone number"),
  role: z.enum(["customer", "worker"]),
});

// Admin logs in with the owner password only — no phone/OTP for admin.
router.post("/admin-login", (req, res) => {
  const schema = z.object({ password: z.string().min(1).max(200) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Password required" });
  const result = adminLogin(parsed.data.password);
  if (!result) return res.status(401).json({ ok: false, error: "Incorrect password" });
  res.json({ ok: true, token: result.token, user: publicUser(result.user) });
});

router.post("/request-otp", (req, res) => {
  const parsed = phoneSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ ok: false, error: parsed.error.issues[0].message });
  const { phone, role } = parsed.data;
  const result = requestOtp(phone, role);
  res.json({ ok: true, ...result });
});

router.post("/verify-otp", (req, res) => {
  const parsed = phoneSchema
    .extend({ otp: z.string().length(6), expect: z.enum(["any", "existing"]).optional() })
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ ok: false, error: "Invalid input" });
  const { phone, role, otp, expect } = parsed.data;
  const result = verifyOtp(phone, role, otp, expect || "any");
  if (!result) return res.status(401).json({ ok: false, error: "Wrong or expired OTP" });
  if (result.noAccount)
    return res.status(404).json({
      ok: false,
      code: "NO_ACCOUNT",
      error: "No Sahayak account uses this number yet.",
    });
  if (result.suspended)
    return res.status(403).json({ ok: false, error: "Account suspended" });
  res.json({ ok: true, token: result.token, user: publicUser(result.user), isNew: !!result.isNew });
});

router.get("/me", authMiddleware(), (req, res) => {
  const user = publicUser(req.user);
  if (req.user.role === "worker") {
    const profile = db
      .prepare("SELECT * FROM worker_profiles WHERE user_id = ?")
      .get(req.user.id);
    if (profile) {
      // The raw Aadhaar never leaves the server — the app only ever sees the last 4 digits
      profile.aadhaar = maskId(profile.aadhaar);
      profile.aadhaar_set = !!profile.aadhaar;
    }
    user.profile = profile;
  }
  res.json({ ok: true, user });
});

router.patch("/me", authMiddleware(), (req, res) => {
  const schema = z.object({
    name: z.string().max(60).optional(),
    email: z.string().max(120).optional(),
    photo_url: z.string().max(300000).optional(), // supports small base64 data URLs
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid input" });
  const { name, email, photo_url } = parsed.data;
  if (name !== undefined)
    db.prepare("UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, req.user.id);
  if (email !== undefined)
    db.prepare("UPDATE users SET email = ?, updated_at = datetime('now') WHERE id = ?").run(email, req.user.id);
  if (photo_url !== undefined)
    db.prepare("UPDATE users SET photo_url = ?, updated_at = datetime('now') WHERE id = ?").run(photo_url, req.user.id);
  res.json({ ok: true });
});

// ---- Report / dispute / SOS (both roles)
router.post("/report", authMiddleware(), (req, res) => {
  const schema = z.object({
    job_id: z.string().optional(),
    kind: z.enum(["dispute", "sos", "other"]).default("dispute"),
    reason: z.string().max(500).default(""),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid report" });
  const { job_id, kind, reason } = parsed.data;
  db.prepare(
    "INSERT INTO reports (id, job_id, reporter_id, reporter_role, kind, reason) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(nanoid(), job_id || null, req.user.id, req.user.role, kind, reason);
  res.json({ ok: true });
});

// ---- Chat history for a job (participants only)
router.get("/jobs/:id/messages", authMiddleware(), (req, res) => {
  const job = db
    .prepare("SELECT * FROM jobs WHERE id = ? AND (customer_id = ? OR worker_id = ?)")
    .get(req.params.id, req.user.id, req.user.id);
  if (!job) return res.status(404).json({ ok: false, error: "Job not found" });
  const messages = db
    .prepare("SELECT * FROM messages WHERE job_id = ? ORDER BY created_at ASC LIMIT 200")
    .all(job.id);
  res.json({ ok: true, messages });
});

router.get("/services", (_req, res) => {
  res.json({
    ok: true,
    services: db.prepare("SELECT * FROM services WHERE active = 1").all(),
  });
});

router.get("/notifications", authMiddleware(), (req, res) => {
  res.json({
    ok: true,
    notifications: db
      .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30")
      .all(req.user.id),
  });
});

export function publicUser(u) {
  return { id: u.id, phone: u.phone, role: u.role, name: u.name, email: u.email, photo_url: u.photo_url };
}

export default router;
