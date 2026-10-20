/**
 * AcuDx - server event sync.
 *
 * When the progress store records a finished encounter, the raw EncounterEvent
 * log plus the grade / calibration summary is posted to
 * POST /v1/events/encounter (server/learning) so dean and faculty panels read
 * real server data. The post carries the person's identity (bearer or the
 * unverified local headers, see src/lib/panelsApi.ts). Failures are retried on
 * the next record and never affect the local progress store.
 */

import { type EncounterBatchWire, type IngestResult, type PanelsApi, panelsApi } from "@/lib/panelsApi";
import { onEncounterRecorded, type EncounterRecord } from "@/state/progressStore";
import type { EncounterEvent } from "@/state/encounterStore";

export type SyncState = "idle" | "sent" | "failed";

export interface SyncOutcome {
  encounterId: string;
  state: SyncState;
  result?: IngestResult;
  error?: string;
}

/** Pure: shape one record + log into the wire batch the server validates. */
export function toEncounterBatch(record: EncounterRecord, events: EncounterEvent[]): EncounterBatchWire {
  return {
    encounter_id: record.id,
    case_id: record.caseId,
    started_at: record.sourceKey,
    ended_at: record.at,
    events: events.map((e) => ({ seq: e.seq, type: e.type, ref: e.ref, at: e.at, meta: e.meta ?? null })),
    summary: {
      title: { en: record.title.en, tr: record.title.tr },
      domain_scores: record.domainScores.map((d) => ({
        key: d.key,
        axis: d.axis,
        band: d.band,
        competence: clamp01(d.competence),
        confidence: clamp01(d.confidence),
        scored: d.scored,
      })),
      calibration: record.calibration.map((c) => ({ ...c })),
      overall_gap: record.overallGap,
      brier: record.brier,
      diagnosis_correct: record.diagnosisCorrect,
      safety_miss: record.safetyMiss,
      expected_intent_count: record.expectedIntentCount,
      metrics: {
        history_coverage_pct: record.metrics.historyCoveragePct,
        question_count: record.metrics.questionCount,
        diagnosis_correct: record.metrics.diagnosisCorrect,
      },
    },
  };
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}

const pending = new Map<string, EncounterBatchWire>();
const outcomes = new Map<string, SyncOutcome>();
const outcomeListeners = new Set<(o: SyncOutcome) => void>();

export function onSyncOutcome(l: (o: SyncOutcome) => void): () => void {
  outcomeListeners.add(l);
  return () => {
    outcomeListeners.delete(l);
  };
}

export function lastSyncOutcome(encounterId: string): SyncOutcome | undefined {
  return outcomes.get(encounterId);
}

async function flush(api: PanelsApi): Promise<void> {
  for (const [id, batch] of [...pending.entries()]) {
    const res = await api.postEncounter(batch);
    const outcome: SyncOutcome = res.ok
      ? { encounterId: id, state: "sent", result: res.data }
      : { encounterId: id, state: "failed", error: res.error };
    if (res.ok || res.error === "validation" || res.error === "forbidden") pending.delete(id);
    outcomes.set(id, outcome);
    for (const l of outcomeListeners) l(outcome);
  }
}

let installed = false;

/** Subscribe the sync to the progress store once (idempotent). Returns the unsubscribe. */
export function installEventSync(api: PanelsApi = panelsApi): () => void {
  if (installed) return () => undefined;
  installed = true;
  const off = onEncounterRecorded((record, events) => {
    pending.set(record.id, toEncounterBatch(record, events));
    void flush(api);
  });
  return () => {
    installed = false;
    off();
  };
}

/** Re-send anything still pending (e.g. after signing in). */
export function retryEventSync(api: PanelsApi = panelsApi): Promise<void> {
  return flush(api);
}
