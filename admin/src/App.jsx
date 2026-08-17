import React from "react";
import AdminApp from "./AdminApp.jsx";
export default function App() {
  return (
    <div className="stage">
      <div className="desktop-shell">
        <AdminApp onExit={() => window.location.reload()} />
      </div>
    </div>
  );
}
