# AcuDx videos (Remotion)

Two families of film, both built with Remotion 4.0.537 (pinned):

1. **The walkthrough (v2)**: a product walkthrough cut from a real screen recording of the running app on a model-generated case, with a smooth cursor, zoom-to-focus on every click, lower-third captions, chapter markers and a spliced chapter of the real live patient video call. Sections below: "Walkthrough".
2. **The launch film (v1)**: the original film built from still captures. Sections from "Outputs (launch film)" on.

## Walkthrough

### Outputs

| File | Spec | Content |
|---|---|---|
| `out/walkthrough.mp4` | 1920 x 1080, 30 fps, 111.2 s, H.264 CRF 32 (8.5 MB), no audio | 3 s Lottie mark, 16 chapters (profile, request, generate, chart, interview, video call, exam, orders, treat, Director, results, guidance, diagnose, feedback, admin, dean), 4 s end card with the lockup and repository URL |
| `out/teaser-v2.mp4` | 1920 x 1080, 30 fps, 15 s (1.2 MB) | mark, four beats (staged generation, the live video call, the Director on the monitor, admin telemetry), end card |
| `out/square.mp4` | 1080 x 1080, 30 fps, 32.7 s (1.9 MB) | social cut: eleven beats with large captions above the frame |
| `out/poster-v2.png` | 1920 x 1080 (0.6 MB) | dark lockup, promise, play affordance and one real frame (the bedside monitor while the Director steps the patient) |

`web/public/media/teaser.mp4` and `web/public/media/launch-poster.png` are copies of `teaser-v2.mp4` and `poster-v2.png` (the landing page film).

### The case and the gateway

