// Realtime hub. Each user joins a private room `user:<id>`.
// Server-side code emits to those rooms; workers stream live location
// which is relayed to the customer of their active job.
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import { db } from "./db.js";
import { verifySocketToken } from "./auth.js";

let io = null;

export function initSockets(httpServer) {
  io = new Server(httpServer, { cors: { origin: "*" } });

  io.use((socket, next) => {
    const user = verifySocketToken(socket.handshake.auth?.token);
    if (!user) return next(new Error("unauthorized"));
    socket.user = user;
    next();
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.user.id}`);

    // Worker streams location during an active job
    socket.on("worker:location", ({ lat, lng }) => {
      if (socket.user.role !== "worker") return;
      db.prepare(
        "UPDATE worker_profiles SET lat = ?, lng = ?, updated_at = datetime('now') WHERE user_id = ?"
      ).run(lat, lng, socket.user.id);
      const active = db
        .prepare(
          "SELECT id, customer_id FROM jobs WHERE worker_id = ? AND status IN ('assigned','in_progress')"
        )
        .get(socket.user.id);
      if (active) {
        io.to(`user:${active.customer_id}`).emit("worker:location", {
          jobId: active.id,
          lat,
          lng,
        });
      }
    });

    // In-app chat between customer and worker of an active job
    socket.on("chat:send", ({ jobId, body }) => {
      if (!jobId || !body || String(body).length > 500) return;
      const job = db
        .prepare(
          "SELECT * FROM jobs WHERE id = ? AND status IN ('assigned','in_progress') AND (customer_id = ? OR worker_id = ?)"
        )
        .get(jobId, socket.user.id, socket.user.id);
      if (!job) return; // only participants of an active job can chat
      const msg = {
        id: nanoid(),
        job_id: jobId,
        sender_id: socket.user.id,
        body: String(body).slice(0, 500),
        created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      };
      db.prepare(
        "INSERT INTO messages (id, job_id, sender_id, body) VALUES (?, ?, ?, ?)"
      ).run(msg.id, msg.job_id, msg.sender_id, msg.body);
      const other = socket.user.id === job.customer_id ? job.worker_id : job.customer_id;
      io.to(`user:${other}`).emit("chat:message", msg);
      socket.emit("chat:message", msg); // echo back to sender
    });
  });

  return io;
}

export function emitTo(userId, event, payload) {
  if (io) io.to(`user:${userId}`).emit(event, payload);
}

// Persist + push a notification (FCM would hook in here for real devices).
export function notify(userId, type, title, body = "") {
  db.prepare(
    "INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)"
  ).run(nanoid(), userId, type, title, body);
  emitTo(userId, "notification", { type, title, body });
}
