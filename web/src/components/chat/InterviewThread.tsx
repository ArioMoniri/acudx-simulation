import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { ChalkboardTeacher, FirstAidKit, Stethoscope, WarningOctagon, Warning, CheckCircle } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { formatClock } from "@/components/ehr/labels";
import { MessageActions } from "./MessageActions";
import { StreamingText } from "./StreamingText";
import type { ActionHandlers, Speaker, ThreadMessage } from "./types";

/**
 * InterviewThread: the interview as a clinical transcript (docs/design/05-chat.md
 * section 3). Every line is left-aligned under a speaker header (avatar, name,
 * role, sim time), consecutive lines from one speaker group under one header,
 * and the learner's lines sit on a faint inset band so the eye can scan the
 * questions. Patient replies stream in; generative components render under the
 * line that carried them; guard notes render as an attending note.
 *
 * Each message is one listitem whose text starts with the speaker ("You",
 * "Patient", ...), visible or sr-only, so the transcript reads correctly by
 * itself in a screen reader and in tests.
 */
export interface InterviewThreadProps {
  messages: ThreadMessage[];
  patientName: string;
  typing: boolean;
  handlers: ActionHandlers;
  /** Called when a streaming reply has fully revealed (keeps the log scrolled). */
  onStreamProgress?: () => void;
  emptyTitle: string;
  emptyBody: string;
}

export const InterviewThread = forwardRef<HTMLDivElement, InterviewThreadProps>(function InterviewThread(
  { messages, patientName, typing, handlers, onStreamProgress, emptyTitle, emptyBody },
  ref,
) {
  const { t } = useTranslation();

  return (
    <div
      ref={ref}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label={t("encounter.transcriptLabel")}
      tabIndex={0}
      className="min-h-[16rem] flex-1 overflow-y-auto overflow-x-hidden overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
    >
      {messages.length === 0 && !typing ? (
        <div className="flex h-full min-h-[14rem] flex-col justify-center gap-1 px-4 py-6 sm:px-5">
          <p className="font-display text-lg text-fg">{emptyTitle}</p>
          <p className="max-w-[52ch] text-sm text-muted">{emptyBody}</p>
        </div>
      ) : (
        <ol className="flex flex-col py-2">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const startsGroup = !prev || prev.speaker !== m.speaker;
            const endsGroup = !next || next.speaker !== m.speaker;
            return (
              <MessageRow
                key={m.id}
                message={m}
                patientName={patientName}
                startsGroup={startsGroup}
                endsGroup={endsGroup}
                handlers={handlers}
                onStreamProgress={onStreamProgress}
              />
            );
          })}
          {typing ? (
            <TypingRow
              patientName={patientName}
              startsGroup={messages.length === 0 || messages[messages.length - 1].speaker !== "patient"}
            />
          ) : null}
        </ol>
      )}
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/* Avatar + header                                                             */
/* -------------------------------------------------------------------------- */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "P";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

function Avatar({ speaker, patientName, hidden }: { speaker: Speaker; patientName: string; hidden?: boolean }) {
  const cls = cn(
    "grid h-7 w-7 shrink-0 select-none place-items-center rounded-control text-[11px] font-semibold",
    hidden && "invisible",
  );
  switch (speaker) {
    case "learner":
      return (
        <span aria-hidden className={cn(cls, "bg-brand text-on-brand")}>
          <Stethoscope weight="bold" className="h-3.5 w-3.5" />
        </span>
      );
    case "patient":
      return (
        <span
          aria-hidden
          data-initials={initials(patientName)}
          className={cn(cls, "border border-border-strong bg-surface text-fg before:content-[attr(data-initials)]")}
        />
      );
    case "nurse":
      return (
        <span aria-hidden className={cn(cls, "bg-bg-inset text-fg")}>
          <FirstAidKit weight="bold" className="h-3.5 w-3.5" />
        </span>
      );
    case "attending":
      return (
        <span aria-hidden className={cn(cls, "bg-ink text-ink-fg")}>
          <ChalkboardTeacher weight="bold" className="h-3.5 w-3.5" />
        </span>
      );
  }
}

function speakerName(speaker: Speaker, patientName: string, t: (k: string) => string): { name: string; role: string } {
  switch (speaker) {
    case "learner":
      return { name: t("chat.roles.learner"), role: "" };
    case "patient":
      return { name: t("chat.roles.patient"), role: patientName };
    case "nurse":
      return { name: t("chat.roles.nurse"), role: "" };
    case "attending":
      return { name: t("chat.roles.attending"), role: "" };
  }
}

