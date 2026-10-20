# 06c Tester: cases generated on request (contract tests)

Date: 2026-10-20. Role: tester. Branch: `worktree-agent-ae261cd5ee1693827` (merged with `origin/claude/clever-mendel-dtbc1n`).

## Owner requirement

Every case is generated on request and changes dynamically in flight. There is no pre-generated case list a learner can open as an encounter.

## Files

| File | What it encodes |
|---|---|
| `web/e2e/on-request.spec.ts` | Every learner entry point must POST `/v2/case/generate` or `/v2/case/generate/stream` and open the case the server returned. Two identical requests give different cases. A student action calls `/v2/director/step` and the returned `patient_visible_changes` show up. The gateway is replaced with `page.route`, which replays `server/tests/fixtures/live/*.json` in the SSE shape that `web/src/lib/caseGenV2.ts` reads. |
| `server/tests/test_on_request_contract.py` | `/v2` never serves a stored case to a learner. `/v2/case/template` is refused for learner roles by default. Director steps are deterministic: the patient deteriorates after a missed deadline and improves after an indicated treatment. Repeated generate calls with no seed differ. |

## How to run

```
# server (in-process, uses the openai double, no network)
PYTHONPATH=. /home/user/acudx-simulation/.venv/bin/python -m pytest server/tests/test_on_request_contract.py -q -rxX

# web (Chromium from /opt/pw-browsers, private port; never run playwright install)
cd web && PORT=4203 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test e2e/on-request.spec.ts --project=laptop

# see the real failure behind every known-failure marker
cd web && ON_REQUEST_SHOW_FAILURES=1 PORT=4203 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test e2e/on-request.spec.ts --project=laptop
```

The e2e spec runs on the `laptop` project only. The other projects skip it in `beforeEach`, because this is a behaviour contract and one viewport is enough. These are viewport skips, not skipped failures.

Markers: a failing web test calls `knownFailure("F-Wn ...")`, which is `test.fail()`. A failing server test carries `pytest.mark.xfail(strict=True, reason="... F-Sn ...")`. When the implementer fixes the behaviour, the test passes, the runner reports it as an error ("expected to fail but passed" or XPASS(strict)), and the marker has to be removed. Do not loosen the assertions.

## Results (2026-10-20)

Server: 13 passed, 4 xfailed (strict). Web, laptop: 4 passed, 8 known failures. The full run reports 12 passed and 36 skipped (the viewport skips).

### Passing today (keep green)

| Test | Notes |
|---|---|
| web: Start page, Begin encounter generates the case | Stream POST issued; the served patient (fixture name) is on screen. |
| web: Encounter New case menu, "Generate a fresh case" | Second stream POST issued and the new case opens. |
| web: two consecutive requests with the same filters give different cases | Bodies are identical apart from the seed, no seed is pinned, the second case replaces the first. |
| web: student action calls `/v2/director/step`, vitals follow | The question posts `action.kind=question` with the spec. The Storyboard HR and SpO2 match the returned vitals (141, 87). |
| server: every generate call runs the model graph | `meta.source=model`, and the author model is called on every request. |
| server: reusing a thread_id does not replay the stored case | A fresh seed or condition and a fresh author call. |
| server: an owned checkpoint is hidden from other learners | |
| server: /v2 has no case listing route | Allowlist: `GET /v2/case/{thread_id}`, `GET /v2/learner/{learner_id}`. Any new `/v2` GET must be reviewed and added. |
| server: template for faculty (admin token) is labelled | `meta.source=template`, `degraded=true`. |
| server: template fallback for student or resident when the setting is on is labelled | See the settings contract below. Passes today only because the route is open to everyone. |
| server: Director is deterministic for identical action sequences | `use_model=false`, recorded sepsis spec. |
| server: Director deteriorates after a missed deadline | ESI 2 sepsis, 20 min deadline: `missed_time_critical_treatment` fires, then HR goes up and SBP and SpO2 go down. |
| server: Director improves after an indicated treatment | IV fluids: HR goes down and SBP and SpO2 go up, and the deadline is cancelled. |
| server: repeated generate (JSON and SSE) with identical inputs and no seed differ | Plus the control: an explicit seed reproduces. |

### Failing today (exact assertions to target)

