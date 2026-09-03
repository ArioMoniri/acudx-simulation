import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

/**
 * AcuDx web — Vitest unit-test config (Issue #32).
 *
 * Standalone config (takes precedence over vite.config.ts) so the pure-logic
 * unit suite runs without pulling in the app's React/Tailwind build plugins.
 * The `@/*` path alias mirrors tsconfig.json + vite.config.ts so tests import
 * the real modules exactly as the app does.
 *
 * Environment is `node`: every module under test is pure/dependency-free
 * (case generation, scope guard, process metrics, FSRS scheduling, the
 * event-sourced encounter store). No test needs a DOM; switch a single file to
 * jsdom via a `// @vitest-environment jsdom` docblock if that ever changes.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
