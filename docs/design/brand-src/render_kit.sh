#!/bin/sh
# Rasterise the AcuDx brand kit (PNG icons, favicon.ico, OG image) from the SVG masters.
#
# Uses the logo-design skill's render_png.py, which needs any SVG renderer: cairosvg,
# rsvg-convert, Inkscape or a headless Chromium. In the cloud sandbox the Playwright
# headless shell is used: put a `chromium` wrapper on PATH that execs
#   /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell --no-sandbox "$@"
#
# usage: sh docs/design/brand-src/render_kit.sh [path/to/logo-design/scripts]
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
BRAND="$ROOT/web/public/brand"
SCRIPTS=${1:-$ROOT/.claude/skills/logo-design/scripts}
R="python3 $SCRIPTS/render_png.py"

python3 "$HERE/build_brand.py"
python3 "$HERE/make_lottie.py"

$R "$BRAND/acudx-app-icon.svg" -o "$BRAND/icon-512.png" --size 512
$R "$BRAND/acudx-app-icon.svg" -o "$BRAND/icon-192.png" --size 192
$R "$BRAND/acudx-app-icon.svg" -o "$BRAND/apple-touch-icon.png" --size 180
$R "$BRAND/favicon.svg" --ico "$BRAND/favicon.ico" --ico-sizes 16 32 48
$R "$BRAND/og-image.svg" -o "$BRAND/og-image.png" --width 1200 --height 630

# The launch film and poster read the same files (video/public/brand).
for f in acudx-mark.svg acudx-mark-dark.svg acudx-lockup-horizontal.svg acudx-lockup-horizontal-dark.svg acudx-app-icon.svg acudx-mark.lottie.json; do
  cp "$BRAND/$f" "$ROOT/video/public/brand/$f"
done
echo "kit rendered into $BRAND"
