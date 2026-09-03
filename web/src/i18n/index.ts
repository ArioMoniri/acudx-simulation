import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import tr from "./locales/tr.json";

export const SUPPORTED_LANGUAGES = ["en", "tr"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = "acudx-lang";

/* --------------------------------------------------------------------------
 * Feature locale merge.
 * Each feature ships its own strings as `features/<feature>.<lng>.json` so that
 * parallel contributors never edit the shared `locales/<lng>.json` files and
 * therefore never collide. Files are deep-merged over the base bundle at init.
 * -------------------------------------------------------------------------- */
type Dict = Record<string, unknown>;

function deepMerge(base: Dict, extra: Dict): Dict {
  const out: Dict = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const prev = out[key];
    if (
      prev &&
      typeof prev === "object" &&
      !Array.isArray(prev) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      out[key] = deepMerge(prev as Dict, value as Dict);
    } else {
      out[key] = value;
    }
  }
  return out;
}

const featureModules = import.meta.glob<Dict>("./features/*.json", {
  eager: true,
  import: "default",
});

function mergeFeatures(lng: Language, base: Dict): Dict {
  let merged: Dict = base;
  for (const [path, mod] of Object.entries(featureModules)) {
    // path looks like ./features/scopeGuard.en.json
    if (path.endsWith(`.${lng}.json`)) {
      merged = deepMerge(merged, mod);
    }
  }
  return merged;
}

const enBundle = mergeFeatures("en", en as Dict);
const trBundle = mergeFeatures("tr", tr as Dict);

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: enBundle },
      tr: { translation: trBundle },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    load: "languageOnly",
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
    returnNull: false,
  });

// Keep <html lang> in sync so screen readers announce the right language.
function syncHtmlLang(lng: string) {
  const normalized = lng.split("-")[0];
  document.documentElement.lang = normalized;
}
syncHtmlLang(i18n.resolvedLanguage ?? "en");
i18n.on("languageChanged", syncHtmlLang);

export default i18n;
