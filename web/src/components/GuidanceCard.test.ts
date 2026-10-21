import { describe, expect, it, beforeAll } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import i18next, { type i18n as I18n } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";

import trBase from "@/i18n/locales/tr.json";
import guidanceTr from "@/i18n/features/guidance3.tr.json";
import gapsTr from "@/i18n/features/encountergaps.tr.json";
import { GuidanceCard } from "./GuidanceCard";

/**
 * Live report 2026-10-21 ("Rehberlik is not working"): with no verified statement
 * for the step, the interview card only said "Rehberlik kullanılamıyor". It now
 * still coaches the next process step, labelled as uncited, and never invents a
 * clinical statement.
 */

let i18n: I18n;

beforeAll(async () => {
  i18n = i18next.createInstance();
  const translation = {
    ...trBase,
    guidance3: {
      ...guidanceTr.guidance3,
      unavailable: { ...guidanceTr.guidance3.unavailable, ...gapsTr.guidance3.unavailable },
    },
  };
  await i18n.use(initReactI18next).init({ lng: "tr", resources: { tr: { translation } }, interpolation: { escapeValue: false } });
});

function render(el: ReactElement): string {
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, el));
}

describe("GuidanceCard", () => {
  it("shows the next process step in Turkish when no verified statement fits", () => {
    const html = render(createElement(GuidanceCard, { hint: null, lang: "tr", nextStep: "Başlangıcı sorgulayın" }));
    expect(html).toContain('data-guidance="process"');
    expect(html).toContain("Sonraki en iyi adım");
    expect(html).toContain("Başlangıcı sorgulayın");
    expect(html).toContain("Yalnızca süreç adımı");
    expect(html).not.toContain("Rehberlik kullanılamıyor");
  });

  it("keeps the honest unavailable state when there is no step either", () => {
    const html = render(createElement(GuidanceCard, { hint: null, lang: "tr" }));
    expect(html).toContain("Rehberlik kullanılamıyor");
  });

  it("abstains after an off-task message even with a next step", () => {
    const html = render(createElement(GuidanceCard, { hint: null, lang: "tr", abstained: true, nextStep: "x" }));
    expect(html).not.toContain('data-guidance="process"');
  });
});
