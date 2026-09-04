# 12 — Realtime Talking-Patient Avatars: Approaches & Decision (August 2026)

**Status:** Decision doc. Extends `10-realtime-avatars-2026.md` and `03-3d-avatars.md` along the **realtime-conversation** and **shared-GPU-pod-safety** axes, and adds the Aug-2026 fast-video-gen models (MiniMax Hailuo H3, Seedance, Kling, LTX-Video) that did not exist at the July refresh. The layered-tier *strategy* in docs 03/10 holds; this doc hardens it against the **shared pod that wipes under disk/VRAM pressure** and re-scores every option against realtime feasibility.

**Time context:** August 2026. Model/vendor facts web-verified, sources inline with dates. Numbers move fast in this space — treat as a Aug-2026 snapshot.

**One-line answer:** **Default = T0, client-side lip-synced 3D (the procedural R3F head AcuDx already ships), $0 GPU, realtime, air-gapped, and the only tier that renders clinical signs.** Server animation of a demographic-matched still (T1) is an *opt-in, queued, VRAM-capped, off-pod* enhancement; proprietary realtime video APIs (T2) are a premium, cloud-only tier. **Realtime video generation NEVER runs on the shared pod.**

---

## 0. The product need, restated as constraints

When a student converses with a simulated patient, the face must:
- **talk in realtime** (respond within the conversational turn, animate at playback speed);
- **match the case demographic** (age / sex / ethnicity from the generated case);
- **reflect symptoms as visual markers** — pallor, cyanosis, diaphoresis, distress, reduced LOC;
- be **education-only, clearly labelled synthetic** (EU AI Act Art. 50; C2PA).

Hard constraints that decide the architecture:
1. **LIGHT/FAST, must NOT max out the shared GPU pod.** The pod co-hosts the LLM grading + voice services (see `server/`, `/v1/grade`) and **wipes under disk/VRAM pressure**. Any component that spikes VRAM or fills disk with model weights/frames can evict the whole pod. This is the dominant constraint and it **excludes realtime video diffusion on that pod outright.**
2. **Open-source-first, air-gapped-capable.** A campus install with no internet must still get a talking, demographic-matched, sign-shaded patient.
3. **EN/TR + more languages.**
4. Cost discipline (free-tier default cannot meter per-minute).

These four are exactly why the answer is *client-first*, not *pick-the-best-model*.

---

## 1. What "realtime talking head" actually means (three families)

The word "realtime" hides three very different pipelines. Scoring them against the constraints is the whole decision.

| Family | How it makes the face move | Where it runs | Realtime? |
|---|---|---|---|
| **A. Parametric mesh + visemes/blendshapes** | TTS audio → phoneme/viseme or blendshape weights → morph-target animation on a rig | **Client GPU** (WebGL2/WebGPU) or a tiny CPU model | **Yes**, natively — it's just animation, no per-frame inference |
| **B. Neural reenactment / dubbing** (LivePortrait, MuseTalk) | Warp a *reference image/video* using driving keypoints or audio-to-lip-region | Server GPU | **Yes at FPS**, but needs a *driving performance* (a neutral looping template video first) |
| **C. Neural portrait/video generation** (audio→face from scratch: SadTalker, Hallo, EchoMimic; and clip-gen: Hailuo, Seedance, Kling, LTX) | Diffusion / flow-matching generates pixels of the face | Server GPU (heavy) or cloud API | **Mostly NO** — 18–31× slower than realtime for the open batch models; a 2026 frontier (Livatar-1, Teller) reaches realtime only on a *dedicated* GPU; cloud APIs are realtime but off-device |

**The trap:** Families B and C are what people mean by "AI avatar," but only Family A is free, air-gapped, and pod-safe, and — decisively — **only Family A can shade clinical signs** (cyanosis at SpO₂ 82%), because B/C render a *healthy generated face* you cannot parameterize. Symptom fidelity is the medical differentiator, so Family A must own the sign channel in every tier.

---

## 2. What AcuDx already has (the T0 baseline is real, not a plan)

