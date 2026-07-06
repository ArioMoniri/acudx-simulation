# 10 — Realtime Patient Avatars (July 2026 refresh)

**Status:** Refreshes and supersedes the vendor specifics in `../architecture/04-avatar-and-vitals-engine.md` §4 (streaming tier). The *strategy* in arch/04 holds; this doc updates it to the July-2026 state of the art and adds the **generated-patient-face** synergy with the case-generation engine (`../00-overview/04-dynamic-cases-ehr-process.md`).

**Time context:** July 2026. Vendor and model facts web-verified (sources inline).

---

## 1. What AcuDx needs from an "avatar"

An embodied patient is worth building only if it improves learning without breaking the four constraints:
1. **Clinical-sign fidelity** — the face/body must be able to show *cyanosis, pallor, diaphoresis, respiratory distress, reduced level of consciousness, jaundice, Cushingoid facies* driven by the **Vitals & Physiology Engine**, and never contradict the monitor or the words. This is the medical differentiator, and it is exactly what generic talking-head vendors **cannot** do (they render a face, not a physiology-shaded face).
2. **Cost discipline** — streaming photoreal is $0.11–0.37/min; it cannot be the free-tier default (per `../00-overview/01-requirements-and-constraints.md` §3.1).
3. **Device floor + accessibility** — must degrade to a still portrait on a weak laptop/phone, and every avatar has a **full non-voice/text equivalent** (WCAG, arch/04).
4. **Safety/provenance** — synthetic media must be **C2PA-labeled + "synthetic patient" marked** (EU AI Act Art. 50, live Dec 2026); no real person's likeness without consent.

Conclusion: a **layered avatar** with one abstraction and swappable renderers — not a single vendor bet.

---

## 2. The July-2026 landscape

### 2.A Streaming photoreal talking-video (server-rendered, WebRTC)

Best for premium immersion / OSCE realism; server-side, per-minute cost, cannot render clinical-sign shaders.

