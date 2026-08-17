import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import { db, getSetting } from "./db.js";
import { initSockets, notify } from "./sockets.js";
import authRoutes from "./routes/auth.js";
import customerRoutes from "./routes/customer.js";
import workerRoutes from "./routes/worker.js";
import adminRoutes from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
initSockets(server);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Simple in-memory rate limit on auth endpoints (swap for Redis in prod)
const hits = new Map();
app.use("/api/auth", (req, _res, next) => {
  const key = req.ip;
  const now = Date.now();
  const entry = hits.get(key) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  hits.set(key, entry);
  if (entry.count > 30) return next(new Error("rate_limited"));
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/worker", workerRoutes);
app.use("/api/admin", adminRoutes);
app.get("/api/health", (_req, res) => res.json({ ok: true, name: "sahayak" }));

// Serve the built apps (single-port deployment: `npm run build` at the root first)
// Customer app at /, Partner app at /partner, Admin at /admin
const customerDist = path.join(__dirname, "..", "..", "customer-app", "dist");
const partnerDist = path.join(__dirname, "..", "..", "worker-app", "dist");
const adminDist = path.join(__dirname, "..", "..", "admin", "dist");

// Cache built assets and service photos hard — they're immutable per deploy,
// so browsers/CDN keep them instead of re-downloading ~3.5MB of images each visit.
const staticOpts = {
  setHeaders: (res, filePath) => {
    if (/\.(png|jpg|jpeg|webp|svg|woff2?|ttf)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else if (/\/assets\//.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
};
app.use("/partner", express.static(partnerDist, staticOpts));
app.use("/admin", express.static(adminDist, staticOpts));
app.use(express.static(customerDist, staticOpts));
app.get(/^\/partner(?!\/api|\/socket\.io).*/, (_req, res) => {
  res.sendFile(path.join(partnerDist, "index.html"), (err) => {
    if (err) res.status(200).send("Sahayak API running. Build apps with: npm run build");
  });
});
app.get(/^\/admin(?!\/api|\/socket\.io).*/, (_req, res) => {
  res.sendFile(path.join(adminDist, "index.html"), (err) => {
    if (err) res.status(200).send("Sahayak API running. Build apps with: npm run build");
  });
});
app.get(/^\/(?!api|socket\.io).*/, (_req, res) => {
  res.sendFile(path.join(customerDist, "index.html"), (err) => {
    if (err) res.status(200).send("Sahayak API running. Build apps with: npm run build");
  });
});

// Error handler — standardized response shape
app.use((err, _req, res, _next) => {
  if (err.message === "rate_limited")
    return res.status(429).json({ ok: false, error: "Too many requests, slow down" });
  console.error(err);
  res.status(500).json({ ok: false, error: "Something went wrong" });
});

// ---- Cron: daily check, remind workers paused for 7+ days
setInterval(() => {
  const stale = db
    .prepare(
      `SELECT user_id FROM worker_profiles
       WHERE available = 0 AND last_availability_toggle < datetime('now', '-7 days')`
    )
    .all();
  for (const w of stale) {
    notify(w.user_id, "reminder", "You've been paused for a week", "Go online to start receiving jobs again.");
    db.prepare("UPDATE worker_profiles SET last_availability_toggle = datetime('now') WHERE user_id = ?").run(w.user_id);
  }
}, 24 * 60 * 60 * 1000);

// ---- Cron: every minute, expire open jobs past the expiry window
setInterval(() => {
  const mins = parseInt(getSetting("job_expiry_min") || "30", 10);
  const expired = db
    .prepare(
      `SELECT id, customer_id FROM jobs
       WHERE status = 'open' AND created_at < datetime('now', ?)`
    )
    .all(`-${mins} minutes`);
  for (const j of expired) {
    db.prepare("UPDATE jobs SET status = 'expired' WHERE id = ?").run(j.id);
    notify(j.customer_id, "expired", "No worker took your job 😕",
      "Try posting again with a higher price, or at a different time.");
  }
}, 60 * 1000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n  Sahayak server running → http://localhost:${PORT}\n`);
});
