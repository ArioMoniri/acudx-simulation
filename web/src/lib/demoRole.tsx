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
 * The vantage is now SEEDED FROM THE REAL PROFILE (src/state/profileStore.ts):
 * once the person is onboarded, their real role maps onto a nav surface so
 * TopNav reflects who they actually are — no placeholder learner default. The
 * "View as" switcher remains a convenience (chiefly for educators/deans) that
 * can preview another surface for the current session; it is cleared whenever
 * the real role changes so nav never sticks on a stale vantage.
 *
 * The public API (`DemoRole`, `DEMO_ROLES`, `useDemoRole` → `{ role, setRole }`)
 * is unchanged, so TopNav and RoleSwitcher consume it exactly as before.
 */

export type DemoRole = "learner" | "educator" | "dean";

export const DEMO_ROLES: readonly DemoRole[] = [
  "learner",
  "educator",
  "dean",
] as const;

const STORAGE_KEY = "acudx-demo-role";

/**
 * Map a real profile role onto a nav vantage. Students and residents both use
 * the solo learner surfaces; educators and deans get their own.
 */
export function profileRoleToDemoRole(role: ProfileRole): DemoRole {
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

interface DemoRoleContextValue {
  role: DemoRole;
  setRole: (r: DemoRole) => void;
}

const DemoRoleContext = createContext<DemoRoleContextValue | null>(null);

function readStored(): DemoRole {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "learner" || v === "educator" || v === "dean") return v;
  } catch {
    /* storage may be unavailable (private mode) — fall back to the default */
  }
  return "learner";
}

/** DemoRoleProvider — holds the current "View as" vantage point. */
export function DemoRoleProvider({ children }: { children: ReactNode }) {
  const profile = useProfile();

  // Base vantage: the REAL role when onboarded, else the persisted demo choice.
  const baseRole: DemoRole = profile?.onboarded
    ? profileRoleToDemoRole(profile.role)
    : readStored();

  // Session-only "View as" override. Cleared whenever the real base changes
  // (onboarding completes, or the account role is edited) so the nav reflects
  // the real profile by default rather than a stale vantage.
  const [override, setOverride] = useState<DemoRole | null>(null);
  const prevBase = useRef<DemoRole>(baseRole);
  useEffect(() => {
    if (prevBase.current !== baseRole) {
      prevBase.current = baseRole;
      setOverride(null);
    }
  }, [baseRole]);

  const role = override ?? baseRole;

  const setRole = useCallback((r: DemoRole) => {
    setOverride(r);
    try {
      localStorage.setItem(STORAGE_KEY, r);
    } catch {
      /* apply in-memory only when storage is unavailable */
    }
  }, []);

  const value = useMemo<DemoRoleContextValue>(
    () => ({ role, setRole }),
    [role, setRole],
  );

  return (
    <DemoRoleContext.Provider value={value}>
      {children}
    </DemoRoleContext.Provider>
  );
}

export function useDemoRole(): DemoRoleContextValue {
  const ctx = useContext(DemoRoleContext);
  if (!ctx)
    throw new Error("useDemoRole must be used within <DemoRoleProvider>");
  return ctx;
}
