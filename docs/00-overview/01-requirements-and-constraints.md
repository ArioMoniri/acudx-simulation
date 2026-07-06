# 01 — Requirements & Constraints (Authoritative Baseline)

**Status:** Foundational. Every later technical, design, and business phase builds on this document. It **consolidates** the twelve research/stakeholder docs under `docs/research/` and `docs/stakeholders/`; where those disagree, the reconciled stance is stated here and the source is cited as `[research:NN]` / `[stake:NN]`. Do not introduce requirements that contradict the sources without amending this file.

**Time context:** July 2026. Version/price/regulatory claims trace to the source docs (which carry inline primary-source citations); treat exact `$`/dates as snapshots and pin *architecture*, not vendor IDs.

**Source map:** `[research:models]`=01-llm-models-and-cost · `[research:voice]`=02-voice-ai · `[research:3d]`=03-3d-avatars · `[research:market]`=04-market-competitors · `[research:guidelines]`=05-clinical-guideline-grounding · `[research:regulatory]`=06-regulatory-compliance · `[research:assessment]`=07-assessment-science · `[stake:learners]`=01 · `[stake:educators]`=02 · `[stake:institution]`=03 · `[stake:policy]`=04 · `[stake:builders]`=05.

---

## 1. Product vision & positioning

**Vision.** AcuDx is the **interaction-and-assessment layer** for health-professions education: learners (medical students, residents, nurses, paramedics) practice real clinical *encounters and teamwork* by roleplaying — taking a history, examining, ordering and interpreting tests, reasoning to a differential, diagnosis, and management — against AI patients, colleagues, families, and dispatchers, solo or in multiplayer role-based rooms. Every encounter returns a defensible, competency-mapped assessment, a Dunning-Kruger calibration plot (self-rated confidence vs measured competence), and a gap-to-remediation loop; institutions get accreditation-grade cohort analytics. AcuDx competes on *interaction fidelity and assessment rigor*, not content breadth — it partners for guidelines rather than reproducing them `[research:market]`.

**Positioning (one paragraph).** *For medical, nursing, and paramedic educators and their learners who need to practice clinical encounters and teamwork at scale — beyond menu-clicking single-player cases and beyond what scarce clinical placements and standardized-patient actors can supply — AcuDx is an AI-native clinical-roleplay and simulation platform that runs multiplayer, role-based rooms with duplex-voice and progressively-embodied AI patients, grounds real-time Socratic guidance in current country-specific guidelines, and returns calibration analytics mapped to Miller/ACGME/CanMEDS/EPA frameworks. Unlike Body Interact, i-Human, and Shadow Health (single-player, menu/typed, scripted) or AMBOSS/UpToDate (content without live roleplay), AcuDx is built voice-, team-, and analytics-first — at a price that reaches individuals, not just procurement departments* `[research:market]`.

**The whitespace (product core, not optional features):** the empty top-right quadrant no competitor holds — **(1) multiplayer role-based rooms + (2) duplex-voice/embodied roleplay + (3) calibration analytics + (4) guideline-grounded Socratic guidance** — treated together as compound differentiation `[research:market]`. The **wedge that ships first**, however, is deliberately narrower (§6).

---

## 2. Consolidated requirements matrix

**Tiering:** **MVP** = the wedge that must be excellent before anything else · **v1** = fast-follows that complete the institutional/premium value · **v2** = later, gated, or opportunistic. Tags reflect the reconciled MoSCoW from `[stake:learners]` and the builder scope discipline in `[stake:builders]`. "Demanded by" names the stakeholder(s) whose adoption/veto depends on it.

### 2.1 Roleplay engine (the core loop)

| # | Requirement | Tier | Demanded by |
|---|---|---|---|
| RP-1 | Solo-vs-AI text encounter, structured stages: history → exam request/interpret → tests → differential → diagnosis → management | **MVP** | Learners (all), Educators |
| RP-2 | Patient variants: geriatric, anxious, aggressive, low-health-literacy, non-native speaker, cognitively impaired, pediatric-via-parent | **MVP** | Learners, Clinical-skills tutor |
| RP-3 | Role interchangeability: learner is doctor / nurse / paramedic / examiner / team-lead; AI fills remaining roles (patient, senior colleague, family, dispatcher, ED) | **MVP** (role select) → **v1** (full set) | Nursing, paramedic, senior learners |
| RP-4 | Live vitals monitor + trend charts (HR/BP/RR/SpO2/Temp; CV & respiratory trends) as an in-encounter, screen-reader-labeled data source; **authoritative case state** serves all labs/exam/vitals (the AI-patient never sources clinical facts) | **MVP** | Nursing (hero feature), all; `[research:models]` |
| RP-5 | Difficulty + forgiveness dials (MS1 = high scaffolding/no penalty for naive questions; senior = high ceiling/sparse hints); adaptive difficulty on two axes (case complexity ⟂ patient-agent difficulty), target ~70–85% success band | **MVP** (dials) → **v1** (adaptive) | Pre-clinical & senior learners; `[research:assessment]` |
| RP-6 | Resumable, drop-tolerant, server-authoritative sessions; resume in ≤2 taps; every case fully completable in **text at <100 kbps** | **MVP** | Interns, nursing, paramedic, LMIC/ESL learners |
| RP-7 | Deterministic safety interceptor **outside** the roleplay LLM for red-flag cues (self-harm/abuse/safeguarding/dangerous management) → break character + resources | **MVP** | Skills tutor (kill-switch test), Clinical governance |
| RP-8 | Agent-only observable rooms (learner watches AI-vs-AI, then joins) | v2 | Learners (C1) |

### 2.2 Multiplayer rooms (the moat)

| # | Requirement | Tier | Demanded by |
|---|---|---|---|
| MP-1 | Realtime multi-human rooms, each a distinct role, AI backfilling empty roles; WebRTC room model | **v1** | Senior residents (team-lead), OSCE pairs; `[research:market]` (hardest-to-copy moat) |
| MP-2 | Server-authoritative, event-sourced room state; idempotent tool calls; role reassignment & AI backfill as events; graceful text fallback on WebRTC failure | **v1** | Realtime/backend eng `[stake:builders]` |
| MP-3 | Team/leadership rubric (delegation, situational awareness, closed-loop comms); debrief separating individual leadership marks from team clinical marks | **v1** | Senior residents; `[research:assessment]` |
| MP-4 | 100 concurrent rooms with no p95 regression (staging gate) | v1 | Builders (SLO) |

