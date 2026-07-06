# 05 — Builder-Side Stakeholder Perspectives

**Scope:** the people who must *design, ship, and operate* AcuDx. Where `01`–`04` cover demand-side stakeholders (learners, educators, institutions, patients-as-standard), this doc simulates the **supply side** — the twelve roles whose priorities, constraints, and risks decide whether AcuDx is buildable and fundable. Each persona gives: **#1 concern**, **early decisions** (things that are cheap to choose now and expensive to change later), **biggest risk**, and **MVP-success definition**. It closes with a consolidated **build constraints & non-negotiables** table and the **top-10 cross-functional risks + mitigations**.

**Central tension for builders:** AcuDx is simultaneously (1) a *realtime multi-agent conversational system* (hard infra/AI problem), (2) a *regulated assessment product* (EU AI Act high-risk, per `02-educators.md` R1), and (3) an *early-stage venture* that must show unit economics before frontier-model token cost eats the margin. No single persona can win alone; the failure modes are all at the seams. Numbers below are July-2026 reality with sources inline.

---

## 1. Personas

### (a) Priya — Product Manager (owns roadmap, scope, wedge)

- **#1 concern:** *scope discipline.* AcuDx's surface area (solo-vs-AI, multiplayer, guidance mode, assessment, dean's dashboards, voice, 3D) is a graveyard of half-built features. The wedge must be one loop that is 10× better than the status quo, not twelve that are 1.2× better.
- **Early decisions:**
  - **The wedge loop.** Recommend: *solo learner ↔ AI-patient, text-first, one specialty (Emergency Medicine, inheriting the AcuDx prototype), with structured feedback + Dunning-Kruger calibration plot.* Everything else (voice, 3D, multiplayer, dean's office) is a fast-follow, gated on this loop retaining users.
  - **Buyer vs user split.** The user is a learner; the payer is the institution (see `03-institutions.md`). MVP must be *individually valuable without the institution* (bottom-up PLG) so it isn't hostage to a 9-month university sales cycle.
  - **Assessment posture.** Ship as **formative-by-default** (`assessment_mode: formative`) to stay out of EU AI Act Annex III high-risk obligations at MVP; summative is a deliberate, later, gated step (`02-educators.md` R1).
- **Biggest risk:** *feature-parity theater* — chasing AMBOSS/UWorld's content breadth or a "metaverse hospital" demo instead of proving the roleplay loop changes a measurable competency. Second risk: the calibration plot is a gimmick nobody acts on.
- **MVP success:** a cohort of ≥200 learners where **D30 retention ≥ 25%**, median **≥3 encounters/week**, and **measured competence rises** on a held-out case between week 1 and week 6 (not just self-rated confidence). One design-partner school signs a paid pilot.

### (b) Aria — Technical / System Architect (owns the whole system's shape)

- **#1 concern:** *keeping a realtime, multi-agent, regulated system from becoming an unmaintainable monolith of prompt spaghetti.* The architecture must isolate three clocks: the **conversation loop** (100s of ms), the **assessment/grounding pipeline** (seconds, auditable), and the **analytics/institutional layer** (batch).
- **Early decisions:**
  - **Boundaries.** Split into: (1) *Orchestration/session service* (room state, turn-taking, role assignment); (2) *Agent runtime* (per-role LLM agents with tools); (3) *Grounding service* (versioned guideline RAG, deterministic, cited — see `guidance-grounding` doc); (4) *Assessment service* (rubric scoring, transcript-anchored, human-in-loop); (5) *Analytics/EPA-mapping* (event-sourced). Align with `CLAUDE.md` DDD bounded-context rule.
  - **Realtime transport.** Recommend **LiveKit** (WebRTC SFU + agents framework) as the room/media backbone: WebRTC at **$0.0005/min**, agent-session at **$0.01/min**, and — critically — **HIPAA-eligible with BAA and SOC 2 Type II only from the Scale tier ($500/mo)** ([LiveKit pricing](https://livekit.com/pricing)). Self-host option exists to kill per-minute charges at scale.
  - **Statefulness & event sourcing.** Every encounter is an append-only event log (utterances, tool calls, vitals mutations, grades). This is both the audit trail R2 demands (`02-educators.md`) and the replay substrate for debrief/analytics. Non-negotiable.
  - **Model abstraction layer.** No business logic calls a vendor SDK directly; route through an internal gateway so models are swappable per-task (see persona c). Prevents lock-in and lets cost routing evolve.
- **Biggest risk:** *the seams between the three clocks.* A synchronous grounding/assessment call blocking the conversation loop turns a 300 ms turn into a 3 s stall and kills immersion. Second: state divergence in multiplayer rooms (two humans + AI agents) under network churn.
- **MVP success:** p95 text turn latency **< 1.5 s**; grounding/assessment run **out-of-band** without blocking the loop; a full encounter is **deterministically replayable** from the event log; zero cross-context data leaks in a pen-test.

### (c) Kenji — AI / ML Engineer (owns agents, models, token cost)

- **#1 concern:** *quality-per-dollar.* Frontier reasoning is what makes the AI-patient believable and the feedback trustworthy, but frontier tokens at scale destroy margin. The job is aggressive **per-task model routing** without letting clinical quality regress.
- **Early decisions (model routing — the core cost lever):**

  | Task | Recommended model (Jul 2026) | Price (in/out /MTok) | Rationale |
  |---|---|---|---|
  | AI-patient dialogue (in-encounter) | **Claude Haiku 4.5** default; escalate to Sonnet on complex cases | $1 / $5 ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)) | Roleplay persona + short turns; latency + cost matter more than deep reasoning |
  | Guidance/Socratic hints (grounded) | **Claude Sonnet 5** (intro $2/$10 through Aug 31 2026, then $3/$15) | $2 / $10 ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)) | Needs reasoning over retrieved guidelines; 1M-token context at standard rate |
  | Post-encounter assessment / feedback / EPA mapping | **Claude Opus 4.8** via **Batch API (−50%)** = $2.50 / $12.50 | $5 / $25 base ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)) | Highest-stakes reasoning; not latency-bound → batch it |
  | Simple transforms (term translation, formatting, redaction) | **Haiku 4.5** or rules/WASM (Tier-1 per `CLAUDE.md`) | $1 / $5 or $0 | No frontier model needed |

  - **Prompt caching is the single biggest lever.** Case scaffold, persona spec, rubric, and guideline snippets are stable within an encounter → cache them. Cache read = **0.1× input** (Haiku cache hit **$0.10/MTok**), amortizing the system prompt across every turn ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)). Design prompts *cache-first*: static prefix, dynamic suffix.
  - **Multi-agent topology.** One orchestrator + specialized role-agents (patient, examiner, senior-colleague) sharing case state via the event log. Keep agent count tight (`CLAUDE.md`: 6–8).
  - **Eval harness before features.** Golden-set of clinician-scored encounters; regression-gate every prompt/model change. Ties to `02-educators.md` R6 validity dossier and the honest κ≈0.44 scoring ceiling already documented there.
