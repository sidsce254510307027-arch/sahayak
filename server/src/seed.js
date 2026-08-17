// Seed demo workers — location is NOT pre-set.
// Workers get their real GPS coordinates when they go online in the app.
import { nanoid } from "nanoid";
import { db } from "./db.js";

const demo = [
  { name: "Ramesh Kumar", skills: ["electrician", "appliance-repair"], exp: 8, phone: "9000000001" },
  { name: "Suresh Yadav", skills: ["plumber", "ro-service"], exp: 5, phone: "9000000002" },
  { name: "Anil Sharma", skills: ["carpenter", "interior"], exp: 12, phone: "9000000003" },
  { name: "Vikram Singh", skills: ["painter", "mason"], exp: 6, phone: "9000000004" },
  { name: "Meena Devi", skills: ["cleaner", "gardening"], exp: 4, phone: "9000000005" },
  { name: "Irfan Ali", skills: ["ac-repair", "electrician"], exp: 10, phone: "9000000006" },
];

for (const [i, w] of demo.entries()) {
  const existing = db.prepare("SELECT id FROM users WHERE phone = ? AND role = 'worker'").get(w.phone);
  if (existing) continue;
  const id = nanoid();
  db.prepare("INSERT INTO users (id, phone, role, name) VALUES (?, ?, 'worker', ?)").run(id, w.phone, w.name);
  db.prepare(
    `INSERT INTO worker_profiles (user_id, skills, experience_years, radius_km, available,
      bio, rating_sum, rating_count, jobs_completed, work_start, work_end)
     VALUES (?, ?, ?, 15, 0, ?, ?, ?, ?, '00:00', '23:59')`
  ).run(
    id,
    JSON.stringify(w.skills),
    w.exp,
    `${w.exp} years of experience. Reliable and on time.`,
    40 + i * 4,
    10 + i,
    25 + i * 7
  );
}
console.log("Seeded demo workers. Log in as any of them (9000000001–9000000006) and allow GPS to go online.");
