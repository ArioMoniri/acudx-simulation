# 14. Results and Imaging Engine

Status: implemented on the server (`server/results/`), routes mounted in `server/app.py`, typed client in `web/src/lib/resultsApi.ts`. The web encounter store resolves orders through the engine in Live mode (section 8); the client-side `syntheticNormalResult` remains only as the labelled offline fallback and the live Commons search is gone.

## 1. Problem

The audit (docs/review/00, sections 1 and 7) found two shipped paths that invent clinical data in the browser: `orderables.syntheticNormalResult` makes up normal values for any order the case did not author, and `openMedicalImages.ts` runs a live Wikimedia Commons search that can return a wrong image for the condition or the wrong side. Neither path knows what time it is in the encounter, what the learner has already given, or where its numbers came from.

The engine replaces both with a server-side resolver whose every output is condition-correct, time- and treatment-responsive, physiologically bounded, deterministic for a seed, and carries provenance a reviewer can check.

## 2. Design rules

1. Truth lives in structured state, never in prose or pixels. The case spec's authored `labs` and `imaging` are ground truth at arrival; the per-condition profile fills the rest; the image is selected to match the structured finding; the LLM (not called here) will write prose only from that state. `narrative` is returned as `null` on purpose.
2. Every number has a source. `reference_ranges.json` refuses a value without `source` and `reviewed_at`; every kinetics constant cites its paper in the docstring that uses it; every image carries license, attribution, source page and verification date.
3. Laterality never flips. A sided finding is served only by a same-sided, bilateral or non-sided image. An image of unknown side is never used for a sided finding.
4. No runtime web access. The imaging bank is a local JSON index built and verified offline. A miss returns `status: "unavailable"` with the structured findings, and the UI shows the report without a picture.
5. Deterministic. All sampling is a SHA-256 hash of `(seed, order_code, analyte)`; the ECG uses a seeded NumPy generator. The same case and order always produce the same result, so an educator can see exactly what a learner saw.
6. Education only. Synthetic patients, representative teaching images, synthetic ECG tracings labelled as such.

## 3. Components

```
POST /v1/results/resolve  (case_state, order_code, sim_time_ms, prior[], seed)
        |
        v
engine.resolve_order
  CaseContext: condition id (catalog lookup by label or ICD-10), sex, age,
               severity from ESI acuity (capped per condition), hours since
               onset, treatments mapped onto the kinetics vocabulary,
               vitals interpolated from the trajectory
  |-- lab panel  -> reference_ranges.json panels -> per analyte:
  |                 baseline sampled inside the sex/age range
  |                 -> profile spec (troponin, lactate, CRP, PCT, creatinine,
  |                    DKA, potassium, haemoglobin, oxygenation, paracetamol,
  |                    static or multiplied value)
  |                 -> authored case value overrides at arrival and rescales the
  |                    kinetic curve for later draws
  |                 -> flag N/L/H/LL/HH, delta from prior, interpretation
  |-- imaging    -> profile finding + laterality (authored findings_en wins)
  |                 -> imaging_bank.resolve -> image + provenance, or unavailable
  |-- ECG        -> profile pattern (rate from vitals) -> ecg.synthesize
  |                 measurements; the waveform is fetched from POST /v1/results/ecg
  |-- micro      -> organism and positivity from the profile, halved when
                    antibiotics were given before the draw
  -> turnaround per category with a source, available_at_ms, narrative: null
```

### 3.1 reference_ranges.json

LOINC-coded analytes with UCUM units, adult sex-specific rows and age bands (D-dimer uses the ADJUST-PE age x 10 rule above 50), critical limits, and a `source` URL plus `reviewed_at` per row. Panels map the catalogue's order codes (`web/src/domain/orderables.ts`) to analyte lists: CBC, BMP, CMP, LFT, lipase and amylase, coagulation, hs-cTnT and hs-cTnI, BNP and NT-proBNP, lactate, VBG and ABG, CRP, PCT, D-dimer, urinalysis, glucose, HbA1c, TSH and T4, beta-hCG, blood and urine culture, CK, magnesium, phosphate, ammonia, osmolality, ethanol, paracetamol, salicylate, ketones, ferritin, LDH, uric acid, cortisol.

Known gaps, stated in the file's `notes`: paediatric bands are not yet authored (CALIPER import pending); LOINC codes are best-effort educational mappings that must be re-verified against LOINC search before any clinical-facing use; ionised calcium, CK-MB, free T4 and base excess are omitted because no public source was verified for them on 2026-10-19.

### 3.2 kinetics.py

Pure functions of `(severity, t_h, treatments[])`, clamped to `BOUNDS`:

