// @vitest-environment jsdom
/**
 * CI guard (owner decision, review 06a): every learner-facing case is generated on
 * request by the model. No learner path may start an encounter from a seed, curated,
 * published, template or on-device case, and no learner path may call the retired
 * routes. A runtime guard covers the store; a source scan covers every learner file.
 */
import { afterEach, describe, expect, it } from "vitest";

import { assertModelSpec, NotModelGeneratedError, type CaseGenV2Spec } from "@/lib/caseGenV2";
import { getEncounterSnapshot, resetEncounter, startGeneratedEncounter } from "@/state/encounterStore";
import { seedCases } from "@/data/seedCases";
import type { CaseGenerationMeta } from "@/lib/liveEncounter";

const SOURCES = import.meta.glob<string>(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"], {
  eager: true,
  query: "?raw",
  import: "default",
});

const meta = (source: CaseGenerationMeta["source"], threadId: string | null = "th-1"): CaseGenerationMeta => ({
  source,
  threadId,
  council: null,
  degraded: false,
  model: null,
  note: null,
});

describe("runtime provenance guard", () => {
  afterEach(() => resetEncounter());

  it.each(["template", "offline", "seed", "published"] as const)("refuses a %s case for a learner", (source) => {
    expect(() => startGeneratedEncounter(seedCases[0], meta(source))).toThrow(/generated on request/);
    expect(getEncounterSnapshot().caseInstance).toBeNull();
  });

  it("refuses a model case that is not bound to its generation thread", () => {
    expect(() => startGeneratedEncounter(seedCases[0], meta("model", null))).toThrow(/thread/);
  });

  it("accepts a model case with its thread", () => {
    startGeneratedEncounter(seedCases[0], meta("model", "th-9"), { "history.presenting": "pending" });
    const s = getEncounterSnapshot();
    expect(s.generation?.source).toBe("model");
    expect(s.generation?.threadId).toBe("th-9");
    expect(s.caseLayers).toEqual({ "history.presenting": "pending" });
  });

  it("assertModelSpec rejects every non-model spec", () => {
    const spec = { meta: { source: "template" } } as unknown as CaseGenV2Spec;
    expect(() => assertModelSpec(spec)).toThrow(NotModelGeneratedError);
    expect(() => assertModelSpec(null)).toThrow(NotModelGeneratedError);
    expect(() => assertModelSpec({ meta: { source: "model" } } as unknown as CaseGenV2Spec)).not.toThrow();
  });
});

describe("source scan: no learner path serves a case that is not generated on request", () => {
  const files = Object.entries(SOURCES).filter(([path]) => !path.includes("/i18n/"));

  it("scans the app sources", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("never imports the seed library, the on-device generator or the template client", () => {
    const offenders: string[] = [];
    for (const [path, text] of files) {
      if (path.endsWith("/data/seedCases.ts") || path.endsWith("/domain/caseGen.ts")) continue;
      if (/from\s+"@\/data\/seedCases"/.test(text)) offenders.push(`${path}: imports @/data/seedCases`);
      if (/import\s*\{[^}]*\bgenerateCase\b[^}]*\}\s*from\s*"@\/domain\/caseGen"/s.test(text)) {
        offenders.push(`${path}: imports generateCase`);
      }
      if (/\btemplateCaseV2\b|\bfetchGeneratedCase\b|\bgenerateCaseFromBackend\b/.test(text)) {
        offenders.push(`${path}: uses a retired case client`);
      }
      if (/["'`]\/v1\/case\/generate|["'`]\/v2\/case\/template/.test(text)) offenders.push(`${path}: calls a retired route`);
    }
    expect(offenders).toEqual([]);
  });

  it("starts learner encounters only through startGeneratedEncounter", () => {
    const offenders = files
      .filter(([path]) => !path.endsWith("/state/encounterStore.ts"))
      .filter(([, text]) => /\bstartEncounter\s*\(/.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("never hands a built case to the encounter through router state", () => {
    const offenders = files
      .filter(([, text]) => /state:\s*\{\s*caseInstance\b/.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
