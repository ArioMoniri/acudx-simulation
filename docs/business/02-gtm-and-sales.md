# 02 — Go-To-Market & Sales (July 2026)

**Scope.** How AcuDx acquires users and closes revenue: the **dual motion** — bottom-up product-led growth (PLG) across the USMLE/OSCE *and* Turkish TUS/OSCE learner communities, converting into enterprise **land-and-expand** through the 7-role dean's-office committee. Includes the full pricing architecture (self-hosted-cost-based, dual-currency with Turkey/PPP), the Turkey GTM specifics (TEPDAD, deans, Sağlık Bakanlığı, resellers, data-residency), the partnership map, the pilot playbook, and a 0–18-month sequence.

**Grounding & consistency.** All numbers reconcile with the open-source cost base (`docs/research/08-open-source-model-stack.md`: ~$0.05–0.08/encounter self-hosted), the institutional buyer model (`docs/stakeholders/03-institution.md`: the 7-role committee, $25k–$500k/yr bands), the market/pricing anchors (`docs/research/04-market-competitors.md`: Full Code $11.99/mo, AMBOSS $12.50–19.99/mo, ~$120/seat/yr institutional anchor), the requirements baseline (`docs/00-overview/01-requirements-and-constraints.md`: dual pricing mandatory, PLG wedge, formative-default), and the Turkish localization strategy (`docs/research/09-localization-i18n-turkish.md`). Market claims are web-verified July 2026 and cited inline; treat exact `$`/rates as snapshots.