| Function | Model | Key constants |
|---|---|---|
| `troponin` | gamma rise to peak, biexponential decay | hs-cTnI peak 8.3 h, hs-cTnT 11.2 h; fast half-life 15 h; slow 40 h (cTnI) and 280 h (cTnT) reproducing 50 percent of peak at about 45 h and 116 h; reperfusion washout; sex-specific 99th percentiles |
| `troponin_rule` | ESC 2020 0 h/1 h algorithm | Elecsys 5/12/3/52/5, Architect 4/5/2/64/6 ng/L |
| `lactate` | rise to a severity plateau, first-order clearance once perfusion is restored | half-life 2 h (4 h in hepatic impairment), floor 1.0 |
| `crp` | 6 h lag, peak at 48 h, 19 h half-life after the stimulus ends | peak 20 + 280 x severity mg/L |
| `procalcitonin` | rise at 2 to 4 h, peak 12 to 24 h, 24 h half-life | viral illness stays below 0.5 ng/mL |
| `creatinine_aki`, `kdigo_stage` | approach to a new steady state, 24 h recovery half-life, dialysis step | 1.8 to 2.0 mg/dL rise at 24 h for 90 percent GFR loss; KDIGO 2012 stages |
| `dka_state` | JBDS 2023 rates under fixed-rate insulin and fluids; Winter's formula and Henderson-Hasselbalch | glucose -3, ketones -0.5, bicarbonate +3 mmol/L/h |
| `potassium` | pulse effects of insulin-dextrose, salbutamol, dialysis; acid-base shift | -0.8 and -0.7 mmol/L; +0.6 per 0.1 pH fall |
| `hemoglobin_hemorrhage` | plasma refill with an 8 h time constant, crystalloid dilution, PRBC | 70 mL/kg blood volume, 25 percent crystalloid retention, +1 g/dL per unit |
| `oxygenation`, `severinghaus_spo2`, `venous_from_arterial` | alveolar gas equation, linearised shunt, Severinghaus saturation, Byrne and Kelly venous offsets | device FiO2 table from the BTS oxygen guideline |
| `paracetamol_level`, `paracetamol_nomogram_line` | one-compartment first-order absorption; UK 100 mg/L and US 150 mg/L lines with a 4 h half-life | Vd 0.9 L/kg, F 0.9, half-life 2.5 h (4 h in hepatotoxic dose) |

### 3.3 ecg.py

An ECGSYN-style synthesizer: each beat is a sum of Gaussian P, Q, R, S and T waves per lead, with an ST plateau term, a PR-segment term, an optional delta wave and a wide-complex morphology switch. Pathologies are explicit rule edits, auditable by a cardiologist: STEMI by territory with reciprocal depression, NSTEMI (ST depression and T inversion), atrial fibrillation (irregular RR, no P, f-waves), SVT, VT, complete heart block (independent P train), hyperkalaemia, pericarditis (diffuse elevation, PR depression, aVR reciprocal), pulmonary embolism (S1Q3T3, anterior T inversion), WPW, long QT, and normal, tachycardic and bradycardic sinus rhythm. Output is 12 leads at 500 Hz for 10 s plus measurements (rate, PR, QRS, QT, QTc, axis, ST deviation per lead). `render_svg` draws the standard 3 x 4 panel with a lead II rhythm strip at 25 mm/s and 10 mm/mV on a 1 mm / 5 mm grid, with calibration pulses and a "synthetic tracing" footer. Tests measure ST at J + 60 ms on the generated samples, not on the parameters.

### 3.4 imaging_bank.json and imaging_bank.py

49 real images, every one verified on 2026-10-19 through the Wikimedia Commons imageinfo API (`License`, `LicenseUrl`, `Artist`, `UsageTerms` read and stored), with modality, region, finding, laterality, view, order codes, condition ids, caption, direct URL, optional local path under `web/public/imaging/`, license, attribution, source page, verification date and `is_synthetic: false`. Licenses present: CC0, public domain, CC BY 3.0 and 4.0, CC BY-SA 2.5 to 4.0. BY-SA entries are served with the license named so derivatives stay BY-SA.

Normal studies exist for every modality in the catalogue (XR, CT, MRI, US, echo, ECG) and for the regions chest XR, hand and foot XR, CT head, CT abdomen and pelvis, US liver, gallbladder and right kidney, echo four-chamber, MRI brain, lumbar spine and MRCP. Regions without a verified normal yet (abdominal XR, CT cervical spine, CT chest and CTPA, pelvic US, DVT-negative leg US, cervical spine MRI) return `unavailable` for normal findings and the report stands alone; they are the first import targets.

The `banks` block records the state of the other sources from research doc 15: NIH ChestX-ray14 (candidate; the HF card did not show the NIH FAQ text so the attribution wording is held until recorded), TCIA (candidate; policy text and the Clark 2013 citation recorded), MedPix 2.0 on Zenodo (CC BY 4.0 record verified; `Descriptions.json` downloaded and scanned, captions are case-specific so nothing is served yet), Open-i (FAQ fetch returned no content; per-image license must be read before import), Radiopaedia (excluded, link out only).

