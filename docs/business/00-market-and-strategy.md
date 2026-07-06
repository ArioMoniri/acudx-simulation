# 00 — Market & Strategy (July 2026)

**Scope.** The market AcuDx is entering, sized bottom-up for a **global** segment and a **distinct Turkey / emerging-market** segment; where AcuDx sits on the competitive map and the whitespace it owns; the compound moat; a two-front beachhead (an English wedge + a Turkey/TEPDAD-aligned wedge); regulation as a tailwind; a three-horizon plan; and a competitor table. All pricing and unit economics are anchored to the **open-source, self-hosted cost base** (`docs/research/08-open-source-model-stack.md`, `01-llm-models-and-cost.md`) so the dual (global + PPP-aware Turkey) pricing is internally consistent.

**Grounding.** Market/competitor facts carry over from `docs/research/04-market-competitors.md`; Turkey market facts and the PPP logic from `docs/research/09-localization-i18n-turkish.md` plus web-verified July-2026 figures cited inline. Cost figures are the **open-first** numbers from `08` (not the API-first numbers). Treat exact `$`/counts as a July-2026 snapshot; pin the **strategy and unit-economics logic**, which survive number churn.

**Direction corrections applied.** (1) **Open-first cost base** — marginal cost per encounter is ~**$0.05–0.08 self-hosted** (`08`), not the API-first $0.43; this is the wedge that makes both a sub-$15/mo prosumer tier and a PPP-discounted Turkey tier gross-margin-positive. (2) **Turkey is a first-class segment**, sized and priced separately, not a global-tier discount. (3) Positioning language matches the medkit design/trust posture (evidence-cited, clinical, not toy).

---

## 1. Market sizing — bottom-up, two segments

### 1.1 The nesting (TAM ⊃ SAM ⊃ SOM), stated with the analyst spread

