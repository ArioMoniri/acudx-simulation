// @vitest-environment jsdom
/** Acceptance 2026-10-20 D-21: a refused privileged route says why. */
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { RoleGateNotice } from "@/components/shell/RoleGateNotice";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("RoleGateNotice", () => {
  it("names the required role, the current role and the ways in (EN and TR)", async () => {
    for (const [lang, needle] of [["en", "needs the faculty role"], ["tr", "faculty rolü gerektirir"]] as const) {
      await i18n.changeLanguage(lang);
      const el = document.createElement("div");
      const root = createRoot(el);
      act(() => {
        root.render(createElement(MemoryRouter, null, createElement(RoleGateNotice, { required: "faculty", current: "student" })));
      });
      expect(el.querySelector("[role=alert]")?.textContent).toContain(needle);
      expect(el.querySelector('a[href="/signin"]')).not.toBeNull();
      act(() => root.unmount());
    }
  });
});