### 3.5 engine.py

`resolve_order(case_state, order_code, sim_time_ms, prior=None, seed=None)`. The condition id is derived from the GeneratedCaseSpec's `condition.label_en` or `icd10` against `server/condition_catalog.py`. About 95 conditions have profiles (labs that move, imaging finding per modality with laterality, ECG pattern, microbiology, urinalysis pattern, a severity cap); the rest resolve to normal results and vitals-driven sinus rhythm. Treatments arrive as `case_state.treatments_given[] = {code|label, at_ms, amount?}` and are mapped by keyword onto the kinetics vocabulary (insulin infusion, insulin-dextrose, fluids with litres, PRBC units, oxygen device or FiO2, antibiotics, vasopressor, PCI, lysis, NAC, calcium, salbutamol, potassium, dialysis, source control).

Turnaround times come from a table with a source per category: point-of-care 5 min, blood gas 10 min, ECG 10 min (ESC 2023 ACS), chemistry 45 min and haematology 40 min (Hawkins 2007), troponin 60 min (Fourth Universal Definition of MI), cultures 24 h preliminary and 48 h final (Lamy 2016, MedlinePlus), imaging per the app's sense-of-time convention. `available_at_ms = sim_time_ms + turnaround.ms`.

### 3.6 Routes and client

`server/results_routes.py` (APIRouter) is mounted with two lines in `server/app.py`:

- `POST /v1/results/resolve` -> `OrderResult`
- `POST /v1/results/ecg` -> `EcgResult` (samples and/or SVG)
- `GET /v1/results/reference-ranges` (whole table, or one analyte resolved for sex and age)
- `GET /v1/imaging/resolve` -> `ImagingResolveResult`

`web/src/lib/resultsApi.ts` mirrors the pydantic models and exposes `resolveOrder`, `ecgStrip`, `referenceRanges`, `referenceRange`, `resolveImaging`, with the same bounded-timeout, never-throw `BackendResult` contract as `backend.ts`.

## 4. Tests

`server/tests/`: `test_kinetics.py` (35), `test_ecg.py` (17), `test_imaging_bank.py` (8), `test_engine.py` (16), `test_results_routes.py` (4). Run with `python -m pytest server/tests -q` after `pip install -r server/requirements-dev.txt`. Highlights: troponin time to peak within 0.3 h of the published medians and cTnI falling faster than cTnT; lactate clears over 10 percent in 2 h after fluids; DKA moves at JBDS rates; insulin-dextrose lowers potassium 0.65 to 1.0 mmol/L at 1 h; ST elevation present in V1 to V4 for anterior STEMI with reciprocal inferior depression measured on the samples; QRS over 120 ms for VT; every bank entry licensed, attributed, verified, URL well-formed; laterality never flips; results deterministic for a seed; every observation carries a source URL.

## 5. What the LLM layer gets

The engine hands the narrative layer a complete structured state: observations with flags, deltas and short deterministic interpretations; imaging findings with laterality and an impression; ECG measurements and pattern; provenance for any picture. The model is constrained to write from that state and must not add findings. Grading compares the learner's interpretation to the same state.

## 6. Next steps

1. Done (2026-10-20, section 8): `encounterStore` resolves through `resolveOrder` in Live mode, `syntheticNormalResult` is the labelled offline fallback, and the live Commons search was removed.
2. Import verified normals for the uncovered regions (section 3.4) and the first NIH ChestX-ray14 and MedPix 2.0 subsets with radiologist sign-off.
3. Author paediatric reference bands from CALIPER and have a clinical pathologist sign `reference_ranges.json`.
4. Replace the vitals interpolation with the Pulse Physiology Engine when it lands (docs/research/15, section 4.3), keeping this kinetics layer for the analytes Pulse does not model.
5. Store ECGs as DICOM Waveform and render through dcmjs-ecg in the viewer; keep `render_svg` for printouts.

## 8. Web integration (shipped 2026-10-20)

Code: `web/src/state/encounterStore.ts`, `web/src/lib/liveEncounter.ts`, `web/src/components/ehr/tabs/ResultsTab.tsx`, `web/src/components/ehr/StudyViewer.tsx`, `web/src/lib/openMedicalImages.ts`. Tests: `web/src/state/encounterStoreLive.test.ts`, `web/src/lib/liveEncounter.test.ts`, `web/src/lib/openMedicalImages.test.ts`.

Live mode is the gateway's reachability (`LiveBackendProvider` health probe), pushed into the store with `setLiveEnabled`. In Live mode:

