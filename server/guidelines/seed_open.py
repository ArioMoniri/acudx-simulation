"""Open-licence GuidelineStatement drafts with EXACT document URLs, plus the metadata that
lets the legacy ``server/guidelines_seed.py`` corpus be migrated and verified.

Authoring rules (docs/architecture/16):
  * every record points at the exact document (a NICE "Recommendations" chapter, a guideline
    PDF, an open-access full text) that the verifier can fetch and quote; never a homepage;
  * ``statement_en`` is OUR condensed expression of the recommendation, written close to the
    source wording so the verifier can locate the supporting passage lexically;
  * ``fetch_url`` is set when the learner-facing ``source_url`` (a DOI or publisher page)
    cannot be fetched headlessly; it points at the open-access mirror of the same article;
  * no record was authored without first reading the fetched source text.

All records enter the store as ``draft``; only the verifier promotes them to ``verified``.
"""

from __future__ import annotations

from typing import Any, Dict, List

from server.guidelines.store import GuidelineStatement

# ---------------------------------------------------------------------------
# Legacy corpus support
# ---------------------------------------------------------------------------

# Landing page -> exact document (the recommendations chapter / the guideline file).
URL_REFINEMENTS: Dict[str, str] = {
    "gs_nice_sah_ct6h": "https://www.nice.org.uk/guidance/ng228/chapter/Recommendations",
    "gs_nice_sah_lp12h": "https://www.nice.org.uk/guidance/ng228/chapter/Recommendations",
    "gs_nice_headache_redflags": "https://www.nice.org.uk/guidance/cg150/chapter/Recommendations",
    "gs_ssc21sepsis_antibiotics": "https://www.sccm.org/survivingsepsiscampaign/guidelines-and-resources/surviving-sepsis-campaign-adult-guidelines",
    "gs_ssc21sepsis_fluids": "https://www.sccm.org/survivingsepsiscampaign/guidelines-and-resources/surviving-sepsis-campaign-adult-guidelines",
    "gs_ssc21sepsis_lactate": "https://www.sccm.org/survivingsepsiscampaign/guidelines-and-resources/surviving-sepsis-campaign-adult-guidelines",
    "gs_nice_meningitis_antibiotics": "https://www.nice.org.uk/guidance/ng240/chapter/Recommendations",
    "gs_status_epilepticus": "https://www.nice.org.uk/guidance/ng217/chapter/7-Treating-status-epilepticus-repeated-or-cluster-seizures-and-prolonged-seizures",
    "gs_nice_upper_gi_bleed": "https://www.nice.org.uk/guidance/cg141/chapter/Recommendations",
    "gs_nice_pyelonephritis": "https://www.nice.org.uk/guidance/ng111/chapter/Recommendations",
    "gs_cellulitis_eron": "https://www.nice.org.uk/guidance/ng141/chapter/Recommendations",
    "gs_nice_aki": "https://www.nice.org.uk/guidance/ng148/chapter/Recommendations",
    "gs_renal_colic": "https://www.nice.org.uk/guidance/ng118/chapter/Recommendations",
    "gs_ectopic_pregnancy": "https://www.nice.org.uk/guidance/ng126/chapter/Symptoms-and-signs-of-ectopic-pregnancy-and-initial-assessment",
    "gs_preeclampsia_magnesium": "https://www.nice.org.uk/guidance/ng133/chapter/Recommendations",
    "gs_pph_management": "https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/prevention-and-management-of-postpartum-haemorrhage-green-top-guideline-no-52/",
    "gs_suicide_risk": "https://www.nice.org.uk/guidance/ng225/chapter/Recommendations",
    "gs_alcohol_withdrawal": "https://www.nice.org.uk/guidance/cg100/chapter/Recommendations",
    "gs_nice_neutropenic_sepsis": "https://www.nice.org.uk/guidance/cg151/chapter/Recommendations",
    "gs_hyperkalaemia_ecg": "https://www.ukkidney.org/sites/default/files/RENAL%20ASSOCIATION%20HYPERKALAEMIA%20GUIDELINE%20-%20JULY%202022%20V2_0.pdf",
    "gs_bts_asthma_acute": "https://www.brit-thoracic.org.uk/document-library/guidelines/asthma/btssign-guideline-for-the-management-of-asthma-2019/",
    "gs_dka_management": "https://abcd.care/sites/default/files/site_uploads/JBDS_Guidelines_Current/JBDS_02_DKA_Guideline_with_QR_code_March_2023.pdf",
}

# Where the verifier fetches the document when source_url is not fetchable headlessly.
FETCH_URLS: Dict[str, str] = {}

DOI_BY_ID: Dict[str, str] = {
    "gs_esc23acs_reperfusion": "10.1093/eurheartj/ehad191",
    "gs_esc23acs_dapt": "10.1093/eurheartj/ehad191",
    "gs_esc23acs_oxygen": "10.1093/eurheartj/ehad191",
    "gs_esc23nstemi_hstroponin": "10.1093/eurheartj/ehad191",
    "gs_esc_pulmonary_embolism": "10.1093/eurheartj/ehz405",
    "gs_esc_af_rvr": "10.1093/eurheartj/ehae176",
    "gs_esc_acute_heart_failure": "10.1093/eurheartj/ehab368",
    "gs_esc_aortic_dissection": "10.1093/eurheartj/ehu281",
    "gs_esc_pericarditis": "10.1093/eurheartj/ehv318",
    "gs_esc_tamponade": "10.1093/eurheartj/ehv318",
    "gs_ssc21sepsis_antibiotics": "10.1097/CCM.0000000000005337",
    "gs_ssc21sepsis_fluids": "10.1097/CCM.0000000000005337",
    "gs_ssc21sepsis_lactate": "10.1097/CCM.0000000000005337",
    "gs_aha_stroke_thrombolysis": "10.1161/STR.0000000000000211",
    "gs_aha_ich_bp": "10.1161/STR.0000000000000407",
    "gs_nec_fasciitis": "10.1093/cid/ciu296",
}

# Legacy retrieval topic -> ICD-10 codes (from server/condition_catalog.py).
TOPIC_CONDITION_CODES: Dict[str, List[str]] = {
    "acs_stemi_reperfusion": ["I21.3"],
    "acs_dual_antiplatelet": ["I21.3", "I21.4", "I20.0"],
    "acs_oxygen_threshold": ["I21.3", "I21.4", "I20.0"],
    "nstemi_hs_troponin_pathway": ["I21.4", "I20.0", "R07.4"],
    "acs_chest_pain_ecg_timing": ["R07.4", "I21.3", "I21.4"],
    "sepsis_antibiotics_timing": ["A41.9", "R65.21"],
    "sepsis_fluid_resuscitation": ["A41.9", "R65.21"],
    "sepsis_lactate_guided_resuscitation": ["A41.9", "R65.21"],
    "sepsis_early_recognition_tr": ["A41.9", "R65.21"],
    "subarachnoid_haemorrhage_ct_timing": ["I60.9", "R51"],
    "subarachnoid_haemorrhage_lp_timing": ["I60.9"],
    "headache_red_flags": ["R51", "I60.9", "G43.909"],
    "aortic_dissection_management": ["I71.0"],
    "acute_heart_failure_management": ["I50.9"],
    "atrial_fibrillation_acute": ["I48.0"],
    "pericarditis_treatment": ["I30.9"],
    "cardiac_tamponade_management": ["I31.4"],
    "pulmonary_embolism_pathway": ["I26.9"],
    "acute_asthma_management": ["J45.901"],
    "copd_exacerbation_management": ["J44.1"],
    "pneumonia_severity_assessment": ["J18.9"],
    "pneumothorax_management": ["J93.1", "J93.0"],
    "ischaemic_stroke_reperfusion": ["I63.9"],
    "acute_stroke_recognition_tr": ["I63.9", "G45.9"],
    "intracerebral_haemorrhage_management": ["I61.9"],
    "bacterial_meningitis_antibiotics": ["G00.9", "A39.4"],
    "status_epilepticus_management": ["G41.9"],
    "acute_abdomen_initial_management": ["R10.4", "K35.80"],
    "acute_pancreatitis_management": ["K85.9"],
    "upper_gi_bleed_management": ["K92.2"],
    "ascending_cholangitis_management": ["K83.09", "K81.0"],
    "dka_management": ["E10.10"],
    "hhs_management": ["E11.00"],
    "hyperkalaemia_emergency": ["E87.5", "N18.6"],
    "adrenal_crisis_management": ["E27.2"],
    "necrotising_fasciitis_management": ["M72.6"],
    "pyelonephritis_management": ["N10"],
    "cellulitis_management": ["L03.90"],
    "acute_kidney_injury_management": ["N17.9"],
    "renal_colic_management": ["N23"],
    "paracetamol_overdose_management": ["T39.1X"],
    "opioid_overdose_management": ["T40.2X"],
    "ectopic_pregnancy_assessment": ["O00.90"],
    "preeclampsia_eclampsia_management": ["O14.90", "O15.9"],
    "postpartum_haemorrhage_management": ["O72.1"],
    "self_harm_risk_assessment": ["R45.851"],
    "alcohol_withdrawal_management": ["F10.239", "F10.231"],
    "neutropenic_sepsis_management": ["D70.9"],
    "sickle_cell_crisis_management": ["D57.00"],
    "anaphylaxis_management": ["T78.2"],
}

# ---------------------------------------------------------------------------
# Sources (exact documents) used below
# ---------------------------------------------------------------------------

NICE = "NICE"
_NICE_LIC = "open"  # NICE UK Open Content Licence (UK use); summarised, cited, deep-linked.
EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/{pmc}/fullTextXML"