- **Biggest risk:** *clinical hallucination in the patient or the hint* — an AI-patient inventing pathophysiology, or a hint contradicting the cited guideline. This is the educator kill-switch (`02`). Second: cost creep as sessions lengthen (context grows → per-turn cost grows superlinearly without caching/summarization).
- **MVP success:** blended **cost/encounter < $0.15** at MVP volume; hallucination rate on the golden set below an agreed threshold with grounding citations attached; feedback agreement with a human rater at/above the documented κ≈0.44 baseline, never presented as summative.

### (d) Sol — Realtime / Backend Engineer (owns latency, concurrency, state)

- **#1 concern:** *turn-taking and state consistency under concurrency.* Believable conversation lives or dies on sub-second, interruptible turns; multiplayer rooms add distributed-state consistency on top.
- **Early decisions:**
  - **Transport:** WebRTC (LiveKit) for voice/multiplayer; WebSocket/SSE for text-only solo (cheaper). Don't pay WebRTC minutes for a text loop.
  - **Turn-taking model:** server-authoritative turn state with barge-in (interrupt) support; VAD-driven endpointing for voice. Budget: STT (~100–300 ms) + LLM first-token + TTS first-chunk must total **< 800 ms** to feel live.
  - **Backpressure & idempotency:** every tool call (order test, reveal vital) is idempotent and event-sourced so a reconnect replays cleanly. No hidden mutable session state.
  - **Presence/room lifecycle:** join/leave, role reassignment, AI-agent backfill for empty roles — all as events, not ad-hoc mutations.
