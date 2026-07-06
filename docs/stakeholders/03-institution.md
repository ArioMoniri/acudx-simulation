# 03 — The Institutional Stakeholder: The Dean's Office and Its Ecosystem

**Scope.** This doc simulates the institutional *buyer/operator* — the "dean's office" and the seven roles that gate an enterprise sale to a medical school, nursing school, teaching hospital, or GME program. For each persona: buying criteria, budget reality, procurement/security path, must-have integrations, the analytics/remediation they need, data-governance demands, and renew-vs-churn triggers. Then the consolidated institutional requirements, the dean-dashboard feature set, and the enterprise-readiness checklist AcuDx must pass before a signature.

**Why this stakeholder is different from the learner.** The learner ([01](./01-learner.md)) *uses* AcuDx and can adopt it bottom-up for $0–$20/mo. The institution *pays for it at scale, owns the liability, and answers to accreditors*. The sales motion is a 6–14 month enterprise cycle with 7+ veto-holders, any one of whom can kill the deal. The product that wins the learner is necessary but nowhere near sufficient to win the institution. This doc is the checklist that turns a viral prototype into a $50k–$500k/yr ARR contract.

**Time context:** July 2026. Version/price/regulatory claims are cited inline.

---

## 1. The buying committee — seven personas

Medical-education software is a *complex B2B2C* sale. The learner is the end user; the institution is the economic buyer; and the buying committee has 7 distinct roles with distinct (sometimes conflicting) incentives. Map every feature and contract term to at least one persona's win condition.

| # | Persona | Cares most about | Kills the deal if... | Typical title(s) |
|---|---------|------------------|----------------------|------------------|
| A | **Dean / Vice-Dean of Medical Education** | Accreditation, reputation, graduate competence, budget ROI | No accreditation-linked evidence; scandal risk | Dean, Vice-Dean UME/GME, Assoc. Dean for Education |
| B | **Med-Ed / Assessment Director** | Validity of assessment, competency mapping, remediation workflow | Assessment isn't defensible / not mapped to a framework | Director of Assessment, Clerkship/Course Director, UME lead |
| C | **Program Coordinator / Administrator** | Rostering, scheduling, day-to-day ops, support load | Manual roster upkeep; no LMS grade passback; poor support | Program Coordinator, Academic Administrator, Sim-Center Manager |
| D | **University IT & Security (CISO/CTO)** | SSO, data residency, breach risk, integration surface | Fails security review; no SSO; opaque subprocessors | CISO, IT Director, Enterprise Architect |
| E | **Procurement / Sourcing** | TCO, contract terms, competitive bids, exit terms | Price opacity; lock-in; no reference customers | Procurement Officer, Sourcing Manager |
| F | **Data Protection Officer (DPO)** | FERPA/GDPR/HIPAA lawful basis, DPA, minimization | No DPA/BAA; unclear AI training use; cross-border transfer | DPO, Privacy Officer, University Counsel |
| G | **Accreditation Liaison** | LCME/ACGME/WFME evidence, competency documentation | Can't produce audit-ready evidence tied to standards | Accreditation Coordinator, CQI Lead |

The **champion** is usually B (Assessment Director) or a passionate course director; the **economic buyer** is A (Dean); the **blockers** are D/E/F (any one is a hard veto). AcuDx must arm the champion to shepherd the deal through the blockers. Design the sales collateral as *ammunition for B to hand to D, E, and F*.

---

## 2. Persona deep-dives

### A. Dean / Vice-Dean of Medical Education — the economic buyer

**What they want.** Accredited program, strong Step/OSCE/board pass rates, defensible graduate competence, national ranking, and a story for the next accreditation visit. They think in *cohorts and outcomes*, not features. They have discretionary budget but many claimants on it.

