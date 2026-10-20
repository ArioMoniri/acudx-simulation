# 06b Medical review: the dynamic case layer (2026-10-20)

Reviewers: emergency physician and critical-care nurse educator (simulated review panel).
Scope: the run-time layer that makes a generated case change with what the student does.

* `server/orchestration/director.py` (physiology bounds, complication planning and deadlines, treatment response)
* `server/orchestration/normalize.py` (treatment class onsets and caps)
* `server/orchestration/judges.py` (deterministic clinical rules)
* `server/case_fixtures.py` (per-condition envelopes, febrile treatment tables) and `server/case_generator.py:936-977` (the baseline trajectory those envelopes feed)
* `server/results/kinetics.py`, `server/results/engine.py` (results over time)
* `web/src/domain/clinicalCourse.ts` (client course model)
* `server/tests/fixtures/live/fever-fever_and_cough.json`, `server/tests/fixtures/live/fever-fever_and_rigors.json` (two real model outputs)

Owner requirement used as the yardstick: every case is generated on request by the model and changes dynamically with
the student's actions; there is no pre-generated case list. A per-condition *rule library* (how a disease behaves) is
not a case list and is compatible with that requirement; this review asks for more of it, not for stored cases.

No source files were edited. Simulation evidence below was produced by driving the project's own `next_state()` with
template specs (`case_generator.build_template_spec`, seed 7) minute by minute for 120 simulated minutes.

---

## 1. Verdict

The Director is a clean, deterministic, well-instrumented skeleton, and the results kinetics (`kinetics.py`) are the
best-sourced part of the platform. As a *clinical course* engine, however, it does not yet behave like a patient:

1. **One generic complication per case.** Every case gets a single `missed_time_critical_treatment` event whose
   deadline comes from ESI (10, 20 or 40 min), not from the condition's guideline, and **any single indicated row
   averts it** (vasopressor without antibiotics in septic shock, aspirin without reperfusion in STEMI, oxygen alone in
   the live sepsis case, "A-to-E assessment" in anaphylaxis).
2. **Anaphylaxis does not respond to IM adrenaline.** It has no condition fixture, so it inherits the emergency
   default rows (`assess`, `analgesia`, `premature_dispo`); the generic effect table has no adrenaline entry. In the
   simulation the patient goes from 78/43 to 46/43 and unresponsive whether or not IM adrenaline is given. 47 of the
   97 conditions at ESI 1 to 2 have no condition fixture.
3. **Wrong actions rarely harm.** Fluid loading in acute heart failure has no effect and logs no error; ten boluses in
   septic shock give 191/42 with HR 56; every contraindicated item gives the same "HR +12, SBP -10"; allergies are
   never checked; any antimicrobial counts as adequate cover.
4. **Untreated patients plateau.** The baseline is authored for 30 min and held flat afterwards, and the complication
   fires once. Untreated septic shock sits at 51/42, unresponsive, from minute 20 to minute 120 and never arrests.
5. **No branching.** A case has one `condition_id` for life. Pneumonia cannot become septic shock, meningitis cannot
   become meningococcal shock, exam findings stay "alert, warm peripheries" after the patient becomes unresponsive.
6. **Client and server disagree.** The browser model (`clinicalCourse.ts`) has its own deterioration ramp, its own
   bounds and gates (adrenaline, nitrate, pulmonary-oedema fluids) that the server Director lacks.

Section 5 is a per-condition course specification the engineers can implement; section 6 lists acceptance tests.

---

## 2. Simulation evidence (Director as shipped, 120 simulated minutes)

Vitals shown as HR, BP, RR, SpO2, temperature, consciousness. "Deadline" is the planned complication and the codes
that cancel it.

| Case (ESI) and plan | t10 | t30 | t60 to t120 | Clinical reading |
|---|---|---|---|---|
| Septic shock (1), untreated. Deadline 10 min, any of `abx`, `vasopressor`, `source_control` | 130, 74/42, 25, 93, alert to drowsy | 156, 51/42, 31, 87, unresponsive | identical to t30 | Plateaus for 90 min with a 9 mmHg pulse pressure and never arrests |
| Septic shock, 10 x 500 mL bolus | 120, 89/42 | 97, 133/42 | 56, 191/42, SpO2 87 | No ceiling, no overload, bradycardia from "fluid" |
| Septic shock, fluids 5, abx 10, noradrenaline 20 | 126, 80/42 | 124, 101/52 | flat 101/52 | Direction right; lactate and mentation not linked |
| Sepsis (2), paracetamol only | 114, 106/61, 38.7 | 133, 90/61 | flat | Temperature falls 0.5 C in 60 min (plausible), deadline at 20 min (guideline 60 min) |
| Pneumonia (3), untreated | 111, 113/63, 92 | 114, 113/63, 92 | 124, 113/63, 90 | Mild, acceptable for 2 h; no route to septic shock |
| Meningitis (2), ceftriaxone at 50 min | 112, 114/68, 92 | 132, 98/65, 87 | 117, 88/65, 87 | Penalised although inside NICE 1 h; ceftriaxone *lowered* HR 15 and SBP 10 (keyword "beta" in "beta-lactam" hit the beta-blocker row); no GCS change at all |
| Pyelonephritis (3), untreated | 94, 125/74, RR 14, 98 | 89, 128/75, RR 13, 99 | 99, 128/75, 97 | Untreated infection *improves* for 30 min |
| DKA (2), untreated | 120, 99/59, 25, 98 | 139, 83/59, 29, 94, drowsy | flat | SpO2 falls (DKA does not desaturate); no pH, K or glucose link to the bedside |
| STEMI (1), aspirin only | 106, 130/74 | 110, 124/74 | flat | Aspirin alone averts the only planned event; no reperfusion needed, no VF or shock risk |
| STEMI, routine oxygen (contraindicated) | 118, 120/74 | 144, 96/74 | flat | Oxygen in a normoxic patient made him tachycardic and hypotensive (not a real effect) |
| PE (2), anticoagulation at 10 min | 120, 110/67, 90 | 124, 106/67, 88 | flat | Reasonable for intermediate risk |
| Anaphylaxis (1), untreated | 132, 74/43, 89, drowsy | 159, 46/43, 79, unresponsive | flat | Deterioration speed plausible, then frozen; no arrest |
| Anaphylaxis, IM adrenaline at 3 min | identical to untreated | identical | identical | **First-line treatment has no effect** |
| Acute HF (2), 6 x 500 mL fluid | 117, 159/89, 88 | 135, 147/89, 81 | flat | Same as untreated: 3 L of fluid in pulmonary oedema is harmless and not logged |

Live model outputs after `normalize_draft` (same Director):

* `fever-fever_and_rigors.json` (Sepsis, ESI 2): deadline cancels on any of `iv_fluids`, `abx`, `7806` (oxygen). Oxygen
  at SpO2 94 % averts the sepsis deadline. Vancomycin is authored as the sole "indicated" antibiotic (no Gram-negative
  cover) and is accepted. Fluids alone hold BP at 109/75 for 2 h with no antibiotic.
* `fever-fever_and_cough.json`: the request "fever and cough" produced **ascending cholangitis** (complaint mismatch);
  "IV fluids" was merged into the `abx_fluids` row, so the formulary fluid bolus no longer satisfies anything and
  vancomycin alone (no biliary Gram-negative or anaerobic cover) averts the deadline.
* Raw model output before normalisation: every treatment `code: ""`, IV fluid effects at 1.0 to 1.5 **seconds**,
  vancomycin lowering temperature 1 C in 3 s, `vitals_trajectory`, `labs`, `imaging`, `pmh`, `allergies` all empty,
  every exam item `abnormal: false` including "BP 90/60" and "rebound tenderness", and both councils ended round 2
  `vetoed: true, decision: repair` before `ground` and `finalize` shipped them. Normalisation repaired codes, onsets
  and gaps correctly, which is good, but the empty allergy and PMH fields mean the allergy-exposure teaching in
  section 4.3 cannot fire on model-path cases.

---

## 3. Findings

Severity: **Critical** = teaches a wrong or unsafe lesson in a time-critical condition; **Major** = clinically
implausible course or missing consequence that a clinician would notice; **Minor** = fidelity or consistency issue.

