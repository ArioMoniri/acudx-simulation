/**
 * AcuDx — user profile store (the real, local identity).
 *
 * A dependency-free external store consumed via React's `useSyncExternalStore`,
 * mirroring `encounterStore`. It holds the ONE real user profile the person
 * fills in themselves during onboarding: their name, role, institution,
 * specialty, preferred language, and chosen avatar. It is the source of truth
 * for identity + role + language across the app, replacing the former demo
 * placeholders ("Dr. Yılmaz", a hard-coded learner role).
 *
 * There is deliberately NO seeded/demo/placeholder profile: until the person
 * completes onboarding the profile is `null` and `onboarded` is effectively
 * false, so the app gates first use to the onboarding flow. There is also no
 * password/credential handling here — production authentication is institution
 * SSO / LTI 1.3 (see the sign-in screen); this store only persists a genuine
 * local profile the user authored.
 *
 * The profile is persisted to localStorage so a reload keeps the same person
 * signed in. A separate `active` session flag lets the user sign out (ending
 * the session) without discarding the account they created.
 *
 * Education only. No real patient data path.
 */

import { useSyncExternalStore } from "react";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The learner/teacher standing of the person. Distinct from the demo "View as"
 * vantage (learner/educator/dean) — see `src/lib/demoRole.tsx`, which maps a
 * real role onto a nav surface.
 */
export type ProfileRole = "student" | "resident" | "educator" | "dean";

export const PROFILE_ROLES: readonly ProfileRole[] = [
  "student",
  "resident",
  "educator",
  "dean",
] as const;

/** Preferred UI language — the two locales AcuDx ships (EN + TR). */
export type ProfileLanguage = "en" | "tr";

export const PROFILE_LANGUAGES: readonly ProfileLanguage[] = [
  "en",
  "tr",
] as const;

/**
 * Avatar identities the person can choose between. Each seed drives a
 * deterministic, offline generated avatar (initials over a seed-derived hue) —
 * no external image, no fake stock photo.
 */
export const AVATAR_SEEDS: readonly string[] = [
  "aster",
  "cobalt",
  "verdant",
  "amber",
  "magenta",
  "slate",
] as const;

/** The real, persisted user profile. */
export interface UserProfile {
  fullName: string;
  role: ProfileRole;
  institution: string;
  /** Clinical specialty / department (optional, free text). */
  specialty?: string;
  language: ProfileLanguage;
  /** One of AVATAR_SEEDS — selects the generated avatar. */
  avatarSeed: string;
  /** ISO 8601 timestamp of when the profile was first created. */
  createdAt: string;
  /** True once the person has completed onboarding. Never seeded true. */
  onboarded: boolean;
}

/** The user-authored fields captured by the onboarding / account form. */
export interface ProfileDraft {
  fullName: string;
  role: ProfileRole;
  institution: string;
  specialty?: string;
  language: ProfileLanguage;
  avatarSeed: string;
}

export interface ProfileState {
  /** The saved account, or null when nobody has onboarded yet. */
  profile: UserProfile | null;
  /** Whether the saved account has an active session (false after signOut). */
  active: boolean;
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "acudx-profile";

function isProfileRole(v: unknown): v is ProfileRole {
  return typeof v === "string" && (PROFILE_ROLES as readonly string[]).includes(v);
}

function isProfileLanguage(v: unknown): v is ProfileLanguage {
  return v === "en" || v === "tr";
}

/** Validate an unknown blob (from storage) into a UserProfile, or null. */
function parseProfile(raw: unknown): UserProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.fullName !== "string" ||
    o.fullName.trim() === "" ||
    !isProfileRole(o.role) ||
    typeof o.institution !== "string" ||
    o.institution.trim() === "" ||
    !isProfileLanguage(o.language) ||
    typeof o.avatarSeed !== "string" ||
    o.avatarSeed === "" ||
    typeof o.createdAt !== "string" ||
    o.onboarded !== true
  ) {
    return null;
  }
  return {
    fullName: o.fullName,
    role: o.role,
    institution: o.institution,
    specialty:
      typeof o.specialty === "string" && o.specialty.trim() !== ""
        ? o.specialty
        : undefined,
    language: o.language,
    avatarSeed: o.avatarSeed,
    createdAt: o.createdAt,
    onboarded: true,
  };
}

function loadState(): ProfileState {
  try {
    const rawStr = localStorage.getItem(STORAGE_KEY);
    if (!rawStr) return { profile: null, active: false };
    const parsed = JSON.parse(rawStr) as unknown;
    const container = (parsed && typeof parsed === "object" ? parsed : {}) as Record<
      string,
      unknown
    >;
    const profile = parseProfile(container.profile);
    const active = profile != null && container.active === true;
    return { profile, active };
  } catch {
    /* storage unavailable or malformed — start fresh, in-memory */
    return { profile: null, active: false };
  }
}

