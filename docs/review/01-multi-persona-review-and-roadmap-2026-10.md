# AcuDx: multi-persona review, platform structure and roadmap (October 2026)

Reviewers: an emergency physician, a nurse educator, a fullstack engineer, an AI engineer and an academician in health-professions education. Evidence: `docs/review/00-codebase-audit-2026-10-19.md` (code), `docs/research/13` to `16` (market and technology, URL-verified on 2026-10-19). Test suite at HEAD: 160 Vitest cases pass, typecheck clean.

## 1. What AcuDx is, in one picture

```
                         +--------------------------------------------+
   Learner (student,     |  web/  Epic-like EHR workspace (React)      |
   resident, nurse,  --> |  Interview  Exam  Orders  Results  Flowsheet|
   paramedic)            |  Problem list  A&P  Guidance  Monitor  Atlas|
                         +------------------+-------------------------+
                                            | /api (same origin)
                         +------------------v-------------------------+
                         |  server/  FastAPI Model Gateway             |
                         |  guard -> persona -> fact gate   /v1/*      |
                         |  case/generate   grade   ground             |
                         +------+-----------+------------+------------+
                                |           |            |
                     local llama-server   embed/rerank   guideline seed (in memory)
```

Facade today: a convincing, well-designed EHR simulation with a real but thin model path. The frontend carries most of the clinical logic (case generation, physiology course, orders, grading fallback, guidance). The backend is optional and unauthenticated. Multiplayer is a LAN snapshot relay with scripted teammates.

## 2. Persona findings

### 2.1 Emergency physician
Strengths: progressive disclosure is right (history by asking, exam by maneuver, results by ordering). Order turnaround realism and treatment effects on vitals are the correct pedagogy. Red flags and ESI are modelled.
Defects that would mis-educate:
1. Normal values are invented for any unordered test (`orderables.ts:1191`). A learner can never learn that a case "has no data" is not "normal".
2. Imaging can come from a live Wikimedia search that may return the wrong pathology or laterality. A wrong-sided pneumothorax taught once is remembered.
3. Guidance attaches condition-specific advice (DKA insulin, sepsis cultures) to a generic "TEPDAD" citation. That is a citation in form only.
4. Server guide titles like "NICE respiratory guidance (summary)" do not exist as documents.
5. No troponin, lactate or glucose kinetics; results do not evolve with time since onset or treatment except vitals.
Verdict: the clinical skeleton is sound, the clinical content layer is not yet trustworthy.

### 2.2 Nurse educator
Strengths: role scoping (doctor orders, nurse executes) is modelled; handoff timeline exists; flowsheet is a real nursing surface.
Defects: nurse and paramedic are not first-class roles in the profile model (only student, resident, educator, dean). Medication administration has no MAR, no five-rights check, no allergy interaction at the point of administration. Room debrief scores are hardcoded (82, 74) for every team. Scope-of-practice violations are not scored.

### 2.3 Fullstack engineer
Strengths: typed client, discriminated results, event-sourced store, i18n discipline, lazy routes, design system.
Defects: no authentication anywhere (client-side role from localStorage; anyone can pick "dean"). No production serving, no Docker, no reverse proxy, TTS and STT exist only in the Vite dev server. Results turnaround is a browser `setTimeout`, so a reload loses pending orders and multiplayer peers can disagree. No e2e tests, no component tests, no Python tests, `lint` has no config, CI covers the web job only. Public assets are 170 MB in git.

### 2.4 AI engineer
Strengths: two-tier boundary (persona never sources facts) and the FactAssertionGate are the right architecture; scope guard is deterministic and tested.
Defects: case generation is one bounded call with silent template fallback presented as a case. No judge or verifier loop, no memory of the learner, no tracing or cost ledger, no eval set. Grounding falls back to a hashing embedding. Voice is non-streaming and vendor-locked to one API in dev only. Lip-sync is text-timed. There is no on-demand GPU path, only a hand-managed pod.

### 2.5 Academician
Strengths: Dunning-Kruger calibration plot, six-domain bands, process metrics from the event log, accreditation crosswalk (ACGME, CanMEDS, EPA, LCME, TEPDAD).
Defects: no psychometric evidence (no inter-rater data, no item analysis), rubric constants unsourced, citations lack URL, DOI, version and retrieval date, no citation verification step. Institution dashboard derives from the single local user. No LTI, no roster, no faculty review queue. The competitor research shows nobody publishes psychometrics; AcuDx can win by doing so.

## 3. Where the market is (from docs/research/13)
Free-text LLM patients are table stakes. No competitor uses an Epic-like chart as the primary surface, none offers browser-native role-differentiated shared-EHR rooms, only one discloses its model, and pricing is opaque. Reference layers (OpenEvidence, AMBOSS AI, UpToDate Expert AI) set the citation bar at page-level links. Turkey has no funded AI simulated-patient product.

## 4. Target architecture (what we are building now)