- `placeOrder` asks `POST /v1/results/resolve` at placement time with `case_state` built from the running `CaseInstance` (`caseInstanceToSpec`, plus `treatments_given` and the earlier engine results as `prior`), `sim_time_ms = placedAt`. The engine's `turnaround.minutes` becomes the ETA label the learner sees; the local playback timer stays the scheduler that reveals the answer. When the timer fires the stored engine answer becomes a `ResolvedResult` with `source: "engine"` and the full `OrderResult`, and the `result` event carries `meta.source = "engine"`, `engineKind`, `abnormal`, `critical`, `status`.
- If the engine fails (5xx, timeout, network) the order still resolves, through the authored case datum (`meta.source = "case"`) or the on-device fallback (`meta.source = "offline-synthetic-normal"`). Nothing is silent: the Results tab shows a provenance chip on every panel, trend, culture and study (Results engine, Case record, Offline synthetic normal) and offline rows carry an "offline synthetic" tag.
- `ResultsTab` renders engine observations through `engineObservationToFhir` (LOINC code, flag, range, unit) so the same panel and trend tables serve both paths. Engine abnormal and critical observations join the summary badges and the critical callout.
- Imaging orders render the engine's `report`: the matched bank image with its provenance footer (licence with link, attribution text, source page, verification date, "Representative image, not this patient"), or, when `image_status` is `unavailable`, the structured findings and impression alone with the reason. ECG orders fetch the 12-lead printout from `POST /v1/results/ecg` (`include_svg`, no samples) and show it as an image with the legend "25 mm/s, 10 mm/mV" plus the measurements table; the SVG string never enters the DOM as markup.
- Off Live mode the behaviour is the previous one, now labelled: authored data from the reveal graph, the curated image bundle (`src/data/conditionImaging.ts`) for pictures, and `syntheticNormalResult` values tagged as offline synthetic.

`web/src/lib/openMedicalImages.ts` is bundle-only: `resolveStudyImage` is synchronous and returns a curated entry or null. The Wikimedia Commons search code was deleted; `openMedicalImages.test.ts` asserts that no `fetch` happens on the image path.

## 7. Citations

Reference ranges and critical limits

- NBME Laboratory Values. https://www.nbme.org/laboratory-values/ (accessed 2026-10-19)
- Kost GJ. Critical limits for urgent clinician notification at US medical centers. JAMA 1990;263:704-707. https://doi.org/10.1001/jama.1990.03440050098042
- MedlinePlus Medical Encyclopedia (NLM): Lactic acid test 003507; CRP 003356; Ammonia 003506; BNP 007509; Blood gases 003855; Urinalysis 003579; Urine specific gravity 003587; Urine pH 003583; HCG quantitative 003510; TSH 003684; PT 003652; PTT 003653; Fibrinogen 003650; Toxicology screen 003578; Blood culture 003744; Urine culture 003751. https://medlineplus.gov/ency/
- Collet JP et al. 2020 ESC Guidelines for the management of acute coronary syndromes in patients presenting without persistent ST-segment elevation, Table 5. Eur Heart J 2021;42:1289-1367. https://doi.org/10.1093/eurheartj/ehaa575
- Apple FS, Collinson PO. Analytical characteristics of high-sensitivity cardiac troponin assays. Clin Chem 2012;58:54-61. https://doi.org/10.1373/clinchem.2011.165795
- Gore MO et al. Age- and sex-dependent upper reference limits for the high-sensitivity cardiac troponin T assay. J Am Coll Cardiol 2014;63:1441-1448. https://doi.org/10.1016/j.jacc.2013.12.032
- McDonagh TA et al. 2021 ESC Guidelines for the diagnosis and treatment of acute and chronic heart failure, section 4.2. Eur Heart J 2021;42:3599-3726. https://doi.org/10.1093/eurheartj/ehab368
- Righini M et al. Age-adjusted D-dimer cutoff levels to rule out pulmonary embolism: the ADJUST-PE study. JAMA 2014;311:1117-1124. https://doi.org/10.1001/jama.2014.2135
- Singer M et al. The Third International Consensus Definitions for Sepsis and Septic Shock (Sepsis-3). JAMA 2016;315:801-810. https://doi.org/10.1001/jama.2016.0287
- Long N. Salicylate toxicity. LITFL, 2020. https://litfl.com/salicylate-toxicity/
- Road Traffic Act 1988 s.11 (UK prescribed alcohol limit). https://www.legislation.gov.uk/ukpga/1988/52/section/11
- LOINC license. https://loinc.org/kb/license ; UCUM license. https://ucum.org/license

Kinetics

