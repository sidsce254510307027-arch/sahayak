import React from "react";
import CustomerApp from "./CustomerApp.jsx";
export default function App() {
  return <CustomerApp onExit={() => window.location.reload()} />;
}
