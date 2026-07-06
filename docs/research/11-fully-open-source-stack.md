# 11 — Fully-Open-Source Stack (the OPEN-FOR-ALL map, July 2026)

**Scope.** This is the authoritative **open-source-by-default** map for AcuDx: for *every* layer where earlier docs named a proprietary vendor (voice: Deepgram/Cartesia/ElevenLabs; avatars: Anam/Tavus/HeyGen/Simli; embeddings: Voyage/Cohere; auth: Auth0; image-to-replica: Tavus), this doc gives the best **open** alternative, its **license** (with ⚠ flags on every non-commercial / AGPL / source-available / restricted term), maturity, quality gap, self-host cost, and Turkish/multilingual support. The goal: AcuDx must be **buildable end-to-end on open source** — sovereign, air-gappable, lowest-COGS — with proprietary vendors surviving **only as optional premium**, each with a named open fallback.

**Supersedes/extends:** the *models* are already open by default (`08-open-source-model-stack.md`, `09-localization-i18n-turkish.md`). This doc extends the open-default mandate to **voice, avatars, retrieval infra, identity, FHIR, analytics, observability, provenance, and the data plane**. The **architecture** in `../architecture/00-11` is unchanged — this swaps *vendor contents*, not the router / event-sourcing / three-clocks / two-tier-content invariants.

**Grounding.** Web-verified July 2026 (sources inline). Licenses and versions churn — **pin the architecture and the open-vs-proprietary decision, treat exact versions/scores as a snapshot.** Every table carries a **LICENSE** column; every ⚠ marks a term that blocks (or complicates) a commercial / fully-open / air-gapped build.

> **License legend.** ✅ **Permissive** (MIT / Apache-2.0 / BSD / PostgreSQL / CC-BY) — use freely, incl. commercial + air-gapped. ⚠️ **Copyleft** (AGPL/GPL) — usable but network-copyleft or share-alike obligations; isolate as a separate service. ⚠️ **Source-available / BSL / SSPL** — not OSI-open; time-delayed or use-restricted. ⛔ **Non-commercial (CC-BY-NC / CPML / research-only)** — **cannot ship in the paid product**; needs an open replacement. 🟡 **Custom "open-weight" terms with a Prohibited-Use Policy** (Gemma, Llama Community, Health-AI-Dev-Foundations) — weights are downloadable/self-hostable but carry field-of-use restrictions that a *medical* product must legally review.

---

## 1. General LLMs

| Component | Current / proprietary pick | Best OPEN alternative(s) — Jul 2026 | LICENSE | Maturity / quality gap | Self-host notes | Turkish / multilingual |
|---|---|---|---|---|---|---|
| Patient-turn model (small-open) | Anthropic Haiku 4.5 | **Qwen3-32B** (+ 30B-A3B MoE) | ✅ Apache-2.0 | Production; ample for persona | 1× H100 FP8/INT4, many replicas | Excellent incl. TR; Qwen = strongest open TR |
| Reasoning / grading (large-open) | Sonnet 5 / Opus 4.8 | **Qwen3.5-397B-A17B**; **DeepSeek V4** (Flash/Pro) as peer | ✅ Apache-2.0 (Qwen); ✅ MIT (DeepSeek) | Near-frontier; leads open reasoning | 17B active/token → serves at ~17B cost | Qwen best-in-class multilingual (201 langs), strong TR |
| Guardrail / classifier tier | Flash-Lite / nano | **gpt-oss-20b** (native MXFP4) | ✅ Apache-2.0 | o3-mini-parity; 16 GB | Fits one small GPU/edge | Good |
| Verification / single-card reasoning | — | **gpt-oss-120b** (MoE 5.1B active) | ✅ Apache-2.0 | o4-mini-parity | ONE 80 GB GPU (MXFP4) | Good |
| Long-context / multimodal | — | **Llama 4 Scout/Maverick** | 🟡 Llama 4 Community (≤700M MAU; custom PUP) | Good; TR behind Qwen | Scout 10M ctx | Moderate TR |
| Small TR-native patient actor | — | **Gemma 3** (+ CosmosGemma-9B TR LoRA) | 🟡 Gemma Terms **(⚠ PUP restricts medical/health practice)** — **Gemma 4 = ✅ Apache-2.0** (use G4 to drop the restriction) | Strong TR latent capacity | 9B on modest GPU | Best small-TR fine-tunes are Gemma-based |

**Verdict:** best *permissively-licensed* open family for AcuDx is **Qwen3 / Qwen3.5 (Apache-2.0)** for both patient turns and reasoning/grading, with **DeepSeek V4 (MIT)** and **gpt-oss (Apache-2.0)** as peers. **Avoid depending on Gemma-3-terms or Llama-Community weights as the *default* for a medical product** — their custom Prohibited-Use Policies touch medical/health use (Gemma) or add MAU/derivative clauses (Llama); **Gemma 4's move to Apache-2.0 removes the Gemma restriction** and is the clean choice if a Gemma-lineage model is wanted. ([Gemma Terms + PUP](https://ai.google.dev/gemma/terms), [Gemma 4 → Apache-2.0](https://www.mindstudio.ai/blog/gemma-4-apache-2-license-commercial-use), [TechCrunch on "open" license traps](https://techcrunch.com/2025/03/14/open-ai-model-licenses-often-carry-concerning-restrictions/), [Qwen3-Embedding paper (Apache)](https://arxiv.org/html/2506.05176v1))

---

## 2. Medical models (grader / verifier only — never the patient actor)

| Component | Current pick | Best OPEN alternative(s) | LICENSE | Maturity / quality gap | Self-host notes | TR |
|---|---|---|---|---|---|---|
| Medical verifier (SOTA) | MedGemma 1.5 | **MedGemma** (4B/27B) | 🟡 **Health AI Developer Foundations terms** — ⚠ *not permissive*; outputs "**not intended to directly inform clinical diagnosis/management**", needs validation before deployment | Highest MedQA (~91%) | Self-hostable weights, but **field-of-use review required** | via base |
| Auditable institutional grounding | Meditron 70B | **Meditron 70B** (EPFL/Yale, "fully open") | 🟡 Llama-3.1 Community + **auditable data/pipeline** | Strong; the *auditability* is the trust lever | 70B FP8 | via base |
| Permissive medical fallback | — | **Aloe** family (7B–70B) | ✅/open (base-dependent) | Strong open specialized medical | flexible | via base |
| Deprioritized | OpenBioLLM 70B | — | Llama-3 Community | ~73% MedQA; no data/paper disclosure | — | weak |

**Verdict:** keep the **generate (Qwen, permissive) → verify (MedGemma/Meditron)** pattern from `08`, but note the license asymmetry: **MedGemma's Health-AI-Dev-Foundations terms are restricted and its card explicitly disclaims clinical use** — fine for AcuDx (education-only, human-in-loop, "never sources clinical facts") but it is **not a permissive OSS license**, so for a *maximally-clean sovereign build* prefer **Meditron (auditable, Llama-Community)** or an **Apache/MIT-based medical model**, and treat MedGemma as one verifier in an ensemble rather than the sole gate. All medical models stay **verifiers**, never the persona. ([MedGemma card / HAI-DEF terms](https://huggingface.co/google/medgemma-27b-text-it), [Meditron](https://arxiv.org/pdf/2605.16215v2))