| ID | File:line | Sev | Finding | Correct behaviour | Citation |
|---|---|---|---|---|---|
| F01 | `director.py:209-224`, `:509-514` | Critical | One generic `missed_time_critical_treatment` per case; `required_any_of` means any single indicated row cancels it. Septic shock is averted by noradrenaline or "source control within 6 h" without antibiotics; STEMI by aspirin or opioid; sepsis (live) by oxygen. | Condition-specific complication plan with **all-of groups**: septic shock needs antimicrobial AND (fluids or vasopressor); STEMI needs antiplatelet AND reperfusion activation; anaphylaxis needs IM adrenaline. | SSC 2021 https://doi.org/10.1097/CCM.0000000000005337 ; ESC 2023 ACS https://doi.org/10.1093/eurheartj/ehad191 ; RCUK 2021 https://www.resus.org.uk/library/additional-guidance/guidance-anaphylaxis/emergency-treatment |
| F02 | `case_fixtures.py:137` (no `anaphylaxis` key), `case_generator.py:673-677`, `director.py:72-91` | Critical | Anaphylaxis has no treatment fixture; it gets `assess` / `analgesia` / `premature_dispo`. IM adrenaline (3992-im) matches no row and has no generic effect, so it does nothing; "A-to-E assessment" or "analgesia" averts the deadline. | IM adrenaline 0.5 mg anterolateral thigh: onset 3 to 5 min, SBP +15 to +30, SpO2 +4 to +8, stridor and wheeze improve; repeat at 5 min if no improvement; after 2 doses start the refractory pathway (IV adrenaline infusion plus 500 to 1000 mL crystalloid). | RCUK 2021 (above); Simons FER, JACI 2001 (IM thigh peak plasma about 8 min) https://doi.org/10.1067/mai.2001.119411 ; WAO 2020 https://doi.org/10.1016/j.waojou.2020.100472 |
| F03 | `case_fixtures.py:137-966` | Critical | 47 of 97 ESI 1 to 2 conditions have no condition fixture (anaphylaxis, ARDS, cardiac arrest, major trauma, encephalitis, eclampsia, TCA and salicylate overdose, DIC, tumour lysis, among others). Template and gap-fill paths give them generic system rows, so their dynamic course is meaningless. | Every ESI 1 to 2 condition needs a course rule (section 5 format): definitive treatments, harm rules, complication plan, branches. This is a rule library, not a case list. | ESI v4 handbook https://www.ena.org/enau/education/esi |
| F04 | `director.py:363-385` (contraindicated rows skipped), `:291-296`, `:410-418` | Critical | Fluid overload is not modelled server-side. In acute HF the formulary bolus (313002) skips the contraindicated `fluid_bolus` row, falls to the generic table gated `systolic<100`, and does nothing: no SpO2 fall, no error. Repeated boluses stack without limit (septic shock 191/42, HR 56). | Track cumulative volume. In pulmonary oedema each 500 mL: SpO2 -2 to -4, RR +3 to +4, crackles extend; log error. In sepsis, fluid response wanes within 60 min and stops once preload-unresponsive; above about 30 mL/kg with no response, further fluid gives oedema not BP. | ESC 2021 HF https://doi.org/10.1093/eurheartj/ehab368 ; SSC 2021 (dynamic assessment); Glassford NJ, Crit Care 2014 https://doi.org/10.1186/s13054-014-0696-5 |
| F05 | `director.py:265-280`, `:528-548`; `case_generator.py:946-960` | Major | Baseline is a 30-min trajectory held flat after its last point; the complication fires once. Untreated septic shock and anaphylaxis freeze at MAP about 45 and "unresponsive" for 90 min; there is no arrest state. | Continuous progression driven by a per-condition severity that keeps rising while untreated, with an explicit peri-arrest and arrest state (MAP below 40 or SpO2 below 60 sustained, or VF) that hands over to the ALS algorithm. | Kumar A, CCM 2006 (survival falls 7.6 % per hour of antimicrobial delay in septic shock) https://doi.org/10.1097/01.CCM.0000217961.75225.E9 ; Pumphrey RSH, Clin Exp Allergy 2000 https://pubmed.ncbi.nlm.nih.gov/10931122/ ; ERC 2021 ALS https://doi.org/10.1016/j.resuscitation.2021.02.009 |
| F06 | `director.py:52` | Major | Deadlines come from ESI (10/20/40 min), not guidelines. Meningitis fires at 20 min (NICE: within 1 h); sepsis at 20 min (NICE high-risk: 1 h); pneumonia at 40 min (NICE: 4 h, 1 h if septic); anaphylaxis at 10 min (adrenaline is immediate). | Per-condition targets (section 5). Separate the **scoring target** (guideline time) from the **physiological consequence** (continuous hazard that grows with delay). | NICE NG240 https://www.nice.org.uk/guidance/ng240 ; NICE NG253 https://www.nice.org.uk/guidance/ng253 ; NICE NG250 https://www.nice.org.uk/guidance/ng250 ; RCUK 2021 |
| F07 | `director.py:509-514`, `:533-543` vs `clinicalCourse.ts:304-309` | Major | After a deadline fires, a late correct treatment cannot undo any of it on the server; the client recovers 80 % over 20 min for every condition. Same student, two different patients. | One shared course model. Late treatment halts progression and reverses part of it, with condition-specific residual injury (shock: lactate and organ markers lag; meningitis: GCS recovers slowly or not at all). | SSC 2021; NICE NG240 |
| F08 | `director.py:83` keyword `"beta"`; label at `case_fixtures.py:1812` | Major | Ceftriaxone in meningitis triggers the **beta-blocker** generic effect (HR -15, SBP -10) because the row label contains "beta-lactam". Seen in simulation. | Match drug classes by catalogue code or whole-word class, never by substring; antibiotics have no in-session vital effect. | Halm EA, JAMA 1998 https://jamanetwork.com/journals/jama/fullarticle/187516 |
| F09 | `director.py:65-67`, `:500-505` | Major | Every contraindicated item applies HR +12, SBP -10. Routine oxygen in normoxic STEMI does not cause tachycardia or hypotension; "delay antibiotics" is an omission, not a drug; insulin bolus before fluids causes hypokalaemia, not tachycardia. | Drug-specific harm rules (section 4.2). Omission rows ("delay ...") become timer rules, not administrable items. Oxygen at SpO2 90 % or more in ACS: no acute vital change, process error only. | DETO2X, NEJM 2017 https://doi.org/10.1056/NEJMoa1706222 ; AVOID, Circulation 2015 https://doi.org/10.1161/CIRCULATIONAHA.114.014494 ; ESC 2023 ACS |
| F10 | `director.py:489-514` | Major | Allergies are free text and never checked. Piperacillin-tazobactam in a patient with "penicillin, anaphylaxis" proceeds without consequence. The live model outputs left `allergies_en` empty. | Structured allergy list (agent, reaction, severity). Exposure to a true anaphylaxis allergen IV opens the anaphylaxis branch within 5 to 10 min; a rash-only history causes a rash. Cephalosporins with dissimilar side chains (ceftriaxone) do not cross-react enough to punish. | NICE CG183 https://www.nice.org.uk/guidance/cg183 ; AAAAI/ACAAI drug allergy practice parameter 2022 https://doi.org/10.1016/j.jaci.2022.08.028 ; Pumphrey 2000 (iatrogenic median 5 min to arrest) |
| F11 | `director.py:319-347` | Major | Any antimicrobial satisfies any "antibiotics" row. Vancomycin alone in cholangitis or Gram-negative sepsis, doxycycline in meningitis, oseltamivir-class codes all count. | Spectrum check per source: meningitis needs a CNS-penetrant agent (ceftriaxone, or chloramphenicol in severe beta-lactam allergy); cholangitis and urosepsis need Gram-negative cover; MRSA-only agents are add-ons. Inadequate cover = untreated for the course. | NICE NG240; NICE NG111 https://www.nice.org.uk/guidance/ng111 ; Tokyo Guidelines 2018 cholangitis https://doi.org/10.1002/jhbp.509 ; SSC 2021 |
| F12 | `clinicalCourse.ts:180`, `:209-213`; live sepsis deadline includes `7806` | Major | Oxygen and IV fluids halt deterioration in every case on the client, and oxygen cancelled the server deadline in the live sepsis case at SpO2 94 %. | Oxygen and fluids are supportive; they change the vitals they act on but never stop the disease clock. Oxygen is indicated below 94 % (88 to 92 % if hypercapnic risk). | BTS 2017 oxygen https://doi.org/10.1136/thoraxjnl-2016-209729 ; SSC 2021 |
| F13 | `director.py:421-445`, `:187-198` | Major | Consciousness depends only on SBP and SpO2. Meningitis never loses GCS; DKA at pH 6.9 stays alert; hypercapnia and hypoglycaemia cannot cause drowsiness. Exam facts are built once at `from_spec` and never change. | Add GCS (or AVPU), CBG, capillary refill, skin and urine output to state; exam and HPI answers re-render from current state. | NICE CG50 recognising deterioration https://www.nice.org.uk/guidance/cg50 ; RCP NEWS2 https://www.rcp.ac.uk/improving-care/resources/national-early-warning-score-news-2/ |
| F14 | `director.py:55-62` | Major | Missed-deadline effects are the same shape for all conditions and always include SpO2 loss: DKA desaturates to 94 %, meningitis to 87 %, STEMI to 89 %. | Condition-specific deterioration signature (section 5): DKA shows Kussmaul RR, falling BP and GCS; meningitis shows GCS fall, seizures, then shock if meningococcal; STEMI shows arrhythmia or pump failure. | JBDS-IP DKA 2023 https://abcd.care/sites/default/files/site_uploads/JBDS_Guidelines_Current/JBDS_02_DKA_Guideline_with_QR_code_March_2023.pdf ; van de Beek D, NEJM 2004 https://doi.org/10.1056/NEJMoa040845 |
| F15 | `director.py:150-171`, `:448-462` | Major | No mechanism for a new diagnosis mid-encounter; the narrator says "I feel worse, doctor. Something is changing." for every event. | `active_diagnoses` with onset times; branch rules declared at generation and validated by the judges; branch adds findings, labs profile, narrator facts and debrief entries (section 4.4). | SSC 2021 (sepsis to septic shock); Berlin ARDS definition, JAMA 2012 https://doi.org/10.1001/jama.2012.5669 |
| F16 | `case_generator.py:962-970`; no `CONDITION_VITALS` for `pyelonephritis`, `bacterial_meningitis` | Major | ESI 3 to 5 long-tail conditions drift toward normal untreated (pyelonephritis: HR 98 to 89, RR 16 to 13, SpO2 to 99). | Untreated infection stays febrile and tachycardic or worsens; improvement only follows treatment. Add envelopes for pyelonephritis and meningitis. | NICE NG111; NICE NG240 |
| F17 | `case_fixtures.py:140-160`, `director.py:52` | Major | STEMI: only event is the generic one; PCI row moves only pain at 90 min; no VF, cardiogenic shock, failed reperfusion, nitrate hypotension; no fibrinolysis row for a non-PCI centre. | Section 5.7: VT/VF hazard before reperfusion, cardiogenic shock branch, reperfusion effects at wire time, fibrinolysis path and failed-lysis rule. | ESC 2023 ACS; Mehta RH, JAMA 2009 (VT/VF in 5.7 % of primary PCI, most before end of procedure) https://doi.org/10.1001/jama.2009.600 |
| F18 | `kinetics.py:433`; `case_fixtures.py:649-667` | Major | DKA: glucose is floored at 10 mmol/L on insulin, so forgetting 10 % glucose never causes hypoglycaemia; potassium falls but never causes arrhythmia; "insulin with K below 3.3" has no harm path; `fluids_first` only lowers HR. | Remove the floor; add 10 % glucose rule below 14 mmol/L; couple K below 3.0 to ectopy and VT hazard; fluids raise SBP. | JBDS-IP 2023; ADA/EASD hyperglycaemic crises 2024 https://doi.org/10.2337/dci24-0032 |
| F19 | `engine.py:410-425` | Major | Lab severity is derived from ESI only, and "hypotensive" from the authored trajectory, not the Director's live vitals. After a complication drops MAP to 45, lactate is still computed as normotensive. | Engine reads the Director's state (current MAP, active complications, branch severity). | Sepsis-3, JAMA 2016 https://doi.org/10.1001/jama.2016.0287 |
| F20 | `kinetics.py:235` | Major | Lactate clearance starts at the first fluid bolus even if MAP stays below 65 and no antibiotic or source control is given. | Clearance starts when perfusion is restored (MAP 65 or more and CRT 3 s or less) and is blunted while the source is untreated. | SSC 2021 (guide resuscitation to lactate and CRT); ANDROMEDA-SHOCK, JAMA 2019 https://doi.org/10.1001/jama.2019.0071 |
| F21 | `normalize.py:296-366` | Major | Effect direction is never checked: a model may author oxygen lowering SpO2 or fluids lowering SBP and it passes. | Each class declares allowed signs per vital (oxygen: SpO2 up; fluids: SBP up, HR down; opioid: RR down) and rejects the rest. | BTS 2017; NICE CG174 https://www.nice.org.uk/guidance/cg174 |
| F22 | `normalize.py:94-181`, `:315-316` | Major | No class for insulin, loop diuretic, thrombolytic, anticoagulant, antiplatelet, corticosteroid, antihistamine, potassium, dextrose, glucagon, beta-blocker. Unclassified treatments skip all onset and cap checks. | Add classes with onsets and caps (section 4.1). | JBDS 2023; ESC 2021 HF; ESC 2019 PE https://doi.org/10.1093/eurheartj/ehz405 ; RCUK 2021 |
| F23 | `normalize.py:216-219` | Minor | Bare "adrenaline" is classed as an IV pressor; a model row "Adrenaline 0.5 mg" for anaphylaxis gets pressor onsets. | Infer IM from route or dose of 0.5 mg or less; IV bolus outside arrest is a harm rule. | RCUK 2021 |
| F24 | `normalize.py:98` | Minor | Oxygen cap of SpO2 +8 is too low for a reservoir mask in a low-shunt hypoxaemic patient and too high for high-shunt ARDS. | Derive oxygen response from `kinetics.oxygenation` (FiO2 and shunt), which already exists. | BTS 2017; Nunn's Applied Respiratory Physiology (alveolar gas equation) |
| F25 | `judges.py:131-186`, `:199-236` (docstring `:12-13` claims "trajectory shape") | Major | Judges never check that an untreated time-critical case worsens, that a definitive treatment exists for the planned complication, or that branch rules are coherent. | Add rules: `untreated_worsens` (ESI 1 to 2), `complication_plan_present`, `definitive_covers_deadline`, `allergy_structured`, `effect_sign`. | ESI handbook; SSC 2021 |
| F26 | `clinicalCourse.ts:43-50` vs `judges.py:44-51` | Minor | Bounds differ: client SpO2 floor 50 and RR floor 4 (apnoea in opioid overdose impossible), server 0 and 0. | One bounds table, generated into both languages. | AHA 2020 ACLS https://www.ahajournals.org/doi/10.1161/CIR.0000000000000916 |
| F27 | `director.py:257-258` | Minor | Diastolic is not coupled to systolic changes (51/42, 191/42). | Model MAP and pulse pressure: vasodilatory shock widens then narrows pulse pressure; fluids move SBP and DBP together; display MAP, since the SSC target is MAP 65. | SSC 2021 |
| F28 | `director.py:283-288` | Minor | Effects never wear off: paracetamol, salbutamol, a single bolus, naloxone and IM adrenaline last forever. | Onset, peak and duration per class: IM adrenaline wanes over 20 to 30 min; naloxone duration shorter than most opioids (re-narcotisation); bolus effect fades within 60 min. | RCUK 2021; Glassford 2014; Clarke SFJ, EMJ 2005 naloxone https://doi.org/10.1136/emj.2004.019240 |
| F29 | `director.py:329-330` | Minor | `SUPPORTIVE_ROW_STEMS` contains "assess", which also matches "reassess" in the sepsis fluid rows. The septic-shock fluid row is excluded from the deadline by accident; when every row is supportive (anaphylaxis) `:216` falls back to all indicated rows. | Mark rows explicitly (`role: definitive / supportive / diagnostic / omission`) instead of substring stems. | n/a (engineering) |
| F30 | live fixtures | Major | Model output: complaint mismatch (cough request, cholangitis case), seconds-long onsets, antibiotic defervescence in seconds, empty trajectory, labs, imaging, allergy and PMH, all `abnormal: false`, and a vetoed council shipped. | Keep the normaliser; additionally block finalize on a safety veto, require structured allergies and PMH, and require the model to author the course rule fields of section 4.5. | SSC 2021; NICE CG183 |
| F31 | `case_fixtures.py:1801-1820` | Minor | Meningitis: no seizure, raised-ICP or meningococcal-shock complication; "LP before CT with red flags" has no harm path. | Section 5.4. | IDSA 2004 meningitis https://doi.org/10.1086/425368 ; NICE NG240 |
| F32 | `case_fixtures.py:407-426` | Minor | PE: no fluid-overload (RV) harm, no intubation harm, no bleeding risk after lysis. | Section 5.8. | ESC 2019 PE; PEITHO, NEJM 2014 https://doi.org/10.1056/NEJMoa1302097 |

