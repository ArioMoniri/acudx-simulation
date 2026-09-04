# 00 — Build Roadmap: Demo → MVP → v1 → v2

**Status:** Build roadmap. **Date:** July 2026. **Read with:** `01-full-integration-plan.md` (the demo→production mapping, backend scaffold, and API/contract order this roadmap sequences). This doc is the *phase-by-phase view with a metric gate per phase and the demo-screen → production-milestone map*; the integration plan is the *what-replaces-what and how*.

**The spine of the plan (one sentence).** Stand up the four foundation nodes + the tenancy/data-plane spine (Phase 0), wire the solo text-first EM encounter loop + grounding + assessment into a 10×-not-1.2× wedge (MVP), then fast-follow with the moat (rooms), voice, the institution money-layer, and the clinical-sign avatar (v1) before the gated summative/3D/sovereign work (v2) — every phase open-source-first and EN/TR from day one.

---

## The demo, phased

The runnable `web/` demo has **three screens** — **Home** (dashboard: stats, recommended cases, recent feedback), **Encounter** (the EHR workspace: patient banner + Storyboard rail + activity tabs + interaction dock + vitals monitor), and **Feedback** (6-domain bands + Dunning-Kruger calibration plot + cited gaps + process timing + treatment checklist). Each screen is a **faithful presentation prototype of a production milestone**; this roadmap says which production capability makes each screen real.

| Demo screen | Runs today on (mock) | Becomes real at (milestone) | Phase |
|---|---|---|---|
| **Home dashboard** — `HomePage`, `dashboardStats`/`recommendedCases`/`recentFeedback` | static arrays in `src/data/mock.ts` | Learning/Progression + Institution/Analytics projections off the Event Log; case recommendations from CaseGeneration + progression targeting | MVP (learner stats) → v1 (cohort analytics + LTI) |
| **Encounter / EHR workspace** — `EncounterPage`, `PatientBanner`/`Storyboard`/`ActivityTabs`, `VitalCard`/`Sparkline`, `EncounterChat` | `seedCases.ts` + `caseGen.ts` + `encounterStore.ts` `setTimeout` timers | Encounter Service turn loop + Director + Persona (two-tier boundary) + Case State + Vitals Engine + CaseGeneration; reveal graph on the physiology clock; results via REST+SSE, not timers | Phase 0 (substrate) → MVP (loop + generation) → v1 (voice/avatar/rooms enrich it) |
| **Feedback** — `FeedbackPage`, `CalibrationPlot`/`DomainBand`/`GapCard`/`ProcessTimingCard`/`TreatmentChecklist`, `processMetrics.ts` (real) | static `feedbackReport` + `feedbackEncounterEvents` fixture | Assessment Service (decomposed evidence-span grading, κ gates, bands) + Calibration Engine (Brier/OCI/ECE) + gap analysis; `processMetrics.ts` runs unchanged over the **replayed live log** | MVP (the signature calibration feature) |

---

## Phase 0 — Foundations (the day-one substrate everything projects off)

**Goal:** the four load-bearing nodes + the tenancy/data-plane spine exist and are mechanically enforced, so no later feature is a retrofit rewrite.