`web/` already ships both renderers of Family A, consuming one shared clinical-sign contract:

- **`web/src/components/avatar3d/PatientHead3D.tsx`** (559 lines) — a **procedural low-poly 3D head in React-Three-Fiber**, built entirely from geometry + drei primitives (**no downloaded GLB, no external URL → fully air-gap friendly**). Physiology-driven: breathing from RR, blink cadence from affect, and pallor / cyanosis / diaphoresis / respiratory-distress / reduced-LOC shade the face and shape the motion. Perf guards: capped devicePixelRatio, `AdaptiveDpr`, and `frameloop="demand"` (pauses when offscreen / tab hidden / reduced-motion). Lazy-loaded so three/fiber/drei land in a separate chunk.
- **`web/src/components/PatientPortrait.tsx`** (847 lines) — the 2D portrait consuming the **same** `ClinicalSignIntensity` / `ClinicalSignKind` contract, so the two renderers never disagree; the device-floor / no-GPU fallback.
- **`web/src/domain/patientProfiles.ts`** + `avatarMotion.ts` — deterministic per-case demographics (skin tone, hair, headwear) seeded from the case id.

Deps: `three@0.169`, `@react-three/fiber@8.18`, `@react-three/drei@9.122`. What's missing for a *talking* head is only the **viseme/lip-sync channel** on top of the existing sign/affect channels — a client-side, $0, air-gapped add-on (§4, T0).

---

## 3. The landscape, scored (August 2026)

### 3.A Client-side, zero-GPU (Family A) — the recommended default surface