---

## 4. Cross-cutting design for engineers

### 4.1 State the Director must carry

Add to `Vitals` or a sibling `Bedside` model, all derived from state every turn:

| Field | Unit | Why | Source |
|---|---|---|---|
| `map` | mmHg | SSC resuscitation target is MAP 65 | SSC 2021 |
| `gcs` (+ AVPU) | 3 to 15 | Meningitis, DKA, hypoglycaemia, hypercapnia, shock | NICE CG50; NEWS2 (new confusion scores 3) |
| `cbg` | mmol/L | DKA, hypoglycaemia; bedside meter the nurse reads | JBDS 2023 |
| `crt_s` | s | Perfusion; ANDROMEDA-SHOCK target 3 s or less | ANDROMEDA-SHOCK 2019 |
| `skin` | warm / cool / mottled (score 0 to 5) | Shock severity | Ait-Oufella H, Intensive Care Med 2011 https://doi.org/10.1007/s00134-011-2162-y |
| `urine_ml_h` | mL/h | Below 0.5 mL/kg/h is AKI | KDIGO 2012 https://kdigo.org/wp-content/uploads/2016/10/KDIGO-2012-AKI-Guideline-English.pdf |
| `airway` | patent / stridor / obstructed | Anaphylaxis, GCS 8 or less | RCUK ABCDE https://www.resus.org.uk/library/abcde-approach |
| `rhythm` | sinus, AF, VT, VF, PEA, asystole | STEMI, hyperkalaemia, hypokalaemia, arrest | AHA 2020 ACLS; ERC 2021 |
| `pain` | 0 to 10 | Already in Affect, move to state | n/a |
| `fluid_in_ml` | mL | Overload rules | ESC 2021 HF; SSC 2021 |
| `news2` | score | Nurse escalation cue, computed not authored | RCP NEWS2 |

