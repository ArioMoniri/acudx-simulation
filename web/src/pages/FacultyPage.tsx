import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  ArrowsClockwise,
  ClipboardText,
  PenNib,
  ShieldCheck,
  ShieldWarning,
  Signature,
  Users,
  WarningCircle,
} from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import {
  Badge,
  Button,
  Card,
  Field,
  Select,
  Skeleton,
  Table,
  TableWrap,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TBody,
  Td,
  Textarea,
  TextInput,
  Th,
  THead,
  Tr,
} from "@/components/ui";
import { reviewerFromProfile } from "@/data/authoring";
import { MAX_POINTS_PER_CASE } from "@/domain/summative";
import { useEntry, useLang } from "@/lib/useLang";
import {
  BAND_NAMES,
  DOMAIN_KEYS,
  panelsApi,
  type Assignment,
  type BandName,
  type CaseSubmission,
  type DomainKey,
  type FacultyQueue,
  type FlaggedEncounter,
  type PanelsErrorCode,
  type RosterEntry,
} from "@/lib/panelsApi";
import { useProfile } from "@/state/profileStore";

const TABS = ["queue", "roster", "assignments"] as const;
type Tab = (typeof TABS)[number];
const TAB_KEY = "acudx-faculty-tab";

function readTab(): Tab {
  try {
    const v = sessionStorage.getItem(TAB_KEY);
    return (TABS as readonly string[]).includes(v ?? "") ? (v as Tab) : "queue";
  } catch {
    return "queue";
  }
}

