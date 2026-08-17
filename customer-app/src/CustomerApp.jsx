import React, { useEffect, useMemo, useState } from "react";
import { api, getSocket, session, rupee } from "./api.js";
import { ToastHost, useToasts, Login, WelcomeGate, LiveMap, Avatar, Stars, useNotificationSocket, useMyLocation, JobChat, SosButton, ServiceTile, BookingSheet, WizardFrame } from "./ui.jsx";

export default function CustomerApp({ onExit }) {
  const [user, setUser] = useState(session.user?.role === "customer" ? session.user : null);
  // null = welcome gate. "signup" = 4-step join. "login" = 2-step return.
  const [intent, setIntent] = useState(null);

  if (!user) {
    if (!intent) {
      return (
        <WelcomeGate
          onSignup={() => setIntent("signup")}
          onLogin={() => setIntent("login")}
        />
      );
    }
    return (
      <Login
        role="customer"
        mode={intent}
        onDone={setUser}
        grandTotal={intent === "login" ? 2 : 4}
        baseStep={0}
        onQuit={() => setIntent(null)}
      />
    );
  }
  if (!user.name) {
    return (
      <div className="stage">
        <CustomerSetup user={user} onDone={(updated) => { session.user = updated; setUser(updated); }} />
      </div>
    );
  }
  return <CustomerHome user={user} setUser={setUser} onExit={onExit} />;
}

/* ── First-time customer setup — 2-step wizard (name → address) ── */
function CustomerSetup({ user, onDone }) {
  const [step, setStep] = useState(0); // 0 = name, 1 = address
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { loc: gpsLoc, error: gpsErr, request: requestGps } = useMyLocation();

  useEffect(() => { requestGps(); }, []);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true); setErr("");
    try {
      await api("/auth/me", { method: "PATCH", body: { name: name.trim() } });
      const updated = { ...user, name: name.trim(), defaultAddress: address, gps: gpsLoc };
      if (address) localStorage.setItem("sahayak_cust_address", address);
      if (gpsLoc) localStorage.setItem("sahayak_cust_gps", JSON.stringify(gpsLoc));
      onDone(updated);
    } catch (e) {
      setErr(e.message || "Couldn't save. Please try again.");
      setBusy(false);
    }
  };

  const nameOk = name.trim().length >= 2;
  const addressOk = address.trim().length >= 4;

  return (
    <WizardFrame
      step={2 + step} total={4}
      canBack={step > 0}
      onBack={() => setStep(Math.max(0, step - 1))}
      footer={
        step === 0
          ? <button className="btn btn-primary" disabled={!nameOk} onClick={() => setStep(1)}>Continue <span className="arr">→</span></button>
          : <button className="btn btn-primary" disabled={!addressOk || busy} onClick={save}>
              {busy ? <span className="spin" /> : <>Start booking <span className="arr">→</span></>}
            </button>
      }
    >
      {step === 0 && (
        <div className="page">
          <div className="kicker">About you</div>
          <div className="h1">What should we <em>call you</em>?</div>
          <p className="sub">Just your first name is fine. Workers see this when they arrive.</p>
          <div className="field">
            <label>Your name</label>
            <input placeholder="e.g. Saumya" value={name} autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && nameOk && setStep(1)} />
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="page">
          <div className="kicker">Almost done</div>
          <div className="h1">Where should partners <em>come</em>?</div>
          <p className="sub">
            {gpsLoc ? <>📍 Detected: <b>Near you</b>. Add the exact house/flat below.</>
              : gpsErr ? <>❌ Please allow location access</>
              : <>📡 Detecting your location…</>}
          </p>
          <div className="field">
            <label>House / flat, street</label>
            <textarea placeholder="e.g. B-402, Silver Oak Residency, near Science City road"
              value={address} autoFocus onChange={(e) => setAddress(e.target.value)} />
          </div>
          {!gpsLoc && (
            <button className="btn btn-ghost btn-small" onClick={requestGps} style={{ alignSelf: "flex-start" }}>
              Allow location
            </button>
          )}
          <p className="helper">You can change this per booking later.</p>
          {err && <p className="sub" style={{ color: "var(--red)" }}>{err}</p>}
        </div>
      )}
    </WizardFrame>
  );
}

