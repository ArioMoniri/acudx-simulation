# 02 — Realtime Voice AI Stack (July 2026)

Spoken clinical roleplay for AcuDx. The learner talks to a simulated patient (or nurse, dispatcher, senior colleague) and gets back naturalistic, interruptible, emotionally-appropriate speech, in the learner's language and accent context. This doc picks the STT, TTS, speech-to-speech, and turn-taking stack, and specifies a concrete AcuDx architecture with fallbacks and cost controls.

**Design constraints that drive every choice below:**
- **Latency budget**: human turn-taking gaps average ~200 ms; anything past ~800 ms voice-to-voice feels like a stalled call. Target **<800 ms p50, <1200 ms p95** voice-to-voice for AcuDx.
- **Barge-in is mandatory**: doctors interrupt patients constantly ("stop — are you having chest pain right now?"). The patient voice must yield instantly.
- **Emotional range is the product**: an "anxious" or "aggressive" or "distressed geriatric" patient must *sound* that way, or the roleplay training value collapses. This pushes toward expressive TTS or native speech-to-speech, not flat STT→text→flat-TTS.
- **Cost at scale**: a med school running 5,000 students × 3 encounters/week × 12 min = ~180k encounter-minutes/month. At $0.30/min that's $54k/month; at $0.05/min it's $9k/month. Voice cost dominates the AI bill (see `03-ai-agents.md` for LLM reasoning cost). Cost engineering is not optional.
- **Medical vocabulary + accents + code-switching**: international med schools (learners with L1 ≠ English, patients scripted in-language). STT must handle drug names, and switch languages.
- **Safety/compliance**: HIPAA (US institutions), EU AI Act Art. 50 synthetic-voice disclosure (in force **2 Aug 2026**), and voice-clone consent. Non-trivial and enforced.

---

## 1. Speech-to-Text (STT)

For AcuDx, STT matters in two roles: (a) transcribing the **learner's** speech so the LLM patient-agent can reason on it, and (b) producing a **verbatim transcript** for post-encounter assessment and gap analysis (what the learner asked, what they missed). Requirements: streaming/partial results, medical vocabulary, accent robustness, code-switching, and turn signals.

### Options (verified July 2026)

