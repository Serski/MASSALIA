// Plausible analytics queue stub (formerly inline in index.html). The real
// script — <script async src="https://plausible.io/js/pa-….js"> in index.html —
// replaces window.plausible when it loads and drains anything queued here. Kept
// as a module so the Content-Security-Policy can stay script-src 'self' + plausible.io
// with no 'unsafe-inline'.
type PlausibleFn = ((...args: unknown[]) => void) & { q?: unknown[][]; o?: Record<string, unknown>; init?: (options?: Record<string, unknown>) => void };

declare global {
  interface Window {
    plausible?: PlausibleFn;
  }
}

const plausible: PlausibleFn =
  window.plausible ??
  ((...args: unknown[]) => {
    (plausible.q = plausible.q ?? []).push(args);
  });
window.plausible = plausible;
plausible.init = plausible.init ?? ((options) => {
  plausible.o = options ?? {};
});
plausible.init();

export {};
