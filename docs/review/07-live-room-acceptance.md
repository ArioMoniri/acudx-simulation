# 07. Live team-room acceptance on a real GPU worker (2026-10-21)

Owner: fullstack engineer and tester. Scope: the room order and task loop moved onto the thread (doc 15 section 12.8), with two browser contexts playing one staged case against a real model.

## Setup

| Item | Value |
|---|---|
| Gateway | private, started from the worktree on port 8941 with its own SQLite file (scratch `ACUDX_DB_PATH`); env copied from the coordinator's `run-gateway.sh` with only `PORT` and `ACUDX_DB_PATH` changed |
| GPU policy | allowlist `gpu_1x_a100_sxm4`, `gpu_1x_h100_pcie`, `gpu_1x_h100_sxm5`; region preference `us-east-1`; file system `acudx-wm`; model `Qwen/Qwen3-14B-AWQ` served as `acudx-llm`; idle window raised to 120 min for the run |
| Worker | started with this gateway's `POST /admin/gpu/start` (`acudx-worker-1792539896`, `gpu_1x_a100_sxm4`, us-east-1). The first start was refused with `no_capacity`; capacity appeared about 2 minutes later. Boot to `ready`: 7 min 40 s |
| Model endpoints | the gateway was restarted with `CASEGEN_BASE_URL` and `JUDGE_BASE_URL` set to `https://<worker domain>/v1` and the bearer from the `gpu_workers` row (the patient persona stayed on the gateway's default endpoint, which is not reachable here, so the interview used the reveal fallback and the Director narrator) |
| Web | Vite dev server on port 4216 proxying `/api` to the gateway; a private multiplayer relay on port 8942 (`VITE_MULTIPLAYER_URL`) |
| Driver | `web/e2e/acceptance/live-room.spec.ts` (Playwright, two contexts at 1280x800). An init script taps every `/api/v2` request and every SSE event each context receives with the wall clock, so the times below are client side and comparable between the two contexts |
| Cost | ledger row: 19.6 min at 1.99 USD per hour, 0.65 USD; the worker was stopped with `POST /admin/gpu/stop` and the Lambda instance list was checked afterwards (below) |

## Walk

1. The host (resident) opens Rooms, picks Case "Fever" in Create room and confirms. The room page opens on `opening.ready`.
2. A second member (student) joins with the invite code and is seated as the Nurse. Joining binds nothing: the host's tab binds the thread to the room code, the member joins it with the code and follows the thread log.
3. The doctor asks three questions in the Interview tab. Each Director step runs on the server and lands on the thread log for both members.
4. The doctor orders Paracetamol in Orders and tasks. The task appears in the nurse's queue on the other device (a `task` event). Administer stays disabled with the treatment-table notice until the `treatments` layer is in; the nurse then administers. The dose goes through the solo path (five rights, allergy band, MAR line by the nurse, a Director treatment step on the thread).
5. The doctor adds the first suggested diagnosis and commits it in the new Diagnosis tab. The debrief layer is written and appears in the Debrief tab of both members, with its guideline sources linked.

## Measurements

Times from the host's click on Create room (T0).

| Run | First text (`opening.delta`) | Playable opening (`opening.ready`) | Room page | Case |
|---|---|---|---|---|
| 1 (23:54 UTC) | 4.0 s | 29.5 s | 30.5 s | fever; the model wrote necrotising fasciitis |
| 2 (23:59 UTC, after the duplicate fix below) | 1.2 s | 18.3 s | 19.2 s | fever with loss of smell; COVID-19 |

Layer arrival (`layer.ready`, the same on both contexts to within 0.1 s):

| Layer | Run 1 | Run 2 |
|---|---|---|
| history.presenting | 66.3 s | 48.3 s |
| history.associated | 82.9 s | 71.1 s |
| history.background | 104.0 s | 96.5 s |
| exam.general | 124.1 s | 123.8 s |
| exam (kernel systems) | msk_skin 149.6 s | respiratory 139.2 s, neurological 154.2 s |
| treatments | 194.8 s | 183.4 s |
| results | 247.3 s | 217.4 s |
| debrief (on commit) | 257.0 s (47.2 s after the commit, queued behind `results` on the worker) | 238.7 s (38.1 s after the commit) |

Director steps and fan-out. A step's round trip is the sender's `POST /v2/director/step` (model narrator on the same worker as the continuation). Fan-out is when the OTHER context received the step's `director` event on its follow stream, against the sender's HTTP answer (the server appends the event to the log before it answers, so a negative value is normal).

| Run | Sender to receiver | Steps | Round trip | Fan-out vs the sender's answer |
|---|---|---|---|---|
| 1 | host to nurse | 5 (2 questions, 3 cadence ticks) | 6.0 to 19.4 s | -21 to -4 ms |
| 1 | nurse to host | 1 (treatment 161) | 8.6 s | -11 ms |
| 2 | host to nurse | 4 (1 question, 3 cadence ticks) | 7.9 to 15.6 s | -16 to +36 ms |
| 2 | nurse to host | 1 (treatment 161) | 9.1 s | +5 ms |

Monitor on both devices (the first row of each monitor's accessible table):

| Run | Before Administer | 12 s after Administer |
|---|---|---|
| 1 | host HR 111, BP 99/64; nurse HR 112, BP 98/63 (the nurse's tab joined later and had not yet taken a step) | both HR 111, BP 99/64, RR 20, SpO2 98, Temp 39.2 |
| 2 | both HR 101, BP 120/80, RR 16, SpO2 94, Temp 39.0 | both HR 102, BP 120/80, RR 16, SpO2 94, Temp 39.0 |

Paracetamol barely moves the vitals within seconds (its effect ramps over its onset); what the run shows is that both monitors carry the same server vitals after the nurse's step.

Debrief citations: run 1, one link (Surviving Sepsis Campaign adult guidelines, sccm.org); run 2, two links (NICE NG191, COVID-19 therapeutics and co-infections). Both runs committed a wrong diagnosis on purpose (the first suggestion), and both debriefs explained why it did not fit.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| R1 | major | The host's tab receives the thread log twice (its own generate stream stays open and it also follows the room), so another member's Director step was applied twice on the host: a remote treatment would have entered the host's shared course twice. | Fixed in this branch: `applyThreadDirector` applies a step only when its sim time is after the last one applied (`encounterStore.ts`), unit test in `roomCaseStore.test.ts`. Run 2 was played on the fix. Tasks and layers were already idempotent. |
| R2 | minor | The duplicate subscription itself remains (double `layer.ready` on the host, harmless after R1). Closing the generate stream once the follow stream is open, or not opening the follow on the owner's tab until `done`, would halve the host's SSE traffic. | Open |
| R3 | minor | The debrief call queues behind the continuation on the single worker (38 to 47 s after the commit), the same serialisation doc 15 section 12.6 describes. | Open (worker side: CUDA graphs, xgrammar, then concurrency) |
| R4 | cosmetic | Run 2's debrief ended a missed cue with a stray `],` from the model. | Open (debrief gate could strip trailing JSON punctuation) |
| R5 | minor | Rooms had no way to commit a diagnosis, so the debrief layer could not be reached from a room. | Fixed: a Diagnosis tab for the doctor (`ProblemListTab`), `CaseDebriefLayer` in the room's Debrief tab, and a member applies the `layer.ready debrief` another member's commit produced. |
| R6 | info | The first worker start was refused with `no_capacity` in us-east-1; only `gpu_1x_a10` was free for about 2 minutes. | Environment |

## Screenshots

`docs/review/acceptance-2026-10-21-rooms/` (run 2, viewport captures, palette-quantised to 96 colours, 406 KB in total): `01-host-room-opening.png`, `02-nurse-joined.png`, `03-host-interview.png`, `04-nurse-task-queue.png`, `05-nurse-administered.png`, `06-host-after-administer.png`, `07-host-debrief.png`, `08-nurse-debrief.png`.

## Teardown

The worker was stopped through the gateway (`POST /admin/gpu/stop`, ledger reason `admin`), and `GET https://cloud.lambda.ai/api/v1/instances` was checked: no `acudx-worker-*` instance of this run remains (see the handoff note for the final listing). Instances not named `acudx-worker-*` were not touched. The gateway, the dev server and the relay started for the run were stopped.
