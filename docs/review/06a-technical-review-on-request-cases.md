# 06a Technical review: on-request, dynamically evolving cases

Reviewer: technical reviewer (senior AI and fullstack). Branch `claude/clever-mendel-dtbc1n` at `7ff0f8f`. Read-only review; no source was changed.

## 0. The requirement under review

The owner's most important requirement:

1. Every case is generated on request by the model pipeline.
2. The case changes dynamically in flight with what the student does.
3. There is no pre-generated case list, no seed or curated case library served to learners, and no template presented as a case.

Verdict in one line: the v2 path from the Start page complies with (1); every other way of obtaining a case violates (1) or (3); and (2) is only partly met, because the Clinical Director reveals and perturbs a case that is fully fixed at generation time, and two of its three consumers (persona, results engine) ignore most of what it changes.

## 1. Findings: every path by which a learner obtains a case

Verdict key: **complies**, **violates**, **partial** (meets the letter in one branch and violates in another).

| # | Path (entry point) | Where | What actually happens | Verdict |
|---|---|---|---|---|
| P1 | Start page, Begin | `web/src/pages/StartPage.tsx:341` | Hands only a selection (`{ start: selection }`: complaint family, difficulty, guidance) to `/encounter`. No case content. | complies |
| P2 | Encounter, live start | `web/src/pages/EncounterPage.tsx:323-332`, `:214-246` | With the gateway reachable, runs `streamCaseGenV2` (`POST /v2/case/generate/stream`), adapts the spec, starts the encounter with model provenance. | complies |
| P3 | Encounter, gateway down with a Start selection | `EncounterPage.tsx:333-345` | `generateCase(...)` from `web/src/domain/caseGen.ts` (seeded deterministic template assembler, see header at `caseGen.ts:1-22`), labelled "offline". | violates (template served as a case) |
| P4 | Encounter, direct visit with no selection and gateway down | `EncounterPage.tsx:346` | Starts the hard-coded seed `chestPainNstemiCase`. | violates (seed served) |
| P5 | Encounter, "Use template" after a model failure | `EncounterPage.tsx:250-270`, button in `web/src/components/ehr/CaseGenProgress.tsx:204`; server `server/orchestration/routes.py:345-348`, `server/orchestration/graph.py:588-620` | `POST /v2/case/template` returns `build_template_spec` (`server/case_generator.py:1016`), labelled `meta.source="template"`; if that fails too, falls to `generateCase` (offline). Honestly labelled, but still a template played as a case. | violates |
| P6 | Encounter, New case menu: random / constrained | `EncounterPage.tsx:353-381` via `web/src/components/ehr/NewCaseMenu.tsx:137` | Live: v2 SSE (complies). Offline: `generateCase` (violates). | partial |
| P7 | Encounter, New case menu: "Or start from a curated case" | `NewCaseMenu.tsx:239-262` (list at `:248`), handler `EncounterPage.tsx:383-389` | Lists the five `seedCases` (`web/src/data/seedCases.ts:587`) and loads one. | violates (curated library) |
| P8 | Encounter, New case menu: "Or start from a published case" | `NewCaseMenu.tsx:65-73`, `:206-236` (start at `:226`) | Loads an educator-authored `caseInstance` from `localStorage` key `acudx-authored-cases:v1` (`web/src/data/authoring.ts:830-877`). Calls `startEncounter(p.caseInstance)` with no generation meta, so provenance is blank. | violates (curated library) |
| P9 | Cases page library grid | `web/src/pages/CasesPage.tsx:648-673` (merge at `:662`) | Renders `[...generated, ...publishedInstances, ...seedCases]` as a browsable library; "Start" navigates with the full `caseInstance` (`:769-774`). | violates (seed and curated list) |
| P10 | Cases page, Quick generate | `CasesPage.tsx:686-697` | Offline `generateCase`, appended to an in-browser list of ready cases. | violates (template, and a pre-generated list) |
| P11 | Cases page, AI generate / Endless | `CasesPage.tsx:701-765`; client `web/src/lib/liveCaseGen.ts:1105`, `:1139-1171`; server `server/app.py:472-486`, `server/case_generator.py:1217-1305` | Uses legacy `POST /v1/case/generate`, which overlays model output on a full template (`_merge`, `case_generator.py:1168`) and returns the bare template with HTTP 200 on any model failure; the client additionally falls back to `generateCase`. The result is parked in a list and later started through `providedCase`, which labels it `"published"` (`EncounterPage.tsx:315-322`) and never reaches the v2 graph or its council. | violates |
| P12 | Home page, recommended rail | `web/src/pages/HomePage.tsx:252-267`, fallback rows `:211`, open at `:293-297` | On every render of the dashboard, `buildRecommended` pre-generates four cases with the offline `generateCase` and hands one over as `caseInstance` on click. If that throws, static `FALLBACK_RAIL` rows are shown. | violates (pre-generated list, template) |
| P13 | Exam mode | `web/src/pages/ExamPage.tsx`, runner `web/src/components/exam/ExamRunner.tsx:67-86`, `:101` | `fetchGeneratedCase` (legacy v1, template merge and template fallback) then `generateCase` offline; `startEncounter(next)` without provenance. `setLiveEnabled` is only ever called by `EncounterPage.tsx:176`, so the Director runs in an exam only if a previous Encounter visit left the module flag on (`encounterStore.ts:304`, `:358-360`). | violates (and in-flight dynamics undefined) |
| P14 | Rooms (multiplayer), join or demo room | `web/src/pages/RoomPage.tsx:234-236`, `:253`; `web/src/data/rooms.ts:259-328`, `:353-355` | `roomCase(room)` is `getSeedCase(room.caseId)`; demo rooms are bound to seed ids; anything else falls back to `em-acs-001`. | violates (seed only) |
| P15 | Rooms, Create room dialog | `web/src/components/room/CreateRoomDialog.tsx:49`, `:115`, `:192` | Case picker lists `seedCases` plus published cases. A published case id then resolves to `em-acs-001` in `roomCase` (bug: the room silently plays a different patient than the one picked). | violates (and a correctness bug) |
| P16 | Authoring (faculty) draft | `web/src/pages/AuthoringPage.tsx:358-364` | Drafts start from offline `generateCase`, not from the model. Publishing feeds P8, P9, P15. | violates (by what it feeds) |
| P17 | `web/src/data/caseLibrary.ts` | whole file | Pure facet helpers (specialty, complaint family, code chip). Serves no case by itself; it exists to power the library in P9. | complies (remove with P9) |
| P18 | `web/src/data/startOptions.ts` | `:156` `CHIEF_COMPLAINT_OPTIONS`, `:167` difficulty labels | Option vocabularies for the request, not cases. | complies |
| P19 | Condition sampling | `server/orchestration/graph.py:314-346`, `server/condition_catalog.py` | Samples a diagnosis from the ICD/DSM taxonomy, with learner memory exclusion and weak-system steering. A taxonomy is not a case. | complies |
| P20 | Fixture gap-fill inside the model path | `server/orchestration/normalize.py:494-560`, `server/case_fixtures.py` | When the model leaves treatments, labs or imaging empty, code fills them from the condition fixture and lists them in `meta.gap_filled`. The chart then mixes template rows into a "model" case. Fixture use as a safety oracle (`graph.py:268-300`) is fine. | partial |
| P21 | `/v2/director/step` | `server/orchestration/routes.py:376-407` | Accepts `spec` or a client-held `case_state`; it does not read the thread checkpoint, so it will step any spec the client sends, including seed, template or offline cases. | partial (see section 2) |

