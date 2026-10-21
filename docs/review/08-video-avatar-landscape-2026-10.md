# 08. Patient video: Tavus or on-prem, and how the face follows the case (2026-10-21)

Owner: AI engineer and researcher. Scope: a decision-grade answer to "are we agreed on Tavus, and is there no open-source equivalent of the same quality as of October 2026", what AcuDx ships as the default, and the live evidence for the symptom-synced patient video (docs/architecture/18 section 6.6). Every vendor or model claim below carries the URL it was read from and the date it was read (all on 2026-10-21 unless stated). "Vendor" marks a number the vendor publishes about itself; "measured" marks a number from our own Lambda runs.

## 1. Decision

**Shipped default: on-prem.** The GPU worker renders the patient (LiveTalking + MuseTalk 1.5, already in production since 2026-10-20) and now also edits the case portrait into the patient's current state with FLUX.2 [klein] 4B (Apache-2.0), switching the live call's face, crossfaded, whenever the Clinical Director changes the state. Tavus stays an optional adapter: it runs only when a session asks for it by name or when the owner marks its registry row `extra.default: true` (owner decision 2026-10-21, relayed by the coordinator).

**Verdict on "same quality as Tavus".** As of October 2026 no open-weights model matches Tavus Phoenix-4.5's full-face realism (head motion, blinks, expressions, listening behaviour) in real time on one GPU. The only open model that claims comparable full-frame quality in real time, Alibaba's Live Avatar (14B, Apache-2.0), needs five 80 GB GPUs for 45 fps. The single-GPU real-time open models either re-render only the mouth (MuseTalk, what we ship) or generate the whole head at lower fidelity (SoulX-FlashHead Lite, AVTR-1). But Tavus's quality lead does not answer AcuDx's actual requirement: the patient must look ill in the way the case says. Tavus faces can show 11 moods and nothing else (no flush, sweat, pallor, mottling, cyanosis, jaundice, breathlessness), its policy bars faces of anyone under 18, it is US-hosted with HIPAA/BAA only on Enterprise, and it cannot run air-gapped. The on-prem stack can show the clinical signs, serves Turkish with our own voices, works under `AIRGAPPED=true` with an on-prem GPU, and costs a GPU-hour instead of 0.26 to 0.37 USD per minute.

**Recommendation: hybrid, on-prem by default.** Keep MuseTalk 1.5 plus the FLUX.2 klein appearance ladder as the default. Benchmark SoulX-FlashHead Lite (Apache-2.0, full head, 96 fps on one RTX 4090, vendor) as the next renderer on our own workers (section 5, not run in this pass). Offer Tavus only for adult, non-air-gapped, showcase sessions where a fully animated face matters more than visible clinical signs, with the illness carried by the voice, the words and a Phoenix emotion tag.

## 2. Tavus in depth

