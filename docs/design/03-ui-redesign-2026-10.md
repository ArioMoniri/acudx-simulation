# 03 UI redesign, October 2026: from generic SaaS to a clinical instrument

**Status:** implemented in `web/` on branch `claude/clever-mendel-dtbc1n` (see the HANDOFF at the end). Supersedes the visual sections of `00-design-system.md`, which now mirrors the tokens below.

## 1. The verdict and the target

The owner's verdict on the previous UI: it reads as generic AI-generated SaaS. Rounded cards everywhere, a centred marketing hero, tinted icon tiles, pill badges, a gradient mark, a 16 px body size with generous padding, entrance animations on every section.

The target has two halves:

1. **AMBOSS**: dense, editorial, confident typography, calm colour, information first. Section headings and bullets carry the content; citations are small chips; no decorative gradients, glassmorphism, emoji, or rounded-everything; no centred hero fluff.
2. **Epic's chart**: a patient banner that never scrolls away, a storyboard rail, activity tabs as a persistent strip, and orders and results as real worklists (tables with status, ETA, flags and trends), not stacks of cards.

## 2. References pulled from Mobbin

Platform: web. Every reference below was opened and read; what was taken is listed per screen.

| # | Product and screen | mobbin_url | Taken |
|---|---|---|---|
| 1 | Heidi, clinical session with context tabs | https://mobbin.com/screens/2d97c22c-d4c0-48a6-8b4c-4a7cb8194b4b | Left rail of sessions with a dense list; a session header with name, condition and date; activity tabs (Context, Transcript, Assessment) as a flat underline strip above the document; a 13 to 14 px reading size. This is the model for the encounter tab strip and the left rail density. |
| 2 | Jobber, client record | https://mobbin.com/screens/228fe97b-859a-4c8b-bc9d-e7398bdb16c6 | Record page with a left primary nav, a contact table at the top, an Overview block with sub-tabs (Active work, Requests, Quotes, Jobs, Invoices) and a right column of compact panels with plain headings. Adopted for the console layout of Dean and Faculty and for the record-like PatientBanner fact band. |
| 3 | Pipedrive, organisation record with activity tabs | https://mobbin.com/screens/f1957f2a-0ec3-4d4f-af5f-ce4ae089ea89 | A record header (name, owner, follower, primary action) over an activity tab strip (Activity, Notes, Call, Email, Files, Documents) with the detail rail on the left. Confirms the Epic-like order: banner, tabs, rail. |
| 4 | Sweatpals, member profile | https://mobbin.com/screens/7af4450d-0e3c-41ba-963a-21a87a117fef | Member banner (avatar, name, first-seen line, actions on the right) with a flat underline tab row and three hairline-separated key figures under it. Model for the banner identity row and the key figures line. |
| 5 | Whop, admin console, user detail | https://mobbin.com/screens/ecd55b3a-6cac-4d3f-b421-3170727c5cf7 | Admin console with a grouped left nav (Dashboard, Pinned, All tools), a breadcrumb line, a top sub-tab row and a right column of stat panels with label and value rows. Model for the admin console and the breadcrumb line in page headers. |
| 6 | Zoho CRM, setup storage page | https://mobbin.com/screens/5706d4fa-ece6-44a8-bb32-0a118006ccec | Console with a left section tree, a storage meter with a title and unit, and a usage table with right-aligned numbers. Adopted for chart cards with titles and units and for right-aligned numeric columns. |
| 7 | Perplexity, research answer | https://mobbin.com/screens/eca7eecc-08cc-4795-80f5-de78c735aba0 | Reading layout: section headings in a slightly heavier weight, bullet lists, inline source chips in a monospace-like small label after each claim, a sources count on the right. Model for the guidance and attending tips reference panel and its citation chips. |
| 8 | Mintlify, documentation page | https://mobbin.com/screens/b409b4ea-993e-4cb5-ae9e-8aaab0558700 | Three-column documentation: navigation on the left, content in the middle with H1, lede, H2 and H3 and inline code tokens. Adopted for the reading measure (about 68 characters) and the heading rhythm in guidance. |
| 9 | Linear, issues list by status | https://mobbin.com/screens/fd1b4d88-f021-49a3-98af-4cd3a87e1d29 | Dense rows (about 32 px), a monospace identifier column, status glyph plus text, group headers with counts, a 13 px type size and a compact left sidebar. Model for the orders worklist and the cases table. |
| 10 | Linear, filtered view with labels | https://mobbin.com/screens/ed670cda-0527-4716-a1a6-0159f12c4f42 | Label chips are 4 px radius, outline, 11 to 12 px, with a coloured dot. Model for the new Badge geometry (square chips instead of pills). |
| 11 | Stripe, billing overview charts | https://mobbin.com/screens/f60d4787-ed33-4017-9f2c-78e793040fdb | Chart cards that are hairline cells in a grid, each with a small title, a large value with a unit and an "Updated" line. No tile decoration. Adopted for KPI rows and chart cards on Dean and Admin. |
| 12 | Stripe, developers overview | https://mobbin.com/screens/fb030c6b-f6dd-4715-9f6f-45f0e354411f | A sub-tab row directly under the top bar (Overview, Webhooks, Events, Logs), a flat page ground with hairline sections, and a search field in the top bar. Model for the compact top bar with global search. |
| 13 | Vercel, project settings | https://mobbin.com/screens/d700ff3c-8f37-4c09-87a4-4340fe157063 | Settings with a left section nav and stacked form sections, each a bordered block with a title, a lede, the control and a footer line with the Save button. Model for the Admin settings section layout. |
| 14 | Vercel, project overview | https://mobbin.com/screens/e092c546-46a0-44b7-aa71-26c092ade7f2 | A 220 px left rail with small icons, a breadcrumb in the top bar, and a key and value grid for settings. Adopted for the left rail width and the key and value density. |
| 15 | Origin, spending report | https://mobbin.com/screens/f36cc102-ee4d-4eca-93f0-30e903dd468b | A chart over a four-figure summary strip over a sortable table with a sort arrow in the header. Model for the sortable cases table and for the results summary strip. |
| 16 | Xero, business health scorecards | https://mobbin.com/screens/262ab48e-8f06-49ef-92d0-900197bab1a8 | A worklist table with grouped rows, a comparison status column (check or cross glyph plus text) and an importance column. Model for flag columns in the results flowsheet: glyph plus word, never colour alone. |
| 17 | Supabase, table editor | https://mobbin.com/screens/7fd540c5-2b47-4b72-a79c-c173d03c27f7 | Monospace values, 28 px rows, column types in the header, row count in the footer. Adopted for the mono value cells and the footer count on tables. |
| 18 | Passionfroot, hero with product screenshots | https://mobbin.com/sites/sections/d008689a-c73f-4513-a760-25a93ef6f043 | A short headline and one button with real product screenshots as the media. Adopted for the landing hero, but left-aligned and without the backdrop. |