function persist(next: ProfileState): void {
  try {
    if (!next.profile) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* apply in-memory only when storage is unavailable */
  }
}

/* -------------------------------------------------------------------------- */
/* Store internals                                                             */
/* -------------------------------------------------------------------------- */

let state: ProfileState = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function setState(next: ProfileState): void {
  state = next;
  persist(next);
  emit();
}

function normalizeDraft(draft: ProfileDraft): ProfileDraft {
  const specialty = draft.specialty?.trim();
  return {
    fullName: draft.fullName.trim(),
    role: draft.role,
    institution: draft.institution.trim(),
    specialty: specialty ? specialty : undefined,
    language: draft.language,
    avatarSeed: draft.avatarSeed,
  };
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Create the profile from the onboarding form and start an active session.
 * Sets `onboarded: true` and stamps `createdAt`.
 */
export function createProfile(draft: ProfileDraft): UserProfile {
  const clean = normalizeDraft(draft);
  const profile: UserProfile = {
    ...clean,
    createdAt: new Date().toISOString(),
    onboarded: true,
  };
  setState({ profile, active: true });
  return profile;
}

/**
 * Update the saved profile's fields (account editing). No-op when nobody has
 * onboarded yet. Preserves `createdAt` and `onboarded`.
 */
export function updateProfile(patch: Partial<ProfileDraft>): void {
  const current = state.profile;
  if (!current) return;
  const merged: UserProfile = {
    ...current,
    ...patch,
    // Re-normalize the free-text fields when they are part of the patch.
    fullName: (patch.fullName ?? current.fullName).trim(),
    institution: (patch.institution ?? current.institution).trim(),
    specialty:
      "specialty" in patch
        ? patch.specialty?.trim()
          ? patch.specialty.trim()
          : undefined
        : current.specialty,
    createdAt: current.createdAt,
    onboarded: true,
  };
  setState({ profile: merged, active: true });
}

/**
 * Reset — fully discard the profile and session. Returns the app to the
 * first-time onboarding state. (Distinct from signOut, which keeps the account.)
 */
export function resetProfile(): void {
  setState({ profile: null, active: false });
}

/**
 * Sign out — end the active session but keep the saved account so the person
 * can sign back in without re-entering everything.
 */
export function signOut(): void {
  if (!state.profile) return;
  setState({ profile: state.profile, active: false });
}

/** Resume a session for the already-created account (from the sign-in screen). */
export function signIn(): void {
  if (!state.profile || !state.profile.onboarded) return;
  if (state.active) return;
  setState({ profile: state.profile, active: true });
}

/* -------------------------------------------------------------------------- */
/* Subscription + hooks                                                        */
/* -------------------------------------------------------------------------- */

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getState(): ProfileState {
  return state;
}

/** Full profile state (profile + session). */
export function useProfileState(): ProfileState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** The saved profile, or null when nobody has onboarded. */
export function useProfile(): UserProfile | null {
  return useSyncExternalStore(
    subscribe,
    () => state.profile,
    () => state.profile,
  );
}

/** True once the person has completed onboarding (an account exists). */
export function useIsOnboarded(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.profile?.onboarded === true,
    () => state.profile?.onboarded === true,
  );
}

/** True when there is an onboarded account AND an active session. */
export function useIsSignedIn(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.profile?.onboarded === true && state.active,
    () => state.profile?.onboarded === true && state.active,
  );
}

/* -------------------------------------------------------------------------- */
/* Selectors (non-hook — for demoRole seeding + the Home greeting)             */
/* -------------------------------------------------------------------------- */

/** Read the current state without subscribing (module consumers, tests). */
export function getProfileState(): ProfileState {
  return state;
}

/**
 * The name to greet the person by. Returns the real full name once onboarded,
 * otherwise an empty string. HomePage imports `useDisplayName` to replace the
 * former hard-coded "Dr. Yılmaz" greeting with the real profile name.
 */
export function selectDisplayName(s: ProfileState): string {
  return s.profile?.onboarded ? s.profile.fullName : "";
}

/** First name only — handy for a shorter, warmer greeting line. */
export function selectFirstName(s: ProfileState): string {
  const full = selectDisplayName(s);
  return full.split(/\s+/)[0] ?? "";
}

/** Hook form of {@link selectDisplayName} for HomePage to consume. */
export function useDisplayName(): string {
  return useSyncExternalStore(
    subscribe,
    () => selectDisplayName(state),
    () => selectDisplayName(state),
  );
}
