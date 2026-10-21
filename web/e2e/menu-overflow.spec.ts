import { test, expect, type Page } from "@playwright/test";
import { createProfile, settle } from "./helpers/session";

/**
 * No menu needs a horizontal scroll (owner, 2026-10-21: "there should be no need
 * to horizontal scroll in menus"). At every audited width, every navigation and
 * menu surface (nav, tablist, menu, menubar, toolbar, listbox, and anything
 * marked data-menu-surface) must fit its own box: no scrollWidth > clientWidth on
 * the surface, no scrolling ancestor that it overflows, and no item past the
 * viewport edge. Open popups (menus, listboxes, dialogs opened from the shell)
 * are checked the same way.
 *
 * The widths loop inside one test per route so a single project covers 375 to
 * 1920; it runs in the laptop project only (the other projects would repeat it).
 */
const WIDTHS = [375, 768, 1024, 1280, 1440, 1920] as const;

const ROUTES = [
  "/",
  "/welcome",
  "/start",
  "/cases",
  "/rooms",
  "/encounter",
  "/feedback",
  "/progress",
  "/exam",
  "/atlas",
  "/account",
  "/authoring",
  "/institution",
  "/faculty",
  "/admin",
] as const;

export interface MenuOverflow {
  surface: string;
  scrollWidth: number;
  clientWidth: number;
  reason: string;
}

/** Runs in the page: every menu surface that would need a horizontal scroll. */
export async function findMenuOverflow(page: Page): Promise<MenuOverflow[]> {
  return page.evaluate(() => {
    const SURFACE =
      'nav, [role="tablist"], [role="menu"], [role="menubar"], [role="toolbar"], [role="listbox"], [data-menu-surface]';
    const vw = document.documentElement.clientWidth;
    const out: { surface: string; scrollWidth: number; clientWidth: number; reason: string }[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none";
    };
    const describe = (el: Element) => {
      const label =
        el.getAttribute("aria-label") ??
        el.getAttribute("data-menu-surface") ??
        (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""} "${label}"`;
    };
    for (const el of Array.from(document.querySelectorAll(SURFACE))) {
      if (!visible(el)) continue;
      if (el.closest('[aria-hidden="true"], .sr-only')) continue;
      const h = el as HTMLElement;
      if (h.scrollWidth > h.clientWidth + 1) {
        out.push({ surface: describe(el), scrollWidth: h.scrollWidth, clientWidth: h.clientWidth, reason: "surface overflows its box" });
        continue;
      }
      // A scrolling ancestor the surface is wider than (the classic tab rail).
      let p = el.parentElement;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if ((ox === "auto" || ox === "scroll") && p.scrollWidth > p.clientWidth + 1 && h.scrollWidth > p.clientWidth + 1) {
          out.push({ surface: describe(el), scrollWidth: p.scrollWidth, clientWidth: p.clientWidth, reason: "inside a horizontally scrolling rail" });
          break;
        }
        p = p.parentElement;
      }
      // An item that runs past the viewport edge.
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) {
        out.push({ surface: describe(el), scrollWidth: Math.round(r.right), clientWidth: vw, reason: "surface runs past the viewport" });
      }
    }
    return out;
  });
}

test.describe("menus never need a horizontal scroll", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== "laptop", "the widths loop covers every viewport");
    await createProfile(page, { role: "dean" });
  });

  for (const route of ROUTES) {
    test(`menus fit on ${route} at ${WIDTHS.join(", ")}`, async ({ page }) => {
      test.slow();
      await page.goto(route);
      await settle(page);
      if (route === "/encounter") {
        await page
          .getByRole("tablist", { name: "Chart sections" })
          .waitFor({ timeout: 30_000 })
          .catch(() => {});
      }
      const failures: string[] = [];
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        await page.waitForTimeout(250);
        for (const f of await findMenuOverflow(page)) {
          failures.push(`${width}px ${f.surface}: ${f.reason} (${f.scrollWidth} > ${f.clientWidth})`);
        }
        const doc = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (doc > 0) failures.push(`${width}px page scrolls horizontally by ${doc}px`);
      }
      expect(failures, `menus needing a horizontal scroll on ${route}`).toEqual([]);
    });
  }

  test("shell popups fit at every width", async ({ page }) => {
    test.slow();
    await page.goto("/");
    await settle(page);
    const failures: string[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.waitForTimeout(250);
      const triggers = page.locator('header [aria-haspopup]:visible, nav [aria-haspopup]:visible, [role="banner"] [aria-haspopup]:visible');
      const n = await triggers.count();
      for (let i = 0; i < n; i++) {
        const trigger = triggers.nth(i);
        const name = (await trigger.getAttribute("aria-label")) ?? (await trigger.innerText()).trim();
        await trigger.click().catch(() => {});
        await page.waitForTimeout(200);
        for (const f of await findMenuOverflow(page)) {
          failures.push(`${width}px popup of "${name}" ${f.surface}: ${f.reason} (${f.scrollWidth} > ${f.clientWidth})`);
        }
        await page.keyboard.press("Escape");
        await page.waitForTimeout(100);
      }
    }
    expect(failures, "shell popups needing a horizontal scroll").toEqual([]);
  });
});
