import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useProfile, type ProfileRole } from "@/state/profileStore";

/**
 * "View as" nav vantage — which of the three product surfaces the header shows
 * (docs/design/01 journeys 5/7/8):
 *   - learner:  Home, Start, Cases, Rooms, Progress   (Journey 1-5)
 *   - educator: adds Authoring + Review               (Journey 7)
 *   - dean:     Institution dashboard                 (Journey 8)
 *
 * The vantage is SEEDED FROM THE REAL PROFILE (src/state/profileStore.ts): once
 * the person is onboarded, their real role maps onto a nav surface so TopNav
 * reflects who they actually are. The "View as" switcher remains a convenience
 * (chiefly for educators/deans) that can preview another surface for the current
 * session; it is cleared whenever the real role changes so nav never sticks on a
 * stale vantage.
 */

export type ViewAsRole = "learner" | "educator" | "dean" | "admin";

export const VIEW_AS_ROLES: readonly ViewAsRole[] = [
  "learner",
  "educator",
  "dean",
  "admin",
] as const;

const STORAGE_KEY = "acudx-view-as";

/**
 * Map a real profile role onto a nav vantage. Students and residents both use
 * the solo learner surfaces; educators and deans get their own.
 */
export function profileRoleToViewAs(role: ProfileRole): ViewAsRole {
  switch (role) {
    case "faculty":
      return "educator";
    case "dean":
      return "dean";
    case "admin":
    case "super_admin":
      return "admin";
    case "student":
    case "resident":
    case "nurse":
    case "paramedic":
    default:
      return "learner";
  }
}

/**
 * SINGLE SOURCE OF TRUTH for ROLE -> PERMITTED VANTAGES. The argument is the
 * profile role, which in OIDC mode is derived from the server-verified principal
 * (profileStore.applyVerifiedIdentity) and in local mode is the self-declared,
 * unverified role. Lists are ordered ascending (learner < educator < dean <
 * admin) so the LAST element is the highest permitted vantage:
 *
 *   student / resident / nurse / paramedic -> learner
 *   faculty                                -> learner, educator
 *   dean                                   -> learner, educator, dean
 *   admin / super_admin                    -> learner, educator, dean, admin
 */
export function permittedVantages(role: ProfileRole): ViewAsRole[] {
  switch (role) {
    case "admin":
    case "super_admin":
      return ["learner", "educator", "dean", "admin"];
    case "dean":
      return ["learner", "educator", "dean"];
    case "faculty":
      return ["learner", "educator"];
    case "student":
    case "resident":
    case "nurse":
    case "paramedic":
    default:
      return ["learner"];
  }
}

/**
 * Clamp a candidate vantage to what is permitted: pass it through when allowed,
 * otherwise fall back to the HIGHEST permitted vantage (last in the list). This
 * keeps "View as" a preview WITHIN permission — it can never elevate access.
 */
function clampVantage(
  candidate: ViewAsRole,
  permitted: readonly ViewAsRole[],
): ViewAsRole {
  if (permitted.includes(candidate)) return candidate;
  return permitted[permitted.length - 1] ?? "learner";
}

interface ViewAsContextValue {
  role: ViewAsRole;
  setRole: (r: ViewAsRole) => void;
}

const ViewAsContext = createContext<ViewAsContextValue | null>(null);

function readStored(): ViewAsRole {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "learner" || v === "educator" || v === "dean" || v === "admin") return v;
  } catch {
    /* storage may be unavailable (private mode) — fall back to the default */
  }
  return "learner";
}

/** ViewAsProvider — holds the current "View as" vantage point. */
export function ViewAsProvider({ children }: { children: ReactNode }) {
  const profile = useProfile();

  // The permitted vantages for the REAL profile role — the one permission
  // source (profile.role today, a server claim later). Anyone not yet onboarded
  // is learner-only. Memoised on the role so `setRole` stays referentially stable.
  const roleKey: ProfileRole | null = profile?.onboarded ? profile.role : null;
  const permitted = useMemo<ViewAsRole[]>(
    () => (roleKey ? permittedVantages(roleKey) : ["learner"]),
    [roleKey],
  );

  // Base vantage: the REAL role when onboarded, else the persisted choice —
  // clamped so it can never exceed what the profile role permits.
  const baseRole: ViewAsRole = clampVantage(
    roleKey ? profileRoleToViewAs(roleKey) : readStored(),
    permitted,
  );

  // Session-only "View as" override. Cleared whenever the real base changes
  // (onboarding completes, or the account role is edited) so the nav reflects
  // the real profile by default rather than a stale vantage.
  const [override, setOverride] = useState<ViewAsRole | null>(null);
  const prevBase = useRef<ViewAsRole>(baseRole);
  useEffect(() => {
    if (prevBase.current !== baseRole) {
      prevBase.current = baseRole;
      setOverride(null);
    }
  }, [baseRole]);

  // Clamp the effective vantage as well: a stale or out-of-range stored override
  // can never yield a vantage the profile role doesn't permit.
  const role = clampVantage(override ?? baseRole, permitted);

  const setRole = useCallback(
    (r: ViewAsRole) => {
      const next = clampVantage(r, permitted);
      setOverride(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* apply in-memory only when storage is unavailable */
      }
    },
    [permitted],
  );

  const value = useMemo<ViewAsContextValue>(
    () => ({ role, setRole }),
    [role, setRole],
  );

  return (
    <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>
  );
}

export function useViewAs(): ViewAsContextValue {
  const ctx = useContext(ViewAsContext);
  if (!ctx) throw new Error("useViewAs must be used within <ViewAsProvider>");
  return ctx;
}
