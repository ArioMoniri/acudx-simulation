# Codebase audit (read-only), 2026-10-19, HEAD 50a3380

Produced by the audit agent. Three parts: `web/` (Vite 6, React 18, TS, vitest), `server/` (FastAPI gateway), `multiplayer/` (ws relay). No Dockerfile, no docker-compose, no committed `.env.example`.

## 1. Structure

Routes (`web/src/App.tsx`), all behind a client-side `AuthGate`; `RoleGate` reads `profile.role` from localStorage.

| Route | Page | Gate |
|---|---|---|
| /signin | SignInPage | public |
| /profile, /account | ProfilePage | public until onboarded |
| / | HomePage | signed in |
| /welcome | LandingPage | signed in |
| /authoring | AuthoringPage | roles educator, dean |
| /start, /cases, /rooms, /rooms/:id, /encounter, /feedback, /progress, /exam, /atlas | respective pages | signed in |
| /institution | InstitutionPage | role dean |

Encounter data flow: EncounterPage picks the case (library pick, offline `generateCase`, else hardcoded `chestPainNstemiCase`); "New random case" calls `fetchGeneratedCase` (POST /v1/case/generate) with offline fallback. `encounterStore` schedules `setTimeout(resolveOrder, playbackMs)` for results (client-side turnaround simulation). `orderables.syntheticNormalResult` invents normal values for orders the case lacks. Vitals from `clinicalCourse.ts` (deterministic). Guidance from `guidanceEngine.ts` with `/v1/ground` and `LOCAL_GUIDELINES` fallback. Interview: `/v1/patient/turn` when live, else client scope guard plus canned `GREETING_REPLIES` and `CLARIFY_REPLIES` and a 900 ms fake typing timer. Grading: `/v1/grade` with local verdict fallback. Progress persisted in localStorage.

Server endpoints: GET /health, GET /status, POST /v1/guard, /v1/patient/turn (scripted deflection fallback), /v1/grade, /v1/case/generate (template fallback), /v1/ground (hashing-embedding fallback). No auth on any endpoint. CORS allows localhost regex.

## 2. Mock, placeholder, hardcoded, demo inventory

| File:line | What | Stands in for |
|---|---|---|
| web/src/data/mock.ts:127-173 | 5 citations without URL or DOI | guideline registry |
| web/src/data/mock.ts:175-203, 382-425 | guidanceHints, recommendedCases fallback | grounded guidance, recommender |
| web/src/data/seedCases.ts:251 | chestPainNstemiCase default encounter | case assignment |
| web/src/pages/EncounterPage.tsx:152, RoomPage.tsx:235 | seed case fallbacks | case selection |
| web/src/data/rooms.ts:2-7,158-332,399,482 | fake participants, seed rooms, acsFloor transcript, acsDebrief scores | LiveKit presence, team assessment |
| web/src/components/room/DebriefPanel.tsx:53, RoomPage.tsx:534 | hardcoded debrief scores always shown | real team assessment |
| web/src/components/room/roomStore.ts:236 | seedState loads SEED_ROOMS | room persistence |
| web/src/components/room/roomCaseStore.ts:178-196,615-632 | AI teammates scripted via setTimeout | AI or human teammates |
| web/src/pages/RoomPage.tsx:298 | setInterval fake speaking indicator | voice activity |
| web/src/state/encounterStore.ts:416 | setTimeout result turnaround | result feed |
| web/src/domain/orderables.ts:1191 | syntheticNormalResult | authored results |
| web/src/components/ehr/tabs/InterviewTab.tsx:91,106,482 | canned replies, fake typing | LLM patient |
| server/app.py:49,55 | _INJECTION_REPLY, _SCRIPTED_DEFLECTION | model reply |
| web/src/data/authoring.ts:1137-1253 | sampleBlueprint, "Dr. Elif Kaya", versionHashes | reviewer identity |
| web/src/data/institution.ts:484-617 | static accreditation catalog and crosswalk | real crosswalk |
| web/src/pages/InstitutionPage.tsx:144,184 | "needs a connected institution data source" | institution data |
| web/src/data/landing.ts, startOptions.ts, progress.ts, guidance.ts | static content | config and curriculum services |
| web/src/domain/caseGen.ts:241-247; lib/guidanceEngine.ts:440-533 | generic tepdad-em citation on condition-specific advice | per-condition guidelines |
| web/src/lib/liveCaseGen.ts:727-767,959 | free-text citationId | registry lookup |
| server/case_fixtures.py:136 | 55 condition fixtures, name pools | authored content |
| server/case_generator.py:426-619, 821-825 | made-up guide titles "(summary)", hardcoded PMH | guideline references |
| server/guidelines_seed.py | 51 in-memory records, reviewed_date all 2026-06-01 | guideline store |
| web/src/lib/speechInput.ts | dead code | n/a |

## 3. Citations

Web `Citation` has no URL, DOI or version. Five ids: esc-acs-2023, nice-ng185, nice-ng228, tepdad-em, titck-formulary. Tags without records: NICE NG51, BTS/SIGN, TEPDAD-UCEP 2024. Server seed has checkable URLs for NICE, ESC, AHA DOIs, WHO, GOLD, BTS, JBDS, IDSA, Tokyo Guidelines, SSC; weak homepage-only citations for saglik.gov.tr, tepdad.org.tr, who.int/emergencycare, toxbase, endocrine.org, ukkidney, RCOG browse. `has_citation()` only checks non-empty fields. Nothing verifies URL resolution or statement-source match.

## 4. Identity

No password, SSO or LTI. Profile in localStorage. Roles student, resident, educator, dean are self-chosen on ProfilePage, so dean and authoring gates mean nothing. No admin page, tenant model, audit log, roster, review queue or server-side auth.

## 5. Testing

Vitest: 9 files, ~160 cases, pure domain logic only. No component tests, no e2e, no Python tests (smoke_test.py asserts only the injection check). CI runs the web job only. `lint` script has no ESLint config.

## 6. Voice and video

ElevenLabs TTS and STT are real but exist only as Vite dev-server middleware (vite.config.ts); absent from server and production. Lip-sync is text-estimated visemes on a timer. 33 pre-generated silent talking-head loops, not lip-synced. Symptom overlays are CSS over a static synthetic photo driven by vitals.

## 7. Imaging and labs

Curated bundle (37 Wikimedia CC files) first, then a live browser call to commons.wikimedia.org that can return a wrong image. Echo GIF and axial CT stack from TotalSegmentator atlas. Labs from case truth or syntheticNormalResult. Public assets ~170 MB.

## 8. Config and deploy

Server env via pydantic-settings (LLM_*, OPENAI_*, EMBED_*, RERANK_*, AIRGAPPED, HOST, PORT, CORS_ORIGINS). Web env VITE_BACKEND_URL, VITE_MULTIPLAYER_URL. deploy.sh is rsync plus venv; start scripts hardcode /data paths. No production web serving, no reverse proxy, no HTTPS.