| Id | Test | Failing assertion | Cause in code |
|---|---|---|---|
| F-W1 | web: Cases page, starting a listed case generates it | `Cases page Start this case: POST /v2/case/generate[/stream] issued`: expected >= 1, received 0 | `CasesPage.tsx` lists `[...generated, ...publishedInstances, ...seedCases]`. `startCase` navigates with `state.caseInstance`, and `EncounterPage` starts that case with no request. |
| F-W2 | web: Cases page, every generate control uses the v2 generator | `Cases page Generate a fresh case: POST ... issued`: expected >= 1, received 0. The test then checks "AI generate" and "Quick generate" the same way. | `handleAiGenerate` calls `generateCaseFromBackend`, which posts `/v1/case/generate` (`liveCaseGen.ts`). `handleQuickGenerate` uses the on-device `generateCase`. |
| F-W3 | web: Encounter New case menu, no curated bundled case opens without generation | `New case > listed case: POST ... issued`: expected >= 2, received 1 | `NewCaseMenu.tsx` renders `seedCases` as menu items. `handleLoadSeed` loads `getSeedCase(id)` directly. |
| F-W4 | web: Exam, each exam case is generated by /v2 | `Exam Begin exam: POST ... issued`: expected >= 1, received 0 | `ExamRunner.tsx` `makeCase` calls `fetchGeneratedCase` (`/v1/case/generate`), then falls back to the on-device `generateCase`. |
| F-W5 | web: Rooms create dialog, the room case is generated | `Rooms create: POST ... issued`: expected >= 1, received 0 | `CreateRoomDialog.tsx` is a `<select>` over `seedCases`. `roomCase()` is `getSeedCase(room.caseId)`. `RoomPage` falls back to `getSeedCase("em-acs-001")`. |
| F-W6 | web: Home recommended rail, opening a recommended case generates it | `Home recommended rail: POST ... issued`: expected >= 1, received 0 | `HomePage.tsx` `buildRecommended` builds the instances on the device at render time. `openCase` hands them over via router state. `FALLBACK_RAIL` is a static list. |
| F-W7 | web: a model outage offers the learner no template or on-device case | `getByRole('button', { name: /^Use template case/ })`: expected count 0, received 1 | `EncounterPage.tsx` `useTemplateCase` offers `/v2/case/template` to every learner, and after that the on-device `generateCase`. The offline mount path also starts `generateCase` or `chestPainNstemiCase` when the gateway is down. |
| F-W8 | web: the patient reply reflects the Director's utterance | `getByRole('log', { name: 'Encounter transcript' }).getByText(DIRECTOR_UTTERANCE)`: element not found | `applyDirectorChanges` stores `utterance` in the overlay (`liveEncounter.ts`), but no component renders it. The patient reply comes only from `/v1/patient/turn` or the offline reply. |
| F-S1 | server: a checkpoint is never served to a different learner | `GET /v2/case/th-unowned` as another student: expected 404, got 200 | `routes.py` `read_case` serves any checkpoint whose `request.learner_id` is empty to any signed-in caller. |
| F-S2 | server: template is refused for learner roles by default (student, resident, anonymous) | expected 401 or 403, got 200 (three parametrized cases) | `routes.py` `template()` has no principal dependency and no setting check. |

### Settings contract proposed for F-S2

The labelled learner fallback is off by default. It is enabled by `learner_template_fallback = True` on the app settings (`app.state.settings`) or by the environment variable `ACUDX_LEARNER_TEMPLATE_FALLBACK=1`. Only an admin or faculty member may change it. Faculty and above (with a verified role, or the admin token in local mode) may always preview the template. Whatever is served must carry `meta.source="template"`, `meta.degraded=true` and a note that mentions "template". If the implementer picks a different setting name, they must update `test_template_fallback_for_learners_only_when_enabled_and_labelled` in the same change.

### Existing tests that conflict with the contract

When F-S1 and F-S2 are fixed, these older tests need updating in the same change:

- `server/tests/test_orchestration_routes.py::test_checkpoint_read_after_generate` reads an unowned thread as `X-User-Id: L-route`. Under F-S1 that is another learner. Generate with `learner_id` or read as faculty instead.
- `server/tests/test_orchestration_routes.py::test_template_route_is_labelled_template` posts anonymously and expects 200. Under F-S2 that must become faculty (with the admin token), or the setting has to be on.
- `web/e2e/encounter.spec.ts` clicks "Use template case" when a reachable gateway answers 503. Under F-W7 that branch disappears for students.

## Notes

- The SSE double replays the recorded trace one `node` event per trace record, between `start` and `done`, exactly as `parseSseBuffer` and `streamCaseGenV2` expect.
- The Director double returns vitals HR 141, BP 86/52, RR 30, SpO2 87 and T 39.6, plus a fixed `utterance_en`. On the laptop viewport the Storyboard "Vitals snapshot" showed exactly these values after one question.
- Every other `/api` call (patient turn, results, voice, auth) answers 503 in the spec, so the encounter runs on its documented degraded path for those features.
