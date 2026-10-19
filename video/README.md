# AcuDx launch video (Remotion)

The launch film, the ten-second teaser and the 1200 x 630 poster, built with Remotion 4.0.537 (pinned). Motion follows `docs/design/00-design-system.md`: one easing (`cubic-bezier(0.16, 1, 0.3, 1)`), brief durations, `fade-up` as the only entrance, brand blue as the only accent, Manrope display over Inter body, Geist Mono for the URL. Every screen in the film is a real capture of the running app; nothing is drawn to look like the product.

## Outputs

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
npm run render:teaser   # out/teaser.mp4
npm run render:poster   # out/poster.png
npm run render:all
```

The scripts pass `--browser-executable /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`. Remotion needs the headless shell (or any Chrome that still has the old headless mode); the full Chromium binary refuses with "Old Headless mode has been removed". On a machine without that path, drop the flag and Remotion downloads its own headless shell.

`npm run studio` opens the Remotion Studio for scrubbing.

## Fonts

`public/fonts/` holds the same Manrope, Inter and Geist Mono files the web app ships through `@fontsource` (SIL OFL 1.1). `src/fonts.ts` loads them with `@remotion/fonts`, so a render never reaches a CDN.