---

## 3. Serving / inference (already fully open)

| Component | Pick | LICENSE | Maturity / quality gap | Self-host notes | Notes |
|---|---|---|---|---|---|
| Default control plane | **vLLM** | ✅ Apache-2.0 | Production default 2026 (v0.21+) | PagedAttention, continuous batching, OpenAI-compat, widest HW | Standard serving layer |
| Patient-persona fleet | **SGLang** | ✅ Apache-2.0 | +~29% at 8B (RadixAttention on shared prefix) | Ideal for the big shared per-case prefix | Prefix-cache win |
| Latency-critical voice turns | **TensorRT-LLM** | ✅ Apache-2.0 | Lowest TTFT/p95 | NVIDIA-only; heavier build | Only where TTFB is felt |
| Edge / CPU / air-gap | **llama.cpp** | ✅ MIT | Mature | GGUF quant, runs anywhere | Fallback / offline |
| Easiest local / dev | **Ollama** | ✅ MIT | Mature | Wraps llama.cpp | Dev + on-prem demos |
| HF-native | ~~TGI~~ | ✅ Apache-2.0 | **In maintenance mode (2026)** — HF now points to vLLM/SGLang/llama.cpp | — | Do not pick for new work |

**Verdict:** no proprietary anywhere — **vLLM standard, SGLang for the patient fleet, TensorRT-LLM only for the voice-coupled path, llama.cpp/Ollama for edge/air-gap.** TGI is deprecated to maintenance; don't build on it. ([inference engine comparison 2026](https://explore.n1n.ai/blog/llm-inference-engine-comparison-vllm-tgi-tensorrt-sglang-2026-03-13))

---

## 4. Embeddings + rerankers (multilingual / Turkish)

| Component | Current / proprietary pick | Best OPEN alternative(s) | LICENSE | Maturity / quality gap | Self-host notes | TR / multilingual |
|---|---|---|---|---|---|---|
| Multilingual embeddings | Voyage / Cohere Embed | **BGE-M3** (dense+sparse+multi-vector) | ✅ Apache-2.0 | Production multilingual RAG workhorse | TEI on GPU; tiny | 100+ langs incl. TR |
| Top-MTEB embeddings | Voyage-3 / Cohere v4 | **Qwen3-Embedding-8B** (0.6/4/8B) | ✅ Apache-2.0 | MTEB leader (~70.6) | TEI/vLLM | 100+ langs incl. TR |
| Alt embeddings | — | **GTE**, **Nomic Embed**, **E5-multilingual** | ✅ Apache-2.0 (GTE/Nomic); ✅ MIT (E5) | Solid | tiny | multilingual |
| Reranker | Cohere Rerank | **bge-reranker-v2-m3** | ✅ Apache-2.0 | Production | TEI | multilingual incl. TR |
| Reranker (SOTA small) | Cohere Rerank | **jina-reranker-v3** (on Qwen3-0.6B) | ✅ open (permissive) | SOTA BEIR (~61.9 nDCG@10), 10× smaller | tiny | multilingual |

