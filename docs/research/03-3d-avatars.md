# 03 — 3D / Digital-Human Avatars for AcuDx (July 2026)

**Scope.** Embodied patients and team members rendered in a browser: real-time avatar/rendering options, audio-driven lip-sync + expression + emotion, rendering *clinical signs* (pallor, cyanosis, respiratory distress, diaphoresis, LOC, wounds, posture), performance/cost on low-end student laptops and mobile, streaming-vs-client-rendered trade-offs, and a progressive-enhancement path (2D → 2.5D → 3D). Every version/price/vendor claim is grounded and cited inline.

**TL;DR recommendation.** Do **not** start with photoreal 3D or a per-minute streaming-avatar vendor. Ship **2D-first**: a stylized portrait with a discrete clinical-sign layer + audio-driven viseme/expression lip-sync, rendered client-side (~$0 marginal cost). Reserve streaming photoreal avatars (Simli/HeyGen/Tavus/Anam) for a **premium tier and OSCE-realism cases** only, because at $0.05–$0.16/min they dominate cost at scale. Move to client-rendered 3D (Three.js + Ready Player Me / open Audio2Face) as a mid-tier once the 2D loop is validated. The **clinical-sign channel is the product**, not photorealism.

---

## 1. Why avatars matter here (and where they don't)

The clinical value of an embodied patient is **conveying examinable signs and affect**, not looking like a photograph. A learner taking a history must read: is the patient *diaphoretic and grey* (shock/MI), *cyanosed and tripoding* (respiratory failure), *drowsy/GCS-dropping* (sepsis, ↑ICP), *guarding* (peritonitis)? These are discrete, teachable, gradeable states. Photorealism that can't toggle "cyanosis: SpO2 82%" is decorative; a stylized face that *can* is pedagogically superior. This reframes the whole build: **avatar = state-driven clinical-sign renderer with a talking face bolted on**, not a talking face with signs bolted on.

