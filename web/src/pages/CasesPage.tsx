import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowRight, ClockCounterClockwise, FilePlus } from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import { Button, Card, Field, Select, SectionLabel } from "@/components/ui";
import { SimBadge } from "@/components/ehr";
import { useLang } from "@/lib/useLang";
import { useReveal } from "@/lib/motion";
import { CHIEF_COMPLAINT_FAMILIES, type ChiefComplaintFamily } from "@/domain/caseGen";
import { COMPLAINT_LABELS, DIFFICULTY_BAND } from "@/data/caseLibrary";
import { listMyCases, type MyCaseRow } from "@/lib/caseGenV2";
import type { StartSelection } from "./StartPage";

const DIFFICULTIES: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5];
const FAMILIES: ChiefComplaintFamily[] = CHIEF_COMPLAINT_FAMILIES.map((f) => f.id);

/**
 * CasesPage: the case REQUEST page (owner decision, review 06a P9 to P11). There
 * is no library: every case is generated on request by the model and changes in
 * flight. The page offers
 *
 *   1. the request form (complaint family, difficulty) and "Generate a fresh case",
 *   2. one request row per presentation, each starting a NEW case for it,
 *   3. the learner's own history of generated encounters (summaries from
 *      GET /v2/cases/mine, never a case to replay).
 *
 * Every Start navigates to /encounter with a request (a StartSelection), exactly
 * like the Start page; the encounter generates the case there.
 */
export function CasesPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const header = useReveal();
  const genEntry = useReveal(0.05);
  const listEntry = useReveal(0.09);

  const [complaint, setComplaint] = useState<ChiefComplaintFamily | null>(null);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [history, setHistory] = useState<MyCaseRow[] | null>(null);
  const [historyError, setHistoryError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void listMyCases({ signal: controller.signal }).then((res) => {
      if (controller.signal.aborted) return;
      if (res.ok) setHistory(res.data.cases);
      else setHistoryError(true);
    });
    return () => controller.abort();
  }, []);

  const request = (cc: ChiefComplaintFamily | null, diff: 1 | 2 | 3 | 4 | 5) => {
    const start: StartSelection = { mode: "solo", role: "doctor", chiefComplaint: cc, difficulty: diff, guidance: true };
    navigate("/encounter", { state: { start } });
  };

  return (
    <PageContainer width="wide" className="flex flex-col gap-6">
      <motion.div {...header}>
        <PageHeader
          eyebrow={t("cases.eyebrow")}
          title={t("cases.title")}
          description={t("oncase.request.hint")}
          meta={<SimBadge variant="chip" />}
        />
      </motion.div>

      <motion.section {...genEntry} aria-labelledby="cases-generate-heading">
        <Card padding="md" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <SectionLabel icon={<FilePlus weight="bold" className="h-3.5 w-3.5" />}>
              {t("select2.cases.generator.eyebrow")}
            </SectionLabel>
            <h2 id="cases-generate-heading" className="text-base font-semibold tracking-tight text-fg">
              {t("cases.generate.heading")}
            </h2>
            <p className="max-w-2xl text-[0.8125rem] text-muted">{t("oncase.request.hint")}</p>
          </div>
          <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Field label={t("cases.generate.complaintLegend")}>
              {(aria) => (
                <Select
                  {...aria}
                  value={complaint ?? "surprise"}
                  onChange={(e) =>
                    setComplaint(e.target.value === "surprise" ? null : (e.target.value as ChiefComplaintFamily))
                  }
                >
                  <option value="surprise">{t("cases.generate.surprise")}</option>
                  {FAMILIES.map((c) => (
                    <option key={c} value={c}>
                      {COMPLAINT_LABELS[c][lang]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("cases.generate.difficultyLegend")}>
              {(aria) => (
                <Select
                  {...aria}
                  value={String(difficulty)}
                  onChange={(e) => setDifficulty(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {d} · {DIFFICULTY_BAND[d][lang]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button
              size="md"
              onClick={() => request(complaint, difficulty)}
              leadingIcon={<FilePlus weight="bold" className="h-4 w-4" />}
              className="h-9"
            >
              {t("livegen.endless")}
            </Button>
          </div>
        </Card>
      </motion.section>

      <motion.section {...listEntry} aria-labelledby="cases-presentations-heading" className="flex flex-col gap-3">
        <h2 id="cases-presentations-heading" className="text-sm font-semibold text-fg">
          {t("cases.generate.complaintLegend")}
        </h2>
        <p className="text-xs text-muted">{t("oncase.recommended.hint")}</p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {FAMILIES.map((c) => (
            <li
              key={c}
              className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-3 py-2.5"
            >
              <span className="min-w-0 truncate text-sm text-fg">{COMPLAINT_LABELS[c][lang]}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => request(c, difficulty)}
                trailingIcon={<ArrowRight weight="bold" className="h-3.5 w-3.5" />}
              >
                {t("actions.start")}
              </Button>
            </li>
          ))}
        </ul>
      </motion.section>

      <section aria-labelledby="cases-history-heading" className="flex flex-col gap-3">
        <h2 id="cases-history-heading" className="flex items-center gap-2 text-sm font-semibold text-fg">
          <ClockCounterClockwise weight="bold" className="h-4 w-4" aria-hidden />
          {t("oncase.history.title")}
        </h2>
        {historyError ? (
          <p className="text-xs text-muted">{t("oncase.history.unavailable")}</p>
        ) : history == null ? null : history.length === 0 ? (
          <p className="text-xs text-muted">{t("oncase.history.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
            {history.map((row) => (
              <li key={row.thread_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-fg">
                  {t("oncase.history.row", { complaint: row.complaint, age: row.age ?? "", sex: row.sex ?? "" })}
                </span>
                <span className="flex items-center gap-3 text-xs text-muted">
                  {row.acuity_esi ? <span>{t("oncase.history.esi", { esi: row.acuity_esi })}</span> : null}
                  <span>{row.committed ? t("oncase.history.committed") : t("oncase.history.open")}</span>
                  <time dateTime={new Date(row.created_at * 1000).toISOString()}>
                    {new Date(row.created_at * 1000).toLocaleString(lang)}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}
