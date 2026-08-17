import React, { useEffect, useState } from "react";
import { api, session, rupee, resetSocket } from "./api.js";

export default function AdminApp({ onExit }) {
  const [user, setUser] = useState(session.user?.role === "admin" ? session.user : null);
  if (!user) {
    return <AdminLogin onDone={setUser} />;
  }
  return <AdminHome onExit={onExit} />;
}

/* Password-only login — no phone/OTP. Only owners with the password get in. */
function AdminLogin({ onDone }) {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!password) return;
    setBusy(true); setErr("");
    try {
      const r = await api("/auth/admin-login", { method: "POST", body: { password } });
      session.token = r.token;
      session.user = r.user;
      resetSocket();
      onDone(r.user);
    } catch (e) {
      setErr(e.message || "Incorrect password");
      setBusy(false);
    }
  };

  return (
    <div className="admin-login-wrap">
      <div className="admin-login-card">
        <div className="brand" style={{ fontSize: 26, marginBottom: 6 }}>Sahayak<small>ADMIN</small></div>
        <p className="sub" style={{ marginBottom: 22 }}>Owner console — enter the admin password to continue.</p>
        <div className="field">
          <label>Admin password</label>
          <input type="password" placeholder="Enter password" value={password} autoFocus
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        {err && <p className="sub" style={{ color: "var(--red)", marginTop: 10 }}>{err}</p>}
        <button className="btn btn-primary" style={{ marginTop: 18 }} disabled={!password || busy} onClick={submit}>
          {busy ? <span className="spin" /> : "Sign in"}
        </button>
        <p className="tiny" style={{ textAlign: "center", marginTop: 16, color: "var(--ink-3)" }}>
          Access restricted to platform owners.
        </p>
      </div>
    </div>
  );
}

function AdminHome({ onExit }) {
  const [nav, setNav] = useState("dashboard");
  return (
    <>
      <div className="appbar">
        <div className="brand">Sahayak<small>ADMIN</small></div>
        <button className="btn btn-danger btn-small" onClick={() => { session.clear(); onExit(); }}>Log out</button>
      </div>
      <div className="admin-body">
        <nav className="admin-nav">
          {[["dashboard", "Dashboard"], ["jobs", "Jobs"], ["workers", "Workers"], ["customers", "Customers"], ["payments", "Payments"], ["reports", "Reports"], ["settings", "Settings"]].map(([k, l]) => (
            <button key={k} className={nav === k ? "on" : ""} onClick={() => setNav(k)}>{l}</button>
          ))}
        </nav>
        <main className="admin-main">
          {nav === "dashboard" && <Dashboard />}
          {nav === "jobs" && <Jobs />}
          {(nav === "workers" || nav === "customers") && <Users role={nav === "workers" ? "worker" : "customer"} key={nav} />}
          {nav === "payments" && <Payments />}
          {nav === "reports" && <Reports />}
          {nav === "settings" && <Settings />}
        </main>
      </div>
    </>
  );
}

function Dashboard() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    const load = () => api("/admin/dashboard").then((r) => setStats(r.stats));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  if (!stats) return "Loading…";
  const tiles = [
    ["Platform revenue", rupee(stats.platform_revenue)],
    ["Gross volume", rupee(stats.gross_volume)],
    ["Active jobs", stats.jobs_active],
    ["Completed jobs", stats.jobs_completed],
    ["Customers", stats.customers],
    ["Workers", `${stats.workers} (${stats.workers_online} online)`],
  ];
  return (
    <>
      <h2 className="h1" style={{ fontSize: 22, marginBottom: 16 }}>Live overview</h2>
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {tiles.map(([k, v]) => (
          <div key={k} className="stat"><div className="v">{v}</div><div className="k">{k}</div></div>
        ))}
      </div>
      <p className="sub" style={{ marginTop: 16 }}>Commission rate: <b>{stats.commission_pct}%</b> — change it under Settings. Refreshes every 15s.</p>
    </>
  );
}

