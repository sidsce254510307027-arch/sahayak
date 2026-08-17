import React from "react";
import WorkerApp from "./WorkerApp.jsx";
export default function App() {
  return <WorkerApp onExit={() => window.location.reload()} />;
}
