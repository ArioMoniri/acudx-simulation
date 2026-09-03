import { useEffect, useReducer } from "react";
import { useTranslation } from "react-i18next";
import { Broadcast, WifiSlash, CircleNotch } from "@phosphor-icons/react";

import { useLiveBackend } from "@/lib/liveBackend";
import { Badge } from "@/components/ui";

/**
 * BackendStatus — a small live-status pill that reports whether the optional,
 * air-gapped pod backend is reachable.
 *
 * It renders ONLY once the learner has opted into Live mode; there is nothing
 * to report while the demo runs fully offline, so the pill stays out of the way.
 * The three states never lean on color alone (WCAG 2.2 / 1.4.1): each pairs a
 * distinct icon with a distinct text label.
 *
 *   checking → probe in flight   (spinner + "Checking backend")
 *   online   → gateway reachable (broadcast + "Live backend online")
 *   offline  → unreachable        (wifi-slash + "Live backend offline")
 *
 * The pill is presentation-only: it never toggles Live mode (that stays with the
 * TopNav switch) and never reaches the network itself — it reflects the shared
 * probe result from `useLiveBackend`.
 */

// Mirrors the persistence key in lib/liveBackend. The context surfaces only the
// EFFECTIVE `enabled` (preference AND gateway reachable), which is false while
// the gateway is offline — so it cannot tell us the learner opted in. We read
// the stored preference directly to gate visibility. Kept in sync by hand;
// liveBackend does not export the key.
const STORAGE_KEY = "acudx-live-backend";

function readPreferred(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // storage may be unavailable (private mode) — treat as not opted in.
    return false;
  }
}

/**
 * Reads the stored Live-mode preference and re-reads on every render. In-tab
 * toggles re-render this component through the shared context (the effective
 * state changes while the gateway is reachable, which is the only time the
 * TopNav switch is enabled); the `storage` listener covers cross-tab changes.
 */
function usePreferredLive(): boolean {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener("storage", force);
    return () => window.removeEventListener("storage", force);
  }, []);
  return readPreferred();
}

export function BackendStatus({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { available, checking } = useLiveBackend();
  const preferred = usePreferredLive();

  // Nothing to surface until the learner has opted into Live mode.
  if (!preferred) return null;

  const shared = {
    className,
    role: "status" as const,
    "aria-live": "polite" as const,
  };

  if (checking) {
    return (
      <Badge
        tone="neutral"
        {...shared}
        icon={
          <CircleNotch
            weight="bold"
            className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
          />
        }
      >
        {t("status.pill.checking")}
      </Badge>
    );
  }

  return available ? (
    <Badge
      tone="normal"
      {...shared}
      icon={<Broadcast weight="bold" className="h-3.5 w-3.5" />}
    >
      {t("status.pill.online")}
    </Badge>
  ) : (
    <Badge
      tone="caution"
      {...shared}
      icon={<WifiSlash weight="bold" className="h-3.5 w-3.5" />}
    >
      {t("status.pill.offline")}
    </Badge>
  );
}

export default BackendStatus;
