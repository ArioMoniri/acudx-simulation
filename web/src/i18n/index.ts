import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import tr from "./locales/tr.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import ar from "./locales/ar.json";
import zh from "./locales/zh.json";
import ru from "./locales/ru.json";
import pt from "./locales/pt.json";
import it from "./locales/it.json";
import ja from "./locales/ja.json";
import hi from "./locales/hi.json";

export const SUPPORTED_LANGUAGES = [
  "en",
  "tr",
  "es",
  "fr",
  "de",
  "ar",
  "zh",
  "ru",
  "pt",
  "it",
  "ja",
  "hi",
] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = "acudx-lang";

/* --------------------------------------------------------------------------
 * Language metadata — native name (for the switcher), English name (for
 * tooltips / a11y), and writing direction. Anything marked `rtl` flips the
 * document via `applyDocumentLanguage`.
 * -------------------------------------------------------------------------- */
export type TextDir = "ltr" | "rtl";
export interface LanguageMeta {
  nativeName: string;
  englishName: string;
  dir: TextDir;
}

export const LANGUAGE_META: Record<Language, LanguageMeta> = {
  en: { nativeName: "English", englishName: "English", dir: "ltr" },
  tr: { nativeName: "Türkçe", englishName: "Turkish", dir: "ltr" },
  es: { nativeName: "Español", englishName: "Spanish", dir: "ltr" },
  fr: { nativeName: "Français", englishName: "French", dir: "ltr" },
  de: { nativeName: "Deutsch", englishName: "German", dir: "ltr" },
  ar: { nativeName: "العربية", englishName: "Arabic", dir: "rtl" },
  zh: { nativeName: "中文", englishName: "Chinese", dir: "ltr" },
  ru: { nativeName: "Русский", englishName: "Russian", dir: "ltr" },
  pt: { nativeName: "Português", englishName: "Portuguese", dir: "ltr" },
  it: { nativeName: "Italiano", englishName: "Italian", dir: "ltr" },
  ja: { nativeName: "日本語", englishName: "Japanese", dir: "ltr" },
  hi: { nativeName: "हिन्दी", englishName: "Hindi", dir: "ltr" },
};

/** Base code of any BCP-47 tag (e.g. `en-US` → `en`), narrowed to a supported
 *  Language when possible, else `en`. */
export function normalizeLanguage(lng: string | undefined | null): Language {
  const base = (lng ?? "en").split("-")[0];
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(base)
    ? (base as Language)
    : "en";
}

/* --------------------------------------------------------------------------
 * Feature locale merge.
 * Each feature ships its own strings as `features/<feature>.<lng>.json` so that
 * parallel contributors never edit the shared `locales/<lng>.json` files and
 * therefore never collide. Files are deep-merged over the base bundle at init.
 *
 * Feature files currently exist only for `en`/`tr`. For every other language a
 * feature key simply isn't present in that bundle, so i18next's `fallbackLng`
 * ("en") resolves it against the English feature strings — the app "supports"
 * all core UI in each language, with feature strings gracefully falling back.
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

const baseBundles: Record<Language, Dict> = {
  en: en as Dict,
  tr: tr as Dict,
  es: es as Dict,
  fr: fr as Dict,
  de: de as Dict,
  ar: ar as Dict,
  zh: zh as Dict,
  ru: ru as Dict,
  pt: pt as Dict,
  it: it as Dict,
  ja: ja as Dict,
  hi: hi as Dict,
};

const resources = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((lng) => [
    lng,
    { translation: mergeFeatures(lng, baseBundles[lng]) },
  ]),
) as Record<Language, { translation: Dict }>;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
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

/**
 * Keep `<html lang>` and `<html dir>` in sync with the active language so
 * screen readers announce the right language and RTL scripts (e.g. Arabic)
 * lay out correctly. Safe to import and call from anywhere.
 *
 * RTL note: flipping `<html dir="rtl">` is the single switch for direction.
 * The shell already leans on flexbox/grid and (increasingly) logical CSS
 * properties, so the mirror is correct for the great majority of the UI. A few
 * components still use physical `left/right` utilities; those are visual polish
 * to migrate to logical (`start/end`) utilities incrementally, not blockers —
 * Arabic renders and reads correctly today. The LanguageSwitcher popover itself
 * is already anchored with logical `end-0` so it mirrors cleanly.
 */
export function applyDocumentLanguage(lng: string): void {
  const normalized = normalizeLanguage(lng);
  const el = document.documentElement;
  el.lang = normalized;
  el.dir = LANGUAGE_META[normalized]?.dir ?? "ltr";
}

applyDocumentLanguage(i18n.resolvedLanguage ?? "en");
i18n.on("languageChanged", applyDocumentLanguage);

export default i18n;
