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

/* ── WelcomeGate — screen 0. Nothing starts until the person picks a lane.
     Returning users get a 2-step login; new users get the 4-step signup. ── */
const GATE_FACES = ["cleaner", "electrician", "plumber", "carpenter"];

export function WelcomeGate({ onSignup, onLogin }) {
  return (
    <div className="stage">
      <div className="phone">
        <div className="gate">
          <div className="gate-scroll">
            <div className="wordmark">Sahayak <small>AHMEDABAD</small></div>

            <div className="namaste"><span className="om">નમસ્તે</span> · Namaste</div>

            <div className="gate-h1">Verified help for<br /><em>ghar ke kaam</em></div>
            <p className="gate-sub">ઘરકામ માટે ભરોસાપાત્ર મદદ — તમારા વિસ્તારમાં.</p>

            <div className="gate-rule" />

            <div className="proof">
              <div className="avstack">
                {GATE_FACES.map((slug) => (
                  <img key={slug} src={`/services/${slug}.jpg`} alt="" loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = "none"; }} />
                ))}
                <div className="more">240+</div>
              </div>
              <div className="proof-line">Partners working across <b>Ahmedabad &amp; Surat</b></div>
            </div>

            <div className="trust">
              <div><span className="tick">✓</span><span><b>ID &amp; police-verified</b> partners — every single one</span></div>
              <div><span className="tick">✓</span><span><b>Price fixed before arrival</b> — no doorstep haggling</span></div>
              <div><span className="tick">✓</span><span><b>Pay after the work is done</b> — cash or UPI</span></div>
            </div>
          </div>

          <div className="gate-foot">
            <button className="btn btn-primary" onClick={onSignup}>
              Create my account <span className="arr">→</span>
            </button>
            <div className="or">OR</div>
            <button className="btn btn-ghost" onClick={onLogin}>I already have an account</button>
            <p className="gate-terms">By continuing you agree to the Terms of use &amp; Privacy policy</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Login — phone + OTP as a proper 2-step wizard ──
   mode "login"  → 2 steps, no account is ever created for a mistyped number
   mode "signup" → 4 steps (phone, OTP, name, address) */
