# AcuDx engineering protocol for agent teams (TDD, DoD, handoff, worktrees)

Applies to every human or agent contributor. Read before touching code.

## 1. Roles

| Role | Owns | Hands off to |
|---|---|---|
| Orchestrator | task board, merge order, conflict resolution | everyone |
| Researcher | `docs/research/*` with URL-verified claims | AI engineer, academician |
| AI engineer | `server/orchestration`, `server/providers`, model and voice adapters | Tester, Watchdog |
| Fullstack engineer | `web/src/**`, `server/app.py`, admin and panel APIs | Designer, Tester |
| Designer | design tokens, layout, responsive and motion review, Mobbin references | Fullstack engineer |
| Motion designer (spawned by Designer) | Lottie, Remotion launch video, micro-interactions | Designer |
| Academician | competency mapping, rubric validity, citation verification | Medical reviewers |
| Medical doctor and nurse reviewers | clinical correctness of cases, orders, results, tips, scope of practice | AI engineer |
| Student and user agents | walk every flow as a learner, log friction | Designer, Tester |
| Tester | unit, contract, e2e (Playwright), stress runs on every button and function | Orchestrator |
| Watchdog | scans for mock, placeholder, hardcoded, demo, TODO, fake, stub; blocks merge | Orchestrator |
| Token optimizer | prompt size, cache prefix stability, cost per encounter | AI engineer |
| Feature suggester | backlog of enhancements with evidence from research | Orchestrator |

## 2. Non-negotiables

1. No mock, placeholder, demo, hardcoded or fake data in shipped paths. A deterministic fallback is allowed only when it is labelled in the response (`meta.source`) and surfaced in the UI as degraded. Fixtures live only under `*.test.ts` or `tests/`.
2. Every clinical fact shown to a learner carries a citation that resolves (URL or DOI) and was verified by a reviewer agent against the source text. Unverified statements are refused, not improvised.
3. Every provider (model, voice, video, imaging, identity, GPU) is configured in the admin panel and persisted server-side. No key is ever shipped to the browser.
4. GPU capacity is on demand. Workers are launched when a request needs them and terminated after the configured idle window. No always-on instance.
5. Education only. Synthetic patients. No PHI path.

## 3. TDD loop

1. Write the failing test first (`web/src/**/*.test.ts` with Vitest, `server/tests/test_*.py` with pytest, `web/e2e/*.spec.ts` with Playwright).
2. Implement the smallest change that passes.
3. Run the fast gate locally: `npm --prefix web run typecheck && npm --prefix web test && npm --prefix web run lint` and `python -m pytest server/tests -q`.
4. For UI: run Playwright at 390x844, 768x1024, 1280x800 and 1920x1080 and attach screenshots to the PR.

## 4. Definition of Done

- Tests: new behaviour covered, whole suite green, no skipped tests added.
- Watchdog scan clean: `scripts/watchdog.sh` exits 0 for the touched files.
- Citations: every new clinical string references a `GuidelineStatement` id that exists in the store.
- Accessibility: WCAG 2.2 AA, keyboard path, `prefers-reduced-motion` respected.
- Responsive: no horizontal scroll at 390 px, panels reflow at 768 px, EHR three-column layout at 1280 px and up.
- i18n: EN and TR strings in `web/src/i18n/features/<feature>.{en,tr}.json`.
- Docs: the owning doc under `docs/` updated, roadmap item ticked.
- Handoff note written (section 6).

## 5. Worktrees and branches

- One worktree per task under `.claude/worktrees/<task-slug>` branched from the integration branch `claude/clever-mendel-dtbc1n`.
- Disjoint file ownership per task is declared in the task description before work starts. Shared files (`App.tsx`, `index.ts` barrels, `locales/*.json`) are changed only by the Orchestrator at merge time.
- Merge order: substrate (server providers, config) before features before UI polish. Rebase is not used on shared branches; merge commits are.

## 6. Handoff note format

```
HANDOFF <from-role> -> <to-role>
Goal: one sentence
Done: bullet list with file paths
Verified by: command and result
Open: what is not finished and why
Next: the exact next action
```

## 7. Watchdog rules

Fail on any of these in non-test source: `mock`, `placeholder`, `TODO`, `FIXME`, `hardcod`, `lorem`, `fake`, `stub`, `demo data`, `Dr. Test`, `setTimeout(` used to simulate a server, literal API keys, `localhost` in production config.
Allowed with justification comment on the same line: `// watchdog: allow <reason>`.