SRC: Dict[str, Dict[str, str]] = {
    "ng185": dict(body=NICE, title="Acute coronary syndromes (NG185)", edition="NG185, November 2020",
                  url="https://www.nice.org.uk/guidance/ng185/chapter/Recommendations", published="2020-11-18"),
    "ng158": dict(body=NICE, title="Venous thromboembolic diseases: diagnosis, management and thrombophilia testing (NG158)",
                  edition="NG158, March 2020 (updated August 2023)",
                  url="https://www.nice.org.uk/guidance/ng158/chapter/Recommendations", published="2020-03-26"),
    "ssc21": dict(body="SSC (SCCM/ESICM)", title="Surviving Sepsis Campaign: International Guidelines for Management of Sepsis and Septic Shock 2021",
                  edition="2021", url="https://www.sccm.org/survivingsepsiscampaign/guidelines-and-resources/surviving-sepsis-campaign-adult-guidelines",
                  published="2021-10-04", doi="10.1097/CCM.0000000000005337", license="copyrighted-summarized"),
    "ng253": dict(body=NICE, title="Suspected sepsis in people aged 16 or over: recognition, assessment and early management (NG253)",
                  edition="NG253, November 2025", url="https://www.nice.org.uk/guidance/ng253/chapter/Evaluating-risk", published="2025-11-19"),
    "jbds_dka": dict(body="JBDS-IP", title="The Management of Diabetic Ketoacidosis in Adults (JBDS 02)", edition="Revised June 2021, updated March 2023",
                     url="https://abcd.care/sites/default/files/site_uploads/JBDS_Guidelines_Current/JBDS_02_DKA_Guideline_with_QR_code_March_2023.pdf",
                     published="2023-03-01"),
    "ng17": dict(body=NICE, title="Type 1 diabetes in adults: diagnosis and management (NG17)", edition="NG17, August 2015 (updated August 2022)",
                 url="https://www.nice.org.uk/guidance/ng17/chapter/Recommendations", published="2015-08-26"),
    "ng128": dict(body=NICE, title="Stroke and transient ischaemic attack in over 16s: diagnosis and initial management (NG128)",
                  edition="NG128, May 2019 (updated April 2022)", url="https://www.nice.org.uk/guidance/ng128/chapter/Recommendations", published="2019-05-01"),
    "ng228": dict(body=NICE, title="Subarachnoid haemorrhage caused by a ruptured aneurysm: diagnosis and management (NG228)",
                  edition="NG228, November 2022", url="https://www.nice.org.uk/guidance/ng228/chapter/Recommendations", published="2022-11-23"),
    "cg150": dict(body=NICE, title="Headaches in over 12s: diagnosis and management (CG150)", edition="CG150, September 2012 (updated December 2021)",
                  url="https://www.nice.org.uk/guidance/cg150/chapter/Recommendations", published="2012-09-19"),
    "wao20": dict(body="World Allergy Organization", title="World Allergy Organization Anaphylaxis Guidance 2020", edition="2020",
                  url="https://doi.org/10.1016/j.waojou.2020.100472", fetch=EPMC.format(pmc="PMC7607509"),
                  doi="10.1016/j.waojou.2020.100472", published="2020-10-30", license="open"),
    "sign158": dict(body="BTS/SIGN", title="British guideline on the management of asthma (SIGN 158)", edition="Revised edition, July 2019",
                    url="https://www.brit-thoracic.org.uk/document-library/guidelines/asthma/btssign-guideline-for-the-management-of-asthma-2019/",
                    published="2019-07-01"),
    "ng115": dict(body=NICE, title="Chronic obstructive pulmonary disease in over 16s: diagnosis and management (NG115)",
                  edition="NG115, December 2018 (updated July 2019)", url="https://www.nice.org.uk/guidance/ng115/chapter/Recommendations", published="2018-12-05"),
    "ng250": dict(body=NICE, title="Pneumonia: diagnosis and management (NG250)", edition="NG250, 2025",
                  url="https://www.nice.org.uk/guidance/ng250/chapter/Recommendations", published="2025-01-01"),
    "splf23": dict(body="SPLF/SMFU/SRLF/SFAR/SFCTCV", title="Guidelines for the management of patients with primary spontaneous pneumothorax",
                   edition="Annals of Intensive Care 2023;13:88", url="https://doi.org/10.1186/s13613-023-01181-2",
                   fetch=EPMC.format(pmc="PMC10509123"), doi="10.1186/s13613-023-01181-2", published="2023-09-19"),
    "wses25ptx": dict(body="WSES", title="Meta-analysis of the optimal needle length and decompression site for tension pneumothorax and consensus recommendations",
                      edition="World Journal of Emergency Surgery 2025", url="https://doi.org/10.1186/s13017-025-00613-7",
                      fetch=EPMC.format(pmc="PMC12087068"), doi="10.1186/s13017-025-00613-7", published="2025-05-01"),
    "wses20appy": dict(body="WSES", title="Diagnosis and treatment of acute appendicitis: 2020 update of the WSES Jerusalem guidelines",
                       edition="World Journal of Emergency Surgery 2020;15:27", url="https://doi.org/10.1186/s13017-020-00306-3",
                       fetch="https://wjes.biomedcentral.com/articles/10.1186/s13017-020-00306-3", doi="10.1186/s13017-020-00306-3", published="2020-04-15"),
    "wses20acc": dict(body="WSES", title="2020 World Society of Emergency Surgery updated guidelines for the diagnosis and treatment of acute calculus cholecystitis",
                      edition="World Journal of Emergency Surgery 2020;15:61", url="https://doi.org/10.1186/s13017-020-00336-x",
                      fetch="https://wjes.biomedcentral.com/articles/10.1186/s13017-020-00336-x", doi="10.1186/s13017-020-00336-x", published="2020-11-05"),
    "ng104": dict(body=NICE, title="Pancreatitis (NG104)", edition="NG104, September 2018 (updated December 2020)",
                  url="https://www.nice.org.uk/guidance/ng104/chapter/Recommendations", published="2018-09-05"),
    "wses19panc": dict(body="WSES", title="2019 WSES guidelines for the management of severe acute pancreatitis",
                       edition="World Journal of Emergency Surgery 2019;14:27", url="https://doi.org/10.1186/s13017-019-0247-0",
                       fetch="https://wjes.biomedcentral.com/articles/10.1186/s13017-019-0247-0", doi="10.1186/s13017-019-0247-0", published="2019-06-13"),
    "cg141": dict(body=NICE, title="Acute upper gastrointestinal bleeding in over 16s: management (CG141)", edition="CG141, June 2012 (updated 2016)",
                  url="https://www.nice.org.uk/guidance/cg141/chapter/Recommendations", published="2012-06-13"),
    "ng148": dict(body=NICE, title="Acute kidney injury: prevention, detection and management (NG148)", edition="NG148, December 2019",
                  url="https://www.nice.org.uk/guidance/ng148/chapter/Recommendations", published="2019-12-18"),
    "ukka20": dict(body="UK Kidney Association (Renal Association)", title="Clinical Practice Guidelines: Treatment of Acute Hyperkalaemia in Adults",
                   edition="July 2020 (v2, July 2022)",
                   url="https://www.ukkidney.org/sites/default/files/RENAL%20ASSOCIATION%20HYPERKALAEMIA%20GUIDELINE%20-%20JULY%202022%20V2_0.pdf",
                   published="2020-07-21"),
    "mhra12": dict(body="MHRA", title="Treating paracetamol overdose with intravenous acetylcysteine: new guidance (Drug Safety Update)",
                   edition="September 2012", url="https://www.gov.uk/drug-safety-update/treating-paracetamol-overdose-with-intravenous-acetylcysteine-new-guidance",
                   published="2012-09-01"),
    "who_opioid": dict(body="WHO", title="Opioid overdose: fact sheet", edition="2023",
                       url="https://www.who.int/news-room/fact-sheets/detail/opioid-overdose", published="2023-08-29"),
    "ng217": dict(body=NICE, title="Epilepsies in children, young people and adults (NG217)", edition="NG217, April 2022",
                  url="https://www.nice.org.uk/guidance/ng217/chapter/7-Treating-status-epilepticus-repeated-or-cluster-seizures-and-prolonged-seizures",
                  published="2022-04-27"),
    "ng235": dict(body=NICE, title="Intrapartum care (NG235)", edition="NG235, September 2023 (updated 2025)",
                  url="https://www.nice.org.uk/guidance/ng235/chapter/Recommendations", published="2023-09-29"),
    "rcog52": dict(body="RCOG", title="Prevention and Management of Postpartum Haemorrhage (Green-top Guideline No. 52)", edition="December 2016",
                   url="https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/prevention-and-management-of-postpartum-haemorrhage-green-top-guideline-no-52/",
                   published="2016-12-16"),
    "ng126sx": dict(body=NICE, title="Ectopic pregnancy and miscarriage: diagnosis and initial management (NG126)", edition="NG126, April 2019 (updated 2023)",
                    url="https://www.nice.org.uk/guidance/ng126/chapter/Symptoms-and-signs-of-ectopic-pregnancy-and-initial-assessment", published="2019-04-17"),
    "ng126mg": dict(body=NICE, title="Ectopic pregnancy and miscarriage: diagnosis and initial management (NG126)", edition="NG126, April 2019 (updated 2023)",
                    url="https://www.nice.org.uk/guidance/ng126/chapter/Management-of-tubal-ectopic-pregnancy", published="2019-04-17"),
    "cg113": dict(body=NICE, title="Generalised anxiety disorder and panic disorder in adults: management (CG113)", edition="CG113, January 2011 (updated 2020)",
                  url="https://www.nice.org.uk/guidance/cg113/chapter/Recommendations", published="2011-01-26"),
    "ng225": dict(body=NICE, title="Self-harm: assessment, management and preventing recurrence (NG225)", edition="NG225, September 2022",
                  url="https://www.nice.org.uk/guidance/ng225/chapter/Recommendations", published="2022-09-07"),
    "ng10": dict(body=NICE, title="Violence and aggression: short-term management in mental health, health and community settings (NG10)",
                 edition="NG10, May 2015", url="https://www.nice.org.uk/guidance/ng10/chapter/Recommendations", published="2015-05-28"),
    "jcs20": dict(body="JCS/JSCVS/JATS/JSVS", title="JCS/JSCVS/JATS/JSVS 2020 Guideline on Diagnosis and Treatment of Aortic Aneurysm and Aortic Dissection",
                  edition="Circulation Journal 2023;87(10):1410-1621", url="https://www.jstage.jst.go.jp/article/circj/87/10/87_CJ-22-0794/_html/-char/en",
                  doi="10.1253/circj.CJ-22-0794", published="2023-09-25"),
    "ng240": dict(body=NICE, title="Meningitis (bacterial) and meningococcal disease: recognition, diagnosis and management (NG240)", edition="NG240, March 2024",
                  url="https://www.nice.org.uk/guidance/ng240/chapter/Recommendations", published="2024-03-19"),
    "cg100": dict(body=NICE, title="Alcohol-use disorders: diagnosis and management of physical complications (CG100)", edition="CG100, June 2010 (updated 2017)",
                  url="https://www.nice.org.uk/guidance/cg100/chapter/Recommendations", published="2010-06-23"),
    "cg151": dict(body=NICE, title="Neutropenic sepsis: prevention and management in people with cancer (CG151)", edition="CG151, September 2012",
                  url="https://www.nice.org.uk/guidance/cg151/chapter/Recommendations", published="2012-09-19"),
    "ng111": dict(body=NICE, title="Pyelonephritis (acute): antimicrobial prescribing (NG111)", edition="NG111, October 2018",
                  url="https://www.nice.org.uk/guidance/ng111/chapter/Recommendations", published="2018-10-31"),
    "ng141": dict(body=NICE, title="Cellulitis and erysipelas: antimicrobial prescribing (NG141)", edition="NG141, September 2019",
                  url="https://www.nice.org.uk/guidance/ng141/chapter/Recommendations", published="2019-09-27"),
    # ---- Febrile families (acceptance 2026-10-20, D-11 / D-24) ----------------
    "ng110": dict(body=NICE, title="Prostatitis (acute): antimicrobial prescribing (NG110)", edition="NG110, October 2018",
                  url="https://www.nice.org.uk/guidance/ng110/chapter/Recommendations", published="2018-10-31"),
    "ng191t": dict(body=NICE, title="COVID-19 rapid guideline: managing COVID-19 (NG191), therapeutics", edition="NG191, March 2021 (updated)",
                   url="https://www.nice.org.uk/guidance/ng191/chapter/4-Therapeutics-for-COVID-19", published="2021-03-23"),
    "ng191c": dict(body=NICE, title="COVID-19 rapid guideline: managing COVID-19 (NG191), co-infections", edition="NG191, March 2021 (updated)",
                   url="https://www.nice.org.uk/guidance/ng191/chapter/6-Identifying-and-managing-co-infections", published="2021-03-23"),
    "cg183": dict(body=NICE, title="Drug allergy: diagnosis and management (CG183)", edition="CG183, September 2014",
                  url="https://www.nice.org.uk/guidance/cg183/chapter/Recommendations", published="2014-09-03"),
    "ng197": dict(body=NICE, title="Shared decision making (NG197)", edition="NG197, June 2021",
                  url="https://www.nice.org.uk/guidance/ng197/chapter/Recommendations", published="2021-06-17"),
    "cdc_pid": dict(body="CDC", title="Sexually Transmitted Infections Treatment Guidelines, 2021: Pelvic Inflammatory Disease",
                    edition="MMWR Recomm Rep 2021;70(4)", url="https://www.cdc.gov/std/treatment-guidelines/pid.htm",
                    published="2021-07-23"),
    "cdc_flu": dict(body="CDC", title="Influenza Antiviral Medications: Summary for Clinicians", edition="Current season",
                    url="https://www.cdc.gov/flu/hcp/antivirals/summary-clinicians.html", published="2024-09-01"),
    "cdc_malaria": dict(body="CDC", title="Clinical Guidance: Malaria Diagnosis and Treatment in the U.S. (Algorithm, Appendix B)",
                        edition="Updated August 2026", url="https://www.cdc.gov/malaria/hcp/clinical-guidance/appendix-b-algorithm.html",
                        published="2026-07-09"),
    "ng118": dict(body=NICE, title="Renal and ureteric stones: assessment and management (NG118)", edition="NG118, January 2019",
                  url="https://www.nice.org.uk/guidance/ng118/chapter/Recommendations", published="2019-01-08"),
}


def _s(sid: str, src: str, en: str, tr: str, codes: List[str], *, topic: str = "",
       specialties: List[str] | None = None, countries: List[str] | None = None) -> GuidelineStatement:
    meta = SRC[src]
    return GuidelineStatement(
        id=sid,
        statement_en=en,
        statement_tr=tr,
        source_body=meta["body"],
        source_title=meta["title"],
        source_url=meta["url"],
        fetch_url=meta.get("fetch", ""),
        doi=meta.get("doi", ""),
        edition_or_version=meta["edition"],
        published_date=meta.get("published", ""),
        license_tag=meta.get("license", _NICE_LIC),
        scope={"countries": countries or (["UK"] if meta["body"] == NICE else ["GLOBAL"]),
               "specialties": specialties or [], "population": "adult", "care_setting": ["ED"]},
        condition_codes=codes,
        topic=topic or sid,
        status="draft",
    )


# ---------------------------------------------------------------------------
# The statements
# ---------------------------------------------------------------------------

