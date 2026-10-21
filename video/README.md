# AcuDx videos (Remotion)

Two families of film, both built with Remotion 4.0.537 (pinned):

1. **The launch walkthrough (v3)**: cut from a real screen recording of the running app (renewed UI, the rebuilt chat) on a model-generated case, with a smooth cursor, zoom-to-focus on every click, lower-third captions, chapter markers and a spliced chapter of the real live patient video call. Sections below: "Walkthrough".
2. **The v1 film** (retired): the original film built from still captures. Sections from "The v1 film" on.

## Walkthrough

### Outputs

| File | Spec | Content |
|---|---|---|
| `out/launch.mp4` | 1920 x 1080, 30 fps, 128.4 s, H.264 CRF 32 (9.4 MB), no audio | 3 s Lottie mark, 18 chapters (profile, request, generate, chart, interview, video call, exam, chat order, orders, treat, Director, results, guidance, diagnose, feedback, admin, dean, rooms), 4 s end card with the lockup and repository URL |
| `out/teaser.mp4` | 1920 x 1080, 30 fps, 15 s (1.0 MB) | mark, four beats (staged generation, an order placed from the chat, the live video call, results called in on the chat), end card |
| `out/poster.png` | 1920 x 1080 (0.2 MB, palette-quantised) | dark lockup, promise, play affordance and one real frame (the bedside monitor while the Director steps the patient) |
| `../docs/media/readme/walkthrough.webp` | 960 x 540, 10 fps, 12.2 s, animated WebP (1.2 MB) | the teaser without its mark and end card, for the README |

`web/public/media/teaser.mp4` and `web/public/media/launch-poster.png` are copies of `teaser.mp4` and `poster.png` (the landing page film). The v2 files (`walkthrough.mp4`, `teaser-v2.mp4`, `square.mp4`, `poster-v2.png`) are retired; the `Square` composition is kept but not rendered.

### The case and the gateway

The walkthrough shows a model-generated case, never a template, seed, curated or offline-generator case. Claude is the default model, but this recording has no `ANTHROPIC_KEY` and no GPU worker, so nothing in it is live model output except the recorded case. The recorder intercepts `POST /api/v2/case/generate/stream` and answers it with the recorded live model output the e2e suite replays (`web/e2e/helpers/liveCase.ts` `LIVE_CASES`, `server/tests/fixtures/live`, Qwen3-14B, acceptance run of 2026-10-20): the sepsis case "fever and rigors". `scripts/staged-replay.mjs` streams it as the staged generator does (start, opening deltas, kernel, `opening.ready`, one `layer.pending` / `layer.ready` per layer, `done`); Playwright's `route.fulfill` cannot stream, so an init script answers that one fetch with a streamed Response. `scripts/seed-thread.py` stores the same thread in the local gateway's CaseStore (through the server's own `CaseStore`, which accepts only `source == "model"`), so every other `/api` call is the real gateway: the interview route (it answers 503 without a model, so the client falls back to the recorded case's own history through the offline path, and no model-written chips appear), the results engine, `POST /v2/director/step` (course engine and the deterministic narrator line), telemetry, dean analytics and the room's case. The recorded case's meta is shown as recorded, including its council note ("council veto, safety overrides applied", degraded). Captions say so. The live Claude acceptance (case, interview with chips, debrief) is in `docs/review/10-live-claude-acceptance.md`.

Run it with a local gateway and the dev server proxied to it:

```
# gateway (repository root): ADMIN_TOKEN, a Fernet ACUDX_SECRET_KEY and a scratch ACUDX_DB_PATH
ADMIN_TOKEN=walkthrough-admin ACUDX_SECRET_KEY=<fernet key> ACUDX_DB_PATH=/tmp/acudx-rec/acudx.db \
  python -m uvicorn server.app:app --host 127.0.0.1 --port 8931
API_PROXY_TARGET=http://127.0.0.1:8931 npm --prefix web run dev -- --port 4205 --strictPort --host 127.0.0.1
cd video && BASE_URL=http://127.0.0.1:4205 GATEWAY_DB=/tmp/acudx-rec/acudx.db ADMIN_TOKEN=walkthrough-admin GATEWAY_PYTHON=../.venv/bin/python npm run record
```

### The live video call chapter

The "Video call" chapter is not part of the screen recording: the recording runs without a GPU worker. `scripts/encode-media.sh prepare` cuts two spans of the real live capture in `docs/media/live-avatar/en` (LiveTalking + MuseTalk 1.5 on the GPU worker, Kokoro voice, measured in `metrics.json`): `call-page.mp4`, the call tile and its caption on that encounter page while the patient answers (cropped to the tile: the rest of that capture shows the chat before the rebuild), and `call-face.mp4`, the lip-synced stream. `Stage.tsx` `LiveCallInsert` plays them side by side for 8 s (4 s in the teaser) with the caption "Live patient video, lip-synced on the GPU worker"; `timeline.ts` `spliceInsert` puts the insert in the chapter's place and shifts the rest of the cut.

### How it is made

