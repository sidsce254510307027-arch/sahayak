import { io } from "socket.io-client";

export const session = {
  get token() { return localStorage.getItem("sahayak_cust_token"); },
  set token(t) { t ? localStorage.setItem("sahayak_cust_token", t) : localStorage.removeItem("sahayak_cust_token"); },
  get user() { const raw = localStorage.getItem("sahayak_cust_user"); return raw ? JSON.parse(raw) : null; },
  set user(u) { u ? localStorage.setItem("sahayak_cust_user", JSON.stringify(u)) : localStorage.removeItem("sahayak_cust_user"); },
  clear() { this.token = null; this.user = null; },
};

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Network error" }));
  // Stale/invalid token (e.g. server data was reset) — sign out cleanly instead of trapping the user
  if (res.status === 401 && session.token) {
    session.clear();
    resetSocket();
    location.reload();
    throw new Error("Session expired — please sign in again");
  }
  if (!data.ok) {
    const err = new Error(data.error || "Request failed");
    if (data.code) err.code = data.code;
    throw err;
  }
  return data;
}

let _socket;
export function getSocket() {
  if (!_socket) _socket = io("/", { auth: { token: session.token }, transports: ["websocket", "polling"] });
  return _socket;
}
export function resetSocket() { if (_socket) { _socket.disconnect(); _socket = null; } }

export const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
export const initials = (name) => (name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