def open_statements() -> List[GuidelineStatement]:  # noqa: C901 - a flat authored list
    S: List[GuidelineStatement] = []
    ACS = ["I21.3", "I21.4", "I20.0", "R07.4"]

    # ---- ACS (NICE NG185) ------------------------------------------------
    S.append(_s("gs_nice_ng185_aspirin300", "ng185",
        "Offer people with acute STEMI a single loading dose of 300 mg aspirin as soon as possible, unless there is clear evidence that they are allergic to it.",
        "Akut STEMI'li hastalara, aspirine alerjik olduklarına dair açık kanıt yoksa, mümkün olan en kısa sürede tek bir 300 mg aspirin yükleme dozu verin.",
        ["I21.3"], specialties=["cardiology"]))
    S.append(_s("gs_nice_ng185_ppci_120min", "ng185",
        "For acute STEMI presenting within 12 hours of symptom onset, offer coronary angiography with follow-on primary PCI as the preferred coronary reperfusion strategy if primary PCI can be delivered within 120 minutes of the time when fibrinolysis could have been given.",
        "Semptom başlangıcından sonraki 12 saat içinde başvuran akut STEMI'de, fibrinolizin verilebileceği zamandan itibaren 120 dakika içinde uygulanabiliyorsa, tercih edilen koroner reperfüzyon stratejisi olarak koroner anjiyografi ve ardından primer PKG önerin.",
        ["I21.3"], specialties=["cardiology"]))
    S.append(_s("gs_nice_ng185_fibrinolysis", "ng185",
        "Offer fibrinolysis to people with acute STEMI presenting within 12 hours of onset of symptoms if primary PCI cannot be delivered within 120 minutes of the time when fibrinolysis could have been given.",
        "Fibrinolizin verilebileceği zamandan itibaren 120 dakika içinde primer PKG uygulanamıyorsa, semptom başlangıcından sonraki 12 saat içinde başvuran akut STEMI hastalarına fibrinoliz önerin.",
        ["I21.3"], specialties=["cardiology"]))
    S.append(_s("gs_nice_ng185_reperfusion_eligibility", "ng185",
        "Immediately assess eligibility for coronary reperfusion therapy (primary PCI or fibrinolysis) in people with acute STEMI, irrespective of age, ethnicity or sex, and deliver coronary reperfusion therapy as quickly as possible for eligible people.",
        "Akut STEMI'li hastalarda yaş, etnik köken veya cinsiyetten bağımsız olarak koroner reperfüzyon tedavisine (primer PKG veya fibrinoliz) uygunluğu hemen değerlendirin ve uygun hastalara reperfüzyonu mümkün olan en kısa sürede uygulayın.",
        ["I21.3"], specialties=["cardiology"]))
    S.append(_s("gs_nice_ng185_nstemi_assessment", "ng185",
        "For people with NSTEMI or unstable angina, formal risk assessment includes a full clinical history, a physical examination including measurement of blood pressure and heart rate, a resting 12-lead ECG looking particularly for dynamic or unstable patterns that indicate myocardial ischaemia, and blood tests such as troponin I or T, creatinine, glucose and haemoglobin.",
        "NSTEMI veya kararsız anjinada formal risk değerlendirmesi tam klinik öykü, kan basıncı ve kalp hızı ölçümünü içeren fizik muayene, miyokart iskemisini gösteren dinamik veya kararsız paternlere özellikle dikkat edilen istirahat 12 derivasyonlu EKG ve troponin I veya T, kreatinin, glukoz ve hemoglobin gibi kan tetkiklerini içerir.",
        ["I21.4", "I20.0", "R07.4"], specialties=["cardiology"]))

    # ---- Pulmonary embolism (NICE NG158) ----------------------------------
    S.append(_s("gs_nice_ng158_pe_wells", "ng158",
        "If PE is suspected, use the two-level PE Wells score to estimate the clinical probability of PE.",
        "PE'den şüpheleniliyorsa PE'nin klinik olasılığını tahmin etmek için iki düzeyli PE Wells skorunu kullanın.",
        ["I26.9"], specialties=["pulmonology"]))
    S.append(_s("gs_nice_ng158_pe_ctpa", "ng158",
        "For people with a likely PE Wells score (more than 4 points), offer a computed tomography pulmonary angiogram (CTPA) immediately if possible; if a CTPA cannot be done immediately, offer interim therapeutic anticoagulation.",
        "PE Wells skoru 'olası' (4 puandan fazla) olan hastalara mümkünse hemen BT pulmoner anjiyografi (BTPA) önerin; BTPA hemen yapılamıyorsa geçici terapötik antikoagülasyon önerin.",
        ["I26.9"], specialties=["pulmonology"]))
    S.append(_s("gs_nice_ng158_pe_unlikely_ddimer", "ng158",
        "For people with an unlikely PE Wells score (4 points or less), offer a D-dimer test with the result available within 4 hours; if the result cannot be obtained within 4 hours, offer interim therapeutic anticoagulation while awaiting the result.",
        "PE Wells skoru 'olası değil' (4 puan veya altı) olan hastalara sonucu 4 saat içinde alınabilecek bir D-dimer testi önerin; sonuç 4 saat içinde alınamıyorsa sonucu beklerken geçici terapötik antikoagülasyon önerin.",
        ["I26.9"], specialties=["pulmonology"]))

    # ---- Sepsis (SSC 2021, NICE NG253) ------------------------------------
    SEP = ["A41.9", "R65.21", "R65.20"]
    S.append(_s("gs_ssc21_antimicrobials_1h", "ssc21",
        "For adults with possible, probable or definite septic shock, and for adults with probable or definite sepsis without shock, administer antimicrobial therapy immediately, ideally within 1 hour of recognition.",
        "Olası, muhtemel veya kesin septik şoklu erişkinlerde ve şok olmayan muhtemel veya kesin sepsisli erişkinlerde antimikrobiyal tedaviyi hemen, ideal olarak tanınmadan sonraki 1 saat içinde uygulayın.",
        SEP, specialties=["sepsis"]))
    S.append(_s("gs_ssc21_fluids_30mlkg", "ssc21",
        "For adults with sepsis-induced hypoperfusion or septic shock, administer at least 30 mL/kg of IV crystalloid in the first 3 hours; crystalloids are the first-line fluid for resuscitation, with balanced crystalloids suggested over 0.9% saline.",
        "Sepsise bağlı hipoperfüzyon veya septik şoklu erişkinlere ilk 3 saat içinde en az 30 mL/kg IV kristaloid uygulayın; resüsitasyonda birinci basamak sıvı kristaloidlerdir ve %0,9 salin yerine dengeli kristaloidler önerilir.",
        SEP, specialties=["sepsis"]))
    S.append(_s("gs_ssc21_lactate_cultures", "ssc21",
        "For adults with possible, probable or definite sepsis or septic shock, collect blood cultures as soon as possible and ideally before administration of antimicrobial therapy, measure blood lactate, and use serial lactate measurements to guide resuscitation when lactate is elevated.",
        "Olası, muhtemel veya kesin sepsis ya da septik şoklu erişkinlerde kan kültürlerini mümkün olan en kısa sürede ve ideal olarak antimikrobiyal tedaviden önce alın, kan laktatını ölçün ve laktat yüksekse resüsitasyonu yönlendirmek için seri laktat ölçümleri kullanın.",
        SEP, specialties=["sepsis"]))
    S.append(_s("gs_ssc21_norepinephrine_map65", "ssc21",
        "For adults with septic shock, use norepinephrine as the first-line vasopressor, starting vasopressors peripherally to restore MAP rather than delaying initiation until central venous access is secured, with an initial MAP target of 65 mm Hg.",
        "Septik şoklu erişkinlerde birinci basamak vazopresör olarak norepinefrin kullanın; santral venöz erişim sağlanana kadar beklemek yerine vazopresörleri periferik yoldan başlatın ve başlangıç OAB hedefi 65 mm Hg olsun.",
        SEP, specialties=["sepsis"]))
    S.append(_s("gs_ssc21_screening", "ssc21",
        "For acutely ill patients in hospital, use NEWS, NEWS2, MEWS or SIRS over qSOFA as a single tool to screen for sepsis; sepsis is a clinical diagnosis and should not be ruled in or ruled out using a single biomarker or diagnostic test.",
        "Hastanede akut hasta bireylerde sepsis taraması için tek araç olarak qSOFA yerine NEWS, NEWS2, MEWS veya SIRS kullanın; sepsis klinik bir tanıdır ve tek bir biyobelirteç veya tanı testiyle doğrulanmamalı ya da dışlanmamalıdır.",
        SEP, specialties=["sepsis"]))
    S.append(_s("gs_nice_ng253_high_risk_criteria", "ng253",
        "High-risk criteria for suspected sepsis include a raised respiratory rate of 25 breaths per minute or more, a new need for oxygen (40% FiO2 or more) to maintain saturation more than 92%, systolic blood pressure 90 mmHg or less or more than 40 mmHg below normal, a raised heart rate of more than 130 beats per minute, and not passed urine in the previous 18 hours.",
        "Şüpheli sepsiste yüksek risk kriterleri: dakikada 25 veya üzeri solunum sayısı, satürasyonu %92'nin üzerinde tutmak için yeni oksijen gereksinimi (%40 FiO2 veya üzeri), 90 mmHg veya altında ya da normalin 40 mmHg'den fazla altında sistolik kan basıncı, dakikada 130'un üzerinde kalp hızı ve son 18 saatte idrar yapmamış olma.",
        SEP, specialties=["sepsis"]))

    # ---- DKA (JBDS 02, NICE NG17) -----------------------------------------
    DKA = ["E10.10", "E11.10"]
    S.append(_s("gs_jbds_dka_diagnosis", "jbds_dka",
        "Diagnose DKA when all three are present: a blood glucose concentration above 11.0 mmol/L or known diabetes mellitus, a capillary or blood ketone concentration above 3.0 mmol/L or significant ketonuria (2+ or more on standard urine sticks), and a bicarbonate concentration below 15.0 mmol/L and/or venous pH below 7.3.",
        "DKA tanısı için üçü de bulunmalıdır: 11,0 mmol/L üzerinde kan glukozu veya bilinen diabetes mellitus, 3,0 mmol/L üzerinde kapiller ya da kan ketonu veya anlamlı ketonüri (idrar çubuğunda 2+ veya üzeri) ve 15,0 mmol/L altında bikarbonat ve/veya 7,3 altında venöz pH.",
        DKA, specialties=["endocrine"]))
    S.append(_s("gs_jbds_dka_friii", "jbds_dka",
        "Commence a fixed rate intravenous insulin infusion (FRIII) at 0.1 unit/kg/hour based on an estimate of weight, made up as 50 units human soluble insulin in 50 ml 0.9% sodium chloride solution, and continue the patient's usual long-acting insulin analogue at the usual dose and time.",
        "Tahmini ağırlığa göre 0,1 ünite/kg/saat sabit hızlı intravenöz insülin infüzyonu (FRIII) başlayın (50 ünite insan soluble insülin 50 ml %0,9 sodyum klorür içinde) ve hastanın kullandığı uzun etkili insülin analoğuna olağan doz ve zamanda devam edin.",
        DKA, specialties=["endocrine"]))
    # Split in two (fluids; potassium) so that every number sits in one verifiable passage.
    S.append(_s("gs_jbds_dka_fluids", "jbds_dka",
        "Commence 0.9% sodium chloride solution via an infusion pump using a large bore cannula: if systolic BP is below 90 mmHg give 500 ml over 10 to 15 minutes and repeat whilst awaiting senior input, otherwise give 1 L over the first 60 minutes.",
        "Geniş lümenli bir kanülle infüzyon pompası üzerinden %0,9 sodyum klorür başlayın: sistolik KB 90 mmHg altındaysa 10-15 dakikada 500 ml verip kıdemli görüş beklenirken tekrarlayın, aksi halde ilk 60 dakikada 1 L verin.",
        DKA, specialties=["endocrine"]))
    S.append(_s("gs_jbds_dka_potassium", "jbds_dka",
        "Add 40 mmol/L potassium chloride to the 0.9% sodium chloride when the potassium level is 3.5 to 5.5 mmol/L, and seek senior review if the potassium is below 3.5 mmol/L.",
        "Potasyum 3,5-5,5 mmol/L ise %0,9 sodyum klorüre 40 mmol/L potasyum klorür ekleyin; potasyum 3,5 mmol/L altındaysa kıdemli değerlendirme isteyin.",
        DKA, specialties=["endocrine"]))
    S.append(_s("gs_jbds_dka_targets_glucose", "jbds_dka",
        "Aim for a rate of fall of ketones of at least 0.5 mmol/L/hr, a bicarbonate rise of 3 mmol/L/hr and a blood glucose fall of 3 mmol/L/hr; add 10% glucose at 125 ml/hr if blood glucose falls below 14 mmol/L and consider reducing the intravenous insulin infusion to 0.05 units/kg/hour.",
        "Ketonların saatte en az 0,5 mmol/L düşmesini, bikarbonatın saatte 3 mmol/L yükselmesini ve kan glukozunun saatte 3 mmol/L düşmesini hedefleyin; kan glukozu 14 mmol/L altına inerse 125 ml/saat %10 glukoz ekleyin ve intravenöz insülin infüzyonunu 0,05 ünite/kg/saate düşürmeyi düşünün.",
        DKA, specialties=["endocrine"]))
    S.append(_s("gs_jbds_dka_monitoring", "jbds_dka",
        "Establish a monitoring regimen of hourly capillary blood glucose and hourly capillary ketone measurement, with venous blood gas for pH, bicarbonate and potassium at 60 minutes, 2 hours and 2 hourly thereafter; if potassium is outside the normal range re-assess potassium replacement and seek immediate senior medical advice if still abnormal after a further hour.",
        "Saatlik kapiller kan glukozu ve saatlik kapiller keton ölçümü ile 60. dakikada, 2. saatte ve sonrasında 2 saatte bir pH, bikarbonat ve potasyum için venöz kan gazı içeren bir izlem düzeni kurun; potasyum normal aralık dışındaysa potasyum replasmanını yeniden değerlendirin ve bir saat sonra hala anormalse hemen kıdemli tıbbi görüş alın.",
        DKA, specialties=["endocrine"]))
    S.append(_s("gs_nice_ng17_dka_fluids_bicarb", "ng17",
        "In adults with DKA, use isotonic saline for primary fluid replacement, not given too rapidly except in cases of circulatory collapse; do not generally use bicarbonate; give intravenous insulin by infusion; and begin potassium replacement early with frequent monitoring for hypokalaemia.",
        "DKA'lı erişkinlerde birincil sıvı replasmanı için izotonik salin kullanın ve dolaşım kollapsı dışında çok hızlı vermeyin; genel olarak bikarbonat kullanmayın; insülini intravenöz infüzyonla verin; potasyum replasmanına erken başlayıp hipokalemi açısından sık izleyin.",
        DKA, specialties=["endocrine"]))

    # ---- Stroke (NICE NG128) ----------------------------------------------
    STROKE = ["I63.9", "G45.9"]
    S.append(_s("gs_nice_ng128_fast_glucose", "ng128",
        "Use a validated tool, such as FAST (Face Arm Speech Test), outside hospital to screen people with sudden onset of neurological symptoms for a diagnosis of stroke or TIA, and exclude hypoglycaemia as the cause of these symptoms.",
        "Hastane dışında ani başlangıçlı nörolojik semptomları olan kişileri inme veya GİA açısından taramak için FAST (Yüz Kol Konuşma Testi) gibi geçerli bir araç kullanın ve semptomların nedeni olarak hipoglisemiyi dışlayın.",
        STROKE, specialties=["neurology"]))
    S.append(_s("gs_nice_ng128_ct_immediate", "ng128",
        "Perform brain imaging immediately with a non-enhanced CT for people with suspected acute stroke if any of the following apply: indications for thrombolysis or thrombectomy, on anticoagulant treatment, a known bleeding tendency, a depressed level of consciousness (Glasgow Coma Score below 13), unexplained progressive or fluctuating symptoms, papilloedema, neck stiffness or fever, or severe headache at onset of stroke symptoms.",
        "Şüpheli akut inmede şunlardan herhangi biri varsa kontrastsız BT ile beyin görüntülemesini hemen yapın: tromboliz veya trombektomi endikasyonu, antikoagülan kullanımı, bilinen kanama eğilimi, bilinç düzeyinde baskılanma (Glasgow Koma Skoru 13 altı), açıklanamayan ilerleyici veya dalgalı semptomlar, papilödem, ense sertliği veya ateş ya da inme semptomlarının başlangıcında şiddetli baş ağrısı.",
        STROKE + ["I61.9"], specialties=["neurology"]))
    S.append(_s("gs_nice_ng128_thrombolysis", "ng128",
        "Thrombolytic medicines (alteplase or tenecteplase) for treating acute ischaemic stroke are given within 4.5 hours of symptom onset and when intracranial haemorrhage has been excluded, only within a well-organised stroke service with staff trained in delivering thrombolysis and in monitoring for complications.",
        "Akut iskemik inmede trombolitik ilaçlar (alteplaz veya tenekteplaz) semptom başlangıcından sonraki 4,5 saat içinde ve intrakraniyal kanama dışlandığında, yalnızca trombolizi uygulama ve komplikasyonları izleme konusunda eğitimli personeli olan iyi organize bir inme servisinde verilir.",
        ["I63.9"], specialties=["neurology"]))
    S.append(_s("gs_nice_ng128_aspirin_swallow", "ng128",
        "Offer aspirin 300 mg as soon as possible, but certainly within 24 hours, to everyone presenting with acute stroke who has had a diagnosis of intracerebral haemorrhage excluded by brain imaging (orally if they do not have dysphagia, rectally or by enteral tube if they do), and ensure swallowing is screened by an appropriately trained healthcare professional before any oral food, fluid or medication.",
        "Beyin görüntülemesiyle intraserebral kanama dışlanmış akut inmeli herkese mümkün olan en kısa sürede ve kesinlikle 24 saat içinde 300 mg aspirin verin (disfaji yoksa oral, varsa rektal veya enteral tüple) ve herhangi bir oral gıda, sıvı veya ilaçtan önce yutmanın eğitimli bir sağlık profesyoneli tarafından taranmasını sağlayın.",
        ["I63.9"], specialties=["neurology"]))
    S.append(_s("gs_nice_ng128_stroke_unit", "ng128",
        "Admit everyone with suspected stroke directly to a specialist acute stroke unit after initial assessment, from either the community, the emergency department, or outpatient clinics.",
        "Şüpheli inmeli herkesi ilk değerlendirmeden sonra toplumdan, acil servisten veya polikliniklerden doğrudan uzmanlaşmış bir akut inme ünitesine yatırın.",
        STROKE, specialties=["neurology"]))
    S.append(_s("gs_nice_ng128_ich_bp", "ng128",
        "Consider rapid blood pressure lowering for people with acute intracerebral haemorrhage who present within 6 hours of symptom onset and have a systolic blood pressure of between 150 and 220 mmHg, provided they have none of the listed exclusions.",
        "Semptom başlangıcından sonraki 6 saat içinde başvuran ve sistolik kan basıncı 150-220 mmHg arasında olan akut intraserebral kanamalı hastalarda, listelenen dışlama kriterleri yoksa hızlı kan basıncı düşürmeyi değerlendirin.",
        ["I61.9"], specialties=["neurology"]))

    # ---- SAH and headache (NICE NG228, CG150) -----------------------------
    S.append(_s("gs_nice_ng228_thunderclap", "ng228",
        "A thunderclap headache (a sudden severe headache, typically peaking in intensity within 1 to 5 minutes) is a red-flag symptom of subarachnoid haemorrhage: take a careful history to establish the rate of onset and time to peak intensity, and refer the person for an urgent non-contrast CT head scan if review by a senior clinical decision-maker confirms unexplained thunderclap headache.",
        "Gök gürültüsü baş ağrısı (tipik olarak 1-5 dakika içinde şiddeti zirveye ulaşan ani şiddetli baş ağrısı) subaraknoid kanama için kırmızı bayrak bir semptomdur: başlangıç hızını ve zirveye ulaşma süresini belirlemek için dikkatli öykü alın ve kıdemli bir klinik karar vericinin değerlendirmesi açıklanamayan gök gürültüsü baş ağrısını doğruluyorsa hastayı acil kontrastsız beyin BT'sine yönlendirin.",
        ["I60.9", "R51"], specialties=["neurology"]))
    S.append(_s("gs_nice_ng228_cta_transfer", "ng228",
        "Offer CT angiography of the head without delay to people with a confirmed diagnosis of subarachnoid haemorrhage to identify the cause of the bleeding, and urgently discuss with a specialist neurosurgical centre the need for transfer of care; the risk of rebleeding is highest within 24 hours of the onset of symptoms.",
        "Doğrulanmış subaraknoid kanamalı hastalara kanamanın nedenini saptamak için gecikmeden beyin BT anjiyografisi önerin ve bakım transferi gereksinimini uzman bir nöroşirürji merkeziyle acilen görüşün; yeniden kanama riski semptom başlangıcından sonraki 24 saat içinde en yüksektir.",
        ["I60.9"], specialties=["neurology"]))
    S.append(_s("gs_nice_ng228_nimodipine", "ng228",
        "Consider enteral nimodipine for people with a confirmed subarachnoid haemorrhage; only use intravenous nimodipine within a specialist setting and if enteral treatment is not suitable.",
        "Doğrulanmış subaraknoid kanamalı hastalarda enteral nimodipini değerlendirin; intravenöz nimodipini yalnızca uzman bir ortamda ve enteral tedavi uygun değilse kullanın.",
        ["I60.9"], specialties=["neurology"]))
    S.append(_s("gs_nice_cg150_redflags", "cg150",
        "Evaluate people who present with headache and any of the following features, and consider the need for further investigations and/or referral: worsening headache with fever, sudden-onset headache reaching maximum intensity within 5 minutes, new-onset neurological deficit, new-onset cognitive dysfunction, change in personality, impaired level of consciousness, recent (typically within the past 3 months) head trauma, or headache triggered by cough, valsalva or exertion.",
        "Baş ağrısıyla başvuran ve şu özelliklerden herhangi biri olan kişileri değerlendirip ileri tetkik ve/veya sevk gereksinimini düşünün: ateşle birlikte kötüleşen baş ağrısı, 5 dakika içinde maksimum şiddete ulaşan ani başlangıçlı baş ağrısı, yeni nörolojik defisit, yeni bilişsel bozukluk, kişilik değişikliği, bilinç düzeyinde bozulma, yakın zamanda (tipik olarak son 3 ay) kafa travması veya öksürük, valsalva ya da eforla tetiklenen baş ağrısı.",
        ["R51", "I60.9", "G43.909", "G00.9"], specialties=["neurology"]))

    # ---- Anaphylaxis (WAO 2020) -------------------------------------------
    ANA = ["T78.2", "T78.0", "T88.6"]
    S.append(_s("gs_wao2020_anaph_epinephrine_im", "wao20",
        "Intramuscular epinephrine (adrenaline) is the first-line drug recommended to treat anaphylaxis: the dose for healthcare professionals is 0.01 mg/kg of body weight to a maximum total dose of 0.5 mg, given by the intramuscular route into the mid-anterolateral thigh, and dosing should be repeated every 5 to 15 min if symptoms are refractory to treatment.",
        "Anafilaksi tedavisinde birinci basamak ilaç kas içi epinefrindir (adrenalin): sağlık profesyonelleri için doz, en fazla toplam 0,5 mg olmak üzere 0,01 mg/kg'dır, uyluğun orta anterolateral bölgesine kas içi uygulanır ve semptomlar tedaviye dirençliyse doz 5-15 dakikada bir tekrarlanır.",
        ANA, specialties=["emergency"]))
    S.append(_s("gs_wao2020_anaph_positioning", "wao20",
        "Most patients should be placed in a supine position during anaphylaxis unless there is respiratory distress, in which case a sitting position may optimize respiratory effort; if pregnant, position the patient in a semi-recumbent position on the left side; if unconscious, place in the recovery position.",
        "Anafilaksi sırasında hastaların çoğu, solunum sıkıntısı yoksa sırtüstü yatırılmalıdır; solunum sıkıntısı varsa oturur pozisyon solunum eforunu iyileştirebilir; gebeyse hastayı sol yanına yarı yatar pozisyona getirin; bilinci kapalıysa derlenme pozisyonuna alın.",
        ANA, specialties=["emergency"]))
    S.append(_s("gs_wao2020_anaph_observation", "wao20",
        "Around half of biphasic reactions occur within the first 6 to 12 hours following the reaction, so patients with anaphylaxis need to be observed, especially after severe reactions and those requiring multiple doses of epinephrine; antihistamines and glucocorticosteroids must not delay the more urgent repeated administration of intramuscular epinephrine.",
        "Bifazik reaksiyonların yaklaşık yarısı reaksiyondan sonraki ilk 6-12 saat içinde ortaya çıkar; bu nedenle anafilaksili hastalar, özellikle ağır reaksiyonlardan ve birden fazla epinefrin dozu gereken durumlardan sonra gözlemlenmelidir; antihistaminikler ve glukokortikosteroidler daha acil olan tekrarlı kas içi epinefrin uygulamasını geciktirmemelidir.",
        ANA, specialties=["emergency"]))

    # ---- Asthma (BTS/SIGN 158) and COPD (NICE NG115) -----------------------
    ASTH = ["J45.901", "J45.902"]
    S.append(_s("gs_sign158_asthma_severity", "sign158",
        "Acute severe asthma in adults is any one of PEF 33 to 50% best or predicted, respiratory rate 25/min or more, heart rate 110/min or more, or inability to complete sentences in one breath; life-threatening asthma is any of PEF below 33% best or predicted, SpO2 below 92%, silent chest, cyanosis, poor respiratory effort, arrhythmia, hypotension, exhaustion or altered conscious level.",
        "Erişkinde akut ağır astım: PEF en iyi veya beklenenin %33-50'si, solunum sayısı 25/dk veya üzeri, kalp hızı 110/dk veya üzeri ya da bir nefeste cümle tamamlayamama kriterlerinden herhangi biri; yaşamı tehdit eden astım: PEF %33'ün altı, SpO2 %92'nin altı, sessiz göğüs, siyanoz, zayıf solunum eforu, aritmi, hipotansiyon, bitkinlik veya bilinç düzeyinde değişiklik.",
        ASTH, specialties=["pulmonology"]))
    S.append(_s("gs_sign158_asthma_oxygen_saba", "sign158",
        "Give controlled supplementary oxygen to all hypoxaemic patients with acute severe asthma titrated to maintain an SpO2 level of 94 to 98%, and use high-dose inhaled beta-2 agonists as first-line agents in acute asthma, administered as early as possible; in hospital, nebulisers for giving beta-2 agonist bronchodilators should preferably be driven by oxygen.",
        "Akut ağır astımlı tüm hipoksemik hastalara SpO2 %94-98 hedefiyle titre edilen kontrollü ek oksijen verin ve akut astımda birinci basamak olarak yüksek doz inhale beta-2 agonistleri mümkün olan en erken zamanda uygulayın; hastanede beta-2 agonist nebülizasyonu tercihen oksijenle sürülmelidir.",
        ASTH, specialties=["pulmonology"]))
    S.append(_s("gs_sign158_asthma_steroids", "sign158",
        "Give steroids in adequate doses to all patients with an acute asthma attack: prednisolone 40 to 50 mg daily or parenteral hydrocortisone 400 mg daily are as effective as higher doses, and prednisolone should be continued until recovery, for a minimum of 5 days.",
        "Akut astım atağı olan tüm hastalara yeterli dozda steroid verin: günlük 40-50 mg prednizolon veya günlük 400 mg parenteral hidrokortizon daha yüksek dozlar kadar etkilidir ve prednizolon iyileşmeye kadar, en az 5 gün sürdürülmelidir.",
        ASTH, specialties=["pulmonology"]))
    S.append(_s("gs_sign158_asthma_abg_magnesium", "sign158",
        "Patients with SpO2 below 92% or other features of life-threatening asthma require arterial blood gas measurement, because SpO2 below 92% is associated with a risk of hypercapnia that pulse oximetry does not detect; a single dose of intravenous magnesium sulphate is safe and may improve lung function and reduce intubation rates in acute severe asthma.",
        "SpO2 %92'nin altında olan veya yaşamı tehdit eden astımın diğer özelliklerini taşıyan hastalarda arter kan gazı ölçümü gerekir; çünkü %92 altı SpO2, nabız oksimetresinin saptamadığı hiperkapni riskiyle ilişkilidir; akut ağır astımda tek doz intravenöz magnezyum sülfat güvenlidir, akciğer fonksiyonunu iyileştirip entübasyon oranlarını azaltabilir.",
        ASTH, specialties=["pulmonology"]))
    S.append(_s("gs_nice_ng115_copd_steroids", "ng115",
        "For people having an exacerbation of COPD with a significant increase in breathlessness that interferes with daily activities, use oral corticosteroids: offer 30 mg oral prednisolone daily for 5 days, because the evidence showed no benefit from taking corticosteroids for more than 7 days.",
        "Günlük aktiviteleri etkileyen anlamlı nefes darlığı artışıyla KOAH alevlenmesi geçiren hastalarda oral kortikosteroid kullanın: 5 gün boyunca günde 30 mg oral prednizolon önerin; kanıtlar kortikosteroidlerin 7 günden uzun kullanımının yarar sağlamadığını göstermiştir.",
        ["J44.1"], specialties=["pulmonology"]))
    S.append(_s("gs_nice_ng115_copd_niv", "ng115",
        "Use non-invasive ventilation as the treatment of choice for persistent hypercapnic ventilatory failure during exacerbations of COPD despite optimal medical therapy.",
        "Optimal medikal tedaviye rağmen KOAH alevlenmesi sırasında kalıcı hiperkapnik ventilatuar yetmezlikte tercih edilen tedavi olarak noninvaziv ventilasyon kullanın.",
        ["J44.1"], specialties=["pulmonology"]))

    # ---- Pneumonia (NICE NG250) -------------------------------------------
    S.append(_s("gs_nice_ng250_curb65", "ng250",
        "If a clinical diagnosis of community-acquired pneumonia has been made in hospital, determine whether adults are at low, intermediate or high risk of death using the CURB65 scoring system, and use clinical judgement together with the CURB65 score to stratify adults into low-, moderate- or high-severity disease; the disease severity will usually correspond to the risk of death.",
        "Hastanede toplum kökenli pnömoni klinik tanısı konmuşsa erişkinlerin düşük, orta veya yüksek ölüm riskinde olduğunu CURB65 skorlama sistemiyle belirleyin ve CURB65 skoruyla birlikte klinik yargıyı kullanarak erişkinleri düşük, orta veya yüksek şiddetli hastalık olarak sınıflandırın; hastalık şiddeti genellikle ölüm riskine karşılık gelir.",
        ["J18.9"], specialties=["pulmonology"]))
    S.append(_s("gs_nice_ng250_cap_4h", "ng250",
        "Put in place processes to allow diagnosis (including chest X-ray) of community-acquired pneumonia in adults within 4 hours of presentation to hospital, and start antibiotic treatment as soon as possible after establishing a diagnosis of community-acquired pneumonia, and within 4 hours of presentation to hospital.",
        "Erişkinlerde toplum kökenli pnömoninin hastaneye başvurudan sonraki 4 saat içinde tanısına (akciğer grafisi dâhil) olanak veren süreçler kurun ve tanı konduktan sonra mümkün olan en kısa sürede ve başvurudan sonraki 4 saat içinde antibiyotik tedavisine başlayın.",
        ["J18.9"], specialties=["pulmonology"]))
    S.append(_s("gs_nice_ng250_cap_micro", "ng250",
        "Do not routinely offer microbiological tests to adults with low-severity community-acquired pneumonia; for adults with moderate- or high-severity community-acquired pneumonia, consider blood cultures if there are additional clinical indications such as suspected sepsis, and sputum cultures.",
        "Düşük şiddetli toplum kökenli pnömonili erişkinlere rutin mikrobiyolojik test önermeyin; orta veya yüksek şiddetli toplum kökenli pnömonide şüpheli sepsis gibi ek klinik endikasyon varsa kan kültürlerini ve balgam kültürünü değerlendirin.",
        ["J18.9"], specialties=["pulmonology"]))

    # ---- Pneumothorax (SPLF 2023, WSES 2025) ------------------------------
    S.append(_s("gs_splf2023_psp_outpatient", "splf23",
        "For a large primary spontaneous pneumothorax without signs of immediate severity, outpatient management based on needle aspiration or on a mini-chest tube with one-way valve is recommended if the patient is stable after intrapleural air removal, a dedicated outpatient care system is previously organized and a consultation with chest ultrasound or CXR is scheduled at 24 to 72 h to assess the evolution.",
        "Acil ciddiyet bulgusu olmayan büyük primer spontan pnömotoraksta, intraplevral hava boşaltımından sonra hasta stabilse, önceden organize edilmiş bir ayaktan bakım sistemi varsa ve 24-72 saatte göğüs ultrasonu veya akciğer grafisiyle kontrol planlanmışsa, iğne aspirasyonuna veya tek yönlü valfli mini göğüs tübüne dayalı ayaktan yönetim önerilir.",
        ["J93.1", "J93.11"], specialties=["pulmonology"]))
    S.append(_s("gs_splf2023_psp_emergency_decompression", "splf23",
        "In a pneumothorax patient with signs of immediate severity, perform emergency chest decompression through an anterior (mid-clavicular line in the 2nd intercostal space) or axillary (mid-axillary line in the 4th intercostal space) approach, using dedicated equipment (thoracentesis kit) or any other needle aspiration device available to the operator.",
        "Acil ciddiyet bulguları olan pnömotorakslı hastada, anterior (2. interkostal aralıkta midklaviküler hat) veya aksiller (4. interkostal aralıkta midaksiller hat) yaklaşımla, özel ekipman (torasentez seti) veya uygulayıcının elindeki herhangi bir iğne aspirasyon aracıyla acil göğüs dekompresyonu yapın.",
        ["J93.0", "J93.1"], specialties=["pulmonology"]))
    S.append(_s("gs_wses2025_tension_ptx", "wses25ptx",
        "Tension pneumothorax is a life-threatening emergency: the progressive increase in intrathoracic pressure displaces the mediastinum towards the opposite side, leading to reduced venous return to the heart and resulting in hemodynamic instability; immediate needle decompression is the first line of treatment, aiming to convert the tension into a simple pneumothorax, followed by insertion of an intercostal chest drain as the definitive treatment.",
        "Tansiyon pnömotoraks yaşamı tehdit eden bir acildir: intratorasik basıncın ilerleyici artışı mediasteni karşı tarafa iter, kalbe venöz dönüşü azaltır ve hemodinamik instabiliteye yol açar; birinci basamak tedavi, tansiyonu basit pnömotoraksa çevirmeyi amaçlayan hemen iğne dekompresyonudur; ardından kesin tedavi olarak interkostal göğüs dreni yerleştirilir.",
        ["J93.0"], specialties=["pulmonology"]))

    # ---- Appendicitis (WSES 2020) -----------------------------------------
    APPY = ["K35.80", "K35.2", "K35.3", "R10.4"]
    S.append(_s("gs_wses2020_appy_scores", "wses20appy",
        "We recommend the use of clinical scores to exclude acute appendicitis and identify intermediate-risk patients needing imaging diagnostics; the AIR score and Adult Appendicitis Score are recommended as clinical predictors of acute appendicitis, and an Alvarado cutoff score of less than 5 is sufficiently sensitive to exclude acute appendicitis.",
        "Akut apandisiti dışlamak ve görüntüleme gereken orta riskli hastaları belirlemek için klinik skorların kullanılmasını öneriyoruz; AIR skoru ve Erişkin Apandisit Skoru akut apandisitin klinik öngördürücüleri olarak önerilir ve 5'in altında bir Alvarado kesim değeri akut apandisiti dışlamak için yeterince duyarlıdır.",
        APPY, specialties=["gastroenterology"]))
    S.append(_s("gs_wses2020_appy_tailored", "wses20appy",
        "We recommend adopting a tailored individualized diagnostic approach for stratifying the risk and disease probability and planning an appropriate stepwise diagnostic pathway in patients with suspected acute appendicitis, depending on age, sex, and clinical signs and symptoms of the patient; we suggest not making the diagnosis of acute appendicitis in pregnant patients on clinical grounds alone.",
        "Şüpheli akut apandisitli hastalarda yaş, cinsiyet ve klinik belirti ve bulgulara göre riski ve hastalık olasılığını sınıflandırmak ve uygun kademeli bir tanı yolağı planlamak için bireyselleştirilmiş bir tanısal yaklaşım benimsenmesini öneriyoruz; gebe hastalarda akut apandisit tanısının yalnızca klinik temelde konmamasını öneriyoruz.",
        APPY, specialties=["gastroenterology"]))
    S.append(_s("gs_wses2020_appy_nom", "wses20appy",
        "We recommend discussing non-operative management with antibiotics as a safe alternative to surgery in selected patients with uncomplicated acute appendicitis and absence of appendicolith, advising of the possibility of failure and misdiagnosing complicated appendicitis; patients who wish to avoid surgery must be aware of a risk of recurrence of up to 39% after 5 years.",
        "Apendikoliti olmayan seçilmiş komplike olmayan akut apandisit hastalarında, başarısızlık ve komplike apandisitin gözden kaçma olasılığı konusunda bilgilendirerek, antibiyotikle non-operatif yönetimin cerrahiye güvenli bir alternatif olarak tartışılmasını öneriyoruz; cerrahiden kaçınmak isteyen hastalar 5 yıl sonra %39'a varan nüks riskinin farkında olmalıdır.",
        APPY, specialties=["gastroenterology"]))
    S.append(_s("gs_wses2020_appy_laparoscopic", "wses20appy",
        "Current evidence shows laparoscopic appendectomy to be the most effective surgical treatment, being associated with a lower incidence of wound infection and post-intervention morbidity, shorter hospital stay, and better quality of life scores when compared to open appendectomy.",
        "Güncel kanıtlar laparoskopik apendektominin en etkili cerrahi tedavi olduğunu göstermektedir; açık apendektomiye kıyasla daha düşük yara enfeksiyonu ve girişim sonrası morbidite, daha kısa hastanede kalış ve daha iyi yaşam kalitesi skorlarıyla ilişkilidir.",
        APPY, specialties=["gastroenterology"]))

    # ---- Cholecystitis (WSES 2020) ----------------------------------------
    ACC = ["K81.0", "K80.20", "K83.09"]
    S.append(_s("gs_wses2020_acc_ultrasound", "wses20acc",
        "We recommend the use of abdominal ultrasound as the preferred initial imaging technique for suspected acute calculous cholecystitis, in view of its cost-effectiveness, wide availability, reduced invasiveness and good accuracy for gallstones disease.",
        "Şüpheli akut kalküloz kolesistitte maliyet etkinliği, yaygın erişilebilirliği, düşük invazivliği ve safra taşı hastalığındaki iyi doğruluğu nedeniyle tercih edilen ilk görüntüleme yöntemi olarak karın ultrasonunu öneriyoruz.",
        ACC, specialties=["gastroenterology"]))
    S.append(_s("gs_wses2020_acc_elc", "wses20acc",
        "In the presence of adequate surgical expertise, we recommend early laparoscopic cholecystectomy be performed as soon as possible, within 7 days from hospital admission and within 10 days from the onset of symptoms.",
        "Yeterli cerrahi deneyim varsa erken laparoskopik kolesistektominin mümkün olan en kısa sürede, hastaneye yatıştan sonraki 7 gün ve semptom başlangıcından sonraki 10 gün içinde yapılmasını öneriyoruz.",
        ACC, specialties=["gastroenterology"]))
    S.append(_s("gs_wses2020_acc_lfts", "wses20acc",
        "We recommend against the use of elevated LFTs or bilirubin as the only method to identify common bile duct stones in patients with acute calculous cholecystitis, in which case we recommend performing further diagnostic tests.",
        "Akut kalküloz kolesistitli hastalarda ana safra kanalı taşlarını saptamak için tek yöntem olarak yüksek karaciğer fonksiyon testleri veya bilirubinin kullanılmasını önermiyoruz; bu durumda ileri tanısal testler yapılmasını öneriyoruz.",
        ACC, specialties=["gastroenterology"]))
    S.append(_s("gs_wses2020_acc_nom", "wses20acc",
        "We suggest considering non-operative management, that is best medical therapy with antibiotics and observation, for patients refusing surgery or those who are not suitable for surgery; in uncomplicated acute calculous cholecystitis we recommend against the routine use of postoperative antibiotics when the focus of infection is controlled by cholecystectomy.",
        "Cerrahiyi reddeden veya cerrahiye uygun olmayan hastalarda non-operatif yönetimi, yani antibiyotik ve gözlemle en iyi medikal tedaviyi değerlendirmeyi öneriyoruz; komplike olmayan akut kalküloz kolesistitte enfeksiyon odağı kolesistektomiyle kontrol altına alındığında rutin postoperatif antibiyotik kullanımını önermiyoruz.",
        ACC, specialties=["gastroenterology"]))

    # ---- Pancreatitis (NICE NG104, WSES 2019) -----------------------------
    S.append(_s("gs_nice_ng104_panc_cause", "ng104",
        "Do not assume that a person's acute pancreatitis is alcohol-related just because they drink alcohol; if gallstones and alcohol have been excluded as potential causes, investigate other possible causes such as metabolic causes (such as hypercalcaemia or hyperlipidaemia), prescription drugs, microlithiasis, hereditary causes, autoimmune pancreatitis, ampullary or pancreatic tumours and anatomical anomalies.",
        "Bir kişinin akut pankreatitinin yalnızca alkol kullandığı için alkole bağlı olduğunu varsaymayın; safra taşı ve alkol olası nedenler olarak dışlanmışsa metabolik nedenler (hiperkalsemi veya hiperlipidemi gibi), reçeteli ilaçlar, mikrolitiyazis, kalıtsal nedenler, otoimmün pankreatit, ampuller veya pankreas tümörleri ve anatomik anomaliler gibi diğer olası nedenleri araştırın.",
        ["K85.9"], specialties=["gastroenterology"]))
    S.append(_s("gs_nice_ng104_panc_abx_nutrition", "ng104",
        "Do not offer prophylactic antimicrobials to people with acute pancreatitis; ensure that people with acute pancreatitis are not made nil-by-mouth and do not have food withheld unless there is a clear reason, and offer enteral nutrition to anyone with severe or moderately severe acute pancreatitis, starting within 72 hours of presentation.",
        "Akut pankreatitli hastalara profilaktik antimikrobiyal vermeyin; açık bir neden yoksa akut pankreatitli hastaların ağızdan beslenmesini kesmeyin ve gıdayı esirgemeyin; ağır veya orta-ağır akut pankreatitli herkese başvurudan sonraki 72 saat içinde başlanan enteral beslenme önerin.",
        ["K85.9"], specialties=["gastroenterology"]))
    S.append(_s("gs_wses2019_panc_diagnosis", "wses19panc",
        "The diagnosis of acute pancreatitis requires at least the presence of two of the three following criteria: abdominal pain consistent with the disease, biochemical evidence of pancreatitis (serum amylase and/or lipase greater than three times the upper limit of normal), and characteristic findings from abdominal imaging.",
        "Akut pankreatit tanısı için şu üç kriterden en az ikisi bulunmalıdır: hastalıkla uyumlu karın ağrısı, pankreatitin biyokimyasal kanıtı (serum amilaz ve/veya lipazın normal üst sınırın üç katından fazla olması) ve karın görüntülemesinde karakteristik bulgular.",
        ["K85.9"], specialties=["gastroenterology"]))

    # ---- Upper GI bleed (NICE CG141) --------------------------------------
    UGIB = ["K92.2", "K92.0", "K92.1", "I85.01"]
    S.append(_s("gs_nice_cg141_scores", "cg141",
        "Use the following formal risk assessment scores for all patients with acute upper gastrointestinal bleeding: the Blatchford score at first assessment, and the full Rockall score after endoscopy; consider early discharge for patients with a pre-endoscopy Blatchford score of 0.",
        "Akut üst gastrointestinal kanamalı tüm hastalarda şu formal risk değerlendirme skorlarını kullanın: ilk değerlendirmede Blatchford skoru ve endoskopi sonrasında tam Rockall skoru; endoskopi öncesi Blatchford skoru 0 olan hastalarda erken taburculuğu değerlendirin.",
        UGIB, specialties=["gastroenterology"]))
    S.append(_s("gs_nice_cg141_endoscopy_timing", "cg141",
        "Offer endoscopy to unstable patients with severe acute upper gastrointestinal bleeding immediately after resuscitation, and offer endoscopy within 24 hours of admission to all other patients with upper gastrointestinal bleeding.",
        "Ağır akut üst gastrointestinal kanamalı instabil hastalara resüsitasyondan hemen sonra endoskopi önerin; üst gastrointestinal kanamalı diğer tüm hastalara yatıştan sonraki 24 saat içinde endoskopi önerin.",
        UGIB, specialties=["gastroenterology"]))
    S.append(_s("gs_nice_cg141_transfusion_ppi", "cg141",
        "Transfuse patients with massive bleeding with blood, platelets and clotting factors in line with local protocols for managing massive bleeding, and base decisions on blood transfusion on the full clinical picture, recognising that over-transfusion may be as damaging as under-transfusion; do not offer acid-suppression drugs (proton pump inhibitors or H2-receptor antagonists) before endoscopy to patients with suspected non-variceal upper gastrointestinal bleeding.",
        "Masif kanamalı hastaları yerel masif kanama protokollerine uygun olarak kan, trombosit ve koagülasyon faktörleriyle transfüze edin; transfüzyon kararlarını, aşırı transfüzyonun yetersiz transfüzyon kadar zararlı olabileceğini bilerek tam klinik tabloya dayandırın; şüpheli varis dışı üst gastrointestinal kanamada endoskopi öncesinde asit baskılayıcı ilaç (proton pompa inhibitörü veya H2 reseptör antagonisti) vermeyin.",
        UGIB, specialties=["gastroenterology"]))
    S.append(_s("gs_nice_cg141_terlipressin", "cg141",
        "Offer terlipressin to patients with suspected variceal bleeding at presentation, and stop treatment after definitive haemostasis has been achieved, or after 5 days, unless there is another indication for its use.",
        "Başvuruda şüpheli varis kanaması olan hastalara terlipressin önerin ve başka bir endikasyon yoksa kesin hemostaz sağlandıktan sonra veya 5 gün sonra tedaviyi kesin.",
        ["I85.01", "K92.2"], specialties=["gastroenterology"]))

    # ---- AKI and hyperkalaemia (NICE NG148, UKKA 2020) --------------------
    S.append(_s("gs_nice_ng148_detect", "ng148",
        "Investigate for acute kidney injury, by measuring serum creatinine and comparing with baseline, in adults with acute illness if any of the following are likely or present: chronic kidney disease, heart failure, liver disease, diabetes, history of acute kidney injury, oliguria, hypovolaemia, use of drugs that can cause or exacerbate kidney injury (such as NSAIDs, aminoglycosides, ACE inhibitors, ARBs and diuretics) within the past week, iodine-based contrast media within the past week, urological obstruction, sepsis, deteriorating early warning scores or age 65 years or over.",
        "Akut hastalığı olan erişkinlerde şunlardan herhangi biri varsa veya olasıysa serum kreatinini ölçüp bazal değerle karşılaştırarak akut böbrek hasarını araştırın: kronik böbrek hastalığı, kalp yetersizliği, karaciğer hastalığı, diyabet, akut böbrek hasarı öyküsü, oligüri, hipovolemi, son bir hafta içinde böbrek hasarına yol açabilen veya kötüleştirebilen ilaç kullanımı (NSAİİ, aminoglikozid, ACE inhibitörü, ARB ve diüretik gibi), son bir hafta içinde iyotlu kontrast madde, ürolojik obstrüksiyon, sepsis, kötüleşen erken uyarı skorları veya 65 yaş ve üzeri.",
        ["N17.9"], specialties=["renal"]))
    # Split in two (dipstick and pyonephrosis; unexplained AKI) so every number sits in one passage.
    S.append(_s("gs_nice_ng148_urinalysis", "ng148",
        "Perform urine dipstick testing for blood, protein, leucocytes, nitrites and glucose in all people as soon as acute kidney injury is suspected or detected, and when pyonephrosis is suspected offer immediate ultrasound of the urinary tract (to be performed within 6 hours of assessment).",
        "Akut böbrek hasarından şüphelenildiği veya saptandığı anda herkeste kan, protein, lökosit, nitrit ve glukoz için idrar çubuk testi yapın ve piyonefroz şüphesinde hemen (değerlendirmeden sonraki 6 saat içinde) üriner sistem ultrasonu önerin.",
        ["N17.9"], specialties=["renal"]))
    S.append(_s("gs_nice_ng148_us_24h", "ng148",
        "When people with acute kidney injury have no identified cause or are at risk of urinary tract obstruction, offer urgent ultrasound of the urinary tract (to be performed within 24 hours of assessment).",
        "Nedeni saptanamayan veya üriner sistem obstrüksiyonu riski olan akut böbrek hasarlı kişilere acil (değerlendirmeden sonraki 24 saat içinde) üriner sistem ultrasonu önerin.",
        ["N17.9"], specialties=["renal"]))
    S.append(_s("gs_nice_ng148_rrt", "ng148",
        "Refer adults immediately for renal replacement therapy if any of the following are not responding to medical management: hyperkalaemia, metabolic acidosis, symptoms or complications of uraemia (for example, pericarditis or encephalopathy), fluid overload or pulmonary oedema; base the decision to start renal replacement therapy on the condition of the person as a whole and not on an isolated urea, creatinine or potassium value.",
        "Şunlardan herhangi biri medikal tedaviye yanıt vermiyorsa erişkinleri hemen renal replasman tedavisine yönlendirin: hiperkalemi, metabolik asidoz, üremi semptomları veya komplikasyonları (örneğin perikardit veya ensefalopati), sıvı yüklenmesi veya pulmoner ödem; renal replasman tedavisine başlama kararını tek bir üre, kreatinin veya potasyum değerine değil kişinin genel durumuna dayandırın.",
        ["N17.9", "E87.5"], specialties=["renal"]))
    HYPK = ["E87.5", "N18.6", "N17.9"]
    S.append(_s("gs_ukka_hyperk_ecg_monitoring", "ukka20",
        "We recommend that all hospitalised patients with a serum potassium level of 6.0 mmol/L or more have an urgent 12-lead ECG performed and assessed for changes of hyperkalaemia, and a minimum of continuous 3-lead ECG monitoring for all patients with a serum potassium of 6.5 mmol/L or more, patients with features of hyperkalaemia on 12-lead ECG, and patients with a potassium of 6.0 to 6.4 mmol/L who are clinically unwell.",
        "Serum potasyumu 6,0 mmol/L veya üzerinde olan tüm hastanede yatan hastalarda acil 12 derivasyonlu EKG çekilip hiperkalemi değişiklikleri açısından değerlendirilmesini, serum potasyumu 6,5 mmol/L veya üzerinde olan, 12 derivasyonlu EKG'de hiperkalemi bulguları olan ve potasyumu 6,0-6,4 mmol/L olup klinik olarak kötü olan tüm hastalarda en az sürekli 3 derivasyonlu EKG izlemi yapılmasını öneriyoruz.",
        HYPK, specialties=["renal", "endocrine"]))
    S.append(_s("gs_ukka_hyperk_calcium", "ukka20",
        "Hyperkalaemia step 1, protect the heart: we recommend that intravenous calcium chloride or calcium gluconate, at an equivalent dose (6.8 mmol), is given to patients with hyperkalaemia in the presence of ECG evidence of hyperkalaemia.",
        "Hiperkalemi 1. adım, kalbi koru: EKG'de hiperkalemi kanıtı olan hiperkalemili hastalara eşdeğer dozda (6,8 mmol) intravenöz kalsiyum klorür veya kalsiyum glukonat verilmesini öneriyoruz.",
        HYPK, specialties=["renal", "endocrine"]))
    S.append(_s("gs_ukka_hyperk_insulin_salbutamol", "ukka20",
        "Hyperkalaemia step 2, shift potassium into cells: we recommend an insulin-glucose infusion (10 units soluble insulin in 25 g glucose) for severe hyperkalaemia (potassium 6.5 mmol/L or more), with nebulised salbutamol 10 to 20 mg as adjuvant therapy; salbutamol is not used as monotherapy in the treatment of severe hyperkalaemia.",
        "Hiperkalemi 2. adım, potasyumu hücre içine kaydır: ağır hiperkalemide (potasyum 6,5 mmol/L veya üzeri) insülin-glukoz infüzyonu (25 g glukoz içinde 10 ünite soluble insülin) ve yardımcı tedavi olarak 10-20 mg nebülize salbutamol öneriyoruz; ağır hiperkalemi tedavisinde salbutamol tek başına kullanılmaz.",
        HYPK, specialties=["renal", "endocrine"]))
    S.append(_s("gs_ukka_hyperk_poc", "ukka20",
        "We recommend that in emergencies the potassium level is measured from an arterial or venous blood sample using a point-of-care blood gas analyser whilst awaiting the results from a formal laboratory measurement, and that patients with severe hyperkalaemia (potassium 6.5 mmol/L or more) detected in the community are admitted for immediate assessment and treatment.",
        "Acil durumlarda formal laboratuvar sonucu beklenirken potasyumun arteriyel veya venöz kan örneğinden hasta başı kan gazı analizörüyle ölçülmesini ve toplumda saptanan ağır hiperkalemili (potasyum 6,5 mmol/L veya üzeri) hastaların hemen değerlendirme ve tedavi için yatırılmasını öneriyoruz.",
        HYPK, specialties=["renal", "endocrine"]))

    # ---- Toxicology (MHRA 2012, WHO) --------------------------------------
    PARA = ["T39.1X", "T39.1"]
    S.append(_s("gs_mhra2012_paracetamol_nomogram", "mhra12",
        "All patients with a timed plasma paracetamol level on or above a single treatment line joining points of 100 mg/L at 4 hours and 15 mg/L at 15 hours after ingestion should receive acetylcysteine based on the treatment nomogram, regardless of risk factors.",
        "Alımdan 4 saat sonra 100 mg/L ve 15 saat sonra 15 mg/L noktalarını birleştiren tek tedavi çizgisinin üzerinde veya üzerinde zamanlı plazma parasetamol düzeyi olan tüm hastalar, risk faktörlerinden bağımsız olarak tedavi nomogramına göre asetilsistein almalıdır.",
        PARA, specialties=["toxicology"]))
    S.append(_s("gs_mhra2012_paracetamol_staggered", "mhra12",
        "Where there is doubt over the timing of paracetamol ingestion, including when ingestion has occurred over a period of one hour or more (staggered overdose), acetylcysteine should be given without delay and the nomogram should not be used; intravenous acetylcysteine is virtually 100% effective in preventing liver damage when given within 8 hours of the overdose.",
        "Parasetamol alım zamanı konusunda şüphe varsa, alımın bir saat veya daha uzun bir süreye yayıldığı durumlar (kademeli aşırı doz) dâhil, asetilsistein gecikmeden verilmeli ve nomogram kullanılmamalıdır; intravenöz asetilsistein aşırı dozdan sonraki 8 saat içinde verildiğinde karaciğer hasarını önlemede neredeyse %100 etkilidir.",
        PARA, specialties=["toxicology"]))
    S.append(_s("gs_mhra2012_paracetamol_infusion", "mhra12",
        "Administer the initial dose of acetylcysteine as an infusion over 60 minutes to minimise the risk of common dose-related adverse reactions; hypersensitivity is no longer a contraindication to treatment with acetylcysteine.",
        "Sık görülen doza bağlı yan etki riskini en aza indirmek için asetilsisteinin başlangıç dozunu 60 dakikalık infüzyon olarak uygulayın; aşırı duyarlılık artık asetilsistein tedavisi için bir kontrendikasyon değildir.",
        PARA, specialties=["toxicology"]))
    OPI = ["T40.2X", "T40.1X", "T40.4X", "T40.60"]
    S.append(_s("gs_who_opioid_signs", "who_opioid",
        "Opioid use can lead to death due to the effects of opioids on the part of the brain which regulates breathing; an opioid overdose can be identified by a combination of three signs and symptoms: pinpoint pupils, unconsciousness and difficulties with breathing.",
        "Opioid kullanımı, opioidlerin beynin solunumu düzenleyen bölgesi üzerindeki etkileri nedeniyle ölüme yol açabilir; opioid aşırı dozu üç belirti ve bulgunun birleşimiyle tanınabilir: iğne ucu pupiller, bilinç kaybı ve solunum güçlüğü.",
        OPI, specialties=["toxicology"]))
    S.append(_s("gs_who_opioid_naloxone_bls", "who_opioid",
        "Death following opioid overdose is preventable if the person receives basic life support and the timely administration of the drug naloxone, an antidote to opioids that will reverse the effects of an opioid overdose if administered in time and has virtually no effect in people who have not taken opioids.",
        "Opioid aşırı dozunu izleyen ölüm, kişiye temel yaşam desteği verilir ve zamanında nalokson uygulanırsa önlenebilir; nalokson, zamanında uygulandığında opioid aşırı dozunun etkilerini geri çeviren ve opioid almamış kişilerde neredeyse hiç etkisi olmayan bir opioid antidotudur.",
        OPI, specialties=["toxicology"]))

    # ---- Status epilepticus (NICE NG217 ch.7) -----------------------------
    SE = ["G41.9", "R56.9"]
    S.append(_s("gs_nice_ng217_se_firstline", "ng217",
        "Provide resuscitation and immediate emergency treatment for people who have convulsive status epilepticus (seizures lasting 5 minutes or more); if there is no individualised emergency management plan, give a benzodiazepine (buccal midazolam or rectal diazepam) immediately as first-line treatment in the community, or use intravenous lorazepam if intravenous access and resuscitation facilities are immediately available.",
        "Konvülsif status epileptikusu (5 dakika veya daha uzun süren nöbet) olan kişilere resüsitasyon ve hemen acil tedavi uygulayın; bireyselleştirilmiş acil yönetim planı yoksa toplumda birinci basamak tedavi olarak hemen bir benzodiazepin (bukkal midazolam veya rektal diazepam) verin ya da intravenöz erişim ve resüsitasyon olanakları hemen mevcutsa intravenöz lorazepam kullanın.",
        SE, specialties=["neurology"]))
    S.append(_s("gs_nice_ng217_se_secondline", "ng217",
        "Give a second dose of benzodiazepine if the seizure does not stop within 5 to 10 minutes of the first dose; if convulsive status epilepticus does not respond to 2 doses of a benzodiazepine, give levetiracetam, phenytoin or sodium valproate intravenously as a second-line treatment, taking into account that levetiracetam may be quicker to administer and have fewer adverse effects than the alternative options.",
        "Nöbet ilk dozdan sonraki 5-10 dakika içinde durmazsa ikinci bir benzodiazepin dozu verin; konvülsif status epileptikus 2 benzodiazepin dozuna yanıt vermezse ikinci basamak tedavi olarak intravenöz levetirasetam, fenitoin veya sodyum valproat verin; levetirasetamın daha hızlı uygulanabileceğini ve diğer seçeneklere göre daha az yan etkisi olabileceğini göz önünde bulundurun.",
        SE, specialties=["neurology"]))
    S.append(_s("gs_nice_ng217_se_causes", "ng217",
        "Be aware of the possible underlying causes of status epilepticus, including hypoglycaemia, eclampsia and alcohol withdrawal, which may need to be treated with additional medication, and be alert to non-adherence to antiseizure medication; if convulsive status epilepticus does not respond to the second-line treatment options tried, consider phenobarbital or general anaesthesia under expert guidance.",
        "Status epileptikusun ek ilaç tedavisi gerektirebilen olası altta yatan nedenlerinin (hipoglisemi, eklampsi ve alkol yoksunluğu dâhil) farkında olun ve antinöbet ilaçlarına uyumsuzluğa karşı dikkatli olun; konvülsif status epileptikus denenen ikinci basamak seçeneklere yanıt vermezse uzman rehberliğinde fenobarbital veya genel anestezi düşünün.",
        SE, specialties=["neurology"]))

    # ---- PPH (NICE NG235, RCOG GTG52) -------------------------------------
    PPH = ["O72.1", "O72.0"]
    S.append(_s("gs_nice_ng235_pph_immediate", "ng235",
        "If a woman has a postpartum haemorrhage: call for help; give immediate clinical treatment: emptying of the bladder and uterine massage and uterotonic drugs and intravenous fluids and controlled cord traction if the placenta has not yet been delivered; continuously assess blood loss and the woman's condition, and identify the source of the bleeding.",
        "Bir kadında doğum sonu kanama varsa: yardım çağırın; hemen klinik tedavi uygulayın: mesaneyi boşaltma, uterin masaj, uterotonik ilaçlar, intravenöz sıvılar ve plasenta henüz doğmamışsa kontrollü kord traksiyonu; kan kaybını ve kadının durumunu sürekli değerlendirin ve kanamanın kaynağını belirleyin.",
        PPH, specialties=["obstetrics-gynecology"]))
    S.append(_s("gs_nice_ng235_pph_txa", "ng235",
        "In addition to uterotonic drugs, give tranexamic acid (1 g by intravenous injection over 10 minutes), and repeat if necessary after at least 30 minutes for managing continuing postpartum haemorrhage.",
        "Uterotonik ilaçlara ek olarak traneksamik asit verin (10 dakikada intravenöz enjeksiyonla 1 g) ve devam eden doğum sonu kanamanın yönetimi için gerekirse en az 30 dakika sonra tekrarlayın.",
        PPH, specialties=["obstetrics-gynecology"]))
    S.append(_s("gs_nice_ng235_pph_uterotonics", "ng235",
        "Uterotonic treatment of postpartum haemorrhage: oxytocin plus ergometrine by intramuscular injection (if contraindicated, give carboprost), or an oxytocin infusion as soon as intravenous access is available; carboprost intramuscular injection can be repeated at intervals not less than 15 minutes up to a maximum of 8 doses, or misoprostol 800 micrograms sublingually or rectally.",
        "Doğum sonu kanamada uterotonik tedavi: kas içi enjeksiyonla oksitosin ve ergometrin (kontrendikeyse karboprost verin) veya intravenöz erişim sağlanır sağlanmaz oksitosin infüzyonu; kas içi karboprost enjeksiyonu 15 dakikadan kısa olmayan aralıklarla en fazla 8 doza kadar tekrarlanabilir veya 800 mikrogram sublingual ya da rektal misoprostol.",
        PPH, specialties=["obstetrics-gynecology"]))
    S.append(_s("gs_rcog_gtg52_pph_definition", "rcog52",
        "The traditional definition of primary PPH is the loss of 500 ml or more of blood from the genital tract within 24 hours of the birth of a baby; PPH can be minor (500 to 1000 ml) or major (more than 1000 ml), and major could be divided to moderate (1000 to 2000 ml) or severe (more than 2000 ml).",
        "Primer doğum sonu kanamanın geleneksel tanımı, bebeğin doğumundan sonraki 24 saat içinde genital kanaldan 500 ml veya daha fazla kan kaybıdır; PPH minör (500-1000 ml) veya majör (1000 ml'den fazla) olabilir ve majör, orta (1000-2000 ml) veya ağır (2000 ml'den fazla) olarak ayrılabilir.",
        PPH, specialties=["obstetrics-gynecology"]))

    # ---- Ectopic pregnancy (NICE NG126) -----------------------------------
    ECT = ["O00.90", "O00.1", "O00.10"]
    S.append(_s("gs_nice_ng126_ectopic_pregnancy_test", "ng126sx",
        "During clinical assessment of women of reproductive age, be aware that they may be pregnant, and think about offering a pregnancy test even when symptoms are non-specific, and that the symptoms and signs of ectopic pregnancy can resemble the common symptoms and signs of other conditions, for example gastrointestinal conditions or urinary tract infection.",
        "Üreme çağındaki kadınların klinik değerlendirmesinde gebe olabileceklerini göz önünde bulundurun, semptomlar özgül olmasa bile gebelik testi önermeyi düşünün ve ektopik gebeliğin belirti ve bulgularının gastrointestinal hastalıklar veya idrar yolu enfeksiyonu gibi diğer durumların sık görülen belirti ve bulgularına benzeyebileceğini unutmayın.",
        ECT, specialties=["obstetrics-gynecology"]))
    S.append(_s("gs_nice_ng126_ectopic_refer", "ng126sx",
        "Refer women who are haemodynamically unstable, or in whom there is significant concern about the degree of pain or bleeding, directly to A&E; refer immediately to an early pregnancy assessment service (or out-of-hours gynaecology service) women with a positive pregnancy test and pain and abdominal tenderness, pelvic tenderness, or cervical motion tenderness on examination.",
        "Hemodinamik olarak instabil olan veya ağrı ya da kanamanın derecesi konusunda ciddi kaygı duyulan kadınları doğrudan acil servise yönlendirin; gebelik testi pozitif olup muayenede ağrı ve karın hassasiyeti, pelvik hassasiyet veya servikal hareket hassasiyeti bulunan kadınları hemen erken gebelik değerlendirme servisine (veya mesai dışı jinekoloji servisine) yönlendirin.",
        ECT, specialties=["obstetrics-gynecology"]))
    S.append(_s("gs_nice_ng126_ectopic_symptoms", "ng126sx",
        "Be aware that atypical presentation for ectopic pregnancy is common; symptoms include common symptoms of abdominal or pelvic pain, amenorrhoea or missed period, and vaginal bleeding with or without clots, and other reported symptoms such as breast tenderness, gastrointestinal symptoms, dizziness, fainting or syncope, shoulder tip pain, urinary symptoms, passage of tissue, and rectal pressure or pain on defecation.",
        "Ektopik gebelikte atipik başvurunun sık olduğunu unutmayın; semptomlar sık görülen karın veya pelvik ağrı, amenore ya da gecikmiş adet ve pıhtılı veya pıhtısız vajinal kanama ile meme hassasiyeti, gastrointestinal semptomlar, baş dönmesi, bayılma veya senkop, omuz ucu ağrısı, üriner semptomlar, doku düşürme ve rektal baskı ya da dışkılamada ağrı gibi diğer bildirilen semptomları içerir.",
        ECT, specialties=["obstetrics-gynecology"]))
    S.append(_s("gs_nice_ng126_ectopic_methotrexate", "ng126mg",
        "Offer systemic methotrexate to women who have no significant pain and an unruptured tubal ectopic pregnancy with an adnexal mass smaller than 35 mm with no visible heartbeat, a serum hCG level less than 1,500 IU/litre, no intrauterine pregnancy on ultrasound and who are able to return for follow-up; when surgical treatment is indicated it should be performed laparoscopically whenever possible.",
        "Anlamlı ağrısı olmayan, rüptüre olmamış tubal ektopik gebeliği 35 mm'den küçük ve kalp atımı görülmeyen adneksiyal kitleyle birlikte olan, serum hCG düzeyi 1.500 IU/litrenin altında, ultrasonda intrauterin gebelik bulunmayan ve izleme gelebilecek kadınlara sistemik metotreksat önerin; cerrahi tedavi endikeyse mümkün olduğunda laparoskopik yapılmalıdır.",
        ECT, specialties=["obstetrics-gynecology"]))

    # ---- Psychiatric emergencies (NICE CG113, NG225, NG10) ----------------
    PANIC = ["F41.0", "F41.1", "R07.4"]
    S.append(_s("gs_nice_cg113_panic_ae", "cg113",
        "If a person presents in A&E, or other settings, with a panic attack, they should: be asked if they are already receiving treatment for panic disorder; undergo the minimum investigations necessary to exclude acute physical problems; not usually be admitted to a medical or psychiatric bed; and be referred to primary care for subsequent care.",
        "Bir kişi acil servise veya başka bir ortama panik atakla başvurursa: panik bozukluğu için zaten tedavi alıyor mu diye sorulmalı; akut fiziksel sorunları dışlamak için gerekli en az tetkikler yapılmalı; genellikle tıbbi veya psikiyatrik yatağa yatırılmamalı; ve sonraki bakım için birinci basamağa yönlendirilmelidir.",
        PANIC, specialties=["psychiatry"]))
    S.append(_s("gs_nice_cg113_panic_benzo", "cg113",
        "Benzodiazepines are associated with a less good outcome in the long term and should not be prescribed for the treatment of individuals with panic disorder; sedating antihistamines or antipsychotics should not be prescribed for the treatment of panic disorder.",
        "Benzodiazepinler uzun dönemde daha kötü sonuçla ilişkilidir ve panik bozukluğu olan bireylerin tedavisi için reçete edilmemelidir; sedatif antihistaminikler veya antipsikotikler panik bozukluğunun tedavisi için reçete edilmemelidir.",
        PANIC, specialties=["psychiatry"]))
    S.append(_s("gs_nice_cg113_panic_chest_pain", "cg113",
        "A panic attack does not necessarily constitute a panic disorder, and appropriate treatment of a panic attack may limit the development of panic disorder; for people who present with chest pain at A&E services there appears to be a greater likelihood of the cause being panic disorder if coronary artery disease is not present or the person is female or relatively young.",
        "Bir panik atak mutlaka panik bozukluğu anlamına gelmez ve panik atağın uygun tedavisi panik bozukluğunun gelişimini sınırlayabilir; acil servise göğüs ağrısıyla başvuranlarda koroner arter hastalığı yoksa ya da kişi kadın veya görece gençse nedenin panik bozukluğu olma olasılığı daha yüksek görünmektedir.",
        PANIC, specialties=["psychiatry"]))
    SH = ["R45.851", "T14.91", "X60"]
    S.append(_s("gs_nice_ng225_selfharm_ed", "ng225",
        "When a person presents to a healthcare professional following an episode of self-harm, establish as soon as possible: the severity of the injury and how urgently medical treatment is needed, the person's emotional and mental state and level of distress, whether there is immediate concern about the person's safety, whether there are any safeguarding concerns, the appropriate nursing observation level, and if there is a need to refer the person to a specialist mental health service for assessment.",
        "Bir kişi kendine zarar verme epizodu sonrasında bir sağlık profesyoneline başvurduğunda en kısa sürede şunları belirleyin: yaralanmanın ciddiyeti ve tıbbi tedavinin ne kadar acil gerektiği, kişinin duygusal ve ruhsal durumu ile sıkıntı düzeyi, kişinin güvenliğiyle ilgili acil bir kaygı olup olmadığı, koruma gerektiren bir durum olup olmadığı, uygun hemşirelik gözlem düzeyi ve kişinin değerlendirme için uzman ruh sağlığı servisine sevk gereksinimi.",
        SH, specialties=["psychiatry"]))
    S.append(_s("gs_nice_ng225_selfharm_means_concurrent", "ng225",
        "Establish the means of self-harm and, if accessible to the person, discuss removing this with therapeutic collaboration or negotiation to keep the person safe; carry out concurrent physical healthcare and the psychosocial assessment as soon as possible after a self-harm episode, and do not delay the psychosocial assessment until after medical treatment is completed.",
        "Kendine zarar verme aracını belirleyin ve kişi erişebiliyorsa güvenliğini korumak için terapötik iş birliği veya müzakereyle bunun uzaklaştırılmasını görüşün; kendine zarar verme epizodundan sonra en kısa sürede fiziksel sağlık bakımı ile psikososyal değerlendirmeyi eş zamanlı yürütün ve psikososyal değerlendirmeyi tıbbi tedavi tamamlanana kadar ertelemeyin.",
        SH, specialties=["psychiatry"]))
    S.append(_s("gs_nice_ng225_selfharm_no_risk_tools", "ng225",
        "Do not use risk assessment tools and scales to predict future suicide or repetition of self-harm, or to determine who should and should not be offered treatment or who should be discharged; do not use global risk stratification into low, medium or high risk to predict future suicide or repetition of self-harm.",
        "Gelecekteki intiharı veya kendine zarar vermenin tekrarını öngörmek ya da kime tedavi önerilip önerilmeyeceğini veya kimin taburcu edileceğini belirlemek için risk değerlendirme araç ve ölçeklerini kullanmayın; gelecekteki intiharı veya tekrarı öngörmek için düşük, orta veya yüksek risk şeklinde küresel risk sınıflamasını kullanmayın.",
        SH, specialties=["psychiatry"]))
    AGIT = ["R45.1", "F29", "F31.2", "F20.9"]
    S.append(_s("gs_nice_ng10_rapid_tranq", "ng10",
        "Use either intramuscular lorazepam on its own or intramuscular haloperidol combined with intramuscular promethazine for rapid tranquillisation in adults; if there is insufficient information to guide the choice of medication, or the service user has not taken antipsychotic medication before, use intramuscular lorazepam; if there is evidence of cardiovascular disease, including a prolonged QT interval, or no electrocardiogram has been carried out, avoid intramuscular haloperidol combined with intramuscular promethazine and use intramuscular lorazepam instead.",
        "Erişkinlerde hızlı sakinleştirme için ya tek başına kas içi lorazepam ya da kas içi haloperidol ile kas içi prometazin kombinasyonu kullanın; ilaç seçimine rehberlik edecek yeterli bilgi yoksa veya kişi daha önce antipsikotik kullanmamışsa kas içi lorazepam kullanın; uzamış QT aralığı dâhil kardiyovasküler hastalık kanıtı varsa veya EKG çekilmemişse kas içi haloperidol ile prometazin kombinasyonundan kaçınıp kas içi lorazepam kullanın.",
        AGIT, specialties=["psychiatry"]))
    S.append(_s("gs_nice_ng10_rt_monitoring", "ng10",
        "After rapid tranquillisation, monitor side effects and the service user's pulse, blood pressure, respiratory rate, temperature, level of hydration and level of consciousness at least every hour until there are no further concerns about their physical health status, and every 15 minutes if the BNF maximum dose has been exceeded or the service user appears to be asleep or sedated, has taken illicit drugs or alcohol, or has a pre-existing physical health problem.",
        "Hızlı sakinleştirmeden sonra yan etkileri ile kişinin nabzını, kan basıncını, solunum sayısını, ateşini, hidrasyon düzeyini ve bilinç düzeyini fiziksel sağlık durumuyla ilgili kaygı kalmayana kadar en az saatte bir izleyin; BNF maksimum dozu aşılmışsa veya kişi uyuyor ya da sedatize görünüyorsa, yasa dışı madde veya alkol almışsa ya da önceden var olan bir fiziksel sağlık sorunu varsa 15 dakikada bir izleyin.",
        AGIT, specialties=["psychiatry"]))

    # ---- Aortic dissection (JCS 2020) -------------------------------------
    AAD = ["I71.0", "I71.00", "I71.01"]
    S.append(_s("gs_jcs2020_aad_pain", "jcs20",
        "The majority of patients with acute aortic dissection complain of intense pain in the chest or back during its onset, often described as severe pain that they have never experienced: a sharp and tearing pain characterized by a sudden onset; anterior chest pain is characteristic of Type A dissection, while back and abdominal pain is characteristic of Type B dissection, and the pain may migrate with the extension of the dissection.",
        "Akut aort diseksiyonlu hastaların çoğu başlangıçta göğüs veya sırtta yoğun ağrıdan yakınır; bu ağrı sıklıkla hiç yaşamadıkları şiddette, ani başlangıçlı, keskin ve yırtılma tarzında tanımlanır; ön göğüs ağrısı Tip A, sırt ve karın ağrısı Tip B diseksiyon için karakteristiktir ve ağrı diseksiyonun yayılımıyla yer değiştirebilir.",
        AAD, specialties=["cardiology"]))
    S.append(_s("gs_jcs2020_aad_assessment", "jcs20",
        "When acute aortic dissection is suspected, the physical findings and vital signs are promptly examined, including pulse palpation of the limbs and examination of heart murmur, and diagnostic imaging is performed immediately if the hemodynamics of the patient is stable; findings suggestive of dissection include laterality in the blood pressure, blood pressure differences between the upper and lower limbs, and pulse deficit.",
        "Akut aort diseksiyonundan şüphelenildiğinde, ekstremite nabızlarının palpasyonu ve kalp üfürümü muayenesi dâhil fizik bulgular ve vital bulgular hızla değerlendirilir ve hastanın hemodinamisi stabilse tanısal görüntüleme hemen yapılır; diseksiyonu düşündüren bulgular arasında kan basıncında taraf farkı, üst ve alt ekstremiteler arasında kan basıncı farkı ve nabız defisiti yer alır.",
        AAD, specialties=["cardiology"]))
    S.append(_s("gs_jcs2020_aad_ddimer_ct", "jcs20",
        "The sensitivity of an increase in the D-dimer level is high, becoming an opportunity to promote further investigation under a tentative diagnosis of dissection; findings such as pericardial fluid retention on transthoracic echocardiography, aortic valve insufficiency and enlargement of the Valsalva sinus suggest acute aortic dissection, and if acute dissection is suspected, diagnostic imaging such as contrast-enhanced CT should be performed.",
        "D-dimer yükselmesinin duyarlılığı yüksektir ve diseksiyon ön tanısıyla ileri incelemeyi tetikleyen bir fırsat oluşturur; transtorasik ekokardiyografide perikardiyal sıvı, aort kapak yetersizliği ve Valsalva sinüsünde genişleme gibi bulgular akut aort diseksiyonunu düşündürür ve akut diseksiyondan şüpheleniliyorsa kontrastlı BT gibi tanısal görüntüleme yapılmalıdır.",
        AAD, specialties=["cardiology"]))
    S.append(_s("gs_jcs2020_aad_bp_hr", "jcs20",
        "As initial treatment in the acute phase of aortic dissection, strict heart rate and blood pressure control is recommended: heart rate below 60/min and systolic blood pressure 100 to 120 mmHg; acute-phase patients should be transported to an institution where emergent invasive treatment (endovascular or open surgery) is possible.",
        "Aort diseksiyonunun akut fazında başlangıç tedavisi olarak sıkı kalp hızı ve kan basıncı kontrolü önerilir: kalp hızı 60/dk altında ve sistolik kan basıncı 100-120 mmHg; akut faz hastaları acil invaziv tedavinin (endovasküler veya açık cerrahi) mümkün olduğu bir kuruma nakledilmelidir.",
        AAD, specialties=["cardiology"]))
    S.append(_s("gs_jcs2020_aad_typeA_surgery", "jcs20",
        "It is recommended to perform urgent open surgery for patients with Stanford Type A aortic dissection with patent false lumen.",
        "Yalancı lümeni açık Stanford Tip A aort diseksiyonlu hastalarda acil açık cerrahi yapılması önerilir.",
        AAD, specialties=["cardiology"]))

    # ---- Meningitis (NICE NG240) ------------------------------------------
    MEN = ["G00.9", "A39.4", "A39.0"]
    S.append(_s("gs_nice_ng240_abx_1h", "ng240",
        "A senior clinical decision maker should perform an initial assessment and ensure that antibiotics start within 1 hour of the person with suspected bacterial meningitis arriving at hospital, and that blood tests and lumbar puncture are performed before starting antibiotics if it is safe to do so and will not cause a clinically significant delay to starting antibiotics.",
        "Kıdemli bir klinik karar verici ilk değerlendirmeyi yapmalı ve şüpheli bakteriyel menenjitli kişinin hastaneye varışından sonraki 1 saat içinde antibiyotiklerin başlanmasını, güvenliyse ve antibiyotik başlangıcında klinik olarak anlamlı gecikmeye yol açmayacaksa kan tetkikleri ve lomber ponksiyonun antibiyotiklerden önce yapılmasını sağlamalıdır.",
        MEN, specialties=["neurology", "infectious"]))
    S.append(_s("gs_nice_ng240_lp_imaging", "ng240",
        "Do not routinely perform neuroimaging before lumbar puncture; perform imaging if the person has risk factors for an evolving space-occupying lesion or symptoms or signs which might indicate raised intracranial pressure: new focal neurological features (including seizures or posturing), abnormal pupillary reactions, a Glasgow Coma Scale score of 9 or less, or a progressive and sustained or rapid fall in level of consciousness; do not perform a lumbar puncture until these factors have been resolved, and take bloods, give antibiotics and stabilise the person before imaging.",
        "Lomber ponksiyon öncesinde rutin nörogörüntüleme yapmayın; gelişen yer kaplayan lezyon için risk faktörleri veya kafa içi basınç artışını düşündürebilecek belirti ve bulgular varsa görüntüleme yapın: yeni fokal nörolojik bulgular (nöbet veya postür dâhil), anormal pupil yanıtları, Glasgow Koma Skalası skoru 9 veya altı ya da bilinç düzeyinde ilerleyici ve sürekli veya hızlı düşüş; bu faktörler çözülene kadar lomber ponksiyon yapmayın ve görüntülemeden önce kan alın, antibiyotik verin ve hastayı stabilize edin.",
        MEN, specialties=["neurology", "infectious"]))
    S.append(_s("gs_nice_ng240_dexamethasone", "ng240",
        "For people over 3 months with strongly suspected or confirmed bacterial meningitis, give intravenous dexamethasone; when the causative organism is found, continue dexamethasone if it is pneumococcus or Haemophilus influenzae type b and stop dexamethasone for all other organisms.",
        "3 aylıktan büyük, kuvvetle şüphelenilen veya doğrulanmış bakteriyel menenjitli kişilere intravenöz deksametazon verin; etken bulunduğunda pnömokok veya Haemophilus influenzae tip b ise deksametazona devam edin, diğer tüm etkenlerde deksametazonu kesin.",
        MEN, specialties=["neurology", "infectious"]))

    # ---- Alcohol withdrawal (NICE CG100) ----------------------------------
    ALC = ["F10.239", "F10.231"]
    S.append(_s("gs_nice_cg100_symptom_triggered", "cg100",
        "Follow a symptom-triggered regimen for drug treatment for people in acute alcohol withdrawal who are in hospital or in other settings where 24-hour assessment and monitoring are available; in people with delirium tremens, offer oral lorazepam as first-line treatment, and do not offer phenytoin to treat alcohol withdrawal seizures.",
        "Hastanede veya 24 saat değerlendirme ve izlemin mümkün olduğu diğer ortamlarda akut alkol yoksunluğundaki kişilerin ilaç tedavisinde semptom tetiklemeli bir rejim izleyin; deliryum tremensli kişilerde birinci basamak tedavi olarak oral lorazepam önerin ve alkol yoksunluğu nöbetlerini tedavi etmek için fenitoin vermeyin.",
        ALC, specialties=["psychiatry"]))
    S.append(_s("gs_nice_cg100_thiamine", "cg100",
        "Offer parenteral thiamine to people with suspected Wernicke's encephalopathy, maintaining a high level of suspicion for the possibility of Wernicke's encephalopathy particularly if the person is intoxicated; parenteral treatment should be given for a minimum of 5 days unless Wernicke's encephalopathy is excluded, in doses toward the upper end of the British National Formulary range.",
        "Şüpheli Wernicke ensefalopatisi olan kişilere parenteral tiamin verin ve özellikle kişi intoksike ise Wernicke ensefalopatisi olasılığına karşı yüksek şüphe düzeyini sürdürün; Wernicke ensefalopatisi dışlanmadıkça parenteral tedavi, İngiliz Ulusal Formüleri aralığının üst ucuna yakın dozlarda en az 5 gün verilmelidir.",
        ALC, specialties=["psychiatry"]))

    # ---- Infections (NICE CG151, NG111, NG141) ------------------------------
    S.append(_s("gs_nice_cg151_neutropenic", "cg151",
        "Treat suspected neutropenic sepsis as an acute medical emergency and offer empiric antibiotic therapy immediately: offer beta lactam monotherapy with piperacillin with tazobactam as initial empiric antibiotic therapy to patients who need intravenous treatment unless there are patient-specific or local microbiological contraindications, and include in the initial clinical assessment a full blood count, kidney and liver function tests, C-reactive protein, lactate and blood culture.",
        "Şüpheli nötropenik sepsisi akut tıbbi acil olarak ele alın ve hemen ampirik antibiyotik tedavisi önerin: hastaya özgü veya yerel mikrobiyolojik kontrendikasyon yoksa intravenöz tedavi gereken hastalara başlangıç ampirik tedavisi olarak piperasilin-tazobaktam ile beta laktam monoterapisi önerin ve ilk klinik değerlendirmeye tam kan sayımı, böbrek ve karaciğer fonksiyon testleri, C-reaktif protein, laktat ve kan kültürünü dâhil edin.",
        ["D70.9", "A41.9"], specialties=["hematology", "infectious"]))
    S.append(_s("gs_nice_ng111_msu", "ng111",
        "In people aged 16 years and over with acute pyelonephritis, obtain a midstream urine sample before antibiotics are taken and send for culture and susceptibility testing; offer an antibiotic, taking account of the severity of symptoms, the risk of developing complications, previous urine culture and susceptibility results and previous antibiotic use, and review the choice of antibiotic when results of urine cultures are available.",
        "Akut piyelonefritli 16 yaş ve üzeri kişilerde antibiyotik alınmadan önce orta akım idrar örneği alıp kültür ve duyarlılık testine gönderin; semptomların şiddetini, komplikasyon gelişme riskini, önceki idrar kültürü ve duyarlılık sonuçlarını ve önceki antibiyotik kullanımını göz önünde bulundurarak antibiyotik önerin ve idrar kültürü sonuçları çıktığında antibiyotik seçimini gözden geçirin.",
        ["N10", "N39.0"], specialties=["infectious", "renal"]))
    S.append(_s("gs_nice_ng141_marker", "ng141",
        "Before treating cellulitis or erysipelas, consider drawing around the extent of the infection with a single-use surgical marker pen to monitor progress, being aware that redness may be less visible on darker skin tones; offer an antibiotic, with flucloxacillin as the first-choice antibiotic for adults (500 mg to 1 g four times a day orally, or 1 g to 2 g four times a day intravenously, for 5 to 7 days).",
        "Selülit veya erizipeli tedavi etmeden önce ilerlemeyi izlemek için enfeksiyonun sınırını tek kullanımlık cerrahi kalemle çizmeyi düşünün; kızarıklığın koyu ten renginde daha az görünür olabileceğini unutmayın; erişkinlerde ilk tercih antibiyotik olarak flukloksasilin (5-7 gün boyunca günde dört kez 500 mg-1 g oral veya günde dört kez 1-2 g intravenöz) ile antibiyotik önerin.",
        ["L03.90", "L03.115"], specialties=["infectious"]))

    # ---- Renal colic (NICE NG118) -----------------------------------------
    S.append(_s("gs_nice_ng118_ct_nsaid", "ng118",
        "Offer urgent (within 24 hours of presentation) low-dose non-contrast CT to adults with suspected renal colic, and offer ultrasound instead of CT if a woman is pregnant; offer a non-steroidal anti-inflammatory drug (NSAID) by any route as first-line treatment, offer intravenous paracetamol if NSAIDs are contraindicated or are not giving sufficient pain relief, and do not offer antispasmodics.",
        "Şüpheli renal kolikli erişkinlere acil (başvurudan sonraki 24 saat içinde) düşük doz kontrastsız BT önerin; kadın gebeyse BT yerine ultrason önerin; birinci basamak tedavi olarak herhangi bir yoldan non-steroid antiinflamatuar ilaç (NSAİİ) önerin, NSAİİ kontrendike veya yetersizse intravenöz parasetamol önerin ve antispazmodik vermeyin.",
        ["N23", "N20.0", "N20.1"], specialties=["renal"]))

    # ---- Febrile families: acceptance test 2026-10-20 (D-11, D-17, D-24) ----
    # Each statement was written after reading the fetched source text; the
    # wording follows the source closely so the verifier can locate it.
    SEP_SOURCE = SEP + ["K83.09", "M00.9", "N73.9", "N10", "M72.6", "N41.0", "L03.90"]
    S.append(_s("gs_ssc21_source_control", "ssc21",
        "Adults with sepsis or septic shock should be rapidly evaluated for specific anatomical diagnoses or sources of infection that require emergent source control; for adults with a source of infection that requires source control, we suggest early source control, ideally within 6 hours of diagnosis of sepsis or septic shock.",
        "Sepsis veya septik şoklu erişkinler acil kaynak kontrolü gerektiren özgül anatomik tanılar veya enfeksiyon kaynakları açısından hızla değerlendirilmelidir; kaynak kontrolü gerektiren bir enfeksiyon kaynağı olan erişkinlerde, ideal olarak sepsis veya septik şok tanısından sonraki 6 saat içinde erken kaynak kontrolü öneriyoruz.",
        SEP_SOURCE, specialties=["sepsis", "surgery"]))
    S.append(_s("gs_nice_ng110_abx_msu", "ng110",
        "Offer an antibiotic to people with acute prostatitis, taking account of the severity of symptoms, the risk of developing complications, previous urine culture and susceptibility results and previous antibiotic use; obtain a midstream urine sample before antibiotics are taken and send for culture and susceptibility testing.",
        "Akut prostatitli kişilere semptomların şiddetini, komplikasyon gelişme riskini, önceki idrar kültürü ve duyarlılık sonuçlarını ve önceki antibiyotik kullanımını göz önünde bulundurarak antibiyotik önerin; antibiyotik alınmadan önce orta akım idrar örneği alıp kültür ve duyarlılık testine gönderin.",
        ["N41.0"], specialties=["renal", "infectious"]))
    S.append(_s("gs_nice_ng110_refer", "ng110",
        "Refer people with acute prostatitis to hospital if they have any symptoms or signs suggesting a more serious illness or condition (for example sepsis, acute urinary retention or prostatic abscess), or their symptoms are not improving 48 hours after starting the antibiotic.",
        "Akut prostatitli kişileri daha ciddi bir hastalığı düşündüren belirti veya bulguları varsa (örneğin sepsis, akut idrar retansiyonu veya prostat apsesi) ya da antibiyotik başladıktan 48 saat sonra semptomları düzelmiyorsa hastaneye yönlendirin.",
        ["N41.0"], specialties=["renal", "infectious"]))
    S.append(_s("gs_cdc_pid_minimum_criteria", "cdc_pid",
        "Presumptive treatment for PID should be initiated for sexually active young women and other women at risk for STIs if they are experiencing pelvic or lower abdominal pain, if no cause for the illness other than PID can be identified, and if one or more of the following three minimum clinical criteria are present on pelvic examination: cervical motion tenderness, uterine tenderness, or adnexal tenderness.",
        "Pelvik veya alt karın ağrısı olan, PİH dışında hastalığın başka bir nedeni bulunamayan ve pelvik muayenede şu üç minimum klinik ölçütten bir veya daha fazlası bulunan cinsel olarak aktif genç kadınlarda ve CYBE riski taşıyan diğer kadınlarda PİH için varsayımsal tedavi başlatılmalıdır: servikal hareket hassasiyeti, uterus hassasiyeti veya adneksiyal hassasiyet.",
        ["N73.9", "N70.93"], specialties=["obgyn", "infectious"], countries=["US"]))
    S.append(_s("gs_cdc_pid_parenteral", "cdc_pid",
        "Recommended parenteral regimen for PID: ceftriaxone 1 g IV every 24 hours plus doxycycline 100 mg orally or IV every 12 hours plus metronidazole 500 mg orally or IV every 12 hours; because of the pain associated with IV infusion, doxycycline should be administered orally when possible.",
        "PİH için önerilen parenteral rejim: 24 saatte bir 1 g IV seftriakson artı 12 saatte bir ağızdan veya IV 100 mg doksisiklin artı 12 saatte bir ağızdan veya IV 500 mg metronidazol; IV infüzyonun ağrısı nedeniyle doksisiklin mümkün olduğunda ağızdan verilmelidir.",
        ["N73.9", "N70.93"], specialties=["obgyn", "infectious"], countries=["US"]))
    S.append(_s("gs_cdc_pid_alternative", "cdc_pid",
        "Alternative parenteral regimens for PID: ampicillin-sulbactam 3 g IV every 6 hours plus doxycycline 100 mg orally or IV every 12 hours, or clindamycin 900 mg IV every 8 hours plus gentamicin loading dose IV or IM (2 mg/kg body weight) followed by a maintenance dose; single daily dosing (3 to 5 mg/kg body weight) can be substituted.",
        "PİH için alternatif parenteral rejimler: 6 saatte bir 3 g IV ampisilin-sulbaktam artı 12 saatte bir ağızdan veya IV 100 mg doksisiklin ya da 8 saatte bir 900 mg IV klindamisin artı IV veya IM gentamisin yükleme dozu (2 mg/kg vücut ağırlığı) ve ardından idame dozu; günde tek doz (3-5 mg/kg vücut ağırlığı) uygulanabilir.",
        ["N73.9", "N70.93"], specialties=["obgyn", "infectious"], countries=["US"]))
    S.append(_s("gs_cdc_flu_oseltamivir", "cdc_flu",
        "Antiviral treatment is recommended as soon as possible for any patient with suspected or confirmed influenza who is hospitalized, has severe, complicated, or progressive illness, or is at higher risk for influenza complications; for hospitalized patients, initiation of antiviral treatment with oral or enterically administered oseltamivir is recommended as soon as possible.",
        "Şüpheli veya kesin influenzası olup hastaneye yatırılan, ağır, komplike veya ilerleyici hastalığı olan ya da influenza komplikasyonları açısından yüksek riskli her hastada antiviral tedavi mümkün olan en kısa sürede önerilir; hastanede yatan hastalarda ağızdan veya enteral yoldan oseltamivir ile antiviral tedavinin mümkün olan en kısa sürede başlatılması önerilir.",
        ["J10.1", "J11.1", "J09.X2"], specialties=["infectious", "respiratory"], countries=["US"]))
    S.append(_s("gs_nice_ng191_dexamethasone", "ng191t",
        "Offer dexamethasone, or either hydrocortisone or prednisolone when dexamethasone cannot be used or is unavailable, to people with COVID-19 who need supplemental oxygen to meet their prescribed oxygen saturation levels; the adult dosage is dexamethasone 6 mg orally or intravenously once a day for 10 days.",
        "Reçete edilen oksijen satürasyon düzeyine ulaşmak için ek oksijen gereken COVID-19'lu kişilere deksametazon, deksametazon kullanılamıyorsa veya yoksa hidrokortizon ya da prednizolon önerin; erişkin dozu 10 gün boyunca günde bir kez ağızdan veya intravenöz 6 mg deksametazondur.",
        ["U07.1"], specialties=["infectious", "respiratory"]))
    S.append(_s("gs_nice_ng191_no_antibiotics", "ng191c",
        "Do not offer an antibiotic for preventing or treating pneumonia if SARS-CoV-2, another virus, or a fungal infection, is likely to be the cause; antibiotics do not work on viruses, and inappropriate use may lead to Clostridioides difficile infection and antimicrobial resistance.",
        "SARS-CoV-2, başka bir virüs veya mantar enfeksiyonu olası neden ise pnömoniyi önlemek veya tedavi etmek için antibiyotik önermeyin; antibiyotikler virüslere etki etmez ve uygunsuz kullanım Clostridioides difficile enfeksiyonuna ve antimikrobiyal dirence yol açabilir.",
        ["U07.1", "J10.1", "J11.1"], specialties=["infectious", "respiratory"]))
    S.append(_s("gs_cdc_malaria_smears", "cdc_malaria",
        "Preliminary review of blood smears concerning for intracellular parasites or a positive RDT or NAAT is sufficient to initiate treatment; if RDT or NAAT is performed, microscopic evaluation of blood smears should also be performed concurrently, and if tests are negative but malaria is still suspected, repeat blood smears every 12 to 24 hours (total of 3 times).",
        "Hücre içi parazit açısından şüpheli kan yaymalarının ön incelemesi veya pozitif HTT ya da NAAT tedaviye başlamak için yeterlidir; HTT veya NAAT yapılırsa kan yaymalarının mikroskobik incelemesi de eş zamanlı yapılmalıdır ve testler negatif olduğu halde sıtma hâlâ düşünülüyorsa kan yaymaları 12-24 saatte bir (toplam 3 kez) tekrarlanmalıdır.",
        ["B54", "B50.9"], specialties=["infectious"], countries=["US"]))
    S.append(_s("gs_cdc_malaria_severe_artesunate", "cdc_malaria",
        "If the patient has severe malaria, regardless of species, begin intravenous artesunate; administer a full follow-on oral treatment course after the intravenous artesunate course is completed, if parasitemia is below 1% and the patient is able to tolerate oral medication.",
        "Hastada ağır sıtma varsa türden bağımsız olarak intravenöz artesunat başlayın; parazitemi %1'in altındaysa ve hasta ağızdan ilacı tolere edebiliyorsa intravenöz artesunat kürü tamamlandıktan sonra tam bir oral idame tedavisi verin.",
        ["B54", "B50.9", "B50.0"], specialties=["infectious"], countries=["US"]))
    S.append(_s("gs_nice_cg183_check_allergy", "cg183",
        "Check a person's drug allergy status and confirm it with them (or their family members or carers as appropriate) before prescribing, dispensing or administering any drug.",
        "Herhangi bir ilacı reçete etmeden, vermeden veya uygulamadan önce kişinin ilaç alerjisi durumunu kontrol edin ve kendisiyle (veya uygunsa aile üyeleri ya da bakım verenleriyle) doğrulayın.",
        ["Z88.0", "Z88.9"], specialties=["pharmacology"]))
    S.append(_s("gs_nice_ng197_what_matters", "ng197",
        "When discussing decisions about tests, treatments and interventions, do so in a way that encourages people to think about what matters to them, and to express their needs and preferences.",
        "Testler, tedaviler ve girişimlerle ilgili kararları, kişileri kendileri için neyin önemli olduğunu düşünmeye ve ihtiyaçlarını ve tercihlerini ifade etmeye teşvik edecek şekilde tartışın.",
        ["Z71.89"], specialties=["communication"]))
    S.append(_s("gs_nice_ng240_antibiotic_allergy", "ng240",
        "In people with an antibiotic allergy: ask about the reaction they get; give ceftriaxone if their reaction was not severe allergy; if their reaction was severe allergy, get advice from an infection specialist and consider chloramphenicol.",
        "Antibiyotik alerjisi olan kişilerde: oluşan reaksiyonu sorun; reaksiyon ağır alerji değilse seftriakson verin; reaksiyon ağır alerjiyse bir enfeksiyon uzmanından görüş alın ve kloramfenikolü düşünün.",
        MEN, specialties=["neurology", "infectious"]))
    S.append(_s("gs_nice_ng141_penicillin_allergy", "ng141",
        "Alternative first-choice antibiotics for cellulitis for penicillin allergy or if flucloxacillin is unsuitable (give orally unless person unable to take oral or severely unwell): clarithromycin 500 mg twice a day orally or 500 mg twice a day intravenously, erythromycin in pregnancy, or doxycycline 200 mg on the first day then 100 mg once a day orally.",
        "Penisilin alerjisinde veya flukloksasilin uygun değilse selülit için alternatif ilk tercih antibiyotikler (ağızdan alamıyorsa veya çok hasta değilse ağızdan verin): günde iki kez ağızdan 500 mg veya günde iki kez intravenöz 500 mg klaritromisin, gebelikte eritromisin ya da ilk gün 200 mg ardından günde bir kez ağızdan 100 mg doksisiklin.",
        ["L03.90", "L03.115"], specialties=["infectious"]))
    S.append(_s("gs_nice_ng250_penicillin_allergy", "ng250",
        "High-severity disease: alternative antibiotic for penicillin allergy (consult a local microbiologist if fluoroquinolone not appropriate) is levofloxacin 500 mg twice a day orally or intravenously for 5 days; low-severity disease: alternative oral antibiotics for penicillin allergy are doxycycline 200 mg on first day, then 100 mg once a day, or clarithromycin 500 mg twice a day for 5 days.",
        "Yüksek ağırlıkta hastalık: penisilin alerjisinde alternatif antibiyotik (florokinolon uygun değilse yerel mikrobiyoloğa danışın) 5 gün boyunca günde iki kez ağızdan veya intravenöz 500 mg levofloksasindir; düşük ağırlıkta hastalık: penisilin alerjisinde alternatif oral antibiyotikler ilk gün 200 mg ardından günde bir kez 100 mg doksisiklin veya 5 gün boyunca günde iki kez 500 mg klaritromisindir.",
        ["J18.9"], specialties=["respiratory", "infectious"]))
    S.append(_s("gs_nice_ng111_iv_choice", "ng111",
        "First-choice intravenous antibiotics for acute pyelonephritis in adults (if unable to take oral antibiotics or severely unwell; antibiotics may be combined if sepsis a concern): cefuroxime 750 mg to 1.5 g three or four times a day, ceftriaxone 1 g to 2 g once a day, or gentamicin initially 5 mg/kg to 7 mg/kg once a day, subsequent doses adjusted according to serum gentamicin concentration.",
        "Erişkinlerde akut piyelonefrit için ilk tercih intravenöz antibiyotikler (ağızdan antibiyotik alamıyorsa veya çok hastaysa; sepsis endişesi varsa antibiyotikler birleştirilebilir): günde üç veya dört kez 750 mg-1,5 g sefuroksim, günde bir kez 1-2 g seftriakson veya başlangıçta günde bir kez 5-7 mg/kg gentamisin, sonraki dozlar serum gentamisin düzeyine göre ayarlanır.",
        ["N10"], specialties=["infectious", "renal"]))

    return S


def by_id() -> Dict[str, GuidelineStatement]:
    return {s.id: s for s in open_statements()}


def describe() -> Dict[str, Any]:
    stmts = open_statements()
    return {"count": len(stmts), "sources": sorted({s.source_url for s in stmts})}
