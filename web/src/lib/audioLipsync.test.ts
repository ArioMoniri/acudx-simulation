import { describe, it, expect } from "vitest";
import {
  amplitudeToViseme,
  envelopeToJaw,
  framesFromRms,
  overlayGeometry,
  rmsFromTimeDomain,
} from "@/lib/audioLipsync";

describe("rmsFromTimeDomain", () => {
  it("is 0 for silence (all 128) and grows with amplitude", () => {
    expect(rmsFromTimeDomain(new Uint8Array(64).fill(128))).toBe(0);
    const quiet = new Uint8Array(64).map((_, i) => (i % 2 ? 140 : 116));
    const loud = new Uint8Array(64).map((_, i) => (i % 2 ? 250 : 6));
    expect(rmsFromTimeDomain(quiet)).toBeCloseTo(12 / 128, 5);
    expect(rmsFromTimeDomain(loud)).toBeGreaterThan(0.9);
    expect(rmsFromTimeDomain([])).toBe(0);
  });
});

describe("envelopeToJaw", () => {
  it("ignores the noise floor and saturates at the ceiling", () => {
    expect(envelopeToJaw(0.01, 0)).toBe(0);
    let jaw = 0;
    for (let i = 0; i < 20; i++) jaw = envelopeToJaw(0.5, jaw);
    expect(jaw).toBeCloseTo(1, 2);
  });
  it("attacks faster than it releases", () => {
    const up = envelopeToJaw(0.22, 0);
    const down = envelopeToJaw(0, 1);
    expect(up).toBeGreaterThan(0.6);
    expect(1 - down).toBeLessThan(0.4);
  });
  it("is deterministic", () => {
    expect(envelopeToJaw(0.1, 0.3)).toBe(envelopeToJaw(0.1, 0.3));
  });
});

describe("amplitudeToViseme", () => {
  it("maps closed, quiet, mid and wide openings to the renderer's shapes", () => {
    expect(amplitudeToViseme(0, 0)).toBe("rest");
    expect(["cons", "mbp"]).toContain(amplitudeToViseme(0.1, 0));
    expect(["e", "i"]).toContain(amplitudeToViseme(0.3, 0));
    expect(["o", "aa"]).toContain(amplitudeToViseme(0.5, 0));
    expect(amplitudeToViseme(0.9, 1)).toBe("aa");
  });
  it("alternates shapes over ticks so quiet speech still articulates", () => {
    const shapes = new Set([0, 1, 2, 3].map((tick) => amplitudeToViseme(0.1, tick)));
    expect(shapes.size).toBe(2);
  });
});

describe("framesFromRms", () => {
  it("rests at the end of a clip and opens during speech", () => {
    const readings = [0, 0, 0.2, 0.25, 0.3, 0.2, 0.05, ...new Array(24).fill(0)];
    const frames = framesFromRms(readings);
    expect(frames[0].shape).toBe("rest");
    expect(Math.max(...frames.map((f) => f.jaw))).toBeGreaterThan(0.7);
    expect(frames[frames.length - 1].jaw).toBe(0);
    expect(frames[frames.length - 1].shape).toBe("rest");
  });
});

describe("overlayGeometry", () => {
  it("scales the mouth with loudness within a shape", () => {
    const soft = overlayGeometry({ jaw: 0.2, shape: "aa" });
    const loud = overlayGeometry({ jaw: 0.9, shape: "aa" });
    expect(loud.height).toBeGreaterThan(soft.height);
    expect(overlayGeometry({ jaw: 0.3, shape: "u" }).round).toBe(1);
    expect(overlayGeometry({ jaw: 0, shape: "rest" }).height).toBeLessThan(0.1);
  });
});
