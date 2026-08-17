import { Router } from "express";
import { nanoid } from "nanoid";
import { db, getSetting, setSetting } from "../db.js";
import { authMiddleware } from "../auth.js";

const router = Router();
router.use(authMiddleware("admin"));

router.get("/dashboard", (_req, res) => {
  const q = (sql) => db.prepare(sql).get();
  res.json({
    ok: true,
    stats: {
      customers: q("SELECT COUNT(*) c FROM users WHERE role='customer' AND deleted_at IS NULL").c,
      workers: q("SELECT COUNT(*) c FROM users WHERE role='worker' AND deleted_at IS NULL").c,
      workers_online: q("SELECT COUNT(*) c FROM worker_profiles WHERE available=1").c,
      jobs_total: q("SELECT COUNT(*) c FROM jobs").c,
      jobs_active: q("SELECT COUNT(*) c FROM jobs WHERE status IN ('open','assigned','in_progress')").c,
      jobs_completed: q("SELECT COUNT(*) c FROM jobs WHERE status='completed'").c,
      gross_volume: q("SELECT COALESCE(SUM(amount),0) c FROM payments").c,
      platform_revenue: q("SELECT COALESCE(SUM(commission_amount),0) c FROM payments").c,
      commission_pct: parseFloat(getSetting("commission_pct")),
    },
  });
});

router.get("/jobs", (_req, res) => {
  res.json({
    ok: true,
    jobs: db
      .prepare(
        `SELECT j.*, c.name AS customer_name, c.phone AS customer_phone,
                w.name AS worker_name, p.amount AS paid_amount, p.commission_amount
         FROM jobs j
         JOIN users c ON c.id = j.customer_id
         LEFT JOIN users w ON w.id = j.worker_id
         LEFT JOIN payments p ON p.job_id = j.id
         ORDER BY j.created_at DESC LIMIT 100`
      )
      .all(),
  });
});

router.get("/users", (req, res) => {
  const role = req.query.role === "worker" ? "worker" : "customer";
  let users = db
    .prepare("SELECT id, phone, name, role, suspended, created_at FROM users WHERE role = ? ORDER BY created_at DESC LIMIT 200")
    .all(role);
  if (role === "worker") {
    const profiles = new Map(
      db.prepare("SELECT * FROM worker_profiles").all().map((p) => [p.user_id, p])
    );
    users = users.map((u) => {
      const p = profiles.get(u.id);
      return {
        ...u,
        skills: p ? JSON.parse(p.skills || "[]") : [],
        available: p ? !!p.available : false,
        rating: p && p.rating_count ? +(p.rating_sum / p.rating_count).toFixed(1) : null,
        jobs_completed: p ? p.jobs_completed : 0,
      };
    });
  }
  res.json({ ok: true, users });
});

router.post("/users/:id/suspend", (req, res) => {
  const suspended = req.body?.suspended ? 1 : 0;
  db.prepare("UPDATE users SET suspended = ? WHERE id = ?").run(suspended, req.params.id);
  db.prepare("INSERT INTO audit_logs (id, actor_id, action, detail) VALUES (?, ?, ?, ?)").run(
    nanoid(), req.user.id, suspended ? "suspend_user" : "unsuspend_user", req.params.id
  );
  res.json({ ok: true });
});

router.post("/commission", (req, res) => {
  const pct = Number(req.body?.pct);
  if (!(pct >= 0 && pct <= 50))
    return res.status(400).json({ ok: false, error: "Commission must be 0–50%" });
  setSetting("commission_pct", pct);
  db.prepare("INSERT INTO audit_logs (id, actor_id, action, detail) VALUES (?, ?, ?, ?)").run(
    nanoid(), req.user.id, "set_commission", String(pct)
  );
  res.json({ ok: true, commission_pct: pct });
});

router.get("/payments", (_req, res) => {
  res.json({
    ok: true,
    payments: db
      .prepare(
        `SELECT p.*, j.service, w.name AS worker_name FROM payments p
         JOIN jobs j ON j.id = p.job_id LEFT JOIN users w ON w.id = j.worker_id
         ORDER BY p.created_at DESC LIMIT 100`
      )
      .all(),
  });
});

// ---- Reports / disputes / SOS
router.get("/reports", (_req, res) => {
  res.json({
    ok: true,
    reports: db
      .prepare(
        `SELECT r.*, u.name AS reporter_name, u.phone AS reporter_phone, j.service
         FROM reports r
         JOIN users u ON u.id = r.reporter_id
         LEFT JOIN jobs j ON j.id = r.job_id
         ORDER BY r.created_at DESC LIMIT 100`
      )
      .all(),
  });
});

router.post("/reports/:id/resolve", (req, res) => {
  db.prepare("UPDATE reports SET status = 'resolved' WHERE id = ?").run(req.params.id);
  db.prepare("INSERT INTO audit_logs (id, actor_id, action, detail) VALUES (?, ?, ?, ?)").run(
    nanoid(), req.user.id, "resolve_report", req.params.id
  );
  res.json({ ok: true });
});

export default router;
