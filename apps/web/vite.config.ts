import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/MASSALIA/" : "/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/content": "http://localhost:3000",
    },
  },
});
