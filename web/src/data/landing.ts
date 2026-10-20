/**
 * Landing / product-overview static content — the one marketing-styled surface
 * (docs/design/01 Screen 1.1). Presents the AcuDx phases and links each into
 * the live demo screen so a reviewer can walk every part of the product.
 *
 * Everything here is bilingual-key-driven; the copy lives in i18n. This file
 * only holds the STRUCTURE: which phases exist, which route each opens, and the
 * demo-tour order. No prose, no fake metrics.
 */

/** One product phase, mapped to the route that demonstrates it. */
export interface LandingPhase {
  id: string;
  /** i18n key stem under landing.phases.<key>.{title,body}. */
  key: string;
  /** Route this phase opens in the demo. */
  to: string;
  /** Phosphor icon name resolved in the component. */
  icon:
    | "chat"
    | "generate"
    | "guidance"
    | "calibration"
    | "multiplayer"
    | "progress"
    | "institution"
    | "sovereign";
}

/**
 * The eight phases the landing presents, in a narrative order that follows the
 * learner loop first (roleplay + EHR -> dynamic cases -> guidance ->
 * calibration feedback -> multiplayer -> progress) then the institutional and
 * platform story (institution analytics -> open-source / sovereign).
 */
export const landingPhases: LandingPhase[] = [
  { id: "roleplay", key: "roleplay", to: "/encounter", icon: "chat" },
  { id: "cases", key: "cases", to: "/cases", icon: "generate" },
  { id: "guidance", key: "guidance", to: "/encounter", icon: "guidance" },
  { id: "feedback", key: "feedback", to: "/feedback", icon: "calibration" },
  { id: "rooms", key: "rooms", to: "/rooms", icon: "multiplayer" },
  { id: "progress", key: "progress", to: "/progress", icon: "progress" },
  {
    id: "institution",
    key: "institution",
    to: "/institution",
    icon: "institution",
  },
  { id: "sovereign", key: "sovereign", to: "/authoring", icon: "sovereign" },
];

/**
 * The guided-tour sequence: the ordered set of demo screens a reviewer walks
 * through, one after another, to see every phase. Kept separate from the
 * marketing phase list because the tour is a linear walk (route + short label
 * key), not a grid of cards.
 */
export interface TourStop {
  /** i18n key under tour.stops.<key>. */
  key: string;
  to: string;
}

export const tourStops: TourStop[] = [
  { key: "welcome", to: "/welcome" },
  { key: "start", to: "/start" },
  { key: "cases", to: "/cases" },
  { key: "encounter", to: "/encounter" },
  { key: "feedback", to: "/feedback" },
  { key: "rooms", to: "/rooms" },
  { key: "progress", to: "/progress" },
  { key: "authoring", to: "/authoring" },
  { key: "institution", to: "/institution" },
];

/** The three trust-strip claims shown under the hero (i18n keys). */
export const landingTrust = [
  "formative",
  "synthetic",
  "cited",
  "accessible",
  "bilingual",
] as const;
