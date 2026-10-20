# AcuDx brand files

The AcuDx mark is the **pulse seal**: a rounded tile split in two by one acute (60 degree) deflection of a monitor trace. The trace is real negative space, so the mark is two solid pieces and the ground shows through the channel. Round two of the brand work (round one was a monoline A on a trace; superseded). Full rationale, construction and test results: `docs/design/02-brand-identity.md`.

Everything here is generated from `docs/design/brand-src/`: `build_brand.py` (SVG), `make_lottie.py` (animation) and `render_kit.sh` (PNG, ICO, video copies). Edit the generators, not the files.

## Files

| File | Use |
|---|---|
| `acudx-mark.svg` | Symbol, brand blue, for light backgrounds. The master (tile 12 to 244, rx 58, channel 28). |
| `acudx-mark-dark.svg` | Symbol, lightened blue, for dark backgrounds. |
| `acudx-mark-mono.svg` / `acudx-mark-mono-white.svg` | One colour black / white. |
| `acudx-mark-small.svg` | Small-size cut (channel 38, apex lower). Use at or below 32 px. Source of `favicon.*`. |
| `acudx-wordmark.svg` (+ `-dark`, `-mono`, `-mono-white`) | "AcuDx" outlined from Manrope ExtraBold. "Dx" in brand blue. |
| `acudx-lockup-horizontal.svg` (+ `-dark`, `-mono`, `-mono-white`) | Symbol + wordmark. The primary logo. |
| `acudx-lockup-stacked.svg` (+ `-dark`) | Symbol over wordmark, for square avatars and social profiles. |
| `acudx-app-icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | The seal itself, edge to edge, filled with the gradient (the one sanctioned gradient surface); the channel is white. |
| `favicon.svg`, `favicon.ico` | Browser tab, from the small cut. The SVG switches to the lightened blue under `prefers-color-scheme: dark`. |
| `og-image.svg`, `og-image.png` | 1200 x 630 social preview. |
| `site.webmanifest` | PWA manifest referenced from `web/index.html`. |
| `acudx-mark.lottie.json` | The seal drawing in (1.4 s, 60 fps, 3.8 KB): each piece's outline traces the deflection first, then the fill settles. Played by `web/src/components/shell/BrandLottie.tsx` and the launch film. |
| `concepts/` | Design process. `concepts/round2/` holds the round two concept sheet, the five-way test sheet (round one A beside four new builds), the final test sheet and the concept sources. The top level keeps round one. |

In the app, use `<Wordmark />` (lockup) or `<AcuDxMark />` (symbol in `currentColor`) from `@/components/shell`; do not load the SVG files by path inside React.

## Colour tokens

| Token | Light | Dark | Where |
|---|---|---|---|
| Mark and "Dx" | `--brand-600` `#2563eb` | `--axis-clinical` `#60a5fa` | the two pieces of the seal, "Dx" |
| "Acu" | `--fg` `#0f172a` | `--fg` `#e2e8f0` | wordmark |
| Tile gradient | `#2dd4bf` to `#3b82f6` to `#f472b6` at 135 degrees | same | app icon only |
| One colour | `#000000` / `#ffffff` | | print, engraving, embroidery |

Approved pairs: brand blue on white or `--bg-subtle`; lightened blue on `--bg` dark; the gradient seal on white (app icon); black on white; white on black. The channel is never painted: it is whatever the mark sits on.

## Clear space and minimum size

- **Clear space** = the channel width of the mark (28 units on the 256 canvas, about 1/8 of the tile) on all sides of any lockup. It scales with the logo.
- **Minimum size**: symbol 16 px (use `acudx-mark-small.svg` at or below 32 px); horizontal lockup 96 px wide on screen, 24 mm in print.
- In the horizontal lockup the tile is 1.16 x the cap height, centred on the cap height, with a gap of 0.2 cap from the tile's edge to the A. Do not re-align the parts.

## Do not

Stretch, rotate, outline, add shadows or glows, recolour outside the table, paint the channel, put the gradient anywhere except the app icon, replace the wordmark with live text in another font, use the mark as the "A" of "AcuDx" (the lockup always shows the full name), or put the seal inside another tile (it is its own container).

## Production notes

- The masters are filled outlines (no strokes, no masks, no fake white cut-outs), so they cut, engrave and embroider as they are. The two pieces are separate paths named `upper` and `lower`.
- Manrope is SIL OFL 1.1; the wordmark is outlined, so the font is not needed to display it.
- No trademark clearance has been done. Run a trademark search and a reverse image search before public launch (see the risk note in `docs/design/02-brand-identity.md`).