| Question | Answer | Source (read 2026-10-21) |
|---|---|---|
| Current rendering model | Phoenix-4.5, listed 2026-09-10: "134 ms from audio to video", first zero-shot Phoenix (about a one-minute preview from a photo, fine-tuned in about two hours), about 35 to 40 fps end to end (vendor). Phoenix-4 (2026-02-18 / press 2026-02-19): 40 fps at 1080p, head to shoulders including blinks, 10+ emotional states (vendor) | https://www.tavus.io/research ; https://www.menlotimes.com/post/tavus-announces-phoenix-4-5-a-new-state-of-the-art-in-real-time-human-rendering ; https://www.eagletribune.com/region/tavus-launches-phoenix-4-the-first-real-time-human-rendering-model-with-emotional-intelligence/article_f60315d5-1f3f-515a-9f85-4a2744d1e692.html |
| CVI end-to-end latency | "less than one second of latency between utterances" (launch post, 2024-08-15, now naming Phoenix-4.5); third-party reviews quote about 500 to 600 ms best case; no independent benchmark found | https://www.tavus.io/blog/introducing-the-worlds-fastest-conversational-video-interface-for-developers ; https://www.spatius.ai/blog/spatius-vs-tavus/ |
| Price and concurrency | Free 20 min, 1 stream; Starter 22 USD/mo 60 min, 1 stream; Builder 59 USD/mo 175 min + 0.35 USD/min, 3 streams; Growth 397 USD/mo 1,300 min + 0.31 USD/min, 10 streams; Business 975 USD/mo 4,000 min + 0.26 USD/min, 15 streams; Enterprise custom. Billing in 6 s increments with a 30 s minimum per conversation (research 14) | https://www.tavus.io/pricing ; docs/research/14-voice-video-stack-oct-2026.md section 1.1 |
| HIPAA, BAA, SOC 2, retention | "SOC2, HIPAA, BAAs, and compliance reports" and Zero Data Retention are Enterprise features only | https://www.tavus.io/pricing |
| EU / Turkey data | No data-residency statement on the pricing or trust material we could read. The create-conversation API documents a `policy: "eu"` field (research 14 table). Nothing for Turkey (KVKK). Treat any learner audio or video sent to Tavus as leaving the institution. | https://docs.tavus.io/api-reference/conversations/create-conversation (via research 14) |
| Self-hosted or VPC | Not offered in any public material we found. Tavus cannot run under `AIRGAPPED=true`. | search 2026-10-21, no result |
| Custom face | Photo path (zero-shot preview on Phoenix-4.5) or a video: one continuous 1080p shot, 30 s speaking then 30 s still. Custom faces only on Starter, Growth, Enterprise. The customer warrants the rights; the AUP requires explicit, informed consent of the person depicted (3.1) | https://docs.tavus.io/sections/faces/overview ; https://docs.tavus.io/sections/faces/phoenix-45-video-requirements.md ; https://tavus.io/acceptable-use-policy |
| Illness states | Emotions only: neutral, angry, excited, elated, content, sad, dejected, scared, contempt, disgusted, surprised, set by an `<emotion value="..."/>` tag before the text or steered through the system prompt; no parameter for skin colour, sweat, breathing or any physical sign | https://docs.tavus.io/sections/conversational-video-interface/quickstart/emotional-expression.md |
| Turkish | `tr` is one of the 42 spoken languages (`tavus-auto` TTS: Cartesia, else ElevenLabs); set with `languages: ["tr"]`; ASR coverage depends on the pinned STT engine | https://docs.tavus.io/sections/conversational-video-interface/language-support.md |
| Policy limits that bite for medical education | AUP effective 2026-04-14: no replica that depicts or appears to depict anyone under 18 (3.2), so paediatric cases cannot use Tavus; tailored medical advice needs a qualified professional (4.14) while "purely educational" health content is allowed with labelling, not aimed at minors (5.1); AI content must be disclosed to users (2) | https://tavus.io/acceptable-use-policy |

What the gateway does with Tavus now (server/voice/avatar/tavus.py, routes.py): our own LLM endpoint answers every Tavus turn from the call's case thread on the server (the persona gets the same breathless, pain, cough and drowsiness lines as the on-prem voice), each reply is prefixed with the Phoenix emotion that matches the state (`scared` when deteriorating or in marked pain or breathlessness, `sad` for milder illness, `dejected` when drowsy or unresponsive, `content` when improving), and a paediatric patient is refused with the AUP reason. The face itself stays the stock or trained Tavus face: it will look the same whether the patient has a fever, jaundice or shock.

## 3. On-prem real-time talking heads, October 2026

