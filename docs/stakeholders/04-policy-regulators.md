# 04 — Policy, Regulators & Accreditation Stakeholders

**Scope:** How accreditation bodies, health/education ministries, IRBs/ethics boards, patient-safety/clinical-governance officers, and medical-defense/liability actors will judge AcuDx — an AI-driven roleplay/simulation platform for clinical training and (optionally) assessment. What each requires, what each fears, the evidence they will demand, the data/consent rules, the red lines, and how AcuDx turns compliance into a **regulatory moat**.

**Framing decision (load-bearing):** AcuDx is an **educational simulation and formative-assessment tool**, not a clinical decision-support device and not a standalone summative examiner. This classification determines almost everything below. Where AcuDx crosses into (a) high-stakes assessment (pass/fail, progression, licensure) or (b) giving clinical advice to a real patient, it enters heavily-regulated territory. The strategy is to **stay formative + human-in-the-loop by default**, and to make the summative path an *opt-in, evidence-gated, institution-owned* configuration.

**Regulatory reality as of July 2026 — the two clocks you must watch:**
- **EU AI Act:** GPAI-model obligations already in force (Aug 2025); **high-risk obligations for Annex III systems apply from 2 Aug 2026**, with certain education use-cases extending to **2 Dec 2027**. AI systems that "evaluate learning outcomes," "determine access/admission," or "monitor and detect prohibited behaviour during tests" are **explicitly listed as high-risk (Annex III §3)**. Sources: [EU AI Act – Annex III](https://artificialintelligenceact.eu/annex/3/), [High-level summary](https://artificialintelligenceact.eu/high-level-summary/), [EU AI Act for Education guide](https://planbe.eco/en/blog/eu-ai-act-for-the-education-industry/).
- **US FDA CDS:** Jan 2026 FDA final/updated guidance re-affirms the 21st Century Cures Act "Non-Device CDS" carve-out (FDCA §520(o)(1)(E)), pivoting on whether a licensed professional can **independently review the basis** of any recommendation. Educational simulation with a synthetic patient is outside the device definition — *as long as AcuDx never outputs advice for a real patient.* Sources: [FDA CDS guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software), [Arnold & Porter, Jan 2026](https://www.arnoldporter.com/en/perspectives/advisories/2026/01/fda-cuts-red-tape-on-clinical-decision-support-software).

---

## 1. Accreditation bodies (LCME, ACGME, GMC, WFME, national councils)

### Persona — "Dr. Ellen Okafor, Associate Dean for Assessment & LCME/WFME self-study lead"
Runs the school's accreditation cycle. Answerable to site visitors who ask: *does every assessment that affects a student's progression have defensible validity evidence and human sign-off?* She is enthusiastic about simulation but terrified of an AI tool silently becoming a de-facto examiner without validity evidence — that is a citable deficiency.

### What they require
- **Constructive alignment:** every AcuDx activity maps to published competencies — **Miller's pyramid** (knows → knows how → shows how → does), **ACGME Core Competencies / Milestones**, **CanMEDS roles**, and **EPAs** (entrustable professional activities). Accreditors don't accept "engagement"; they accept mapped, defensible outcomes.
- **Validity & reliability evidence** for anything scored. The lingua franca is **Kane's validity argument** (scoring → generalization → extrapolation → implications) and **Messick's unified validity**. For OSCE-style stations: inter-rater reliability (κ / ICC), G-coefficient / D-studies, standard-setting (Angoff/borderline-regression), and DIF (differential item functioning) analysis across subgroups.
- **Human oversight of consequential decisions.** The AAMC *Principles for the Responsible Use of AI in and for Medical Education* (v2.0, 31 Jul 2025) and *Principles for Responsible AI in Medical School and Residency Selection* (v2.0, Jul 2025) repeatedly assert AI must **support, not replace, professional judgment**; AI decision tools must face "the same scrutiny applied to other assessment methods." Sources: [AAMC Principles for AI use](https://www.aamc.org/about-us/mission-areas/medical-education/principles-ai-use), [AAMC selection principles](https://www.aamc.org/about-us/mission-areas/medical-education/principles-ai).
- **WFME** moved (2020) to a **principles-based** standards model localized per country; 2025 revised CPD standards landed. WFME expects programs to "keep pace with scientific and technological developments" — which now explicitly includes AI. Source: [WFME Standards](https://wfme.org/standards/).

### What they fear
- An **unvalidated AI grader** deciding who passes — a direct accreditation citation and a lawsuit magnet.
- **Construct-irrelevant variance:** the LLM rewards verbose/keyword-stuffed answers or penalizes non-native-English phrasing, so the score measures fluency, not competence.
- **Automation bias in faculty:** teachers rubber-stamp AI scores, so "human oversight" is theater.
- **Drift:** a silent model/prompt update changes scoring behavior mid-cohort, breaking longitudinal comparability.

### Evidence they'll demand
| Claim AcuDx makes | Evidence required |
|---|---|
| "Our scoring is valid" | Kane argument + criterion validity vs. faculty gold-standard (target **κ ≥ 0.6**, ICC ≥ 0.7 with expert raters) |
| "It's fair" | DIF/subgroup performance by gender, race/ethnicity proxy, native language, disability accommodations; report gaps, not just aggregate accuracy |
| "It's reliable" | Test-retest + generalizability study; **version-locked** scoring model per cohort |
| "It measures the right thing" | Blueprint mapping to EPAs/Milestones; SME content-validity ratings |

### Red lines
1. **AI must not be the sole examiner for any progression/licensure decision** without human review and published validity evidence.
2. **No unversioned model changes** during an assessment window.
3. **No opaque scoring** — the rubric and the AI's evidence for each score must be inspectable by faculty and appealable by students.

### How AcuDx is an ally
- Ship a **validity-study toolkit**: exportable score distributions, rater-agreement dashboards, DIF reports, and a template Kane argument the school can drop into its self-study.
- **Competency-mapping engine** with signed mappings to Miller/ACGME/CanMEDS/EPAs, exportable as evidence.
- **"Formative by default, summative by attestation"**: summative scoring is disabled until an institution admin uploads its standard-setting and signs a human-oversight attestation.

---

## 2. Ministry / Department of Health or Education

### Persona — "Direktör Anja Lindqvist, National Digital-Health & Workforce Standards Unit"
Cares about workforce competence at population scale, sovereignty of citizen/student data, procurement fairness, and not being the minister who greenlit an AI that taught trainees something unsafe. Buys or blocks at national scale.

### What they require
- **Data sovereignty / residency:** health-adjacent + student data stays in-country or in an approved jurisdiction. In the EU this couples GDPR with the AI Act; several ministries mandate national/EU cloud regions.
- **Country-specific clinical grounding.** Guidance content must reflect the *national* guideline (e.g., ATLS has country variants; resuscitation follows ERC vs. AHA vs. national council). A US-defaulted tool is a non-starter for a non-US ministry.
- **Procurement transparency:** conformity documentation, security certification (ISO 27001, and for health, ISO/IEC 42001 AI management system), accessibility (WCAG 2.2 AA / EN 301 549), and often a public-sector algorithmic-transparency record.
- **Equity of access:** works on low-bandwidth, low-end devices; multilingual; doesn't advantage wealthier institutions.

### What they fear
- A foreign vendor exfiltrating a generation of trainees' performance data.
- Teaching **outdated or wrong-country** protocols at national scale.
- Vendor lock-in of the assessment substrate of the national workforce.

### Red lines
- No cross-border transfer of identifiable student/health data without a lawful basis and (EU) an adequacy decision or SCCs + transfer impact assessment.
- Guidance content must be **versioned, sourced, and country-tagged**, or it cannot be deployed for national training.

### How AcuDx is an ally
- **Regional deployment SKUs** (EU/UK/national cloud), data-residency guarantees, and a **model-routing layer** that can pin a national/self-hosted model where sovereignty demands it.
- **Guideline provenance ledger:** every guidance snippet carries {source, publisher, version, country, effective date, retrieval date} and is served from a versioned, human-curated store — never free-form model hallucination.
- Offer a **national-guideline curation partnership** (see moat §6): the ministry co-owns the localized guideline pack.

---

## 3. University ethics board / IRB

### Persona — "Prof. Ravi Menon, IRB Chair (Social & Behavioral)"
Two hats: (1) approving *research* on AcuDx (does the AI improve learning? is the Dunning-Kruger calibration valid?), and (2) the ethics of *using* it on students at all — coercion, secondary use of performance data, psychological risk of aggressive-patient roleplay.

### What they require
- **Informed consent that separates uses:** (a) using AcuDx to learn, (b) using de-identified data for product improvement/model training, (c) using data for research/publication. Each is a *separate, revocable* opt-in. **Consent to core educational function cannot be bundled with consent to train AI on your data.** (GDPR: consent must be freely given, specific, informed; "use consent sparingly, never for core educational functions.") Source: [Secure Privacy — Student data governance](https://secureprivacy.ai/blog/student-data-privacy-governance).
- **Minimization + purpose limitation:** collect only what the pedagogy needs; don't repurpose grades into a training corpus by default.
- **Right to withdraw** without academic penalty; **data-subject rights** (access, erasure, portability).
- **Risk assessment of psychological harm:** aggressive/abusive-patient and pediatric-death scenarios need content warnings, opt-outs, and debrief/support pathways.

### What they fear
- Students **coerced** into being an AI training corpus as a condition of their degree.
- **Function creep**: formative data quietly used for high-stakes decisions or shared with a dean's dashboard that affects standing.
- Re-identification of "de-identified" performance traces.

### Red lines
- **No training on identifiable student data without explicit, unbundled, revocable consent.** Default product-improvement path must use **de-identified or synthetic data**. Options recognized by regulators: de-identify to FERPA standard, obtain explicit consent, use synthetic data, or qualify the vendor as a "school official" under contract. Source: [Secure Privacy](https://secureprivacy.ai/blog/student-data-privacy-governance).
- **No secret capture** — students must be told what is recorded (including voice, if voice mode is on).

### How AcuDx is an ally
- **Consent-as-configuration:** granular, per-purpose consent toggles, logged with timestamps and version of the consent text (event-sourced), producing an IRB-ready audit trail.
- **Two data planes:** an *identified education plane* (institution-owned, never used for training) and a *de-identified/synthetic improvement plane*. Physically separated; training pipelines can only read the latter.
- **Ethics pack:** pre-written IRB protocol templates, DPIA (Data Protection Impact Assessment) template, and content-safety documentation for distressing scenarios (warnings, opt-out, debrief resources).

---

## 4. Patient-safety & clinical-governance officer

### Persona — "Sister Grace Adeyemi, Director of Clinical Governance & Simulation Safety"
Owns the principle that simulation must **improve** real-world safety and never seed unsafe habits. She thinks in incidents, near-misses, and root-cause analysis. Her nightmare: a learner internalizes a wrong dose or a wrong algorithm because the AI "patient" or "senior" said so.

### What they require
- **Clinical content accuracy** verified by named SMEs, versioned, with an error-reporting and rapid-correction loop (analogous to adverse-event reporting). The GMC now frames AI-enabled software/apps as reportable **medical devices** for adverse-incident purposes under *Good Medical Practice 2024*. Source: [GMC — AI and innovative technologies](https://www.gmc-uk.org/professional-standards/learning-materials/artificial-intelligence-and-innovative-technologies).
- **Safety guardrails on generation:** the AI must not invent drug doses, fabricate lethal management, or present hallucinated "guidelines" as fact. Guidance mode must be **retrieval-grounded**, not free-generation.
- **Hallucination / factuality monitoring** with measurable thresholds and human escalation.
- **Clear sim-vs-real boundary:** the platform must never be usable as (or mistaken for) real clinical advice.

### What they fear
- **Negative training:** a plausible-but-wrong AI answer that a learner carries to a real patient.
- **Sycophancy:** the AI agreeing with an unsafe learner plan to be "supportive."
- Undetected content drift after a model update degrades safety silently.

### Red lines
- **No fabricated clinical facts presented as authoritative.** Doses, algorithms, and guideline claims in *guidance mode* must trace to a versioned source.
- **No unsafe advice pathway to a real patient**, ever — hard product boundary and disclaimer.
- Any detected safety-critical error triggers **content quarantine** and notification.

### How AcuDx is an ally
- **Two-tier content architecture:** *(1) grounded layer* — guidance, doses, and guideline claims retrieved from a curated, versioned, SME-signed store (RAG with citation-or-refuse); *(2) roleplay layer* — the LLM improvises patient affect/dialogue but is **constrained from asserting clinical facts** outside the grounded layer. A verifier model + rule checks (dose ranges, contraindications) gate any clinical assertion.
- **Safety telemetry:** log every clinical assertion with its source; run automated factuality/red-team suites on each model/prompt version before promotion; publish a **safety changelog**.
- **Incident pipeline:** in-app "flag unsafe content," triage SLA, root-cause log, and a governance dashboard the officer can audit.

---

## 5. Medical-defense / liability perspective (MDU, MPS, MDDUS; malpractice carriers)

### Persona — "Counsel — Medical Defence Organisation risk & policy lead"
Asks one question: *when this goes wrong, who is on the hook, and is that allocation clear, insured, and documented?* Defense orgs support innovation but insist on transparency to patients, human oversight, and clear accountability. Consensus in 2025 MDO guidance: **if an AI tool errors, the developer is liable for the tool; the clinician remains liable for how they use it** — responsibility is *shared*, so the boundary must be explicit. Sources: [The MDU](https://www.themdu.com/), [MDDUS](https://www.mddus.com/).

### What they require
- **Crisp liability allocation** in contracts: platform warrants the *educational* tool's fitness for purpose; institution/educator owns the *pedagogical use and any progression decision*; neither party's learners are given clinical advice for real patients.
- **Audit trail** sufficient to reconstruct any encounter and any score (who/what/when/which model version/which guideline version).
- **Professional-standards alignment:** transparency to end-users that AI is in use; consent where appropriate (GMC/AAMC echo this).
- **No "off-label" clinical use** — a term of service prohibiting use of AcuDx for real patient care.

### What they fear
- A trainee (or worse, a licensed doctor "just practicing") **acts on AcuDx output for a real patient**, harm follows, and the boundary was fuzzy.
- Undocumented, unversioned AI decisions that can't be defended in a fitness-to-practise hearing or negligence claim.

### Red lines
- **AcuDx output is educational only.** Prominent, logged disclaimers; product design that makes real-clinical-use implausible (synthetic patients, sandbox framing).
- **Every consequential score is reconstructable and appealable.**

### How AcuDx is an ally
- **Immutable, event-sourced audit log** (append-only, hash-chained) per encounter and per score, retaining model + prompt + guideline versions — the single best artifact for defending an assessment or an incident.
- **Terms + UX guardrails** that quarantine clinical-advice use; explicit "this is a simulation" framing surfaced at session start and logged as acknowledged.
- **Transparency records** the institution can show a regulator: what AI does, what humans decide, where the line is.

---

## 6. Policy / compliance requirements list (build-to spec)

**Classification & scope**
- [ ] Default posture: **formative educational simulation, human-in-the-loop**; summative scoring is opt-in and evidence-gated.
- [ ] Hard boundary: **no clinical advice for real patients**; enforced in ToS, UX, and logging.
- [ ] EU AI Act: treat any progression/access/exam-monitoring feature as **Annex III high-risk** → conformity assessment, risk-management system, data governance, logging, human oversight, transparency, accuracy/robustness, post-market monitoring, EU registration. Prepare before **2 Aug 2026 / 2 Dec 2027**. ([Annex III](https://artificialintelligenceact.eu/annex/3/), [summary](https://artificialintelligenceact.eu/high-level-summary/))

**Data & consent**
- [ ] Unbundled, per-purpose, revocable consent: (learn) vs (product improvement) vs (research). Never condition education on training-data consent. ([Secure Privacy](https://secureprivacy.ai/blog/student-data-privacy-governance))
- [ ] Two physically-separated data planes: identified-education (never trains models) vs de-identified/synthetic-improvement.
- [ ] GDPR special-category handling for any health-adjacent data; DPIA on file; data residency SKUs; SCCs/adequacy for transfers.
- [ ] FERPA "school official" contract terms for US institutions; data-subject rights (access/erasure/portability); withdrawal without penalty.
- [ ] Voice/STT capture disclosed and separately consented; retention limits.

**Validity, fairness, safety**
- [ ] Kane/Messick validity argument for every scored construct; criterion validity vs. faculty (targets: κ ≥ 0.6, ICC ≥ 0.7).
- [ ] Version-locked scoring model per cohort/assessment window; no silent updates.
- [ ] DIF/subgroup fairness reporting (gender, ethnicity proxy, native language, disability); publish gaps. (TRIPOD+AI / PROBAST+AI reporting discipline.) ([Bias in medical AI](https://www.jyi.org/2026-january-1/2026/1/8/bias-in-medical-ai-algorithmic-fairness-and-ethics-challenges))
- [ ] Grounded guidance layer with citation-or-refuse; dose/contraindication rule checks; per-version red-team + factuality suite gating promotion.
- [ ] Incident reporting + content quarantine + safety changelog (GMC medical-device adverse-event alignment). ([GMC](https://www.gmc-uk.org/professional-standards/learning-materials/artificial-intelligence-and-innovative-technologies))

**Governance & audit**
- [ ] Immutable, event-sourced, hash-chained audit log (encounter + score + model/guideline versions); reconstructable and appealable.
- [ ] Competency mapping (Miller/ACGME/CanMEDS/EPAs) as exportable evidence.
- [ ] Certifications roadmap: **ISO/IEC 42001** (AI management), **ISO 27001**, SOC 2, **WCAG 2.2 AA / EN 301 549**; EU AI Act conformity + CE where applicable.
- [ ] Model/guideline provenance ledger, published version history, and a human-oversight attestation flow for summative use.

**Human-in-the-loop (non-negotiable)**
- [ ] No AI-only progression/licensure decision; faculty review + override on every consequential score, with anti-automation-bias UX (AI shows *evidence*, faculty must actively confirm, disagreements logged).

---

## 7. The "regulatory moat" AcuDx can build

Compliance done right is not overhead — it is a **defensible moat** that late/cheap competitors can't cross:

1. **Validity evidence as a data asset.** Accumulated, published validity/fairness studies (per specialty, per country) become the credential accreditors ask for. A new entrant starts at zero; AcuDx has years of κ/ICC/DIF evidence. *This is the deepest moat — it compounds and can't be bought.*
2. **The audit-trail substrate.** An immutable, versioned, appealable record of every encounter and score is exactly what IRBs, defense orgs, and site visitors need. Institutions won't rip out the system of record.
3. **National-guideline curation partnerships.** Co-own versioned, country-specific guideline packs with ministries/colleges (ATLS/ERC/AHA/national variants). Regulatory endorsement + switching cost + a content asset rivals must re-license or re-build.
4. **Certification stack as procurement gatekeeper.** ISO 42001 + AI Act conformity + WCAG + data-residency SKUs clear public-sector procurement bars that block uncertified rivals outright.
5. **Human-oversight-by-design as accreditation-safe.** Because AcuDx is architecturally formative-first with faculty override, schools can adopt it *without* triggering the citations an "AI examiner" would — making it the low-risk default choice.
6. **Standards-body seat.** Contribute to WFME/AAMC/AMEE working groups on AI-in-assessment; help write the rubric competitors are later measured against.

---

## Key decisions for AcuDx

1. **Formative-first, human-in-the-loop by default; summative is opt-in and evidence-gated.** No AI-only progression/licensure decision — ever. This single choice keeps AcuDx out of the worst of EU AI Act high-risk exposure and off accreditation citation lists.
2. **Hard educational-only boundary.** No clinical advice to real patients; enforced in ToS + UX + logging. This keeps AcuDx outside the FDA device definition (Non-Device CDS logic) and clarifies liability (developer owns the tool; educator owns the pedagogical use).
3. **Two-tier content architecture:** grounded/retrieval layer (versioned, SME-signed, citation-or-refuse) for all clinical facts/doses/guidelines; roleplay layer that improvises affect but cannot assert clinical facts. A verifier + rule checks gate every clinical assertion.
4. **Two physically-separated data planes** + unbundled, revocable, per-purpose consent. Default product-improvement uses de-identified/synthetic data only; never train on identifiable student data without explicit opt-in. GDPR/FERPA-compliant by construction.
5. **Version-locking is mandatory:** scoring models and guideline packs are pinned per cohort/assessment window; no silent model/prompt updates; every change is logged in a published changelog.
6. **Immutable, event-sourced, hash-chained audit log** of encounters + scores + model/guideline versions — reconstructable and appealable. This is simultaneously the compliance requirement and moat asset #2.
7. **Validity & fairness are first-class deliverables:** Kane argument per scored construct, κ ≥ 0.6 / ICC ≥ 0.7 vs. faculty, DIF/subgroup reporting. Ship a validity-study toolkit and competency mappings (Miller/ACGME/CanMEDS/EPAs) as exportable evidence.
8. **Regional/sovereignty SKUs + national-guideline curation partnerships** and a certification stack (ISO/IEC 42001, ISO 27001, WCAG 2.2 AA, EU AI Act conformity). These clear procurement gates and build the deepest, compounding moats.
