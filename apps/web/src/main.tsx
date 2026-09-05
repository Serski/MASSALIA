import React from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import "./plausible.js";
import { LEGACY_TOKEN_STORAGE_KEY } from "./api.js";
import { App } from "./App.js";

// Sessions are cookie-only now; drop the raw token older builds kept in
// localStorage (a no-op once it is gone). The server still honours that token as
// a Bearer header for one release, but this client never sends it again.
try {
  localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
} catch {
  // localStorage unavailable (private mode / blocked): nothing to purge.
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
