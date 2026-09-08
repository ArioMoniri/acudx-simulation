import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

// The client talks to the AcuDx API gateway at the same origin under `/api`
// (see src/lib/backend.ts). In development that path is proxied to the gateway
// so the app reaches the live model backend without hardcoding its origin in
// the client or dealing with CORS. Override the target with API_PROXY_TARGET
// (e.g. the SSH-tunnelled pod). In production `/api` is served by the deploy's
// own reverse proxy.
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? "http://localhost:8890";

/**
 * Resolve the ElevenLabs API key server-side (never shipped to the browser):
 * prefer the process env, else read it from a dotenv-style file
 * (`TTS_ENV_FILE`, default `~/.config/intake/tts.env`). Missing key => TTS is
 * simply disabled (the endpoint answers 503 and the client stays text-only).
 */
function resolveTtsKey(): string | undefined {
  const fromEnv =
    process.env.TTS_ELEVENLABS_API_KEY ?? process.env.ELEVENLABS_API_KEY;
  if (fromEnv) return fromEnv;
  const file = process.env.TTS_ENV_FILE ?? `${homedir()}/.config/intake/tts.env`;
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*(?:TTS_)?ELEVENLABS_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no file — TTS disabled */
  }
  return undefined;
}

/**
 * Dev-only Text-To-Speech proxy. POST /tts { text, voiceId } -> ElevenLabs
 * audio/mpeg. The API key lives only in this Node process; the browser never
 * sees it. In production this route is served by the deploy's own backend.
 */
function ttsProxyPlugin(): Plugin {
  return {
    name: "acudx-tts-proxy",
    configureServer(server) {
      const apiKey = resolveTtsKey();
      server.config.logger.info(
        apiKey
          ? "  ➤ patient voice (ElevenLabs) proxy enabled at /tts"
          : "  ➤ patient voice disabled (no ElevenLabs key found)",
      );
      server.middlewares.use("/tts", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        if (!apiKey) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ error: "tts-not-configured" }));
        }
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
          const text: string = String(body.text ?? "").slice(0, 800);
          const voiceId: string =
            String(body.voiceId ?? "").trim() || "21m00Tcm4TlvDq8ikWAM";
          if (!text.trim()) {
            res.statusCode = 400;
            return res.end();
          }
          const upstream = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
              method: "POST",
              headers: {
                "xi-api-key": apiKey,
                "Content-Type": "application/json",
                Accept: "audio/mpeg",
              },
              body: JSON.stringify({
                text,
                model_id: "eleven_multilingual_v2",
                voice_settings: { stability: 0.5, similarity_boost: 0.75 },
              }),
            },
          );
          if (!upstream.ok || !upstream.body) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            return res.end(
              JSON.stringify({ error: "tts-upstream", status: upstream.status }),
            );
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "audio/mpeg");
          res.setHeader("Cache-Control", "no-store");
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch {
          res.statusCode = 500;
          res.end();
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), ttsProxyPlugin()],
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
