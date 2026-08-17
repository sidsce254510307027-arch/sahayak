import React, { useEffect, useRef, useState } from "react";
import { api, session, resetSocket, initials } from "./api.js";

/* ── Toasts ── */
export function ToastHost({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <b>{t.title}</b>
          {t.body}
        </div>
      ))}
    </div>
  );
}
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = (title, body = "") => {
    const id = Math.random();
    setToasts((ts) => [...ts, { id, title, body }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 4200);
  };
  return { toasts, push };
}

/* ── Wizard scaffolding (used by Login + first-time onboarding) ── */
export function WizardFrame({ step, total, onBack, canBack, children, footer }) {
  const pct = total > 0 ? (step / total) * 100 : 0;
  return (
    <div className="phone">
      <div className="topbar">
        <button className="back" onClick={onBack} style={{ visibility: canBack ? "visible" : "hidden" }}>‹</button>
        <div className="progress"><span style={{ width: `${pct}%` }} /></div>
        <div className="step-count">{step + 1} / {total}</div>
      </div>
      <div className="phone-scroll">{children}</div>
      {footer && <div style={{ flex: "0 0 auto", padding: "14px 18px calc(14px + env(safe-area-inset-bottom))" }}>{footer}</div>}
    </div>
  );
}

/* ── Login — phone + OTP as a proper 2-step wizard ── */
export function Login({ role, onDone, grandTotal, baseStep = 0 }) {
  const [stage, setStage] = useState("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [devOtp, setDevOtp] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const refs = useRef([]);

  const sendOtp = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await api("/auth/request-otp", { method: "POST", body: { phone, role } });
      setDevOtp(r.devOtp || "");
      setStage("otp");
      setTimeout(() => refs.current[0]?.focus(), 60);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const verify = async (code) => {
    setErr(""); setBusy(true);
    try {
      const r = await api("/auth/verify-otp", { method: "POST", body: { phone, role, otp: code } });
      session.token = r.token; session.user = r.user; resetSocket();
      onDone(r.user);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const setDigit = (i, v) => {
    if (!/^\d?$/.test(v)) return;
    const next = [...otp]; next[i] = v; setOtp(next);
    if (v && i < 5) refs.current[i + 1]?.focus();
    const code = next.join("");
    if (code.length === 6) verify(code);
  };

  const kicker = role === "worker" ? "Sahayak Partner" : "Welcome to Sahayak";

  return (
    <div className="stage">
      <WizardFrame
        step={baseStep + (stage === "phone" ? 0 : 1)}
        total={grandTotal || 2}
        canBack={stage === "otp"}
        onBack={() => { setStage("phone"); setOtp(["","","","","",""]); setErr(""); }}
        footer={
          stage === "phone"
            ? <button className="btn btn-primary" disabled={phone.length !== 10 || busy} onClick={sendOtp}>
                {busy ? <span className="spin" /> : <>Continue <span className="arr">→</span></>}
              </button>
            : <button className="btn btn-ghost" onClick={() => { setStage("phone"); setOtp(["","","","","",""]); setErr(""); }}>
                Change number
              </button>
        }
      >
        {stage === "phone" && (
          <div className="page">
            <div className="kicker">{kicker}</div>
            <div className="h1">
              {role === "worker"
                ? <>Earn on <em>your terms</em>. Start with your mobile number.</>
                : <>Let's start with your <em>mobile number</em></>}
            </div>
            <p className="sub">
              {role === "worker"
                ? "Get jobs from customers in your area. Set your own hours. Cash out weekly."
                : "We'll send a one-time code to verify it. No spam, ever."}
            </p>
            <div className="phone-pill">
              <span className="cc">+91</span>
              <input inputMode="numeric" placeholder="10-digit mobile number" maxLength={10}
                value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && phone.length === 10 && sendOtp()}
                autoFocus />
              {phone && <button className="clr" onClick={() => setPhone("")} aria-label="Clear">✕</button>}
            </div>
            {err && <p className="sub" style={{ color: "var(--red)" }}>{err}</p>}
            <p className="tiny" style={{ textAlign: "center" }}>By continuing you agree to the Terms of use & Privacy policy</p>
          </div>
        )}
        {stage === "otp" && (
          <div className="page">
            <div className="kicker">Verify</div>
            <div className="h1">Enter the <em>6-digit code</em></div>
            <p className="sub">Sent to <b>+91 {phone.replace(/(\d{5})(\d{5})/, "$1 $2")}</b></p>
            <div className="otp-row">
              {otp.map((d, i) => (
                <input key={i} ref={(el) => (refs.current[i] = el)} inputMode="numeric" maxLength={1}
                  value={d} onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => e.key === "Backspace" && !d && i > 0 && refs.current[i - 1]?.focus()} />
              ))}
            </div>
            {devOtp && (
              <div className="card" style={{ background: "var(--amber-bg)", borderColor: "transparent" }}>
                <span className="tiny" style={{ color: "var(--amber)", fontWeight: 800 }}>DEMO MODE</span>
                <p className="sub">Your code is <b style={{ fontSize: 17, letterSpacing: 2 }}>{devOtp}</b> — shown until SMS is connected.</p>
              </div>
            )}
            {err && <p className="sub" style={{ color: "var(--red)" }}>{err}</p>}
            {busy && <p className="sub">Verifying…</p>}
          </div>
        )}
      </WizardFrame>
    </div>
  );
}

/* ── Real map for worker (Leaflet + OpenStreetMap) ── */
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const customerIcon = L.divIcon({ className: "leaflet-pin", html: "📍", iconSize: [28, 28], iconAnchor: [14, 28] });
const workerIcon = L.divIcon({ className: "leaflet-pin", html: "🛵", iconSize: [28, 28], iconAnchor: [14, 28] });

export function JobMap({ customerPos, workerPos, height = 220 }) {
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const custMarker = useRef(null);
  const workMarker = useRef(null);

  useEffect(() => {
    if (!mapRef.current || mapObj.current) return;
    const center = customerPos ? [customerPos.lat, customerPos.lng] : [20.5937, 78.9629];
    const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView(center, 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    L.control.attribution({ prefix: false, position: "bottomright" })
      .addAttribution('© <a href="https://openstreetmap.org">OSM</a>')
      .addTo(map);
    mapObj.current = map;
    if (customerPos) {
      custMarker.current = L.marker([customerPos.lat, customerPos.lng], { icon: customerIcon })
        .addTo(map).bindPopup("Customer location");
    }
    return () => { map.remove(); mapObj.current = null; };
  }, []);

  // Update worker's own position on map
  useEffect(() => {
    if (!mapObj.current || !workerPos) return;
    if (workMarker.current) {
      workMarker.current.setLatLng([workerPos.lat, workerPos.lng]);
    } else {
      workMarker.current = L.marker([workerPos.lat, workerPos.lng], { icon: workerIcon })
        .addTo(mapObj.current).bindPopup("You");
    }
    if (custMarker.current) {
      const bounds = L.latLngBounds([custMarker.current.getLatLng(), workMarker.current.getLatLng()]);
      mapObj.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }, [workerPos?.lat, workerPos?.lng]);

  return (
    <div>
      <div ref={mapRef} style={{ height, borderRadius: 14, overflow: "hidden", border: "1px solid var(--line)" }} />
      {customerPos && (
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${customerPos.lat},${customerPos.lng}`}
          target="_blank" rel="noopener noreferrer"
          className="btn btn-primary btn-small"
          style={{ width: "100%", marginTop: 10, textAlign: "center", display: "block", textDecoration: "none" }}
        >
          🧭 Navigate to customer
        </a>
      )}
    </div>
  );
}

/* ── Real GPS tracking hook ── */
export function useLiveLocation(enabled) {
  const [loc, setLoc] = useState(null);
  const watchId = useRef(null);
  useEffect(() => {
    if (!enabled || !navigator.geolocation) {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000 }
    );
    return () => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); };
  }, [enabled]);
  return loc;
}

/* ── One-shot location ── */
export function useMyLocation() {
  const [loc, setLoc] = useState(null);
  const [error, setError] = useState(null);
  const request = () => {
    if (!navigator.geolocation) { setError("Geolocation not supported"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setError(err.message),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };
  return { loc, error, request };
}

export function Avatar({ name, photo }) {
  if (photo) return <img className="avatar" src={photo} alt={name} style={{ objectFit: "cover" }} />;
  return <div className="avatar">{initials(name)}</div>;
}

export function Stars({ value, onChange }) {
  return (
    <div className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={n <= value ? "on" : ""} onClick={() => onChange(n)} aria-label={`${n} stars`}>★</button>
      ))}
    </div>
  );
}

export function useNotificationSocket(socket, push) {
  useEffect(() => {
    if (!socket) return;
    const h = (n) => push(n.title, n.body);
    socket.on("notification", h);
    return () => socket.off("notification", h);
  }, [socket]);
}

/* ── In-app chat for an active job ── */
export function JobChat({ jobId, socket, myId, otherName }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    api(`/auth/jobs/${jobId}/messages`).then((r) => setMessages(r.messages)).catch(() => {});
    const h = (m) => m.job_id === jobId && setMessages((ms) => [...ms, m]);
    socket.on("chat:message", h);
    return () => socket.off("chat:message", h);
  }, [jobId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, open]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    socket.emit("chat:send", { jobId, body });
    setText("");
  };

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <button className="row" style={{ width: "100%", padding: "12px 14px", textAlign: "left" }} onClick={() => setOpen(!open)}>
        <b className="grow">💬 Chat with {otherName}</b>
        <span className="tiny">{open ? "▲" : `${messages.length ? messages.length : ""} ▼`}</span>
      </button>
      {open && (
        <>
          <div style={{ maxHeight: 220, overflowY: "auto", padding: "0 14px", display: "flex", flexDirection: "column", gap: 6 }}>
            {messages.length === 0 && <p className="tiny" style={{ textAlign: "center", padding: 10 }}>Say hello 👋 — messages are only visible during this job.</p>}
            {messages.map((m) => (
              <div key={m.id} style={{
                alignSelf: m.sender_id === myId ? "flex-end" : "flex-start",
                background: m.sender_id === myId ? "var(--blue-700)" : "var(--paper-2, #f1f3f7)",
                color: m.sender_id === myId ? "#fff" : "var(--ink)",
                borderRadius: 12, padding: "7px 12px", maxWidth: "80%", fontSize: 14,
              }}>
                {m.body}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="row" style={{ padding: 10, gap: 8 }}>
            <input className="grow" placeholder="Type a message…" value={text} style={{ minWidth: 0 }}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()} />
            <button className="btn btn-primary btn-small" onClick={send} disabled={!text.trim()}>Send</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── SOS / report button for active jobs ── */
export function SosButton({ jobId, push }) {
  const [open, setOpen] = useState(false);
  const report = async (kind, reason) => {
    try {
      await api("/auth/report", { method: "POST", body: { job_id: jobId, kind, reason } });
      push(kind === "sos" ? "🆘 SOS logged" : "Report submitted", "Our team has been notified.");
      setOpen(false);
    } catch (e) { push("Couldn't submit", e.message); }
  };
  return (
    <div>
      <button className="btn btn-danger btn-small" style={{ width: "100%" }} onClick={() => setOpen(!open)}>
        🆘 SOS / Report a problem
      </button>
      {open && (
        <div className="card" style={{ marginTop: 8, borderColor: "var(--red)" }}>
          <p className="sub"><b>In immediate danger?</b></p>
          <a className="btn btn-danger" style={{ width: "100%", margin: "8px 0", textAlign: "center", display: "block", textDecoration: "none" }}
            href="tel:112">📞 Call emergency services (112)</a>
          <p className="sub" style={{ marginTop: 6 }}><b>Or report an issue:</b></p>
          <div className="chip-row" style={{ marginTop: 6 }}>
            {["Unsafe behaviour", "Didn't show up", "Payment issue", "Other"].map((r) => (
              <button key={r} className="chip" onClick={() => report(r === "Unsafe behaviour" ? "sos" : "dispute", r)}>{r}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Swipe to go online ─────────────────────────────────────────
   Drag the knob across to start receiving jobs; drag it back to pause.
   Deliberately harder to trigger than a tap, so a stray touch can't
   knock someone offline mid-shift.

   Uses Pointer Events with setPointerCapture so move/up are delivered
   to the knob itself — no window listeners, and no stale-closure bugs.
   The live position lives in a ref so the release handler always reads
   the true value rather than whatever state existed when it was bound.
─────────────────────────────────────────────────────────────────*/
export function SwipeToggle({ on, onChange, busy }) {
  const trackRef = useRef(null);
  const posRef = useRef(0);
  const startRef = useRef(0);
  const maxRef = useRef(1);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const KNOB = 54, PAD = 5;
  const maxTravel = () => Math.max(1, (trackRef.current?.offsetWidth || 0) - KNOB - PAD * 2);

  const down = (e) => {
    if (busy) return;
    maxRef.current = maxTravel();
    startRef.current = e.clientX - (on ? maxRef.current : 0);
    posRef.current = on ? maxRef.current : 0;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const move = (e) => {
    if (!dragging) return;
    const next = Math.max(0, Math.min(maxRef.current, e.clientX - startRef.current));
    posRef.current = next;
    setX(next);
  };

  const up = (e) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(false);
    const crossed = posRef.current > maxRef.current * 0.5;
    posRef.current = 0;
    setX(0);
    if (crossed !== on) onChange(crossed);
  };

  const progress = dragging ? x / maxRef.current : on ? 1 : 0;
  const restX = on ? maxTravel() : 0;

  return (
    <div className={`swipe ${on ? "on" : ""} ${busy ? "busy" : ""}`} ref={trackRef}>
      <div className="swipe-fill" style={{
        transform: `scaleX(${progress})`,
        transition: dragging ? "none" : "transform .3s ease",
      }} />
      <span className="swipe-label">
        {busy ? "One moment…" : on ? "Swipe back to pause" : "Swipe to go online"}
      </span>
      <button
        type="button"
        className="swipe-knob"
        aria-label={on ? "Swipe back to pause" : "Swipe to go online"}
        style={{
          transform: `translateX(${dragging ? x : restX}px)`,
          transition: dragging ? "none" : "transform .3s cubic-bezier(.3,1.25,.5,1)",
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!busy) onChange(!on); }
        }}
      >
        {busy ? <span className="spin" style={{ borderColor: "rgba(0,0,0,.15)", borderTopColor: "var(--brand)" }} />
          : on ? <span className="knob-glyph">✓</span>
          : <span className="knob-glyph">→</span>}
      </button>
    </div>
  );
}