Prior art confirms this is the right axis. Medical simulators already convey "skin mottling, cyanosis, ptosis, delayed capillary refill, tachypnea, fever" as discrete rendered states, and "Visual Patient" avatar systems change skin color from healthy to cyanotic as a function of SpO2 (Simulation in Healthcare / PMC; https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7105929/). Recent AI-driven virtual-patient work (psychotherapy-training avatars, arXiv 2606.17786; https://arxiv.org/pdf/2606.17786) uses Character Creator 4 + Azure TTS + **NVIDIA Audio2Face** for lip-sync — a stack we can partially adopt, minus its heavy Unity dependency.

---

## 2. Real-time rendering options (July 2026)

Two orthogonal decisions: **(A) where pixels are computed** — client-rendered vs server-streamed video — and **(B) how the face is built** — parametric mesh+blendshapes vs neural (Gaussian-splat / diffusion) talking head.

### 2A. Web 3D engines (client-rendered, mesh-based)

WebGPU crossed the line to production baseline in 2026. Safari shipped WebGPU by default in iOS 26 / iPadOS 26 / macOS Tahoe 26; Firefox 147 (Jan 2026) enabled it on Windows and ARM macOS; Chrome/Edge have had it since v113 — global coverage ~70%+ and climbing (web.dev; https://web.dev/blog/webgpu-supported-major-browsers; byteiota; https://byteiota.com/webgpu-2026-70-browser-support-15x-performance-gains/). This matters for battery and low-end laptops: same workload that drained a phone in 2h on WebGL runs ~3h on WebGPU, and Babylon reports ~10x faster scene rendering via render bundles (byteiota, above).

| Engine | Weekly downloads / status | WebGPU | Best for AcuDx | Notes |
|---|---|---|---|---|
| **Three.js / React-Three-Fiber** | ~2.7M/wk npm; dominant (utsubo; https://www.utsubo.com/blog/threejs-2026-what-changed) | Since r171, auto WebGL2 fallback | **Recommended** client-3D engine | Largest ecosystem, R3F fits our React UI, glTF+morph-target native |
| **Babylon.js** | Native WGSL shaders (2024); WebGPU since v5.0 | First-class, ~10x render bundles | Strong alt; better built-ins | Heavier; less React-idiomatic |
| **PlayCanvas** | Lightweight, fast load | Yes | Good if load-time critical | Smaller talent pool |
| **Unity WebGL** | Large builds (20–60MB+), slow TTI | Via WebGPU backend | **Avoid for web** | Great authoring, poor web delivery; reserve for native app if ever |

Sources: Babylon WebGPU docs (https://doc.babylonjs.com/setup/support/webGPU); Cinevva engine comparison (https://app.cinevva.com/blog/2026-06-09-web-game-engines-2026-comparison.html).

**Decision:** **Three.js + React-Three-Fiber**, WebGPU renderer with automatic WebGL2 fallback. This is the client-3D substrate for the mid/high tier. Unity WebGL is rejected for delivery weight.

### 2B. Avatar body/rig sources

- **Ready Player Me** — free avatar SDK; GLB export ships **ARKit-compatible blendshapes** (52 standard) *and* Oculus visemes, half- and full-body, drives directly from ARKit `ARFaceAnchor.BlendShapeLocation` (docs.readyplayer.me; https://docs.readyplayer.me/ready-player-me/api-reference/avatars/morph-targets/apple-arkit). Stylized-but-credible; low poly; ideal for our "state-driven face" approach. **Recommended base rig.**
- **MetaHuman** — now integrated into **Unreal Engine 5.6** (June 2025); the web MetaHuman Creator was **sunset** (no new web users) (metahuman.com/news; https://www.metahuman.com/news/metahuman-leaves-early-access-with-a-feature-packed-new-release). Licensing loosened June 2025: MetaHumans usable in **any engine / DCC** (Unity, Godot) and sellable, under the UE EULA (free under $1M revenue) (CG Channel; https://www.cgchannel.com/2025/06/you-can-now-sell-metahumans-or-use-them-in-unity-or-godot/). But MetaHuman-in-browser is a heavy pipeline (glTF conversion, 52 ARKit blendshapes drivable manually; metahuman.jonasjohansson.se; https://metahuman.jonasjohansson.se/). **Photoreal but expensive to run at web scale — reserve for premium.**

### 2C. Photoreal digital-human / streaming-avatar vendors (server-rendered video)

These stream WebRTC video of a photoreal face driven by your audio/text. You pay **per minute of stream** — the dominant cost variable at scale.

| Vendor | Model | Latency | Price (2026) | Notes |
|---|---|---|---|---|
| **Simli** | Neural, **3D Gaussian-splat** face; full-face animation | **<300 ms** | **$0.05/min** PAYG; $10 free + 50 min/mo | Cheapest credible real-time; WebRTC; Pipecat/VideoSDK plugins (Simli; https://www.simli.com/; verda blog; https://verda.com/blog/how-simli-achieved-cost-efficient-real-time-inference-for-interactive-ai) |
| **HeyGen LiveAvatar** | Photoreal video avatar | "near-instant," was 2–3s early | **1 credit ($0.10) = 30s Full / 60s Lite** → ~$0.10–0.20/min; up to 40 concurrent (HeyGen; https://help.heygen.com/en/articles/12758516-introducing-liveavatar) | Best photoreal fidelity; pay-as-you-go from $5 in 2026 |
| **Tavus** | Conversational video (CVI) | Real-time | Starter $59/mo ≈ 100 min; Growth $299/mo ≈ 500+ min; per-min beyond (Tavus; https://www.tavus.io/pricing) | "PALs" persistent-memory avatars; 3 concurrent (Starter) |
| **Anam** | Real-time interactive | Real-time, billed per second | **$0.11–0.16/min** by tier (Starter $0.16 → Professional $0.11); Free 30 min/mo; 1–10 concurrent (Anam; https://anam.ai/pricing) | Transparent per-min; low concurrency on cheap tiers |
| **D-ID** | Talking-photo / agents | Real-time streaming | API ≈ **$0.05/s (~$3/min)**; Build tier $18/mo ≈ 32 min stream (D-ID; https://www.d-id.com/pricing/api/; heyfish; https://heyfish.ai/d-id-review) | Rounds up to 15s; minutes don't roll over; strong "talking photo" 2D path |
| **NVIDIA ACE / Audio2Face** | SDK/microservice, not a hosted stream | Real-time | **Free / open-source** models + SDK | Self-host; you supply GPUs; see §3 |
| **Convai** | NPC platform on ACE (Riva ASR + Audio2Face) | Low-latency | Platform pricing | Character-focused; ACE-based |

**Dead vendor — do NOT design around it:** **Soul Machines ceased operations February 2026** (per 2026 vendor reporting; Tavus/digitalhumans comparisons; https://www.digitalhumans.com/blog/the-best-digital-human-providers-platforms-comparison-rankings-2026). Any tutorial or ADR referencing Soul Machines "Digital People" as a live option is stale.

**Cost reality check.** A single 12-minute encounter on a photoreal stream costs ~$0.60 (Simli) to ~$2.00 (Anam Starter / HeyGen Full / D-ID API). At 10,000 encounters/month that's **$6k–$20k/month in avatar streaming alone** — before LLM, TTS, STT. This is why streaming avatars must be gated to premium/OSCE tiers, not the default.

### 2D. Neural / Gaussian-splatting talking heads (the fast-moving frontier)

3D Gaussian splatting (3DGS) is now the dominant research substrate for real-time photoreal talking heads. 2025–2026 work: **GaussianEmoTalker** (real-time *emotional* talking head, audio-driven + blendshape-based 3DGS; arXiv 2607.00959; https://arxiv.org/abs/2607.00959), **GaussianHeadTalk** (wobble-free, WACV 2026; https://www.research.ed.ac.uk/en/publications/gaussianheadtalk-wobble-free-3d-talking-heads-with-audio-driven-g/), **SyncTalk++** (arXiv 2506.14742), **Avat3r** (animatable Gaussian reconstruction of heads). Simli's production API already runs a **Gaussian-splat neural face** with full 3D control (not video lip-sync overlay) at <300 ms — the clearest proof this is shippable, not just papers.

**Strategic read:** 3DGS gives photoreal per-person avatars but needs GPU inference (server-side today) and per-subject capture/training. For AcuDx, this is a **buy (Simli) not build** decision until at least 2027; splat rendering *in-browser* is emerging but immature for driven, emotive faces. Diffusion 2D talking heads (VASA-1-class, FantasyTalking2 at AAAI 2026; AniPortrait; LivePortrait) are alternatives but are compute-heavy and, for VASA-class, deliberately unreleased for deepfake-safety reasons — **not a dependency to build on**.

---

## 3. Lip-sync, facial expression, emotion (the audio→face pipeline)

The core loop: **TTS audio → visemes/blendshape weights → morph-target animation on the mesh**, plus an **emotion channel** and a **clinical-state channel** (§4).

### 3A. Blendshape/viseme standard: converge on ARKit-52

Standardize on the **ARKit 52 blendshape set** as the interchange format. Rationale: it's the de-facto industry standard, Ready Player Me exports it, MetaHuman is drivable by it, and — critically — **NVIDIA open-sourced Audio2Face-3D in Sept 2025, which emits ARKit blendshapes with emotion** (NVIDIA blog; https://developer.nvidia.com/blog/nvidia-open-sources-audio2face-animation-model/; HF nvidia/Audio2Face-3D-v3.0; https://huggingface.co/nvidia/Audio2Face-3D-v3.0). Licensing: models under **NVIDIA Open Model License**, SDK (C++/Python) **MIT**, training framework **Apache** — permissive enough to self-host and fine-tune (NVIDIA/Audio2Face-3D-Samples; https://github.com/NVIDIA/Audio2Face-3D-Samples).

**Two lip-sync tiers:**

1. **Cheap client-side visemes (default).** Map TTS phoneme/timing output (or a lightweight in-browser viseme model) to the ~15 Oculus/ARKit viseme shapes. Works offline, $0 marginal, "good enough" for a stylized RPM face. Combine with jaw + minimal co-articulation. This is the 2D/2.5D default.
2. **Audio2Face-3D microservice (premium client-3D).** Self-hosted A2F converts audio → ARKit blendshapes + **audio-detected emotion** (or explicitly specified emotion), streamed to the Three.js mesh. Higher fidelity, needs a GPU, but avoids per-minute vendor fees — you amortize GPU cost across many concurrent sessions. Recommended for the mid-tier 3D once volume justifies a GPU box.

For **fully photoreal**, emotion+lip-sync come bundled inside the streaming vendor (Simli/HeyGen/Anam) — you send audio, they return the emotive face. No pipeline to build; you just pay per minute.

### 3B. Emotion channel

Drive an explicit `emotion` enum (neutral, anxious, distressed, angry, drowsy, sedated, tearful, stoic) from the **patient-agent LLM state**, not just from audio prosody. This keeps affect *pedagogically controllable* (e.g., the "aggressive patient" or "anxious patient" variants in the AcuDx spec must reliably read as such). A2F can take emotion as explicit input; RPM/Three.js can blend an emotion pose over the viseme animation. The LLM already tracks emotional state for dialogue — reuse it to weight blendshapes.

---

## 4. Rendering clinical signs (the differentiating layer)

This is where AcuDx wins or loses as a *medical* tool. Treat clinical signs as a **separate, physiology-driven render channel** on top of the face/body, parameterized by the simulation's vital-sign model (the existing AcuDx vitals monitor — HR/BP/RR/SpO2/Temp — becomes the driver).

| Sign | Rendering technique | Driver |
|---|---|---|
| **Cyanosis** (central/peripheral) | Shift skin/lip albedo toward blue-grey via shader tint; lips/nailbeds first | SpO2 threshold (e.g., visible <85–88%) |
| **Pallor** | Desaturate + lighten skin albedo | Hb / shock state / vasovagal |
| **Diaphoresis** | Specular/roughness map overlay (wet sheen) + optional normal-map beads on forehead/upper lip | Sympathetic state (MI, shock, hypoglycemia) |
| **Flushing / fever** | Warm albedo tint, cheeks/forehead | Temp / sepsis / anaphylaxis |
| **Jaundice** | Yellow tint skin + sclera | LFT state |
| **Respiratory distress** | Animation: ↑RR chest/shoulder excursion, accessory-muscle use, nasal flaring, tripod posture, pursed lips | RR + work-of-breathing param |
| **Level of consciousness** | Eye-open %, gaze fixation, head droop, response latency, ptosis; GCS-mapped | GCS / sedation param |
| **Mottling / cap refill** | Skin mottling texture (legs/knees); cap-refill as a triggered exam animation | Perfusion state |
| **Wounds / trauma / rashes** | Decal/texture layer at body region; bleeding as animated decal | Injury model (ATLS cases) |
| **Posture / guarding** | Body-rig poses: guarding, fetal, tripod, seizure, hemiplegia droop | Pain/neuro state |

**Design rules.**
- **Physiology-driven, not scripted.** Signs interpolate off the same vitals engine that feeds the monitor, so the avatar and monitor never contradict — a documented failure mode when they're separate systems.
- **Gradeable + explainable.** Each sign has a numeric intensity the assessment layer can score ("missed central cyanosis at SpO2 80%"). This feeds the gap-analysis / Dunning-Kruger feedback.
- **Shader-parameter approach beats asset-swapping** for continuous signs (cyanosis, pallor, diaphoresis, flushing) — one material with uniforms (`o_cyanosis`, `o_pallor`, `o_sweat`, `o_flush`) is cheap on low-end GPUs and animates smoothly. Discrete signs (wounds, rashes) use decals.
- **This layer is renderer-agnostic** and should exist even in the 2D tier as portrait variants / overlays — it's the part that *must* ship in Phase 1.

**Constraint on streaming vendors:** photoreal streaming avatars (Simli/HeyGen/Anam) do **not** expose clinical-sign shader controls — you get a healthy face talking. This is a decisive reason to keep client-rendered (2D/3D) as the primary path where signs matter, and treat streaming photoreal as an affect/communication upgrade, not a physical-exam surface.

---

## 5. Performance, cost, bandwidth on low-end hardware

Target device floor: a 4–5-year-old student laptop (integrated GPU, WebGL2-only possible) and mid-range phones on 4G.

### Client-rendered (Three.js / RPM)
- **GPU/CPU:** Stylized RPM avatar (~10–20k tris) + blendshape morphs is trivial for integrated GPUs at 30–60 fps; WebGPU gives battery + headroom, WebGL2 fallback covers the floor. Real-time facial AR at 58 fps on iPhone 15 for 4K frames is already demonstrated (byteiota, above) — our stylized load is far lighter.
- **Bandwidth:** avatar asset (GLB) is a **one-time ~2–8 MB download**, then only tiny animation/parameter streams (blendshape weights, vitals) over the existing WebSocket — **near-zero ongoing bandwidth**. Ideal for weak connections and mobile data.
- **Marginal cost:** ~**$0** compute (runs on the student's device). This is the decisive economic argument.

### Server-streamed (Simli/HeyGen/Anam)
- **Bandwidth:** continuous **WebRTC video** — typically ~0.5–2.5 Mbps down per session; strains weak/mobile connections and shows the "2–3s awkward delay" if the link is poor.
- **Client load:** trivial (just decode video) — *better* for the weakest devices in raw GPU terms, but worse for network and for battery on cellular.
- **Marginal cost:** $0.05–$0.20/min server-side (§2C) + your GPU/egress. Scales linearly with usage — the cost wall.

**Trade-off summary:**

| Axis | Client-rendered (2D/3D) | Server-streamed photoreal |
|---|---|---|
| Marginal $/encounter | ~$0 | $0.60–$2.00 (12 min) |
| Bandwidth (ongoing) | Near-zero | 0.5–2.5 Mbps continuous |
| Weak-device GPU | Fine (stylized) | Best (decode only) |
| Weak network | Best | Worst |
| Clinical-sign control | **Full** (shaders) | **None** |
| Photorealism | Stylized | Photoreal |
| Offline / air-gapped campus | Possible | Impossible |

**Verdict:** client-rendered is the correct default on *both* cost and clinical-control axes; streaming is a fidelity upsell that trades away sign-control and adds a per-minute meter.

---

## 6. Progressive enhancement: 2D → 2.5D → 3D

Ship value at each tier; never block Phase 1 on 3D.

- **Tier 0 — 2D portrait + expressions (Phase 1, weeks).** Static/illustrated patient portrait per persona (geriatric, pediatric-via-parent, anxious, etc.), with a **discrete expression/emotion set** (image variants or Live2D-style rig) and the **full clinical-sign overlay layer** (cyanosis/pallor/diaphoresis/distress as image states or CSS/canvas shader tints). Audio lip-sync via simple mouth-shape swap or a 2D talking-photo (D-ID talking-photo, ~$3/min, only if voiced photoreal is wanted; otherwise text + expression is enough). **Cheapest, fastest, and already carries the pedagogical payload.**
- **Tier 1 — 2.5D (Live2D-style / layered rig).** Same portrait, but rigged in layers (Live2D Cubism or a canvas/WebGL 2.5D rig) for parallax head turn, blink, breathing excursion, brow/mouth blendshapes, sweat overlay. Adds *life* and better breathing/distress animation at still ~$0 marginal cost, no full 3D asset pipeline.
- **Tier 2 — Full 3D, client-rendered (mid-tier).** Three.js/R3F + Ready Player Me GLB + ARKit-52 blendshapes; visemes client-side or via self-hosted Audio2Face-3D; full shader-driven clinical-sign channel; body rig for posture/guarding. Enables multiplayer rooms with multiple embodied roles at ~$0 marginal. **The realistic "real" AcuDx avatar.**
- **Tier 3 — Photoreal streaming (premium / OSCE-realism).** Simli (cheapest, $0.05/min, Gaussian-splat) as default photoreal; HeyGen LiveAvatar for max fidelity; gated to premium subscribers and high-stakes exam-style encounters. Accept loss of clinical-sign shader control here; use for communication/affect realism.

**Guardrail:** every tier must render the **same clinical-sign state** consistently, because a case authored once (SpO2 82% → cyanosis) must present correctly whether the learner is on the free 2D tier or premium streaming tier. Author signs against the **abstract vitals/state model**, render per tier.

---

## 7. Recommended phased AcuDx avatar strategy

- **Phase 1 (MVP, now):** Tier 0 — 2D persona portraits + emotion set + **clinical-sign overlay driven by the existing vitals engine**. Text/voice dialogue with simple mouth-sync. This ships the medical differentiator with ~$0 avatar cost. Build the **abstract sign/state schema** now — it's the load-bearing contract for every later tier.
- **Phase 2:** Tier 1 (2.5D Live2D rig) for breathing/distress/blink realism + Tier 3 **pilot** — integrate **Simli** ($0.05/min, <300 ms, WebRTC) behind a feature flag for a *premium/OSCE* photoreal patient, to validate demand and UX before committing to 3D pipeline cost.
- **Phase 3:** Tier 2 full client-3D — Three.js/R3F + Ready Player Me + ARKit-52; adopt **open-source Audio2Face-3D** (self-hosted, MIT/Apache/Open-Model license) for GPU-amortized lip-sync+emotion; port the clinical-sign shader channel to 3D materials; enable multi-role embodied multiplayer rooms.
- **Phase 4 (opportunistic):** Evaluate in-browser Gaussian-splat driven faces as the tech matures (track GaussianEmoTalker/GaussianHeadTalk line) to potentially collapse the streaming per-minute cost into client rendering. Do **not** commit before it's proven for driven, emotive, sign-controllable faces.

---

## Key decisions for AcuDx

1. **2D-first, clinical-signs-first.** Phase 1 avatar = 2D persona portrait + emotion set + **physiology-driven clinical-sign overlay** (cyanosis/pallor/diaphoresis/distress/LOC), driven by the existing vitals engine. The sign channel is the medical differentiator and must ship first; photorealism is deferred.
2. **Author against an abstract sign/state schema, render per tier.** One case authored once (e.g., SpO2 82% → central cyanosis, intensity X) must render identically across 2D/2.5D/3D/streaming. This schema is a Phase-1 contract.
3. **Standardize on ARKit-52 blendshapes** as the interchange format across all tiers (Ready Player Me exports it; MetaHuman drivable by it; NVIDIA open Audio2Face-3D emits it).
4. **Client-rendered is the default** (Three.js + React-Three-Fiber, WebGPU with WebGL2 fallback; Ready Player Me base rig) at ~$0 marginal cost, near-zero ongoing bandwidth, and — decisively — **full shader control of clinical signs**, which streaming vendors cannot expose.
5. **Streaming photoreal is a gated premium/OSCE upsell, not the default.** At $0.05/min (Simli, Gaussian-splat, <300 ms) to $0.11–0.20/min (Anam/HeyGen), a 12-min encounter costs $0.60–$2.00; 10k encounters/mo = $6k–$20k/mo in streaming alone. Gate it.
6. **Preferred streaming vendor = Simli** (cheapest credible real-time, 3D neural/Gaussian-splat, <300 ms, WebRTC, Pipecat/VideoSDK plugins); HeyGen LiveAvatar for max fidelity. **Do NOT design around Soul Machines — it ceased operations Feb 2026.**
7. **For client-3D lip-sync+emotion, self-host open-source Audio2Face-3D** (NVIDIA Open Model + MIT SDK + Apache training framework) to amortize GPU cost across sessions and avoid per-minute vendor fees; use cheap client-side visemes for the free tier.
8. **Reject Unity WebGL** for web delivery (build weight/TTI); keep **MetaHuman** for premium only (web Creator sunset; UE-integrated, heavy browser pipeline). Track Gaussian-splat in-browser (GaussianEmoTalker/HeadTalk line) as the Phase-4 path to collapse streaming cost into client rendering.
