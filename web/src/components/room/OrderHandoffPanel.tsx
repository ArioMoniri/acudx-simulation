import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Pill,
  TestTube,
  Syringe,
  HandGrabbing,
  CircleDashed,
  CheckCircle,
  Hourglass,
  Clock,
  Prohibit,
  Prescription,
  ArrowRight,
} from "@phosphor-icons/react";

import { Badge, Button, SectionLabel, type BadgeProps } from "@/components/ui";
import { cn } from "@/lib/cn";
import { TREATMENT_CATALOG } from "@/domain/treatments";
import { primaryCode } from "@/domain/case";
import type { Lang } from "@/data/mock";
import type { ClinicalRole } from "@/data/rooms";
import {
  placeOrderAs,
  claimTask,
  completeTask,
  type RoomCaseState,
  type RoomTask,
} from "./roomCaseStore";

export interface OrderHandoffPanelProps {
  roomId: string;
  state: RoomCaseState;
  lang: Lang;
  /** The role this device currently acts as (drives what controls are live). */
  actingRole: ClinicalRole;
}

/** Status → badge tone + icon (never colour-only). */
const STATUS_META: Record<
  RoomTask["status"],
  { tone: BadgeProps["tone"]; Icon: typeof CircleDashed }
> = {
  pending: { tone: "caution", Icon: CircleDashed },
  claimed: { tone: "brand", Icon: HandGrabbing },
  done: { tone: "normal", Icon: CheckCircle },
};

/**
 * OrderHandoffPanel — the collaborative core (order → task → execute). The
 * doctor composes orders from the medication catalog + the case's expected
 * workup; each order lands in the executing role's queue as a task with a
 * realistic turnaround. The nurse (or whoever holds that seat) claims and
 * completes it: administering a medication feeds the shared clinical-course
 * engine so the patient's live vitals respond, while a diagnostic resolves its
 * result after its turnaround. Every state is carried by an icon + text label.
 */
