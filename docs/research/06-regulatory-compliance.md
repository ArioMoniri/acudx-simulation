# 06 — Regulatory, Privacy, Ethics & Safety (July 2026)

**Scope.** AcuDx is a gamified medical-education roleplay/simulation platform serving universities internationally. It is **education, not clinical care**: no real patients, no clinical data, no diagnosis or treatment of a living person. That single fact is the fulcrum of nearly every regulatory decision below — and defending it is a design discipline, not a marketing line. This doc maps the July-2026 landscape and gives concrete, decision-oriented rules.

**Posture in one line:** Build to the *strictest applicable regime by default* (EU GDPR + EN 301 549/WCAG 2.2 AA + a DCB0129-style clinical-safety file), keep AcuDx **provably on the education side** of the medical-device and clinical-decision-support lines, and treat any assessment/analytics that gate a learner's progression as **potentially high-risk under the EU AI Act** and govern it accordingly — even though the enforcement clock for that has slipped to **December 2027**.

---

## 1. Data protection & residency

### 1.1 The regimes that actually bite

| Regime | Applies to AcuDx when… | What it forces |
|---|---|---|
| **GDPR** (Reg. 2016/679) | Any EU/EEA student/staff data, or offering the service to people in the EU (Art. 3(2) extraterritorial) | Lawful basis, DPA/Art. 28 processor contracts, DPIA for large-scale/high-risk profiling, breach notice ≤72h, data-subject rights, transfer safeguards (SCCs/adequacy) |
| **UK GDPR + DPA 2018** | UK universities (a large share of the med-ed market) | Substantively mirrors GDPR; UK–EU adequacy renewed; ICO is the regulator. Watch the UK **Data (Use and Access) Act 2025** which loosens some automated-decision rules vs. EU |
| **FERPA** (20 U.S.C. §1232g) | US universities — student "education records" | Consent before disclosure **unless** the *school official exception* applies; you must be under the institution's **direct control**, use records only for the contracted purpose, and **not redisclose or train models** on them without consent |
| **HIPAA** | **Almost never** — AcuDx handles simulated patients, not PHI of real patients | Institutions *worry* about it reflexively; the honest answer is HIPAA is about covered entities and real patient PHI. Say this explicitly in sales/security docs |
| **State laws** (US) | e.g. student-privacy statutes, and CCPA/CPRA for CA residents' staff | Contractual "student data" clauses (SDPC/NDPA template), no ad targeting, deletion on contract end |
| **Other** | PIPL (China), APPI (Japan), LGPD (Brazil), Canada PIPEDA/provincial, Saudi PDPL, etc. per target market | Data-residency + local processing expectations; many require in-country storage for public universities |

