import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { health } from "@/lib/backend";

/**
 * LiveBackendProvider — silently tracks whether the optional model-backed
 * gateway is reachable and, when it is, serves dynamic patient dialogue.
 *
 * There is no user-facing preference or switch: behaviour follows reachability
 * alone. The provider polls the gateway's /health probe; while it answers,
 * `enabled` is true and connected learners get dynamic, model-backed replies.
 * When the gateway is unreachable the effective state is off and the encounter
 * degrades gracefully to the offline reveal-graph path (see InterviewTab).
 *
 * Poll cadence backs OFF when unreachable: a reachable gateway is re-checked on
 * a relaxed interval (to notice it going away), but an unreachable one is
 * retried with growing delays so a missing gateway does not flood the console
 * with connection errors every few seconds.
 *
 * `enabled` is the effective state (currently just reachability), so consumers
 * can branch on it directly. `available` / `checking` expose the raw probe
 * status for any consumer that needs to distinguish "still checking" from "off".
 */

/** Re-probe cadence while the gateway is reachable (catch it going away). */
const ONLINE_POLL_MS = 30_000;
/** First retry delay after a failed probe; doubles up to the cap (backoff). */
const OFFLINE_POLL_BASE_MS = 15_000;
/** Ceiling for the offline backoff so retries never stop, but stay quiet. */
const OFFLINE_POLL_MAX_MS = 120_000;

interface LiveBackendValue {
  /** Effective state: the gateway is reachable. */
  enabled: boolean;
  /** The gateway answered the health probe. */
  available: boolean;
  /** The initial health probe is still in flight. */
  checking: boolean;
}

const LiveBackendContext = createContext<LiveBackendValue | null>(null);

export function LiveBackendProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(true);

  // Poll /health on a self-scheduling loop: fast confirm on mount, relaxed
  // re-checks while reachable, and a backing-off retry while unreachable so a
  // missing gateway does not spam connection errors. Never throws — health()
  // returns a result. Tears down cleanly on unmount (and StrictMode's dev
  // double-invoke).
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

  // Effective state follows reachability directly.
  const enabled = available;

  const value = useMemo<LiveBackendValue>(
    () => ({ enabled, available, checking }),
    [enabled, available, checking],
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