- **Biggest risk:** *tail latency and reconnection storms.* p95, not p50, decides whether it feels alive; a flaky campus network mid-encounter must degrade gracefully (text fallback), not drop the room. Second: multiplayer race conditions corrupting shared case state.
- **MVP success:** solo text p95 turn **< 1.5 s**; voice round-trip p95 **< 1.2 s**; a room survives a mid-encounter reconnect with zero state loss; 100 concurrent rooms on staging with no p95 regression.

### (e) Maya — UX / UI + Product Designer (owns the experience, the loop, the plot)

- **#1 concern:** *making a text/voice clinical roleplay feel like practice, not a chatbot* — and turning assessment into something a learner *acts on* rather than dismisses. The Dunning-Kruger calibration plot is the signature moment; if it's confusing, the whole feedback promise collapses.
- **Early decisions:**
  - **Core screen:** inherit the AcuDx prototype's split (chat + live Vital Signs Monitor + resources) but redesign the *feedback* surface: transcript with rubric items anchored to the exact utterance (satisfies `02` R2 traceability *and* makes feedback legible).
  - **Calibration plot design:** self-rated confidence (collected *before* reveal) vs measured competence, per competency, over time. Must be self-explanatory in <10 s and non-punitive (growth framing, not shaming). This is a design problem, not a data problem.
  - **Difficulty & mode controls surfaced to educators** (disable red-flag modes, set persona variant) per `02` R7.
  - **Accessibility from day one:** WCAG 2.2 AA; captions for voice; the product will be used by non-native speakers *as learners* (not just as a patient persona).
- **Biggest risk:** *the loop feels like homework, not a game.* Gamification (XP/streaks/leaderboards) that's bolted on reads as cheap; if it undermines the clinical seriousness, educators reject it. Second: the calibration plot is misread and demoralizes weak learners.
- **MVP success:** first-encounter completion rate **> 70%**; learners can correctly interpret their own calibration plot in usability tests (≥80%); qualitative signal that feedback changed what they'd do next time.

### (f) Theo — 3D / Graphics Engineer (owns avatars, if/when)

- **#1 concern:** *not letting 3D become a resource sink that starves the core loop.* Avatars are a differentiator and an immersion multiplier, but they are the highest-effort, lowest-certainty bet in the whole build.
- **Early decisions:**
  - **Defer 3D past MVP.** Text + voice + a 2D expressive portrait carries the roleplay. 3D is a Phase-2 immersion play, not an MVP requirement. Say so explicitly to protect scope.
  - **When built: buy the pipeline, don't invent it.** **Ready Player Me** avatars + **NVIDIA Audio2Face-3D** (now open-sourced) for audio-driven facial animation, rendered client-side via **Three.js / WebGL** or a lightweight talking-head lib (e.g. `met4citizen/TalkingHead` for browser lip-sync) — this stack is proven and documented ([NVIDIA ACE + RPM](https://blogs.nvidia.com/blog/omniverse-ace-early-access/); [Audio2Face-3D open source](https://developer.nvidia.com/blog/nvidia-open-sources-audio2face-animation-model/)). Healthcare avatar vendors report **<100 ms** response with synced lip movement in production ([Beyond Presence, 2026](https://www.beyondpresence.ai/blog/how-ai-avatars-are-transforming-healthcare-in-2026)).
  - **Client-side render budget:** must run on a mid-range student laptop/phone. No server-side per-frame GPU rendering at MVP economics — server GPU for real-time video avatars is a margin killer at scale.
