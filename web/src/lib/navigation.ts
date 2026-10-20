import type { ViewAsRole } from "@/lib/viewAs";

/**
 * navigation.ts: the single source of truth for primary navigation.
 *
 * The role-scoped item lists used to live inside TopNav. The shell now renders
 * them in three places (the left rail on lg+, the bottom tab bar on phone and
 * tablet, and the breadcrumb line in page headers), so they are pure data
 * here, unit-tested, and the components only render.
 */

export interface NavItem {
  to: string;
  /** i18n key for the label (nav.*). */
  key: string;
  /** Exact-match only (Home). */
  end?: boolean;
  /** English fallback for a key not yet in every locale bundle. */
  defaultLabel?: string;
}

/**
 * Nav surfaces per PERMITTED vantage point (docs/design/01). The vantage is
 * permission-clamped upstream in `lib/viewAs` (`permittedVantages`), so this
 * map is only ever indexed by a vantage the real profile role permits:
 *   learner  -> the solo learning loop (Journeys 1 to 5), incl. formative feedback
 *   educator -> the learner loop PLUS authoring (Journey 7)
 *   dean     -> the institution dashboard (Journey 8)
 *   admin    -> the operator console
 */
const NAV_BY_ROLE: Record<ViewAsRole, NavItem[]> = {
  learner: [
    { to: "/", key: "nav.home", end: true },
    { to: "/start", key: "nav.start" },
    { to: "/cases", key: "nav.cases" },
    { to: "/rooms", key: "nav.rooms" },
    { to: "/exam", key: "nav.exam" },
    { to: "/atlas", key: "nav.atlas", defaultLabel: "Atlas" },
    { to: "/feedback", key: "nav.feedback" },
    { to: "/progress", key: "nav.progress" },
  ],
  educator: [
    { to: "/", key: "nav.home", end: true },
    { to: "/cases", key: "nav.cases" },
    { to: "/faculty", key: "nav.faculty", defaultLabel: "Faculty" },
    { to: "/authoring", key: "nav.authoring" },
    { to: "/atlas", key: "nav.atlas", defaultLabel: "Atlas" },
  ],
  dean: [
    { to: "/", key: "nav.home", end: true },
    { to: "/dean", key: "nav.institution" },
    { to: "/faculty", key: "nav.faculty", defaultLabel: "Faculty" },
    { to: "/authoring", key: "nav.authoring" },
    { to: "/atlas", key: "nav.atlas", defaultLabel: "Atlas" },
  ],
  admin: [
    { to: "/", key: "nav.home", end: true },
    { to: "/admin", key: "nav.admin", defaultLabel: "Admin" },
    { to: "/dean", key: "nav.institution" },
    { to: "/faculty", key: "nav.faculty", defaultLabel: "Faculty" },
    { to: "/authoring", key: "nav.authoring" },
  ],
};

/** The primary navigation for a vantage, in rail order. */
export function navItemsFor(role: ViewAsRole): readonly NavItem[] {
  return NAV_BY_ROLE[role];
}

/** How many items the bottom tab bar shows before the "More" entry. */
export const BOTTOM_TAB_PRIMARY = 4;

/** Split a vantage's items into the bottom-bar tabs and the "More" sheet. */
export function primaryTabsFor(role: ViewAsRole): { primary: NavItem[]; overflow: NavItem[] } {
  const items = NAV_BY_ROLE[role];
  if (items.length <= BOTTOM_TAB_PRIMARY + 1) {
    return { primary: [...items], overflow: [] };
  }
  return {
    primary: items.slice(0, BOTTOM_TAB_PRIMARY),
    overflow: items.slice(BOTTOM_TAB_PRIMARY),
  };
}

/** Routes that are reachable but not in any nav list, with their label keys. */
const ROUTE_LABELS: Record<string, { key: string; defaultLabel?: string }> = {
  "/encounter": { key: "nav.encounter" },
  "/account": { key: "nav.account" },
  "/profile": { key: "nav.account" },
  "/institution": { key: "nav.institution" },
  "/dean": { key: "nav.institution" },
  "/faculty": { key: "nav.faculty", defaultLabel: "Faculty" },
  "/admin": { key: "nav.admin", defaultLabel: "Admin" },
  "/welcome": { key: "landing.breadcrumb", defaultLabel: "Welcome" },
  "/start": { key: "nav.start" },
  "/cases": { key: "nav.cases" },
  "/rooms": { key: "nav.rooms" },
  "/exam": { key: "nav.exam" },
  "/atlas": { key: "nav.atlas", defaultLabel: "Atlas" },
  "/feedback": { key: "nav.feedback" },
  "/progress": { key: "nav.progress" },
  "/authoring": { key: "nav.authoring" },
};

export interface Crumb {
  to: string;
  key: string;
  defaultLabel?: string;
}

/**
 * Breadcrumbs for a pathname: Home, then the top-level section. A route that is
 * in the vantage's nav uses that item's key; any other known route resolves
 * through ROUTE_LABELS; an unknown route yields Home alone.
 */
export function breadcrumbsFor(pathname: string, role: ViewAsRole): Crumb[] {
  const home: Crumb = { to: "/", key: "nav.home" };
  const top = "/" + (pathname.split("/").filter(Boolean)[0] ?? "");
  if (top === "/") return [home];
  const navItem = NAV_BY_ROLE[role].find((i) => i.to === top);
  if (navItem) {
    return [home, { to: navItem.to, key: navItem.key, ...(navItem.defaultLabel ? { defaultLabel: navItem.defaultLabel } : {}) }];
  }
  const known = ROUTE_LABELS[top];
  if (known) {
    return [home, { to: top, key: known.key, ...(known.defaultLabel ? { defaultLabel: known.defaultLabel } : {}) }];
  }
  return [home];
}
