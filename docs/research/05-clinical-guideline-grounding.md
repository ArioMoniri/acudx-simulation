# 05 — Clinical-Guideline Grounding Engine

**Scope:** How AcuDx keeps its guidance mode (AMBOSS-like Socratic hints) and its case/patient correctness grounded in **current, country-specific, evidence-based** clinical guidelines — and does so **legally** and **medically safely**. Design target: state of the art as of **July 2026**.

**Non-negotiables that drive every decision below:**
1. AcuDx is an **education/simulation** tool, not a clinical decision support system (CDSS) for real patients. This is our single biggest safety and regulatory lever — it keeps us out of FDA SaMD / EU MDR device territory *as long as we never output patient-specific management advice to a treating clinician*. Guardrails must preserve this boundary.
2. Guidance content must be **grounded, cited, versioned, and country-parameterized**. An ungrounded LLM "hint" that contradicts current ATLS/AHA/ESC is a product-killing failure, not a cosmetic bug.
3. Most authoritative guidelines are **copyrighted**. We build on **licensed**, **open**, or **partner** sources — never on scraped proprietary PDFs.

---

## 1. Guideline sources per domain, and how country variants diverge

The core problem: for the same clinical situation, the "correct" answer legitimately differs by country because different bodies issue different guidelines. AcuDx must model this explicitly with a **country parameter**, not pretend one global truth exists.

### 1.1 Trauma

