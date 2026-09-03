import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { health } from "@/lib/backend";

/**
 * LiveBackendProvider — the OPTIONAL "Live backend" switch for the web demo.
 *
 * Off by default. When the learner turns it on (and the pod gateway answered a
 * health probe), the encounter routes real calls through the air-gapped Model
 * Gateway instead of the offline mock path (see InterviewTab). The preference is
 * persisted in localStorage; if the backend is unavailable the switch is forced
 * off so the UI never tries to reach a gateway that is not there.
 *
 * `enabled` is the EFFECTIVE state (stored preference AND backend reachable), so
 * consumers can branch on it directly. `available` / `checking` drive the toggle
 * affordance in TopNav (disabled + "backend offline" note while unreachable).
 */

const STORAGE_KEY = "acudx-live-backend";

interface LiveBackendValue {
  /** Effective: the user asked for Live AND the gateway is reachable. */
  enabled: boolean;
  /** Persist the user's Live-mode preference. No-op effect while unavailable. */
  setEnabled: (on: boolean) => void;
  /** The gateway answered the health probe. */
  available: boolean;
  /** The initial health probe is still in flight. */
  checking: boolean;
}

const LiveBackendContext = createContext<LiveBackendValue | null>(null);

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // storage may be unavailable (private mode) — default to off.
    return false;
  }
}

export function LiveBackendProvider({ children }: { children: ReactNode }) {
  const [preferred, setPreferred] = useState<boolean>(() => readStored());
  const [available, setAvailable] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(true);

  // Ping /health once on mount. Aborts cleanly on unmount (and StrictMode's
  // double-invoke in dev), and never throws — health() returns a result.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void (async () => {
      const res = await health({ signal: controller.signal });
      if (!active) return;
      setAvailable(res.ok && res.data.status === "ok");
      setChecking(false);
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    setPreferred(on);
    try {
      localStorage.setItem(STORAGE_KEY, on ? "true" : "false");
    } catch {
      // apply in-memory only when storage is unavailable.
    }
  }, []);

  // If the backend is unavailable, force enabled off regardless of preference.
  const enabled = preferred && available;

  const value = useMemo<LiveBackendValue>(
    () => ({ enabled, setEnabled, available, checking }),
    [enabled, setEnabled, available, checking],
  );

  return (
    <LiveBackendContext.Provider value={value}>
      {children}
    </LiveBackendContext.Provider>
  );
}

export function useLiveBackend(): LiveBackendValue {
  const ctx = useContext(LiveBackendContext);
  if (!ctx) {
    throw new Error("useLiveBackend must be used within <LiveBackendProvider>");
  }
  return ctx;
}