- **Biggest risk:** *uncanny-valley or perf-tax immersion damage* — a janky avatar is worse than no avatar for clinical seriousness; and GPU cost/complexity dwarfing the value. Second: driving *clinically meaningful* facial signs (pallor, distress, Cushing's facies) is far harder than generic lip-sync and easy to fake badly.
- **MVP success (Phase 2):** avatar adds measurable immersion/retention lift in an A/B vs voice-only, renders at ≥30 fps on target hardware, and adds **< $0.05/min** incremental cost.

### (g) Ren — Voice Engineer (owns STT / TTS / duplex)

- **#1 concern:** *medical-term recognition accuracy and conversational latency* — a learner saying "she has a positive Kernig's sign" must not be transcribed as "curing sign," and the loop must feel duplex, not walkie-talkie.
- **Early decisions:**
  - **STT:** **Deepgram Nova-3 Medical** — tuned for pharma names, clinical acronyms, Latin disease terms; streaming WER **~6.8%** (vs generic Whisper degrading badly in uncontrolled clinical audio), at **$0.0077/min streaming** ([Deepgram STT 2026](https://deepgram.com/learn/best-speech-to-text-apis-2026); [Nova-3 Medical](https://deepgram.com/learn/introducing-nova-3-speech-to-text-api)). Medical vocabulary accuracy is the differentiator; do not use a generic model.
  - **TTS:** **ElevenLabs** for expressive, persona-appropriate voices (geriatric, anxious, pediatric-via-parent) with **~75 ms streaming latency**, ~$0.08/min agent minutes ([ElevenLabs](https://elevenlabs.io/pricing)).
  - **Architecture choice — pipeline vs native-audio:** cascade (STT→LLM→TTS) gives control over the *clinical text* (needed for grounding, assessment, transcript audit) but adds latency. A native speech-to-speech model (**Gemini 2.5 Flash native audio**, ~$0.037/min, 30 HD voices/24 langs, sub-second duplex — [Google](https://ai.google.dev/gemini-api/docs/models)) is cheaper/lower-latency but yields no clean auditable clinical text and less persona control. **Recommend cascade for MVP** (auditability wins in a regulated assessment product); revisit native-audio for casual/low-stakes modes.
  - **Barge-in / interruption** is mandatory for realism — must be in from the first voice build.
- **Biggest risk:** *transcription errors silently corrupting the assessment* — a misheard drug/dose flowing into a grade the educator can't reconstruct. Second: latency stacking (STT + LLM + TTS) breaking immersion.
- **MVP-of-voice success:** medical-term WER acceptable to clinician reviewers on a held-out term set; voice round-trip p95 **< 1.2 s**; barge-in works; transcript is faithful enough to anchor rubric items.

### (h) Dr. Nadia — Clinical Content Lead (MD; owns medical correctness & safety)

- **#1 concern:** *no unsafe or incorrect medicine reaches a learner, and every clinical claim is sourced.* She holds the same veto the educators in `02` hold — one hallucinated "correct" management recommendation pulls the cohort.
- **Early decisions:**
  - **Grounding is a service, not a prompt.** Country-specific, versioned guideline corpus (ATLS x-edition, NICE, local protocols) behind the grounding service; every hint/assertion carries edition + date citations (`02` R3; `guidance-grounding` doc).
  - **Content pipeline & provenance.** AI drafts case scaffolds; MD reviews and locks. Target the `02` R-author economics: cut a case author's expert-review share to 2–4 hours. Open export schema (MedBiquitous MVP baseline) to avoid IP lock-in (`02` R5).
  - **Safety layer is deterministic.** A rules layer intercepts red-flag cues (self-harm, safeguarding, abuse) *before* the LLM improvises, with educator-configurable escalation (`02` R7). Never LLM-only for safety.
  - **Scope of specialty at MVP:** one specialty (EM), a small, *deep*, clinically-validated case set beats a broad shallow one.
- **Biggest risk:** *guideline drift* — a cached hint reflecting a superseded edition; or country-variant errors (ATLS differs by region). Second: liability framing — learners over-trusting AI feedback as ground truth.
- **MVP success:** 100% of in-encounter clinical assertions carry a versioned citation; zero unsafe-content incidents in red-team testing of red-flag cues; a validated case set signed off by ≥2 MDs.

### (i) Dev — Data / Analytics Engineer (owns the event model, the plot, the dashboards)

- **#1 concern:** *a clean, competency-mapped event model* that powers the calibration plot, gap analysis, and dean's-office analytics from the *same* source of truth — not three divergent pipelines.
- **Early decisions:**
  - **Event schema first.** Encounters emit typed events (utterance, tool-call, rubric-hit, self-rating, grade) mapped to competency frameworks (Miller, ACGME milestone, CanMEDS, EPA) per `02` R4 and `03`. Emit **Caliper Analytics** events and support **LTI 1.3** grade passback for LMS interop (`02` R5).
  - **Confidence-vs-competence data capture.** Self-rating must be captured *pre-reveal* and stored as a first-class event, or the Dunning-Kruger plot is unbuildable retroactively.
  - **Privacy-by-design in the model.** Learner PII segregated from encounter content; pseudonymized IDs; cohort analytics on de-identified aggregates (feeds persona j and GDPR/FERPA — see below).
- **Biggest risk:** *garbage competency mapping* — if rubric-to-EPA mapping is wrong or unauditable, every downstream dashboard and the whole accreditation-evidence pitch (`03`) is worthless. Second: re-identification risk in "aggregate" cohort views.
- **MVP success:** calibration plot + gap analysis rendered from the canonical event log; competency mapping editable by curriculum directors (`02` R4); LTI grade passback demonstrated end-to-end with one LMS.

### (j) Omar — Security / Compliance Engineer (owns the regulatory perimeter)

- **#1 concern:** *classifying the data and the regulatory regime correctly so the product isn't accidentally built as a HIPAA/high-risk system it doesn't need to be — while still being defensible.*
- **Early decisions (the load-bearing compliance call):**
  - **No real PHI. Synthetic patients only.** AcuDx patients are fictional → **no HIPAA PHI is created by the encounter.** The regulated data is *student* data, which in US universities is governed by **FERPA**, not HIPAA; HIPAA explicitly excludes FERPA-covered student records from PHI ([HHS FERPA/HIPAA joint guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/ferpa-hipaa/index.html)). This is a *huge* scope reducer — architect to *keep* it true (never ingest real patient data). Offer a **BAA only if** an institution insists / integrates real data later; LiveKit Scale and comparable vendors provide BAAs when needed.
  - **EU AI Act posture.** Education AI that *assesses learning outcomes or determines educational path* is **Annex III high-risk**; high-risk education obligations apply from **2 Dec 2027**, transparency (must disclose AI interaction) from **Aug 2026** (`02` R1; [EU AI Act Annex III](https://artificialintelligenceact.eu/annex/3/)). **Ship formative-only at MVP** to sit *below* the high-risk trigger, and build the high-risk controls (logging ≥6 mo, human oversight, data governance, bias testing) as a deliberate gate before any summative feature.
  - **GDPR** for any EU learner: lawful basis, data-subject rights, special-category caution (health-adjacent), DPA with sub-processors (each model/voice vendor).
  - **Baseline security:** SOC 2 Type II on the roadmap (institutions will demand it in procurement — `03`); tenant isolation; encryption in transit/at rest; audit log immutability.
- **Biggest risk:** *scope creep into HIPAA/high-risk* — a well-meaning "let students upload a real de-identified case" feature that drags the whole platform into HIPAA and Annex III. Second: sub-processor sprawl (LLM + STT + TTS + avatar vendors) each a GDPR/DPA liability.
- **MVP success:** documented data-flow map proving no PHI; formative-only assessment posture verified; AI-disclosure UX shipped (transparency); DPAs/BAAs in place with every sub-processor touched; SOC 2 Type II underway.

### (k) Lena — Business / GTM Lead (owns model, pricing, motion)

- **#1 concern:** *unit economics and a repeatable go-to-market* — proving that revenue/user exceeds fully-loaded cost/user (tokens + voice + infra) and that there's a motion to acquire institutions without an 18-month enterprise slog.
- **Early decisions:**
  - **Motion:** **bottom-up PLG** (free individual tier → paid individual → institutional site license), *not* enterprise-first. The individual learner is the wedge and the champion who drags the institution in. Contrast the demand-side buyer analysis in `03`.
  - **Pricing hypothesis:** freemium individual (limited encounters/mo) → ~$15–25/mo pro learner → per-seat institutional site license with the dean's-office analytics as the enterprise upsell. Validate willingness-to-pay early.
  - **Cost ceiling per encounter must stay well under price.** With blended text-encounter cost < $0.15 (persona c) and voice adding ~$0.08–0.15/min, a 15-min voice encounter can approach $1–2 in variable cost — pricing and free-tier limits must reflect that. *Voice/3D are premium tiers, not free-tier defaults.*
  - **Beachhead:** one specialty (EM), one geography with clear guideline sourcing, design-partner schools.
- **Biggest risk:** *market timing / incumbent squeeze.* Well-funded adjacents are moving fast — **OpenEvidence hit a $12B valuation and >40% daily US-physician usage in Jan 2026** ([CNBC](https://www.cnbc.com/2026/01/21/openevidence-chatgpt-for-doctors-doubles-valuation-to-12-billion.html)); AMBOSS/UWorld/Osmosis own the med-ed content channel; sim incumbents own the institution. AcuDx's defensibility is the *roleplay + assessment + validity* loop, not content breadth. Second: the free-tier being subsidized frontier-token burn with no path to positive contribution margin.
- **MVP success:** one paid institutional pilot + a cohort of paying individuals; **contribution margin positive on the paid tier** (price > fully-loaded variable cost); a repeatable channel signal (e.g., organic student-to-student spread).

### (l) Victor — Prospective Investor / VC (owns the "is this fundable" lens)

- **#1 concern:** *a defensible, venture-scale wedge in a crowded, incumbent-heavy, model-commoditizing market.* Why does AcuDx win when the underlying models are rentable by anyone and OpenEvidence/AMBOSS have the doctors' attention and capital?
- **What he's underwriting / early diligence questions:**
  - **Moat:** not the LLM (commodity). Candidates: (1) the **validity/assessment dossier + institutional trust** (regulatory + accreditation moat, slow to replicate — see `02`/`03`); (2) proprietary **clinician-graded eval + case data** flywheel; (3) curriculum/competency integration lock-in via LTI/Caliper. He wants to see *which* moat is being built.
  - **Unit economics vs frontier-cost exposure:** does contribution margin survive model-price volatility? He'll note prices *are* moving (Sonnet intro pricing ends Aug 31 2026, reverting $2/$10→$3/$15; new tokenizers add ~30% tokens on newest models — [pricing](https://platform.claude.com/docs/en/about-claude/pricing)). Routing + caching discipline (persona c) is diligence-material.
  - **Regulatory timing as tailwind or landmine:** EU AI Act high-risk education rules (Dec 2027) *raise the barrier* for entrants who do assessment right — an incumbency advantage if AcuDx builds the controls early, a landmine if it ships summative recklessly.
  - **Market size:** med-ed + CME + institutional simulation is large but fragmented; he wants a credible path from a single-specialty wedge to horizontal (nursing, paramedics, allied health, CME) expansion.
- **Biggest risk (his):** *"nice product, no moat, no margin"* — a fundable demo that's a feature an incumbent bolts on, with token cost eating the P&L and no institutional lock-in. Second: founder over-scoping (voice+3D+multiplayer+dashboards) burning the seed before the loop is proven.
- **What earns the next round:** the persona-a MVP metrics **plus** evidence of a moat compounding (retained cohorts, a growing clinician-graded eval set, one institution embedding AcuDx in its assessment blueprint) and contribution-margin-positive paid usage.

---

## 2. Consolidated Build Constraints & Non-Negotiables

| # | Constraint | Owner(s) | Why it's non-negotiable |
|---|---|---|---|
| C1 | **Formative-by-default assessment** (`assessment_mode: formative`) at MVP; summative is a gated, later step | Priya, Omar | Stays below EU AI Act Annex III high-risk trigger; summative needs full high-risk controls (`02` R1) |
| C2 | **No real PHI — synthetic patients only** | Omar, Nadia | Keeps the product FERPA-governed, not HIPAA; massive scope/cost reducer; must be *architecturally* enforced |
| C3 | **Event-sourced, append-only encounter log** as single source of truth | Aria, Dev | Powers replay/debrief, transcript-anchored grading (`02` R2), analytics, and the ≥6-month high-risk audit trail |
| C4 | **Every clinical assertion carries a versioned, country-specific citation** | Nadia | Educator/clinician kill-switch is hallucinated medicine (`02` R3) |
| C5 | **Grounding + assessment run out-of-band; never block the conversation loop** | Aria, Sol | p95 turn < 1.5 s (text) / 1.2 s (voice); immersion dies at multi-second stalls |
| C6 | **Per-task model routing + prompt caching** through an internal gateway; no direct vendor SDK calls in business logic | Kenji, Aria | Cost control + swappability; blended text-encounter cost target < $0.15 |
| C7 | **Cascade voice (STT→LLM→TTS) at MVP**, medical-tuned STT (Deepgram Nova-3 Medical) | Ren, Nadia | Auditable clinical text for grounding/assessment; medical-term accuracy is the differentiator |
| C8 | **Transcript-anchored, overridable scoring** — every rubric item links to the exact utterance; one-click override + reason | Dev, Nadia | `02` R2; inadmissible otherwise |
| C9 | **Editable competency mapping** (Miller/ACGME/CanMEDS/EPA), versioned, exportable; LTI 1.3 + Caliper | Dev | Accreditation-grade evidence, no vendor-taxonomy lock-in (`02` R4/R5, `03`) |
| C10 | **Deterministic safety layer** intercepts red-flag cues before the LLM; educator-configurable | Nadia, Maya | Never LLM-only for self-harm/abuse/safeguarding (`02` R7) |
| C11 | **Defer 3D avatars past MVP**; text + voice + 2D portrait carries the loop | Priya, Theo | Highest-effort/lowest-certainty bet; protect scope and margin |
| C12 | **Voice & 3D are premium tiers, not free-tier defaults** | Lena, Kenji | Free-tier must not be subsidized frontier-token/voice burn; contribution margin must survive |
| C13 | **Bottom-up PLG**; individually valuable without the institution | Lena, Priya | Avoid hostage to 9–18 month university sales cycle |
| C14 | **AI-disclosure UX** + DPAs/BAAs with every sub-processor | Omar | EU AI Act transparency (Aug 2026) + GDPR sub-processor obligations |
| C15 | **Eval harness / golden set gates every prompt & model change** | Kenji, Nadia | Model prices/versions churn (Sonnet intro pricing ends Aug 31 2026; new tokenizers +~30% tokens) — quality must not silently regress |

---

## 3. Top-10 Cross-Functional Risks & Mitigations

| # | Risk | Sev | Primary owners | Mitigation |
|---|---|---|---|---|
| R1 | **Clinical hallucination** in AI-patient or hint reaches a learner as "correct" | Critical | Kenji, Nadia | Grounding service + mandatory citations (C4); golden-set eval gate (C15); MD-locked content; deterministic safety layer (C10). *Educator kill-switch.* |
| R2 | **Latency kills immersion** — grounding/assessment or voice stacking stalls the loop | High | Sol, Aria, Ren | Out-of-band grounding/assessment (C5); cascade-voice latency budget < 800 ms first-audio; cache-first prompts; p95 (not p50) SLOs |
| R3 | **Token cost eats margin** as sessions lengthen / volume scales | High | Kenji, Lena | Per-task routing (Haiku default, Opus batched −50%) + prompt caching (0.1× reads) (C6); voice/3D as paid tiers (C12); cost/encounter SLO < $0.15 |
| R4 | **Regulatory over-reach** — accidental slide into HIPAA / EU AI Act high-risk | High | Omar, Priya | Synthetic-patients-only architecture (C2); formative-by-default (C1); no real-PHI ingestion feature at MVP; transparency UX (C14) |
| R5 | **Assessment not defensible** — scores educators can't reconstruct or override | High | Dev, Nadia | Transcript-anchored, overridable scoring (C8); immutable event log (C3); validity dossier per `02` R6; honest κ≈0.44 framing, advisory-only |
| R6 | **Scope creep** — voice+3D+multiplayer+dashboards burn runway before the loop is proven | High | Priya, Victor | Ruthless wedge (solo text EM loop); defer 3D (C11); multiplayer/dashboards as fast-follows; MVP metric gates before expansion |
| R7 | **No moat / incumbent squeeze** — OpenEvidence ($12B), AMBOSS/UWorld, sim incumbents | High | Lena, Victor | Moat = validity/assessment + clinician-graded eval flywheel + institutional integration (LTI/Caliper), not content breadth; regulatory barrier as tailwind |
| R8 | **Multiplayer / realtime state divergence** under network churn (2 humans + AI agents) | Med | Sol, Aria | Server-authoritative, event-sourced room state; idempotent tool calls; graceful text fallback on WebRTC failure; 100-concurrent-room staging test |
| R9 | **Voice mis-transcription corrupts the grade** (drug/dose/eponym errors) | Med | Ren, Dev | Medical-tuned STT (Deepgram Nova-3 Medical, ~6.8% WER) (C7); confirm-critical-values UX; faithful transcript anchors rubric (C8) |
| R10 | **Competency-mapping / analytics rot** — wrong or unauditable EPA mapping poisons dashboards | Med | Dev | Editable, versioned, MD/curriculum-owned mapping (C9); pre-reveal self-rating captured as first-class event; de-identified aggregates guard re-identification |

---

## Key decisions for AcuDx

- **Wedge = solo learner ↔ AI-patient, text-first, Emergency Medicine, with structured feedback + Dunning-Kruger calibration plot.** Voice, 3D, multiplayer, and dean's-office dashboards are gated fast-follows, not MVP. (Priya, Victor)
- **Ship formative-by-default and synthetic-patients-only.** These two calls (C1, C2) keep AcuDx *below* EU AI Act Annex III high-risk and *outside* HIPAA (FERPA governs student data) — the single biggest scope/cost/regulatory reducers available. Summative and any real-data path are deliberate, gated, later. (Omar, Priya)
- **Model routing is the cost architecture:** Haiku 4.5 ($1/$5) for in-encounter patient dialogue, Sonnet 5 ($2/$10 intro → $3/$15 Sep 1 2026) for grounded hints, **Opus 4.8 via Batch API (−50% = $2.50/$12.50)** for out-of-band assessment. **Prompt caching (0.1× input on reads) is the biggest single lever** — design cache-first. Target blended text-encounter cost **< $0.15**. ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)) (Kenji)
- **Cascade voice (STT→LLM→TTS), not native speech-to-speech, at MVP** — auditable clinical text wins in a regulated assessment product. Stack: **Deepgram Nova-3 Medical** STT (~6.8% WER, $0.0077/min) + **ElevenLabs** TTS (~75 ms, ~$0.08/min); latency budget < 800 ms first-audio, barge-in mandatory. Voice is a **premium tier**. (Ren, Lena)
- **Event-sourced encounter log is the single source of truth** for replay/debrief, transcript-anchored + overridable grading (`02` R2), analytics/EPA mapping, and the ≥6-month audit trail. Grounding and assessment run **out-of-band** so they never block the sub-1.5 s conversation loop. (Aria, Sol, Dev)
- **Realtime backbone = LiveKit** (WebRTC $0.0005/min, agent $0.01/min); note **HIPAA-BAA + SOC 2 only from Scale tier ($500/mo)** — text-only solo uses cheaper WebSocket/SSE, don't pay WebRTC minutes for text. ([LiveKit](https://livekit.com/pricing)) (Aria, Sol)
- **Defer 3D avatars to Phase 2**; when built, buy the pipeline (Ready Player Me + open-source NVIDIA Audio2Face-3D + client-side Three.js), render on the client, keep incremental cost < $0.05/min. (Theo)
- **Moat and margin, not features, are what earn the round:** validity/assessment dossier + clinician-graded eval flywheel + LTI/Caliper institutional integration, and **contribution-margin-positive paid usage** — against a market where OpenEvidence is at a $12B valuation and >40% daily US-physician usage. Bottom-up PLG so AcuDx isn't hostage to the university sales cycle. ([CNBC](https://www.cnbc.com/2026/01/21/openevidence-chatgpt-for-doctors-doubles-valuation-to-12-billion.html)) (Lena, Victor)