- van Doorn WPTM et al. High-sensitivity cardiac troponin I and T kinetics after non-ST-segment elevation myocardial infarction. J Appl Lab Med 2020;5:239-241. https://doi.org/10.1373/jalm.2019.029785
- Mair J et al. hs-cTn kinetics after STEMI (half-lives 12.4 to 17.3 h, reperfusion washout). PMC10432699, 2023.
- Vincent JL et al. The value of blood lactate kinetics in critically ill patients: a systematic review. Crit Care 2016;20:257. PMID 27520452
- Nguyen HB et al. Early lactate clearance is associated with improved outcome in severe sepsis and septic shock. Crit Care Med 2004;32:1637-1642. https://doi.org/10.1097/01.CCM.0000132904.35713.A7
- Pepys MB, Hirschfield GM. C-reactive protein: a critical update. J Clin Invest 2003;111:1805-1812. https://doi.org/10.1172/JCI18921
- Schuetz P, Albrich W, Mueller B. Procalcitonin for diagnosis of infection and guide to antibiotic decisions. BMC Med 2011;9:107. https://doi.org/10.1186/1741-7015-9-107
- Meisner M. Update on procalcitonin measurements. Ann Lab Med 2014;34:263-273. https://doi.org/10.3343/alm.2014.34.4.263
- Waikar SS, Bonventre JV. Creatinine kinetics and the definition of acute kidney injury. J Am Soc Nephrol 2009;20:672-679. https://doi.org/10.1681/ASN.2008070669
- KDIGO Clinical Practice Guideline for Acute Kidney Injury. Kidney Int Suppl 2012;2:1-138. https://kdigo.org/wp-content/uploads/2016/10/KDIGO-2012-AKI-Guideline-English.pdf
- KDOQI Clinical Practice Guideline for Hemodialysis Adequacy: 2015 update. Am J Kidney Dis 2015;66:884-930. https://doi.org/10.1053/j.ajkd.2015.07.015
- JBDS-IP. The Management of Diabetic Ketoacidosis in Adults, revised March 2023. https://abcd.care/sites/default/files/site_uploads/JBDS_Guidelines_Current/JBDS_02_DKA_Guideline_with_QR_code_March_2023.pdf
- Albert MS, Dell RB, Winters RW. Quantitative displacement of acid-base equilibrium in metabolic acidosis. Ann Intern Med 1967;66:312-322. https://doi.org/10.7326/0003-4819-66-2-312
- UK Kidney Association. Clinical Practice Guideline: Treatment of Acute Hyperkalaemia in Adults, 2023. https://ukkidney.org/health-professionals/guidelines/treatment-acute-hyperkalaemia-adults
- Adrogue HJ, Madias NE. Changes in plasma potassium concentration during acute acid-base disturbances. Am J Med 1981;71:456-467. https://doi.org/10.1016/0002-9343(81)90182-0
- American College of Surgeons. ATLS Student Course Manual, 10th ed., Shock chapter (blood volume 7 percent of body weight); Nadler SB et al. Surgery 1962;51:224-232.
- Hahn RG. Volume kinetics for infusion fluids. Anesthesiology 2010;113:470-481. https://doi.org/10.1097/ALN.0b013e3181dcd88f
- NICE NG24 Blood transfusion, 2015. https://www.nice.org.uk/guidance/ng24
- O'Driscoll BR et al. BTS guideline for oxygen use in adults in healthcare and emergency settings. Thorax 2017;72:ii1-ii90. https://doi.org/10.1136/thoraxjnl-2016-209729
- Lumb AB. Nunn's Applied Respiratory Physiology, 8th ed., chapters 7 and 10 (alveolar gas equation, venous admixture).
- Severinghaus JW. Simple, accurate equations for human blood O2 dissociation computations. J Appl Physiol 1979;46:599-602. https://doi.org/10.1152/jappl.1979.46.3.599
- Byrne AL et al. Peripheral venous and arterial blood gas analysis in adults: are they comparable? Respirology 2014;19:168-175. https://doi.org/10.1111/resp.12225
- Kelly AM. Agreement between arterial and venous blood gases in emergency medical care: a systematic review. Hong Kong J Emerg Med 2013;20:166-171. https://doi.org/10.1177/102490791302000307
- MHRA. Treating paracetamol overdose with intravenous acetylcysteine: new guidance. Drug Safety Update, September 2012. https://www.gov.uk/drug-safety-update/treating-paracetamol-overdose-with-intravenous-acetylcysteine-new-guidance
- Rumack BH, Matthew H. Acetaminophen poisoning and toxicity. Pediatrics 1975;55:871-876.
- Forrest JA, Clements JA, Prescott LF. Clinical pharmacokinetics of paracetamol. Clin Pharmacokinet 1982;7:93-107. https://doi.org/10.2165/00003088-198207020-00001

ECG