Summary: only P1 to P2 (and the live branch of P6) satisfy the requirement. The violations fall into four groups: (a) offline template generator `caseGen.ts` used as a silent-ish fallback in eight places; (b) seed and published libraries (P7, P8, P9, P14, P15); (c) legacy `/v1/case/generate` with template merge and template fallback (P11, P13); (d) the explicit "Use template" button (P5).

## 2. In-flight dynamics: what the Director really changes

### 2.1 What the Director does per action (`server/orchestration/director.py`)

| Channel | Mechanism | Evidence |
|---|---|---|
| Clock | `t_ms` advances by a default cost per action kind; a 60 s real-time `elapsed` tick from the client | `director.py:44-47`, `encounterStore.ts` `startDirectorClock` |
| Facts | Unlocks pre-authored strings keyed by `question:<intent>`, `exam:<maneuver>`, `order:<code>`; nothing new is ever created | `from_spec` `:174-228`, `node_perceive` `:468-517` (`"unlocks nothing in this case"` at `:486`) |
| Vitals | Baseline trajectory plus bounded effect ramps of given treatments (case table, then a generic class table), clamped | `:69-93`, `compute_vitals` |
| Complications | Exactly one planned complication, `missed_time_critical_treatment`, by ESI deadline (10/20/40 min), cancelled by any indicated definitive treatment; plus a fixed adverse response to a contraindicated treatment | `:52-68`, `:215-227`, `node_complications` `:528-546` |
| Affect | Deterministic from vitals and ESI; an optional model call may reword mood and pain but "never changes a vital, a fact or a complication" | `_affect_from_vitals` `:421`, `make_narrate_model` `:593`, docstring `:17-20` |

