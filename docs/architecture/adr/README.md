# Architecture Decision Record Log

**Status of this log:** Authoritative. Captures the ~18 most consequential and contested decisions distilled from `docs/00-overview/01-requirements-and-constraints.md` and the full architecture set (`00-system-overview`, `01-ai-agent-architecture`, `02-model-gateway-and-routing`, `03-voice-pipeline`, `04-avatar-and-vitals-engine`, `05-guideline-grounding-engine`, `06-assessment-and-calibration-engine`, `07-multiplayer-rooms`, `08-data-model-and-multitenancy`, `09-security-and-compliance-architecture`, `10-api-and-integration-surface`). Each ADR is intentionally tight. Where a source doc goes deeper, it is cited. Cross-cutting tensions are tagged `Txx` per requirements §4. All ADRs below are **Accepted**.

| # | Title |
|---|---|
| [0001](#adr-0001--composable-cascade-voice-sttllmtts-not-native-speech-to-speech) | Composable cascade voice (STT→LLM→TTS), not native speech-to-speech |
| [0002](#adr-0002--3-tier-model-router-haiku--sonnet--opus) | 3-tier model router (Haiku → Sonnet → Opus) |
| [0003](#adr-0003--two-tier-content-architecture-grounded-facts--roleplay-affect) | Two-tier content architecture (grounded facts ⟂ roleplay affect) |
| [0004](#adr-0004--event-sourced-hash-chained-log-as-single-source-of-truth) | Event-sourced, hash-chained log as single source of truth |
| [0005](#adr-0005--formative-by-default-assessment_mode) | Formative-by-default `assessment_mode` |
| [0006](#adr-0006--synthetic-patients-only-no-real-phi) | Synthetic-patients-only, no real PHI |
| [0007](#adr-0007--band-only-assessment-granularity) | Band-only assessment granularity |
| [0008](#adr-0008--grader-model-family--patient-model-family) | Grader model family ≠ patient model family |
| [0009](#adr-0009--country-as-first-class-retrieval-filter-filter-before-rank) | Country as first-class retrieval filter (filter-before-rank) |
| [0010](#adr-0010--2d-clinical-signs-first-client-rendered-avatars-arkit-52--ready-player-me) | 2D, clinical-signs-first, client-rendered avatars (ARKit-52 / Ready Player Me) |
| [0011](#adr-0011--livekit--webrtc-for-realtime-voice-and-multiplayer) | LiveKit / WebRTC for realtime voice and multiplayer |
| [0012](#adr-0012--qdrant-filterable-hnsw-over-postgrespgvector-for-the-vector-index) | Qdrant filterable-HNSW over Postgres/pgvector for the vector index |
| [0013](#adr-0013--monorepo-with-a-single-model-gateway-chokepoint-and-service-boundaries) | Monorepo with a single Model-Gateway chokepoint and service boundaries |
| [0014](#adr-0014--typescript-primary-with-a-python-grading-service) | TypeScript-primary with a Python grading service |
| [0015](#adr-0015--lti-13-advantage-as-the-p0-institutional-integration) | LTI 1.3 Advantage as the P0 institutional integration |
| [0016](#adr-0016--region-pinned-multi-tenancy) | Region-pinned multi-tenancy |
| [0017](#adr-0017--two-physically-separated-data-planes--crypto-shredding-for-erasure) | Two physically-separated data planes + crypto-shredding for erasure |
| [0018](#adr-0018--nvidia-audio2face-3d-for-client-side-avatar-lip-sync) | NVIDIA Audio2Face-3D for client-side avatar lip-sync |

---

## ADR-0001 — Composable cascade voice (STT→LLM→TTS), not native speech-to-speech
**Status:** Accepted · **Tension:** T7

**Context.** Native speech-to-speech (Gemini Live, OpenAI Realtime) offers the lowest-latency, most "cinematic" audio, but hides its reasoning inside audio tokens — no inspectable clinical text. AcuDx is a regulated *assessment* product where every clinical utterance must be grounded, graded, per-case routed, and cost-attributed.

**Decision.** Default voice is a **composable cascade STT→LLM→TTS** (Deepgram Flux/Nova-3 Medical → tiered LLM → Cartesia Sonic-3 / ElevenLabs peaks), reusing the unchanged text turn loop as transport with **zero clinical authority** — the FactAssertionGate runs on persona *text* before any TTS byte. Barge-in is mandatory and every voice feature has a full non-voice equivalent. Native S2S (Gemini Live 2.5) is a **premium/cinematic fallback only** (restricted to low-fact-density cases, since the gate cannot run inside audio); OpenAI Realtime is a benchmark/last-failover only.

**Consequences.** Auditable text at every stage feeds grounding, assessment, routing, and cost transparency; low-STT-confidence falls back to text (never a silent mis-score); the assessment transcript is a separate batch Nova-3 re-STT on clock 3, never the latency-tuned live stream. Costs ~525 ms p50 / ~1075 ms p95 voice-to-voice (within the <800/<1200 SLO) and more moving parts to orchestrate.

**Alternatives rejected.** Native S2S as default — hides reasoning, defeats auditability and per-case routing, cannot run the fact gate, and is far costlier at scale (~$50K+/mo naïve vs ~$9–16K composable for a 5,000-student cohort).

---

## ADR-0002 — 3-tier model router (Haiku → Sonnet → Opus)
**Status:** Accepted · **Tension:** T1

**Context.** Starting every turn at a frontier model is financially unviable (~$6.30/encounter → ~$63K/day at 10K enc/day). Quality must be preserved only where it matters (hard turns, grading), not everywhere.

**Decision.** A pure-function router `(TaskType, EscalationSignals, TenantPolicy) → ModelConfig` runs patient turns on **Haiku 4.5** by default and escalates to **Sonnet 5** only on persona-break / clinical-fact / low-confidence / guardrail / retrieval-gap signals (~10–20% of turns). Grading/gap-analysis/authoring run on **Opus 4.8 via Batch (−50%)**; calibration is deterministic code. The **router architecture is pinned, model IDs are swappable**.

**Consequences.** ~93% cost cut (caching ~55% / RAG ~25% / batch ~10%); rare re-draft latency on escalation. A hard $0.15 soft / $0.43 hard per-encounter budget with a degrade ladder that never suppresses safety or clinical-fact serving.

**Alternatives rejected.** Single frontier model for all calls (unviable cost); fixed per-task model with no escalation (either overpays on easy turns or under-serves hard ones).

---

## ADR-0003 — Two-tier content architecture (grounded facts ⟂ roleplay affect)
**Status:** Accepted · **Tension:** T2

**Context.** The #1 clinical hazard and educator kill-switch is a hallucinated clinical fact reaching a learner as "correct" — an AI-patient inventing pathophysiology, or an "aggressive patient" drifting into unsafe management. A prompt alone cannot prevent this.

**Decision.** Separate a **grounded layer** (versioned, SME-signed, citation-or-refuse `GuidelineStatement`s + authoritative Case State) that owns *all* clinical facts/doses/labs/vitals from a **roleplay layer** that improvises affect but **structurally cannot assert clinical facts**. Enforced in three code layers: persona sees only a deterministic `CaseStateView` (intensity→adjective); facts arrive only via tools re-injected as `SanctionedFact`; a deterministic **FactAssertionGate** rejects/regenerates any unsanctioned clinical assertion pre-emit.

**Consequences.** Removes the largest hallucination surface and makes prompt-injection structurally ineffective (the patient has no path to source facts). Adds pipeline stages and a tool round-trip when a persona needs a self-knowable fact.

**Alternatives rejected.** One agent that both roleplays and states clinical truth (unbounded hallucination surface); prompt-only guardrails (jailbreakable, not defensible to a clinical governance board).

---

## ADR-0004 — Event-sourced, hash-chained log as single source of truth
**Status:** Accepted

**Context.** Assessment must be reconstructable and defensible for ≥6 months; AI-Act high-risk logging, academic-integrity audit, and "score this the way it was taught in 2024" replay all demand one tamper-evident record. Multiple ad-hoc stores would drift.

**Decision.** A **per-tenant, append-only, hash-chained Event Log** (`hash_n = SHA-256(canonical_body_n ‖ prev_hash_n)` + gap-free `seq`) is the spine; every store (Case State, grades, corpus, projections, ClickHouse analytics) is a **deterministically replayable projection**. Causal order is `seq`/`stream_seq`, never wall-clock `occurred_at`. KMS-signed WORM checkpoints every ~5 min bound tamper blast-radius; `verifyChain()` runs in CI and on export. The bus (Redis Streams → NATS/Kafka) is propagation-only, never truth.

**Consequences.** Free deterministic replay, audit, and version-locked reproducibility. GDPR erasure conflicts with append-only — resolved by crypto-shredding (ADR-0017). `model.call` events store prompt/model *hash only*, not learner content.

**Alternatives rejected.** Mutable relational rows as source of truth (no tamper evidence, no replay); public blockchain anchoring (PII-on-chain conflicts with GDPR erasure).

---

## ADR-0005 — Formative-by-default `assessment_mode`
**Status:** Accepted · **Tension:** T4, T5

**Context.** Auto-gating progression or profiling learners is EU AI Act Annex III high-risk, and LLM scoring has a real validity ceiling (κ≈0.44 on diagnosis). Black-box summative grading is the educator kill-switch.

**Decision.** `assessment_mode` is a hard flag defaulting to **`formative`** (advisory-to-human, Art. 6(3) limited-risk). **`summative-with-review`** is a separate opt-in that **refuses to finalize without a named human co-sign** and carries the full validity stack (Kane argument, IRR vs faculty, DIF/fairness), targeting the 2 Dec 2027 Annex-III deadline. Enforced end-to-end: the LTI AGS passback withholds summative grades until the co-sign exists. No AI-only consequential decision, ever.

**Consequences.** Keeps the MVP below Annex III high-risk by construction while leaving summative as a deliberate later gate. Summative revenue is deferred behind a contract/co-sign gate.

**Alternatives rejected.** Summative-capable by default (triggers high-risk obligations prematurely and invites the educator veto); no summative path at all (forfeits the institutional grade-of-record value).

---

## ADR-0006 — Synthetic-patients-only, no real PHI
**Status:** Accepted · **Tension:** (R5)

**Context.** Any real-patient-data path would pull AcuDx into HIPAA and EU MDR/MDSW device scope, and blur the "education, not clinical care" load-bearing wall.

**Decision.** **Synthetic patients only; no real-PHI-input path.** A deterministic **PHI Interceptor at ingress** (structural regex/validators first, cheap NER only to raise suspicion) blocks suspected real PHI *before* persistence and records only the matched rule. Learner data is therefore FERPA+GDPR, not PHI; HIPAA is out of scope by construction, and the security packet states BAA-not-applicable explicitly.

**Consequences.** Sharply narrows regulatory surface and keeps the two data classes physically separable. "Upload a real de-identified case" and similar point-of-care-flavored features are gated behind an explicit regulatory review — a deliberate later relaxation, never accidental.

**Alternatives rejected.** Allowing de-identified real cases (re-identification risk + HIPAA/MDR exposure); relying on policy/ToS instead of an ingress block (unenforceable, not auditable).

---

## ADR-0007 — Band-only assessment granularity
**Status:** Accepted · **Tension:** T4

**Context.** LLM graders produce plausible-looking decimals, but exact-score accuracy is ~0.52 vs band accuracy ~0.83–0.88. Decimals imply a precision the method does not have and are indefensible to examiners.

**Decision.** Deterministic code aggregates weighted item judgments into an internal `domain_raw` that is **never surfaced**, then maps to **4–5 ordinal bands only, never decimals**, across UI, XP, dashboards, LTI AGS passback, and Caliper/xAPI emission. A per-(domain×case-type×grader-config) reliability gate against the expert **anchor set** governs display: **weighted κ ≥ 0.6 to display a band, ≥ 0.7 to drive pass/fail, < 0.6 withholds the band** and flags for review.

**Consequences.** Defensible reliability at the cost of coarser feedback. Shapes UI, XP, gamification, dashboard, and every outbound integration. Requires an expert anchor set (which is also the moat).

**Alternatives rejected.** Decimal/percentage scores (false precision, ~0.52 accuracy, indefensible); pass/fail-only (discards useful gradation and calibration signal).

---

## ADR-0008 — Grader model family ≠ patient model family
**Status:** Accepted · **Tension:** T4

**Context.** Using the same model family to roleplay and to grade introduces self-preference bias — a validity defect, not a preference.

**Decision.** The grader **model family must differ from the patient-agent family**, enforced as a **fail-closed config-time reject** in the Model Registry/`ModelConfig` (not a runtime warning). High-stakes items additionally require an **ensemble of ≥2 families**; open-weight verifiers (MedGemma 1.5 / Meditron) cover the on-prem tier. Six named bias mitigations (pointwise-not-pairwise, verbosity, self-preference, leniency recalibration, prompt-freeze, demographic/language DIF) accompany it.

**Consequences.** A same-family grade is impossible to route, not merely discouraged. Ensemble is gated to high-stakes items only (else grading cost ~doubles). Fallback chains must preserve the family constraint.

**Alternatives rejected.** Same-family grader (self-preference bias, validity defect); runtime warning instead of config-time reject (allows the defect to ship).

---

## ADR-0009 — Country as first-class retrieval filter (filter-before-rank)
**Status:** Accepted · **Tension:** T6

**Context.** The "correct" clinical answer legitimately differs by country/council: a 135/85 diagnosis is right under AHA/ACC, wrong under ESC. Ministries reject US-defaulted tools, and a US answer leaking into a UK case is the #1 grounding hazard.

**Decision.** **Country/council is a hard metadata filter applied *before* ranking** — inside the ANN traversal — so divergent guidance never competes for recall. Divergent bodies are held as **parallel independently-cited `GuidelineStatement`s** linked by `conflicts_with`, never merged or averaged. Scoring filters to the case's declared council (single authoritative answer); guidance mode surfaces divergence as a teaching feature.

**Consequences.** No silent US-defaulting; reproducible, defensible per-country grading. Requires per-country curation and a corpus that keeps parallel atoms distinct. Divergence is unambiguous at grade time because the filter has already collapsed it.

**Alternatives rejected.** Single global guideline set (wrong for most of the world); post-filtering after rank (starves recall, lets the wrong-country answer surface); merging/averaging divergent thresholds (clinically incoherent).

---

## ADR-0010 — 2D, clinical-signs-first, client-rendered avatars (ARKit-52 / Ready Player Me)
**Status:** Accepted · **Tension:** T8

**Context.** Photorealism that cannot toggle "cyanosis @ SpO2 82%" is decorative in a clinical trainer; streaming photoreal vendors cannot expose clinical-sign shaders, and cost $0.05–0.20/min at scale.

**Decision.** **2D-first, clinical-signs-first, client-rendered.** A physiology-driven clinical-sign overlay (cyanosis/pallor/diaphoresis/distress/LOC) driven by the vitals engine is the medical differentiator at ~$0 marginal cost; **avatar, monitor, and the persona's `CaseStateView` are three read-only projections of one authoritative `ClinicalSign.intensity`, so they structurally cannot contradict** ([`04` §1](../04-avatar-and-vitals-engine.md)). An **abstract sign/state schema (frozen `ClinicalSignType` enum) is authored once** (with numeric `intensity` the assessment layer scores and a quantized `band` the persona/captions consume) and renders identically across a four-rung tier ladder: **Tier 0 2D** portrait + shader overlay → **Tier 1 2.5D** (Live2D layered rig) → **Tier 2 client-3D** → **Tier 3 streaming**. The 3D tier standardizes on **ARKit-52 blendshapes** as interchange, client-rendered (Three.js + R3F, WebGPU with automatic WebGL2 fallback, **Ready Player Me** rig). A **client capability probe auto-selects down the degradation ladder** (WebGPU 3D → WebGL2 3D → 2.5D → 2D → text "Patient status" table); the sign *state* is identical at every rung, only the render degrades. Streaming photoreal (Simli default — neural 3D Gaussian-splat face; HeyGen max fidelity) is gated to premium/OSCE only and **degrades the sign channel to monitor + captions** (it cannot expose clinical-sign shaders). Per baseline sequencing, the **vitals monitor + sign schema ship in MVP; the avatar render tiers are a v1+ fast-follow** (2D at v1; 2.5D/3D/streaming at v2).

**Consequences.** The differentiating channel ships cheaply on the device floor (4–5-year-old laptop, mid-range phone on 4G); the 2D tier already carries the medical payload before any 3D exists. Photoreal fidelity is a paid upsell, not a default; ARKit-52 keeps the sign schema portable up the fidelity tiers and lets client-3D power embodied multiplayer rooms ([`07`](../07-multiplayer-rooms.md)) at ~$0 render cost. The single-authoritative-state design forecloses the monitor↔avatar contradiction bug by construction.

**Alternatives rejected.** Streaming photoreal as default (cannot render clinical signs, dominates cost at scale); 3D-first everywhere (device-floor and cost hostile with no medical payoff over the sign channel); a bespoke blendshape standard or open sign authoring (loses the ARKit-52/RPM tooling ecosystem and grader consistency); **Unity WebGL** (20–60 MB builds, slow TTI) and **MetaHuman** (web Creator sunset, heavy pipeline) for web delivery; **Soul Machines** (ceased operations Feb 2026 — explicitly not designed around). In-browser Gaussian-splat driven faces are tracked as an opportunistic Phase-4 path to collapse streaming per-minute cost into client rendering, not committed.

---

## ADR-0011 — LiveKit / WebRTC for realtime voice and multiplayer
**Status:** Accepted

**Context.** Voice and multiplayer rooms need low-latency, drop-tolerant realtime transport; text-only solo does not and should not pay for it.

**Decision.** Use **WebRTC via LiveKit + LiveKit Agents** (~$0.0005/participant-min + ~$0.01/agent-min) **only where needed** — voice and multiplayer rooms — with server-authoritative, event-sourced room state, idempotent tool calls, and **graceful text fallback on WebRTC failure**. Text-only solo encounters use cheaper WebSocket/SSE and must remain fully completable in text at <100 kbps. LiveKit's usual BAA burden evaporates under synthetic-only/no-PHI. Runner-up Pipecat is pipeline-first and awkward for multi-party.

**Consequences.** Realtime cost is confined to the features that need it; every voice/multiplayer path has a text fallback that never silently degrades the encounter. Multiplayer room state divergence is bounded by event sourcing + idempotency; a full LiveKit outage drops a whole room to text with zero clinical state lost.

**Alternatives rejected.** WebRTC for all traffic (pays realtime cost on the text wedge, hostile to LMIC/low-bandwidth learners); raw WebRTC without a media server (re-implements SFU/room orchestration LiveKit provides); Pipecat (multi-party ergonomics).

---

## ADR-0012 — Qdrant filterable-HNSW over Postgres/pgvector for the vector index
**Status:** Accepted · **Tension:** T6

**Context.** The grounding retrieval invariant is *filter-before-rank*: the country/council filter must run *inside* the ANN traversal, not as a post-filter that starves recall. Postgres+pgvector is the obvious co-located default.

**Decision.** Use **Qdrant (filterable HNSW)** as the vector index because its HNSW respects payload filters during graph traversal, so the country/council/domain/population filter is applied inside the ANN search. **pgvector is explicitly accepted only at small scale.** Postgres 16 + JSONB remains the authoritative statement store; Postgres FTS provides BM25; dense+BM25 are fused by RRF (k=60) → Cohere Rerank v3.5. All are replayable projections of the Event Log.

**Consequences.** Recall is preserved under hard filtering at scale, which is the safety-critical property. Adds a dedicated vector store to operate alongside Postgres; embeddings go through the Model Gateway `embed()` (Voyage `voyage-3-large`, Cohere fallback, `bge-m3` on-prem).

**Alternatives rejected.** pgvector at scale (post-filtering after ANN starves recall — the exact failure that leaks a US answer into a UK case); dense-only retrieval (blurs drug names and numeric thresholds where BM25 wins).

---

## ADR-0013 — Monorepo with a single Model-Gateway chokepoint and service boundaries
**Status:** Accepted

**Context.** Several invariants (grader≠patient family, `no_train=true`, region pinning, PHI block, prompt-cache byte-stability, per-call audit) must be enforced mechanically, not by convention scattered across services.

**Decision.** A **monorepo** with clear service boundaries where **all LLM traffic flows through one Model Gateway package** — enforced by a CI `no-restricted-imports` lint banning vendor SDKs outside `packages/model-gateway/`. A single prefix-builder owns cached-prompt assembly (with an `assertByteStable()` diff). Services (AI-agent/Director, Grounding, Assessment, Calibration, Auth, Room) are separate bounded contexts communicating over the event bus (Redis Streams → NATS/Kafka at scale), all projections of the Event Log.

**Consequences.** Invariants are enforced at the import boundary in CI, not left to reviewers; the three isolated clocks (conversation / grounding+assessment / batch analytics) stay physically separable. Monorepo tooling and build discipline required.

**Alternatives rejected.** Per-service polyrepos with direct vendor SDK calls (invariants become tribal knowledge, silently violated); a shared library instead of a gateway service (cannot enforce region pinning, audit emission, or fail-closed family checks centrally).

---

## ADR-0014 — TypeScript-primary with a Python grading service
**Status:** Accepted

**Context.** The conversation loop, Director, gateway, and web stack are best served by one TypeScript codebase; grading/calibration lean on psychometric and numerical tooling (κ, Brier decomposition, monotone recalibration, DIF) where Python's ecosystem is strongest, and grading runs on a different clock.

**Decision.** **TypeScript is the primary language** for the realtime and platform services; the **grading/calibration path runs as a separate service** with Python for the psychometric math (deterministic calibration is pure code, no LLM). It is decoupled by the event bus and Model-Gateway Batch transport, so it never touches the conversation loop.

**Consequences.** Right-tool-per-clock: TS for realtime, Python for statistics. A language boundary to maintain, mitigated by communicating only over events and the gateway (no shared in-process state). Calibration math stays reproducible and cheap.

**Alternatives rejected.** All-TypeScript (weaker psychometric/numerical ecosystem for the validity stack); all-Python (poor fit for the realtime/web conversation loop and WebRTC orchestration).

---

## ADR-0015 — LTI 1.3 Advantage as the P0 institutional integration
**Status:** Accepted

**Context.** Institutional adoption runs through the LMS. Without certified LMS integration, the dean's-office value is unreachable and procurement stalls. LTI 1.1 is deprecated.

**Decision.** **LTI 1.3 Advantage Complete (1EdTech-certified)** is the **P0 institutional integration**: OIDC third-party-initiated launch → NRPS 2.0 roster → Deep Linking 2.0 case selection (binds `case_version_hash`) → AGS 2.0 grade passback. AGS passback is **band-only** and **withholds summative grades until a named human co-sign exists**. Standalone SAML 2.0 / OIDC / SCIM 2.0 / OneRoster 1.2 and Caliper 1.2 / xAPI emission are v1 fast-follows for non-LMS deployments and analytics-mature buyers.

**Consequences.** Seamless roster, SSO, and grade flow into the institution's LMS — the adoption and renewal lever. Requires certification effort; the formative/summative gate and band-only granularity both live at the AGS passback boundary.

**Alternatives rejected.** LTI 1.1 (deprecated, insecure, no AGS/NRPS); custom per-LMS integrations (unscalable, fails procurement's standards requirement).

---

## ADR-0016 — Region-pinned multi-tenancy
**Status:** Accepted

**Context.** Ministries and DPOs require that learner PII and analytics never leave the region, with in-region zero-retention inference for EU/UK. Residency is a *placement* property, not an *access* property, so access-control alone (RLS) cannot satisfy it — and a single global deployment cannot satisfy residency law.

**Decision.** **Region-pinned multi-tenant deployment** (eu-central, uk, us; me-central/ap on demand): **RLS within a region** for tenant isolation, **plus database/cluster/KMS-namespace-per-region** for residency. `Org.region` is immutable after creation. Learner PII/analytics never leave the region; EU/UK use in-region zero-retention / no-train inference endpoints. The Model Gateway enforces the region map, `no_train=true` (`store=false`) default, and per-call audit. Region-pinned base URL `https://{region}.api.acudx.dev/v1`, cross-region 421. An on-prem/VPC appliance tier (Qwen3-32B/Llama 4 Scout + MedGemma/Meditron on vLLM) serves privacy-maximal institutions; break-even ≈ >3–5M tokens/day.

**Consequences.** Residency and sovereignty are satisfiable per tenant; the gateway is the single enforcement point. Multi-region operational overhead and provider-availability-per-region constraints on fallback chains.

**Alternatives rejected.** Single global region (violates EU/UK residency law, ministry veto); RLS-only tenancy (satisfies access isolation but not residency placement); schema-per-tenant (ops cost, no isolation gain); db-per-tenant everywhere (reserved for appliance/ministry tenants only); on-prem everywhere (GPU capex/opex only pays off above 3–5M tok/day — a compliance choice, not a default).

---

## ADR-0017 — Two physically-separated data planes + crypto-shredding for erasure
**Status:** Accepted · **Tension:** (R5)

**Context.** Learner data must never leak into a model-training set, yet a de-identified/synthetic improvement corpus is the only lawful training source. Separately, GDPR Art. 17 right-to-erasure conflicts head-on with the append-only, hash-chained Event Log (ADR-0004) — you cannot delete an event without breaking every subsequent hash.

**Decision.** Split storage into **two physically-separated planes**: an **identified-education plane** (learner PII/transcripts/grades; `no_train=true`, per-tenant KEK, region-pinned; *never* trains) and a **de-identified/synthetic-improvement plane** (the *only* trainable source, opt-in only). The de-id projection is **one-way — no reverse path, no join key, and no service holds credentials to both** (separate DB clusters, KMS namespaces, network segments). Erasure is resolved by **crypto-shredding**: learner content is envelope-encrypted per subject; destroy the per-subject data key → ciphertext is unrecoverable but the hash-over-ciphertext still verifies, so the chain stays intact, and a `subject.erased` tombstone is appended. Non-PII assessment metadata (band + `rubric_version_hash` + `model_config_id`) is retained ~7y for accreditation defensibility.

**Consequences.** "No learner data trains a model" and "erasure without breaking the audit chain" are both architecturally true, not promised. Consent is checked per-subject-per-trace at ingest; core educational use is non-consent-based with no training path. Open item with accreditors: whether a shredded-content-but-hash-intact grade remains "appealable enough."

**Alternatives rejected.** One shared store with policy-only training exclusion (unenforceable, one credential away from a leak); physical event deletion for erasure (breaks the hash chain, destroys tamper-evidence); anonymizing in place (re-identification risk, no clean training boundary).

---

## ADR-0018 — NVIDIA Audio2Face-3D for client-side avatar lip-sync
**Status:** Accepted · **Tension:** T8

**Context.** The client-rendered 3D avatar tier (ADR-0010) needs believable lip-sync driven from the cascade's TTS audio, without paying a per-minute streaming-avatar vendor and without breaking the ARKit-52 clinical-sign schema. Streaming photoreal vendors bundle lip-sync but at $0.05–0.20/min and cannot expose the clinical-sign shaders.

**Decision.** Use **self-hosted NVIDIA Audio2Face-3D** as the **premium client-3D (Tier 2) lip-sync path**, emitting **ARKit-52 blendshape** coefficients (plus an explicit emotion channel) that compose cleanly with the physiology-driven clinical-sign overlay on the same rig via an **additive channel partition** ([`04` §4.3](../04-avatar-and-vitals-engine.md)): A2F-3D owns the ~15 viseme-critical mouth/jaw shapes, the sign channel owns skin uniforms + posture + eye/LOC, and the sign schema is authored to avoid the viseme-critical shapes so they never contend for a coefficient. Its permissive licensing (**NVIDIA Open Model License on the model, MIT SDK, Apache training framework**) is what makes self-hosting — GPU-amortized across concurrent sessions, no per-minute vendor fee — the deliberate choice. It runs off the cascade's already-inspectable TTS audio, so it adds **zero clinical authority and needs no Model Gateway path**; every generated audio/visual segment is **C2PA-marked at generation** (Art. 50(2), [`04` §5](../04-avatar-and-vitals-engine.md), [`09`](../09-security-and-compliance-architecture.md)) alongside the voice pipeline's markers. **Cheap client-side visemes** (TTS phoneme timing → ~15 Oculus/ARKit shapes) are the default free-tier / 2D-2.5D lip-sync **and the fallback when the A2F-3D microservice is down** — the face keeps talking at lower mouth fidelity ([`04` §6.1, §8](../04-avatar-and-vitals-engine.md)). Streaming photoreal (Simli/HeyGen) remains the premium/OSCE alternative that bundles its own lip-sync.

**Consequences.** Lip-sync at ~$0 marginal cost on the device floor, portable across fidelity tiers because it speaks ARKit-52. Adds a self-hosted A2F-3D service to operate; the sign⟂viseme partition (§4.3) is the mechanism that keeps sign overlay and A2F-3D blendshapes from contending on shared facial channels, and its exact blendshape allocation is a named Tier-2 blocker to finalize with SMEs.

**Alternatives rejected.** Streaming-vendor lip-sync as default (per-minute cost, cannot render clinical signs); a proprietary/non-ARKit blendshape output (breaks the write-once sign schema and RPM tooling); no lip-sync on the client-3D tier (uncanny, undercuts the embodiment value).

---

*Sources: `docs/00-overview/01-requirements-and-constraints.md` (requirements baseline — §4 tensions T1–T12, §2 requirements incl. AV-1..AV-4 / AD-1..AD-7, §3 NFRs incl. §3.5 accessibility, §7 risks); and the full 11-doc architecture set `docs/architecture/00-system-overview.md`; `01-ai-agent-architecture.md`; `02-model-gateway-and-routing.md`; `03-voice-pipeline.md`; `04-avatar-and-vitals-engine.md`; `05-guideline-grounding-engine.md`; `06-assessment-and-calibration-engine.md`; `07-multiplayer-rooms.md`; `08-data-model-and-multitenancy.md`; `09-security-and-compliance-architecture.md`; `10-api-and-integration-surface.md`.*
