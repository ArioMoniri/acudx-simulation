import { describe, it, expect } from "vitest";
import {
  CHIEF_COMPLAINT_FAMILIES,
  generateCase,
  mulberry32,
  validateCase,
  type ChiefComplaintFamily,
  type GenerateCaseOptions,
} from "@/domain/caseGen";
import type { CaseInstance } from "@/domain/case";

/**
 * Issue #32 — caseGen unit tests.
 *
 * Covers the two load-bearing product claims of the deterministic generator:
 *   1. same seed => same case (reproducibility),
 *   2. every emitted case passes the internal validity gate,
 * plus the seeded RNG primitive and the family constraint.
 */

const base: GenerateCaseOptions = {
  seedMode: "random",
  locale: "en",
  seed: 0xacd,
};

function gen(overrides: Partial<GenerateCaseOptions> = {}): CaseInstance {
  return generateCase({ ...base, ...overrides });
}

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("returns floats in [0, 1)", () => {
    const rand = mulberry32(98765);
    for (let i = 0; i < 500; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("produces different streams for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toEqual(b());
  });

  it("does not collapse to a constant", () => {
    const rand = mulberry32(42);
    const values = new Set(Array.from({ length: 20 }, () => rand()));
    expect(values.size).toBeGreaterThan(15);
  });
});

describe("generateCase — determinism", () => {
  it("same seed => byte-identical case", () => {
    const c1 = gen({ seed: 777 });
    const c2 = gen({ seed: 777 });
    expect(JSON.stringify(c1)).toEqual(JSON.stringify(c2));
    expect(c1.seed).toBe(777);
  });

  it("different seeds => different case ids", () => {
    const c1 = gen({ seed: 100 });
    const c2 = gen({ seed: 200 });
    expect(c1.id).not.toEqual(c2.id);
  });

  it("echoes the requested locale and difficulty", () => {
    const c = gen({ seed: 55, locale: "tr", difficulty: 3 });
    expect(c.locale).toBe("tr");
    expect(c.difficulty).toBe(3);
  });
});

describe("generateCase — validity", () => {
  it("every generated case passes validateCase across many seeds", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const c = gen({ seed });
      const v = validateCase(c);
      expect(v.ok, `seed ${seed}: ${v.reasons.join(", ")}`).toBe(true);
    }
  });

  it("populated ground truth: history, workup, diagnosis present", () => {
    const c = gen({ seed: 9 });
    expect(c.groundTruth.history.length).toBeGreaterThan(0);
    expect(c.expectedWorkup.length).toBeGreaterThan(0);
    expect(c.correctDiagnosis).toBeTruthy();
    expect(c.provenance).toBe("generated");
  });

  it("a high-acuity case carries at least one critical action", () => {
    // ACS is ESI <= 2; the constrained pool guarantees a chest-pain family case.
    const c = gen({ seedMode: "constrained", chiefComplaint: "chest-pain", seed: 3 });
    if (c.acuityESI <= 2) {
      expect(c.expectedWorkup.some((w) => w.critical)).toBe(true);
    }
  });
});

describe("validateCase — rejects the implausible", () => {
  it("flags an out-of-range heart rate", () => {
    const c = gen({ seed: 21 });
    const broken: CaseInstance = { ...c, triageVitals: { ...c.triageVitals, hr: 500 } };
    const v = validateCase(broken);
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain("hr out of physiological range");
  });

  it("flags diastolic >= systolic", () => {
    const c = gen({ seed: 22 });
    const broken: CaseInstance = {
      ...c,
      triageVitals: { ...c.triageVitals, systolic: 120, diastolic: 130 },
    };
    const v = validateCase(broken);
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain("diastolic implausible vs systolic");
  });

  it("flags an empty history / workup", () => {
    const c = gen({ seed: 23 });
    const broken: CaseInstance = {
      ...c,
      groundTruth: { ...c.groundTruth, history: [] },
      expectedWorkup: [],
    };
    const v = validateCase(broken);
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain("no history items");
    expect(v.reasons).toContain("no expected workup");
  });

  it("flags an implausible age", () => {
    const c = gen({ seed: 24 });
    const broken: CaseInstance = { ...c, patient: { ...c.patient, ageYears: 140 } };
    expect(validateCase(broken).reasons).toContain("age implausible");
  });
});

describe("generateCase — family constraint", () => {
  // The catalogue now spans many diagnoses per family; a constrained draw must
  // stay WITHIN the requested family but is no longer a single fixed diagnosis.
  const FAMILY_CODES: Record<string, string[]> = {
    "chest-pain": ["I21.4", "300.01", "I71.01", "I30.9", "J93.11"],
    headache: ["I60.9", "G43.909", "G00.9", "I63.9", "M31.6"],
    "abdominal-pain": [
      "K35.80", "K81.0", "K85.90", "N20.0", "K56.609", "O00.9", "E10.10", "I71.4", "N10",
    ],
    dyspnea: ["I26.99", "J18.9", "I50.9", "J44.1", "J45.901", "T78.2XXA"],
  };

  for (const [family, codes] of Object.entries(FAMILY_CODES)) {
    it(`constrained ${family} always stays within its family`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const c = generateCase({
          seedMode: "constrained",
          chiefComplaint: family as never,
          locale: "en",
          seed,
        });
        expect(codes, `seed ${seed}`).toContain(
          c.correctDiagnosis.code.coding[0]?.code,
        );
      }
    });
  }

  it("a constrained family surfaces more than one diagnosis (endless variety)", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const c = generateCase({
        seedMode: "constrained",
        chiefComplaint: "abdominal-pain",
        locale: "en",
        seed,
      });
      seen.add(c.correctDiagnosis.code.coding[0]?.code ?? "");
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("generateCase — endless breadth", () => {
  it("random generation spans many systems across seeds", () => {
    const codes = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) {
      const c = gen({ seed });
      codes.add(c.correctDiagnosis.code.coding[0]?.code ?? "");
    }
    // The old generator only ever produced five diagnoses; the broadened
    // offline catalogue must be visibly richer than that.
    expect(codes.size).toBeGreaterThanOrEqual(10);
  });

  it("consecutive unseeded random draws never collide on the same seed", () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 25; i++) {
      seeds.add(generateCase({ seedMode: "random", locale: "en" }).seed);
    }
    expect(seeds.size).toBe(25);
  });
});

