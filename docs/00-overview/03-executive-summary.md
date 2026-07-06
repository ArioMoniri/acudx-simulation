# 03 — Executive Summary (Investor-Grade)

**Status:** Investor-facing capstone. Distills the authoritative baseline ([`01-requirements-and-constraints.md`](./01-requirements-and-constraints.md)), the integrated architecture ([`02-architecture-overview.md`](./02-architecture-overview.md)), the business phase ([`../business/00-market-and-strategy.md`](../business/00-market-and-strategy.md) · [`01-business-model-and-unit-economics.md`](../business/01-business-model-and-unit-economics.md) · [`02-gtm-and-sales.md`](../business/02-gtm-and-sales.md) · [`03-financial-model-and-roadmap.md`](../business/03-financial-model-and-roadmap.md)), and the cost/localization research that reshaped the plan ([`../research/08-open-source-model-stack.md`](../research/08-open-source-model-stack.md) · [`../research/09-localization-i18n-turkish.md`](../research/09-localization-i18n-turkish.md)).

**Time context:** July 2026. Every headline figure is web-verified this month and traces to a sourced doc above; pin the *structure* (unit economics, moat, gate logic), treat exact `$`/model-IDs as snapshots that live in config, not in the thesis.

**One sentence.** AcuDx is the AI-native **interaction-and-assessment layer** for health-professions education — learners roleplay full clinical encounters (history → exam → tests → differential → diagnosis → management) against AI patients, colleagues and families, solo or in multiplayer role-based rooms, and receive a defensible competency-mapped grade, a Dunning-Kruger calibration plot, and a guideline-grounded remediation loop — built on a **self-hosted open-weight model stack** that collapses per-encounter cost ~86% and unlocks both a genuinely free tier and a positive-margin Turkish/emerging-market segment that API-priced incumbents structurally cannot serve.

---

## 1. Problem & why now (July 2026)

**The problem.** Clinical-skills training does not scale. Standardized-patient actors, physical simulation centers, and scarce clinical placements are the bottleneck between a medical/nursing/paramedic student and competence at the "Shows How / Does" level of Miller's pyramid. The one standardized US clinical-skills exam (USMLE Step 2 CS) was **permanently discontinued with no replacement**, pushing skills assessment onto institutional OSCEs that schools cannot staff at the volume learners need. Existing digital tools force a false choice: **content without live roleplay** (AMBOSS, UWorld, UpToDate) or **single-player, menu/typed, scripted sims** (Body Interact, i-Human, Shadow Health). Nobody delivers multiplayer, voice-native, guideline-grounded, calibration-scored practice at individual-affordable prices ([`../business/00-market-and-strategy.md`](../business/00-market-and-strategy.md) §2).

**Why now — three converging shifts:**
1. **AI collapsed the marginal cost of a graded encounter.** Self-hosted open-weight models (Qwen3, DeepSeek V4, MedGemma 1.5) put a full graded encounter at **~$0.06** vs ~$0.43 API-optimized, ~$6.30 naïve, and vs $50k+/mannequin and thousands in actor labor ([`../research/08-open-source-model-stack.md`](../research/08-open-source-model-stack.md) §4). Verified July 2026: DeepSeek V4 and Qwen3.5 top open-weight leaderboards; H100 spot rents at ~$1–2/hr on neo-clouds (50–75% under hyperscalers).
2. **Simulation is now regulatory-grade, not enrichment.** The NCSBN National Simulation Study established up to **50% of clinical hours** are replaceable by high-quality simulation; states keep legislating substitution (e.g. NY 30% of nursing clinicals). Buyers already accept "20 encounters, not 200." The sim market is **~$1.9B (2025) → ~$6.7B (2033) at ~17% CAGR**, with the software/virtual-patient sub-slice the fastest-growing (~17.7%) ([`../research/04-market-competitors.md`], [`../business/00-market-and-strategy.md`](../business/00-market-and-strategy.md) §1).
3. **Regulation became a moat, not just a cost.** EAA/WCAG 2.2 AA enforceable, EU AI Act transparency live Dec 2026, KVKK/GDPR data-residency demands — a wall that slows entry and, once cleared, becomes switching-cost defensibility. OpenEvidence ($12B, >40% of US physicians daily) just proved that regulated, content-and-trust-anchored clinical AI is a category, not a feature.

