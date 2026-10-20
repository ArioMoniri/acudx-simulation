import { useEffect, useMemo, useReducer, useState } from "react";
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
import { PatientPhoto } from "@/components/PatientPhoto";
import {
  PatientViewer,
  SymptomSummary,
  photoSignsFromVitals,
} from "@/components/PatientViewer";
import { resolvePatientVisual } from "@/domain/patientIdentity";
import { useRoomsStore } from "@/components/room/roomStore";
import { EncounterClock } from "./EncounterClock";
import { conceptText, pick } from "./labels";
import {
  getCurrentVitals,
  getDiscoveredExam,
  getDiscoveredHistory,
  useEncounterState,
} from "@/state/encounterStore";
import type { Lang } from "@/data/schema";
import type { CaseInstance } from "@/domain/case";

export interface StoryboardProps {
  caseInstance: CaseInstance;
  lang: Lang;
  affectLabel: string;
}

/** One row of the care-team roster (a real room seat, or a solo bedside role). */
interface CareMember {
  key: string;
  /** Display name ("You", a teammate's name, or a role-based label). */
  name: string;
  /** Localized role line, shown muted on the right. */
  role: string;
  /** Optional trailing tag: team lead, or AI-backed. */
  tag?: string;
}

/* -------------------------------------------------------------------------- */
/* Small hooks                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Re-render on a light interval so clock-derived reads (the live vitals course)
 * evolve even though the store only emits on discrete actions — matching the
 * bedside LiveVitalsMonitor's tick. SSR-safe.
 */
