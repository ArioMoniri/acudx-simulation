import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  adminApi,
  getAdminToken,
  setAdminToken,
  type AdminApi,
  type AdminErrorCode,
  type AdminResult,
} from "@/lib/adminApi";
import { hasAccessToken, useAuthSession } from "@/lib/auth";

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

interface AdminSessionValue {
  /** True once a token is stored for this tab. */
  signedIn: boolean;
  api: AdminApi;
  /** Store the token (sessionStorage only) and verify it against /admin/health. */
  signIn: (token: string) => Promise<AdminErrorCode | null>;
  signOut: () => void;
  /** Called by data hooks on 401 so the gate re-appears. */
  invalidate: () => void;
}

const AdminSessionContext = createContext<AdminSessionValue | null>(null);

export function AdminSessionProvider({ children, api = adminApi }: { children: ReactNode; api?: AdminApi }) {
  const [tokenSignedIn, setSignedIn] = useState<boolean>(() => getAdminToken() !== null);
  // A verified OIDC session (admin / super_admin) opens the console without the bootstrap
  // token; the server still checks the bearer's role on every /admin call. Subscribing to the
  // auth session re-renders once a reload has refreshed the access token.
  const auth = useAuthSession();
  const signedIn = tokenSignedIn || (auth.status === "signed-in" && hasAccessToken());

  const signOut = useCallback(() => {
    setAdminToken(null);
    setSignedIn(false);
  }, []);

  const signIn = useCallback(
    async (token: string) => {
      setAdminToken(token);
      const r = await api.getHealth();
      if (r.ok) {
        setSignedIn(true);
        return null;
      }
      setAdminToken(null);
      setSignedIn(false);
      return r.error;
    },
    [api],
  );

  const value = useMemo<AdminSessionValue>(
    () => ({ signedIn, api, signIn, signOut, invalidate: signOut }),
    [signedIn, api, signIn, signOut],
  );
  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSessionValue {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error("useAdminSession must be used within <AdminSessionProvider>");
  return ctx;
}

/* -------------------------------------------------------------------------- */
/* Query hook                                                                 */
/* -------------------------------------------------------------------------- */

export interface AdminQuery<T> {
  data: T | null;
  error: AdminErrorCode | null;
  loading: boolean;
  /** Epoch ms of the last successful load. */
  loadedAt: number | null;
  reload: () => Promise<void>;
}

/**
 * Load admin data with a stable `reload`, optional polling, and 401 handling
 * (an expired or wrong token sends the operator back to the sign-in gate).
 */
export function useAdminQuery<T>(
  fetcher: (api: AdminApi) => Promise<AdminResult<T>>,
  deps: DependencyList,
  opts: { pollMs?: number } = {},
): AdminQuery<T> {
  const { api, invalidate, signedIn } = useAdminSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AdminErrorCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const alive = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await fetcherRef.current(api);
    if (!alive.current) return;
    if (r.ok) {
      setData(r.data);
      setError(null);
      setLoadedAt(Date.now());
    } else {
      setError(r.error);
      if (r.error === "unauthorized") invalidate();
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, invalidate, ...deps]);

  useEffect(() => {
    alive.current = true;
    if (signedIn) void reload();
    return () => {
      alive.current = false;
    };
  }, [reload, signedIn]);

  useEffect(() => {
    if (!opts.pollMs || !signedIn) return;
    const id = setInterval(() => void reload(), opts.pollMs);
    return () => clearInterval(id);
  }, [opts.pollMs, reload, signedIn]);

  return { data, error, loading, loadedAt, reload };
}

/* -------------------------------------------------------------------------- */
/* Small shared helpers                                                       */
/* -------------------------------------------------------------------------- */

/** Active UI language as an Intl locale tag. */
export function useLocaleTag(): string {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage ?? "en";
}

/** "3 minutes ago" style text for an epoch-seconds timestamp. */
export function relativeTime(tsSeconds: number | null | undefined, locale: string, nowMs = Date.now()): string {
  if (!tsSeconds) return "";
  const diff = Math.round(tsSeconds - nowMs / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 60) return rtf.format(diff, "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86_400), "day");
}

export function formatDateTime(tsSeconds: number | null | undefined, locale: string): string {
  if (!tsSeconds) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(tsSeconds * 1000));
}
