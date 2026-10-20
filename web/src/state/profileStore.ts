/**
 * AcuDx - user profile store (identity + role + language).
 *
 * A dependency-free external store consumed via React's `useSyncExternalStore`,
 * mirroring `encounterStore`. It holds the ONE user profile: either
 *
 *   - a LOCAL profile the person authored during onboarding (AUTH_MODE=local,
 *     air-gapped demos). It is unverified: `verified` is false and the server
 *     tags every response with `X-Auth-Mode: local` so the UI says so; or
 *   - a VERIFIED profile derived from the server's principal after an OIDC
 *     sign-in (src/lib/auth.ts -> GET /v1/auth/me). Name, role, roles and org
 *     come from verified claims; the person cannot edit them here.
 *
 * There is deliberately NO seeded profile: until the person
 * completes onboarding or signs in the profile is `null`. The profile is
 * persisted to localStorage so a reload keeps the same person signed in; a
 * separate `active` flag lets the user sign out without discarding a local
 * account. Access tokens are NEVER stored here (see src/lib/auth.ts).
 *
 * Education only. No real patient data path.
 */

import { useSyncExternalStore } from "react";

import { SUPPORTED_LANGUAGES, type Language } from "@/i18n";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The person's standing, one of the eight server roles (server/auth/roles.py):
 * learner tracks (student, nurse, paramedic), resident, faculty, dean, admin and
 * super_admin. Distinct from the "View as" vantage (learner/educator/dean/admin)
 * in `src/lib/viewAs.tsx`, which maps a role onto a nav surface. The legacy
 * `educator` value is read from storage as `faculty`.
 */
export type ProfileRole =
  | "student"
  | "resident"
  | "nurse"
  | "paramedic"
  | "faculty"
  | "dean"
  | "admin"
  | "super_admin";

export const PROFILE_ROLES: readonly ProfileRole[] = [
  "student",
  "resident",
  "nurse",
  "paramedic",
  "faculty",
  "dean",
  "admin",
  "super_admin",
] as const;

/** Roles a person may self-select on a LOCAL profile. Privileged roles need a verified token. */
export const SELF_SERVICE_ROLES: readonly ProfileRole[] = ["student", "resident", "nurse", "paramedic"] as const;

/** Preferred UI language. Single source of truth in `src/i18n`. */
export type ProfileLanguage = Language;

export const PROFILE_LANGUAGES: readonly ProfileLanguage[] = SUPPORTED_LANGUAGES;

/** Avatar identities (deterministic offline identicons; no photo, no stock image). */
export const AVATAR_SEEDS: readonly string[] = [
  "aster",
  "cobalt",
  "verdant",
  "amber",
  "magenta",
  "slate",
] as const;

