import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

const PRODUCTION_API_ORIGIN = "https://api.playmassalia.com";

// index.html carries the production Content-Security-Policy verbatim. This plugin
// adapts it for other targets: a build against another API (VITE_API_URL, e.g. a
// local API for smoke-testing the built site) swaps the API origin in connect-src
// and img-src, and the dev server (`vite`) additionally allows the inline React
// Fast Refresh preamble + the HMR websocket that only exist in dev.
function csp(apiUrl: string | undefined, isDev: boolean): Plugin {
  const apiOrigin = apiUrl ? new URL(apiUrl).origin : isDev ? "http://localhost:3001" : PRODUCTION_API_ORIGIN;
  return {
    name: "massalia-csp",
    transformIndexHtml(html) {
      return html.replace(/(<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content=")([^"]*)(")/, (_match, open, policy, close) => {
        let next: string = policy;
        if (apiOrigin !== PRODUCTION_API_ORIGIN) next = next.split(PRODUCTION_API_ORIGIN).join(apiOrigin);
        if (isDev) {
          next = next.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("connect-src 'self'", "connect-src 'self' ws: wss:");
        }
        return `${open}${next}${close}`;
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    base: "/",
    plugins: [react(), csp(env.VITE_API_URL, command === "serve")],
    server: {
      proxy: {
        "/api": "http://localhost:3000",
        "/content": "http://localhost:3000",
      },
    },
  };
});