| Option | Latency | GPU cost | Realtime | Demographic control | Symptom conditioning | License | Air-gapped |
|---|---|---|---|---|---|---|---|
| **Procedural R3F head** (AcuDx-built, `PatientHead3D`) | frame-rate, no inference | **$0 (client)** | ✅ | ✅ params (skin/age/sex/hair from case seed) | ✅ **native** shaders (the sign channel) | our code / MIT-class deps | ✅✅ (no assets) |
| **Ready Player Me GLB + TalkingHead.js** ([met4citizen/TalkingHead](https://github.com/met4citizen/TalkingHead)) | frame-rate | $0 (client) | ✅ | ✅ RPM rig variety; ARKit-52 + Oculus visemes ([RPM morph-target docs](https://docs.readyplayer.me/ready-player-me/api-reference/avatars/morph-targets/apple-arkit)) | ⚠️ overlay shader must be added (RPM face is healthy) | RPM SDK free; TalkingHead MIT | ✅ *if* GLB self-hosted + local visemes (default TTS is Google Cloud → swap for local) |
| **2D image warp / Live2D-style rig** | frame-rate | $0 (client) | ✅ | ✅ per-portrait | ✅ CSS/canvas tint overlay | varies | ✅ |

**Lip-sync for T0:** map TTS phoneme/timing (or a tiny in-browser viseme model) to ~15 Oculus/ARKit viseme shapes + jaw. TalkingHead.js has built-in lip-sync for EN/DE/FR/FI/LT; for **TR and others, drive visemes from the TTS engine's phoneme output** (locale-agnostic) rather than TalkingHead's per-language tables. This keeps EN/TR/+ languages working air-gapped.

**Verdict:** This family satisfies *every* hard constraint simultaneously. It is the only family that is realtime **and** $0 **and** air-gapped **and** sign-capable. It is the default.

### 3.B Open server models (Families B/C) — realtime viability + VRAM

| Model | Speed | VRAM | Realtime for a live turn? | Symptom conditioning | License | Notes |
|---|---|---|---|---|---|---|
| **LivePortrait** | 60+ FPS on consumer GPU | ~few GB | ✅ **but reenactment** — needs a driving video/keypoints, not text→face | ❌ (warps a healthy still) | MIT-ish OSS | Great for animating a still *from a driver*; you must supply the performance. |
| **MuseTalk** ([arXiv 2410.10122](https://arxiv.org/html/2410.10122v3)) | **30 FPS @256², V100** | ~a few GB | ✅ **but dubbing** — lip-region onto a *template video* | ❌ (edits lips only) | OSS | Needs a neutral looping template clip of the demographic-matched face first; low-res. |
| **Audio2Face-3D** (open model, Sept 2025) | **30 FPS realtime** | **5–6 GB default; ~0.9 GB edge** (single-stream TensorRT); outputs 52+16 blendshapes ([NVIDIA perf docs](https://docs.nvidia.com/ace/audio2face-3d-microservice/1.3/text/interacting/performance.html)) | ✅ audio→blendshapes (drives a mesh, not pixels) | Open Model License (weights) / MIT SDK / **NIM needs AI Enterprise** | **Best server option for AcuDx** *if* used at all: emits ARKit-52 that feed our own mesh → **composes with the sign shader**. Use the **open weights**, not the licensed NIM, for air-gapped. |
| **SadTalker** | **18.9 s per 1 s of video** | mid | ❌ ~19× too slow | ❌ | OSS | Batch pre-render only. |
| **Hallo** | **20.9 s / s** | high | ❌ ~21× too slow | ❌ | OSS | Batch only. |
| **EchoMimic / EchoMimicV3** ([antgroup/echomimic_v3](https://github.com/antgroup/echomimic_v3), AAAI 2026) | **31 s / s** (v1); v3 = 1.3B | **12–16 GB** (v3) | ❌ | ❌ | OSS | Batch only; v3 VRAM alone would threaten the shared pod. |
| **Wav2Lip (+ successors)** | fast | **~1 GB** | ✅ lip-region | ❌ (blurry mouth patch) | OSS | Cheapest, ugliest; lip-patch only. |
| **Livatar-1** ([arXiv 2507.18649](https://arxiv.org/abs/2507.18649), Hedra) | **141 FPS, 0.17 s e2e on ONE A10** | dedicated A10-class | ✅ **true realtime audio→streaming portrait** | ❌ | research | The 2026 frontier proof that audio→photoreal-portrait can be realtime — but on a **dedicated** GPU, and still no sign control. |
| Teller / Hallo-Live / DyStream (2026) | realtime-streaming research | dedicated GPU | ✅ (research) | ❌ | research | Track, don't build on. |

**Read:** the *batch* diffusion models (SadTalker/Hallo/EchoMimic) are categorically out for live turns — 18–31× slower than realtime, and each is a multi-GB weight load + frame buffer that is exactly the "disk/VRAM pressure" that wipes the pod. The *realtime* ones split two ways: **reenactment/dubbing** (LivePortrait, MuseTalk) needs a pre-made driving clip and can't shade signs; **Audio2Face-3D** is the one that fits AcuDx philosophically because it outputs **blendshapes, not pixels** — it drives *our* mesh, so the sign shader survives — and it fits in ~1–6 GB. But even A2F is only worth self-hosting when there's a **dedicated, isolated GPU**, never the shared pod.

### 3.C Fast video-gen models (Aug 2026) — can any do near-realtime talking heads?

| Model | Open? | Latency | Cost | Talking-head fit | Air-gapped |
|---|---|---|---|---|---|
| **MiniMax Hailuo H3 (Hailuo 3.0)** | **Open-weight** (announced 31 Jul 2026, weights "coming days"; MiniMax Community License, <$20M rev) ([HF blog](https://huggingface.co/blog/ResterChed/minimax-h3-hailuo-3-0)) | **Async batch, 30–90 s/clip** | **$0.13/s 2K ≈ $7.80/min** | image-to-video + talking-head via reference audio, but **4–15 s clips, async** | ⚠️ self-host only after weights ship; size/VRAM unknown, likely large |
| **Kling 3.0 Turbo** | No (API) | async clip | ¥0.8/s (~$0.11/s) 720p; ~$20/min 1080p ([invideo pricing, Aug 2026](https://invideo.io/blog/ai-video-model-pricing/)) | clip gen, no live loop | ❌ |
| **Seedance 2.0** | No (API) | async clip | ~$22.45/min 1080p | clip gen | ❌ |
| **LTX-Video (LTX-2.3)** | **Open weights** (fastest open diffusion) | near-realtime *generation* of short clips on H100-class | $0.06–0.32/s hosted | clip gen; no native audio-lip conditioning | ⚠️ self-host, heavy GPU |

**Verdict:** **None do realtime interactive talking heads.** They are **asynchronous clip generators** — you wait 30–90 s and pay **$7.80–$22 per minute of output**. They are useful to AcuDx **only offline**: pre-generating a short (2–4 s) neutral "idle/breathing" loop of a demographic-matched patient to feed a *reenactment* renderer (LivePortrait/MuseTalk), done **once per case at authoring time, off the pod, cached**. As a live conversational surface they fail cost, latency, and pod-safety at once. Hailuo H3 open weights are worth watching purely as an **offline still→idle-clip** asset generator, not a live path.

### 3.D Proprietary realtime avatar APIs — premium optional tier only

| Vendor | Latency | Cost | Concurrency | Privacy / regulated | Self-host / air-gap | Sign control |
|---|---|---|---|---|---|---|
| **Anam (CARA-3)** | **~180 ms** | $0.24 (Starter) → **$0.15/min (Growth $299/2k min)** ([Anam via toughtongue, 2026](https://www.toughtongueai.com/blog/best-virtual-avatar-solutions-2026)) | 1–10 by tier | **HIPAA + SOC 2** ([Anam HIPAA](https://anam.ai/blog/hipaa-compliance-expressive-voices)) | ❌ cloud only | ❌ |
| **Tavus (Phoenix-4)** | **<500–600 ms** | ~$0.37/min overage | tiered | enterprise SLAs | ❌ cloud only | ❌ |
| **HeyGen LiveAvatar** | **<300 ms TTFF** | falls to **~$0.01/min at scale**, 1080p, **unlimited concurrency** | unlimited | no published HIPAA | ❌ cloud only | ❌ |
| **D-ID** | realtime | from $18/mo; ~$3/min API | tiered | — | ❌ cloud only | ❌ |

**Verdict:** genuinely realtime and low-latency, and the **image-to-replica** path (Tavus from one photo; Anam persona) is the natural way to turn a **generated demographic-matched still into a talking patient**. But: **cloud-only (breaks air-gapped), per-minute metered (breaks free default), and cannot render clinical signs.** Correct role = **premium, opt-in, network-connected tier only**, with **Anam as primary** (HIPAA/SOC-2, 180 ms) and Tavus/HeyGen as the generated-face / cheap-at-scale alternates. Never the default; never in an air-gapped deployment.

---

## 4. RECOMMENDED tiered architecture for AcuDx

One `PatientAvatar` abstraction, one **driver interface** (viseme/blendshape stream ← TTS; affect ← persona agent; **clinical-sign intensities ← Vitals & Physiology Engine**), three pluggable renderers. Drivers are identical across tiers, so a case authored once presents consistently everywhere.

| Tier | Renderer | Family | Runs where | GPU cost | Latency | Air-gap | Sign channel | When |
|---|---|---|---|---|---|---|---|---|
| **T0 — DEFAULT (light/free/realtime)** | **Client lip-synced 3D**: existing `PatientHead3D` + viseme channel; RPM+TalkingHead.js as an alt rig | A | **client** | **$0** | frame-rate | **✅✅** | **native shaders** | **everywhere, always** |
| **T1 — enhanced (gated, off-pod, batched)** | **Server animation of a demographic-matched still**: Audio2Face-3D open weights → *our* mesh (preferred), or LivePortrait/MuseTalk reenacting a cached idle-clip, **+ client sign overlay** | A-driven / B | **dedicated isolated GPU or queued burst — NEVER the shared pod** | amortized, VRAM-capped | ~realtime on A10-class | ⚠️ (self-host weights) | overlay (kept client-side) | capable deployments that provision a *separate* GPU; opt-in |
| **T2 — premium (cloud, optional)** | **Proprietary realtime API**: Anam CARA-3 (primary, HIPAA/SOC2), Tavus/HeyGen alts; image-to-replica of the generated face | C | vendor cloud | $0.15–0.37/min | 180–600 ms | ❌ | overlay badges only | premium/OSCE/institution, network-connected, consented |

Everything degrades to **T0**. T0 is not a fallback — it is the product's default and the only universally-available, sign-shaded, air-gapped, realtime surface.

**Why this ordering (vs "just use the best model"):** the shared pod is the scarce, fragile resource. T0 spends **zero** of it. T1 spends a **separate** GPU under a hard cap. T2 spends **someone else's** cloud. At no tier does realtime video generation touch the pod that runs grading/voice.

---

## 5. Symptom → visual-marker mapping, per tier

The sign channel is **renderer-agnostic**: authored once as `ClinicalSign.intensity` (0..1) off the vitals engine, rendered per tier. It **must never be delegated to a generative model** — a generated face is healthy by construction.

| Symptom | Driver | T0 (client, native) | T1 (client overlay over server-animated face) | T2 (client badge over vendor video) |
|---|---|---|---|---|
| **Pallor** | Hb / shock | desaturate + lighten skin albedo (shader uniform `o_pallor`) | same overlay shader composited over the animated frame | text badge + monitor (vendor face can't shade) |
| **Cyanosis** | SpO₂ (<85–88%) | blue-grey tint, lips/nailbeds first (`o_cyanosis`) | same overlay | badge + monitor |
| **Diaphoresis** | sympathetic (MI/shock/hypo) | specular sheen + forehead/upper-lip beads (`o_sweat`) | overlay sheen | badge |
| **Respiratory distress** | RR + work-of-breathing | ↑chest/shoulder excursion, accessory muscles, nasal flare, tripod, pursed lips (motion) | motion where mesh-driven (A2F/our rig); else overlay + posture frame | badge + audio cue |
| **Distress / affect** | persona agent | brow/mouth/gaze pose blended over visemes | same affect channel | vendor emotion (approximate) + badge |
| **Reduced LOC** | GCS / sedation | eye-open %, gaze drift, head droop, response latency, ptosis | same | badge + latency |

**Rule:** the dark vitals monitor stays **authoritative**; avatar, monitor, and words never contradict (single source: Case State + Vitals Engine). Every sign also has a **text equivalent** (WCAG "never colour/3D alone" — already implemented in `PatientHead3D`'s visually-hidden sign list), so meaning survives on a colour-blind, GPU-less, or badge-only (T2) display.

**Implication for tier choice:** because T1/T2 render a *healthy* face and we can only *overlay* signs on their pixels (weakly) but *drive* them natively on our mesh, **T0 is clinically superior for physical-exam-heavy cases even when a fancier tier is available.** T1/T2 are affect/communication upgrades, not physical-exam surfaces.

---

## 6. Demographic conditioning (age / sex / ethnicity), per tier

Demographics come from the case-generation engine, deterministically seeded by `caseInstanceId` (stable across the encounter; see `patientProfiles.ts`).

- **T0:** parametric — the seed selects skin tone, facial proportions (age), hair, headwear, and rig sex directly as R3F material/geometry params. No asset generation, no network, fully air-gapped. **Diversity is guaranteed by the parameter space, not by a model's training bias.**
- **T1:** the seed → a **generated still portrait** (open image model, e.g. SDXL/Flux-class, **pre-rendered at authoring time, off the pod, cached**) → LivePortrait/MuseTalk reenacts it, or A2F drives a mesh textured from it. Air-gapped if the image model + weights are bundled and generation is done offline into the case cache.
- **T2:** the same generated still feeds **Tavus image-to-replica / Anam persona** → a talking patient with that exact face, cloud-side. Network-only.

**Fairness guardrails (all tiers):** seed for **within-case consistency**; audit generated faces for **demographic diversity** and **no stereotype clustering by diagnosis** (e.g., don't let one ethnicity concentrate on one condition); **no real-person likeness** without consent; **C2PA + "synthetic patient" label on every frame** (EU AI Act Art. 50, live Dec 2026). Learner emotion is **never inferred** (EU-prohibited).

---

## 7. Pod-safety guardrails (the load-bearing rules)

The shared GPU pod runs LLM grading + voice and **wipes under disk/VRAM pressure**. These are hard rules, not preferences:

1. **NEVER run realtime video generation (Family C) on the shared pod.** No SadTalker/Hallo/EchoMimic/LTX/Hailuo inference, no per-frame diffusion, on the pod. Full stop — it is the single fastest way to OOM-evict grading/voice.
2. **T0 is the default and touches zero server GPU.** The realtime talking face runs on the *student's* device.
3. **If T1 is enabled, it runs on a physically/logically separate GPU** (dedicated node or queued burst worker), **never co-resident** with grading/voice. Enforce a **hard VRAM ceiling** and an **OOM guard** that fails *soft to T0*, never crashes the pod.
4. **No large weights or frame spool on the pod's disk.** Model weights (A2F ~1–6 GB, diffusion multi-GB) and any rendered-frame cache live on the T1 node or object storage — the pod stays lean so disk pressure can't wipe it.
5. **Batch/queue, don't stream, any server animation.** Pre-render idle/breathing loops and short reaction clips at **authoring time**, cached per case; do not generate video per conversational turn server-side.
6. **T1/T2 are opt-in and capacity-gated.** A concurrency cap + queue protects the isolated GPU; over the cap, sessions **degrade to T0**, which is always available.
7. **Air-gapped deployments are T0-only by default** (optionally T1 if the site provisions its own isolated GPU). T2 is impossible without network and is simply hidden there.

**Failure mode this prevents:** a naive "add an AI avatar" that spins up a diffusion model on the pod, spikes VRAM, and wipes the grading service mid-encounter. The architecture makes that structurally impossible: the realtime face is never on that GPU.

---

## 8. Decision summary

- **Default tier = T0: client-side lip-synced 3D** — the procedural R3F `PatientHead3D` AcuDx already ships, plus a client viseme channel (RPM + TalkingHead.js as an alternate rig). $0 GPU, realtime, EN/TR-capable, air-gapped, and **the only tier that renders clinical signs natively.** Add only the viseme/lip-sync channel; the demographic + sign + affect channels already exist.
- **T1 = open server animation of a demographic-matched still**, **Audio2Face-3D open weights preferred** (blendshapes→our mesh, so the sign shader survives; 1–6 GB, 30 FPS), or LivePortrait/MuseTalk reenacting a **cached, authoring-time** idle clip. **Gated, VRAM-capped, on a dedicated/isolated GPU or queued burst — NEVER the shared pod.** Degrades to T0 under load.
- **T2 = proprietary realtime API**, **Anam CARA-3 primary** (HIPAA/SOC-2, 180 ms), Tavus/HeyGen for the generated-face path and cheap-at-scale. Premium/OSCE/institution only, cloud-only, per-minute, **cannot shade signs**. Hidden in air-gapped installs.
- **Fast video-gen models (Hailuo H3, Seedance, Kling, LTX-Video) are NOT a realtime path** — async clip generators at $7.80–$22/min. Use only offline, off-pod, at authoring time, to pre-bake demographic idle clips for T1; watch Hailuo H3's open weights for that offline role.
- **Non-negotiables:** realtime video-gen never on the shared pod; the vitals monitor stays authoritative; every sign has a text equivalent; every synthetic face is C2PA + "synthetic patient" labelled, diversity-audited, and never a real likeness without consent; learner emotion is never inferred.

**Build sequence:** (1) add the client viseme channel to `PatientHead3D` → T0 talks (this quarter). (2) Ship the `PatientAvatar` driver interface so T1/T2 drop in. (3) Pilot T1 on an *isolated* GPU with A2F open weights + the OOM-soft-fail-to-T0 guard. (4) Offer T2 (Anam) behind the premium/institution flag, network-gated, C2PA-labelled.
