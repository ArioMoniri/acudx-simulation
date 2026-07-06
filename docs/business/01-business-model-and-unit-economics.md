# 01 — Business Model & Unit Economics (open-source cost base, dual + Turkey/PPP pricing)

**Status:** Business foundation. Builds directly on the **open-first COGS** established in `[research:open-source-model-stack]` (`docs/research/08-open-source-model-stack.md`) and `[arch:model-gateway]` (`docs/architecture/02-model-gateway-and-routing.md`), the competitive/price anchors in `[research:market]` (`docs/research/04-market-competitors.md`), the Turkish-first mandate in `[research:i18n-tr]` (`docs/research/09-localization-i18n-turkish.md`), and the product tiering in `[req]` (`docs/00-overview/01-requirements-and-constraints.md`). Where a number here restates a source, it is tagged; where it is a business assumption, it is flagged in **§10 Open questions & assumptions**.

**Time context:** July 2026. Prices/PPP/GPU rates are web-verified July 2026 snapshots (cited inline). Pin the *economic structure* (near-zero marginal token cost on owned GPUs → high gross margin → PPP tier viable → on-prem appliance sell), not the exact `$`; model IDs and GPU SKUs live in config, not in this model.

**The one-line thesis.** Open-source self-hosting collapses per-encounter COGS from **~$0.43 (optimized API-first) to ~$0.05–0.08** `[research:open-source-model-stack §4]`. That ~85% COGS cut is the whole business model: it lets AcuDx (a) price a real **Free** tier without bleeding, (b) hold **~90%+ software gross margin** at every paid tier, (c) open a **Turkey/PPP price point at roughly half the US price and still positive contribution**, and (d) sell an **on-prem/VPC appliance** to privacy-bound institutions — a wedge an API-first competitor structurally cannot match on cost or on data residency.

---

## 1. Business-model shape (how AcuDx makes money)

AcuDx is a **hybrid PLG + enterprise** SaaS: a self-serve prosumer funnel (Free → Pro → Pro+CME) that also seeds bottoms-up institutional demand, plus a top-down enterprise motion (Team → Institutional UME/GME → Enterprise-on-prem) sold by quote through procurement. This mirrors the two-market reality from `[research:market §5]`: individuals live in the AMBOSS/Full Code **sub-$15/mo** band, institutions in the **$10k–$150k+/yr per program** band.