**Ships:**
- **Event Log** — append-only, per-tenant hash-chained (`hash = SHA-256(body ‖ prev_hash)`), gap-free `seq`, WORM checkpoints (S3/SeaweedFS Object-Lock + KMS-signed every 5 min/10k events), `verifyChain`. **Freeze the `EncounterEvent` envelope + canonical-JSON serialization before the first event is written.** (The demo's `EncounterEvent{seq,type,ref,at,meta}` is the seed shape.)
- **Model Gateway** — the only path to any model: **open 3-tier router** (small-open Qwen3-32B / large-open Qwen3.5-397B / guardrail gpt-oss-20b / rare Opus-4.8-Batch escalation), byte-stable cached-prefix builder (`assertByteStable()`, cache read-ratio ≥85%), `$0.15` soft / `$0.43` hard budget + degrade ladder, `no_train=true` + region-pin, `ModelCallEvent` audit. `no-restricted-imports` CI boundary.
- **Case State Store + Vitals & Physiology Engine** — authoritative facts + deterministic physiology tick; `ClinicalSign(intensity)` fan-out to monitor + avatar; `intensity→adjective` redaction seam (persona never reads raw numbers).
- **PHI + Safety Interceptor** — deterministic, outside the LLM (Presidio + red-flag rules); `422 phi_block` at ingress before persistence; break-character kill-switch.
- **Tenancy + two data planes** — Postgres 16 RLS within region, db/KMS/cluster per region; identified-education ⟂ de-identified-improvement on separate DB/KMS/network; crypto-shred erasure. Model Registry + Eval Gate scaffolding + red-team CI harness.

**Metric gate (exit Phase 0):** `verifyChain` green in CI; a synthetic turn round-trips through Gateway with ≥85% cached-prefix read and a `ModelCallEvent` on the chain; a PHI-laced input is blocked at ingress with the raw text never persisted; RLS proven to isolate two tenants; the red-team suite (dose/pediatric/country-threshold traps) runs in CI and can fail a build.

---

## MVP — the solo text-first Emergency-Medicine wedge

**Goal:** the wedge that must be **10× not 1.2×** — a solo learner works a dynamically-generated EM case in the EHR workspace and gets a defensible, competency-mapped grade + the Dunning-Kruger calibration plot + a gap→remediation loop (overview/01 §6). Requirements: RP-1..7, RP-4 vitals, G-1..3, AS-1..10, GEN-1, PROC-1, GM-1/2, AU-1/2 (basic), AD-4/5, dual-axis (AS-5) from day one.

**Ships (each replaces a demo mock — see integration plan §1):**
- **Encounter loop** — Encounter Service + **Director + Persona Agents** (two-tier boundary + FactAssertionGate); replaces the `encounterStore` `setTimeout` timers with the server turn loop + reveal graph on the physiology clock (M4/M6).
- **CaseGeneration (GEN-1)** — `sample dx → draft (Qwen3.5) → RAG-ground (BGE-M3/Qdrant) → verify (MedGemma/Meditron + ported `validateCase` deterministic checks) → instantiate FHIR + reveal graph + rubric anchors`; MVP ships on the **5 seed cases + a live-generation flag**, clinician spot-review before cohort exposure (M2/M3).
- **Grounding** — `GuidelineStatement` store (versioned, country/council-scoped, cited, license-tagged, clinician-approved), filter-before-rank hybrid RAG, runtime safety chain (retrieve→hard-citation-gate→verifier→deterministic dose/threshold check→out-of-scope refuse), open-license domains first (WHO/GINA/GOLD/USPSTF/CDC/NICE-UK). Replaces `guidanceHints` statics (M1/M5).
- **Assessment + Calibration** — decomposed per-item evidence-span grading (grader≠patient family, temp 0, strict JSON), deterministic band mapping, κ≥0.6 show / ≥0.7 pass-fail, gap analysis, confidence-before-reveal, formative mode; Calibration Engine (Brier/OCI/ECE, deterministic). `processMetrics.ts` runs unchanged over the replayed live log. Replaces the static feedback (M5).
- **API** — REST + SSE turn stream (`Idempotency-Key`/`Last-Event-ID`), confidence→grade order-enforced, band-only serialization, audit on every mutating route, region-pinned + RLS (integration plan §4 A1–A8).
- **Authoring (basic)** + provenance — the 5 seeds become the first human-reviewed cases + the golden eval set (AU-1/2).

**Demo screen → milestone:** the **Encounter** screen becomes a live loop; the **Feedback** screen becomes real grading + calibration (the signature feature); the **Home** screen shows real learner stats.

**Metric gate (exit MVP — all must hold, overview/01 §6):** cohort ≥200 learners · D30 retention ≥25% · median ≥3 encounters/wk · **measured competence rises wk1→wk6 on a held-out case** (not just self-rated confidence) · first-encounter completion >70% · ≥80% correctly interpret their calibration plot · blended text-encounter cost **<$0.15** · **one paid design-partner school pilot**.

---

## v1 — Fast-follows (the moat, voice, the money layer, the avatar)

**Goal:** complete the institutional + premium value, **in requirement order — multiplayer above single-player polish** (overview/01 §6). Parallel tracks after the MVP gate.

**v1.1 — Multiplayer rooms (the moat, first).** Realtime multi-human role-based rooms, AI backfilling empty roles, server-authoritative event-sourced room state, floor control, per-role Case-State views, team/leadership rubric, graceful text fallback on WebRTC failure. **LiveKit** self-host (Apache) + Agents. Requirements: MP-1..4, RP-3 (full role set), EHR-3 (role-scoped EHR views). *Metric gate:* 100 concurrent rooms on staging with no p95 regression; team-rubric debrief separates individual leadership from team clinical marks.

**v1.2 — Voice (composable cascade).** `Whisper-TR → Qwen3 → Chatterbox-TR` (TR-native, since no open native-S2S emits Turkish), barge-in mandatory, accent-robust with text fallback on low STT confidence, full non-voice equivalent, C2PA + embedded watermark on synthetic audio. **LiveKit Agents + Silero VAD** (open); managed ElevenLabs-TR/Deepgram optional premium. Requirements: V-1..V-5. *Metric gate:* voice round-trip <800 ms p50 / <1200 ms p95, first-audio <800 ms; STT low-confidence → text fallback, never a silent mis-score; ESL/IMG learners not penalized (accent bias audit).

**v1.3 — Institution dashboard + LTI 1.3 (the money layer).** Cohort competency heatmap (drill cohort→section→learner→encounter→evidence-span, role-gated), at-risk/remediation closed loop, one-click accreditation export (LCME/ACGME/CanMEDS/AAMC-EPA, de-identified), aggregate cohort calibration, editable competency mapping. **LTI 1.3 Advantage Complete** (OIDC + NRPS + Deep Linking + AGS with formative/summative co-sign gate) + SAML/OIDC/SCIM/OneRoster + Caliper 1.2/xAPI + webhooks. **Keycloak + ltijs** (open). Requirements: IN-1..7, AD-1..3, AU-3/4. *Metric gate:* 1EdTech LTI Advantage Complete certification passing; HECVAT 4 / SOC 2 Type II / VPAT-WCAG 2.2 AA / DPA-BAA ready; the **Home** screen becomes the real dean's-office analytics; educator-minutes-per-case instrumented and net-negative (T9).

**v1.4 — 2D clinical-sign avatar.** 2D persona portrait + emotion set + **physiology-driven clinical-sign overlay** (cyanosis/pallor/diaphoresis/distress/LOC) off the one Vitals-Engine state; avatar & monitor never contradict; abstract sign schema authored once (renders across tiers); generated per-case face via **Qwen-Image/FLUX-schnell + PuLID/PhotoMaker** (Apache), C2PA-marked + "synthetic patient" labeled + diversity-audited. Requirements: AV-1/AV-2. *Metric gate:* the sign channel is scorable by the assessment layer; every sign has a band-word + table + ARIA equivalent (a11y); ~$0 marginal (client-rendered).

**Demo screen → milestone:** **Encounter** gains voice, the clinical-sign avatar, and multiplayer rooms; **Home** becomes the institution analytics surface; the whole product becomes institutionally sellable.

---

## v2 — Gated / opportunistic

**Goal:** the deliberately-gated later value — each behind an explicit gate, never accidental.

- **Summative track + full compliance stack.** `assessment_mode: summative-with-review` behind a contract gate + named human co-sign + validity dossier per case-type (Kane argument, IRR vs faculty, DIF/subgroup fairness) + the full EU AI-Act high-risk stack, targeting **2 Dec 2027** (Digital Omnibus deadline). No AI-only consequential decision, ever. Requirements: AS-10 (summative), RP-8 (observable rooms). *Gate:* the formative wedge is proven + the compliance stack (ISO 42001/27001, AI-Act conformity) is in place; regulatory review before relaxing the formative non-negotiable.
- **3D / streaming photoreal premium.** ARKit-52 client-3D (R3F + Ready Player Me + self-hosted Audio2Face-3D) as default premium; **LivePortrait + MuseTalk** (MIT) streaming animation of the generated face (replaces Anam/Tavus); Gaussian-splat frontier stays a T3 research tier until a permissive release lands. Streaming photoreal gated to premium/OSCE only (it can't expose sign shaders → signs degrade to monitor+captions). Requirements: AV-3/AV-4, V-6 (native S2S cinematic). *Gate:* premium-tier demand + positive contribution margin (voice/3D never free-tier defaults).
- **On-prem / sovereign appliance.** The single self-hostable containerized appliance a T.C. Sağlık Bakanlığı / KVKK ministry or privacy-max school runs entirely on-prem with **zero third-party data egress** — the full all-open stack (Qwen3/Meditron/BGE-M3/Qdrant/Whisper-TR/Chatterbox/LiveKit/LivePortrait/Keycloak/Postgres+Valkey+NATS+ClickHouse+SeaweedFS/SQL-LRS/Langfuse/Presidio/c2pa-rs). SaaS control plane orchestrates but never sees PHI. Requirements: AD-6/AD-7. *Gate:* a sovereign/privacy-max design partner + the ≈>3–5M tok/day (voice+avatar higher) break-even; on-prem Eval-Gate parity inside the tenant VPC without exposing PHI.

---

## Phase gates at a glance

| Phase | Ships (headline) | Exit metric gate |
|---|---|---|
| **Phase 0** | Event Log · Model Gateway (open router) · Case State + Vitals · PHI/Safety · tenancy + two planes | `verifyChain` green; turn round-trips with ≥85% cache read + audit; PHI blocked at ingress; RLS isolates tenants; red-team CI can fail a build |
| **MVP** | Solo text EM loop · CaseGeneration (GEN-1) · Grounding · Assessment + Calibration · REST/SSE | ≥200 learners · D30 ≥25% · ≥3 enc/wk · competence rise wk1→wk6 · >70% completion · ≥80% read calibration · cost <$0.15 · 1 paid pilot |
| **v1.1 rooms** | Multiplayer role-based rooms + AI backfill (the moat) | 100 concurrent rooms, no p95 regression; team vs individual marks separated |
| **v1.2 voice** | Cascade Whisper-TR → Qwen3 → Chatterbox-TR + barge-in | <800 ms p50 round-trip; low-confidence→text fallback; accent-bias audit clean |
| **v1.3 institution** | Dashboard + LTI 1.3 Advantage + Caliper/xAPI + SCIM | 1EdTech cert; HECVAT 4 / SOC 2 / VPAT / DPA-BAA ready; educator-minutes net-negative |
| **v1.4 avatar** | 2D physiology-driven clinical-sign overlay | Sign channel scorable; band-word/table/ARIA equivalents; ~$0 marginal |
| **v2 summative** | Summative-with-review + full compliance | Validity dossier + human co-sign + AI-Act high-risk stack (toward Dec 2027) |
| **v2 3D/premium** | Client-3D + streaming photoreal (premium/OSCE) | Positive premium-tier margin; signs preserved or degrade to monitor+captions |
| **v2 sovereign** | On-prem air-gapped appliance | Sovereign design partner + break-even + on-prem eval parity, zero data egress |

**Guiding discipline throughout (risk R6):** ruthless text-EM wedge first; defer voice/3D/multiplayer/dashboards behind MVP-metric gates; instrument the loop before enriching it. Open-source-first, sovereign-capable, EN/TR — at every phase.

---

## Demo feature build — the dynamic encounter (pulled forward into `web/`, in progress)

To make the runnable demo *functional* (not just a presentation prototype), these MVP/v1/v2 capabilities are being implemented in `web/` as client engines driven by a rich **case truth**, with the pod (open Qwen2.5-7B + Turkish embed/rerank, AIRGAPPED) providing generation + grounding. Each is a GitHub issue → PR → merge; built by parallel engineers on disjoint files. Everything stays dynamic to what the student **asks and does**, EN/TR, resource-safe.

| Feature | Maps to | Shape |
|---|---|---|
| **Unlimited case generation** | GEN-1 (MVP) | pod `/v1/case/generate` samples ICD-11/ICD-10/DSM-5-TR from a broad catalog → open model synthesises a full case spec; client adapts to a `CaseInstance`. Deterministic templated fallback when the model is down. |
| **Orders with clinical time** | Vitals/Case-State (Ph0) + REST/SSE (MVP) | per-test turnaround so a **culture returns much later than a CBC**; realistic ETA labels + live countdown; POC fast, CT/MRI slow, micro-cultures far out. |
| **Dynamic response to treatment** | Case State + Vitals Engine + reveal graph | `administerTreatment` → a clinical-course engine evolves vitals/status over sim time from the case's treatment-response map (or a physiologic fallback: O₂↑SpO₂, fluids↑BP, antipyretic↓temp…). |
| **Live vitals + trend monitor** | RP-4 vitals + Vitals Engine | a **real bedside-monitor UI** (live waveforms, big colour numerics HR/SpO₂/BP/RR/Temp, alarm limits) + trend graphs, dynamic off the sim clock. |
| **Real condition imaging** | (new) | ordering imaging fetches a **real representative image** of the condition from open-licensed Wikimedia Commons, attributed + licensed + labelled "representative image, not this patient". |
| **Realtime cited guidance + attending tips** | G-1..3 grounding + guide mode | a live guidance panel (cited to WHO/NICE/ATLS/DSM via pod grounding) + an **attending-physician tip/outline** coach: next-best-action, coverage gaps, timing nudges. AMBOSS-like reference UI. |
| **Multiplayer rooms — one case, many roles** | MP-1..4, RP-3, EHR-3 (v1.1) | students join a room on the **same patient**, take roles (doctor / nurse / paramedic …), see role-scoped EHR views, and **hand orders/tasks to each other** (doctor orders → nurse executes). Demo runs a shared local case-state with role handoff; networked transport (LiveKit) stays the v1.1 production path. |
| **3D avatar** | AV-3/AV-4 (v2) | R3F patient head with physiology-driven clinical-sign overlays (pallor/cyanosis/diaphoresis) off the one vitals state + mouth movement on patient turns; graceful fallback to the 2D avatar. |
| **AMBOSS/Mobbin-grade UI** | design | the "Clinical Instrument" system (merged) + AMBOSS-like dense reference/guidance surfaces; Manrope/Inter type; crafted instrument logo. |

**Interview correctness (shipped):** the opening "why did you come in?" question is in-scope and elicits the presenting complaint; the patient stays dynamic to what is asked and what has been done.
