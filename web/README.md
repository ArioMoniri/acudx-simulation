# AcuDx (web)

The learner-facing app: an Epic-like EHR workspace for generated emergency
cases, the patient call tile, team rooms, the anatomy atlas, and the dean,
faculty and admin panels. It talks to the gateway in `../server` over
same-origin `/api` and to the rooms relay in `../multiplayer` over WebSocket.
Without a gateway it still runs on labelled on-device fallbacks (template case,
offline synthetic normal results, "guidance unavailable").

> For education only. Not for real patient care.

## Run

```bash
npm install
npm run dev
```

Open the printed URL (default http://localhost:5173). The dev server proxies
`/api/*` to the gateway at `API_PROXY_TARGET` (default `http://localhost:8890`),
rewriting `/api/v1/...` to `/v1/...`. No vendor key is ever read by Vite.

## Scripts (from `package.json`)

| Script | What it does |
| --- | --- |
| `npm run dev` | `vite`: dev server with HMR |
| `npm run build` | `tsc --noEmit && vite build` |
| `npm run preview` | `vite preview`: serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `eslint .` (flat config in `eslint.config.js`: typescript-eslint, react-hooks, react-refresh) |
| `npm test` | `vitest run` (`src/**/*.test.ts`) |
| `npm run test:e2e` | `playwright test` (`e2e/*.spec.ts`, four viewports) |
| `npm run test:e2e:report` | `playwright show-report` |

## Build-time environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_BACKEND_URL` | same-origin `/api` | Gateway origin when the app is served from a different host than the gateway (`src/lib/backend.ts`) |
| `VITE_MULTIPLAYER_URL` | `ws://<hostname>:8899` | Rooms relay URL (`src/lib/roomTransport.ts`) |
| `API_PROXY_TARGET` | `http://localhost:8890` | Dev-server proxy target for `/api` (`vite.config.ts`), not shipped to the bundle |

Everything else (model, voice, avatar, identity, GPU) is configured on the
gateway through the admin console; the browser never holds a provider key.

## Testing

Unit tests are Vitest (`npm test`). End-to-end tests are Playwright
(`npm run test:e2e`, config in `playwright.config.ts`):

- Four projects, one per protocol viewport: `mobile` 390x844, `tablet`
  768x1024, `laptop` 1280x800, `desktop` 1920x1080.
- Playwright starts the Vite dev server on http://localhost:4173 and the
  rooms relay (`../multiplayer/server.mjs`) on ws://localhost:8899; both are
  reused when already running. `E2E_PREVIEW=1` runs the production bundle
  (`npm run build && npm run preview`) instead of the dev server.
- Sessions are created through the real UI (`e2e/helpers/session.ts`:
  SignInPage -> Create your profile -> role); no localStorage injection.
- The suite measures the on-device path: `createProfile` aborts every `/api`
  request for the browser context, so a gateway that happens to listen on the
  proxy port of the same machine cannot switch the app to its live path
  mid-run (the specs assume deterministic client replies and results).
- Specs: `routes` (every route renders with no console errors and no
  horizontal overflow), `a11y` (axe-core; serious and critical fail, the rest
  are logged), `buttons` (click every enabled button on every route),
  `encounter` (start -> interview -> exam -> lab and imaging orders -> results
  -> treatment -> diagnosis -> feedback), `rooms` (create, join by code from a
  second browser context, role switch), `authoring`, `atlas`, `stress`
  (25 rapid orders and 50 rapid questions in one encounter), `screenshots`
  (every route at desktop and mobile into `e2e/__screenshots__/`).
- Browser: Chromium. In the sandbox the preinstalled build under
  `PLAYWRIGHT_BROWSERS_PATH` is used via `launchOptions.executablePath`
  (never run `playwright install` there); CI installs the matching revision
  with `npx playwright install --with-deps chromium`.

## Stack

- **Vite 6** + `@vitejs/plugin-react` + **TypeScript** (React 18)
- **Tailwind v4** via `@tailwindcss/vite` (CSS-first: `@import "tailwindcss"` +
  `@theme` tokens in `src/index.css`; dark theme via the `.dark` class)
- **react-router-dom v6**, every page lazy-loaded with hover prefetch
- **i18next** + **react-i18next** + browser language detector (EN default, TR;
  per-feature files under `src/i18n/features/<feature>.{en,tr}.json` deep-merged
  over `src/i18n/locales/`)
- **@phosphor-icons/react** (one weight), **motion** (reduced-motion aware),
  **Radix** Tabs, Tooltip, Switch, Dialog, **recharts** for panels,
  **three** for the atlas 3D view, **livekit-client** for the video call,
  **lottie-web** for the brand mark
- Fonts self-hosted through `@fontsource-variable/manrope`,
  `@fontsource-variable/inter`, `@fontsource/geist-mono` (no CDN)

## Design language

Clean clinical white base, one locked brand blue (`--brand-600 #2563EB`), and
the teal to pink gradient reserved for the app-icon tile. The one dark element
is the vitals monitor, which stays dark in both themes. Clinical states are
always icon plus text, never colour alone (WCAG 1.4.1). Tokens and rules:
`../docs/design/00-design-system.md`; brand files: `public/brand/README.md`.

## Structure

```
src/
  main.tsx              App entry: i18n + ThemeProvider + Router
  App.tsx               Routes and role gates (signin, profile, home, start, cases,
                        encounter, feedback, progress, rooms, exam, atlas, authoring,
                        dean, faculty, admin)
  index.css             Tailwind import, fonts, design tokens
  pages/                One module per route (lazy chunks)
  components/           ui/ primitives, shell/, ehr/ (tabs, call tile, viewers),
                        room/, atlas/, admin/, institution/, landing/, monitor/
  domain/               Case, orderables, treatments, clinical course (typed)
  state/                Event-sourced encounter store, profile, progress
  lib/                  Gateway clients (caseGenV2, resultsApi, guidelinesApi,
                        voiceApi, panelsApi, adminApi), auth (OIDC PKCE), theme
  i18n/                 locales/ (base EN, TR) + features/ (per-feature files)
  data/                 Seed cases, curated imaging bundle, room fixtures
e2e/                    Playwright specs and helpers
```

The `@/` path alias maps to `src/`.
