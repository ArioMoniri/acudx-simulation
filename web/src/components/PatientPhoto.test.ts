import { describe, expect, it } from "vitest";
import { PHOTO_THUMBNAIL_MAX, photoAllowsOverlays } from "./PatientPhoto";

// Owner report 2026-10-21: the clinical-signs caption rendered over the 64 px
// patient thumbnail in the dark flowsheet card and clipped mid-word. Overlays
// are gated on the measured width, so every thumbnail size must refuse them.
describe("PatientPhoto overlay gate", () => {
  it("draws no overlay on any thumbnail below 160 px", () => {
    expect(PHOTO_THUMBNAIL_MAX).toBe(160);
    for (const w of [0, 24, 32, 40, 48, 56, 64, 80, 96, 120, 159]) {
      expect(photoAllowsOverlays(w), `${w}px`).toBe(false);
    }
  });

  it("allows overlays on the enlarged viewer and the call tile", () => {
    for (const w of [160, 200, 320, 480]) {
      expect(photoAllowsOverlays(w), `${w}px`).toBe(true);
    }
  });
});
