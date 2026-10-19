# 13. Competitor Landscape, October 2026

Prepared for AcuDx (open-source medical-education platform: AI simulated patients inside an Epic-like EHR, solo and multiplayer interdisciplinary rooms, graded feedback).
Research date: 2026-10-19. Method: web search (extended mode for recent items) plus direct page fetches. Every factual claim below carries the URL where it was read. Claims that could not be confirmed are labelled **unverified**. Anything about model vendors that a vendor does not state publicly is labelled as not disclosed rather than guessed.

Supersedes the older landscape in `04-market-competitors.md` where the two disagree.

---

## 1. Per-vendor profiles

### 1.1 Body Interact (Take The Wind, Portugal; distributed in the US by Wolters Kluwer / Pocket Nurse)

**What it does.** Screen-based virtual patient simulator with a real-time adaptive physiology engine (vital signs, symptom progression, organ function, compensatory mechanisms), head-to-toe assessment, and five environments (Emergency Room, Consultation, Inpatient, Pre-Hospital, Home Care). Marketing cites "1,500+ curriculum-aligned scenarios" in 10+ languages. Available on web, iOS, Android, Windows. Source: https://bodyinteract.com/virtual-patient-simulator/

**Tech known.** The AI-Driven Conversations feature (Beta) is "built with Llama, an AI language model developed by Meta Platforms." Learners speak (speech recognition, text shown in a chat box for editing before sending) or type. Optimized languages: English, Spanish, Japanese, Portuguese, French; additional beta languages include **Turkish**, German, Italian, Polish, Russian, Ukrainian and others. Requires v2026.050+ and a paid institutional license; educators switch it on per simulation session in BI Studio (default off); independent users cannot access it. Message counts per scenario are capped and vary by scenario type. Source: https://help.bodyinteract.com/body-interact-simulator-app/understand-ai-driven-conversations-beta/

**EHR fidelity.** No Epic-like chart. Interaction is a game-like patient view with ordering of tests and ABG/ventilation physiology. Imaging and labs exist as orderable results but the fetched pages do not describe a chart or documentation workflow. Source: https://bodyinteract.com/virtual-patient-simulator/

**Pricing.** Not public. Pocket Nurse lists Lite/Basic/Standard/Premium nursing tiers as "Call for Price"; Basic = 30 scenarios, Premium = 120 scenarios, up to 1,000 user accounts, unlimited simulations, 1 to 5 year terms. Sources: https://www.pocketnurse.com/dmacc/11-98-7624p-body-interact-for-nursing-education-basic-package-one-year-subscription and https://www.pocketnurse.com/default/11-98-7626p-body-interact-for-nursing-education-premium-package-one-year-subscription

**Assessment.** Post-simulation analytics organized around stages of care plus an "AI-powered report" that explains what worked and what did not. AI communication feedback is scored in four domains (rapport/initiation, information gathering, information giving, closing) grounded in Calgary-Cambridge, SEGUE and the Kalamazoo Consensus; EMS scenarios add SAMPLE/OPQRST. Sources: https://bodyinteract.com/virtual-patient-simulator/ and the help article above.

**Multiplayer / IPE.** Not mentioned on the fetched product pages. BI Studio is described as a "built-in LMS" for assigning simulations; LTI is not mentioned. Source: https://bodyinteract.com/virtual-patient-simulator/

**Weaknesses.** Conversation AI is still Beta with per-scenario message caps and a disclaimer that responses "may contain mistakes or outdated information"; AI is off by default and gated behind institutional licensing; no EHR chart; no multiplayer; no public pricing; Turkish is beta-quality only.

---

### 1.2 Oxford Medical Simulation (OMS, UK)

**What it does.** VR and screen-based clinical simulation for nurses, doctors and allied health; scenario library of roughly 240 to 260 (counts vary by source). OMS Create is a no-code authoring tool (edit history, exam, physiology, imaging, results, conversation, feedback; text-to-speech generation of new patient audio). Sources: https://www.healthysimulation.com/oms-create-vr-clinical-simulation-scenario-authoring/ , https://www.unboundmedicine.com/oadn/view/Virtual%20Simulation%20Reviews/2455046/all/Oxford_Medical_Simulation , https://oxfordmedicalsimulation.com/platform/

**Tech known.** "Hands & Voice" replaces menu-driven interaction with full voice control, uses large language models for patient dialogue, and adds an emotion and physiology engine. No LLM or speech vendor is named. Source: https://thenextweb.com/news/oxford-medical-simulation-secures-5m-growth-financing (16 March 2026). OMS's own AI article (21 Aug 2025) confirms NLP plus LLM voice scenarios with open-ended dialogue, no vendor named: https://oxfordmedicalsimulation.com/artificial-intelligence-in-healthcare-simulation-the-why-and-how/

**Funding.** £5M growth debt from Salica Investments (March 2026) for US expansion, AI-driven scenarios, learning analytics and workflow tooling; prior £10M Series A (Jan 2024, Frog Capital); 35,000+ simulations per month. Source: https://thenextweb.com/news/oxford-medical-simulation-secures-5m-growth-financing

