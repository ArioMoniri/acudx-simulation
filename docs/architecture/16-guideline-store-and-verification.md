# 16. Guideline store and verification

**Status:** Built (Phase 0). **Date:** October 2026. **Owner:** Grounding Service.

**Scope.** This document describes the verified GuidelineStatement store, the verification pipeline that promotes a draft statement to `verified` only when its source document contains a supporting passage, the attending tips that are authored over verified statements, the HTTP surface, and the web contract. It refines document 05 (guideline grounding engine) for the slice that is now running in code: `server/guidelines/`, `server/grounding.py`, `web/src/lib/guidelinesApi.ts`.

## 1. The rule

Every clinical sentence a learner sees must trace to a GuidelineStatement row whose `status` is `verified`. A verified row carries the exact passage of the source that supports it (`verification_quote`), the URL that was fetched to find it (`verification_url`), the date and the verifier identity. A row that is `draft`, `failed` or `retired` is never served to a learner: the routes refuse it, `/v1/ground` does not retrieve over it, and the web app renders an explicit "guidance unavailable" or "source unavailable" state instead of any fallback text.

There is no offline guideline text in the web app any more. `web/src/data/mock.ts` no longer holds `citations` or `guidanceHints`, `web/src/data/guidance.ts` (hand-written provenance) is deleted, and the `FAMILY_LEADS` and `LOCAL_GUIDELINES` maps in `guidanceEngine.ts` are gone.

## 2. Store (`server/guidelines/store.py`)

SQLite, path from `ACUDX_DB_PATH` (default `server/data/acudx.db`, which is gitignored; `:memory:` for tests). One table, `guideline_statement`:

| Column | Meaning |
|---|---|
| `id` | stable statement id (`gs_...`) |
| `statement_en`, `statement_tr` | our condensed expression of the recommendation, bilingual |
| `source_body`, `source_title`, `source_url` | issuing body, document title, the exact document URL a learner opens |
| `fetch_url` | where the verifier fetches when `source_url` is a DOI or publisher page that is not fetchable headlessly (an open-access mirror of the same article) |
| `doi`, `edition_or_version`, `published_date` | provenance |
| `retrieved_at`, `verified_at`, `verified_by`, `verification_method`, `verification_quote`, `verification_url`, `verification_note` | evidence; `verification_note` holds the failure reason or the audit line (`score 0.93; 14/15 terms; html 48138 chars`) |
| `license_tag` | `open` or `copyrighted-summarized` |
| `scope` (JSON) | countries, specialties, population, care setting |
| `condition_codes` (JSON) | ICD-10 codes joined to `server/condition_catalog.py` |
| `topic`, `status` | retrieval key; `draft`, `verified`, `failed`, `retired` |

`GuidelineStore.seed()` migrates every record of `server/guidelines_seed.py` (50 records) and every record of `server/guidelines/seed_open.py` (105 records) as `draft`. Seeding is idempotent: a row whose text and source did not change is left alone with its evidence or its failure reason. Re-authoring a statement resets it to `draft`.

`get_store()` opens the process store lazily. An empty database is populated from the committed evidence file `server/guidelines/statements.verified.json`, so a fresh deployment serves verified statements without any network access.

### 2.1 Legacy migration

`legacy_to_statement()` projects a seed record onto the schema. Where the seed pointed at a landing page, `seed_open.URL_REFINEMENTS` replaces the URL with the exact document (for example `nice.org.uk/guidance/ng228` becomes `.../ng228/chapter/Recommendations`; the SSC landing page becomes the adult guidelines page that carries the recommendation list; the JBDS landing becomes the DKA guideline PDF). The original URL stays in `verification_note` for audit. `seed_open.TOPIC_CONDITION_CODES` supplies ICD-10 codes per legacy topic and `seed_open.DOI_BY_ID` the DOIs of the journal guidelines.

### 2.2 Open seed

