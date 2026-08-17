import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db, getSetting } from "../db.js";
import { authMiddleware } from "../auth.js";
import { findEligibleWorkers, haversineKm } from "../services/matching.js";
import { emitTo, notify } from "../sockets.js";

const router = Router();
router.use(authMiddleware("customer"));

// ---- Post a job → matching engine broadcasts to eligible workers
router.post("/jobs", (req, res) => {
  const schema = z.object({
    service: z.string(),
    description: z.string().max(500).default(""),
    slot: z.string().max(60).default(""),
    urgency: z.enum(["normal", "urgent"]).default("normal"),
    lat: z.number(),
    lng: z.number(),
    address: z.string().max(200).default(""),
    price_offered: z.number().int().nonnegative().optional(),
    pay_mode: z.enum(["cash", "upi", "card", "wallet"]).default("cash"),
    preferred_time: z.string().max(60).default("ASAP"),
    preferred_worker_id: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ ok: false, error: parsed.error.issues[0].message });
  const j = parsed.data;

  const service = db.prepare("SELECT * FROM services WHERE slug = ?").get(j.service);
  if (!service) return res.status(400).json({ ok: false, error: "Unknown service" });
  // Customers no longer name a price — the service's base rate is used and the
  // final amount is confirmed at payment time.
  const price = j.price_offered && j.price_offered > 0 ? j.price_offered : (service.price_min || 0);

  const id = nanoid();
  const otp = String(Math.floor(1000 + Math.random() * 9000));
  db.prepare(
    `INSERT INTO jobs (id, customer_id, service, description, urgency, lat, lng, address, price_offered, pay_mode, preferred_time, preferred_worker_id, otp_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.user.id, j.service, j.description, j.urgency, j.lat, j.lng, j.address, price, j.pay_mode, j.slot || j.preferred_time, j.preferred_worker_id || null, otp);

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  let eligible = findEligibleWorkers(job);
  // Rebooking: if the customer asked for a specific worker, ping only them (when eligible)
  if (j.preferred_worker_id) {
    const preferred = eligible.filter((w) => w.workerId === j.preferred_worker_id);
    if (preferred.length) eligible = preferred;
  }
  for (const w of eligible) {
    emitTo(w.workerId, "job:new", { job, distanceKm: w.distanceKm });
    notify(w.workerId, "new_job", `New ${service.label} job nearby`, `₹${price} · ${w.distanceKm} km away`);
  }
  res.json({ ok: true, job, notified: eligible.length });
});

// ---- Shortlist of workers who accepted
router.get("/jobs/:id/shortlist", (req, res) => {
  const job = ownJob(req);
  if (!job) return res.status(404).json({ ok: false, error: "Job not found" });
  const rows = db
    .prepare(
      `SELECT a.id AS acceptance_id, a.eta_min, a.created_at, u.id AS worker_id, u.name, u.photo_url,
              wp.skills, wp.experience_years, wp.bio, wp.rating_sum, wp.rating_count, wp.jobs_completed, wp.lat, wp.lng
       FROM job_acceptances a
       JOIN users u ON u.id = a.worker_id
       JOIN worker_profiles wp ON wp.user_id = u.id
       WHERE a.job_id = ? AND a.status = 'pending'
       ORDER BY a.created_at ASC`
    )
    .all(job.id);
  const shortlist = rows.map((r) => ({
    ...r,
    skills: JSON.parse(r.skills || "[]"),
    rating: r.rating_count ? +(r.rating_sum / r.rating_count).toFixed(1) : null,
    distanceKm: r.lat != null ? +haversineKm(job.lat, job.lng, r.lat, r.lng).toFixed(1) : null,
  }));
  res.json({ ok: true, job, shortlist });
});

// ---- Choose one worker; everyone else gets "job taken"
router.post("/jobs/:id/select", (req, res) => {
  const job = ownJob(req);
  if (!job || job.status !== "open")
    return res.status(400).json({ ok: false, error: "Job is not open" });
  const { worker_id } = req.body || {};
  const acceptance = db
    .prepare("SELECT * FROM job_acceptances WHERE job_id = ? AND worker_id = ?")
    .get(job.id, worker_id);
  if (!acceptance) return res.status(400).json({ ok: false, error: "Worker did not accept this job" });

  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE jobs SET status = 'assigned', worker_id = ?, assigned_at = datetime('now') WHERE id = ?"
    ).run(worker_id, job.id);
    db.prepare("UPDATE job_acceptances SET status = 'selected' WHERE id = ?").run(acceptance.id);
    db.prepare(
      "UPDATE job_acceptances SET status = 'rejected' WHERE job_id = ? AND id != ?"
    ).run(job.id, acceptance.id);
  });
  tx();

  emitTo(worker_id, "job:selected", { jobId: job.id });
  notify(worker_id, "selected", "You got the job! 🎉", "Head to the customer's location.");
  const others = db
    .prepare("SELECT worker_id FROM job_acceptances WHERE job_id = ? AND status = 'rejected'")
    .all(job.id);
  for (const o of others) {
    emitTo(o.worker_id, "job:taken", { jobId: job.id });
    notify(o.worker_id, "taken", "Job taken", "The customer chose another worker.");
  }
  res.json({ ok: true });
});

// ---- Cancel (free while open; fee recorded if a worker was already assigned)
router.post("/jobs/:id/cancel", (req, res) => {
  const job = ownJob(req);
  if (!job || !["open", "assigned"].includes(job.status))
    return res.status(400).json({ ok: false, error: "Cannot cancel now" });
  const fee = job.status === "assigned" ? parseInt(getSetting("cancel_fee") || "0", 10) : 0;
  db.prepare("UPDATE jobs SET status = 'cancelled', cancel_fee = ? WHERE id = ?").run(fee, job.id);
  if (job.worker_id) {
    emitTo(job.worker_id, "job:cancelled", { jobId: job.id });
    notify(job.worker_id, "cancelled", "Job cancelled by customer");
  }
  res.json({ ok: true, cancel_fee: fee });
});

// ---- Pay (records commission split; Razorpay hooks in here for real UPI/card)
router.post("/jobs/:id/pay", (req, res) => {
  const job = ownJob(req);
  if (!job || job.status !== "completed")
    return res.status(400).json({ ok: false, error: "Job must be completed first" });
  const existing = db.prepare("SELECT id FROM payments WHERE job_id = ?").get(job.id);
  if (existing) return res.status(400).json({ ok: false, error: "Already paid" });

  const schema = z.object({
    mode: z.enum(["cash", "upi", "card", "wallet"]),
    amount: z.number().int().positive(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payment" });
  const { mode, amount } = parsed.data;

  const pct = parseFloat(getSetting("commission_pct")); // never hardcoded
  const commission = Math.round((amount * pct) / 100);
  const net = amount - commission;

  db.prepare(
    `INSERT INTO payments (id, job_id, amount, mode, commission_pct, commission_amount, net_worker_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(nanoid(), job.id, amount, mode, pct, commission, net);

  emitTo(job.worker_id, "payment:received", { jobId: job.id, amount, net, commission, mode });
  notify(job.worker_id, "payment", `Payment received · ₹${amount}`, `₹${net} credited after ${pct}% commission`);
  res.json({ ok: true, amount, commission_pct: pct, commission, net_worker_amount: net });
});

// ---- Rate the worker
router.post("/jobs/:id/rate", (req, res) => {
  const job = ownJob(req);
  if (!job || job.status !== "completed")
    return res.status(400).json({ ok: false, error: "Job must be completed first" });
  const schema = z.object({ stars: z.number().int().min(1).max(5), review: z.string().max(400).default("") });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid rating" });
  const { stars, review } = parsed.data;

  try {
    const tx = db.transaction(() => {
      db.prepare(
        "INSERT INTO ratings (id, job_id, worker_id, stars, review) VALUES (?, ?, ?, ?, ?)"
      ).run(nanoid(), job.id, job.worker_id, stars, review);
      db.prepare(
        "UPDATE worker_profiles SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE user_id = ?"
      ).run(stars, job.worker_id);
    });
    tx();
  } catch {
    return res.status(400).json({ ok: false, error: "Already rated" });
  }
  notify(job.worker_id, "rating", `New rating: ${"★".repeat(stars)}`, review);
  res.json({ ok: true });
});

// ---- History + current job
router.get("/jobs", (req, res) => {
  const jobs = db
    .prepare(
      `SELECT j.*, u.name AS worker_name, u.phone AS worker_phone, u.photo_url AS worker_photo,
              p.amount AS paid_amount, p.mode AS paid_mode, r.stars AS my_stars
       FROM jobs j
       LEFT JOIN users u ON u.id = j.worker_id
       LEFT JOIN payments p ON p.job_id = j.id
       LEFT JOIN ratings r ON r.job_id = j.id
       WHERE j.customer_id = ? AND j.deleted_at IS NULL
       ORDER BY j.created_at DESC LIMIT 50`
    )
    .all(req.user.id);
  res.json({ ok: true, jobs });
});

function ownJob(req) {
  return db
    .prepare("SELECT * FROM jobs WHERE id = ? AND customer_id = ?")
    .get(req.params.id, req.user.id);
}

export default router;
