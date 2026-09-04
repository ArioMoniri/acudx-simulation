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
 * LiveBackendProvider — the "Live backend" switch for the web demo.
 *
 * AUTO-ON when reachable. The provider polls the pod gateway's /health probe;
 * as soon as it answers, Live mode defaults ON so a connected learner gets
 * dynamic, model-backed patient dialogue without hunting for a toggle. The user
 * can still turn it off (or back on) from TopNav, and that EXPLICIT choice is
 * persisted in localStorage and always wins over the auto-default. When the
 * gateway is unreachable the effective state is forced off and the encounter
 * degrades gracefully to the offline reveal-graph path (see InterviewTab).
 *
 * Preference is tri-state on disk: absent = "auto" (follow reachability),
 * "true"/"false" = the learner's explicit pick. So a first-time connected user
 * is Live-on by default, while someone who opted out stays out across reloads.
 *
 * Poll cadence backs OFF when offline: a reachable gateway is re-checked on a
 * relaxed interval (to notice it going away), but an unreachable one is retried
 * with growing delays so a missing gateway does not flood the console with
 * connection errors every few seconds.
 *
 * `enabled` is the EFFECTIVE state (reachable AND not explicitly disabled), so
 * consumers can branch on it directly. `available` / `checking` drive the toggle
 * affordance in TopNav (disabled + "backend offline" note while unreachable).
 */

const STORAGE_KEY = "acudx-live-backend";

/** Re-probe cadence while the gateway is reachable (catch it going away). */
const ONLINE_POLL_MS = 30_000;
/** First retry delay after a failed probe; doubles up to the cap (backoff). */
const OFFLINE_POLL_BASE_MS = 15_000;
/** Ceiling for the offline backoff so retries never stop, but stay quiet. */
const OFFLINE_POLL_MAX_MS = 120_000;

interface LiveBackendValue {
  /** Effective: the gateway is reachable AND the learner has not opted out. */
  enabled: boolean;
  /** Persist the user's EXPLICIT Live-mode choice (overrides the auto-default). */
  setEnabled: (on: boolean) => void;
  /** The gateway answered the health probe. */
  available: boolean;
  /** The initial health probe is still in flight. */
  checking: boolean;
}

const LiveBackendContext = createContext<LiveBackendValue | null>(null);

/** Tri-state stored preference: `null` = auto (follow reachability). */
type StoredPref = boolean | null;

function readStored(): StoredPref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "true") return true;
    if (v === "false") return false;
    return null;
  } catch {
    // storage may be unavailable (private mode) — treat as auto.
    return null;
  }
}

export function LiveBackendProvider({ children }: { children: ReactNode }) {
  // `null` preference = auto: default ON whenever the gateway is reachable.
  const [preferred, setPreferred] = useState<StoredPref>(() => readStored());
  const [available, setAvailable] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(true);

  // Poll /health on a self-scheduling loop: fast confirm on mount, relaxed
  // re-checks while online, and a backing-off retry while offline so a missing
  // gateway does not spam connection errors. Never throws — health() returns a
  // result. Tears down cleanly on unmount (and StrictMode's dev double-invoke).
  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    let controller: AbortController | null = null;
    let failures = 0;

    const schedule = (ms: number) => {
      if (!active) return;
      timer = window.setTimeout(() => void probe(), ms);
    };

    const probe = async (): Promise<void> => {
      controller = new AbortController();
      const res = await health({ signal: controller.signal });
      if (!active) return;
      const ok = res.ok && res.data.status === "ok";
      setAvailable(ok);
      setChecking(false);
      if (ok) {
        failures = 0;
        schedule(ONLINE_POLL_MS);
      } else {
        failures += 1;
        const delay = Math.min(
          OFFLINE_POLL_MAX_MS,
          OFFLINE_POLL_BASE_MS * 2 ** (failures - 1),
        );
        schedule(delay);
      }
    };

    void probe();

    return () => {
      active = false;
      if (timer != null) window.clearTimeout(timer);
      controller?.abort();
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

  // Effective state: reachable AND not explicitly disabled. With no explicit
  // choice (`preferred == null`) a reachable gateway defaults ON (auto-enable);
  // an unreachable gateway is always off regardless of preference.
  const enabled = available && (preferred ?? true);

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