`seed_open.open_statements()` adds 105 statements written against documents that were actually fetched and read before authoring: NICE recommendation chapters (NG185, NG158, NG253, NG17, NG128, NG228, CG150, NG115, NG250, NG104, CG141, NG148, NG217, NG235, NG126, CG113, NG225, NG10, NG240, CG100, CG151, NG111, NG141, NG118), the SSC 2021 adult guideline page, the JBDS 02 DKA PDF, the UK Kidney Association hyperkalaemia PDF, BTS/SIGN 158, the MHRA paracetamol Drug Safety Update, the WHO opioid overdose fact sheet, the RCOG Green-top 52 page, the JCS 2020 aortic guideline on J-STAGE, and open-access articles mirrored by Europe PMC (WAO anaphylaxis guidance 2020, SPLF 2023 pneumothorax guideline, WSES 2025 tension pneumothorax consensus) or served by Springer (WSES 2020 appendicitis, WSES 2020 cholecystitis, WSES 2019 pancreatitis).

## 3. Verifier (`server/guidelines/verifier.py`)

For each draft:

1. **Homepage gate.** A `source_url` that is a bare host, or one of the known landing pages (`saglik.gov.tr`, `tepdad.org.tr`, `who.int/emergencycare`), fails immediately with the reason "homepage-only source_url; the exact document URL is not recorded". Nothing is fetched and no document is invented.
2. **Fetch.** `fetch_url or source_url` is fetched with httpx (40 s timeout, follow redirects, a named User-Agent, one request per host per second, robots.txt respected, 25 MB cap). A JavaScript or anti-bot wall, a login page, an HTTP error or fewer than 200 characters of text are failures with that reason.
3. **Extract.** PDF through pypdf, JATS XML through tag stripping (front and back matter removed), HTML through trafilatura with an lxml full-text fallback; the longer extraction wins because trafilatura mis-picks the main block on some NICE chapters.
4. **Locate.** The statement's content terms are weighted (numbers count double) after normalisation: UK and US spellings are unified, common synonyms are mapped (adrenaline to epinephrine, dextrose to glucose), unit tokens are split, and ranges such as `94-98%` expose both numbers. Sentence windows of one to three sentences are scored by weighted recall. When one window cannot cover a statement that condenses two neighbouring recommendations, a two-excerpt composite quote (`... [...] ...`) is allowed.
5. **Decide.** Verified when the best window scores at least 0.50 (0.55 for a composite), at least five content terms match, and at least one of the statement's numbers appears in the quote when the statement has numbers. Otherwise failed, with the score, the term counts and the best candidate recorded in `verification_note`.
6. **Embedding (optional).** When the Model Gateway embed adapter is reachable, the top lexical candidates are re-scored by cosine similarity and blended (0.6 lexical, 0.4 cosine); `verification_method` becomes `lexical+embedding`. The adapter is probed once; when it is down the run stays lexical.

The thresholds were set from the first runs: the ESC, GOLD and Endocrine Society landing pages scored at most 0.24 and the authored statements scored 0.73 to 1.00, so the margin is wide; two composites at exactly 0.50 stitched weakly related fragments, which is why composites need 0.55.

Run it with `python -m server.guidelines.verifier --export server/guidelines/statements.verified.json`. Use `--all` to re-verify failed rows, `--ids` for a subset, `--no-embed` to stay lexical.

### 3.1 Result of the run committed in this slice

155 drafts checked on 19 October 2026 from the build sandbox: **113 verified, 42 failed**.

| Failure reason | Count | Records |
|---|---|---|
| Homepage-only source URL (no exact document recorded) | 8 | the two T.C. Saglik Bakanligi, the three TEPDAD, the two WHO emergency-care summaries, TOXBASE (login) |
| Publisher blocks headless fetching (403 JavaScript wall) | 3 | the two AHA/ASA stroke statements (ahajournals.org), Tokyo Guidelines (jshbps.jp) |
| Document not found at the recorded URL (404) | 3 | ESC aortic diseases, ESC pericardial diseases (two statements) |
| Landing page without the recommendation text | 9 | ESC ACS (four), ESC heart failure, ESC atrial fibrillation, ESC pulmonary embolism, GOLD 2024, Endocrine Society, JBDS HHS |
| Guideline withdrawn by the publisher | 1 | NICE CG191 (replaced by NG250) |
| Paraphrase too loose for the located passage (score below threshold) | 18 | legacy NICE, SSC, BTS, IDSA, RCOG and WHO summaries; every one has a tighter verified replacement in the open seed |

