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

export type ViewAsRole = "learner" | "educator" | "dean";

export const VIEW_AS_ROLES: readonly ViewAsRole[] = [
  "learner",
  "educator",
  "dean",
] as const;

const STORAGE_KEY = "acudx-view-as";

/**
 * Map a real profile role onto a nav vantage. Students and residents both use
 * the solo learner surfaces; educators and deans get their own.
 */
export function profileRoleToViewAs(role: ProfileRole): ViewAsRole {
  switch (role) {
    case "educator":
      return "educator";
    case "dean":
      return "dean";
    case "student":
    case "resident":
    default:
      return "learner";
  }
}

interface ViewAsContextValue {
  role: ViewAsRole;
  setRole: (r: ViewAsRole) => void;
}

const ViewAsContext = createContext<ViewAsContextValue | null>(null);

function readStored(): ViewAsRole {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "learner" || v === "educator" || v === "dean") return v;
  } catch {
    /* storage may be unavailable (private mode) — fall back to the default */
  }
  return "learner";
}

/** ViewAsProvider — holds the current "View as" vantage point. */
export function ViewAsProvider({ children }: { children: ReactNode }) {
  const profile = useProfile();

  // Base vantage: the REAL role when onboarded, else the persisted choice.
  const baseRole: ViewAsRole = profile?.onboarded
    ? profileRoleToViewAs(profile.role)
    : readStored();

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

  const role = override ?? baseRole;

  const setRole = useCallback((r: ViewAsRole) => {
    setOverride(r);
    try {
      localStorage.setItem(STORAGE_KEY, r);
    } catch {
      /* apply in-memory only when storage is unavailable */
    }
  }, []);

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