**Time context:** July 2026. USD/TRY market rate ≈ **46.8** ([TradingEconomics, 6 Jul 2026](https://tradingeconomics.com/turkey/currency)); World-Bank PPP conversion factor ≈ **15.4 TRY per international $** (Dec 2025, [World Bank PA.NUS.PPP](https://data.worldbank.org/indicator/PA.NUS.PPP?locations=TR)) — the ~**3× gap between market FX and PPP is the entire basis of the Turkey pricing discount** (§4.2).

---

## 1. GTM thesis in one page

**The core bet (from the requirements baseline, tension T11).** AcuDx runs a **bottom-up PLG motion** so it is not hostage to a 6–14-month, 7-veto university procurement cycle. The learner is both the **wedge** and the **champion**: an individual gets 10× value from the free/Pro product *without their institution buying anything*, uses it, tells peers and faculty, and — when a cohort is visibly using it — drags the institution into an enterprise conversation. **Land with the learner-loved product; expand and renew on the dean's-office value** (accreditation evidence, remediation loop, cohort analytics), which is what actually gets paid for at scale (`docs/stakeholders/03-institution.md` §9).

**Why this works now (demand tailwinds, from `docs/research/04-market-competitors.md`):**
1. **Placement scarcity is regulatory-grade.** NCSBN established up to **50% of clinical hours** are replaceable by high-quality simulation with no competency loss; states legislate simulation substitution. Buyers already believe "20 encounters, not 200."
2. **AI collapsed the marginal cost of an encounter.** Self-hosted open-weight models put a full graded encounter at **~$0.05–0.08** (`docs/research/08`), vs $50k+/mannequin and thousands in standardized-patient actor labor. This is the wedge that lets AcuDx *undercut incumbents on institutional TCO and still profit on a sub-$15/mo prosumer tier*.
3. **The top-right quadrant is empty.** No incumbent or AI-native competitor combines multiplayer + duplex-voice/embodied roleplay + calibration analytics + guideline-grounded guidance.

**Two geographies, one motion.** AcuDx runs the *same* dual motion in **two learner communities simultaneously**: the **US/international USMLE-Step + OSCE** market (English-first) and the **Turkish TUS + OSCE** market (Turkish-first, `docs/research/09`). Turkey is not a "later localization" — it is a **first-class launch geography** chosen because (a) Turkish medical students are a primary cohort, (b) the open-source/self-host stack makes **in-country data residency** economically feasible (a hard requirement under KVKK/Sağlık Bakanlığı — §5), and (c) PPP pricing lets AcuDx reach a price-sensitive but large market (≈16,000 medical-school seats/year — §5.1) profitably at ~$0.06/encounter cost.

**What we do NOT do.** We do not out-content AMBOSS/Aquifer/UpToDate; we do not lead with enterprise cold-outreach; we do not gate the core loop behind a sales call. The free tier is the top of the funnel, not a demo.

---

## 2. The dual-motion funnel

```
                         PLG (self-serve, both geos)                    Enterprise (land & expand)
  ┌───────────────────────────────────────────────────┐   ┌──────────────────────────────────────────┐
  │  AWARENESS                                          │   │  QUALIFIED ACCOUNT                          │
  │  campus ambassadors · TUS/USMLE communities ·       │   │  ≥1 cohort with visible org usage           │
  │  Prognosis/Reddit/Discord/Ekşi · content SEO ·      │   │  (PLG signal) OR inbound from a champion     │
  │  clerkship word-of-mouth · faculty demo day         │   │                                             │
  ├───────────────────────────────────────────────────┤   ├──────────────────────────────────────────┤
  │  SIGN-UP (Free)                                     │──▶│  CHAMPION (Assessment Director / course dir)│
  │  email/Google/Apple · .edu detect · locale = EN|TR  │   │  armed with usage data + ROI one-pager      │
  ├───────────────────────────────────────────────────┤   ├──────────────────────────────────────────┤
  │  ACTIVATION                                         │   │  PILOT (paid, time-boxed, 1 cohort)          │
  │  first EM encounter completed + calibration plot    │   │  success metrics agreed up front (§7)       │
  │  read (D0 aha-moment)                                │   ├──────────────────────────────────────────┤
  ├───────────────────────────────────────────────────┤   │  COMMITTEE CLEARANCE                          │
  │  RETENTION (D30 ≥25%, ≥3 enc/wk — MVP gate)         │   │  IT/Sec · Procurement · DPO · Accreditation │
  ├───────────────────────────────────────────────────┤   │  (any one = veto; champion shepherds)        │
  │  MONETIZE → Pro ($/mo) + CME upsell                 │──▶│  CONTRACT → annual seat/cohort license       │
  ├───────────────────────────────────────────────────┤   ├──────────────────────────────────────────┤
  │  REFER (ambassadors, cohort invites, team rooms)   │   │  EXPAND (more cohorts → school → GME →       │
  │                                                     │   │  multi-campus) + RENEW on accreditation value│
  └───────────────────────────────────────────────────┘   └──────────────────────────────────────────┘
        ▲ learner is wedge & champion ─────────────────────────────▶ drags institution in ▲
```

**Funnel conversion assumptions (planning, deliberately conservative for a paid-education prosumer product):**

| Stage | Assumption | Basis |
|---|---|---|
| Visitor → Free sign-up | 4–8% | Content/ambassador-led ed-tech norm |
| Free → activated (1st encounter + calibration read) | 35–50% | Strong aha-moment (calibration plot is the signature artifact) |
| Activated → D30 retained | ≥25% | **MVP success gate** (`docs/00-overview/01` §6) |
| Free → Pro (paid) | 3–6% blended; 6–10% among activated | Below Duolingo-style ~4–8% because clinical audience skews high-intent |
| Cohort-with-usage → enterprise pilot | 15–25% of schools with ≥1 active cohort | PLG-sourced enterprise is warm |
| Pilot → paid contract | 40–60% | Pilot is pre-qualified; blockers are the risk, not fit |
| Annual logo retention (institution) | ≥90% once accreditation-embedded | Accreditation evidence is the #1 renewal lever (`docs/stakeholders/03` §9) |

**Instrument from day one:** activation rate, D30, encounters/week, calibration-plot comprehension (≥80% usability, an MVP gate), Free→Pro, and — critically — **PLG-to-enterprise attribution** (which paid contracts trace to organic cohort usage). The whole thesis inverts if PLG does not seed enterprise; measure it.

---

## 3. PLG motion — acquisition, activation, monetization

### 3.1 Acquisition channels (ranked by expected CAC efficiency)

1. **Campus ambassadors (primary, both geos).** A student rep per school runs demo sessions, seeds the free tier before an OSCE/Step/TUS block, and owns a referral link. Comp: free Pro + CME credits + a small per-activated-peer bounty + leaderboard-free recognition. Target: **1 ambassador per target school** (≈155 US LCME MD schools ([LCME, via Wikipedia](https://en.wikipedia.org/wiki/Liaison_Committee_on_Medical_Education)) + ~90 Turkish medical schools, of which 75 are in the TEPDAD system ([TEPDAD accredited programs](https://tepdad.org.tr/en/accredited-programs-in-turkey/); RE-AIM evaluation, [PubMed 39415178](https://pubmed.ncbi.nlm.nih.gov/39415178/))). Ambassadors are also the enterprise motion's early-warning radar (they name the friendly course director).
2. **Community/content SEO.** English: exam-prep subreddits, Discords, and the Prognosis/Clinical-Odyssey-adjacent audience (top-of-funnel individual acquisition, `docs/research/04` §1.2). Turkish: TUS-prep forums, Ekşi Sözlük, medical-student Instagram/YouTube, and university clubs. Content is *calibration-first* ("are you over-confident on ACS? find out") — the differentiator competitors can't copy.
3. **Clerkship/OSCE word-of-mouth.** The team-room and OSCE-pair features are inherently viral (you invite peers to a room). Ship shareable post-encounter artifacts (redacted calibration plot, "I diagnosed the STEMI in 4 min").
4. **Faculty demo day (bridge to enterprise).** Free faculty accounts + a 30-minute live demo of the dean-dashboard mock; this is where a champion self-identifies.
5. **CME as an acquisition surface** (US). Pro+CME converts clinicians and residents who need credits, mirroring Full Code's $99.99 Pro+CME lever (`docs/research/04`).

### 3.2 Activation — the aha-moment

The **D0 activation event** is: *complete one text-first Emergency-Medicine encounter and read your calibration plot* — the wedge from `docs/00-overview/01` §6. Everything in onboarding drives to that single completed encounter in <10 minutes. The calibration plot (confidence vs measured competence) is the artifact no competitor has and the reason a student comes back. Turkish learners hit the identical loop in `tr-TR` with TUS-register framing and TİTCK/Sağlık-Bakanlığı-grounded feedback (`docs/research/09` §5).

### 3.3 Monetization — the individual tiers

Positioned inside the AMBOSS/Full Code price band so AcuDx is a *complement* to a Qbank, not a competitor to one. Contribution margin must be positive on paid tiers; **voice & 3D are premium, never free-tier defaults** (`docs/00-overview/01` §5). At **~$0.06/encounter** self-hosted cost, even a heavy Pro user (say 60 encounters/mo ≈ $3.60 COGS) leaves healthy margin at a $15 price — the open-source cost base is what makes an affordable, high-usage prosumer tier viable.

See §4 for the full price table (both currencies).

---

## 4. Pricing architecture (dual-currency, PPP, self-hosted-cost-based)

### 4.1 Cost base → margin logic (why these prices work)

Every price is anchored to the **self-hosted marginal cost of ~$0.05–0.08 per full graded encounter** (`docs/research/08` §4), not to frontier-API economics. This is load-bearing:

- **Prosumer:** a $14.99/mo Pro user at 40–80 encounters/mo carries **$2.40–$4.80 COGS** → 68–84% gross margin before fixed GPU/infra. The GPU fleet is a **fixed cost that amortizes with volume**, so margin *improves* as the base grows (the opposite of API-metered economics).
- **Institutional:** AI token cost is **absorbed into the seat price, never usage-metered to the institution** (`docs/stakeholders/03` §E; `docs/00-overview/01` §5). At ~$0.06/encounter, a student doing 200 encounters/year costs ~$12 in COGS against a ~$120 anchor seat price — the AI marginal-cost advantage is the wedge to undercut Body Interact/OMS/i-Human on TCO while keeping margin.
- **On-prem/VPC appliance tier** (privacy-maximal / KVKK residency): the same open stack shipped as a containerized appliance the institution runs in its own VPC; break-even vs API ≈ >3–5M tokens/day (`docs/00-overview/01` AD-7). Priced as a platform license + support, not per-seat metered.

### 4.2 The Turkey/PPP discount — method

Turkey's **market FX (~46.8 TRY/$)** and **PPP factor (~15.4 TRY/int'l $)** diverge ~3× — meaning a dollar buys roughly 3× more inside Turkey than the FX rate implies. Charging US list prices in Turkey would price out the market; charging naïve FX-converted prices leaves money on the table and invites arbitrage. **Method: price Turkish tiers at a ~65–70% discount to US list (a ~0.30–0.35× PPP multiplier), billed in TRY, geo/verification-gated to Turkish learners and institutions.** This lands prosumer Pro near local willingness-to-pay while staying far above the ~$0.06/encounter cost floor. Guardrails: bill in **TRY** (insulate the buyer from lira volatility — down ~17% YoY, [TradingEconomics](https://tradingeconomics.com/turkey/currency)); verify eligibility (.edu.tr / TR institution / TR payment method) to prevent US users buying the TR price; **re-index TRY prices semi-annually** against FX drift so lira depreciation doesn't silently erode the margin.

### 4.3 Individual / prosumer price table

| Tier | Includes | **US / Intl (USD)** | **Turkey (PPP, TRY billed)** | Anchor / rationale |
|---|---|---|---|---|
| **Free** | 4–6 EM encounters/mo, text-only, calibration plot, gap analysis | **$0** | **₺0** | Top-of-funnel wedge; not a demo |
| **Pro** | Unlimited text encounters, all specialties as they ship, spaced-repetition, streaks | **$14.99/mo · $119/yr** | **~₺230/mo · ~₺1,800/yr** (≈ $5/mo equiv.) | Below AMBOSS $19.99, at Full Code $11.99 band |
| **Pro + Voice** | Adds duplex-voice patients (premium), expressive TTS | **$19.99/mo · $179/yr** | **~₺320/mo · ~₺2,700/yr** | Voice is premium, never free (cost discipline) |
| **Pro + CME** (US) | Pro + AMA PRA Cat-1 credit per case | **$99.99/yr** | n/a (Turkey uses TTB/local CPD — §6) | Mirrors Full Code $99.99 Pro+CME |
| **Student annual (verified)** | Pro, .edu/.edu.tr verified, sold to individuals | **$89/yr** | **~₺1,400/yr** | Bulk-affordable; feeds enterprise land |

*(TRY figures are indicative at Jul-2026 FX; the operative rule is the ~0.30–0.35× PPP multiplier on USD list, re-indexed semi-annually — not the literal lira number.)*

### 4.4 Institutional price table

Transparent per-seat / per-cohort with a cap; **no usage metering**; renewal price protection ≈ CPI or 5%; 10–20% discount for 3-year prepay; cooperative-purchasing vehicles (E&I, Internet2 NET+) to bypass RFPs where the deal >~$50k–$100k (`docs/stakeholders/03` §E, §8).

| Package | Scope | **US / Intl (USD/yr)** | **Turkey (PPP, TRY/yr)** | Notes |
|---|---|---|---|---|
| **Program pilot** | 1 cohort, 1 semester, time-boxed | **$8k–$15k** | **~₺100k–₺190k** (≈ $3k–5k equiv.) | Paid pilot; credited toward year-1 if converts (§7) |
| **Single cohort** (100–200/class UME) | Learner app + dean dashboard + LTI + SSO | **$25k–$150k** | **~₺400k–₺1.9M** (PPP-discounted) | Core anchor (`docs/stakeholders/03` A) |
| **Multi-campus / school + GME** | Multiple cohorts, GME programs, full analytics | **$300k–$500k** | quote (PPP-adjusted) | Land-and-expand ceiling |
| **On-prem / VPC appliance** | Self-hosted stack, in-country residency | platform license + support (quote) | **quote — the KVKK/residency SKU for Turkey** | Open stack = feasible on-prem (§5) |

**Seat anchor:** ~**$120/learner-seat/yr** list (Full Code program-tier parity, `docs/research/04`), volume-discounted; Turkey seat anchor ≈ **₺600–800/seat/yr** (~$40 equiv. at PPP). Absorb AI cost into the seat.

---

## 5. Turkey GTM (first-class geography)

### 5.1 Market shape

Turkey has **~90 medical schools** (75 in the TEPDAD accreditation system as of the 2024 evaluation, [PubMed 39415178](https://pubmed.ncbi.nlm.nih.gov/39415178/); [TEPDAD](https://tepdad.org.tr/en/accredited-programs-in-turkey/)), with a **medical-school intake that grew from ~5,000 (2005) to ~16,000/year (2020)**, of which foundation (private) universities now take ~9,000 ([Turkey Higher-Education Statistics 2026, YÖK](https://www.turkeyuniversity.org/blog/turkey-higher-education-statistics-2026); [MEJFM overview](http://www.mejfm.com/journal/July03/a_general_overview_of_medical_ed.htm)). Every graduate who wants a residency sits the **TUS** (240 questions, twice yearly, April/September, [ÖSYM](https://www.osym.gov.tr/TR,33819/2026.html)) — a large, exam-driven, price-sensitive, English-code-switching learner population (`docs/research/09` §4). This is a genuine market, not a token locale.

### 5.2 The Turkey buying context (how it differs from the US committee)

The 7-role committee (§6) still applies, but with Turkish institutions and Turkish gates layered on:

- **TEPDAD (accreditation).** WFME-recognized national program accreditation ([TEPDAD](https://tepdad.org.tr/en/home/)). The equivalent of LCME/ACGME as the #1 lever. AcuDx must map competencies to **TEPDAD standards** and the **UÇEP/ÇEP national core curriculum** (the case-blueprint source of truth for TR; UÇEP-2026 revision in progress) so a school can cite AcuDx use in its self-evaluation (BİDR) (`docs/research/09` §5). This is the single strongest institutional lever in Turkey exactly as accreditation is in the US.
- **Deans (dekan) + YÖK context.** Turkish medical deans are the economic buyers; the Higher Education Council (YÖK) owns the UÇEP curriculum. Budget cycles and public-university procurement are bureaucratic; **foundation (private) universities move faster and are the beachhead** (they hold ~9,000 of the intake and have more budget autonomy).
- **T.C. Sağlık Bakanlığı (Ministry of Health) + TİTCK.** National clinical guidelines, drug licensing (TİTCK), and — critically — **health-data governance**. Public-sector and hospital-affiliated deployments will invoke ministry data rules.
- **TUS/ÖSYM register.** Assessment framing tuned to TUS clinical-reasoning expectations; grading rubric in Turkish clinical register (`docs/research/09`).

### 5.3 Data residency — the decisive Turkey requirement (and why the open stack wins)

KVKK (Law No. 6698) does not impose blanket localization, but it runs a **conditional cross-border-transfer framework** (explicit consent, adequacy, or KVK-Board-approved binding commitments / SCCs), and **government-related critical data — including health records — must be stored within Turkey**; global hyperscalers still lack in-country zones, which "compels companies to settle infrastructure within Turkey" ([IncCountry](https://incountry.com/blog/data-protection-laws-in-turkey-what-laws-you-need-to-comply/); [Gün+Partners, data residency in Turkey](https://gun.av.tr/insights/guides/data-residency-in-turkey-for-2025); [Recording Law, data-localization by country](https://www.recordinglaw.com/world-laws/world-data-privacy-laws/data-localization-laws-by-country/)). **This is where the local/open-source-first architecture becomes a commercial weapon:** because AcuDx defaults to self-hosted open-weight models (`docs/research/08` §6), it can rent GPUs in a **Türkiye region or run the VPC/on-prem appliance inside the institution's own data center** — PHI/learner data never leaves AcuDx-controlled hardware in-country, satisfying KVKK/Sağlık-Bakanlığı residency without a single US API call. A frontier-API-first competitor structurally cannot make this promise. **The on-prem appliance is the Turkey enterprise SKU.**

### 5.4 Turkey go-to-market mechanics

- **Local partners / resellers.** Public-university and ministry procurement in Turkey strongly favors a **local corporate entity / reseller** (invoicing in TRY, local VAT, Turkish-language contracts, local support). Recruit 1–2 Turkish ed-tech/health-IT resellers as channel; consider a local subsidiary before the first ministry-scale deal.
- **Turkish medical societies** (specialty dernekleri, TTB — Turkish Medical Association) for CPD/CME credibility and content endorsement (§6).
- **Language & trust.** Full TR text+voice parity, Turkish clinician-fluent QA reviewer (not generic translation), TL-billing, Turkish support SLA, and TR-scoped guideline citations (TEPDAD/Sağlık Bakanlığı, not NICE/AHA) are **table stakes** for Turkish trust, per `docs/research/09` §6.
- **Beachhead sequence:** foundation universities (fast, budget) → flagship public medical faculties (via TEPDAD credibility + reference logos) → ministry/hospital in-service (via on-prem residency SKU).

---

## 6. The 7-role committee (enterprise motion)

The enterprise sale is a **complex B2B2C** motion with 7 veto-holding roles (full deep-dive in `docs/stakeholders/03`). AcuDx sells to the *committee*, not the user: arm the **champion** with ammunition for the **economic buyer** to clear the **blockers** (any one a hard veto).

| # | Role | US title | Turkey equivalent | AcuDx-motion role | Their win condition | Sales artifact we hand them |
|---|---|---|---|---|---|---|
| A | **Dean / Vice-Dean of Med-Ed** | Dean, Assoc. Dean UME/GME | Dekan / Eğitim Koordinatörü | **Economic buyer** | Accreditation leverage, outcome delta, faculty time saved | ROI one-pager + accreditation-evidence demo |
| B | **Assessment / Med-Ed Director** | Director of Assessment, Clerkship Dir | Ölçme-Değerlendirme / Eğitim Koordinatörü | **Champion** | Valid, framework-mapped, defensible formative assessment + remediation loop | Framework-mapping sheet (Miller/ACGME/EPA + TEPDAD/UÇEP), validity brief |
| C | **Program Coordinator / Admin** | Program Coordinator, Sim-Center Mgr | Program Koordinatörü | **Daily operator / renewal veto** | Zero-touch rostering, grade passback, low support load | LTI 1.3 + SIS/SSO setup guide, support SLA |
| D | **IT & Security (CISO/CTO)** | CISO, IT Director | Bilgi İşlem / Güvenlik | **Hard blocker** | SSO, HECVAT, data flows, no surprise subprocessors | HECVAT 4, SOC 2 Type II, subprocessor+model list, **in-country residency plan** |
| E | **Procurement / Sourcing** | Procurement Officer | Satın Alma / İhale | **Terms blocker** | TCO, clean terms, no lock-in, references | Transparent price sheet, DPA, exit clause, **co-op vehicle / local reseller invoice** |
| F | **Data Protection Officer** | DPO, Privacy/Counsel | KVKK Veri Sorumlusu / Hukuk | **Legal blocker** | Lawful basis, DPA, "no training on our data", residency | DPA/BAA templates, **KVKK cross-border/residency answer**, DPIA support |
| G | **Accreditation Liaison** | Accreditation Coordinator, CQI Lead | TEPDAD/BİDR Sorumlusu | **Evidence blocker / strongest renewal lever** | Audit-ready evidence tied to standards | One-click accreditation export (LCME/ACGME/**TEPDAD/UÇEP**) |

**Committee sequencing:** the **champion (B)** runs the pilot and builds the business case; the **Dean (A)** says yes on ROI + accreditation; then B shepherds the deal through **D/E/F/G** in parallel using the pre-built artifacts. The enterprise-readiness gate (HECVAT 4, SOC 2 Type II, VPAT/WCAG 2.2 AA, DPA/BAA, residency) must be **passed before the pitch** — any missing item is weeks of delay or a veto (`docs/stakeholders/03` §8). Fiscal-year boundaries mean a **July pilot targets *next* July's budget** — plan the 6–14-month cycle accordingly.

---

## 7. Pilot playbook

The pilot is the bridge from PLG signal to paid contract. It is **paid** (skin in the game, filters tire-kickers), **time-boxed** (one semester/block), **single-cohort**, and **metric-agreed up front**.

**Structure:**
1. **Qualify (champion + PLG signal).** Prefer schools already showing organic cohort usage; the champion (Assessment Director / course director) is named and bought in.
2. **Scope one cohort, one block.** Typically an EM/acute-care clerkship or an OSCE-prep window (the wedge's strongest fit). US: map to ACGME/AAMC-EPA + LCME. Turkey: map to UÇEP core presentations + TEPDAD standards.
3. **Agree success metrics up front (the contract test):**
   - Learner engagement: median **≥3 encounters/week**, first-encounter completion **>70%** (mirrors the MVP gate, `docs/00-overview/01` §6).
   - Learning signal: **measured competence rises wk1→wk6** on a held-out case (not just self-rated confidence).
   - Faculty burden: **net-negative educator-minutes** (creation time saved > oversight time added; instrument it — this is tension T9, the thesis inverts if false).
   - Institutional artifact: one **accreditation-export** produced and reviewed by the Accreditation Liaison.
4. **Price.** Program-pilot fee ($8k–$15k US / ~₺100k–190k TR), **credited toward year-1** on conversion.
5. **Convert.** Pilot results → committee clearance (§6) → annual single-cohort license → expand.

**Pilot → expansion ladder:** 1 cohort → adjacent cohorts/specialties → whole UME class → + GME programs → multi-campus. Renewal is driven by the **institutional layer** (accreditation evidence, remediation-loop closure, operational smoothness), not learner sizzle (`docs/stakeholders/03` §9).

---

## 8. Partnerships

Partnerships de-risk content/compliance and open distribution — AcuDx partners for guidelines and credentials rather than reproducing them (`docs/research/04` §4).

| Partner class | Examples | Value to AcuDx | Motion |
|---|---|---|---|
| **Guideline bodies (open-license first)** | WHO, GINA, GOLD, USPSTF, CDC, NICE-UK | Grounded, citable clinical content for the guidance layer; trust/credibility | License/attribution; open-license domains first, defer ATLS/UpToDate/AMBOSS to paid deals (`docs/00-overview/01` G-6) |
| **Turkish societies / guideline sources** | **TEPDAD, T.C. Sağlık Bakanlığı, TİTCK, TTB (Turkish Medical Assoc.), specialty dernekleri** | TR-scoped grounding + accreditation credibility + local endorsement | Content/endorsement partnership; TEPDAD mapping is the accreditation wedge |
| **CME / CPD accreditors** | ACCME (US, AMA PRA Cat-1), **TTB/local TR CPD** | Monetizable credit (Pro+CME lever); clinician acquisition | Accreditation provider partnership per geography |
| **LMS marketplaces** | Canvas, Moodle, Blackboard, Brightspace app catalogs | Distribution to IT-approved institutions; LTI 1.3 Advantage listing | 1EdTech LTI Advantage Complete certification → marketplace listing (`docs/stakeholders/03` §3) |
| **Cooperative purchasing vehicles** | E&I Cooperative, Internet2 NET+ (US); **local reseller / channel (Turkey)** | Skip full RFPs; faster procurement; local invoicing/VAT | Co-op contract (US); reseller agreement + local entity (TR) |
| **Complementary content (non-compete)** | Qbank/reference partners where interoperation beats competition | Bundle/interoperate; AcuDx = interaction+assessment layer atop their content | Interop/integration, not head-to-head |

**Explicitly NOT a partnership to chase early:** head-on content licensing with AMBOSS/Elsevier where it invites a fast-follow into roleplay (`docs/research/04` §5.3). Partner on guidelines and distribution; keep the multiplayer/voice/calibration moat proprietary.

---

## 9. 0–18-month sequence

| Phase | Months | PLG | Enterprise | Turkey | Gate to advance |
|---|---|---|---|---|---|
| **0. Wedge live** | 0–3 | Free tier + Pro live (EN); EM text wedge + calibration plot; first ambassadors at 5–10 schools | — (no enterprise motion until PLG proven) | TR i18n groundwork; TR guideline store (UÇEP/TEPDAD/TİTCK) seeded | **MVP success gate**: cohort ≥200, D30 ≥25%, ≥3 enc/wk, competence rises wk1→6, 1st-enc completion >70%, calibration comprehension ≥80%, encounter cost <$0.15, **1 paid design-partner pilot** (`docs/00-overview/01` §6) |
| **1. Prove PLG + first pilots** | 3–6 | Scale ambassadors to ~25–40 schools (both geos); Pro+CME (US); referral loops | Convert design-partner + 2–3 PLG-sourced pilots; build the 7-role artifact kit; start HECVAT/SOC 2 Type II | **TR launch**: full TR text+voice parity; TRY/PPP pricing live; foundation-university beachhead pilots | Free→Pro ≥3%; ≥3 paid pilots signed; enterprise-readiness gate items in progress |
| **2. Enterprise engine + Turkey residency** | 6–12 | Voice-Pro tier; team-rooms virality; specialty expansion beyond EM | Land 5–15 single-cohort contracts; LTI Advantage cert + LMS marketplace listings; co-op vehicles | Local reseller/entity; **on-prem/VPC appliance (KVKK residency SKU)** shipped; first TEPDAD-mapped Turkish school contract | ≥5 paying institutions; pilot→paid ≥40%; SOC 2 Type II + HECVAT 4 complete |
| **3. Land-and-expand + scale** | 12–18 | Multiplayer/OSCE-pair growth; international (other locales gated on demand) | Expand within logos (cohort→school→GME→multi-campus); reference-sell to peer institutions | Public-university + ministry/hospital in-service via residency SKU; Turkish society endorsements | ≥90% logo retention; multi-campus deals in pipeline; positive PLG→enterprise attribution |

**Sequencing discipline (from `docs/00-overview/01` R6):** do **not** run the enterprise motion or ship voice/3D/multiplayer before the text-EM wedge clears its MVP gate. PLG proof precedes enterprise; the learner-loved loop precedes the dean's-office dashboard. Turkey launches at Phase 1 (not deferred), but its *enterprise* motion (residency SKU, ministry) lands in Phase 2–3 once the appliance and local entity exist.

---

## Open questions & assumptions

- **PPP multiplier (~0.30–0.35× US list for Turkey)** is a strategic assumption from a ~3× FX/PPP gap, not a tested price point — validate against actual Turkish willingness-to-pay in Phase-1 pilots; the lira's ~17% YoY depreciation means the multiplier needs a **semi-annual re-index rule** or margin silently erodes.
- **Free→Pro conversion (3–6% blended)** is borrowed from consumer-ed-tech norms; a high-intent clinical audience may convert higher (good) or resist paying atop an existing AMBOSS/UWorld spend (bad). This ratio drives the entire PLG revenue model — measure it before scaling ambassador spend.
- **PLG-to-enterprise causality is assumed, not proven.** The whole thesis (T11) is that organic cohort usage seeds enterprise deals. If pilots come from cold outreach instead of PLG signal, the motion is really enterprise-first and the funnel model changes. **Instrument attribution from day one.**
- **Turkey local-entity / reseller requirement** for public-university and ministry procurement is asserted from KVKK/procurement norms; confirm with Turkish counsel whether a local subsidiary is needed before the first ministry-scale deal, and when (cost/timing of incorporation vs first revenue).
- **On-prem appliance economics** assume the institution sustains >3–5M tokens/day to beat API; a single-cohort Turkish pilot may sit *below* break-even, so the residency SKU may run at negative unit margin until volume — price the appliance as license+support (not per-seat) to cover this, and confirm the break-even against real pilot volume.
- **CME/CPD monetization in Turkey** (TTB/local CPD vs US AMA PRA) is under-specified — the Pro+CME lever is US-proven (Full Code); the Turkish equivalent's willingness-to-pay and accreditation path need validation.
- **Enterprise price bands ($25k–$500k/yr US; PPP-discounted TR)** are anchored to `docs/stakeholders/03` and competitor quotes, but institutional deals are near-universally negotiated — treat bands as anchors, not invoices; the first 3–5 contracts set the real reference.
- **Ambassador CAC and per-activated-peer bounty** are unquantified; the ~155 US + ~90 TR school target implies a sizable ambassador program — model CAC per activated Pro user before committing bounty budget at scale.
