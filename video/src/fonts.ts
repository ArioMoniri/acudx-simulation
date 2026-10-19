import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

/**
 * Self-hosted fonts (SIL OFL): the same Manrope, Inter and Geist Mono files
 * the web app ships through @fontsource. No CDN fetch during a render.
 * `loadFont` delays the render until each face is ready.
 */
const faces = [
  { family: "Manrope", url: "fonts/manrope-latin-wght-normal.woff2", weight: "200 800" },
  { family: "Manrope", url: "fonts/manrope-latin-ext-wght-normal.woff2", weight: "200 800" },
  { family: "Inter", url: "fonts/inter-latin-wght-normal.woff2", weight: "100 900" },
  { family: "Inter", url: "fonts/inter-latin-ext-wght-normal.woff2", weight: "100 900" },
  { family: "Geist Mono", url: "fonts/geist-mono-latin-400-normal.woff2", weight: "400" },
];

export const fontsReady: Promise<void> = Promise.all(
  faces.map((f) =>
    loadFont({
      family: f.family,
      url: staticFile(f.url),
      weight: f.weight,
      format: "woff2",
    }),
  ),
).then(() => undefined);