**The HIPAA framing to use with institutions (say it up front):** AcuDx is a *training simulator*. The "patient" is an AI persona or scripted case. No real PHI is created, received, or transmitted. Therefore HIPAA's Privacy/Security Rules do not attach to case content. The *learner's* own account data (name, institution, performance) is **student/staff personal data → FERPA + GDPR**, not PHI. Keep those two data classes physically separated so this distinction is auditable, not rhetorical. (FERPA school-official conditions per [Center for Democracy & Technology](https://cdt.org/insights/commercial-companies-and-ferpas-school-official-exception-a-survey-of-privacy-policies/); US ED OET 2023–24 AI guidance reaffirms FERPA applies whenever AI processes education records.)

### 1.2 Lawful basis & the model-training trap

- **Lawful basis** for processing learner PII: for university-contracted use, the *institution* is controller and AcuDx is **processor** (Art. 28 DPA required). Basis is typically the institution's **public task / legitimate interests** or **contract**, not learner consent — because a student can't meaningfully "refuse" a required curriculum tool. Do **not** rely on consent for core processing; reserve consent for genuinely optional things (marketing, optional research use, voice-clone avatars).
- **The single biggest landmine: training AI on student data.** FERPA guidance and GDPR purpose-limitation both cut against it. **Rule: no learner content (transcripts, self-ratings, performance) trains any model by default.** If you want to fine-tune on interaction data, that is a *separate purpose* needing its own basis (institutional opt-in in the DPA, plus de-identification). Bake a hard flag `no_train=true` into every learner-data record and every LLM API call (`store=false` / zero-retention endpoints — see §5.4).
- **Analytics consent:** the Dunning-Kruger calibration plots, competency mapping, and dean's-office cohort analytics are *profiling* of a natural person. Under GDPR this is fine on a legitimate-interest/contract basis **but** triggers a **DPIA** (Art. 35) because it's large-scale systematic evaluation of individuals affecting their education. Do the DPIA before launch; make it a living document.

### 1.3 Data residency — the international-med-school problem

Med schools in the EU, Gulf, China, India, and Canadian provinces frequently *require* in-region storage for public-institution data. Design for it:

- **Recommendation: region-pinned tenancy from day one.** Multi-region deployment with data-plane isolation: `eu-central` (Frankfurt), `uk`, `us`, and add `me-central`/`ap` on demand. Learner PII and analytics **never leave the tenant's region**; only anonymized aggregate telemetry may cross borders, and only if the DPA permits.
- **LLM inference residency is the hard part.** Frontier APIs default to US processing. For EU/UK tenants use EU-resident inference: **Azure OpenAI EU data zones**, **AWS Bedrock** EU regions (Anthropic Claude, Mistral, Llama), **Google Vertex** EU regions, or EU-sovereign providers (**Mistral**, in-region). Contractually require **zero data retention** and no-training on the inference endpoint. This is a *cost + latency + model-availability* tradeoff (see doc 04 on model selection) — pin it per region and document which model serves which tenant.
- **Sub-processor transparency:** publish a sub-processor list (cloud, LLM vendor, STT/TTS, avatar, analytics) and give 30-day change notice — universities' DPAs demand it.

---

## 2. EU AI Act — status, timeline, and where AcuDx lands

### 2.1 Timeline as of July 2026 (post-Digital Omnibus)

The AI Act (Reg. 2024/1689) is being **re-phased** by the **"Digital Omnibus on AI,"** on which the Council, Parliament and Commission reached provisional agreement **7 May 2026**; formal adoption/publication in the Official Journal is expected **before 2 August 2026**. Net effect for a tool like AcuDx:

| Milestone | Date | Relevance to AcuDx |
|---|---|---|
| Prohibited-practices ban + **AI literacy (Art. 4)** in force | **2 Feb 2025** | Art. 4 already binds you as a *provider and deployer*: staff/contractors operating AcuDx's AI need documented AI-literacy measures. Enforcement by national authorities from **2 Aug 2026** |
| GPAI (general-purpose model) obligations apply | **2 Aug 2025** | Falls on the *model providers* (Anthropic/OpenAI/etc.), not AcuDx — but you inherit their documentation for your own conformity file |
| Art. 50 **transparency** obligations effective | now **2 Dec 2026** (Omnibus compressed the grace period from 6→3 months) | **Directly hits AcuDx:** users must be told they're interacting with AI; AI-generated content (synthetic voice/video/text of the "patient") must be disclosed/marked |
| **High-risk Annex III** stand-alone systems obligations | **postponed to 2 Dec 2027** (was Aug 2026) | This is the big one for AcuDx's *assessment* features — you got ~16 extra months, don't waste them |
| High-risk embedded in Annex I regulated products | **2 Aug 2028** | Only relevant if AcuDx ever became a medical device (it must not) |

Sources: [European Commission AI Act timeline](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai); [Gibson Dunn on the Omnibus postponement](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/); [ComplianceHub on the Aug-2026 Art. 50 reset](https://compliancehub.wiki/eu-ai-act-article-50-transparency-digital-omnibus-2026/); [EC AI-literacy Q&A](https://digital-strategy.ec.europa.eu/en/faqs/ai-literacy-questions-answers).

### 2.2 Is AcuDx high-risk or limited-risk?

**Annex III(3) makes education AI high-risk** where a system is used for: admission/assignment to educational programmes; **evaluating learning outcomes** (incl. steering the learning process); assessing the appropriate level of education for a person; or monitoring/detecting prohibited behaviour during tests (proctoring). ([artificialintelligenceact.eu Annex III](https://artificialintelligenceact.eu/annex/3/).)

AcuDx has features on **both sides of the line**:

- **Roleplay practice, hints, translation, vitals sim, XP/badges** → *not* an evaluation-of-outcomes function → **limited-risk** (transparency only).
- **The graded assessment, competency mapping to Miller/ACGME/EPAs, and any score that gates progression, remediation, or appears on an institutional transcript** → this **evaluates learning outcomes** and can **steer the learning process** → presumptively **high-risk**.

**The Article 6(3) escape hatch — use it deliberately.** An Annex III system is *not* high-risk if it doesn't pose significant risk to health/safety/fundamental rights, including by **not materially influencing the outcome of decision-making**, and it only: (a) performs a narrow procedural task; (b) improves a completed human activity; (c) detects patterns without replacing human judgment; or (d) is preparatory. **Profiling a person is always high-risk regardless.** ([Article 6](https://artificialintelligenceact.eu/article/6/).)

**Design decision:** keep AcuDx's assessment **advisory to a human educator by default.** If AcuDx *recommends* a competency gap and a faculty member makes the pass/fail/remediation call, you have a strong 6(3)(b)/(d) argument and land in **limited-risk**. The moment an AcuDx score **auto-gates** progression with no human review, you are high-risk — and because you profile learners, the 6(3) exception is weakest exactly there. Two build tracks:

1. **Default product (limited-risk):** AI is transparent, assessment is decision-support for a human. Obligations: Art. 50 transparency (label AI, mark synthetic content), Art. 4 literacy, plus GDPR. Achievable now.
2. **"Institutional summative mode" (high-risk):** if a university wants AcuDx scores to count officially. Then you owe the full Annex III stack: risk-management system, data governance, technical documentation, **automatic logging** of events, transparency to users, **human oversight** design, accuracy/robustness/cybersecurity, conformity assessment (internal, Annex VI), EU-database registration. Gate this behind an explicit contract and only ship it by **Dec 2027**.

### 2.3 Transparency & logging obligations you owe *regardless*

Even in limited-risk mode, from **Dec 2026**:

- **Disclose AI interaction (Art. 50(1)):** the learner must know the patient/examiner/colleague is AI. (Easy — it's the whole premise — but state it in-UI and in ToS.)
- **Mark synthetic content (Art. 50(2)):** AI-generated audio/video/images (synthetic patient voice, 3D avatar, generated case media) must be **machine-detectably marked** (e.g. C2PA content credentials / watermark) and labelled to users. Applies to your TTS voices and any generated avatars/media.
- **Logging:** high-risk mode requires automatic, tamper-evident event logs retained for traceability. Build this now anyway (§5.5) — it doubles as clinical-safety and academic-integrity evidence.

---

## 3. The medical-device line: staying on the education side

This is existential. Cross the line and you're in FDA/MDR territory — clinical evaluation, notified bodies, QMS (ISO 13485), post-market surveillance. AcuDx must **never** cross it.

### 3.1 EU (MDR 2017/745 + MDCG 2019-11)

Software is a **medical device** only if its **intended purpose** matches the MDR device definition (diagnosis, prevention, monitoring, treatment of *a specific patient/disease*). Per **MDCG 2019-11 Rev.1 (June 2025)**, "software for general purposes, even in a healthcare setting… or for education/well-being purposes, is **not** a medical device." Intended purpose is the determining factor, independent of platform. ([MDCG 2019-11](https://health.ec.europa.eu/system/files/2020-09/md_mdcg_2019_11_guidance_en_0.pdf); [Emergo on Rev.1](https://www.emergobyul.com/news/european-revision-primary-software-guidance-mdcg-2019-11-revision-1-small-changes-meaningful).)

**AcuDx's intended purpose statement (put it in writing, everywhere):** *"AcuDx is a training and assessment simulator for health-professions education. It is not intended for the diagnosis, prevention, monitoring, prediction, prognosis, treatment or alleviation of disease in any real patient, and must not be used to inform the care of any real patient."*

### 3.2 US (FDA — CDS final guidance, revised early 2026)

FDA's **revised final CDS guidance (released Jan/Mar 2026, superseding the 2022 version)** governs the §520(o)(1)(E) "non-device CDS" exclusion: a CDS is a *device* if it fails any of four criteria — notably if the clinician **cannot independently review the basis** for the recommendation, or if it's driven by image/signal analysis. ([FDA CDS guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software); [Arnold & Porter 2026 advisory](https://www.arnoldporter.com/en/perspectives/advisories/2026/01/fda-cuts-red-tape-on-clinical-decision-support-software).) AcuDx doesn't even reach this test *if* it never targets a real patient — but the guidance is the map of where the cliff edge is.

### 3.3 The bright-line rules that keep AcuDx on the education side

- **No real-patient input path. Ever.** No feature that accepts a real patient's data (image, lab, symptom) and returns advice. If a learner pastes real patient details, detect-and-block ("This is a simulator; do not enter real patient information").
- **Guidance mode is grounded in *published guidelines for a fictional case*, not personalized advice.** The Socratic hints (ATLS etc.) reference the *simulated* patient. Frame outputs as "in this scenario, guidelines suggest…", never "you should do X for your patient."
- **Every output is explainable / cites its guideline source** — mirrors the FDA transparency criterion and keeps you defensible.
- **Explicit disclaimers** on every clinical-content surface: educational use only, not for real-patient care.
- **No claims** of diagnostic accuracy, clinical efficacy, or that using AcuDx improves patient outcomes. Market it as *competency training*, measured against *educational* frameworks (Miller, EPAs), never clinical endpoints.
- **Watch scope creep:** a future "point-of-care refresher" or "on-shift lookup" feature would flip AcuDx into CDS/MDSW. Any such idea goes through a **regulatory gate review** before build.

---

## 4. Integrity, safeguarding, accessibility, inclusivity, bias

### 4.1 Academic integrity

- AcuDx assessment data can be gamed (share answers, bot-play). For any *summative* use, provide **identity assurance** (SSO-bound sessions), **attempt logging**, **case-bank rotation/randomization**, and **anomaly detection** (impossibly fast "perfect" runs). But **do not build AI proctoring** (webcam behaviour analysis) casually — that is an Annex III high-risk *and* a fundamental-rights/safeguarding minefield. If a university demands proctoring, treat it as a separate high-risk module or integrate a third-party proctor under *their* DPA/risk assessment.
- Position AcuDx primarily as **formative** practice; make summative claims cautiously.

### 4.2 Safeguarding

- Users may be **under 18** (some med programs, and nursing/paramedic access). Where minors are in scope: heightened GDPR protections (Art. 8), FERPA/COPPA (US, <13 rare but check), no behavioural ads, data minimization. Prefer **institution-mediated onboarding** (no direct minor sign-up) to keep age-assurance the institution's job.
- **Clinical content can distress:** cases involve death, trauma, paediatric arrest, abuse. Add **content warnings**, an opt-out/"step away," and signpost support. Roleplay with an "aggressive patient" persona must have guardrails so it can't become abusive toward the learner.
- **Wellbeing/self-harm:** if a learner types self-harm ideation into a chat, the system must **break character** and surface help resources — a hard safety rule in the agent layer, not a persona behaviour.

### 4.3 Accessibility — EN 301 549 / WCAG 2.2

The **European Accessibility Act** has been **enforceable since 28 June 2025**; non-compliance risks fines and market removal, and it reaches any org serving EU customers regardless of HQ. The harmonized technical standard is **EN 301 549** — the currently-cited version (v3.2.1) maps to **WCAG 2.1 AA**, but **v4.1.1 (expected 2026) incorporates WCAG 2.2**, so build to **WCAG 2.2 AA now**. ([Level Access EAA guide](https://www.levelaccess.com/compliance-overview/european-accessibility-act-eaa/); [Deque on EN 301 549](https://www.deque.com/en-301-549-compliance/).) US public universities separately impose **Section 508 / ADA Title II** (the 2024 DOJ rule sets WCAG 2.1 AA for public entities). Net target: **WCAG 2.2 AA is the design baseline.**

Concrete implications for AcuDx's UI (chat + live vitals monitor + charts + voice):

- **Voice/duplex mode needs a full non-voice path:** captions for TTS, text alternative for STT, no feature that *only* works by voice. Deaf/HoH learners must be able to complete every case.
- **Vital-signs monitor & trend charts:** don't encode meaning in colour alone (WCAG 1.4.1); provide text/table equivalents and ARIA live regions announcing changes; alarms need non-audio cues.
- **3D avatars:** decorative-or-meaningful decision; provide text description; never gate content behind avatar rendering.
- **Keyboard-operable, screen-reader-labelled, focus-visible, 2.2 targets** (min target size 24×24 CSS px, no dragging-only interactions, consistent help). Publish a **VPAT / EN 301 549 accessibility statement**.

### 4.4 Inclusivity & bias in personas and assessment

This is both an ethics and a fairness-of-assessment risk, and (in high-risk mode) an **Annex III data-governance obligation**.

- **Persona library must span** age, sex, gender identity, race/ethnicity, body type, disability, language, and health-literacy — *without* leaning on stereotypes. "Aggressive patient" or "non-native speaker" personas must not map to any demographic. Review with clinician-educators + DEI review; document the design rationale.
- **Presentation bias in the case bank:** classic trap — teaching "textbook" (often white-male-default) presentations of disease. Deliberately include atypical/under-represented presentations (e.g. MI in women, dermatology across skin tones) so AcuDx *corrects* rather than *reinforces* medical bias.
- **Assessment fairness:** measure whether scores differ systematically by learner demographic, first language, or accent (STT accuracy varies by accent — a direct equity risk). **Test STT/scoring for demographic performance gaps** and remediate; don't let a voice-recognition weakness masquerade as a competency deficit. This is exactly the kind of bias the AI Act's high-risk data-governance and the Dunning-Kruger calibration analytics must not encode.
- **LLM bias:** the model judging a learner's history-taking may carry its own biases. Use rubric-anchored scoring with human-reviewed calibration sets; audit LLM-judge outputs for disparate impact.

---

## 5. Clinical-safety governance, incidents, model-risk, audit

Even though AcuDx isn't a medical device, adopting a **clinical-safety management system modelled on DCB0129** is the strongest trust signal to universities and hospitals, and it's *cheap insurance* against a wrong-guideline-hint incident.

### 5.1 DCB0129/0160-style safety file (voluntary but recommended)

**DCB0129** (manufacturer) and **DCB0160** (deploying org) are the NHS clinical-risk-management standards, mandatory for NHS health-IT under the Health & Social Care Act 2012 — and **under active review, with a public consultation open 29 Jun–11 Sep 2026**. ([NHS England clinical risk standards](https://digital.nhs.uk/services/clinical-safety/clinical-risk-management-standards).) AcuDx is *education*, so not strictly in scope — but adopt the pattern:

- Appoint a **Clinical Safety Officer** (registered clinician, safety-trained) — required by DCB0129 for compliance and a credibility asset regardless.
- Maintain a **Clinical Safety Case Report + Hazard Log**: enumerate hazards (a hint citing an outdated/wrong guideline; a persona modelling a dangerous behaviour a learner mimics; a mistranslation in the terminology translator; wrong drug dose in a protocol), assess severity×likelihood, mitigate, sign off.
- **The #1 hazard is guidance-mode content being wrong or stale.** See §5.3.

### 5.2 The guideline-grounding safety problem

Guidance mode is the highest-risk feature: an authoritative-sounding hint grounded in an outdated or wrong-country guideline can teach unsafe practice. Controls:

- **Versioned, sourced guideline store** (see doc 05 on grounding): every hint carries `{guideline, version, country, effective_date, source_url}`. Never emit clinical guidance the system can't attribute.
- **Country-specific by design** (ATLS variants, drug names/doses differ by jurisdiction). Wrong-country dosing is a real hazard; pin guideline set to the tenant's country.
- **Human clinical review + expiry:** guideline content is reviewed by clinicians, has a review date, and is flagged stale when its source updates. RAG retrieval must prefer current versions and refuse to answer outside the vetted corpus rather than hallucinate.
- **No free-form clinical claims:** guidance-mode LLM output is constrained to the retrieved, cited corpus (grounded generation), not open model knowledge.

### 5.3 Model-risk management

- **Model registry:** which model/version serves each surface (persona, examiner, judge, guidance), its prompt, its eval scores, its guardrails. Version and change-control it.
- **Evals before promotion:** clinical-accuracy, safety (refusal of unsafe/off-topic), bias, and hallucination evals gate any model or prompt change into production. No silent model swaps.
- **Guardrails:** input filters (block real-PHI entry, block self-harm→break character), output filters (no real-patient advice, no unsafe roleplay), and a hard **"education-only" system contract** in every agent.
- **Provider dependency:** frontier-model deprecations/behaviour drift are a real operational risk (see doc 04). Abstract behind a model gateway; keep fallbacks; re-run evals on every provider update.

### 5.4 Incident handling

- **Two incident classes**, handled distinctly: **(a) data/security incidents** → GDPR 72h breach process, contractual notice to institutions, ICO/DPA notification; **(b) clinical-safety/content incidents** (wrong hint, unsafe persona behaviour, mis-scored assessment) → hazard-log entry, root cause, corrective action, and disclosure to affected institutions.
- **Reporting channel** in-product ("report incorrect medical content") feeding the CSO and hazard log — turns users into a safety sensor and evidences good governance.
- **AI Act post-market note:** in high-risk mode you'd owe serious-incident reporting to authorities; the process above is the substrate for it.

### 5.5 Audit logging (do this from day one)

One logging spine serves privacy, integrity, clinical safety, and AI-Act traceability:

- **Immutable, tamper-evident, timestamped** event log: who/what/when for auth, assessment events, model calls (model+version+prompt hash, not necessarily full content), guidance served (with guideline version), content-safety triggers, admin actions.
- **Separate learner-content store** from operational logs, with the `no_train` flag and per-region residency.
- **Retention policy** aligned to institutional contracts + GDPR minimization (define per data class; don't keep forever). Learner-erasure requests must be executable.

---

## 6. Compliance-by-design checklist for AcuDx

**Data & privacy**
- [ ] Act as **processor**; sign Art. 28 DPA + FERPA "school official" terms with every institution; publish sub-processor list w/ 30-day notice.
- [ ] **Region-pinned tenancy**; learner PII/analytics never leave region; EU/UK inference on EU-resident endpoints with **zero retention + no-training**.
- [ ] Hard **`no_train=true`** default on all learner data and LLM calls; model-training on interaction data only via explicit institutional opt-in + de-identification.
- [ ] **DPIA** completed for calibration/competency analytics (large-scale profiling) before launch; keep it living.
- [ ] Separate **learner-PII store** from **simulated-case content**; document that no real PHI exists → HIPAA out of scope.
- [ ] Data-subject rights (access/erasure/portability) executable; defined retention per data class.

**AI Act**
- [ ] **Art. 4 AI-literacy** program for staff/contractors (enforced from Aug 2026).
- [ ] **Art. 50 transparency** (live Dec 2026): in-UI "you're talking to AI"; **C2PA/watermark** on synthetic voice/avatar/media + user labelling.
- [ ] Assessment ships **advisory-to-human by default** (Art. 6(3) → limited-risk). Any **auto-gating** summative mode = **high-risk**, gated behind contract, delivered by **Dec 2027** with full Annex III stack (risk mgmt, data governance, logging, human oversight, conformity assessment, EU-DB registration).
- [ ] **No AI proctoring** in core product (high-risk + safeguarding); if required, isolate/third-party under institution's DPA.

**Medical-device line**
- [ ] Written **intended-purpose statement** ("education only, not for real-patient care") on product, ToS, marketing, and in-agent system prompt.
- [ ] **No real-patient-input path**; detect-and-block real PHI entry.
- [ ] Guidance grounded in published guidelines for the **fictional case**; every clinical output **cited/explainable**; disclaimers on every clinical surface.
- [ ] **No** diagnostic-accuracy/clinical-efficacy/patient-outcome claims. **Regulatory gate review** before any point-of-care-flavored feature.

**Accessibility & fairness**
- [ ] **WCAG 2.2 AA** baseline (EN 301 549 / EAA / Section 508); full **non-voice path** for all voice features; accessible vitals monitor/charts (no colour-only); publish accessibility statement/VPAT.
- [ ] Persona library spans demographics **without stereotypes**; case bank includes **atypical/under-represented presentations**; DEI + clinician review documented.
- [ ] **Test STT + scoring for demographic/accent bias**; audit LLM-judge for disparate impact; rubric-anchored, human-calibrated scoring.
- [ ] Safeguarding: institution-mediated onboarding for minors; content warnings + opt-out on distressing cases; **self-harm → break character + resources** hard rule.

**Clinical safety & governance**
- [ ] Appoint **Clinical Safety Officer**; maintain **DCB0129-style Safety Case + Hazard Log**.
- [ ] **Versioned, country-specific, clinician-reviewed guideline store** with expiry; grounded generation only; refuse rather than hallucinate.
- [ ] **Model registry + pre-promotion evals** (accuracy/safety/bias/hallucination); no silent model swaps; guardrails + model gateway with fallbacks.
- [ ] **Immutable audit log** (auth, assessments, model calls, guidance versions, safety triggers) from day one; dual incident process (GDPR 72h + clinical hazard log); in-product "report incorrect content."

---

## Key decisions for AcuDx

1. **"Education, not clinical care" is the load-bearing wall.** Enforce it structurally: no real-patient-input path, written intended-purpose statement everywhere, guidance framed against the fictional case, no accuracy/efficacy claims. This keeps AcuDx out of FDA CDS and EU MDR/MDSW entirely.
2. **Ship two assessment tracks.** Default = **advisory-to-human** (limited-risk under AI Act Art. 6(3)). A separate **"institutional summative"** mode auto-gating progression is **high-risk (Annex III)** — build the full compliance stack for it and target the **2 Dec 2027** deadline the Digital Omnibus gave you; don't ship it earlier without the stack.
3. **Two AI-Act obligations bind you now regardless of risk tier:** **Art. 4 AI-literacy** (enforced Aug 2026) and **Art. 50 transparency** (live **Dec 2026**) — disclose AI interaction and **watermark/label synthetic voice/avatar/media (C2PA)**.
4. **`no_train=true` by default on all learner data + LLM calls.** FERPA + GDPR both cut against training on student data; make model-training a separate, opt-in, de-identified purpose. Treat calibration/competency analytics as profiling → **DPIA required before launch**.
5. **Region-pinned tenancy with in-region, zero-retention inference** for EU/UK (Azure OpenAI EU zones / Bedrock EU / Vertex EU / Mistral). This constrains model selection (doc 04) and cost per region — pin the model↔region map.
6. **WCAG 2.2 AA is the non-negotiable UI baseline** (EAA enforceable since Jun 2025). Every voice/duplex feature needs a full non-voice equivalent; the vitals monitor/charts must not rely on colour alone.
7. **Stand up a DCB0129-style clinical-safety file with a Clinical Safety Officer and a Hazard Log**, even though it's not legally required — the #1 hazard is **stale/wrong/wrong-country guideline hints**, mitigated by a versioned, clinician-reviewed, country-pinned guideline store with grounded-generation-only output.
8. **One immutable audit-log spine serves privacy, integrity, clinical safety, and AI-Act traceability** — build it day one; it's also the substrate for incident reporting and the eventual high-risk conformity file.