| Model | What it renders | Real-time evidence | GPU | Licence (code / weights) | Fit for AcuDx |
|---|---|---|---|---|---|
| **MuseTalk 1.5** in **LiveTalking** (shipped) | Mouth region (256 x 256) re-rendered over a prepared portrait loop | Measured on our workers: 94 to 101 fps per call alone, 84 to 94 fps with two calls on an H100; speech start 0.8 to 0.9 s steady EN; lips within 60 ms of the voice (docs/architecture/18 6.3.7, 6.3.8). Vendor: 30 fps+ on a V100 | Shares the worker card; about 3.5 to 7 GB | MIT / "any purpose including commercial"; LiveTalking Apache-2.0 | Production today. The face only moves by our idle loop, so the illness has to be in the portrait: hence the appearance ladder (section 4) |
| **SoulX-FlashHead 1.3B** (2026-02-12) | Full head from one image, streaming, infinite length | Lite: 96 fps or 3 concurrent 25 fps streams on one RTX 4090; Pro: 10.8 fps on a 4090, real time on two RTX 5090 (vendor) | 4090 class; VRAM not published | Apache-2.0 | Best single-GPU candidate for full-head motion and expressions; inference code and Lite/Pro weights public; needs a streaming port into our runner. Not benchmarked here (section 5) |
| **Live Avatar** (Alibaba, 2025-12, v1.1 2026-01-20, ECCV 2026) | Full frame, 14B (Wan2.2-S2V base) | 45 fps on five 80 GB GPUs with 4-step sampling; single 80 GB GPU only offline (vendor) | 5 x H800/H100 80 GB | Apache-2.0 (Wan base Apache-2.0) | Closest open quality to Tavus; five H100s per call (about 20 USD/hour on Lambda) rules it out per learner |
| **AVTR-1** (avaturn-live, 2026) | Portrait + speech and listening audio, 5-frame chunks | Real-time factor 2.2 on an A100, 2.4 on an L40 at 25 fps (vendor) | A100 / L40 | AVTR-1 Community Licence (free under 10 M USD revenue), InsightFace models non-commercial, streamer PolyForm Noncommercial; gated weights | Interesting listening behaviour; licence stack is the most restrictive here |
| **Ditto** (Ant Group, ACM MM 2025) | Motion-space diffusion + LivePortrait-style renderer | "Real-time" with an online pipeline, no fps published; TensorRT engines for Ampere+ (vendor) | A100 tested | Apache-2.0 code; weight licence not stated | Plausible A100 candidate; unmeasured |
| **LatentSync 1.6** (ByteDance, 2025-06-11) | Lip sync of an existing video at 512 x 512 | No speed claim, offline; 18 GB VRAM | 18 GB | Apache-2.0 | Offline only |
| **EchoMimic V3 / V3-Flash** (Ant, 2026) | 1.3B Wan-based head/body | No real-time claim; about 12 GB | 12 GB | Apache-2.0 | Offline clip generation |
| **Hallo3** (Fudan, CVPR 2025) | CogVideoX-5B I2V derivative | No speed claim; H100 tested | H100 | MIT code, bound by the CogVideo-5B licence | Offline |
| LivePortrait-driven pipelines (JoyVASA, FasterLivePortrait) | Keypoint motion + warping renderer | Renderer about 15 ms per frame on a 4090 (vendor), audio-to-motion not real time (JoyVASA) | 4090 | LivePortrait code permissive; InsightFace models non-commercial | Needs an audio-to-motion model we do not have |
| 2026 papers without confirmed open weights: Avatar-Forever (27.2 fps at 768 x 512 on one H100, 22B), Omni-LiveAvatar, OmniMate, DynaForcing, Talker-T2AV | | per arXiv abstracts | | not confirmed | Watch list |

Sources: https://github.com/TMElyralab/MuseTalk ; https://github.com/lipku/LiveTalking ; https://github.com/Soul-AILab/SoulX-FlashHead and https://arxiv.org/abs/2602.07449 ; https://github.com/Alibaba-Quark/LiveAvatar and https://arxiv.org/abs/2512.04677 ; https://huggingface.co/avaturn-live/avtr-1 ; https://github.com/antgroup/ditto-talkinghead ; https://github.com/bytedance/LatentSync ; https://github.com/antgroup/echomimic_v3 ; https://github.com/fudan-generative-vision/hallo3 ; https://arxiv.org/html/2608.12107v1 ; https://arxiv.org/pdf/2608.13602 ; https://arxiv.org/pdf/2607.23023 ; https://arxiv.org/pdf/2608.17707 ; https://arxiv.org/pdf/2604.23586 (all read 2026-10-21).

### 3.1 Scored comparison (1 poor to 5 best)

| Criterion (weight) | Tavus Phoenix-4.5 | MuseTalk 1.5 + appearance ladder (shipped) | FlashHead Lite (candidate) | Live Avatar 14B |
|---|---|---|---|---|
| Face realism and motion (3) | 5 | 3 | 4 (vendor demos) | 5 |
| Shows the case's clinical signs (3) | 1 (moods only) | 4 (measured, section 4) | 4 (same portrait ladder can drive it) | 4 |
| Real-time latency on our budget (2) | 4 (vendor, < 1 s) | 4 (measured, 0.8 to 0.9 s EN steady) | 4 (vendor) | 1 (5 GPUs) |
| Licence fit, noncommercial now and a commercial path (2) | 3 (paid SaaS, AUP) | 5 (MIT, Apache-2.0) | 5 (Apache-2.0) | 5 |
| Air-gap and data residency (2) | 1 | 5 | 5 | 5 |
| Turkish (1) | 4 | 4 (Chatterbox TR, ElevenLabs optional) | 4 | 4 |
| Paediatric cases (1) | 0 (AUP 3.2) | 5 | 5 | 5 |
| Cost per 15 min interview (1) | 2 (3.66 to 4.65 USD) | 4 (GPU-hour share) | 4 | 1 |
| Integrated and measured in AcuDx (1) | 2 (contract-tested, never live) | 5 | 1 | 1 |
| **Weighted total (max 80)** | **43** | **67** | **64** | **56** |