Top-down anchors (state the range, don't cherry-pick — from `04`):

- **TAM, all medical education:** global med-ed **~$48.9B (2025) → ~$83.4B (2035)**, ~5.5% CAGR ([Expert Market Research](https://www.expertmarketresearch.com/reports/medical-education-market)). Outer boundary only — includes bricks-and-mortar teaching/CME/publishing; **not** AcuDx's addressable market.
- **TAM/SAM, healthcare/medical simulation (the relevant segment):** analyst spread — Grand View **$1.9B (2025) → $6.7B (2033), 17.0% CAGR** ([GVR](https://www.grandviewresearch.com/industry-analysis/medical-healthcare-simulation-market)); MarketsandMarkets **~$7.23B by 2030** ([M&M](https://www.marketsandmarkets.com/Market-Reports/healthcare-medical-simulation-market-1156.html)); others cluster $2.8–4.1B (2025–26) at 15–17% CAGR. **Working figure: sim market ~$3B (2026), 15–17% CAGR.** The *software / virtual-patient* sub-slice AcuDx lives in is smaller today but the fastest-growing (~20%+).

AcuDx's addressable market is not the whole sim market (most of that is manikins/task-trainers/physical sim centers). We size the **software virtual-patient + AI-roleplay sub-slice** bottom-up below.

### 1.2 Bottom-up — GLOBAL segment (English-first launch markets)

Built from *learner programs* (institutional) + *individual prosumers*, using verified per-seat/per-program anchors from `04`.

**Population (verified):**
- US allopathic + osteopathic medical students: **~100k** in training at any time (≈95k MD across 155+ LCME schools + ~37k DO; conservatively ~100k active/2 pre-clinical cohorts most sim-relevant). US **nursing** students dwarf this: **>430k** in pre-licensure BSN/ADN programs. PA/paramedic add ~40k+.
- Anglophone med-ed beyond the US (UK, Ireland, Canada, Australia/NZ, English-track programs in EU/Gulf/SE-Asia): a similar order of magnitude of **medical** learners again, ~150–200k.
- **Programs** (the actual buying unit): ~155 US MD + ~40 DO schools; ~2,000+ US nursing programs; hundreds of PA/paramedic programs; plus international. Call it **~3,000–4,000 addressable programs** in Horizon-1 English markets.

**Institutional SAM (global, English):**
- Anchor per `04`: sim deals land **~$10k–$150k/yr per program** (Full Code program tier ~$120/seat/yr is the floor anchor; enterprise is quote-based).
- Blended plausible ACV **~$25k/program/yr** (small nursing program at the floor; a med school with team-room + analytics at the top).
- 4,000 programs × $25k = **~$100M/yr institutional SAM** in English-first markets — squarely the "low-hundreds-of-millions software sub-slice" of `04`.

**Individual/prosumer SAM (global):** the AMBOSS/UWorld/Full Code price band, **~$12–30/mo**. AMBOSS alone crossed **>1M pro users, 180 countries** ([AMBOSS](https://www.amboss.com/us/pricing)). If AcuDx reaches even **200k paying individuals** at a blended ~$10/mo net (annualized, TR-discounted mix), that is **~$24M/yr** — additive to the institutional SAM and a genuine top-of-funnel/land-and-expand engine into institutions.

**Global SOM (3–5 yr, realistic):** capture **200–400 institutional programs** at ~$25k ACV = **$5–10M** + a prosumer book of **50–150k paying individuals** ≈ **$6–18M** ⇒ **~$10–25M ARR** global. Consistent with `04`'s "low-tens-of-millions ARR" SOM in a market where AMBOSS alone raised €240M.

### 1.3 Bottom-up — TURKEY / emerging-market segment (distinct, PPP-aware)

Turkey is sized and priced **separately** because (a) the learner pool is large and dense, (b) purchasing power is ~3× lower at market FX, and (c) accreditation (TEPDAD/UÇEP) gives a defensible local wedge (`09`).

**Population (web-verified, 2025–26):**
- **Medical students: ~132,001** across **118 medical faculties**; **~21,398 new medical admissions/yr** (9,282 state + 9,127 foundation) ([turkeyuniversity.org / YÖK 2025-26](https://www.turkeyuniversity.org/blog/turkey-higher-education-statistics-2026)).
- **Nursing students: ~89,570** across **184 programs / 153 universities** (17,895 annual quota) — the second-largest applied program after medicine ([YÖK statistics](https://istatistik.yok.gov.tr/), [YÖK 2025-26](https://www.turkeyuniversity.org/blog/turkey-higher-education-statistics-2026)); plus paramedic/first-aid (İlk ve Acil Yardım) associate programs.
- **TUS candidates (residency-entrance exam):** ~**20,000–30,000 per session**, **~52,000–55,000/yr** across both sessions; **~9,689 civilian residency slots** per session ([ÖSYM 2026-TUS](https://www.osym.gov.tr/TR,33822/2026-tus-1-donem-kilavuz-ve-basvuru-bilgileri.html)) — a high-stakes, high-willingness-to-pay exam-prep cohort.

**PPP logic (the pricing key):** USD/TRY ≈ **46.8** (6 Jul 2026, [tradingeconomics](https://tradingeconomics.com/turkey/currency)); Turkey's **PPP conversion factor ~4.7–5 LCU/int'l\$** ([World Bank PA.NUS.PPP](https://data.worldbank.org/indicator/PA.NUS.PPP?locations=TR)); Turkey's **GDP/capita ~$15k nominal vs ~$44k PPP** (2024, [World Bank](https://data.worldbank.org/indicator/NY.GDP.PCAP.PP.CD?locations=TR)). The market-vs-PPP wedge is **~3×** — a dollar of software list price feels ~3× more expensive to a Turkish student than to a US one. **Rule: price Turkey at ~1/3 of US list** to hold constant *real* affordability, which the open-first cost base makes margin-safe (below).

**Turkey SAM (bottom-up):**
- *Institutional:* ~118 med schools + ~184 nursing + paramedic programs ≈ **~350–400 addressable programs**. PPP-discounted ACV ~**$8k/program/yr** (≈ 1/3 of the $25k global blend) ⇒ **~$3M/yr** institutional SAM.
- *Individual:* ~132k med + ~90k nursing + ~52k/yr TUS candidates ≈ a **~250k+ live learner pool**. At a PPP-set **~$4–5/mo** (≈ 1/3 of the ~$12–15 global prosumer price) with, say, 15% eventual paid penetration (~40k paid) ⇒ **~$2M/yr**. TUS exam-prep spikes willingness-to-pay seasonally.
- **Turkey SAM ≈ $5M+/yr**, and it is a **beachhead into the wider emerging/PPP world** (MENA, N. Africa, Central Asia, South Asia) that shares the affordability + English-track-medicine profile — the same PPP-tier playbook replicates.

**Turkey SOM (3–5 yr):** a **TEPDAD-aligned** wedge landing **20–40 institutional programs** (~$8k) = **$0.2–0.3M** + **20–50k paying individuals** at ~$4.5/mo ≈ **$1–2.7M** ⇒ **~$1.5–3M ARR** — small in dollars, strategically outsized as proof of the PPP model and a defensible localized position no US incumbent contests.

### 1.4 Why the two-segment split is defensible (the margin check)

The **open-first cost base is what makes PPP pricing work**. Marginal cost is **~$0.05–0.08/encounter self-hosted** (`08`), vs $0.43 API-optimized, vs $6.30 naïve. Even a heavy individual user at ~20 encounters/mo costs **~$1.0–1.6/mo in inference** — so a **$4.5/mo Turkey tier is still gross-margin-positive**, and a $12–15 global tier is very healthy. A voice-heavy user adds STT/TTS (self-hosted Whisper/XTTS, `08`/`09`) but stays well inside a PPP price. **This is the compound advantage: the AI cost collapse doesn't just cut cost — it unlocks a whole PPP market segment that API-priced incumbents (or thin-margin AI-native peers on frontier APIs) cannot profitably serve.**

---

## 2. Positioning map — interaction fidelity × assessment rigor

Two axes (per `04` §5.1):

- **X — interaction fidelity:** static MCQ → typed NLP → menu/branching → generative voice → **multiplayer voice + 3D roleplay** (far right).
- **Y — assessment rigor:** completion tracking → rubric scoring → competency-mapped → **calibration (confidence vs competence) + guideline-grounded gap analysis** (top).

```
  ASSESSMENT RIGOR (Y)
  ▲
  │                                                     ┌───────────────┐
  │  calibration +                                      │    ACUDX      │
  │  grounded gap analysis                              │ (empty top-   │
  │                                                     │  right box)   │
  │  competency-mapped        Aquifer ●                 └───────────────┘
  │                          (AI preceptor,
  │                           VP cases)
  │  rubric scoring     Shadow Health ●     i-Human ●        SimCare AI ○
  │                     (typed NLP)        (menu H&P)       SimConverse ○
  │                                       Body Interact ●   (voice, single-
  │  completion        AMBOSS ◆  UWorld ◆   OMS ● (VR/screen  player)
  │                    (Qbank/content,      scripted branch)   Virti ○
  │                     no roleplay)                          Full Code ●
  └───────────────────────────────────────────────────────────────────▶
     MCQ    typed NLP    menu/branching    generative voice   multiplayer
                                                              voice + 3D
     INTERACTION FIDELITY (X)

  ● incumbent sim   ◆ content/Qbank incumbent   ○ AI-native peer
```

**Read:** content/Qbank incumbents (AMBOSS, UWorld) sit low-left. Single-player sim incumbents (Body Interact, i-Human, Shadow Health, OMS) cluster mid. AI-native peers (SimCare AI, SimConverse, Virti) sit mid-right but **single-player** and thin on assessment rigor. Aquifer is the only one high on the Y-axis (AI preceptor + VP cases) but low-fidelity interaction. **The top-right — team-based generative voice/3D roleplay with calibration + grounded gap analysis — is empty. That is AcuDx's box** (`04` §5.1).

---

## 3. Whitespace & the compound moat

No single feature is uncopyable; the **compound** is (per `04` §4). Four load-bearing pillars, ranked by defensibility:

1. **Multiplayer, role-based team rooms** (hardest to copy). Every incumbent is single-learner; SimCare AI only *hints* at "group case simulations." Realtime multi-human + multi-AI rooms (doctor + nurse + paramedic + team-lead, AI backfilling empty roles) map to **crisis-resource-management / team training** that today needs a physical sim center and staff. This is the moat and the sim-center displacer.
2. **Voice + 3D roleplay as the native interface** — not typed (Shadow Health), not menu (Body Interact/i-Human), not scripted-branch (OMS). Duplex STT/TTS + expressive 3D avatars across the full loop (history → exam → order/interpret tests → differential → dx → management). **Open-first voice (Whisper/XTTS, `09`) is what makes this affordable at PPP prices.**
3. **Calibration analytics (Dunning-Kruger)** — plot **self-rated confidence vs measured competence**. No competitor does this. Deterministic (no LLM cost), novel, and a research/publication hook (Miller's pyramid, ACGME/CanMEDS, EPAs; MedQA-CS-style scoring).
4. **Guideline-grounded Socratic guidance**, **country-scoped** — cited to NICE/ESC/AHA globally and to **TEPDAD / Sağlık Bakanlığı / TİTCK / UÇEP** for Turkey (`09` §5). Incumbents have content-without-sim or sim-without-grounded-coach; none combine live grounded coaching with the right national citations.

**Why it compounds:** each pillar makes the others more valuable and the whole harder to replicate — team rooms generate the multi-role encounter data that feeds calibration analytics, which is only trustworthy because guidance is guideline-grounded, all delivered through the voice/3D interface. Plus the **structural moats**: (a) **compliance/integration** (FERPA/HIPAA/GDPR/KVKK, SSO, WCAG 2.2 AA, LMS, accreditation mapping) — the procurement barrier that becomes a switching-cost moat once cleared; (b) **open-first cost structure** — a fixed GPU fleet whose per-encounter cost *falls* with volume, so the margin gap vs API-priced rivals **widens as we scale** (`08`); (c) **localized accreditation fit** (TEPDAD/UÇEP mapping) that no US incumbent will build for Turkey.

**What AcuDx must NOT try to own** (`04` §4): validated case-content breadth (Body Interact/Aquifer), USMLE/NCLEX Qbank supremacy (UWorld/AMBOSS), authoritative reference content (UpToDate). **Partner or interoperate for guidelines; compete on interaction + assessment.**

---

## 4. Beachhead — a two-front wedge

### 4.1 English wedge (Horizon-1 revenue): US/Anglophone nursing + acute-care skills labs

- **Why nursing/acute-care first:** the strongest regulatory tailwind (NCSBN 50%-simulation substitution + state legislation, §5), the largest learner pool, and the clearest pain (placement scarcity, preceptor shortage). Full Code proved individual willingness-to-pay in acute care; Shadow Health proved nursing VP adoption but is typed-only and single-player — **exactly the interaction gap AcuDx fills**.
- **Motion:** land a few **sim-center / clinical-skills programs** on **team rooms + calibration analytics** (the features no one else has), priced ~$10k–$50k ACV; seed with a **transparent sub-$15/mo prosumer tier** (Full Code/AMBOSS band) for bottom-up individual adoption that pulls the institution in.
- **Wedge feature:** multiplayer CRM/team-training rooms — displaces physical sim-center scheduling, the buyer's most expensive, least-scalable asset.

### 4.2 Turkey wedge (strategic proof + defensible position): TEPDAD-aligned, affordable

- **Why Turkey:** ~132k med + ~90k nursing + ~52k/yr TUS learners (§1.3), an underserved, English-secondary market where US incumbents don't localize and where **accreditation is a local moat**.
- **Wedge:** map AcuDx competencies to **UÇEP core curriculum** (case-blueprint source of truth) and **TEPDAD** standards (WFME-recognized program accreditation) so a Turkish faculty can **cite AcuDx use in its accreditation self-evaluation (BİDR)** (`09` §5). Ground drugs/pathways to **Sağlık Bakanlığı/TİTCK**, tune assessment register to **TUS**. Deliver full **TR text+voice** parity (Whisper-large-v3 + XTTS-v2 TR, Qwen3/Gemma reasoning — `09`).
- **Price:** PPP tier at **~1/3 of US list** (~$4–5/mo individual; ~$8k/program) — margin-safe on the open-first cost base (§1.4). A **TUS-prep** individual product is the seasonal willingness-to-pay spike.
- **Payoff:** Turkey is both a real (if small-dollar) revenue segment **and** the reusable template for the wider PPP/emerging world (MENA, Central/South Asia) — a position API-priced incumbents structurally cannot follow.

---

## 5. Regulatory barrier as tailwind

The compliance/accreditation bar is simultaneously the **demand driver**, the **procurement barrier**, and, once cleared, the **moat** (`04` §3).

- **Simulation is regulatory-grade, not enrichment.** The **NCSBN National Simulation Study (2014)** established up to **50% of traditional clinical hours** replaceable by high-quality simulation with no competency/NCLEX difference ([J. Nursing Regulation](https://www.journalofnursingregulation.com/article/s2155-8256(15)30062-4/fulltext); [NCSBN Guidelines](https://www.ncsbn.org/research-item/ncsbn-simulation-guidelines-for-prelicensure-nursing-programs)). States keep legislating (e.g., NY counting up to 30% of nursing clinicals as sim, [nurse.org](https://nurse.org/articles/new-york-nursing-simulation-lab-bill/)). SimCare AI's "**20 encounters, not 200**" pitch rides this exact wave — buyers already accept the thesis.
- **CBME / EPAs / OSCE pressure** pushes schools toward scalable, auditable digital assessment — the assessment-rigor axis AcuDx owns.
- **Turkey:** **TEPDAD accreditation + UÇEP core curriculum** are the local equivalent — mapping AcuDx to them turns "nice-to-have" into "accreditation evidence," a buying trigger no generic vendor supplies (`09` §5).
- **Compliance-as-moat:** FERPA/HIPAA/GDPR/**KVKK** (Turkey's data-protection law), SSO, WCAG 2.2 AA, LMS/SSO integration, and data-residency slow AcuDx down *and* protect it once won. **Open-first self-hosting is a compliance unlock**: PHI/learner data never leaves AcuDx-controlled GPUs, removing a whole class of sub-processor/BAA/residency risk (GDPR, KVKK, Sağlık Bakanlığı) that a frontier-API-only competitor cannot escape (`08` §7).

**Net:** the same wall that makes med-ed sales slow is the wall that keeps a horizontal AI-roleplay startup or a content company from casually crossing into AcuDx's box.

---

## 6. Three-horizon strategy

**Horizon 1 (0–18 mo) — win the empty box on two fronts.**
- Ship the compound MVP: **multiplayer team rooms + duplex voice/3D roleplay + calibration analytics + guideline-grounded guidance**, on the **open-first stack** (small-open patient turns → large-open grading → rare frontier escalation).
- English wedge: land **20–50 nursing/acute-care programs** + launch the sub-$15/mo prosumer tier.
- Turkey wedge: **TR text+voice parity**, UÇEP/TEPDAD mapping, PPP pricing, TUS-prep product; land **pilot Turkish faculties**.
- Compliance from day one (FERPA/HIPAA/GDPR/KVKK, SSO, WCAG 2.2 AA, LMS).
- **Target: ~$3–6M ARR** (mostly English institutional + prosumer; Turkey small-dollar but strategically live).

**Horizon 2 (18–42 mo) — deepen the moat, expand segments.**
- Institutional analytics ("dean's office"): cohort/competency/remediation/longitudinal dashboards mapped to Miller/ACGME/CanMEDS/EPA/**TEPDAD**.
- **Guideline-content partnership** (rather than build) for authoritative grounding; MedQA-CS-style published validation of the AI examiner/patient (turns clinical safety into a marketed feature).
- Expand English beyond nursing into **MD/DO/PA** and health-system residency/in-service; expand PPP playbook from Turkey into **MENA/Central Asia** using the same localized-accreditation template.
- Widen the individual funnel into institutions (land-and-expand).
- **Target: ~$15–30M ARR**; SOM range from §1 largely realized.

**Horizon 3 (42 mo+) — category ownership + platform.**
- Become the **interaction-and-assessment layer** of med-ed: an open **case/authoring ecosystem**, LMS/EHR-sim interoperability, and a longitudinal **competency graph** per learner across their training.
- Team-based CRM training displaces a meaningful share of physical sim-center hours; calibration analytics becomes an accreditation-cited standard.
- Compounding cost/margin advantage from the fixed open-first GPU fleet funds price-led expansion into more PPP markets that API-priced rivals cannot profitably enter.

---

## 7. Competitor table (consolidated)

| Competitor | Category | Interaction fidelity | Assessment rigor | Multiplayer | Voice-native | Guideline-grounded | Turkey/PPP-localized | Pricing signal | Threat |
|---|---|---|---|---|---|---|---|---|---|
| **Body Interact** | Incumbent sim | Menu/branching (+ bolt-on AI dialogue) | Physiology outcomes | No | No | Partial | No | Quote (4 tiers) | Med |
| **i-Human (Kaplan)** | Incumbent sim | Menu H&P | Reasoning score | No | No | No | No | Quote/seat | Med |
| **Oxford Medical Sim (OMS)** | Incumbent sim (VR+screen) | Scripted branch, voice-in-VR | Analytics | No | Partial (VR) | Partial | No | Quote/learner | Med (well-capitalized) |
| **Shadow Health (Elsevier)** | Incumbent sim | Typed NLP interview | Rubric | No | No (typed) | No | No | Bundled (Elsevier) | **High** (distribution) |
| **Full Code** | Prosumer sim | Decision-tree, timed | Completion + CME | No | No | Partial | No | **$11.99/mo; $120/seat/yr** | Low-Med (narrow, EM) |
| **SimConverse** | AI-native | Duplex voice | Comms feedback | No | **Yes** | Partial | No | Quote | Med (voice proof, RCT) |
| **SimCare AI** | AI-native | Voice/text, DT-mapped | Feedback | Hints "group" | **Yes** | Partial | No | Seat/usage (early) | **High** (closest architecture) |
| **Virti** | AI-native (horizontal) | AI virtual humans, XR | Training analytics | No | Yes | No | No | Enterprise quote | Med (drifting horizontal) |
| **Aquifer** (non-profit) | VP + AI preceptor | Menu VP cases | **AI preceptor feedback** | No | No | Partial | No | Quote (~90% US schools) | **High** (native to our space) |
| **AMBOSS** | Content/Qbank + AI | Search/assistant (no roleplay) | N/A (content) | No | No | **Yes (content)** | Partial (TR content?) | **$12.50–19.99/mo** | **High** (could add AI patient) |
| **UWorld** | Qbank | MCQ | Score | No | No | No | No | Sub/seat | Med-High (wallet share) |
| **UpToDate (WK)** | Reference | N/A | N/A | No | No | **Yes (reference)** | No | Enterprise | Med (content, no sim DNA) |
| **AcuDx** | **AI-native sim + assessment** | **Multiplayer voice+3D** | **Calibration + grounded gap analysis** | **Yes** | **Yes** | **Yes (country-scoped, incl. TR)** | **Yes (TEPDAD/UÇEP, PPP)** | **Sub-$15/mo global; ~1/3 PPP; $10–150k/program** | — |

**Highest head-on collision risks (`04`):** **Aquifer** and **Elsevier/Shadow Health** (already do AI-flavored VPs with deep US penetration) on the incumbent side; **SimCare AI** on the AI-native side; **AMBOSS** as the fast-follow content+AI+distribution threat. AcuDx's answer to all four is the **compound** (team + voice/3D + calibration + country-scoped grounding), plus the **PPP/open-first cost structure** none of them can match.

---

## Open questions & assumptions

**Assumptions (load-bearing):**
1. **Open-first marginal cost ~$0.05–0.08/encounter holds at scale** (above the ~500K tok/day break-even, `08`). If AcuDx stays sub-break-even (slow pilot), the API-first ~$0.43 applies and the PPP tier's margin is thinner — pilots may need to start API-first until the GPU fleet amortizes.
2. **Turkey PPP discount ≈ 3× → price at ~1/3 of US list.** Anchored to USD/TRY ~46.8, PPP factor ~4.7–5, and the ~$15k-nominal/~$44k-PPP per-capita ratio. Volatile TRY means the ratio drifts; re-index the TR price to PPP, not to a fixed dollar.
3. **Blended institutional ACV ~$25k global / ~$8k Turkey** is a planning midpoint between the $120/seat/yr floor and $150k enterprise ceiling; real deals are quote-based and will vary widely by seats/features.
4. **Individual paid-penetration (200k global, ~40k Turkey)** is a modeling assumption, not a forecast — the prosumer funnel is unproven for a team-based product and may convert primarily as a land-and-expand motion into institutions rather than standalone.
5. **Multiplayer team rooms remain uncopied through Horizon 1.** If SimCare AI or an incumbent ships true multi-human team rooms fast, the primary moat compresses to voice/3D + calibration + localization.

**Open questions:**
1. **Guideline-content partnership vs build** — which national/international guideline source(s) partner with AcuDx for grounding (and at what cost), especially the TR sources (TEPDAD/Sağlık Bakanlığı/TİTCK)? Unresolved; affects both cost and defensibility.
2. **Turkey go-to-market** — direct-to-faculty, via a local distributor, or via a TEPDAD/med-school-association channel? KVKK data-residency likely mandates in-region GPU hosting (cost + ops implications).
3. **CME/accreditation monetization** — is there a Turkish CME-equivalent lever (as Full Code's $99.99 Pro+CME is in the US) to lift TR individual ARPU despite PPP pricing?
4. **Prosumer→institutional conversion rate** — does bottom-up individual adoption actually pull institutional deals for a *team-based* product, or is the individual tier mainly a brand/funnel cost?
5. **Exact software-sub-slice SAM** — the $100M global / $5M Turkey SAM figures are bottom-up estimates from program counts × blended ACV; they need validation against actual win-rates and realized ACVs once the first cohort of deals closes.

---

### Sources

- Market/competitors/pricing: `docs/research/04-market-competitors.md` (and its cited sources — EMR, GVR, M&M, NCSBN, Full Code, AMBOSS, Aquifer, SimCare AI, SimConverse, OMS, Virti).
- Cost base: `docs/research/08-open-source-model-stack.md`, `docs/research/01-llm-models-and-cost.md`.
- Turkey/localization: `docs/research/09-localization-i18n-turkish.md`; [YÖK higher-ed statistics 2025-26](https://www.turkeyuniversity.org/blog/turkey-higher-education-statistics-2026); [YÖK istatistik](https://istatistik.yok.gov.tr/); [ÖSYM 2026-TUS](https://www.osym.gov.tr/TR,33822/2026-tus-1-donem-kilavuz-ve-basvuru-bilgileri.html); [World Bank PPP factor (TR)](https://data.worldbank.org/indicator/PA.NUS.PPP?locations=TR); [World Bank GDP/cap PPP (TR)](https://data.worldbank.org/indicator/NY.GDP.PCAP.PP.CD?locations=TR); [USD/TRY](https://tradingeconomics.com/turkey/currency).
- GPU/self-host economics: [sitepoint self-hosted LLM costs 2026](https://www.sitepoint.com/self-hosted-llm-costs-2026/); [Spheron H100/2026](https://www.spheron.network/blog/runpod-h100-pricing-2026/).