Treatment classes to add to `normalize.TREATMENT_CLASSES` (onset window, allowed signs and caps):

| Class | Onset | Allowed effects (sign, cap) | Duration | Source |
|---|---|---|---|---|
| `adrenaline_im` (exists) | 3 to 10 min | SBP +30, SpO2 +8, RR -6, HR +/-20 | wanes 20 to 30 min | RCUK 2021; Simons 2001 |
| `loop_diuretic` | 5 to 30 min (venodilation first, diuresis 30 to 60 min) | RR -4, SpO2 +4, urine up | hours | ESC 2021 HF |
| `insulin_frii` | lab effect only | CBG -3 mmol/L/h, K -0.5 mmol/L/h | while running | JBDS 2023 |
| `dextrose_10` | 5 to 15 min | CBG up | while running | JBDS 2023 |
| `potassium` | lab effect only | K up | while running | JBDS 2023 |
| `thrombolytic` | 30 to 90 min | SBP +25, HR -20 (high-risk PE), pain -5 and ST resolution (STEMI) | persistent | ESC 2019 PE; ESC 2023 ACS |
| `antiplatelet`, `anticoagulant`, `antibiotic`, `corticosteroid`, `antihistamine` | none in session | no vital change; they alter disease rate or risk only | n/a | ESC 2023; SSC 2021; RCUK 2021 (antihistamines and steroids are not first-line) |
| `beta_blocker_iv` | 5 to 15 min | HR -20, SBP -15 | hours | COMMIT, Lancet 2005 https://doi.org/10.1016/S0140-6736(05)67661-1 |
| `glucagon` | 5 to 15 min | SBP +15 in beta-blocked anaphylaxis | 20 min | RCUK 2021 |

### 4.2 Harm rules (wrong actions)

Fire as a harm event with a condition-specific effect, an error entry, a narrator fact and a room cue.

| Trigger | Context | Effect | Onset | Source |
|---|---|---|---|---|
| Fluid bolus | Acute HF / pulmonary oedema | Per 500 mL: SpO2 -3, RR +4, crackles to mid-zones; at 1 L or more pink frothy sputum, drowsy | 10 to 20 min | ESC 2021 HF |
| Fluid bolus | Septic shock after about 30 mL/kg with no BP response | No BP gain; SpO2 -2 per further 500 mL, crackles | 15 to 30 min | SSC 2021; Glassford 2014 |
| Fluid more than 500 mL | High or intermediate-high risk PE | SBP -10 to -15 (RV overdistension) | 15 to 30 min | ESC 2019 PE |
| GTN | SBP below 90, RV infarct, PDE-5 inhibitor within 24 to 48 h | SBP -30 to -40, HR +15, presyncope | 2 to 5 min | ESC 2023 ACS; AHA ACS 2025 https://doi.org/10.1161/CIR.0000000000001309 |
| IV beta-blocker | STEMI with Killip II or more, SBP below 100 | Cardiogenic shock branch | 15 to 30 min | COMMIT 2005; ESC 2023 |
| Insulin with K below 3.3, or no K in fluids after the first litre | DKA | K falls toward 2.5; ectopy, U waves, VT hazard | 1 to 2 h (lab), rhythm when K below 3.0 | ADA 2024; JBDS 2023 |
| FRIII without 10 % glucose once CBG below 14 | DKA | CBG falls below 4 within about 1 to 2 h: sweaty, confused, GCS -2, seizure risk | progressive | JBDS 2023 |
| High-flow oxygen to SpO2 above 92 % | COPD or other hypercapnic risk | PaCO2 +1 to +2 kPa, GCS -2, RR falls | 30 to 60 min | BTS 2017; Austin MA, BMJ 2010 https://doi.org/10.1136/bmj.c5462 |
| IV adrenaline bolus 1 mg | Anaphylaxis, not in arrest | SBP above 200, VT, chest pain | 1 min | RCUK 2021 |
| Sitting or standing a hypotensive anaphylaxis patient | Anaphylaxis | Sudden PEA arrest risk | immediate | Pumphrey RSH, JACI 2003 https://doi.org/10.1067/mai.2003.1652 ; RCUK 2021 |
| Lumbar puncture before CT with red flags (GCS below 13, papilloedema, new seizure, focal deficit, immunosuppression) | Meningitis | Herniation branch: GCS falls, Cushing response, pupil change | 30 to 120 min | IDSA 2004; NICE NG240 |
| Systemic thrombolysis | Intermediate-risk PE without decompensation | Bleeding hazard (major about 6 %, intracranial about 2 %), no benefit | hours | PEITHO 2014; ESC 2019 |
| Opioid or benzodiazepine | Already hypoventilating, or combined | RR -4 to -8, SpO2 falls, GCS -2 | 2 to 10 min | AHA 2020 opioid emergency |
| Delay rows ("delay antibiotics", "delay drainage") | any | Not administrable; scored by timer only | n/a | F09 |

### 4.3 Allergy exposure

Structured allergies: `[{agent_class, reaction: rash | angioedema | bronchospasm | anaphylaxis, certainty}]`, authored by
the model and checked by the safety judge.

