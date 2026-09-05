import React from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import "./plausible.js";
import { LEGACY_TOKEN_STORAGE_KEY } from "./api.js";
import { App } from "./App.js";

// HTTPS bounce: a plain-http hit on the production host is redirected to the
// same URL over https before anything else runs (nothing is rendered). The
// session cookie is Secure, so an http page could never be logged in anyway.
if (location.protocol === "http:" && location.hostname.endsWith("playmassalia.com")) {
  location.replace(`https://${location.host}${location.pathname}${location.search}${location.hash}`);
} else {
  boot();
}

function boot() {
  // Sessions are cookie-only; drop the raw token older builds kept in localStorage
  // (a no-op once it is gone). The server no longer accepts it either.
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
}
