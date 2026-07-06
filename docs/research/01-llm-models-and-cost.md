# 01 — LLM & Multimodal Model Landscape and Token/Cost Strategy (July 2026)

**Scope.** Which text/multimodal models AcuDx should use for each job, how to route between tiers, what an encounter costs, and how to cut that cost 60–80%. Voice/STT/TTS/duplex pricing is out of scope here (see `03-realtime-voice.md`); this doc covers the reasoning/generation LLM layer that sits behind every mode.

**Grounding.** Prices below are per **1M tokens**, verified July 2026. Model versions move fast; treat the exact `$` as a snapshot and pin the ROUTING ARCHITECTURE, which survives version churn. Anthropic figures are from the internal `claude-api` model catalog (authoritative). Others are cited inline.

---

## 1. Model landscape (July 2026)

### 1.1 Frontier tier — hard reasoning, grading, authoring

| Model | Ctx (in) | $ in /1M | $ out /1M | Cached in /1M | Notes |
|---|---|---|---|---|---|
| **Claude Opus 4.8** (`claude-opus-4-8`) | 1M | $5.00 | $25.00 | ~$0.50 | Adaptive thinking; strong clinical reasoning + instruction-following; our default frontier. |
| Claude Fable 5 (`claude-fable-5`) | 1M | $10.00 | $50.00 | — | Most capable Claude; **refuses bio/cyber-adjacent content by default** — a hazard for medical roleplay (see §6). Reserve for authoring only. |
| Claude Sonnet 5 (`claude-sonnet-5`) | 1M | $3.00 (intro $2.00 through 2026-08-31) | $15.00 ($10 intro) | ~$0.30 | Near-Opus quality on agentic/coding at Sonnet cost. Our **mid-tier workhorse**. |
| **OpenAI GPT-5.5** | 1.05M | $5.00 | $30.00 | $0.50 | Flagship; 128K max out; >272K ctx billed 2×in/1.5×out. ([OpenRouter](https://openrouter.ai/openai/gpt-5.5), [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.5)) |
| OpenAI GPT-5.6 "Sol" | ~400K | $5.00 | $30.00 | — | Newest tier; Terra $2.50/$15, Luna $1/$6. ([aipricing.guru](https://www.aipricing.guru/openai-pricing/)) |
| **Google Gemini 3 Pro** | 1M | $2.00 (≤200K) / $4.00 (>200K) | $12.00 / $18.00 | — | Cheapest frontier-class; long-context premium tiering. ([costgoat](https://costgoat.com/pricing/gemini-api), [ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing)) |

### 1.2 Mid tier — the roleplay/guidance workhorses

| Model | Ctx | $ in /1M | $ out /1M | Cached | Latency class |
|---|---|---|---|---|---|
| **Claude Sonnet 5** | 1M | $3.00 ($2 intro) | $15.00 ($10 intro) | ~$0.30 | 2–4 s TTFB |
| Gemini 3.5 Flash | 1M / 64K out | $1.50 | $9.00 | $0.15 | Fast; launched 2026-05-19. ([metacto](https://www.metacto.com/blogs/the-true-cost-of-google-gemini-a-guide-to-api-pricing-and-integration)) |
| Gemini 3 Flash Preview | 1M | $0.50 | $3.00 | — | Cheapest usable multimodal mid. ([pricepertoken](https://pricepertoken.com/pricing-page/model/google-gemini-3-flash-preview)) |
| GPT-5.4 mini | ~400K | $0.75 | $4.50 | — | Strong perf/latency. ([OpenAI](https://openai.com/index/introducing-gpt-5-4-mini-and-nano/)) |

### 1.3 Small tier — patient turns, translation, guardrails, drafting

| Model | Ctx | $ in /1M | $ out /1M | Latency |
|---|---|---|---|---|
| **Claude Haiku 4.5** (`claude-haiku-4-5`) | 200K | $1.00 | $5.00 | ~500 ms |
| GPT-5.4 nano | ~400K | $0.20 | $1.25 | sub-500 ms ([OpenAI](https://openai.com/index/introducing-gpt-5-4-mini-and-nano/)) |
| Gemini 3.1 Flash-Lite | 1M | ~$0.10 | ~$0.40 | fastest hosted ([pricepertoken](https://pricepertoken.com/pricing-page/model/google-gemini-3.1-flash-lite-preview)) |

### 1.4 Open-weight (self-host / on-prem)

| Model | License | API $ in/out /1M | Self-host $/1M (spot) | Notes |
|---|---|---|---|---|
| **DeepSeek V4 Flash** | MIT | $0.14 / $0.28 (as low as $0.09/$0.18) | — | Non-reasoning; cheap. ([DeepSeek](https://api-docs.deepseek.com/quick_start/pricing), [Spheron](https://www.spheron.network/blog/deepseek-vs-llama-4-vs-qwen3/)) |
| DeepSeek V4 Pro | MIT | $0.435 / $0.87 | — | Reasoning; self-hostable. ([codersera](https://codersera.com/blog/deepseek-v4-complete-guide-2026/)) |
| Qwen3-32B | Apache-2.0 | ~$0.50/$3 (Together) | $0.05 (B200 FP4) – $0.34 (H100 spot) | Strong general + tuning base. ([aipricing.guru](https://www.aipricing.guru/together-pricing/)) |
| Llama 4 Scout | Llama license | — | ~$0.36 (H100 spot) | ([Spheron](https://www.spheron.network/blog/deepseek-vs-llama-4-vs-qwen3/)) |

### 1.5 Medical-tuned open-weight (grounding/verification, NOT primary roleplay)

| Model | Params | MedQA | Use |
|---|---|---|---|
| **MedGemma 1.5** (Google) | — | ~91% | SOTA open medical; on-prem verifier / gap-analysis grader. ([nirmitee](https://nirmitee.io/blog/healthcare-llm-landscape-2026-medgemma-meditron-clinical-model-guide/)) |
| Meditron 70B (EPFL/Yale) | 70B | ~high | Auditable, guideline-trained; on-prem. ([arXiv 2605.16215](https://arxiv.org/pdf/2605.16215)) |
| OpenBioLLM 70B | 70B | ~73% | Llama-3 based. ([awesomeagents](https://awesomeagents.ai/leaderboards/medical-llm-leaderboard/)) |

> **Key point:** medical-tuned models win on **narrow factual/exam** tasks but are weaker at multi-turn persona and instruction-following than frontier general models. Use them as **graders/verifiers**, not as the patient actor. Frontier general models (Opus 4.8, GPT-5.5, Gemini 3 Pro) now match or beat 2023-era Med-PaLM 2 on MedQA anyway.

---

## 2. Model tier ↔ AcuDx job mapping

| Job | Frequency/encounter | Default model | Escalate to | Why |
|---|---|---|---|---|
| **Patient roleplay turn** (AI = patient/family) | 20–60 turns | **Haiku 4.5** | Sonnet 5 on persona-break/complex affect | Persona + short reply; cheap, low-latency, streamed. Persona lives in cached system prompt. |
| **Examiner / senior-colleague turn** | 3–10 | Sonnet 5 | Opus 4.8 for edge cases | Needs light clinical reasoning, still conversational. |
| **Guidance / Socratic hints** (grounded in guidelines) | 5–20 | Sonnet 5 + RAG | Opus 4.8 if uncertainty high | Must be evidence-grounded & safe → retrieval-augmented, not long-context. |
| **Post-encounter assessment / grading / gap analysis** | 1 (batch) | **Opus 4.8** | Fable 5 only if needed | High-stakes, competency-mapped (Miller/EPA/CanMEDS); run via **Batch API (−50%)**. Cross-check facts with MedGemma. |
| **Dunning-Kruger calibration compute** | 1 | deterministic code, no LLM | — | It's arithmetic (self-rating vs measured score); don't spend tokens. |
| **Terminology translation** (term → target lang) | on-demand | **Haiku 4.5 / Gemini Flash-Lite** | Sonnet 5 for rare terms | Short, cache glossary; small model + translation-memory cache. |
| **Safety / guardrail check** (medical-harm, PII, jailbreak) | every AI output | **nano/Flash-Lite classifier** | — | Fast, cheap gate on the small model's output before it reaches learner. |
| **Content authoring** (cases, rubrics, variants) | offline, rare | Opus 4.8 / Fable 5 | — | One-time cost amortized over thousands of runs; quality dominates. |

---

## 3. The 3-tier routing strategy

**Principle: cheap default → escalate on complexity/uncertainty. Never start at the frontier.**

```
Turn arrives
  │
  ├─ Tier 0  Non-LLM / cache hit? ── translation-memory, cached persona reply,
  │            deterministic vitals math, guardrail regex           → return, $0
  │
  ├─ Tier 1  Small (Haiku 4.5 / Flash-Lite)  ← DEFAULT for patient turns
  │            emit + self-report confidence + guardrail pass
  │            │
  │            ├─ confident & in-persona & safe → stream to learner
  │            └─ ESCALATE if: persona break, clinical-fact question,
  │                 low self-confidence, guardrail flag, learner off-script
  │
  ├─ Tier 2  Mid (Sonnet 5)  ← examiner, guidance, hard patient turns
  │            RAG-grounded for guidance; escalate on grounding gap/uncertainty
  │
  └─ Tier 3  Frontier (Opus 4.8)  ← grading, gap analysis, contested reasoning
               batched where non-interactive
```

**Escalation signals (cheap to compute):**
- Small model returns a low logprob / self-rated-confidence tag → escalate.
- Learner asks the AI-patient a **clinical fact** ("what's my potassium?") → route to the case's structured state, not the persona model.
- Guardrail classifier flags medical-harm/hallucination → escalate + verify.
- Retrieval returns weak/no match for a guidance query → escalate to Tier 2/3 + widen retrieval.

**Cost-cutting levers baked into routing:**

1. **Prompt caching.** Persona + case brief + guideline snippets go in a **frozen cached prefix**. Cache reads cost ~0.1× input, writes ~1.25×. Anthropic minimum cacheable prefix: 4096 tokens (Opus/Haiku), 2048 (Sonnet 5). **Keep the system prompt byte-stable** — no `datetime.now()`, no unsorted JSON, no per-request IDs in the prefix, or the cache silently misses. This is the single biggest per-encounter saving.
2. **Retrieval, not long context.** Never stuff full ATLS/guideline PDFs into context. Chunk + vector-retrieve (HNSW) the 2–5 relevant passages per guidance turn. A 1M window is available but paying to fill it every turn is the #1 cost mistake.
3. **Context compression.** After N turns, server-side **compaction** (`compact-2026-01-12`) or context-editing (clear old tool results) keeps the transcript lean. Summarize old history into a running case-state object rather than resending raw turns.
4. **Batching.** Grading, gap analysis, cohort analytics, content authoring → **Batch API at 50% off** (Anthropic, OpenAI, Gemini all offer −50%). None are latency-sensitive.
5. **Streaming.** Every interactive turn streams (TTFB matters more than total latency for perceived responsiveness; also avoids HTTP timeouts on long outputs).
6. **Speculative / small-model drafting.** Small model drafts the patient reply; escalate only the ~10–20% of turns that fail the confidence/guardrail gate. Most turns never touch a mid/frontier model.

---

## 4. Per-encounter token budget & cost

**Reference encounter:** solo-vs-AI, ~40 turns, 15-min ED case, guidance on, full post-encounter grade.

### Naïve (everything on frontier, no caching) — the anti-pattern

| Component | Tokens (in/out) | Model | Cost |
|---|---|---|---|
| 40 patient turns, full history resent each turn | ~600K in / 20K out | Opus 4.8 | $3.00 + $0.50 = **$3.50** |
| 15 guidance turns, full guideline docs in ctx | ~450K in / 8K out | Opus 4.8 | $2.25 + $0.20 = **$2.45** |
| Grading | ~40K in / 6K out | Opus 4.8 | $0.20 + $0.15 = **$0.35** |
| **Total** | | | **≈ $6.30 / encounter** |

At 10K encounters/day that's **$63K/day** — unviable.

### Optimized (routed + cached + RAG + batched)

| Component | Tokens | Model | Cost |
|---|---|---|---|
| 34 patient turns (cached prefix, ~2K fresh in / 150 out each) | reads ~90% cached | Haiku 4.5 | ~**$0.09** |
| 6 escalated patient turns | small fresh | Sonnet 5 | ~**$0.04** |
| 15 guidance turns (RAG: 3K retrieved + 1K query in, cached persona) | | Sonnet 5 | ~**$0.10** |
| Guardrail checks (40 outputs) | tiny | Flash-Lite/nano | ~**$0.01** |
| Grading + gap analysis (batched −50%) | 40K in / 6K out | Opus 4.8 batch | ~**$0.18** |
| Translation (cached glossary) | | Haiku | ~**$0.01** |
| **Total** | | | **≈ $0.43 / encounter** |

**≈ 93% reduction ($6.30 → $0.43).** Even a conservative build (Sonnet 5 default instead of Haiku for patient turns) lands near **$1.10**, still an **82% cut**. The 60–80% target is comfortably met by caching + RAG + routing alone; small-model drafting pushes it to ~90%.

**Sensitivity:** the biggest single lever is **prompt caching on the patient-persona prefix** (~55% of the saving), then **RAG-instead-of-long-context for guidance** (~25%), then **batched grading** (~10%).

---

## 5. On-prem / open-weight option for privacy-sensitive institutions

Some universities/hospitals will demand no PHI leaving their walls (GDPR, national health-data laws, IRB constraints). Offer a **self-hosted tier**:

**Recommended stack:**
- **Patient roleplay + examiner:** Qwen3-32B or Llama 4 Scout, served on vLLM. Self-host cost **$0.05–0.36 /1M** on B200/H100 spot. ([Spheron](https://www.spheron.network/blog/deepseek-vs-llama-4-vs-qwen3/))
- **Clinical grounding / grading / verification:** **MedGemma 1.5** (~91% MedQA) or **Meditron 70B** (auditable, guideline-trained — matters for institutional trust). ([nirmitee](https://nirmitee.io/blog/healthcare-llm-landscape-2026-medgemma-meditron-clinical-model-guide/), [arXiv](https://arxiv.org/pdf/2605.16215))
- **Reasoning fallback:** DeepSeek V4 Pro (MIT, self-hostable) for harder cases.

**Trade-offs:**
- **Quality gap:** open-weight roleplay/persona quality trails Opus 4.8/GPT-5.5 by a noticeable margin on multi-turn affect, non-native-speaker simulation, and instruction adherence. Acceptable for many training scenarios, weaker for the subtle personas (cognitively impaired, aggressive de-escalation).
- **Cost:** near-zero marginal token cost, but you own **GPU capex/opex** ($0.50–$5/GPU-hr) and MLOps. Break-even vs API is roughly **>3–5M tokens/day sustained**; below that, hosted APIs are cheaper.
- **Grounding is a strength:** medical-tuned open models are genuinely competitive on factual guidance/grading, so the on-prem quality hit is smallest exactly where institutions care most (evidence accuracy), and largest where they care least for compliance (persona flavor).
- **Ops:** offer it as a **deployable appliance** (containerized vLLM + MedGemma + retrieval index) so institutions run it in their VPC; AcuDx SaaS control-plane orchestrates but never sees PHI.

---

## 6. Medical hallucination mitigation — model choices

Hallucination in a **teaching** tool is worse than in a chatbot: a confidently-wrong "senior colleague" or an ungrounded guideline hint mis-trains a clinician. Layered defense:

1. **Retrieval-grounded guidance, always.** Every Socratic hint and every clinical-fact answer is generated **from retrieved, versioned guideline passages** (ATLS + country variants), with **inline citations** returned to the learner. Use Anthropic **Citations** (`citations: {enabled: true}`) so cited spans are machine-verifiable. No retrieval hit → the model must say "not in current guidelines," not invent.
2. **Separate the actor from the truth.** The AI-**patient** never sources clinical facts; the **case's structured state** (labs, exam findings, vitals) is authoritative. When the learner asks for a test result, serve it from state, not from a language model. This removes the largest hallucination surface entirely.
3. **Verifier cross-check on guidance & grading.** Generate with the frontier general model, then **verify factual claims with a medical-tuned model** (MedGemma 1.5 / Meditron) or a second independent pass. Disagreement → flag/regenerate. This "generate-then-verify" pairing catches confident errors a single model misses.
4. **Model choice for the reasoning that matters:** **Opus 4.8** for grading (strong instruction-following → fewer fabricated rubric hits; adaptive thinking improves multi-step clinical reasoning). Note **Claude Fable 5 refuses bio/cyber-adjacent content** and is a poor fit for medical roleplay despite being most capable — configure server-side fallbacks to Opus 4.8 if Fable is ever in the chain (see `claude-api` refusal handling).
5. **Guardrail classifier** (nano/Flash-Lite) on every AI output: catches medical-harm advice, PII leakage, and out-of-persona clinical assertions before they reach the learner.
6. **Structured outputs for grades.** Emit rubric scores via strict JSON schema (`output_config.format`), so competency mapping (Miller/ACGME/CanMEDS/EPA) is deterministic and can't drift into prose invention.
7. **Human-in-the-loop for authoring.** New cases/rubrics are frontier-generated but **faculty-reviewed** before publication — the one place we accept the frontier-model cost and never auto-publish.

---

## Key decisions for AcuDx

- **Default patient-turn model = Claude Haiku 4.5** (streamed, persona in a cached prefix); **escalate to Sonnet 5** only on persona-break/clinical-fact/low-confidence/guardrail signals. Never start turns at the frontier.
- **Grading, gap analysis, and content authoring = Claude Opus 4.8**, run through the **Batch API (−50%)**; calibration plots are deterministic code, not LLM.
- **3-tier router (Small → Mid → Frontier)** with confidence/guardrail escalation is the core architecture and must survive model version churn; pin the router, not the model IDs.
- **Prompt caching + RAG + batching cut per-encounter cost ~93%** ($6.30 → $0.43). Keep the cached prefix byte-stable (no timestamps/UUIDs/unsorted JSON) — this alone is ~55% of the saving.
- **Guidance is retrieval-grounded and cited, never long-context**; the AI-patient never sources clinical facts — labs/exam/vitals come from authoritative **case state**, removing the biggest hallucination surface.
- **Hallucination defense = generate (frontier general) then verify (MedGemma 1.5 / Meditron)**; guardrail classifier on every output; strict-JSON grade schemas mapped to Miller/ACGME/CanMEDS/EPA.
- **On-prem tier for privacy-sensitive institutions:** Qwen3-32B/Llama 4 Scout for roleplay + MedGemma 1.5/Meditron for grounding, shipped as a VPC appliance; expect a persona-quality hit but competitive clinical accuracy. Break-even vs API ≈ >3–5M tokens/day.
- **Avoid Claude Fable 5 in the live roleplay path** — it refuses bio/cyber-adjacent content; use Opus 4.8 and configure server-side refusal fallbacks if Fable is used for authoring.
- **Budget planning number: ~$0.43/encounter optimized (~$1.10 conservative).** At 10K encounters/day that's ~$4.3K/day vs ~$63K/day naïve — the routing/caching work is existential, not optional.
