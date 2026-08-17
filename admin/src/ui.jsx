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

/* ── OTP login ── */
export function Login({ role, title, subtitle, onDone, onBack }) {
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState("phone"); // phone | otp
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [devOtp, setDevOtp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refs = useRef([]);

  const sendOtp = async () => {
    setError("");
    setBusy(true);
    try {
      const r = await api("/auth/request-otp", { method: "POST", body: { phone, role } });
      setDevOtp(r.devOtp || "");
      setStage("otp");
      setTimeout(() => refs.current[0]?.focus(), 50);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const verify = async (code) => {
    setError("");
    setBusy(true);
    try {
      const r = await api("/auth/verify-otp", { method: "POST", body: { phone, role, otp: code } });
      session.token = r.token;
      session.user = r.user;
      resetSocket();
      onDone(r.user);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const setDigit = (i, v) => {
    if (!/^\d?$/.test(v)) return;
    const next = [...otp];
    next[i] = v;
    setOtp(next);
    if (v && i < 5) refs.current[i + 1]?.focus();
    const code = next.join("");
    if (code.length === 6) verify(code);
  };

  return (
    <div className="screen" style={{ paddingTop: 40, gap: 20 }}>
      {onBack && <button onClick={onBack} style={{ alignSelf: "flex-start", fontSize: 14, color: "var(--ink-2)", fontWeight: 600 }}>← Back</button>}
      <div>
        <div className="h1">{title}</div>
        <p className="sub" style={{ marginTop: 6 }}>{subtitle}</p>
      </div>

      {stage === "phone" && (
        <>
          <div className="field">
            <label>Phone number</label>
            <input
              inputMode="numeric" placeholder="10-digit mobile number" maxLength={10}
              value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && phone.length === 10 && sendOtp()}
            />
          </div>
          {error && <p className="sub" style={{ color: "var(--red)" }}>{error}</p>}
          <button className="btn btn-primary" disabled={phone.length !== 10 || busy} onClick={sendOtp}>
            {busy ? <span className="spin" /> : "Send OTP"}
          </button>
        </>
      )}

      {stage === "otp" && (
        <>
          <div className="field">
            <label>Enter the 6-digit code sent to {phone}</label>
            <div className="otp-row">
              {otp.map((d, i) => (
                <input key={i} ref={(el) => (refs.current[i] = el)} inputMode="numeric" maxLength={1}
                  value={d} onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => e.key === "Backspace" && !d && i > 0 && refs.current[i - 1]?.focus()} />
              ))}
            </div>
          </div>
          {devOtp && (
            <div className="card" style={{ background: "var(--amber-bg)", borderColor: "transparent" }}>
              <span className="tiny" style={{ color: "var(--amber)", fontWeight: 700 }}>DEV MODE</span>
              <p className="sub">Your OTP is <b>{devOtp}</b> (shown here because no SMS gateway is connected yet)</p>
            </div>
          )}
          {error && <p className="sub" style={{ color: "var(--red)" }}>{error}</p>}
          <button className="btn btn-ghost" onClick={() => { setStage("phone"); setOtp(["","","","","",""]); }}>Change number</button>
        </>
      )}
    </div>
  );
}

/* ── Mock live map (Google Maps drops in here later) ── */
export function LiveMap({ workerPos, customerPos, height = 230 }) {
  // Normalize positions into the box using a small window around the customer
  const toPct = (pos) => {
    if (!pos || !customerPos) return { left: "50%", top: "50%" };
    const dx = (pos.lng - customerPos.lng) / 0.05;
    const dy = (pos.lat - customerPos.lat) / 0.05;
    return {
      left: `${Math.min(92, Math.max(8, 50 + dx * 45))}%`,
      top: `${Math.min(88, Math.max(10, 50 - dy * 45))}%`,
    };
  };
  const w = toPct(workerPos);
  return (
    <div className="map" style={{ height }}>
      <div className="road" style={{ left: "10%", right: "5%", top: "38%", height: 10, transform: "rotate(-4deg)" }} />
      <div className="road" style={{ left: "55%", top: "8%", bottom: "10%", width: 10, transform: "rotate(6deg)" }} />
      <div className="road" style={{ left: "0%", right: "30%", top: "72%", height: 8 }} />
      <div className="pulse" style={{ left: "50%", top: "50%" }} />
      <div className="pin" style={{ left: "50%", top: "50%" }} title="You">📍</div>
      {workerPos && <div className="pin worker" style={w} title="Worker">🛵</div>}
    </div>
  );
}

export function Avatar({ name }) {
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
