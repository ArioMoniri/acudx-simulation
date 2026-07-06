# 09 — Localization & Turkish Strategy (July 2026)

**Scope.** Turkish is a **first-class locale** for AcuDx, not an afterthought. Turkish medical students are a primary launch cohort, so TR must reach parity with EN across **text and voice**: patient roleplay, clinical reasoning/grading, STT, TTS, terminology handling, guideline grounding, and the i18n engineering underneath. This doc picks the TR text+voice stack, scopes the Turkish guideline/accreditation context into the guideline store, and specifies the i18n engineering rules — with the Turkish-specific pitfalls (dotted/dotless `i`) called out as first-class bugs.

**Grounding.** Web-verified July 2026. Cross-references: LLM tiering `01-llm-models-and-cost.md`, voice stack `02-voice-ai.md`, guideline grounding `05-clinical-guideline-grounding.md`, and architecture `docs/architecture/02-model-gateway-and-routing.md` / `05-guideline-grounding-engine.md`. Model versions move fast; pin the ROUTING/EVAL ARCHITECTURE, treat exact scores as a snapshot.

**Direction correction applied.** Per the platform-wide LOCAL/OPEN-FIRST mandate, the TR stack defaults to **self-hosted open-weight** models (small-open patient turns → large-open reasoning/grading) and escalates to a frontier API only when Turkish quality genuinely requires it. The key finding below: **Turkish-specialized fine-tunes are useful for narrow tasks, but the best general open-weight models with strong Turkish coverage (Qwen3, Gemma) beat the small Turkish-only fine-tunes on multi-turn persona and reasoning** — the same pattern as the general/medical split in `01`.

---

## 1. Turkish-language quality of the candidate open LLMs

### 1.1 The landscape (verified July 2026)

Two families of Turkish-capable open models exist, and AcuDx uses them for **different jobs**:

**(A) General open-weight models with strong Turkish coverage** — the workhorses.