| Provider / model | Streaming $/min | Medical mode | Multilingual / code-switch | Time-to-final | Notes |
|---|---|---|---|---|---|
| **Deepgram Nova-3 Medical** | $0.0077/min general streaming; **Nova-3 Medical ~$0.0043/min batch** ([Deepgram](https://deepgram.com/pricing)) | Yes, purpose-built | Nova-3 Multilingual (Mar 2026 update: ~21% streaming WER drop) | Fast (~300 ms partials) | **Median WER 3.45%**, KER (keyterm) **6.79%** — best clinical accuracy; keyterm prompting up to 100 terms for drug names ([Deepgram Nova-3 Medical](https://deepgram.com/learn/introducing-nova-3-medical-speech-to-text-api)) |
| **Deepgram Flux** | Priced with Nova tier | Via Nova keyterms | Flux Multilingual: 10 languages + **mid-call switching** (Apr 2026) ([SiliconANGLE](https://siliconangle.com/2026/04/29/deepgram-expands-flux-10-languages-mid-call-switching-voice-agents/)) | EoT <400 ms | **Conversational STT** — model-based turn detection built in, not just transcription. Best fit for the live agent loop |
| **AssemblyAI Universal-Streaming** | **$0.15/hr = $0.0025/min**; Universal-3 Pro $0.45/hr | **Medical Mode +$0.07/hr** add-on | Multilingual Universal-Streaming: EN/ES/FR/DE/IT/PT unified | ~760 ms time-to-final | Signs **BAA**; built-in end-of-turn detection, PII redaction, sentiment ([AssemblyAI](https://www.assemblyai.com/pricing)) |
| **OpenAI gpt-4o-transcribe** | **~$0.006/min** (mini ~$0.003/min); gpt-realtime-whisper $0.017/min | No dedicated medical | Whisper-lineage multilingual, strong | Controllable latency | Convenient if already on OpenAI; weaker on rare drug names than Deepgram Medical ([OpenAI pricing](https://developers.openai.com/api/docs/pricing)) |
| **ElevenLabs Scribe** | Bundled in agent pricing | No | ~99 languages | Low | Good if standardizing on ElevenLabs; not medical-tuned |
| **Kyutai STT (open-source)** | Self-host GPU cost only | No (custom finetune) | Multilingual; low-latency streaming | ~500 ms | For self-hosted/on-prem institutions; no per-min vendor fee ([Kyutai Unmute](https://kyutai.org/unmute/)) |

### Recommendation

- **Live loop STT: Deepgram Flux** (conversational, mid-call language switch, sub-400 ms end-of-turn) with **Nova-3 Medical keyterm prompting** seeded per-case with the scripted drug list, diagnosis terms, and the patient's named medications. This gives us turn-taking *and* clinical accuracy in one component. Median WER 3.45% clinically is the number to beat, and Deepgram holds it.
- **Assessment transcript STT: Nova-3 Medical batch** ($0.0043/min) reprocessed post-encounter for the highest-fidelity verbatim record used in gap analysis.
- **Accents/code-switching**: keyterm prompting + Flux Multilingual covers the common case. For an international cohort where the learner's L1 is e.g. Arabic/Hindi/Mandarin, allow per-institution language config; fall back to gpt-4o-transcribe or AssemblyAI multilingual if Deepgram coverage for a specific language is thin.

**Why not just Whisper self-hosted?** Whisper-large is not streaming-native and lags on rare medical terms without finetuning; the ops burden isn't worth it below very high volume. Reserve self-host (Kyutai) for on-prem institutional requirements.

---

## 2. Text-to-Speech (TTS)

This is where the *acting* happens. AcuDx needs expressive, emotional, multilingual voices spanning patient archetypes: elderly, anxious, aggressive, low-health-literacy, non-native accent, pediatric-via-parent, distressed. Requirements: sub-100 ms first-audio for the live loop, emotional control, multilingual, and controlled voice cloning for reusable patient personas.

### Options (verified July 2026)

| Provider / model | Latency (TTFA) | Price | Expressiveness | Multilingual | Notes |
|---|---|---|---|---|---|
| **ElevenLabs Flash v2.5** | **~75 ms** ([ElevenLabs latency docs](https://elevenlabs.io/docs/eleven-api/concepts/latency)) | ~$0.30/1k chars on Creator; Flash ~0.5–1 credit/char | Good, agent-grade | ~32 languages | **Recommended by ElevenLabs for live agents**; v3 excluded from agents for latency ([ElevenLabs models](https://elevenlabs.io/docs/overview/models)) |
| **ElevenLabs v3** | Higher first-token (not for realtime) | 1 credit/char | **Best-in-class emotional/expressive** | Broad | Use for **pre-generated** distress/emotional lines, not live loop ([Eleven v3](https://elevenlabs.io/blog/eleven-v3)) |
| **Cartesia Sonic-3 / Turbo** | **~90 ms Sonic-3; ~40 ms Turbo** ([Cartesia Sonic](https://www.cartesia.ai/sonic)) | ~$35/1M chars effective ([eesel](https://www.eesel.ai/blog/cartesia-sonic-3-pricing)) | #1 naturalness, native laughter/emotion | 40+ languages native | Latency leader; SSM architecture; strong for cost + speed |
| **OpenAI TTS (gpt-4o-mini-tts)** | Low | Cheap | Steerable via prompt ("sound anxious") | Multilingual | Fine as a fallback; less control than ElevenLabs/Cartesia over voice identity |
| **Gemini TTS (native, in Live)** | Native, low | Bundled in Live pricing | 30 HD voices, mood control | 24 languages | Only meaningful inside Gemini Live S2S (below) |
| **Kyutai TTS / Pocket TTS** | Streaming, low; Pocket runs on CPU | Self-host only | Moderate | Multilingual | Open-source; on-prem option ([Kyutai TTS](https://kyutai.org/tts/)) |

### Patient-voice strategy (the hard part)

The training value depends on the patient *sounding* like the archetype. Two-tier approach:

1. **Live turns → Flash v2.5 or Cartesia Sonic-3/Turbo** for sub-100 ms responsiveness, with emotion set per-persona via voice selection + style tags. Cartesia Turbo (~40 ms) is the aggressive-latency choice; Flash v2.5 (~75 ms) is the mature default.
2. **Scripted high-emotion moments → pre-rendered ElevenLabs v3** clips. A distressed "I can't breathe!" or an aggressive outburst is a fixed line in the case script; render it once with v3's superior emotional model, cache it, and play from cache. This gives cinematic-quality distress *without* paying v3's latency in the loop.

**Reusable patient personas via voice cloning** — build a curated library of ~30–50 patient voices (age × gender × affect × accent) as **ElevenLabs Professional Voice Clones** created from consenting voice actors, NOT scraped/real-patient audio. Each persona = one stable voice ID reused across thousands of encounters. This amortizes voice creation and gives brand-consistent, legally-clean patients. See §7 for the consent/regulatory constraints — this is a hard requirement, not a nicety.

**Recommendation**: **Cartesia Sonic-3 (default live) + ElevenLabs v3 (pre-rendered emotional peaks) + ElevenLabs Professional Voice Clones (persona library)**. Cartesia's latency/cost edge wins the high-volume live path; ElevenLabs wins the persona identity + emotional-peak path. Keep OpenAI/Gemini TTS as bundled fallbacks inside their respective S2S stacks.

---

## 3. Full-duplex speech-to-speech vs composable STT→LLM→TTS

This is the central architecture fork.

### Speech-to-speech (native) — one model does audio-in → audio-out

| Stack | Price | Latency | Barge-in | Control | Verdict for AcuDx |
|---|---|---|---|---|---|
| **OpenAI Realtime (gpt-realtime-2)** | **$32/1M audio-in, $64/1M audio-out** ($0.40 cached in) → ~**$0.18–0.46/min uncached**, **$0.05–0.10/min with caching** ([OpenAI](https://developers.openai.com/api/docs/pricing), [HackerNoon 4k-session study](https://hackernoon.com/openai-realtime-api-pricing-in-2026-real-world-data-from-4000-measured-sessions)) | ~450–900 ms time-to-first-voice; server-VAD barge-in ([OpenAI Realtime guide](https://developers.openai.com/api/docs/guides/realtime)) | Built-in server VAD, distinguishes cough vs new sentence | Least — voice + reasoning fused; hard to inspect/gate the clinical reasoning | Great UX, **expensive at scale, weak governance** |
| **Gemini Live (2.5 Flash Native Audio)** | **$3/1M audio-in, $12/1M audio-out** → ~**$0.005 in / $0.018 out per min** ([Google AI pricing](https://ai.google.dev/gemini-api/docs/pricing)) | Native, cuts ~100–200 ms/turn vs pipeline; barge-in, proactive audio | Yes, affective dialog + barge-in | Moderate; 30 HD voices/24 langs | **~10–50× cheaper than OpenAI Realtime** at scale — the S2S cost leader |
| **Kyutai Unmute / Moshi (OSS)** | Self-host GPU only | Moshi ~160 ms (L4); Unmute 400–750 ms | Full-duplex native | **Full** — bring any LLM; open weights | On-prem / cost-floor option ([Kyutai Unmute](https://kyutai.org/unmute/)) |

**Cost reality check** (from the 4,000-session and byteiota analyses): at ~100k min/month, Gemini Live ≈ **$165/mo** worth of audio tokens vs an OpenAI Realtime-mini-equivalent ≈ **$8,400/mo**. That gap is decisive for a bootstrapped edtech serving whole cohorts.

### Composable pipeline — STT → LLM → TTS, orchestrated

- **Latency**: naive chaining is >1.5 s; but with Deepgram Flux (EoT <400 ms) + streaming LLM first-token (~200–300 ms) + Cartesia (~40–90 ms TTFA) you can land **~700–900 ms voice-to-voice** — competitive with native S2S.
- **Cost**: you pay STT (~$0.004/min) + LLM (text tokens, cheap and cacheable, see `03-ai-agents.md`) + TTS (~$0.03–0.05/min). Roughly **$0.05–0.09/min all-in**, and every stage is independently swappable and priceable.
- **Control (the decisive factor for AcuDx)**: the LLM turn is **text**, so you can (a) run the medical guardrails / guideline-grounding / assessment logic on inspectable text, (b) log exactly what the patient-agent "decided," (c) swap the reasoning model per case complexity (Haiku for simple patients, a frontier model for complex differentials), and (d) inject retrieved country-specific guidelines. Native S2S hides the reasoning inside audio tokens and makes clinical governance far harder.
- **Barge-in**: you must build it (VAD + flush TTS + truncate LLM) — frameworks below do this for you.

### Verdict

**AcuDx defaults to the composable pipeline** for pedagogical control, guideline-grounding, per-case model routing, and cost transparency — all of which are core to the product (assessment, guidance mode, safety). **Native S2S (Gemini Live) is the "cinematic mode"** fallback/premium path where raw conversational fluidity matters more than reasoning inspection (e.g., pure history-taking warm-ups). We explicitly avoid OpenAI Realtime as the *default* on cost, keeping it only as a quality-benchmark/failover.

---

## 4. Turn-taking, VAD, barge-in, backchannel

Natural interruptible conversation is what separates a demo from a usable clinical simulator. Components:

- **VAD (voice activity detection)**: detects the learner is speaking. **Silero VAD** is the open default (Pipecat uses it). Threshold-tunable.
- **End-of-turn / endpointing** — the make-or-break: silence-based endpointing is too dumb (a doctor pausing mid-sentence gets cut off). Use **model-based turn detection**:
  - **Deepgram Flux**: model-based EoT, confidence 0.5–0.9 (default 0.7), plus **Eager EoT** (threshold 0.3–0.9) that lets the LLM start generating early, then commit or discard — shaves real latency ([Deepgram Flux config](https://developers.deepgram.com/docs/flux/configuration)).
  - **Pipecat Smart Turn v3** (open-source) or **LiveKit turn-taking v1.5** as framework-native alternatives.
- **Barge-in**: when learner speech is detected mid-patient-utterance, immediately (a) stop TTS playback, (b) truncate the LLM generation, (c) discard the unspoken audio, (d) commit the patient's partial utterance to context so the model knows it was interrupted ("...chest —" not the full sentence). All three frameworks handle this; native S2S (OpenAI/Gemini) handles it server-side.
- **Backchannel**: sprinkle "mm-hm," "okay," "yeah" from the patient during long learner turns for realism. Emit as short pre-rendered TTS clips gated on VAD-detected learner-speaking + pause micro-gaps. Keep subtle; overuse is uncanny. Nice-to-have for v2, not v1.
- **Interruptibility as a graded skill**: a clinically valuable twist — an *aggressive* patient barges in on the learner (patient-initiated barge-in), a *cognitively impaired* patient has long, unpredictable pauses (raise EoT threshold), an *anxious* patient over-talks. Turn-taking parameters become **per-persona knobs**, not global config. This is an AcuDx differentiator.

---

## 5. Multilingual + accent handling for international med schools

- **STT**: Deepgram Flux Multilingual (10 langs, mid-call switch) + Nova-3 Multilingual for the assessment transcript; AssemblyAI/gpt-4o-transcribe as fallbacks for languages outside Deepgram's set. Seed keyterms per case in the target language.
- **Patient TTS**: Cartesia (40+ langs native) and ElevenLabs (~32 langs) both cover the major med-school languages; render the persona voice in-language.
- **Accent as a training variable**: the "non-native speaker" patient archetype and "low-health-literacy" archetype are pedagogically important (learners must practice communicating across a language/literacy gap). Encode accent/register in the persona's TTS voice + the LLM patient's word choice/grammar. This is a feature, not a bug — but keep it respectful and non-stereotyped (content review required).
- **Code-switching**: a patient who slips between L1 and English mid-sentence (common in real EDs) is realistic and hard. Flux's mid-call switching + a bilingual persona prompt supports this; flag it as an advanced case type.
- **Localization scope**: launch languages should mirror target institutions (English + likely Spanish, German, French, Arabic, Mandarin depending on partner schools). Don't boil the ocean; light up languages per signed institution.

---

## 6. Recommended AcuDx voice architecture

```
                          ┌─────────────────────────────────────────────┐
   Learner mic  ─────────▶│  Orchestrator (LiveKit Agents, WebRTC room)  │
   (WebRTC, Opus)         │  - Silero/Flux VAD + model-based EoT          │
                          │  - barge-in: flush TTS, truncate LLM          │
                          └───────┬───────────────────────┬──────────────┘
                                  │ audio                 │ text turns
                                  ▼                       ▼
                     ┌────────────────────┐   ┌──────────────────────────┐
                     │ STT: Deepgram Flux │   │ Patient-agent LLM (text) │
                     │ + Nova-3 Medical   │──▶│  - persona + emotion      │
                     │   keyterms         │   │  - guideline grounding    │
                     └────────────────────┘   │  - model routing (Haiku↔  │
                                  │            │    frontier per case)     │
                                  │ verbatim   └────────────┬─────────────┘
                                  ▼ (batch)                 │ text + style tags
                     ┌────────────────────┐                 ▼
                     │ Assessment store   │      ┌────────────────────────┐
                     │ (transcript, gaps) │      │ TTS: Cartesia Sonic-3  │
                     └────────────────────┘      │  (live)  +  cached      │
                                                 │  ElevenLabs v3 clips    │
                                                 │  (emotional peaks)      │
                                                 └───────────┬────────────┘
                                                             ▼
                                                     Learner speaker
                     ╔══════════════════════════════════════════════════╗
                     ║ "Cinematic mode" fallback: Gemini Live native S2S ║
                     ║  (warm-ups / fluidity-first cases; ~$0.02/min)    ║
                     ╚══════════════════════════════════════════════════╝
```

**Orchestration framework: LiveKit Agents.** Room-first WebRTC fits multiplayer rooms (several human learners + AI-filled roles) natively — Pipecat is pipeline-first and shines for single-agent flows, but AcuDx's multiplayer requirement (multiple humans + multiple AI roles in one room) maps directly onto LiveKit's participant model. Trade-off: on LiveKit, **HIPAA compliance is your responsibility** — you sign BAAs with each downstream vendor (Deepgram, Cartesia, ElevenLabs, LLM provider), run in compliant regions, own retention/redaction ([Medium comparison](https://medium.com/@hello_18940/livekit-vs-pipecat-for-voice-ai-orchestration-e8780fe3e5d3)). For single-agent solo-vs-AI cases, Pipecat Cloud (HIPAA add-on, Daily signs BAA) is a lighter alternative worth keeping for the solo path.

**Default pipeline** (per live turn):
1. LiveKit room captures learner Opus audio; Silero VAD + Flux EoT decide turn end (<400 ms).
2. Deepgram Flux streams partials; on EoT, final transcript (+ Nova-3 Medical keyterms) goes to the patient-agent LLM.
3. LLM (routed: Haiku for simple/scripted patients, frontier for complex differentials — see `03-ai-agents.md`) emits patient reply text + emotion/style tags, grounded in the case script and country guideline snippets.
4. Cartesia Sonic-3 streams TTS (~90 ms TTFA) in the persona voice; emotional-peak lines swap to pre-cached ElevenLabs v3 clips.
5. Barge-in monitored throughout: learner speech → flush TTS, truncate LLM, commit partial.
6. Post-encounter: Nova-3 Medical batch re-transcribes full audio → assessment/gap-analysis store.

### Fallback & failover chain

| Stage | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| STT | Deepgram Flux + Nova-3 Medical | AssemblyAI Universal (medical add-on) | gpt-4o-transcribe |
| Patient LLM | Routed (Haiku → frontier) | Alternate provider (see `03`) | — |
| TTS live | Cartesia Sonic-3 | ElevenLabs Flash v2.5 | OpenAI gpt-4o-mini-tts |
| TTS emotional peak | Pre-cached ElevenLabs v3 | Cartesia w/ emotion tags | — |
| Whole path (degraded) | Composable pipeline | **Gemini Live native S2S** | Text-only chat mode (last resort) |

If any live component breaches latency SLO or errors, degrade gracefully: TTS fallback is transparent to the user; whole-path failure drops to Gemini Live S2S; total voice failure drops to the existing text chat UI (never break the encounter).

### Cost controls (non-negotiable at cohort scale)

1. **Prompt/context caching on the LLM turn** — the case script, persona, and guideline context are static per encounter; cache them. On OpenAI Realtime this alone moves $0.18–0.46/min → $0.05–0.10/min; in the composable pipeline the LLM text cost is already small and cache-friendly.
2. **Model routing** — most patient turns are simple ("Where does it hurt?" → scripted answer). Route those to Haiku/Tier-2 or even a WASM/template path; reserve frontier models for genuinely novel reasoning. (Cross-ref CLAUDE.md 3-tier routing.)
3. **Cache emotional-peak TTS** — scripted distress lines rendered once, replayed free.
4. **Prefer composable over native S2S for the default path** — text-token LLM billing beats audio-token billing (~$32–64/1M audio vs ~$3–15/1M text on frontier models); Gemini Live only where fluidity justifies it.
5. **Cap encounter length + idle timeout** — a runaway session is a runaway bill. Hard cap ~20 min, idle disconnect ~60 s.
6. **Batch the assessment transcript** (batch STT ~$0.0043/min) rather than paying premium streaming twice.
7. **Self-host escape hatch** — for very-high-volume or on-prem institutions, Kyutai Unmute/Moshi + local LLM removes per-minute vendor fees entirely (GPU capex/opex instead). Model this at the volume where vendor fees exceed GPU amortization (~roughly >500k min/month sustained).

**Blended target: ~$0.05–0.09/min all-in for the composable default**, i.e. **~$9k–16k/month** for the 180k-min cohort example above — vs $50k+ if we naively used OpenAI Realtime uncached.

---

## 7. Safety, consent, and regulatory constraints (hard requirements)

These are enforced law as of July 2026, not best-practice suggestions:

- **EU AI Act Article 50 (in force 2 Aug 2026)**: any AI system that generates/manipulates voice (a "deepfake," including synthetic patient voices) must **disclose it is AI-generated**, and a voice agent must be **identifiable as AI at the start of every interaction** in a way meaningful to the listener. Penalties up to **€15M or 7% of global turnover** ([EU AI Act analysis](https://www.dilr.ai/blog/voice-ai-voice-cloning-consent-deepfake-enterprise)). **AcuDx implication**: every simulated voice is disclosed as AI in the UI and/or a spoken/onscreen label at encounter start — trivially satisfied since AcuDx is overtly a simulator, but must be explicit and logged. Synthetic audio should carry provenance metadata/watermarking where the provider supports it.
- **Voice-clone consent**: every persona voice must be a **default synthetic voice with documented lineage, or an actor recording with written+recorded consent, or a custom clone with the consenting individual's written consent on file**. **AcuDx implication**: the persona library uses ElevenLabs Professional Voice Clones built **only** from consenting, contracted voice actors — never from real patient recordings or public figures. Keep consent records per voice ID.
- **HIPAA (US institutions)**: learner audio can contain PHI if learners narrate real-adjacent details; treat all encounter audio as potentially sensitive. Sign **BAAs with every voice vendor** in the path (Deepgram, AssemblyAI, ElevenLabs, Cartesia, LLM provider). AssemblyAI and Daily/Pipecat sign BAAs; on LiveKit you own the BAA chain. Enforce audio retention limits, redaction, region pinning, access control.
- **No real-patient voice cloning, ever** — even with a research use case, the consent/ethics/regulatory surface is not worth it. Personas are actor-derived.

---

## Key decisions for AcuDx

- **Default architecture = composable STT→LLM→TTS pipeline**, not native speech-to-speech — chosen for pedagogical control, guideline-grounding on inspectable text, per-case model routing, and cost transparency. Native S2S is a fallback/"cinematic" mode, not the default.
- **STT = Deepgram Flux (live, model-based EoT <400 ms, mid-call language switch) + Nova-3 Medical keyterm prompting** (median WER 3.45%, KER 6.79%). Batch Nova-3 Medical (~$0.0043/min) reprocesses audio for the assessment transcript. Fallbacks: AssemblyAI Universal (+medical add-on), gpt-4o-transcribe.
- **TTS = Cartesia Sonic-3 for the live loop** (~90 ms TTFA, ~$35/1M chars, 40+ langs), **ElevenLabs v3 for pre-rendered emotional-peak clips** (cached, played free), **ElevenLabs Professional Voice Clones for a 30–50 persona library** built from consenting actors. Flash v2.5 (~75 ms) is the live-TTS fallback.
- **Native S2S fallback = Gemini Live 2.5 Native Audio** (~$0.005 in / $0.018 out per min) — ~10–50× cheaper than OpenAI Realtime ($0.18–0.46/min). OpenAI Realtime kept only as a quality benchmark/last failover, never the default.
- **Latency SLO: <800 ms p50, <1200 ms p95 voice-to-voice**; barge-in mandatory (flush TTS + truncate LLM + commit partial); turn-taking parameters (EoT threshold, over-talk, pause tolerance) are **per-persona knobs** that encode clinical behavior (aggressive/anxious/cognitively-impaired).
- **Orchestration = LiveKit Agents** (WebRTC room model fits multiplayer human+AI rooms); Pipecat Cloud (HIPAA add-on, Daily BAA) as the lighter solo-vs-AI option. On LiveKit, AcuDx owns the HIPAA BAA chain with every downstream vendor.
- **Cost controls are mandatory**: prompt/context caching, 3-tier model routing (most patient turns → Haiku/template), cached emotional TTS, 20-min encounter cap + idle timeout. **Blended target ~$0.05–0.09/min all-in**, ~$9k–16k/month for a 5,000-student cohort (vs $50k+ naive OpenAI Realtime).
- **Compliance is hard-gated**: EU AI Act Art. 50 (in force 2 Aug 2026) requires AI-voice disclosure at encounter start + synthetic-audio provenance; all persona voices require documented consent (actor-derived only, never real-patient audio); BAAs signed with every voice vendor in the path.