function useTick(ms: number): void {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => force(), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

/* -------------------------------------------------------------------------- */
/* Section scaffold                                                            */
/* -------------------------------------------------------------------------- */

function Section({
  icon,
  title,
  count,
  headerRight,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  /** Optional trailing header slot (e.g. a live/status badge), right-aligned. */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border px-4 py-3 first:border-t-0">
      <h3 className="mb-2 flex items-center gap-1.5 eyebrow">
        <span aria-hidden className="text-subtle">
          {icon}
        </span>
        {title}
        {headerRight ? <span className="ms-auto">{headerRight}</span> : null}
        {!headerRight && typeof count === "number" && count > 0 ? (
          <span className="ms-auto rounded-full bg-bg-subtle px-1.5 text-[10px] font-medium text-muted">
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
const ITEM_ENTER = "motion-safe:animate-[fade-up_0.16s_ease-out]";

/** Compact vitals snapshot cell (mono, tabular). Shows the LIVE current value
 * (triage until the encounter clock starts). */
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
    <div className="border-b border-e border-border px-2 py-1.5">
      <p className="eyebrow text-[0.625rem] leading-none">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold leading-none tabular-nums text-fg">
        {value}
        {unit ? <span className="ms-0.5 text-[10px] font-medium text-muted">{unit}</span> : null}
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
  const [viewerOpen, setViewerOpen] = useState(false);
  // Tick so the vitals snapshot tracks the live course (the store emits only on
  // actions; clock-driven vitals evolve between them, like the bedside monitor).
  useTick(1000);
  const { patient, triageVitals, allergies } = caseInstance;

  // Live current vitals (baseline trajectory + administered treatments). Falls
  // back to the triage numbers before the encounter clock starts. This is the
  // SAME source the bedside monitor reads, so the snapshot and monitor agree.
  const liveVitals = getCurrentVitals(state);
  const vitals = liveVitals ?? triageVitals;
  const vitalsAreLive = liveVitals != null;

  const discoveredHistory = getDiscoveredHistory(state);
  // Meds + PMH are surfaced from discovered history intents (earned by asking).
  const meds = discoveredHistory.filter((h) => h.intent === "medications");
  const pmh = discoveredHistory.filter((h) => h.intent === "past-medical-history");
  const medCount = meds.length + pmh.length;

  // Exam findings are earned by requesting a maneuver (progressive disclosure).
  const discoveredExam = getDiscoveredExam(state);

  const problems = state.problemList;

  // The ONE unified visual identity — same distinct face + case name everywhere.
  const visual = resolvePatientVisual(caseInstance);
  // Signs track the LIVE vitals course (falls back to triage before the clock
  // starts) so the portrait tint + symptom summary reflect the current picture.
  const clinicalSigns = photoSignsFromVitals(vitals);
  const sexLabel = t(`common.${patient.gender === "female" ? "female" : "male"}`);
  const acuityTone = `esi-${caseInstance.acuityESI}` as StatusTone;

  // Reactive care team. When THIS encounter is being run in a multiplayer room
  // (matched by the room's shared case id), reflect the real seated roster —
  // names, roles, who is you, who is AI-backed, who holds the team-lead hat.
  // Solo, fall back to an honest, acuity-appropriate bedside context. Reading the
  // rooms store is graceful: no matching room ⇒ the solo branch.
  const roomsStore = useRoomsStore();
  const roomRuntime = useMemo(
    () =>
      roomsStore.order
        .map((rid) => roomsStore.runtimes[rid])
        .find((rt) => rt?.caseInstance?.id === caseInstance.id),
    [roomsStore, caseInstance.id],
  );
  // Only treat it as a room roster when at least one seat is actually held.
  const inRoom = Boolean(roomRuntime?.room.seats.some((s) => s.holder != null));
  const careTeam = useMemo<CareMember[]>(() => {
    if (roomRuntime && inRoom) {
      const members: CareMember[] = [];
      for (const seat of roomRuntime.room.seats) {
        const holder = seat.holder;
        if (!holder) continue; // empty seat — nobody to show
        const isMine = seat.role === roomRuntime.mine;
        members.push({
          key: seat.role,
          name: isMine ? t("ehr.careTeam.you", { defaultValue: "You" }) : holder.name,
          role: t(`rooms.role.${seat.role}`, { defaultValue: seat.role }),
          tag: seat.teamLead
            ? t("rooms.teamLead.hat", { defaultValue: "Team lead" })
            : holder.kind === "ai"
              ? t("rooms.seat.aiHeld", { defaultValue: "AI" })
              : undefined,
        });
      }
      return members;
    }

    // Solo — honest bedside context, widened for a resuscitation-acuity patient.
    const solo: CareMember[] = [
      {
        key: "you",
        name: t("ehr.careTeam.you", { defaultValue: "You" }),
        role: t("ehr.careTeam.roleClinician", { defaultValue: "Treating clinician" }),
      },
      {
        key: "nurse",
        name: t("ehr.careTeam.nurse", { defaultValue: "Triage nurse" }),
        role: t("ehr.careTeam.roleNurse", { defaultValue: "Nursing" }),
      },
    ];
    if (caseInstance.acuityESI <= 2) {
      solo.push({
        key: "charge",
        name: t("ehr.careTeam.charge", { defaultValue: "Charge nurse" }),
        role: t("ehr.careTeam.roleResus", { defaultValue: "Resuscitation support" }),
      });
    }
    return solo;
  }, [roomRuntime, inRoom, caseInstance.acuityESI, t]);

  const allergyTexts = allergies.map((a) => conceptText(a.code, lang));
  const isNkda =
    allergies.length === 1 && allergies[0].code.coding[0]?.code === "409137002";

  return (
    <aside
      aria-label={t("ehr.storyboard.label")}
      className="overflow-hidden border border-border bg-surface"
    >
      {/* Patient identity: the synthetic portrait on paper with the name in
          the display serif, matched to the demographic; physiology tints the
          face. */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
        <PatientPhoto
          sex={visual.sexAtBirth}
          age={visual.age}
          photoId={visual.photoId}
          signs={clinicalSigns}
          rr={vitals.rr}
          alt={t("ehr.storyboard.avatarAlt", {
            defaultValue: "Synthetic patient portrait — not a real individual",
          })}
          className="h-16 w-16 shrink-0 rounded-control ring-1 ring-border"
          onClick={() => setViewerOpen(true)}
          expandLabel={t("patientviewer.expand")}
        />
        <div className="min-w-0">
          <p className="serif truncate text-lg leading-tight text-fg">
            {patient.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
            <Heartbeat weight="fill" className="h-3 w-3 shrink-0 text-[color:var(--state-normal)]" aria-hidden />
            <span className="italic">{affectLabel}</span>
          </p>
          {/* Live clinical-sign summary derived from the current vitals course. */}
          <SymptomSummary vitals={vitals} className="mt-1 text-muted" />
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

      {/* Vitals snapshot — the LIVE current vitals (matches the bedside monitor);
          triage values until the encounter clock starts. */}
      <Section
        icon={<Heartbeat weight="bold" className="h-3.5 w-3.5" />}
        title={t("ehr.storyboard.vitalsSnapshot")}
        headerRight={
          vitalsAreLive ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-bg-subtle px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-[color:var(--state-normal)] motion-safe:animate-pulse"
              />
              {t("vitals.online")}
            </span>
          ) : undefined
        }
      >
        <div className="grid grid-cols-3 gap-1.5">
          <MiniVital label={t("vitals.hrShort")} value={String(vitals.hr)} unit={t("vitals.units.bpm")} />
          <MiniVital
            label={t("vitals.bpShort")}
            value={`${vitals.systolic}/${vitals.diastolic}`}
          />
          <MiniVital label={t("vitals.rrShort")} value={String(vitals.rr)} unit={t("vitals.units.brpm")} />
          <MiniVital label={t("vitals.spo2Short")} value={String(vitals.spo2)} unit={t("vitals.units.percent")} />
          <MiniVital label={t("vitals.tempShort")} value={vitals.tempC.toFixed(1)} unit={t("vitals.units.celsius")} />
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

      {/* Care team — the real room roster when this encounter runs in a room,
          otherwise an honest, acuity-appropriate solo bedside context. */}
      <Section
        icon={<UsersThree weight="bold" className="h-3.5 w-3.5" />}
        title={t("ehr.storyboard.careTeam")}
        headerRight={
          inRoom ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-bg-subtle px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-[color:var(--state-normal)] motion-safe:animate-pulse"
              />
              {t("ehr.careTeam.inRoom", { defaultValue: "In room" })}
            </span>
          ) : undefined
        }
      >
        <ul className="flex flex-col gap-1 text-xs text-fg">
          {careTeam.map((m) => (
            <li key={m.key} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{m.name}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {m.tag ? (
                  <span className="rounded-full bg-bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-muted">
                    {m.tag}
                  </span>
                ) : null}
                <span className="text-muted">{m.role}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {/* Encounter clock */}
      <Section
        icon={<ClipboardText weight="bold" className="h-3.5 w-3.5" />}
        title={t("ehr.clock.title")}
      >
        <EncounterClock variant="inline" />
      </Section>

      {/* Enlarged, symptom-aware patient view (photo + live 3D signs) */}
      <PatientViewer
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        caseInstance={caseInstance}
        affectLabel={affectLabel}
      />
    </aside>
  );
}
