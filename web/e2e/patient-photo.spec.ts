import { test, expect, type Page } from "@playwright/test";
import { createProfile, openTab, settle } from "./helpers/session";

/**
 * Patient thumbnails carry the face only (owner report 2026-10-21: the
 * "Clinical signs: ..." caption and a corner icon sat on the 64 px photo in the
 * dark flowsheet card, clipped mid-word). Reduced motion is the case where the
 * signs pill is drawn at all, so the check runs with it on: below 160 px a
 * patient photo holds no text node and no visible corner glyph, and the signs
 * are printed as text beside it instead.
 */
test.use({ reducedMotion: "reduce" });

async function thumbnails(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("figure[data-patient-photo]"))
      .map((f) => {
        const r = f.getBoundingClientRect();
        const glyphs = Array.from(f.querySelectorAll<HTMLElement>("button span[aria-hidden]")).filter(
          (n) => Number(getComputedStyle(n).opacity) > 0.05,
        ).length;
        return {
          width: Math.round(r.width),
          kind: f.dataset.patientPhoto,
          text: (f.innerText || "").trim(),
          glyphs,
        };
      })
      .filter((f) => f.width > 0),
  );
}

test("patient thumbnails never carry the clinical-signs caption or a corner icon", async ({ page }) => {
  await createProfile(page, { role: "student" });
  await page.goto("/encounter");
  await settle(page);
  await expect(page.getByRole("tablist", { name: "Chart sections" })).toBeVisible({ timeout: 30_000 });

  for (const tab of ["Chart Review", "Flowsheets"]) {
    await openTab(page, tab);
    await page.waitForTimeout(400);
    const photos = await thumbnails(page);
    expect(photos.length, `patient photos on ${tab}`).toBeGreaterThan(0);
    for (const p of photos.filter((x) => x.width < 160)) {
      expect(p.kind, `${tab}: ${p.width}px photo is a thumbnail`).toBe("thumbnail");
      expect(p.text, `${tab}: text inside a ${p.width}px photo`).toBe("");
      expect(p.glyphs, `${tab}: corner icon at rest on a ${p.width}px photo`).toBe(0);
    }
  }

  // The signs are still there, as text beside the thumbnail.
  await openTab(page, "Flowsheets");
  const signs = page.getByRole("tabpanel").getByLabel("Clinical signs", { exact: true }).filter({ visible: true }).first();
  await expect(signs).toBeVisible();
  await expect(signs).toHaveText(/\w/);
});