function CustomerHome({ user, setUser, onExit }) {
  const { toasts, push } = useToasts();
  const [tab, setTab] = useState("home");
  const [services, setServices] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [view, setView] = useState(null); // {type:'post', service} | {type:'job', id}
  const [bookingSheet, setBookingSheet] = useState(null); // {service}
  const [search, setSearch] = useState("");
  const { loc: gps, request: requestGps } = useMyLocation();
  const socket = useMemo(() => getSocket(), []);
  useNotificationSocket(socket, push);
  useEffect(() => { requestGps(); }, []);

  const refresh = async () => {
    const r = await api("/customer/jobs");
    setJobs(r.jobs);
  };
  useEffect(() => {
    api("/auth/services").then((r) => setServices(r.services));
    refresh();
    const events = ["shortlist:updated", "job:started", "job:completed", "worker:location"];
    const h = () => refresh();
    events.forEach((e) => socket.on(e, h));
    return () => events.forEach((e) => socket.off(e, h));
  }, []);

  const currentJob = jobs.find((j) => ["open", "assigned", "in_progress"].includes(j.status));
  const unratedDone = jobs.find((j) => j.status === "completed" && (!j.paid_amount || !j.my_stars));

  const body = () => {
    if (view?.type === "post")
      return <PostJob services={services} service={view.service} preferredWorker={view.preferredWorker} push={push}
        onPosted={() => { setView(null); refresh(); }} onBack={() => setView(null)} />;
    if (view?.type === "job") {
      const job = jobs.find((j) => j.id === view.id);
      if (job) return <JobDetail job={job} socket={socket} push={push} refresh={refresh} onBack={() => setView(null)}
        onRebook={(j) => setView({ type: "post", service: j.service, preferredWorker: { id: j.worker_id, name: j.worker_name } })} />;
    }
    if (tab === "bookings") return <History jobs={jobs} open={(id) => setView({ type: "job", id })} />;
    if (tab === "profile") return <Profile user={user} jobs={jobs} setTab={setTab} push={push} onExit={onExit} />;
    return (
      <div className="screen home">
        <div className="home-hero">
          <div className="hh-top">
            <span className="hh-loc">📍 Your area</span>
            <Avatar name={user.name || "You"} photo={user.photo_url} />
          </div>
          <div className="hh-title">Hi{user.name ? `, ${user.name.split(" ")[0]}` : ""} 👋<br />What do you need done?</div>
          <div className="searchwrap">
            <input placeholder="🔍 Search for 'plumber'" value={search}
              onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {(currentJob || unratedDone) && (
          <button className="card row after-hero" style={{ borderColor: "var(--blue-700)", textAlign: "left" }}
            onClick={() => setView({ type: "job", id: (currentJob || unratedDone).id })}>
            <span style={{ fontSize: 26 }}>{currentJob ? "🔔" : "✅"}</span>
            <div className="grow">
              <b>{currentJob ? "Job in progress" : "Job finished — pay & rate"}</b>
              <p className="sub">{labelFor(services, (currentJob || unratedDone).service)} · {rupee((currentJob || unratedDone).price_offered)}</p>
            </div>
            <span style={{ color: "var(--blue-700)", fontWeight: 700 }}>→</span>
          </button>
        )}

        <div className={currentJob || unratedDone ? "" : "after-hero"}>
          <div className="h2" style={{ marginBottom: 12 }}>All services</div>
          {services.filter((s) => s.label.toLowerCase().includes(search.toLowerCase())).length === 0 && (
            <div className="empty"><div className="big">🔍</div>No service matches "{search}"</div>
          )}
          <div className="svc-grid">
            {services
              .filter((s) => s.label.toLowerCase().includes(search.toLowerCase()))
              .map((s) => (
                <ServiceTile key={s.slug} service={s} onClick={() => setBookingSheet({ service: s })} />
              ))}
          </div>
        </div>

        {!search && (
          <>
            {/* ── Popular right now (photo cards) ── */}
            <div>
              <div className="h2" style={{ marginBottom: 12 }}>Popular right now</div>
              <div className="hscroll">
                {[
                  { slug: "cleaner", label: "Cleaning", sub: "Deep clean, dusting", jobs: "3.1K+ booked" },
                  { slug: "electrician", label: "Electrician", sub: "Fan, wiring, switch", jobs: "2.4K+ booked" },
                  { slug: "plumber", label: "Plumber", sub: "Tap, pipe, drain", jobs: "1.8K+ booked" },
                  { slug: "ac-repair", label: "AC Repair", sub: "Service, gas refill", jobs: "1.2K+ booked" },
                ].map((p) => {
                  const svc = services.find((s) => s.slug === p.slug) || { slug: p.slug, label: p.label };
                  return (
                    <button key={p.slug} className="pop-card" onClick={() => setBookingSheet({ service: svc })}>
                      <span className="pop-photo"><img src={`/services/${p.slug}.jpg`} alt="" loading="lazy" /></span>
                      <span className="pop-body">
                        <b>{p.label}</b>
                        <span className="pop-sub">{p.sub}</span>
                        <span className="pop-jobs">🔥 {p.jobs}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Quick access panel ── */}
            <div>
              <div className="h2" style={{ marginBottom: 10 }}>Quick access</div>
              <div className="quick-grid">
                {[
                  ["🗂️", "Bookings", () => setTab("bookings")],
                  ["💳", "Payments", () => setTab("profile")],
                  ["⚙️", "Settings", () => setTab("profile")],
                  ["👤", "Profile", () => setTab("profile")],
                ].map(([ico, label, go]) => (
                  <button key={label} className="quick" onClick={go}>
                    <span className="quick-ico">{ico}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Why customers trust Sahayak ── */}
            <div className="trust-band">
              <b className="trust-band-title">Why customers trust Sahayak</b>
              <div className="trust-list">
                {[
                  ["💰", "Clear pricing up front", "See the starting price before you book. No call-out charges, no surprises at the door."],
                  ["📍", "Watch them arrive", "Live GPS on a real map, plus a 4-digit start code so only your worker can begin."],
                  ["💳", "Pay only when it's done", "Nothing leaves your pocket until the work is finished and you're happy."],
                  ["🆘", "Help is one tap away", "An SOS button runs through every active job, and support answers 7 days a week."],
                ].map(([ico, title, desc]) => (
                  <div key={title} className="trust-item">
                    <span className="trust-badge">{ico}</span>
                    <div className="grow">
                      <b>{title}</b>
                      <p className="tiny" style={{ marginTop: 3 }}>{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Offers ── */}
            <div>
              <div className="h2" style={{ marginBottom: 10 }}>Offers for you</div>
              <div className="hscroll">
                {[
                  { bg: "linear-gradient(135deg,#1740c9,#0e2b8f)", title: "First booking", sub: "Get 20% off on your first service", code: "FIRST20" },
                  { bg: "linear-gradient(135deg,#12b76a,#0a7a4d)", title: "AC season", sub: "AC service starts at just ₹399", code: "COOL399" },
                  { bg: "linear-gradient(135deg,#7e57c2,#4527a0)", title: "Monsoon ready", sub: "₹100 off any plumbing work", code: "RAIN100" },
                ].map((o) => (
                  <div key={o.code} style={{ flex: "none", width: 240, background: o.bg, borderRadius: "var(--r-lg)", padding: "18px 16px", color: "#fff" }}>
                    <b style={{ fontSize: 16 }}>{o.title}</b>
                    <p style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>{o.sub}</p>
                    <div style={{ marginTop: 10, background: "rgba(255,255,255,.2)", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 800, letterSpacing: ".08em", display: "inline-block" }}>
                      {o.code}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Every Day with Sahayak ── */}
            <div>
              <div className="h2" style={{ marginBottom: 4 }}>Every day with Sahayak</div>
              <p className="sub" style={{ marginBottom: 12 }}>The small jobs that keep a home running — sorted, whenever they come up.</p>
              <div className="day-grid">
                {[
                  ["🌅", "Morning", "Geyser playing up before the shower? An electrician can be at your door before breakfast.", "electrician"],
                  ["🏠", "Midday", "Deep clean while the house is empty — kitchen, bathrooms, floors, the lot.", "cleaner"],
                  ["🔧", "Afternoon", "Dripping tap or a slow drain that's been bothering you for weeks. Half an hour, done.", "plumber"],
                  ["❄️", "Before summer", "Get the AC serviced before the first heatwave, not during it.", "ac-repair"],
                  ["🎨", "Weekends", "That room you've been meaning to repaint since Diwali.", "painter"],
                  ["🌿", "Month end", "Garden trimmed, plants tended, balcony looking cared for again.", "gardening"],
                ].map(([ico, when, desc, slug]) => (
                  <button key={when} className="day-card" onClick={() => { const svc = services.find((s) => s.slug === slug) || { slug, label: when }; setBookingSheet({ service: svc }); }}>
                    <span className="day-ico">{ico}</span>
                    <b className="day-when">{when}</b>
                    <p className="tiny">{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Stats ── */}
            <div className="card" style={{ background: "var(--blue-900)", color: "#fff", borderColor: "transparent", textAlign: "center" }}>
              <b style={{ fontFamily: "var(--display)", fontSize: 17 }}>India's growing local services platform</b>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 14 }}>
                {[["50K+", "Jobs done"], ["4.8★", "Avg rating"], ["10K+", "Workers"]].map(([v, l]) => (
                  <div key={l}>
                    <div style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700 }}>{v}</div>
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Closing statement ── */}
            <div className="statement">
              India's most trusted<br />local services app
            </div>

            <div className="endmark">
              <span>Every day with</span>
              <span>Sahayak</span>
            </div>

            <div style={{ textAlign: "center", padding: "0 0 10px" }}>
              <p className="tiny">Made with ❤️ in India · © 2026 Sahayak</p>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="stage">
      <div className="phone">
        <ToastHost toasts={toasts} />
        {!(tab === "home" && !view) && (
          <div className="appbar">
            <div className="brand">Sahayak<small>CUSTOMER</small></div>
            <span className="tiny">📍 Your area</span>
          </div>
        )}
        <div className="phone-scroll">{body()}</div>
        {!view && (
          <div className="tabbar">
            {[["home", "🏠", "Home"], ["bookings", "🗂️", "Bookings"], ["profile", "👤", "Profile"]].map(([k, ico, l]) => (
              <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
                <span className="ico">{ico}</span>{l}
              </button>
            ))}
          </div>
        )}
        {bookingSheet && (
          <BookingSheet
            service={bookingSheet.service}
            user={user}
            gps={gps}
            onClose={() => setBookingSheet(null)}
            onPosted={() => { setBookingSheet(null); refresh(); push("Job posted", "Nearby workers have been notified"); }}
            push={push}
          />
        )}
      </div>
    </div>
  );
}

/* ── Post a job ── */

// Build bookable windows from the service's typical duration.
// Jobs under an hour get 30-minute slots; longer jobs get windows that
// actually fit the work, so nobody books a 4-hour paint job into a 30-min gap.
function buildSlots(durationMin = 60) {
  const DAY_START = 8, DAY_END = 20;
  const step = durationMin <= 60 ? 30 : 60;
  const span = Math.max(durationMin, step);
  const fmt = (mins) => {
    const h24 = Math.floor(mins / 60), m = mins % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
  };
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const slots = [];
  for (let t = DAY_START * 60; t + span <= DAY_END * 60; t += step) {
    slots.push({ start: t, label: `${fmt(t)} – ${fmt(t + span)}`, today: t > nowMins + 45 });
  }
  return { slots, span };
}

function PostJob({ services, service, preferredWorker, onPosted, onBack, push }) {
  const { loc: gpsLoc, error: gpsError, request: requestGps } = useMyLocation();
  const savedAddress = localStorage.getItem("sahayak_cust_address") || "";
  const savedGps = (() => { try { return JSON.parse(localStorage.getItem("sahayak_cust_gps")); } catch { return null; } })();
  const [form, setForm] = useState({
    service, urgency: "urgent",
    pay_mode: localStorage.getItem("sahayak_cust_paymode") || "upi",
    address: savedAddress,
  });
  const [day, setDay] = useState("today");
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => { requestGps(); }, []);

  const usedLoc = gpsLoc || savedGps;
  const svc = services.find((s) => s.slug === form.service);
  const duration = svc?.duration_min || 60;
  const { slots, span } = useMemo(() => buildSlots(duration), [duration]);
  const shown = day === "today" ? slots.filter((s) => s.today) : slots;

  // Switching service changes the window length, so any old pick is stale
  useEffect(() => { setSlot(""); }, [form.service]);
  // If nothing is left today, move them to tomorrow rather than showing an empty list
  useEffect(() => { if (day === "today" && slots.length && !slots.some((s) => s.today)) setDay("tomorrow"); }, [slots, day]);

  const durationLabel = span >= 120 ? `${Math.round(span / 60)} hours` : span === 60 ? "1 hour" : `${span} minutes`;
  const scheduled = form.urgency === "normal";
  const ready = form.address.trim() && usedLoc && (!scheduled || slot);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api("/customer/jobs", {
        method: "POST",
        body: {
          service: form.service,
          urgency: form.urgency,
          pay_mode: form.pay_mode,
          address: form.address,
          slot: scheduled ? `${day === "today" ? "Today" : "Tomorrow"}, ${slot}` : "As soon as possible",
          lat: usedLoc.lat, lng: usedLoc.lng,
          ...(preferredWorker ? { preferred_worker_id: preferredWorker.id } : {}),
        },
      });
      push(r.notified > 0 ? `Sent to ${r.notified} nearby worker${r.notified > 1 ? "s" : ""}` : "Job posted",
        r.notified > 0 ? "You'll see them appear as they accept." : "Waiting for workers to come online.");
      onPosted();
    } catch (e) { push("Couldn't post job", e.message); }
    setBusy(false);
  };

  return (
    <div className="screen">
      <button onClick={onBack} style={{ alignSelf: "flex-start", fontWeight: 600, color: "var(--ink-2)", fontSize: 14 }}>← Back</button>
      <div className="h1">Request a service</div>

      {preferredWorker && (
        <div className="card row" style={{ background: "var(--blue-50)", borderColor: "transparent" }}>
          <Avatar name={preferredWorker.name} />
          <p className="sub grow"><b>Rebooking {preferredWorker.name}</b><br />They'll be notified first if they're available.</p>
        </div>
      )}

      <div className="field">
        <label>Service</label>
        <select value={form.service} onChange={(e) => set("service", e.target.value)}>
          {services.map((s) => <option key={s.slug} value={s.slug}>{s.icon} {s.label}</option>)}
        </select>
      </div>

      {svc && (
        <div className="card row" style={{ background: "var(--wash)", borderColor: "transparent", gap: 12 }}>
          <span style={{ fontSize: 26 }}>{svc.icon}</span>
          <div className="grow">
            <b style={{ fontSize: 14 }}>{svc.label}</b>
            <p className="tiny">Usually takes about {durationLabel} · from {rupee(svc.price_min)}</p>
          </div>
        </div>
      )}

      <div className="field">
        <label>When do you need it?</label>
        <div className="chip-row">
          {[["urgent", "🚨 As soon as possible"], ["normal", "🕐 Pick a time"]].map(([v, l]) => (
            <button key={v} className={`chip ${form.urgency === v ? "on" : ""}`} onClick={() => set("urgency", v)}>{l}</button>
          ))}
        </div>
      </div>

      {scheduled && (
        <div className="field">
          <label>Available {durationLabel} slots</label>
          <div className="chip-row" style={{ marginBottom: 10 }}>
            {[["today", "Today"], ["tomorrow", "Tomorrow"]].map(([v, l]) => (
              <button key={v} className={`chip ${day === v ? "on" : ""}`} onClick={() => { setDay(v); setSlot(""); }}>{l}</button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="tiny">No slots left today — try tomorrow.</p>
          ) : (
            <div className="slot-grid">
              {shown.map((s) => (
                <button key={s.label} className={`slot ${slot === s.label ? "on" : ""}`} onClick={() => setSlot(s.label)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="field">
        <label>How will you pay?</label>
        <div className="chip-row">
          {[["upi", "UPI"], ["cash", "Cash"], ["card", "Card"], ["wallet", "Wallet"]].map(([v, l]) => (
            <button key={v} className={`chip ${form.pay_mode === v ? "on" : ""}`} onClick={() => set("pay_mode", v)}>{l}</button>
          ))}
        </div>
        <span className="tiny">Workers see this before accepting. You'll confirm the amount after the job.</span>
      </div>

      <div className="field">
        <label>Your address</label>
        <input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="House/flat number, street, landmark" />
        <span className="tiny" style={{ color: gpsLoc ? "var(--green)" : gpsError ? "var(--red)" : "var(--ink-3)" }}>
          {gpsLoc ? "📍 Using your live GPS location" : gpsError ? "❌ Location is required — please allow GPS access in your browser to post a job." : "📡 Getting your location…"}
        </span>
        {!gpsLoc && <button className="btn btn-ghost btn-small" style={{ marginTop: 4 }} onClick={requestGps}>Allow location</button>}
      </div>

      <button className="btn btn-primary" disabled={busy || !ready} onClick={submit}>
        {!usedLoc ? "📍 Location required" : scheduled && !slot ? "Pick a time slot" : busy ? <span className="spin" /> : "Post job to nearby workers"}
      </button>
    </div>
  );
}

/* ── Job detail: shortlist → tracking → pay → rate ── */
function JobDetail({ job, socket, push, refresh, onBack, onRebook }) {
  const [shortlist, setShortlist] = useState([]);
  const [workerPos, setWorkerPos] = useState(null);
  const [payMode, setPayMode] = useState(job.pay_mode || "upi");
  const [stars, setStars] = useState(0);
  const [review, setReview] = useState("");
  const [busy, setBusy] = useState(false);
  const myId = session.user?.id;

  const loadShortlist = () =>
    api(`/customer/jobs/${job.id}/shortlist`).then((r) => setShortlist(r.shortlist)).catch(() => {});

  useEffect(() => {
    if (job.status === "open") {
      loadShortlist();
      const h = () => loadShortlist();
      socket.on("shortlist:updated", h);
      return () => socket.off("shortlist:updated", h);
    }
    if (["assigned", "in_progress"].includes(job.status)) {
      const h = (p) => p.jobId === job.id && setWorkerPos({ lat: p.lat, lng: p.lng });
      socket.on("worker:location", h);
      return () => socket.off("worker:location", h);
    }
  }, [job.status]);

  const act = async (fn, ok) => {
    setBusy(true);
    try { await fn(); ok && push(ok); await refresh(); } catch (e) { push("Oops", e.message); }
    setBusy(false);
  };

  return (
    <div className="screen">
      <button onClick={onBack} style={{ alignSelf: "flex-start", fontWeight: 600, color: "var(--ink-2)", fontSize: 14 }}>← Back</button>
      <div className="row">
        <div className="h1 grow" style={{ fontSize: 22 }}>{titleCase(job.service)}</div>
        <span className={`badge ${job.status}`}>{job.status.replace("_", " ")}</span>
      </div>
      <p className="sub">{job.preferred_time} · from {rupee(job.price_offered)}</p>

      {job.status === "open" && (
        <>
          <div className="card row" style={{ background: "var(--blue-50)", borderColor: "transparent" }}>
            <span className="spin" style={{ borderColor: "rgba(23,64,201,0.25)", borderTopColor: "var(--blue-700)" }} />
            <p className="sub grow"><b style={{ color: "var(--blue-900)" }}>Broadcasting to nearby workers…</b><br />Workers who accept appear below. Pick the one you like.</p>
          </div>
          <div className="list">
            {shortlist.length === 0 && <div className="empty"><div className="big">📡</div>No responses yet — give it a moment</div>}
            {shortlist.map((w) => (
              <div key={w.worker_id} className="card">
                <div className="row">
                  <Avatar name={w.name || "Worker"} />
                  <div className="grow">
                    <b>{w.name || "Worker"}</b>
                    <p className="tiny">
                      {w.rating ? `★ ${w.rating} (${w.rating_count})` : "New"} · {w.jobs_completed} jobs · {w.experience_years} yrs
                      {w.distanceKm != null && ` · ${w.distanceKm} km`}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <b style={{ color: "var(--blue-700)" }}>{w.eta_min} min</b>
                    <p className="tiny">ETA</p>
                  </div>
                </div>
                {w.bio && <p className="sub" style={{ marginTop: 8, fontSize: 13 }}>{w.bio}</p>}
                <button className="btn btn-primary btn-small" style={{ width: "100%", marginTop: 10 }} disabled={busy}
                  onClick={() => act(() => api(`/customer/jobs/${job.id}/select`, { method: "POST", body: { worker_id: w.worker_id } }), "Worker confirmed! 🎉")}>
                  Choose {String(w.name || "worker").split(" ")[0]}
                </button>
              </div>
            ))}
          </div>
          <button className="btn btn-danger btn-small" style={{ alignSelf: "center" }} disabled={busy}
            onClick={() => act(() => api(`/customer/jobs/${job.id}/cancel`, { method: "POST" }), "Job cancelled")}>
            Cancel request
          </button>
        </>
      )}

      {["assigned", "in_progress"].includes(job.status) && (
        <>
          <LiveMap workerPos={workerPos} customerPos={{ lat: job.lat, lng: job.lng }} />
          <div className="card row">
            <Avatar name={job.worker_name || "Worker"} photo={job.worker_photo} />
            <div className="grow">
              <b>{job.worker_name || "Your worker"}</b>
              <p className="tiny">{job.status === "assigned" ? "On the way to you 🛵" : "Working on your job 🔧"}</p>
            </div>
            {job.worker_phone && <a className="btn btn-ghost btn-small" href={`tel:${job.worker_phone}`}>📞 Call</a>}
          </div>
          <JobChat jobId={job.id} socket={socket} myId={myId} otherName={job.worker_name || "worker"} />
          <div className="card" style={{ background: "var(--amber-bg)", borderColor: "transparent" }}>
            <span className="tiny" style={{ color: "var(--amber)", fontWeight: 700 }}>START CODE</span>
            <p className="sub">Share OTP <b style={{ fontSize: 18, letterSpacing: 4 }}>{job.otp_code}</b> with the worker when they arrive.</p>
          </div>
          <SosButton jobId={job.id} push={push} />
          {job.status === "assigned" && (
            <button className="btn btn-ghost btn-small" style={{ alignSelf: "center" }} disabled={busy}
              onClick={() => act(() => api(`/customer/jobs/${job.id}/cancel`, { method: "POST" }), "Job cancelled")}>
              Cancel (a small fee may apply after selecting a worker)
            </button>
          )}
        </>
      )}

      {job.status === "expired" && (
        <div className="card" style={{ background: "var(--amber-bg)", borderColor: "transparent" }}>
          <b>⏰ No worker took this job in time</b>
          <p className="sub" style={{ marginTop: 6 }}>Try again with a higher price offer, or at a different time of day.</p>
          <button className="btn btn-primary btn-small" style={{ width: "100%", marginTop: 10 }}
            onClick={() => onRebook({ ...job, worker_id: null, worker_name: null })}>
            Post again
          </button>
        </div>
      )}

      {job.status === "completed" && (
        <>
          {!job.paid_amount ? (
            <div className="card">
              <div className="h2">Pay {rupee(job.price_offered)}</div>
              <div className="chip-row" style={{ margin: "12px 0" }}>
                {[["upi", "UPI"], ["cash", "Cash"], ["card", "Card"], ["wallet", "Wallet"]].map(([v, l]) => (
                  <button key={v} className={`chip ${payMode === v ? "on" : ""}`} onClick={() => setPayMode(v)}>{l}</button>
                ))}
              </div>
              <button className="btn btn-primary" disabled={busy}
                onClick={() => act(() => api(`/customer/jobs/${job.id}/pay`, { method: "POST", body: { mode: payMode, amount: job.price_offered } }), "Payment recorded ✅")}>
                {payMode === "cash" ? "I paid the worker in cash" : `Pay ${rupee(job.price_offered)}`}
              </button>
              <p className="tiny" style={{ marginTop: 8 }}>Razorpay checkout plugs in here for real UPI/card payments.</p>
            </div>
          ) : (
            <div className="card row" style={{ background: "var(--green-bg)", borderColor: "transparent" }}>
              <span style={{ fontSize: 24 }}>✅</span>
              <p className="sub grow"><b style={{ color: "var(--green)" }}>Paid {rupee(job.paid_amount)}</b> via {job.paid_mode?.toUpperCase()}</p>
            </div>
          )}

          {job.paid_amount && !job.my_stars && (
            <div className="card">
              <div className="h2">Rate {job.worker_name || "your worker"}</div>
              <div style={{ margin: "12px 0" }}><Stars value={stars} onChange={setStars} /></div>
              <div className="field">
                <textarea rows={2} placeholder="Write a short review (optional)" value={review} onChange={(e) => setReview(e.target.value)} />
              </div>
              <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={!stars || busy}
                onClick={() => act(() => api(`/customer/jobs/${job.id}/rate`, { method: "POST", body: { stars, review } }), "Thanks for rating! ⭐")}>
                Submit rating
              </button>
            </div>
          )}
          {job.my_stars && <p className="sub" style={{ textAlign: "center" }}>You rated this job {"★".repeat(job.my_stars)}</p>}
          {job.worker_id && (
            <button className="btn btn-ghost" onClick={() => onRebook(job)}>
              🔁 Book {job.worker_name ? job.worker_name.split(" ")[0] : "this worker"} again
            </button>
          )}
          <SosButton jobId={job.id} push={push} />
        </>
      )}
    </div>
  );
}

function History({ jobs, open }) {
  return (
    <div className="screen">
      <div className="h1">Bookings</div>
      {jobs.length === 0 && <div className="empty"><div className="big">🗂️</div>No bookings yet</div>}
      <div className="list">
        {jobs.map((j) => (
          <button key={j.id} className="card row" style={{ textAlign: "left" }} onClick={() => open(j.id)}>
            <div className="grow">
              <b>{titleCase(j.service)}</b>
              <p className="tiny">{new Date(j.created_at + "Z").toLocaleString()} {j.worker_name ? `· ${j.worker_name}` : ""}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <b>{rupee(j.paid_amount || j.price_offered)}</b>
              <div><span className={`badge ${j.status}`}>{j.status.replace("_", " ")}</span></div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Profile hub + working sub-screens ── */
function Profile({ user, jobs = [], setTab, push, onExit }) {
  const [screen, setScreen] = useState(null);
  const [name, setName] = useState(user.name || "");
  const [saved, setSaved] = useState(false);

  // Wallet is derived from real completed+paid jobs
  const paidJobs = jobs.filter((j) => j.paid_amount);
  const totalSpent = paidJobs.reduce((s, j) => s + (j.paid_amount || 0), 0);
  const ratedJobs = jobs.filter((j) => j.my_stars);

  if (screen === "addresses") return <Addresses onBack={() => setScreen(null)} push={push} />;
  if (screen === "payments") return <PaymentMethods onBack={() => setScreen(null)} push={push} />;
  if (screen === "howitworks") return <HowItWorks onBack={() => setScreen(null)} />;
  if (screen === "ratings") return <MyRatings jobs={ratedJobs} onBack={() => setScreen(null)} />;
  if (screen === "settings") return <SettingsScreen onBack={() => setScreen(null)} push={push} />;
  if (screen === "help") return <HelpSupport onBack={() => setScreen(null)} push={push} />;
  if (screen === "about") return <AboutSahayak onBack={() => setScreen(null)} />;
  if (screen === "wallet") return <Wallet paidJobs={paidJobs} totalSpent={totalSpent} onBack={() => setScreen(null)} />;

  const MENU = [
    ["📍", "Manage addresses", "Add or edit saved locations", "addresses"],
    ["💳", "Payment methods", "UPI, cards, wallet", "payments"],
    ["💡", "How Sahayak works", "Booking, tracking, paying — explained", "howitworks"],
    ["⭐", "My ratings", `${ratedJobs.length} job${ratedJobs.length === 1 ? "" : "s"} rated`, "ratings"],
    ["⚙️", "Settings", "Notifications, language, theme", "settings"],
    ["❓", "Help & support", "FAQs, contact us, report issue", "help"],
    ["📖", "Our Sahayak story", "Who we are, terms & privacy", "about"],
  ];

  return (
    <div className="screen">
      <div className="h1">Profile</div>

      <div className="card" style={{ textAlign: "center", padding: "24px 16px" }}>
        <div style={{ margin: "0 auto", width: 44 }}><Avatar name={name || user.phone} photo={user.photo_url} /></div>
        <b style={{ display: "block", marginTop: 10, fontSize: 18, fontFamily: "var(--display)" }}>{name || "Add your name"}</b>
        <p className="tiny">+91 {user.phone}</p>
        {user.email && <p className="tiny">{user.email}</p>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <button className="card" style={{ textAlign: "center", padding: "18px 10px" }} onClick={() => setTab("bookings")}>
          <span style={{ fontSize: 28 }}>🗂️</span>
          <b style={{ display: "block", marginTop: 6, fontSize: 13 }}>My bookings</b>
          <p className="tiny">{jobs.length} total</p>
        </button>
        <button className="card" style={{ textAlign: "center", padding: "18px 10px" }} onClick={() => setScreen("wallet")}>
          <span style={{ fontSize: 28 }}>💰</span>
          <b style={{ display: "block", marginTop: 6, fontSize: 13 }}>My wallet</b>
          <p className="tiny">{rupee(totalSpent)} spent</p>
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {MENU.map(([ico, t, s, key], i) => (
          <button key={t} className="row" style={{ width: "100%", textAlign: "left", padding: "15px 16px", borderBottom: i < MENU.length - 1 ? "1px solid var(--line)" : "none", gap: 14 }}
            onClick={() => setScreen(key)}>
            <span style={{ fontSize: 20, flex: "none" }}>{ico}</span>
            <div className="grow">
              <b style={{ fontSize: 14 }}>{t}</b>
              <p className="tiny">{s}</p>
            </div>
            <span style={{ color: "var(--ink-3)", fontSize: 14 }}>›</span>
          </button>
        ))}
      </div>

      <div className="field">
        <label>Change display name</label>
        <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
      </div>
      <button className="btn btn-primary" onClick={async () => {
        await api("/auth/me", { method: "PATCH", body: { name } });
        session.user = { ...user, name };
        setSaved(true);
        push?.("Profile updated ✓");
      }}>{saved ? "Saved ✓" : "Save changes"}</button>

      <button className="btn btn-danger" style={{ marginTop: 10 }} onClick={() => { session.clear(); onExit(); }}>Log out</button>

      <div style={{ textAlign: "center", padding: "16px 0" }}>
        <p className="tiny">App version 1.0.0</p>
      </div>
    </div>
  );
}

function SubHead({ title, onBack, sub }) {
  return (
    <>
      <button onClick={onBack} style={{ alignSelf: "flex-start", fontWeight: 700, color: "var(--ink-2)", fontSize: 14 }}>← Back</button>
      <div>
        <div className="h1">{title}</div>
        {sub && <p className="sub" style={{ marginTop: 6 }}>{sub}</p>}
      </div>
    </>
  );
}

/* ── Saved addresses (persisted locally) ── */
const ADDR_KEY = "sahayak_cust_addresses";
const readAddrs = () => { try { return JSON.parse(localStorage.getItem(ADDR_KEY)) || []; } catch { return []; } };

function Addresses({ onBack, push }) {
  const [list, setList] = useState(readAddrs);
  const [label, setLabel] = useState("Home");
  const [text, setText] = useState("");
  const { loc, request } = useMyLocation();

  const persist = (next) => { setList(next); localStorage.setItem(ADDR_KEY, JSON.stringify(next)); };

  const add = () => {
    if (!text.trim()) return;
    const entry = { id: Date.now(), label, text: text.trim(), lat: loc?.lat ?? null, lng: loc?.lng ?? null };
    persist([...list, entry]);
    setText("");
    push?.("Address saved ✓");
  };

  const useDefault = (a) => {
    localStorage.setItem("sahayak_cust_address", a.text);
    if (a.lat) localStorage.setItem("sahayak_cust_gps", JSON.stringify({ lat: a.lat, lng: a.lng }));
    push?.("Default address set", a.text);
  };

  return (
    <div className="screen">
      <SubHead title="Manage addresses" onBack={onBack} sub="Saved addresses fill in automatically when you post a job." />

      <div className="list">
        {list.length === 0 && <div className="empty"><div className="big">📍</div>No saved addresses yet</div>}
        {list.map((a) => (
          <div key={a.id} className="card row">
            <span style={{ fontSize: 22 }}>{a.label === "Home" ? "🏠" : a.label === "Work" ? "🏢" : "📍"}</span>
            <div className="grow">
              <b style={{ fontSize: 14 }}>{a.label}</b>
              <p className="tiny">{a.text}</p>
            </div>
            <button className="btn btn-ghost btn-small" onClick={() => useDefault(a)}>Use</button>
            <button className="btn btn-danger btn-small" onClick={() => persist(list.filter((x) => x.id !== a.id))}>✕</button>
          </div>
        ))}
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <b style={{ fontSize: 15 }}>Add a new address</b>
        <div className="chip-row">
          {["Home", "Work", "Other"].map((l) => (
            <button key={l} className={`chip ${label === l ? "on" : ""}`} onClick={() => setLabel(l)}>{l}</button>
          ))}
        </div>
        <div className="field">
          <label>Full address</label>
          <textarea rows={2} placeholder="Flat / house no, street, landmark" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <button className="btn btn-ghost btn-small" onClick={request}>
          {loc ? "📍 GPS attached ✓" : "📍 Attach current location"}
        </button>
        <button className="btn btn-primary" disabled={!text.trim()} onClick={add}>Save address</button>
      </div>
    </div>
  );
}

/* ── Payment methods (sets the default pay mode) ── */
const PAY_KEY = "sahayak_cust_paymode";
function PaymentMethods({ onBack, push }) {
  const [mode, setMode] = useState(localStorage.getItem(PAY_KEY) || "upi");
  const choose = (m) => { setMode(m); localStorage.setItem(PAY_KEY, m); push?.("Default payment updated", m.toUpperCase()); };
  const OPTIONS = [
    ["upi", "📱", "UPI", "GPay, PhonePe, Paytm — pay on completion"],
    ["cash", "💵", "Cash", "Hand cash to the worker after the job"],
    ["card", "💳", "Card", "Debit or credit card"],
    ["wallet", "👛", "Wallet", "Sahayak wallet balance"],
  ];
  return (
    <div className="screen">
      <SubHead title="Payment methods" onBack={onBack} sub="Your default is pre-selected every time you post a job." />
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {OPTIONS.map(([k, ico, t, s], i) => (
          <button key={k} className="row" style={{ width: "100%", textAlign: "left", padding: "15px 16px", gap: 14, borderBottom: i < OPTIONS.length - 1 ? "1px solid var(--line)" : "none", background: mode === k ? "var(--wash)" : "transparent" }}
            onClick={() => choose(k)}>
            <span style={{ fontSize: 22, flex: "none" }}>{ico}</span>
            <div className="grow">
              <b style={{ fontSize: 14 }}>{t}</b>
              <p className="tiny">{s}</p>
            </div>
            {mode === k && <span style={{ color: "var(--brand)", fontWeight: 800 }}>✓</span>}
          </button>
        ))}
      </div>
      <p className="tiny">Digital payments are collected by the platform and settled to the worker, minus the platform fee. Cash is paid directly to the worker.</p>
    </div>
  );
}

/* ── How Sahayak works (moved here from the homepage) ── */
function HowItWorks({ onBack }) {
  const STEPS = [
    ["📝", "Post your job", "Pick a service and tell us where. Choose 'as soon as possible' or book a specific time slot that suits you."],
    ["📡", "Workers respond instantly", "Every available worker nearby who does that job is alerted at the same moment. The ones who are free accept."],
    ["👤", "You pick who comes", "Compare each worker's rating, distance and arrival time, then choose the one you want. The rest are told the job is taken."],
    ["📍", "Track them to your door", "Follow them live on a real map. When they arrive you share a 4-digit start code, so only your worker can begin the job."],
    ["💳", "Pay & rate after", "Nothing is charged until the work is finished. Pay by UPI, cash, card or wallet, then rate the worker."],
  ];
  return (
    <div className="screen">
      <SubHead title="How Sahayak works" onBack={onBack} sub="From posting a job to paying for it — the whole flow in five steps." />
      <div className="list">
        {STEPS.map(([ico, title, desc], i) => (
          <div key={title} className="card row" style={{ alignItems: "flex-start", gap: 14 }}>
            <div style={{ position: "relative", flex: "none" }}>
              <div style={{ width: 46, height: 46, borderRadius: 15, background: "var(--wash)", display: "grid", placeItems: "center", fontSize: 22 }}>{ico}</div>
              <span style={{ position: "absolute", top: -5, right: -5, width: 21, height: 21, borderRadius: "50%", background: "var(--brand)", color: "#fff", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800 }}>{i + 1}</span>
            </div>
            <div className="grow">
              <b style={{ fontSize: 14.5 }}>{title}</b>
              <p className="tiny" style={{ marginTop: 4 }}>{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ background: "var(--wash)", borderColor: "transparent" }}>
        <b style={{ fontSize: 14.5 }}>What it costs</b>
        <p className="sub" style={{ marginTop: 6 }}>
          Each service has a starting price shown before you book, based on what that job usually takes.
          The worker confirms the final amount with you on site if the job turns out bigger than expected — nothing is charged without your say-so.
        </p>
      </div>

      <div className="card" style={{ background: "var(--amber-bg)", borderColor: "transparent" }}>
        <b style={{ fontSize: 14.5 }}>If something goes wrong</b>
        <p className="sub" style={{ marginTop: 6 }}>
          Cancelling is free while your job is still open. Once a worker is on the way a small fee may apply, since they've already set out.
          During any active job there's an SOS button, and you can report an issue from Help &amp; support at any time.
        </p>
      </div>
    </div>
  );
}

/* ── My ratings (real data) ── */
function MyRatings({ jobs, onBack }) {
  const avg = jobs.length ? (jobs.reduce((s, j) => s + j.my_stars, 0) / jobs.length).toFixed(1) : null;
  return (
    <div className="screen">
      <SubHead title="My ratings" onBack={onBack} sub="Ratings you've given to workers after each job." />
      {jobs.length > 0 && (
        <div className="card" style={{ textAlign: "center", padding: "22px 16px" }}>
          <p className="tiny" style={{ fontWeight: 800, letterSpacing: ".08em" }}>AVERAGE YOU GIVE</p>
          <b style={{ fontFamily: "var(--display)", fontSize: 38, display: "block", marginTop: 4 }}>{avg}</b>
          <div className="stars" style={{ fontSize: 20 }}>{"★".repeat(Math.round(avg))}</div>
          <p className="tiny" style={{ marginTop: 6 }}>across {jobs.length} rated job{jobs.length === 1 ? "" : "s"}</p>
        </div>
      )}
      <div className="list">
        {jobs.length === 0 && <div className="empty"><div className="big">⭐</div>You haven't rated any jobs yet</div>}
        {jobs.map((j) => (
          <div key={j.id} className="card row">
            <Avatar name={j.worker_name || "Worker"} photo={j.worker_photo} />
            <div className="grow">
              <b style={{ fontSize: 14 }}>{j.worker_name || "Worker"}</b>
              <p className="tiny">{titleCase(j.service)} · {j.completed_at ? new Date(j.completed_at + "Z").toLocaleDateString() : ""}</p>
            </div>
            <span className="stars">{"★".repeat(j.my_stars)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Settings (persisted locally) ── */
const SET_KEY = "sahayak_cust_settings";
function SettingsScreen({ onBack, push }) {
  const [s, setS] = useState(() => {
    try { return { notifJobs: true, notifOffers: true, sound: true, ...JSON.parse(localStorage.getItem(SET_KEY)) }; }
    catch { return { notifJobs: true, notifOffers: true, sound: true }; }
  });
  const [lang, setLang] = useState(localStorage.getItem("sahayak_cust_lang") || "English");

  const toggle = (k) => {
    const next = { ...s, [k]: !s[k] };
    setS(next); localStorage.setItem(SET_KEY, JSON.stringify(next));
  };
  const pickLang = (l) => { setLang(l); localStorage.setItem("sahayak_cust_lang", l); push?.("Language preference saved", l); };

  const ROWS = [
    ["notifJobs", "Job updates", "Worker accepted, on the way, completed"],
    ["notifOffers", "Offers & promos", "Discounts and seasonal deals"],
    ["sound", "Sound & vibration", "Play a sound for new notifications"],
  ];

  return (
    <div className="screen">
      <SubHead title="Settings" onBack={onBack} />
      <div className="h2">Notifications</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {ROWS.map(([k, t, d], i) => (
          <div key={k} className="row" style={{ padding: "15px 16px", gap: 14, borderBottom: i < ROWS.length - 1 ? "1px solid var(--line)" : "none" }}>
            <div className="grow">
              <b style={{ fontSize: 14 }}>{t}</b>
              <p className="tiny">{d}</p>
            </div>
            <button className={`switch ${s[k] ? "on" : ""}`} onClick={() => toggle(k)} aria-label={t} />
          </div>
        ))}
      </div>

      <div className="h2">Language</div>
      <div className="chip-row">
        {["English", "हिन्दी", "ગુજરાતી", "मराठी"].map((l) => (
          <button key={l} className={`chip ${lang === l ? "on" : ""}`} onClick={() => pickLang(l)}>{l}</button>
        ))}
      </div>
      <p className="tiny">More languages are on the way — your preference is saved for when they land.</p>

      <div className="h2">Privacy</div>
      <div className="card">
        <p className="sub">Location is used only while you're posting or tracking a job. You can revoke it any time from your browser's site settings.</p>
        <button className="btn btn-ghost btn-small" style={{ marginTop: 12 }}
          onClick={() => { localStorage.removeItem("sahayak_cust_gps"); push?.("Saved location cleared"); }}>
          Clear saved location
        </button>
      </div>
    </div>
  );
}

/* ── Help & support ── */
function HelpSupport({ onBack, push }) {
  const [open, setOpen] = useState(null);
  const [issue, setIssue] = useState("");
  const FAQ = [
    ["How do I book a worker?", "Pick a service on the home screen, describe the job, set your price and payment method, then post it. Nearby workers are alerted instantly and you choose who comes."],
    ["Who decides the price?", "You do. You name your price when posting, and we show the typical range for that service so you know what's fair. Workers accept only if the price works for them."],
    ["When do I pay?", "Only after the job is finished. You confirm the amount and payment method in the app once the worker marks the job complete."],
    ["Can I cancel a booking?", "Yes. Cancelling is free while your job is still open. Once you've selected a worker who is already on the way, a small cancellation fee may apply."],
    ["What if no worker accepts?", "The job expires after a while and you'll be notified. You can post again at a higher price or at a different time of day."],
    ["Is my location shared?", "Your address is shared only with the worker you select, and only for that job. Workers never see your exact location before you choose them."],
    ["How are workers verified?", "Workers build trust through ratings from real completed jobs. You can see each worker's rating, jobs completed and experience before choosing."],
  ];
  const submit = async () => {
    if (!issue.trim()) return;
    try {
      await api("/auth/report", { method: "POST", body: { kind: "other", reason: issue.trim() } });
      push?.("Issue reported", "Our team will look into it.");
      setIssue("");
    } catch (e) { push?.("Couldn't send", e.message); }
  };
  return (
    <div className="screen">
      <SubHead title="Help & support" onBack={onBack} />

      <div className="h2">Frequently asked</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {FAQ.map(([q, a], i) => (
          <div key={q} style={{ borderBottom: i < FAQ.length - 1 ? "1px solid var(--line)" : "none" }}>
            <button className="row" style={{ width: "100%", textAlign: "left", padding: "15px 16px", gap: 12 }}
              onClick={() => setOpen(open === i ? null : i)}>
              <b className="grow" style={{ fontSize: 14 }}>{q}</b>
              <span style={{ color: "var(--ink-3)" }}>{open === i ? "−" : "+"}</span>
            </button>
            {open === i && <p className="sub" style={{ padding: "0 16px 15px" }}>{a}</p>}
          </div>
        ))}
      </div>

      <div className="h2">Report an issue</div>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="field">
          <label>Tell us what went wrong</label>
          <textarea rows={3} placeholder="Describe the problem — the more detail, the faster we can help." value={issue} onChange={(e) => setIssue(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={!issue.trim()} onClick={submit}>Submit report</button>
      </div>

      <div className="h2">Contact us</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <a className="row" href="tel:1800000000" style={{ padding: "15px 16px", gap: 14, borderBottom: "1px solid var(--line)", textDecoration: "none", color: "inherit" }}>
          <span style={{ fontSize: 20 }}>📞</span>
          <div className="grow"><b style={{ fontSize: 14 }}>Call support</b><p className="tiny">9 AM – 9 PM, all days</p></div>
        </a>
        <a className="row" href="mailto:help@sahayak.app" style={{ padding: "15px 16px", gap: 14, textDecoration: "none", color: "inherit" }}>
          <span style={{ fontSize: 20 }}>✉️</span>
          <div className="grow"><b style={{ fontSize: 14 }}>Email us</b><p className="tiny">help@sahayak.app</p></div>
        </a>
      </div>

      <div className="card row" style={{ background: "#fdeceb", borderColor: "#f7c6c4", gap: 14 }}>
        <span style={{ fontSize: 30 }}>🆘</span>
        <div className="grow">
          <b style={{ fontSize: 14, color: "#a1281a" }}>Emergency</b>
          <p style={{ fontSize: 12.5, color: "#b5382a", marginTop: 3 }}>If you're in immediate danger, call 112. During an active job you can also use the SOS button.</p>
        </div>
      </div>
    </div>
  );
}

/* ── About ── */
function AboutSahayak({ onBack }) {
  return (
    <div className="screen">
      <SubHead title="About Sahayak" onBack={onBack} />
      <div className="card" style={{ textAlign: "center", padding: "26px 18px" }}>
        <div className="wordmark" style={{ fontSize: 34 }}>Sahayak<span className="dot">.</span></div>
        <p className="sub" style={{ marginTop: 8 }}>Trusted local help, minutes away.</p>
        <p className="tiny" style={{ marginTop: 10 }}>Version 1.0.0</p>
      </div>

      <div className="card">
        <b style={{ fontSize: 15 }}>Our idea</b>
        <p className="sub" style={{ marginTop: 8 }}>
          Finding a reliable electrician or plumber shouldn't mean asking around for a number and hoping for the best.
          Sahayak connects you directly with skilled workers near you — no agents, no markup, and no haggling on the doorstep.
        </p>
        <p className="sub" style={{ marginTop: 10 }}>
          You name your price up front. Every nearby worker sees the job at the same moment. The ones who are free accept,
          and you pick the person you like best.
        </p>
      </div>

      <div className="card">
        <b style={{ fontSize: 15 }}>Fair for workers too</b>
        <p className="sub" style={{ marginTop: 8 }}>
          Workers keep the large majority of what you pay. A small, clearly shown platform fee keeps the service running,
          and they can see the exact split for every job in their earnings screen.
        </p>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {[["📜", "Terms of use"], ["🔒", "Privacy policy"], ["⚖️", "Open source licenses"]].map(([ico, t], i) => (
          <div key={t} className="row" style={{ padding: "15px 16px", gap: 14, borderBottom: i < 2 ? "1px solid var(--line)" : "none" }}>
            <span style={{ fontSize: 20 }}>{ico}</span>
            <b className="grow" style={{ fontSize: 14 }}>{t}</b>
            <span style={{ color: "var(--ink-3)" }}>›</span>
          </div>
        ))}
      </div>

      <p className="tiny" style={{ textAlign: "center", padding: "8px 0 20px" }}>Made with ❤️ in India<br />© 2026 Sahayak</p>
    </div>
  );
}

/* ── Wallet (real spend history) ── */
function Wallet({ paidJobs, totalSpent, onBack }) {
  return (
    <div className="screen">
      <SubHead title="My wallet" onBack={onBack} />
      <div className="card" style={{ background: "linear-gradient(150deg, var(--brand), var(--brand-deep))", color: "#fff", borderColor: "transparent", padding: "24px 18px" }}>
        <p style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".1em", opacity: .8 }}>WALLET BALANCE</p>
        <b style={{ fontFamily: "var(--display)", fontSize: 34, display: "block", marginTop: 4 }}>₹0</b>
        <p style={{ fontSize: 12.5, opacity: .85, marginTop: 6 }}>Referral rewards and refunds land here.</p>
      </div>

      <div className="stat-grid">
        <div className="stat"><div className="k">Total spent</div><div className="v">{rupee(totalSpent)}</div></div>
        <div className="stat"><div className="k">Jobs paid</div><div className="v">{paidJobs.length}</div></div>
      </div>

      <div className="h2">Payment history</div>
      <div className="list">
        {paidJobs.length === 0 && <div className="empty"><div className="big">🧾</div>No payments yet</div>}
        {paidJobs.map((j) => (
          <div key={j.id} className="card row">
            <div className="grow">
              <b style={{ fontSize: 14 }}>{titleCase(j.service)}</b>
              <p className="tiny">
                {j.worker_name ? `${j.worker_name} · ` : ""}
                {(j.paid_mode || "").toUpperCase()}
                {j.completed_at ? ` · ${new Date(j.completed_at + "Z").toLocaleDateString()}` : ""}
              </p>
            </div>
            <b>{rupee(j.paid_amount)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

const titleCase = (s) => (s || "").split("-").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
const labelFor = (services, slug) => services.find((s) => s.slug === slug)?.label || titleCase(slug);