export function Login({ role, onDone, grandTotal, baseStep = 0, mode = "signup", onQuit }) {
  const [stage, setStage] = useState("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [devOtp, setDevOtp] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [noAccount, setNoAccount] = useState(false);
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
  const verify = async (code, force) => {
    setErr(""); setNoAccount(false); setBusy(true);
    try {
      const body = { phone, role, otp: code };
      if (mode === "login" && !force) body.expect = "existing";
      const r = await api("/auth/verify-otp", { method: "POST", body });
      session.token = r.token; session.user = r.user; resetSocket();
      onDone(r.user);
    } catch (e) {
      // Right OTP, no account behind the number — offer signup instead of a dead end.
      if (e.code === "NO_ACCOUNT") setNoAccount(true);
      else setErr(e.message);
      setBusy(false);
    }
  };
  const setDigit = (i, v) => {
    if (!/^\d?$/.test(v)) return;
    const next = [...otp]; next[i] = v; setOtp(next);
    if (v && i < 5) refs.current[i + 1]?.focus();
    const code = next.join("");
    if (code.length === 6) verify(code);
  };

  const backToPhone = () => { setStage("phone"); setOtp(["","","","","",""]); setErr(""); setNoAccount(false); };

  const kicker = role === "worker" ? "Sahayak Partner"
    : mode === "login" ? "Welcome back" : "Welcome to Sahayak";

  return (
    <div className="stage">
      <WizardFrame
        step={baseStep + (stage === "phone" ? 0 : 1)}
        total={grandTotal || 2}
        canBack={stage === "otp" || !!onQuit}
        onBack={() => (stage === "otp" ? backToPhone() : onQuit?.())}
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
                : mode === "login"
                  ? <>Log in with your <em>mobile number</em></>
                  : <>Let's start with your <em>mobile number</em></>}
            </div>
            <p className="sub">
              {role === "worker"
                ? "Get jobs from customers in your area. Set your own hours. Cash out weekly."
                : mode === "login"
                  ? "The number you signed up with. We'll send a one-time code."
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
            {devOtp && !noAccount && (
              <div className="card" style={{ background: "var(--amber-bg)", borderColor: "transparent" }}>
                <span className="tiny" style={{ color: "var(--amber)", fontWeight: 800 }}>DEMO MODE</span>
                <p className="sub">Your code is <b style={{ fontSize: 17, letterSpacing: 2 }}>{devOtp}</b> — shown until SMS is connected.</p>
              </div>
            )}
            {noAccount && (
              <div className="card" style={{ background: "var(--blue-50)", borderColor: "var(--blue-100)" }}>
                <b style={{ color: "var(--head)", fontSize: 15 }}>No account on this number yet</b>
                <p className="sub" style={{ marginTop: 4 }}>
                  Check the number, or create an account with it now — the code you just entered still works.
                </p>
                <button className="btn btn-primary btn-small" style={{ marginTop: 12 }}
                  disabled={busy} onClick={() => verify(otp.join(""), true)}>
                  Create account with this number <span className="arr">→</span>
                </button>
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

/* ── ServiceTile — photo first, emoji fallback (no SVG) ── */
export function ServiceTile({ service, onClick }) {
  const [failed, setFailed] = useState(false);
  return (
    <button className="svc" onClick={onClick}>
      <span className="svc-art">
        {!failed ? (
          <img src={`/services/${service.slug}.jpg`} alt={service.label} loading="lazy"
            onError={() => setFailed(true)} />
        ) : (
          <span className="svc-glyph">{service.icon || "🛠️"}</span>
        )}
      </span>
      <span className="svc-name">{service.label}</span>
    </button>
  );
}

/* ── BookingSheet — 2-tap booking modal
   Tap 1: user tapped a service tile on Home (parent opened this sheet)
   Tap 2: user taps "Confirm & post" here
   Everything else is a defaulted chip they can change. */
export function BookingSheet({ service, user, gps, onClose, onPosted, push }) {
  const [when, setWhen] = useState("now"); // "now" | "today" | "tomorrow"
  const [slot, setSlot] = useState("");
  const [pay, setPay] = useState("upi"); // upi | cash | card
  const [address, setAddress] = useState(user?.defaultAddress || localStorage.getItem("sahayak_cust_address") || "");
  const [editAddr, setEditAddr] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [err, setErr] = useState("");

  const post = async () => {
    if (!service) return;
    setPosting(true); setErr("");
    try {
      const scheduledFor = when === "now" ? null
        : when === "today" ? new Date(new Date().toDateString() + " " + (slot || "10:00")).toISOString()
        : (() => { const t = new Date(); t.setDate(t.getDate() + 1); return new Date(t.toDateString() + " " + (slot || "10:00")).toISOString(); })();
      const body = {
        service: service.slug,
        pay_mode: pay,
        urgency: when === "now" ? "now" : "scheduled",
        scheduled_for: scheduledFor,
        address_text: address,
        lat: gps?.lat, lng: gps?.lng,
      };
      const r = await api("/customer/jobs", { method: "POST", body });
      setPosted(true);
      // remember address if changed
      if (address) localStorage.setItem("sahayak_cust_address", address);
      setTimeout(() => { onPosted?.(r.job); }, 300);
    } catch (e) {
      setErr(e.message || "Couldn't post — please try again");
      setPosting(false);
    }
  };

  const canPost = address.trim().length >= 4 && (when !== "today" || slot) && (when !== "tomorrow" || slot) && !posting;

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-grip" />

        {!posted && (
          <>
            <div className="sheet-top">
              <div className="sheet-ico">
                <img src={`/services/${service.slug}.jpg`} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              </div>
              <div>
                <b>Book {service.label}</b>
                <span>Confirm & post in a tap</span>
              </div>
              <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
            </div>

            <div className="sheet-info">
              <div className="row-line">
                <span className="k">👤 {user?.name || "You"}</span>
                <span className="v">+91 {user?.phone?.slice(0,5) || "•••••"} {user?.phone?.slice(5) || "•••••"}</span>
              </div>
              <div className="row-line">
                <span className="k">📍 Address</span>
                <span className="v">
                  {editAddr ? (
                    <input value={address} onChange={(e) => setAddress(e.target.value)} onBlur={() => setEditAddr(false)}
                      autoFocus style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", width: 200, fontSize: 13 }} />
                  ) : (
                    <>
                      {address ? (address.length > 32 ? address.slice(0,32) + "…" : address) : "Add address"}
                      <button className="edit" onClick={() => setEditAddr(true)}>Change</button>
                    </>
                  )}
                </span>
              </div>
            </div>

            <div>
              <div className="sec-label">When</div>
              <div className="chip-row">
                {[["now","⚡ Now"],["today","📅 Today"],["tomorrow","🗓️ Tomorrow"]].map(([v,l]) => (
                  <button key={v} className={`chip ${when === v ? "on" : ""}`} onClick={() => { setWhen(v); if (v !== "today" && v !== "tomorrow") setSlot(""); }}>{l}</button>
                ))}
              </div>
              {(when === "today" || when === "tomorrow") && (
                <div className="chip-row" style={{ marginTop: 8 }}>
                  {["10:00", "12:00", "14:00", "16:00", "18:00"].map((t) => (
                    <button key={t} className={`chip ${slot === t ? "on" : ""}`} onClick={() => setSlot(t)}>{t}</button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="sec-label">Pay after job</div>
              <div className="chip-row">
                {[["upi","UPI"],["cash","Cash"],["card","Card"]].map(([v,l]) => (
                  <button key={v} className={`chip ${pay === v ? "on" : ""}`} onClick={() => setPay(v)}>{l}</button>
                ))}
              </div>
            </div>

            {err && <p className="sub" style={{ color: "var(--red)" }}>{err}</p>}

            <button className="btn btn-primary" disabled={!canPost} onClick={post}>
              {posting ? <span className="spin" /> : <>Confirm & post job <span className="arr">→</span></>}
            </button>
          </>
        )}

        {posted && (
          <div className="celebrate">
            <div className="ring"><div className="check">✓</div></div>
            <div className="h1">Request is <em>out there</em></div>
            <p className="sub" style={{ textAlign: "center" }}>
              Nearby {service.label.toLowerCase()}s are getting pinged. You'll get a notification the moment someone accepts — usually under 4 minutes.
            </p>
            <button className="btn btn-primary" onClick={onClose}>Back to home</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ── Real live map (Leaflet + OpenStreetMap) ── */
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const customerIcon = L.divIcon({ className: "leaflet-pin", html: "📍", iconSize: [28, 28], iconAnchor: [14, 28] });
const workerIcon = L.divIcon({ className: "leaflet-pin", html: "🛵", iconSize: [28, 28], iconAnchor: [14, 28] });

export function LiveMap({ workerPos, customerPos, height = 260 }) {
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const custMarker = useRef(null);
  const workMarker = useRef(null);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapObj.current) return;
    const center = customerPos ? [customerPos.lat, customerPos.lng] : [20.5937, 78.9629];
    const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView(center, 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);
    L.control.attribution({ prefix: false, position: "bottomright" })
      .addAttribution('© <a href="https://openstreetmap.org">OSM</a>')
      .addTo(map);
    mapObj.current = map;
    // Customer marker
    if (customerPos) {
      custMarker.current = L.marker([customerPos.lat, customerPos.lng], { icon: customerIcon })
        .addTo(map).bindPopup("Your location");
    }
    return () => { map.remove(); mapObj.current = null; };
  }, []);

  // Update worker marker in real time
  useEffect(() => {
    if (!mapObj.current || !workerPos) return;
    if (workMarker.current) {
      workMarker.current.setLatLng([workerPos.lat, workerPos.lng]);
    } else {
      workMarker.current = L.marker([workerPos.lat, workerPos.lng], { icon: workerIcon })
        .addTo(mapObj.current).bindPopup("Worker is on the way");
    }
    // Fit both markers in view
    if (custMarker.current) {
      const bounds = L.latLngBounds([custMarker.current.getLatLng(), workMarker.current.getLatLng()]);
      mapObj.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }, [workerPos?.lat, workerPos?.lng]);

  return <div ref={mapRef} style={{ height, borderRadius: 14, overflow: "hidden", border: "1px solid var(--line)" }} />;
}

/* ── Get user's real GPS location ── */
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

/* ── Service tile ────────────────────────────────────────────────
   Uses a real photo from /services/<slug>.jpg when you add one.
   Until then it falls back to a rich duotone tile so nothing looks broken.
   To use real photography: drop electrician.jpg, plumber.jpg … into
   customer-app/public/services/ (square, ~400×400, licensed for your use).
─────────────────────────────────────────────────────────────────*/
const TILE_ART = {
  electrician: ["#3d5afe", "#1a237e"], plumber: ["#00b8d4", "#006064"],
  carpenter: ["#c07a3e", "#5d3a1a"], painter: ["#ff7043", "#bf360c"],
  cleaner: ["#26c6da", "#00838f"], mechanic: ["#78909c", "#37474f"],
  "ac-repair": ["#4fc3f7", "#01579b"], "appliance-repair": ["#7e57c2", "#311b92"],
  "ro-service": ["#29b6f6", "#0277bd"], cctv: ["#546e7a", "#263238"],
  mason: ["#a1887f", "#4e342e"], welder: ["#ff8a65", "#d84315"],
  interior: ["#ab47bc", "#6a1b9a"], gardening: ["#66bb6a", "#1b5e20"],
};
