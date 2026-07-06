# 02 — Educator & Clinician Stakeholders

**Scope:** the people who supervise, examine, author, and certify. They are AcuDx's gatekeepers: without their trust the tool is a toy, and with it AcuDx becomes infrastructure. Learners (students, residents, nurses, paramedics) are covered in `01-learners.md`; institutions ("dean's office") in `03-institutions.md`. This doc is about the clinician-educators who sit between the two and hold veto power over adoption.

**Central tension:** every educator persona below is time-starved and liability-aware. They will *not* adopt a tool that (a) grades their learners in a way they can't defend, or (b) adds authoring/oversight work on top of a job that is already unpaid or under-recognized. AcuDx wins only if it is a *net workload reducer* with a *defensible validity story*. Everything here serves those two constraints.

---

## 1. Personas

### (a) Dr. Amaka O. — Attending / Consultant Supervisor (EM, tertiary hospital)
- **Context:** supervises 6–10 residents + rotating students; precepts on shift; signs entrustment decisions. Zero protected time for edtech.
- **Job-to-be-done with AcuDx:** offload low-stakes reps (history-taking, differential building, common presentations) so scarce bedside time goes to high-acuity teaching. Wants a dashboard that tells her *which resident is weak at what* before the next shift, not after the rotation.
- **What she needs to trust it:** that AcuDx's AI-patient behaves clinically plausibly (no hallucinated pathophysiology), that its feedback agrees with what *she* would have said, and that a bad AI grade can't quietly flow into an ACGME milestone or an EPA entrustment decision she signs her name to.
- **Adoption trigger:** it saves her writing narrative feedback. If AcuDx drafts a defensible milestone-mapped comment she edits in 90 seconds instead of writing from scratch, she is in.
- **Kill switch:** one hallucinated management recommendation shown to a resident as "correct." She will pull the whole cohort.