### 2.2 Who consumes the changes

| Consumer | Uses Director output? | Evidence | Gap |
|---|---|---|---|
| Vitals monitor, Storyboard | yes, overlay delta on local course | `encounterStore.ts:1097-1118`, `Storyboard.tsx:171` | none |
| Patient avatar affect label | no; derived from `triageVitals` (arrival) only | `EncounterPage.tsx:392-400` | the face never deteriorates or improves |
| Persona (patient voice) | client sends `vitals`, `vitals_adjectives`, `affect`, `complications` (`InterviewTab.tsx:588-600`), but `server/persona.py` `build_patient_turn` (`:175-230`) reads only persona, narrative and sanctioned facts; a grep finds no use of `vitals`, `affect` or `complications` in `server/persona.py` | the patient sounds the same while desaturating; `affect_baseline` is the static page label |
| Persona disclosure gate | client puts every history answer into `sanctioned_facts` up front (`InterviewTab.tsx:580`, `:594`) | the Director's progressive reveal adds nothing for history; the fact gate cannot catch premature disclosure |
| Results engine | gets the original spec plus `treatments_given` (`liveEncounter.ts:159-169`); `vitals_at` interpolates the authored trajectory (`server/results/engine.py:375`) | a fired complication does not move lactate, gas, troponin or potassium; labs follow the planned course, not the patient the student is managing |

### 2.3 What is fixed at generation time that should evolve

- Every HPI answer, exam finding, lab at arrival, imaging report, treatment table, vitals trajectory and disposition is frozen in the spec (`server/case_generator.py:366-390`). The Director only unlocks it.
- Exam findings never change after a deterioration (no new crackles, no new confusion, no mottling) and never improve after treatment.
- Only one branch exists (missed deadline). There is no response-to-treatment branch beyond vitals ramps, no iatrogenic branch other than a fixed HR and BP bump (for example fluid overload after large boluses, anaphylaxis after a contraindicated antibiotic, respiratory depression after opioids), no spontaneous course (for example a pneumothorax that tensions), and no recovery branch that changes the history the patient gives.
- A question or order with no authored datum returns nothing (`director.py:486`), so out-of-script but reasonable questions are dead ends rather than generated answers.
- `case_state` round-trips through the client and `/v2/director/step` does not bind to the generation thread (`routes.py:376-407`), so the server has no authoritative in-flight case and cannot generate consistent new layers.

## 3. Latency and the SSE progress UX

### 3.1 Where the 205 to 330 s goes (one A10, Qwen3-14B, guided JSON)

| Step | Cost driver | Evidence |
|---|---|---|
| Author | one call, `max_tokens=2400`, every text field bilingual (`*_en` and `*_tr`), minimum counts forced (HPI 5-8, exam 3-5, trajectory 3-5, labs 2-5, imaging 1-2, treatments 3-5, red flags 1-4) | `graph.py:52-56`, `:66-99` |
| Author retry | a malformed reply repeats the whole author call | `graph.py:348-360` |
| Council | three judges per round, each with a model phase up to 500 tokens | `server/orchestration/judges.py:445`, fan-out `graph.py:409-418` |
| Repair | rewrites the COMPLETE case (`repair_messages`), then a second judge round; up to two repairs on veto | `graph.py:246-265`, `:436-451`, `MAX_REPAIRS_DEFAULT = 2` |
| Time budget | `casegen_time_budget_s = 120` only gates whether another repair starts; the SSE cap is 600 s | `server/config.py:161`, `routes.py:65` |

At a realistic 25 to 35 decode tokens per second on an A10 for a 14B model under schema-guided decoding, a 1,800 to 2,400 token bilingual case is 55 to 95 s per author or repair call; one author, two judge rounds and one repair land in the measured 205 to 330 s range. The structure is serial in the worst place: nothing reaches the learner until `finalize`.