### 2.3 Voice (STT/TTS/duplex)

| # | Requirement | Tier | Demanded by |
|---|---|---|---|
| V-1 | Composable **cascade STT→LLM→TTS** pipeline (NOT native speech-to-speech) as default, for auditable clinical text, grounding, per-case routing, cost transparency | **v1** | Builders, Clinical content; `[research:voice]` |
| V-2 | Medical-tuned STT (Deepgram Flux live + Nova-3 Medical keyterms; batch Nova-3 for assessment transcript); **accent-robust with text fallback** (low STT confidence → text, never silent mis-score) | **v1** | ESL/IMG learners (fastest churn path), paramedics; `[research:voice]` |
| V-3 | Expressive TTS (Cartesia Sonic-3 live + pre-rendered ElevenLabs v3 emotional peaks + 30–50 consented-actor Professional Voice-Clone persona library) | **v1** | Learners (roleplay realism); `[research:voice]` |
| V-4 | Barge-in mandatory (flush TTS + truncate LLM + commit partial); turn-taking params (EoT threshold, over-talk, pause tolerance) are **per-persona knobs** | **v1** | Paramedic/OSCE realism; `[research:voice]` |
| V-5 | Full **non-voice equivalent** for every voice feature (captions on TTS, text alt for STT); voice is enhancement, never a gate | **v1** (with voice) | Deaf/HoH learners, WCAG, LMIC; `[research:regulatory]`, `[stake:learners]` |
| V-6 | Native S2S (Gemini Live 2.5 Native Audio) as "cinematic" fallback/premium only; OpenAI Realtime as benchmark/last failover only | v2 | `[research:voice]` |

### 2.4 Avatars (embodiment)

| # | Requirement | Tier | Demanded by |
|---|---|---|---|
| AV-1 | 2D persona portrait + emotion set + **physiology-driven clinical-sign overlay** (cyanosis/pallor/diaphoresis/distress/LOC) driven by the vitals engine; avatar & monitor never contradict | **v1** | Learners, Clinical content; `[research:3d]` (the medical differentiator) |
| AV-2 | Abstract sign/state schema authored **once**, renders identically across 2D/2.5D/3D/streaming; each sign has a numeric intensity the assessment layer can score | **v1** (schema is the contract) | `[research:3d]`, Assessment |
| AV-3 | Standardize on **ARKit-52 blendshapes** as interchange; client-rendered default (Three.js + R3F, WebGPU w/ WebGL2 fallback, Ready Player Me rig); ~$0 marginal | v2 | `[research:3d]` |
| AV-4 | Streaming photoreal (Simli default, HeyGen max fidelity) gated to **premium/OSCE** only ($0.05–0.20/min); self-hosted Audio2Face-3D for client-3D lip-sync | v2 | Premium buyers; `[research:3d]` |

### 2.5 Guidance mode (grounded Socratic hints)

| # | Requirement | Tier | Demanded by |
|---|---|---|---|
| G-1 | Guidance toggle; scaffolded Socratic hints **retrieval-grounded and cited**, never long-context, never free-generated clinical facts | **MVP** | MS1 (scaffolding), Clinical governance; `[research:guidelines]` |
| G-2 | `GuidelineStatement` store: versioned, country/council-scoped, cited, license-tagged, clinician-approved; Postgres/JSONB source of truth + HNSW hybrid dense+BM25 index; **country is a first-class retrieval filter** (filter before rank) | **MVP** (store first) | Ministries, seniors/paramedics, Educators; `[research:guidelines]`, `[stake:policy]` |
| G-3 | Runtime safety pipeline on every output, in order: retrieval-grounded generation → **hard citation gate** → cheap-tier verifier/faithfulness → deterministic dose/threshold check → out-of-scope refusal → citations + education-only disclaimer. **Abstain > confident-wrong** | **MVP** | Clinical governance, MDU/MPS; `[research:guidelines]`, `[stake:policy]` |
| G-4 | Surface legitimate country divergence as a teaching feature (ESC 140/90 vs AHA/ACC 130/80; ILCOR→{AHA,ERC}→national; SSC-2026 vs NICE/NEWS2); never silently US-default | v1 | Ministries, seniors; `[research:guidelines]` |
| G-5 | Freshness watch (NICE daily XML, ICD Oct-1, ESC congress, ILCOR CoSTR) opens **review tasks**; **never auto-publishes** clinical content; "last reviewed" date shown | v1 | Educators, Clinical governance; `[research:guidelines]` |
| G-6 | Open-license domains first (WHO/GINA/GOLD/USPSTF/CDC/NICE-UK); defer ATLS/UpToDate/AMBOSS to licensing deals (budget NICE international + ≥1 proprietary partner) | MVP→v1 build order | Business, Legal; `[research:guidelines]` |

### 2.6 Assessment & calibration

| # | Requirement | Tier | Demanded by |
|---|---|---|---|
| AS-1 | Fixed **6-domain internal rubric** (history · exam/investigations · reasoning · communication · management · professionalism/teamwork); external frameworks via **versioned crosswalk tables (data, not code)** | **MVP** | Assessment Director, Curriculum Director; `[research:assessment]` |
| AS-2 | **Case-specific rubric per case** (10–40 behavioral-anchor checklist items + weights), human-reviewed, version-hashed, authored ahead of grade time — never improvised by the grader | **MVP** | Examiners, Content authors; `[research:assessment]` |
| AS-3 | Decomposed grading: per-item `{met, evidence_span (forced transcript quote), confidence}`, deterministic code-side aggregation, lower-weighted anchored GRS, temp 0, structured JSON | **MVP** | Examiners (traceability); `[research:assessment]` |
| AS-4 | **Grader model ≠ patient-agent model family**; ensemble ≥2 families on high-stakes items; mitigate position/verbosity/self-preference/leniency/prompt/demographic bias | **MVP** | `[research:assessment]` |
| AS-5 | **Dual-axis feedback**: clinical reasoning score separate from communication/language score | **MVP** | ESL/IMG learners (highest-leverage), all; `[stake:learners]` |
| AS-6 | Reliability gates + **band-only granularity**: weighted κ ≥ 0.6 to display a domain score, ≥ 0.7 to drive pass/fail; grade ≥3× for self-consistency; UI/XP/dashboards use **4–5 bands, never decimals** (exact-score acc ~0.52 vs band ~0.83–0.88) | **MVP** | Examiners, Accreditation; `[research:assessment]`, `[stake:policy]` |
| AS-7 | **Calibration plot**: elicit per-domain & per-decision confidence **before** score reveal; Brier (decomposed) + signed OCI + reliability diagram + ECE + discrimination; banded quadrants + shrinking-gap trajectory; framed as trainable skill; **never on a public leaderboard** | **MVP** | Learners (signature feature); `[research:assessment]` |
| AS-8 | Gap analysis (free from evidence spans) → FSRS spaced repetition (knowledge) + mastery learning (skills; e.g. entrustment ≥4 across ≥3 cases); **safety-critical misses surfaced always & separately** regardless of score | MVP (gap) → v1 (SRS/mastery) | Learners, Educators; `[research:assessment]` |
| AS-9 | **Transcript-anchored, one-click-overridable** scoring; mandatory override reason; immutable audit log ≥6 months | **MVP** | Examiners (inadmissible otherwise); `[stake:educators]` |
| AS-10 | `assessment_mode: formative | summative-with-review` hard flag; summative requires named human co-sign; validity dossier per case-type (Kane argument, IRR vs faculty, DIF/subgroup fairness) | MVP (formative) → v2 (summative stack) | Educators, Accreditation, Policy; `[stake:educators]`, `[stake:policy]` |