---

## 2. Product & the wedge

**Product.** A learner roleplays a full encounter against progressively-embodied AI patients/colleagues/families — text-first, voice as a premium tier, 2D clinical-sign avatars, and multiplayer role-based rooms (doctor + nurse + paramedic + team-lead, AI backfilling empty roles). Every encounter returns a **6-domain competency-mapped grade** (mapped to Miller / ACGME / CanMEDS / AAMC-EPA and, for Turkey, TEPDAD/UÇEP), a **Dunning-Kruger calibration plot** (self-rated confidence elicited *before* score reveal vs measured competence), and a **gap→remediation loop**. Institutions get accreditation-grade cohort analytics.

**The wedge (ships first, must be 10× not 1.2×):** *solo learner ↔ AI-patient, **text-first**, **Emergency Medicine**, structured feedback + calibration plot* — EN and TR from day one ([`01-requirements-and-constraints.md`](./01-requirements-and-constraints.md) §6). Voice, 3D, multiplayer, and the dean's-office dashboard are **gated fast-follows behind metric gates, not MVP scope**. Two non-negotiables are architecturally enforced to keep classification stable: **`assessment_mode: formative`** (below EU AI Act Annex III high-risk) and **synthetic-patients-only / no PHI** (FERPA+GDPR, not HIPAA) — both deliberate later gates to relax, never accidental.

---

## 3. The open-source cost advantage & margins

The **open-first cost base is the whole business model**, not a cost tactic ([`../business/01-business-model-and-unit-economics.md`](../business/01-business-model-and-unit-economics.md), [`../research/08-open-source-model-stack.md`](../research/08-open-source-model-stack.md)). The Model Gateway's 3-tier router is unchanged; only the tier *contents* swapped from Anthropic-hosted to open-hosted: **small-open (patient turns, Qwen3-32B/Gemma-4 on SGLang) → large-open (grading/reasoning, Qwen3.5-397B + MedGemma verify) → frontier-API (rare, ~<5% of tokens, Opus 4.8 Batch on the hardest contested reasoning).**

| Encounter COGS | Naïve | API-first (optimized) | **Open-first (self-host)** |
|---|---|---|---|
| Blended text | ~$6.30 | ~$0.43 | **~$0.06** |

