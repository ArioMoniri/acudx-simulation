# 07 — Assessment Science & Learning Analytics

**Scope.** How AcuDx turns a roleplay transcript into a defensible score, a calibration ("Dunning-Kruger") plot, a gap analysis, a remediation plan, and cohort-level dashboards — without demotivating learners or shipping an unreliable grader. Decision-oriented; numbers and named methods throughout. State of the art as of **July 2026**.

**The core claim of this doc:** AcuDx's assessment is a **psychometric product, not a feature**. If the score isn't reliable and validity-argued, every downstream artifact (calibration plot, XP, dean's dashboard, remediation) inherits the noise and becomes actively harmful — a confidently wrong grade is worse than no grade. The whole chain must be engineered to a defined reliability floor and continuously calibrated against expert raters.

---

## 1. Competency frameworks to map to

AcuDx should **not invent a competency taxonomy**. It should score against a small, fixed **internal rubric ontology** and provide *crosswalks* (mappings) to the external frameworks institutions already report on. Institutions live in ACGME/CanMEDS/EPA/Miller language; if AcuDx emits its own vocabulary, it can't feed a dean's dashboard.

### 1.1 The frameworks (what each is *for*)

| Framework | What it measures | Granularity | Where AcuDx uses it |
|---|---|---|---|
| **Miller's pyramid** (Knows → Knows How → Shows How → Does) | *Level of assessment*, not content | 4 levels | Positions AcuDx: simulation = **"Shows How"** (and, with high fidelity + longitudinal data, a claim on **"Does"**). MCQ apps stop at "Knows How". This is AcuDx's headline differentiator. |
| **ACGME Core Competencies + Milestones** | 6 US competencies (Patient Care, Medical Knowledge, Practice-Based Learning & Improvement, Interpersonal & Communication Skills, Professionalism, Systems-Based Practice), each with 4–5 sub-competencies scored on **Level 1–5 Milestone** narrative anchors | Sub-competency, 5 levels | US residency programs report Milestones to ACGME twice yearly. AcuDx per-domain scores must roll up to a Milestone-level estimate + supporting evidence. |
| **CanMEDS** (2015; **CanMEDS 2025** refresh in adoption) | 7 physician Roles: Medical Expert, Communicator, Collaborator, Leader, Health Advocate, Scholar, Professional | Role → competency | Canada, much of EU/Middle East/Asia use CanMEDS. Map AcuDx domains → Roles. CanMEDS 2025 strengthens EDI, patient safety, and data/AI literacy — reflect these as scorable behaviors. |
| **EPAs** (Entrustable Professional Activities) | Units of *professional work* trainees are entrusted to do unsupervised (e.g. "Gather a history and perform an exam", "Recognize a patient requiring urgent care"). Scored on an **entrustment/supervision scale** (Chen/ten Cate O-SCALE, levels 1–5: "observe only" → "unsupervised" → "supervise others") | Whole activity | The natural output unit for a *simulation*: a case exercises specific EPAs. AcuDx should emit an **entrustment estimate per EPA** with evidence, which is exactly what CBME programs want. AAMC Core EPAs for Entering Residency (13 EPAs) are the canonical UME set. |
| **OSCE / clinical-skills rubrics** | Station-level performance: history-taking, physical exam, clinical reasoning, communication, management, professionalism | Item (checklist) + station global rating | The **operational scoring layer**. AcuDx grades each encounter with a checklist + global rating, then aggregates upward into the frameworks above. |

**Sources:** ACGME Milestones Guidebook (acgme.org/globalassets/milestonesguidebook.pdf); ACGME "Assessment Tools and Processes for Collecting Milestones Data" (2022); ABP "Milestones, Competencies, and EPAs" (abp.org); ten Cate, *Nuts and Bolts of EPAs* (PMC3613304).

### 1.2 The AcuDx internal rubric ontology (6 domains)

Score every encounter on these six; everything else is a crosswalk. This mirrors OSCE domains and maps cleanly to all four frameworks.

1. **History-taking** — completeness, structure, targeting, red-flag screening.
2. **Physical exam & investigations** — correct exam requests, appropriate/justified test ordering, cost/radiation stewardship, interpretation.
3. **Clinical reasoning** — differential breadth+prioritization, hypothesis-driven data gathering, diagnostic accuracy, management appropriateness, safety-netting.
4. **Communication** — clarity, empathy, shared decision-making, adaptation to patient variant (geriatric/anxious/low-literacy/non-native).
5. **Management & procedures** — plan correctness, guideline concordance, escalation, prioritization under time pressure.
6. **Professionalism & teamwork** — consent, safety behaviors, role-appropriate conduct, closed-loop communication in multiplayer rooms.

### 1.3 Crosswalk (build this table into the data model, not the prose)

| AcuDx domain | Miller | ACGME competency | CanMEDS Role | Example EPA touched |
|---|---|---|---|---|
| History-taking | Shows How | Patient Care; ICS | Medical Expert; Communicator | "Gather a history & perform exam" |
| PE & investigations | Shows How | Patient Care; Medical Knowledge | Medical Expert | "Prioritize a differential / order tests" |
| Clinical reasoning | Shows How / Does | Patient Care; PBLI | Medical Expert; Scholar | "Recognize patient requiring urgent care" |
| Communication | Shows How | ICS; Professionalism | Communicator; Collaborator | "Obtain informed consent" |
| Management | Shows How / Does | Patient Care; SBP | Medical Expert; Leader | "Enter/discuss orders & prescriptions" |
| Professionalism & teamwork | Shows How | Professionalism; SBP | Professional; Collaborator; Leader | "Collaborate as a member of a team" |

**Decision:** store scores at the **item** level (finest), aggregate deterministically to the 6 domains, then apply versioned crosswalk tables to emit Milestone/CanMEDS/EPA estimates. Crosswalks change (CanMEDS 2025, program-specific Milestones); keep them as data, versioned, not code.

---

## 2. Scoring a roleplay transcript reliably with an LLM

This is the hardest and most consequential part. The literature is blunt: **LLMs are usable as *complementary* graders and proficiency detectors, not standalone replacements** ([arXiv 2501.13957, benchmarking generative AI for OSCE interview scoring](https://arxiv.org/html/2501.13957)). Design accordingly.

### 2.1 Rubric design: checklist + global rating (both, always)

The OSCE psychometric consensus, which AcuDx should copy:

- **Checklist items** = concrete, binary/near-binary observable behaviors ("asked about chest pain radiation", "screened for red-flag headache features", "confirmed allergies before prescribing"). LLMs score these *well*: the benchmarking work found LLMs "performed better on rubric items with concrete behaviors than those requiring nuanced judgment" and that **behavioral anchors** suit automated scoring ([arXiv 2501.13957](https://arxiv.org/html/2501.13957)).
- **Global rating scale (GRS)** = holistic 1–5/1–9 judgments per domain (e.g. "overall clinical reasoning"). GRS carries the *validity* in OSCE research (better construct validity, less checklist-gaming, better at capturing expertise) but is where LLM judgment is weakest and most biased. Weight GRS lower in the composite and never let it swing a pass/fail alone at MVP.
- **Case-specific (bespoke) rubrics.** The frontier method: generate a **per-case rubric of 10–40 criteria** rather than one generic rubric. This is what **HealthBench** does — 262 physicians from 60 countries authored **48,562 unique rubric criteria**, and grading "closely aligns with physician grading" ([OpenAI HealthBench](https://openai.com/index/healthbench/); [HealthBench paper PDF](https://cdn.openai.com/pdf/bd7a39d5-9e9f-47b3-903c-8b847ca650c7/healthbench_paper.pdf)). The 823-encounter case-specific-rubric study reports strong LLM–clinician agreement when rubrics are instance-specific ([arXiv 2604.24710](https://arxiv.org/pdf/2604.24710)). **AcuDx must author a rubric per case as a first-class content artifact**, human-reviewed, versioned — not generate it at grade time.

**Rubric authoring pipeline:** clinician SME drafts case → LLM proposes checklist items + weights + behavioral anchors → SME edits/approves → rubric frozen with a version hash. Grade time uses the frozen rubric; never let the grader improvise criteria.

### 2.2 The grading architecture (structured, decomposed, not "score this 1–100")

Never ask one model for one holistic number. Decompose:

1. **Evidence extraction pass.** For each checklist item, the model returns `{met: bool|partial, evidence_span: <transcript quote>, confidence: 0–1}`. Forcing a **grounded quote** is the single biggest reliability lever — it curbs hallucinated credit and gives the learner an auditable "why".
2. **Structured output** via constrained decoding / JSON schema (tool-call or structured-outputs mode) so every item is machine-checked, not parsed from prose.
3. **Deterministic aggregation.** Domain score = weighted sum of items in code, not by the LLM. The LLM judges *items*; arithmetic is not its job.
4. **GRS pass** per domain, anchored, temperature 0, requested *with* the extracted evidence in context.
5. **Consistency / calibration layer** (see 2.4).

This mirrors HealthBench (many fine-grained criteria, graded individually) and the case-specific-rubric literature, both of which beat monolithic scoring on agreement.

### 2.3 LLM grading bias — name them, mitigate each

Frontier judges fail **50%+ of bias tests**; this is not hypothetical ([Adaline, "Why Frontier Models Fail 50%+ Bias Tests"](https://www.adaline.ai/blog/llm-as-a-judge-reliability-bias)).

| Bias | Effect on AcuDx | Mitigation |
|---|---|---|
| **Position/order bias** | Shuffling inputs dropped judge accuracy 0.879→0.833 and Cohen's κ 0.807→0.639; pairwise flip rates 25–50% ([arXiv 2602.02219](https://arxiv.org/pdf/2602.02219); [arXiv 2606.19544](https://arxiv.org/pdf/2606.19544)) | Use **pointwise item scoring, not pairwise** learner comparisons. Randomize item order; grade items independently. |
| **Verbosity bias** | Chatty, padded learner answers get undue credit; interacts badly with rubrics lacking a length criterion | Score against explicit behavioral anchors; add an explicit "concise/relevant" criterion; strip filler before grading. |
| **Self-preference / family bias** | If the *patient-AI* and the *grader* are the same model family, the grader may under-penalize the encounter's own errors (EMNLP 2025) | **Use a different model family for grading than for the patient agent.** e.g. patient played by one vendor, graded by another; ensemble across ≥2 families for high-stakes items. |
| **Leniency / central-tendency** | Judges drift generous; clusters mid-scale | Calibrate against a human-scored anchor set (2.4); apply a learned monotone recalibration; force use of the full anchor range with worked examples. |
| **Sycophancy / prompt sensitivity** | "Subtle prompt variations influenced outcomes despite zero temperature" ([arXiv 2501.13957](https://arxiv.org/html/2501.13957)) | Freeze grading prompts under version control; regression-test prompt changes against the anchor set before any rollout. |
| **Demographic/language bias** | Training-data communication norms penalize non-native or culturally-different phrasing; pairwise judges show language/fluency bias ([arXiv 2601.13649](https://arxiv.org/pdf/2601.13649)) | Audit score distributions by learner language/demographic on the anchor set; the *patient variant* (low-literacy, non-native) must not leak into *doctor* scoring. |

### 2.4 Reliability & the calibration-against-experts loop (non-negotiable)

Reliability without validity is worthless — a systematic large-scale eval warns LLM judges can be *consistent but invalid* ([arXiv 2606.19544](https://arxiv.org/pdf/2606.19544)). AcuDx needs both, measured continuously.

**Anchor set (gold standard).** Maintain a growing bank of transcripts double- or triple-rated by clinician experts per case. This is the ground truth the LLM grader is measured against. Budget for it; it is the product's moat.

**Reliability targets (adopt as gates):**
- **LLM–expert agreement**: **Cohen's/weighted κ ≥ 0.6** (substantial) per domain before a domain's score is shown; **≥ 0.7** before it can drive a pass/fail. Context: experts agree with LLM judges only ~**64–68%** on genuinely expert tasks ([LLM-as-judge survey](https://www.emergentmind.com/topics/llm-as-a-judge-systems)), and OSCE-benchmark exact accuracy was low (~0.52 for one Claude config) while **thresholded/level-differentiating accuracy hit 0.83–0.88** ([arXiv 2501.13957](https://arxiv.org/html/2501.13957)). **Implication: trust AcuDx scores at the *level/band* granularity (e.g. 4-band Milestone-like), not to the decimal.** Design the UI and XP around bands.
- **Inter-expert agreement (ceiling).** Report human–human κ too; the LLM can't be expected to beat the humans' own disagreement. If experts sit at κ≈0.6, that's the target, not 0.95.
- **Test–retest / self-consistency.** Grade each transcript ≥3× at temp 0 (or with sampled prompts); flag items where the grader disagrees with itself and route them to lower confidence / human review.

**Validity argument (Kane's framework — build the evidence, not just the number):**
- *Scoring*: rubric maps to competency; evidence spans support each item.
- *Generalization*: reliability across cases/raters (κ, Generalizability-theory G-coefficient ≥ 0.7 for consequential decisions).
- *Extrapolation*: AcuDx sim scores correlate with real OSCE / Milestone / in-training-exam performance — **run this validation study explicitly** and publish it; it is the institutional sales asset.
- *Implications*: what decisions the score licenses (formative feedback vs. progression) — keep AcuDx **formative-first**, gate high-stakes use behind stronger evidence.

**Human-in-the-loop by stakes:** formative solo practice → fully automated, banded, with "flag for review". Anything feeding a transcript/progression decision → **human co-sign** on the LLM score. This is also the defensible posture for regulators and program directors.

---

## 3. The calibration plot (self-rated confidence vs measured competence)

The Dunning-Kruger visualization is a signature AcuDx feature — and a demotivation landmine. Get the metrics and the framing right.

### 3.1 Elicit confidence *before* the reveal

- Ask the learner to **self-rate confidence per domain (0–100%) immediately after the encounter, before seeing the score.** Post-hoc confidence is contaminated.
- Also elicit **item-level confidence on key decisions** ("How sure is your leading diagnosis?") so you can compute proper scoring-rule metrics, not just a domain-level gestalt.
- The DK effect is real and measured in this exact population: first-semester medical students show it strongly ([PMC11515314](https://pmc.ncbi.nlm.nih.gov/articles/PMC11515314/)); EM residents' predicted vs actual ABEM in-training scores show it too ([PubMed 39463809](https://pubmed.ncbi.nlm.nih.gov/39463809/)). Bottom-quartile learners over-estimate most; top performers slightly under-estimate. AcuDx's job is to *shrink* that gap over time and show it shrinking.

### 3.2 Metrics (compute all; show few)

| Metric | What it captures | Use in AcuDx |
|---|---|---|
| **Brier score** (mean squared error between stated confidence and 0/1 correctness) | Overall calibration quality; lower is better | Headline calibration number per session; track its downward trend. Decompose (Murphy) into **calibration + refinement/resolution** so you can tell "badly calibrated" from "can't discriminate". |
| **Over/Under-Confidence Index (OCI)** = mean(confidence) − mean(accuracy) | *Direction* and *size* of bias; signed | The DK signal itself. Positive = overconfident (the dangerous kind clinically). Show as a single signed gauge per domain. |
| **Calibration curve / reliability diagram** | Confidence bin vs observed accuracy vs the 45° line | The actual "Dunning-Kruger plot". Bin item-confidences; plot observed accuracy per bin; overlay identity line. |
| **ECE (Expected Calibration Error)** | Weighted average gap across bins | Secondary scalar; good for dashboards and trend lines. |
| **Discrimination / resolution** | Can the learner tell their right answers from wrong? | Guards against the trap of "well-calibrated because uniformly unsure". |

Brier and ECE are the standard calibration pair (lower = better); OCI/Brier/reliability-diagram are the established triad for self-confidence calibration ([survey on LLM honesty, arXiv 2409.18786](https://arxiv.org/pdf/2409.18786); [PMC12818272 on Brier-score misconceptions](https://pmc.ncbi.nlm.nih.gov/articles/PMC12818272/)).

### 3.3 Present it usefully, without demotivating

The measured competence axis is itself banded (§2.4), so **plot bands + uncertainty, never false-precision points.**

- **Frame as a skill to train, not a verdict.** Label the plot "Calibration — how well your confidence matches your performance", and celebrate *improving calibration* as its own XP-worthy achievement, independent of raw competence. A learner who is honestly aware they're weak is doing something valuable.
- **Quadrant framing** (confidence × competence): "Calibrated-strong", "Calibrated-growing", "Blind spot (overconfident)", "Hidden strength (underconfident)". The clinically dangerous quadrant (overconfident-incompetent) gets *supportive*, specific "here's the one thing to check next time" language — never a red "you're dangerous" banner.
- **Show trajectory, not just today.** A shrinking OCI / falling Brier over the last N sessions is the motivating story. First-timers *will* be overconfident; that's the population baseline, so normalize it explicitly ("most learners start here").
- **Per-domain, so it's actionable.** "Your reasoning is well-calibrated; your ECG interpretation confidence runs ahead of performance" is useful; a single global "you're overconfident" is demoralizing and vague.
- **Never rank calibration on public leaderboards.** Calibration is private, formative, ego-fragile. Public exposure would incentivize gaming (sandbagging confidence).

---

## 4. Gap analysis → remediation, spaced repetition, mastery, adaptive difficulty

The score is diagnosis; this is treatment. The transcript-level evidence spans (§2.2) make gap analysis nearly free — every unmet checklist item *is* a gap with a quote attached.

### 4.1 Gap analysis

- Roll unmet/partial items into **domain gaps** and **specific missed behaviors** ("did not safety-net", "anchored on first diagnosis", "no allergy check before prescribing"). Each gap carries: evidence span, competency-framework tag, severity (safety-critical vs. quality), and frequency across the learner's history.
- **Safety-critical misses** (missed red flag, dangerous order, no consent) are surfaced separately and always, regardless of overall score — a 90% encounter that missed a STEMI is a fail on the thing that matters.

### 4.2 Remediation → spaced repetition + mastery learning

- **Spaced repetition** for *knowledge* gaps: the concept/decision behind a miss becomes a scheduled review item on an SM-2/FSRS-style interval (FSRS is the current best-in-class free scheduler as of 2026). Missed a Wells-score step → it resurfaces at expanding intervals until stably correct.
- **Mastery learning** for *skills* gaps: don't advance the learner past a competency until they hit a **pre-set mastery threshold** across repeated encounters (mastery learning's defining feature: fixed standard, variable time). Concretely: "reach entrustment ≥4 on 'recognize urgent patient' across ≥3 distinct cases" before that EPA is marked provisionally met. Mastery-based simulation shows strong effect sizes in the medical-education literature; adopt its structure.
- **Deliberate-practice targeting:** the next recommended case is chosen to exercise the learner's *widest current gap*, not random — turning practice into targeted reps.

### 4.3 Adaptive difficulty

- Adapt on **two axes independently**: *case complexity* (comorbidity, atypical presentation, diagnostic ambiguity, time pressure) and *patient-agent difficulty* (aggressive, low-literacy, non-native, cognitively impaired — these tax communication, not reasoning).
- Target a **desirable-difficulty success rate ~70–85%** (challenge without demoralization; the "flow channel"). If a learner passes too easily, raise complexity; if they're failing safety items, drop back and rebuild.
- Feed the **calibration signal into adaptation**: overconfident learners get cases specifically designed to surface their blind spots (an atypical presentation of the thing they think they've mastered) — the most efficient way to correct DK.

---

## 5. Gamification that helps (not harms) learning

Evidence is mixed-to-positive on engagement but **specifically warns on competition/leaderboards.**

**What the evidence says (July 2026):**
- Gamification improves engagement, motivation, clinical reasoning, technical performance, communication, and self-regulation across reviews ([scoping review on gamification for clinical reasoning, PMC11938692](https://pmc.ncbi.nlm.nih.gov/articles/PMC11938692/); systematic review 2020–2025).
- **But competitive gamification can backfire in healthcare:** a randomized cross-over trial found leaderboards/competition *undermined* learning, raised stress, and discouraged collaboration; experts warn lower-ranked students demotivate, especially when gaps are large ([Delphi study, PMC10778414](https://pmc.ncbi.nlm.nih.gov/articles/PMC10778414/); leaderboard RCT NCT06254547). Classic finding: points/levels/leaderboards can dent *intrinsic* motivation if they crowd out mastery goals.

**AcuDx gamification rules (design constraints):**

| Mechanic | Verdict | Rule |
|---|---|---|
| **XP / levels** | Keep | Tie XP to **mastery and improvement** (closing gaps, improving calibration), not raw score or volume. Reward the *behavior you want*. |
| **Streaks** | Keep, gently | Reward consistent practice; make them *forgiving* (freezes) so a missed day doesn't nuke motivation and drive burnout/quitting. |
| **Badges** | Keep | Award for **competency milestones and EPAs entrusted**, mapped to real frameworks — makes them meaningful, not vanity. |
| **Public global leaderboards** | **Avoid by default** | Highest demotivation + collaboration-harm risk; conflicts with clinical teamwork values. |
| **Leaderboards (opt-in, small-cohort, mastery-normed)** | Conditional | If used: opt-in only, within a small peer group, ranked on **personal improvement / calibration**, not absolute rank; never on ego-fragile metrics. Institution may enable per policy. |
| **Collaboration rewards (multiplayer)** | Add | Reward closed-loop communication, good handoffs, team performance — aligns gamification with the clinical value AcuDx is teaching. |

**Principle:** reward **process and mastery, not competition and grinding.** Self-determination theory: support **autonomy** (choice of cases), **competence** (visible mastery progress), **relatedness** (team play) — those sustain intrinsic motivation; leaderboards erode it.

---

## 6. Institution-level learning analytics & competency dashboards

The "dean's office" layer is where AcuDx monetizes assessment. It must speak the institution's frameworks and feed their systems.

**What deans/program directors need:**
- **Cohort competency heatmap**: learners × the 6 domains / Milestones / EPAs, color = attainment band, drill-down to individual → encounter → evidence span. This is the core artifact.
- **Longitudinal trajectories**: competency growth curves per learner and cohort; time-to-mastery per EPA; who's stalled.
- **Milestone rollups** on ACGME's Level 1–5 anchors, ready for the semiannual Clinical Competency Committee — AcuDx as *supplementary evidence* into CCC decisions, not a replacement.
- **Calibration analytics at cohort scale**: which competencies show systematic cohort overconfidence (a curriculum signal — teach it differently).
- **Remediation & at-risk flags**: learners repeatedly missing safety-critical items; automated remediation-plan drafts for faculty review.
- **Gap-to-curriculum mapping**: aggregate misses mapped to curriculum objectives → shows the program *where its teaching is weak*, which is the killer institutional insight.

**Integration & governance (make-or-break for sales):**
- **LMS/SSO**: SAML/OIDC SSO; **LTI 1.3** to embed in Canvas/Moodle/Blackboard; **1EdTech Caliper Analytics / xAPI** to emit learning events to the institution's LRS/warehouse.
- **Framework crosswalks as data** (§1.3), versioned, so one score set renders in ACGME, CanMEDS, or EPA views per institution.
- **Privacy & fairness**: assessment data is sensitive and consequential. FERPA (US)/GDPR (EU) posture; per-institution data residency; role-based access (a dean sees cohorts, not raw private calibration ego-data unless policy permits). **Audit dashboards for score fairness across demographics/language** are mandatory, not optional (§2.3).
- **Human oversight of consequential decisions** baked into the dashboard: any AcuDx signal feeding progression is flagged "requires faculty review".

---

## Key decisions for AcuDx

1. **Score against a fixed 6-domain internal rubric** (history, exam/investigations, reasoning, communication, management, professionalism) and ship **versioned crosswalks** to Miller (position = "Shows How"/"Does"), ACGME Milestones (Level 1–5), CanMEDS (7 Roles, target CanMEDS 2025), and EPAs (entrustment 1–5). Crosswalks are data, not code.
2. **Author a case-specific rubric (10–40 behavioral-anchor checklist items + weights) per case as a human-reviewed, version-hashed content artifact** (HealthBench model: 262 physicians, 48,562 criteria; grading tracks physician grading). Never let the grader improvise criteria at run time.
3. **Grade with a decomposed, structured pipeline**: per-item `{met, evidence_span, confidence}` with a **forced transcript quote**, deterministic code-side aggregation, a lower-weighted anchored global rating, temp 0, structured/JSON output. Item judgment to the LLM; arithmetic and pass/fail thresholds to code.
4. **Grade with a different model family than the patient agent**; ensemble ≥2 families on high-stakes items. Mitigate position bias (pointwise not pairwise), verbosity, self-preference/family, leniency, prompt-sensitivity, and demographic/language bias — frontier judges fail 50%+ of bias tests.
5. **Gate on reliability, trust only at band granularity.** Require **weighted κ ≥ 0.6 vs experts** to display a domain score, **≥ 0.7** to drive pass/fail; report inter-expert κ as the ceiling; grade each transcript ≥3× for self-consistency. Exact-score accuracy is low (~0.52) but band/level accuracy is high (~0.83–0.88) — design UI, XP, and dashboards around **4–5 bands, never decimals**. Maintain an expert-rated anchor set as the product's moat; keep AcuDx **formative-first** with human co-sign on consequential scores.
6. **Calibration plot**: elicit per-domain and per-decision confidence **before the reveal**; compute **Brier (decomposed), OCI (signed), reliability diagram, ECE, discrimination**; present as **banded quadrants with a shrinking-gap trajectory**, framed as a trainable skill; normalize first-timer overconfidence; **never put calibration on a public leaderboard**.
7. **Gap analysis is free from evidence spans** → route knowledge gaps to **FSRS spaced repetition**, skill gaps to **mastery learning** (fixed threshold e.g. entrustment ≥4 across ≥3 cases, variable time), surface **safety-critical misses always and separately**, and adapt difficulty on two axes (case complexity vs. patient-agent difficulty) toward a **~70–85% success band**, steering overconfident learners into blind-spot cases.
8. **Gamify process and mastery, not competition**: XP/badges tied to competency milestones, EPAs entrusted, and improving calibration; forgiving streaks; **no public global leaderboards** (RCT evidence: they undermine learning and collaboration in healthcare); reward multiplayer teamwork/closed-loop communication.
9. **Institution layer**: cohort competency heatmaps (learner × domain/Milestone/EPA, drill-down to evidence span), longitudinal trajectories, Milestone rollups feeding CCCs as *supplementary* evidence, cohort calibration signals, gap-to-curriculum mapping; integrate via **SSO (SAML/OIDC), LTI 1.3, xAPI/Caliper**; FERPA/GDPR + role-based access + mandatory demographic/language fairness audit dashboards; human review flag on any progression-feeding signal.
