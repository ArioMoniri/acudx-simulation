import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveStudyImage } from "@/lib/openMedicalImages";

/**
 * The runtime image path is bundle-only (docs/architecture/14, section 1): a
 * study resolves to a curated, individually verified image or to nothing. No
 * network search may run from the viewer.
 */
describe("openMedicalImages: bundle only", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("resolves a curated study synchronously with licence, attribution and source page", () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const img = resolveStudyImage("normal 12-lead ECG", "ECG", "en");
    expect(img).not.toBeNull();
    expect(img?.curated).toBe(true);
    expect(img?.license).toBeTruthy();
    expect(img?.attribution).toBeTruthy();
    expect(img?.pageUrl).toMatch(/^https:\/\//);
    expect(img?.url).toMatch(/imaging\//);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null instead of guessing when the bundle has no verified image", () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    expect(resolveStudyImage("left pneumothorax on a knee MRI", "MRI", "en")).toBeNull();
    expect(resolveStudyImage("", undefined, "tr")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves the caption in the active language", () => {
    const tr = resolveStudyImage("normal 12-lead ECG", "ECG", "tr");
    const en = resolveStudyImage("normal 12-lead ECG", "ECG", "en");
    expect(tr?.curatedCaption).not.toBe(en?.curatedCaption);
  });
});