### 3.2 SSE progress UX today

- `start` announces the node list; `node` events advance a rail (`routes.py:270-311`, `EncounterPage.tsx:221-228`); `done` carries the whole spec. No token streaming, no partial case, no ETA, no elapsed timer tied to measured medians.
- The copy says "You can keep reading the chart", but there is no chart until `done`.
- Failure handling is honest (503, 502, 504 shown, Retry offered), but the only alternative offered is the template (P5), which the owner forbids.

## 4. Staged generation design

Goal: the encounter opens in under 30 s (first visible text under 5 s), full depth is generated per request as the student works, the whole case stays model-generated and consistent, and nothing is generated before a learner asks for a case.

### 4.1 Principle

One request creates one thread (`thread_id`) and one hidden **case kernel**. Everything the learner sees is a **layer** generated from the kernel plus the **fact ledger** (everything already revealed or changed). Layers are produced by small calls with small schemas, in the requested locale only. The kernel, ledger and layers live in the LangGraph checkpoint; the server is the authority on case state.

Allowed and forbidden, stated for the owner:

- Allowed: after the learner requests a case, the same request continues to author that case's next layers in the background while the learner reads (in-request continuation). This is not speculation: the case was asked for, and nothing is produced for a case or learner that did not ask.
- Forbidden and not proposed: warm pools, nightly batches, per-user pre-generated queues, cached cases reused across learners.
- Recommended owner decision: confirm that in-request continuation is acceptable. If not, every layer is strictly lazy and the per-layer budgets in 4.4 apply at the moment of the action.

### 4.2 Stages

| Stage | Trigger | Content (schema) | Validation | Budget on one A10 |
|---|---|---|---|---|
| S0 sample | request | condition from the taxonomy, acuity, difficulty, learner steering (as today, `graph.py:314`) | deterministic | under 0.1 s |
| S1 kernel and opening (streamed) | request | Kernel (hidden): working diagnosis code, 4 to 6 key positives, 3 to 5 key negatives, severity, planned course class (improving, stable, deteriorating), 2 to 3 candidate branches with triggers (for example "no antibiotic by 60 min: septic shock"; "more than 2 L crystalloid with EF under 40: pulmonary oedema"). Opening (visible): demographics, chief complaint, triage note in one locale, triage vitals, persona card (affect, communication style, health literacy), 3 opening HPI statements. About 350 to 450 output tokens. | deterministic only: vitals bounds (`judges.VITAL_BOUNDS`), age and sex plausibility, kernel consistency with the sampled condition, no drug content yet, so no safety judge is needed | first tokens 1 to 3 s; complete 12 to 20 s |
| S2 history core | S1 done (continuation) or first question | HPI clusters by intent (onset, character, radiation, associated, risk factors), PMH, medications, allergies; about 300 tokens | deterministic consistency with kernel positives and negatives; model consistency judge async | 8 to 12 s, usually hidden behind chart reading |
| S3 exam layer | first exam maneuver per system, or continuation | findings for the requested system, conditioned on kernel and current Director state (so a deteriorated patient has new findings) | deterministic plus async consistency judge | 3 to 6 s per system |
| S4 treatment table | first visit to Orders or first treatment order | indicated, neutral and contraindicated rows with bounded effects | safety and dosing judge blocking for this layer only; fixture appropriateness enforced as an oracle (`graph.py:268-300`) | 8 to 12 s plus judge 3 to 5 s |
| S5 results | each order | numbers from `server/results/engine.py` kinetics conditioned on the Director's live state, not the authored trajectory; the model writes only imaging and ECG report prose | engine bounds; report judge async | engine under 0.2 s; report 3 to 6 s, shown as "pending" with a clinical turnaround anyway |
| S6 branch event | Director fires a branch | new facts (symptom, exam change, nurse call), persona affect shift, lab trajectory shift | deterministic bounds; safety judge if a drug or dose is mentioned | 3 to 6 s; vitals change immediately, prose follows |
| S7 debrief and anchors | diagnosis committed | rubric, anchors resolved to verified statement ids (as `node_ground` today) | `resolve_anchors` | 5 to 10 s |

### 4.3 The council, reshaped

