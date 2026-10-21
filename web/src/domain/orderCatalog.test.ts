import { describe, it, expect } from "vitest";
import { orderTiming, type OrderCategory } from "@/domain/orderCatalog";

/**
 * orderCatalog — per-test turnaround ("sense of time").
 *
 * Two invariants matter: (1) results come back in a believable relative order —
 * a culture is disclosed FAR later than a CBC, a CT later than an x-ray; and
 * (2) the category is inferred from EN/TR code+label keywords, with the
 * ServiceRequestKind as a fallback.
 */

describe("orderCatalog — relative turnaround ordering", () => {
  it("cultures come back much later than a CBC", () => {
    const culture = orderTiming("blood-culture", "laboratory", {
      en: "Blood culture",
      tr: "Kan kültürü",
    });
    const cbc = orderTiming("cbc", "laboratory", { en: "CBC", tr: "Hemogram" });

    expect(culture.category).toBe("micro-culture");
    expect(cbc.category).toBe("lab");
    // Much later — not merely a hair slower.
    expect(culture.playbackMs).toBeGreaterThan(cbc.playbackMs * 5);
  });

  it("orders POC < lab < CT < MRI < culture in playback time", () => {
    const poc = orderTiming("glucose", "laboratory", { en: "POC glucose", tr: "Kan şekeri" });
    const lab = orderTiming("cbc", "laboratory", { en: "CBC", tr: "Hemogram" });
    const ct = orderTiming("ct-head", "imaging", { en: "CT head", tr: "Beyin BT" });
    const mri = orderTiming("mri-brain", "imaging", { en: "MRI brain", tr: "Beyin MR" });
    const culture = orderTiming("uc", "laboratory", { en: "Urine culture", tr: "İdrar kültürü" });

    const chain = [poc, lab, ct, mri, culture].map((o) => o.playbackMs);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]).toBeGreaterThan(chain[i - 1]);
    }
  });

  it("shows a realistic clinical turnaround label, not the compressed playback", () => {
    const culture = orderTiming("blood-culture", "laboratory", {
      en: "Blood culture",
      tr: "Kan kültürü",
    });
    // Review 2026-10-21: a blood culture has a 24 h preliminary and a 5 day final.
    expect(culture.clinicalLabel.en).toBe("prelim 24 h, final 5 d");
    expect(culture.turnaroundMs).toBe(5 * 24 * 60 * 60_000);
    expect(culture.preliminaryMs).toBe(24 * 60 * 60_000);
    expect(culture.clinicalLabel.tr).toContain("sa");
    expect(orderTiming("ldh", "laboratory", { en: "LDH", tr: "LDH" }).turnaroundMs).toBe(50 * 60_000);
  });
});

describe("orderCatalog — category detection (EN + TR keywords)", () => {
  const table: Array<{ code: string; label?: { en: string; tr: string }; expected: OrderCategory }> = [
    { code: "67151-1", label: { en: "High-sensitivity troponin", tr: "Yüksek duyarlıklı troponin" }, expected: "cardiac" },
    { code: "inr", label: { en: "PT/INR", tr: "PT/INR" }, expected: "coag" },
    { code: "48065-7", label: { en: "D-dimer", tr: "D-dimer" }, expected: "coag" },
    { code: "cxr", label: { en: "Chest x-ray", tr: "Akciğer grafisi" }, expected: "imaging-xr" },
    { code: "ct-abd", label: { en: "CT abdomen", tr: "Batın BT" }, expected: "imaging-ct" },
    { code: "us-abd", label: { en: "Abdominal ultrasound", tr: "Batın ultrasonu" }, expected: "imaging-us" },
    { code: "mri-brain", label: { en: "MRI brain", tr: "Beyin MR" }, expected: "imaging-mri" },
    { code: "abg", label: { en: "Arterial blood gas", tr: "Arter kan gazı" }, expected: "poc" },
    { code: "11524-6", label: { en: "12-lead ECG", tr: "12 derivasyon EKG" }, expected: "poc" },
    { code: "lactate", label: { en: "Lactate", tr: "Laktat" }, expected: "lab" },
  ];

  for (const { code, label, expected } of table) {
    it(`classifies "${label?.en ?? code}" as ${expected}`, () => {
      expect(orderTiming(code, "laboratory", label).category).toBe(expected);
    });
  }

  it("does NOT misread 'lactate' as a CT via the 'ct' substring", () => {
    expect(orderTiming("lactate", "laboratory", { en: "Lactate", tr: "Laktat" }).category).toBe("lab");
  });

  it("falls back to the ServiceRequestKind when no keyword matches", () => {
    expect(orderTiming("mystery-1", "imaging", { en: "Study", tr: "Tetkik" }).category).toBe("imaging-xr");
    expect(orderTiming("mystery-2", "laboratory", { en: "Assay", tr: "Test" }).category).toBe("lab");
    expect(orderTiming("mystery-3", "consult", { en: "Consult", tr: "Konsültasyon" }).category).toBe("other");
  });
});
