import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  PencilRuler,
  FlowArrow,
  Blueprint,
  ShieldCheck,
  SealCheck,
  Pulse,
  Robot,
} from "@phosphor-icons/react";

import { PageContainer } from "@/components/shell";
import { SimBadge } from "@/components/ehr";
import { useEntry } from "@/lib/useLang";
import {
  PipelineRail,
  BlueprintCard,
  CaseEditor,
  SignOffGate,
  MonitorList,
} from "@/components/authoring";

/* -------------------------------------------------------------------------- */
/* Section heading helper                                                      */
/* -------------------------------------------------------------------------- */

function SectionHeading({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof FlowArrow;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Icon weight="bold" className="h-5 w-5 text-brand" aria-hidden />
        <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * AuthoringPage — the educator case-authoring surface (Journey 7, AU-1/AU-2).
 *
 * The AI-drafts / human-authoritative pipeline rendered as a visual spine
 * (blueprint -> AI draft -> expert review & lock -> peer/psychometric ->
 * publish + version -> monitor), followed by the review editor stub (locked
 * facts + provenance on cited guideline facts), a peer/psychometric pre-flight,
 * and a credentialed-clinician SIGN-OFF gate that must be co-signed to publish.
 * Every clinical claim is cited and versioned; a flagged (ungrounded) fact
 * hard-blocks publish. Everything is SIM / synthetic and education only.
 */
export function AuthoringPage() {
  const { t } = useTranslation();
  const header = useEntry();
  const pipeline = useEntry(0.06);
  const blueprint = useEntry(0.1);
  const editor = useEntry(0.14);
  const signoff = useEntry(0.18);
  const monitor = useEntry(0.22);

  return (
    <PageContainer width="wide" className="flex flex-col gap-10">
      {/* Header */}
      <motion.header {...header} className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            <PencilRuler weight="bold" className="h-3.5 w-3.5" aria-hidden />
            {t("authoring.eyebrow")}
          </span>
          <SimBadge variant="chip" />
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {t("authoring.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">
          {t("authoring.subtitle")}
        </p>
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted">
          <Robot weight="bold" className="h-3.5 w-3.5" aria-hidden />
          {t("authoring.aiHumanNote")}
        </p>
      </motion.header>

      {/* The six-stage pipeline */}
      <motion.section {...pipeline} aria-labelledby="authoring-pipeline">
        <SectionHeading
          icon={FlowArrow}
          title={t("authoring.pipeline.heading")}
          subtitle={t("authoring.pipeline.headingSub")}
        />
        <span id="authoring-pipeline" className="sr-only">
          {t("authoring.pipeline.heading")}
        </span>
        <PipelineRail />
      </motion.section>

      {/* Blueprint (Stage 1) */}
      <motion.section {...blueprint} aria-labelledby="authoring-blueprint">
        <SectionHeading
          icon={Blueprint}
          title={t("authoring.blueprint.heading")}
          subtitle={t("authoring.blueprint.headingSub")}
        />
        <span id="authoring-blueprint" className="sr-only">
          {t("authoring.blueprint.heading")}
        </span>
        <BlueprintCard />
      </motion.section>

      {/* Review editor (Stage 3, the human-authoritative core) */}
      <motion.section {...editor} aria-labelledby="authoring-editor">
        <SectionHeading
          icon={ShieldCheck}
          title={t("authoring.editor.heading")}
          subtitle={t("authoring.editor.headingSub")}
        />
        <span id="authoring-editor" className="sr-only">
          {t("authoring.editor.heading")}
        </span>
        <CaseEditor />
      </motion.section>

      {/* Sign-off gate (Stages 4 to 5) */}
      <motion.section {...signoff} aria-labelledby="authoring-signoff">
        <SectionHeading
          icon={SealCheck}
          title={t("authoring.signoff.sectionHeading")}
          subtitle={t("authoring.signoff.sectionSub")}
        />
        <span id="authoring-signoff" className="sr-only">
          {t("authoring.signoff.sectionHeading")}
        </span>
        <SignOffGate />
      </motion.section>

      {/* Monitor (Stage 6) */}
      <motion.section {...monitor} aria-labelledby="authoring-monitor">
        <SectionHeading
          icon={Pulse}
          title={t("authoring.monitor.heading")}
          subtitle={t("authoring.monitor.headingSub")}
        />
        <span id="authoring-monitor" className="sr-only">
          {t("authoring.monitor.heading")}
        </span>
        <MonitorList />
      </motion.section>

      <p className="text-xs text-muted">{t("authoring.eduNote")}</p>
    </PageContainer>
  );
}
