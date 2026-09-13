import { describe, expect, it } from "vitest";

import { resolveCuratedImagingByText } from "./conditionImaging";

/**
 * These lock in the fix for ordered US / echo / MRI studies showing
 * "No representative image available": every US/echo/MRI/CT read — including
 * the dominant NORMAL/WNL case, which the UI queries as literally
 * `"normal <label>"` — must resolve to a curated bundled image, and the right
 * one for its modality + region. The query strings mirror what ResultsTab's
 * buildSyntheticImaging (`"normal " + label.en`) + modalityShort() actually
 * pass to ConditionImage → resolveStudyImage → resolveCuratedImagingByText.
 */
describe("curated imaging — US / echo / MRI / CT resolution by text", () => {
  const resolveId = (query: string, modality: string): string | null =>
    resolveCuratedImagingByText(query, modality)?.id ?? null;

  it("resolves a NORMAL echocardiogram read (the reported empty-state case)", () => {
    // Echo classifies to the "US" modality short label; must NOT fall to a
    // normal abdominal-US image.
    expect(resolveId("normal Echocardiogram (TTE) / POCUS", "US")).toBe("echo-normal");
  });

  it("resolves normal ultrasound reads to a real normal abdominal US", () => {
    expect(resolveId("normal Ultrasound abdomen", "US")).toBe("us-abdomen-normal");
    expect(resolveId("normal Ultrasound RUQ (biliary)", "US")).toBe("us-abdomen-normal");
    expect(resolveId("normal FAST ultrasound (trauma)", "US")).toBe("us-abdomen-normal");
    expect(resolveId("normal Renal / bladder ultrasound", "US")).toBe("us-abdomen-normal");
    expect(resolveId("normal Lower-limb venous Doppler (DVT)", "US")).toBe("us-abdomen-normal");
  });

  it("resolves abnormal US findings to the matching study", () => {
    expect(resolveId("Gallbladder ultrasound: cholelithiasis with acoustic shadowing", "US")).toBe(
      "us-cholelithiasis",
    );
    expect(resolveId("Right kidney with moderate hydronephrosis and dilated calyces", "US")).toBe(
      "us-hydronephrosis",
    );
    expect(resolveId("Abdominal aortic aneurysm, 5.4 cm", "US")).toBe("us-aaa");
  });

  it("resolves MRI reads to the correct region", () => {
    expect(resolveId("normal MRI brain", "MRI")).toBe("mri-brain-normal");
    expect(resolveId("normal MRI cervical spine", "MRI")).toBe("mri-cspine");
    expect(resolveId("normal MRI lumbar spine", "MRI")).toBe("mri-lspine");
    expect(resolveId("normal MRI abdomen / MRCP", "MRI")).toBe("mri-mrcp");
  });

  it("resolves an acute stroke MRI over the normal-brain image", () => {
    expect(
      resolveId("Acute infarct with restricted diffusion on DWI, right MCA territory", "MRI"),
    ).toBe("mri-brain-infarct");
  });

  it("resolves a normal head CT and does not disturb CT pathology matches", () => {
    expect(resolveId("normal CT head (non-contrast)", "CT")).toBe("ct-head-normal");
    // A normal head-CT entry must never displace an abnormal CT read.
    expect(resolveId("subarachnoid haemorrhage in the basal cisterns", "CT")).toBe(
      "ct-subarachnoid-hemorrhage",
    );
  });

  it("keeps modalities from leaking across buckets", () => {
    // An MRI query must resolve within the MRI bucket, never to a US/CT study.
    const mri = resolveCuratedImagingByText("normal MRI brain", "MRI");
    expect(mri?.modality).toBe("mri");
    const us = resolveCuratedImagingByText("normal Ultrasound abdomen", "US");
    expect(us?.modality).toBe("us");
  });
});