| Vendor / model | Latency | Cost | Regulated? | Image→avatar | Notes |
|---|---|---|---|---|---|
| **Anam.ai — CARA-3** | ~180 ms response, sub-1 s median conversation, 25 fps @ 720×480 | overage **$0.11–0.16/min** (per-second billing; 30 free min); concurrency by tier (5 @ Growth, 10 @ Pro) | **HIPAA + SOC 2**, built for regulated/medical | yes (persona) | **Primary pick** for AcuDx premium/institution tier: regulated-ready, connect-any-LLM (Claude/open), thousands of concurrent sessions. [anam.ai/pricing](https://anam.ai/pricing) |
| **Tavus — Phoenix-4** | **sub-600 ms** end-to-end, WebRTC | **$0.37/min** over quota; 25 free min | enterprise SLAs | **image-to-replica from ONE photo** | Phoenix-4 = Gaussian-diffusion, emotional intelligence (Feb 2026). The **single-image → talking patient** path is the key synergy with generated cases. CVI pipeline Raven→Sparrow→STT→LLM→TTS→Phoenix. [marktechpost](https://www.marktechpost.com/2026/02/18/tavus-launches-phoenix-4-a-gaussian-diffusion-model-bringing-real-time-emotional-intelligence-and-sub-600ms-latency-to-generative-video-ai/), [tavus.io/cvi](https://www.tavus.io/cvi) |
| HeyGen LiveAvatar / Simli / Spatius / Avatario | ~0.3–1 s | ~$0.05–0.20/min | varies | some | Alternatives / cost-downside options; Simli cheapest streaming. |

### 2.B Client-rendered real-time 3D (controllable, ~$0 marginal)

Best for the **controllable clinical-sign channel** + offline-ish, device-local rendering.

- **Three.js + React-Three-Fiber** (WebGPU, WebGL2 fallback) with **Ready Player Me** rigs; **ARKit-52 blendshapes** as the interchange (arch/04 AV-3).
- **NVIDIA Audio2Face-3D** (open model / permissive SDK; [arXiv:2508.16401](https://arxiv.org/html/2508.16401v1)) — self-hosted, audio-driven ARKit-52 blendshapes for lip-sync + expression, composes additively with the clinical-sign overlay (sign channel ⟂ viseme channel).
- **Gaussian-splatting talking heads** — the realism frontier: **GaussianTalker** (real-time pose-controllable, [arXiv:2404.16012](https://arxiv.org/pdf/2404.16012)), **TaoAvatar** (real-time full-body AR, [arXiv:2503.17032](https://arxiv.org/pdf/2503.17032)), **TeGA** (high-res dynamic heads, [arXiv:2505.05672](https://arxiv.org/pdf/2505.05672)), **ESGaussianFace** (emotional/stylized 2026, [arXiv:2601.01847](https://arxiv.org/pdf/2601.01847)), **Universal Gaussian Head Avatars** ([arXiv:2509.18924](https://arxiv.org/pdf/2509.18924)). Use a splat head where it beats mesh for photorealism while keeping local control.

### 2.C 2D physiology-driven portrait (client SVG/CSS/canvas, $0)

The MVP embodiment and the always-available fallback: a stylized portrait whose expression + skin tone + effort + posture are shaded from `ClinicalSign.intensity`. Owns the clinical-sign channel even when a video/3D layer is on top.

---

## 3. AcuDx decision — one abstraction, four tiers

A single `PatientAvatar` component with a **driver interface** and pluggable **renderers**. Drivers are the same across renderers:
- **viseme/blendshape stream** ← Voice Pipeline TTS (Cartesia/ElevenLabs or open) — ARKit-52.
- **affect state** ← Persona Agent (emotion label + intensity).
- **clinical-sign intensities** ← Vitals & Physiology Engine (`ClinicalSign.intensity`, arch/04) — the channel vendors can't render, so it stays a client overlay.

| Tier | Renderer | When | Cost | Clinical-sign channel |
|---|---|---|---|---|
| **T0 (MVP, default/free)** | 2D physiology portrait (client) | everywhere; device floor | ~$0 | native (this IS the sign channel) |
| **T1 (v1, enhanced)** | client 3D: R3F + RPM + Audio2Face-3D lip-sync; optional Gaussian-splat head | capable devices | ~$0 (client GPU) | shader/blendshape overlay, additive |
| **T2 (premium/OSCE/institution)** | streaming photoreal: **Anam CARA-3** (primary, HIPAA/SOC2) or **Tavus Phoenix-4** | opt-in premium, high-fidelity OSCE, institution deals | $0.11–0.37/min | overlay client sign badges + keep the monitor authoritative (vendor face can't shade signs) |
| **T3 (research)** | on-device Gaussian-splat neural head | frontier demo | ~$0 | overlay |

Streaming is **premium-gated, never a free default** (arch/04 AV-4; requirements §3.1). Everything degrades to T0.

---

## 4. Synergy: a unique face for every generated case

The case-generation engine (`../00-overview/04-dynamic-cases-ehr-process.md` §3) produces demographics per unlimited, non-repeating case. Give each case a **consistent, unique face**:

1. Generate a **patient portrait image** from the case demographics (image-gen), deterministically seeded by `caseInstanceId` so it is stable across the encounter.
2. That portrait drives **T0** directly (stylized) and, for **T2**, feeds **Tavus Phoenix-4 image-to-replica** → a talking patient with that exact face. No per-patient recording session.
3. **Guardrails:** seed for **within-case consistency**; audit for **demographic diversity/fairness** across generated faces (no stereotype clustering by diagnosis); **no real-person likeness** unless consented (consented actor library for T2 personas remains an option); **C2PA + "synthetic patient" label** on all frames.

This is a genuine edge: competitors ship a fixed avatar library; AcuDx can render a **new believable patient every session**, face included.

---

## 5. Integration architecture (fits the canon)

- `PatientAvatar` sits in the EHR **Interview** tab / interaction dock, beside the dark vitals monitor; **avatar, monitor, and words never contradict** (single source: Case State + Vitals Engine).
- **Transport:** T2 streaming rides the existing **LiveKit** WebRTC layer (shared with voice/multiplayer, arch/03, arch/07). T0/T1 are local render — no extra transport.
- **Model access:** any avatar LLM still routes through the **Model Gateway** (open-weight-first, arch/02); Anam/Tavus "connect-any-LLM" points at our gateway endpoint, preserving the two-tier content boundary (the avatar **never sources clinical facts**).
- **Assessment:** avatar affect is presentation only; the learner's emotion is **never** inferred (EU-prohibited, arch/09). The sign channel's numeric intensities remain scoreable by Assessment (arch/06).

---

## 6. Recommendation & build sequence

1. **Now (B-phase):** ship **T0** in `web/` (physiology-driven 2D portrait, already present) and wire it to the vitals/sign state; add the `PatientAvatar` abstraction + driver interface so higher tiers drop in.
2. **v1:** **T1** client 3D (R3F + RPM + self-hosted Audio2Face-3D) with the clinical-sign shader overlay — the controllable, ~$0 realism step.
3. **Premium/OSCE:** **T2** via **Anam.ai** (regulated-ready) first; add **Tavus Phoenix-4** for the generated-face path; gate behind premium/institution plans; C2PA-label everything.
4. **Watch:** Gaussian-splat on-device heads (TeGA/ESGaussianFace/Universal GHA) for a future ~$0 photoreal T3.

## Key decisions for AcuDx
- **Layered avatar, one abstraction, four tiers** — 2D-signs-first (T0, $0) → client-3D (T1) → streaming photoreal (T2, premium) → splat (T3). Never bet on one vendor.
- **Anam.ai (HIPAA/SOC2, $0.11–0.16/min, 180 ms) is the premium primary; Tavus Phoenix-4 (image-to-replica) is the generated-patient-face path.**
- **The clinical-sign channel is non-negotiable and stays client-controlled** because no streaming vendor can shade cyanosis-at-SpO2; the monitor stays authoritative.
- **Every generated case gets a unique, consistent, C2PA-labeled synthetic face**, seeded by case id, diversity-audited, never a real likeness without consent.
- All avatar model traffic routes through the **Model Gateway**; avatars **never source clinical facts**; learner emotion is **never** inferred.
