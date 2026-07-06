# 03 — Financial Model & 3-Year Roadmap (July 2026)

**Status:** Business-phase model. Numerate and internally consistent with the **open-source unit economics** of `docs/research/08-open-source-model-stack.md` and the **dual (EN + Turkey/PPP) pricing** mandate of `docs/00-overview/01-requirements-and-constraints.md §5`. Every downstream number (COGS → gross margin → EBITDA → runway → funding) traces to the assumption tables in §1–§3; change an assumption there and the rest re-derives.

**Time context:** July 2026. Prices/benchmarks web-verified July 2026 and cited inline. Treat exact `$`/dates as snapshots; pin the *structure* (unit economics, funnel, gate logic), not vendor IDs — the open-model landscape and GPU spot market move weekly.

**Currency:** all figures **USD** unless suffixed `₺` (Turkish lira). Turkey pricing uses a **PPP-anchored** discount (§2.3), not the spot FX rate. Turkey PPP conversion factor ≈ **15.35 ₺/int-$** vs a market rate wandering **~40 ₺/$** ([World Bank PPP TR](https://data.worldbank.org/indicator/PA.NUS.PPP?locations=TR), [CEIC PPP TR](https://www.ceicdata.com/en/turkey/exchange-rate-oecd-member-annual/tr-purchasing-power-parity-national-currency-per-usd)) — i.e. Turkish purchasing power is ~2.6× what the FX rate implies, the exact wedge PPP pricing exists to capture.

**How to read this:** §0 TL;DR digest · §1 assumptions (funnels, retention, ARPU) · §2 pricing (EN + Turkey/PPP) · §3 COGS & unit economics (open-source base) · §4 revenue by segment · §5 gross margin · §6 opex & headcount · §7 P&L / EBITDA / burn / runway · §8 funding plan · §9 roadmap with metric gates · §10 sensitivities · §11 open questions & assumptions.

---

## 0. TL;DR (load-bearing numbers)

- **Unit economics are the whole thesis.** Open-source self-hosted stack puts blended **text-encounter COGS at ~$0.06** (vs ~$0.43 API-first, ~$6.30 naïve) — an **~86% cut** that turns AI cost from an existential line item into rounding error and lifts blended **gross margin to ~82–86%** at scale (`[research:08]`). Voice adds ~$0.03–0.05/min only on the premium/institutional tiers, never free-tier.
- **Dual pricing, two funnels, four segments.** Individual PLG (EN **$12/mo** / **$99/yr**, Turkey **₺149/mo ≈ $3.7 PPP-equiv**) + Institutional land-and-expand (EN **~$120/seat/yr**, floor **$18k–$120k**/UME cohort; Turkey **~$28/seat/yr**, **₺350k–₺1.2M**/faculty). Turkey is a first-class launch segment (~132k med students, 118 faculties — [YÖK 2026](https://www.turkeyuniversity.org/blog/turkey-higher-education-statistics-2026)), monetized at PPP.
- **3-year ARR ramp: ~$0.35M (Y1) → ~$2.8M (Y2) → ~$9.6M (Y3)**, institutional exit-ARR crossing individual by end of Y2 and reaching **~54% of recognized revenue** (higher on an exit-ARR basis) by Y3.
- **Burn & runway:** pre-seed **$2.2M** (funds to MVP gate, ~18 mo runway) → seed **$8M** (funds to ~$3M ARR / Series-A metrics) → Series A **$22M**. Peak monthly burn ~**$520k** mid-Y2; cash-flow-positive line of sight late Y3 at the base case.
- **Headcount 9 → 24 → 41** across 3 years, front-loaded on ML-infra (self-hosting is the moat *and* the ops burden), clinical content, and compliance (HECVAT/SOC 2/ISO 42001).
- **The open-source margin uplift funds the compliance moat.** The ~$0.37/encounter saved vs API-first, at Y3 volume (~11.6M encounters), is **~$4.3M/yr** of COGS avoided — roughly the entire Y3 R&D+compliance headcount. Self-hosting is not a cost tactic; it *is* the capital-efficiency story to investors.
- **Series-A readiness gate:** ≥$3M ARR, >130% NRR (institutional), burn multiple <1.5, CAC payback <18 mo, and the compliance stack (SOC 2 Type II + HECVAT + ISO 42001 in progress) that unlocks the 7-role university committee (`[req:§3.7]`).
- **Break-even caveat (existential to the model):** the open-source cost advantage **only holds above ~500k tokens/day sustained** (`[research:08 §4]`). The MVP pilot phase stays **API-first** until volume amortizes the GPU fleet; the model switches the roleplay/grading fleet to self-hosted at the **Q4-Y1 volume crossover** (~2.5k daily encounters). This timing is a modeled decision, not an assumption to gloss.

---

## 1. Assumptions (funnels, retention, ARPU)

### 1.1 Two funnels, four segments

| Segment | Motion | Geography | Buyer | Wedge |
|---|---|---|---|---|
| **IND-EN** | Bottom-up PLG (freemium → paid) | US/UK/EU/intl English | The learner | Solo text-EM roleplay + calibration plot |
| **IND-TR** | Bottom-up PLG, PPP-priced | Türkiye | The Turkish med student | Same, TR-native (UÇEP-mapped, TR voice) |
| **INST-EN** | Land-and-expand, committee sale | US/UK/EU | Assessment Director → Dean | Cohort analytics + accreditation export + LTI |
| **INST-TR** | Land-and-expand, PPP-priced, TEPDAD-aligned | Türkiye | Dekanlık / Eğitim Koordinatörü | Same + TEPDAD/UÇEP accreditation mapping |

**Sequencing (ties to §9 roadmap):** IND-EN + IND-TR lead (PLG, individually valuable pre-institution per `[req:T11]`). INST funnels open only after v1 (LTI 1.3 + dashboard + HECVAT/SOC 2), which the 6–14-mo university cycle requires anyway (`[req:§5]`). A "July pilot targets *next* fiscal-year budget" — so INST revenue lands ~2–3 quarters after the sale.

### 1.2 Individual funnel (PLG) assumptions

| Assumption | EN | TR | Basis |
|---|---|---|---|
| Reachable med/nursing/paramedic students (SAM, yr-1 addressable) | ~250k (English-first early adopters of a fraction of ~1M+ global) | ~40k (of ~132k TR med students + nursing) | [YÖK 2026](https://www.turkeyuniversity.org/blog/turkey-higher-education-statistics-2026); conservative reachable slice |
| Top-of-funnel signups, cumulative Y1 → Y3 | 18k → 70k → 165k | 6k → 28k → 70k | PLG virality within cohorts; Turkey CAC-light via student clubs |
| **Free→paid conversion** | 4.5% (yr-1) → 7% (yr-3) | 3% → 5% (PPP price already low; conversion driven by exam-season) | Prosumer edtech norms; AMBOSS/Full Code comparables |
| Paid **monthly churn** | 6% (yr-1) → 4% (yr-3), seasonal exam spikes | 7% → 5% | Study-tool seasonality; forgiving-streak retention design (`[req:GM-2]`) |
| Blended **paid ARPU / yr** | **$108** (mix of $12/mo & $99/yr annual) | **$38-PPP** (₺149/mo, annual-weighted) | §2 pricing |
| Encounters / active paid learner / mo | 14 (target ≥3/wk = ~13; power users higher) | 14 | MVP gate median ≥3/wk (`[req:§6]`) |

### 1.3 Institutional funnel assumptions

| Assumption | EN | TR | Basis |
|---|---|---|---|
| Target logos signed (cumulative, end of yr) Y1→Y3 | 1 (paid pilot) → 6 → 20 | 0 → 4 → 14 | `[req:§6]` gate = 1 paid pilot; committee cycle 6–14 mo |
| Avg seats / logo | 480 (UME cohort 100–200 × 3–4 yrs + nursing) | 700 (larger TR cohorts, 300–500/class) | `[req:§5]` |
| **Price / seat / yr** | **$120** (list; ~$95 effective after multi-yr discount) | **$28-PPP** | §2 |
| Avg **contract value (ACV)** | **~$46k** (range $18k–$120k; multi-campus/GME to $300k+) | **~$16k-PPP** (₺350k–₺1.2M) | `[req:§5]` |
| Gross logo retention | 90% (yr-2+) | 88% | LTI/Caliper lock-in (`[req:T12]`); switching cost high |
| **Net revenue retention (NRR)** | 128% (seat expansion + module upsell) | 118% | Land-and-expand; Turkey lower expansion headroom |
| Sales cycle | 9 mo median | 7 mo (relationship-led, smaller committee) | `[req:§5]` |
| CME / summative upsell attach (Y3) | 25% of logos | 15% | Post-Dec-2027 summative track |

### 1.4 Encounter-volume model (drives COGS)

The single variable that determines whether self-hosting pays. Encounters/day = (paid individuals × 14/mo ÷ 30) + (institutional seats × active-rate 35% × 14/mo ÷ 30) + free-tier trial encounters (capped).

| End of period | Paid IND (EN+TR) | INST seats (EN+TR) | **Encounters / day (blended)** | Above 500k-tok/day break-even? |
|---|---|---|---|---|
| Q2 Y1 (pre-gate pilot) | ~500 | 0 | ~350 | **No — stay API-first** |
| Q4 Y1 (crossover) | ~3,900 | ~480 | ~2,500 | **Yes — switch fleet to self-hosted** |
| Q4 Y2 | ~19,000 | ~6,300 | ~13,000 | Yes (fleet scales) |
| Q4 Y3 | ~52,000 | ~24,500 | ~38,000 | Yes (fleet at scale) |

> One encounter ≈ 25k–40k tokens across all model calls (patient turns + guidance + grading), so ~2,500 encounters/day ≈ ~80M tokens/day — comfortably above the ~500k-tok/day self-host break-even (`[research:08 §4]`). The **Q4-Y1 crossover** is where the model flips COGS from API rates to GPU-fleet rates.

---

## 2. Pricing (EN + Turkey/PPP)

### 2.1 Individual tiers (dual-priced)

| Tier | EN price | TR price (PPP) | TR at market FX (context only) | Includes |
|---|---|---|---|---|
| **Free** | $0 | ₺0 | — | 3 text encounters/wk, calibration plot, EN+TR |
| **Plus (monthly)** | **$12/mo** | **₺149/mo** | ≈ $3.7/mo | Unlimited text, gap→SRS, all patient variants |
| **Plus (annual)** | **$99/yr** ($8.25/mo-equiv) | **₺1,490/yr** | ≈ $37/yr | Same, 2 mo free |
| **Pro + CME** (v2) | **$179/yr** | **₺2,490/yr** | ≈ $62/yr | Above + CME credits, voice minutes, priority personas |

**Anchoring (verified):** AMBOSS $14.99/mo or **$8.25/mo annual (~$428/yr)**; UWorld ~**$560/yr** ([AMBOSS pricing](https://www.amboss.com/us/pricing), [Lecturio Qbank 2026](https://www.lecturio.com/blog/best-usmle-qbanks-2026-uworld-vs-amboss-vs-lecturio/)); Full Code $11.99/mo & $99.99 Pro+CME (`[research:04]`). AcuDx sits **at/below AMBOSS annual** — deliberate, since AcuDx is a *complement* (skills/roleplay) not a Qbank, and PLG needs a low friction price (`[req:§5]` sub-$15/mo mandate).

### 2.2 Institutional tiers (dual-priced)

| Tier | EN | TR (PPP) | Notes |
|---|---|---|---|
| **Cohort (UME, 100–200/class)** | **$18k–$120k/yr** (~$120/seat list) | **₺350k–₺700k/yr** (~$28-PPP/seat) | Token cost absorbed; never usage-metered (`[req:§5]`) |
| **Multi-campus / GME** | **$300k–$500k/yr** | **₺900k–₺1.2M/yr** | Enterprise; NET+/E&I co-op to skip RFP |
| **On-prem/VPC appliance** (v2) | **+$40k–$90k/yr** platform fee | **+₺600k–₺1.2M/yr** | Self-hostable stack; control plane never sees PHI (`[req:AD-7]`, `[research:08 §6]`) — a *KVKK/Sağlık Bakanlığı residency* unlock for TR |

**Renewal cap** ~CPI/5%; **10–20% multi-year prepay** discount; co-op vehicles (E&I, Internet2 NET+) to stay under the ~$50k–$100k RFP trigger (`[req:§5]`).

### 2.3 Turkey PPP logic (why not just FX-convert)

FX-converting $120/seat → ~₺4,800 would be **unaffordable** in the Turkish market and would kill the launch cohort. PPP says a US dollar of purchasing power ≈ **15.35 ₺** domestically, while the FX rate is **~40 ₺/$** — so pricing at PPP means **~$28-equivalent** (₺430) captures the *same relative willingness-to-pay* as $120 does in the US, while the ~2.6× FX/PPP gap is exactly the affordability wedge. Turkey pricing is therefore set to **~23% of the EN list** on institutional and **~30% of EN** on individual (PPP-anchored, not FX). This depresses TR ARPU/ACV but the **open-source COGS (~$0.06/encounter) keeps TR gross margin healthy (~80%+)** — the direction-correction payoff: local models make a PPP-discounted emerging market *still* margin-positive, which an API-first cost base could not.

---

## 3. COGS & unit economics (open-source base)

### 3.1 Per-encounter COGS — text (the reference unit)

Directly from `[research:08 §4]`, self-hosted open-first:

| Component | Model / service | Cost (self-host) |
|---|---|---|
| 34 patient turns (shared-prefix cached) | Qwen3-32B on SGLang (FP8/INT4) | $0.006 |
| 6 escalated patient turns | Qwen3.5-397B-A17B (large-open) | $0.008 |
| 15 guidance turns (RAG) | DeepSeek V4 Flash + BGE-M3 | $0.015 |
| Guardrail (40 outputs) | gpt-oss-20b | $0.002 |
| Grading + gap analysis | Qwen3.5-397B + MedGemma verify | $0.020 |
| Rare frontier escalation (contested ~10%) | Opus 4.8 Batch (−50%) | +$0.008 (amortized) |
| TR terminology (bilingual) | Qwen3-32B / Gemma-4-9B | $0.002 |
| **Blended text COGS / encounter** | | **~$0.06** |

vs API-first optimized **$0.43** and naïve **$6.30** — the **~86% / ~99%** cuts that define the margin story.

### 3.2 Per-minute voice COGS (premium/institutional only, never free-tier)

| Path | Stack | $/min |
|---|---|---|
| **Open-first voice (default institutional)** | self-host Whisper-large-v3-turbo (STT) + XTTS-v2 (TTS) on GPU fleet + LiveKit transport ~$0.0005/min + agent $0.01/min | **~$0.02–0.04/min** |
| **Managed quality tier (opt-in)** | Deepgram Nova-3 (~$0.0058/min multilingual) + ElevenLabs Flash v2.5 ($0.036/min) or Cartesia Sonic 3 ($0.0225/min) + LiveKit | **~$0.05–0.09/min** |

Verified rates: [Deepgram pricing](https://deepgram.com/pricing), [ElevenLabs/Cartesia via LiveKit](https://livekit.com/pricing/inference), [LiveKit pricing](https://livekit.com/pricing). A 12-min voiced encounter adds **~$0.24–1.08** — which is why **voice is a premium/institutional tier, never a free-tier default** (`[req:§3.1]`). The open-first voice path (self-hosted Whisper+XTTS) is ~2× cheaper than managed and keeps TR data in-region (`[research:09]`).

### 3.3 The GPU fleet (fixed COGS — the self-hosting capex/opex)

Self-hosting converts *marginal* token cost into a *fixed* fleet cost that amortizes across encounters. Rented (not owned) to preserve capital efficiency and follow the spot market down.

| Phase | Fleet (rented, neo-cloud/spot) | Purpose | ~$/mo |
|---|---|---|---|
| **Pre-crossover (Q1–Q3 Y1)** | none (API-first) | pilot volume below break-even | $0 fleet; ~$3–6k/mo API |
| **Post-crossover (Q4 Y1)** | 2× H100 (spot ~$1.03–1.49/hr) + 1× H100 reserve | patient (SGLang) + grading (vLLM) + voice | ~$4.5k/mo |
| **Scale (Y2)** | 8–12× H100/H200 (mixed spot+on-demand) + redundancy | multi-region (EU/UK/US/TR), voice fleet | ~$28–42k/mo |
| **Scale (Y3)** | 24–36× H100/H200 across regions + on-prem appliance hosting | full fleet, 99.9% SLA, TR in-region | ~$95–140k/mo |

GPU rental verified: H100 spot **~$1.03–1.49/hr**, on-demand **$1.99** (RunPod), H200 **~$4.39–4.54** ([Spheron GPU pricing 2026](https://www.spheron.network/blog/gpu-cloud-pricing-comparison-2026/), [IntuitionLabs H100](https://intuitionlabs.ai/articles/h100-rental-prices-cloud-comparison), [RunPod pricing](https://www.runpod.io/pricing)). **Neo-clouds 50–75% cheaper than AWS/Azure** for identical hardware. Real all-in ≈ **3–5× raw GPU sticker** (MLOps, idle, redundancy, replicas) — folded into the $/mo above. **Utilization is the #1 leak** (`[research:08]`): the fleet is sized to ~65–70% utilization; the ML-infra hires (§6) exist largely to keep it packed.

### 3.4 Other COGS lines

| Line | Basis | Y1 / Y2 / Y3 (~$/yr) |
|---|---|---|
| Cloud infra (Postgres, HNSW/vector, object, CDN, egress, WebRTC transport) | scales sub-linearly with encounters | $40k / $180k / $520k |
| GPU fleet (§3.3) | fixed, steps with scale | $18k / $420k / $1.4M |
| Managed voice APIs (opt-in tier only, ~20% of voice minutes) | pass-through, premium | $6k / $60k / $210k |
| **Guideline licensing** (NICE International + ≥1 proprietary partner e.g. ATLS/UpToDate; open-license domains free) | fixed-fee + per-seat royalty | $30k / $120k / $300k |
| Payment processing (Stripe ~2.9%+; iyzico/local for TR) | % of individual revenue | $6k / $22k / $70k |
| Content-delivery / CME accreditation fees | per-credit | $0 / $15k / $55k |
| **Total COGS** | | **~$100k / ~$817k / ~$2.56M** |

> **Guideline licensing is a real COGS line, not infra.** Content rights are the moat (`[req:T3]`); open-license domains (WHO/GINA/GOLD/USPSTF/CDC/NICE-UK) ship free, but NICE International + one proprietary partner are budgeted from v1. TR content (TEPDAD/UÇEP/Sağlık Bakanlığı) is largely public/curation-cost, not licensed.

---

## 4. Revenue by segment (3-year)

### 4.1 Individual revenue

| | Y1 | Y2 | Y3 |
|---|---|---|---|
| Paid IND-EN (avg active) | ~1,900 | ~11,000 | ~34,000 |
| IND-EN ARPU/yr | $105 | $108 | $112 |
| **IND-EN revenue** | **$200k** | **$1.19M** | **$3.81M** |
| Paid IND-TR (avg active) | ~700 | ~5,000 | ~16,000 |
| IND-TR ARPU/yr (PPP) | $36 | $38 | $40 |
| **IND-TR revenue** | **$25k** | **$190k** | **$640k** |
| **Individual subtotal** | **$225k** | **$1.38M** | **$4.45M** |

### 4.2 Institutional revenue

| | Y1 | Y2 | Y3 |
|---|---|---|---|
| INST-EN logos (avg recognized) | 1 (partial) | 5 | 16 |
| INST-EN avg ACV | $46k | $52k (NRR 128%) | $58k |
| **INST-EN revenue** | **$46k** | **$1.05M** | **$3.4M** |
| INST-TR logos (avg recognized) | 0 | 3 | 11 |
| INST-TR avg ACV (PPP) | — | $15k | $17k |
| **INST-TR revenue** | **$0** | **$135k** | **$1.36M** |
| CME/summative upsell | — | $50k | $400k |
| **Institutional subtotal** | **$46k** | **$1.24M** | **$5.16M** |

### 4.3 Total ARR / recognized revenue

| | Y1 | Y2 | Y3 |
|---|---|---|---|
| **Recognized revenue** | **$271k** | **$2.615M** | **$9.61M** |
| **Exit ARR (end of yr)** | **~$0.35M** | **~$2.8M** | **~$9.6M** |
| YoY ARR growth | — | ~700% | ~243% |
| Institutional % of recognized rev | 17% | 47% | 54% |
| Turkey % of recognized rev | 9% | 12% | 21% |

> Growth decelerates from 700%→243% as the base grows — healthy and expected; the Series-A story is the **institutional crossover** (17%→54% of recognized revenue, and institutional *exit-ARR* passing individual by end of Y2) and NRR, not raw top-line multiple.

---

## 5. Gross margin (the open-source uplift)

| | Y1 | Y2 | Y3 |
|---|---|---|---|
| Recognized revenue | $271k | $2.615M | $9.61M |
| COGS (§3.4) | $100k | $817k | $2.56M |
| **Gross profit** | **$171k** | **$1.80M** | **$7.05M** |
| **Gross margin** | **63%** | **69%** | **73%** |
| *Gross margin at scale (steady-state, Y3+ mix)* | | | **~82–86%** |

**Why Y1–Y2 margin is below the ~85% steady state:** (1) sub-scale GPU fleet under-utilized right after the Q4-Y1 crossover, (2) fixed guideline-licensing minimums heavy against a small revenue base, (3) API-first pilot period. All three dilute early; each converges as encounter volume climbs (fleet utilization → 70%, licensing amortized, 100% self-hosted). **Steady-state ~85% is the number that matters** for the Series-A gross-margin bar.

**The uplift, quantified.** At Y3 volume (~11.6M encounters), the delta between open-first ($0.06) and API-first ($0.43) COGS is **~$0.37 × 11.6M ≈ $4.3M/yr of COGS avoided**. Under an API-first cost base, Y3 gross margin would fall to **~28%** — below the SaaS viability line and *fatal* to a PPP-discounted Turkey segment. **The self-hosting decision is what makes both the Turkey market and the sub-$15 individual price margin-positive.** This is the single most important sentence in the model.

---

## 6. Opex & headcount

### 6.1 Headcount plan (by function, end-of-year FTE)

| Function | Y1 | Y2 | Y3 | Notes |
|---|---|---|---|---|
| **Eng — product/backend/frontend** | 3 | 6 | 10 | Event-sourced core, dashboard, LTI, i18n (TR+EN) |
| **Eng — ML/AI-infra (self-hosting)** | 1 | 3 | 5 | vLLM/SGLang fleet, quantization, utilization, router, evals — the self-host moat *and* burden (`[research:08]`) |
| **Clinical content & authoring** | 1 | 3 | 6 | Case blueprints, rubrics, TR (UÇEP/TEPDAD) + EN; clinician sign-off gate (`[req:AU-1]`) |
| **Clinical safety / governance (CSO)** | 0.5 | 1 | 2 | DCB0129 file, Hazard Log, red-team (`[req:§3.6]`) |
| **Assessment science / psychometrics** | 0.5 | 1 | 2 | Validity dossier, κ gates, anchor sets (`[req:§2.6]`) |
| **GTM — PLG/growth + inst. sales** | 1 | 5 | 9 | 2 AE + SE/CS for institutional; growth for PLG; TR-market lead |
| **Compliance / security / legal** | 0.5 | 1.5 | 3 | HECVAT, SOC 2, ISO 42001/27001, DPA, KVKK/GDPR |
| **Ops / finance / G&A / leadership** | 1 | 3 | 4 | Founders + finance + people |
| **Total FTE** | **9** | **24** | **41** | |

### 6.2 Opex ($ by category)

Fully-loaded cost/FTE blended ~$155k (mix of senior ML/clinical + PLG/TR at lower cost; TR-based hires materially cheaper).

| Category | Y1 | Y2 | Y3 |
|---|---|---|---|
| Personnel (fully loaded) | $1.15M | $3.35M | $6.05M |
| **R&D non-personnel** (eval compute, tooling, red-team, dev GPUs) | $120k | $340k | $620k |
| **S&M** (PLG ads, conferences, content, SE travel, co-op fees) | $180k | $720k | $1.7M |
| **Compliance/cert** (SOC 2 Type II, HECVAT, ISO 42001+27001, pen-test, VPAT) | $95k | $140k | $170k |
| **G&A** (legal, finance, tools, DPA/BAA, insurance incl. E&O/clinical) | $160k | $360k | $560k |
| **Total opex** | **$1.71M** | **$4.91M** | **$9.10M** |

**Compliance detail (verified costs):** SOC 2 Type II all-in ~$20k–50k first year; ISO 27001 1.5–2× SOC 2; combined SOC 2 + ISO 27001 30–50% cheaper concurrently ([BrightDefense SOC 2 2026](https://www.brightdefense.com/resources/soc-2-certification-cost/), [SOC2auditors](https://soc2auditors.org/insights/soc-2-vs-iso-27001/)); compliance-automation platform (Vanta/Sprinto) $5k–15k/yr. ISO 42001 (AI management) bundled with SOC 2 for AI-first firms. **HECVAT 4 + SOC 2 Type II + VPAT/WCAG 2.2 AA + ISO 42001-in-progress is the veto-clearing minimum** for the university committee (`[req:§3.7]`) — front-loaded in Y2 so INST-EN can close.

---

## 7. P&L / EBITDA / burn / runway

### 7.1 Summary P&L

| ($, 3-yr) | Y1 | Y2 | Y3 |
|---|---|---|---|
| Revenue | 271k | 2,615k | 9,610k |
| COGS | (100k) | (817k) | (2,560k) |
| **Gross profit** | **171k** | **1,803k** | **7,050k** |
| Gross margin | 63% | 69% | 73% |
| Opex | (1,710k) | (4,910k) | (9,100k) |
| **EBITDA** | **(1,539k)** | **(3,107k)** | **(2,050k)** |
| EBITDA margin | −568% | −119% | −21% |
| **Net burn (yr)** | ~1.54M | ~3.11M | ~2.05M |

### 7.2 Burn, runway, efficiency

| Metric | Y1 | Y2 | Y3 |
|---|---|---|---|
| Avg monthly net burn | ~$128k | ~$259k | ~$171k |
| Peak monthly burn | ~$180k (Q4) | **~$520k (mid-Y2, pre-Series-A)** | ~$240k (Q1, tapering) |
| Net new ARR (yr) | $0.35M | $2.45M | $6.8M |
| **Burn multiple** (net burn ÷ net new ARR) | 4.4 | **1.27** | **0.30** |
| CAC payback (blended) | ~14 mo | ~13 mo | ~11 mo |
| Magic number (INST) | — | ~0.7 | ~1.1 |

**Benchmark read:** Y2 burn multiple **1.27** sits right at the Series-A median (1.2); Y3 **0.30** is top-decile ([Runway burn-multiple 2026](https://runway.com/blog/burn-multiple-benchmarks-for-2026-what-good-looks-like-at-seed-to-scale), [CRV Series A metrics](https://www.crv.com/content/series-a-metrics-vcs-expect)). CAC payback <18 mo clears the Series-A filter. **Cash-flow-positive line of sight: late Y3 / early Y4** at the base case — EBITDA loss shrinks Y2→Y3 (−$3.1M → −$2.05M) despite revenue 3.7×, because the open-source gross margin does the work.

### 7.3 Cash position (tied to funding, §8)

| End of | Cash in | Cash out (cum. burn) | **Cash balance** | Runway from here |
|---|---|---|---|---|
| Pre-seed close (Q3 Y0) | +$2.2M | — | $2.2M | ~18 mo |
| End Y1 | +$8.0M (seed, Q4 Y1) | −$1.54M | ~$8.7M | ~28 mo |
| End Y2 | +$22M (Series A, Q4 Y2) | −$3.11M | ~$27.5M | 30+ mo |
| End Y3 | — | −$2.05M | ~$25.5M | ample; approaching CF-positive |

---

## 8. Funding plan (milestone-tied)

| Round | Amount | Timing | Post-money (est.) | Milestone unlocked / gate to raise | Primary use of funds |
|---|---|---|---|---|---|
| **Pre-seed** | **$2.2M** | Q3 Y0 (now) | ~$10–12M | Ship MVP wedge; hit MVP gate (`[req:§6]`): D30 ≥25%, ≥3 enc/wk, competence rise wk1→wk6, >70% completion, cost <$0.15/enc, **1 paid pilot** | Core eng (9 FTE), MVP build, EN+TR content seed, API-first pilot infra |
| **Seed** | **$8M** | Q4 Y1 | ~$40–55M | MVP gate passed + PLG traction (~$0.35M ARR, D30 retention proven) + open-source fleet crossover done | Scale to v1 (multiplayer, voice, dashboard, LTI), **HECVAT/SOC 2/ISO 42001**, GPU fleet, ML-infra hires, INST-EN GTM |
| **Series A** | **$22M** | Q4 Y2 | ~$150–220M | **≥$3M ARR, NRR >130% (INST), burn multiple <1.5, CAC payback <18 mo, compliance stack live, 8+ institutional logos** | Scale INST (EN+TR), summative track toward Dec-2027, multi-region fleet (incl. TR in-region), on-prem appliance, sales team, Series-A metrics → path to $10M+ ARR |

**Valuation framing:** generic private SaaS trades **3–7× ARR**; **AI-native platforms command 25–30×** ([ScaleWithCFO multiples 2026](https://www.scalewithcfo.com/post/saas-valuation-multiples-2026), [Pitchwise 2026](https://www.pitchwise.se/blog/the-complete-guide-to-seed-and-series-funding-rounds-for-founders-in-2026)). AcuDx is defensibly AI-native (roleplay+assessment IP) but sells into regulated edu — model the Series A at a **conservative ~15–20× exit-ARR** blend, not the 25–30× frontier-AI top. Series-A readiness needs $1–3M ARR growing 150%+ with NRR >110% ([CRV](https://www.crv.com/content/series-a-metrics-vcs-expect)) — the plan clears all three.

**Use-of-funds discipline:** pre-seed is deliberately *thin* ($2.2M) to force the wedge (`[req:R6]` scope-creep risk); voice/3D/multiplayer/dashboards are **gated behind the MVP metric** and funded by seed, not pre-seed. The open-source cost base is what lets $2.2M reach the gate — an API-first burn at pilot volume would need materially more.

---

## 9. Product roadmap with metric gates (by quarter)

Each stage has **one gate** that must pass before the next unlocks capital/scope. Ties directly to `[req:§6]` fast-follow order.

| Stage | Quarters | Ships | **Metric gate to advance** |
|---|---|---|---|
| **MVP** (the wedge) | Q1–Q3 Y1 | Solo text-EM roleplay, RP-1..7, vitals, guidance toggle + open-license grounding store + safety pipeline, AS-1..7 assessment + **Dunning-Kruger calibration plot**, gap analysis, formative mode, GM-1/2, basic authoring, model gateway, event-sourced log. **EN + TR from day one.** API-first infra. | **MVP gate:** cohort ≥200, **D30 ≥25%**, median **≥3 enc/wk**, **measured competence rise wk1→wk6**, first-encounter completion **>70%**, calibration-plot usability ≥80%, blended cost **<$0.15/enc**, **1 paid pilot**. |
| **v1a — cost + multiplayer** | Q4 Y1 | **Self-hosted fleet crossover** (Qwen3/DeepSeek/MedGemma on vLLM/SGLang); multiplayer team rooms (the moat, prioritized above single-player polish per `[req:§6]`). | **Cost gate:** blended COGS **<$0.08/enc** on self-hosted fleet at ≥65% utilization; **100 concurrent rooms, no p95 regression** (`[req:MP-4]`). |
| **v1b — voice + institution** | Q1–Q2 Y2 | Cascade voice (Whisper+XTTS open-first, Deepgram/ElevenLabs managed tier, TR + EN); institution dashboard (heatmap, remediation loop, accreditation export, calibration); **LTI 1.3 Advantage**; **HECVAT/SOC 2 Type II/VPAT**. | **Institutional gate:** voice round-trip **<1200 ms p95**; **1 signed paid INST-EN logo** + **HECVAT+SOC 2 complete**; NRR signal >110%. |
| **v1c — TR institution + scale** | Q3–Q4 Y2 | TEPDAD/UÇEP accreditation mapping; INST-TR GTM; 2D clinical-sign avatar (`[req:AV-1]`); ISO 42001/27001. | **Series-A gate (§8):** ≥$3M ARR, NRR >130%, burn multiple <1.5, 8+ logos incl. TR. |
| **v2a — summative + premium** | Q1–Q2 Y3 | Summative track (human co-sign, validity dossier) toward **EU AI Act Annex III 2 Dec 2027**; CME; Pro+CME tier; 3D/streaming premium (gated). | **Summative gate:** κ ≥0.7 on pass/fail items across ≥3 case-types; validity dossier peer-reviewed; DPIA refreshed. |
| **v2b — appliance + multi-region** | Q3–Q4 Y3 | On-prem/VPC appliance (privacy-max institutions, TR in-region KVKK/Sağlık Bakanlığı); multi-region fleet (EU/UK/US/TR); agent-observable rooms. | **Scale gate:** 99.9% uptime SLA met; TR data fully in-region; appliance deployed at ≥1 institution. |

**Gate philosophy:** the calibration plot + measured-competence-rise gate (MVP) is the *learning-efficacy* proof; the cost gate (v1a) is the *unit-economics* proof; HECVAT/SOC 2 (v1b) is the *procurement* proof; κ ≥0.7 (v2a) is the *validity* proof. Miss a gate → hold scope and fix, don't spend the next tranche (`[req:R6]`).

---

## 10. Sensitivities

Base case = §4–§7. Levers ranked by impact on Y3 EBITDA / runway.

| # | Lever | Downside case | Base | Upside case | Y3 EBITDA swing |
|---|---|---|---|---|---|
| S1 | **Free→paid conversion (IND)** | 3% | 5.5% | 8% | ±$1.9M |
| S2 | **Institutional logos landed (Y3)** | 18 total | 27 total | 40 total | ±$2.6M |
| S3 | **NRR (INST)** | 105% | 128% | 145% | ±$1.4M |
| S4 | **GPU spot price / utilization** | H100 doubles to ~$3/hr **and** util 45% | $1.49/hr, 68% util | $0.90/hr, 75% util | ±$0.9M COGS |
| S5 | **Turkey PPP / FX shock** | lira −40%, TR ARPU halves in $ | base PPP | lira stable | ±$0.5M |
| S6 | **Guideline licensing** | proprietary partner demands 2× | base | open-only sufficient longer | ±$0.3M |
| S7 | **Self-host slips (stay API-first through Y2)** | COGS at $0.43, GM →~50% | crossover Q4 Y1 | crossover Q3 Y1 | **±$3.2M** (existential) |

**Key sensitivity readings:**
- **S7 is the model's spine.** If self-hosting fails to land (fleet ops too hard, quality regression, utilization stuck), COGS reverts toward API-first, Y3 gross margin collapses ~73%→~50%, and the Turkey segment turns margin-negative. Mitigation: the ML-infra team is the *first* seed hire; a golden-set eval gate blocks any quality regression before switching a fleet (`[research:08]`, `[req:R1]`).
- **S4 (GPU market) is bounded, not existential** — even a doubling of spot H100 to ~$3/hr with poor utilization only moves COGS ±$0.9M because tokens are cheap per encounter; the fleet is a small fraction of opex. This is precisely the resilience self-hosting buys vs API price-list exposure.
- **S1 + S2 together define the raise size** — the downside conversion/logo case (burn multiple ~2.1) would need the Series A pulled forward or trimmed; the upside case (burn multiple ~0.8) reaches CF-positive within Y3.
- **S5 (Turkey FX):** modeled in PPP, so lira depreciation hits *reported-$ ARR* but not *local affordability or margin* — TR stays gross-margin-positive on open-source COGS even in the shock case, which is the whole reason PPP+self-host was chosen for the segment.

**Downside runway check:** in the combined downside (S1 low + S2 low + S7 slip), Y2 net burn rises to ~$4.6M and the seed round ($8M) runway shortens to ~20 mo — still reaching a (smaller) Series-A conversation, but the model would trigger cost holds (defer 3D/appliance, freeze GTM headcount) at the ~$0.9M-cash tripwire.

---

## 11. Open questions & assumptions

**Load-bearing assumptions (each is a modeled input, not a fact):**
1. **Self-hosting lands on schedule (Q4 Y1) and holds quality.** The entire margin thesis (§5, S7) depends on the ML-infra team getting Qwen3/DeepSeek/MedGemma to production quality on a ≥65%-utilized vLLM/SGLang fleet with a golden-set eval gate. If it slips a year, model API-first (GM ~50%, larger seed).
2. **500k-tok/day break-even is cleared at the Q4-Y1 crossover.** Encounter-volume model (§1.4) assumes PLG reaches ~2,500 encounters/day by Q4 Y1. Below that, stay API-first longer — the crossover *timing* is the single most schedule-sensitive number.
3. **PPP pricing captures Turkish willingness-to-pay without cannibalizing EN.** Assumes geo/locale-gating holds (no arbitrage of ₺149/mo into USD markets) and that ~30%/~23% of EN list is the right PPP point. Needs live price-testing in the TR pilot.
4. **Free→paid (5.5% blended) and NRR (128% INST).** Both are edtech-comparable, not measured; the MVP/seed period must validate them. Conversion is the biggest single-lever sensitivity (S1).
5. **University committee closes in 9 mo (EN) / 7 mo (TR) once HECVAT+SOC 2 clear.** Assumes the compliance stack is the binding constraint (`[req:§3.7]`) and that clearing it unblocks the 7-role cycle. Cycle risk is real; Y1 assumes only 1 paid pilot precisely to de-risk this.
6. **Guideline licensing stays a bounded COGS line** ($30k→$300k). Assumes open-license domains + NICE International + one proprietary partner suffice, and that a partner doesn't demand a step-change royalty (S6).
7. **Blended fully-loaded cost/FTE ~$155k** assumes a mix skewed by cheaper TR-based clinical/content/PLG hires; a US-heavy team would raise opex ~20–30%.
8. **Fleet is rented, not owned.** Model uses neo-cloud/spot rental (opex) to preserve capital efficiency and follow the spot market down; owning GPUs (capex) is deliberately *not* modeled until scale justifies it (>Y3).

**Open questions to resolve before/at seed:**
- **Q1.** What is the *real* free→paid conversion and D30 retention in the MVP cohort? Everything in §4 re-derives from it — instrument first (`[req:§6]`).
- **Q2.** Does the open-source patient-persona quality (Qwen3-32B / Gemma-4-9B TR) hold at production scale, or does escalation-to-frontier creep above the modeled ~10%, pushing COGS up? (S7-adjacent.)
- **Q3.** Which proprietary guideline partner (ATLS / UpToDate / AMBOSS) and at what royalty — this sets the S6 licensing envelope and gates the EM/OSCE content depth.
- **Q4.** Does Turkey monetize at the modeled PPP ARPU, or does the market bear even less (pushing IND-TR toward a pure top-of-funnel / brand play rather than a revenue line)?
- **Q5.** Timing of the summative track vs the Dec-2027 EU AI Act Annex III deadline — does the validity dossier (κ ≥0.7) land in time to monetize the summative upsell in Y3, or does it slip to Y4 (removing the $400k CME/summative line)?
- **Q6.** On-prem/VPC appliance pricing and demand — is the +$40k–90k platform fee (EN) / KVKK-residency value (TR) enough to justify the Y3 build, or is it a Y4 item?
- **Q7.** Does peak Y2 burn (~$520k/mo) need the Series A pulled forward a quarter if S1/S2 land soft? The cash tripwire (~$0.9M balance) is the trigger to hold scope.

---

### Sources (web-verified July 2026)

- GPU economics: [Spheron GPU pricing 2026](https://www.spheron.network/blog/gpu-cloud-pricing-comparison-2026/) · [IntuitionLabs H100](https://intuitionlabs.ai/articles/h100-rental-prices-cloud-comparison) · [RunPod pricing](https://www.runpod.io/pricing) · [Thunder Compute market trends](https://www.thundercompute.com/blog/ai-gpu-rental-market-trends)
- Voice/infra: [Deepgram pricing](https://deepgram.com/pricing) · [LiveKit inference](https://livekit.com/pricing/inference) · [LiveKit pricing](https://livekit.com/pricing)
- Pricing anchors: [AMBOSS pricing](https://www.amboss.com/us/pricing) · [Lecturio Qbanks 2026](https://www.lecturio.com/blog/best-usmle-qbanks-2026-uworld-vs-amboss-vs-lecturio/)
- Turkey market/PPP: [YÖK higher-ed stats 2026](https://www.turkeyuniversity.org/blog/turkey-higher-education-statistics-2026) · [World Bank PPP TR](https://data.worldbank.org/indicator/PA.NUS.PPP?locations=TR) · [CEIC PPP TR](https://www.ceicdata.com/en/turkey/exchange-rate-oecd-member-annual/tr-purchasing-power-parity-national-currency-per-usd)
- Compliance costs: [BrightDefense SOC 2 2026](https://www.brightdefense.com/resources/soc-2-certification-cost/) · [SOC2auditors SOC 2 vs ISO 27001](https://soc2auditors.org/insights/soc-2-vs-iso-27001/)
- Funding/benchmarks: [CRV Series A metrics](https://www.crv.com/content/series-a-metrics-vcs-expect) · [Runway burn-multiple 2026](https://runway.com/blog/burn-multiple-benchmarks-for-2026-what-good-looks-like-at-seed-to-scale) · [ScaleWithCFO multiples 2026](https://www.scalewithcfo.com/post/saas-valuation-multiples-2026) · [Pitchwise funding 2026](https://www.pitchwise.se/blog/the-complete-guide-to-seed-and-series-funding-rounds-for-founders-in-2026)
- Internal: `docs/00-overview/01-requirements-and-constraints.md` · `docs/research/08-open-source-model-stack.md` · `docs/research/09-localization-i18n-turkish.md` · `docs/research/04-market-competitors.md`
