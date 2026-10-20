# AcuDx: what is shipped, what needs the owner, what is a real limit

Last updated: 2026-10-20 (October 2026 build, phases P0 to P5 of `docs/review/01-multi-persona-review-and-roadmap-2026-10.md`). This replaces the September checklist; the Supabase-only auth path described there is superseded by the OIDC design in architecture doc 19.

## 1. Shipped

Each row names the owning architecture doc and the code it describes. "Shipped" means: merged on the integration branch, covered by Vitest or pytest, and free of mock or placeholder paths (the watchdog rules in `docs/process/AGENT-PROTOCOL.md` section 7).

| Capability | Doc | Code |
|---|---|---|
| Results and imaging engine: sourced reference ranges, kinetics (troponin, lactate, glucose, paracetamol, alcohol), synthesized 12-lead ECG with rule-authored pathologies, license-verified image bank with laterality guard, provenance on every result | [14](../architecture/14-results-and-imaging-engine.md) | `server/results/`, `server/results_routes.py`, `web/src/lib/resultsApi.ts` |
| Case generator v2 and Clinical Director: LangGraph graph, three-judge council plus deterministic high-stakes checks, repair loop, learner memory store, cost attribution, streamed progress, `503` instead of a silent template | [15](../architecture/15-case-generator-v2-and-director.md) | `server/orchestration/`, `web/src/lib/caseGenV2.ts` |
| Guideline store and verification: `GuidelineStatement` rows with URL or DOI, verifier that promotes a row only when the source passage is found, attending tips authored over verified rows, "guidance unavailable" state in the web app | [16](../architecture/16-guideline-store-and-verification.md) | `server/guidelines/`, `server/grounding.py`, `web/src/lib/guidelinesApi.ts` |
| Provider registry, admin console, telemetry: every provider kind configured and sealed server-side, probe, priority order, air-gap guard, per-call cost rows, OTel gen_ai spans (optional) | [17](../architecture/17-provider-registry-admin-telemetry.md) | `server/registry/`, `server/telemetry/`, `web/src/pages/AdminPage.tsx` |
| Voice and the patient video call: gateway-routed TTS and STT with provider switch, LiveKit room and avatar renderer rows (Simli, Anam), bundled talking head driven by the real audio, voice agent worker | [18](../architecture/18-voice-and-video-call.md) | `server/voice/`, `workers/voice_agent/`, `web/src/components/ehr/PatientCallTile.tsx` |
| Identity, roles and panels: OIDC PKCE sign-in, server-verified bearer tokens, roles from claims unioned with the `user_roles` table, dean cohort analytics from the hash-chained event log, faculty queue and assignments, admin users tab, Keycloak dev realm | [19](../architecture/19-identity-roles-and-panels.md) | `server/auth/`, `server/learning/`, `web/src/lib/auth.ts`, `web/src/pages/{DeanPage,FacultyPage,SignInPage}.tsx`, `deploy/keycloak/` |
| On-demand GPU worker: Lambda Cloud launch on demand, idle reaper, daily budget, ledger, worker image with vLLM, TTS and STT behind Caddy | [12](../architecture/12-air-gapped-reference-architecture.md), `server/README.md` | `server/providers/`, `infra/gpu-worker/cloud-init.yaml` |
| Interprofessional rooms: create, join by code, seats for doctor, nurse and paramedic, AI-held seats, order handoff, WebSocket snapshot relay | [07](../architecture/07-multiplayer-rooms.md) | `web/src/components/room/`, `multiplayer/server.mjs` |
| Launch kit: Docker Compose plus Caddy one-click deploy, brand kit, launch film and poster, README with real captures, e2e harness at four viewports, CI with web, pytest and Playwright jobs | [design/02](../design/02-brand-identity.md), `video/README.md`, `deploy/` | `deploy/one-click.sh`, `docker-compose.yml`, `web/public/brand/`, `video/`, `web/e2e/`, `.github/workflows/ci.yml` |

## 2. Needs the owner

Nothing below can be finished by an agent alone.

