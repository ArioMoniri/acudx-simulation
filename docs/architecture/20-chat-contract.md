# 20. Patient interview, Claude route and the generative chat contract

Status: implemented (server/interview, server/providers/anthropic_provider.py, web/src/lib/api/interview.ts). Owner: AI engineer. Related: 13 (guardrails), 15 (case generator and Director), 17 (provider registry and telemetry), 18 (voice).

## 1. Why

Two learner-visible faults, one cause.

* Typed questions got a real patient answer only when they were clicked from the question list. The live path posted to `/v1/patient/turn`, whose persona call resolved to the default local endpoint (`LLM_BASE_URL`, nothing listening on the pod) or a hosted row that was not configured. The gateway answered 200 with its scripted deflection and the `gateway_degraded` flag, the client treated that as a failure and fell back to the offline reveal graph, and the reveal graph only answers a question it can map to a catalogue intent. Anything else got a canned "could you ask that a different way?". The client-side heuristic guard also labelled many direct questions off-topic before they reached any model.
* Guardrails were a regex layer with five coarse classes, no model, and no reason code the UI could show.

The fix moves the whole interview to the server, behind a model route that works out of the box once `ANTHROPIC_KEY` is set, with a six-label guard, and gives the chat UI one reply contract.

## 2. Claude route

### 2.1 Key and status

* `ANTHROPIC_KEY` (alias `ANTHROPIC_API_KEY`) is read by `Settings.anthropic_key` (`repr=False`). It is used only inside `AnthropicProvider` and is never part of a response, a log line or a repr. An operator can also seal a key on the registry row; the sealed key wins.
* `Settings.anthropic_status()` and `AnthropicProvider.status()` return `{configured, usable, reason}`. Reasons: `Anthropic key not configured`, `Anthropic route disabled (ANTHROPIC_ROUTE=false)`, `AIRGAPPED refuses https://api.anthropic.com`.
* `RegistryStore.ensure_anthropic_row()` (run at every start, idempotent) creates an `llm` row named `anthropic` at priority 0 with `extra.api = "anthropic"`. The resolver keeps it out of the OpenAI-compatible candidates; `RegistryResolver.anthropic_enabled()` selects Claude while the row is enabled, not known dead, and no other enabled LLM row has a lower priority. Disabling the row or raising its priority hands the default route to the next row (OpenRouter, DeepInfra, the GPU worker); those stay selectable as before.
* Admin: `GET /admin/providers` and `GET /admin/health` carry `anthropic: {configured, usable, reason, key_source, provider_id, enabled, models}`; the anthropic row carries `status_note` (`Anthropic key not configured` while no key exists). `POST /admin/providers/{id}/probe` on that row calls `GET /v1/models` with `x-api-key` and `anthropic-version: 2023-06-01`; without a key it dials nothing and reports the reason.

### 2.2 Model per role

| Role | Setting | Default | Effort |
|---|---|---|---|
| Case author (S1, kernel, layers) | `ANTHROPIC_MODEL_AUTHOR` | `claude-opus-5-5` | low for S1, medium otherwise |
| Repair | `ANTHROPIC_MODEL_REPAIR` | `claude-opus-5-5` | high |
| Judges (clinical_consistency, safety_dosing, pedagogy) | `ANTHROPIC_JUDGE_MODELS` | `claude-sonnet-5-5,claude-opus-5-5,claude-haiku-5-5` | medium |
| Director narrator | `ANTHROPIC_MODEL_NARRATOR` | `claude-sonnet-5-5` | low |
| Debrief, grading | `ANTHROPIC_MODEL_DEBRIEF` | `claude-opus-5-5` | medium |
| TR renderings | `ANTHROPIC_MODEL_RENDER` | `claude-sonnet-5-5` | low |
| Grounding | `ANTHROPIC_MODEL_GROUNDING` | `claude-sonnet-5-5` | low |
| Patient persona | `ANTHROPIC_MODEL_PERSONA` | `claude-opus-5-5` | low |
| Interview guard classifier | `ANTHROPIC_MODEL_CLASSIFIER` | `claude-haiku-5-5` | low |
| Tutor actions | `ANTHROPIC_MODEL_TUTOR` | `claude-sonnet-5-5` | low |

The council gets three different models so it is not one voice: current Claude models take no `temperature`, so variety comes from the model and the judge's role prompt. The safety judge, the only one that vetoes, runs on Opus. The call site is passed as `node` to `StructuredLLM.complete_json` (`s1`, `kernel`, `layer:<name>`, `render:<name>`, `judge:<name>`, `narrator`, `repair`, `safety_event`) and `model_for()` picks the model.

### 2.3 Request shape