describe("generateCase — compositional variety", () => {
  // "endocrine" resolves to a single template (DKA), so the diagnosis is held
  // fixed and only the compositional axes (onset × severity × comorbidity ×
  // complication, plus jittered labs / vitals) can make the two draws differ.
  it("two draws of the SAME diagnosis differ in text and numbers", () => {
    const a = generateCase({ seedMode: "constrained", chiefComplaint: "endocrine", locale: "en", seed: 101 });
    const b = generateCase({ seedMode: "constrained", chiefComplaint: "endocrine", locale: "en", seed: 202 });

    expect(a.correctDiagnosis.code.coding[0]?.code).toBe(
      b.correctDiagnosis.code.coding[0]?.code,
    );
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));

    const vitalsDiffer =
      JSON.stringify(a.triageVitals) !== JSON.stringify(b.triageVitals);
    const labsDiffer =
      JSON.stringify(a.groundTruth.labs) !== JSON.stringify(b.groundTruth.labs);
    expect(vitalsDiffer || labsDiffer).toBe(true);
  });

  it("stays byte-identical for the same seed despite the new axes", () => {
    const a = generateCase({ seedMode: "constrained", chiefComplaint: "endocrine", locale: "en", seed: 303 });
    const b = generateCase({ seedMode: "constrained", chiefComplaint: "endocrine", locale: "en", seed: 303 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("recombines patient names into many distinct identities", () => {
    const names = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) {
      names.add(generateCase({ seedMode: "random", locale: "en", seed }).patient.name);
    }
    // Far beyond the reach of the old ~24 fixed name strings.
    expect(names.size).toBeGreaterThanOrEqual(20);
  });
});

describe("generateCase — families beyond the original four", () => {
  // Specialty families that map to exactly one curated template — a constrained
  // draw must land on that diagnosis and pass validity across seeds.
  const SINGLE_TEMPLATE_FAMILY_CODE: Record<string, string> = {
    endocrine: "E10.10",
    allergy: "T78.2XXA",
    obgyn: "O00.9",
    rheumatology: "M31.6",
    psychiatry: "300.01",
  };

  for (const [family, code] of Object.entries(SINGLE_TEMPLATE_FAMILY_CODE)) {
    it(`constrained ${family} generates a valid case with the expected dx`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const c = generateCase({
          seedMode: "constrained",
          chiefComplaint: family as ChiefComplaintFamily,
          locale: "en",
          seed,
        });
        expect(validateCase(c).ok, `seed ${seed}`).toBe(true);
        expect(c.correctDiagnosis.code.coding[0]?.code).toBe(code);
      }
    });
  }

  it("a multi-template specialty family draws more than one diagnosis", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const c = generateCase({
        seedMode: "constrained",
        chiefComplaint: "cardiology",
        locale: "en",
        seed,
      });
      seen.add(c.correctDiagnosis.code.coding[0]?.code ?? "");
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("generateCase — anti-repeat (unseeded run)", () => {
  it("never repeats a diagnosis back-to-back across a fresh run", () => {
    let prevCode = "";
    let prevName = "";
    for (let i = 0; i < 12; i++) {
      const c = generateCase({ seedMode: "random", locale: "en" });
      const code = c.correctDiagnosis.code.coding[0]?.code ?? "";
      expect(code).not.toBe(prevCode);
      expect(c.patient.name).not.toBe(prevName);
      prevCode = code;
      prevName = c.patient.name;
    }
  });
});

describe("CHIEF_COMPLAINT_FAMILIES export", () => {
  it("lists every family with bilingual labels and unique ids", () => {
    expect(CHIEF_COMPLAINT_FAMILIES.length).toBeGreaterThanOrEqual(12);
    const ids = CHIEF_COMPLAINT_FAMILIES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const orig of ["chest-pain", "headache", "abdominal-pain", "dyspnea"] as const) {
      expect(ids).toContain(orig);
    }
    for (const f of CHIEF_COMPLAINT_FAMILIES) {
      expect(f.label.en.length).toBeGreaterThan(0);
      expect(f.label.tr.length).toBeGreaterThan(0);
    }
  });

  it("every listed family actually produces a valid case (breadth is real)", () => {
    for (const f of CHIEF_COMPLAINT_FAMILIES) {
      const c = generateCase({
        seedMode: "constrained",
        chiefComplaint: f.id,
        locale: "en",
        seed: 7,
      });
      expect(validateCase(c).ok, f.id).toBe(true);
    }
  });
});