- McSharry PE, Clifford GD, Tarassenko L, Smith LA. A dynamical model for generating synthetic electrocardiogram signals. IEEE Trans Biomed Eng 2003;50:289-294. https://doi.org/10.1109/TBME.2003.808805
- NeuroKit2 `ecg_simulate`. https://neuropsychology.github.io/NeuroKit/functions/ecg.html
- Thygesen K et al. Fourth Universal Definition of Myocardial Infarction (2018). Eur Heart J 2019;40:237-269. https://doi.org/10.1093/eurheartj/ehy462
- Rautaharju PM et al. AHA/ACCF/HRS recommendations for the standardization and interpretation of the electrocardiogram, part IV. Circulation 2009;119:e241-e250. https://doi.org/10.1161/CIRCULATIONAHA.108.191096
- Goldberger AL, Goldberger ZD, Shvilkin A. Goldberger's Clinical Electrocardiography, 9th ed.
- Byrne RA et al. 2023 ESC Guidelines for the management of acute coronary syndromes (ECG within 10 min). Eur Heart J 2023;44:3720-3826. https://doi.org/10.1093/eurheartj/ehad191

Turnaround

- Hawkins RC. Laboratory turnaround time. Clin Biochem Rev 2007;28:179-194. PMC2282400 (PMID 18392122; the earlier PMC1282400 was wrong)
- Shorter laboratory turnaround time is associated with shorter ED length of stay (median TAT 51.1 min). BMC Emerg Med 2022. https://doi.org/10.1186/s12873-022-00763-w
- Improving ED flow: reducing turnaround time for emergent CT (order to final report median 4.2 h). AMIA Annu Symp Proc 2018. PMC6371246
- Impact of an in-house emergency radiologist on report turnaround time (preliminary 2.05 to 2.40 h, final 2.75 h). CJEM 2015. https://doi.org/10.2310/8000.2013.131235
- Lean-driven interventions improve ED imaging turnaround (median 70 to 36 min). Emerg Radiol 2021. https://doi.org/10.1007/s10140-020-01803-3
- Abbreviated MRI for dizziness: report turnaround (NCCT head 1.41 h, CTA 3.86 h, MRI 6.14 h). Emerg Radiol 2024. https://doi.org/10.1007/s10140-024-02273-7
- Seasonal variations in blood culture time to positivity; 5-day standard incubation. Eur J Clin Microbiol Infect Dis 2021. https://doi.org/10.1007/s10096-021-04248-9
- Lamy B et al. How to optimize the use of blood cultures for the diagnosis of bloodstream infections? Front Microbiol 2016;7:697. https://doi.org/10.3389/fmicb.2016.00697

Imaging bank licensing

- Commons:Licensing. https://commons.wikimedia.org/wiki/Commons:Licensing ; Commons:Reusing content outside Wikimedia. https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia
- Each entry's `source_page` in `server/results/imaging_bank.json` (49 Commons file pages, imageinfo read 2026-10-19).
- TCIA Data Usage Policies and Restrictions. https://www.cancerimagingarchive.net/data-usage-policies-and-restrictions/ ; Clark K et al. J Digit Imaging 2013;26:1045-1057. https://doi.org/10.1007/s10278-013-9622-7
- MedPix 2.0 on Zenodo, CC BY 4.0. https://zenodo.org/records/12624810 (doi 10.5281/zenodo.12624810)
- NIH ChestX-ray14 (Wang X et al., CVPR 2017, arXiv 1705.02315). https://nihcc.app.box.com/v/ChestXray-NIHCC ; card https://huggingface.co/datasets/timm/nih-chest-xray-14
- Radiopaedia Terms (link out only). https://radiopaedia.org/terms
- docs/research/15-imaging-labs-providers-oct-2026.md (provider survey this design follows)

## 9. Order catalogue, sim-time turnaround and terminologies (2026-10-21)

### 9.1 The reported fault

A learner in a live encounter saw "Lactate dehydrogenase (LDH), 1 analytes, Offline synthetic normal, Ordered 0 min -> resulted 0 min". Root causes:

1. Any failed engine request (timeout, HTTP error, or an engine exception on a model-written spec such as `age: "58 years"`) made the store finalize the order as `offline-synthetic-normal`, although the gateway was up. The engine now coerces every numeric field (`engine.num`), and the store retries (1 s, 3 s), shows "result unavailable" with a retry when the reachable engine refuses (4xx, 500), and uses the offline label only when the gateway is unreachable and Live mode is off.
2. Results were revealed after a compressed wall-clock delay (18 s for chemistry), so both timestamps rounded to 0 min. Orders are now scheduled on the sim clock with the test's realistic turnaround and stay pending until it is reached; the learner can advance time to the next result (`advanceSimTime`, which also steps the Director by the same elapsed time, so the patient's course moves too).
3. "1 analytes": `labs2.results.analytes_one/_other`.
4. "Code: Full code" in the banner is the resuscitation status; it now reads "Resuscitation status: Full resuscitation" with the meaning in the hint. A test fails on any learner string that labels something "Code:".

### 9.2 Catalogues

