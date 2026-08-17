// Matching engine: finds eligible workers for a job.
// Filters: correct skill, available, inside their own service radius,
// inside working hours, not busy on another active job.
import { db } from "../db.js";

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function insideWorkingHours(start, end, now = new Date()) {
  const mins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = (start || "00:00").split(":").map(Number);
  const [eh, em] = (end || "23:59").split(":").map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return s <= e ? mins >= s && mins <= e : mins >= s || mins <= e; // overnight shifts
}

export function findEligibleWorkers(job) {
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.photo_url, wp.*
       FROM worker_profiles wp
       JOIN users u ON u.id = wp.user_id
       WHERE wp.available = 1
         AND u.suspended = 0 AND u.deleted_at IS NULL
         AND wp.lat IS NOT NULL AND wp.lng IS NOT NULL`
    )
    .all();

  const busy = new Set(
    db
      .prepare(
        "SELECT worker_id FROM jobs WHERE worker_id IS NOT NULL AND status IN ('assigned','in_progress')"
      )
      .all()
      .map((r) => r.worker_id)
  );

  return rows
    .filter((w) => {
      if (busy.has(w.user_id)) return false;
      const skills = JSON.parse(w.skills || "[]");
      if (!skills.includes(job.service)) return false;
      if (!insideWorkingHours(w.work_start, w.work_end)) return false;
      const dist = haversineKm(job.lat, job.lng, w.lat, w.lng);
      return dist <= (w.radius_km || 5);
    })
    .map((w) => ({
      workerId: w.user_id,
      distanceKm: +haversineKm(job.lat, job.lng, w.lat, w.lng).toFixed(1),
    }));
}