Weights reflect the owner's requirement that "video should be reflecting symptoms and in sync with lab results and case scenario". FlashHead's scores are vendor-based until it is benchmarked.

## 4. Per-case appearance: which generator

| Model | Task | Licence | Fit |
|---|---|---|---|
| **FLUX.2 [klein] 4B** (chosen) | Text-to-image and single-reference editing, 4 steps, about 13 GB VRAM (vendor) | **Apache-2.0** (open weights for commercial use) | Keeps the person and changes only what the prompt lists; fits our PolyForm Noncommercial licence and a future commercial licence; pinned revision `e7b7dc27` |
| FLUX.1 Kontext [dev] (12B) | Image editing | FLUX.1 [dev] Non-Commercial Licence (outputs usable commercially) | Fits noncommercial use only; larger |
| FLUX.2 [klein] 9B / [dev] | | FLUX Non-Commercial Licence | Same limit |
| Qwen-Image-Edit-2511 (20B) | Identity-preserving editing | Apache-2.0 | Good fit but about 40 GB in bf16 |
| SD 3.5 Large | Text-to-image | Stability Community Licence (free under 1 M USD revenue) | Weaker editing identity |
| Wan 2.2 (TI2V 5B, I2V 14B) | Image-to-video | Apache-2.0 | A 5 s 720p clip takes minutes; candidate for idle-loop clips later |
| LTX-2 / 2.3 | Image-to-video | LTX-2 Community Licence (paid above 10 M USD revenue) | Possible later |
| HunyuanVideo 1.5 | Image-to-video | Tencent Hunyuan Community Licence (territorial exclusions reported for the EU, UK, South Korea) | Avoid for a Turkish and EU audience |

Sources: https://huggingface.co/black-forest-labs/FLUX.2-klein-4B ; https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev ; https://venturebeat.com/technology/black-forest-labs-launches-open-source-flux-2-klein-to-generate-ai-images-in ; https://huggingface.co/qwen/qwen-image-edit-2511 ; https://huggingface.co/stabilityai/stable-diffusion-3.5-large ; https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B ; https://huggingface.co/Lightricks/LTX-2 ; https://huggingface.co/tencent/HunyuanVideo-1.5 ; https://magichour.ai/blog/ltx-2-3-vs-wan-2-2 (read 2026-10-21).

### 4.1 Visible clinical signs, on-prem only (owner decision 2026-10-21)

Decision: the patient's appearance is made by open-weight models on our own GPU worker, never by a hosted generator (no Higgsfield, no hosted image or video API). Hosted generators apply their own content filters, which refuse or soften exactly the findings a clinical case needs (rashes, burns, wounds, cyanosis). The model has to show real visible signs: petechiae, purpura and the non-blanching meningococcal rash, urticaria, jaundice and scleral icterus, cyanosis, pallor, mottling, diaphoresis, flushing, facial droop, periorbital oedema, facial and lip swelling, wounds and burns when the case states them on the face or neck, dehydration signs, distress and accessory muscle use.

What runs: FLUX.2 [klein] 4B (Apache-2.0) in our own image edit server on the worker (`/imagegen/edit`, infra/gpu-worker/cloud-init.yaml). The model card ships optional NSFW and protected-content inference filters; our server does not load them, and our own guardrails apply instead (server/voice/avatar/appearance.py):

* a sign is drawn only when the server case thread states it (exam text, triage note, history answers, Director state), in EN or TR, with negation ("no petechiae", "siyanoz yok") honoured; wounds and burns only where a head-and-shoulders portrait shows them (face, scalp, neck);
* every edit instruction says: a clinical teaching photo, fully clothed, head and shoulders only, no nudity, nothing sexual, and no blood or injury unless a wound or burn is listed; the clear-skin instruction ("no rash, no spots") is dropped only when a rash or lesion is listed;
* the case portraits are synthetic adults for the sign set; the runner's portraits of minors never get anything but the case's own findings, and the framing instruction above applies to every patient;
* the fever flush is an even tint added after the edit (tint.py), not drawn by the model (blotches in earlier tuning).