- Stage gates are deterministic and fast. The model judges move off the critical path: they review each layer asynchronously and can issue a **field-level patch** (JSON Patch on one layer), never a whole-case rewrite.
- A layer that a judge vetoes before the learner has seen it is replaced silently with a regenerated layer. A layer already seen is corrected through the Director as a clinical event (for example "Lab called: the potassium was haemolysed, repeat sent"), never by rewriting history under the learner.
- The safety and dosing judge stays blocking, but only for S4 and any S6 event that mentions a drug.

### 4.4 Model serving tactics for the A10

1. Generate in the requested locale only; translate lazily on locale switch (halves output tokens).
2. Tight `max_tokens` per stage (450, 300, 150, 400, 200) instead of 2,400 for everything.
3. vLLM prefix caching on a byte-stable system block (charter, kernel, ledger summary) so each layer call prefills only a short delta.
4. Run independent layers concurrently on the same vLLM instance (continuous batching makes 2 to 4 concurrent short calls nearly as fast as one).
5. Use the faster structured-output backend (xgrammar) and keep schemas shallow (no nested optional unions).
6. Use token streaming (`stream: true`) for S1 and parse partial JSON so the banner, complaint and vitals render field by field.
7. Keep Qwen3 thinking off (as `llm.py:283-285` already does). Consider Qwen3-8B AWQ for S2, S3, S5 prose and the 14B for S1 and S4; measure before switching.
8. Remove the author retry on malformed output for small layers; regenerate only the failed layer.

### 4.5 Director v3 (dynamics)

- Authoritative state on the server: `/v2/director/step` takes `thread_id` and an action, loads kernel, ledger and Director state from the checkpoint, and rejects specs that did not come from the generator (closes P21).
- Branches come from the kernel (model-authored per case, validated against condition fixtures and hard bounds), not a single ESI table. Each branch has trigger, effects on vitals, effects on labs (engine parameters), new facts to emit, persona affect shift, and an averting action set.
- When a branch fires, the Director emits vitals at once and schedules S6 to author the new findings.
- Unscripted but reasonable questions or orders go to a lazy layer call constrained by kernel and ledger instead of "unlocks nothing".
- Consumers: persona receives `affect`, `vitals_adjectives` and fired events in its system and user blocks; the avatar uses Director affect; the results engine receives Director state (`active_effects`, fired complications) so labs move with the patient.

### 4.6 SSE contract

```
event: start            {thread_id, stages:[...], eta_ms:{s1:15000, s2:10000}}
event: kernel           {status:"ready"}                       (no content: hidden)
event: opening.delta    {path:"demographics.age", value:58}    (partial JSON, streamed)
event: opening.ready    {opening:{...}}                         (encounter starts here)
event: layer.pending    {layer:"history", reason:"continuation"}
event: layer.ready      {layer:"history", data:{...}}
event: judge            {layer:"history", decision:"accept"|"patched", patch?:[...]}
event: error            {stage, error, status, retryable}
event: done             {thread_id}
```

The stream stays open for the encounter (or the client re-subscribes with `GET /v2/case/{thread_id}/events?after=<id>`). UX: an elapsed timer and an ETA from the rolling median of each stage; the chart opens on `opening.ready`; each tab shows a skeleton with "being written for this patient" until its layer arrives; on failure, Retry for the failed layer only. The template button is removed.

### 4.7 Budget summary

| Milestone | Today | Target with staging |
|---|---|---|
| First visible text | 205 to 330 s (nothing until `done`) | 1 to 3 s |
| Encounter usable (chart, vitals, persona) | 205 to 330 s | 12 to 20 s, cap 30 s |
| First history answer | at encounter start | under 1 s if S2 continuation finished, else 8 to 12 s |
| Treatment table ready | at start | 8 to 17 s after first Orders visit, usually ready earlier by continuation |
| Whole case authored and judged | 205 to 330 s | 60 to 90 s in the background, never blocking |

## 5. Implementation checklist

Remove served templates, seeds and libraries (owner requirement 1 and 3)

