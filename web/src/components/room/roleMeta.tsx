import {
  Stethoscope,
  FirstAid,
  Ambulance,
  type Icon,
} from "@phosphor-icons/react";
import type { ClinicalRole, Presence } from "@/data/rooms";

/** Phosphor icon per clinical role (icons only, per the design language). */
export const ROLE_ICON: Record<ClinicalRole, Icon> = {
  doctor: Stethoscope,
  nurse: FirstAid,
  paramedic: Ambulance,
};

/**
 * Presence dot styling. Meaning is ALSO carried by a text label wherever this
 * is used (WCAG 1.4.1) — the dot is a redundant cue, never the only one.
 */
export const PRESENCE_COLOR: Record<Presence, string> = {
  active: "var(--state-normal)",
  idle: "var(--state-caution)",
  reconnecting: "var(--state-warning)",
};