The walkthrough shows a model-generated case, never a template, seed, curated or offline-generator case. The recorder intercepts `POST /api/v2/case/generate/stream` and answers it with the recorded live model output the e2e suite replays (`web/e2e/helpers/liveCase.ts` `LIVE_CASES`, `server/tests/fixtures/live`, Qwen3-14B, acceptance run of 2026-10-20): the sepsis case "fever and rigors". `scripts/staged-replay.mjs` streams it as the staged generator does (start, opening deltas, kernel, `opening.ready` with the opening only, one `layer.pending` / `layer.ready` per history, exam, treatment and result layer, `done`); Playwright's `route.fulfill` cannot stream, so an init script answers that one fetch with a streamed Response. `scripts/seed-thread.py` stores the same thread in the local gateway's CaseStore (through the server's own `CaseStore`, which accepts only `source == "model"`), so every other `/api` call is the real gateway: the patient turn, the results engine, `POST /v2/director/step` (the course engine and the deterministic narrator line, since the run has no model endpoint), the telemetry and the dean analytics. The recorded case's meta is shown as recorded, including its council note ("council veto, safety overrides applied", degraded).

Run it with a local gateway and the dev server proxied to it:

```
# gateway (repository root): ADMIN_TOKEN, a Fernet ACUDX_SECRET_KEY and a scratch ACUDX_DB_PATH
ADMIN_TOKEN=walkthrough-admin ACUDX_SECRET_KEY=<fernet key> ACUDX_DB_PATH=/tmp/acudx-rec/acudx.db \
  python -m uvicorn server.app:app --host 127.0.0.1 --port 8931
API_PROXY_TARGET=http://127.0.0.1:8931 npm --prefix web run dev -- --port 4197 --strictPort --host 127.0.0.1
cd video && GATEWAY_DB=/tmp/acudx-rec/acudx.db ADMIN_TOKEN=walkthrough-admin GATEWAY_PYTHON=../.venv/bin/python npm run record
```

### The live video call chapter

The "Video call" chapter is not part of the screen recording: the recording runs without a GPU worker. `scripts/encode-media.sh prepare` cuts two spans of the real live capture in `docs/media/live-avatar` (LiveTalking + MuseTalk 1.5 on the GPU worker, Kokoro voice, measured in `metrics.json`): `call-page.mp4`, the transcript and call tile of that encounter page while the patient answers (cropped below the banner, because that capture's banner names its own case source), and `call-face.mp4`, the lip-synced stream. `Stage.tsx` `LiveCallInsert` plays them as picture in picture for 8 s (4 s in the short cuts) with the caption "Live patient video, lip-synced on the GPU worker"; `timeline.ts` `spliceInsert` puts the insert in the chapter's place and shifts the rest of the cut.

### How it is made

1. **Record** (`scripts/record-walkthrough.mjs`, `npm run record`). playwright-core drives the real web app at 1920 x 1080 with `recordVideo`. The flow: create a profile, ask for a fever case on the Start page, watch the opening stream in and the layers being written, the banner ("model generated"), three typed interview questions, the patient call tile (replaced by the live capture in the cut), one exam manoeuvre, five orders (CBC, lactate, blood cultures, chest X-ray, ECG), IV fluids, oxygen and ceftriaxone through the dose form, the patient's reply, four vitals rechecks (each a Director step), the bedside monitor and trends, every result on its real timer, Results and the ECG, Guidance, commit sepsis, debrief and calibration, then the admin console (role switch, token, Telemetry) and the dean panel. Headless Chromium paints no pointer, so an init script draws a cursor that follows `mousemove`; each move is an eased, slightly curved path animated in the page on `requestAnimationFrame`, then one real `mousemove` lands it. Every step is logged to `public/recording/walkthrough.json` (seconds since recording start, chapter, action, label, the element's bounding box, the box to frame and the wanted zoom). Waits (route chunks, result timers, the remaining layers, console loads) are logged as skip spans. `--debug` also writes one cursor-free still per chapter to `out/record-debug/`.
2. **Prepare** (`bash scripts/encode-media.sh prepare`, run by `npm run record`): the VP8 webm becomes a near-lossless H.264 with a keyframe every 10 frames, so `OffthreadVideo` seeks fast, and the two live call spans are cut. None of these is committed (the recording mp4 is about 200 MB); the JSON timeline is.
3. **Cut** (`src/walkthrough/timeline.ts`): skip spans are dropped, idle gaps over 2.6 s are trimmed to 1.7 s after the last action and 0.7 s before the next, each chapter is sped up (at most 2.2x) to fit its budget in `src/Walkthrough.tsx`, and the call insert is spliced in.
4. **Camera**: every logged click, type, select or focus with a zoom above 1 becomes a shot that frames its box (the requested scale, reduced until the box fits with a margin, centre clamped inside the frame). Shots closer than 2.4 s chain into a pan; otherwise the camera holds 1.1 s and eases back to the full frame. Transitions use a critically damped spring, with scale interpolated in log space.
5. **Render** (`npm run render:v2`): Walkthrough, Teaser, Square and PosterV2, then `scripts/encode-media.sh final` re-encodes at CRF 30 to 32 after a light temporal denoise (hqdn3d, adaptive quantisation). The README hero and feature images are not cut from the film; they are plain captures of the running app.
6. **README images**: `node scripts/design/capture-readme.mjs` (same replay and gateway, `GATEWAY_DB` and `ADMIN_TOKEN` set; `SCHEME=dark` for the dark landing shot) and `python3 scripts/design/readme-media.py` (repository root) capture the renewed UI directly, uncropped, palette-quantised under 350 KB each, into `docs/media/readme/`; the video call card is a frame of `docs/media/live-avatar`.

Captions are English, short and factual, and say what the run really shows (for example, that the local run has no model endpoint, so the telemetry counts its model calls as errors).

## Outputs (launch film)

The launch film, the ten-second teaser and the 1200 x 630 poster. Motion follows `docs/design/00-design-system.md`: one easing (`cubic-bezier(0.16, 1, 0.3, 1)`), brief durations, `fade-up` as the only entrance, brand blue as the only accent, Manrope display over Inter body, Geist Mono for the URL. Every screen in the film is a real capture of the running app; nothing is drawn to look like the product.

### Files

| File | Spec | Content |
|---|---|---|
| `out/launch.mp4` (v1, retired, not committed; regenerate with `npm run render`) | 1920 x 1080, 30 fps, 51 s, H.264, no audio track | mark draws in, promise (EN and TR), four EHR captures with slow pan and zoom, five feature cards, open-source and sovereign line, end card with the repository URL |
| `out/teaser.mp4` (v1, retired, not committed) | 1920 x 1080, 30 fps, 10 s, H.264, no audio track | mark, promise, one EHR capture, end card |
| `out/poster.png` | 1200 x 630 | lockup, promise, EHR capture; also the `<video poster>` on the landing page |

The landing page (`web/src/components/landing/LaunchTeaser.tsx`) no longer plays this teaser: `web/public/media/teaser.mp4` and `launch-poster.png` are copies of the walkthrough family's `teaser-v2.mp4` and `poster-v2.png` (see "Walkthrough"). After a re-render, copy them again.

The film is silent by design: captions are in the frame in both languages, so it plays correctly in a muted timeline and needs no music licence.

## Scenes and timing (30 fps)

| Scene | Frames | Source |
|---|---|---|
| A mark | 0 to 120 | `src/scenes/MarkScene.tsx` plays `public/brand/acudx-mark.lottie.json` (the same file as `BrandLottie` on the landing page) through `@remotion/lottie` |
| B promise | 110 to 330 | `src/scenes/PromiseScene.tsx` |
| C screens | 320 to 880 | `src/scenes/ScreenScene.tsx`, four shots from `public/screens/` |
| D features | 870 to 1230 | `src/scenes/FeatureScene.tsx` |
| E sovereign | 1220 to 1410 | `src/scenes/SovereignScene.tsx` |
| F end card | 1400 to 1560 | `src/scenes/EndScene.tsx` |

Scenes overlap by ten frames so the scene fades cross instead of cutting to white.

## Capturing screens

The captures are taken with Playwright against the dev server, through the real onboarding form and the real Start page (no seeded state):

```
npm --prefix web run dev -- --port 4175
cd video
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run capture
```

`npm run capture -- --landing` also writes the landing page at 390, 768, 1280 and 1920 px to `web/e2e/__screenshots__/landing-*.png` and prints any element that overflows the viewport. `--landing-only` skips the app captures.

The script expects Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (override with `CHROMIUM_PATH`) and matches `playwright-core` 1.56.1, which ships that revision. Do not run `playwright install`.

## Rendering

```
cd video
npm install
npm run render          # out/launch.mp4
npm run render:launch-teaser   # out/teaser.mp4 (composition LaunchTeaser)
npm run render:poster   # out/poster.png
npm run render:all      # launch film plus the walkthrough family

# walkthrough (needs the gateway and dev server above, GATEWAY_DB and ADMIN_TOKEN)
npm run record          # public/recording/walkthrough.{webm,json,mp4}, call-page.mp4, call-face.mp4
npm run render:v2       # out/walkthrough.mp4, teaser-v2.mp4, square.mp4, poster-v2.png
```

The scripts pass `--browser-executable /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`. Remotion needs the headless shell (or any Chrome that still has the old headless mode); the full Chromium binary refuses with "Old Headless mode has been removed". On a machine without that path, drop the flag and Remotion downloads its own headless shell.

`npm run studio` opens the Remotion Studio for scrubbing.

## Fonts

`public/fonts/` holds the same Manrope, Inter and Geist Mono files the web app ships through `@fontsource` (SIL OFL 1.1). `src/fonts.ts` loads them with `@remotion/fonts`, so a render never reaches a CDN.