**Pricing.** Not public (SoftwareOne marketplace listing exists without figures): https://platform.softwareone.com/product/oxford-medical-simulation-platform/PCP-0247-4833

**Assessment.** Standardized evidence-based feedback and performance analytics; team-based feedback on technical and non-technical skills, group debrief environment, team analytics dashboards in the IPE product. Sources: https://oxfordmedicalsimulation.com/platform/hands-voice/ and https://media-and-learning.eu/interprofessional-vr-simulation-introducing-oms-interprofessional/

**Multiplayer / IPE.** OMS Interprofessional: multiple learners in one VR scenario, co-located or in different countries, faculty can join; interdisciplinary teams. Source: https://media-and-learning.eu/interprofessional-vr-simulation-introducing-oms-interprofessional/ ; multi-patient scenarios: https://oxfordmedicalsimulation.com/multi-patient-scenarios-next-step-in-preparing-for-practice/

**EHR fidelity.** Simulated bedside charting inside the scenario; not an Epic-like EHR. **Unverified** beyond the authoring feature list (imaging/results are editable fields).

**Weaknesses.** VR-first (headset logistics, cost); no vendor transparency on AI stack; growth financed by debt, which suggests pressure on margins; no public pricing; no evidence of LTI/SSO specifics in fetched pages.

---

### 1.3 i-Human Patients by Kaplan (US)

**What it does.** Cloud-based case authoring and playback platform simulating a complete encounter: history, physical exam, differential, tests, documentation and management, for medical, osteopathic, PA and nursing programs. Kaplan's acquisition release cites 500+ configurable cases. Sources: https://kaplan.com/about/press-media/kaplan-acquires-i-human-patients-a-leader-in-virtual-interactive-medical-simulations and https://kaplan.com/institutions-educators/higher-education/nursing-schools/i-human

**Tech known.** Kaplan markets an "AI Tutor" giving immediate individual feedback as a "real-time clinical coach." No LLM vendor named; no voice or avatar specifics on the product page. Source: https://kaplan.com/institutions-educators/higher-education/nursing-schools/i-human

**EHR fidelity.** Structured chart-like case player (history question bank, exam, orders, notes) rather than an Epic-like EHR. **Unverified** for 2026 changes; no 2026 feature announcements were found.

**Pricing.** Historic figure of $295 per user per year with $49/month short terms (2015 data, treat as stale): https://www.sramanamitra.com/?p=93240 . Current pricing is quote-only.

**Assessment.** Cases align to the NCSBN Clinical Judgment Measurement Model (per OADN review quoted on the Kaplan page); analytics and reporting for real-time insight. Source: https://kaplan.com/institutions-educators/higher-education/nursing-schools/i-human

**Multiplayer / IPE.** None found.

**Weaknesses.** Aging interaction model (menu/select driven); no public 2026 roadmap; no multiplayer; AI limited to feedback coaching; opaque pricing.

---

### 1.4 Aquifer (US nonprofit)

**What it does.** Text-based virtual patient cases (250+ across Family Medicine, Internal Medicine, Pediatrics, Geriatrics, Neurology, OB/GYN, Radiology, Psychiatry), PracticeSmart quizzes, 40+ Integrated Illness Scripts, Calibrate formative assessments, Clinical Decision Making Exam. Source: https://aquifer.org/learner-subscriptions

**AI features.** "Aquifer AI" instant summary-statement feedback (same page). AI Virtual Patient Encounters (VPEs) grew from 8 announced January 2026 to 23 by 17 July 2026, spanning primary care, neurology, psychiatry, gynecology, obstetrics, emergency, pediatrics, adult medicine and geriatrics, including a breaking-bad-news encounter; feedback is personalized to what the learner asked, differential prioritization, counselling and response to red flags and emotional cues; learners compare against expert reasoning. Modality (text vs voice) and LLM vendor not stated. Sources: https://aquifer.org/aquifer-news-and-events/vpes-reflect-clinical-variety , https://aquifer.org/aquifer-news-and-events/8-new-vpes-support-skill-development , https://aquifer.org/aquifer-news-and-events/aquifers-2026-innovations

**Pricing.** Individual student yearly plan $125 (page undated beyond 2026 copyright; confirm); institutional quote-based. Source: https://aquifer.org/learner-subscriptions

**Assessment.** Calibrate formative assessments per discipline, new 2026 program-level reporting tools. Sources above.

**Multiplayer / IPE.** None. **EHR fidelity.** None (narrative cases). Voice/avatar: none found.

**Weaknesses.** No EHR, no voice, no multiplayer, no imaging viewer beyond the Radiology course content; AI encounters are a small fraction (23) of the library.

---

### 1.5 Shadow Health / Digital Clinical Experiences (Elsevier, US)

**What it does.** 80+ Digital Standardized Patients who "answer millions of unique questions"; students interview, examine, document (EHR documentation practice) and get a Student Performance Index. Content aligned to AACN Essentials. Source: https://www.elsevier.com/products/shadow-health