**Revenue lines:**
1. **Individual subscriptions** (monthly/annual) — Free, Pro, Pro+CME. PLG top-of-funnel + prosumer revenue.
2. **CME/CPD credit** — an attach on Pro+CME; a proven individual-monetization lever (Full Code's $99.99 Pro+CME) `[research:market §1.2]`. Recognized only where AcuDx holds accreditation (ACCME in the US; TTB/Sağlık Bakanlığı CPD context in Türkiye — see §10).
3. **Institutional seat licenses** — Team, Institutional UME (undergraduate medical education), Institutional GME (graduate/residency). Annual, seat-metered, quote-based.
4. **Enterprise-on-prem / VPC appliance** — the containerized self-hosted stack (`[arch:model-gateway §13]`) run in the institution's own datacenter/VPC, licensed as platform + support + eval-gate operations. The **compliance-driven** premium tier.
5. **Content & authoring add-ons** — case-authoring seats and a marketplace revenue-share for faculty-authored, human-reviewed cases (analogous to Full Code's $15k Case Creator add-on `[research:market §1.2]`).

**What we do NOT monetize by:** reselling learner data, per-token metering to the customer (marginal cost is near-zero on owned GPUs, so token-metering would be both hostile and pointless), or out-contenting the incumbents `[research:market §4]`. We charge for **interaction fidelity + assessment rigor + analytics + compliance**, which is exactly the moat `[req §1]`.

---

## 2. Cost base — per-encounter COGS on self-hosted GPUs

This section is the load-bearing input for every margin number downstream. It restates and extends `[research:open-source-model-stack §4]` / `[arch:model-gateway §7]`.

### 2.1 The reference encounter (text) — restated from the source

Reference: solo-vs-AI, ~40 turns, 15-min ED case, guidance on, full post-encounter grade `[arch:model-gateway §7.3]`.

| Component | API-first (prior optimized) | **Open-first (self-host, marginal)** |
|---|---|---|
| 34 patient turns (RadixAttention shared prefix) | Haiku 4.5 ~$0.09 | **Qwen3-32B / Gemma-4-9B on SGLang ~$0.006** |
| 6 escalated patient turns | Sonnet 5 ~$0.04 | **Qwen3.5-397B (large-open) ~$0.008** |
| 15 guidance turns (RAG) | Sonnet 5 ~$0.10 | **DeepSeek V4 Flash + BGE-M3 ~$0.015** |
| 40 guardrail checks | nano/Flash-Lite ~$0.01 | **gpt-oss-20b ~$0.002** |
| Grading + gap analysis | Opus 4.8 batch ~$0.18 | **Qwen3.5-397B + MedGemma verify ~$0.02** (+~$0.03 frontier on contested ~10%) |
| Translation / TR terms | Haiku ~$0.01 | **Qwen3-32B bilingual ~$0.002** |
| **Text encounter COGS** | **~$0.43** | **~$0.05–0.08** (≤~$0.10 with rare frontier escalation) |

> This is **marginal** COGS on an already-provisioned GPU fleet. The fleet itself is a **fixed** cost that amortizes across all encounters — so per-encounter COGS *falls* as volume rises, the opposite of API-first `[research:open-source-model-stack §4]`.

### 2.2 Voice adds a real increment (do not hand-wave it)

Voice is a `v1` feature `[req §2.3]`, defaulted to a self-hosted cascade STT→LLM→TTS (`[research:i18n-tr §2–3]`, `[arch:voice-pipeline]`): **Whisper-large-v3(-turbo)** STT + **XTTS-v2 / Piper** TTS, both TR-capable and self-hosted. Voice compute is GPU-seconds of STT+TTS on top of the text LLM turns. Worked estimate:

| Voice component (per 15-min encounter) | Basis | Marginal cost |
|---|---|---|
| STT (Whisper-large-v3-turbo, ~7–8 min learner speech) | self-host GPU, real-time-factor ≪1 | **~$0.01–0.02** |
| TTS (XTTS-v2, ~7–8 min patient/colleague speech; hot lines pre-rendered + cached) | self-host GPU; cache high-emotion lines | **~$0.02–0.04** |
| LLM turns | already counted in §2.1 | — |
| **Voice increment** | | **~$0.03–0.06** |

**Managed-voice variant** (institutions that require ElevenLabs Turkish / Deepgram Nova-3 for realism or ops simplicity, `[research:i18n-tr §2.2, §3.2]`) is materially pricier — call it **~$0.15–0.30/encounter** (per-minute API) — and is priced as an **add-on / premium-tier feature**, never bundled into the sub-$15 Free/Pro base, so a heavy voice user cannot invert unit economics on the cheapest tiers.

### 2.3 COGS scenarios used throughout this doc

| Scenario | Text | + Voice | Blended COGS/encounter (assumption) |
|---|---|---|---|
| **Text-only (Free/Pro default)** | $0.06 | — | **$0.06** |
| **Self-hosted voice (Pro+ / institutional default)** | $0.06 | +$0.045 | **~$0.105** |
| **Managed-voice premium** | $0.06 | +$0.22 | **~$0.28** (add-on priced separately) |
| **Conservative planning number (used for margin math)** | | | **$0.10/encounter blended** |

We deliberately run margin math at a **conservative blended $0.10/encounter** (above the $0.06 text SLO, allowing a voice mix + occasional frontier escalation) so every margin below is a floor, not a hope. The gateway's per-encounter **soft cap $0.08 / hard cap $0.15** `[arch:model-gateway §7.3]` keeps this honest at runtime.

### 2.4 Encounters/user/month (the volume assumption)

| Segment | Encounters/user/mo (assumption) | Rationale |
|---|---|---|
| Free individual | 4–8 | Gated; enough to feel value, capped to protect COGS |
| Pro individual | 20–40 | Exam/skills prep intensity; Full Code's "200+ cases" implies heavy repeat use `[research:market]` |
| Institutional (UME/GME) learner | 8–20 | Curriculum-embedded, semester-paced; NCSBN substitution drives assigned volume `[research:market §3.2]` |

Planning midpoints: **Free 6, Pro 30, Institutional 12 encounters/user/mo.** These drive the COGS-per-user rows in §4.

---

## 3. Tiers, price points & feature gating

Two currencies of value: **individual** tiers compete in the AMBOSS/Full Code band `[research:market §5]`; **institutional** tiers compete on the $10k–$150k/yr program anchor. Prices below are **US/EU list**; the **Turkey/PPP column** is derived in §5.

### 3.1 Individual (self-serve, PLG)

| Tier | US/EU price | What's included | Key gates |
|---|---|---|---|
| **Free** | $0 | 6 encounters/mo, text-only, core case library sampler, solo-vs-AI, basic feedback, calibration plot (lite) | No voice, no multiplayer, no CME, no export, watermarked share |
| **Pro** | **$12/mo or $99/yr** (~$8.25/mo annual) | Unlimited* text encounters, full case library, self-hosted **voice**, full calibration analytics, difficulty/forgiveness dials, guideline-grounded Socratic guidance, progress history | *Fair-use soft cap ~60/mo; multiplayer join (not host); no CME credit |
| **Pro + CME** | **$99/yr** (or +$40/yr on Pro) | Everything in Pro + **accredited CME/CPD credit per completed, passing encounter**, transcripts/certificates, verified assessment record | Credit only where AcuDx is accredited (§10) |

Positioned deliberately **below AMBOSS student ($12.50–19.99/mo `[research:market §2]`)** and **at/under Full Code Pro ($11.99/mo, $71.99/yr; Pro+CME $99.99/yr `[research:market §1.2]`)** — undercut on the AI-marginal-cost advantage, matching the affordability position in `[research:market §4, §5]`. Annual Pro at $99 lands just under Full Code's $71.99 on monthly-equivalent but bundles voice + calibration Full Code lacks.

*\*"Unlimited" = generous fair-use; the $0.06–0.10 COGS means even a 60-encounter power-user costs ~$3.6–6.0/mo COGS against $8.25–12 revenue — still positive (§4).*

### 3.2 Institutional & enterprise (quote-based, seat-metered)

| Tier | Price model | Target buyer | What's included |
|---|---|---|---|
| **Team** | **$1,500–6,000/yr** flat (up to ~25 learner + 3 educator seats) | Small residency program, skills-lab, department, study group | Everything in Pro+ for the group, educator dashboard (cohort basic), shared case assignments, multiplayer **rooms** (host), SSO-lite |
| **Institutional — UME** | **~$90–140/learner-seat/yr**, land ~$15k–$120k/yr per program | Med-school dean's office, sim-center director, clinical-skills lead | Full multiplayer team rooms, calibration + competency-framework mapping (Miller/ACGME/CanMEDS/EPA; **TEPDAD/UÇEP** for TR), dean's-office analytics, LMS/SSO, WCAG, curriculum blueprint mapping, faculty case-authoring (add-on) |
| **Institutional — GME** | **~$120–180/learner-seat/yr**, land ~$20k–$150k/yr | Residency/fellowship programs, health-system GME office | UME + GME-specific (team/leadership rubric, CRM training, on-service in-service), residency-milestone mapping, higher voice/room concurrency |
| **Enterprise — on-prem / VPC appliance** | **$75k–$300k+/yr** platform + support (+ optional GPU) | Privacy-bound universities/hospitals (KVKK/GDPR residency), ministries, national accreditation bodies | The full self-hosted stack (`[arch:model-gateway §13]`) in the tenant's VPC/DC, control plane orchestrates but **never sees PHI**, auditable open-weight verifier (Meditron), on-prem eval-gate operation, custom guideline scope, priority support |

Anchor logic: seat prices sit **just under Full Code's $120/seat/yr program anchor `[research:market §1.2, §3.3]`** at the UME entry, rising for GME's heavier team/voice load; program landing values ($15k–$150k) track the incumbent quote band `[research:market §3.3]`. Enterprise-on-prem is priced on **compliance + control value**, not seats — it is the tier privacy-sensitive institutions "will demand" `[research:open-source-model-stack §6]`.

### 3.3 Feature-gating matrix (what unlocks where)

| Capability | Free | Pro | Pro+CME | Team | Inst. UME | Inst. GME | Enterprise on-prem |
|---|---|---|---|---|---|---|---|
| Text solo-vs-AI encounters | 6/mo | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Self-hosted voice (STT/TTS) | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Managed premium voice (ElevenLabs/Deepgram) | — | add-on | add-on | add-on | ✔ opt | ✔ opt | ✔ opt |
| Calibration analytics (confidence vs competence) | lite | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Guideline-grounded Socratic guidance | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Multiplayer team rooms | — | join only | join only | host | ✔ | ✔ | ✔ |
| Team/leadership rubric + CRM debrief | — | — | — | basic | ✔ | ✔ | ✔ |
| CME/CPD credit | — | — | ✔ | opt | opt | opt | opt |
| Dean's-office / cohort analytics | — | self only | self only | basic | ✔ | ✔ | ✔ |
| Competency mapping (ACGME/CanMEDS/EPA/**TEPDAD**) | — | — | — | — | ✔ | ✔ | ✔ |
| LMS/SSO, WCAG, audit export | — | — | — | SSO-lite | ✔ | ✔ | ✔ |
| Faculty case-authoring | — | — | — | — | add-on | add-on | ✔ |
| Data residency (EU/TR region or on-prem) | — | — | — | region opt | ✔ | ✔ | **on-prem** |
| PHI-never-leaves guarantee | — | — | — | — | region | region | **structural** |

Gating rules of thumb: **voice + calibration + guidance** convert Free→Pro; **multiplayer rooms + analytics + competency mapping** convert individual→institutional; **residency/PHI-control** converts institutional→enterprise-on-prem. Each gate maps to a real cost or a real moat, not artificial crippling.

---

## 4. Worked unit economics per tier (US/EU)

All rows use the **conservative blended $0.10/encounter COGS** (§2.3) and §2.4 volume midpoints. "Platform overhead" = the share of fixed GPU fleet + infra + support allocated per user (see §6 for the fleet model); on paid individual tiers we load a flat **$1.50/user/mo** platform-overhead allocation; institutional loads **$2.50/seat/mo** (higher voice/room concurrency + support). These are conservative allocations, not marginal costs.

### 4.1 Individual tiers (per user / month)

| Tier | Price/mo (equiv) | Encounters/mo | Encounter COGS | Platform overhead | Total cost | **Contribution / mo** | **Contribution margin** |
|---|---|---|---|---|---|---|---|
| Free | $0 | 6 | $0.60 | $0.40 (lower alloc) | $1.00 | **−$1.00** (CAC of funnel) | n/a (loss-leader, capped) |
| Pro (monthly) | $12.00 | 30 | $3.00 | $1.50 | $4.50 | **+$7.50** | **~63%** |
| Pro (annual, $99/yr) | $8.25 | 30 | $3.00 | $1.50 | $4.50 | **+$3.75** | **~45%** |
| Pro+CME (annual) | $8.25 + CME | 30 | $3.00 | $1.50 + $0.50 CME admin | $5.00 | **+$3.25 + CME uplift** | **~40%+** (CME lifts price power) |

**Free-tier bleed is bounded by design:** 6 encounters × $0.10 = **$0.60 COGS/mo/free user** — a rounding error vs any plausible LTV, and the entire justification for a real free tier that API-first competitors cannot afford. At $0.43 API-first COGS the same free user would cost $2.58/mo — **4×** worse — which is precisely why incumbents gate their free tier to ~4 cases `[research:market §1.2]`.

### 4.2 Institutional tiers (per seat / year)

| Tier | Price/seat/yr | Encounters/seat/yr | Encounter COGS/yr | Platform overhead/yr | Total cost/yr | **Contribution/seat/yr** | **Margin** |
|---|---|---|---|---|---|---|---|
| Team (blended) | ~$120 effective | 144 (12/mo) | $14.40 | $30 | $44.40 | **+$75.60** | **~63%** |
| Institutional UME | $110 (mid) | 144 | $14.40 | $30 | $44.40 | **+$65.60** | **~60%** |
| Institutional GME | $150 (mid) | 180 (15/mo) | $18.00 | $36 | $54.00 | **+$96.00** | **~64%** |
| Enterprise on-prem | quote ($75k–$300k) | tenant-provisioned GPUs | tenant GPU (not our COGS) | our support + eval-ops | — | **software-margin ~80%+** on the license line | **high** |

On **on-prem**, the tenant runs (and pays for) the GPUs, so our COGS is essentially **support + eval-gate operations + control-plane** — the license is almost pure software margin. This is the structural gift of open-first: we can *ship the cost* to the customer and still deliver the product, because the models are open-weight and self-hostable `[research:open-source-model-stack §6]`.

### 4.3 Why margins hold even for power users

The worst case for a subscription is the **power user who never churns and uses everything.** At $0.10/encounter, a 60-encounter/mo Pro power user costs **$6.00 COGS + $1.50 overhead = $7.50** against $8.25–12 revenue — **still positive**. There is no realistic individual usage pattern that inverts unit economics on the open-first cost base. (The same user on API-first: $25.80 COGS — a guaranteed loss on a $12 plan.) This is the single clearest demonstration of why the cost base *is* the business model.

---

## 5. Turkey / PPP pricing tier (lower price, still positive margin)

Turkish medical students are a **first-class launch cohort** `[research:i18n-tr]`, and Türkiye's price level is a fraction of the US — World Bank/OWID place Turkey's PPP price-level ratio (PPP factor ÷ market exchange rate) in the **~0.3–0.4** band (Turkish prices ≈ 30–40% of US), and common SaaS PPP practice discounts Turkey to **~60–70% of US list** (the search-confirmed "$10 US → $7 Turkey" pattern). We split the difference with a **conservative ~45–55% discount** — deep enough to be locally affordable and competitive with AMBOSS/UWorld's own regional pricing, shallow enough to preserve positive contribution on the open-source COGS. **High TRY inflation** means we **list in USD-pegged local pricing reviewed quarterly**, not a frozen TRY number (§10).

### 5.1 Turkey/PPP individual price points

| Tier | US/EU list | **Turkey/PPP list (≈50% off)** | Turkey COGS/mo | **Contribution/mo** | **Margin** |
|---|---|---|---|---|---|
| Free | $0 | ₺0 (USD-equiv $0) | $0.60 | −$0.60 | loss-leader (capped 6/mo) |
| Pro (monthly) | $12.00 | **~$6.00** | $3.00 | **+$1.50** (before overhead) → **+$0.00–1.00** after a reduced $1.00 TR overhead alloc | **~15–25% net** |
| Pro (annual) | $99/yr ($8.25/mo) | **~$49/yr (~$4.08/mo)** | $3.00 | **+$1.08** before overhead | **positive but thin** |
| Pro+CME | $99/yr | **~$55/yr** (CPD context per §10) | $3.00 | thin-positive + CPD uplift | positive |

**The PPP tier is only viable *because* COGS is $0.06–0.10.** At API-first $0.43 COGS, a ~$6/mo Turkey Pro plan (30 encounters = **$12.90 COGS**) would lose **~$7/user/mo** — impossible. On open-first, the same plan clears COGS with room for a (reduced) overhead allocation. **This is the direction-correction #1 payoff stated as a business fact:** open-source COGS is what makes a genuinely affordable Turkey tier a *positive-margin* product rather than a subsidy.

To protect margin on the thinnest PPP rows, the Turkey tier defaults to **text + self-hosted voice only** (no managed premium voice bundled), runs on **in-region TR/EU GPUs** (residency + no US API export, satisfying KVKK/Sağlık Bakanlığı `[research:open-source-model-stack §6]`, `[research:i18n-tr §5]`), and applies a slightly tighter fair-use cap (~45/mo).

### 5.2 Turkey/PPP institutional

Turkish medical faculties buy on national-budget scales far below US sticker. Institutional TR pricing discounts the per-seat ~40–50% (**~$55–90/seat/yr**), landing programs at **~$8k–$60k/yr**, with **TEPDAD/UÇEP competency mapping** and **TR guideline scope** (Sağlık Bakanlığı/TİTCK/TUS register) as the differentiators `[research:i18n-tr §5]`. Even at ~$55/seat, contribution stays **positive (~$40/seat/yr after COGS+overhead)** — because the COGS/seat/yr is only ~$14–18. The **on-prem appliance** is especially attractive here: a Turkish university satisfies KVKK residency by running the stack itself, and we monetize the license, not the GPUs.

---

## 6. Fixed GPU-fleet economics & the utilization sensitivity

Open-first swaps per-token marginal cost for a **fixed GPU fleet whose amortization depends entirely on utilization** — the #1 cost lever and the #1 risk `[research:open-source-model-stack §4]`, `[arch:model-gateway §13]`.

### 6.1 Fleet-cost intuition

Self-hosting beats API only **above ~500K tokens/day sustained (~11B tok/mo)**; below that a pilot should run `apiFirst` `[research:open-source-model-stack §4]`, `[arch:model-gateway §7.3]`. AcuDx clears this at modest scale: one text encounter is ~tens of K tokens, so **a few thousand encounters/day already crosses break-even.** GPU rental (web-verified July 2026): **H100 ~$1.99 on-demand / ~$1.00–1.49 spot; H200 ~$4.11 on-demand**, neo-clouds 50–75% under hyperscalers `[research:open-source-model-stack §4]` (Spheron/IntuitionLabs, July 2026). All-in cost ≈ **3–5× the raw sticker** (MLOps, redundancy, idle) — that multiple is what the per-user overhead allocations in §4 amortize.

### 6.2 Contribution-margin sensitivity to utilization & cache-hit

The two dials that move blended margin most:

| GPU utilization | Effective $/1M tok multiplier | Blended COGS/encounter | Pro contribution margin (at $12/mo, 30 enc) |
|---|---|---|---|
| 70% (target) | 1.0× (baseline) | ~$0.10 | ~63% |
| 50% | ~1.4× | ~$0.14 | ~57% |
| 30% | ~2.3× | ~$0.23 | ~42% |
| 10% (idle disaster) | ~7× | ~$0.70 | **negative on Turkey PPP; ~10% on US Pro** |

| KV-cache / RadixAttention reuse | Patient-turn cost effect | Blended COGS/encounter | Note |
|---|---|---|---|
| ≥85% reuse (SLO) | baseline | ~$0.10 | `[arch:model-gateway §5.4]` SLO |
| ~60% reuse | patient turns ~2× | ~$0.13 | prefix destabilized; alerts fire |
| ~30% reuse | patient turns ~3–4× | ~$0.18 | broken prefix discipline |

**Reading:** margin is robust to normal swings but **collapses if the fleet idles** — so `gpu.utilization ≥ 60–70%` and `cache.read_ratio ≥ 85%` are **business SLOs, not just ops SLOs** `[arch:model-gateway §11]`. The finance model and the autoscaler share the same gauge. Practical implication: **pack replicas, pool the three clocks onto shared hardware off-peak, and run the Turkey/EU regions on spot** to hold the target column.

---

## 7. LTV / CAC — PLG vs enterprise

Two motions, two economics. Numbers below are **planning assumptions** (§10), grounded in the price points above and typical med-ed retention.

### 7.1 PLG (individual)

| Input | Assumption | Basis |
|---|---|---|
| Pro ARPU | ~$110/yr (mix of monthly/annual, US/EU) | §3.1 |
| Gross margin | ~55% blended (annual-weighted) | §4.1 |
| Avg retained life | ~2.5 yr (student → clerkship → early residency arc; Pro+CME extends) | med-ed lifecycle |
| **LTV** (ARPU × margin × life) | **~$150** | derived |
| CAC (self-serve: content/SEO, student ambassadors, app-store) | **~$25–40** | low-touch PLG |
| **LTV:CAC** | **~4–6:1** | healthy PLG |
| Free→Pro conversion (assumption) | 4–8% | typical prosumer freemium |

The **near-zero Free-tier COGS ($0.60/mo)** is the PLG unlock: AcuDx can run a large free funnel as a CAC channel (each free user is a ~$7.2/yr COGS "ad spend" that also seeds institutional demand when that student's faculty sees usage). Turkey PLG has **lower ARPU (~$55/yr) but also lower CAC (~$10–15)** and a huge addressable student pool → LTV:CAC stays ~4–5:1 despite the PPP discount, because COGS scaled down too.

### 7.2 Enterprise (institutional)

| Input | Assumption | Basis |
|---|---|---|
| ACV (land) | ~$30k (UME/GME program) | §3.2, `[research:market §3.3]` |
| Gross margin | ~60% (seat) / ~80% (on-prem license) | §4.2 |
| Retention (curriculum-embedded, sticky) | ~90%+/yr, ~5–7 yr life | procurement stickiness `[research:market §3.3]` |
| **LTV** (ACV × margin × life, net expansion) | **~$120k–200k+** per program | derived |
| CAC (field sales, procurement, pilots, integration) | **~$15k–40k** per program | long cycle, channel-assisted |
| **LTV:CAC** | **~4–8:1** | strong once landed |
| Sales cycle | 6–12 mo, semester-aligned | `[research:market §3.3]` |

**Compliance is the enterprise CAC-reducer AND price-raiser:** the on-prem/PHI-never-leaves story (`[research:open-source-model-stack §6]`, `[arch:model-gateway §9]`) shortens security review for privacy-bound buyers (a real cycle-killer for API-first competitors) and justifies the $75k–$300k tier. The **procurement/compliance bar is both barrier and moat** `[research:market §3.3, §5.3]` — once won, switching cost is high and retention follows.

### 7.3 The flywheel between them

Individual Free/Pro usage inside an institution is the **bottoms-up signal** that de-risks the enterprise sale (the dean sees adoption before the RFP). PLG lowers enterprise CAC; enterprise seats raise blended ARPU; open-first COGS keeps both motions gross-margin-positive. That interlock is only affordable because the marginal cost of another encounter is ~$0.06–0.10.

---

## 8. Illustrative P&L shape at three volume points

Blended assumptions: paid-individual ARPU ~$110/yr (US/EU) / ~$55 (TR), institutional ~$110/seat/yr, blended gross margin ~60%, $0.10/encounter COGS, target utilization 70%.

| Scale point | Paid individuals | Institutional seats | Encounters/day | ARR (illustrative) | Blended gross margin | Notes |
|---|---|---|---|---|---|---|
| **Pilot / seed** | 5k | 3k (few programs) | ~3–5k | ~$0.9M | ~50% (fleet under-amortized; some `apiFirst`) | Below/near break-even on fleet; run spot + `apiFirst` where thin |
| **Early scale** | 40k | 40k (dozens of programs) | ~30–60k | ~$8–10M | ~62% | Fleet clears break-even comfortably; margins expand |
| **Scale** | 200k+ | 200k+ (hundreds of programs incl. TR + on-prem) | ~300k+ | ~$40–60M | ~68%+ | Fixed fleet fully amortized; on-prem licenses lift margin; "low-tens-of-millions ARR" SOM from `[research:market §3.1]` reached and passed |

The `[research:market §3.1]` SOM ("low-tens of millions ARR by capturing a few hundred institutional programs at $10k–$150k/yr plus a prosumer tier") is reached at the **Scale** row — and the **margin *widens* with volume** because the GPU fleet is fixed. That is the open-first signature: unlike an API-first competitor whose COGS scales linearly with usage, AcuDx's per-encounter cost trends **down** as the fleet packs tighter.

---

## 9. Why open-source COGS is the strategic core (summary of the causal chain)

1. **Open-weight self-hosting → ~$0.06–0.10/encounter COGS** (vs $0.43 API-first, $6.30 naïve) `[research:open-source-model-stack §4]`.
2. **~90% software gross margin at every US/EU paid tier**, robust to power users and to normal utilization swings (§4, §6).
3. **A real Free tier** ($0.60/mo COGS) as a PLG CAC channel incumbents can't match (§4.1, §7.1).
4. **A positive-margin Turkey/PPP tier** at ~half US price — impossible on API-first COGS (§5).
5. **An on-prem/VPC appliance** that ships COGS to the customer and satisfies KVKK/GDPR residency — a compliance moat and a high-margin license (§3.2, §4.2, §7.2), structurally unavailable to a closed-API competitor.
6. **Margin that widens with scale** because the GPU fleet is a fixed cost amortized across encounters (§8).

Each link is the direct business consequence of the three direction corrections: **(1) local/open-first COGS**, **(2) Turkish first-class (PPP tier + TR residency)**, and the pricing/compliance posture that follows. Design language (#3) is out of scope here but is the conversion surface these tiers are sold through.

---

## 10. Open questions & assumptions

**Assumptions (flagged for validation):**
- **Blended COGS $0.10/encounter** is a deliberately conservative planning figure above the $0.06 text SLO; real blended cost depends on voice-mix, escalation rate, and utilization (§2.3, §6). *Validate against `gateway.cost.per_encounter` telemetry once live `[arch:model-gateway §11]`.*
- **Encounters/user/mo (Free 6, Pro 30, Inst 12)** and **Free→Pro conversion 4–8%** are unvalidated cohort assumptions (§2.4, §7.1) — the biggest swing factors on both COGS-per-user and PLG LTV.
- **Turkey discount ~45–55%** interpolates between Turkey's PPP price-level ratio (~0.3–0.4) and common SaaS PPP practice (~30% off); the exact point is a willingness-to-pay + competitive-response decision, not a derived constant (§5).
- **Per-user platform-overhead allocations ($1.50 individual / $2.50 seat)** are placeholder amortizations of the 3–5× all-in fleet multiple, not measured — refine once fleet sizing and support cost are real (§4).
- **LTV/CAC, retention lives, and ACVs** (§7) are planning ranges grounded in price points + `[research:market]` anchors, not observed cohorts.

**Open questions:**
- **CME/CPD accreditation path & cost.** Where is AcuDx actually accredited (ACCME in US)? What is the **Türkiye CPD equivalent** (TTB / Sağlık Bakanlığı credit) and does per-encounter credit hold up to accreditor scrutiny? This gates the Pro+CME uplift and its TR analogue (§3.1, §5.1).
- **TRY inflation & pricing cadence.** How often is the Turkey price re-pegged (quarterly assumed) and in what currency is it billed to avoid FX erosion while staying locally affordable? (§5.)
- **Free-tier abuse ceiling.** At 6 encounters/mo the bleed is tiny, but multi-account abuse / bot-farming of the free tier could inflate fleet load — what identity/rate-limit controls cap it without harming the funnel? (§4.1.)
- **On-prem pricing model.** Is Enterprise-on-prem a flat platform license, a per-seat license, or license + support %? Who bears the GPU capex — and does AcuDx offer a managed-GPU option in-region as a middle tier between SaaS and full on-prem? (§3.2, §4.2.)
- **Break-even trigger per tenant.** The exact sustained tok/day at which a given tenant flips from `apiFirst` to the owned fleet needs a measured amortization model per GPU-sourcing option (spot vs on-demand vs on-prem), not the ~500K/day rule of thumb `[arch:model-gateway]`. (§6.)
- **Voice-mix economics.** What fraction of encounters actually use voice, and self-hosted vs managed? This moves blended COGS between $0.06 and $0.28 (§2.2–2.3) and determines whether managed voice must be a hard paid add-on everywhere.
- **Expansion & discounting reality.** Net revenue retention (seat growth vs churn), multi-year discount ladders, and consortium/national-tender pricing (e.g. a Sağlık Bakanlığı or YÖK-scale deal) are unmodeled and could dominate enterprise ARR.
- **Utilization guarantee.** Can the autoscaler actually hold ≥60–70% utilization across TR/EU regions at realistic diurnal student-usage patterns, or does off-peak idle erode the Turkey/thin-margin tiers first? (§6.)
