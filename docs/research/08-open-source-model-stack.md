# 08 — Open-Source / Self-Hosted Model Stack (NEW DEFAULT tier, July 2026)

**Scope.** The open-weight, self-hosted models AcuDx runs by default, the serving/quantization stack, the GPU economics that make them cheaper than API, which jobs stay open vs escalate to a frontier API, the Turkish-first constraint, and the privacy/residency win. This **supersedes the API-first default** of `01-llm-models-and-cost.md`: the Model Gateway + 3-tier router survives unchanged, but the tiers are now **small-open → large-open → frontier-API (rare)** instead of Haiku → Sonnet → Opus.

**Grounding.** Prices are per **1M tokens** or **per GPU-hour**, web-verified July 2026 (cited inline). Open-model landscape moves weekly; treat exact `$`/params as a snapshot and pin the ROUTING + SERVING ARCHITECTURE, which survives version churn. Frontier-API figures (Opus 4.8, etc.) carry over from `01-llm-models-and-cost.md`.

> **Direction correction 1 applied:** default to the best self-hosted open-weight model per job; escalate to a frontier API only when quality genuinely requires it (hardest reasoning, rare). This cuts marginal token cost toward zero and keeps PHI in-region.

---

## 1. Best open-weight general LLMs (July 2026)

The 2024 order (Llama dominant) has inverted: **Chinese labs — DeepSeek, Alibaba/Qwen, Moonshot, Zhipu — hold most top open-weight positions**, with OpenAI's `gpt-oss` and Meta's Llama 4 as the strongest Western open releases. ([BenchLM](https://benchlm.ai/blog/posts/best-open-source-llm), [HF blog](https://huggingface.co/blog/daya-shankar/open-source-llms))

| Model | Total / active params | Ctx | License | Multilingual / TR strength | Role for AcuDx |
|---|---|---|---|---|---|
| **DeepSeek V4 Pro** | 1.6T / 49B MoE | 1M | **MIT** | Strong; leads open coding/reasoning (BenchLM overall 87) | Large-open reasoning ceiling (rare) ([BenchLM](https://benchlm.ai/blog/posts/best-open-source-llm), [HF](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro)) |
| **DeepSeek V4 Flash** | 284B / 13B MoE | 1M | **MIT** | Strong | Fast large-open; grading/guidance ([llm-stats](https://llm-stats.com/models/compare/qwen3.5-397b-a17b-vs-deepseek-v4-flash-max)) |
| **Qwen3.5-397B-A17B** | 397B / 17B MoE | 262K (→1M YaRN) | **Apache-2.0** | **Best-in-class multilingual (201 langs), strongest TR of the open frontier** | **Default large-open (reasoning/grading), TR-first** ([llm-stats](https://llm-stats.com/models/compare/qwen3.5-397b-a17b-vs-deepseek-v4-flash-max), [Particula](https://particula.tech/blog/deepseek-v4-qwen-open-source-ai-disruption)) |
| **Qwen3-32B** (+ 30B-A3B MoE) | 32B dense | 128K+ | **Apache-2.0** | Excellent multilingual incl. TR; MGSM/MMMLU-leading class | **Default patient-turn model** (persona, small-open) ([HF blog](https://huggingface.co/blog/daya-shankar/open-source-llms)) |
| **Llama 4 Scout** | 109B / 17B, 16 experts | **10M** | Llama 4 Community (≤700M MAU) | Good multimodal; TR moderate | Long-context option; multimodal ([Meta](https://ai.meta.com/blog/llama-4-multimodal-intelligence/), [HF](https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E)) |
| **Llama 4 Maverick** | 400B / 17B, 128 experts | 1M | Llama 4 Community | Good; runs at ~17B cost/speed | Mid-large fallback ([Meta](https://ai.meta.com/blog/llama-4-multimodal-intelligence/)) |
| **gpt-oss-120b** | 117B / 5.1B MoE, native MXFP4 | 128K | **Apache-2.0** | o4-mini-parity reasoning; fits ONE 80GB GPU | Verification/reasoning on a single card ([OpenAI](https://openai.com/index/introducing-gpt-oss/), [arXiv 2508.10925](https://arxiv.org/abs/2508.10925)) |
| **gpt-oss-20b** | 21B / 3.6B MoE | 128K | **Apache-2.0** | o3-mini-parity; runs in 16GB (edge) | Guardrail/classifier tier ([OpenAI](https://openai.com/index/introducing-gpt-oss/)) |
| Kimi K2.6 (Moonshot) | large MoE | long | open | strong coding (BenchLM 88.7) | optional reasoning peer ([BenchLM](https://benchlm.ai/blog/posts/best-open-source-llm)) |

Notes: Llama 4 **Behemoth (~2T) is paused** (May 2026) — do not design around it. ([serenitiesai](https://serenitiesai.com/articles/llama-4-behemoth-maverick-scout-review-2026)) MoE is why this is affordable: Maverick/Qwen3.5 "know" 400B but **activate ~17B/token**, so they serve at ~17B cost/latency. ([Meta](https://ai.meta.com/blog/llama-4-multimodal-intelligence/))

**Turkish (Direction correction 2).** Qwen is the open family with the strongest, best-documented Turkish; validate against **TurkishMMLU** and **Cetvel** (unified TR understanding/generation/culture benchmark). ([TurkishMMLU arXiv 2407.12402](https://arxiv.org/pdf/2407.12402), [Cetvel arXiv 2508.16431](https://arxiv.org/pdf/2508.16431)) Turkish is agglutinative/morphologically rich — persona fluency and medical terminology must be TR-eval'd, not assumed from MMLU. Keep the door open to a **TR-fine-tuned Qwen3** (LoRA on Turkish medical corpora + TEPDAD/T.C. Sağlık Bakanlığı guideline text) if base TR fluency lags on clinical registers.

---

## 2. Best MEDICAL open models (grounding / grading / verification)

Used as **graders/verifiers**, not as the patient actor (they trail general models on multi-turn persona/instruction-following).

| Model | Params | MedQA | License | Use for AcuDx |
|---|---|---|---|---|
| **MedGemma 1.5** (Google, Jan 2026) | 4B & 27B multimodal, 27B text-only | **~91%** (> Med-PaLM 2 86.5%) | Gemma terms | **SOTA open medical verifier**; on-prem fact cross-check + gap-analysis grading ([nirmitee](https://nirmitee.io/blog/healthcare-llm-landscape-2026-medgemma-meditron-clinical-model-guide/)) |
| **Meditron 70B** (EPFL/Yale, "Fully Open") | 70B (Llama-3.1) | high | open + **auditable pipeline** | Institutional-trust grounding; fully auditable data/pipeline matters for accreditation ([arXiv 2605.16215](https://arxiv.org/pdf/2605.16215v2)) |
| Aloe family | 7B–70B | strong | open | Alternative open specialized medical ([arXiv 2505.04388](https://arxiv.org/pdf/2505.04388)) |
| OpenBioLLM 70B | 70B (Llama-3) | ~73% | open | Weaker; no paper/data disclosure — deprioritize ([nirmitee](https://nirmitee.io/blog/healthcare-llm-landscape-2026-medgemma-meditron-clinical-model-guide/)) |

> **Key point (unchanged from `01`):** medical-tuned models win on **narrow factual/exam** tasks but are weaker at persona. Pattern = **generate with a general open model → verify factual claims with MedGemma 1.5 / Meditron** → disagreement flags/regenerates. This "generate-then-verify" pairing catches confident errors a single model misses. Off-guideline QA (rare cases) still needs retrieval — see `05-guideline-grounding-engine.md`. ([arXiv 2605.21807](https://arxiv.org/pdf/2605.21807))

**Embeddings (open, self-host):** **BGE-M3** (dense+sparse+multi-vector, 100+ langs incl. TR — the production multilingual RAG workhorse) or **Qwen3-Embedding-8B** (70.6 MTEB, 100+ langs). Domain-tuned medical embeddings beat generic by 10–15% in-domain — fine-tune BGE-M3 on the guideline corpus. ([BentoML](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models), [Milvus](https://milvus.io/blog/choose-embedding-model-rag-2026.md))

**Voice (TR-first, all open, cross-refs `03-voice-pipeline.md`):** **Whisper large-v3** STT (99+ langs, +20–30% on non-English incl. TR; use **large-v3-turbo** for 6× faster inference at ~1–2% WER cost). TTS: **XTTS-v2** (17 langs incl. `tr`) or **Kokoro/Fish-Speech** for lighter GPU. ([Whisper HF](https://huggingface.co/openai/whisper-large-v3), [Coqui XTTS](https://localaimaster.com/models/coqui-tts), [Spheron TTS](https://www.spheron.network/blog/deploy-open-source-tts-gpu-cloud-2026/))

---

## 3. Serving stack + quantization + throughput

| Engine | Best at | AcuDx use |
|---|---|---|
| **vLLM** | High-concurrency general production, PagedAttention + continuous batching, multi-GPU tensor-parallel, OpenAI-compatible API | **Default serving layer** for patient-turn + grading fleets ([sitepoint](https://www.sitepoint.com/self-hosted-llm-costs-2026/), [LeetLLM](https://leetllm.com/blog/llm-inference-engine-comparison-2026)) |
| **SGLang** | Prefix-heavy / shared-prefix workloads (RadixAttention): ~16.2K tok/s vs vLLM 12.5K on Llama-3.1-8B H100 (**+29%**) | **Patient-persona fleet** — huge shared cached prefix per case = ideal for RadixAttention ([Spheron](https://www.spheron.network/blog/vllm-vs-tensorrt-llm-vs-sglang-benchmarks/), [particula](https://particula.tech/blog/sglang-vs-vllm-inference-engine-comparison)) |
| **TensorRT-LLM** | Lowest latency: >10K out tok/s at peak, sub-100ms TTFT, lowest p50/p95 at every concurrency (p95 TTFT 1,280ms vs vLLM 1,450ms @100 concurrent) on Llama-3.3-70B FP8 | **Latency-critical voice turns** where TTFB is felt ([Spheron](https://www.spheron.network/blog/vllm-vs-tensorrt-llm-vs-sglang-benchmarks/), [Lyceum](https://lyceum.technology/magazine/vllm-vs-tensorrt-llm-production-benchmark/index.html)) |
| TGI / LMDeploy | HF-native / alt | fallback |

**Recommendation:** **vLLM as the standard control plane**; **SGLang for the patient-persona fleet** (shared-prefix cache dominates); **TensorRT-LLM only for the latency-critical voice-coupled path**. Delta at 70B is modest (3–5%); at 8B it's large — so engine choice matters most for the small-open patient model.

**Quantization** (the real cost lever): serve at **FP8** by default (near-lossless on H100/H200, ~2× throughput vs BF16); **MXFP4** where native (gpt-oss ships MXFP4, runs 120B on one 80GB GPU); **AWQ/GPTQ INT4** for the small patient model to fit more replicas per GPU; keep **INT8/FP8 KV-cache** to extend batch/context. ([OpenAI gpt-oss](https://openai.com/index/introducing-gpt-oss/)) Rule of thumb: FP8 doubles effective $/token savings vs BF16 at negligible quality cost for our jobs.

---

## 4. GPU economics — realistic $/1M tokens self-hosted vs API

**GPU rental (per-GPU-hour, neo-cloud/spot vs hyperscaler, July 2026):**

| GPU | Spot / neo-cloud | On-demand | Hyperscaler |
|---|---|---|---|
| **H100 80GB** | ~$1.03–1.49 (Hyperbolic/spot) | $1.99 (RunPod), $2.99 (Lambda) | $3.93–6.98 (AWS), ~$12.29 (Azure) |
| **H200 141GB** | ~$3.72–3.80 (Jarvis) | ~$4.11 | up to ~$10.60 |
| **L40S 48GB** | ~$0.8–1.2 | ~$1.5 | — |
| **B200 192GB** | ~$4.95 (Vast) | $5.34+ | $4.95–18 (launch premium) |
| **GB200 NVL72** | enterprise contract | — | — |

Sources: [IntuitionLabs](https://intuitionlabs.ai/articles/h100-rental-prices-cloud-comparison), [Thunder H100](https://www.thundercompute.com/blog/nvidia-h100-pricing), [Jarvis H200](https://jarvislabs.ai/blog/h200-price), [Vast B200](https://vast.ai/pricing/gpu/B200), [Runpod B200](https://www.runpod.io/gpu-models/b200). **Neo-clouds (Vast/RunPod/Lambda) are 50–75% cheaper than AWS/Azure/GCP for identical hardware.**

**$/1M tokens self-hosted** = `GPU_$/hr ÷ (throughput_tok/s × 3600) × 1e6 ÷ utilization`. **Utilization is the #1 leak — a GPU at 10% load inflates $/token 10×.** Real all-in self-host cost is ~**3–5× the raw GPU sticker** (MLOps, idle, redundancy, replicas). Worked figures:

| Setup | Throughput | Raw GPU $/hr | Effective $/1M tok (70% util, ×4 overhead) |
|---|---|---|---|
| Qwen3-32B FP8, H100 spot | ~10K tok/s aggregate | $1.49 | **~$0.05–0.20** |
| gpt-oss-120b MXFP4, 1× H100 | ~high (MoE 5.1B active) | $1.99 | **~$0.10–0.30** |
| DeepSeek V4 Flash FP8, H200 | large-MoE | $4.11 | **~$0.30–0.60** |

vs **API**: budget open-router APIs $0.10–0.28/1M, frontier reasoning $5–30/1M. ([cloudzero](https://www.cloudzero.com/blog/llm-api-pricing-comparison/), [morphllm](https://www.morphllm.com/llm-api))

**Break-even.** Self-hosting beats API at roughly **≥500K tokens/day sustained** (~11B tokens/month is the classic threshold); at **500M tok/day a Llama-70B-class setup is ~$4,360/mo vs ~$22,500/mo API — a 5× win**. Below ~500K tok/day, hosted APIs are cheaper (you can't amortize the idle GPU). ([tokenmix](https://tokenmix.ai/blog/self-host-llm-vs-api), [braincuber](https://www.braincuber.com/blog/self-hosted-llms-vs-api-based-llms-cost-performance-analysis))

**Worked per-encounter cost at AcuDx scale** (reference: solo-vs-AI, ~40 turns, 15-min ED case, guidance on, full grade — same encounter as `01`):

| Component | Prior API-first (`01` optimized) | **New open-first (self-host)** |
|---|---|---|
| 34 patient turns (cached/shared-prefix) | Haiku 4.5 ~$0.09 | **Qwen3-32B on SGLang ~$0.006** |
| 6 escalated patient turns | Sonnet 5 ~$0.04 | **Qwen3.5-397B (large-open) ~$0.008** |
| 15 guidance turns (RAG) | Sonnet 5 ~$0.10 | **DeepSeek V4 Flash + BGE-M3 ~$0.015** |
| Guardrail (40 outputs) | nano/Flash-Lite ~$0.01 | **gpt-oss-20b ~$0.002** |
| Grading + gap analysis | Opus 4.8 batch ~$0.18 | **Qwen3.5-397B + MedGemma verify ~$0.02** (frontier-API only on contested ~10%: +~$0.03) |
| Translation/TR terms | Haiku ~$0.01 | **Qwen3-32B (bilingual) ~$0.002** |
| **Total / encounter** | **~$0.43** | **~$0.05–0.08** (with rare frontier escalation ~$0.10) |

**~80–88% below the already-optimized API-first number ($0.43 → ~$0.06), and ~98% below the naïve $6.30.** At 10K encounters/day: API-first ~$4.3K/day → **open-first ~$600–800/day** (plus fixed GPU fleet). The GPU fleet is a **fixed cost**, so the saving compounds with volume — the more encounters, the wider the gap. Caveat: this only holds **above the ~500K tok/day break-even**, which AcuDx clears easily at target scale; a low-volume pilot should stay API-first until volume justifies the fleet.

---

## 5. Which jobs stay OPEN vs escalate to FRONTIER API

**Stay open (default, ~95%+ of tokens):**
- **Patient/family roleplay turns** → Qwen3-32B (SGLang, FP8/INT4, shared cached persona prefix). Highest volume; open quality is ample for persona.
- **Embeddings / retrieval** → BGE-M3 (self-host, TR-capable). Zero reason to pay an API.
- **Guardrail / safety / PII classifier** → gpt-oss-20b (16GB, fast).
- **Verification / fact cross-check** → MedGemma 1.5 / Meditron (on-prem, auditable).
- **Most grading & gap analysis** → Qwen3.5-397B (large-open), MedGemma-verified, batched.
- **Terminology translation TR↔EN** → Qwen3-32B (bilingual, glossary-cached).
- **Voice STT/TTS** → Whisper large-v3(-turbo) + XTTS-v2 (self-host, TR).

**Escalate to frontier API (rare, ~<5%, quality-gated):**
- **Hardest contested clinical reasoning** in grading where large-open + verifier disagree or confidence is low → **Opus 4.8 (Batch −50%)**.
- **Subtle/high-stakes personas** (cognitively-impaired affect, aggressive de-escalation, rare non-native-speaker simulation) where open persona fidelity is felt to slip → escalate that turn only.
- **Content authoring** (new cases/rubrics) — offline, faculty-reviewed, quality dominates → frontier is fine one-time, amortized over thousands of runs.

**Escalation signals** are unchanged from `01`'s router (low self-confidence/logprob, persona break, guardrail flag, weak retrieval, verifier disagreement) — the router is identical, only the tier *contents* changed from Anthropic-hosted to open-hosted.

---

## 6. Privacy / residency win (Direction correction: local-first)

Self-hosting is not only cheaper — it is the **compliance unlock**:
- **No third-party data processor.** PHI/learner data never leaves AcuDx-controlled GPUs → removes a whole class of DPA/BAA/sub-processor risk (GDPR, KVKK — Turkey's data-protection law, national health-data statutes).
- **In-region residency.** Rent H100/H200 in an EU/Türkiye region (or an institution's own DC) → data-residency requirements for Turkish universities and hospitals (**T.C. Sağlık Bakanlığı**, KVKK) are satisfiable without exporting data to US API endpoints.
- **VPC/on-prem appliance.** Ship the stack (vLLM/SGLang + Qwen3 + MedGemma + BGE-M3 + Whisper/XTTS + retrieval index) as a **containerized appliance** institutions run in their own VPC; the AcuDx SaaS control plane orchestrates but **never sees PHI**. This is the tier privacy-sensitive institutions (IRB, accreditation) will demand.
- **Auditability.** Meditron's fully-open/auditable pipeline and open weights let institutions inspect exactly what grades their students — a trust lever no closed API offers. ([arXiv 2605.16215](https://arxiv.org/pdf/2605.16215v2))

---

## Key decisions for AcuDx

- **Open-weight self-hosted is the NEW DEFAULT tier.** Tiers become **small-open (patient turns) → large-open (reasoning/grading) → frontier-API (rare escalation)**. The Model Gateway + 3-tier router from `02-model-gateway-and-routing.md` is unchanged; only the tier *contents* swap from Anthropic-hosted to open-hosted.
- **Recommended default open model per job:**
  - Patient/family roleplay turn → **Qwen3-32B** (SGLang, FP8/INT4, shared cached prefix)
  - Examiner / guidance / most grading → **Qwen3.5-397B-A17B** (Apache-2.0, best open TR) with **DeepSeek V4 Flash** as reasoning peer
  - Medical fact verification / gap-analysis grounding → **MedGemma 1.5** (SOTA open, ~91% MedQA) + **Meditron 70B** (auditable)
  - Embeddings / RAG → **BGE-M3** (fine-tuned on guideline corpus)
  - Guardrail / PII / safety classifier → **gpt-oss-20b** (Apache-2.0, 16GB)
  - Voice → **Whisper large-v3-turbo** (STT) + **XTTS-v2** (TTS), both TR-capable
  - Rare frontier escalation (hardest reasoning, subtle personas) → **Opus 4.8 (Batch −50%)**
- **Serving:** vLLM standard; **SGLang for the patient-persona fleet** (RadixAttention on the shared case prefix, +29% at 8B); TensorRT-LLM only for latency-critical voice turns. Serve **FP8** by default, **MXFP4** for gpt-oss, **INT4 AWQ** for the small patient model.
- **Turkish is first-class:** Qwen is the open family with the strongest documented TR; validate on **TurkishMMLU + Cetvel**, and be ready to LoRA-tune Qwen3 on Turkish medical + TEPDAD/Sağlık Bakanlığı text if clinical-register fluency lags. Voice is TR too (Whisper +20–30% non-English, XTTS `tr`).
- **Cost:** per-encounter drops from **~$0.43 (optimized API-first) to ~$0.05–0.08 open-first** (~80–88% further saving, ~98% below naïve). Holds **above ~500K tok/day break-even** (AcuDx clears this at scale); low-volume pilots stay API-first until the GPU fleet amortizes. Utilization is the #1 cost leak — pack replicas, keep GPUs busy.
- **Generate-then-verify stays:** open general model generates, **MedGemma/Meditron verifies** clinical claims, disagreement flags/regenerates; guardrail (gpt-oss-20b) on every output; strict-JSON grade schemas (Miller/ACGME/CanMEDS/EPA). The AI-patient never sources clinical facts — labs/vitals come from authoritative case state.
- **Privacy is the strategic win:** in-region GPU rental / VPC appliance keeps PHI on AcuDx-controlled hardware → satisfies GDPR/KVKK/Sağlık Bakanlığı residency without US API export; ship as a self-hostable appliance the control plane orchestrates but never sees PHI.
- **Avoid designing around paused/uncertain models:** Llama 4 **Behemoth is paused** — do not depend on it. Pin the *router and serving architecture*, not model IDs; open weights churn weekly.