**2026 news.** Shadow Health Lab with VR launched 9 June 2026 (debut at INACSL): 165+ lab simulations plus 30 VR patient encounters with structured prep, facilitation and debrief tools; "patented, AI-enabled Conversation Engine" using NLP so students converse in their own words. No headset, pricing or AI vendor named. Source: https://www.elsevier.com/about/press-releases/elsevier-launches-shadow-health-lab-with-virtual-reality-to-transform-clinical-education-for-nursing-students

**Tech known.** Patented NLP conversation engine; Elsevier does not state whether it is now LLM-based. A third-party page claims it matches free text against phrase libraries and that students hit unrecognized phrasing (low-confidence, **unverified**): https://academicresearchbureau.com/shadow-he/

**Pricing.** Not public (demo request). **Multiplayer / IPE.** None found. **Scale.** 700,000+ nursing students per Elsevier AU page: https://www.elsevier.com/en-au/products/shadow-health

**Weaknesses.** Nursing-only; conversation engine of uncertain generative capability; no multiplayer; closed content.

---

### 1.6 Lecturio (Germany) including Healer and SimTutor

**What it does.** Video lecture and Qbank platform; Healer is a clinical reasoning virtual patient product (data acquisition, problem representation, hypothesis generation, differential; "Diagnostic Pause" to build illness scripts; 100+ expert illness scripts; dozens of encounters; objective scoring across six skills plus two self-assessed). SimTutor is a 2D/3D procedural simulation product. Sources: https://www.lecturio.com/inst/healer/how-it-works/ , https://www.lecturio.com/inst/healer/ , https://www.healthysimulation.com/webinars/knowledge-practice-clinical-reasoning-applied-skill-lecturio-virtual-simulation/

**AI.** Lecturio's Qbank uses AI for adaptive question selection: https://www.lecturio.com/blog/ai-study-tools-for-med-students-can-they-help-you-pass-boards-in-2026/ . A third-party directory describes an "AI Tutor" using Socratic questioning (**unverified**, not on Lecturio pages fetched): https://physicianaitools.com/companies/lecturio/ . No LLM-driven free-text AI patient was found on Lecturio pages.

**Pricing.** Institutional quote only; free single-case trial. **Multiplayer / IPE.** None found. **EHR.** None.

**Weaknesses.** Branching rather than generative patients; no voice; no EHR; no team play.

---

### 1.7 AMBOSS (Germany/US) as reference-layer benchmark

**What it does.** Knowledge library plus Qbank. Two AI products: (a) AMBOSS GPT, a free custom GPT inside ChatGPT that prioritizes AMBOSS articles and links to them: https://support.amboss.com/hc/en-us/articles/33872741080081-AMBOSS-GPT ; (b) AMBOSS AI Mode ("AMBOSS AI (LiSA)"), an AI search agent drawing exclusively on AMBOSS articles, the AMBOSS drug database and selected external sources such as US clinical guidelines, with direct links to original sources, flagging when sources disagree, saying when it cannot find relevant information, anticipatory deep dives, specialty personalization and multilingual answers. Access by request with waitlist, currently included in all subscriptions, may move to Premium. Vendor claims top rank in an independent Stanford-Harvard 100-case benchmark (vendor characterization). Source: https://www.amboss.com/us/clinical-ai-mode

**Why it matters to AcuDx.** The "attending-tip" reference UI pattern (short cited summary, link-out to the canonical article, disagreement flagged, honest "not found") is now the expectation for in-sim reference help.

**Weaknesses.** Underlying model not disclosed; waitlisted rollout; not a simulation product.

---

### 1.8 PCS Spark (PCS / Patient Communication Simulators, US; distributed with Nasco Healthcare)

**What it does.** Conversational AI virtual patients in browser (Chrome, microphone) and VR (Meta Quest, WebXR). Learners examine (vitals, heart and lung sounds). Sources: https://www.pcs.ai/spark , https://help.pcs.ai/en/articles/7239038-student-s-guide-to-pcs-spark-in-the-browser , https://help.pcs.ai/en/articles/7869016-student-s-guide-to-pcs-spark-in-vr

**Tech known.** "PCS AI/Speech" proprietary custom-trained, fine-tuned LLMs (explicitly "not built on ChatGPT"); speech recognition and synthesis with selectable emotional speech styles (angry, cheerful, sad, terrified, unfriendly); 15 languages including **Turkish**. AI/Scenarios generates scenarios from short text descriptions (Pro tier); 50+ PCS-authored scenarios. AI/Assessment scores in real time against scenario checklists and communication frameworks; faculty can edit checklists and grant "Credit Challenge." Two-way LTI 1.3 integration with Canvas, Moodle, Blackboard. Source: https://www.pcs.ai/spark

**Multiplayer / IPE.** TeamSpace: learners in different locations share one encounter with audio or text chat. Source: https://www.pcs.ai/spark

**Pricing.** Per-student per-year with minimums, Spark and Spark Pro tiers, quote only. Source: https://www.pcs.ai/spark

**EHR fidelity.** Not mentioned on the product page. Imaging: not mentioned.

**Weaknesses.** No EHR or order-entry layer described; proprietary model stack is unauditable; content library small (50+); accent sensitivity acknowledged by vendor.

