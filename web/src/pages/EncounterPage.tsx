import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  PaperPlaneRight,
  Microphone,
  Paperclip,
  Flask,
  Stethoscope,
  Circle,
} from "@phosphor-icons/react";

import { PageContainer } from "@/components/shell";
import { Badge, Switch, Tooltip } from "@/components/ui";
import {
  ProgressStages,
  EncounterChat,
  GuidanceCard,
  VitalCard,
  PatientPortrait,
} from "@/components";
import {
  chestPainCase,
  transcript,
  vitals,
  guidanceHints,
  type ClinicalState,
  type VitalKey,
} from "@/data/mock";
import { useEntry, useLang } from "@/lib/useLang";
import { cn } from "@/lib/cn";

/**
 * Bedside display overrides for this encounter's snapshot (brief-specified
 * numbers). History/trend come from the mock series; state is set so the
 * icon + label reads correctly for each override.
 */
const bedside: Partial<Record<VitalKey, { value: string; state: ClinicalState }>> =
  {
    hr: { value: "112", state: "caution" },
    bp: { value: "148/92", state: "caution" },
    rr: { value: "22", state: "caution" },
    spo2: { value: "94", state: "caution" },
    temp: { value: "37.1", state: "normal" },
  };

/** EncounterPage — the signature emergency-medicine encounter screen. */
export function EncounterPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const left = useEntry();
  const right = useEntry(0.08);

  const [guidanceOn, setGuidanceOn] = useState(true);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<number | null>(null);

  // Current stage = the last stage present in the transcript (exam here).
  const currentIndex = useMemo(() => {
    const lastStage = transcript[transcript.length - 1]?.stage;
    const idx = chestPainCase.stages.findIndex((s) => s.key === lastStage);
    return idx < 0 ? 0 : idx;
  }, []);

  const currentStageKey = chestPainCase.stages[currentIndex]?.key ?? "history";
  const activeHint =
    guidanceHints.find((h) => h.stage === currentStageKey) ?? guidanceHints[0];

  const affectByTurn = {
    t2: t("encounter.affect.distress"),
    t4: t("encounter.affect.distress"),
    t6: t("encounter.affect.guarded"),
  };

  // Simulate a latency-free patient typing indicator on send (no network).
  function handleSend() {
    if (!draft.trim()) return;
    setDraft("");
    setTyping(true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => setTyping(false), 1400);
  }

  const monitorVitals = vitals.map((v) => {
    const o = bedside[v.key];
    return o ? { ...v, value: o.value, state: o.state } : v;
  });

  return (
    <PageContainer width="wide" className="flex flex-col gap-6">
      {/* Top region: case chip, stages, guidance toggle */}
      <motion.div
        {...left}
        className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="brand">
            <Stethoscope weight="bold" className="h-3.5 w-3.5" aria-hidden />
            {t("encounter.caseChip")}
          </Badge>
          <span className="text-sm text-muted">{chestPainCase.title[lang]}</span>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2.5 self-start rounded-full border border-border bg-surface px-3 py-1.5 lg:self-auto">
          <span className="text-sm font-medium text-fg">
            {t("encounter.guidance.toggle")}
          </span>
          <Switch
            checked={guidanceOn}
            onCheckedChange={setGuidanceOn}
            aria-label={t("encounter.guidance.toggle")}
          />
          <span className="text-xs text-muted">
            {t(guidanceOn ? "encounter.guidance.on" : "encounter.guidance.off")}
          </span>
        </label>
      </motion.div>

      <motion.div {...left}>
        <ProgressStages
          stages={chestPainCase.stages}
          currentIndex={currentIndex}
          lang={lang}
          ariaLabel={t("encounter.stageLabel")}
        />
      </motion.div>

      {/* Main two-column layout (stacks on mobile) */}
      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,360px)]">
        {/* LEFT: chat + composer */}
        <motion.section
          {...left}
          className="flex min-h-[520px] flex-col rounded-card border border-border bg-bg-subtle"
        >
          <EncounterChat
            turns={transcript}
            lang={lang}
            patientTyping={typing}
            affectByTurn={affectByTurn}
            className="max-h-[52vh] flex-1 px-3 sm:px-4"
          />

          {/* Composer */}
          <div className="border-t border-border p-3 sm:p-4">
            {guidanceOn && activeHint ? (
              <GuidanceCard hint={activeHint} lang={lang} className="mb-3" />
            ) : null}

            <div className="flex items-end gap-2 rounded-card border border-border bg-surface p-2">
              <div className="flex items-center gap-1">
                <Tooltip content={t("encounter.voiceMode")}>
                  <button
                    type="button"
                    aria-label={t("encounter.voiceMode")}
                    className="grid h-9 w-9 place-items-center rounded-control text-muted transition-colors duration-200 ease-out hover:bg-bg-subtle hover:text-fg focus-visible:outline-none active:scale-[0.98]"
                  >
                    <Microphone weight="bold" className="h-5 w-5" aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip content={t("encounter.attach")}>
                  <button
                    type="button"
                    aria-label={t("encounter.attach")}
                    className="grid h-9 w-9 place-items-center rounded-control text-muted transition-colors duration-200 ease-out hover:bg-bg-subtle hover:text-fg focus-visible:outline-none active:scale-[0.98]"
                  >
                    <Paperclip weight="bold" className="h-5 w-5" aria-hidden />
                  </button>
                </Tooltip>
              </div>

              <label htmlFor="composer" className="sr-only">
                {t("encounter.composerPlaceholder")}
              </label>
              <textarea
                id="composer"
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={t("encounter.composerPlaceholder")}
                className="max-h-32 min-h-[2.25rem] flex-1 resize-none bg-transparent px-1 py-2 text-sm text-fg placeholder:text-muted focus-visible:outline-none"
              />

              <button
                type="button"
                onClick={handleSend}
                disabled={!draft.trim()}
                aria-label={t("actions.send")}
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-control bg-brand text-white",
                  "transition-[background-color,transform] duration-200 ease-out",
                  "hover:bg-brand-hover focus-visible:outline-none active:scale-[0.98]",
                  "disabled:opacity-40 disabled:pointer-events-none",
                )}
              >
                <PaperPlaneRight weight="fill" className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-muted">
              {t("encounter.sendHint")}
            </p>
          </div>
        </motion.section>

        {/* RIGHT: dark vitals monitor + portrait */}
        <motion.aside
          {...right}
          aria-label={t("vitals.title")}
          className="rounded-card border p-4"
          style={{
            backgroundColor: "var(--monitor-bg)",
            borderColor: "var(--monitor-border)",
          }}
        >
          {/* Monitor header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5" aria-hidden>
                <span
                  className="absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping"
                  style={{ backgroundColor: "var(--monitor-online)" }}
                />
                <span
                  className="relative inline-flex h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: "var(--monitor-online)" }}
                />
              </span>
              <span
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--monitor-online)" }}
              >
                {t("vitals.online")}
              </span>
              <span
                className="text-xs"
                style={{ color: "var(--monitor-dim)" }}
              >
                {chestPainCase.title[lang]}
              </span>
            </div>
            <span
              className="font-mono text-[11px]"
              style={{ color: "var(--monitor-dim)" }}
            >
              {t("vitals.title")}
            </span>
          </div>

          {/* Vital cards */}
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {monitorVitals.map((v) => (
              <VitalCard key={v.key} vital={v} />
            ))}
          </div>

          {/* Visually-hidden table equivalent for the whole monitor */}
          <table className="sr-only">
            <caption>{t("vitals.table.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("vitals.table.vital")}</th>
                <th scope="col">{t("vitals.table.value")}</th>
                <th scope="col">{t("vitals.table.status")}</th>
                <th scope="col">{t("vitals.table.trend")}</th>
              </tr>
            </thead>
            <tbody>
              {monitorVitals.map((v) => (
                <tr key={v.key}>
                  <th scope="row">{t(`vitals.${v.labelKey}`)}</th>
                  <td>
                    {v.value}
                    {v.unitKey ? ` ${t(`vitals.units.${v.unitKey}`)}` : ""}
                  </td>
                  <td>{t(`states.${v.state}`)}</td>
                  <td>{t(`vitals.trend.${v.trend}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Patient portrait */}
          <div className="mt-3">
            <PatientPortrait
              caption={t("encounter.portrait.caption")}
              name={t("encounter.patient")}
            />
          </div>

          {/* Bedside action chips */}
          <div className="mt-3">
            <p
              className="mb-1.5 text-[11px] font-medium uppercase tracking-wide"
              style={{ color: "var(--monitor-dim)" }}
            >
              {t("encounter.monitorActions")}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200 ease-out focus-visible:outline-none active:scale-[0.98]"
                style={{
                  color: "var(--monitor-fg)",
                  backgroundColor:
                    "color-mix(in srgb, var(--monitor-fg) 8%, transparent)",
                }}
              >
                <Flask weight="bold" className="h-3.5 w-3.5" aria-hidden />
                {t("actions.orderTest")}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200 ease-out focus-visible:outline-none active:scale-[0.98]"
                style={{
                  color: "var(--monitor-fg)",
                  backgroundColor:
                    "color-mix(in srgb, var(--monitor-fg) 8%, transparent)",
                }}
              >
                <Stethoscope weight="bold" className="h-3.5 w-3.5" aria-hidden />
                {t("actions.requestExam")}
              </button>
            </div>
          </div>

          <p
            className="mt-3 flex items-center gap-1 text-[10px]"
            style={{ color: "var(--monitor-dim)" }}
          >
            <Circle weight="fill" className="h-1.5 w-1.5" aria-hidden />
            {t("app.eduDisclaimer")}
          </p>
        </motion.aside>
      </div>
    </PageContainer>
  );
}
