# AcuDx Stakeholders — 01: Learners

**Scope.** The people who actually roleplay the cases. This doc simulates seven learner archetypes in depth, then extracts cross-cutting requirements, a MoSCoW feature prioritization, retention hooks, and churn anti-patterns. Everything is grounded in the AcuDx roleplay mechanics (Solo-vs-AI, multiplayer rooms, agent-only rooms, guidance mode, Dunning-Kruger calibration feedback) and July 2026 market reality.

**Why this matters commercially.** Learners are the daily-active surface. Institutions pay (see `03-institutions.md`), but if learners don't return, cohort dashboards go dark and renewals die. The market signal is clear: clinical-skills assessment has been permanently pushed down to the institution/OSCE level after USMLE Step 2 CS was discontinued and its relaunch abandoned ([USMLE.org, "Work to relaunch USMLE Step 2 CS discontinued"](https://www.usmle.org/work-relaunch-usmle-step-2-cs-discontinued)). That created a durable, unmet demand for scalable clinical-encounter practice — exactly AcuDx's wedge. Competing AI-virtual-patient products already exist (SimChat by Geeky Medics, MedAscend/Simulation Collective) but are shallow ([Geeky Medics SimChat](https://geekymedics.com/simulation-with-ai-virtual-patients/)); the differentiator is roleplay depth + grounded guidance + calibrated feedback.

---

## Persona framework (how to read each card)

Each persona has: **snapshot**, **goals**, **jobs-to-be-done (JTBD)**, **context of use**, **pain points with current tools**, **motivation & anxiety drivers**, **what "great" looks like**, **failure/dropout risks**, **device/bandwidth**, **accessibility**. Personas are composites, not real individuals.

---

## (a) Pre-clinical medical student — "Priya, MS1"

**Snapshot.** Year 1, 22, big US/EU/India cohort. Living in anatomy/physiology/pharmacology. Has never taken a real history. High motivation, near-zero clinical schema, terrified of "looking stupid."

**Goals.** Convert textbook facts into a mental model of a real encounter. Build the *reflex* of asking "what would I do next?" early, so clinical years aren't a cold start. Feel like a future doctor, not a flashcard machine.

**JTBD.**
- "When I finish a lecture on chest pain, help me *use* it in a 5-minute encounter so it sticks."
- "When I don't know the next question, don't fail me silently — scaffold me."
- "Show me I'm improving week over week so I keep going."

**Context of use.** 5–15 minute sessions between lectures, on a laptop in the library or phone on a commute. Spaced, opportunistic, low-stakes. Often the *only* clinical exposure MS1s get all year.

**Pain points with current tools.** Anki/UWorld/AMBOSS are recognition-based (pick the right MCQ), not production-based (generate the next question live). MCQ banks train test-taking, not encounters. Standardized-patient sessions are rationed to 2–4/year and scheduled months out. There is no cheap, on-demand way to *practice the conversation*.

**Motivation & anxiety drivers.** Motivation: identity ("I'm becoming a doctor"), visible progress, peer comparison. Anxiety: fear of judgment, imposter syndrome, information overload. **Design implication:** MS1 mode must be *forgiving by default* — the AI patient should never punish a naive question; guidance mode should be ON with heavy scaffolding.

**What "great" looks like.** A geriatric-patient case where Priya fumbles the opening, the Socratic guidance nudges ("You haven't established onset — how might you ask?"), she recovers, and the post-encounter calibration plot shows her confidence was *low but competence was moderate* — reframing imposter feelings as under-confidence. She feels safe enough to do three more.

**Failure/dropout risks.** Content too advanced → humiliation → churn. This is the single biggest MS1 risk. Also: no visible tie to her actual curriculum/exams → feels like a toy. Burnout is real background risk (pooled medical-student burnout ~37%, dropout 3.8–26% depending on cohort — [ScienceDirect, "Correlates of burnout and dropout intentions in medical students"](https://www.sciencedirect.com/science/article/pii/S0165032724012163)); anything that adds shame accelerates it.

**Device/bandwidth.** Laptop primary, phone secondary. Campus Wi-Fi generally good, but India/LMIC cohorts on mobile data — **text mode must work at <100 kbps; voice must be optional, never required.**

**Accessibility.** Standard: keyboard nav, screen-reader-labeled vitals monitor, dyslexia-friendly typography, adjustable text size. Many MS1s are ESL even in "English" programs.

---

## (b) Clinical-years student prepping for OSCEs — "Marcus, MS3/MS4"

**Snapshot.** On rotations, 24–26. Facing high-stakes institutional OSCEs — now the *de facto* gatekeeper of clinical competence since Step 2 CS died and elements moved into institutional OSCEs and Step 3 computer-based case simulations ([USMLE policy updates following Step 2 CS discontinuation](https://www.usmle.org/usmle-policy-updates-following-step-2-cs-discontinuation)). A comprehensive clinical assessment is a full-day, ~12-station OSCE covering history, exam, diagnosis, management, communication, professionalism.

**Goals.** Pass OSCEs cleanly. Automate the OSCE *ritual* (WIPE hygiene, structured history, ICE — ideas/concerns/expectations, closing the loop) so it's muscle memory under time pressure. Practice the specific station formats his school uses.

**JTBD.**
- "Give me timed, checklist-scored stations that mirror my school's OSCE format and mark scheme."
- "Rehearse the *hard* patients — the aggressive one, the tearful one, the vague historian — that wreck my timing."
- "Tell me exactly which marks I dropped and why, per station, so I can drill the gap."

**Context of use.** Evening cram blocks, 20–45 min, often with 1–2 classmates (multiplayer rooms shine here). Laptop at home. Intense, deadline-driven, weeks before the exam.

**Pain points with current tools.** Peer role-play needs a partner and a script and honest feedback — all scarce. Real standardized patients are gold but rationed. Existing AI virtual-patient tools score OSCE-style checklists but are thin on realistic patient *affect* and don't map to *his* school's mark scheme ([Geeky Medics AI patients for OSCE](https://geekymedics.com/ai-simulated-patients-for-osce-preparation/)). Feedback is generic.

**Motivation & anxiety drivers.** Motivation: pass/fail stakes, class ranking, wanting to not embarrass himself on the ward. Anxiety: timing (the 7-minute station), blanking, the "difficult patient." **Design implication:** a hard countdown timer, station-format templates, and a difficulty dial on patient affect are must-haves.

**What "great" looks like.** He runs a 7-minute abdominal-pain station against an anxious patient variant, gets a live timer, is auto-scored against a checklist that matches his school's rubric (uploaded by the institution), and the gap analysis says "you never asked about ICE — 3 marks; you didn't safety-net — 2 marks." He redoes it, hits the marks, and his calibration plot tightens.

**Failure/dropout risks.** Scoring that doesn't match his real OSCE rubric → he distrusts it → abandons before the exam. Latency in voice mode breaking the timed illusion. Cases that feel canned after 5 reps.

**Device/bandwidth.** Laptop, home broadband, headset for voice. Voice mode is *high-value here* (OSCEs are spoken) — but must degrade gracefully to text on bad connections.

**Accessibility.** Timed stations disadvantage some disabled learners — **must offer extended-time and no-timer modes** without breaking scoring semantics.

---

## (c) Junior resident / intern (PGY-1) — "Aisha, intern"

**Snapshot.** First year post-graduation, 26–28, exhausted, on shift work. Real patients, real stakes, chronic sleep debt. This is where the AAMC Core EPAs (13 activities expected "on day one of residency without direct supervision") are supposed to already be in place — and where the med-school→residency performance gap actually bites ([AAMC Core EPAs](https://www.aamc.org/about-us/mission-areas/medical-education/cbme/core-epas)).

**Goals.** Not kill anyone. Handle the overnight admissions and cross-cover calls she wasn't drilled on. Build fast, safe decision reflexes for the 20 presentations that make up 80% of her nights.

**JTBD.**
- "Between admissions, give me a 4-minute reps on the exact call I'll get at 3am (chest pain page, hypotension, falls)."
- "Let me practice the *dispatcher/senior-colleague* comms, not just the patient" — AcuDx role interchangeability matters here (AI plays senior colleague / family / nurse).
- "Fit into 5 minutes of dead time and remember where I left off."

**Context of use.** Micro-sessions in call-room downtime, on a phone, often one-handed, interrupted constantly. Fatigue is the dominant constraint. Any friction = no session.

**Pain points with current tools.** Everything assumes she has 30 focused minutes. She doesn't. Qbanks are exam-shaped, not shift-shaped. No tool rehearses the *escalation* conversation (calling the senior, SBAR handoff) which is where interns actually fail.

**Motivation & anxiety drivers.** Motivation: fear of harming a patient, wanting to look competent to seniors, survival. Anxiety: acute burnout (residents skew high), decision paralysis at night. **Design implication:** ultra-short sessions, instant resume, zero cognitive setup cost, phone-first, dark-mode for night shifts.

**What "great" looks like.** 3am, phone, dark mode: she runs a 4-minute "hypotensive post-op patient" agent room where the AI nurse gives her a vitals trend and she must reason to a plan and "call the senior" (AI). Guidance is grounded in the correct country-specific protocol. She closes the app before her real page even finishes buzzing.

**Failure/dropout risks.** Anything slow, heavy, or preachy. If it feels like *more work* on top of an 80-hour week, it's gone in a day. Burnout-driven disengagement is the core retention threat.

**Device/bandwidth.** Phone-only realistically. Hospital Wi-Fi is often terrible/segregated — **must work fully offline-tolerant or on cellular; sessions must survive network drops.**

**Accessibility.** Fatigue-aware: large tap targets, low-cognitive-load UI, voice optional (she can't always talk in a shared call room → text-first).

---

## (d) Senior resident (PGY-3+) — "David, senior"

**Snapshot.** 29–33, competent, now *teaching* juniors and being assessed on higher-order EPAs and leadership. Time-poor but self-directed. Prepping for board/specialty exams and increasingly for team-lead roles.

**Goals.** Sharpen management-level reasoning and *team leadership* (running the room, delegating to nurse/paramedic, closed-loop comms). Prep for high-stakes specialty boards. Use AcuDx to *teach* — run multiplayer rooms as team-lead over juniors and AI agents.

**JTBD.**
- "Put me in the team-lead seat in a multiplayer trauma room and grade my leadership, not just my diagnosis."
- "Simulate the rare/high-acuity cases I don't see often enough (massive PE, peri-arrest, mass-casualty triage)."
- "Give me content hard enough to actually stretch me."

**Context of use.** Scheduled deliberate practice (30–60 min) plus using AcuDx *as a teaching tool* with his juniors — he's a power user and a distribution channel. Laptop, sometimes a big screen with the vitals monitor.

**Pain points with current tools.** Ceiling too low — most edtech is pitched at students and bores seniors instantly. Nothing assesses *leadership/teamwork* (CanMEDS Collaborator/Leader, ACGME systems-based practice). No good way to run a controlled multi-role scenario without booking a physical sim center.

**Motivation & anxiety drivers.** Motivation: mastery, teaching identity, board pass rates, promotion. Anxiety: being exposed as rusty on rare emergencies; leading a resus badly. **Design implication:** high-difficulty content, leadership rubrics, and first-class multiplayer/team-lead tooling.

**What "great" looks like.** David spins up a multiplayer major-trauma room, takes team-lead, assigns two interns to airway/access and lets AI fill paramedic + family roles, and gets scored on ATLS-grounded decisions *and* on delegation, situational awareness, and closed-loop communication — with a debrief that separates *his* leadership marks from the team's clinical marks.

**Failure/dropout risks.** Too easy → instant churn. Multiplayer that's laggy or clunky to set up. Guidance that's out of date relative to current guidelines (a senior will *immediately* catch a stale protocol and lose all trust).

**Device/bandwidth.** Laptop/desktop, good connection, comfortable with voice + multiplayer. The most bandwidth-tolerant persona.

**Accessibility.** Standard; main need is efficient power-user shortcuts and dense information display.

---

## (e) Nursing student — "Elena, BSN Y3"

**Snapshot.** 20–23, training toward a *nursing* scope: assessment, monitoring, escalation, medication safety, patient communication — NOT differential-diagnosis-first reasoning. Often overlooked by physician-centric edtech.

**Goals.** Master structured assessment (ABCDE), recognize deterioration early, escalate correctly (SBAR to the doctor), safe med administration, and compassionate communication. AcuDx role interchangeability is central: **she must be able to play the nurse, with the AI as patient/doctor/family.**

**JTBD.**
- "Let me be the *nurse*, not a mini-doctor — assess, monitor the vitals trend, and escalate at the right moment."
- "Drill deterioration recognition: give me a patient whose SpO2 is quietly sliding and see if I catch it."
- "Practice SBAR handoff to an AI doctor and grade my communication."

**Context of use.** 10–20 min sessions, phone or shared campus computers/tablets, often between clinical placements. Nursing programs are resource-constrained; personal laptops less universal than in med school.

**Pain points with current tools.** Almost everything is physician/diagnosis-shaped. Nursing sim is manikin-based (SimMan etc.), expensive, and access-rationed. No affordable on-demand tool centers the *nursing* role and its escalation/communication competencies.

**Motivation & anxiety drivers.** Motivation: patient safety, competence, licensure exam (e.g., NCLEX-style). Anxiety: "will I miss the deteriorating patient?", speaking up to a doctor (hierarchy anxiety). **Design implication:** the live vitals monitor and trend charts (already in the AcuDx prototype) are *the* hero feature for nursing; escalation-communication scoring is a distinct rubric.

**What "great" looks like.** Elena watches the respiratory trend chart on a post-op patient, catches the early SpO2 drift, does a focused ABCDE, and delivers a clean SBAR to the AI doctor who (correctly) responds to the quality of her handoff. Feedback praises early recognition and coaches her SBAR structure.

**Failure/dropout risks.** Feeling like an afterthought bolted onto a doctor tool → she leaves. Content that forces her out of nursing scope. Price: nursing students are more price-sensitive than med students.

**Device/bandwidth.** Phone/tablet primary; shared devices common → **no assumption of a persistent personal device; must resume via login on any device.**

**Accessibility.** Multi-device session continuity, low-bandwidth, and shared-device privacy (log out cleanly).

---

## (f) Paramedic trainee — "Tom, EMT→paramedic"

**Snapshot.** 21–30, often a career-changer, training for *pre-hospital* practice: rapid primary survey, protocol-driven decisions, scene management, radio comms to dispatch/ED, all under time and environmental pressure.

**Goals.** Nail time-critical protocol execution (trauma, cardiac arrest, stroke, anaphylaxis) to muscle memory. Practice scene leadership and dispatch/ED radio handover (ATMIST/MIST). Get reps on decisions he *rarely* faces but must nail (peri-arrest, pediatric).

**JTBD.**
- "Throw me a time-critical scene: primary survey, a protocol decision tree, and a radio handover — under a clock."
- "Let the AI be dispatch and the receiving ED so I practice comms, not just clinical steps."
- "Score me against my service's actual protocols" (country/service-specific).

**Context of use.** Between shifts, in the station, on a phone; sometimes in a training-center classroom. Highly kinesthetic learner; short attention for reading, high tolerance for voice/audio.

**Pain points with current tools.** Med-school edtech ignores pre-hospital entirely. Protocol apps are reference, not practice. High-fidelity ambulance sims are expensive and rare. No cheap way to rehearse the *decision + comms* loop repeatedly.

**Motivation & anxiety drivers.** Motivation: protocol confidence, "not freezing on scene," licensure. Anxiety: time pressure, rare high-acuity calls, radio comms under stress. **Design implication:** voice mode + hard timers + dispatcher/ED AI roles are core, not optional, for paramedics. This is the persona where **realtime voice is most load-bearing.**

**What "great" looks like.** Tom runs a voice-driven anaphylaxis scene: AI patient deteriorating, AI dispatch on the radio, hard clock. He calls his protocol steps aloud, gives adrenaline, delivers a clean ATMIST handover to the AI ED, and gets scored on protocol adherence *and* comms timing. Guidance is grounded in his country/service protocol version.

**Failure/dropout risks.** Voice latency ruining the realtime illusion (see latency budget below). Protocols not matching his service. Anything that feels academic rather than operational.

**Device/bandwidth.** Phone primary, often on cellular at a station with patchy signal. **Voice-first but must fall back to text; must tolerate 200–400ms mobile network jitter.**

**Accessibility.** Hands-free/voice-first operation; audio-primary with text captions for noisy environments.

---

## (g) International / second-language learner — "Wei, IMG / ESL learner"

**Snapshot.** Any of the above roles but operating in a non-native clinical language (e.g., a Chinese/Indian/Arabic/Spanish-speaking learner practicing in English or German). Post-Step-2-CS, IMGs must get clinical competencies certified via their own schools — there is **no standardized international clinical-skills exam anymore** ([USMLE Step 2 CS alternative overview](https://acemedboards.com/usmle-step-2-cs-alternative-what-medical-students-need-know/)), so on-demand language+clinical practice is doubly valuable.

**Goals.** Practice clinical *communication* in the target language: idiom, empathy phrases, medical terminology, and understanding patients with accents/low health literacy. Reduce the double cognitive load of "reason clinically" + "in a foreign language."

**JTBD.**
- "Let me practice the encounter in English/German, with a *terminology translator* on hand (already in the AcuDx prototype) so I can look up a term without leaving the case."
- "Give me patient variants that mirror real communication challenges: non-native speaker, low health-literacy, accented speech."
- "Feed back on my *language and communication*, separately from my clinical reasoning, so I know which is the weak link."

**Context of use.** Longer, more deliberate sessions; heavy use of the terminology translator; often practicing the *same* case twice (once for clinical logic, once for language fluency). Laptop and phone.

**Pain points with current tools.** Generic tools don't separate language failure from clinical failure — Wei gets marked down and can't tell if it was his medicine or his English. STT often mis-transcribes accented speech, punishing exactly the learner who needs help. Terminology lookup means leaving the app.

**Motivation & anxiety drivers.** Motivation: licensure in target country, employability, dignity. Anxiety: being judged for accent/grammar, mis-transcription, slow processing under time pressure. **Design implication:** dual-axis feedback (language vs clinical), accent-robust STT, inline non-blocking terminology translation, and an optional *no-timer* mode to remove language-speed penalty.

**What "great" looks like.** Wei runs a low-health-literacy patient case in English, taps a term in the translator inline without pausing the encounter, and the debrief gives two separate scores: clinical reasoning (strong) and communication/language (needs work on empathic phrasing), with concrete phrase suggestions. He replays the same case and watches the language score climb.

**Failure/dropout risks.** Accent-blind STT that mis-hears him → humiliation and distrust (the fastest churn path for this persona). Feedback that conflates language and clinical errors. Translator that's clunky or breaks flow.

**Device/bandwidth.** Mixed; often in LMICs on constrained bandwidth. **Multilingual UI, low-bandwidth text mode, and accent-robust STT are non-negotiable.** Note current voice stacks tout multilingual support (e.g., Inworld ~15 production languages, sub-250ms P90) but accent robustness on STT is the real risk, not language coverage ([Inworld speech-to-speech](https://inworld.ai/resources/best-speech-to-speech-apis)).

**Accessibility.** This persona overlaps heavily with accessibility: captions on all voice, adjustable pacing, and text alternatives everywhere.

---

## Cross-cutting learner requirements

These hold across all seven personas and are binding on later design phases.

| # | Requirement | Rationale / which personas |
|---|---|---|
| R1 | **Text mode is the floor; voice is an enhancement, never a gate.** Every case must be fully completable in text at <100 kbps. | LMIC MS1s, interns on hospital Wi-Fi, ESL learners with accent-STT risk. Voice-only would exclude the neediest users. |
| R2 | **Sessions must be resumable and survive network drops.** Server-authoritative state; auto-checkpoint each turn. | Interns (interrupted), nursing students (shared devices), paramedics (cellular jitter). |
| R3 | **Dual-axis feedback: clinical reasoning score separate from communication/language score.** | ESL learners critically; helps everyone. Conflated scores destroy diagnostic value of feedback. |
| R4 | **Rubrics are pluggable and institution-uploadable.** OSCE mark schemes, nursing SBAR rubrics, paramedic service protocols, leadership rubrics all differ. | OSCE students distrust generic scoring; seniors need leadership rubrics; paramedics need service-specific protocols. |
| R5 | **Difficulty and forgiveness are dials.** MS1 = high scaffolding, no penalty for naive questions; senior = high difficulty, sparse hints. | Prevents the two opposite churn modes (humiliation vs boredom). |
| R6 | **Role interchangeability is first-class.** Learner can be doctor / nurse / paramedic / examiner / team-lead; AI fills the rest (patient, senior, family, dispatcher, ED). | Nursing, paramedic, and senior personas depend entirely on this. |
| R7 | **Guidance grounded in current, country/service-specific, versioned guidelines.** Show the guideline + version. | Seniors and paramedics will catch and reject stale protocols instantly; safety requirement. |
| R8 | **Calibration (Dunning-Kruger) feedback that reframes, not shames.** Show confidence-vs-competence; name under-confidence explicitly for anxious learners. | MS1 imposter syndrome, ESL dignity, general engagement. |
| R9 | **Accessibility baseline: WCAG 2.2 AA.** Keyboard nav, screen-reader-labeled vitals monitor and trend charts, captions on all voice, adjustable text/pacing, no-timer and extended-time modes, dark mode. | Legal/institutional procurement requirement + directly serves ESL and disabled learners. |
| R10 | **Phone-first, one-handed, low-friction entry.** Resume in <2 taps, zero setup for a quick rep. | Interns and paramedics in dead-time micro-sessions. |
| R11 | **Curriculum/competency mapping visible.** Every case tagged to Miller's pyramid level, EPA, ACGME/CanMEDS competency, and (where uploaded) the local curriculum. | Makes it feel like real prep, not a toy; feeds institution dashboards; note AAMC replaced the 2013 PCRS with new UME Foundational Competencies in 2025 — mapping layer must be updatable ([AAMC Core EPAs](https://www.aamc.org/about-us/mission-areas/medical-education/cbme/core-epas)). |
| R12 | **Latency budget for voice: end-to-end speech-to-speech target ≤800ms, hard ceiling ~1.2s before it feels robotic.** Natural conversation needs sub-500ms response onset; current stacks hit sub-250ms P90 (Inworld) with 40ms TTFA achievable (Cartesia). | Paramedic and OSCE timed realism depend on this ([Inworld](https://inworld.ai/resources/best-speech-to-speech-apis); [Cartesia via Inworld TTS roundup](https://inworld.ai/resources/best-text-to-speech-apis)). |

---

## Top feature priorities (MoSCoW)

Prioritized for a learner-facing MVP → v1. This ordering is a decision, not a menu.

### Must have
- **M1. Solo-vs-AI text encounter with structured stages** (history → exam request/interpret → tests → differential → diagnosis → management). The core loop; must be flawless in text.
- **M2. Patient variants** (geriatric, anxious, aggressive, low-health-literacy, non-native, cognitively impaired, pediatric-via-parent). This is the roleplay depth competitors lack.
- **M3. Structured post-encounter feedback + gap analysis** mapped to a competency framework, with **dual-axis (clinical vs communication) scores**.
- **M4. Dunning-Kruger calibration plot** (self-rated confidence vs measured competence) per encounter and trended over time.
- **M5. Live vitals monitor + trend charts** (already prototyped) as an interpretable, screen-reader-labeled data source in-encounter.
- **M6. Difficulty/forgiveness dial + guidance mode toggle** (scaffolded Socratic hints, grounded and versioned).
- **M7. Resumable, drop-tolerant sessions; phone-first UX.**
- **M8. Role selection** (be the doctor OR nurse OR paramedic) with AI filling remaining roles.

### Should have
- **S1. Multiplayer rooms** (several humans, distinct roles, AI fills the rest) — critical for OSCE-pair practice and senior team-lead training, but heavier to build.
- **S2. Timed OSCE-station mode** with countdown + institution-uploaded mark scheme.
- **S3. Realtime voice (STT/TTS/duplex)** with captions and text fallback; accent-robust STT.
- **S4. Inline terminology translator** (prototyped) — non-blocking, in-encounter.
- **S5. Gamification: XP, levels, streaks, badges, leaderboards** (opt-in, see anti-patterns).
- **S6. SBAR/handover + escalation-comms scoring** (nursing, paramedic, intern).

### Could have
- **C1. Agent-only observable rooms** (learner watches AI-vs-AI, then joins).
- **C2. Leadership/teamwork rubric** for team-lead scoring in multiplayer.
- **C3. 3D avatars** for patients (nice for immersion; not a competence driver — deprioritize until voice + roleplay are excellent).
- **C4. Spaced-repetition scheduling** of case types tuned to the learner's gap analysis.
- **C5. Cross-device continuity** with clean shared-device logout.

### Won't have (this cycle)
- **W1. VR/headset delivery** — excludes low-bandwidth and phone users; niche vs the wedge.
- **W2. Auto-generated cases with no clinical review** — safety/guidance-grounding risk; every case must be reviewable.
- **W3. Full LMS replacement** — integrate, don't rebuild (see institutions doc).

---

## Engagement & retention hooks

Grounded in the personas above and in the reality that the biggest retention threat is burnout, not disinterest.

1. **Micro-session by default.** A "one quick rep" that fits 4–5 minutes wins interns and paramedics. The unit of engagement is one encounter, not one study session.
2. **Visible week-over-week progress.** The calibration plot *tightening* and competency bars filling are the core dopamine — tie XP to genuine competence gains, not just time spent.
3. **Streaks that forgive.** Streaks motivate but backfire under burnout. Use **"streak freeze"/grace days** so a brutal call week doesn't nuke a 40-day streak and trigger abandonment.
4. **Difficulty that keeps pace.** Adaptive difficulty prevents both MS1 humiliation and senior boredom — the two churn cliffs.
5. **Social, opt-in.** Multiplayer rooms with classmates and cohort (not global) leaderboards. Anxious learners must be able to hide from public ranking.
6. **Identity reinforcement.** "You handled an aggressive patient" badge speaks to becoming-a-clinician identity, which is a stronger MS1 motivator than points.
7. **Gap-driven next-case suggestion.** "You keep missing safety-netting — here's a 5-minute case that drills it." Closes the loop from feedback to action.
8. **Teacher/power-user loop.** Let seniors run rooms for juniors — turns your most engaged users into a distribution and retention engine for the tier below.

---

## Anti-patterns that make learners churn

1. **Humiliation of beginners.** Content pitched too hard for MS1s, or an AI patient that "punishes" naive questions, is the fastest MS1 churn path. Forgiveness dial must default ON for pre-clinical.
2. **Boring the experts.** A low difficulty ceiling loses seniors in one session. Never cap difficulty for the sake of accessibility — dial it.
3. **Fake/generic feedback.** Vague "good job / try harder" with no per-mark gap analysis destroys trust for OSCE and ESL learners. Feedback must be specific, rubric-anchored, and dual-axis.
4. **Voice-only or voice-required.** Excludes low-bandwidth, shared-room interns, and accent-STT-vulnerable ESL learners. Voice is enhancement, not gate.
5. **Accent-blind STT.** Mis-transcribing the ESL learner is the single most humiliating, trust-destroying failure. If STT confidence is low, fall back to text and never silently mis-score.
6. **Stale or wrong guidance.** One out-of-date protocol and every senior/paramedic writes the product off as unsafe. Version and source every guideline.
7. **Friction on entry.** Multi-tap setup, forced logins per session, no resume — interns and paramedics abandon in a day.
8. **Toxic gamification.** Non-forgiving streaks, mandatory public leaderboards, and grind-for-XP loops actively worsen burnout in an already-burned-out population (~37% baseline) and drive the exact churn you're trying to prevent.
9. **Rubric mismatch.** Scoring that doesn't match the learner's real OSCE/service rubric → distrust → abandonment right before the high-stakes event they came for.
10. **Physician-centrism.** Treating nursing/paramedic learners as second-class "mini-doctors" loses two entire segments that have *worse* incumbent tooling and are more underserved.

---

## Key decisions for AcuDx

1. **Wedge = on-demand clinical-encounter practice for institutional OSCEs.** Step 2 CS is permanently gone and clinical-skills assessment now lives at the school/OSCE level with no standardized alternative — that is the durable unmet need AcuDx targets first. Build M1–M4 to be excellent here before anything else.
2. **Text-first, voice-as-enhancement, phone-first.** Bind this at the architecture layer: every case fully completable in text at <100 kbps, sessions server-authoritative and drop-tolerant, resume in ≤2 taps. Voice (STT/TTS/duplex, ≤800ms target / ~1.2s ceiling) is Should-have, never a gate.
3. **Dual-axis feedback (clinical reasoning ⟂ communication/language) is mandatory, not optional.** It's the single highest-leverage differentiator for ESL/IMG learners and improves feedback quality for everyone. Score them separately from day one.
4. **Difficulty + forgiveness dials are core to retention.** They directly defuse the two opposite churn cliffs (MS1 humiliation, senior boredom). Default forgiveness ON for pre-clinical, high difficulty ceiling for seniors.
5. **Role interchangeability + pluggable, institution-uploadable rubrics.** Nursing (SBAR/escalation), paramedic (service protocols), and senior (leadership/teamwork) segments are unserved by incumbents and depend entirely on this. It also feeds the institution dashboards.
6. **Guidance must be grounded, versioned, and country/service-specific — surfaced visibly.** Seniors and paramedics will instantly reject stale protocols; this is both a trust and a safety requirement.
7. **Gamify competence, forgive burnout.** XP tied to real competence gains (calibration tightening), streaks with grace days, opt-in cohort-only leaderboards. Toxic/grind gamification is a net-negative in a ~37%-burnout population and must be avoided.
8. **Accessibility = WCAG 2.2 AA baseline with no-timer/extended-time modes and accent-robust STT.** Non-negotiable for both institutional procurement and for serving the ESL/disabled learners who are the most underserved and highest-loyalty if served well.