```
 Browser (web/)                        Gateway (server/)                         Workers
 EHR workspace  ----/v2/case/generate/stream----> LangGraph case graph ----+
 Interview tile  ---LiveKit room------> LiveKit Agents worker (STT/LLM/TTS/avatar) ---> on-demand Lambda GPU
 Orders/Results  ---/v1/results/*-----> results engine (ranges, kinetics, ECG, image bank)
 Guidance        ---/v1/ground--------> GuidelineStatement store (versioned, URL, verified_by)
 Admin/Dean      ---/admin/*----------> provider registry, GPU policy, telemetry (OTel -> Langfuse/ClickHouse)
 Sign-in         ---OIDC PKCE---------> Keycloak (SAML to university IdPs, LTI 1.3 via ltijs)
```

Decisions (each justified in the research docs):
- Orchestration: LangGraph 1.x with a three-judge council and a Clinical Director subgraph; SQLite checkpointer locally, Postgres in production.
- Model access: self-hosted vLLM on an on-demand Lambda GPU worker (never always-on, idle-terminated) as the sovereign path; DeepInfra, Groq or the HF router as API alternatives configured in the admin panel. Lambda Inference API is winding down and is not used.
- Voice: cascade STT -> LLM -> TTS over LiveKit Agents; hosted Deepgram Nova-3 (tr) + ElevenLabs v4 when keys exist, self-hosted faster-whisper + Chatterbox Multilingual on the worker otherwise. Realtime face: Simli or Anam by API, LiveTalking + MuseTalk (or SoulX-FlashHead) on the worker as the open fallback.
- Results: deterministic physiology (Pulse engine integration later; parametric kinetics now), LOINC/UCUM reference ranges with sources, synthesized 12-lead ECG, license-clean image bank with provenance, synthetic images only offline, labelled and C2PA-marked.
- Identity: Keycloak 26 as default, Supabase Auth as managed option; roles student, resident, nurse, paramedic, faculty, dean, admin, super-admin.
- Deploy: Docker Compose + Caddy (paste a domain, get TLS), Coolify and Railway templates, Cloudflare Tunnel option.
- Telemetry: OpenTelemetry gen_ai spans from the gateway, cost from a versioned price table, Langfuse + Grafana; panels render with evilcharts (shadcn registry, Recharts/ECharts).

## 5. Roadmap

| Phase | Weeks | Ships | Exit gate |
|---|---|---|---|
| P0 Substrate (now) | 0 to 2 | GPU worker manager, results engine, case generator v2 + director, e2e harness, brand kit, protocol and watchdog | pytest and Playwright green in CI; watchdog hits trending to 0; a case generated by the v2 graph plays end to end |
| P1 Trust layer | 2 to 5 | GuidelineStatement store with URL/DOI and verifier agent, attending tips (AMBOSS style) only from verified statements, FactGate on every clinical string, citation audit report | 100 percent of learner-visible clinical statements resolve to a verified statement; medical reviewer sign-off per condition family |
| P2 Identity and panels | 4 to 7 | Keycloak OIDC, server-verified roles, admin panel (providers, GPU policy, budgets, telemetry), dean panel (cohort analytics from server events), faculty panel (assignments, review queue, grading override) | no client-side role; two institutions isolated in tests; LTI 1.3 launch from Moodle sandbox |
| P3 Voice and video | 6 to 10 | LiveKit room per encounter, cascade voice with barge-in, Simli/Anam or MuseTalk face, symptom rendering from vitals, Turkish listening test passed | round-trip < 1.2 s p95; lip-sync offset < 120 ms; works with zero hosted keys on the GPU worker |
| P4 Interprofessional rooms | 9 to 13 | server-authoritative room state (replace LAN relay), real AI teammates via director, MAR and five rights, team debrief from events | 100 concurrent rooms on staging; scope-of-practice violations scored |
| P5 Launch kit | 12 to 14 | one-click deploy (Compose + Caddy, Coolify, Railway), README with real screenshots, Remotion launch video, docs site | fresh VM to running domain in under 15 minutes |
| P6 Evidence | 14 to 22 | psychometrics (IRR with faculty, item analysis), published eval set, accreditation export packs, pilot with one school | measured competence rise week 1 to 6; D30 retention >= 25 percent |

## 6. Risks
1. Clinician curation is the real cost of imaging and guideline banks; automate verification, not authorship.
2. Turkish voice quality: no open S2S speaks Turkish; the cascade must be tuned and benchmarked.
3. GPU cold start (model pull) is minutes; mitigate with a pre-baked filesystem on Lambda and warm-on-schedule policies owned by admins.
4. Air-gapped mode and hosted providers conflict; the egress guard must reject hosted values when AIRGAPPED is on.

## 7. What the owner must provide
1. Fresh AWS credentials if AWS should be used (the session token in this environment is expired).
2. API keys for any hosted provider to enable (ElevenLabs, Deepgram, Simli or Anam or Tavus, DeepInfra or OpenRouter). Without them the platform runs fully on the Lambda worker.
3. A domain name for the one-click deploy, and a Lambda SSH key name to attach to workers (one exists: acudx-claude-mac).
4. Native clinician review time for Turkish content.