---

### 1.9 SimX (US)

**What it does.** VR medical simulation; 425+ patient models, 1,064+ simulated tools, 474+ settings, "hundreds" of pre-built encounters plus a Scenario Editor and marketplace; runs on all major wireless headsets. Source: https://www.simxvr.com/platform/

**Tech known.** Patented multiplayer for co-located and remote groups, 4+ learners per patient, moderator tools (screen recording, state timers). "AI-driven scenario automation" and links to AI Assistant / Autonomous Simulation pages, details not given. Full offline mode (March 2026). Sources: https://www.simxvr.com/platform/ , https://www.healthysimulation.com/expanding-rural-healthcare-simulation-simx-virtual-reality-vr/ (sponsored article, 18 March 2026)

**Assessment.** Critical-action timestamps, playback, learning-objective tracking, exportable performance reports. Source: https://www.simxvr.com/platform/

**Multiplayer / IPE.** Strongest VR IPE story in the set (nursing, EMS, medicine in one scenario). Source: https://www.healthysimulation.com/simx-vr-ipe-competency-based-education-nursing/

**Pricing.** Not public. **EHR.** Not mentioned. **LMS/LTI.** Not mentioned.

**Weaknesses.** Headset-bound; AI patient conversation specifics undisclosed; moderator-driven rather than autonomous AI patients in most scenarios (vendor's own "emerging AI" language).

---

### 1.10 Sim-Ed AI startups (2024 to 2026 cohort)

| Company | Country | What is verified | Source |
|---|---|---|---|
| **SimConverse** | Australia | Generative AI patients, colleagues and casualties; photorealistic avatars; shaped voices; five-stage flow (prep, conversation, documentation, feedback, reflection); rubric heatmaps institution-wide; SSO + LTI; SOC 2, ISO 27001, GDPR, FERPA; customers include KCL, NHS England, Adelaide, Indiana, Houston (2021 to 2025). Seed A$1.5M March 2023. No LLM vendor named. | https://www.simconverse.com/ , https://www.businessnewsaustralia.com/articles/folklore--artesian-back--1-5m-seed-round-for-ai-powered-medtech-simconverse.html |
| **SimChat (Geeky Medics)** | UK | Text, voice or video-avatar patients (AI faces, lip-sync, expressive speech); generates patients from SP scripts, OSCE checklists, mark schemes; tagged library, cohort permissions, transcripts; embed in VLE via links; ISO 27001, Cyber Essentials. Third-party review says built on OpenAI GPT models (**unverified** by vendor). Blog dated 22 May 2026. | https://app.simchat.ai/blog/medical-simulation-with-virtual-patients/ , https://geekymedics.com/virtual-patient-avatars/ (listed in search, fetch blocked), review via https://www.remnote.com/blog/best-ai-tools-for-medical-students |
| **MedSimAI** | US (academic spin-out) | Voice or chat SP encounters, "AI-Preceptor" coaching, educator rubrics incl. MIRS, deliberate-practice no-penalty mode, program analytics; partners UCSF, Weill Cornell, Yale, Ohio State, UVA, Michigan Dentistry; 80+ cases, 500+ students. No model vendor named. | https://medsimai.com/ , https://arxiv.org/html/2503.05793v1 |
| **ALYT** | EU (location not stated, EU-hosted, GDPR) | "Living" virtual patients across a shift with nurse handoffs and overnight phase; commit diagnosis before ordering; supervisor character; 9-point rubric across interviewing, exam, organization, counselling/management; live PubMed references; educator authoring; pilots with unnamed European faculties; controlled study from Sept 2026. No voice/avatar stated. | https://alyt.ai/ |
| **MedAscend** | not stated | Marketed as AI virtual patient platform for universities and hospitals; details thin. **Largely unverified.** | https://medascend.ai/ |
| **VRpatients** | US | No-code AI-driven VR/MR/web patient sims for EMS and nursing; claims backing from a top European medical school (vendor claim). | https://vrpatients.com/ |
| **Virti** | UK | VR + AI immersive learning with no-code editor; not medicine-specific. | https://sourceforge.net/software/medical-simulation/europe/ (listing) |
| **Northeastern VAPS** | US (academic) | $900K NSF RITEL grant (7 Oct 2026) for VR AI patients with speech, gaze, expressions, eye-tracking and heart-rate capture, faculty authoring tool to come. Research, not product. | https://news.northeastern.edu/2026/10/07/virtual-reality-system-healthcare-ai/ |
| **AIMS (research)** | US | Unity IPE sim on Gemini-2.5-Flash for pharmacy, medicine, nursing, social work; four participants, weak evidence. | https://pith.science/paper/2510.08891 |

Market-level evidence: a 2026 JMIR Med Educ framework paper on "digital standardized patients" notes AI-SPs can partially relieve SP resource limits but need IT infrastructure and platform investment: https://mededu.jmir.org/2026/1/e91050 . An April 2026 RCT on AI virtual SPs for history taking found benefit but did not assess cost-effectiveness: https://pmc.ncbi.nlm.nih.gov/articles/PMC13274040/ . A July 2026 BMC Med Educ IPE study found "AI-supported" facilitation in a commercial platform was really structured prompting, not adaptive AI (abstract via PubMed): https://pubmed.ncbi.nlm.nih.gov/42415032/

---

### 1.11 Osmosis (Elsevier)

Osmosis AI launched 3 March 2026: AI study companion grounded in Elsevier textbooks and Osmosis videos; every answer cited to a page or video section; flashcards (cloze, front/back, fill-in, exportable to Anki) and exam-style questions; faculty mode generates lesson plans, teaching tips and case prompts. Available in Osmosis MD, DO, PA and health professions tiers; pricing not stated; model vendor not named. Sources: https://www.prnewswire.com/news-releases/elsevier-launches-study-companion-osmosis-ai-to-transform-how-medical-students-learn-302701471.html , https://www.osmosis.org/blog/osmosis-product-updates-2026 . Not a simulator; relevant as the bar for cited, source-grounded explanations.

---

### 1.12 UpToDate Expert AI and OpenEvidence as reference layers

**UpToDate Expert AI (Wolters Kluwer).** Generative conversational layer over UpToDate content; available in the trainee subscription in US/Canada; trainee list price starts at $219/year; Pro Plus (includes Expert AI) reported at $699/year by third parties (**unverified**, store.uptodate.com is canonical). Sources: https://www.wolterskluwer.com/en/solutions/uptodate/pro/uptodate/uptodate-trainee-subscription , https://www.wolterskluwer.com/en/solutions/uptodate/pro/uptodate/uptodate-pro-plus , https://evidencemd.ai/blogs/clinical-ai-tools-pricing-access

**OpenEvidence.** Free for verified US clinicians, ad-funded. Funding: $75M Series A (Feb 2025, $1B), $210M (Jul 2025, $3.5B), $200M Series C (Oct 2025, $6B), $250M Series D (Jan 2026, $12B); about 760,000 registered US physicians and about 18M consultations/month by Dec 2025; content partners NEJM, JAMA Network, AMA, NCCN, AAFP, ACEP; Cedars-Sinai EHR integration (May 2026). Source: https://en.wikipedia.org/wiki/OpenEvidence and https://www.cnbc.com/2026/01/21/openevidence-chatgpt-for-doctors-doubles-valuation-to-12-billion.html (fetch blocked, seen in search). Products: DeepConsult reasoning agent (2025), succeeded by "Snow" in a model selector with "Osler" and "Sackett": https://www.openevidence.com/user-guide ; Visits (21 Aug 2025) real-time evidence inside the visit: https://www.openevidence.com/announcements/visits-real-time-medical-intelligence ; Voice Mode (21 May 2026), native speech-to-speech with interruptible answers, transcript and references for each spoken answer, free to all users: https://secure.businesswire.com/news/home/20260521555369/en/OpenEvidence-Launches-Voice-Mode-The-First-Native-Speech-to-Speech-Medical-AI . A reported Sept 2026 $250M round at $15B appears only on Sacra (**unverified**): https://sacra.com/c/openevidence/ . Underlying foundation-model vendor not disclosed. Student access: policy covers verified US healthcare professionals; explicit student terms **unverified**.

**Stanford-Harvard "State of Clinical AI" report (Jan 2026)** is the benchmark both AMBOSS and others cite: https://medicine.stanford.edu/news/stories/2026/01/clinical-ai-has-boomed.html (fetch failed with 503; seen in search, contents **unverified**).

---

### 1.13 Turkish and EU players

**Turkey.**
- **SimuleHasta** (developer: Bee Elektronik). Turkish-language platform with three patient types (real SP live, remote SP, AI patient 24/7), group/family/team-dynamics simulations, instant feedback on communication, empathy and clinical decisions, live camera recording and analysis, role-based interfaces (instructor, student, admin, technical), case design editor, mobile/tablet, KVKK compliance; cites Süleyman Demirel and Akdeniz medical faculties; free basic tier, institutional custom branding and integration. Sample cases dated Jan to May 2024; copyright 2026. No AI model, voice tech or pricing disclosed; the site is hosted on a pages.dev subdomain, and the listed phone number is a placeholder, so maturity is **unverified**. Source: https://medisim.pages.dev/
- **Kocaeli Sağlık ve Teknoloji Üniversitesi** built a "Hasta İletişim Simülasyon Platformu" (patient communication simulation) as a graduation project with post-encounter analysis of empathy, communication and questioning, aimed at medicine, nursing and midwifery students. University project, not a company. Sources: https://www.cagdaskocaeli.com.tr/foto/28258726/kocaeli-saglik-ve-teknoloji-universitesi-yapay-zeka-hasta-iletisim-simulasyon-platformu , https://www.bizimyaka.com/haber/28259092/saglik-ogrencileri-artik-sanal-hastalarla-pratik-yapacak
- **Aydın Adnan Menderes University** study (AIDS Care, 8 Sept 2026): ChatGPT-4o configured as a standardized patient living with HIV; 277 students did text interviews. Academic. Source: https://tibbiyebulteni.com/yapay-zeka-hasta-oldu-turkiyeden-dikkat-ceken-tip-egitimi-arastirmasi
- Body Interact (Turkish beta language) and PCS Spark (Turkish listed) are the only commercial products found that advertise Turkish AI patients (sources in 1.1 and 1.8). No funded Turkish AI-SP startup was found; **gap confirmed as of search date.**

**EU.** ALYT (EU-hosted, pilots with European faculties), Lecturio (Germany), AMBOSS (Germany), Body Interact (Portugal), OMS and Geeky Medics SimChat (UK), SimConverse customers in UK/EU. A French OSCE dialogue dataset and controllable virtual patient system was published on arXiv in June 2026 (academic): https://arxiv.org/pdf/2606.28526 . No EU product found that combines an Epic-like EHR with AI patients.

---

## 2. Synthesis: where the industry standard sits in October 2026

1. **Free-text AI patients are table stakes, but mostly text-first with voice bolted on.** Body Interact (Llama, beta), OMS Hands & Voice (LLM, voice), PCS Spark (proprietary LLM, voice), Aquifer VPEs (23 encounters), SimChat, SimConverse, MedSimAI all ship them. Shadow Health and i-Human still describe NLP/menu models. Sources: sections 1.1 to 1.10.
2. **Nobody discloses the model stack except Body Interact (Llama) and SimChat (GPT, via third party).** Vendor lock-in and unauditable grading are the norm.
3. **Video avatars with lip-sync exist (SimChat, SimConverse photorealistic avatars) but real-time generation is still expensive**; research comparisons favoured HeyGen for lip-sync with 10 to 20 minute generation unless using real-time tier: https://arxiv.org/html/2405.19941
4. **EHR fidelity is the biggest hole.** No competitor fetched describes an Epic-like chart with orders, results, MAR, notes and imaging viewer as the primary interaction surface. Shadow Health offers "EHR documentation" practice; i-Human has a structured case player; Body Interact has an order panel inside a game UI.
5. **Multiplayer IPE is VR-centric** (SimX, OMS Interprofessional) or audio/text side-channel (PCS TeamSpace). No browser-native, role-differentiated (MD, RN, PharmD, RT) shared-patient room with a shared EHR was found.
6. **Assessment** is converging on framework-anchored communication scoring (Calgary-Cambridge, SEGUE, Kalamazoo at Body Interact; MIRS at MedSimAI; 9-point rubric at ALYT; NCSBN CJMM alignment at i-Human; AACN Essentials at Shadow Health) plus AI-written narrative feedback. Few publish psychometrics; the BMC Med Educ paper shows "AI-supported" is often templated.
7. **Reference layers set the citation bar**: OpenEvidence (NEJM/JAMA cited, voice mode, free), AMBOSS AI Mode (link-out, disagreement flagging, honest misses), Osmosis AI (page-level citations). In-sim "attending tips" must match this.
8. **Integration**: LTI 1.3 two-way grade passback (PCS), SSO + LTI (SimConverse), SOC 2 / ISO 27001 / GDPR / FERPA badges (SimConverse, SimChat, Body Interact ISO 27001) are becoming required for procurement.
9. **Pricing** is opaque everywhere except Aquifer ($125/yr student) and UpToDate trainee ($219/yr); per-seat per-year with minimums is the norm.
10. **Turkey and most of the EU have no incumbent** combining AI patients, EHR and team rooms; Turkish is only a beta language at two foreign vendors.

### Best in class per capability (Oct 2026) and how AcuDx exceeds it

| Capability | Current best in class (source) | AcuDx target to exceed |
|---|---|---|
| Case generation | PCS AI/Scenarios from a text prompt (https://www.pcs.ai/spark); SimChat from SP scripts and OSCE mark schemes (https://app.simchat.ai/blog/medical-simulation-with-virtual-patients/); OMS Create no-code editing incl. physiology and imaging | Generate a full case bundle in one pass: patient persona, longitudinal chart (prior encounters, meds, allergies), guideline-grounded physiology timeline, labs/imaging with report text, rubric, and role scripts for each profession; store as open JSON schema so faculty can diff, version and share; cite the guideline used for every expected action (see `05-clinical-guideline-grounding.md`) |
| Patient voice | OpenEvidence native speech-to-speech with interruption (https://secure.businesswire.com/news/home/20260521555369/en/...); PCS emotional speech styles, 15 languages incl. Turkish | Duplex, interruptible voice with emotion and physiology-conditioned prosody (dyspnea, pain, confusion), first-class Turkish and English, latency budget under 800 ms; open model stack per `02-voice-ai.md` and `11-fully-open-source-stack.md` |
| Video / avatar | SimChat video avatars with lip-sync; SimConverse photorealistic avatars | Real-time talking avatar driven by the same physiology state (pallor, sweating, posture) in the browser, no headset; see `12-realtime-talking-avatars-2026.md`; make avatar optional so low-bandwidth sites still run |
| EHR UI | Shadow Health EHR documentation; i-Human structured case player; Body Interact order panel | Epic-like chart as the primary surface: Storyboard, problem list, orders with order sets, results trending, MAR with barcode scan step, notes with templates, imaging viewer, flowsheets, in-basket; log every click as an assessable action; this is the gap no competitor fills |
| Assessment | Body Interact four-domain communication scoring on Calgary-Cambridge/SEGUE/Kalamazoo; MedSimAI MIRS rubrics; ALYT 9-point rubric; Aquifer expert-reasoning comparison | Dual-channel scoring: deterministic action rubric from EHR event log (timeliness, correctness, omissions, harm) plus LLM communication scoring with published prompts, inter-rater reliability reported, and faculty override with audit trail; export to competency frameworks (EPA, CJMM, AACN, Turkish UÇEP) |
| Imaging | OMS Create imaging fields; Aquifer Radiology course; Body Interact test ordering | DICOM-style viewer with window/level, series scroll and report release timing; synthetic or openly licensed images tagged to the case; the learner must read the image before the report is released |
| Interprofessional rooms | SimX patented VR multiplayer (4+ learners); OMS Interprofessional remote teams; PCS TeamSpace audio/text | Browser-native rooms with role-specific EHR views and permissions (physician orders, nurse administers, pharmacist verifies, RT manages vent), shared patient state, closed-loop communication detection, team debrief with per-role timelines; no headset needed |
| Dean / program dashboards | SimConverse rubric heatmaps institution-wide; SimX exportable reports; Aquifer 2026 reporting tools | Cohort heatmaps by competency, drill to individual event logs, longitudinal trajectories, equity breakdowns, accreditation export packs (LCME, ACGME, YÖKAK/TEPDAD for Turkey), all queryable via open API |
| LTI / SSO | PCS two-way LTI 1.3 with Canvas/Moodle/Blackboard; SimConverse SSO + LTI, SOC 2 / ISO 27001 / GDPR / FERPA | LTI 1.3 Advantage (Deep Linking, NRPS, AGS grade passback), SAML and OIDC SSO, SCIM provisioning, KVKK and GDPR data residency options, self-hostable; publish a security whitepaper rather than badges only |
| Reference layer / attending tips | AMBOSS AI Mode (link-out, flags disagreement, admits misses); OpenEvidence (NEJM/JAMA citations, voice); Osmosis AI (page-level citations) | Context-aware attending tip panel inside the chart that cites the open guideline passage, flags when guidance differs by region (US vs EU vs Turkish), and logs tip usage as a learning signal without giving away the answer |
| Transparency / openness | Body Interact names Llama; everyone else closed | Open source, documented model routing (`01-llm-models-and-cost.md`, `08-open-source-model-stack.md`), reproducible grading, published eval sets |
| Pricing | Aquifer $125/yr student; UpToDate trainee $219/yr; others quote-only | Public pricing page, free self-host, hosted per-seat tier below $100/yr for students, institutional tier with transparent minimums |

### Concrete list: how AcuDx should exceed each competitor

1. Ship the Epic-like EHR as the interaction surface, not a side panel (no competitor does this).
2. Make every patient conversation open-stack and auditable: name the models, publish prompts and grading rubrics.
3. Offer duplex voice with interruption and emotional prosody in Turkish and English at launch; competitors treat Turkish as beta.
4. Build browser multiplayer with real role permissions and a shared chart; current IPE products are VR-bound or side-channel chat.
5. Pair deterministic event-log scoring with LLM communication scoring and publish reliability statistics; no competitor publishes psychometrics.
6. Include an imaging viewer with report-release timing; most competitors return results as text.
7. Provide an in-chart attending-tip layer that matches AMBOSS/OpenEvidence citation standards and records help-seeking.
8. Deliver dean dashboards with accreditation export packs for LCME, ACGME and Turkish bodies; competitors stop at heatmaps.
9. Implement LTI 1.3 Advantage, SAML/OIDC, SCIM and EU/Turkish data residency; only PCS and SimConverse advertise LTI today.
10. Publish pricing and allow free self-hosting; the market is almost entirely quote-only.
11. Author cases as open, versioned JSON with guideline citations so faculties can share a commons, unlike closed libraries of 50 to 1,500 scenarios.
12. Position for Turkey and the EU first, where no incumbent combines AI patients, EHR and team rooms.

---

## 3. Source list (all fetched or seen in search results on 2026-10-19)

- https://bodyinteract.com/virtual-patient-simulator/
- https://help.bodyinteract.com/body-interact-simulator-app/understand-ai-driven-conversations-beta/
- https://www.pocketnurse.com/dmacc/11-98-7624p-body-interact-for-nursing-education-basic-package-one-year-subscription
- https://www.pocketnurse.com/default/11-98-7626p-body-interact-for-nursing-education-premium-package-one-year-subscription
- https://thenextweb.com/news/oxford-medical-simulation-secures-5m-growth-financing
- https://oxfordmedicalsimulation.com/artificial-intelligence-in-healthcare-simulation-the-why-and-how/
- https://oxfordmedicalsimulation.com/platform/hands-voice/
- https://oxfordmedicalsimulation.com/platform/
- https://media-and-learning.eu/interprofessional-vr-simulation-introducing-oms-interprofessional/
- https://www.healthysimulation.com/oms-create-vr-clinical-simulation-scenario-authoring/
- https://www.unboundmedicine.com/oadn/view/Virtual%20Simulation%20Reviews/2455046/all/Oxford_Medical_Simulation
- https://kaplan.com/institutions-educators/higher-education/nursing-schools/i-human
- https://kaplan.com/about/press-media/kaplan-acquires-i-human-patients-a-leader-in-virtual-interactive-medical-simulations
- https://www.sramanamitra.com/?p=93240
- https://aquifer.org/learner-subscriptions
- https://aquifer.org/aquifer-news-and-events/vpes-reflect-clinical-variety
- https://aquifer.org/aquifer-news-and-events/8-new-vpes-support-skill-development
- https://aquifer.org/aquifer-news-and-events/aquifers-2026-innovations
- https://www.elsevier.com/products/shadow-health
- https://www.elsevier.com/en-au/products/shadow-health
- https://www.elsevier.com/about/press-releases/elsevier-launches-shadow-health-lab-with-virtual-reality-to-transform-clinical-education-for-nursing-students
- https://academicresearchbureau.com/shadow-he/
- https://www.lecturio.com/inst/healer/how-it-works/
- https://www.lecturio.com/inst/healer/
- https://www.lecturio.com/blog/ai-study-tools-for-med-students-can-they-help-you-pass-boards-in-2026/
- https://www.healthysimulation.com/webinars/knowledge-practice-clinical-reasoning-applied-skill-lecturio-virtual-simulation/
- https://physicianaitools.com/companies/lecturio/
- https://www.amboss.com/us/clinical-ai-mode
- https://support.amboss.com/hc/en-us/articles/33872741080081-AMBOSS-GPT
- https://www.pcs.ai/spark
- https://help.pcs.ai/en/articles/7239038-student-s-guide-to-pcs-spark-in-the-browser
- https://help.pcs.ai/en/articles/7869016-student-s-guide-to-pcs-spark-in-vr
- https://www.simxvr.com/platform/
- https://www.healthysimulation.com/expanding-rural-healthcare-simulation-simx-virtual-reality-vr/
- https://www.healthysimulation.com/simx-vr-ipe-competency-based-education-nursing/
- https://www.simconverse.com/
- https://www.businessnewsaustralia.com/articles/folklore--artesian-back--1-5m-seed-round-for-ai-powered-medtech-simconverse.html
- https://app.simchat.ai/blog/medical-simulation-with-virtual-patients/
- https://geekymedics.com/virtual-patient-avatars/
- https://www.remnote.com/blog/best-ai-tools-for-medical-students
- https://medsimai.com/
- https://arxiv.org/html/2503.05793v1
- https://alyt.ai/
- https://medascend.ai/
- https://vrpatients.com/
- https://news.northeastern.edu/2026/10/07/virtual-reality-system-healthcare-ai/
- https://pith.science/paper/2510.08891
- https://mededu.jmir.org/2026/1/e91050
- https://pmc.ncbi.nlm.nih.gov/articles/PMC13274040/
- https://pubmed.ncbi.nlm.nih.gov/42415032/
- https://arxiv.org/html/2405.19941
- https://www.prnewswire.com/news-releases/elsevier-launches-study-companion-osmosis-ai-to-transform-how-medical-students-learn-302701471.html
- https://www.osmosis.org/blog/osmosis-product-updates-2026
- https://www.wolterskluwer.com/en/solutions/uptodate/pro/uptodate/uptodate-trainee-subscription
- https://www.wolterskluwer.com/en/solutions/uptodate/pro/uptodate/uptodate-pro-plus
- https://evidencemd.ai/blogs/clinical-ai-tools-pricing-access
- https://en.wikipedia.org/wiki/OpenEvidence
- https://www.cnbc.com/2026/01/21/openevidence-chatgpt-for-doctors-doubles-valuation-to-12-billion.html
- https://www.openevidence.com/user-guide
- https://www.openevidence.com/announcements/visits-real-time-medical-intelligence
- https://secure.businesswire.com/news/home/20260521555369/en/OpenEvidence-Launches-Voice-Mode-The-First-Native-Speech-to-Speech-Medical-AI
- https://sacra.com/c/openevidence/
- https://medicine.stanford.edu/news/stories/2026/01/clinical-ai-has-boomed.html
- https://medisim.pages.dev/
- https://www.cagdaskocaeli.com.tr/foto/28258726/kocaeli-saglik-ve-teknoloji-universitesi-yapay-zeka-hasta-iletisim-simulasyon-platformu
- https://www.bizimyaka.com/haber/28259092/saglik-ogrencileri-artik-sanal-hastalarla-pratik-yapacak
- https://tibbiyebulteni.com/yapay-zeka-hasta-oldu-turkiyeden-dikkat-ceken-tip-egitimi-arastirmasi
- https://arxiv.org/pdf/2606.28526
- https://sourceforge.net/software/medical-simulation/europe/