- [ ] Delete the "Use template" action: `EncounterPage.tsx:250-270`, `CaseGenProgress.tsx:204-207`; unmount `POST /v2/case/template` from learner builds (`routes.py:345-348`), or restrict it to faculty and tests.
- [ ] Replace every `generateCase` fallback served to learners (P3, P6 offline, P10, P11, P12, P13) with an honest "the model is unavailable" state with Retry. Keep `web/src/domain/caseGen.ts` only for unit tests and authoring fixtures, behind a build flag.
- [ ] Remove the default seed start `EncounterPage.tsx:346` and the seed loader `:383-389`; remove the curated list `NewCaseMenu.tsx:239-262` and the published list `:206-236`.
- [ ] Remove the library grid from `CasesPage.tsx:648-673`; turn the page into a request form that navigates to `/encounter` with a selection, like `StartPage.tsx:341`. Retire `/v1/case/generate` (`server/app.py:472-486`, `liveCaseGen.ts`) for learners.
- [ ] Home rail (`HomePage.tsx:252-297`): show recommended complaint families and difficulty as requests (no case content); generate only on click via the v2 stream.
- [ ] Exam runner (`ExamRunner.tsx:67-86`): request each case from the v2 stream at the start of that station; call `setLiveEnabled` explicitly; record provenance.
- [ ] Rooms (`RoomPage.tsx:234-253`, `rooms.ts:259-355`, `CreateRoomDialog.tsx`): the room stores a request (complaint, difficulty, locale) and the host's thread id; every seat binds to that thread. Fixes the published-case-becomes-ACS bug.
- [ ] Authoring: published cases become faculty review artefacts and rubric templates, not learner-startable cases; drafts come from the v2 graph, not `generateCase` (`AuthoringPage.tsx:358-364`).
- [ ] Fixture gap-fill (`normalize.py:494-560`): in the staged design a missing layer is regenerated, not filled from fixtures; keep fixtures as a validation oracle only.
- [ ] Provenance: `EncounterPage.tsx:315-322` must not label a non-seed case "published"; with the removals above, provenance is always `model` plus thread id.
- [ ] Add a CI guard: a test that fails if any learner route can call `startEncounter` with a case whose `generation.source` is not `model`.

Staged generation (latency)

- [ ] New `KernelDraft` and `OpeningDraft` pydantic models (single locale) and per-layer schemas `HistoryLayer`, `ExamLayer`, `TreatmentLayer`, `BranchEvent`, `ReportProse` in `server/orchestration/`.
- [ ] Split `build_casegen_graph` into an S1 graph (sample, kernel and opening, deterministic gate) and a layer graph keyed by `(thread_id, layer)` with its own checkpoint entries.
- [ ] Token streaming in `StructuredLLM.complete_json` (`stream: true`) with an incremental JSON parser feeding `opening.delta`.
- [ ] Move model judges to async per layer with JSON Patch output; keep the safety judge blocking for S4 and drug-bearing S6.
- [ ] Long-lived SSE per thread plus `GET /v2/case/{thread_id}/events?after=` for reconnect; SSE cap per stage instead of 600 s overall.
- [ ] vLLM flags: prefix caching on, xgrammar guided decoding, `max_num_seqs` tuned for 3 to 4 concurrent short calls; measure Qwen3-8B AWQ against 14B per layer.
- [ ] Client: `v2SpecToCaseInstance` becomes an incremental adapter (opening first, layers merged); tabs show per-layer skeletons; progress shows elapsed and ETA from server medians.
- [ ] Telemetry: per-stage latency histograms (time to first token, time to opening, time per layer) on the admin dashboard; acceptance gate: p95 opening under 30 s on one A10.

In-flight dynamics

- [ ] `/v2/director/step` binds to `thread_id` and loads state from the checkpoint; reject client-supplied specs in production.
- [ ] Kernel-authored branches replace the single `DEADLINE_BY_ESI_MS` table (`director.py:52-68`); keep the table as a floor for safety.
- [ ] Branch firing schedules an S6 layer call; new facts and exam changes appear in the chart with a timestamp.
- [ ] Unmatched question, exam or order triggers a lazy layer call instead of the "unlocks nothing" note (`director.py:486`).
- [ ] `server/persona.py` `build_patient_turn`: add current affect, vitals adjectives and fired events to the prompt; stop sending all history answers as sanctioned (`InterviewTab.tsx:580-594`); send only revealed ones.
- [ ] Avatar affect from Director affect, not `triageVitals` (`EncounterPage.tsx:392-400`).
- [ ] Results engine input includes Director state (`liveEncounter.ts:159-169`, `engine.py:375`) so labs follow deterioration and treatment.
- [ ] Tests: a deterioration scenario where lactate, persona wording, avatar affect and an exam finding all change after a missed antibiotic; a response scenario where they improve after the indicated treatment.