| File | Content |
|---|---|
| `server/results/lab_catalog.json` | 105 orderables in 18 sections (haematology to body fluids) with LOINC order code, member analytes, specimen, turnaround class, generator |
| `server/results/reference_ranges.json` | 189 analytes, each with UCUM unit, sex/age intervals (open-ended where the source is), source URL, review date |
| `server/results/imaging_catalog.json` | 43 imaging procedures with LOINC radiology code and Playbook attributes (modality, body part, contrast), mapped to the imaging bank |
| `server/results/catalog.py` | loaders, `TURNAROUND` with `basis` (measured, guideline or convention) and source, `public_catalog()` |
| `server/results/specimens.py` | CSF, pleural/ascitic/synovial fluid, blood group and microbiology generators |

Generators: `analyte` (ground truth, kinetics, seeded value in the interval, then electrolyte, protein and red-cell-index reconciliation and derived anion gap, CKD-EPI 2021 eGFR, globulin, Friedewald LDL), `micro` (profile organism and probability, culture preliminary at 24 h and final at 48 h or 5 days), `csf`, `body_fluid` (a fluid result exists only when the patient has that effusion; otherwise "no specimen obtainable"). Drug levels and toxic alcohols are "not detected" unless the case exposes the patient.

Turnaround (sim minutes, order to report): POC 5, blood gas 10, chemistry 50 and haematology 45 (BMC Emerg Med 2022 median 51.1), troponin 60 (UDMI 2018), XR 60, NCCT head 85, CT 250 with a preliminary read at 125, CTA 230, US 165 (preliminary 125), MRI 370, cultures preliminary 24 h and final 48 h (blood culture 5 days when negative). Figures marked `convention` are AcuDx teaching defaults and say so.

Fixes found while verifying codes against LOINC 2.82: 1841-5 (ammonia), 53060-9 (beta-hydroxybutyrate) and 5797-1 (urine ketones) do not exist (now 22763-7, 6873-4, 5797-6, with the old codes kept as aliases); the imaging map sent 30746-2 (portable chest XR) to CT aorta, 42272-5 (chest XR) to CT abdomen, 34534-8 (EKG panel) to echo and 24725-4 (CT head) to MRI spine, and used two codes that do not exist (36953-5, 39150-9).

### 9.3 Terminologies

`scripts/terminology/build_terminology.py` (standard library only) downloads into `data/terminology/cache/` (git-ignored), records SHA-256 and licence in `data/terminology/MANIFEST.json`, and writes:

| Output | Source | Licence | In repo |
|---|---|---|---|
| `server/terminology/data/icd10cm-fy2027.json.gz` (98,403 codes, 74,879 billable, alphabetic-index synonyms) | CDC/NCHS FY2027 code descriptions and index | public domain | yes |
| `server/terminology/data/icd11-mms-2026-01.json.gz` (35,664 coded entities, code + title + URI unmodified) | WHO simple tabulation 2026-01 | CC BY-ND 3.0 IGO; WHO terms 1.2.2 and 1.2.3 allow incorporation in software with code, title, URI and attribution; no crosswalk (1.2.4) | yes |
| `server/terminology/data/loinc-verified.json` (244 codes) | LOINC 2.82 via `tx.fhir.org` `$lookup` | LOINC licence, notice in NOTICE | yes |
| `data/terminology/range-verification.json` | each cited source page fetched; cited bounds searched on the page | n/a | yes |
| `web/src/domain/generated/orderCatalog.generated.json` | `catalog.public_catalog()` | n/a | yes |

LOINC full-table download needs a free loinc.org account: sign in at https://loinc.org/downloads/, download the LOINC Table File (CSV) for the current release, unzip to `data/terminology/cache/loinc/`, then run `build_terminology.py loinc --loinc-csv data/terminology/cache/loinc/LoincTable/Loinc.csv`. Without it the script resolves each code on the HL7 terminology server. The RSNA Radiology Playbook RPID files ship with the LOINC release; the catalogue records the Playbook attribute values and links to https://playbook.radlex.org/.

Routes: `GET /v1/results/catalog`, `GET /v1/terminology/status`, `/v1/terminology/icd10cm/search?q=` (code prefix, words, index synonyms, a small table of clinical abbreviations marked as an AcuDx addition), `/v1/terminology/icd10cm/{code}` (with ancestors), `/v1/terminology/icd10cm/relate` (exact, more_specific, less_specific, same_category, same_block), `/v1/terminology/icd11/search`. The diagnosis picker merges server ICD-10-CM hits when the gateway is reachable; the debrief credits a more specific descendant of the case code and gives a same-category near miss for codes outside the curated catalogue.

CI: `python scripts/terminology/build_terminology.py check` (offline) fails when an output drifts from the manifest, the web catalogue is stale, or a LOINC code in use is unverified or inactive. Tests: `server/tests/test_terminology_catalog.py` (every orderable resolves with sourced observations, no orphan web orders, ranges sourced, turnaround, preliminary reports, the LDH live spec, ICD search, no "code:" labels).