### (b) Dr. Ben H. — OSCE Examiner (finals / licensing station examiner)
- **Context:** examines 12–16 candidates/day on a fixed checklist + global rating; obsessed with fairness, standardization, and defensibility on appeal.
- **JTBD:** formative OSCE practice at scale so candidates arrive prepared; and — the bigger prize — *AI-assisted scoring of the encounter* that he can audit, not a black box that replaces him.
- **Trust bar:** he lives in psychometrics. He wants inter-rater reliability numbers vs. a human examiner, station-level reliability (Cronbach's α / G-coefficient), evidence the AI doesn't drift across candidates, and per-item scoring he can override. He knows the current honest ceiling: recent work on LLM juries scoring real clinical cases reports Cohen's κ of ~0.44 for diagnosis scoring — *on par with human re-score panels (κ ~0.41) but not better*, and with a systematic tendency to under-score by 0.7–1.3 points on a 5-point scale ([Can LLMs Accurately Score Medical Diagnoses and Clinical Reasoning?, arXiv 2604.14892](https://arxiv.org/html/2604.14892v3)). He will accept AI as a *second rater / triage / practice tool*, **not** as the sole summative examiner. Design to that.
- **Kill switch:** an AI score he can't reconstruct from the transcript. If he can't point to the utterance that earned/lost the mark, it's inadmissible.

### (c) Dr. Chen L. — Simulation-Lab Faculty (sim center director)
- **Context:** runs manikin/SP scenarios, debriefs, books rooms, tracks SP hires. Deeply invested in existing sim pedagogy (PEARLS/advocacy-inquiry debriefing, INACSL standards) and protective of it.
- **JTBD:** use AcuDx for the *cognitive* parts (history, reasoning, disposition) that don't need a physical manikin, freeing SP dollars and lab hours for procedural/team sim that does. Wants AcuDx to *feed* his debrief, not replace it — a transcript + gap analysis he opens the debrief with.
- **Trust bar:** fidelity claims must be honest. He will call out "high-fidelity" marketing on a text/voice chat. He needs the AI-patient's affect/behavior variants (aggressive, anxious, low-health-literacy, cognitively impaired) to be *pedagogically controllable*, not random. Alignment with INACSL Healthcare Simulation Standards of Best Practice and a mapping to sim learning objectives.
- **Adoption trigger:** pre-brief and debrief material generated automatically; scheduling/prep time cut.

### (d) Dr. Dara P. — Clinical-Skills Tutor (small-group, pre-clinical + early clinical)
- **Context:** teaches history/exam/communication to groups of 8; high-touch, formative, relationship-based. Most skeptical that a bot can teach communication.
- **JTBD:** give students unlimited *safe* reps between her sessions, especially for the awkward ones (breaking bad news, non-native speaker, angry patient) that she can't manufacture on demand. Wants to *see* what students did so her scarce contact time is remediation, not first exposure.
- **Trust bar:** the AI-patient's *communication* behavior and the feedback on empathy/rapport must be defensible. She'll test it with edge cases (a suicidal cue, a safeguarding disclosure) and watch whether it responds safely. She wants control over difficulty and the ability to disable modes.
- **Kill switch:** the AI mishandling a red-flag disclosure (self-harm, abuse) or rewarding a student for a communication move she considers harmful.

### (e) Dr. Elif K. — Course / Curriculum Director
- **Context:** owns a course's learning outcomes, blueprint, assessment map, and accreditation evidence (LCME/GMC/WFME). Answerable to the curriculum committee and external accreditors.
- **JTBD:** map every AcuDx case and every measured competency to *her* outcomes and to a framework (Miller's pyramid, ACGME/CanMEDS, EPAs) so AcuDx data becomes accreditation-grade evidence, not shadow data. Wants coverage analytics: "which EPAs does my cohort never practice?"
- **Trust bar:** curriculum mapping must be *hers to edit*, versioned, and exportable. Assessment data must survive an accreditation audit. She needs the validity argument written down (Kane's framework: scoring → generalization → extrapolation → implications).
- **Adoption trigger:** AcuDx produces the coverage + competency evidence her accreditation self-study currently costs weeks of manual work to assemble.

### (f) Dr. Farid N. — Clinical Content Author (case writer / question bank editor)
- **Context:** writes cases and MCQs, often for AMBOSS/UWorld-style banks or institutional repositories. Cares about medical accuracy, source citation, and reuse.
- **JTBD:** author a rich, branching, guideline-grounded case in *hours not weeks*, with AI drafting the scaffold and him doing expert review. Reference: redesigning even one existing colorectal VP case took ~16 surgeon-hours + ~48 developer-hours ([Huwendiek et al., pilot study](https://www.tandfonline.com/doi/full/10.1080/01421590801910216)). If AcuDx cuts the author's share to 2–4 hours of *review*, that's the whole business case.
- **Trust bar:** every clinical assertion is sourced and versioned; he can lock/override AI-generated content; cases export in an open format (not trapped in AcuDx); attribution and IP are clear.
- **Kill switch:** AI-authored content he can't verify the provenance of, or a platform that owns his cases.

---

## 2. Cross-Persona Requirements (what they all demand)

| # | Requirement | Why it's non-negotiable | Design implication for AcuDx |
|---|---|---|---|
| R1 | **Human-in-the-loop on every grade that "counts"** | EU AI Act classes education AI that *assesses learning outcomes or determines educational path* as **high-risk** (Annex III); obligations phasing in, high-risk education-use rules apply from **2 Dec 2027**, transparency rules from **Aug 2026** ([EU AI Act Annex III](https://artificialintelligenceact.eu/annex/3/); [EU AI Act for Education 2026](https://planbe.eco/en/blog/eu-ai-act-for-the-education-industry/)). Educators are legally on the hook. | AI grades are **advisory by default**. Summative use requires explicit educator sign-off. Hard config flag `assessment_mode: formative | summative-with-review`. |
| R2 | **Traceable, overridable scoring** | Examiners can't defend a score they can't reconstruct. AI Act also mandates override + logging (≥6 months) for high-risk systems. | Every rubric item links to the exact transcript span that triggered it. One-click override with a mandatory reason. Immutable audit log. |
| R3 | **Guideline grounding + provenance** | Attendings/authors will reject any hint of hallucinated medicine. | Every clinical claim in a case or hint carries a citation to a versioned, country-specific guideline source (ATLS x-edition, NICE, local protocol) with edition + date. See `guidance-grounding` design doc. |
| R4 | **Curriculum & framework mapping they own** | Curriculum directors need accreditation-grade evidence; nobody trusts a vendor's opaque taxonomy. | Editable mapping layer: case → learning outcome → competency (Miller, ACGME milestone, CanMEDS role, EPA). Versioned, exportable. |
| R5 | **Interoperability / no lock-in** | Content authors and directors refuse to trap IP; sim centers already run LMSs. | Cases import/export in an open schema (align with the ANSI/MedBiquitous Virtual Patient standard as a baseline — [MVP overview, PMC2655833](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2655833/)); LMS integration via **LTI 1.3** + grade passback and **Caliper Analytics** events ([1EdTech LTI](https://www.1edtech.org/standards/lti)). |
| R6 | **Validity evidence, written down** | Examiners and directors won't stake accreditation on vibes. | Ship a living validity dossier per case-type: IRR vs. human, station reliability, bias testing across demographics (AI Act data-governance requirement). |
| R7 | **Safety guardrails on sensitive content** | Skills tutors will probe red-flag disclosures. | Deterministic safety layer intercepts self-harm/abuse/safeguarding cues; educator-configurable escalation; never rewards unsafe learner behavior. |
| R8 | **Workload must go *down*** | Adoption dies if it's extra unpaid work. | Every educator-facing feature is judged against the "does this save me time this week?" test (see §5). |

---

## 3. Case-Authoring Workflow They'll Accept

The author (persona f) and content-owning directors (e) will only adopt an "AI-assisted, human-authoritative" pipeline. Fully-automated case generation is a **non-starter** for anything summative. Proposed workflow:

```
STAGE 0  BLUEPRINT (director/author, 10 min)
  Pick: specialty, presentation, difficulty, target learner level,
  competencies to assess (multi-select from framework), country/guideline set.
  → AcuDx pre-fills a case skeleton from the blueprint.

STAGE 1  AI DRAFT (Tier-3 model, ~60–120s, ~$0.05–0.20/case)
  Generates: patient persona + hidden clinical truth (diagnosis, physiology,
  test results, disposition), branching dialogue, expected-actions rubric,
  distractor findings, guideline-cited hints. EVERY clinical claim tagged
  with a source + confidence. Nothing is shown to learners yet.

STAGE 2  EXPERT REVIEW & LOCK (author, 2–4 hrs — the real work)
  Author reviews in a side-by-side "claim / source / edit" view.
  - Accept / edit / reject each clinical assertion.
  - Lock verified facts (locked = AI cannot alter on regeneration).
  - Set rubric weights and pass/fail anchors.
  - Flag safety-sensitive branches for the guardrail layer.
  A case cannot leave DRAFT status until an author with clinical credentials
  signs off. Sign-off is recorded (who, when, guideline versions).

STAGE 3  PEER / PSYCHOMETRIC REVIEW (2nd reviewer + optional pilot)
  Optional second clinician review (config per institution).
  Pilot on N learners → item analysis (difficulty, discrimination,
  point-biserial) surfaced before summative use.

STAGE 4  PUBLISH + VERSION
  Semantic versioning. Publishing pins guideline editions. Any later
  guideline update flags affected cases for re-review (does NOT auto-edit).

STAGE 5  MONITOR
  Drift dashboard: flag items where AI grade vs. educator override diverge
  > threshold → back to review. Closes the loop for R2/R6.
```

**Why authors accept it:** their time moves from *creation* (weeks) to *review* (hours), they keep authority (locking, sign-off), provenance is enforced, and nothing they didn't verify reaches a learner. This directly attacks the ~64-person-hour cost of building one rich case.

---

## 4. Trust & Safety Guardrails They Will Demand

1. **Advisory-by-default grading.** AI never assigns a grade of record without a named human's sign-off (R1). UI must make the AI/human boundary unmistakable.
2. **Full traceability.** Score → rubric item → transcript span, always reconstructable; immutable audit log ≥6 months (AI Act); exportable for appeals.
3. **Provenance on every clinical claim.** Case content and real-time hints cite versioned, country-specific guidelines. No source → flagged, not shown as fact.
4. **Deterministic safety interceptor.** A rules+classifier layer *outside* the roleplay LLM catches red-flag learner or patient content (self-harm, abuse, safeguarding, dangerous management) and routes to educator-configured behavior. The generative model is never the last line of safety defense.
5. **Bias & fairness testing.** Per AI Act data-governance duties, test scoring parity across gender/ethnicity/language/disability proxies; publish results in the validity dossier; let institutions gate on it.
6. **Controllable difficulty & mode disabling.** Educators toggle patient-behavior variants and difficulty; can disable modes (e.g., "aggressive patient") for a cohort.
7. **Guideline-update discipline.** New guideline edition → affected cases *flagged for human re-review*, never silently rewritten. Directors see a "cases pending re-validation" queue.
8. **No black-box summative use.** Given current LLM-scoring ceilings (κ ~0.44 for diagnosis, differential-diagnosis scoring notably weaker, correlations 0.09–0.52 — [arXiv 2604.14892](https://arxiv.org/html/2604.14892v3)), AcuDx positions AI as **formative practice + second-rater/triage**, and requires human co-signing for summative. Encode this as policy, not marketing.
9. **Data governance / FERPA-GDPR.** Learner performance data is institution-owned; clear DPA; SSO; role-based access so an examiner sees only their candidates.

---

## 5. How AcuDx *Reduces* Educator Workload (the adoption case)

Each item maps to a persona and a measurable time saving. This is the section that gets AcuDx adopted.

| Task today (manual) | Persona | AcuDx does | Time saved |
|---|---|---|---|
| Writing narrative, milestone-mapped feedback per learner | Attending (a) | Drafts a competency-mapped comment from the transcript; attending edits | Feedback drops from ~10–15 min to ~90 s edit |
| Running formative history/reasoning reps | Attending (a), Tutor (d) | Unlimited AI-patient reps between contact hours | Reclaims bedside/contact time for high-acuity teaching |
| OSCE first-pass scoring | Examiner (b) | AI second-rater + item-level pre-fill; examiner audits/overrides | Faster panels; used as check, not replacement |
| Authoring one rich branching case | Author (f) | Drafts scaffold + rubric + cited hints; author reviews | ~64 person-hrs → ~2–4 hrs review ([ref](https://www.tandfonline.com/doi/full/10.1080/01421590801910216)) |
| Building pre-brief / debrief materials | Sim faculty (c) | Auto-generates transcript, gap analysis, debrief prompts | Prep time cut; debrief starts from evidence |
| Assembling accreditation coverage evidence | Director (e) | Auto coverage map (EPAs/milestones practiced vs. gaps), exportable | Weeks of self-study assembly → dashboard export |
| Manufacturing hard/rare encounters (bad news, angry, non-native) | Tutor (d) | On-demand, safe, repeatable variants | No SP scheduling; infinite reps |
| Chasing which learner is weak at what | Attending (a), Director (e) | Cohort competency heatmap + Dunning-Kruger calibration flags | Remediation targeted *before* the rotation ends |

**The one-sentence pitch to each educator:** *"AcuDx does the first draft; you stay the authority — and you get your evenings back."*

Guardrail on the workload claim: if the review/oversight burden (Stage 2 sign-off, override review, re-validation queue) is heavier than the creation time saved, the value proposition inverts. Instrument this. Track per-institution *educator minutes spent* and prove net-negative, or the whole thesis fails.

---

## Key decisions for AcuDx

1. **AI grading is advisory-by-default; summative grades require named human sign-off.** Ship `assessment_mode: formative | summative-with-review` as a hard flag. Driven by EU AI Act high-risk classification of education-assessment AI (Annex III; high-risk rules from 2 Dec 2027, transparency from Aug 2026) and the honest LLM-scoring ceiling (κ ≈ 0.44 for diagnosis, ≈ human panels, not better; weak on differential diagnosis).
2. **Every score is fully traceable and overridable.** Rubric item ↔ transcript span, one-click override with mandatory reason, immutable audit log ≥6 months. Non-traceable scores are inadmissible to examiners — do not ship them.
3. **Case-authoring is AI-drafts / human-authoritative in 6 stages, with an enforced clinician sign-off gate.** Target moving authors from ~64 person-hrs of creation to ~2–4 hrs of review per case. Locking + provenance + sign-off are mandatory; auto-generated summative content without human lock is banned.
4. **Provenance on every clinical claim, versioned to country-specific guideline editions.** No source → flagged, never shown as fact. Guideline updates flag cases for human re-review; never silently rewrite.
5. **Own an editable, versioned curriculum-mapping layer** (case → outcome → Miller / ACGME milestone / CanMEDS / EPA), exportable as accreditation-grade evidence — this is the curriculum director's adoption trigger.
6. **Interoperate, don't lock in:** open case schema aligned to the ANSI/MedBiquitous Virtual Patient standard; LMS integration via LTI 1.3 grade passback + Caliper Analytics. Content authors will reject IP capture.
7. **Deterministic safety interceptor sits outside the roleplay LLM** for red-flag disclosures (self-harm/abuse/safeguarding/dangerous management); the generative model is never the last safety layer. This is the skills tutor's kill-switch test.
8. **Prove net-negative educator workload with instrumentation.** Track educator-minutes per institution; if oversight burden exceeds creation-time saved, the adoption thesis inverts. Bias/fairness testing across demographics is a shipped artifact (AI Act data-governance duty), not a promise.
