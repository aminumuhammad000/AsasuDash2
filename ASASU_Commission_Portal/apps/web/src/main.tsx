import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/app.css";

// Suppress noisy in-page provider errors injected by browser extensions
// (e.g. inpage.js) so they don't break the app initialization.
function isInpageProviderError(msg: string | undefined, filename?: string) {
  if (!msg && !filename) return false;
  const m = String(msg || "").toLowerCase();
  const f = String(filename || "").toLowerCase();
  return (
    m.includes("in_page_channel_node_id") ||
    m.includes("in-page-channel-node-id") ||
    m.includes("channel secret not available") ||
    f.includes("inpage.js") ||
    f.includes("in-page")
  );
}

window.addEventListener("error", (ev) => {
  try {
    const ee = ev as ErrorEvent;
    if (isInpageProviderError(ee.message, ee.filename)) {
      ev.preventDefault();
      // keep a lightweight console notice for debugging
      // eslint-disable-next-line no-console
      console.warn("Suppressed in-page provider error:", ee.message, ee.filename);
    }
  } catch (_) {
    // ignore
  }
});

window.addEventListener("unhandledrejection", (ev) => {
  try {
    const reason: any = (ev as PromiseRejectionEvent).reason;
    const msg = typeof reason === "string" ? reason : reason?.message;
    if (isInpageProviderError(msg, undefined)) {
      ev.preventDefault();
      // eslint-disable-next-line no-console
      console.warn("Suppressed in-page provider rejection:", reason);
    }
  } catch (_) {
    // ignore
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