### 2.7 Gamification

| # | Requirement | Tier | Demanded by |
|---|---|---|---|
| GM-1 | XP/levels tied to **mastery & improvement** (closing gaps, tightening calibration), not raw score/volume | **MVP** | Learners; `[research:assessment]`, `[stake:learners]` |
| GM-2 | **Forgiving streaks** (freeze/grace days) — burnout-aware (~37% baseline) | **MVP** | Learners; `[stake:learners]` |
| GM-3 | Badges for competency milestones + EPAs entrusted; identity-reinforcing | v1 | Learners |
| GM-4 | **No public global leaderboards** (RCT evidence they harm learning/collaboration); opt-in cohort-only, ranked on personal improvement/calibration if used; reward multiplayer teamwork | v1 | Learners, Educators; `[research:assessment]` |

### 2.8 Institution dashboard ("dean's office")

| # | Requirement | Tier | Demanded by |
|---|---|---|---|
| IN-1 | Cohort competency heatmap (learner × domain/Milestone/EPA), drill-down cohort→section→learner→encounter→**evidence span**, role-gated | **v1** | Dean, Assessment Director, Accreditation; `[stake:institution]`, `[research:assessment]` |
| IN-2 | At-risk/remediation closed loop (detect→diagnose→prescribe→re-assess→document, exportable) | **v1** | Assessment Director (the money feature); `[stake:institution]` |
| IN-3 | **One-click accreditation export** tagged to LCME/ACGME/CanMEDS/AAMC-EPA elements (de-identified) | **v1** | Accreditation Liaison, Dean (#1 renewal lever); `[stake:institution]` |
| IN-4 | Aggregate cohort **calibration** view (systematic over/under-confidence by topic — a curriculum signal) | v1 | Assessment Director; `[research:assessment]` |
| IN-5 | Longitudinal trajectories, Milestone rollups feeding CCCs as **supplementary** evidence; gap-to-curriculum mapping | v1 | Program directors, Accreditation |
| IN-6 | Editable, versioned, exportable competency-mapping layer (prebuilt ACGME/CanMEDS 2025/AAMC-EPA/LCME; configurable per-institution taxonomy) | **v1** | Curriculum Director (adoption trigger); `[stake:institution]`, `[stake:educators]` |
| IN-7 | Mandatory demographic/language **fairness audit dashboards**; human-review flag on any progression-feeding signal | v1 | Policy, DPO; `[research:assessment]`, `[stake:policy]` |

### 2.9 Authoring

| # | Requirement | Tier | Demanded by |
|---|---|---|---|
| AU-1 | 6-stage **AI-drafts / human-authoritative** pipeline (blueprint → AI draft → expert review & lock → peer/psychometric → publish+version → monitor) with enforced credentialed **clinician sign-off gate**; target ~64 person-hrs → ~2–4 hrs review/case | **MVP** (basic) → v1 (full) | Content authors, Curriculum Director; `[stake:educators]` |
| AU-2 | Locked facts + provenance on every clinical claim + version-hash; guideline update **flags** affected cases for re-review, never silent rewrite | **MVP** | Content authors, Clinical governance; `[stake:educators]`, `[research:guidelines]` |
| AU-3 | Open case schema (align ANSI/MedBiquitous Virtual Patient); no IP capture; institution-uploadable/pluggable rubrics (OSCE mark schemes, SBAR, service protocols, leadership) | v1 | Content authors, OSCE/nursing/paramedic learners; `[stake:educators]`, `[stake:learners]` |
| AU-4 | MCP enrichment (ICD-10 FY2026, ChEMBL, PubMed, ClinicalTrials) at **authoring time under clinician review**; runtime MCP limited to cheap deterministic lookups (e.g. validate learner-entered ICD) | v1 | Content authors; `[research:guidelines]` |

### 2.10 Admin, integration & platform

| # | Requirement | Tier | Demanded by |
|---|---|---|---|
| AD-1 | **LTI 1.3 Advantage Complete** (1EdTech-certified): OIDC SSO + roster (NRPS) + deep-link + grade passback (AGS); LTI 1.1 deprecated | **v1** (P0 for institutional) | IT/Security, Coordinator; `[stake:institution]` |
| AD-2 | Standalone SAML 2.0 (Shibboleth/InCommon) + OIDC + SCIM 2.0 / OneRoster 1.2 for non-LMS deployments | v1 | IT/Security; `[stake:institution]` |
| AD-3 | Caliper 1.2 / xAPI learning-event emission to institutional LRS/warehouse | v1 | Analytics-mature buyers; `[stake:institution]`, `[research:assessment]` |
| AD-4 | Internal **model gateway** — no vendor SDK calls in business logic; per-task routing + prompt caching; 3-tier router pinned (not model IDs) | **MVP** | Architect, ML eng; `[stake:builders]`, `[research:models]` |
| AD-5 | **Event-sourced, append-only encounter log** = single source of truth (replay/debrief, grading, analytics, ≥6-mo audit); deterministically replayable | **MVP** | Architect, Data eng, Policy; `[stake:builders]`, `[stake:policy]` |
| AD-6 | Region-pinned multi-tenant deployment (eu-central, uk, us; me-central/ap on demand); learner PII/analytics never leave region; in-region zero-retention/no-train inference for EU/UK | v1 | Ministries, DPO; `[research:regulatory]`, `[stake:institution]` |
| AD-7 | On-prem/VPC appliance tier (self-host roleplay via Qwen3-32B/Llama 4 Scout + MedGemma 1.5/Meditron grounding) for privacy-maximal institutions; break-even vs API ≈ >3–5M tokens/day | v2 | Privacy-sensitive institutions; `[research:models]`, `[stake:institution]` |

---

## 3. Non-functional requirements & constraints

### 3.1 Cost & token budget

| Target | Value | Source |
|---|---|---|
| Blended **text**-encounter cost (optimized) | **~$0.43** (conservative ~$1.10); **SLO < $0.15** at MVP volume | `[research:models]`, `[stake:builders]` |
| Naïve anti-pattern (do not build) | ~$6.30/encounter → ~$63K/day at 10K enc/day | `[research:models]` |
| Optimized at 10K enc/day | ~$4.3K/day | `[research:models]` |
| **Voice** all-in (composable) | **~$0.05–0.09/min**; ~$9K–16K/mo for a 5,000-student cohort (vs $50K+ naïve OpenAI Realtime) | `[research:voice]` |
| Streaming avatar (gated premium) | $0.05/min (Simli) – $0.20/min (HeyGen); 12-min = $0.60–$2.00 | `[research:3d]` |
| Client-rendered avatar marginal | ~$0 | `[research:3d]` |
| Contribution margin | Must be **positive** on paid tier; voice & 3D are **premium tiers, never free-tier defaults** | `[stake:builders]` |

**Cost architecture (mandatory, existential — not optional):**
- **3-tier router** (Small→Mid→Frontier): patient turns default **Haiku 4.5** ($1/$5), escalate to **Sonnet 5** ($3/$15; intro $2/$10 through 2026-08-31) only on persona-break/clinical-fact/low-confidence/guardrail signal; **never start turns at frontier** `[research:models]`.
- **Grading/gap-analysis/authoring = Opus 4.8** ($5/$25) via **Batch API (−50% = $2.50/$12.50)**; calibration is deterministic code, no LLM `[research:models]`.
- **Prompt caching is the single biggest lever (~55% of savings):** byte-stable cached prefix (persona + case brief + guideline snippets); **no timestamps/UUIDs/unsorted JSON** or the cache silently misses. Cache reads ~0.1× input `[research:models]`.
- **RAG, not long-context** (~25% of savings): retrieve 2–5 passages per guidance turn; never stuff guideline PDFs into context.
- **Batching** (~10%), context compaction, streaming, small-model drafting, 20-min encounter cap + idle timeout.
- **AVOID Claude Fable 5 in the live roleplay path** — it refuses bio/cyber-adjacent content; use Opus 4.8, configure server-side refusal fallbacks if Fable authors offline `[research:models]`.

### 3.2 Latency budgets

| Path | Target | Source |
|---|---|---|
| **Text** turn | p95 **< 1.5 s** | `[stake:builders]` |
| **Voice** round-trip (speech-to-speech) | **< 800 ms p50, < 1200 ms p95**; first-audio < 800 ms; hard ceiling ~1.2 s before it feels robotic | `[research:voice]`, `[stake:learners]`, `[stake:builders]` |
| STT end-of-turn (Deepgram Flux) | < 400 ms | `[research:voice]` |
| TTS time-to-first-audio (Cartesia) | ~90 ms (Sonic-3) / ~40 ms (Turbo) | `[research:voice]` |
| Grounding + assessment | **Out-of-band** — must **NEVER block** the conversation loop | `[stake:builders]` |

**Three isolated clocks** (architectural invariant): conversation loop (100s of ms) · grounding+assessment (seconds, auditable, out-of-band) · analytics/institutional (batch) `[stake:builders]`.

### 3.3 Scale, availability, offline

- Target a 4–5-year-old student laptop (integrated GPU, WebGL2-possible) and mid-range phones on 4G as the **device floor** `[research:3d]`; **phone-first, one-handed** entry `[stake:learners]`.
- Sessions **survive network drops** (server-authoritative, checkpoint each turn); text mode works at **<100 kbps** `[stake:learners]`.
- Uptime SLA target **≥99.9%** with credits + public status page `[stake:institution]`.
- 100 concurrent multiplayer rooms on staging with no p95 regression `[stake:builders]`.
- WebRTC only where needed (voice/multiplayer, $0.0005/min + agent $0.01/min via LiveKit); text-only solo uses cheaper WebSocket/SSE `[stake:builders]`.

### 3.4 Privacy, residency & data governance

- **Synthetic patients only, no real PHI** → learner data is **FERPA + GDPR, not PHI**; keep the two data classes physically separated. Detect-and-block real-PHI entry. HIPAA out of scope by construction `[research:regulatory]`, `[stake:institution]`, `[stake:builders]`.
- **`no_train=true` by default** on all learner data and every LLM call (`store=false`/zero-retention endpoints); model-training only via explicit institutional opt-in + de-identification `[research:regulatory]`, `[stake:policy]`.
- **Two physically-separated data planes:** identified-education (institution-owned, never trains models) vs de-identified/synthetic-improvement (the only plane training pipelines may read) `[stake:policy]`.
- **Unbundled, per-purpose, revocable consent** (learn / improve / research); never condition education on training-data consent `[stake:policy]`.
- Act as **processor** (GDPR Art. 28 DPA + FERPA "school official" terms); publish sub-processor + model-provider list with 30-day change notice `[research:regulatory]`, `[stake:institution]`.
- **DPIA before launch** for calibration/competency analytics (= profiling) `[research:regulatory]`.
- **Region-pinned tenancy** with in-region zero-retention inference for EU/UK (Azure OpenAI EU zones / Bedrock EU / Vertex EU / Mistral) `[research:regulatory]`.
- **Never infer learner emotion for assessment** — prohibited in EU education since Feb 2025 (roleplaying an anxious *patient* is fine; reading the *learner's* emotion as an assessed dimension is banned) `[stake:institution]`, `[research:regulatory]`.

### 3.5 Accessibility

- **WCAG 2.2 AA is the non-negotiable baseline** (EAA enforceable since 28 Jun 2025; EN 301 549 v4.1.1 (2026) adopts 2.2; US Section 508/ADA Title II parallel, DOJ deadlines Apr 2026/2027) `[research:regulatory]`, `[stake:institution]`.
- Every voice/duplex feature needs a **full non-voice equivalent** (captions, text alt); no voice-only feature `[research:regulatory]`.
- Vitals monitor/charts **must not rely on colour alone** (WCAG 1.4.1); provide text/table equivalents + ARIA live regions; non-audio alarm cues `[research:regulatory]`.
- Keyboard-operable, screen-reader-labeled, focus-visible, 24×24 CSS-px targets, no drag-only interactions; **no-timer/extended-time modes**, dark mode; publish a VPAT / accessibility statement `[research:regulatory]`, `[stake:learners]`, `[stake:institution]`.

### 3.6 Clinical safety & AI-Act

- **"Education, not clinical care" is the load-bearing wall:** no real-patient-input path; written intended-purpose statement everywhere; guidance framed against the fictional case; **no accuracy/efficacy/patient-outcome claims**. Keeps AcuDx out of FDA CDS and EU MDR/MDSW device scope `[research:regulatory]`, `[stake:policy]`.
- **DCB0129-style clinical-safety file** + named **Clinical Safety Officer** + **Hazard Log**; #1 hazard = stale/wrong/wrong-country guideline hints `[research:regulatory]`.
- **Two AI-Act obligations bind now regardless of tier:** Art. 4 AI-literacy (enforced Aug 2026) and Art. 50 transparency (live **2 Dec 2026**) — disclose AI interaction + **C2PA-watermark/label all synthetic voice/avatar/media** `[research:regulatory]`.
- **Model registry + pre-promotion evals** (accuracy/safety/bias/hallucination) gate every model/prompt change; **no silent model swaps**; red-team suite (drug doses, pediatric weight-based calcs, country-threshold traps) in CI `[research:regulatory]`, `[research:guidelines]`.
- **One immutable, tamper-evident, hash-chained audit-log spine** (auth, assessment events, model calls w/ version+prompt hash, guideline versions served, safety triggers, admin actions) from day one; dual incident process (GDPR 72h breach + clinical hazard log) + in-product "report incorrect medical content" `[research:regulatory]`, `[stake:policy]`.
- **Version-locking:** scoring models + guideline packs pinned per cohort/assessment window; published changelog `[stake:policy]`.

### 3.7 Enterprise-readiness gates (each is a potential veto)

HECVAT 4 (321 Qs incl. 32-Q AI/ML section) · SOC 2 Type II · VPAT/WCAG 2.2 AA · annual third-party pen-test · encryption at rest (AES-256) + in transit (TLS 1.2+) · DPA/BAA templates ready · named subprocessor list + EU/UK residency · uptime SLA + status page · incident-response plan. Any one missing = weeks of delay or veto `[stake:institution]`. Certification roadmap: **ISO/IEC 42001** (AI management) + ISO 27001 + EU AI Act conformity as compounding procurement moats `[stake:policy]`.

---

## 4. Hardest cross-cutting tensions & chosen stance

| # | Tension | Chosen stance | Rationale / source |
|---|---|---|---|
| T1 | **Frontier-model quality vs cost** | 3-tier router: Haiku default patient turns → Sonnet escalation → Opus (batched) for grading only. Pin the *router*, not model IDs. Cache-first prompts. Never start at frontier. | Frontier at scale is unviable ($63K/day); routing+caching+RAG cut ~93% while preserving quality where it matters (grading, hard turns). `[research:models]`, `[stake:builders]` |
| T2 | **Roleplay realism vs clinical safety** | **Two-tier content architecture:** grounded layer (versioned, SME-signed, citation-or-refuse) owns *all* clinical facts/doses/guidelines; roleplay layer improvises affect but **cannot assert clinical facts**. AI-patient never sources facts — case state does. Deterministic safety interceptor outside the LLM. | The AI-patient is the actor, not the truth; separating them removes the biggest hallucination surface and keeps the "aggressive patient" from becoming unsafe. `[research:models]`, `[stake:policy]`, `[stake:educators]` |
| T3 | **Guideline quality vs licensing/copyright** | Open-license domains first (WHO/GINA/GOLD/USPSTF/CDC/NICE-UK); clinician-authored **structured summaries + cite/deep-link** for copyrighted-published; **partner licenses** for proprietary (ATLS/UpToDate/AMBOSS). **No scraping, no fine-tuning on full text, ever.** Content rights = the moat. | Copyright is existential; OpenEvidence ($12B, >40% US physicians) proved licensed content is the moat. `[research:guidelines]`, `[research:market]` |
| T4 | **LLM grading validity vs automation** | **Formative-by-default; human co-sign for summative.** Band-only granularity (κ≥0.6 to show, ≥0.7 for pass/fail; exact acc ~0.52 vs band ~0.83–0.88). Grader family ≠ patient family. Transcript-anchored + overridable. Anchor set of expert-rated transcripts is the moat. | LLM scoring ceiling is real (κ≈0.44 diagnosis; systematic under-scoring 0.7–1.3 pts; weak on differential). Black-box summative is the educator kill-switch and EU AI Act high-risk. `[research:assessment]`, `[stake:educators]`, `[stake:policy]` |
| T5 | **Institutional summative value vs EU AI Act high-risk** | Ship **two tracks**: default advisory-to-human (Art. 6(3) → limited-risk, achievable now); separate opt-in "institutional summative" mode = Annex III high-risk, full stack, target **2 Dec 2027** (Digital Omnibus deadline). No AI-only consequential decision, ever. No AI proctoring in core product. | Auto-gating progression + profiling learners = high-risk; the 6(3) exception is weakest exactly there. `[research:regulatory]`, `[stake:institution]`, `[stake:policy]` |
| T6 | **Country-specific truth vs single global answer** | **Country is a first-class retrieval filter** (filter before rank). Hold divergent guidelines as **parallel cited statements** (ESC 140/90 ∥ AHA/ACC 130/80). Score against the case's declared council; surface divergence as a teaching feature; never silently US-default. | The "correct" answer legitimately differs by body; a 135/85 diagnosis is right under AHA/ACC, wrong under ESC. Ministries reject US-defaulted tools. `[research:guidelines]`, `[stake:policy]` |
| T7 | **Voice immersion (native S2S) vs auditability/control** | **Composable cascade STT→LLM→TTS is the default** (inspectable clinical text for grounding/assessment/per-case routing/cost). Native S2S (Gemini Live) is cinematic-fallback/premium only; OpenAI Realtime benchmark only. | Auditability wins in a regulated assessment product; cascade can hit ~700–900 ms competitive latency; native S2S hides reasoning in audio tokens. `[research:voice]`, `[stake:builders]` |
| T8 | **Embodiment (photoreal 3D) vs cost & clinical-sign control** | **2D-first, clinical-signs-first, client-rendered.** The sign channel is the medical differentiator (~$0 marginal). Streaming photoreal gated to premium/OSCE only — streaming vendors **cannot expose clinical-sign shaders**. | Photorealism that can't toggle "cyanosis @ SpO2 82%" is decorative; streaming at $0.05–0.20/min dominates cost at scale. `[research:3d]` |
| T9 | **Educator workload: help vs net burden** | Every educator feature judged "does this save me time this week?"; target 64 person-hrs → 2–4 hrs review/case. **Instrument educator-minutes per institution; prove net-negative or the thesis inverts.** | Adoption dies if oversight burden (sign-off, override review, re-validation) exceeds creation-time saved. `[stake:educators]` |
| T10 | **Gamification engagement vs learning harm** | Reward **process & mastery** (closing gaps, tightening calibration, EPAs entrusted), forgiving streaks, cohort-only opt-in leaderboards. **No public global leaderboards; calibration never ranked.** | RCT evidence: competitive leaderboards undermine learning/collaboration & raise stress in a ~37%-burnout population. `[research:assessment]`, `[stake:learners]` |
| T11 | **Bottom-up PLG vs enterprise sales cycle** | **Bottom-up PLG** — MVP individually valuable without the institution (learner is wedge & champion). Land with learner-loved product; expand/renew on dean-office value. Dual pricing. | Avoids being hostage to a 6–14-month, 7-veto university cycle; the learner champion drags the institution in. `[stake:builders]`, `[stake:institution]`, `[research:market]` |
| T12 | **Moat vs commodity models** | Moat is **not** the LLM. It is: validity/assessment dossier + clinician-graded eval flywheel + national-guideline curation partnerships + LTI/Caliper institutional lock-in + audit substrate as system-of-record + cert stack. Compounds, can't be bought. | Models are rentable by anyone; OpenEvidence/AMBOSS own content+attention. Defensibility is the roleplay+assessment+validity loop. `[stake:policy]`, `[stake:builders]`, `[research:market]` |

---

## 5. Business-model constraints (baseline for the business phase)

- **Dual pricing (mandatory):** individual/prosumer **sub-$15/mo** + CME upsell (anchors: Full Code $11.99/mo & $99.99 Pro+CME; AMBOSS $12.50–19.99/mo) **AND** institutional quotes anchored ~$120/seat/yr, landing **~$25k–$150k/yr** per UME cohort (100–200/class), **$300k–$500k/yr** multi-campus/GME `[research:market]`, `[stake:institution]`.
- **Absorb AI token cost into seat price; never usage-meter the institution.** Transparent per-seat/per-cohort with renewal cap (~CPI/5%); 10–20% multi-year-prepay discount; use E&I/Internet2 NET+ co-op vehicles to skip RFPs (>~$50k–$100k triggers an RFP) `[stake:institution]`.
- **Sell to a 7-role committee:** champion = Assessment Director, economic buyer = Dean, unilateral-veto blockers = IT/Procurement/DPO/Accreditation. 6–14-month cycle; a July pilot targets *next* fiscal-year budget `[stake:institution]`.
- **Do NOT out-content incumbents** (AMBOSS/UpToDate/Aquifer own content); partner for guidelines, compete on interaction + assessment `[research:market]`.
- **Market context:** simulation ~$3B (2026), 15–17% CAGR; software/virtual-patient sub-slice growing ~20%+; NCSBN 50%-simulation-substitution + state legislation (NY 30% nursing clinicals) legitimize sim as accreditation-grade `[research:market]`. Competitive watch: OpenEvidence ($12B, >40% daily US physicians); highest head-on collision = Aquifer + Elsevier/Shadow Health; nearest AI-native peer = SimCare AI ("20 vs 200 encounters," group sims) `[research:market]`, `[stake:builders]`.

---

## 6. Prioritized MVP definition

**The wedge (ships first, must be 10× not 1.2×):** *solo learner ↔ AI-patient, **text-first**, **Emergency Medicine**, structured feedback + **Dunning-Kruger calibration plot**.* Voice, 3D, multiplayer, and dean's-office dashboards are **gated fast-follows, not MVP** `[stake:builders]`, `[stake:learners]`.

**Why EM/OSCE-shaped:** Step 2 CS was permanently discontinued with no standardized replacement, pushing clinical-skills assessment to institutional ~12-station OSCEs — a durable, unmet demand for on-demand encounter practice `[stake:learners]`.

**MVP ships (from §2):** RP-1..RP-7 · RP-4 vitals · G-1 guidance toggle · G-2/G-3 grounding store + safety pipeline (open-license domains only) · AS-1..AS-7 assessment + calibration · AS-8 gap analysis · AS-9 traceable/overridable scoring · AS-10 formative mode · GM-1/GM-2 gamification · AU-1/AU-2 basic authoring + provenance · AD-4 model gateway · AD-5 event-sourced log. Dual-axis feedback (AS-5) from day one.

**Two scope-defining non-negotiables (architecturally enforced):**
1. **`assessment_mode: formative`** — keeps AcuDx *below* EU AI Act Annex III high-risk.
2. **Synthetic-patients-only / no real PHI** — keeps it FERPA-governed, not HIPAA.
Both are deliberate later gates to relax (summative, real-data) — never accidental `[stake:builders]`.

**MVP success gate (before expansion):** cohort ≥200 learners with **D30 retention ≥25%**, median **≥3 encounters/week**, **measured competence rises** wk1→wk6 on a held-out case (not just self-rated confidence), first-encounter completion **>70%**, learners correctly interpret their calibration plot (≥80% usability), blended text-encounter cost **<$0.15**, and **one paid design-partner school pilot** `[stake:builders]`, `[stake:learners]`.

**Fast-follow order after the gate:** (1) multiplayer team rooms (the moat) — prioritized *above* single-player polish `[research:market]`; (2) voice (cascade); (3) institution dashboard + LTI 1.3; (4) 2D clinical-sign avatar; (5) summative track + full compliance stack toward Dec 2027; (6) 3D/streaming premium; (7) on-prem appliance.

---

## 7. Top 10 risks & mitigations

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| R1 | **Clinical hallucination** reaches a learner as "correct" (AI-patient invents pathophysiology; hint contradicts guideline) — the educator kill-switch | Critical | Two-tier content arch (T2); AI-patient never sources facts (case state does); hard citation gate + cheap-tier verifier + deterministic dose/threshold check + out-of-scope refusal; MD-locked content; deterministic safety interceptor; golden-set eval gate on every model/prompt change `[research:guidelines]`, `[stake:educators]` |
| R2 | **Latency kills immersion** — grounding/assessment or voice stacking stalls the loop | High | Three isolated clocks; grounding+assessment strictly out-of-band; cascade-voice budget <800 ms first-audio; barge-in; cache-first prompts; p95 (not p50) SLOs `[stake:builders]`, `[research:voice]` |
| R3 | **Token cost eats margin** as sessions lengthen / volume scales | High | 3-tier router (Haiku default, Opus batched −50%); prompt caching (0.1× reads, byte-stable prefix); RAG not long-context; 20-min cap + idle timeout; voice/3D premium-only; cost/encounter SLO <$0.15 `[research:models]`, `[stake:builders]` |
| R4 | **Assessment not defensible** — scores educators can't reconstruct/override; LLM validity ceiling (κ≈0.44) | High | Transcript-anchored, overridable, banded scoring; grader family ≠ patient family; κ gates (0.6 show / 0.7 pass-fail); formative-by-default + human co-sign; expert anchor set + validity dossier `[research:assessment]`, `[stake:educators]` |
| R5 | **Regulatory over-reach** — accidental slide into HIPAA / EU AI Act high-risk (e.g. a "upload a real de-identified case" feature) | High | Synthetic-patients-only + formative-by-default architecturally enforced; no real-PHI-input path (detect-and-block); regulatory gate review before any point-of-care-flavored feature; two data planes; DPIA; transparency + C2PA UX `[research:regulatory]`, `[stake:builders]`, `[stake:policy]` |
| R6 | **Scope creep** — voice+3D+multiplayer+dashboards burn runway before the loop is proven | High | Ruthless text-EM wedge; defer 3D/voice/multiplayer/dashboards behind MVP-metric gates; instrument the loop first `[stake:builders]` |
| R7 | **No moat / incumbent squeeze** (OpenEvidence $12B; AMBOSS/UWorld/Osmosis own the channel; Aquifer/Shadow Health collide head-on) | High | Compound moat (validity dossier + eval flywheel + guideline partnerships + LTI/Caliper lock-in + audit substrate + cert stack); multiplayer+voice+calibration together, not one feature; regulatory barrier as tailwind; partner for guidelines `[research:market]`, `[stake:policy]`, `[stake:builders]` |
| R8 | **Stale/wrong/wrong-country guideline hints** (#1 clinical-safety hazard) + guideline drift in cached content | High | Versioned, country-pinned, clinician-reviewed `GuidelineStatement` store; freshness watch → review tasks, never auto-publish; guideline update flags cases for re-review; version-lock per cohort; grounded-generation-only; "last reviewed" dates; CSO + Hazard Log `[research:guidelines]`, `[research:regulatory]` |
| R9 | **Accent-blind STT / voice mis-transcription** — humiliates ESL learners (fastest churn) and corrupts the grade (drug/dose/eponym errors) | Med | Medical-tuned STT (Deepgram Nova-3 Medical, ~3.45% median WER; keyterm prompting); accent-robust with **text fallback on low confidence** (never silent mis-score); confirm-critical-values UX; batch re-transcribe for assessment; STT demographic/accent bias audits `[research:voice]`, `[stake:learners]`, `[research:regulatory]` |
| R10 | **Educator workload inverts** (oversight burden > creation-time saved) → adoption dies; and multiplayer state divergence under network churn | Med | Instrument educator-minutes per institution, prove net-negative; AI-drafts/human-authoritative pipeline (64→2–4 hrs); server-authoritative event-sourced room state + idempotent tool calls + graceful text fallback; 100-concurrent-room staging test `[stake:educators]`, `[stake:builders]` |

---

## 8. Glossary

- **ACGME Milestones** — US residency competency framework; 6 core competencies, sub-competencies scored Level 1–5 narrative anchors; reported semiannually, feed Clinical Competency Committees (CCCs).
- **AMBOSS / Aquifer / Body Interact / i-Human / Shadow Health / SimConverse / Full Code** — incumbent med-ed products; content or single-player-sim leaders AcuDx competes against on interaction+assessment, not content `[research:market]`.
- **Annex III (EU AI Act)** — list of high-risk AI uses; §3 covers education AI that evaluates learning outcomes, gates access/progression, or proctors. Stand-alone-system obligations deferred to **2 Dec 2027** (Digital Omnibus).
- **ARKit-52** — the 52-blendshape facial-animation standard adopted as avatar interchange across all AcuDx rendering tiers `[research:3d]`.
- **Barge-in** — a learner interrupting the AI mid-utterance; requires flushing TTS + truncating the LLM + committing the partial. Mandatory for voice `[research:voice]`.
- **Batch API** — asynchronous LLM inference at −50% cost; used for grading/gap-analysis/authoring (non-latency-sensitive) `[research:models]`.
- **Brier score / OCI / ECE / reliability diagram** — calibration metrics: mean squared error of confidence vs correctness (Brier, decomposable into calibration+resolution); signed Over/Under-Confidence Index; Expected Calibration Error; confidence-bin-vs-accuracy plot — together the "Dunning-Kruger plot" `[research:assessment]`.
- **C2PA** — content-provenance standard for watermarking/labeling synthetic media (AI-Act Art. 50) `[research:regulatory]`.
- **Caliper Analytics / xAPI** — 1EdTech learning-event standards emitted to an institution's LRS/warehouse `[stake:institution]`.
- **CanMEDS (2025)** — 7-Role physician competency framework (Medical Expert, Communicator, Collaborator, Leader, Health Advocate, Scholar, Professional); used in Canada/EU/ME/Asia.
- **Cascade / composable pipeline** — STT→LLM→TTS voice architecture (vs native speech-to-speech); AcuDx default for auditability `[research:voice]`.
- **CDS / CDSS** — Clinical Decision Support (System); FDA-regulated if it advises on a real patient. AcuDx must never cross into this `[research:regulatory]`.
- **Clinical Safety Officer (CSO) / DCB0129 / Hazard Log** — NHS-style clinical-risk-management role/standard/artifact AcuDx adopts voluntarily as a trust signal `[research:regulatory]`.
- **Dunning-Kruger calibration plot** — AcuDx's signature feedback: self-rated confidence (elicited *before* reveal) vs measured competence, per domain, trended; framed as a trainable skill, never leaderboarded `[research:assessment]`.
- **EPA (Entrustable Professional Activity)** — a unit of professional work a trainee is entrusted to do; scored on an entrustment/supervision scale 1–5; AAMC Core EPAs = 13 canonical UME activities.
- **Evidence span** — the forced verbatim transcript quote a grader must attach to each rubric-item judgment; the biggest reliability lever and the source of free gap analysis `[research:assessment]`.
- **FERPA / GDPR / HIPAA** — US student-records privacy law / EU data-protection regulation / US health-privacy law. AcuDx is FERPA+GDPR (learner data), **not** HIPAA (no PHI) by construction `[research:regulatory]`.
- **Formative vs summative** — practice feedback (advisory, default) vs a grade of record (gated, human co-signed). `assessment_mode` is a hard flag `[stake:educators]`.
- **GuidelineStatement** — the atomic content unit: versioned, country/council-scoped, cited, license-tagged, clinician-approved recommendation record; source of truth for guidance/scoring/gap-analysis `[research:guidelines]`.
- **HECVAT 4** — 321-question higher-ed vendor security assessment (incl. 32-Q AI/ML section); an institutional procurement gate `[stake:institution]`.
- **LTI 1.3 Advantage** — 1EdTech LMS-integration standard bundling OIDC SSO + roster (NRPS) + deep-link + grade passback (AGS); P0 institutional integration `[stake:institution]`.
- **Mastery learning / FSRS** — fixed-standard/variable-time skill remediation; and the best-in-class spaced-repetition scheduler for knowledge gaps `[research:assessment]`.
- **MedGemma 1.5 / Meditron 70B** — medical-tuned open models used as graders/verifiers (generate-then-verify) and on-prem grounding, never as the patient actor `[research:models]`.
- **Miller's pyramid** — assessment-level framework (Knows → Knows How → Shows How → Does); AcuDx sits at "Shows How," approaching "Does" — its headline differentiator over MCQ tools `[research:assessment]`.
- **Model gateway / 3-tier router** — internal abstraction routing each task to Small (Haiku) / Mid (Sonnet) / Frontier (Opus) tiers with cheap escalation signals; pinned architecture, swappable model IDs `[research:models]`.
- **Prompt caching** — reusing a byte-stable cached prefix at ~0.1× input cost; the single biggest cost lever `[research:models]`.
- **RAG (hybrid dense+BM25, HNSW)** — retrieval-augmented generation over the `GuidelineStatement` store, filtered by country before ranking; the alternative to (banned) long-context guideline stuffing `[research:guidelines]`.
- **Two-tier content architecture** — grounded layer (owns all clinical facts, citation-or-refuse) + roleplay layer (improvises affect, cannot assert clinical facts) `[stake:policy]`, `[research:models]`.

---

## Key decisions for AcuDx

1. **Wedge = solo text-first Emergency-Medicine roleplay + structured feedback + Dunning-Kruger calibration plot.** Voice, 3D, multiplayer, dean's dashboards are gated fast-follows. MVP gate: D30 ≥25%, ≥3 enc/wk, measured competence rise wk1→wk6, ≥70% completion, cost <$0.15/enc, one paid pilot.
2. **Two architecturally-enforced non-negotiables:** `assessment_mode: formative` (below EU AI Act Annex III high-risk) and synthetic-patients-only/no-PHI (FERPA not HIPAA). Summative and real-data are deliberate later gates.
3. **Cost architecture is existential:** 3-tier router (Haiku patient turns → Sonnet hints → Opus batched grading), prompt caching (~55% of savings, byte-stable prefix), RAG-not-long-context. Blended text cost ~$0.43 optimized, SLO <$0.15; voice ~$0.05–0.09/min; voice & 3D are premium tiers.
4. **Two-tier content architecture is the safety spine:** grounded layer (versioned, country-scoped, cited `GuidelineStatement`s, citation-or-refuse, cheap-tier verifier, deterministic dose check, abstain>hallucinate) owns all clinical facts; the AI-patient never sources facts — case state does; deterministic safety interceptor sits outside the LLM.
5. **Assessment is a psychometric product, not a feature:** 6-domain rubric + versioned crosswalks, case-specific rubrics, decomposed evidence-span grading, grader family ≠ patient family, band-only (κ≥0.6 show/≥0.7 pass-fail), transcript-anchored + overridable, formative + human co-sign. Dual-axis (clinical ⟂ communication) from day one. Expert anchor set = the moat.
6. **Voice = composable cascade STT→LLM→TTS** (Deepgram Flux/Nova-3 Medical + Cartesia Sonic-3/ElevenLabs), <800 ms p50, barge-in mandatory, full non-voice equivalent, accent-robust with text fallback. **Avatars = 2D-first, clinical-signs-first, client-rendered**; streaming photoreal gated premium.
7. **Institution layer is what gets bought:** cohort competency heatmap, at-risk/remediation closed loop, aggregate calibration, one-click accreditation export, editable competency mapping — via LTI 1.3 Advantage + Caliper/xAPI. Pass HECVAT 4 / SOC 2 Type II / VPAT-WCAG 2.2 AA / DPA-BAA before pitching.
8. **One event-sourced, hash-chained audit-log spine** from day one (replay/debrief, grading, analytics, ≥6-mo audit, AI-Act traceability). Region-pinned tenancy, `no_train=true` default, two data planes, DPIA, C2PA labeling, no learner-emotion inference.
9. **Moat is not the model:** validity/assessment dossier + clinician-graded eval flywheel + national-guideline curation partnerships + LTI/Caliper lock-in + audit substrate + cert stack (ISO 42001/27001, AI-Act conformity). Compounds; can't be bought.
10. **Bottom-up PLG, dual pricing** (individual sub-$15/mo + CME; institutional ~$25k–$500k/yr, token cost absorbed into seat price). Partner for guidelines; compete on interaction + assessment. Prove net-negative educator workload or the thesis inverts.
