/**
 * AcuDx: which history facts the patient persona may use on one turn.
 *
 * Review 06a 2.2: the interview used to send EVERY history answer as sanctioned, so the
 * fact gate could not catch premature disclosure and the Director's progressive reveal
 * added nothing. The persona now gets only what the learner's actual questions have
 * sanctioned: answers already revealed, plus the answers to the question asked now.
 *
 * Pure. Education only.
 */

import type { CaseInstance } from "@/domain/case";

export interface PersonaFacts {
  /** Facts the patient may state on this turn. */
  sanctioned: string[];
  /** The patient's qualitative knowledge for this turn (complaint + sanctioned facts). */
  narrative: string[];
}

export function personaFacts(
  c: CaseInstance,
  discovered: ReadonlySet<string>,
  lang: "en" | "tr",
  intent: string | null,
): PersonaFacts {
  const seen = new Set<string>();
  const sanctioned: string[] = [];
  for (const h of c.groundTruth.history) {
    if (!(discovered.has(h.id) || (intent != null && h.intent === intent))) continue;
    const text = (h.answer[lang] || h.answer.en || "").trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      sanctioned.push(text);
    }
  }
  const complaint = (c.chiefComplaint[lang] || c.chiefComplaint.en || "").trim();
  return { sanctioned, narrative: complaint ? [complaint, ...sanctioned] : sanctioned };
}