1. **Record** (`scripts/record-walkthrough.mjs`, `npm run record`). playwright-core drives the real web app at 1920 x 1080 with `recordVideo`. The flow: create a profile, ask for a fever case on the Start page, watch the opening stream in and the layers being written, the banner, three typed questions (each waits for its reply), the patient call tile (replaced by the live capture in the cut), one exam manoeuvre from the Suggestions drawer, `/order lactate` typed into the composer and confirmed inside the chip, four orders from the worklist (the tracker shows each turnaround), IV fluids, oxygen and ceftriaxone through the dose form, a vitals recheck (a Director step), the bedside monitor and trends, Results pending, "Advance to next result" until all but the culture are back, the nurse's result lines in the chat and their Open Results button, the ECG, Guidance, commit sepsis, the debrief dialog, the report's cited process section and calibration plot, the admin console (role switch, token, Telemetry), the dean panel, and a team room created from the Rooms page. Headless Chromium paints no pointer, so an init script draws a cursor that follows `mousemove`. Every step is logged to `public/recording/walkthrough.json`; waits are logged as skip spans. `--debug` also writes one cursor-free still per chapter to `out/record-debug/`.
2. **Prepare** (`bash scripts/encode-media.sh prepare`, run by `npm run record`): the VP8 webm becomes a near-lossless H.264 with a keyframe every 10 frames, and the two live call spans are cut. None of these is committed (the recording mp4 is about 170 MB); the JSON timeline is.
3. **Cut** (`src/walkthrough/timeline.ts`): skip spans are dropped, idle gaps over 2.6 s are trimmed, each chapter is sped up (at most 2.2x) to fit its budget in `src/Walkthrough.tsx`, and the call insert is spliced in.
4. **Camera**: every logged click, type, select or focus with a zoom above 1 becomes a shot that frames its box; close shots chain into a pan. Transitions use a critically damped spring.
5. **Render** (`npm run render:v3`): Walkthrough to `out/launch.raw.mp4`, Teaser to `out/teaser.raw.mp4`, PosterV2 to `out/poster.png`, then `scripts/encode-media.sh final` re-encodes at CRF 32 and 30 after a light temporal denoise. Delete `out/*.raw.mp4` and `node_modules/.cache` afterwards (several hundred MB). The README WebP: `ffmpeg -ss 1.4 -t 12.2 -i out/teaser.mp4 -vf "fps=10,scale=960:-1:flags=lanczos" -c:v libwebp_anim -q:v 60 -loop 0 ../docs/media/readme/walkthrough.webp`.
6. **README images**: `node scripts/design/capture-readme.mjs` (same replay and gateway, `GATEWAY_DB`, `ADMIN_TOKEN` and `PORT` set; `SCHEME=dark` for the dark landing shot) and `python3 scripts/design/readme-media.py` (repository root) capture the UI directly at 1440 x 900, uncropped, without cursor or captions, palette-quantised under 350 KB each, into `docs/media/readme/`; the video call card is a frame of `docs/media/live-avatar/en/patient-live.mp4`.

Captions are English, short and factual, and say what the run really shows.

## The v1 film (retired)


The launch film, the ten-second teaser and the 1200 x 630 poster. Motion follows `docs/design/00-design-system.md`: one easing (`cubic-bezier(0.16, 1, 0.3, 1)`), brief durations, `fade-up` as the only entrance, brand blue as the only accent, Manrope display over Inter body, Geist Mono for the URL. Every screen in the film is a real capture of the running app; nothing is drawn to look like the product.

### Files

| File | Spec | Content |
|---|---|---|
| `out/launch-v1.mp4` (retired, not committed; `npm run render:v1`) | 1920 x 1080, 30 fps, 51 s, H.264, no audio track | mark draws in, promise (EN and TR), four EHR captures with slow pan and zoom, five feature cards, open-source and sovereign line, end card with the repository URL |
| `out/teaser-v1.mp4` (retired, not committed; `npm run render:launch-teaser`) | 1920 x 1080, 30 fps, 10 s, H.264, no audio track | mark, promise, one EHR capture, end card |
| `out/poster-v1.png` (retired, not committed; `npm run render:poster`) | 1200 x 630 | lockup, promise, EHR capture |

The landing page (`web/src/components/landing/LaunchTeaser.tsx`) no longer plays this teaser: `web/public/media/teaser.mp4` and `launch-poster.png` are copies of the v3 `teaser.mp4` and `poster.png` (see "Walkthrough"). After a re-render, copy them again.

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
npm run render:v1               # out/launch-v1.mp4 (retired film)
npm run render:launch-teaser    # out/teaser-v1.mp4 (composition LaunchTeaser)
npm run render:poster           # out/poster-v1.png
npm run render:all              # the v3 family (same as render:v3)

# walkthrough (needs the gateway and dev server above, GATEWAY_DB and ADMIN_TOKEN)
npm run record          # public/recording/walkthrough.{webm,json,mp4}, call-page.mp4, call-face.mp4
npm run render:v3       # out/launch.mp4, teaser.mp4, poster.png
```

The scripts pass `--browser-executable /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`. Remotion needs the headless shell (or any Chrome that still has the old headless mode); the full Chromium binary refuses with "Old Headless mode has been removed". On a machine without that path, drop the flag and Remotion downloads its own headless shell.

`npm run studio` opens the Remotion Studio for scrubbing.

## Fonts

`public/fonts/` holds the same Manrope, Inter and Geist Mono files the web app ships through `@fontsource` (SIL OFL 1.1). `src/fonts.ts` loads them with `@remotion/fonts`, so a render never reaches a CDN.