export function OrderHandoffPanel({ roomId, state, lang, actingRole }: OrderHandoffPanelProps) {
  const { t } = useTranslation();
  const canOrder = actingRole === "doctor";

  const diagnostics = useMemo(
    () =>
      state.caseInstance.expectedWorkup.map((w) => ({
        code: primaryCode(w.code),
        label: w.label,
      })),
    [state.caseInstance],
  );

  // Newest first so a just-placed order is immediately visible.
  const tasks = useMemo(() => [...state.tasks].reverse(), [state.tasks]);

  const roleName = (r: ClinicalRole) => t(`roomscollab.roles.${r}`);

  return (
    <div className="flex flex-col gap-4">
      {/* Order composer (doctor) */}
      <section
        aria-label={t("roomscollab.orders.title")}
        className="rounded-card border border-border bg-surface p-4"
      >
        <div className="flex items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-brand-tint text-brand">
            <Prescription weight="bold" className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">{t("roomscollab.orders.title")}</h2>
            <p className="mt-0.5 text-xs text-muted">{t("roomscollab.orders.subtitle")}</p>
          </div>
        </div>

        {canOrder ? (
          <div className="mt-4 flex flex-col gap-4">
            {/* Medications */}
            <div>
              <SectionLabel icon={<Pill weight="bold" className="h-3.5 w-3.5" aria-hidden />}>
                {t("roomscollab.orders.medications")}
              </SectionLabel>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {TREATMENT_CATALOG.map((tx) => (
                  <button
                    key={tx.code}
                    type="button"
                    onClick={() => placeOrderAs(roomId, "doctor", tx.code)}
                    aria-label={t("roomscollab.orders.placeAria", { name: tx.label[lang] })}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1.5 rounded-control border border-border bg-bg-subtle px-2.5 text-xs font-medium text-fg",
                      "transition-colors duration-200 hover:border-brand hover:bg-brand-tint hover:text-brand focus-visible:outline-none",
                    )}
                  >
                    <Pill weight="bold" className="h-3.5 w-3.5 text-muted" aria-hidden />
                    {tx.label[lang]}
                  </button>
                ))}
              </div>
            </div>

            {/* Diagnostics from the case's expected workup */}
            {diagnostics.length > 0 ? (
              <div>
                <SectionLabel icon={<TestTube weight="bold" className="h-3.5 w-3.5" aria-hidden />}>
                  {t("roomscollab.orders.diagnostics")}
                </SectionLabel>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {diagnostics.map((d) => (
                    <button
                      key={d.code}
                      type="button"
                      onClick={() => placeOrderAs(roomId, "doctor", d.code, { label: d.label })}
                      aria-label={t("roomscollab.orders.placeAria", { name: d.label[lang] })}
                      className={cn(
                        "inline-flex min-h-9 items-center gap-1.5 rounded-control border border-border bg-bg-subtle px-2.5 text-xs font-medium text-fg",
                        "transition-colors duration-200 hover:border-brand hover:bg-brand-tint hover:text-brand focus-visible:outline-none",
                      )}
                    >
                      <TestTube weight="bold" className="h-3.5 w-3.5 text-muted" aria-hidden />
                      {d.label[lang]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 flex items-start gap-2 rounded-control border border-border bg-bg-subtle px-3 py-2.5">
            <Prohibit weight="bold" className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
            <p className="text-xs leading-relaxed text-muted">{t("roomscollab.orders.doctorOnly")}</p>
          </div>
        )}
      </section>

      {/* Shared task queue */}
      <section
        aria-label={t("roomscollab.task.queueTitle")}
        className="rounded-card border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-fg">{t("roomscollab.task.queueTitle")}</h2>
            <p className="mt-0.5 text-xs text-muted">{t("roomscollab.task.queueSubtitle")}</p>
          </div>
        </div>

        {tasks.length === 0 ? (
          <p className="mt-4 rounded-control border border-dashed border-border bg-bg-subtle px-3 py-6 text-center text-sm text-muted">
            {t("roomscollab.task.empty")}
          </p>
        ) : (
          <ol className="mt-3 flex flex-col gap-2.5">
            {tasks.map((task) => {
              const status = STATUS_META[task.status];
              const mine = actingRole === task.assignedRole;
              const isMed = task.kind === "medication";
              const resultReady = state.results.some((r) => r.taskId === task.id);
              const KindIcon = isMed ? Pill : TestTube;

              return (
                <li
                  key={task.id}
                  className="rounded-control border border-border bg-bg-subtle p-3"
                >
                  {/* Title + kind + status */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-control bg-surface text-muted">
                      <KindIcon weight="bold" className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                      {task.label[lang]}
                    </span>
                    <Badge tone={status.tone} icon={<status.Icon weight="fill" className="h-3 w-3" aria-hidden />}>
                      {t(`roomscollab.task.status.${task.status}`)}
                    </Badge>
                  </div>

                  {/* Meta: routing + ETA */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                    <span className="inline-flex items-center gap-1">
                      {t("roomscollab.task.orderedBy", { role: roleName(task.orderedBy) })}
                      <ArrowRight weight="bold" className="h-3 w-3" aria-hidden />
                      {t("roomscollab.task.for", { role: roleName(task.assignedRole) })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock weight="bold" className="h-3 w-3" aria-hidden />
                      {t("roomscollab.task.eta", { eta: task.etaLabel[lang] })}
                    </span>
                    <span className="rounded-full bg-surface px-1.5 py-0.5 font-medium">
                      {t(`roomscollab.task.kind.${task.kind}`)}
                    </span>
                  </div>

                  {/* Lifecycle + actions */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {task.status === "pending" ? (
                      mine ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => claimTask(roomId, actingRole, task.id)}
                            aria-label={t("roomscollab.task.claimAria", { name: task.label[lang] })}
                            leadingIcon={<HandGrabbing weight="bold" className="h-3.5 w-3.5" />}
                          >
                            {t("roomscollab.task.claim")}
                          </Button>
                          <ExecuteButton
                            isMed={isMed}
                            onClick={() => completeTask(roomId, actingRole, task.id)}
                            label={task.label[lang]}
                          />
                        </>
                      ) : (
                        <NotYours role={roleName(task.assignedRole)} />
                      )
                    ) : task.status === "claimed" ? (
                      <>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-brand">
                          <HandGrabbing weight="fill" className="h-3.5 w-3.5" aria-hidden />
                          {t("roomscollab.task.claimedBy", {
                            role: task.claimedByAi ? t("rooms.seat.aiHeld") : roleName(task.claimedBy ?? task.assignedRole),
                          })}
                        </span>
                        {mine ? (
                          <ExecuteButton
                            isMed={isMed}
                            onClick={() => completeTask(roomId, actingRole, task.id)}
                            label={task.label[lang]}
                          />
                        ) : (
                          <NotYours role={roleName(task.assignedRole)} />
                        )}
                      </>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[color:var(--state-normal)]">
                          <CheckCircle weight="fill" className="h-3.5 w-3.5" aria-hidden />
                          {t("roomscollab.task.doneBy", {
                            role: task.completedByAi ? t("rooms.seat.aiHeld") : roleName(task.completedBy ?? task.assignedRole),
                          })}
                        </span>
                        {!isMed ? (
                          resultReady ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-fg">
                              <CheckCircle weight="fill" className="h-3 w-3 text-[color:var(--state-normal)]" aria-hidden />
                              {t("roomscollab.task.resultReady")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
                              <Hourglass weight="bold" className="h-3 w-3 motion-safe:animate-pulse" aria-hidden />
                              {t("roomscollab.task.resultPending")}
                            </span>
                          )
                        ) : null}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

function ExecuteButton({
  isMed,
  onClick,
  label,
}: {
  isMed: boolean;
  onClick: () => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <Button
      size="sm"
      variant="primary"
      onClick={onClick}
      aria-label={
        isMed
          ? t("roomscollab.task.administerAria", { name: label })
          : t("roomscollab.task.collectAria", { name: label })
      }
      leadingIcon={
        isMed ? (
          <Syringe weight="bold" className="h-3.5 w-3.5" />
        ) : (
          <TestTube weight="bold" className="h-3.5 w-3.5" />
        )
      }
    >
      {isMed ? t("roomscollab.task.administer") : t("roomscollab.task.collect")}
    </Button>
  );
}

function NotYours({ role }: { role: string }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
      <Prohibit weight="bold" className="h-3.5 w-3.5" aria-hidden />
      {t("roomscollab.task.notYours", { role })}
    </span>
  );
}