| Source | Body | Status (Jul 2026) | License reality |
|---|---|---|---|
| **ATLS 11th ed.** | American College of Surgeons (ACS) | Launched **Jul 2025**, 11th edition ([ACS](https://www.facs.org/quality-programs/trauma/education/advanced-trauma-life-support/atls-11/)) | **Proprietary**, copyrighted to ACS (© editions 1980→2018→2025). Course + manual sold via ACS. **No public reuse license.** |
| **European Trauma Course (ETC)** | European Resuscitation Council / ETC Org | Active; team-based, modular, adaptable to regional needs, taught in native languages ([PMC10955415](https://pmc.ncbi.nlm.nih.gov/articles/PMC10955415/)) | Course IP; materials proprietary. |
| **National trauma guidelines** | e.g. NICE NG39 (UK major trauma), TARN; German S3-Leitlinie Polytrauma (AWMF); RCS/JRCALC (UK prehospital) | Varies | NICE = favorable open license (UK use); AWMF S3 = generally freely readable German-language PDFs; JRCALC = licensed. |

**Divergence example that matters in-sim:** ATLS is surgeon-led and dominates where trauma care sits with surgery; ETC is a team-training model with higher adoption where emergency medicine is an established specialty ([PMC10955415](https://pmc.ncbi.nlm.nih.gov/articles/PMC10955415/)). A "correct" trauma team choreography in a German ETC-adopting center differs from a US ATLS center. AcuDx's `country`/`system` parameter must select the right choreography and terminology (e.g. permissive hypotension thresholds, TXA timing windows, whole-blood vs component resuscitation all have regional variation).

### 1.2 Resuscitation (cardiac arrest / ALS / BLS)

The resuscitation world is unusually clean because it is **pyramidal**:

- **ILCOR** publishes the **2025 CoSTR** (Consensus on Science with Treatment Recommendations) — the shared evidence base, Oct 2025 ([AHA Professional](https://professional.heart.org/en/science-news/2025-international-consensus-on-cardiopulmonary-resuscitation-and-ecc-science-treatment)).
- **AHA 2025 Guidelines** (Circulation, Oct 2025) and **ERC 2025 Guidelines** (Resuscitation, launched 22 Oct 2025, Rotterdam) both derive from that CoSTR ([AHA Part 9 ALS](https://www.ahajournals.org/doi/10.1161/CIR.0000000000001376); [ERC 2025](https://www.erc.edu/science-research/guidelines/guidelines-2025/guidelines-2025-english/)).
- National councils (Resuscitation Council UK, Australian & NZ Resuscitation Council, etc.) localize ERC/AHA.

**Design implication:** model resuscitation as **ILCOR CoSTR (shared science) → {AHA, ERC} regional recommendation → national council localization**. Store the CoSTR-level evidence once; attach regional deltas. 2025 changes AcuDx must reflect: vasopressor choice, ventilatory goals, temperature control (not "targeted temperature 33°C" dogma), coronary angiography/PCI timing, seizure/post-arrest myoclonus, survivorship ([AHA Part 11](https://www.ahajournals.org/doi/10.1161/CIR.0000000000001375)). **AHA vs ERC differ** on drug sequencing details, compression-to-ventilation nuance, and prognostication windows — a solo-vs-AI "run this arrest" scenario must be scored against the learner's selected council.

### 1.3 Sepsis

- **Surviving Sepsis Campaign (SSC) 2026** — joint SCCM + ESICM, published Mar 2026 in *Critical Care Medicine*. **129 statements, 46 new**, updating the 2021 guideline; panel of 69 from 23 countries, 38% LMIC ([SCCM](https://www.sccm.org/clinical-resources/guidelines/guidelines/surviving-sepsis-campaign-international-guidelines-for-management-of-sepsis-and-septic-shock-2026); [ESICM](https://www.esicm.org/2026-surviving-sepsis-campaing-guidelines/)).
- National overlays exist, e.g. German **S3 sepsis guideline, 2025 update** ([PMC12708846](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12708846/)), and NICE sepsis (NG51). These differ on **screening tools** (qSOFA vs NEWS2), **bundle timing** (1-hr vs 3-hr), and antibiotic stewardship framing.

**In-sim consequence:** an "hour-1 bundle" scored to US/SSC differs from a NEWS2-triggered UK pathway. Store SSC 2026 as the base; NEWS2 and NICE bundle timing as a UK overlay.

### 1.4 Cardiology (huge, high-divergence domain)

The cleanest teaching example of **legitimate country disagreement**:

- **Hypertension:** **2025 AHA/ACC** keeps diagnosis + treatment threshold at **130/80 mmHg**, risk-first, lifetime-CV-risk framing ([JACC at-a-glance](https://www.jacc.org/doi/10.1016/j.jacc.2025.07.010)). **2024 ESC** keeps **140/90 mmHg** for diagnosis/therapy, introduces an "Elevated" band 120–139/70–89 treated **by CV risk**, favoring calibrated intensity to avoid overtreatment/polypharmacy ([AHA Hypertension review](https://www.ahajournals.org/doi/10.1161/HYPERTENSIONAHA.124.24173)).
- Beyond HTN, **ESC vs ACC/AHA** diverge across HF, ACS/NSTEMI, AF anticoagulation thresholds, lipid targets, and syncope. There is no single right answer; there is a right answer **per selected guideline body**.

**This is the canonical case for country parameterization.** A learner who diagnoses "hypertension" at 135/85 is correct under AHA/ACC and *incorrect* under ESC. AcuDx must score against the **case's declared guideline context**, surface *why* the answer differs across bodies (a genuinely valuable teaching moment), and never silently assume US defaults.

### 1.5 Other domains (breadth plan)

Stroke (AHA/ASA vs ESO), asthma/COPD (GINA/GOLD — both are *global*, low-divergence, and comparatively license-friendly), diabetes (ADA Standards of Care, annually updated, vs country bodies), obstetrics (ACOG vs RCOG vs FIGO), pediatrics (APLS/PALS). Prioritize by (a) case volume in Emergency Medicine, (b) license accessibility, (c) divergence risk. **GINA/GOLD/WHO** are good early wins: global, updated, and more openly reusable than ATLS.

---

## 2. Licensing & copyright reality — and compliant strategies

**Hard truth:** the highest-authority guidelines are copyrighted and *not* free to redistribute or fine-tune on. Ignoring this is existential legal risk. The market already validated that **the moat is licensed content, not the model**: OpenEvidence licensed **300+ peer-reviewed journals** (NEJM full archive since 1990, JAMA, Cochrane, NCCN) and forces a citation on every answer; it hit a **$12B valuation** (Series D, Jan 2026) and is used daily by **>40% of US physicians** ([Pebblous analysis](https://blog.pebblous.ai/report/openevidence-medical-ai-data-moat/en/); [OpenEvidence×NEJM](https://www.openevidence.com/announcements/openevidence-and-nejm)). Wolters Kluwer's **UpToDate** is pursuing the "trusted knowledge layer under every AI" strategy — **Microsoft embedded UpToDate into Dragon Copilot / M365 Copilot / Teams (Mar 2026)** ([iatroX](https://www.iatrox.com/blog/openevidence-europe-alternatives-clinical-ai-search)). The lesson for AcuDx: **content rights are the product moat and the compliance boundary**.

### 2.1 The copyright spectrum (what we may/may not do)

| Tier | Examples | May we ingest full text? | May we fine-tune on it? | Strategy |
|---|---|---|---|---|
| **Proprietary, closed** | ATLS 11, UpToDate, AMBOSS, most society CME manuals | **No** (without a license) | **No** | Partner/license, or cite + link only. Never scrape. |
| **Copyrighted but publicly published** | ESC/AHA/ACC guideline articles, SSC, ILCOR CoSTR, ERC | Read/quote-limited under fair use for **education**; **redistribution needs permission** | **No** by default | RAG over **our own summaries/structured extractions**; cite + deep-link to source. |
| **Favorable open/gov license** | **NICE** (UK Open Content Licence — free for UK use; **international use requires a paid license + agreement**), WHO guidelines (CC BY-NC-SA typical), CDC, USPSTF, GINA/GOLD reports | Yes, per license | Often yes for NC use — **check each** | Ingest fully; machine-readable via **NICE Syndication REST API** (daily XML) ([NICE API guide](https://www.nice.org.uk/corporate/ecd10)). |
| **Aggregators/registries** | **GIN International Guidelines Library** (free to access, powered by EBSCO), Trip, ECRI Guidelines Trust | Metadata + discovery, then follow to source | No | Use for **coverage discovery + provenance**, not bulk text. |

NICE detail that matters: **no fee for UK-only use** under the NICE UK Open Content Licence; **international reuse is fee'd and requires an agreement** ([Reusing NICE content](https://www.nice.org.uk/reusing-our-content)). Since AcuDx is multi-country, budget for the NICE international license the moment UK content ships outside the UK.

### 2.2 Four compliant grounding strategies (use all four, layered)

1. **Original structured summaries.** AcuDx clinical staff (and models under clinician review) author **our own** condensed, structured representations of a guideline's *recommendations* (facts and thresholds are not copyrightable; specific expression is). We store *our* text, cite the source, and deep-link. This is the workhorse and is what lets us legally power RAG.
2. **Official partnerships / licenses.** Pursue formal licenses where the content is load-bearing and proprietary: ACS for ATLS-aligned trauma content; a Wolters Kluwer/UpToDate or AMBOSS content-API deal; NICE international license. Partnerships also confer **credibility** (the OpenEvidence×NEJM playbook).
3. **Open sources first.** Default new domains to WHO/GINA/GOLD/USPSTF/CDC/NICE(UK) so we can ingest full text cleanly, and only license proprietary content where openly-licensed equivalents are inadequate.
4. **Cite + link, never copy.** Every guidance fragment carries a citation to the *primary* guideline with a stable deep link. We display the citation; we do not reproduce copyrighted paragraphs verbatim beyond fair-use snippet length.

**Explicit prohibitions (engineering guardrails):** no scraping of ATLS/UpToDate/AMBOSS PDFs into the vector store; no fine-tuning base models on copyrighted full text; no verbatim reproduction beyond short attributed quotes; no presenting summarized content as the society's official words.

---

## 3. Versioned, country-parameterized knowledge architecture

### 3.1 Data model — the `GuidelineStatement` as the atomic unit

Do **not** store PDFs as opaque blobs. Store **atomic, structured recommendation records**:

```jsonc
{
  "statement_id": "ssc-2026-abx-0047",
  "domain": "sepsis",
  "topic": "antibiotic_timing",
  "claim": "Administer antimicrobials within 1 hour for septic shock.",
  "strength": "strong",                 // strong | conditional
  "certainty": "moderate",              // GRADE certainty of evidence
  "source": {
    "body": "SSC",                      // ILCOR | AHA | ERC | ESC | ACC/AHA | NICE | WHO | ACS...
    "title": "Surviving Sepsis Campaign 2026",
    "citation": "Crit Care Med. 2026;54(4)...",
    "url": "https://www.sccm.org/...",
    "pub_date": "2026-03",
    "license": "copyrighted-summarized" // open | licensed | copyrighted-summarized | partner
  },
  "version": "2026.1",
  "supersedes": "ssc-2021-abx-0031",
  "applies_to": {
    "countries": ["US","GLOBAL"],
    "council_scope": "SSC",
    "population": "adult",
    "care_setting": ["ED","ICU"]
  },
  "overlays": [ {"country":"UK","overlay_ref":"nice-ng51-abx","note":"NEWS2 trigger; 3-hr framing"} ],
  "review": { "clinician_reviewer":"...", "reviewed_at":"2026-04-10", "status":"approved" },
  "conflicts_with": ["esc-... (different HTN threshold)"]
}
```

Key properties this buys us:
- **Provenance on every atom** (body, citation, URL, license tier, pub date).
- **Versioning + supersession chains** — event-sourced; a new edition *supersedes* prior statements without deleting them (needed for "score this the way it was taught in 2024" and for audit).
- **Country/council scoping + overlays** — the same `topic` can hold parallel statements per body (ESC 140/90 *and* AHA/ACC 130/80), each independently cited.
- **Explicit `conflicts_with`** — surfaces legitimate cross-country disagreement instead of hiding it.

### 3.2 Storage & retrieval stack

- **Structured store:** the `GuidelineStatement` records live in a relational/document store (Postgres + JSONB) — the authoritative, queryable source of truth. This is what clinician reviewers curate.
- **Vector index for retrieval:** embed each statement's `claim` + context into a vector DB for semantic retrieval (hybrid **dense + BM25**, which the medical-RAG literature repeatedly finds outperforms dense-only; see MEGA-RAG's dense+BM25+KG design ([Frontiers 2025](https://www.frontiersin.org/journals/public-health/articles/10.3389/fpubh.2025.1635381/full))). AcuDx already runs an HNSW-capable memory layer — reuse it.
- **Retrieval is filtered, then ranked.** Always **hard-filter by `country`/`council` + `domain` + `population` first**, then semantic-rank within that scope, then **cross-encoder rerank**. Filtering before ranking is what prevents "US answer leaking into a UK case."

### 3.3 Freshness & update cadence

Guidelines update on real calendars — build a **watch pipeline**, don't rely on training data:

| Source | Cadence | Trigger |
|---|---|---|
| ICD-10-CM/PCS | **Annually, Oct 1** (FY2026 in effect 2025-10-01→2026-09-30) | Automated (via ICD MCP, §5) |
| ILCOR/AHA/ERC | ~5-yr major (2020→2025), continuous CoSTR updates | Watch ILCOR CoSTR feed |
| ESC | Annual congress (Aug/Sep) drops | Watch ESC publication feed |
| ACC/AHA | Rolling per-topic | Watch Circulation/JACC |
| SSC | ~Every few years (2021→2026) | Watch SCCM/ESICM |
| NICE | Rolling, ~monthly | **NICE Syndication API daily XML poll** |

Implement as scheduled jobs that (1) detect a new/changed guideline, (2) open a **review task**, (3) *never* auto-publish clinical content — a human clinician must approve before it goes live. Stale content is flagged in-product with a "last reviewed" date.

### 3.4 Human clinical review & conflict resolution

- **Clinician-in-the-loop is mandatory** for every statement's `approved` status. No guideline atom reaches learners unreviewed. This is both a safety control and, practically, the thing that lets us summarize copyrighted guidelines defensibly (human editorial judgment).
- **Conflict resolution policy** when countries disagree: **do not merge or average.** Keep both statements, tag each with its body, and let the **case context** (declared country/council) select which one scores. In guidance mode, when a divergence is pedagogically relevant, *show both* ("US: 130/80; ESC: 140/90 — here's why"). Silent US-defaulting is a bug.
- **Governance:** a small clinical editorial board owns the review workflow, a versioned changelog, and a documented escalation path for contested statements.

---

## 4. Medical accuracy & hallucination mitigation

The systematic-review consensus (70 studies, 2020–2025) is blunt: **RAG grounding measurably reduces hallucination but does not eliminate it**, and naive RAG can still produce unfaithful or mis-cited answers ([PMC12157099](https://pmc.ncbi.nlm.nih.gov/articles/PMC12157099/); [large-scale expert eval, arXiv 2511.06738](https://arxiv.org/pdf/2511.06738)). So we layer defenses:

**Defense-in-depth pipeline (every guidance/scoring output passes through this):**

1. **Retrieval-grounded generation.** The generator model may only use retrieved `GuidelineStatement`s as its factual basis; the system prompt forbids drawing clinical facts from parametric memory. Retrieve → filter by country → rerank → generate.
2. **Citation enforcement (hard gate).** Every clinical claim in the output must map to a retrieved statement_id. Outputs with unsupported clinical claims are **rejected/regenerated**, not shown. This mirrors OpenEvidence's "citation on every answer" discipline — proven at scale.
3. **Verifier / faithfulness model (second pass).** A separate model (or the same model in a distinct verifier role) checks each sentence: *is this entailed by the cited statement?* This "trust-but-verify" post-hoc audit / multi-agent feedback pattern is the current best practice for medical hallucination mitigation ([arXiv 2606.14149](https://arxiv.org/pdf/2606.14149)). Fail → regenerate or downgrade to "I can't ground this."
4. **Out-of-scope refusal.** If retrieval returns nothing above a relevance threshold for the selected country/domain, **refuse** ("No grounded guideline statement available for this in {country} — here's a link to search") rather than improvising. Abstention > confident wrong answer (cf. determinability work, [ClinDet-Bench](https://arxiv.org/pdf/2602.22771)).
5. **Clinician-in-the-loop content, red-team scenarios.** Curated content is clinician-approved (§3.4). Separately, a **red-team suite** of adversarial cases (drug doses, pediatric weight-based calcs, contraindications, country-threshold traps like 135/85 HTN) runs in CI against every model/prompt/version change. Any regression blocks release.
6. **Disclaimers + role boundary.** Every guidance surface carries an **education-only, not-for-patient-care** disclaimer. This is legally load-bearing: it keeps AcuDx a training tool, not a regulated CDSS. The AI must never output patient-specific management advice framed for a real patient.

**Model routing for cost:** verifier and citation-check passes should run on a **cheaper/faster tier**; only the generative hint and complex reasoning warrant a frontier model. (Detailed $/1M-token routing lives in the model-selection doc; here the rule is: *grounding checks are cheap-tier, generation is where you spend.*)

**Special-cased high-risk outputs:** drug doses, weight-based pediatric dosing, and any numeric threshold get an **extra deterministic check** (unit + range validation) beyond the LLM verifier. Never trust an LLM alone for a mg/kg calculation.

---

## 5. Enriching cases with medical MCP tools

AcuDx can use available medical MCP tools to make simulated cases **richer, internally consistent, and free of hand-authored errors** — used at **authoring time** (offline, reviewed) far more than at runtime, to keep latency and cost down.

| MCP tool | Use in AcuDx |
|---|---|
| **ICD-10 (CM/PCS, FY2026)** | Tag every case's diagnosis + procedures with valid, billable, date-correct codes (`validate_code`, `lookup_code`). Powers the "map missed items to competencies + coding" gap analysis and keeps the code set auto-current each Oct 1. |
| **ChEMBL (drug/compound)** | Populate drug protocols and distractors with real mechanism, bioactivity, ADMET data; generate plausible pharmacology for the "order & interpret" step and for medication-safety red-team cases. |
| **PubMed** | Pull primary-literature citations behind a guideline statement; enrich guidance-mode "why" explanations with real references; check `get_copyright_status` before surfacing full text. |
| **ClinicalTrials.gov** | Add realism to advanced cases (eligibility criteria, endpoints); source teaching points on emerging management. |
| **bioRxiv/medRxiv, variant/oncology MCPs** | Niche enrichment for specialized tracks (e.g. precision-oncology EPAs); keep behind clinician review — preprints are **not peer-reviewed**. |

**Rule:** MCP-enriched content is **generated at authoring time and clinician-reviewed** before publication. Runtime MCP calls are limited to cheap, deterministic lookups (e.g. validating an ICD code the learner entered), never for grounding clinical guidance on the fly.

---

## 6. Recommended AcuDx guideline-grounding architecture

```
                    ┌──────────────────────────────────────────────┐
   SOURCES          │  INGEST + CURATE (offline, clinician-in-loop) │
   ─────────        │                                              │
   Open (WHO,GINA,  │  Watch feeds ─▶ change detected ─▶ REVIEW    │
   NICE-UK API,     │  TASK ─▶ author STRUCTURED SUMMARY ─▶        │
   USPSTF,CDC)      │  clinician APPROVE ─▶ GuidelineStatement     │
   Licensed (NICE   │  (versioned, country-scoped, cited, MCP-     │
   intl, partners)  │   enriched: ICD/ChEMBL/PubMed)               │
   Copyrighted →    └───────────────┬──────────────────────────────┘
   summarize+cite                   │
                                     ▼
                    ┌──────────────────────────────────────────────┐
                    │  GUIDELINE STORE                             │
                    │  Postgres(JSONB) = source of truth           │
                    │  + Vector index (dense+BM25, HNSW) for RAG   │
                    └───────────────┬──────────────────────────────┘
                                     │  (filter: country/council/domain/pop → rank → rerank)
                                     ▼
   RUNTIME          ┌──────────────────────────────────────────────┐
   ───────          │  GROUNDED GENERATION PIPELINE                │
   case+role+       │  retrieve ─▶ generate hint/score (frontier)  │
   country ─────────▶  ─▶ CITATION GATE ─▶ VERIFIER (cheap tier)   │
   +learner turn    │  ─▶ deterministic dose/threshold check       │
                    │  ─▶ out-of-scope? REFUSE                     │
                    │  ─▶ attach citations + disclaimer            │
                    └───────────────┬──────────────────────────────┘
                                     ▼
                    Guidance hints / feedback / D-K calibration,
                    each with source citation + "last reviewed" date
```

**Concrete recommendations:**

- **R1 — Build the `GuidelineStatement` atom + versioned country-scoped store first.** Everything (scoring, guidance, gap analysis, D-K calibration) reads from it. Postgres/JSONB truth + HNSW vector index.
- **R2 — Ship open-license domains first** (WHO/GINA/GOLD/USPSTF/CDC/NICE-UK), where we can legally ingest full text and stand up RAG cleanly. Defer ATLS/UpToDate/AMBOSS to licensing deals.
- **R3 — Country parameter is first-class, not an afterthought.** Filter retrieval by country/council *before* ranking. Store ESC and AHA/ACC (and NICE overlays) as parallel, independently-cited statements; expose divergence as a teaching feature.
- **R4 — Hard citation gate + cheap-tier verifier + deterministic numeric checks + out-of-scope refusal** on every runtime output. Abstain rather than hallucinate.
- **R5 — Clinician-in-the-loop is a required pipeline stage**, not a nice-to-have. It is simultaneously our safety control and our copyright defense for summarizing proprietary guidelines.
- **R6 — Content licensing is the moat and the compliance boundary** (OpenEvidence proved it). Budget for NICE international + ≥1 proprietary partner (ACS trauma and/or UpToDate/AMBOSS). Never scrape.
- **R7 — Automated freshness watch** on every source (esp. NICE Syndication daily XML, ICD Oct-1 refresh, ESC congress, ILCOR CoSTR) opens review tasks; **no auto-publish** of clinical content.

---

## Key decisions for AcuDx

- **Atomic unit = `GuidelineStatement`** (structured, versioned, country/council-scoped, cited, license-tagged, clinician-approved). Store in Postgres/JSONB as source of truth + HNSW vector index for hybrid dense+BM25 retrieval. **Never store guidelines as opaque PDFs.**
- **Country is a first-class retrieval filter.** Model ILCOR→{AHA,ERC}→national for resus; hold ESC (140/90) and AHA/ACC (130/80) HTN thresholds as *parallel* cited statements. Filter by country/council *before* semantic ranking; surface cross-country divergence as a teaching feature, never silently US-default.
- **Copyright is existential.** ATLS 11 (ACS, Jul 2025), UpToDate, AMBOSS are proprietary — **no scraping, no fine-tuning on full text.** Legal grounding = our own clinician-authored structured summaries + cite/deep-link, plus open sources (WHO/GINA/GOLD/USPSTF/CDC, NICE-UK API) and formal partner licenses. **Content rights = the moat** (per OpenEvidence's 300+ licensed journals → $12B, >40% of US physicians).
- **Ship open-license domains first;** defer proprietary domains to licensing deals. Budget for NICE international license (UK-only is free; international is fee'd + agreement) and ≥1 proprietary content partner.
- **Runtime safety pipeline (every output):** retrieval-grounded generation → **hard citation gate** → **cheap-tier verifier/faithfulness pass** → **deterministic dose/threshold check** → **out-of-scope refusal** → citations + education-only disclaimer. Abstain > confident-wrong.
- **Clinician-in-the-loop is a mandatory pipeline stage** — the safety control *and* the copyright defense. No guideline atom reaches learners unreviewed; no auto-publish on guideline updates.
- **Education-only, not-a-CDSS boundary is the regulatory keystone** — never emit patient-specific management advice for a real patient; keeps AcuDx out of FDA SaMD / EU MDR device scope.
- **Medical MCP tools (ICD-10 FY2026, ChEMBL, PubMed, ClinicalTrials) enrich cases at authoring time under clinician review;** runtime MCP use is limited to cheap deterministic lookups (e.g. validating a learner-entered ICD code). Automated freshness watch (NICE daily XML, ICD Oct-1, ESC/ILCOR feeds) opens review tasks, never auto-publishes.
