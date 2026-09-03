# Work Manifest — parallel engineering coordination

**Rule for every engineer:** you own ONLY the files listed under your issue. The files under other issues belong to other engineers who are working concurrently — **do not read-modify-write them**. Shared strings go in your own `web/src/i18n/features/<feature>.{en,tr}.json` file (deep-merged at init — see `web/src/i18n/index.ts`), never in `locales/{en,tr}.json`. Keep public component props backward-compatible so a sibling that imports your component still builds. Match the medkit design language, EN/TR, WCAG 2.2 AA, no em-dash, Phosphor icons, honor `prefers-reduced-motion`.

Coordination model: disjoint file ownership (below) + this manifest = mutual awareness. One branch + one PR per issue; PRs merge sequentially after `npm run build` passes.

## Batch 1

| Issue | Branch | Owned files (exclusive) |
|---|---|---|
| **#1** live Scope & Injection Guard | `issue-1-scope-guard` | `web/src/domain/scopeGuard.ts` (new) · `web/src/components/ehr/tabs/InterviewTab.tsx` · `web/src/state/encounterStore.ts` · `web/src/i18n/features/scopeGuard.{en,tr}.json` (new) |
| **#2** patient profiles + animated avatars | `issue-2-patient-avatars` | `web/src/domain/patientProfiles.ts` (new) · `web/src/components/PatientPortrait.tsx` · `web/src/components/ehr/PatientAvatar.tsx` · `web/src/lib/avatarMotion.ts` (new) · `web/src/i18n/features/patient.{en,tr}.json` (new) |
| **#3** motion & micro-interactions | `issue-3-motion-polish` | `web/src/lib/motion.ts` (new) · `web/src/pages/HomePage.tsx` · `web/src/pages/CasesPage.tsx` · `web/src/pages/LandingPage.tsx` |
| **#4** route code-splitting | `issue-4-code-splitting` | `web/src/App.tsx` · `web/src/components/shell/RouteFallback.tsx` (new) |

**Not owned by anyone this batch (do not touch):** `web/src/i18n/locales/*`, `web/src/i18n/index.ts`, shell (except RouteFallback), other pages, `src/data/*`, `src/domain/*` except as listed.

Integration order (sequential merge): #4 → #1 → #3 → #2 (least-to-most cross-cutting), rebuild after each.
