import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Trash, UserPlus } from "@phosphor-icons/react";

import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, Field, Skeleton, Table, TableWrap, TBody, Td, TextInput, Th, THead, Tr } from "@/components/ui";
import type { UserRecord } from "@/lib/adminApi";
import { ACUDX_ROLES, type AcuDxRole } from "@/lib/auth";
import { formatDateTime, useAdminQuery, useAdminSession, useLocaleTag } from "./adminSession";

/**
 * Identity: the server-side `user_roles` table (server/auth/store.py). Roles an
 * admin grants here are unioned with the roles in the person's verified token,
 * so a university that cannot add claims to its IdP can still promote faculty
 * and deans from this screen. Keyed by the IdP `sub`.
 */
export function UsersSection() {
  const { t } = useTranslation();
  const { api } = useAdminSession();
  const locale = useLocaleTag();
  const [org, setOrg] = useState("");
  const q = useAdminQuery((a) => a.listUsers(org || undefined), [org]);
  const [newSub, setNewSub] = useState("");
  const [newOrg, setNewOrg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function toggle(user: UserRecord, role: AcuDxRole) {
    const has = user.roles.includes(role);
    const roles = has ? user.roles.filter((r) => r !== role) : [...user.roles, role];
    setBusy(user.sub);
    const r = await api.putUserRoles(user.sub, roles, user.org ?? undefined);
    setBusy(null);
    setMsg(r.ok ? t("admin.users.saved", { sub: user.sub }) : t("admin.users.failed", { error: r.error }));
    if (r.ok) void q.reload();
  }

  async function remove(user: UserRecord) {
    setBusy(user.sub);
    const r = await api.deleteUser(user.sub);
    setBusy(null);
    if (r.ok) void q.reload();
    else setMsg(t("admin.users.failed", { error: r.error }));
  }

  async function add() {
    if (!newSub.trim()) return;
    setBusy("new");
    const r = await api.putUserRoles(newSub.trim(), ["student"], newOrg.trim() || undefined);
    setBusy(null);
    if (r.ok) {
      setNewSub("");
      void q.reload();
    } else {
      setMsg(t("admin.users.failed", { error: r.error }));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card padding="lg">
        <CardHeader>
          <CardTitle>{t("admin.users.title")}</CardTitle>
          <CardDescription>{t("admin.users.description")}</CardDescription>
        </CardHeader>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label={t("admin.users.filterOrg")} hint={t("admin.users.filterOrgHint")}>
            {(aria) => <TextInput {...aria} value={org} onChange={(e) => setOrg(e.target.value)} />}
          </Field>
          <Field label={t("admin.users.newSub")} hint={t("admin.users.newSubHint")}>
            {(aria) => <TextInput {...aria} value={newSub} onChange={(e) => setNewSub(e.target.value)} />}
          </Field>
          <Field label={t("admin.users.newOrg")} optional>
            {(aria) => (
              <div className="flex gap-2">
                <TextInput {...aria} value={newOrg} onChange={(e) => setNewOrg(e.target.value)} />
                <Button size="sm" variant="secondary" onClick={() => void add()} loading={busy === "new"} disabled={!newSub.trim()} leadingIcon={<UserPlus weight="bold" className="h-4 w-4" />}>
                  {t("admin.users.add")}
                </Button>
              </div>
            )}
          </Field>
        </div>
        {msg ? (
          <p className="mt-3 text-xs text-muted" aria-live="polite">
            {msg}
          </p>
        ) : null}
      </Card>

      {q.loading && !q.data ? (
        <Skeleton className="h-40 rounded-control" />
      ) : q.data && q.data.users.length === 0 ? (
        <Card padding="lg" variant="inset" className="text-center text-sm text-muted">
          {t("admin.users.empty")}
        </Card>
      ) : q.data ? (
        <Card padding="sm">
          <TableWrap>
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.users.col.user")}</Th>
                  <Th>{t("admin.users.col.org")}</Th>
                  <Th>{t("admin.users.col.roles")}</Th>
                  <Th>{t("admin.users.col.lastSeen")}</Th>
                  <Th>
                    <span className="sr-only">{t("admin.users.col.actions")}</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {q.data.users.map((u) => (
                  <Tr key={u.sub}>
                    <Td>
                      <span className="block text-sm font-medium text-fg">{u.name ?? u.sub}</span>
                      <span className="block text-xs text-muted">{u.email ?? ""}</span>
                      <code className="block truncate text-[10px] text-subtle" title={u.sub}>
                        {u.sub}
                      </code>
                    </Td>
                    <Td className="text-xs text-muted">{u.org ?? ""}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("admin.users.col.roles")}>
                        {ACUDX_ROLES.map((role) => {
                          const on = u.roles.includes(role);
                          return (
                            <button
                              key={role}
                              type="button"
                              aria-pressed={on}
                              disabled={busy === u.sub}
                              onClick={() => void toggle(u, role)}
                              className={
                                "inline-flex min-h-7 items-center gap-1 rounded-chip border px-2 text-xs font-medium transition-colors focus-visible:outline-none " +
                                (on ? "border-brand bg-brand-tint text-fg" : "border-border text-muted hover:text-fg")
                              }
                            >
                              {on ? <ShieldCheck weight="fill" className="h-3 w-3" aria-hidden /> : null}
                              {t(`profile.roles.${role}`)}
                            </button>
                          );
                        })}
                      </div>
                      {u.granted_by ? (
                        <Badge tone="neutral" variant="outline" className="mt-1.5">
                          {t("admin.users.grantedBy", { by: u.granted_by })}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="text-xs text-muted">{u.last_seen_at ? formatDateTime(u.last_seen_at, locale) : t("admin.users.neverSeen")}</Td>
                    <Td>
                      <Button size="sm" variant="ghost" aria-label={t("admin.users.remove", { sub: u.sub })} onClick={() => void remove(u)} loading={busy === u.sub}>
                        <Trash weight="bold" className="h-4 w-4" aria-hidden />
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      ) : null}
    </div>
  );
}