function fmtDate(ts: number | null | undefined, lang: string): string {
  if (!ts) return "";
  try {
    return new Intl.DateTimeFormat(lang === "tr" ? "tr" : "en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ts * 1000));
  } catch {
    return "";
  }
}

/* -------------------------------------------------------------------------- */
/* Review form: grading override with mandatory co-sign                        */
/* -------------------------------------------------------------------------- */

function ReviewForm({
  item,
  onDone,
}: {
  item: FlaggedEncounter;
  onDone: (updated: FlaggedEncounter) => void;
}) {
  const { t } = useTranslation();
  const profile = useProfile();
  const reviewer = reviewerFromProfile(profile);
  const [decision, setDecision] = useState<"upheld" | "overridden">("upheld");
  const [overrides, setOverrides] = useState<Partial<Record<DomainKey, BandName>>>({});
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");
  const [cosigned, setCosigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const scored = item.summary.domain_scores.filter((d) => d.scored);
  const hasOverride = Object.values(overrides).some(Boolean) || points.trim() !== "";
  const pointsNum = points.trim() === "" ? undefined : Number(points);
  const pointsValid = pointsNum === undefined || (Number.isInteger(pointsNum) && pointsNum >= 0 && pointsNum <= MAX_POINTS_PER_CASE);
  const canSubmit = reviewer !== null && cosigned && pointsValid && (decision === "upheld" || hasOverride);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => Boolean(v))) as Partial<Record<DomainKey, BandName>>;
    const res = await panelsApi.review(item.batch_id, {
      decision,
      note: note.trim() || undefined,
      overrides: decision === "overridden" && Object.keys(clean).length > 0 ? clean : undefined,
      points: decision === "overridden" ? pointsNum : undefined,
      cosigned: true,
    });
    setBusy(false);
    if (res.ok) onDone(res.data);
    else setErr(t("panels.faculty.review.failed", { error: res.error }));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 border-t border-border pt-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("panels.faculty.review.decision")}>
          {(aria) => (
            <Select {...aria} value={decision} onChange={(e) => setDecision(e.target.value as "upheld" | "overridden")}>
              <option value="upheld">{t("panels.faculty.review.upheld")}</option>
              <option value="overridden">{t("panels.faculty.review.overridden")}</option>
            </Select>
          )}
        </Field>
        {decision === "overridden" ? (
          <Field label={t("panels.faculty.review.points", { max: MAX_POINTS_PER_CASE })} hint={t("panels.faculty.review.pointsHint")} optional error={pointsValid ? undefined : t("panels.faculty.review.pointsError", { max: MAX_POINTS_PER_CASE })}>
            {(aria) => <TextInput {...aria} inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} />}
          </Field>
        ) : null}
      </div>

      {decision === "overridden" ? (
        <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="mb-1 text-sm font-medium text-fg">{t("panels.faculty.review.overrideBands")}</legend>
          {DOMAIN_KEYS.map((d) => {
            const current = scored.find((s) => s.key === d);
            return (
              <Field key={d} label={t(`feedback.domains.${d}`)} hint={current ? t("panels.faculty.review.currentBand", { band: t(`bands.${current.band}`) }) : t("bands.withheld")}>
                {(aria) => (
                  <Select {...aria} value={overrides[d] ?? ""} onChange={(e) => setOverrides((o) => ({ ...o, [d]: (e.target.value || undefined) as BandName | undefined }))}>
                    <option value="">{t("panels.faculty.review.keep")}</option>
                    {BAND_NAMES.map((b) => (
                      <option key={b} value={b}>
                        {t(`bands.${b}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            );
          })}
        </fieldset>
      ) : null}

      <Field label={t("panels.faculty.review.note")} optional>
        {(aria) => <Textarea {...aria} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>

      <label className="flex items-start gap-2 text-sm text-fg">
        <input type="checkbox" className="mt-1" checked={cosigned} onChange={(e) => setCosigned(e.target.checked)} disabled={reviewer === null} />
        <span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Signature weight="bold" className="h-4 w-4" aria-hidden />
            {t("panels.faculty.review.cosign")}
          </span>
          <span className="block text-xs text-muted">
            {reviewer
              ? t("panels.faculty.review.cosignAs", { name: reviewer.name, role: reviewer.role.en, institution: reviewer.institution })
              : t("panels.faculty.review.notCredentialed")}
          </span>
        </span>
      </label>

      {err ? (
        <p role="alert" className="text-xs text-[color:var(--state-critical)]">
          {err}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={!canSubmit} loading={busy}>
          {t("panels.faculty.review.submit")}
        </Button>
        {decision === "overridden" && !hasOverride ? <span className="text-xs text-muted">{t("panels.faculty.review.needOverride")}</span> : null}
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Queue                                                                       */
/* -------------------------------------------------------------------------- */

function FlaggedCard({ item, onDone }: { item: FlaggedEncounter; onDone: (u: FlaggedEncounter) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const title = item.summary.title?.[lang] ?? item.summary.title?.en ?? item.case_id;
  return (
    <Card padding="md" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">{title}</p>
          <p className="mt-0.5 text-xs text-muted">
            {item.user_name ?? item.user_hash.slice(0, 6).toUpperCase()} · {fmtDate(item.received_at, lang)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.reasons.map((r) => (
              <Badge key={r} tone="warning" icon={<WarningCircle weight="fill" className="h-3.5 w-3.5" aria-hidden />}>
                {t(`panels.faculty.reasons.${r}`)}
              </Badge>
            ))}
            {item.summary.domain_scores
              .filter((d) => d.scored)
              .map((d) => (
                <Badge key={d.key} tone="neutral" variant="outline">
                  {t(`feedback.domains.${d.key}`)}: {t(`bands.${d.band}`)}
                </Badge>
              ))}
          </div>
        </div>
        <Button size="sm" variant={open ? "ghost" : "secondary"} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? t("panels.common.close") : t("panels.faculty.review.open")}
        </Button>
      </div>
      {open ? <ReviewForm item={item} onDone={onDone} /> : null}
    </Card>
  );
}

function CaseCard({ item, onDecided }: { item: CaseSubmission; onDecided: (c: CaseSubmission) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [busy, setBusy] = useState<"approved" | "returned" | null>(null);
  async function decide(status: "approved" | "returned") {
    setBusy(status);
    const r = await panelsApi.decideCase(item.id, { status });
    setBusy(null);
    if (r.ok) onDecided(r.data);
  }
  return (
    <Card padding="md" className="flex flex-wrap items-center gap-3">
      <PenNib weight="bold" className="h-5 w-5 shrink-0 text-brand" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{item.title}</p>
        <p className="text-xs text-muted">
          {item.author_name ?? item.author_sub} · {fmtDate(item.submitted_at, lang)} · <code className="font-mono">{item.case_id}</code>
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" loading={busy === "returned"} onClick={() => void decide("returned")}>
          {t("panels.faculty.cases.return")}
        </Button>
        <Button size="sm" loading={busy === "approved"} onClick={() => void decide("approved")}>
          {t("panels.faculty.cases.approve")}
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Roster + assignments                                                        */
/* -------------------------------------------------------------------------- */

function AssignForm({ roster, onAssigned }: { roster: RosterEntry[]; onAssigned: () => void }) {
  const { t } = useTranslation();
  const [caseId, setCaseId] = useState("");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!caseId.trim() || (!all && selected.size === 0)) return;
    setBusy(true);
    const r = await panelsApi.assign({ case_id: caseId.trim(), title: title.trim() || undefined, assignees: all ? [] : [...selected], all_learners: all });
    setBusy(false);
    setMsg(r.ok ? t("panels.faculty.assign.done", { count: r.data.assigned }) : t("panels.faculty.assign.failed", { error: r.error }));
    if (r.ok) {
      setSelected(new Set());
      onAssigned();
    }
  }

  return (
    <Card padding="lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-fg">{t("panels.faculty.assign.title")}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("panels.faculty.assign.caseId")} hint={t("panels.faculty.assign.caseIdHint")}>
            {(aria) => <TextInput {...aria} value={caseId} onChange={(e) => setCaseId(e.target.value)} />}
          </Field>
          <Field label={t("panels.faculty.assign.caseTitle")} optional>
            {(aria) => <TextInput {...aria} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          {t("panels.faculty.assign.everyone")}
        </label>
        {!all ? (
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-1 text-xs text-muted">{t("panels.faculty.assign.pick")}</legend>
            {roster.map((r) => {
              const on = selected.has(r.sub);
              return (
                <label key={r.sub} className={"inline-flex cursor-pointer items-center gap-1.5 rounded-chip border px-2.5 py-1 text-xs " + (on ? "border-brand bg-brand-tint text-fg" : "border-border text-muted")}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(r.sub)) n.delete(r.sub);
                        else n.add(r.sub);
                        return n;
                      })
                    }
                  />
                  {r.name ?? r.user_hash.slice(0, 6).toUpperCase()}
                </label>
              );
            })}
            {roster.length === 0 ? <span className="text-xs text-muted">{t("panels.faculty.roster.empty")}</span> : null}
          </fieldset>
        ) : null}
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" loading={busy} disabled={!caseId.trim() || (!all && selected.size === 0)}>
            {t("panels.faculty.assign.submit")}
          </Button>
          {msg ? (
            <span className="text-xs text-muted" aria-live="polite">
              {msg}
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function RosterTable({ roster }: { roster: RosterEntry[] }) {
  const { t } = useTranslation();
  const lang = useLang();
  if (roster.length === 0) {
    return (
      <Card padding="lg" variant="inset" className="text-center text-sm text-muted">
        {t("panels.faculty.roster.empty")}
      </Card>
    );
  }
  return (
    <Card padding="sm">
      <TableWrap>
        <Table>
          <THead>
            <Tr>
              <Th>{t("panels.faculty.roster.name")}</Th>
              <Th>{t("panels.faculty.roster.roles")}</Th>
              <Th numeric>{t("panels.faculty.roster.encounters")}</Th>
              <Th numeric>{t("panels.faculty.roster.safetyMisses")}</Th>
              <Th numeric>{t("panels.faculty.roster.open")}</Th>
              <Th>{t("panels.faculty.roster.lastActive")}</Th>
            </Tr>
          </THead>
          <TBody>
            {roster.map((r) => (
              <Tr key={r.sub}>
                <Td>
                  <span className="block text-sm font-medium text-fg">{r.name ?? r.user_hash.slice(0, 6).toUpperCase()}</span>
                  {r.email ? <span className="block text-xs text-muted">{r.email}</span> : null}
                </Td>
                <Td className="text-xs text-muted">{r.roles.length ? r.roles.join(", ") : t("panels.faculty.roster.noRoles")}</Td>
                <Td numeric>{r.encounters}</Td>
                <Td numeric>{r.safety_misses}</Td>
                <Td numeric>{r.open_assignments}</Td>
                <Td className="text-xs text-muted">{fmtDate(r.last_at, lang)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </Card>
  );
}

function AssignmentsTable({ rows, roster }: { rows: Assignment[]; roster: RosterEntry[] }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = (sub: string) => roster.find((r) => r.sub === sub)?.name ?? sub.slice(0, 8);
  if (rows.length === 0) {
    return (
      <Card padding="lg" variant="inset" className="text-center text-sm text-muted">
        {t("panels.faculty.assignments.empty")}
      </Card>
    );
  }
  return (
    <Card padding="sm">
      <TableWrap>
        <Table>
          <THead>
            <Tr>
              <Th>{t("panels.faculty.assignments.case")}</Th>
              <Th>{t("panels.faculty.assignments.learner")}</Th>
              <Th>{t("panels.faculty.assignments.status")}</Th>
              <Th>{t("panels.faculty.assignments.created")}</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((a) => (
              <Tr key={a.id}>
                <Td>
                  <span className="block text-sm text-fg">{a.title ?? a.case_id}</span>
                  <code className="text-xs text-muted">{a.case_id}</code>
                </Td>
                <Td>{nameOf(a.assignee_sub)}</Td>
                <Td>
                  {a.completed_at ? (
                    <Badge tone="normal" dot>
                      {t("panels.faculty.assignments.completed")}
                    </Badge>
                  ) : (
                    <Badge tone="caution" dot>
                      {t("panels.faculty.assignments.openStatus")}
                    </Badge>
                  )}
                </Td>
                <Td className="text-xs text-muted">{fmtDate(a.created_at, lang)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * FacultyPage (/faculty): review queue (authored cases awaiting review and
 * learner encounters the server flagged), the roster, assignments, and the
 * grading override that must be co-signed by a credentialed reviewer. All data
 * comes from /v1/faculty/* (server/learning); the server enforces the role.
 */
export function FacultyPage() {
  const { t } = useTranslation();
  const entry = useEntry();
  const [tab, setTab] = useState<Tab>(readTab);
  const [queue, setQueue] = useState<FacultyQueue | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [authMode, setAuthMode] = useState<"local" | "oidc">("local");
  const [error, setError] = useState<PanelsErrorCode | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [q, r, a] = await Promise.all([panelsApi.queue(), panelsApi.roster(), panelsApi.assignments()]);
    if (q.ok) {
      setQueue(q.data);
      setAuthMode(q.authMode);
      setError(null);
    } else {
      setError(q.error);
    }
    if (r.ok) setRoster(r.data.roster);
    if (a.ok) setAssignments(a.data.assignments);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function refresh() {
    setLoading(true);
    void load();
  }

  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_KEY, tab);
    } catch {
      /* per-tab convenience only */
    }
  }, [tab]);

  const pending = (queue?.cases.length ?? 0) + (queue?.encounters.length ?? 0);

  return (
    <PageContainer width="wide">
      <motion.div {...entry} className="flex flex-col gap-6">
        <PageHeader
          eyebrow={t("panels.faculty.eyebrow")}
          title={t("panels.faculty.title")}
          description={t("panels.faculty.lede")}
          actions={
            <Button size="sm" variant="secondary" onClick={refresh} loading={loading} leadingIcon={<ArrowsClockwise weight="bold" className="h-4 w-4" />}>
              {t("panels.common.refresh")}
            </Button>
          }
          meta={
            <div className="flex flex-wrap items-center gap-2">
              {queue ? (
                <Badge tone={pending > 0 ? "warning" : "normal"} dot>
                  {t("panels.faculty.pending", { count: pending })}
                </Badge>
              ) : null}
              {queue ? (
                authMode === "local" ? (
                  <Badge tone="caution" icon={<ShieldWarning weight="fill" className="h-3.5 w-3.5" aria-hidden />} title={t("identity.badge.localHint")}>
                    {t("identity.badge.local")}
                  </Badge>
                ) : (
                  <Badge tone="normal" icon={<ShieldCheck weight="fill" className="h-3.5 w-3.5" aria-hidden />}>
                    {t("identity.badge.verified")}
                  </Badge>
                )
              ) : null}
            </div>
          }
        />

        {error ? (
          <Card padding="md" variant="inset" className="flex flex-wrap items-center gap-3">
            <WarningCircle weight="fill" className="h-5 w-5 shrink-0 text-[color:var(--state-critical)]" aria-hidden />
            <p className="min-w-0 flex-1 text-sm text-fg">
              {error === "forbidden" || error === "unauthenticated" ? t("panels.faculty.forbidden") : t("panels.faculty.unavailable", { error })}
            </p>
            <Button size="sm" variant="secondary" onClick={refresh}>
              {t("panels.common.retry")}
            </Button>
          </Card>
        ) : null}

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
          {/* Console section nav: a left list on lg+, an underline strip below. */}
          <div className="lg:sticky lg:top-16 lg:self-start">
            <TabsList aria-label={t("panels.faculty.title")} variant="vertical" className="hidden lg:flex">
              {TABS.map((k) => (
                <TabsTrigger key={k} value={k}>
                  {t(`panels.faculty.tabs.${k}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="-mx-4 overflow-x-auto px-4 lg:hidden">
              <TabsList aria-label={t("panels.faculty.title")} variant="underline" className="w-max min-w-full">
                {TABS.map((k) => (
                  <TabsTrigger key={k} value={k}>
                    {t(`panels.faculty.tabs.${k}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
          <div className="min-w-0 [&>[role=tabpanel]]:mt-0">

          <TabsContent value="queue">
            {loading && !queue ? (
              <div className="flex flex-col gap-3" aria-busy="true">
                <Skeleton className="h-20 rounded-control" />
                <Skeleton className="h-20 rounded-control" />
              </div>
            ) : queue ? (
              <div className="flex flex-col gap-8">
                <section aria-labelledby="fac-cases" className="flex flex-col gap-3">
                  <h2 id="fac-cases" className="inline-flex items-center gap-2 text-base font-semibold text-fg">
                    <PenNib weight="bold" className="h-4 w-4 text-brand" aria-hidden />
                    {t("panels.faculty.cases.heading", { count: queue.cases.length })}
                  </h2>
                  {queue.cases.length === 0 ? (
                    <p className="text-sm text-muted">{t("panels.faculty.cases.empty")}</p>
                  ) : (
                    queue.cases.map((c) => (
                      <CaseCard key={c.id} item={c} onDecided={(u) => setQueue((q) => (q ? { ...q, cases: q.cases.filter((x) => x.id !== u.id) } : q))} />
                    ))
                  )}
                </section>
                <section aria-labelledby="fac-flagged" className="flex flex-col gap-3">
                  <h2 id="fac-flagged" className="inline-flex items-center gap-2 text-base font-semibold text-fg">
                    <ClipboardText weight="bold" className="h-4 w-4 text-brand" aria-hidden />
                    {t("panels.faculty.flagged.heading", { count: queue.encounters.length })}
                  </h2>
                  {queue.encounters.length === 0 ? (
                    <p className="text-sm text-muted">{t("panels.faculty.flagged.empty")}</p>
                  ) : (
                    queue.encounters.map((e) => (
                      <FlaggedCard
                        key={e.batch_id}
                        item={e}
                        onDone={(u) =>
                          setQueue((q) =>
                            q ? { ...q, encounters: q.encounters.filter((x) => x.batch_id !== u.batch_id), recent_reviews: [u, ...q.recent_reviews] } : q,
                          )
                        }
                      />
                    ))
                  )}
                </section>
                {queue.recent_reviews.length > 0 ? (
                  <section aria-labelledby="fac-recent" className="flex flex-col gap-2">
                    <h2 id="fac-recent" className="text-sm font-semibold text-fg">
                      {t("panels.faculty.recent.heading")}
                    </h2>
                    <ul className="flex flex-col gap-1.5 text-xs text-muted">
                      {queue.recent_reviews.slice(0, 10).map((r) => (
                        <li key={r.batch_id} className="flex flex-wrap items-center gap-2">
                          <Badge tone={r.decision === "overridden" ? "brand" : "neutral"} variant="outline">
                            {r.decision ? t(`panels.faculty.review.${r.decision}`) : r.status}
                          </Badge>
                          <span>{r.case_id}</span>
                          <span>· {r.reviewer_name ?? r.reviewer_sub}</span>
                          {r.cosigned ? (
                            <span className="inline-flex items-center gap-1">
                              <Signature weight="bold" className="h-3 w-3" aria-hidden />
                              {t("panels.faculty.review.cosignedShort")}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="roster">
            <div className="flex flex-col gap-6">
              <section aria-labelledby="fac-roster">
                <h2 id="fac-roster" className="mb-3 inline-flex items-center gap-2 text-base font-semibold text-fg">
                  <Users weight="bold" className="h-4 w-4 text-brand" aria-hidden />
                  {t("panels.faculty.roster.heading", { count: roster.length })}
                </h2>
                <RosterTable roster={roster} />
              </section>
            </div>
          </TabsContent>

          <TabsContent value="assignments">
            <div className="flex flex-col gap-6">
              <AssignForm roster={roster} onAssigned={() => void load()} />
              <AssignmentsTable rows={assignments} roster={roster} />
            </div>
          </TabsContent>
          </div>
        </Tabs>
      </motion.div>
    </PageContainer>
  );
}