1. **Hosted provider keys** (optional). ElevenLabs, Deepgram, Simli or Anam, DeepInfra or OpenRouter. Entered in the admin console, never in the repo. Without them the platform runs entirely on the GPU worker; with `AIRGAPPED=true` hosted rows are refused.
2. **Lambda Cloud key and SSH key name** for the on-demand worker (`LAMBDA_KEY`, `LAMBDA_SSH_KEY_NAME`), or an alternative GPU host wired through the same provider interface.
3. **A domain name** for `DOMAIN=... ./deploy/one-click.sh`; Caddy obtains the certificate once the A record resolves.
4. **Identity provider choice**: Keycloak (default, dev realm shipped in `deploy/keycloak/`) or Supabase Auth as the managed option. The gateway only needs an OIDC discovery URL and a client id; `auth_mode=oidc` then makes verified identity mandatory.
5. **Clinician sign-off per condition.** No condition is learner-visible as verified until a licensed reviewer initials the 20-item checklist in `docs/review/02-clinical-content-review-2026-10.md` section 4 (coding, presentation, objective data, treatments and effects, guidance and citations, interprofessional content) and the sign-off record (name, credential, date, commit hash, citation URLs checked) is stored. The critical and major findings in sections 1 to 3 of that review are the fix list to work through first.
6. **Turkish listening test.** Chatterbox Multilingual against ElevenLabs on short clinical utterances with native speakers (`docs/research/14` section 5.4); the bundled reference voice is a stand-in for consented actor recordings.
7. **Licence choice and trademark search.** No LICENSE file is committed; the brand mark has had no trademark or reverse image search (`docs/design/02` section 7).

## 3. Honest limits

- **MuseTalk runner not shipped.** The self-hosted lip-synced face (LiveTalking plus MuseTalk through a LiveKit `AvatarRunner`) is specified in architecture doc 18 section 6.3 and the registry already routes `extra.avatar: musetalk`, but the runner has not been benchmarked on a GPU or written. Without a Simli or Anam row the call tile shows the bundled talking head, timed to the real audio and labelled "Text-timed animation".
- **Synthetic imaging offline only.** With a gateway, every image comes from the verified bank (real, licensed, laterality-checked) or the authored case record. Without a gateway the web app falls back to the curated bundle and to `syntheticNormalResult` values tagged "offline synthetic"; the ECG tracing is always synthetic and says so in its footer. No generated CT, MRI or echo is ever shown as diagnostic.
- **Paediatric reference ranges not authored.** `reference_ranges.json` holds adult bands with sources; CALIPER import and a clinical pathologist's sign-off are pending (doc 14 section 6). Paediatric cases therefore cannot be served with verified ranges.
- **ESC and AHA full texts not fetchable headlessly.** The verifier could not read the ESC landing pages, two AHA/ASA statements (JavaScript wall) and the Tokyo Guidelines; those rows stay `failed` and are never shown. The same thresholds are served from the verified open equivalents (NICE NG185, NG158, NG128). Doc 16 section 3 lists each row and its reason.
- **Mobile Problem list click interception.** At 390 px the Playwright click on the Problem list tab is intercepted by an overlapping element, so the e2e flow scrolls and forces the click; a learner on a phone may need a second tap. Tracked for the next UI polish pass, not fixed.
- **Rooms are a snapshot relay.** The relay forwards the latest room snapshot per channel (last write wins); room state is not server-authoritative and the room debrief is not yet derived from server events (roadmap P4).
- **No LTI launch, no roster import.** LTI 1.3 through ltijs and the SAML onboarding runbook are specified (doc 19 sections 8 and 11) but not implemented; learners sign in through OIDC or local profiles.
- **Cold GPU start is minutes.** A fresh worker pulls the vLLM image and about 19 GB of weights (`GPU_READY_TIMEOUT_S` defaults to 45 min). A pre-baked filesystem and a warm-on-schedule policy are the mitigation, both owner-configured.

## 4. How to continue

Work through section 2 in order; each item unblocks a phase exit gate in `docs/review/01` section 5. The next engineering items are the MuseTalk runner benchmark (doc 18 section 11), paediatric ranges (doc 14 section 6), server-authoritative rooms (P4) and the psychometric evidence pack (P6).