function Jobs() {
  const [jobs, setJobs] = useState([]);
  useEffect(() => { api("/admin/jobs").then((r) => setJobs(r.jobs)); }, []);
  return (
    <>
      <h2 className="h1" style={{ fontSize: 22, marginBottom: 16 }}>Jobs</h2>
      <table className="data">
        <thead><tr><th>Service</th><th>Customer</th><th>Worker</th><th>Offer</th><th>Paid</th><th>Fee</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td><b>{j.service}</b></td>
              <td>{j.customer_name || j.customer_phone}</td>
              <td>{j.worker_name || "—"}</td>
              <td>{rupee(j.price_offered)}</td>
              <td>{j.paid_amount ? rupee(j.paid_amount) : "—"}</td>
              <td>{j.commission_amount ? rupee(j.commission_amount) : "—"}</td>
              <td><span className={`badge ${j.status}`}>{j.status.replace("_", " ")}</span></td>
              <td className="tiny">{new Date(j.created_at + "Z").toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Users({ role }) {
  const [users, setUsers] = useState([]);
  const load = () => api(`/admin/users?role=${role}`).then((r) => setUsers(r.users));
  useEffect(() => { load(); }, [role]);
  const toggle = async (u) => {
    await api(`/admin/users/${u.id}/suspend`, { method: "POST", body: { suspended: !u.suspended } });
    load();
  };
  return (
    <>
      <h2 className="h1" style={{ fontSize: 22, marginBottom: 16 }}>{role === "worker" ? "Workers" : "Customers"}</h2>
      <table className="data">
        <thead>
          <tr><th>Name</th><th>Phone</th>
            {role === "worker" && <><th>Skills</th><th>Rating</th><th>Jobs</th><th>Status</th></>}
            <th>Joined</th><th></th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={{ opacity: u.suspended ? 0.5 : 1 }}>
              <td><b>{u.name || "—"}</b></td>
              <td>{u.phone}</td>
              {role === "worker" && (
                <>
                  <td className="tiny">{(u.skills || []).join(", ") || "—"}</td>
                  <td>{u.rating ? `★ ${u.rating}` : "—"}</td>
                  <td>{u.jobs_completed}</td>
                  <td>{u.available ? "🟢 online" : "⚪ paused"}</td>
                </>
              )}
              <td className="tiny">{new Date(u.created_at + "Z").toLocaleDateString()}</td>
              <td>
                <button className={`btn btn-small ${u.suspended ? "btn-ghost" : "btn-danger"}`} onClick={() => toggle(u)}>
                  {u.suspended ? "Restore" : "Suspend"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Payments() {
  const [payments, setPayments] = useState([]);
  useEffect(() => { api("/admin/payments").then((r) => setPayments(r.payments)); }, []);
  const csv = () => {
    const rows = [["id", "service", "worker", "amount", "mode", "commission", "net", "date"]]
      .concat(payments.map((p) => [p.id, p.service, p.worker_name, p.amount, p.mode, p.commission_amount, p.net_worker_amount, p.created_at]));
    const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sahayak-payments.csv";
    a.click();
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        <h2 className="h1 grow" style={{ fontSize: 22 }}>Payments</h2>
        <button className="btn btn-ghost btn-small" onClick={csv}>Export CSV</button>
      </div>
      <table className="data">
        <thead><tr><th>Service</th><th>Worker</th><th>Amount</th><th>Mode</th><th>Commission</th><th>Worker net</th><th>Date</th></tr></thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td><b>{p.service}</b></td>
              <td>{p.worker_name}</td>
              <td>{rupee(p.amount)}</td>
              <td>{p.mode.toUpperCase()}</td>
              <td>{rupee(p.commission_amount)} <span className="tiny">({p.commission_pct}%)</span></td>
              <td><b>{rupee(p.net_worker_amount)}</b></td>
              <td className="tiny">{new Date(p.created_at + "Z").toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Settings() {
  const [pct, setPct] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { api("/admin/dashboard").then((r) => setPct(String(r.stats.commission_pct))); }, []);
  return (
    <>
      <h2 className="h1" style={{ fontSize: 22, marginBottom: 16 }}>Settings</h2>
      <div className="card" style={{ maxWidth: 380 }}>
        <div className="field">
          <label>Platform commission (%)</label>
          <input inputMode="decimal" value={pct} onChange={(e) => { setPct(e.target.value); setSaved(false); }} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }}
          onClick={async () => { await api("/admin/commission", { method: "POST", body: { pct: Number(pct) } }); setSaved(true); }}>
          {saved ? "Saved ✓" : "Update commission"}
        </button>
        <p className="tiny" style={{ marginTop: 10 }}>Applied to every payment recorded after the change. Never hardcoded.</p>
      </div>
    </>
  );
}

function Reports() {
  const [reports, setReports] = useState([]);
  const load = () => api("/admin/reports").then((r) => setReports(r.reports));
  useEffect(() => { load(); }, []);
  const resolve = async (id) => { await api(`/admin/reports/${id}/resolve`, { method: "POST" }); load(); };
  return (
    <>
      <h2 className="h1" style={{ fontSize: 22, marginBottom: 16 }}>Reports & disputes</h2>
      <table className="table">
        <thead><tr><th>When</th><th>Kind</th><th>Reporter</th><th>Job</th><th>Reason</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {reports.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 24 }}>No reports 🎉</td></tr>}
          {reports.map((r) => (
            <tr key={r.id} style={r.kind === "sos" && r.status === "open" ? { background: "#fff1f0" } : {}}>
              <td>{new Date(r.created_at + "Z").toLocaleString()}</td>
              <td>{r.kind === "sos" ? "🆘 SOS" : r.kind}</td>
              <td>{r.reporter_name || r.reporter_phone} <span className="tiny">({r.reporter_role})</span></td>
              <td>{r.service || "—"}</td>
              <td>{r.reason}</td>
              <td><span className={`badge ${r.status === "open" ? "open" : "completed"}`}>{r.status}</span></td>
              <td>{r.status === "open" && <button className="btn btn-ghost btn-small" onClick={() => resolve(r.id)}>Resolve</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
