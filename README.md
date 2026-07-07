# AcuDx

**AcuDx is the interaction-and-assessment layer for health-professions education.** Learners (medical, nursing, paramedic students and residents) practice full clinical encounters — history → exam → tests → differential → diagnosis → management — by roleplaying against AI patients, colleagues, and families in a simulated EHR, solo or in multiplayer role-based rooms. Every encounter returns a defensible, competency-mapped grade, a Dunning-Kruger **calibration plot** (self-rated confidence vs measured competence), and a gap→remediation loop; every clinical fact is grounded-or-refused against current country-specific guidelines, every synthetic asset is C2PA-marked, and every action is one event on one hash-chained log. It is **open-source-first, sovereign-capable (air-gappable on-prem), and bilingual EN/TR** by design.

**Status: blueprint complete + runnable demo.** The `docs/` blueprint is a full architecture (11 service docs + overview + research + business + design + build plan); the `web/` app is a runnable presentation-and-domain-model prototype (three screens on client-side mock layers). The path from the demo to production is specified in `docs/build/`.

---

## Run the demo

```bash
npm --prefix web install && npm --prefix web run dev
```

Then open the printed local URL. Three screens: **Home** (dashboard), **Encounter** (EHR workspace with vitals monitor + interaction dock), **Feedback** (6-domain bands + calibration plot + cited gaps). Toggle **EN/TR** and light/dark in the top nav. Everything runs client-side on mock data — no backend, no keys, no network. Education-only, synthetic patients, no real patient data.

Stack: Vite · React 18 · TypeScript · Tailwind v4 · Radix · i18next (EN/TR) · react-router · Framer Motion. Build: `npm --prefix web run build` · typecheck: `npm --prefix web run typecheck` · lint: `npm --prefix web run lint`.

---

## Repository map

### `web/` — the runnable demo
The production client, prototyped. Reuse-not-reinvent: a full design system (tokens + shell + UI primitives + EHR components), a FHIR-shaped domain model (`src/domain/`), a seeded client-side case generator, an event-sourced encounter store, and EN/TR i18n. See `web/` source under `src/{components,domain,state,data,pages,i18n}`.

### `docs/` — the blueprint

| Folder | What it owns |
|---|---|
| **`00-overview/`** | Product-level synthesis — [requirements & constraints](docs/00-overview/01-requirements-and-constraints.md) (the authoritative baseline: MVP wedge, tensions T1–T12, the two non-negotiables), [architecture overview](docs/00-overview/02-architecture-overview.md), [executive summary](docs/00-overview/03-executive-summary.md), [dynamic cases / EHR / process-aware assessment](docs/00-overview/04-dynamic-cases-ehr-process.md) |
| **`architecture/`** | The 12 engineering docs — [system overview](docs/architecture/00-system-overview.md), AI agents, [model gateway & routing](docs/architecture/02-model-gateway-and-routing.md), voice pipeline, avatar & vitals engine, [grounding engine](docs/architecture/05-guideline-grounding-engine.md), [assessment & calibration](docs/architecture/06-assessment-and-calibration-engine.md), multiplayer rooms, [data model & multi-tenancy](docs/architecture/08-data-model-and-multitenancy.md), security & compliance, [API & integration surface](docs/architecture/10-api-and-integration-surface.md), internationalization + the [ADR log](docs/architecture/adr/README.md) |
| **`research/`** | Web-verified July-2026 grounding — LLM models & cost, voice AI, 3D avatars, market, guideline grounding, regulatory, assessment science, [open-source model stack](docs/research/08-open-source-model-stack.md), localization/Turkish, realtime avatars, and the authoritative [fully-open-source stack map](docs/research/11-fully-open-source-stack.md) |
| **`stakeholders/`** | Learner, educator, institution, policy/regulator, and builder perspectives |
| **`design/`** | The medkit [design system](docs/design/00-design-system.md) + [UX flows and key screens](docs/design/01-ux-flows-and-key-screens.md) |
| **`business/`** | Market & strategy, business model & unit economics, GTM & sales, financial model & roadmap |
| **`build/`** | **Demo → production** — the [full integration plan](docs/build/01-full-integration-plan.md) (mock-layer → real-service mapping, backend scaffold, open stack, API order, FHIR + event sourcing, auth/LTI, voice + avatar, eval/CI gates, timeline + team) and the [phase-by-phase roadmap](docs/build/00-roadmap.md) (Phase 0 → MVP → v1 → v2 with a metric gate per phase) |

**Start here:** new readers → `docs/00-overview/03-executive-summary.md`; builders → `docs/architecture/00-system-overview.md`; taking the demo to production → `docs/build/00-roadmap.md`.

---

## What makes AcuDx AcuDx

- **The wedge:** solo text-first Emergency-Medicine roleplay + structured feedback + the Dunning-Kruger calibration plot — a 10×-not-1.2× first product; voice, 3D, multiplayer, and dean's-office dashboards are gated fast-follows.
- **Two-tier content safety:** a grounded layer owns *all* clinical facts (citation-or-refuse); the AI patient improvises affect but *never sources a clinical fact* — the case state does.
- **Assessment as a psychometric product:** decomposed evidence-span grading, grader-family ≠ patient-family, band-only granularity (κ-gated), transcript-anchored + overridable, formative-by-default with human co-sign for summative.
- **Open-source-first & sovereign:** every layer has a permissive-open default (Qwen3 · BGE-M3 · Qdrant · Whisper-TR + Chatterbox · LiveKit · LivePortrait · Keycloak · Postgres/Valkey/ClickHouse), so AcuDx is buildable end-to-end on open source and deliverable as an **air-gapped on-prem appliance with zero third-party data egress** for a Türkiye ministry (T.C. Sağlık Bakanlığı / KVKK) or a privacy-max institution. Proprietary vendors survive only as optional premium, each with a named open fallback.
- **Bilingual EN/TR:** first-class Turkish across UI, content, guidelines, and voice.

**Scope-defining non-negotiables (architecturally enforced):** `assessment_mode: formative` by default (keeps AcuDx below EU AI-Act Annex III high-risk) and synthetic-patients-only / no PHI (FERPA + GDPR, not HIPAA). Both are deliberate later gates to relax, never accidental.

---

*Education only. Synthetic patients. No real patient data. Not a medical device; not for clinical care.*
