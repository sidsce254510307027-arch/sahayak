import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, getSocket, session, rupee } from "./api.js";
import { ToastHost, useToasts, Login, Avatar, useNotificationSocket, JobMap, useLiveLocation, JobChat, SosButton, SwipeToggle, WizardFrame } from "./ui.jsx";

export default function WorkerApp({ onExit }) {
  const [user, setUser] = useState(session.user?.role === "worker" ? session.user : null);
  if (!user) {
    return <Login role="worker" onDone={setUser} grandTotal={6} baseStep={0} />;
  }
  return <WorkerHome user={user} setUser={setUser} onExit={onExit} />;
}

function WorkerHome({ user, setUser, onExit }) {
  const { toasts, push } = useToasts();
  const socket = useMemo(() => getSocket(), []);
  useNotificationSocket(socket, push);

  const [tab, setTab] = useState("jobs");
  const [toggling, setToggling] = useState(false);
  const [profile, setProfile] = useState(null);
  const [services, setServices] = useState([]);
  const [openJobs, setOpenJobs] = useState([]);
  const [active, setActive] = useState(null);
  const [history, setHistory] = useState([]);

  const refresh = async () => {
    const [me, jobs] = await Promise.all([api("/auth/me"), api("/worker/jobs")]);
    setProfile(me.user.profile);
    // Keep user state in sync (fixes profile-setup not transitioning after save)
    const updated = { ...user, name: me.user.name, photo_url: me.user.photo_url };
    session.user = updated;
    setUser(updated);
    setActive(jobs.active);
    setHistory(jobs.history);
    if (me.user.profile?.available) {
      const open = await api("/worker/jobs/open");
      setOpenJobs(open.jobs);
    } else setOpenJobs([]);
  };

  useEffect(() => {
    api("/auth/services").then((r) => setServices(r.services));
    refresh();
    const onNew = ({ job, distanceKm }) => {
      push(`New job: ${job.service}`, `${rupee(job.price_offered)} · ${distanceKm} km away`);
      refresh();
    };
    const onEvent = () => refresh();
    socket.on("job:new", onNew);
    ["job:selected", "job:taken", "job:cancelled", "payment:received"].forEach((e) => socket.on(e, onEvent));
    return () => {
      socket.off("job:new", onNew);
      ["job:selected", "job:taken", "job:cancelled", "payment:received"].forEach((e) => socket.off(e, onEvent));
    };
  }, []);

  // Real GPS tracking — send live location to customer while on active job
  const liveGps = useLiveLocation(!!active);
  useEffect(() => {
    if (liveGps && active) {
      socket.emit("worker:location", { lat: liveGps.lat, lng: liveGps.lng });
      // Also update worker profile location
      api("/worker/profile", { method: "PATCH", body: { lat: liveGps.lat, lng: liveGps.lng } }).catch(() => {});
    }
  }, [liveGps?.lat, liveGps?.lng, active?.id]);

  if (!profile) return <div className="empty" style={{ paddingTop: 100 }}><div className="big">⏳</div>Loading…</div>;

  const skills = JSON.parse(profile.skills || "[]");
  const needsSetup = skills.length === 0 || !user.name;

  const setAvailability = async (on) => {
    if (toggling) return;
    setToggling(true);
    try {
      if (on) {
        // Must get real GPS — no hardcoded fallback
        try {
          const pos = await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(
              (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
              reject, { enableHighAccuracy: true, timeout: 8000 }
            ));
          await api("/worker/profile", { method: "PATCH", body: pos });
        } catch {
          push("📍 Location required", "Please allow GPS access in your browser to go online and receive jobs.");
          return; // Don't go online without location
        }
      }
      await api("/worker/availability", { method: "POST", body: { available: on } });
      push(on ? "You're online 🟢" : "You're paused",
        on ? "You'll get jobs matching your skills and hours." : "No job notifications until you resume.");
      await refresh();
    } catch (e) {
      push("Couldn't update", e.message);
    } finally {
      setToggling(false);
    }
  };

  const body = () => {
    if (needsSetup)
      return <WorkerOnboarding user={user} profile={profile} services={services} push={push}
        onDone={() => { refresh(); setTab("jobs"); }} />;
    if (tab === "profile")
      return <ProfileSetup user={user} profile={profile} services={services} push={push}
        onSaved={() => { refresh(); setTab("jobs"); }} onExit={onExit} firstTime={false} />;
    if (tab === "earnings") return <Earnings history={history} />;
    return (
      <div className="screen">
        <div className="card row avail-hero" style={{
          background: profile.available
            ? "linear-gradient(150deg, var(--brand) 0%, var(--brand-deep) 100%)"
            : "linear-gradient(150deg, #3a4152 0%, #23293a 100%)",
          color: "#fff", border: "none", padding: "20px 18px",
        }}>
          <div className="grow">
            <b style={{ fontFamily: "var(--display)", fontSize: 19 }}>
              {profile.available ? "You're online 🟢" : "You're offline"}
            </b>
            <p className="tiny" style={{ color: "rgba(255,255,255,.75)", marginTop: 3 }}>
              {profile.available ? "Getting jobs that match your skills" : "Swipe below to start receiving jobs"}
            </p>
          </div>
        </div>

        <SwipeToggle on={!!profile.available} busy={toggling} onChange={setAvailability} />

        {active && <ActiveJob job={active} push={push} refresh={refresh} workerPos={liveGps} socket={socket} />}

        {!active && (
          <>
            <div className="h2">Jobs near you</div>
            {!profile.available && <div className="empty"><div className="big">😴</div>Go online to see job requests</div>}
            {!!profile.available && openJobs.length === 0 && <div className="empty"><div className="big">📡</div>Listening for new jobs…</div>}
            <div className="list">
              {openJobs.map((j) => <OpenJobCard key={j.id} job={j} push={push} refresh={refresh} />)}
            </div>
          </>
        )}

        {/* ── Quick stats ── */}
        <div>
          <div className="h2" style={{ marginBottom: 10 }}>Your snapshot</div>
          <div className="stat-grid">
            <div className="stat"><div className="k">Rating</div><div className="v">{profile.rating_count ? (profile.rating_sum / profile.rating_count).toFixed(1) + "★" : "New"}</div></div>
            <div className="stat"><div className="k">Jobs done</div><div className="v">{profile.jobs_completed || 0}</div></div>
            <div className="stat"><div className="k">Skills</div><div className="v">{JSON.parse(profile.skills || "[]").length}</div></div>
            <div className="stat"><div className="k">Hours</div><div className="v" style={{ fontSize: 17 }}>{(profile.work_start || "08:00")}–{(profile.work_end || "20:00")}</div></div>
          </div>
        </div>

        {/* ── Tips to earn more ── */}
        <div>
          <div className="h2" style={{ marginBottom: 10 }}>Tips to earn more</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {[
              ["🕐", "Stay online during peak hours", "6–10 AM and 5–9 PM have 3x more jobs."],
              ["⭐", "Keep your rating above 4.5", "Customers prefer top-rated workers. Be punctual and polite."],
              ["📸", "Add a profile photo", "Workers with photos get 40% more selections."],
              ["🎯", "Set the right radius", "Too small = fewer jobs. Too large = long travel. 8–15 km is ideal."],
              ["⚡", "Accept fast", "Quick responses get more selections. Turn on notifications."],
            ].map(([ico, title, desc], i) => (
              <div key={i} className="row" style={{ padding: "14px 0", borderBottom: i < 4 ? "1px solid var(--line)" : "none", gap: 14 }}>
                <div style={{ width: 42, height: 42, borderRadius: 14, background: "var(--wash)", display: "grid", placeItems: "center", fontSize: 20, flex: "none" }}>{ico}</div>
                <div className="grow">
                  <b style={{ fontSize: 13.5 }}>{title}</b>
                  <p className="tiny" style={{ marginTop: 2 }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── How payouts work ── */}
        <div className="card" style={{ background: "linear-gradient(160deg, var(--brand-ink), var(--brand-deep))", color: "#fff", borderColor: "transparent" }}>
          <b style={{ fontFamily: "var(--display)", fontSize: 16 }}>How you get paid</b>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {[
              ["💵", "Cash jobs", "Customer pays you directly. Platform fee is deducted from your next digital payout."],
              ["📱", "UPI / Card jobs", "Payment goes through the platform. Your share is settled daily."],
              ["📊", "Commission", "A small platform fee (set by admin) is deducted from each job. You see the exact split in Earnings."],
            ].map(([ico, t, d]) => (
              <div key={t} className="row" style={{ alignItems: "flex-start", gap: 10 }}>
                <span style={{ fontSize: 22, flex: "none", marginTop: 2 }}>{ico}</span>
                <div><b style={{ fontSize: 13 }}>{t}</b><p style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{d}</p></div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Trust badges ── */}
        <div className="card" style={{ textAlign: "center", padding: "20px 16px" }}>
          <b style={{ fontFamily: "var(--display)", fontSize: 15 }}>Sahayak Partner benefits</b>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginTop: 14 }}>
            {[["🚫", "Zero\njoining fee"], ["📅", "Your own\nschedule"], ["💰", "Keep 85%+\nearnings"]].map(([ico, l]) => (
              <div key={l} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 26 }}>{ico}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-2)", whiteSpace: "pre-line", lineHeight: 1.3 }}>{l}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Safety ── */}
        <div className="card row" style={{ background: "linear-gradient(135deg,#fff1f0,#ffddd9)", borderColor: "#ffbab3", gap: 14 }}>
          <span style={{ fontSize: 34 }}>🆘</span>
          <div className="grow">
            <b style={{ fontSize: 14, color: "#a1281a" }}>Your safety matters</b>
            <p style={{ fontSize: 12, color: "#b5382a", marginTop: 3 }}>If you ever feel unsafe during a job, use the SOS button. We'll log it immediately and follow up.</p>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ textAlign: "center", padding: "10px 0 20px" }}>
          <p className="tiny">Made with ❤️ in India</p>
          <p className="tiny" style={{ marginTop: 4 }}>© 2026 Sahayak Partner · Terms · Privacy</p>
        </div>
      </div>
    );
  };

  return (
    <div className="stage">
      <div className="phone">
        <ToastHost toasts={toasts} />
        <div className="appbar">
          <div className="brand">Sahayak<small>PARTNER</small></div>
          <span className="tiny">{profile.available ? "🟢 Online" : "⚪ Paused"}</span>
        </div>
        <div className="phone-scroll">{body()}</div>
        {!needsSetup && (
          <div className="tabbar">
            {[["jobs", "🧰", "Jobs"], ["earnings", "💰", "Earnings"], ["profile", "👤", "Profile"]].map(([k, ico, l]) => (
              <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
                <span className="ico">{ico}</span>{l}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OpenJobCard({ job, push, refresh }) {
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      const r = await api(`/worker/jobs/${job.id}/accept`, { method: "POST" });
      setAccepted(true);
      push("You're on the shortlist ✋", `ETA shown to customer: ${r.eta_min} min. Waiting for them to choose.`);
    } catch (e) { push("Couldn't accept", e.message); refresh(); }
    setBusy(false);
  };
  return (
    <div className="card">
      <div className="row">
        <div className="grow">
          <b>{job.service.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")}</b>
          <p className="tiny">{job.urgency === "urgent" ? "🚨 Urgent · " : ""}{job.distanceKm != null ? `${job.distanceKm} km · ` : ""}{job.preferred_time} · {job.address.split(",")[0]}{job.pay_mode ? ` · pays ${job.pay_mode.toUpperCase()}` : ""}</p>
        </div>
        <b style={{ color: "var(--green)", fontSize: 18 }}>{rupee(job.price_offered)}</b>
      </div>
      {job.description && <p className="sub" style={{ marginTop: 8, fontSize: 13 }}>{job.description}</p>}
      <button className={`btn ${accepted ? "btn-ghost" : "btn-primary"} btn-small`} style={{ width: "100%", marginTop: 10 }}
        disabled={busy || accepted} onClick={accept}>
        {accepted ? "Waiting for customer…" : "Accept job"}
      </button>
    </div>
  );
}

function ActiveJob({ job, push, refresh, workerPos, socket }) {
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (path, body, ok) => {
    setBusy(true);
    try { await api(path, { method: "POST", body }); push(ok); await refresh(); } catch (e) { push("Oops", e.message); }
    setBusy(false);
  };
  const customerPos = job.lat && job.lng ? { lat: job.lat, lng: job.lng } : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Map showing customer location + worker's live position + navigate button */}
      {customerPos && <JobMap customerPos={customerPos} workerPos={workerPos} />}

      <div className="card" style={{ borderColor: "var(--blue-700)" }}>
        <span className="badge assigned">{job.status === "assigned" ? "Head to customer" : "Job in progress"}</span>
        <div className="row" style={{ marginTop: 12 }}>
          <Avatar name={job.customer_name || "Customer"} />
          <div className="grow">
            <b>{job.customer_name || "Customer"}</b>
            <p className="tiny">{job.address}</p>
          </div>
          <a className="btn btn-ghost btn-small" href={`tel:${job.customer_phone}`}>📞</a>
        </div>
        <p className="sub" style={{ margin: "10px 0" }}>
          {job.description || "No description"} · <b>{rupee(job.price_offered)}</b>
          {job.pay_mode && <span className="tiny"> · pays by {job.pay_mode.toUpperCase()}</span>}
        </p>

        {job.status === "assigned" && (
          <>
            <div className="field">
              <label>Enter customer's start code (ask on arrival)</label>
              <input inputMode="numeric" maxLength={4} placeholder="4-digit code" value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
            </div>
            <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy}
              onClick={() => act(`/worker/jobs/${job.id}/start`, otp ? { otp } : {}, "Job started 🔧")}>
              Start job
            </button>
            <p className="tiny" style={{ marginTop: 6 }}>📡 Your live location is being shared with the customer.</p>
          </>
        )}
        {job.status === "in_progress" && (
          <button className="btn btn-primary" disabled={busy}
            onClick={() => act(`/worker/jobs/${job.id}/complete`, {}, "Marked complete ✅ Customer will pay now.")}>
            Mark job complete
          </button>
        )}
      </div>

      <JobChat jobId={job.id} socket={socket} myId={session.user?.id} otherName={job.customer_name || "customer"} />
      <SosButton jobId={job.id} push={push} />
    </div>
  );
}

function Earnings({ history }) {
  const [data, setData] = useState(null);
  useEffect(() => { api("/worker/earnings").then((r) => setData(r)); }, [history.length]);
  if (!data) return <div className="empty" style={{ paddingTop: 80 }}>Loading…</div>;
  const s = data.summary;
  const maxWeekBar = Math.max(1, ...last7(data.payments).map((d) => d.total));
  return (
    <div className="screen">
      <div className="h1">Earnings</div>
      <div className="stat-grid">
        <div className="stat"><div className="v">{rupee(s.today)}</div><div className="k">Today</div></div>
        <div className="stat"><div className="v">{rupee(s.week)}</div><div className="k">This week</div></div>
        <div className="stat"><div className="v">{rupee(s.all_time)}</div><div className="k">All time (net)</div></div>
        <div className="stat"><div className="v">{s.total_jobs}</div><div className="k">Paid jobs</div></div>
      </div>

      <div className="card">
        <b style={{ fontSize: 14 }}>Last 7 days</b>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 90, marginTop: 12 }}>
          {last7(data.payments).map((d, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: Math.max(4, (d.total / maxWeekBar) * 70), background: d.total ? "var(--blue-600)" : "var(--line)", borderRadius: 6, transition: "height 0.3s" }} />
              <span className="tiny">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="row"><p className="sub grow">Commission paid to platform</p><b>{rupee(s.commission_paid)}</b></div>
        <div className="row" style={{ marginTop: 8 }}><p className="sub grow">Cash / digital jobs</p><b>{s.cash_jobs} / {s.digital_jobs}</b></div>
      </div>

      <div className="h2">Recent payouts</div>
      <div className="list">
        {data.payments.length === 0 && <div className="empty"><div className="big">💸</div>Complete jobs to start earning</div>}
        {data.payments.map((p) => (
          <div key={p.id} className="card row">
            <div className="grow">
              <b>{rupee(p.net_worker_amount)} <span className="tiny">net</span></b>
              <p className="tiny">{new Date(p.created_at + "Z").toLocaleString()} · {p.mode.toUpperCase()} · {p.commission_pct}% fee {rupee(p.commission_amount)}</p>
            </div>
            <span className="badge completed">settled</span>
          </div>
        ))}
      </div>

      <div className="h2">Job history & your ratings</div>
      <div className="list">
        {history.length === 0 && <div className="empty"><div className="big">🗂️</div>Completed jobs appear here</div>}
        {history.map((j) => (
          <div key={j.id} className="card row">
            <div className="grow">
              <b>{j.service.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")}</b>
              <p className="tiny">{j.customer_name} · {j.completed_at ? new Date(j.completed_at + "Z").toLocaleDateString() : ""}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <b>{rupee(j.net_worker_amount ?? j.price_offered)}</b>
              <p className="tiny" style={{ color: "var(--amber)" }}>{j.stars ? "★".repeat(j.stars) : "not rated yet"}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function last7(payments) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const total = payments
      .filter((p) => new Date(p.created_at + "Z").toDateString() === d.toDateString())
      .reduce((a, p) => a + p.net_worker_amount, 0);
    days.push({ label: d.toLocaleDateString("en", { weekday: "narrow" }), total });
  }
  return days;
}

/* ── First-time worker onboarding — step-by-step wizard with photo trade picker ── */
function WorkerOnboarding({ user, profile, services, push, onDone }) {
  const [step, setStep] = useState(0); // 0 name, 1 trades, 2 aadhaar, 3 area
  const [name, setName] = useState(user.name || "");
  const [trades, setTrades] = useState(JSON.parse(profile.skills || "[]"));
  const [aadhaar, setAadhaar] = useState("");
  const [area, setArea] = useState(profile.area || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const digits = (v, n) => v.replace(/\D/g, "").slice(0, n);
  const toggleTrade = (slug) => {
    if (trades.includes(slug)) setTrades(trades.filter((t) => t !== slug));
    else if (trades.length < 3) setTrades([...trades, slug]);
  };

  const nameOk = name.trim().length >= 2;
  const tradesOk = trades.length >= 1 && trades.length <= 3;
  const aadhaarOk = /^\d{12}$/.test(aadhaar);
  const areaOk = area.trim().length >= 3;

  const finish = async () => {
    setBusy(true); setErr("");
    try {
      await api("/auth/me", { method: "PATCH", body: { name: name.trim() } });
      await api("/worker/profile", { method: "PATCH", body: {
        skills: trades, aadhaar, area: area.trim(),
        contact_phone: profile.contact_phone || user.phone,
      }});
      session.user = { ...user, name: name.trim() };
      push("You're all set 🎉", "Swipe to go online and get your first job");
      onDone();
    } catch (e) {
      setErr(e.message || "Couldn't save. Please try again.");
      setBusy(false);
    }
  };

  const total = 4;
  const GRAND = 6, OFFSET = 2; // login was steps 1-2 of 6
  const canNext = [nameOk, tradesOk, aadhaarOk, areaOk][step];

  return (
    <WizardFrame
      step={OFFSET + step} total={GRAND}
      canBack={step > 0}
      onBack={() => setStep(Math.max(0, step - 1))}
      footer={
        <button className="btn btn-primary" disabled={!canNext || busy}
          onClick={() => { if (step < total - 1) setStep(step + 1); else finish(); }}>
          {busy ? <span className="spin" /> : <>{step === total - 1 ? "Finish setup" : "Continue"} <span className="arr">→</span></>}
        </button>
      }
    >
      {step === 0 && (
        <div className="page">
          <div className="kicker">About you</div>
          <div className="h1">What's your <em>name</em>?</div>
          <p className="sub">Customers see this when you accept a job. Your real name works best.</p>
          <div className="field">
            <label>Your full name</label>
            <input placeholder="e.g. Ramesh Kumar" value={name} autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && nameOk && setStep(1)} />
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="page">
          <div className="kicker">Your skills</div>
          <div className="h1">What work do you <em>do</em>?</div>
          <p className="sub">Pick up to 3. You'll only get jobs matching your trades. Add more later from settings.</p>
          <div className="trade-grid">
            {services.map((s) => (
              <button key={s.slug} className={`trade ${trades.includes(s.slug) ? "on" : ""}`}
                onClick={() => toggleTrade(s.slug)}>
                <div className="tick">✓</div>
                <img src={`/services/${s.slug}.jpg`} alt={s.label} loading="lazy" />
                <div className="nm">{s.label}</div>
              </button>
            ))}
          </div>
          <p className="helper">{trades.length}/3 selected</p>
        </div>
      )}
      {step === 2 && (
        <div className="page">
          <div className="kicker">Verify identity</div>
          <div className="h1">Your <em>Aadhaar number</em></div>
          <p className="sub">Required by law. This stays private — customers never see it. We use it only for background checks.</p>
          <div className="field">
            <label>Aadhaar (12 digits)</label>
            <input inputMode="numeric" maxLength={12} placeholder="XXXX XXXX XXXX"
              value={aadhaar} autoFocus onChange={(e) => setAadhaar(digits(e.target.value, 12))} />
          </div>
          <p className="helper">🔒 Encrypted & stored securely. Never shared.</p>
        </div>
      )}
      {step === 3 && (
        <div className="page">
          <div className="kicker">Almost done</div>
          <div className="h1">Where do you <em>work from</em>?</div>
          <p className="sub">Your base area. You'll only get jobs within 8 km — no long-distance surprises.</p>
          <div className="field">
            <label>Your locality</label>
            <input placeholder="e.g. Sola, Ahmedabad" value={area} autoFocus
              onChange={(e) => setArea(e.target.value)} />
          </div>
          {err && <p className="sub" style={{ color: "var(--red)" }}>{err}</p>}
        </div>
      )}
    </WizardFrame>
  );
}

function ProfileSetup({ user, profile, services, push, onSaved, onExit, firstTime }) {
  const [name, setName] = useState(user.name || "");
  const [photo, setPhoto] = useState(user.photo_url || "");
  const [skills, setSkills] = useState(JSON.parse(profile.skills || "[]"));
  const [form, setForm] = useState({
    contact_phone: profile.contact_phone || user.phone || "",
    alt_phone: profile.alt_phone || "",
    emergency_phone: profile.emergency_phone || "",
    aadhaar: "",
    area: profile.area || "",
    home_address: profile.home_address || "",
    work_start: profile.work_start || "08:00",
    work_end: profile.work_end || "20:00",
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const digits = (v, n) => v.replace(/\D/g, "").slice(0, n);
  const savedAadhaar = profile.aadhaar || "";
  const toggleSkill = (slug) =>
    setSkills((s) => (s.includes(slug) ? s.filter((x) => x !== slug) : [...s, slug]));

  // Resize photo to a small square data URL so it stays lightweight
  const onPhotoPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 160;
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      const min = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size);
      setPhoto(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.src = URL.createObjectURL(file);
  };

  const aadhaarOk = !form.aadhaar || form.aadhaar.length === 12;
  const contactOk = form.contact_phone.length === 10;
  const canSave = name.trim() && skills.length > 0 && contactOk && aadhaarOk;

  const save = async () => {
    setBusy(true);
    try {
      await api("/auth/me", { method: "PATCH", body: { name, photo_url: photo } });
      const payload = { ...form, skills };
      // Only send Aadhaar when they typed a new one, so we don't overwrite the stored value
      if (!payload.aadhaar) delete payload.aadhaar;
      await api("/worker/profile", { method: "PATCH", body: payload });
      session.user = { ...user, name, photo_url: photo };
      push("Profile saved ✓");
      onSaved();
    } catch (e) { push("Couldn't save", e.message); }
    setBusy(false);
  };

  return (
    <div className="screen">
      <div className="h1">{firstTime ? "Set up your worker profile" : "Profile"}</div>

      <div className="row" style={{ gap: 14 }}>
        <Avatar name={name || "?"} photo={photo} />
        <label className="btn btn-ghost btn-small" style={{ cursor: "pointer" }}>
          📷 {photo ? "Change photo" : "Add photo"}
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={onPhotoPick} />
        </label>
      </div>

      <div className="field">
        <label>Full name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="As customers will see it" />
      </div>

      <div className="h2">What work do you do?</div>
      <div className="chip-row">
        {services.map((s) => (
          <button key={s.slug} className={`chip chip-photo ${skills.includes(s.slug) ? "on" : ""}`} onClick={() => toggleSkill(s.slug)}>
            <img src={`/services/${s.slug}.jpg`} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            {s.label}
          </button>
        ))}
      </div>
      {skills.length === 0 && <p className="tiny">Pick at least one — you'll only get jobs that match.</p>}

      <div className="h2">Contact details</div>
      <div className="field">
        <label>Contact number</label>
        <input inputMode="numeric" maxLength={10} placeholder="10-digit mobile number"
          value={form.contact_phone} onChange={(e) => set("contact_phone", digits(e.target.value, 10))} />
        <span className="tiny">Shared with a customer only after they choose you for a job.</span>
      </div>
      <div className="field">
        <label>Another phone number <span style={{ fontWeight: 600, color: "var(--ink-3)" }}>(optional)</span></label>
        <input inputMode="numeric" maxLength={10} placeholder="Backup number"
          value={form.alt_phone} onChange={(e) => set("alt_phone", digits(e.target.value, 10))} />
      </div>
      <div className="field">
        <label>Emergency contact number</label>
        <input inputMode="numeric" maxLength={10} placeholder="Family member or close friend"
          value={form.emergency_phone} onChange={(e) => set("emergency_phone", digits(e.target.value, 10))} />
        <span className="tiny">Used only if something happens to you while you're on a job.</span>
      </div>

      <div className="h2">Where you live</div>
      <div className="field">
        <label>Area of residence</label>
        <input placeholder="e.g. Sola, Ahmedabad" value={form.area} onChange={(e) => set("area", e.target.value)} />
      </div>
      <div className="field">
        <label>Home address</label>
        <textarea rows={2} placeholder="House/flat number, street, landmark"
          value={form.home_address} onChange={(e) => set("home_address", e.target.value)} />
      </div>

      <div className="h2">Identity</div>
      <div className="field">
        <label>Aadhaar card number</label>
        {savedAadhaar && !form.aadhaar && (
          <div className="row" style={{ gap: 10, marginBottom: 8 }}>
            <span className="badge completed">Saved</span>
            <span className="tiny grow" style={{ letterSpacing: ".06em" }}>{savedAadhaar}</span>
          </div>
        )}
        <input inputMode="numeric" maxLength={12}
          placeholder={savedAadhaar ? "Enter a new number to replace it" : "12-digit Aadhaar number"}
          value={form.aadhaar} onChange={(e) => set("aadhaar", digits(e.target.value, 12))} />
        <span className="tiny" style={{ color: form.aadhaar && !aadhaarOk ? "var(--red)" : "var(--ink-3)" }}>
          {form.aadhaar && !aadhaarOk
            ? `Aadhaar must be 12 digits — you've entered ${form.aadhaar.length}.`
            : "Stored encrypted. Never shown to customers, and only the last 4 digits are ever displayed back to you."}
        </span>
      </div>

      <div className="h2">Working hours</div>
      <div className="row" style={{ gap: 10 }}>
        <div className="field grow">
          <label>Work from</label>
          <input type="time" value={form.work_start} onChange={(e) => set("work_start", e.target.value)} />
        </div>
        <div className="field grow">
          <label>Work until</label>
          <input type="time" value={form.work_end} onChange={(e) => set("work_end", e.target.value)} />
        </div>
      </div>
      <p className="tiny">Outside these hours you won't be sent any jobs, so your off-time stays quiet.</p>

      <button className="btn btn-primary" disabled={busy || !canSave} onClick={save}>
        {busy ? <span className="spin" /> : firstTime ? "Start receiving jobs" : "Save changes"}
      </button>
      {!canSave && (
        <p className="tiny" style={{ textAlign: "center" }}>
          {!name.trim() ? "Add your name to continue"
            : skills.length === 0 ? "Pick at least one type of work"
            : !contactOk ? "Enter a valid 10-digit contact number"
            : "Check your Aadhaar number"}
        </p>
      )}

      {!firstTime && (
        <button className="btn btn-danger" onClick={() => { session.clear(); onExit(); }}>Log out</button>
      )}
    </div>
  );
}
