import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// The client talks to the AcuDx API gateway at the same origin under `/api`
// (see src/lib/backend.ts). In development that path is proxied to the gateway
// so the app reaches the live model backend without fixing its origin in
// the client or dealing with CORS. Override the target with API_PROXY_TARGET
// (e.g. the SSH-tunnelled pod). In production `/api` is served by the deploy's
// own reverse proxy. Voice (TTS / STT) rides the same proxy: the gateway's
// /v1/voice/* routes hold the provider keys (server/voice), so the dev server
// no longer carries any vendor key or vendor-specific middleware.
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? "http://localhost:8890";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      // `/api/v1/...` on the dev origin -> `/v1/...` on the gateway.
      "/api": {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
