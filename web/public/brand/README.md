# AcuDx brand files

The AcuDx mark is **one acute deflection on a calm baseline**: an A (for AcuDx, and for *acute*) drawn as a single 60 degree spike on a monitor trace. The apex is the only sharp join in the whole system; every other end is round. Full rationale and construction: `docs/design/02-brand-identity.md`.

Everything here is generated from `docs/design/brand-src/build_brand.py` (SVG) and `make_lottie.py` (animation). Edit the generator, not the files.

## Files

| File | Use |
|---|---|
| `acudx-mark.svg` | Symbol, brand blue, for light backgrounds. The master. |
| `acudx-mark-dark.svg` | Symbol, lightened blue, for dark backgrounds. |
| `acudx-mark-mono.svg` / `acudx-mark-mono-white.svg` | One colour black / white. |
| `acudx-mark-small.svg` | Small-size cut (stroke 40, wider counter). Use below 32 px. Source of `favicon.*`. |
| `acudx-wordmark.svg` (+ `-dark`, `-mono`, `-mono-white`) | "AcuDx" outlined from Manrope ExtraBold. "Dx" in brand blue. |
| `acudx-lockup-horizontal.svg` (+ `-dark`, `-mono`, `-mono-white`) | Symbol + wordmark. The primary logo. |
| `acudx-app-icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | White mark on the gradient tile (the one sanctioned gradient surface). |
| `favicon.svg`, `favicon.ico` | Browser tab. The SVG switches to the lightened blue under `prefers-color-scheme: dark`. |
| `og-image.svg`, `og-image.png` | 1200 x 630 social preview. |
| `site.webmanifest` | PWA manifest referenced from `web/index.html`. |
| `acudx-mark.lottie.json` | The mark drawing in (1.5 s, 60 fps, 1.9 KB). Played by `web/src/components/shell/BrandLottie.tsx`. |
| `concepts/` | Design process: concept sheet, round 1 and final test sheets, concept sources. |

In the app, use `<Wordmark />` (lockup) or `<AcuDxMark />` (symbol in `currentColor`) from `@/components/shell`; do not load the SVG files by path inside React.

## Colour tokens

| Token | Light | Dark | Where |
|---|---|---|---|
| Mark and "Dx" | `--brand-600` `#2563eb` | `--axis-clinical` `#60a5fa` | symbol stroke, "Dx" |
| "Acu" | `--fg` `#0f172a` | `--fg` `#e2e8f0` | wordmark |
| Tile gradient | `#2dd4bf` to `#3b82f6` to `#f472b6` at 135 degrees | same | app icon only |
| One colour | `#000000` / `#ffffff` | | print, engraving, embroidery |

Approved pairs: brand blue on white or `--bg-subtle`; lightened blue on `--bg` dark; white on the gradient tile; black on white; white on black. Nothing else.

## Clear space and minimum size

- **Clear space** = the stroke width of the mark (1/8 of the symbol height; 32 units on the 256 canvas) on all sides of any lockup. It scales with the logo.
- **Minimum size**: symbol 16 px (use `acudx-mark-small.svg` at or below 32 px); horizontal lockup 96 px wide on screen, 24 mm in print.
- The symbol sits on the wordmark's cap height, not its baseline: the trace runs through the wordmark's x-height centre. Do not re-align the parts.

## Do not

Stretch, rotate, outline, add shadows or glows, recolour outside the table, put the gradient anywhere except the app-icon tile, replace the wordmark with live text in another font, or use the mark as the "A" of "AcuDx" (the lockup always shows the full name).

## Production notes

- The masters use strokes (round caps, mitred apex, miter limit 4). They scale correctly in every browser and vector tool; for cutting or embroidery run *Expand Stroke* in a vector editor first.
- Manrope is SIL OFL 1.1; the wordmark is outlined, so the font is not needed to display it.
- No trademark clearance has been done. Run a trademark search and a reverse image search before public launch.