| Model | License | Turkish coverage | Role in AcuDx |
|---|---|---|---|
| **Qwen3** (32B / 235B-A22B) | Apache-2.0 | Strong; Qwen family has been the standout on Turkish among general open models since Qwen2-72B was noted as the first open model to reach real Turkish proficiency ([Cetvel, arXiv 2508.16431](https://arxiv.org/pdf/2508.16431)) | **Large-open TR reasoning/grading**; TR patient-turn base after LoRA |
| **Gemma 3 / Gemma 4** (9B–31B) | Gemma license | Strong; Gemma is the base for the best Turkish fine-tunes (CosmosGemma-9B, WiroAI-9B) — evidence the base has good Turkish latent capacity ([Turkish LLM Benchmark Suite](https://zenodo.org/records/18861750)) | **Small/mid-open TR patient turns** (9B), verifier |
| **Llama 4** (Scout/Maverick) | Llama license | Good but behind Qwen/Gemma on Turkish; Llama 3 70B scored **79.17%** on the TUS residency exam ([PMC12023555](https://pmc.ncbi.nlm.nih.gov/articles/PMC12023555/)) | Fallback base only |

**(B) Turkish-specialized fine-tunes** — narrow, cheap, useful as small-tier or for TR style, NOT as the reasoner.

| Model | Base | Size | Notes |
|---|---|---|---|
| **CosmosGemma-9B** (Cosmos/Turkish-Gemma) | Gemma | 9B | Best-rounded TR fine-tune in the 2026 suite; also **highest safety** score on Turkish prompt-injection tests ([MDPI 16/13/6740](https://www.mdpi.com/2076-3417/16/13/6740)) — matters for a student-facing product |
| **WiroAI-9B / 8B** | Gemma / Llama | 8–9B | Competitive TR instruction-following |
| **Trendyol-LLM** (v0.1 → v4.1) | Llama-2 → newer | 7B | Pioneer TR fine-tune; **older variants now behind same-size newer bases** (Trendyol beats its Llama-2 base but trails Llama-3-8B) ([TurkishMMLU](https://arxiv.org/pdf/2407.12402)) |
| **KoçDigital-8B**, **Kumru-2B** | Various | 2–8B | Kumru-2B = tiny/edge; lower safety scores noted |
| **Kanarya (KUIS AI), TURNA** | Turkish-native | — | Earlier Turkish-native models; encoder/seq2seq lineage, not chat-first — legacy, not selected |

> **Key point (mirrors the medical/general split in `01`):** Turkish-only fine-tunes win on **TR fluency/idiom and are safe/cheap at small size**, but they are **weaker at multi-turn persona and clinical reasoning** than a strong general model. The best TR fine-tunes are all built on Gemma/Qwen anyway. → Use a Turkish fine-tune (or a light LoRA on Gemma/Qwen) for the **patient actor**; use full-size **Qwen3 / large-open** for **clinical reasoning + grading**.

### 1.2 Turkish CLINICAL reasoning quality (the number that matters)

The decisive evidence is the **TUS (Tıpta Uzmanlık Sınavı)** benchmark — the Turkish residency entrance exam, 240 questions (120 basic + 120 clinical sciences), the hardest native Turkish medical test.

| Model tested on TUS | Accuracy | Verdict |
|---|---|---|
| **ChatGPT-4** (frontier API) | **88.75%** | Escalation ceiling |
| **Llama 3 70B** (open) | **79.17%** | **Open model clears the bar** |
| Gemini 1.5 Pro | 78.13% | Strong |
| Command R+ | 50.00% | Weak on TR medical |
| *Human test-takers (avg)* | *48.16%* | — |

Source: [PMC12023555](https://pmc.ncbi.nlm.nih.gov/articles/PMC12023555/). Takeaway: **a large open model (Llama-3-70B-class, and by 2026 Qwen3-32B/235B and Gemma-4 exceed it) already beats average human residents on Turkish clinical MCQs** — so AcuDx's large-open tier is viable for TR grading, with frontier-API escalation reserved for the hardest ~10% and for high-stakes final rubric authoring.

Corroborating clinical-NLP evidence in Turkish: on bilingual clinical relation extraction, **Gemini 1.5 Flash reached 0.888 micro-F1 in Turkish vs 0.906 in English** ([arXiv 2601.09367](https://arxiv.org/html/2601.09367)) — a small, acceptable TR gap that closes further with retrieval/structured reasoning. A dedicated Turkish medical LLM fine-tuned on **167,732 real patient–doctor Q&A pairs** (LoRA + catastrophic-forgetting mitigation) exists ([ACM 10.1145/3772000](https://dl.acm.org/doi/10.1145/3772000)) and is a candidate LoRA recipe for our **TR patient-actor** style, not our reasoner.

### 1.3 AcuDx TR LLM tier mapping

| Job | Default (open, self-hosted) | Escalate to |
|---|---|---|
| **TR patient/family roleplay turn** | **Gemma-4-9B or CosmosGemma-9B + AcuDx persona LoRA** (served vLLM/SGLang) | Large-open on persona-break |
| **TR examiner / Socratic hint (grounded)** | **Qwen3-32B + RAG** over TR guideline store | Frontier API if uncertainty high |
| **TR post-encounter grading / gap analysis** | **Qwen3-235B-A22B (large-open)** | **Frontier API** for hardest cases + rubric authoring |
| **TR ↔ EN terminology translation** | Gemma-4-9B + glossary cache | Large-open for rare terms |
| **TR safety/guardrail classifier** | Small TR fine-tune (Cosmos safety-tuned) | — |

---

## 2. Turkish medical STT (ASR)

### 2.1 Options (verified July 2026)

| Engine | Turkish support | Accuracy / notes | Cost model |
|---|---|---|---|
| **Deepgram Nova-3 (Turkish)** | **Yes — Turkish added Jan 2026** (with Italian/Norwegian/Indonesian), 36+ langs, multilingual code-switching + Keyterm Prompting (100 terms) | **Mar 2026 update: ~34% batch WER drop, ~21% streaming WER drop**; Deepgram notes streaming *outperforms* batch for Turkish specifically despite its agglutinative morphology + vowel harmony ([Deepgram](https://deepgram.com/learn/deepgram-expands-nova-3-with-italian-turkish-norwegian-and-indonesian-support), [Deepgram Mar-2026](https://deepgram.com/learn/nova-3-multilingual-major-wer-improvements-across-languages)) | Per-min API (matches EN live-loop choice in `02`) |
| **Whisper-large-v3 (Turkish)** | Yes, native multilingual | Baseline Turkish **WER ~4.3–14.2%** depending on domain/audio; not streaming-native; **LoRA fine-tuning materially improves Turkish** ([MDPI 13/21/4227](https://www.mdpi.com/2079-9292/13/21/4227)). Medical adaptation gains are large (analogous Greek medical dictation: 26.4%→14.9% WER after fine-tune) ([arXiv 2509.23550](https://arxiv.org/pdf/2509.23550)) | **Self-host GPU only** — the open-first default |
| **AssemblyAI / OpenAI gpt-4o-transcribe** | Multilingual incl. TR | Convenient fallback; not TR-medical-tuned | Per-min API |

### 2.2 Recommendation

- **Open-first default: self-hosted Whisper-large-v3 + a Turkish-medical LoRA/fine-tune** (fine-tuned on TR drug names, ICD/diagnosis terms, TR medical dictation) served streaming via a low-latency runtime. This is the cost-controlled path and gives on-prem institutions a no-vendor-fee option. Seed the decoder with a **per-case TR keyterm/glossary** (scripted drug list, diagnosis terms, patient's named meds) — the same keyterm trick used for EN.
- **Managed fallback / live-loop for institutions that want it: Deepgram Nova-3 Turkish** — it now has genuine Turkish streaming + mid-call code-switch, which is important because Turkish clinicians switch to English medical terms constantly (§4). Use Nova-3 Turkish when p95 latency or ops burden makes self-host Whisper impractical.
- **Assessment transcript: batch re-process** post-encounter with the highest-fidelity TR model for the verbatim gap-analysis record.
- **Accuracy guardrail:** Turkish agglutination means a single mis-segmented suffix changes meaning; log per-encounter TR WER on a held-out set and alert if it regresses. Vowel-harmony/long-compound errors are the failure mode to watch.

---

## 3. Turkish TTS

### 3.1 Options (verified July 2026)

| Engine | Turkish | Naturalness / latency | Deploy |
|---|---|---|---|
| **XTTS-v2 (Coqui)** | **Yes — Turkish is among its 17 languages**; ~6 s zero-shot voice clone | Good MOS; the open workhorse for TR patient personas; self-host on modest GPU | **Open, self-host** (open-first default) |
| **F5-TTS** | Multilingual (community TR checkpoints); CC-BY-NC (non-commercial base — check license before prod) | High naturalness; flow-matching | Open, self-host |
| **Piper (Turkish)** | Yes — TR voices exist; MIT | Fast, **CPU-capable / edge**; lower expressiveness | Open, on-prem/edge |
| **ElevenLabs (Turkish)** | **Yes — many named TR voices** (Enes, Defne, Selim, Mert, Cavit Pancar…), **Istanbul-accent** option; 70+ langs | Best-in-class realism + cloning; Flash v2.5 ~75 ms TTFA for live agents; v3 for pre-rendered high-emotion ([ElevenLabs Turkish](https://elevenlabs.io/text-to-speech/turkish)) | Managed API |
| **Cartesia Sonic 3.5** | Yes (in 42 langs) but **Turkish is long-tail, not the top-quality tier** (EN/ES/FR/DE/PT/IT/HI/JA are the quality tier) ([futureagi](https://futureagi.com/blog/elevenlabs-vs-cartesia-tts-2026/)) | Latency leader (~40–90 ms) but TR quality only "functional" | Managed API — **not** first choice for TR |

### 3.2 Recommendation (mirrors the two-tier EN strategy in `02`)

- **Open-first live turns:** self-hosted **XTTS-v2 Turkish** for patient-persona voices (elderly, anxious, aggressive, low-health-literacy, pediatric-via-parent), with per-persona cloned voices from short TR samples. **Piper Turkish** for edge/on-prem and for non-expressive utility voices (system prompts, nurse pages).
- **Managed quality tier for TR (when institution allows API):** **ElevenLabs Turkish Flash v2.5** for live loop (Istanbul accent default, sub-100 ms), and **pre-rendered ElevenLabs v3** for scripted high-emotion TR lines ("Nefes alamıyorum!" / distress outbursts) — render once, cache, play from cache. This buys cinematic TR distress without paying v3 latency in the loop.
- **Avoid Cartesia for Turkish** despite its EN latency lead — TR is in its functional-not-flagship tier; the training value depends on the patient *sounding* Turkish-native.
- **Synthetic-voice disclosure:** EU AI Act Art. 50 (in force 2 Aug 2026) and consent for cloned voices apply to TR voices exactly as EN (see `06-regulatory-compliance.md`).

---

## 4. Turkish medical terminology, code-switching & safety guardrails

**The core linguistic reality:** Turkish clinicians and students **code-switch heavily into English/Latin medical terms**. A Turkish sentence routinely embeds `myocardial infarction`, `dyspne`, `EKG`, `troponin`, drug INN names, and Latin anatomy — often inflected with Turkish suffixes (`troponin`**`i`** `yüksek`, `hasta`**`nın`**). The system must accept, understand, and *produce* this register naturally, or it reads as fake.

**Handling requirements:**

1. **Bilingual TR/EN medical glossary + translation memory** — a curated term store mapping TR ↔ EN/Latin (e.g. *kalp krizi* ⇄ *myocardial infarction* ⇄ *MI*; *nefes darlığı* ⇄ *dyspnea*). Used to: (a) seed STT keyterms, (b) constrain TTS pronunciation, (c) ground translation so the model never invents a term. TR medical NER is viable — Gemini-class models extract TR clinical entities well ([TR mammography NER, PMC11852152](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11852152/)), and TR clinical NLI/relation datasets exist ([TurkMedNLI](https://peerj.com/articles/cs-2662/), [arXiv 2601.09367](https://arxiv.org/html/2601.09367)) to validate the glossary.
2. **Code-switch-aware prompting:** the patient-actor persona LoRA is trained/prompted to mix registers appropriately — a low-health-literacy patient says *kalp krizi*, a physician-examiner says *MI* — so register itself becomes a teachable signal.
3. **Clinical-safety translation guardrails (non-negotiable):**
   - **Never free-translate a drug/dose/route.** Numbers, units, INN drug names, and dosing pass through the glossary/translation-memory as **locked tokens**, never re-generated by the LLM. A mistranslated dose is a patient-safety incident even in simulation.
   - **Round-trip check** high-risk clinical strings (TR→EN→TR) and flag divergence for human review before a case ships.
   - **TR safety classifier** (Cosmos safety-tuned small model — highest TR prompt-injection safety in the 2026 suite) gates every TR AI output for medical-harm/PII/jailbreak, same gate as EN.
   - **Hallucination watch:** TR has less clinical training data than EN, so grounding is *more* important, not less — all TR clinical claims are RAG-grounded against the TR-scoped guideline store (§5), never model-memory.

---

## 5. Turkish clinical guidelines & accreditation context (country-scoped guideline store)

The guideline store (`05-guideline-grounding-engine.md`) is **country-scoped**; the `TR` scope carries Turkish national sources so citations read *TEPDAD / Sağlık Bakanlığı* to a Turkish student, not *NICE/AHA*.

**Sources to ingest into the `TR` guideline scope:**

| Body | What it governs | Use in AcuDx |
|---|---|---|
| **TEPDAD** (Tıp Eğitimi Programları Değerlendirme ve Akreditasyon Derneği) | National medical-education **program accreditation**; **WFME-recognized** ([TEPDAD](https://tepdad.org.tr/en/home/)) | Map AcuDx competencies to TEPDAD standards so institutions can cite AcuDx use in accreditation self-evaluation (BİDR) |
| **UÇEP / ÇEP** (Ulusal Çekirdek Eğitim Programı) | National **core curriculum** — core diseases, symptoms, basic clinical skills (UÇEP-2020; **UÇEP-2026** revision in progress via TEPDAD workshops) ([YÖK UÇEP](https://www.yok.gov.tr/Documents/Kurumsal/egitim_ogretim_dairesi/Ulusal-cekirdek-egitimi-programlari/mezuniyet-oncesi-tip-egitimi-cekirdek-egitimi-programi.pdf)) | **Case-blueprint source of truth for TR** — scenario library maps to UÇEP core presentations & skill levels; the OSCE/UÇEP core is the TR equivalent of a curriculum map |
| **T.C. Sağlık Bakanlığı** (Ministry of Health) + **TİTCK** (Türkiye İlaç ve Tıbbi Cihaz Kurumu) | National clinical guidelines, drug licensing, MedDRA coding ([TİTCK](https://www.titck.gov.tr/mevzuat)) | Drug names/indications/dosing grounded to **TİTCK** rather than FDA/EMA; TR treatment pathways cite Sağlık Bakanlığı |
| **TUS** (Tıpta Uzmanlık Sınavı, ÖSYM) | Residency entrance exam; residency training is **in Turkish, C1 required** ([ÖSYM 2026](https://www.osym.gov.tr/TR,33819/2026.html)) | TUS-style item framing for TR assessment register; grading rubric tuned to TR clinical-reasoning expectations |

**Scoping rule:** an encounter's `locale = tr-TR` selects the TR guideline scope; retrieval, citations, and the grader's reference standard all pull from TR sources first, falling back to international (NICE/ESC/AHA) only where no national guidance exists — and labeling the fallback explicitly. This keeps clinical grounding **country-correct**, which is a trust and accreditation requirement, not a nicety.

---

## 6. i18n engineering (ICU, locale content, TR-specific pitfalls)

### 6.1 Message & format layer

- **ICU MessageFormat** for all UI strings (react-intl/FormatJS) — the 2026 de-facto standard, supported by react-intl/i18next/vue-i18n ([Crowdin](https://crowdin.com/blog/icu-guide)). Turkish is **gender-neutral** (no grammatical gender, single 3rd-person pronoun *o*) — simpler than Romance languages for gender, but plural/case rules still need ICU `plural`/`select`, never string concatenation.
- **No sentence assembly from fragments.** Turkish is **agglutinative + SOV + vowel-harmony**: suffixes attach to the noun and word order differs from English. Concatenating translated fragments produces ungrammatical Turkish. Each user-facing sentence is one ICU message with named placeholders; translators own full-sentence order.
- **Number/date/units:** Turkish uses **`,` decimal separator and `.` thousands** (1.234,56), 24-hour time, `d MMMM yyyy` dates, and **metric everywhere** — drive all of this from `Intl.NumberFormat`/`Intl.DateTimeFormat` with `tr-TR`, never hardcode. Medical vitals stay in clinical SI units regardless of locale.

### 6.2 The dotted/dotless `i` — treat as a first-class bug class

Turkish has **four** i-letters: `I` (uppercase dotless), `İ` (uppercase dotted, U+0130), `i` (lowercase dotted), `ı` (lowercase dotless, U+0131). Case mapping is **locale-dependent**: in `tr`, `uppercase(i) = İ` and `lowercase(I) = ı` ([i18nguy](http://www.i18nguy.com/unicode/turkish-i18n.html), [Wikipedia](https://en.wikipedia.org/wiki/Dotted_and_dotless_I_in_computing)).

**Rules (each a real-world defect if violated):**

1. **Never case-fold identifiers/emails/usernames/slugs with the Turkish locale.** The GitHub auth bypass came from locale-sensitive lowercasing colliding `I`/`ı` during password-reset email comparison ([DEV](https://dev.to/jagracey/hacking-github-s-auth-with-unicode-s-turkish-dotless-i-460n)). → For security-sensitive comparisons use **`toUpperCase('en-US')` / invariant/`toLocaleUpperCase('en-US')`** or Unicode case-folding with the Turkic flag **off**; store emails/IDs case-normalized under the invariant locale, never `tr`.
2. **Do use Turkish casing for DISPLAY text** — a Turkish UI must render *İstanbul*, *İLAÇ* correctly, so display casing uses `'tr-TR'`. Two code paths: **display casing = tr**, **identity/security casing = invariant**. Never mix them.
3. **Collation/sort/search** with `Intl.Collator('tr')` (ç, ğ, ı, i, ö, ş, ü order); a naïve ASCII sort mis-orders Turkish and search fails to match `ı`↔`i` ([Mozilla bug 812837](https://bugzilla.mozilla.org/show_bug.cgi?id=812837)).
4. **DB layer:** use a Turkish-aware collation for user-facing sort, but a deterministic/invariant collation for keys and unique constraints — otherwise `İ`/`i` collisions create duplicate-key or lookup surprises.

### 6.3 Content & QA

- **Locale content packs** per scope: UI strings (ICU), case-scenario text, TR medical glossary, TR guideline citations, TR TTS voice map, TR STT keyterm lists — all keyed by `tr-TR` and loaded together.
- **Pseudo-localization + TR expansion budget:** Turkish strings can run longer than English; test layouts with real TR strings, not English placeholders.
- **Right register:** medical Turkish is formal/clinical; the localization QA reviewer must be a **Turkish clinician-fluent** reviewer, not a generic translator, because the code-switching register (§4) and clinical terminology are where machine translation quietly fails.

---

## Key decisions for AcuDx

- **TR is first-class, open-first.** Default to self-hosted open-weight models for TR; escalate to a frontier API only for the hardest reasoning/grading and rubric authoring — same tiering as EN, proven viable because a large open model already beats average Turkish residents on TUS (Llama-3-70B **79.2%**; Qwen3/Gemma-4 exceed it).
- **TR text LLM stack:** patient turns → **Gemma-4-9B / CosmosGemma-9B + AcuDx persona LoRA**; reasoning/Socratic hints → **Qwen3-32B + TR-scoped RAG**; grading/gap-analysis → **Qwen3-235B-A22B**, frontier-API escalation for the top ~10% and authoring. Turkish-only fine-tunes are used *only* at small tier / for TR style, never as the reasoner.
- **TR STT:** open-first **self-hosted Whisper-large-v3 + Turkish-medical LoRA**, per-case keyterm seeding; **Deepgram Nova-3 Turkish** (streaming + mid-call code-switch, Mar-2026 WER drops) as the managed live-loop/fallback. Batch re-transcribe for the assessment record.
- **TR TTS:** open-first **XTTS-v2 Turkish** (cloned patient personas) + **Piper Turkish** (edge/utility); **ElevenLabs Turkish** (Istanbul accent, Flash v2.5 live + v3 pre-rendered emotion) as the managed quality tier. **Do not use Cartesia for TR** — Turkish is its long-tail, not its flagship quality tier.
- **Code-switching is the product, not a bug:** accept and produce TR↔EN medical register; register itself is a teachable signal. Drug names/doses/units are **locked glossary tokens**, never LLM-translated; round-trip + TR safety-classifier gate every clinical string.
- **Guideline store is country-scoped to TR:** UÇEP/ÇEP core curriculum drives the TR case blueprint, **TEPDAD** (WFME-recognized) maps competencies for accreditation, **Sağlık Bakanlığı/TİTCK** ground drugs and pathways, **TUS** tunes the assessment register — international guidelines only as labeled fallback.
- **i18n engineering:** ICU MessageFormat, full-sentence translations (no fragment assembly, agglutinative), `tr-TR` `Intl` for numbers/dates/collation — and the **dotted/dotless `i` treated as a security-relevant bug class**: invariant-locale casing for identity/security, `tr-TR` casing for display, `Intl.Collator('tr')` for sort/search, deterministic collation for DB keys.

---

### Sources

- [Cetvel: Turkish LLM benchmark (arXiv 2508.16431)](https://arxiv.org/pdf/2508.16431) · [TurkishMMLU (arXiv 2407.12402)](https://arxiv.org/pdf/2407.12402) · [Turkish LLM Benchmark Suite (Zenodo)](https://zenodo.org/records/18861750) · [TR-MMLU (arXiv 2501.00593)](https://arxiv.org/html/2501.00593v2) · [TR prompt-injection safety (MDPI)](https://www.mdpi.com/2076-3417/16/13/6740)
- [LLMs on TUS residency exam (PMC12023555)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12023555/) · [Bilingual clinical RE EN/TR (arXiv 2601.09367)](https://arxiv.org/html/2601.09367) · [Turkish medical LLM on patient–doctor Q&A (ACM 10.1145/3772000)](https://dl.acm.org/doi/10.1145/3772000) · [TurkMedNLI (PeerJ)](https://peerj.com/articles/cs-2662/) · [TR mammography NER (PMC11852152)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11852152/)
- [Deepgram Nova-3 adds Turkish](https://deepgram.com/learn/deepgram-expands-nova-3-with-italian-turkish-norwegian-and-indonesian-support) · [Nova-3 Mar-2026 WER drop](https://deepgram.com/learn/nova-3-multilingual-major-wer-improvements-across-languages) · [Whisper Turkish + LoRA (MDPI)](https://www.mdpi.com/2079-9292/13/21/4227) · [Greek medical dictation fine-tune (arXiv 2509.23550)](https://arxiv.org/pdf/2509.23550)
- [ElevenLabs Turkish](https://elevenlabs.io/text-to-speech/turkish) · [ElevenLabs vs Cartesia 2026](https://futureagi.com/blog/elevenlabs-vs-cartesia-tts-2026/) · [Coqui XTTS-v2 languages](https://localaimaster.com/models/coqui-tts) · [Open TTS licenses 2026](https://www.promptquorum.com/power-local-llm/local-tts-voice-cloning-piper-coqui-xtts)
- [TEPDAD](https://tepdad.org.tr/en/home/) · [UÇEP (YÖK)](https://www.yok.gov.tr/Documents/Kurumsal/egitim_ogretim_dairesi/Ulusal-cekirdek-egitimi-programlari/mezuniyet-oncesi-tip-egitimi-cekirdek-egitimi-programi.pdf) · [TİTCK mevzuat](https://www.titck.gov.tr/mevzuat) · [TUS 2026 (ÖSYM)](https://www.osym.gov.tr/TR,33819/2026.html)
- [ICU MessageFormat guide (Crowdin)](https://crowdin.com/blog/icu-guide) · [Turkish i18n dotted/dotless i (i18nguy)](http://www.i18nguy.com/unicode/turkish-i18n.html) · [GitHub auth bypass via Turkish ı (DEV)](https://dev.to/jagracey/hacking-github-s-auth-with-unicode-s-turkish-dotless-i-460n) · [Dotted/dotless I in computing (Wikipedia)](https://en.wikipedia.org/wiki/Dotted_and_dotless_I_in_computing) · [Mozilla bug 812837](https://bugzilla.mozilla.org/show_bug.cgi?id=812837)