## 10. Compressed encounter clock (2026-10-21)

### 10.1 The reported fault

Live report: "Sonuç should be faster, not that much wait time, in a couple of minutes." Section 9 put results on the sim clock with their clinical turnaround, but the sim clock ran at wall-clock speed, so a stat chemistry took 50 real minutes and a culture a day unless the learner pressed "Advance to next result".

### 10.2 Design

Every time the learner reads stays clinical sim time (ordered 4 min, resulted 49 min). Two settings make the real wait short:

| Setting | Default | Bounds | Meaning |
|---|---|---|---|
| `scale` | 6 | 1 to 60 | sim ms per real ms: one real minute is six sim minutes, so a ten-minute session covers the first hour of care (the usual bundle window) |
| `wait_cap_s.poc` | 15 | 5 to 600 | longest real wait for a bedside test report |
| `wait_cap_s.lab` | 45 | 5 to 600 | laboratory (chemistry, haematology, coagulation, troponin) |
| `wait_cap_s.imaging` | 90 | 5 to 600 | XR, CT, US, MRI (first report; the final after a preliminary waits one more cap) |
| `wait_cap_s.culture` | 120 | 5 to 600 | cultures (preliminary, then the final one more cap later) |

A pending report lands after `min(sim time left / scale, cap)` real seconds, the cap counted from the order (or from the preliminary report for the final). When the cap comes first, the store jumps the sim clock to the report: the same step as "Advance to next result", logged as a `stage` event with `meta.advancedMs` and `meta.auto = true`, and in Live mode the Clinical Director steps to the new sim time, so the patient's course moves on by the same time (an untreated patient keeps deteriorating). The button stays; it skips the remaining wait at once.

With the defaults: POC glucose 15 s, blood gas 15 s, stat chemistry 45 s, troponin 45 s, chest XR 90 s, NCCT head 90 s, CT with a preliminary read 90 s then the final at 180 s, blood culture preliminary 120 s and final 240 s. The pending row shows the sim ETA and "next report in ~N s real time".

One clock: every Director step carries `sim_time_ms` (the browser's encounter clock; a learner action is stamped when it happens, an `elapsed` step when it runs). The server Director sets `t_ms = max(t_ms, sim_time_ms)` and ignores the per-kind defaults and `elapsed_ms` (`server/orchestration/director.py` `Action.sim_time_ms`), so the server course, the browser vitals mirror (`domain/clinicalCourse.ts`, which reads the same sim clock) and the results engine (`sim_time_ms` = order time) share one time axis. The cadence tick is about five sim minutes, between 15 s and 60 s of wall time (`directorTickWallMs`); a time jump is never coalesced with a cadence tick.

### 10.3 Per-course setting (faculty)

Faculty set the clock for their course (the faculty's org) in the faculty panel, tab "Encounter clock" (`web/src/components/institution/CourseClockCard.tsx`), which previews the real waits. Routes (`server/learning/routes.py`, stored in `course_settings`):

| Route | Who | |
|---|---|---|
| `GET /v1/me/sim-clock` | any signed-in caller | the caller's course clock, the defaults, `source` (`course` or `default`), a preview of the real waits, the bounds |
| `GET /v1/faculty/sim-clock` | faculty and above | the same for the faculty's course |
| `PUT /v1/faculty/sim-clock` | faculty and above | `{ "scale": 12, "wait_cap_s": { "poc": 10, "lab": 30, "imaging": 60, "culture": 90 } }` (422 outside the bounds) |
| `DELETE /v1/faculty/sim-clock` | faculty and above | back to the defaults |

The encounter page reads `GET /v1/me/sim-clock` when the gateway is reachable and applies it (`setSimClockSettings`); a running encounter keeps its sim time and continues at the new scale. Offline, or when the answer fails, the defaults apply.

### 10.4 Parity and tests

`server/learning/sim_clock.py` and `web/src/domain/simClock.ts` implement the same rule; both read `server/tests/fixtures/sim_clock_parity.json` (defaults, bounds, wait classes, the real waits above, and a Director step sequence with the `sim_time_ms` each step must carry and the `t_ms` the server must reach). Tests: `server/tests/test_sim_clock.py` (defaults, waits, validation, Director follows the clock and never rewinds, routes and roles), `web/src/domain/simClock.test.ts`, `web/src/state/encounterSimClock.test.ts` (stat chemistry within 45 s stamped at 50 sim min, culture preliminary at 120 s and final at 240 s, Advance, real-time course setting), `web/src/state/encounterStoreLive.test.ts` (Director parity, engine turnaround with the cap), `server/tests/test_deploy_web_image.py` (the web image copies every fixture a web test imports).
