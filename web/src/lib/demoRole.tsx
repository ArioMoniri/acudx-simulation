import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Demo "View as" role — a lightweight presentation switch that reveals the
 * three product surfaces the specs describe (docs/design/01 journeys 5/7/8):
 *   - learner:  Home, Start, Cases, Rooms, Progress   (Journey 1-5)
 *   - educator: adds Authoring + Review               (Journey 7)
 *   - dean:     Institution dashboard                 (Journey 8)
 *
 * This is a DEMO affordance, not auth. It only changes which nav surfaces are
 * shown so a reviewer can walk the whole product; no data is gated by it.
 * The choice is persisted so a reload keeps the same vantage point.
 */

export type DemoRole = "learner" | "educator" | "dean";

export const DEMO_ROLES: readonly DemoRole[] = [
  "learner",
  "educator",
  "dean",
] as const;

const STORAGE_KEY = "acudx-demo-role";

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
  const [role, setRoleState] = useState<DemoRole>(() => readStored());

  // Keep other tabs / late reads in sync with the persisted choice.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setRoleState(readStored());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setRole = useCallback((r: DemoRole) => {
    setRoleState(r);
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