**Verdict:** **zero reason to pay Voyage/Cohere.** Default **BGE-M3** (Apache-2.0, dense+sparse+ColBERT in one model → native hybrid) fine-tuned on the guideline corpus; **Qwen3-Embedding-8B** when top MTEB matters; **bge-reranker-v2-m3 / jina-reranker-v3** for rerank. All permissive, all TR-capable, all self-hostable via TEI. ([BentoML embeddings 2026](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models), [Qwen3-Embedding](https://arxiv.org/html/2506.05176v1), [jina-reranker-v3](https://jina.ai/models/jina-reranker-v3/))

---

## 5. Vector DB + hybrid / BM25

| Component | Current pick | OPEN alternative(s) | LICENSE | Maturity / quality gap | Self-host notes | Notes |
|---|---|---|---|---|---|---|
| Vector DB (chosen) | **Qdrant** (arch/08) | Qdrant | ✅ Apache-2.0 | Strongest default for low-latency filtered RAG | Rust; filterable HNSW = filter-before-rank (country filter) | **Keep** |
| Vector-in-Postgres | — | **pgvector** / **VectorChord** | ✅ PostgreSQL license | Best if already on Postgres | one DB, one backup story | Sovereign-friendly (collapses infra) |
| Billion-scale | — | **Milvus** | ✅ Apache-2.0 | Scale leader | heavier ops | if corpus explodes |
| Built-in hybrid | — | **Weaviate** | ✅ BSD-3 | Built-in hybrid + vectorizers | — | alt |
| Embedded / edge | — | **LanceDB** | ✅ Apache-2.0 | In-process, no server | air-gap / on-device | edge |
| BM25 / FTS (chosen) | **Postgres FTS** (arch/08) | Postgres FTS | ✅ PostgreSQL license | Fine for MVP | already present | **Keep** |
| BM25 library | — | **Tantivy** | ✅ MIT | Lucene-class in Rust | embed | if FTS outgrown |
| Search server (BM25+vec) | — | **OpenSearch** | ✅ Apache-2.0 | Full hybrid + vector | JVM; heavier | Elastic-fork, clean license |
| Fast search UX | — | **Meilisearch** (CE) / **Typesense** | ⚠️ Meilisearch CE **MIT** (cloud/enterprise features SSPL-adjacent — use CE); ⚠️ **Typesense GPL-3** (copyleft — isolate as a service) | Great DX | — | instant-search UX only, not the RAG path |

**Verdict:** **keep Qdrant (Apache-2.0) + Postgres FTS** — both already chosen and clean. For a **sovereign/air-gapped single-box** deployment, **pgvector/VectorChord collapses the vector store into the existing Postgres** (one thing to run, back up, and certify). Avoid Typesense in the core path (GPL-3 copyleft); if a Meilisearch is used, pin to the **MIT Community Edition**. ([vector DB benchmarks 2026](https://callsphere.ai/blog/vector-database-benchmarks-2026-pgvector-qdrant-weaviate-milvus-lancedb), [Meilisearch/Typesense/OpenSearch licenses](https://ossalt.com/blog/meilisearch-vs-typesense-vs-elasticsearch-search-2026))

---

## 6. STT (speech-to-text) — streaming + Turkish

| Component | Current / proprietary pick | Best OPEN alternative(s) | LICENSE | Streaming? | Maturity / quality gap | TR / multilingual |
|---|---|---|---|---|---|---|
| Live-loop STT | **Deepgram Flux / Nova-3 Medical** | **NVIDIA Parakeet-tdt-0.6b-v3** | ✅ CC-BY-4.0 | **Yes** (chunked, ~160 ms) | SOTA English/European WER | ⛔ **Turkish NOT covered** (25 European langs, no TR) |
| Live-loop STT (streaming, many langs) | Deepgram Flux | **NVIDIA Nemotron-ASR-Streaming-0.6B** / **Canary** | ✅ CC-BY-4.0 | **Yes** (80 ms–1 s controllable; 240–2400 streams/H100) | Strong; multilingual+translation | Canary = 25 langs; **verify TR presence per checkpoint** |
| **TR + medical default** | Deepgram Nova-3 Turkish | **Whisper large-v3 (+ large-v3-turbo)** + **TR-medical LoRA** | ✅ MIT | Not native-streaming → wrap with **WhisperX / faster-whisper / WhisperLive** | +20–30% non-English; TR WER ~4–14% (LoRA closes it) | **Yes — TR native**; the open TR workhorse |
| Streaming wrappers | — | **faster-whisper** (CTranslate2), **WhisperX**, **WhisperLive** | ✅ MIT (faster-whisper/WhisperLive); ⚠️ **WhisperX BSD-2/-4-clause — check** | Yes (VAD-chunked) | 4–6× faster | inherits Whisper langs |
| On-prem full-duplex STT | Deepgram | **Kyutai STT** (Unmute) | ✅ CC-BY-4.0 | Yes (~500 ms) | Low-latency streaming | multilingual |
| Edge STT | — | **Moonshine** | ✅ MIT | Yes | Tiny, on-device English | EN edge only |

**Verdict:** the open STT default is **Parakeet/Canary/Nemotron-Streaming (CC-BY-4.0) for English + European** (true streaming, best WER), and **Whisper large-v3 + TR-medical LoRA (MIT), wrapped with faster-whisper/WhisperX for streaming, for Turkish** — because **Parakeet v3 does not include Turkish** (confirmed: 25 European languages only). This *fully replaces Deepgram* for a sovereign build; keep **Deepgram Nova-3 Turkish** only as an optional managed fallback where ops burden or p95 forces it. Per-case keyterm/glossary seeding (drug list, ICD terms) applies to the open path too. ([Parakeet-tdt-0.6b-v3 — no Turkish](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [Nemotron-ASR-Streaming](https://blogs.nvidia.com/blog/speech-ai-dataset-models/), [Whisper TR + LoRA](https://www.mdpi.com/2079-9292/13/21/4227), [open STT benchmarks 2026](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks))

---

## 7. TTS (text-to-speech) — Turkish + expressiveness + **license traps**

| Component | Current / proprietary pick | Best OPEN alternative(s) | LICENSE | Maturity / quality gap | TR | Notes |
|---|---|---|---|---|---|---|
| Expressive live TTS (default) | **ElevenLabs / Cartesia** | **Chatterbox (Multilingual v3, Resemble AI)** | ✅ **MIT** | Benchmarked ≈/> ElevenLabs in blind tests; emotion-exaggeration control; **built-in watermark** (helps AI-Act) | ✅ **Turkish supported** (25-lang multilingual, 0.5B Llama backbone) | **New open default** — MIT + TR + expressive |
| Fast/light live TTS | ElevenLabs Flash | **Kokoro** (82M) | ✅ **Apache-2.0** | Fast even on CPU; tiny (327 MB) | limited TR (voice-pack dependent) | ultra-cheap fallback / utility voice |
| Edge / CPU utility voice | — | **Piper** | ✅ **MIT** | Fast, CPU-capable; lower expressiveness | ✅ **TR voices exist** | system prompts, nurse pages, air-gap edge |
| High-naturalness | — | **StyleTTS2** | ✅ **MIT** | High MOS | community TR | permissive expressive option |
| Voice-agent LLM-TTS | Orpheus | **Orpheus 3B** | ✅ Apache-2.0 | Agent-grade; needs ~8–12 GB VRAM | multilingual | GPU-heavier |
| ⚠️ **Do NOT ship (non-commercial)** | (previously **XTTS-v2**) | ~~XTTS-v2 (Coqui)~~ | ⛔ **CPML non-commercial** — **Coqui shut down Jan 2024, so NO commercial license can be bought.** Weights are non-commercial *forever*. | Good TR (17 langs) but **legally unusable in the paid product** | TR yes | **REMOVED as default** — replaces with Chatterbox/Piper |
| ⚠️ **Do NOT ship (non-commercial)** | F5-TTS | ~~F5-TTS weights~~ | ⛔ code MIT but **weights CC-BY-NC-4.0** | High naturalness | community TR | research only unless you retrain weights |
| ⚠️ Flag | Fish/OpenAudio, Sesame CSM | Fish-Speech / OpenAudio, Sesame CSM | ⚠️ **check per-release** (some CC-BY-NC / gated) | strong | varies | verify license before prod |

> **CRITICAL CORRECTION to `08`/`09`:** those docs named **XTTS-v2 as the open TTS default**. **XTTS-v2's weights are CPML (non-commercial), and because Coqui is defunct there is no path to a commercial license — it cannot be the default in a shipping paid product.** The corrected fully-open default is **Chatterbox Multilingual v3 (MIT, Turkish-capable, expressive, watermarked)**, with **Piper (MIT)** for edge/utility and **Kokoro (Apache-2.0)** for ultra-cheap fallback. XTTS-v2/F5-TTS remain usable only for *internal, non-shipping* experiments.

**Verdict:** **Chatterbox v3 (MIT) is the open TTS default** — it is the rare model that is *permissive, multilingual-with-Turkish, expressive, and ships an embedded watermark* (which directly helps the EU AI Act Art. 50 synthetic-audio marking obligation). This *fully replaces ElevenLabs/Cartesia* for a sovereign build; keep them as **optional managed premium** for the very-top TR realism tier only. ([Chatterbox MIT + multilingual v3 + TR](https://www.resemble.ai/resources/chatterbox-multilingual-v3-tts-with-embedded-watermarking-for-25-languages), [Kokoro Apache](https://localaimaster.com/blog/kokoro-tts-local-setup), [TTS license map: XTTS non-commercial, F5 NC, Piper/StyleTTS2 MIT, Kokoro Apache](https://www.promptquorum.com/power-local-llm/local-tts-voice-cloning-piper-coqui-xtts))

---

## 8. Full-duplex / turn-taking / voice-agent orchestration

| Component | Current / proprietary pick | Best OPEN alternative(s) | LICENSE | Maturity / quality gap | TR | Notes |
|---|---|---|---|---|---|---|
| Orchestration (chosen) | **LiveKit Agents** (arch/03) | LiveKit Agents (open-core self-host) | ✅ Apache-2.0 (SDK/server open-core) | Room-first WebRTC; fits multiplayer | — | **Keep** — self-hostable, no per-min fee on your own infra |
| Pipeline orchestration | Pipecat Cloud | **Pipecat** (self-host) | ✅ BSD-2 | Mature single-agent pipelines | — | solo-vs-AI path |
| Turn detection / VAD | — | **Silero VAD** + **Pipecat Smart-Turn v3** / **LiveKit turn-detector** | ✅ MIT | Model-based EoT, open | — | per-persona EoT knobs stay open |
| Native S2S (on-prem "cinematic") | Gemini Live / OpenAI Realtime | **Kyutai Moshi + Mimi codec** | ✅ **CC-BY-4.0** | ~200 ms full-duplex; **full control (bring any LLM)** | multilingual (verify TR) | on-prem S2S floor |
| S2S with any LLM | — | **Ultravox** (v0.6/0.7 on Qwen3) | ✅ **MIT** | Audio-in → text, bring-your-own-LLM | inherits Qwen (TR strong) | clean MIT S2S front-end |
| Omni S2S | — | **Qwen3-Omni-30B-A3B** | ✅ Apache-2.0 | Real-time streaming S2S | ⚠️ **TR speech-IN yes, TR speech-OUT NO** (10 output langs, no TR) | for TR, use cascade for output |

**Verdict:** the **composable cascade (STT→LLM→TTS) stays the default** (auditability, grounding, per-case routing — unchanged from `02`), and it is now **100% open**: open STT (§6) + open LLM (§1) + open TTS (§7), orchestrated by **self-hosted LiveKit Agents (Apache-2.0)**. For an on-prem "cinematic" native-S2S option, **Moshi (CC-BY) or Ultravox (MIT)** replace Gemini Live/OpenAI Realtime. **Important TR constraint:** **Qwen3-Omni cannot emit Turkish speech** — so a fully-open *Turkish* voice patient must use the **cascade with Chatterbox/Whisper**, not an omni-S2S model. ([Moshi/Mimi CC-BY](https://github.com/kyutai-labs/moshi), [Ultravox MIT](https://github.com/fixie-ai/ultravox/blob/main/LICENSE), [Qwen3-Omni Apache, TR-in-not-out](https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Instruct))

---

## 9. Avatars — the OPEN path (this REPLACES Anam/Tavus for a fully-open build)

| Tier | Current / proprietary pick | Best OPEN alternative(s) | LICENSE | Maturity / quality gap | Self-host notes | Notes |
|---|---|---|---|---|---|---|
| 2D physiology portrait (T0, chosen) | — (in-house) | client SVG/CSS/canvas | ✅ your code | Ships now | ~$0, client | Owns the clinical-sign channel |
| 2D neural real-time talking-head | **Anam CARA-3 / Tavus Phoenix-4** | **LivePortrait** (+ **MuseTalk** for lip-sync) | ✅ **MIT** (both) | Real-time portrait animation + 30fps lip-sync; ONNX/CoreML ports exist | 1 GPU or on-device | **The open replacement for streaming vendors** |
| 2D audio-driven (upper body) | HeyGen | **EchoMimic (v2)** | ✅ open (Apache/MIT-class — verify per repo) | Half/upper-body, stable lip-sync | GPU | richer motion |
| 2D long-form portrait | Tavus | **Hallo2 / Hallo3**, **SadTalker**, **Wav2Lip** | ⚠️ **verify per repo** (Wav2Lip weights research-only historically; SadTalker Apache; Hallo Apache-ish) | Long-duration, hi-res | GPU | check license before prod |
| 3D lip-sync (chosen path) | — | **NVIDIA Audio2Face-3D** | ✅ open model / permissive SDK | Audio→ARKit-52 blendshapes; composes with sign overlay | self-host | **Keep** (arch/04) |
| 3D scene / rig | — | **Three.js + R3F**; **Ready Player Me / Avaturn** rigs | ✅ MIT (Three/R3F); RPM/Avaturn = free SDK, ⚠️ hosted-avatar ToS — self-host GLB where possible | Mature | client GPU, ~$0 | ARKit-52 interchange |
| 3D photoreal frontier | Tavus Phoenix (Gaussian) | **GaussianTalker**, **TaoAvatar**, **TeGA**, **Universal GHA** | ⚠️ mostly **research/CC-BY-NC or unspecified** — verify | Realism frontier | client/edge GPU | T3 research tier only until license-clear |
| Image→3D head (generated patient) | Tavus image-to-replica | **TripoSG / TripoSR** | ⚠️ TripoSR **MIT**; TripoSG **verify** | single-image → 3D mesh | GPU | feeds the generated-face path |

**Verdict — explicit:** for a **fully-open build, the avatar streaming tier is LivePortrait + MuseTalk (both MIT) driving the generated patient face, plus Audio2Face-3D + R3F/RPM for the client-3D tier** — this **replaces Anam CARA-3 and Tavus Phoenix-4 entirely**. Anam (HIPAA/SOC-2) and Tavus (image-to-replica) survive **only as optional premium** for institutions that want a vendor SLA; every generated case face can instead be animated **in-house** with LivePortrait/MuseTalk at ~$0 marginal on client/edge GPU. The **clinical-sign shader channel stays client-controlled** regardless of renderer (no streaming vendor can shade cyanosis@SpO2 — the medical differentiator, unchanged from `10`). ⚠️ The **Gaussian-splat frontier models are mostly research-/NC-licensed** — keep them in the T3 research tier until a permissive release lands. ([LivePortrait + MuseTalk MIT](https://lipsync.com/blog/open-source-lip-sync), [open lip-sync 2026](https://www.pixazo.ai/blog/best-open-source-lip-sync-models))

---

## 10. Image-gen for patient faces (replaces Tavus image-to-replica, license-flagged)

| Component | Current / proprietary pick | Best OPEN alternative(s) | LICENSE | Maturity / quality gap | Notes |
|---|---|---|---|---|---|
| Base image model (commercial-clean) | Tavus / hosted gen | **Qwen-Image** | ✅ **Apache-2.0** | Top-tier local gen; commercial output OK | **Default** — output is unambiguously yours |
| Fast base model | — | **FLUX.1-schnell** (+ **FLUX.2-klein 4B**) | ✅ **Apache-2.0** | Fast, high quality | commercial output OK |
| High-quality base | FLUX.1-dev | ⚠️ **FLUX.1-dev / FLUX.2-dev** | ⛔ **Non-commercial output unless you buy a BFL license** | Best quality | **Do NOT ship output** without the paid BFL license → prefer Qwen-Image/schnell |
| Alt base | — | **Stable Diffusion 3.5** | ⚠️ **Stability Community License** (free < $1M rev; else paid) | Mid | check revenue threshold |
| Identity-consistent face | InstantID | **PuLID** / **PhotoMaker-V2** | ✅ **Apache-2.0** (both) | Consistent ID across seeds | **Default for stable per-case face** |
| ⚠️ Identity (encoder trap) | InstantID | InstantID | ⚠️ code **Apache-2.0** but **InsightFace/AntelopeV2 encoder = non-commercial research-only** | Strong ID | ⛔ **encoder blocks commercial** → prefer **PuLID/PhotoMaker** |

**Verdict:** the **generated-patient-face path is fully open and commercially clean with Qwen-Image or FLUX.1-schnell (both Apache-2.0) + PuLID or PhotoMaker-V2 (both Apache-2.0)** for identity-consistent, seed-stable faces per `caseInstanceId`. **Avoid FLUX.1-dev output (non-commercial without BFL license) and InstantID (its face encoder is non-commercial-only)** — both are real, easy-to-miss traps. Every face is **C2PA-marked + "synthetic patient" labeled + diversity-audited** (unchanged from `10`). ([FLUX-dev non-commercial vs schnell/klein Apache](https://botmonster.com/ai/best-local-image-generation-models-2026/), [Qwen-Image Apache](https://localaimaster.com/blog/best-local-image-models-compared), [PuLID/PhotoMaker Apache; InstantID encoder NC](https://huggingface.co/TencentARC/PhotoMaker-V2/blob/main/README.md))

---

## 11. Realtime transport

| Component | Chosen pick | OPEN alternative(s) | LICENSE | Maturity | Notes |
|---|---|---|---|---|---|
| WebRTC SFU (chosen) | **LiveKit** (arch/10) | LiveKit open-core self-host | ✅ Apache-2.0 (server + SDKs) | Production | **Keep** — self-host removes the $0.0005/min fee; sovereign-capable |
| Alt SFU (library) | — | **mediasoup** | ✅ ISC | Production | lower-level, more control |
| Alt gateway | — | **Janus** | ✅ GPL-3 (⚠️ copyleft — isolate as a service) | Mature | plugin gateway |
| Turnkey conferencing | — | **Jitsi** | ✅ Apache-2.0 | Mature | if a full meeting stack is wanted |

**Verdict:** **keep self-hosted LiveKit (Apache-2.0)** — it is already the choice and is fully open when self-hosted; mediasoup (ISC) is the permissive fallback. Avoid Janus in a permissive product unless isolated (GPL-3). ([LiveKit is used in arch/03, arch/07, arch/10])

---

## 12. FHIR / EHR (all permissive — pick by language)

| Component | OPEN alternative(s) | LICENSE | Maturity / quality gap | Notes |
|---|---|---|---|---|
| FHIR platform (TS-native) | **Medplum** | ✅ **Apache-2.0** | Production; batteries-included (auth, subscriptions, bots) | **Default** — TS matches the stack; whole-platform open |
| FHIR server (Java) | **HAPI FHIR** | ✅ **Apache-2.0** | The reference Java FHIR server | if JVM shop |
| FHIR store (fast) | **Blaze** | ✅ **Apache-2.0** | Clojure; high-performance FHIR store | scale |
| EHR (clinical) | **OpenMRS O3**, **OpenEMR**, **Bahmni** | ✅ MPL-2.0 (OpenMRS); GPL (OpenEMR — ⚠️ copyleft); combo (Bahmni) | Mature EHRs | only if a real EHR is needed |

**Verdict:** AcuDx uses **synthetic cases**, so a full FHIR server is optional — but where case-authoring or institutional EHR-interop wants FHIR, **Medplum (Apache-2.0)** is the clean default (TS-native, whole platform open). No proprietary EHR is required anywhere. ([Medplum/HAPI/Blaze all Apache-2.0](https://darrendevitt.com/the-6-open-source-fhir-servers/))

---

## 13. Auth / SSO / SCIM + LTI + open LMS

| Component | Current / proprietary pick | Best OPEN alternative(s) | LICENSE | Maturity / quality gap | Notes |
|---|---|---|---|---|---|
| IdP / SSO / SAML+OIDC (default) | **Auth0 / Okta** | **Keycloak** | ✅ **Apache-2.0** | Largest OSS identity ecosystem; SAML IdP+SP, OIDC, LDAP/AD federation | **Default** — permissive, battle-tested; SCIM via community ext |
| IdP with first-party SCIM | Auth0 | **Authentik** | ✅ **MIT** core (enterprise features separate) | Cleaner first-party SCIM; good DX | if SCIM is mission-critical |
| IdP (modern) | Auth0 | ⚠️ **Zitadel** | ⚠️ **AGPL-3.0 since v3 (2025)** — network-copyleft; SDKs Apache/MIT carve-outs; commercial license available | Modern, multi-tenant | **flag AGPL** — usable self-hosted but review copyleft; not the default |
| Auth building blocks | Auth0 | **Ory** (Kratos/Hydra) / **SuperTokens** | ✅ Apache-2.0 (both) | Composable | if building bespoke |
| LTI 1.3 Advantage | (commercial LTI libs) | **ltijs** | ✅ Apache-2.0 | LTI 1.3 core + Advantage | the open LTI tool library |
| LMS (interop targets) | Canvas (proprietary) | **Moodle**, **Open edX** | ⚠️ Moodle **GPL-3**; Open edX **AGPL-3** (⚠️ copyleft — but these are *integration targets*, not linked code) | Mature | AcuDx integrates via LTI, doesn't embed them → copyleft doesn't reach AcuDx |

**Verdict:** **Keycloak (Apache-2.0) is the open default IdP**, replacing Auth0 — it covers SAML/OIDC/LDAP and the LTI 1.3 / SCIM / OneRoster identity-mapping surface from `arch/08` §7. **Authentik (MIT)** if first-party SCIM is decisive. ⚠️ **Zitadel moved to AGPL-3.0 in 2025** — usable but adds network-copyleft review, so it's *not* the default. LTI via **ltijs (Apache-2.0)**. Moodle/Open edX are copyleft but only *integration targets* (LTI), so their GPL/AGPL never reaches AcuDx's code. ([Keycloak/Ory/SuperTokens Apache, Authentik MIT, Zitadel→AGPL-3](https://www.cerbos.dev/blog/best-open-source-auth-tools-and-software-for-enterprises-2026))

---

## 14. Data plane (already almost entirely open — one swap)

| Component | Current pick | OPEN alternative / status | LICENSE | Notes |
|---|---|---|---|---|
| Relational + FTS + (vector) | **PostgreSQL 16** (arch/08) | Postgres | ✅ **PostgreSQL license** | **Keep** — source of truth, event log, FTS, pgvector-capable |
| Cache / hot state | ~~Redis 7~~ (arch/08) | ⚠️ **Redis relicensed** (SSPL/RSAL; then re-added AGPL May 2025) → **use Valkey** | ✅ **BSD-3 (Valkey, Linux Foundation)** | **SWAP Redis → Valkey** for a clean permissive license; drop-in |
| Event bus (MVP→scale) | Redis Streams → NATS/Kafka (arch/08) | **NATS** (JetStream); **Apache Kafka**; ⚠️ **Redpanda** | ✅ Apache-2.0 (NATS, Kafka); ⚠️ **Redpanda = BSL source-available** (converts to Apache after 4 yrs) | Prefer **NATS/Kafka (Apache)**; if Redpanda, note BSL |
| Analytics warehouse | **ClickHouse** (arch/08) | ClickHouse | ✅ **Apache-2.0** | **Keep** |
| Object storage | — | **MinIO**, **SeaweedFS** | ⚠️ MinIO **AGPL-3.0** (isolate as a service — it's an S3 API server, not linked code); ✅ SeaweedFS **Apache-2.0** | S3-compatible; SeaweedFS if AGPL is unwanted |
| IaC | Terraform | **OpenTofu** | ✅ **MPL-2.0** | **Use OpenTofu** — Terraform went BSL; OpenTofu is the open fork (Linux Foundation) |
| Orchestration | — | **Kubernetes** | ✅ Apache-2.0 | standard |

**Verdict:** the data plane is essentially open already; the two hygiene swaps for a *maximally-clean* build are **Redis → Valkey (BSD-3)** and **Terraform → OpenTofu (MPL-2.0)** (both because the originals relicensed to non-open BSL/SSPL). Event bus stays **NATS/Kafka (Apache)**; object storage **SeaweedFS (Apache)** or **MinIO (AGPL, run as an isolated S3 service)**. ([Valkey/OpenTofu at Linux Foundation; Redis/Terraform relicensing](https://www.flowverify.co/blog/open-source-relicensing-2026-what-happened), [Redpanda BSL](https://github.com/redpanda-data/redpanda/blob/dev/licenses/bsl.md))

---

## 15. Analytics / LRS (open standards + open stores)

| Component | Current pick | OPEN alternative(s) | LICENSE | Notes |
|---|---|---|---|---|
| LRS (xAPI store) | (institution's LRS) | **Yet Analytics SQL-LRS** | ✅ **Apache-2.0** | **Default open LRS** — SQL-based (SQLite/Postgres), ADL-conformant, 100+ releases |
| LRS (alt) | — | **Learning Locker** (Learning Pool), **Veracity Learning** | ⚠️ Learning Locker **GPL-3** (community); Veracity free tier (verify license) | alternatives |
| Standards | Caliper 1.2 / xAPI (arch/10) | Caliper / xAPI | ✅ open specs (1EdTech / ADL) | **Keep** — emission unchanged |
| Dashboards / BI | — | **Metabase**, **Apache Superset** | ⚠️ Metabase **AGPL-3 (community)**; ✅ Superset **Apache-2.0** | **Prefer Superset (Apache)** for embedding; Metabase (AGPL) as standalone service |

**Verdict:** the **Caliper/xAPI emission (arch/10) stays**, now paired with an **open LRS (SQL-LRS, Apache-2.0)** so an institution without its own LRS still gets a fully-open analytics sink; **Apache Superset** is the clean embeddable BI (avoid Metabase's AGPL unless run standalone). ([SQL-LRS Apache-2.0](https://www.yetanalytics.com/sql-lrs))

---

## 16. LLM observability + eval + guardrails + PII/PHI

| Component | Current / proprietary pick | Best OPEN alternative(s) | LICENSE | Notes |
|---|---|---|---|---|
| Observability / tracing | Datadog LLM / LangSmith | **Langfuse** | ✅ **MIT** (core) | **Default** — tracing, prompt mgmt, evals, datasets; OTel-native |
| Observability (alt) | — | ⚠️ **Arize Phoenix** | ⚠️ **Elastic-2.0 (ELv2)** — source-available, not OSI-open | usable self-host; note ELv2 |
| Instrumentation | — | **OpenLLMetry** (Traceloop) | ✅ Apache-2.0 | vendor-neutral OTel for LLMs |
| Eval (RAG/faithfulness) | — | **Ragas**, **DeepEval**, **promptfoo** | ✅ Apache-2.0 (Ragas/promptfoo); ✅ Apache-2.0 (DeepEval) | CI eval gate (arch/09 pre-promotion evals) |
| Eval (bias/robustness) | — | **Giskard** | ✅ Apache-2.0 | fairness/robustness scans |
| Guardrails | — | **NeMo Guardrails**, **Guardrails AI** | ✅ Apache-2.0 (both) | programmable + validators; pairs with gpt-oss-20b classifier |
| **PII / PHI detection** | — | **Microsoft Presidio** (+ **medspaCy/spaCy**) | ✅ **MIT** (Presidio); ✅ MIT/permissive (spaCy) | **The PHI-Interceptor engine** (arch/09) — detect-and-block real PHI, de-identify |

**Verdict:** **entirely open and permissive** — **Langfuse (MIT)** for observability, **Ragas/DeepEval/promptfoo/Giskard (Apache)** for the CI eval gate, **NeMo Guardrails + Guardrails AI (Apache)** for programmable guardrails, and **Presidio (MIT) + medspaCy** as the PHI-Interceptor. Only ⚠️ Arize Phoenix (ELv2) and standalone Metabase (AGPL) are non-permissive — both avoidable. ([Langfuse MIT](https://github.com/langfuse/langfuse), [Presidio MIT](https://github.com/microsoft/presidio), [NeMo Guardrails / Guardrails AI Apache](https://github.com/NVIDIA-NeMo/Guardrails))

---

## 17. Spaced repetition, gamification, provenance

| Component | OPEN pick | LICENSE | Notes |
|---|---|---|---|
| Spaced repetition | **ts-fsrs** (FSRS) | ✅ **MIT** | Runtime FSRS scheduler for knowledge-gap cards (arch/08 `SRSCard`) |
| Gamification | in-house (XP/mastery/streaks) | ✅ your code | No vendor; RCT-informed design already open |
| Content provenance (C2PA) | **c2pa-rs** | ✅ **Apache-2.0 + MIT** (dual) | Signs synthetic audio/video/image manifests (AI-Act Art. 50; arch/09 §7) — fully open tooling |

**Verdict:** all three are permissive open — **ts-fsrs (MIT)**, in-house gamification, **c2pa-rs (Apache/MIT)** for the Art. 50 marking. No proprietary anywhere. ([ts-fsrs MIT](https://github.com/open-spaced-repetition/ts-fsrs), [c2pa-rs Apache+MIT](https://github.com/contentauth/c2pa-rs))

---

## 18. Frontend (already fully open — confirmation)

**Vite (MIT) · React (MIT) · TailwindCSS (MIT) · Radix UI (MIT) · i18next/react-intl (MIT) · Three.js + React-Three-Fiber (MIT).** ICU MessageFormat is an open standard. Nothing proprietary; nothing to swap. (arch/11, `09` §6)

---

## (A) Fully sovereign / air-gapped deployment

**Claim:** AcuDx can be delivered as a **single self-hostable appliance a Turkish ministry (Sağlık Bakanlığı / KVKK) or a privacy-max school runs entirely on-prem, with ZERO third-party data egress.** The all-open reference stack:

| Layer | Sovereign/air-gapped pick (all self-hosted, permissive) |
|---|---|
| LLMs | **Qwen3-32B** (patient) + **Qwen3.5-397B** (grading) + **gpt-oss-20b** (guardrail), all Apache-2.0, on **vLLM/SGLang** |
| Medical verify | **Meditron 70B** (auditable, Llama-Community) — preferred over MedGemma for a maximally-clean sovereign build; MedGemma optional as one ensemble verifier |
| Embeddings/rerank | **BGE-M3** + **bge-reranker-v2-m3** (Apache), TEI |
| Vector + BM25 | **Qdrant** (Apache) or **pgvector/VectorChord** (collapses into Postgres) + **Postgres FTS** |
| STT | **Whisper large-v3 + TR-medical LoRA** (MIT) via **faster-whisper**; Parakeet/Canary (CC-BY) for EN/EU |
| TTS | **Chatterbox v3** (MIT, TR, watermarked) + **Piper** (MIT, edge) |
| Voice orchestration | **LiveKit Agents** self-host (Apache) + **Silero VAD** (MIT); on-prem S2S option **Moshi**/**Ultravox** |
| Avatars | **2D physiology portrait** (in-house) + **LivePortrait/MuseTalk** (MIT) + **Audio2Face-3D** + **R3F** — **no Anam/Tavus** |
| Image-gen faces | **Qwen-Image** (Apache) + **PuLID/PhotoMaker** (Apache) — **no FLUX-dev, no InstantID-encoder** |
| Transport | **LiveKit** self-host (Apache) / **mediasoup** (ISC) |
| Identity | **Keycloak** (Apache) SAML/OIDC/SCIM + **ltijs** (Apache) LTI 1.3 |
| Data plane | **Postgres** + **Valkey** (BSD) + **NATS/Kafka** (Apache) + **ClickHouse** (Apache) + **SeaweedFS** (Apache) + **OpenTofu** (MPL) + **Kubernetes** |
| Analytics/LRS | **SQL-LRS** (Apache) + **Superset** (Apache) + Caliper/xAPI |
| Obs/eval/guardrail/PHI | **Langfuse** (MIT) + **Ragas/DeepEval/Giskard** (Apache) + **NeMo/Guardrails AI** (Apache) + **Presidio** (MIT) |
| Provenance | **c2pa-rs** (Apache/MIT) |

**What is lost going fully air-gapped (be honest):**
- **Top-end voice/avatar realism.** Chatterbox/LivePortrait are excellent but the very-best TR emotional realism (ElevenLabs v3) and vendor-SLA photoreal (Anam/Tavus) are a notch above at the extreme. Acceptable for education; offer them as *optional premium* to non-air-gapped tenants.
- **The rare frontier-reasoning escalation** (hardest contested grading, ~<5% of tokens) — an air-gapped tenant loses the Opus-4.8 safety net and relies on the large-open + Meditron ensemble. Mitigate with the generate-then-verify ensemble and human co-sign on high-stakes.
- **MedGemma's SOTA MedQA** if the tenant declines the Health-AI-Dev-Foundations terms — Meditron/Aloe cover it with a small quality trade.
- **Managed convenience** (Deepgram/Cartesia ops, vendor uptime SLAs) — replaced by your own MLOps/GPU on-call. This is the real cost (see B).
- **No functional capability is lost** — every layer has a working open path. What's traded is *last-mile polish + ops-outsourcing*, not *capability*.

**Turkish note:** the sovereign stack is fully TR-capable **except** that a Turkish *native-S2S* model doesn't exist open (Qwen3-Omni can't emit TR speech) — so TR voice uses the **cascade** (Whisper-TR → Qwen3 → Chatterbox-TR), which is the default anyway.

---

## (B) All-open COGS (voice + avatars now also self-hosted)

`08` already put the **open-first-LLM** per-encounter cost at **~$0.05–0.08** (vs ~$0.43 optimized-API, ~$6.30 naïve). Making **voice and avatars also open/self-hosted** changes the *voice and avatar* lines, not the LLM lines:

| Component | Prior (open LLM, **managed** voice/avatar) | **All-open (self-hosted voice + avatar)** |
|---|---|---|
| LLM (patient + grading + guardrail + verify) | ~$0.03–0.05 | ~$0.03–0.05 (unchanged) |
| **Voice STT+TTS** (12–15 min) | managed ~$0.05–0.09/min → **~$0.60–1.35/encounter** | **Whisper + Chatterbox self-hosted → ~$0.05–0.15/encounter** (GPU-time only, batched, high-util) |
| **Avatar** (if T2 streaming) | Anam/Tavus **$0.11–0.37/min → $1.30–5.50/encounter** | **LivePortrait/MuseTalk on shared GPU → ~$0.02–0.10/encounter**, or **$0** for 2D/client-3D |
| Embeddings/rerank | self-host, negligible | self-host, negligible |
| **Total / voice+avatar encounter** | **~$1–7** (voice/avatar dominate) | **~$0.10–0.30** |

**The GPU/ops trade-off (the catch):**
- Self-hosting voice+avatar **collapses per-minute vendor fees to ~$0 marginal**, but adds a **fixed GPU fleet + MLOps burden**: STT/TTS/avatar models want their own GPU capacity (a 12-min voice+avatar encounter is far more GPU-intensive than a text turn). **Utilization is again the #1 lever** — an idle avatar GPU inflates $/encounter fast.
- **Break-even is higher than for text-only.** Text LLM self-host breaks even ~≥500K tok/day; **voice+avatar self-host breaks even at a higher sustained concurrency** (you must keep STT/TTS/lip-sync GPUs busy). Below that, managed voice/avatar (Deepgram/Anam) is still cheaper per encounter.
- **Net:** at AcuDx target scale, an **all-open stack pushes the fully-loaded voice+avatar encounter from ~$1–7 (managed) to ~$0.10–0.30 (self-hosted)** — a **~5–20× voice/avatar saving on top of the LLM saving** — but converts a *variable per-minute cost* into a *fixed GPU+ops cost*. The right move: **all-open for high-volume institutions and every air-gapped/sovereign tenant; managed voice/avatar for low-volume tenants and the top-realism premium tier**, exactly mirroring the text-LLM break-even logic in `08`.

---

## Key decisions for AcuDx

**Per-layer DEFAULT-OPEN pick (the map):**

| Layer | DEFAULT-OPEN pick (license) |
|---|---|
| General LLM | **Qwen3-32B / Qwen3.5-397B** (Apache-2.0); DeepSeek V4 (MIT), gpt-oss (Apache) peers |
| Medical verifier | **Meditron 70B** (auditable) primary for sovereign; MedGemma optional (⚠ HAI-DEF terms) |
| Serving | **vLLM** (Apache) + **SGLang** (Apache); llama.cpp/Ollama (MIT) edge |
| Embeddings/rerank | **BGE-M3** + **bge-reranker-v2-m3** (Apache) |
| Vector + BM25 | **Qdrant** (Apache) / **pgvector** + **Postgres FTS** |
| STT | **Whisper-v3 + TR-LoRA** (MIT) for TR; **Parakeet/Canary** (CC-BY) for EN/EU |
| TTS | **Chatterbox v3** (MIT) + **Piper** (MIT) + **Kokoro** (Apache) — **NOT XTTS/F5 (non-commercial)** |
| Voice orchestration | **LiveKit Agents** self-host (Apache) + **Silero VAD** (MIT) |
| Avatars | **LivePortrait + MuseTalk** (MIT) + **Audio2Face-3D** + **R3F** — replaces Anam/Tavus |
| Image-gen faces | **Qwen-Image / FLUX-schnell** (Apache) + **PuLID/PhotoMaker** (Apache) — **NOT FLUX-dev / InstantID-encoder** |
| Transport | **LiveKit** self-host (Apache) / mediasoup (ISC) |
| FHIR | **Medplum** (Apache) |
| Auth/LTI | **Keycloak** (Apache) + **ltijs** (Apache); Authentik (MIT) for SCIM |
| Data plane | **Postgres** + **Valkey** (BSD) + **NATS/Kafka** (Apache) + **ClickHouse** (Apache) + **SeaweedFS** (Apache) + **OpenTofu** (MPL) |
| Analytics/LRS | **SQL-LRS** (Apache) + **Superset** (Apache) |
| Obs/eval/guardrail/PHI | **Langfuse** (MIT) + Ragas/DeepEval/Giskard (Apache) + NeMo/Guardrails AI (Apache) + **Presidio** (MIT) |
| Spaced-rep / provenance | **ts-fsrs** (MIT) + **c2pa-rs** (Apache/MIT) |
| Frontend | Vite/React/Tailwind/Radix/i18next/Three.js (all MIT) |

**⚠ License corrections to earlier docs (act on these):**
1. **XTTS-v2 is NOT a shippable default** (CPML non-commercial, Coqui defunct) → **swap to Chatterbox v3 (MIT)** in `08`/`09` recommendations.
2. **F5-TTS weights are CC-BY-NC** (code MIT ≠ weights) → internal-only.
3. **InstantID's face encoder (AntelopeV2) is non-commercial** → use **PuLID/PhotoMaker** (Apache) instead.
4. **FLUX.1-dev output is non-commercial** without a BFL license → use **Qwen-Image / FLUX-schnell** (Apache).
5. **Gemma-3 terms carry a medical Prohibited-Use Policy**; **MedGemma is Health-AI-Dev-Foundations-restricted** → prefer **Qwen (Apache)** as the default family and **Meditron** as the sovereign medical verifier; use **Gemma 4 (Apache-2.0)** if a Gemma-lineage model is wanted.
6. **Parakeet v3 has no Turkish** → TR STT must use **Whisper+LoRA**, not Parakeet.
7. **Qwen3-Omni cannot emit Turkish speech** → TR voice patient must use the **cascade**, not omni-S2S.
8. **Redis → Valkey** and **Terraform → OpenTofu** (originals relicensed off-open); **Zitadel is now AGPL** (not the default IdP).

**Components worth keeping a PROPRIETARY option as OPTIONAL premium (each with its open fallback):**

| Layer | Optional premium (why) | Open fallback (the default) |
|---|---|---|
| Frontier reasoning | **Opus 4.8 (Batch)** — hardest contested grading, ~<5% tokens | **Qwen3.5-397B + Meditron ensemble** |
| Top TR emotional TTS | **ElevenLabs Turkish (v3)** — cinematic distress peaks | **Chatterbox v3 (MIT)** live + cached |
| Vendor-SLA photoreal avatar | **Anam CARA-3** (HIPAA/SOC-2) / **Tavus Phoenix-4** (image-to-replica) | **LivePortrait + MuseTalk (MIT)** on your GPU |
| Managed STT convenience | **Deepgram Nova-3 Turkish** (ops-outsourced streaming) | **Whisper-v3 + TR-LoRA (MIT)** self-host |
| Managed S2S "cinematic" | **Gemini Live** | **Moshi / Ultravox** self-host |

**Bottom line:** **every layer has a permissive-open default** — AcuDx is buildable end-to-end on open source, air-gappable for a Turkish ministry or privacy-max school with **zero third-party data egress**, at **~$0.10–0.30 all-open per voice+avatar encounter** vs ~$1–7 managed. Proprietary vendors are demoted to **optional premium with a named open fallback**, never a dependency. The license discipline is real: **flag and avoid the non-commercial traps (XTTS/F5/InstantID-encoder/FLUX-dev), the AGPL/BSL relicensings (Zitadel/Redis/Terraform/Redpanda/MinIO/Metabase), and the medical Prohibited-Use terms (Gemma-3/MedGemma)** — the DEFAULT-OPEN column above is chosen to be commercially and clinically clean.

---

### Sources

- **LLMs/licenses:** [Gemma Terms + PUP](https://ai.google.dev/gemma/terms) · [Gemma 4 → Apache-2.0](https://www.mindstudio.ai/blog/what-is-gemma-4-apache-2-license-commercial-ai-deployment) · ["open" license traps](https://techcrunch.com/2025/03/14/open-ai-model-licenses-often-carry-concerning-restrictions/) · [MedGemma HAI-DEF terms](https://huggingface.co/google/medgemma-27b-text-it)
- **Serving:** [inference engines 2026](https://explore.n1n.ai/blog/llm-inference-engine-comparison-vllm-tgi-tensorrt-sglang-2026-03-13)
- **Embeddings/rerank:** [BentoML 2026](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models) · [Qwen3-Embedding (Apache)](https://arxiv.org/html/2506.05176v1) · [jina-reranker-v3](https://jina.ai/models/jina-reranker-v3/)
- **Vector/BM25:** [VDB benchmarks 2026](https://callsphere.ai/blog/vector-database-benchmarks-2026-pgvector-qdrant-weaviate-milvus-lancedb) · [Meilisearch/Typesense/OpenSearch licenses](https://ossalt.com/blog/meilisearch-vs-typesense-vs-elasticsearch-search-2026)
- **STT:** [Parakeet-tdt-0.6b-v3 (no Turkish)](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) · [NVIDIA multilingual speech models](https://blogs.nvidia.com/blog/speech-ai-dataset-models/) · [Whisper TR + LoRA](https://www.mdpi.com/2079-9292/13/21/4227) · [open STT 2026](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)
- **TTS:** [Chatterbox Multilingual v3 (MIT, TR, watermark)](https://www.resemble.ai/resources/chatterbox-multilingual-v3-tts-with-embedded-watermarking-for-25-languages) · [Kokoro (Apache)](https://localaimaster.com/blog/kokoro-tts-local-setup) · [TTS license map (XTTS/F5 non-commercial; Piper/StyleTTS2 MIT; Kokoro Apache)](https://www.promptquorum.com/power-local-llm/local-tts-voice-cloning-piper-coqui-xtts)
- **S2S:** [Moshi/Mimi (CC-BY)](https://github.com/kyutai-labs/moshi) · [Ultravox (MIT)](https://github.com/fixie-ai/ultravox/blob/main/LICENSE) · [Qwen3-Omni (Apache; TR-in-not-out)](https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Instruct)
- **Avatars/image-gen:** [LivePortrait+MuseTalk (MIT)](https://lipsync.com/blog/open-source-lip-sync) · [open lip-sync 2026](https://www.pixazo.ai/blog/best-open-source-lip-sync-models) · [FLUX-dev NC vs schnell/klein Apache](https://botmonster.com/ai/best-local-image-generation-models-2026/) · [Qwen-Image Apache](https://localaimaster.com/blog/best-local-image-models-compared) · [PuLID/PhotoMaker Apache; InstantID encoder NC](https://huggingface.co/TencentARC/PhotoMaker-V2/blob/main/README.md)
- **FHIR/auth:** [Medplum/HAPI/Blaze Apache](https://darrendevitt.com/the-6-open-source-fhir-servers/) · [Keycloak/Authentik/Zitadel(→AGPL)/Ory/SuperTokens](https://www.cerbos.dev/blog/best-open-source-auth-tools-and-software-for-enterprises-2026)
- **Data plane:** [Valkey/OpenTofu at LF; Redis/Terraform relicensing 2026](https://www.flowverify.co/blog/open-source-relicensing-2026-what-happened) · [Redpanda BSL](https://github.com/redpanda-data/redpanda/blob/dev/licenses/bsl.md)
- **Analytics/obs/guardrails/PHI:** [SQL-LRS (Apache)](https://www.yetanalytics.com/sql-lrs) · [Langfuse (MIT)](https://github.com/langfuse/langfuse) · [Presidio (MIT)](https://github.com/microsoft/presidio) · [NeMo/Guardrails AI (Apache)](https://github.com/NVIDIA-NeMo/Guardrails)
- **Spaced-rep/provenance:** [ts-fsrs (MIT)](https://github.com/open-spaced-repetition/ts-fsrs) · [c2pa-rs (Apache+MIT)](https://github.com/contentauth/c2pa-rs)