The causal chain investors should hold: open-weight self-hosting → **~82–86% steady-state gross margin** → a real **Free tier** ($0.60/mo COGS — a rounding error incumbents can't match) → a **positive-margin Turkey/PPP tier at ~half US price** → an **on-prem/VPC appliance** that ships COGS to the customer *and* satisfies KVKK/GDPR residency. Critically, the GPU fleet is a **fixed cost that amortizes across encounters**, so **per-encounter cost falls as volume rises** — margin *widens* with scale, the opposite of an API-metered competitor. At Y3 volume (~11.6M encounters) the open-vs-API delta is **~$4.3M/yr of COGS avoided** — roughly the entire Y3 R&D+compliance headcount. Under an API-first base, Y3 gross margin would fall to ~28% and the Turkey segment would go margin-negative; **self-hosting is what makes both the sub-$15 individual price and the emerging-market segment viable.**

*Caveat (modeled, not glossed):* self-host beats API only above **~500K tokens/day sustained**. The MVP pilot runs API-first; the fleet switches at the **Q4-Y1 volume crossover** (~2,500 encounters/day). This timing is the single most schedule-sensitive number in the model (sensitivity S7).

---

## 4. Turkey / EN dual market

Turkey is a **first-class launch geography, not a later localization** ([`../research/09-localization-i18n-turkish.md`](../research/09-localization-i18n-turkish.md), [`../business/02-gtm-and-sales.md`](../business/02-gtm-and-sales.md) §5). Rationale: ~**132k medical + ~90k nursing students across ~118 faculties**, ~52k/yr TUS residency-exam candidates — a large, dense, exam-driven, price-sensitive cohort that US incumbents do not localize. TR reaches EN parity in **both text and voice** (Qwen3/Gemma reasoning, Whisper-large-v3 + XTTS-v2 self-hosted, ElevenLabs Turkish as managed tier), with Turkish medical terminology, English/Latin code-switching treated as a *teachable signal*, and the guideline store country-scoped to **TEPDAD / T.C. Sağlık Bakanlığı / TİTCK / UÇEP** so citations read Turkish, not NICE/AHA. A large open model already beats average Turkish residents on the TUS exam (Llama-3-70B 79.2%; Qwen3/Gemma-4 exceed it), so the open tier is viable for TR grading.

**The margin unlock:** priced at a PPP-anchored **~1/3 of US list** (~$4–5/mo individual; ~$8k/program), Turkey is still gross-margin-positive *only because* COGS is ~$0.06 — impossible on API-first. Turkey is both a real (if small-dollar) revenue segment **and** the reusable template for the wider PPP/emerging world (MENA, Central/South Asia) that API-priced incumbents structurally cannot follow. KVKK data-residency is answered by in-region GPU rental / the on-prem appliance — the same open-first architecture that cuts cost.

---

## 5. Compound moat

No single feature is uncopyable; the **compound** is — the empty top-right quadrant of interaction-fidelity × assessment-rigor no competitor holds ([`../business/00-market-and-strategy.md`](../business/00-market-and-strategy.md) §3):

1. **Multiplayer role-based team rooms** (hardest to copy) — displaces the physical sim center, the buyer's most expensive asset.
2. **Voice + 3D roleplay as the native interface** — affordable only because voice is open-first (Whisper/XTTS).
3. **Calibration analytics** (confidence vs competence) — deterministic, novel, a publication hook; no competitor has it.
4. **Country-scoped guideline-grounded Socratic guidance** — cited to the right national body.

Each pillar makes the others more valuable and the whole harder to replicate. Reinforced by **structural moats**: the compound eval/validity flywheel (expert-graded anchor set), guideline-curation partnerships, LTI/Caliper institutional lock-in, a hash-chained audit substrate as system-of-record, a certification stack (ISO 42001/27001 + AI-Act conformity), the **open-first cost structure whose margin gap vs rivals widens with scale**, and **localized accreditation fit** (TEPDAD/UÇEP) no US incumbent will build. **The moat is not the model — models are rentable by anyone; the moat is the roleplay + assessment + validity + compliance loop, which compounds and can't be bought** ([`01-requirements-and-constraints.md`](./01-requirements-and-constraints.md) T12).

---

## 6. Unit-economics headline

- **Per-encounter COGS ~$0.06** (text, open-first) → **~82–86% steady-state gross margin**; robust to power users (a 60-encounter/mo Pro user costs ~$7.50 against $8.25–12 revenue) and to normal utilization swings.
- **Free tier bleed bounded at $0.60/user/mo** — the PLG unlock incumbents (at $2.58/mo API-first) cannot afford.
- **PLG LTV:CAC ~4–6:1** (LTV ~$150, CAC ~$25–40); **Enterprise LTV:CAC ~4–8:1** (LTV ~$120k–200k/program, ~90%+ logo retention once accreditation-embedded, NRR ~128%).
- Business SLOs that *are* the finance model: **GPU utilization ≥ 65–70%** and **prompt-cache reuse ≥ 85%** — margin is robust to swings but collapses if the fleet idles.

---

## 7. Go-to-market (two sentences)

AcuDx runs a **bottom-up product-led motion** in two learner communities simultaneously — US/international USMLE-Step + OSCE (English-first) and Turkish TUS + OSCE (Turkish-first) — where the learner is both wedge and champion: an individual gets 10× value from the free/Pro product without their institution buying anything, uses it, and drags the institution into an enterprise conversation. We then **land-and-expand through the 7-role dean's-office committee** (champion = Assessment Director, economic buyer = Dean, hard-veto blockers = IT/Procurement/DPO/Accreditation), arriving pre-armed with the compliance stack (HECVAT 4 / SOC 2 Type II / VPAT-WCAG 2.2 AA / DPA + residency) that clears the 6–14-month cycle — with Turkey's on-prem/KVKK-residency appliance as its distinct enterprise SKU.

---

## 8. Technical differentiators

| Differentiator | What it is | Why it matters |
|---|---|---|
| **Two-tier safety architecture** | A GROUNDED layer owns *all* clinical facts (citation-or-refuse); a ROLEPLAY layer improvises affect but **cannot assert a clinical fact** — the AI-patient never sources a number; case state does. A deterministic safety interceptor sits *outside* the LLM ([`02-architecture-overview.md`](./02-architecture-overview.md) §4). | Removes the largest hallucination surface; the "aggressive patient" can never become clinically unsafe. This is the educator kill-switch answered mechanically, not by prompt. |
| **Calibration analytics** | Confidence elicited *before* score reveal (structurally enforced by event-log ordering) → Brier/OCI/ECE/reliability diagram, deterministic, no LLM cost, never leaderboarded. | The signature feature no competitor has; a research/accreditation hook framed as a trainable skill. |
| **Open-source cost architecture** | 3-tier router (small-open → large-open → frontier-rare), prompt-cache byte-stable prefix (~55% of savings), RAG-not-long-context, self-hosted vLLM/SGLang fleet at FP8/INT4. | The ~86% COGS cut that is the entire capital-efficiency story and the PPP/Free-tier unlock. |
| **Multiplayer rooms** | Server-authoritative, event-sourced role-based rooms with AI backfill of empty roles + team/leadership rubric. | The hardest-to-copy moat; displaces the physical sim center. |
| **First-class i18n (TR+EN)** | Full text+voice parity; country-scoped guideline store; code-switching as a teachable signal; dotted/dotless-`i` treated as a security-relevant bug class. | Opens a large PPP market and the emerging-world template; a genuine trust/accreditation requirement, not a translation layer. |

All governed by four load-bearing invariants — two-tier content, three isolated clocks, one event-sourced hash-chained source of truth, and the Model Gateway as the only path to any model — each enforced mechanically ([`02-architecture-overview.md`](./02-architecture-overview.md) §intro).

---

## 9. MVP success gate

Before any expansion capital is spent, the wedge must clear a single hard gate ([`01-requirements-and-constraints.md`](./01-requirements-and-constraints.md) §6):

> cohort **≥200 learners** · **D30 retention ≥25%** · median **≥3 encounters/week** · **measured competence rises wk1→wk6** on a held-out case (not just self-rated confidence) · first-encounter completion **>70%** · learners correctly interpret their calibration plot (**≥80% usability**) · blended text-encounter cost **<$0.15** · **one paid design-partner school pilot**.

Miss the gate → hold scope and fix, do not spend the next tranche. Fast-follow order after the gate: (1) self-hosted fleet crossover + multiplayer rooms, (2) voice, (3) institution dashboard + LTI 1.3, (4) 2D clinical-sign avatar, (5) summative track toward Dec 2027, (6) 3D/streaming premium, (7) on-prem appliance.

---

## 10. Roadmap (metric-gated)

Each stage has **one gate** that must pass before the next unlocks capital/scope ([`../business/03-financial-model-and-roadmap.md`](../business/03-financial-model-and-roadmap.md) §9).

| Stage | Quarters | Ships | Metric gate to advance |
|---|---|---|---|
| **MVP** (the wedge) | Q1–Q3 Y1 | Solo text-EM roleplay + vitals + guidance + calibration plot + gap analysis + formative grading; EN+TR day one; API-first infra | D30 ≥25%, ≥3 enc/wk, competence rise wk1→wk6, >70% completion, calibration usability ≥80%, cost <$0.15/enc, **1 paid pilot** |
| **v1a — cost + multiplayer** | Q4 Y1 | Self-hosted fleet crossover (Qwen3/DeepSeek/MedGemma on vLLM/SGLang); multiplayer team rooms (moat first) | Blended COGS **<$0.08/enc** at ≥65% utilization; **100 concurrent rooms, no p95 regression** |
| **v1b — voice + institution** | Q1–Q2 Y2 | Cascade voice (open-first + managed tier, TR+EN); dean's-office dashboard; LTI 1.3 Advantage; HECVAT/SOC 2 Type II/VPAT | Voice round-trip <1200 ms p95; **1 signed paid INST-EN logo** + HECVAT+SOC 2 complete; NRR signal >110% |
| **v1c — TR institution + scale** | Q3–Q4 Y2 | TEPDAD/UÇEP accreditation mapping; INST-TR GTM; 2D clinical-sign avatar; ISO 42001/27001 | **Series-A gate:** ≥$3M ARR, NRR >130%, burn multiple <1.5, 8+ logos incl. TR |
| **v2a — summative + premium** | Q1–Q2 Y3 | Summative track (human co-sign, validity dossier) toward EU AI Act Annex III (2 Dec 2027); CME; 3D/streaming premium | κ ≥0.7 on pass/fail across ≥3 case-types; validity dossier peer-reviewed; DPIA refreshed |
| **v2b — appliance + multi-region** | Q3–Q4 Y3 | On-prem/VPC appliance (KVKK/Sağlık Bakanlığı residency); multi-region fleet (EU/UK/US/TR) | 99.9% uptime SLA; TR data fully in-region; appliance deployed at ≥1 institution |

**3-year trajectory:** ARR **~$0.35M (Y1) → ~$2.8M (Y2) → ~$9.6M (Y3)**; institutional crosses individual on exit-ARR by end of Y2 (17% → 54% of recognized revenue); gross margin 63% → 69% → 73%, converging to ~85% at scale; **burn multiple 4.4 → 1.27 → 0.30** (Y3 top-decile); cash-flow-positive line of sight late Y3.

---

## 11. Funding ask & use of funds

Milestone-tied, deliberately staged so each round buys a proof point ([`../business/03-financial-model-and-roadmap.md`](../business/03-financial-model-and-roadmap.md) §8):

| Round | Amount | Timing | Gate to raise | Primary use of funds |
|---|---|---|---|---|
| **Pre-seed** | **$2.2M** | Q3 Y0 (now) | — | Core eng (9 FTE), MVP wedge build, EN+TR content seed, API-first pilot infra — thin by design to force the wedge and hit the MVP gate |
| **Seed** | **$8M** | Q4 Y1 | MVP gate passed + PLG traction (~$0.35M ARR, D30 proven) + fleet crossover done | Scale to v1 (multiplayer, voice, dashboard, LTI), **HECVAT/SOC 2/ISO 42001**, GPU fleet, ML-infra hires, INST-EN GTM |
| **Series A** | **$22M** | Q4 Y2 | ≥$3M ARR, NRR >130%, burn multiple <1.5, CAC payback <18 mo, compliance stack live, 8+ institutional logos | Scale INST (EN+TR), summative track toward Dec-2027, multi-region + on-prem, sales team, path to $10M+ ARR |

**Use-of-funds discipline:** voice/3D/multiplayer/dashboards are **gated behind the MVP metric** and funded by seed, not pre-seed. The open-source cost base is precisely what lets $2.2M reach the gate — an API-first burn at pilot volume would need materially more. Valuation framing: model Series A at a conservative **~15–20× exit-ARR** (AI-native but regulated-edu), not the 25–30× frontier-AI top.

---

## 12. Top 5 risks

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| R1 | **Clinical hallucination reaches a learner as "correct"** — the educator kill-switch | Critical | Two-tier content architecture (AI-patient never sources facts; case state does); hard citation gate + cheap-tier verifier + deterministic dose/threshold check + refuse; MD-locked content; deterministic safety interceptor outside the LLM; golden-set eval gate on every model/prompt change ([`01-requirements-and-constraints.md`](./01-requirements-and-constraints.md) R1) |
| R2 | **Self-hosting slips or regresses quality** (S7 — the model's spine) | Critical (economic) | COGS reverts toward API-first → GM 73%→~50%, Turkey turns margin-negative. Mitigation: ML-infra is the *first* seed hire; golden-set eval gate blocks any regression before switching a fleet; stay API-first until the crossover clears ([`../business/03-financial-model-and-roadmap.md`](../business/03-financial-model-and-roadmap.md) S7) |
| R3 | **Assessment not defensible** — scores educators can't reconstruct/override; LLM validity ceiling (κ≈0.44) | High | Transcript-anchored, overridable, band-only scoring (κ≥0.6 show / 0.7 pass-fail); grader family ≠ patient family (fail-closed); formative-by-default + human co-sign; expert anchor set + validity dossier ([`01-requirements-and-constraints.md`](./01-requirements-and-constraints.md) R4) |
| R4 | **PLG-to-enterprise causality unproven** — the whole GTM thesis (T11) assumes organic cohort usage seeds enterprise deals | High | Instrument PLG→enterprise attribution from day one; Y1 targets only 1 paid pilot precisely to de-risk; if pilots come from cold outreach, the motion is enterprise-first and the funnel model changes ([`../business/02-gtm-and-sales.md`](../business/02-gtm-and-sales.md) §2) |
| R5 | **Regulatory over-reach / incumbent squeeze** — accidental slide into HIPAA or EU AI Act high-risk; OpenEvidence/AMBOSS/Aquifer/Shadow Health collide | High | Synthetic-only + formative-by-default architecturally enforced (no real-PHI path); compound moat (validity + eval flywheel + guideline partnerships + LTI/Caliper lock-in + cert stack + open-first cost); regulation as tailwind; partner for guidelines, compete on interaction+assessment ([`01-requirements-and-constraints.md`](./01-requirements-and-constraints.md) R5, R7) |

*(Full 10-risk register in [`01-requirements-and-constraints.md`](./01-requirements-and-constraints.md) §7; 7-tension resolution map in [`02-architecture-overview.md`](./02-architecture-overview.md) §6.)*

---

## 13. Why this wins

AcuDx occupies an **empty market quadrant** (multiplayer + voice/3D roleplay + calibration + country-scoped grounding) that incumbents reach only by combining four hard capabilities at once — and it defends that position with a **compound moat that compounds**: the more encounters, the richer the eval/validity flywheel, the deeper the institutional lock-in, and — uniquely — the *wider* the margin gap versus any API-priced rival, because the open-source GPU fleet is a fixed cost that amortizes with volume. That same open-first architecture is not just a cost story: it is the **PPP unlock** (a positive-margin Turkish/emerging-market segment nobody else can profitably serve), the **compliance unlock** (PHI never leaves AcuDx-controlled hardware → KVKK/GDPR residency + on-prem appliance), and the **free-tier unlock** (a real PLG funnel incumbents can't afford). Wrapped in a regulation-as-tailwind posture and a psychometrically defensible, formative-by-default assessment product, AcuDx converts the three forces reshaping medical education in 2026 — the AI cost collapse, regulatory-grade simulation demand, and the compliance wall — from headwinds into its three deepest moats.

---

*Detailed docs: requirements → [`01-requirements-and-constraints.md`](./01-requirements-and-constraints.md) · architecture → [`02-architecture-overview.md`](./02-architecture-overview.md) and [`../architecture/`](../architecture/) (00–10 + ADRs) · market & strategy → [`../business/00-market-and-strategy.md`](../business/00-market-and-strategy.md) · business model & unit economics → [`../business/01-business-model-and-unit-economics.md`](../business/01-business-model-and-unit-economics.md) · GTM & sales → [`../business/02-gtm-and-sales.md`](../business/02-gtm-and-sales.md) · financial model & roadmap → [`../business/03-financial-model-and-roadmap.md`](../business/03-financial-model-and-roadmap.md) · open-source model stack → [`../research/08-open-source-model-stack.md`](../research/08-open-source-model-stack.md) · localization & Turkish → [`../research/09-localization-i18n-turkish.md`](../research/09-localization-i18n-turkish.md).*
