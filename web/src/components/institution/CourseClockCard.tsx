import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Timer } from "@phosphor-icons/react";

import { Badge, Button, Card, Field, Skeleton, TextInput } from "@/components/ui";
import { formatSimMinutes } from "@/domain/serverCatalog";
import {
  SCALE_BOUNDS,
  WAIT_CAP_BOUNDS_S,
  WAIT_CLASSES,
  realWaitsS,
  type SimClockSettings,
  type WaitClass,
} from "@/domain/simClock";
import type { OrderCategory } from "@/domain/orderCatalog";
import { panelsApi, type SimClockCourse } from "@/lib/panelsApi";
import { useLang } from "@/lib/useLang";

/** One representative order per class for the live preview (same as the server preview). */
const PREVIEW: Record<WaitClass, { category: OrderCategory; minutes: number; prelim: number | null }> = {
  poc: { category: "poc", minutes: 5, prelim: null },
  lab: { category: "lab", minutes: 50, prelim: null },
  imaging: { category: "imaging-ct", minutes: 250, prelim: 125 },
  culture: { category: "micro-culture", minutes: 2880, prelim: 1440 },
};

function inBounds(v: number, [lo, hi]: readonly [number, number]): boolean {
  return Number.isFinite(v) && v >= lo && v <= hi;
}

/**
 * CourseClockCard: the faculty's per-course encounter clock (docs/architecture/14
 * section 10). The scale compresses the sim clock; the caps bound the real wait
 * for each turnaround class. Learners' displayed times stay clinical sim time.
 */
export function CourseClockCard() {
  const { t } = useTranslation();
  const lang = useLang();
  const [course, setCourse] = useState<SimClockCourse | null>(null);
  const [draft, setDraft] = useState<SimClockSettings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void panelsApi.facultySimClock().then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setCourse(r.data);
        setDraft(r.data.settings);
      } else setMsg(t("simClock.loadFailed", { error: r.error }));
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (!draft) {
    return msg ? (
      <Card padding="lg" variant="inset" className="text-sm text-muted">
        {msg}
      </Card>
    ) : (
      <Skeleton className="h-64" />
    );
  }

  const scaleOk = inBounds(draft.scale, SCALE_BOUNDS);
  const capsOk = WAIT_CLASSES.every((k) => inBounds(draft.wait_cap_s[k], WAIT_CAP_BOUNDS_S));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft || !scaleOk || !capsOk) return;
    setBusy(true);
    const r = await panelsApi.setFacultySimClock(draft);
    setBusy(false);
    if (r.ok) {
      setCourse(r.data);
      setDraft(r.data.settings);
      setMsg(t("simClock.saved"));
    } else setMsg(t("simClock.saveFailed", { error: r.error }));
  }

  async function reset() {
    setBusy(true);
    const r = await panelsApi.resetFacultySimClock();
    setBusy(false);
    if (r.ok) {
      setCourse(r.data);
      setDraft(r.data.settings);
      setMsg(t("simClock.resetDone"));
    } else setMsg(t("simClock.saveFailed", { error: r.error }));
  }

  return (
    <Card padding="lg">
      <form onSubmit={save} className="flex flex-col gap-5" aria-labelledby="course-clock-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="course-clock-title" className="flex items-center gap-1.5 text-sm font-semibold text-fg">
              <Timer weight="bold" className="h-4 w-4 text-muted" aria-hidden />
              {t("simClock.title")}
            </h3>
            <p className="mt-1 max-w-prose text-xs text-muted">{t("simClock.body")}</p>
          </div>
          <Badge tone={course?.source === "course" ? "brand" : "neutral"}>
            {course?.source === "course" ? t("simClock.sourceCourse") : t("simClock.sourceDefault")}
          </Badge>
        </div>

        <Field
          label={t("simClock.scale")}
          hint={t("simClock.scaleHint", { min: SCALE_BOUNDS[0], max: SCALE_BOUNDS[1], sim: draft.scale })}
          error={scaleOk ? undefined : t("simClock.outOfRange", { min: SCALE_BOUNDS[0], max: SCALE_BOUNDS[1] })}
        >
          {(aria) => (
            <TextInput
              {...aria}
              type="number"
              inputMode="decimal"
              min={SCALE_BOUNDS[0]}
              max={SCALE_BOUNDS[1]}
              step="any"
              value={Number.isFinite(draft.scale) ? draft.scale : ""}
              onChange={(e) => setDraft({ ...draft, scale: Number(e.target.value) })}
              className="max-w-[8rem]"
            />
          )}
        </Field>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium text-fg">{t("simClock.caps")}</legend>
          {WAIT_CLASSES.map((k) => {
            const ok = inBounds(draft.wait_cap_s[k], WAIT_CAP_BOUNDS_S);
            return (
              <Field
                key={k}
                label={t(`simClock.class.${k}`)}
                error={ok ? undefined : t("simClock.outOfRange", { min: WAIT_CAP_BOUNDS_S[0], max: WAIT_CAP_BOUNDS_S[1] })}
              >
                {(aria) => (
                  <TextInput
                    {...aria}
                    type="number"
                    inputMode="numeric"
                    min={WAIT_CAP_BOUNDS_S[0]}
                    max={WAIT_CAP_BOUNDS_S[1]}
                    value={Number.isFinite(draft.wait_cap_s[k]) ? draft.wait_cap_s[k] : ""}
                    onChange={(e) => setDraft({ ...draft, wait_cap_s: { ...draft.wait_cap_s, [k]: Number(e.target.value) } })}
                    className="max-w-[8rem]"
                  />
                )}
              </Field>
            );
          })}
        </fieldset>

        <div>
          <p className="mb-1.5 text-sm font-medium text-fg">{t("simClock.preview")}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {WAIT_CLASSES.map((k) => {
              const p = PREVIEW[k];
              const w = scaleOk && capsOk ? realWaitsS(draft, p.category, p.minutes, p.prelim) : null;
              return (
                <li key={k} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-1 last:border-b-0">
                  <span className="text-fg">{t(`simClock.example.${k}`)}</span>
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {t("simClock.previewRow", {
                      clinical: formatSimMinutes(p.prelim ?? p.minutes, lang),
                      first: w ? Math.round(w.first) : "-",
                      final: w ? Math.round(w.final) : "-",
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy || !scaleOk || !capsOk}>
            {t("simClock.save")}
          </Button>
          <Button type="button" variant="ghost" disabled={busy || course?.source !== "course"} onClick={() => void reset()}>
            {t("simClock.reset")}
          </Button>
          {msg ? (
            <span role="status" className="text-xs text-muted">
              {msg}
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