Options weighed for the signs the 4B model may draw weakly (licences read 2026-10-21):

| Model | Use | Licence | Verdict |
|---|---|---|---|
| FLUX.2 [klein] 4B | single-reference edit, 4 steps | Apache-2.0 (https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) | Kept; fits a 40 GB card next to the voices and the runner |
| Qwen-Image-Edit-2509 / 2511 (20B) | identity-preserving edit, multi-image input | Apache-2.0 (https://huggingface.co/Qwen/Qwen-Image-Edit-2509) | Best candidate for signs the 4B model misses; needs an 80 GB card or its own card on a multi-GPU worker (about 40 GB in bf16) |
| SD 3.5 Large + an inpainting mask (and a clinical-signs LoRA or IP-Adapter for identity) | lesion placed exactly where the mask says | Stability Community Licence, free for research, noncommercial and under 1 M USD revenue (https://huggingface.co/stabilityai/stable-diffusion-3.5-large) | Fits our PolyForm Noncommercial licence; worth it for rashes if a LoRA is trained on licensed clinical photos (none is bundled); not implemented |
| HunyuanImage 2.1 | text-to-image | Tencent Hunyuan Community Licence: does not apply in the EU, UK and South Korea, separate licence above 100 M MAU (https://huggingface.co/tencent/HunyuanImage-2.1/blob/main/LICENSE) | Excluded: a Turkish and EU audience |
| Wan 2.2 TI2V-5B / I2V-A14B | image-to-video (tachypnoea, shivering, rigors as motion) | Apache-2.0 (https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B) | Candidate for short motion loops of a prepared look; a 5 s 720p clip takes minutes (vendor: under 9 minutes on one consumer GPU for TI2V-5B), so only as a background job, never on the call path; not implemented |

The clinical-sign test set (scripts/clinical_sign_check.py, docs/media/live-avatar/signs/) edits one adult portrait per sign on the worker and scores each edit with a vision check; results are in section 5.1.

## 5. What was and was not tested live

Everything below ran on 2026-10-21 through a private gateway on this branch (port 8897, its own database) talking to Lambda workers it launched itself. Captures, metrics and the frames are in docs/media/live-avatar/state-sync/ (en/, tr/, prompt-tuning/, pool-status-two-workers.json).

**Fever case, end to end (community-acquired pneumonia, 1x H100 SXM, offload image mode)**

| Step | EN (42 M, photo p22) | TR (52 F, photo p35) |
|---|---|---|
| Case start: 4 pictures generated and the presenting look prepared (`POST /v1/voice/avatar/prepare`) | 73.2 s (each picture 9.5 s, prepare 31 s) | 72.9 s (9.5 s each, prepare 29.8 s) |
| Call session created (look already prepared) | 0.14 s prepare, about 1 s total | 0.14 s prepare, 0.62 s total |
| First video frame in the browser (through an SSH tunnel) | 11.6 s | similar |
| Runner speed | 86 fps inference (25 fps output) | 91 fps |
| Director step 1 (4 h, no treatment): SpO2 94 to 86, RR 32, drowsy | switched to the pre-built "worse" look 9 s after the step (reason `ladder_ready`) | exact look generated and switched 68 s after the step (`director:generated`) |
| Director step 2 (3 h more): SpO2 80, GCS 11 | switched to "critical" 36 s after the step | exact look switched 49 s after the step |
| Voice | speed 0.92 then 0.85, coughs spoken as "ahem," | speed 1.0 then 0.85, "öhö," |
| First audio chunk of a reply | about 1.5 s | about 1.5 s |

An earlier EN run (thread d387, photo p34) where the exact look was already prepared switched 339 ms after the Director step. The runner swaps frame sets in about 0.5 ms; the gateway round trip for `/switch` is 58 to 95 ms. Crossfade is 0.6 s.

What the face shows comes only from the server case thread: the spec plus the Director CaseState snapshot. Negated text ("no cyanosis") is ignored, peripheral cyanosis is not drawn on the face, and a sign the vitals no longer support is dropped. The fever flush is an even warm tint applied by the gateway (server/voice/avatar/tint.py), never drawn by the model; prompts that asked the model for a flush gave blotches and rash-like patches on 3 of 5 portraits (prompt-tuning/). The TR case lists pallor in the exam, so the TR ladder goes grey-pale; the EN case lists sweating and distress, so it shows sweat and strain.

**Pool**

* Two workers served at once (pool-status-two-workers.json): calls and LLM requests went to the least-loaded ready worker, a refused call triggered a scale-up, and idle workers were reaped one by one (an A100 was reaped after its idle window).
* 4x H100 SXM (gpu_4x_h100_sxm5): booted, but CUDA failed with error 802 because the NVSwitch fabric manager was not running. Stopped from the admin page (cost 5.63 USD). Cloud-init now installs and starts the fabric manager; that fix has not been seen working on a live 4x or 8x box yet.
* Image edits: about 9.5 s each in offload mode on an H100 that also runs vLLM and the runner; sequential mode took 154 s for the first edit before the warm-up at load was added.

**Not tested live**

* Tavus (no key in this environment).
* FlashHead Lite, Ditto and Live Avatar (not benchmarked; see section 6).
* 8x workers and a working multi-GPU layout (only the failed 4x boot above).
* A real browser on a phone network: frames went through an SSH tunnel to a headless browser.

Total GPU spend for this pass was 5 workers: three A100 (1.29 USD/h), one 4x H100 and one H100 (4.29 USD/h), all stopped and confirmed gone through the Lambda instances API.

### 5.1 Clinical-sign test set (2026-10-21)

One adult case portrait per sign, level 2 (marked), FLUX.2 [klein] 4B in offload mode on a Lambda A100 40 GB that also ran vLLM, the voices and the runner (about 10 to 12 s per edit), each edit scored by Claude (claude-opus-5-5) looking at the original and the edit: is the sign visible, is it realistic (would a clinician accept it as a photo of the finding, not paint or an exaggeration), is it the same person, what else was drawn. Sheets, pictures and scores: docs/media/live-avatar/signs/ (second round, with the phrases rewritten to keep natural skin tone) and signs/round1/.

| | Round 1 (first phrases) | Round 2 (natural-tone phrases, realism scored) |
|---|---|---|
| Visible | 14 of 19 | 12 of 19 |
| Visible and realistic | not scored | 1 of 19 (diaphoresis) |

What the model did: rashes came out as painted dots and ringed blotches (petechiae, purpura read as erythema multiforme, urticaria as vesicles), jaundice and pallor as flat paint over the face, scleral icterus as yellow irises, cyanosis as blue lipstick, the burn as punched-out bleeding wounds, the forehead wound with a loose suture thread; facial droop, the flush tint at level 2, respiratory distress and accessory muscle use were not visible on a still, closed-mouth portrait. The same person was kept in 16 of 19 (round 1) and 15 of 19 (round 2). Rewriting the phrases changed little: the 4B model at 4 steps follows "yellow" or "pale" as a colour fill.

Verdict: FLUX.2 [klein] 4B gives a visible cue for most signs but not a clinically realistic one, so it stays only for the mild, colour-light signs the live call uses most (sweat, mild distress, drowsiness, the tinted flush) and is not good enough for rashes, jaundice, cyanosis, burns or wounds. Next, in this order: run the same set with Qwen-Image-Edit-2509 (Apache-2.0, 20B) on an 80 GB worker card, and with FLUX.2 klein at more steps; for rashes and wounds, inpaint only a masked region of the face (SD 3.5 or Qwen inpainting) instead of editing the whole portrait; for motion signs (tachypnoea, shivering, accessory muscles), an image-to-video loop of the prepared look (Wan 2.2 TI2V-5B, Apache-2.0) as a background job. Until a model passes this set for a sign, the gateway should not draw that sign at level 2.

## 6. Open items

* SoulX-FlashHead Lite and Ditto were not benchmarked on our hardware in this pass. A bench host that serves its results over plain HTTP was refused by the session's permission policy; the next step is to add FlashHead Lite as a second renderer inside the worker image (its own container, behind Caddy and the bearer like the others) and measure fps, VRAM and SyncNet LSE-C / LSE-D against the MuseTalk recordings in docs/media/live-avatar/.
* Tavus has still never run against the live API (no key in this environment).
* Multi-GPU workers: the layout (runner and image edits on their own cards, four calls per runner) is in cloud-init, and the NVSwitch fabric manager fix is in, but no multi-GPU worker has served a call yet (section 5).