**Buying criteria (ranked).**
1. **Accreditation leverage** — evidence that maps to LCME/ACGME/WFME standards (§6). This is the #1 lever; frame everything through it.
2. **Outcome signal** — does it move board pass rates, OSCE performance, clinical-reasoning scores? They want a *pilot with a measurable delta* before scaling.
3. **Faculty time saved** — SP (standardized-patient) encounters and OSCE stations cost \$50k+ per mannequin and thousands in SP labor; AI roleplay that offloads formative practice is a hard-dollar and soft-dollar win. (Simulation financing/cost pressure documented in [StatPearls, "Financing and Funding a Simulation Center"](https://www.ncbi.nlm.nih.gov/books/NBK568786/); high-fidelity mannequins "upwards of \$50,000" per [MarketsandMarkets Medical Simulation Software Market](https://www.marketsandmarkets.com/Market-Reports/medical-simulation-software-market-95728725.html).)
4. **Reputation safety** — no clinically wrong guidance reaching students, no data breach, no AI-cheating scandal.
5. **Equity** — remediation for struggling students, reaching learners without SP-center access.

**Budget reality.** Deans control program budgets but med-ed software competes with faculty lines, sim-center capex, and curriculum-management systems. Realistic annual spend for a net-new digital learning platform: **\$25k–\$150k/yr for a mid-size UME cohort (100–200 students/class), up to \$300k–\$500k/yr for a multi-campus system or a school + affiliated GME programs.** Deans rarely find *new* money mid-year; they reallocate at the **fiscal-year boundary (budgets set 6–9 months ahead)** — so a July pilot targets the *next* July's budget. Grant funding (curriculum-innovation, HRSA, foundation) is a common bridge for year 1.

**Renew vs churn.** Renews if: (1) the accreditation team used the data in a real self-study, (2) there's a visible outcome delta, (3) faculty adoption is >40% of a cohort. Churns if: it became shelfware (learner MAU collapses after the novelty), a competitor bundles it into an existing suite (Elsevier/Amboss/Osmosis-style), or the champion leaves and no one owns it.

### B. Med-Ed / Assessment Director — the champion

**What they want.** Assessment that is *valid, reliable, and defensible* under scrutiny, mapped to a recognized competency framework, with a workflow to catch and remediate struggling learners early. They are the person who will actually run the pilot and evangelize internally.

**Buying criteria.**
1. **Framework mapping.** Every AcuDx encounter and rubric item must map to **Miller's pyramid** (Knows → Knows How → Shows How → Does; AcuDx simulation targets *Shows How*, approaching *Does*), plus **ACGME Core Competencies/Milestones**, **CanMEDS 2025**, and **EPAs (AAMC Core EPAs for entering residency; EPA "entrustment" aligns with Miller's "Does")**. (Frameworks and their integration per [ACGME Milestones Guidebook](https://www.acgme.org/globalassets/milestonesguidebook.pdf); [American Board of Pediatrics — Milestones, Competencies, and EPAs](https://www.abp.org/content/milestones-competencies-and-epas); AAMC [Foundational Competencies for UME, released 2024](https://engage.aamc.org/UME-Competencies-AAMC-ACGME-AACOM).)
2. **Validity evidence.** They will ask for construct validity, inter-rater reliability of AI scoring vs faculty, and defensibility of the Dunning-Kruger calibration plot as a *formative* (not summative/high-stakes) instrument. AcuDx should position AI scoring as **formative + faculty-in-the-loop for anything that touches a grade** — never fully-automated summative decisions (this also keeps it out of EU AI Act "high-risk" automated-assessment classification; §5).
3. **Remediation loop.** Gap analysis → targeted assignment → re-assessment → documented improvement. The *closed loop* is what they present at accreditation.
4. **Faculty control.** Author/edit cases, tune rubrics, override AI scores, blueprint coverage across the curriculum.

**Budget reality.** Usually holds a small program/course budget (\$5k–\$30k) — enough for a pilot, not a school-wide rollout. Their real power is *influence*: they build the business case the Dean signs.

**Renew vs churn.** Renews if the remediation loop demonstrably works and faculty aren't drowning in review. Churns if AI scoring is untrustworthy (over- or under-calls competence), if it can't be mapped cleanly to their framework, or if authoring is too painful to keep case content current.

### C. Program Coordinator / Administrator — the daily operator

**What they want.** It just *works* every day: students are auto-enrolled, grades flow to the gradebook, they can pull a report in two clicks, and support tickets don't land on their desk. They are the most under-served and highest-friction-sensitive persona, and they quietly decide renewals by how much pain the tool causes them.

**Buying criteria.**
1. **Zero-touch rostering.** Auto-provision/deprovision via **SIS/SSO/OneRoster** — never manual CSV upkeep. (OneRoster is the 1EdTech rostering standard; see [1EdTech specifications](https://www.1edtech.org/specifications).)
2. **Grade passback.** **LTI 1.3 Assignment & Grade Services (AGS)** so scores post to Canvas/Moodle/Blackboard/Brightspace gradebooks automatically. (LTI 1.3 AGS enables automatic score return; [1EdTech LTI Advantage Overview](https://www.imsglobal.org/lti-advantage-overview).)
3. **Reporting they can self-serve.** Cohort completion, at-risk flags, exportable to CSV/PDF for faculty meetings.
4. **Support SLA.** Named contact, <1 business-day response, and a status page.

**Budget reality.** No budget authority, but generates the *renewal veto*. A coordinator who spends 4 hours/week fixing rosters will tank the renewal.

**Renew vs churn.** Renews if operational load is near-zero. Churns on repeated roster/gradebook breakage or slow support.

### D. University IT & Security (CISO/CTO) — the hard blocker

**What they want.** Minimal attack surface, standards-based SSO, clear data flows, no surprise subprocessors, and a completed **HECVAT**. They can veto unilaterally and are unmoved by pedagogy.

**Buying criteria / gate.**
1. **SSO first.** **SAML 2.0 and OIDC**, integrate with Shibboleth/InCommon federation, Entra ID (Azure AD), Okta, Google Workspace. SCIM for provisioning. No local passwords for institutional users.
2. **HECVAT.** As of 2026, most R1 research universities require a completed **HECVAT** *regardless* of whether the vendor already holds SOC 2. **HECVAT 4** merged Full/Lite/On-Premise into one unified tool with **321 questions across 7 sections**, aligned to NIST 800-53, HIPAA, PCI DSS, and — new in v4 — **32 questions specifically on AI/ML practices** (model training data, output transparency, generative AI). ([SaltyCloud/Isora GRC — HECVAT Complete Guide 2026](https://www.saltycloud.com/blog/what-is-the-hecvat/); [EDUCAUSE HECVAT](https://www.educause.edu/higher-education-community-vendor-assessment-toolkit).)
3. **SOC 2 Type II.** Requested for independent assurance on critical vendors; HECVAT and SOC 2 are complementary, not substitutes — SOC 2's Privacy criterion is *optional and does not cover FERPA*, which HECVAT's 69-question privacy section does. ([SaltyCloud — HECVAT vs SOC 2](https://www.saltycloud.com/blog/hecvat-vs-soc-2/).)
4. **Data residency & subprocessor transparency.** Named list of every AI model provider and cloud region; EU/UK data-residency option (§F).
5. **Accessibility.** **VPAT + WCAG 2.1 AA** (moving to 2.2 AA). US public institutions face **DOJ ADA Title II deadlines — WCAG 2.1 AA by April 2026 (large entities) / April 2027 (small)** — which puts real procurement weight on accessibility conformance. ([SaltyCloud on WCAG deadlines within HECVAT](https://www.saltycloud.com/blog/what-is-the-hecvat/).)

**Budget reality.** No budget, absolute veto. Every unanswered HECVAT question is a delay of weeks.

**Renew vs churn.** Not a renewal driver per se, but a *breach, an undisclosed subprocessor, or an AI-training-on-student-data revelation* is an instant churn + reputational event.

### E. Procurement / Sourcing — the terms blocker

**What they want.** Defensible TCO, competitive process, clean contract, no lock-in, real references. They convert the Dean's "yes" into a signable contract and often force a bid or a discount.

**Buying criteria.**
1. **Transparent, predictable pricing.** Per-seat or per-cohort with a cap; no usage-metered surprises (AI token cost is AcuDx's, not theirs to worry about — bake it into the seat price; see [08 cost model](../architecture/08-cost-model.md)).
2. **Contract terms.** Data ownership by the institution, exit/data-export clause, price-protection on renewal (cap at CPI or ~5%), termination for convenience, SLA with credits.
3. **Competitive justification.** References from 2–3 peer institutions; ideally on a **cooperative purchasing vehicle** (e.g., E&I Cooperative, Internet2 NET+) to skip a full RFP.
4. **Sole-source or RFP path.** Deals >~\$50k–\$100k often trigger an RFP unless there's a cooperative contract or documented sole-source justification.

**Budget reality.** Enforces the budget the Dean set; extracts multi-year discounts (typical 10–20% for a 3-year prepay).

**Renew vs churn.** Renews on clean TCO and no billing disputes. Churns if a competitor undercuts on a cooperative contract or if renewal price jumps.

### F. Data Protection Officer / Privacy — the legal blocker

**What they want.** A lawful basis for every data flow, a signed **DPA** (and **BAA** if any PHI touches the system), data minimization, and an ironclad answer to "do you train models on our students' data?" (The answer AcuDx must give: **no training on institutional/learner data by default; contractual guarantee.**)

**Buying criteria / gate.**
1. **US: FERPA.** Learner records are education records. AcuDx operates as a **"school official" under FERPA's exception** — requires the institution to have direct control, legitimate educational interest, and no redisclosure. FERPA-specific handling lives in HECVAT's privacy section, *not* SOC 2. ([episki — SOC 2 for EdTech 2026](https://episki.com/now/soc2-for-education); [thesoc2 — EdTech compliance 2026: FERPA, COPPA, SOC2](https://www.thesoc2.com/post/edtech-compliance-2026-ferpa-coppa-and-soc2-requirements-explained).)
2. **EU/UK: GDPR + AI Act.** DPA under Art. 28 (AcuDx = processor; institution = controller), Standard Contractual Clauses for any transfer, and a **DPIA** because education + potentially large-scale profiling is high-risk under GDPR. **EU AI Act caveats (critical, see §5):** *emotion-recognition in education is a prohibited practice, effective since February 2025* — AcuDx must **not** infer learner emotional state for assessment. High-risk classification for education-assessment AI applies, with obligations deferred under the Digital Omnibus (adopted 19 Nov 2025; Council final green light 29 June 2026) to **2 December 2027 for stand-alone Annex III systems**. ([European Commission AI Act](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai); [Gibson Dunn — EU AI Act Omnibus, postponed high-risk deadlines](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/); [artificialintelligenceact.eu Annex III](https://artificialintelligenceact.eu/annex/3/).)
3. **HIPAA.** If AcuDx is used with *real* patient data (unlikely for pure roleplay, but affiliated-hospital deployments may cross this line) → BAA required. Default posture: **all patient content is synthetic; no PHI ingested** — this keeps HIPAA out of scope, a major simplifier. Flag any feature that would change this.
4. **Retention & deletion.** Defined retention schedule, learner right-to-deletion (GDPR Art. 17), and hard-delete on contract exit.

**Budget reality.** No budget, absolute legal veto. A missing DPA template stalls the deal for a month of legal back-and-forth.

**Renew vs churn.** Churns instantly on any privacy incident, discovery of undisclosed AI training on their data, or a regulator inquiry.

### G. Accreditation Liaison — the evidence blocker

**What they want.** Audit-ready evidence that graduates achieve required competencies, tied to specific accreditation elements, exportable for the self-study and site visit. LCME/ACGME visits are scheduled years out (e.g., site visits in AY 2025–2026 per [FIU](https://medicine.fiu.edu/about/accreditation/lcme-cqi/) and [Weill Cornell / UIC](https://comedaffairs.uic.edu/resources/lcme-accreditation/)) and the school assembles evidence continuously.

**Buying criteria.**
1. **Standards mapping.** Evidence tagged to LCME elements (e.g., 6.x educational program objectives/competencies, 8.x curricular management, 9.x assessment), ACGME Common Program Requirements, WFME, and the AAMC Foundational Competencies.
2. **Longitudinal cohort tracking.** Show competency attainment over time, remediation outcomes, and CQI (continuous quality improvement) loops closing.
3. **Exportable evidence packages.** One-click "accreditation export" — de-identified cohort competency reports, curriculum-map coverage, assessment-blueprint alignment.

**Budget reality.** No budget; enormous influence on the Dean because accreditation is existential. If AcuDx *materially helps the self-study*, the Dean will find the money.

**Renew vs churn.** This is the strongest *renewal* lever in the whole committee — if AcuDx data appeared in a successful accreditation cycle, the renewal is nearly automatic.

---

## 3. Must-have integrations (the technical gate)

Institutions will not deploy anything that isn't standards-based and roster-integrated. This is table stakes, not differentiation.

| Layer | Standard / product | Requirement | Priority |
|-------|--------------------|-------------|----------|
| **LMS embedding** | **LTI 1.3 Core + LTI Advantage** (Deep Linking 2.0, AGS 2.0, NRPS 2.0) | Launch AcuDx inside Canvas/Moodle/Blackboard/Brightspace; deep-link cases; post grades; read roster/roles | **P0** |
| **LTI certification** | 1EdTech LTI Advantage Complete | Listed in the [1EdTech public product registry](https://site.imsglobal.org/certifications). Canvas itself certified LTI v1.3 platform on 2025-07-01. LTI 1.1 is deprecated. | **P0** |
| **SSO** | **SAML 2.0** (Shibboleth/InCommon) **+ OIDC** | Federated login; Entra ID, Okta, Google Workspace; no local passwords for inst. users | **P0** |
| **Provisioning** | **SCIM 2.0** and/or **OneRoster 1.2** | Auto create/suspend/delete users and section membership | **P0** |
| **SIS** | OneRoster / Ellucian Banner, Workday Student, PeopleSoft | Enrollment & section sync (often via the LMS, not direct) | **P1** |
| **Gradebook** | LTI AGS 2.0 | Formative scores + optional summative passback with faculty gate | **P0** |
| **Learning analytics** | **Caliper Analytics 1.2** (primary) and/or **xAPI** | Emit standardized learning events to the institution's LRS/LMS analytics. Caliper and xAPI are "horses for courses," not equivalent — support Caliper for LMS-native analytics, xAPI where the institution runs an LRS. ([1EdTech Caliper](https://www.1edtech.org/standards/caliper); [IMS xAPI/Caliper comparison](https://www.imsglobal.org/initial-xapicaliper-comparison).) | **P1** |
| **Accessibility** | VPAT 2.5 / WCAG 2.2 AA | Conformance report for procurement | **P0** |

**Recommendation.** Build **LTI 1.3 Advantage as the primary integration surface** — it delivers SSO (via LTI's OIDC launch), roster (NRPS), deep-linked content, and grade passback in one certified package, and it's the single most-requested item from personas C and D. Add **standalone SAML/OIDC** for institutions that want AcuDx outside the LMS, and **Caliper** for analytics-mature institutions. Pursue **1EdTech LTI Advantage Complete certification** early — it's a checkbox on every RFP and a trust signal to IT.

---

## 4. Cohort / competency analytics & remediation reporting

This is the *product* the institution actually buys — the learner-facing sim is the delivery mechanism; the **analytics and remediation layer is the institutional value.** (Learner-facing feedback/calibration is in [02 feedback](../design/) / [assessment design]; this section is the *aggregate institutional view*.)

**What each persona needs from analytics:**

- **Dean (A):** one-screen cohort health — % of class at/above expected competency, trend vs last cohort, remediation throughput, and a headline outcome metric (e.g., correlation of AcuDx activity with OSCE/Step scores once data exists).
- **Assessment Director (B):** competency-by-competency heatmap across the cohort mapped to the framework; item analysis (which rubric items discriminate); reliability stats; and the **Dunning-Kruger calibration distribution** aggregated across the cohort (are our learners systematically over-confident on X?).
- **Coordinator (C):** completion tracking, at-risk list, exportable reports.
- **Accreditation Liaison (G):** longitudinal competency attainment tied to standards, remediation-loop closure evidence, curriculum-map coverage.

**The remediation reporting loop (the money feature):**
1. **Detect** — learner falls below competency threshold on an EPA/competency, or shows a large confidence-competence gap (calibration miss).
2. **Diagnose** — gap analysis names the specific missed items (e.g., "did not order/interpret troponin in ACS," "missed FAST in trauma primary survey"), mapped to competencies.
3. **Prescribe** — auto-assign targeted cases/guidance addressing the gap.
4. **Re-assess** — repeat encounter; measure delta.
5. **Document** — closed-loop record the Assessment Director and Accreditation Liaison can export.

**Analytics data-governance requirement:** aggregate/cohort views must support **de-identified export**; individual learner records stay under FERPA "school official" control; no cross-institution benchmarking that leaks one school's data to another without explicit contract terms. Emotion/affect must **never** be an analytics dimension (EU AI Act prohibition, §5).

---

## 5. Data governance & AI-specific requirements (2026 reality)

The AI layer is what makes AcuDx powerful *and* what makes it a harder sale than a static LMS tool. Every persona D/F/G question now has an "…and what about the AI?" follow-up. Non-negotiables:

1. **No training on institutional or learner data by default.** Contractual guarantee. This is the single most common AI question on 2026 HECVATs (the new 32-question AI/ML section) and DPO reviews. Offer an opt-in, per-institution, contractually-scoped fine-tuning arrangement only if the institution asks and consents.
2. **Subprocessor transparency.** Name every foundation-model provider and region (see [06 model routing](../architecture/) for the actual model mix). Institutions in the EU/UK will demand EU-region inference or a compliant transfer mechanism. Support a **"no-third-party-model / EU-hosted-open-weights"** deployment tier for privacy-maximal buyers.
3. **Emotion recognition is prohibited in education (EU).** Effective **February 2025**. AcuDx must not infer or assess learner *emotional state* as an evaluated dimension. (Roleplaying an *anxious patient* is fine — that's the AI performing an emotion, not the system reading the learner's emotion for assessment.) ([artificialintelligenceact.eu high-level summary](https://artificialintelligenceact.eu/high-level-summary/).)
4. **Automated assessment = high-risk under EU AI Act Annex III.** Education systems that determine access, evaluate learning outcomes, or assess students are high-risk. Obligations (risk-management system, data governance, technical docs, logging, **human oversight**, accuracy/robustness) apply — deadline deferred to **2 Dec 2027** for stand-alone Annex III systems under the Digital Omnibus. **Mitigation: keep AI scoring formative and faculty-in-the-loop for anything summative** — a human makes the entrustment/grade decision, which materially reduces high-risk exposure and is the safer pedagogy anyway. Fines for a non-compliant high-risk system: **up to €15M or 3% of global turnover.** ([Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/); [EU AI Act penalties](https://artificialintelligenceact.eu/high-level-summary/).)
5. **Grounded guidance = clinical-safety governance.** The AMBOSS-like guidance mode must be versioned, country-specific, evidence-linked, and clearly labeled *educational, not clinical advice* — with a documented review process. (See [guidance grounding](../architecture/) doc.) Deans and legal will ask "what if the AI tells a student the wrong drug dose and they carry it to a real patient?" — the answer is provenance, versioning, disclaimers, and no PHI. This is a **clinical-safety** review dimension IT-security reviews don't cover; expect medical-director sign-off at academic-medical-center buyers.
6. **Data minimization, retention, deletion.** Retention schedule in the DPA; GDPR Art. 17 deletion; hard-delete + certificate on contract exit; encryption at rest and in transit (baseline, but they will ask).

---

## 6. Accreditation & competency-framework mapping (the differentiation)

Mapping AcuDx to accreditation is the single strongest institutional lever (persona A + G). Ship a **first-class competency-mapping layer**, not an afterthought.

- **Miller's Pyramid** — AcuDx roleplay sits at **Shows How** and, with realistic decision consequences, approaches **Does** — a stronger claim than MCQ tools (which sit at Knows/Knows How). Say this explicitly in sales collateral. ([Miller's pyramid alignment with "Does" via EPAs](https://www.abp.org/content/milestones-competencies-and-epas).)
- **ACGME Core Competencies + Milestones** (Patient Care, Medical Knowledge, Practice-Based Learning, Interpersonal & Communication Skills, Professionalism, Systems-Based Practice) — map each rubric item; support GME programs directly. ([ACGME Milestones Guidebook](https://www.acgme.org/globalassets/milestonesguidebook.pdf).)
- **CanMEDS 2025** (Medical Expert, Communicator, Collaborator, Leader, Health Advocate, Scholar, Professional) — for Canadian/CanMEDS-aligned schools internationally.
- **EPAs** — AAMC Core EPAs for Entering Residency; specialty EPAs. Entrustment maps to Miller's "Does." Frame AcuDx encounters as EPA-practice with entrustment-scale feedback. ([ABP](https://www.abp.org/content/milestones-competencies-and-epas).)
- **AAMC Foundational Competencies for UME** (released 2024) — the current US UME reference; map to it. ([AAMC](https://engage.aamc.org/UME-Competencies-AAMC-ACGME-AACOM).)
- **LCME elements** — tag evidence to specific elements (6.x objectives/competencies, 8.x curricular management, 9.x assessment). This is what the Accreditation Liaison exports.
- **WFME / country-specific** — for the international market (GMC in the UK, national frameworks).

**Recommendation.** Build competency mapping as **configurable per-institution taxonomy** (they map to their own version) with **prebuilt mappings for ACGME, CanMEDS, AAMC EPAs, and LCME** out of the box. This turns "another sim tool" into "our accreditation evidence engine."

---

## 7. The Dean-Dashboard feature set

The institutional admin surface. Role-scoped so each persona sees their view. Prioritized P0/P1/P2.

**Cohort & competency analytics (the core)**
- **P0** Cohort competency heatmap — mapped to the institution's framework; drill from cohort → section → learner (role-gated).
- **P0** At-risk / remediation dashboard — flagged learners, gap analysis, remediation status, closed-loop tracking.
- **P0** Completion & engagement — per-assignment, per-cohort, MAU/WAU trends (the leading indicator of renewal health).
- **P1** Aggregate **calibration (Dunning-Kruger) view** — cohort confidence-vs-competence distribution; identify systematic over/under-confidence by topic.
- **P1** Outcome correlation — link AcuDx activity to OSCE/Step/board results once institution shares outcomes (drives renewal ROI story).

**Accreditation & reporting**
- **P0** One-click **accreditation export** — de-identified competency-attainment reports tagged to LCME/ACGME/WFME elements; curriculum-map coverage; assessment-blueprint alignment; CSV/PDF/Excel.
- **P1** Longitudinal cohort tracking across years; CQI loop documentation.

**Curriculum & content control**
- **P0** Case/scenario authoring & editing — faculty create cases, tune rubrics, blueprint coverage across competencies.
- **P0** Rubric & competency-mapping editor — map rubric items to the institution's taxonomy.
- **P1** Content library & sharing — institutional case bank; optional cross-institution marketplace (opt-in).

**Administration**
- **P0** Roster/section management via SIS/LTI/OneRoster; role assignment (learner/faculty/coordinator/admin).
- **P0** RBAC — role-scoped data access enforcing FERPA "need to know."
- **P0** Assignment & scheduling — assign cases to cohorts, deadlines, grade passback config.
- **P1** SSO/SCIM config console; audit log of admin actions.

**Governance & trust**
- **P0** Audit log — who accessed what data when (FERPA/GDPR accountability).
- **P0** Data-export & deletion tools (self-serve on contract exit).
- **P1** AI-transparency panel — which models, guidance-source versions, disclaimers, human-in-the-loop settings.

**Design note.** The dashboard is where AcuDx earns its price. The learner app can be beautiful and viral; if the Dean's dashboard can't produce an accreditation export and an at-risk list, the institution won't pay. Invest here as heavily as in the learner UI. See [design docs](../design/) for the institutional-admin UX; keep it role-scoped, exportable, and boring-reliable.

---

## 8. Enterprise-readiness checklist (the deal gate)

The concrete list AcuDx must pass. Grouped by blocker persona; each item is a potential veto.

### Security & IT (persona D)
- [ ] **SSO:** SAML 2.0 (Shibboleth/InCommon) + OIDC; Entra ID/Okta/Google Workspace tested
- [ ] **Provisioning:** SCIM 2.0 and/or OneRoster 1.2 auto de/provisioning
- [ ] **LTI 1.3 Advantage Complete** — certified & listed in 1EdTech registry
- [ ] **HECVAT 4** completed (all 321 questions, incl. 32-question AI/ML section) and kept current
- [ ] **SOC 2 Type II** report available under NDA
- [ ] **Penetration test** (annual, third-party) summary available
- [ ] **Encryption** at rest (AES-256) + in transit (TLS 1.2+); documented key management
- [ ] **Data residency** options incl. EU/UK region; named subprocessor + model-provider list
- [ ] **Uptime SLA** (target ≥99.9%) with credits; public status page
- [ ] **Incident-response** plan + breach-notification commitment (contractual timelines)

### Privacy & legal (persona F)
- [ ] **DPA** template (GDPR Art. 28) ready to sign; **BAA** available if PHI ever in scope (default: no PHI)
- [ ] **FERPA "school official"** posture documented; no redisclosure; institution retains control
- [ ] **No training on institutional/learner data** — contractual guarantee
- [ ] **DPIA** support materials; SCCs for cross-border transfer
- [ ] **EU AI Act:** no emotion recognition of learners; formative + human-in-loop for summative; high-risk readiness for the 2 Dec 2027 deadline (risk-mgmt system, data governance, logging, human oversight, technical docs)
- [ ] **Retention/deletion:** schedule defined; GDPR Art. 17 deletion; hard-delete + certificate on exit

### Accessibility (personas D + F)
- [ ] **VPAT 2.5** + **WCAG 2.2 AA** conformance report (2.1 AA minimum; meet DOJ ADA Title II April 2026/2027 timelines)

### Assessment validity & accreditation (personas B + G)
- [ ] Competency mapping: **ACGME, CanMEDS 2025, AAMC EPAs, LCME elements** out-of-the-box + configurable taxonomy
- [ ] Validity evidence: AI-vs-faculty scoring reliability study; positioned formative
- [ ] Remediation closed-loop with documented outcomes
- [ ] One-click accreditation export

### Operations (persona C)
- [ ] Zero-touch rostering + LTI AGS grade passback verified in Canvas/Moodle/Blackboard/Brightspace
- [ ] Named support contact, <1 business-day SLA, admin docs, onboarding/training
- [ ] Self-serve reporting (CSV/PDF export)

### Commercial (persona E)
- [ ] Transparent per-seat/per-cohort pricing with renewal price protection (cap ≈ CPI or 5%)
- [ ] Data-ownership + export + termination-for-convenience clauses
- [ ] 2–3 peer-institution references
- [ ] Cooperative-purchasing vehicle (E&I / Internet2 NET+) or sole-source/RFP path ready
- [ ] Multi-year discount structure (e.g., 10–20% for 3-year prepay)

### Clinical safety (academic medical centers)
- [ ] Guidance mode: versioned, country-specific, evidence-linked, "educational-not-clinical" labeled; medical-director review process; no PHI

---

## 9. Renew-vs-churn summary

| Renews when… | Churns when… |
|--------------|--------------|
| Data appeared in a **successful accreditation cycle** (strongest lever) | **Privacy/security incident** or undisclosed AI-training on their data |
| Visible **outcome delta** (OSCE/board correlation) | Became **shelfware** — learner MAU collapsed after novelty |
| **Remediation loop** demonstrably closes | **Roster/gradebook breakage** buries the coordinator |
| Faculty adoption **>40%** of cohort | **Champion left** and no one owns it |
| Coordinator operational load **near-zero** | **AI scoring untrustworthy** — over/under-calls competence |
| Clean TCO, **no billing disputes** | Competitor **bundles equivalent** into an incumbent suite at lower TCO |

**Strategic implication:** the renewal is won by the *institutional* layer (accreditation evidence, remediation outcomes, operational smoothness), not the learner sizzle. Land with the learner-loved product; expand and renew on the dean-office value. Budget product investment accordingly: the learner app gets you in the door, the dean dashboard keeps you.

---

## Key decisions for AcuDx

1. **LTI 1.3 Advantage Complete is the P0 integration surface and must be 1EdTech-certified** — it delivers SSO (OIDC), roster (NRPS), deep-linked content, and grade passback (AGS) in one certified package that appears on every RFP; LTI 1.1 is deprecated. Add standalone SAML 2.0 (Shibboleth/InCommon) + OIDC + SCIM/OneRoster for non-LMS deployments.
2. **Keep AI scoring formative and faculty-in-the-loop for anything summative.** A human makes every entrustment/grade decision. This is safer pedagogy *and* materially reduces EU AI Act "high-risk" (Annex III) exposure — obligations deferred to **2 Dec 2027** under the Digital Omnibus; fines up to €15M / 3% turnover.
3. **Absolute AI-data rules:** no training on institutional/learner data by default (contractual); named subprocessor + model-provider list; EU-region/EU-hosted-open-weights deployment tier; and **never infer learner emotional state for assessment** (prohibited in EU education since Feb 2025). Default posture: **synthetic patients only, no PHI ingested** — keeps HIPAA out of scope.
4. **The dean dashboard is the product institutions actually buy** — cohort competency heatmap, at-risk/remediation closed-loop, aggregate Dunning-Kruger calibration, and **one-click accreditation export** tagged to LCME/ACGME/CanMEDS/AAMC-EPA elements. Invest here as heavily as in the learner app; it drives renewal.
5. **Ship competency mapping as a first-class, configurable layer** with prebuilt ACGME Milestones, CanMEDS 2025, AAMC Core EPAs, and LCME element mappings out of the box. Position AcuDx at Miller's **"Shows How → Does,"** stronger than MCQ tools. Accreditation leverage is the #1 buying and #1 renewal lever.
6. **Pass the enterprise gate before the pitch:** complete **HECVAT 4** (321 questions incl. the 32-question AI/ML section), hold **SOC 2 Type II**, ship a **VPAT/WCAG 2.2 AA** report (DOJ ADA Title II deadlines April 2026/2027), and have DPA/BAA templates ready. Any one missing = weeks of delay or a veto.
7. **Price transparently per-seat/per-cohort with a cap** — realistic **\$25k–\$150k/yr** for a 100–200/class UME cohort, up to **\$300k–\$500k/yr** for multi-campus/GME systems; absorb AI token cost into the seat price (never usage-meter the institution). Offer 10–20% multi-year prepay discounts and pursue cooperative-purchasing vehicles (E&I, Internet2 NET+) to bypass full RFPs. Deals >~\$50k–\$100k trigger RFPs.
8. **Sell to the committee, not the user:** arm the Assessment Director (champion) with ammunition for the Dean (economic buyer) to clear IT/Procurement/DPO/Accreditation (blockers, any one a veto). Fiscal-year budget boundaries mean a July pilot targets *next* July's budget — plan the 6–14 month enterprise cycle accordingly.