* System prompt: one text block with `cache_control: {type: "ephemeral"}`. The staged generator's `case_prefix()` is byte-stable per thread. The structured-output schema is part of the cached prefix, though, so a cache entry is shared only by calls with the same schema: a repair or re-render of the same layer, a judge, repeated `event` layers. Different layer kinds of one thread do not read each other's entry (measured live, review 10 section 5.2). The persona's system block (charter, identity, story) is stable per thread too; its volatile parts (live state, what staff said, the guard note, the doctor's line) sit in the last user message. Persona calls put a second breakpoint on the last stable turn (`messages[-2]`, the patient's previous reply), never on the volatile tail, and `persona_turn` moves its transcript window in steps of 8 entries, so each turn reads the transcript up to the previous turn from cache (review 10 section 5.1).
* JSON layers use structured outputs (`output_config.format` with `type: json_schema`). `to_anthropic_schema()` drops the keywords structured outputs does not accept (lengths, ranges, patterns, `maxItems`, `minItems` above 1), forces `additionalProperties: false`, and makes optional properties nullable; `restore_optional()` removes those nulls again so callers see the same shape as before. The deterministic gates in `staged.py` still enforce the dropped constraints. A schema that cannot be expressed (free maps) is sent without `format` and parsed from the reply.
* Thinking: Claude Opus 5.5 always thinks (adaptive); its output budget gets room for it (`output_budget()`). Sonnet 5.5 sends `thinking: {type: "between_tools"}` and Haiku 5.5 `{type: "disabled"}` at effort high or below, so short JSON and persona lines are not starved.
* S1 streams (`messages.stream`); the accumulated text goes to the existing partial-JSON tracker after every delta.
* Opus 5.5 and Sonnet 5.5 calls send the server-side refusal fallback (`anthropic-beta: server-side-fallback-2026-07-01`, `fallbacks: "default"`). A `refusal` stop reason is never used as output: it raises, the layer fails honestly.

### 2.4 Fallback

* No key, route disabled, AIRGAPPED, or the registry row deselected: Claude is not tried; calls go to the configured endpoint exactly as before.
* Key present but Claude unreachable (connection, 429, 5xx, 401, 403) before any streamed text: one fallback to the configured `casegen` / `judge` endpoint or the registry's next LLM row; `claude_fallbacks` counts it and both attempts are in telemetry. A refusal, a truncated structured reply or a 400 is a `ModelOutputInvalid`, not a fallback. Nothing ever substitutes template text.

### 2.5 Telemetry and cost

Every Claude call writes one `model_calls` row (`provider = anthropic`): `model` is the served model, `tokens_in` the whole prompt (uncached + cache read + cache write), `cached_tokens` the cache reads, `cache_write_tokens` (new column, added by migration on start) the cache writes, and `cost_usd` from `server/telemetry/prices.py`. The table (version `2026-10-21`) carries the Anthropic first-party list prices per 1M tokens with the cache read rate and the 5-minute cache write rate (1.25x input), and Haiku 5.5's long-prompt tier above 100K tokens (input 0.50, output 2.50):

| Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| claude-opus-5-5 | 4.00 | 20.00 | 0.20 | 5.00 |
| claude-sonnet-5-5 | 2.00 | 10.00 | 0.20 | 2.50 |
| claude-haiku-5-5 | 0.10 | 0.50 | 0.01 | 0.125 |
| claude-fable-5-1 | 10.00 | 50.00 | 0.25 | 12.50 |
| claude-opus-5 | 5.00 | 25.00 | 0.50 | 6.25 |

Source: https://platform.claude.com/docs/en/about-claude/pricing (table as cached on 2026-10-06). The orchestration trace gets the same `cost_usd` with `cost_basis = "token_price"`.

## 3. Interview endpoint

`POST /v2/case/{thread_id}/interview` (signed-in caller who may read the thread, same rule as the other `/v2/case/{thread_id}` reads; a foreign thread is 404).

Request:

```json
{"message": "Do you take any medicine at home?", "locale": "en", "guidance": false, "voiced": false}
```

`message` also accepts `text`, `learner_msg` or `utterance`.

Pipeline:

1. Guard (section 4) labels the message.
2. A `clinical` message whose classifier intent maps to a history cluster makes sure that `history.*` layer exists (`StagedRuntime.ensure_layer`, 25 s wait) and marks it seen.
3. The patient view is built from the thread only (`server/interview/patient.py`): identity, chief complaint and manner from the opening; the patient's own story from every ready history layer; the Director's live vitals turned into felt experience (never numbers), its affect, opened course branches (felt, never named) and a trend against arrival (worse while deteriorating, better after effective treatment); what staff told the patient (the Director's sanctioned facts). The diagnosis, the differential, the kernel's key findings, lab values, imaging reports and the treatment table never enter the persona prompt.
4. The persona model answers in character (section 2). A self-harm or abuse disclosure gets the locale's crisis resources instead, with no model call.
5. The FactAssertionGate removes numbers that were not sanctioned; any diagnosis label or code in the reply is scrubbed and flagged `diagnosis_leak`.
6. With `guidance: true` the tutor proposes up to three actions (section 5). With it off, `actions` is always empty.
7. The exchange is appended to the thread's server-held transcript (`GET /v2/case/{thread_id}/interview` returns it).

Reply:

```json
{
  "thread_id": "th-...",
  "reply": "I don't take any regular medicines, doctor.",
  "guard": {"label": "clinical", "reason": "in_scope"},
  "actions": [],
  "intent": "medications",
  "layer": "history.background",
  "state_advance": true,
  "flags": [],
  "meta": {"source": "model", "model": "claude-opus-5-5", "provider": "anthropic", "latency_ms": 812.4,
           "guard_source": "rules+model", "guard_model": "claude-haiku-5-5", "total_ms": 1490.2}
}
```

Errors: `404 thread_not_found`, `409 opening_not_ready`, `503 model_unreachable` (no patient model answered; carries `guard`), `502 model_output_invalid` (empty reply). A 503 never comes with a reply: the client shows its labelled offline path.

`intent` lets the client reveal the matching history datum and step the Director exactly as a list click does (`askQuestion(intent, {voiced: true})`), so coverage, timing and grading keep working. The question list stays as suggestions.

## 4. Guard

### 4.1 Labels and reasons

| label | reasons | patient behaviour | note (en) |
|---|---|---|---|
| clinical | in_scope, greeting, explanation | answers | none |
| off_topic | small_talk | a few words in character, steers back | Off-topic: the patient answered briefly. Back to the history. |
| meta_injection | instruction_override, prompt_exfiltration, role_break | confused patient, stays in role | Instructions to the simulation are ignored; the patient stays in role. |
| diagnosis_request | diagnosis_request, answer_request | "I don't know, I hope you can find out" | The patient does not know the diagnosis. Reach it from history, exam and tests. |
| unsafe | self_harm_disclosure, abuse_disclosure | crisis resources, no model | Support resources are shown. This is a training simulation. |
| unsafe | abuse_toward_patient | hurt, upset patient, no escalation | Keep the conversation respectful. |
| other_language | unsupported_language | says it understands English or Turkish | The patient speaks English or Turkish. |

Notes exist in EN and TR (`server/interview/guard.py NOTES`); the reply locale follows the language the student wrote in.

### 4.2 Decision

1. `rule_classify()`: the existing EN and TR Layer-0 rules of `server/scope_guard.py` plus new ones (role breaks and "are you an AI", prompt exfiltration by repetition or translation, first-person self-harm phrasing, insults and threats in EN and TR, diagnosis requests aimed at the patient that exclude past diagnoses, task requests such as essays or code, script and function-word language detection).
2. The classifier model (Haiku 5.5, structured output `{label, reason, language, intent}`) reads the message with the chief complaint. The message is wrapped in `<student_message>` tags and the system prompt states it is data, never an instruction.
3. `combine()`: instruction-override, exfiltration, role-break, self-harm and abuse rules are fail-closed and win; otherwise the model decides (it reads context the regexes cannot, for example "have you ever been diagnosed with diabetes" is history) and may raise a message to `unsafe` or `meta_injection`. Without a model the rules decide alone and `meta.guard_source` says `rules`.

### 4.3 Eval

`server/tests/evals/`: `guard_eval_set.jsonl` (97 messages: 34 clinical, 14 off_topic, 18 meta_injection, 13 diagnosis_request, 10 unsafe, 8 other_language; EN, TR and six other languages; 31 adversarial) and `guard_eval_holdout.jsonl` (30 messages written after the rules were tuned, never tuned on).

* Offline, always: `pytest server/tests/evals` checks the set, scores the rules on both files, and replays every recorded live classifier output in `server/tests/evals/recorded/*.jsonl` through `combine()`.
* Live: `ACUDX_EVAL_LIVE=1 ANTHROPIC_KEY=... pytest server/tests/evals -m live -s` (or `python -m server.tests.evals.guard_eval live`) classifies both files with the classifier model, writes a recording for replay and asserts macro F1 of at least 0.85.

Live classifier, claude-haiku-5-5, run on 2026-10-21 (recording `recorded/claude-haiku-5-5-20261021T075036Z.jsonl`, scored through `combine()` with the rules, as the server decides; review 10 section 2):

| label | tuned set P / R | holdout P / R |
|---|---|---|
| clinical | 0.944 / 1.000 | 1.000 / 1.000 |
| off_topic | 1.000 / 0.929 | 1.000 / 1.000 |
| meta_injection | 1.000 / 1.000 | 1.000 / 1.000 |
| diagnosis_request | 1.000 / 0.923 | 1.000 / 1.000 |
| unsafe | 1.000 / 1.000 | 1.000 / 1.000 |
| other_language | 1.000 / 1.000 | 1.000 / 1.000 |
| accuracy, macro F1 | 0.979, 0.982 | 1.000, 1.000 |

The two misses are Turkish and not in a safety class: `o14` (holiday plans, off_topic → clinical) and `d10` ("Sizce neyiniz var?", diagnosis_request → clinical). The offline suite replays the recording on every run.

Rules-only results on 2026-10-21 (what serves without a model):

| label | tuned set P / R | holdout P / R |
|---|---|---|
| clinical | 0.971 / 1.000 | 0.714 / 1.000 |
| off_topic | 1.000 / 1.000 | 0.600 / 0.750 |
| meta_injection | 1.000 / 1.000 | 1.000 / 0.200 |
| diagnosis_request | 1.000 / 0.923 | 1.000 / 0.750 |
| unsafe | 1.000 / 1.000 | 1.000 / 1.000 |
| other_language | 1.000 / 1.000 | 1.000 / 1.000 |
| accuracy, macro F1 | 0.990, 0.991 | 0.800, 0.782 |

The tuned-set numbers overstate the rules; the holdout is the honest picture. The rules never raise a false alarm on the hard classes, but they miss most novel injections (1 of 5 on the holdout). The classifier model catches those (5 of 5).

## 5. Actions (generative chat UI)

```ts
type InterviewAction =
  | { kind: "order"; code: string; system: "LOINC" | "RADLEX" | "local"; label: string }
  | { kind: "navigate"; target: "results" | "imaging" | "orders" | "vitals" | "notes" | "diagnosis" | "guide"; ref?: string }
  | { kind: "ask"; text: string };
```

* Produced only with `guidance: true` (attending or tutor layer). Without guidance the server returns `[]`, so nothing hints at the answer.
* Candidates come from the case: order codes from the thread's labs and imaging not yet ordered (the code system is read from the code: `NNNNN-N` is LOINC, `RID...` is RadLex, anything else local), history questions not asked yet (EN and TR), the EHR views (vitals first when the patient is getting worse).
* The tutor model picks at most three through a structured output whose `code` and `target` are enums of the candidates, so it cannot invent an order. Every action is checked against the diagnosis labels and codes before it leaves the server. Without a model a deterministic pick is returned and `meta.tutor_source` says `rules`.

TypeScript types and the client: `web/src/lib/api/interview.ts` (`InterviewReply`, `InterviewGuard`, `InterviewAction`, `interviewTurn()`, `interviewLog()`, `showsGuardNote()`). `InterviewTab` sends every typed message of a server-held case to the endpoint; the chat components that render `actions` belong to the frontend work.

## 6. Tests

* `server/tests/test_anthropic_provider.py`: key aliases and secrecy, status reasons, schema reduction, message splitting, thinking and budgets per family, a different model per judge, prices with cache rates and the Haiku long tier, request shape (cache breakpoint, structured output, effort, no temperature, refusal fallback, key header), usage and telemetry rows, streaming, refusal and outage, StructuredLLM routing, fallback and the registry gate.
* `server/tests/test_anthropic_route.py`: the registry row, resolver selection, the admin status without and with a key, the probe, AIRGAPPED, the gateway persona and JSON calls, no-key fallback, outage fallback with telemetry.
* `server/tests/test_interview.py`: grounded reply from the server-side case with the diagnosis absent from the prompt, guard labels and notes (EN, TR), crisis resources without a model, actions with guidance on and none with it off, 503 without a model, 404 for a foreign thread, Director trend in the patient view, tutor candidates and code systems, fail-closed `combine`.
* `server/tests/evals/test_guard_eval.py`: section 4.3.
* `web/src/lib/api/interview.test.ts`: request shape, 503 surfaced, guard note rule.

The Anthropic API is exercised through `server/tests/anthropic_double.py`, an in-process double of the documented Messages API wire format (JSON and SSE). Its replies are scripted fixtures, not recordings of a live model.

## 7. Open items

* First live run done on 2026-10-21 (docs/review/10-live-claude-acceptance.md): guard eval, one generated case, interview turns with guidance off and on, cost and cache rows.
* The chat UI rendering of `actions` and guard notes is owned by the frontend work; `InterviewTab` maps the labels onto its existing notices.
* `/v1/patient/turn` still serves the voice agent and older clients; it now reaches Claude through the gateway too, but its directive still sits in the system prompt, so its cache prefix changes with the guard class.