Not adopted on purpose: the dark marketing heroes (Vizcom, Norma, Craft) because they are decorative, and Hims and Hers because they are consumer pages with photography.

## 3. What changed

### 3.1 Tokens (`web/src/index.css`)

- Type: Inter for all UI including headings; Manrope only on the `display` utility (landing headline and the wordmark); Geist Mono for codes, identifiers and values. Base size 14 px, line height 1.5. Scale: 11 (eyebrow), 12 (caption), 13 (table and secondary), 14 (body), 16 (section title), 18 and 20 (page title), 28 to 36 (display).
- Spacing: a tighter 4 px grid. Cards use 12 to 16 px padding, tables 8 px by 12 px cells, page gutters 16 px on phone and 24 px from md.
- Neutral surfaces: a true neutral ramp (`--bg` #f4f5f6, `--surface` #ffffff, `--bg-inset` #eceef0, `--border` #e2e4e8, `--border-strong` #cbd0d6, `--fg` #15181d, `--fg-muted` #596270, `--fg-subtle` #626975). Dark theme mirrors the ramp.
- One accent: `--brand-600` #0f766e (5.4:1 on white) with #2dd4bf on dark. The teal, blue and pink gradient variables are gone; chart series colours are now `--chart-1` to `--chart-4`.
- Clinical colours: `--state-normal` #04694a, `--state-caution` #9a4508, `--state-warning` #a83508, `--state-critical` #b01b1b. All four are at least 6.6:1 on white and at least 4.7:1 on their own 12 percent tint laid over the darkest ground (`--bg-inset`), so a chip can label text on any surface. Dark values are lightened and re-verified.
- Radius: `--r-card` 6 px, `--r-control` 4 px, `--r-chip` 4 px. The pill radius remains only for the status dot.
- Shadows: `--shadow-sm` none, `--shadow-md` a 1 px hairline lift, `--shadow-pop` for overlays only. No glow, no gradients, no backdrop blur.
- Motion: `--dur-fast` 120 ms, `--dur-base` 160 ms, `--dur-slow` 200 ms. `lib/motion.ts` uses the same values, a 4 px travel and a 30 ms stagger. `prefers-reduced-motion` collapses everything.

### 3.2 Shell (`web/src/components/shell/`)

- `TopNav` is now a 48 px top bar: wordmark (phone and tablet only, the rail carries it on lg+), a breadcrumb slot, a global search button that opens the command palette (Ctrl or Cmd K outside the encounter, which keeps its own palette), the role or vantage switcher, language, theme and account.
- `SideNav` is the primary navigation on lg+: a 220 px rail with the wordmark, the role-scoped items (`lib/navigation.ts`, unit-tested) and the guided tour entry.
- `BottomTabBar` is the phone and tablet navigation: a fixed bottom bar with the first four items and a "More" sheet for the rest.
- `PageHeader` takes `breadcrumbs`, renders a dense title row with actions on the right and a hairline under it.
- `AppFrame` composes the three and keeps `main#main`, the skip link and the education-only footer line.

### 3.3 Encounter (`web/src/components/ehr/`)

- `PatientBanner`: a full-width record strip, square corners, no blur. Identity row (portrait, name, age and sex, MRN in mono, SIM badge, toolbar) over a fact band with chief complaint, allergies, code status, ESI, weight, encounter class.
- `ProgressStages`: a compact numbered stepper with square chips and hairline connectors.
- `ActivityTabs`: a flat Epic-like activity strip with a 2 px underline on the active tab, mono counts, no card chrome.
- `OrdersTab`: the live tracker is a worklist table (order, status chip, ordered at, ETA, progress), the catalogue rows are 36 px.
- `ResultsTab`: flowsheet sections with a hairline rule under each heading, the existing trend sparklines and glyph-plus-word flags.
- `InterviewTab`: the patient call tile is sticky at the top of its column so it stays pinned while the transcript scrolls.
- Guidance tab: `RealtimeGuidance` and `AttendingTips` sit in a `reference` reading layout (headings, bullets, citation chips, callouts) with a 68 character measure.

### 3.4 Landing, Home, Cases

- Landing: a left-aligned editorial hero with the real encounter capture as media, a plain sources line, a numbered list for the loop, a hairline list for the platform, and one closing line. No tinted icon tiles, no closing band.
- Home: a hairline stats strip, recommended cases as a dense list, calibration and recent activity as compact panels.
- Cases: the generator is one toolbar row; the catalogue is a sortable table (case, specialty, code, difficulty, acuity, minutes) driven by `lib/caseSort.ts` (unit-tested).

### 3.5 Admin, Dean, Faculty

- Console layout: a left section nav (vertical `Tabs` variant) on lg+ and a horizontal strip below, tables for lists, chart cards with a title and a unit, KPI cells in one hairline strip.

### 3.6 Motion

- Transitions are 120 to 200 ms, transform and opacity only, with no scale on press and no hover lift. Reduced motion is honoured at the CSS level and in every hook.

## 4. Verification

- Before and after captures at 390, 768, 1280 and 1920 live in `docs/design/redesign-shots/before/` and `docs/design/redesign-shots/after/` (landing, home, cases, encounter and its Interview, Orders, Results and Guidance tabs, dean, faculty, admin, progress).
- `npm run typecheck`, `npm test`, `npm run lint`, and `PORT=4191 npm run test:e2e` on all four viewports. Counts are in the HANDOFF.