Every failed row keeps its reason in `verification_note` and stays out of learner view. The ESC and AHA recommendations are not lost to the product: their open equivalents (NICE NG185, NG158, NG128) are verified and carry the same thresholds.

## 4. Attending tips (`server/guidelines/tips.py`)

86 hand-authored tips in the AMBOSS attending register: one next best action, one pitfall, a timing hint, bilingual, each with `condition_codes` and `statement_ids`. `list_tips()` emits a tip only when every linked statement is `verified` in the store; a tip whose evidence failed is withheld rather than shown with a weaker citation. Families covered: ACS, PE, aortic dissection, sepsis, DKA, stroke and ICH, SAH, anaphylaxis, asthma and COPD, pneumonia, pneumothorax, appendicitis, cholecystitis, pancreatitis, upper GI bleed, AKI and hyperkalaemia, paracetamol and opioid overdose, status epilepticus, PPH, ectopic pregnancy, panic and self-harm and agitation, meningitis, alcohol withdrawal, neutropenic sepsis, pyelonephritis, cellulitis, renal colic.

`server/tests/test_tips.py` asserts that every tip's statement ids exist and are verified in the committed evidence, and that each required family returns at least one tip.

## 5. HTTP surface (`server/guidelines/routes.py`)

| Route | Behaviour |
|---|---|
| `GET /v1/guidelines/statements?condition=&stage=&locale=` | verified statements; `condition` is an ICD-10 code, a catalog id or a label; `stage` narrows to the statements that stage's tips cite |
| `GET /v1/guidelines/statements/{id}` | the learner view of one verified statement; 404 with `status` for a draft or failed row |
| `GET /v1/guidelines/tips?condition=&stage=&locale=` | tips plus the verified statements they cite, keyed by id |
| `POST /admin/guidelines/verify` | re-runs the verifier; `X-Admin-Token` compared with `ADMIN_TOKEN` by `secrets.compare_digest`; 503 when unset, 401 on mismatch, 409 under `AIRGAPPED` unless `ACUDX_VERIFIER_ALLOW_EGRESS=1` (verification is a clock-3 batch job that reaches publishers) |

`/v1/ground` now retrieves over `GuidelineStore.verified()` only, and each passage's `citation` carries `doi`, `edition` and `verified_at`.

## 6. Web contract (`web/src/lib/guidelinesApi.ts`)

* `toCitationView()` maps a statement payload to the chip: label (`NICE NG185`, `SSC (SCCM/ESICM) 2021`), body, title, edition, link (source URL or DOI), verification date, verified quote.
* `CitationPill` renders that chip with a tooltip and a new-tab link. It fetches the statement by id when the caller has no payload, shows a loading chip, and shows a dashed "source unavailable" chip when the backend is off or the id is not verified. Legacy ids persisted in older records resolve through `LEGACY_CITATION_ALIASES`; the TEPDAD and TITCK framework tags resolve to nothing and therefore render as unavailable.
* `GuidanceCard` takes a `GuidanceHint` built from a verified `/v1/ground` passage; `null` renders "guidance unavailable".
* `AttendingTips` consumes `/v1/guidelines/tips` for the case's condition code, groups rows by stage, and unlocks treatment and disposition rows only once the encounter reaches assessment so the coach never leaks management ahead of the work-up.
* `useLiveGrounding` returns `unavailable: true` with no passages when the backend is off, errors or returns nothing.

Case definitions (`caseGen.ts`, `seedCases.ts`, `authoring.ts`, `progressStore.ts`) now reference verified statement ids. Generic emergency work-up items that have no verified statement yet keep the `tepdad-em` tag and render an honest unavailable chip; authoring verified statements for those items is the next step.

## 7. Operations

* Re-verify after a guideline update: `python -m server.guidelines.verifier --all --export server/guidelines/statements.verified.json`, review the failures, commit the export.
* Add a statement: write it in `seed_open.py` against a document you have fetched and read, run the verifier, confirm the quote is the passage you meant.
* Never add a homepage as a source. If the exact document cannot be fetched headlessly, record the DOI as `source_url` and an open-access mirror as `fetch_url`.
* `server/data/*.db` is local state; the evidence of record is the JSON export.