| Allergy | Given | Result | Source |
|---|---|---|---|
| Penicillin, anaphylaxis | Any penicillin (amoxicillin, co-amoxiclav, piperacillin-tazobactam, benzylpenicillin) IV | Open anaphylaxis branch at 3 to 10 min (iatrogenic median about 5 min to arrest) | Pumphrey 2000; NICE CG183 |
| Penicillin, any | Ceftriaxone or cefotaxime (dissimilar side chain) | No reaction; no error (guideline-acceptable) | AAAAI/ACAAI 2022 |
| Penicillin, rash only | Penicillin | Urticarial rash at 30 to 60 min, no haemodynamic change | NICE CG183 |
| Aspirin / NSAID respiratory disease | Aspirin | Bronchospasm: RR +6, SpO2 -4, wheeze | ESC 2023 ACS (aspirin hypersensitivity) |
| Morphine "itching" | Morphine | Pruritus only (pseudo-allergy) | NICE CG183 |
| Iodinated contrast, hives | Contrast CT | Urticaria; anaphylaxis branch only if prior anaphylaxis | ACR Manual on Contrast Media https://www.acr.org/Clinical-Resources/Contrast-Manual |

### 4.4 Branching: a case can become a new diagnosis

Mechanism, compatible with "generated on request, no case list":

1. At generation the model authors `latent_branches` for this patient, picked from the rule library for the condition
   (section 5), each with a trigger and a seeded probability. Judges validate them against the library.
2. Triggers are evaluated by the Director every turn: time without a required treatment group, a harm rule, a
   severity threshold, or a seeded hazard.
3. When a branch opens, the Director appends to `active_diagnoses`, raises that branch's severity, adds its findings to
   `facts_by_trigger` (so re-examining the patient shows mottling, purpura, crackles), switches the results engine to
   the branch profile (lactate, platelets, gases), passes the branch label and new sanctioned facts to the narrator,
   and writes a debrief entry ("pneumonia progressed to septic shock at 64 min; antibiotics were not given").
4. The narrator line changes with it (examples in section 5); the relative or nurse voice can carry it when the
   patient's GCS is low.
5. ARDS and empyema develop over hours to days. A session of 120 min cannot show them truthfully; implement a
   **time-skip** ("handover, 6 hours later on the ward") that advances the course rules and kinetics, and open ARDS only
   in that window. Berlin: onset within 1 week of insult, bilateral opacities, PaO2/FiO2 300 or less on PEEP 5 or more.

### 4.5 Fields the model must author per case (validated, never trusted)

```json
{
  "course": {
    "severity0": 0.6,
    "untreated_rate_per_h": 0.35,
    "definitive_groups": [["antimicrobial_gram_neg"], ["fluids", "vasopressor"]],
    "targets": [{"id": "abx_1h", "group": 0, "target_ms": 3600000, "source": "SSC 2021"}],
    "complications": [{"id": "refractory_shock", "when": "severity>=0.85", "effect": "branch:refractory_shock"}],
    "latent_branches": [{"id": "septic_shock", "trigger": "severity>=0.7 && !group_met(0)", "p": 1.0}],
    "harm_overrides": ["fluid_overload_after_30mlkg"],
    "allergies": [{"agent_class": "penicillin", "reaction": "anaphylaxis"}]
  }
}
```

The judge checks every id and class against the rule library; anything unknown is dropped, not executed.

### 4.6 What the nurse and the paramedic must see change in the room

The room is the nurse's and paramedic's main information channel. Each state change must produce a visible or audible
cue, not only a number:

* Monitor: alarm tone when NEWS2 reaches 5 (urgent review) or 7 (emergency), or a single parameter scores 3; rhythm
  strip changes (ST elevation, ectopy, VT, VF); SpO2 waveform loses quality with poor perfusion. (RCP NEWS2)
* Skin and face: pallor, sweating, mottling spreading from the knees, cyanosis, purpura spreading, urticaria,
  lip and tongue swelling. (Ait-Oufella 2011; NICE NG240; RCUK 2021)
* Breathing: speaking in sentences, then phrases, then words; tripod position; accessory muscles; audible stridor or
  wheeze, then a silent chest; Kussmaul breathing; pink frothy sputum.
* Mentation: oriented, then new confusion, then agitation, then drowsy, then responds to pain only (AVPU); a seizure
  event; pupils in raised ICP.
* Devices the nurse reads: CBG and ketone meter values; urine bag volume per hour; fluid balance chart; infusion pumps
  showing what is running; capillary refill timed at the sternum or fingertip.
* Paramedic channel: time since onset, pre-hospital treatment given (IM adrenaline, aspirin 300 mg, benzylpenicillin
  for meningococcal rash), and a structured handover (ATMIST or SBAR) whose content follows the live state. The
  paramedic's action (for example IM adrenaline on scene) must start the same course rule as in the ED.
  (NICE NG240 pre-hospital benzylpenicillin; RCUK 2021)

---

## 5. Per-condition dynamic course specification

Conventions. Times are from arrival (t0). Values are adult central values; the generator jitters within the stated
range. "Design" marks a simulation choice (time compression, seeded hazard) that no guideline gives as a number; it is
labelled so that clinical reviewers can tune it. Lab trajectories use the existing `kinetics.py` functions with the
corrections in F18 to F20.

### 5.1 Sepsis (no shock), high-risk features

* t0: HR 112, BP 106/62 (MAP 77), RR 23, SpO2 95 % RA, T 38.9, GCS 15, CRT 3 s, warm, urine 40 mL/h, lactate 2.8,
  NEWS2 about 6.
* Untreated: severity +0.3/h (design). t30: HR 118, BP 100/58, RR 24. t60: HR 124, BP 94/54 (MAP 67), RR 26, new
  confusion (GCS 14, NEWS2 rises by 3), lactate 3.3. t90 to 120: MAP below 65 opens **septic shock** (5.2).
