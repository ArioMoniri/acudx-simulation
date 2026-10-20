import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import en from "./locales/en.json";
import tr from "./locales/tr.json";

/**
 * Every literal `t("a.b.c")` key used in the source must resolve in the merged
 * EN and TR bundles (base locale + feature files), otherwise i18next renders
 * the raw key to the learner (acceptance test 2026-10-20 found
 * "guidance3.nba.within" on the Attending tips card).
 */
type Dict = Record<string, unknown>;

const SRC = join(__dirname, "..");
const FEATURES = join(__dirname, "features");

function deepMerge(base: Dict, extra: Dict): Dict {
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const prev = out[k];
    out[k] =
      prev && typeof prev === "object" && !Array.isArray(prev) && v && typeof v === "object" && !Array.isArray(v)
        ? deepMerge(prev as Dict, v as Dict)
        : v;
  }
  return out;
}

function bundle(lng: "en" | "tr", base: Dict): Dict {
  let merged = base;
  for (const f of readdirSync(FEATURES)) {
    if (f.endsWith(`.${lng}.json`)) merged = deepMerge(merged, JSON.parse(readFileSync(join(FEATURES, f), "utf8")) as Dict);
  }
  return merged;
}

function has(dict: Dict, key: string): boolean {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (!cur || typeof cur !== "object") return false;
    cur = (cur as Dict)[part];
  }
  if (typeof cur === "string" || Array.isArray(cur) || (cur && typeof cur === "object")) return true;
  return false;
}

/** A key with plural forms is stored as key_one / key_other. */
function resolves(dict: Dict, key: string): boolean {
  return has(dict, key) || has(dict, `${key}_one`) || has(dict, `${key}_other`);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "i18n" || name === "node_modules") continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const KEY_RE = /\bt\(\s*"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g;

/** The remaining arguments of a call, up to its matching closing paren. */
function callArgs(rest: string): string {
  let depth = 1;
  for (let i = 0; i < rest.length && i < 2000; i++) {
    const c = rest[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    if (depth === 0) return rest.slice(0, i);
  }
  return rest.slice(0, 2000);
}

function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(KEY_RE)) {
      // A call that carries its own fallback (`{ defaultValue }` or a string
      // second argument) never renders the raw key, so it is not checked here.
      const rest = text.slice((m.index ?? 0) + m[0].length);
      if (/^\s*,\s*["'`]/.test(rest) || /defaultValue/.test(callArgs(rest))) continue;
      keys.set(m[1], relative(SRC, file));
    }
  }
  return keys;
}

describe("i18n keys", () => {
  const keys = usedKeys();
  const bundles = { en: bundle("en", en as Dict), tr: bundle("tr", tr as Dict) };

  it("finds literal keys in the source", () => {
    expect(keys.size).toBeGreaterThan(100);
  });

  it("resolves the attending-tips next-best-action window in EN and TR", () => {
    expect(resolves(bundles.en, "guidance3.nba.within")).toBe(true);
    expect(resolves(bundles.tr, "guidance3.nba.within")).toBe(true);
  });

  for (const lng of ["en", "tr"] as const) {
    it(`every literal t() key resolves in ${lng}`, () => {
      const missing = [...keys].filter(([k]) => !resolves(bundles[lng], k)).map(([k, f]) => `${k} (${f})`);
      expect(missing).toEqual([]);
    });
  }
});
