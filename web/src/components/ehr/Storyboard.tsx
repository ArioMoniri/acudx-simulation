import { useTranslation } from "react-i18next";
import {
  ClipboardText,
  FirstAid,
  Heartbeat,
  Pill,
  Stethoscope,
  UsersThree,
  Warning,
  ListChecks,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import {
  DescriptionList,
  KeyValue,
  StatusDot,
  type StatusTone,
} from "@/components/ui";
import {
  signsFromVitals,
  type ClinicalSignIntensity,
} from "./PatientAvatar";
import { PatientPhoto } from "@/components/PatientPhoto";
import { EncounterClock } from "./EncounterClock";
import { conceptText, pick } from "./labels";
import {
  getDiscoveredExam,
  getDiscoveredHistory,
  useEncounterState,
} from "@/state/encounterStore";
import type { Lang } from "@/data/mock";
import type { CaseInstance } from "@/domain/case";

export interface StoryboardProps {
  caseInstance: CaseInstance;
  lang: Lang;
  affectLabel: string;
}

/* -------------------------------------------------------------------------- */
/* Section scaffold                                                            */
/* -------------------------------------------------------------------------- */

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border px-4 py-3 first:border-t-0">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span aria-hidden className="text-muted">
          {icon}
        </span>
        {title}
        {typeof count === "number" && count > 0 ? (
          <span className="ml-auto rounded-full bg-bg-subtle px-1.5 text-[10px] font-medium text-muted">
            {count}
          </span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

/** Small "nothing obtained yet" line — the progressive-disclosure empty state. */
function Sparse({ text }: { text: string }) {
  return <p className="text-xs italic text-muted">{text}</p>;
}

/**
 * Entrance for a rail item as it is newly disclosed. A single gentle fade-up so
 * the rail visibly *populates* as the student works. The global
 * `prefers-reduced-motion` rule (index.css) collapses the animation to nothing,
 * and stable React keys mean only newly mounted items animate — items already on
 * the rail stay put.
 */
const ITEM_ENTER = "motion-safe:animate-[fade-up_0.28s_ease-out]";

/** Compact vitals snapshot cell (mono, tabular). Triage values, given-at-start. */
function MiniVital({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="rounded-control border border-border bg-bg-subtle px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-fg">
        {value}
        {unit ? <span className="ml-0.5 text-[10px] font-medium text-muted">{unit}</span> : null}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Storyboard                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Storyboard — the left rail (docs §2.1). Starts sparse and populates ONLY from
 * discovered data (progressive disclosure): the problem list grows from the
 * store, history-derived context appears as the student asks. Given-at-start
 * items (demographics, triage vitals snapshot, allergies, encounter clock) are
 * always shown because they arrive with the banner.
 */
export function Storyboard({ caseInstance, lang, affectLabel }: StoryboardProps) {
  const { t } = useTranslation();
  const state = useEncounterState();
  const { patient, triageVitals, allergies } = caseInstance;

  const discoveredHistory = getDiscoveredHistory(state);
  // Meds + PMH are surfaced from discovered history intents (earned by asking).
  const meds = discoveredHistory.filter((h) => h.intent === "medications");
  const pmh = discoveredHistory.filter((h) => h.intent === "past-medical-history");
  const medCount = meds.length + pmh.length;

  // Exam findings are earned by requesting a maneuver (progressive disclosure).
  const discoveredExam = getDiscoveredExam(state);

  const problems = state.problemList;

  const clinicalSigns: ClinicalSignIntensity[] = signsFromVitals(triageVitals);
  const sexLabel = t(`common.${patient.gender === "female" ? "female" : "male"}`);
  const acuityTone = `esi-${caseInstance.acuityESI}` as StatusTone;

  const allergyTexts = allergies.map((a) => conceptText(a.code, lang));
  const isNkda =
    allergies.length === 1 && allergies[0].code.coding[0]?.code === "409137002";

  return (
    <aside
      aria-label={t("ehr.storyboard.label")}
      className="overflow-hidden rounded-card border border-border bg-surface"
    >
      {/* Patient identity — realistic synthetic portrait on the monitor-dark
          accent, matched to the demographic; physiology tints the face. */}
      <div className="flex items-center gap-3 border-b border-border bg-monitor-bg px-3 py-3">
        <PatientPhoto
          sex={patient.gender === "female" ? "female" : "male"}
          age={patient.ageYears}
          seed={caseInstance.seed}
          signs={clinicalSigns}
          alt={t("ehr.storyboard.avatarAlt", {
            defaultValue: "Synthetic patient portrait — not a real individual",
          })}
          className="h-16 w-16 shrink-0 ring-1 ring-white/10"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-monitor-fg">
            {patient.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-monitor-dim">
            <Heartbeat weight="fill" className="h-3 w-3 shrink-0 text-monitor-online" aria-hidden />
            <span className="italic">{affectLabel}</span>
          </p>
        </div>
      </div>

      {/* Demographics — identifiers as a dense key/value record (Attio/Heidi). */}
      <div className="border-b border-border px-4 py-3">
        <DescriptionList
          layout="rows"
          divided
          aria-label={t("ehr.storyboard.demographics")}
        >
          <KeyValue label={t("ehr.banner.mrn")} value={patient.mrn} mono />
          <KeyValue
            label={t("ehrPolish.age")}
            value={<span className="tnum">{patient.ageYears}</span>}
          />
          <KeyValue label={t("ehrPolish.sex")} value={sexLabel} />
          <KeyValue
            label={t("ehrPolish.acuity")}
            value={
              <StatusDot
                tone={acuityTone}
                label={t("ehr.banner.esi", { level: caseInstance.acuityESI })}
              />
            }
          />
          {patient.weightKg ? (
            <KeyValue
              label={t("ehr.storyboard.weight")}
              value={`${patient.weightKg} kg`}
              mono
            />
          ) : null}
        </DescriptionList>
      </div>

      {/* Progressive-disclosure cue: the rail fills in as the chart is worked */}
      <p className="border-b border-border px-4 py-1.5 text-[11px] italic text-muted">
        {t("ehr.storyboard.populateHint")}
      </p>

      {/* Problem list — grows from the store */}
      <Section
        icon={<ListChecks weight="bold" className="h-3.5 w-3.5" />}
        title={t("ehr.storyboard.problemList")}
        count={problems.length}
      >
        {problems.length === 0 ? (
          <Sparse text={t("ehr.storyboard.problemsEmpty")} />
        ) : (
          <ul className="flex flex-col gap-1">
            {problems.map((p, i) => (
              <li
                key={`${p.code}-${p.role}-${i}`}
                className={cn(
                  "flex items-center justify-between gap-2 text-xs",
                  ITEM_ENTER,
                )}
              >
                <span className="min-w-0 truncate text-fg">{p.display}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                    p.role === "working"
                      ? "bg-brand-tint text-brand"
                      : "bg-bg-subtle text-muted",
                  )}
                >
                  {t(`ehr.problemRole.${p.role}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Allergies (given at start) */}
      <Section
        icon={<Warning weight="bold" className="h-3.5 w-3.5" />}
        title={t("ehr.banner.allergies")}
      >
        {isNkda ? (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <FirstAid weight="bold" className="h-3.5 w-3.5" aria-hidden />
            {t("ehr.banner.nkda")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {allergyTexts.map((a, i) => (
              <li
                key={i}
                className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--state-critical)]"
              >
                <Warning weight="fill" className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {a}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Vitals snapshot (triage, given at start) */}
      <Section
        icon={<Heartbeat weight="bold" className="h-3.5 w-3.5" />}
        title={t("ehr.storyboard.vitalsSnapshot")}
      >
        <div className="grid grid-cols-3 gap-1.5">
          <MiniVital label={t("vitals.hrShort")} value={String(triageVitals.hr)} unit={t("vitals.units.bpm")} />
          <MiniVital
            label={t("vitals.bpShort")}
            value={`${triageVitals.systolic}/${triageVitals.diastolic}`}
          />
          <MiniVital label={t("vitals.rrShort")} value={String(triageVitals.rr)} unit={t("vitals.units.brpm")} />
          <MiniVital label={t("vitals.spo2Short")} value={String(triageVitals.spo2)} unit={t("vitals.units.percent")} />
          <MiniVital label={t("vitals.tempShort")} value={triageVitals.tempC.toFixed(1)} unit={t("vitals.units.celsius")} />
        </div>
      </Section>

      {/* Meds — earned by asking (medications intent) */}
      <Section
        icon={<Pill weight="bold" className="h-3.5 w-3.5" />}
        title={t("ehr.storyboard.medList")}
        count={medCount}
      >
        {medCount === 0 ? (
          <Sparse text={t("ehr.storyboard.medsEmpty")} />
        ) : (
          <ul className="flex flex-col gap-1 text-xs text-fg">
            {meds.map((m) => (
              <li key={m.id} className={ITEM_ENTER}>
                {pick(m.answer, lang)}
              </li>
            ))}
            {pmh.map((h) => (
              <li key={h.id} className={cn("text-muted", ITEM_ENTER)}>
                {pick(h.answer, lang)}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Exam findings — earned by requesting a maneuver */}
      <Section
        icon={<Stethoscope weight="bold" className="h-3.5 w-3.5" />}
        title={t("ehr.storyboard.examFindings")}
        count={discoveredExam.length}
      >
        {discoveredExam.length === 0 ? (
          <Sparse text={t("ehr.storyboard.examEmpty")} />
        ) : (
          <ul className="flex flex-col gap-1.5 text-xs">
            {discoveredExam.map((f) => (
              <li key={f.id} className={cn("flex items-start gap-1.5", ITEM_ENTER)}>
                {f.abnormal ? (
                  <Warning
                    weight="fill"
                    className="mt-0.5 h-3 w-3 shrink-0 text-[color:var(--state-warning)]"
                    aria-hidden
                  />
                ) : (
                  <span
                    aria-hidden
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--state-normal)]"
                  />
                )}
                <span className="min-w-0">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted">
                    {pick(f.system, lang)}
                  </span>
                  <span
                    className={cn(
                      "block",
                      f.abnormal ? "font-medium text-fg" : "text-fg",
                    )}
                  >
                    {pick(f.finding, lang)}
                  </span>
                  <span className="sr-only">
                    {f.abnormal
                      ? t("ehr.storyboard.abnormalFlag")
                      : t("ehr.storyboard.normalFlag")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Care team (fixed context) */}
      <Section
        icon={<UsersThree weight="bold" className="h-3.5 w-3.5" />}
        title={t("ehr.storyboard.careTeam")}
      >
        <ul className="flex flex-col gap-1 text-xs text-fg">
          <li className="flex items-center justify-between gap-2">
            <span>{t("ehr.careTeam.you")}</span>
            <span className="text-muted">{t("ehr.careTeam.roleClinician")}</span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span>{t("ehr.careTeam.nurse")}</span>
            <span className="text-muted">{t("ehr.careTeam.roleNurse")}</span>
          </li>
        </ul>
      </Section>

      {/* Encounter clock */}
      <Section
        icon={<ClipboardText weight="bold" className="h-3.5 w-3.5" />}
        title={t("ehr.clock.title")}
      >
        <EncounterClock variant="inline" />
      </Section>
    </aside>
  );
}
