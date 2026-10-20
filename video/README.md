# AcuDx videos (Remotion)

Two families of film, both built with Remotion 4.0.537 (pinned):

1. **The walkthrough (v2)**: a product walkthrough cut from a real screen recording of the running app, with a smooth cursor, zoom-to-focus on every click, lower-third captions and chapter markers. Sections below: "Walkthrough".
2. **The launch film (v1)**: the original film built from still captures. Sections from "Outputs (launch film)" on.

## Walkthrough

### Outputs

| File | Spec | Content |
|---|---|---|
| `out/walkthrough.mp4` | 1920 x 1080, 30 fps, 94 s, H.264 CRF 32 (6.7 MB), no audio | 3 s Lottie mark, 14 chapters (profile, case, chart review, interview, exam, orders, results, guidance, treat, diagnose, feedback, dean, admin, atlas), 4 s end card with the lockup and repository URL |
| `out/teaser-v2.mp4` | 1920 x 1080, 30 fps, 15 s (1.2 MB) | mark, four beats (interview, orders, results with ECG, calibration), end card |
| `out/square.mp4` | 1080 x 1080, 30 fps, 30.7 s (1.6 MB) | social cut: nine beats with large captions above the frame |
| `out/poster-v2.png` | 1920 x 1080 | dark lockup, promise, play affordance and one real frame (Results with the ECG) |


### How it is made

1. **Record** (`scripts/record-walkthrough.mjs`, `npm run record`). playwright-core drives the real web app at 1920 x 1080 with `recordVideo`, on the offline path (every `/api/**` request is aborted, like `web/e2e/helpers/session.ts` `offlineGateway`). The flow: create a profile, generate an Infectious case until the generator serves cough and fever, chart review, four typed interview questions, two exam manoeuvres, six orders (CBC, CRP, lactate, blood cultures, chest X-ray, ECG), wait for every result on its real timer, Results with provenance and the ECG, Guidance with attending tips and citation chips, paracetamol through the dose form, commit community-acquired pneumonia, debrief and the calibration plot, then switch the local profile to admin and open the dean panel, the admin token gate and the 3D atlas. Headless Chromium paints no pointer, so an init script draws a cursor that follows `mousemove`; each move is an eased, slightly curved path animated in the page on `requestAnimationFrame`, then one real `mousemove` lands it. Every step is logged to `public/recording/walkthrough.json` (seconds since recording start, chapter, action, label, the element's bounding box, the box to frame and the wanted zoom). Waits (route chunks, result timers, generator redraws, the 3D load) are logged as skip spans. `--debug` also writes one cursor-free still per chapter to `out/record-debug/`.
2. **Prepare** (`bash scripts/encode-media.sh prepare`, run by `npm run record`): the VP8 webm becomes a near-lossless H.264 with a keyframe every 10 frames, so `OffthreadVideo` seeks fast. The webm and mp4 are not committed (about 40 MB and 190 MB); the JSON timeline is.
3. **Cut** (`src/walkthrough/timeline.ts`): skip spans are dropped, idle gaps over 2.6 s are trimmed to 1.7 s after the last action and 0.7 s before the next, and each chapter is sped up (at most 2.2x) to fit its budget in `src/Walkthrough.tsx`.
4. **Camera**: every logged click, type, select or focus with a zoom above 1 becomes a shot that frames its box (the requested scale, reduced until the box fits with a margin, centre clamped inside the frame). Shots closer than 2.4 s chain into a pan; otherwise the camera holds 1.1 s and eases back to the full frame. Transitions use a critically damped spring, with scale interpolated in log space.
5. **Render** (`npm run render:v2`): Walkthrough, Teaser, Square and PosterV2, then `scripts/encode-media.sh final` re-encodes at CRF 30 to 32 after a light temporal denoise (hqdn3d, adaptive quantisation). The README hero and feature images are not cut from the film; they are plain captures of the running app (`scripts/design/capture-readme.mjs`, `scripts/design/readme-media.py`).
6. **README images**: moved out of the film pipeline. `node scripts/design/capture-readme.mjs` and `python3 scripts/design/readme-media.py` (repository root) capture the renewed UI directly, uncropped, palette-quantised under 350 KB each, into `docs/media/readme/`.

Captions are English, short and factual, and say what the offline path really shows (for example, the ECG is a labelled representative image with its licence, and an unverified guideline source shows as unavailable).

## Outputs (launch film)

The launch film, the ten-second teaser and the 1200 x 630 poster. Motion follows `docs/design/00-design-system.md`: one easing (`cubic-bezier(0.16, 1, 0.3, 1)`), brief durations, `fade-up` as the only entrance, brand blue as the only accent, Manrope display over Inter body, Geist Mono for the URL. Every screen in the film is a real capture of the running app; nothing is drawn to look like the product.

### Files

| File | Spec | Content |
|---|---|---|
| `out/launch.mp4` | 1920 x 1080, 30 fps, 51 s, H.264, no audio track | mark draws in, promise (EN and TR), four EHR captures with slow pan and zoom, five feature cards, open-source and sovereign line, end card with the repository URL |
| `out/teaser.mp4` | 1920 x 1080, 30 fps, 10 s, H.264, no audio track | mark, promise, one EHR capture, end card |
| `out/poster.png` | 1200 x 630 | lockup, promise, EHR capture; also the `<video poster>` on the landing page |

The web app serves copies at `web/public/media/teaser.mp4` and `web/public/media/launch-poster.png` (`web/src/components/landing/LaunchTeaser.tsx`). After a re-render, copy them again.

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

# walkthrough (needs the dev server: npm --prefix web run dev -- --port 4197)
npm run record          # public/recording/walkthrough.{webm,json,mp4}
npm run render:v2       # out/walkthrough.mp4, teaser-v2.mp4, square.mp4, poster-v2.png
```

The scripts pass `--browser-executable /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`. Remotion needs the headless shell (or any Chrome that still has the old headless mode); the full Chromium binary refuses with "Old Headless mode has been removed". On a machine without that path, drop the flag and Remotion downloads its own headless shell.

`npm run studio` opens the Remotion Studio for scrubbing.

## Fonts

`public/fonts/` holds the same Manrope, Inter and Geist Mono files the web app ships through `@fontsource` (SIL OFL 1.1). `src/fonts.ts` loads them with `@remotion/fonts`, so a render never reaches a CDN.