function SimTime({ at }: { at: number | null }) {
  const { t } = useTranslation();
  if (at == null) return null;
  const clock = formatClock(at);
  return (
    <time
      className="font-mono text-[11px] tabular-nums text-subtle"
      dateTime={`PT${Math.floor(at / 1000)}S`}
      aria-label={t("chat.time.simLabel", { clock })}
    >
      {t("chat.time.sim", { clock })}
    </time>
  );
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

function MessageRow({
  message: m,
  patientName,
  startsGroup,
  endsGroup,
  handlers,
  onStreamProgress,
}: {
  message: ThreadMessage;
  patientName: string;
  startsGroup: boolean;
  endsGroup: boolean;
  handlers: ActionHandlers;
  onStreamProgress?: () => void;
}) {
  const { t } = useTranslation();
  const { name, role } = speakerName(m.speaker, patientName, t);
  const learner = m.speaker === "learner";

  return (
    <li
      data-speaker={m.speaker}
      data-status={m.status}
      className={cn(
        "grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 px-3 sm:px-5",
        startsGroup ? "pt-3" : "pt-1",
        endsGroup ? "pb-3" : "pb-0",
        learner && "bg-bg-subtle",
        startsGroup && "border-t border-border first:border-t-0",
      )}
    >
      <Avatar speaker={m.speaker} patientName={patientName} hidden={!startsGroup} />
      <div className="min-w-0">
        {startsGroup ? (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[0.8125rem] font-semibold text-fg">{name}</span>
            {role ? <span className="min-w-0 truncate text-xs text-muted">{role}</span> : null}
            <SimTime at={m.at} />
            {m.status === "sending" ? (
              <span className="text-[11px] text-subtle">{t("chat.status.sending")}</span>
            ) : null}
          </div>
        ) : (
          <span className="sr-only">{name}</span>
        )}

        {m.speaker === "nurse" ? (
          <NurseBody message={m} />
        ) : (
          <p
            className={cn(
              "mt-0.5 max-w-[68ch] whitespace-pre-wrap text-sm leading-relaxed text-fg [overflow-wrap:anywhere]",
              m.status === "sending" && "text-muted",
            )}
          >
            {m.speaker === "patient" ? (
              <StreamingText text={m.text} animate={Boolean(m.stream)} onDone={onStreamProgress} />
            ) : (
              m.text
            )}
          </p>
        )}

        {learner && m.intent ? (
          <span className="mt-1 inline-flex items-center rounded-chip border border-border px-1.5 py-px text-[10px] font-medium text-muted">
            {m.intent}
          </span>
        ) : null}

        {m.findings || m.awaiting ? <Findings message={m} /> : null}

        {m.speaker === "patient" && m.affect && endsGroup ? (
          <p className="mt-1 text-[11px] italic text-muted">{m.affect}</p>
        ) : null}

        {m.actions && m.actions.length > 0 ? <MessageActions actions={m.actions} handlers={handlers} /> : null}

        {m.guard ? <GuardNote label={m.guard.label} note={m.guard.note} /> : null}
      </div>
    </li>
  );
}

function NurseBody({ message: m }: { message: ThreadMessage }) {
  const Icon = m.tone === "critical" ? WarningOctagon : m.tone === "abnormal" ? Warning : CheckCircle;
  const color =
    m.tone === "critical" ? "text-state-critical" : m.tone === "abnormal" ? "text-state-warning" : "text-state-normal";
  return (
    <p className="mt-0.5 flex max-w-[68ch] items-start gap-1.5 text-sm leading-relaxed text-fg">
      <Icon weight="fill" className={cn("mt-[3px] h-3.5 w-3.5 shrink-0", color)} aria-hidden />
      <span className="min-w-0 [overflow-wrap:anywhere]">{m.text}</span>
    </p>
  );
}

function Findings({ message: m }: { message: ThreadMessage }) {
  const { t } = useTranslation();
  if (m.awaiting) return <p className="mt-1 text-xs text-muted">{t("chat.exam.awaiting")}</p>;
  const findings = m.findings ?? [];
  if (findings.length === 0) return <p className="mt-1 text-xs text-muted">{t("chat.exam.noFinding")}</p>;
  return (
    <dl className="mt-1.5 grid max-w-[68ch] grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-s-2 border-border-strong ps-3 text-[0.8125rem]">
      {findings.map((f) => (
        <div key={f.id} className="contents">
          <dt className="font-medium text-muted">{f.system}</dt>
          <dd className={cn("text-fg [overflow-wrap:anywhere]", f.abnormal && "font-medium")}>
            {f.abnormal ? (
              <Warning weight="fill" className="me-1 inline h-3 w-3 -translate-y-px text-state-warning" aria-hidden />
            ) : null}
            {f.finding}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A guard note from the reply: an attending's aside, never a red error box. */
export function GuardNote({ label, note }: { label: string; note?: string }) {
  const { t } = useTranslation();
  return (
    <aside
      className="mt-2 flex max-w-[68ch] items-start gap-2 border-s-2 border-state-caution bg-surface py-1.5 pe-2 ps-2.5"
      aria-label={t("chat.roles.attending")}
      data-testid="guard-note"
    >
      <span aria-hidden className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-chip bg-ink text-ink-fg">
        <ChalkboardTeacher weight="bold" className="h-3 w-3" />
      </span>
      <p className="min-w-0 text-xs leading-relaxed text-muted">
        <span className="font-semibold text-fg">{label}.</span>
        {note ? <> {note}</> : null}
      </p>
    </aside>
  );
}

function TypingRow({ patientName, startsGroup }: { patientName: string; startsGroup: boolean }) {
  const { t } = useTranslation();
  return (
    <li
      className={cn(
        "grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 px-3 pb-3 sm:px-5",
        startsGroup ? "border-t border-border pt-3" : "pt-1",
      )}
      data-testid="typing-indicator"
    >
      <Avatar speaker="patient" patientName={patientName} hidden={!startsGroup} />
      <div className="flex h-6 items-center">
        <span className="sr-only">{t("encounter.aiTyping")}</span>
        <span className="flex items-center gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-subtle motion-safe:animate-[fade-up_1s_ease-in-out_infinite]"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </span>
      </div>
    </li>
  );
}
