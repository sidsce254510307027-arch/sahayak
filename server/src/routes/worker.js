import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { encryptId } from "../crypto.js";
import { authMiddleware } from "../auth.js";
import { haversineKm } from "../services/matching.js";
import { emitTo, notify } from "../sockets.js";

const router = Router();
router.use(authMiddleware("worker"));

// ---- Profile
router.patch("/profile", (req, res) => {
  const schema = z.object({
    bio: z.string().max(300).optional(),
    experience_years: z.number().int().min(0).max(70).optional(),
    radius_km: z.number().min(1).max(50).optional(),
    skills: z.array(z.string()).optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    work_start: z.string().optional(),
    work_end: z.string().optional(),
    contact_phone: z.string().max(15).optional(),
    alt_phone: z.string().max(15).optional(),
    emergency_phone: z.string().max(15).optional(),
    aadhaar: z.string().max(12).optional(),
    area: z.string().max(120).optional(),
    home_address: z.string().max(300).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid profile" });
  const d = parsed.data;
  const cols = [];
  const vals = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    cols.push(`${k} = ?`);
    vals.push(k === "skills" ? JSON.stringify(v) : k === "aadhaar" ? encryptId(v) : v);
  }
  if (cols.length) {
    db.prepare(`UPDATE worker_profiles SET ${cols.join(", ")}, updated_at = datetime('now') WHERE user_id = ?`)
      .run(...vals, req.user.id);
  }
  res.json({ ok: true });
});

// ---- Availability toggle (stores lastAvailabilityToggle for the 7-day reminder cron)
router.post("/availability", (req, res) => {
  const available = req.body?.available ? 1 : 0;
  db.prepare(
    "UPDATE worker_profiles SET available = ?, last_availability_toggle = datetime('now') WHERE user_id = ?"
  ).run(available, req.user.id);
  res.json({ ok: true, available: !!available });
});

// ---- Accept a job → joins the customer's shortlist
router.post("/jobs/:id/accept", (req, res) => {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(req.params.id);
  if (!job || job.status !== "open")
    return res.status(400).json({ ok: false, error: "Job no longer open" });
  const wp = db.prepare("SELECT * FROM worker_profiles WHERE user_id = ?").get(req.user.id);
  const dist = wp?.lat != null ? haversineKm(job.lat, job.lng, wp.lat, wp.lng) : 5;
  const eta = Math.max(5, Math.round(dist * 4) + 5); // rough travel estimate

  try {
    db.prepare(
      "INSERT INTO job_acceptances (id, job_id, worker_id, eta_min) VALUES (?, ?, ?, ?)"
    ).run(nanoid(), job.id, req.user.id, eta);
  } catch {
    return res.status(400).json({ ok: false, error: "Already accepted" });
  }
  emitTo(job.customer_id, "shortlist:updated", { jobId: job.id });
  notify(job.customer_id, "acceptance", "A worker accepted your request", "Review the shortlist and pick one.");
  res.json({ ok: true, eta_min: eta });
});

// ---- Start job (optional OTP verification against customer's code)
router.post("/jobs/:id/start", (req, res) => {
  const job = myJob(req);
  if (!job || job.status !== "assigned")
    return res.status(400).json({ ok: false, error: "Job not assigned to you" });
  const { otp } = req.body || {};
  if (otp && otp !== job.otp_code)
    return res.status(400).json({ ok: false, error: "Wrong OTP" });
  db.prepare("UPDATE jobs SET status = 'in_progress', started_at = datetime('now') WHERE id = ?").run(job.id);
  emitTo(job.customer_id, "job:started", { jobId: job.id });
  res.json({ ok: true });
});

// ---- Complete job
router.post("/jobs/:id/complete", (req, res) => {
  const job = myJob(req);
  if (!job || job.status !== "in_progress")
    return res.status(400).json({ ok: false, error: "Job not in progress" });
  db.prepare("UPDATE jobs SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(job.id);
  db.prepare("UPDATE worker_profiles SET jobs_completed = jobs_completed + 1 WHERE user_id = ?").run(req.user.id);
  emitTo(job.customer_id, "job:completed", { jobId: job.id });
  notify(job.customer_id, "completed", "Job completed", "Please pay and rate your worker.");
  res.json({ ok: true });
});

// ---- Current + past jobs
router.get("/jobs", (req, res) => {
  const active = db
    .prepare(
      `SELECT j.*, u.name AS customer_name, u.phone AS customer_phone
       FROM jobs j JOIN users u ON u.id = j.customer_id
       WHERE j.worker_id = ? AND j.status IN ('assigned','in_progress')`
    )
    .get(req.user.id);
  const history = db
    .prepare(
      `SELECT j.*, u.name AS customer_name, p.amount AS paid_amount, p.mode AS paid_mode,
              p.net_worker_amount, p.commission_amount, r.stars
       FROM jobs j
       JOIN users u ON u.id = j.customer_id
       LEFT JOIN payments p ON p.job_id = j.id
       LEFT JOIN ratings r ON r.job_id = j.id
       WHERE j.worker_id = ? AND j.status = 'completed'
       ORDER BY j.completed_at DESC LIMIT 50`
    )
    .all(req.user.id);
  res.json({ ok: true, active: active || null, history });
});

// ---- Open jobs this worker can still accept (in case the push was missed)
router.get("/jobs/open", (req, res) => {
  const wp = db.prepare("SELECT * FROM worker_profiles WHERE user_id = ?").get(req.user.id);
  if (!wp || !wp.available) return res.json({ ok: true, jobs: [] });
  const skills = JSON.parse(wp.skills || "[]");
  const accepted = new Set(
    db.prepare("SELECT job_id FROM job_acceptances WHERE worker_id = ?").all(req.user.id).map((r) => r.job_id)
  );
  const jobs = db
    .prepare("SELECT * FROM jobs WHERE status = 'open' ORDER BY created_at DESC LIMIT 30")
    .all()
    .filter((j) => skills.includes(j.service) && !accepted.has(j.id))
    .map((j) => ({
      ...j,
      distanceKm: wp.lat != null ? +haversineKm(j.lat, j.lng, wp.lat, wp.lng).toFixed(1) : null,
    }))
    .filter((j) => j.distanceKm == null || j.distanceKm <= (wp.radius_km || 5));
  res.json({ ok: true, jobs });
});

// ---- Earnings dashboard
router.get("/earnings", (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, j.completed_at, j.started_at FROM payments p
       JOIN jobs j ON j.id = p.job_id
       WHERE j.worker_id = ? ORDER BY p.created_at DESC`
    )
    .all(req.user.id);

  const now = new Date();
  const sum = (filter) =>
    rows.filter(filter).reduce((acc, r) => acc + r.net_worker_amount, 0);
  const isSameDay = (d) => new Date(d + "Z").toDateString() === now.toDateString();
  const withinDays = (d, n) => (now - new Date(d + "Z")) / 86400000 <= n;

  res.json({
    ok: true,
    summary: {
      total_jobs: rows.length,
      today: sum((r) => isSameDay(r.created_at)),
      week: sum((r) => withinDays(r.created_at, 7)),
      month: sum((r) => withinDays(r.created_at, 30)),
      all_time: sum(() => true),
      commission_paid: rows.reduce((a, r) => a + r.commission_amount, 0),
      cash_jobs: rows.filter((r) => r.mode === "cash").length,
      digital_jobs: rows.filter((r) => r.mode !== "cash").length,
    },
    payments: rows.slice(0, 30),
  });
});

function myJob(req) {
  return db
    .prepare("SELECT * FROM jobs WHERE id = ? AND worker_id = ?")
    .get(req.params.id, req.user.id);
}

export default router;
