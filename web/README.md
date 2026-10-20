# AcuDx (web)

Clinical medical-education roleplay platform. Text-first emergency-medicine
encounters with structured, evidence-anchored feedback and a calibration mirror.

This package is the web client scaffold: the design system, i18n, app shell,
and shared building blocks. Full screens are placeholder routes for now.

> For education only. Not for real patient care.

## Run

```bash
npm install
npm run dev
```

Then open the printed local URL (default http://localhost:5173).

## Scripts

| Script            | What it does                                  |
| ----------------- | --------------------------------------------- |
| `npm run dev`     | Start the Vite dev server with HMR            |
| `npm run build`   | Typecheck (`tsc --noEmit`) then production build |
| `npm run preview` | Serve the production build locally            |
| `npm run typecheck` | Type-check only                             |
| `npm run lint`    | ESLint 9 flat config (`eslint.config.js`): typescript-eslint, react-hooks, react-refresh |
| `npm test`        | Vitest unit suite (`src/**/*.test.ts`)          |
| `npm run test:e2e` | Playwright end-to-end suite (`e2e/*.spec.ts`), 4 viewports |
| `npm run test:e2e:report` | Open the last Playwright HTML report     |

## Testing

Unit tests are Vitest (`npm test`). End-to-end tests are Playwright
(`npm run test:e2e`, config in `playwright.config.ts`):

- Four projects, one per protocol viewport: `mobile` 390x844, `tablet`
  768x1024, `laptop` 1280x800, `desktop` 1920x1080.
- Playwright starts the Vite dev server on http://localhost:4173 and the
  multiplayer relay (`../multiplayer/server.mjs`) on ws://localhost:8899; both
  are reused when already running. `E2E_PREVIEW=1` runs the production bundle
  (`npm run build && npm run preview`) instead of the dev server.
- Sessions are created through the real UI (`e2e/helpers/session.ts`:
  SignInPage -> Create your profile -> role); no localStorage injection.
- The suite measures the on-device path: `createProfile` aborts every `/api`
  request for the browser context, so a gateway that happens to listen on the
  proxy port of the same machine cannot switch the app to its live path
  mid-run (the specs assume deterministic client replies and results).
- Specs: `routes` (every route renders with no console errors and no
  horizontal overflow), `a11y` (axe-core; serious/critical fail, the rest are
  logged), `buttons` (click every enabled button on every route),
  `encounter` (start -> interview -> exam -> lab + imaging orders -> results
  -> treatment -> diagnosis -> feedback), `rooms` (create, join by code from
  a second browser context, role switch), `authoring`, `atlas`, `stress`
  (25 rapid orders + 50 rapid questions in one encounter), `screenshots`
  (every route at desktop + mobile into `e2e/__screenshots__/`).
- Browser: Chromium. In the sandbox the preinstalled build under
  `PLAYWRIGHT_BROWSERS_PATH` is used via `launchOptions.executablePath`
  (never run `playwright install` there); CI installs the matching revision
  with `npx playwright install --with-deps chromium`.

## Stack

- **Vite 6** + `@vitejs/plugin-react` + **TypeScript** (React 18)
- **Tailwind v4** via `@tailwindcss/vite` (CSS-first: `@import "tailwindcss"` +
  `@theme` tokens in `src/index.css`; dark theme via the `.dark` class)
- **react-router-dom v6** for routing
- **i18next** + **react-i18next** + browser language detector (EN default, TR)
- **@phosphor-icons/react** for icons (one weight)
- **motion** (`motion/react`) for restrained, reduced-motion-aware animation
- **Radix** primitives: Tabs, Tooltip, Switch, Dialog
- `clsx` + `tailwind-merge` via a `cn()` helper
- Fonts self-hosted with `@fontsource-variable/geist` and
  `@fontsource/geist-mono` (no CDN)

## Design language (medkit)

Clean clinical white base, a single locked blue accent CTA
(`--brand-600 #2563EB`), and a sparse teal to pink gradient
(`#2DD4BF -> #3B82F6 -> #F472B6`) reserved for the app frame and the logo mark.
The one dark element is the vitals monitor, which stays dark in both themes.
Clinical semantic states are always shown as icon plus text label, never color
alone (WCAG 1.4.1). Light theme is the default; dark theme via `.dark` and
`prefers-color-scheme`.

## Structure

```
src/
  main.tsx              App entry: i18n + ThemeProvider + Router
  App.tsx               Routes: / (Home), /encounter, /feedback
  index.css             Tailwind import, fonts, design tokens, @theme mapping
  lib/
    cn.ts               clsx + tailwind-merge helper
    theme.tsx           ThemeProvider (light default, persisted, system-aware)
  i18n/
    index.ts            i18next init (EN/TR, detector, persist, <html lang>)
    locales/en.json     UI strings (English)
    locales/tr.json     UI strings (Turkish)
  components/
    ui/                 Button, Card, Badge, Tabs, Tooltip, Switch, Skeleton, Stat
    shell/              AppFrame, TopNav, PageContainer, Wordmark,
                        LanguageSwitcher, ThemeToggle
  data/
    mock.ts             Bilingual, typed mock domain data (chest-pain case,
                        transcript, vitals series, cited guidance, feedback)
```

The `@/` path alias maps to `src/`.