* Treated: 500 mL crystalloid over 15 min: SBP +8 to +12, HR -6 within 15 min, fading over 60 min if the source is
  untreated (Glassford 2014). Appropriate antibiotic: no vital change in session; stops severity rising after a lag of
  about 60 min (design). Paracetamol 1 g: T -0.5 to -1.0 C over 60 to 120 min (OFIRMEV label
  https://www.accessdata.fda.gov/drugsatfda_docs/label/2010/022450lbl.pdf), HR falls with temperature.
* Targets: cultures before antibiotics if no delay; antimicrobial within 1 h (NICE NG253 high risk; SSC 2021 "high
  likelihood of sepsis"); lactate measured; 500 mL bolus if SBP below 90 or lactate above 2 (NICE NG253).
* Required group: appropriate-spectrum antimicrobial. Oxygen, paracetamol and cultures never satisfy it.
* Harm: inadequate spectrum counts as untreated (F11); fluids beyond about 30 mL/kg without response give oedema.
* Branches: septic shock (trigger MAP below 65 or lactate 4 or more); penicillin-allergy exposure to anaphylaxis.
* Narrative on branch to shock: "I feel so cold and dizzy... where am I?"; relative: "He's not making sense now."
* Room: rigors, flushed then pale, rising RR, new confusion, urine output falling below 0.5 mL/kg/h.
* Sources: SSC 2021; NICE NG253; Seymour CW, NEJM 2017 (each hour of delay raises mortality) https://doi.org/10.1056/NEJMoa1703058

### 5.2 Septic shock

* t0: HR 126, BP 80/44 (MAP 56), RR 26, SpO2 93 %, T 39.2, GCS 14, CRT 5 s, mottling score 2, urine 15 mL/h,
  lactate 4.5 to 5.5.
* Untreated: t30: MAP 51, HR 134, GCS 13, lactate rising per `kinetics.lactate`; t60: MAP 47, HR 140, GCS 12, mottling
  3, urine below 10 mL/h; t90: MAP 43, GCS 10, SpO2 90 %; t110 to 120: MAP below 40 sustained 3 min opens
  **peri-arrest / PEA arrest** (design compression of refractory shock; Kumar 2006 for the per-hour mortality gradient).
* Treated:
  * Crystalloid boluses of 500 mL, aiming for 30 mL/kg within 3 h: each bolus SBP +8 to +14, MAP +5 to +8, HR -5 to -10
    at 15 min, waning over 60 min (Glassford 2014); diminishing returns after about 2 L.
  * Noradrenaline, peripheral start acceptable: onset 1 to 2 min, titrated MAP to 65 to 70 within 10 to 15 min; HR
    little change. (SSC 2021: norepinephrine first line, MAP 65, peripheral start acceptable)
  * Antimicrobial plus source control: no vital change inside 2 h, but severity stops rising; vasopressor need falls
    over hours (time-skip).
  * Lactate clears with half-life about 2 h only once MAP 65 or more and CRT 3 s or less (F20).
* Targets (hour-1 bundle): lactate, cultures, broad-spectrum antimicrobial immediately and within 1 h, 30 mL/kg for
  hypotension or lactate 4 or more, vasopressor if MAP below 65 during or after fluids (Levy MM, CCM 2018
  https://doi.org/10.1097/CCM.0000000000003119 ; SSC 2021).
* Required groups (all of): [appropriate antimicrobial] AND [fluids or vasopressor]. Source control has a 6 h target
  (SSC 2021) and is scored, not a rescue.
* Harm: starch (AKI, mortality; SSC 2021 recommends against), fluid overload after non-response (SpO2 falls,
  crackles), sitting the patient up when MAP below 50 (design: presyncope).
* Branches: refractory shock (MAP below 65 on noradrenaline 0.25 mcg/kg/min or more: add vasopressin, SSC 2021);
  ARDS (time-skip only); DIC (platelets falling, oozing at cannula sites).
* Narrative: confused and mumbling; family voice carries history once GCS is 12 or less.
* Room: mottled knees spreading, CRT 5 s at sternum, cold peripheries with warm core, catheter bag nearly empty,
  noradrenaline pump visible, monitor MAP alarm.

### 5.3 Community-acquired pneumonia (CURB-65 2 to 3)

* t0: HR 108, BP 114/66, RR 26, SpO2 91 % RA, T 39.0, GCS 15 (AMT 8 or less if confused), urea 8 to 9.
* Untreated (2 h): SpO2 -1 to -2 % per hour, RR +2 per hour, HR +4 per hour; the course is slow (Halm 1998). If
  CURB-65 3 or more and no antibiotic by 60 min, open a seeded hazard (design, p 0.3) of **septic shock (pulmonary
  source)** between 60 and 120 min.
* Treated: nasal oxygen 2 to 4 L: SpO2 +3 to +5 within 5 min; reservoir mask: from `kinetics.oxygenation` (shunt
  dependent). Target 94 to 98 %, or 88 to 92 % with hypercapnic risk (BTS 2017). Antibiotic: no in-session
  defervescence; clinical stability takes days (Halm 1998). Fluids only if hypotensive or dry.
* Targets: CXR within 4 h and antibiotics within 4 h of diagnosis; within 1 h if sepsis is suspected (NICE NG250).
  Severity by CURB-65 (BTS 2009 https://doi.org/10.1136/thx.2009.121434). Agent by severity (NICE NG250; IDSA/ATS 2019
  https://doi.org/10.1164/rccm.201908-1581ST).
* Harm: high-flow oxygen in a COPD patient to SpO2 above 92 % opens **type 2 respiratory failure** (BTS 2017; Austin
  2010); large fluid volumes worsen oxygenation.
* Branches: septic shock (as above); type 2 respiratory failure (iatrogenic oxygen or exhaustion: PaCO2 rises, GCS
  falls, flapping tremor); ARDS only after a time-skip (Berlin 2012; ESICM ARDS 2023
  https://doi.org/10.1007/s00134-023-07050-7); parapneumonic effusion only after a time-skip.
* Narrative on septic shock: "I can't get my breath and I'm freezing"; on type 2 failure: drowsy, slurred, "leave me
  alone".
* Room: speaking in phrases, rigors, rusty sputum in a pot, oxygen device on the face, SpO2 trend.

### 5.4 Bacterial meningitis

* t0: HR 112, BP 118/70, RR 20, SpO2 96 %, T 39.4, GCS 14 (E4 V4 M6), neck stiffness, photophobia; meningococcal
  variant adds non-blanching petechiae.
* Untreated: severity +0.3/h (design). t30: GCS 14, agitation; t60: GCS 12, vomiting; seeded seizure event (design,
  per-case probability 0.15, consistent with seizures in about 17 % of adults during the illness, Zoons E, Neurology
  2008 https://doi.org/10.1212/01.wnl.0000288178.91614.5d); t90 to 120: GCS 9 or less, airway at risk. Meningococcal
  variant: purpura spreads and BP falls about 10 mmHg per 30 min after t30, opening **meningococcal septic shock**.
  Raised ICP (late): bradycardia with hypertension and pupil change. SpO2 does not fall until airway or seizure
  compromise (F14).
* Treated: ceftriaxone 2 g IV (or chloramphenicol in severe beta-lactam allergy) plus dexamethasone with or before the
  first dose: no vital change in 2 h; stops severity rising; GCS recovers slowly or not at all in session.
  Dexamethasone reduces unfavourable outcome (de Gans J, NEJM 2002 https://doi.org/10.1056/NEJMoa021334).
* Targets: antibiotics within 1 h of arrival, without waiting for CT or LP; immediately (and pre-hospital
  benzylpenicillin) with a meningococcal rash or shock (NICE NG240). A ceftriaxone dose at 50 min is on target (F06).
* Required group: CNS-penetrant antimicrobial. Spectrum check per F11.
* Harm: LP with red flags before CT (herniation branch, IDSA 2004); antibiotics delayed for imaging (target breach,
  continuing rise of severity).
* Branches: seizure and status epilepticus (needs benzodiazepine; NICE NG217 https://www.nice.org.uk/guidance/ng217);
  meningococcal septic shock (5.2 rules apply); herniation.
* Narrative: "the light is unbearable, my neck..." then confused and repetitive, then only groans; parent or partner
  reports "the spots are spreading".
* Room: dark room request, glass test on the rash, GCS charted every 15 min, vomit bowl.
* Features baseline: van de Beek D, NEJM 2004.

### 5.5 Acute pyelonephritis

* t0: HR 104, BP 122/74, RR 18, SpO2 97 %, T 39.0, loin pain 7/10, rigors, vomiting; NEWS2 about 3.
* Untreated: stays febrile; T 39.0 to 39.6, HR +5 to +10 by t120; no improvement without treatment (F16).
* Treated: antibiotic (NICE NG111 choice; gentamicin if beta-lactam allergy): no in-session vital change. Fluids:
  HR -5 to -10. Paracetamol as 5.1. Antiemetic eases vomiting.
* Targets: MSU and blood cultures before the first dose; IV antibiotic if unable to take oral or systemically unwell
  (NICE NG111). If NEWS2 5 or more or sepsis criteria, the 5.1 sepsis rules and 1 h target apply.
* Branches: **obstructed infected kidney** (seeded or authored: ultrasound hydronephrosis, stone on CT): severity
  rises; SBP falls about 10 mmHg per 30 min after t60 into urosepsis (5.2); needs urgent decompression by nephrostomy
  or stent (EAU urological infections https://uroweb.org/guidelines/urological-infections). Bacteraemic sepsis.
* Harm: delaying drainage of an obstructed infected kidney (severity keeps rising despite antibiotics); nephrotoxic
  gentamicin repeated in AKI (creatinine up via `kinetics.creatinine_aki`).
* Narrative on urosepsis: "the shaking won't stop and I feel faint".
* Room: renal-angle tenderness, rigors, urine dipstick, falling urine output.

### 5.6 Diabetic ketoacidosis (moderate to severe)

* t0: HR 118, BP 102/60, RR 28 (Kussmaul), SpO2 98 %, T 36.8, GCS 15, CBG 28, ketones 5.5, pH 7.10, HCO3 10, K 5.3,
  dry mucosa, acetone breath.
* Untreated (2 h): HCO3 -0.5/h and ketones +0.2/h (kinetics), RR +2/h, HR +5/h, SBP -5/h from osmotic diuresis; GCS
  falls by 1 to 2 when pH below 7.0 (JBDS severity markers: pH below 7.0, HCO3 below 5, GCS below 12, SBP below 90).
  SpO2 unchanged (F14).
* Treated: 0.9 % NaCl 1 L over 1 h (500 mL over 10 to 15 min if SBP below 90): HR -8 to -12, SBP +8 to +12 over 30 to
  60 min. FRIII 0.1 U/kg/h: CBG -3 mmol/L/h, ketones -0.5/h, HCO3 +3/h, K -0.5/h in the first hours (kinetics already
  models this). Potassium 40 mmol/L in fluids when K 3.5 to 5.5 after the first litre. Add 10 % glucose 125 mL/h
  when CBG below 14. (JBDS 2023)
* Targets: fluids started in the first hour; FRIII after fluids started and K known; hourly CBG and ketones; K at
  60 min and 2 h.
* Required groups (all of): [fluids] AND [FRIII]. K replacement is a safety rule, not optional.
* Harm: insulin with K below 3.3 (ADA 2024) or no K replacement: K below 3.0 within about 2 h, ectopy then VT hazard;
  no 10 % glucose: CBG below 4 (remove the floor at `kinetics.py:433`); sodium bicarbonate at pH above 6.9 (ADA 2024):
  hypokalaemia; large boluses in patients aged 18 to 25: cerebral oedema watch (headache, falling GCS, bradycardia;
  JBDS 2023; ISPAD 2022 https://doi.org/10.1111/pedi.13406 for under-18s).
* Branches: hypokalaemic arrhythmia; hypoglycaemia; cerebral oedema (young); precipitant found (pneumonia, STEMI) adds
  that condition's rules.
* Narrative: abdominal pain and thirst, then "so tired"; with hypoglycaemia "shaky and sweaty".
* Room: CBG and ketone meter each hour on a chart, fluid balance, U waves on the monitor when K falls, acetone smell.

### 5.7 STEMI (anterior)

* t0: HR 98, BP 136/82, RR 20, SpO2 96 %, pain 8/10, sweating, anterior ST elevation.
* Untreated: pain stays 7 to 9; troponin rises (kinetics); ECG evolves (Q waves develop over hours). Seeded VT/VF
  hazard before reperfusion (design: about 6 % of cases, Mehta 2009, higher in large anterior infarcts) between t5 and
  t90. Large anterior with no reperfusion by t60: seeded **cardiogenic shock** (design p 0.1; ESC 2023 cites about 6 to
  10 % of STEMI): SBP below 90, HR 115, cold peripheries, crackles, SpO2 -4, lactate rising, urine below 0.5 mL/kg/h.
* Treated: aspirin 150 to 300 mg loading and P2Y12 per strategy: no vital change. Primary PCI: at wire time pain falls
  to 1 to 2/10 within minutes, ST resolves 50 % or more by 60 to 90 min, transient reperfusion arrhythmias; troponin
  peaks earlier and higher (kinetics). Fibrinolysis when PCI is not possible within 120 min: give within 10 min of
  diagnosis; check ST resolution at 60 to 90 min, failed lysis (less than 50 % resolution) needs rescue PCI.
  Oxygen only if SpO2 below 90 %. Titrated opioid for pain (may delay oral P2Y12 absorption).
* Targets: ECG within 10 min of first contact; diagnosis to wire 60 min or less in a PCI centre, 120 min or less
  with transfer; otherwise lysis within 10 min (ESC 2023; AHA ACS 2025).
* Required groups (all of): [antiplatelet] AND [reperfusion activation or fibrinolysis]. Opioid never averts.
* Harm: GTN with RV infarct, SBP below 90 or PDE-5 inhibitor (4.2); IV beta-blocker in Killip II or more
  (cardiogenic shock; COMMIT); routine oxygen at SpO2 90 % or more: no acute vital effect, process error only
  (DETO2X; AVOID); fibrinolysis with an absolute contraindication: intracranial haemorrhage branch.
* Branches: VF arrest (ALS: shock immediately; AHA 2020, ERC 2021), cardiogenic shock, complete heart block (inferior),
  RV infarct with nitrate hypotension.
* Narrative: "crushing, like a weight", nausea; on shock "I can't breathe lying flat".
* Room: defibrillator pads on, ST trend on monitor, ectopy before VF, grey and clammy, cath-lab call.

### 5.8 Pulmonary embolism (intermediate-high risk)

* t0: HR 116, BP 108/68, RR 26, SpO2 89 % RA, pleuritic pain, troponin raised, RV dilated on echo.
* Untreated: slow change in 2 h (HR +5, SpO2 -1 to -2). Decompensation to high risk is uncommon (about 5 % over 7
  days on anticoagulation alone in PEITHO), so do not fire it by clock; fire it from harm triggers or a seeded hazard at
  higher difficulty (design).
* Treated: anticoagulation started while awaiting imaging when probability is high: no vital change, stops clot
  propagation. Oxygen: SpO2 +3 to +6. High-risk PE (SBP below 90 for 15 min or pressor need): systemic thrombolysis,
  SBP +15 to +25 and HR -15 to -20 over 30 to 90 min (ESC 2019).
* Targets: anticoagulate without delay in high or intermediate clinical probability; risk-stratify with PESI, RV and
  troponin; rescue reperfusion if decompensation (ESC 2019).
* Harm: fluids above 500 mL (RV overdistension: SBP falls); intubation or sedation without pressor support
  (cardiovascular collapse on induction; ESC 2019); thrombolysis in intermediate risk without decompensation
  (bleeding hazard; PEITHO).
* Branches: high-risk PE (obstructive shock: raised JVP, SBP below 90, cold), PEA arrest (consider thrombolysis in
  arrest; ERC 2021), post-lysis haemorrhage.
* Narrative: "it hurts when I breathe in"; on decompensation "I'm going to faint".
* Room: raised JVP, tachypnoea, unilateral leg swelling, anxious and sweaty, RV strain on ECG.

### 5.9 Anaphylaxis (food or venom trigger, adult)

* t0: HR 128, BP 82/46, RR 28, SpO2 91 %, generalised urticaria, lip swelling, stridor or wheeze, feels faint.
* Untreated: rapid. Time from exposure to arrest in fatal cases: median about 30 min for food, 15 min for venom, 5 min
  for iatrogenic IV drugs (Pumphrey 2000). Food course: t5: BP 76/40, SpO2 89 %; t10: BP 68/36, SpO2 85 %, stridor
  louder, drowsy; t20: BP 54/30, SpO2 78 %, silent chest or obstructed airway; t25 to 30: **PEA arrest**. Venom:
  halve the times; iatrogenic IV: arrest risk from t5.
* Treated: IM adrenaline 0.5 mg (500 mcg) thigh: from t+3 min SBP +15 to +30, SpO2 +4 to +8, stridor and wheeze ease,
  HR may fall as perfusion returns; effect wanes over 20 to 30 min. If not improved at 5 min, repeat. After two doses
  without response: refractory pathway (IV adrenaline infusion by a senior, 500 to 1000 mL crystalloid bolus, airway
  expert). Lie flat with legs raised, or sitting if breathing is the main problem. (RCUK 2021; EAACI 2021
  https://doi.org/10.1111/all.15032)
* Targets: IM adrenaline immediately (deadline for teaching 5 min; second dose at 5 min if no improvement);
  remove the trigger; high-flow oxygen; call for help.
* Required group: IM adrenaline. Antihistamine and steroid never avert (RCUK 2021).
* Harm: IV adrenaline 1 mg bolus outside arrest (4.2); sitting or standing a hypotensive patient (Pumphrey 2003);
  continuing the culprit infusion; beta-blocked patient refractory unless glucagon (RCUK 2021).
* Branches: refractory anaphylaxis; airway obstruction needing a surgical airway; biphasic reaction (up to about 5 %,
  WAO 2020) after a time-skip.
* Narrative: "my throat is closing", then hoarse whisper, then silent; partner gives the trigger history.
* Room: audible stridor, swelling visible on the face camera, hives spreading, SpO2 trace failing, adrenaline
  auto-injector or ampoule and syringe.

### 5.10 Acute heart failure with pulmonary oedema (reference for fluid harm)

* t0: HR 116, BP 162/92, RR 30, SpO2 87 % RA, crackles to mid-zones, sitting bolt upright.
* Untreated: SpO2 -2 per 15 min, RR +3, sweating, then drowsy as PaCO2 rises.
* Treated: CPAP or NIV: SpO2 +5 to +8 within 10 to 15 min, RR -4. IV nitrate if SBP above 110: SBP -15 to -30, RR -4.
  IV furosemide: venodilation then diuresis over 30 to 60 min, RR -4, SpO2 +3. (ESC 2021 HF)
* Harm: each 500 mL fluid: SpO2 -3, RR +4, crackles rise; lying the patient flat: SpO2 -3 within minutes.
* Room: pink frothy sputum, wet cough, tripod, crackles audible on stethoscope sound, urine catheter output after
  diuretic.

---

## 6. Acceptance tests (deterministic, add to `server/tests/`)

1. Anaphylaxis, untreated, food: SBP below 60 by t20 and arrest state by t30. IM adrenaline at t3: SBP 90 or more by
   t10 and no arrest; "A-to-E assessment" and "analgesia" do not cancel the adrenaline target.
2. Septic shock: noradrenaline alone or fluids alone do not satisfy the antimicrobial group; untreated reaches the
   arrest state by t120; ten boluses never raise SBP above 140 and produce an overload harm event.
3. Acute HF: 1 L of crystalloid lowers SpO2 by 4 or more and logs `fluid_overload`.
4. Meningitis: ceftriaxone given at t50 produces no target breach; ceftriaxone never lowers HR or SBP; untreated GCS
   falls by 2 or more by t60 and SpO2 is unchanged until a seizure or airway event.
5. Pyelonephritis untreated: HR and temperature at t30 are not lower than at t0.
6. DKA: FRIII without 10 % glucose lets CBG fall below 4 within 4 h of insulin; insulin started at K 3.1 produces a
   K below 3.0 and an arrhythmia hazard.
7. STEMI: aspirin alone leaves the reperfusion target open; GTN in an RV infarct drops SBP by 30 or more; routine
   oxygen at SpO2 96 % changes no vital.
8. Allergy: piperacillin-tazobactam in a "penicillin, anaphylaxis" patient opens the anaphylaxis branch within 10 min;
   ceftriaxone in the same patient does not.
9. Branch: pneumonia with CURB-65 3 and no antibiotic opens septic shock by t120 under its seed; re-examining shows
   mottling; the lactate result after the branch is above 4; the narrator receives the branch label.
10. Parity: for every rule above, `clinicalCourse.ts` and the Director return the same vitals (within 1 unit) at t10,
    t30, t60 and t120 (shared fixture).

---

## 7. Priority order

1. F02, F03 (anaphylaxis and fixture-less ESI 1 to 2 conditions), F01 (all-of definitive groups), F04 (fluid
   overload). These teach wrong lessons today.
2. F05, F06, F07 (continuous progression, guideline targets, one shared model with F12 and F26).
3. F08, F09, F10, F11 (harm and allergy rules, spectrum).
4. F13, F14, F15 (bedside state, condition signatures, branching and narrative).
5. F18 to F22, F25 (kinetics coupling, class table, judges).

## 8. References

* Surviving Sepsis Campaign 2021, Evans L et al. https://doi.org/10.1097/CCM.0000000000005337
* SSC hour-1 bundle, Levy MM et al. 2018 https://doi.org/10.1097/CCM.0000000000003119
* Sepsis-3, Singer M et al. JAMA 2016 https://doi.org/10.1001/jama.2016.0287
* NICE NG253 Suspected sepsis in people aged 16 or over https://www.nice.org.uk/guidance/ng253
* NICE CG174 Intravenous fluid therapy in adults https://www.nice.org.uk/guidance/cg174
* NICE CG50 Acutely ill adults in hospital https://www.nice.org.uk/guidance/cg50
* RCP NEWS2 https://www.rcp.ac.uk/improving-care/resources/national-early-warning-score-news-2/
* Kumar A et al. CCM 2006 https://doi.org/10.1097/01.CCM.0000217961.75225.E9
* Seymour CW et al. NEJM 2017 https://doi.org/10.1056/NEJMoa1703058
* Glassford NJ et al. Crit Care 2014 https://doi.org/10.1186/s13054-014-0696-5
* ANDROMEDA-SHOCK, Hernandez G et al. JAMA 2019 https://doi.org/10.1001/jama.2019.0071
* Ait-Oufella H et al. Intensive Care Med 2011 https://doi.org/10.1007/s00134-011-2162-y
* KDIGO 2012 AKI https://kdigo.org/wp-content/uploads/2016/10/KDIGO-2012-AKI-Guideline-English.pdf
* NICE NG250 Pneumonia https://www.nice.org.uk/guidance/ng250
* BTS CAP 2009 https://doi.org/10.1136/thx.2009.121434
* IDSA/ATS CAP 2019 https://doi.org/10.1164/rccm.201908-1581ST
* Halm EA et al. JAMA 1998 https://jamanetwork.com/journals/jama/fullarticle/187516
* BTS emergency oxygen 2017 https://doi.org/10.1136/thoraxjnl-2016-209729
* Austin MA et al. BMJ 2010 https://doi.org/10.1136/bmj.c5462
* Berlin ARDS definition, JAMA 2012 https://doi.org/10.1001/jama.2012.5669
* ESICM ARDS guidelines 2023 https://doi.org/10.1007/s00134-023-07050-7
* NICE NG240 Bacterial meningitis and meningococcal disease https://www.nice.org.uk/guidance/ng240
* IDSA bacterial meningitis 2004, Tunkel AR et al. https://doi.org/10.1086/425368
* van de Beek D et al. NEJM 2004 https://doi.org/10.1056/NEJMoa040845
* Zoons E et al. Neurology 2008 https://doi.org/10.1212/01.wnl.0000288178.91614.5d
* de Gans J, van de Beek D. NEJM 2002 https://doi.org/10.1056/NEJMoa021334
* NICE NG217 Epilepsies https://www.nice.org.uk/guidance/ng217
* NICE NG111 Pyelonephritis (acute) https://www.nice.org.uk/guidance/ng111
* EAU Urological infections https://uroweb.org/guidelines/urological-infections
* Tokyo Guidelines 2018 cholangitis https://doi.org/10.1002/jhbp.509
* JBDS-IP DKA 2023 https://abcd.care/sites/default/files/site_uploads/JBDS_Guidelines_Current/JBDS_02_DKA_Guideline_with_QR_code_March_2023.pdf
* ADA/EASD hyperglycaemic crises 2024 https://doi.org/10.2337/dci24-0032
* ISPAD 2022 DKA https://doi.org/10.1111/pedi.13406
* ESC 2023 ACS https://doi.org/10.1093/eurheartj/ehad191
* ACC/AHA 2025 ACS https://doi.org/10.1161/CIR.0000000000001309
* Mehta RH et al. JAMA 2009 https://doi.org/10.1001/jama.2009.600
* DETO2X, Hofmann R et al. NEJM 2017 https://doi.org/10.1056/NEJMoa1706222
* AVOID, Stub D et al. Circulation 2015 https://doi.org/10.1161/CIRCULATIONAHA.114.014494
* COMMIT, Lancet 2005 https://doi.org/10.1016/S0140-6736(05)67661-1
* ESC 2019 acute PE https://doi.org/10.1093/eurheartj/ehz405
* PEITHO, Meyer G et al. NEJM 2014 https://doi.org/10.1056/NEJMoa1302097
* ESC 2021 heart failure https://doi.org/10.1093/eurheartj/ehab368
* RCUK 2021 anaphylaxis https://www.resus.org.uk/library/additional-guidance/guidance-anaphylaxis/emergency-treatment
* RCUK ABCDE approach https://www.resus.org.uk/library/abcde-approach
* WAO anaphylaxis 2020 https://doi.org/10.1016/j.waojou.2020.100472
* EAACI anaphylaxis 2021 https://doi.org/10.1111/all.15032
* Pumphrey RSH. Clin Exp Allergy 2000 https://pubmed.ncbi.nlm.nih.gov/10931122/
* Pumphrey RSH. JACI 2003 (fatal posture) https://doi.org/10.1067/mai.2003.1652
* Simons FER et al. JACI 2001 https://doi.org/10.1067/mai.2001.119411
* NICE CG183 Drug allergy https://www.nice.org.uk/guidance/cg183
* AAAAI/ACAAI drug allergy practice parameter 2022 https://doi.org/10.1016/j.jaci.2022.08.028
* ACR Manual on Contrast Media https://www.acr.org/Clinical-Resources/Contrast-Manual
* Clarke SFJ et al. EMJ 2005 (naloxone) https://doi.org/10.1136/emj.2004.019240
* AHA 2020 ACLS https://www.ahajournals.org/doi/10.1161/CIR.0000000000000916
* ERC 2021 adult ALS https://doi.org/10.1016/j.resuscitation.2021.02.009
* ESI handbook https://www.ena.org/enau/education/esi
* OFIRMEV (IV paracetamol) label https://www.accessdata.fda.gov/drugsatfda_docs/label/2010/022450lbl.pdf

Education only. Synthetic patients. Values are for simulation fidelity, not for clinical decisions.