/** The persisted user profile. */
export interface UserProfile {
  fullName: string;
  role: ProfileRole;
  /** Every role held (verified profiles may hold several, e.g. dean + faculty). */
  roles: ProfileRole[];
  institution: string;
  /** Clinical specialty / department (optional, free text). */
  specialty?: string;
  language: ProfileLanguage;
  /** One of AVATAR_SEEDS. */
  avatarSeed: string;
  /** ISO 8601 timestamp of when the profile was first created. */
  createdAt: string;
  /** True once the person has completed onboarding or signed in. Never seeded true. */
  onboarded: boolean;
  /**
   * Stable pseudonymous id sent as X-User-Id on local-mode requests so a local
   * learner's encounters chain under one identity. Not a credential.
   */
  localId: string;
  /** True when name, role(s) and org came from a server-verified token. */
  verified: boolean;
  /** IdP subject for a verified profile. */
  sub?: string;
  email?: string;
  /** Org / tenant from the verified claim (the institution field mirrors it). */
  org?: string;
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

/** The server principal shape consumed by {@link applyVerifiedIdentity}. */
export interface VerifiedIdentity {
  sub: string;
  email: string | null;
  name: string | null;
  roles: string[];
  org: string;
  primary_role: string;
}

export interface ProfileState {
  profile: UserProfile | null;
  /** Whether the saved account has an active session (false after signOut). */
  active: boolean;
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "acudx-profile";

const LEGACY_ROLE_ALIASES: Record<string, ProfileRole> = { educator: "faculty", "super-admin": "super_admin" };

export function normalizeProfileRole(v: unknown): ProfileRole | null {
  if (typeof v !== "string") return null;
  const mapped = LEGACY_ROLE_ALIASES[v] ?? v;
  return (PROFILE_ROLES as readonly string[]).includes(mapped) ? (mapped as ProfileRole) : null;
}

function isProfileLanguage(v: unknown): v is ProfileLanguage {
  return typeof v === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(v);
}

function newLocalId(): string {
  try {
    return `local-${crypto.randomUUID()}`;
  } catch {
    return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Validate an unknown blob (from storage) into a UserProfile, or null. */
function parseProfile(raw: unknown): UserProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const role = normalizeProfileRole(o.role);
  if (
    typeof o.fullName !== "string" ||
    o.fullName.trim() === "" ||
    role === null ||
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
  const roles = Array.isArray(o.roles)
    ? (o.roles.map(normalizeProfileRole).filter((r): r is ProfileRole => r !== null) as ProfileRole[])
    : [];
  return {
    fullName: o.fullName,
    role,
    roles: roles.length > 0 ? roles : [role],
    institution: o.institution,
    specialty: typeof o.specialty === "string" && o.specialty.trim() !== "" ? o.specialty : undefined,
    language: o.language,
    avatarSeed: o.avatarSeed,
    createdAt: o.createdAt,
    onboarded: true,
    localId: typeof o.localId === "string" && o.localId !== "" ? o.localId : `local-${o.createdAt}`,
    verified: o.verified === true,
    sub: typeof o.sub === "string" ? o.sub : undefined,
    email: typeof o.email === "string" ? o.email : undefined,
    org: typeof o.org === "string" ? o.org : undefined,
  };
}

function loadState(): ProfileState {
  try {
    const rawStr = localStorage.getItem(STORAGE_KEY);
    if (!rawStr) return { profile: null, active: false };
    const parsed = JSON.parse(rawStr) as unknown;
    const container = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    const profile = parseProfile(container.profile);
    const active = profile != null && container.active === true;
    return { profile, active };
  } catch {
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

/** Create a LOCAL (unverified) profile from the onboarding form and start a session. */
export function createProfile(draft: ProfileDraft): UserProfile {
  const clean = normalizeDraft(draft);
  const profile: UserProfile = {
    ...clean,
    roles: [clean.role],
    createdAt: new Date().toISOString(),
    onboarded: true,
    localId: state.profile?.localId ?? newLocalId(),
    verified: false,
  };
  setState({ profile, active: true });
  return profile;
}

/**
 * Update the saved profile's fields. On a VERIFIED profile the identity fields
 * (name, role, institution) are owned by the IdP and ignored here; only the
 * person's preferences (language, avatar, specialty) are applied.
 */
export function updateProfile(patch: Partial<ProfileDraft>): void {
  const current = state.profile;
  if (!current) return;
  const locked = current.verified;
  const role = locked ? current.role : (patch.role ?? current.role);
  const merged: UserProfile = {
    ...current,
    language: patch.language ?? current.language,
    avatarSeed: patch.avatarSeed ?? current.avatarSeed,
    fullName: locked ? current.fullName : (patch.fullName ?? current.fullName).trim(),
    institution: locked ? current.institution : (patch.institution ?? current.institution).trim(),
    role,
    roles: locked ? current.roles : [role],
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
 * Apply the server-verified principal (after OIDC sign-in or a silent refresh).
 * Creates the profile when none exists, otherwise replaces the identity fields
 * while keeping the person's preferences. Starts an active session.
 */
export function applyVerifiedIdentity(id: VerifiedIdentity, defaults: { language?: ProfileLanguage } = {}): UserProfile {
  const current = state.profile;
  const role = normalizeProfileRole(id.primary_role) ?? "student";
  const roles = id.roles.map(normalizeProfileRole).filter((r): r is ProfileRole => r !== null);
  const profile: UserProfile = {
    fullName: (id.name ?? id.email ?? id.sub).trim() || id.sub,
    role,
    roles: roles.length > 0 ? roles : [role],
    institution: id.org,
    specialty: current?.specialty,
    language: current?.language ?? defaults.language ?? "en",
    avatarSeed: current?.avatarSeed ?? AVATAR_SEEDS[0],
    createdAt: current?.sub === id.sub ? current.createdAt : new Date().toISOString(),
    onboarded: true,
    localId: current?.localId ?? newLocalId(),
    verified: true,
    sub: id.sub,
    email: id.email ?? undefined,
    org: id.org,
  };
  setState({ profile, active: true });
  return profile;
}

/** Fully discard the profile and session (back to first-time onboarding). */
export function resetProfile(): void {
  setState({ profile: null, active: false });
}

/** End the active session but keep the saved account. */
export function signOut(): void {
  if (!state.profile) return;
  setState({ profile: state.profile, active: false });
}

/** Resume a session for the already-created LOCAL account (from the sign-in screen). */
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

export function useProfileState(): ProfileState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function useProfile(): UserProfile | null {
  return useSyncExternalStore(
    subscribe,
    () => state.profile,
    () => state.profile,
  );
}

export function useIsOnboarded(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.profile?.onboarded === true,
    () => state.profile?.onboarded === true,
  );
}

export function useIsSignedIn(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.profile?.onboarded === true && state.active,
    () => state.profile?.onboarded === true && state.active,
  );
}

/** True when the active profile's identity came from a verified token. */
export function useIsVerified(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.profile?.verified === true,
    () => state.profile?.verified === true,
  );
}

/* -------------------------------------------------------------------------- */
/* Selectors                                                                   */
/* -------------------------------------------------------------------------- */

export function getProfileState(): ProfileState {
  return state;
}

/**
 * Local-mode identity headers for API calls when no bearer token is in memory.
 * They are UNVERIFIED by design (the server marks the response X-Auth-Mode: local).
 */
export function localIdentityHeaders(s: ProfileState = state): Record<string, string> {
  const p = s.profile;
  if (!p || !s.active) return {};
  const headers: Record<string, string> = { "X-User-Id": p.localId, "X-User-Role": p.role };
  if (p.fullName) headers["X-User-Name"] = p.fullName;
  if (p.institution) headers["X-Tenant"] = p.institution.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 64);
  if (p.email) headers["X-User-Email"] = p.email;
  return headers;
}

export function selectDisplayName(s: ProfileState): string {
  return s.profile?.onboarded ? s.profile.fullName : "";
}

export function selectFirstName(s: ProfileState): string {
  const full = selectDisplayName(s);
  return full.split(/\s+/)[0] ?? "";
}

export function useDisplayName(): string {
  return useSyncExternalStore(
    subscribe,
    () => selectDisplayName(state),
    () => selectDisplayName(state),
  );
}
