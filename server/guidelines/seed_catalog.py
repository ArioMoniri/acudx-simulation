"""GuidelineStatement drafts that back the attending tips of the condition catalogue.

Scope: every ``server/condition_catalog`` entry that had no verified attending tip on
2026-10-21 (104 of 163). Each record was authored by the academician / MD reviewer after
reading the fetched source text, and it follows the rules of ``seed_open``:

  * ``source_url`` is the exact document (a NICE recommendations chapter, a guideline full
    text, an agency clinical page), never a homepage; ``fetch_url`` names the open-access
    mirror the verifier reads when the publisher page cannot be fetched headlessly
    (Europe PMC full-text XML for PMC articles);
  * ``statement_en`` stays close to the source wording so the lexical verifier can locate
    its supporting passage, and every number in it appears in that passage;
  * ``section`` records the recommendation number or the heading the statement rests on;
  * ``stages`` records the encounter stages whose tips cite the statement.

Records enter the store as ``draft``. ``server.guidelines.verifier`` promotes them to
``verified`` only when the passage is found; ``server.guidelines.crosscheck`` then re-fetches
each source and rejects a statement whose quote is not present verbatim or whose numbers
are not in the quote. Where no accessible source supported a statement it was not written:
see ``COVERAGE_GAPS`` in ``server/guidelines/tips_catalog.py``.
"""

from __future__ import annotations

from typing import Dict, List

from server.guidelines.store import GuidelineStatement

NICE = "NICE"
EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/{pmc}/fullTextXML"


def _nice(code: str, title: str, edition: str, chapter: str, published: str) -> Dict[str, str]:
    return dict(body=NICE, title=f"{title} ({code.upper()})", edition=edition,
                url=f"https://www.nice.org.uk/guidance/{code}/chapter/{chapter}", published=published,
                license="open", countries="UK")


SRC: Dict[str, Dict[str, str]] = {
    # ---- NICE ---------------------------------------------------------------
    "ng196": _nice("ng196", "Atrial fibrillation: diagnosis and management", "NG196, April 2021 (updated June 2021)",
                   "Recommendations", "2021-04-27"),
    "ng208": _nice("ng208", "Heart valve disease presenting in adults: investigation and management", "NG208, November 2021",
                   "Recommendations", "2021-11-17"),
    "cg187": _nice("cg187", "Acute heart failure: diagnosis and management", "CG187, October 2014 (updated November 2021)",
                   "Recommendations", "2014-10-08"),
    "ng136": _nice("ng136", "Hypertension in adults: diagnosis and management", "NG136, August 2019 (updated November 2023)",
                   "Recommendations", "2019-08-28"),
    "cg126": _nice("cg126", "Stable angina: management", "CG126, July 2011 (updated August 2016)",
                   "Recommendations", "2011-07-27"),
    "cg95": _nice("cg95", "Recent-onset chest pain of suspected cardiac origin: assessment and diagnosis",
                  "CG95, March 2010 (updated November 2016)", "Recommendations", "2010-03-24"),
    "cg109": _nice("cg109", "Transient loss of consciousness ('blackouts') in over 16s",
                   "CG109, August 2010 (updated November 2023)", "Recommendations", "2010-08-25"),
    # ---- Journals / societies (open full text) ------------------------------
    "jcs_ie26": dict(body="JCS", title="JCS 2026 Guideline on the Management of Infective Endocarditis",
                     edition="Circulation Journal 2026;90(8)", doi="10.1253/circj.CJ-25-0987",
                     url="https://www.jstage.jst.go.jp/article/circj/90/8/90_CJ-25-0987/_html/-char/en", published="2026-07-25"),
    "jcs_myo23": dict(body="JCS", title="JCS 2023 Guideline on the Diagnosis and Treatment of Myocarditis",
                      edition="Circulation Journal 2023;87(5):674-754", doi="10.1253/circj.CJ-22-0696",
                      url="https://www.jstage.jst.go.jp/article/circj/87/5/87_CJ-22-0696/_html/-char/en", published="2023-04-25"),
    "jcs_arr22": dict(body="JCS/JHRS", title="JCS/JHRS 2022 Guideline on Diagnosis and Risk Assessment of Arrhythmia",
                      edition="Circulation Journal 2024;88(9)", doi="10.1253/circj.CJ-22-0827",
                      url="https://www.jstage.jst.go.jp/article/circj/88/9/88_CJ-22-0827/_html/-char/en", published="2024-08-23"),
    "svt19": dict(body="Turkish Society of Cardiology (Anatol J Cardiol)",
                  title="Review of the 2019 European Society of Cardiology Guidelines for the management of patients with supraventricular tachycardia",
                  edition="Anatolian Journal of Cardiology 2019;22(Suppl 2)", doi="10.14744/AnatolJCardiol.2019.93507",
                  url="https://doi.org/10.14744/AnatolJCardiol.2019.93507", fetch=EPMC.format(pmc="PMC6955050"),
                  published="2019-10-01"),
    "costr20als": dict(body="ILCOR", title="Adult Advanced Life Support: 2020 International Consensus on Cardiopulmonary Resuscitation and Emergency Cardiovascular Care Science with Treatment Recommendations",
                       edition="Resuscitation 2020;156:A80-A119", doi="10.1016/j.resuscitation.2020.09.012",
                       url="https://doi.org/10.1016/j.resuscitation.2020.09.012", fetch=EPMC.format(pmc="PMC7576326"),
                       published="2020-10-21"),
    "costr23": dict(body="ILCOR", title="2023 International Consensus on Cardiopulmonary Resuscitation and Emergency Cardiovascular Care Science With Treatment Recommendations: Summary From the BLS; ALS; PLS; NLS; EIT; and First Aid Task Forces",
                    edition="Circulation 2023;148:e187-e280", doi="10.1161/CIR.0000000000001179",
                    url="https://doi.org/10.1161/CIR.0000000000001179", fetch=EPMC.format(pmc="PMC10713008"),
                    published="2023-11-09"),
}

# ---- Emergency medicine ------------------------------------------------------
SRC.update({
    "ng39": _nice("ng39", "Major trauma: assessment and initial management", "NG39, February 2016",
                  "Recommendations", "2016-02-17"),
    "ng158": _nice("ng158", "Venous thromboembolic diseases: diagnosis, management and thrombophilia testing",
                   "NG158, March 2020 (updated August 2023)", "Recommendations", "2020-03-26"),
    "ng253cs": _nice("ng253", "Suspected sepsis in people aged 16 or over: recognition, assessment and early management",
                     "NG253, November 2025", "Could-this-be-sepsis", "2025-11-19"),
    "ng253f2f": _nice("ng253", "Suspected sepsis in people aged 16 or over: recognition, assessment and early management",
                      "NG253, November 2025", "Face-to-face-assessment", "2025-11-19"),
    "ng253ab": _nice("ng253", "Suspected sepsis in people aged 16 or over: recognition, assessment and early management",
                     "NG253, November 2025", "Antibiotic-therapy-intravenous-fluid-and-oxygen", "2025-11-19"),
    "cdc_heat": dict(body="CDC (NIOSH)", title="Heat Stress: Heat-related Illnesses", edition="NIOSH workplace safety and health topic",
                     url="https://www.cdc.gov/niosh/heat-stress/about/illnesses.html", published="2024-06-05",
                     license="open", countries="US"),
    "heat_cn20": dict(body="PLA Professional Committee of Critical Care Medicine", title="Expert consensus on the diagnosis and treatment of heat stroke in China",
                      edition="Military Medical Research 2020;7:1", doi="10.1186/s40779-019-0229-2",
                      url="https://doi.org/10.1186/s40779-019-0229-2", fetch=EPMC.format(pmc="PMC6956553"),
                      published="2020-01-13", license="open"),
    "hypo21": dict(body="ICAR MedCom / ERC authors", title="Accidental Hypothermia: 2021 Update",
                   edition="International Journal of Environmental Research and Public Health 2022;19(1):501",
                   doi="10.3390/ijerph19010501", url="https://doi.org/10.3390/ijerph19010501",
                   fetch=EPMC.format(pmc="PMC8744717"), published="2022-01-04", license="open"),
    "trauma_eu23": dict(body="European Task Force for Advanced Bleeding Care in Trauma",
                        title="The European guideline on management of major bleeding and coagulopathy following trauma: sixth edition",
                        edition="Critical Care 2023;27:80", doi="10.1186/s13054-023-04327-7",
                        url="https://doi.org/10.1186/s13054-023-04327-7", fetch=EPMC.format(pmc="PMC9977110"),
                        published="2023-03-01", license="open"),
    "isccm_poison19": dict(body="ISCCM", title="Initial Management of Poisoned Patient",
                           edition="Indian Journal of Critical Care Medicine 2019;23(Suppl 4):S234-S240",
                           doi="10.5005/jp-journals-10071-23307", url="https://doi.org/10.5005/jp-journals-10071-23307",
                           fetch=EPMC.format(pmc="PMC6996652"), published="2019-12-01"),
    "barany_vasc22": dict(body="Bárány Society (ICVD)", title="Vascular vertigo and dizziness: Diagnostic criteria",
                          edition="Journal of Vestibular Research 2022;32(3):205-222", doi="10.3233/VES-210169",
                          url="https://doi.org/10.3233/VES-210169", fetch=EPMC.format(pmc="PMC9249306"),
                          published="2022-06-01", license="open"),
    "barany_auvp22": dict(body="Bárány Society (ICVD)", title="Acute unilateral vestibulopathy/vestibular neuritis: Diagnostic criteria",
                          edition="Journal of Vestibular Research 2022;32(5):389-406", doi="10.3233/VES-220201",
                          url="https://doi.org/10.3233/VES-220201", fetch=EPMC.format(pmc="PMC9661346"),
                          published="2022-09-01", license="open"),
})

# ---- Endocrinology -----------------------------------------------------------
SRC.update({
    "ng243": _nice("ng243", "Adrenal insufficiency: identification and management", "NG243, August 2024",
                   "Recommendations", "2024-08-28"),
    "ng28im": _nice("ng28", "Type 2 diabetes in adults: management", "NG28, December 2015 (updated 2026)",
                    "Initial-medicines", "2015-12-02"),
    "ng28bg": _nice("ng28", "Type 2 diabetes in adults: management", "NG28, December 2015 (updated 2026)",
                    "Blood-glucose-management", "2015-12-02"),
    "ng28ed": _nice("ng28", "Type 2 diabetes in adults: management", "NG28, December 2015 (updated 2026)",
                    "Education", "2015-12-02"),
    "ng145": _nice("ng145", "Thyroid disease: assessment and management", "NG145, November 2019 (updated October 2023)",
                   "Recommendations", "2019-11-20"),
    "jbds_hhs22": dict(body="JBDS-IP", title="The Management of the Hyperosmolar Hyperglycaemic State (HHS) in Adults (JBDS 06)",
                       edition="Revised 2022", published="2022-03-01", license="open",
                       url="https://abcd.care/sites/default/files/site_uploads/JBDS_Guidelines_Current/JBDS_06_The_Management_of_Hyperosmolar_Hyperglycaemic_State_HHS_%20in_Adults_FINAL_0.pdf"),
    "jbds_hypo23": dict(body="JBDS-IP", title="The Hospital Management of Hypoglycaemia in Adults with Diabetes Mellitus (JBDS 01)",
                        edition="Revised January 2023", published="2023-01-01", license="open",
                        url="https://abcd.care/sites/default/files/site_uploads/JBDS_Guidelines_Current/JBDS_01_Hypo_Guideline_with_QR_code_January_2023.pdf"),
    "sfe_ca16": dict(body="Society for Endocrinology", title="Society for Endocrinology Endocrine Emergency Guidance: Emergency management of acute hypercalcaemia in adult patients",
                     edition="Endocrine Connections 2016;5(5):G9-G11", doi="10.1530/EC-16-0055",
                     url="https://doi.org/10.1530/EC-16-0055", fetch=EPMC.format(pmc="PMC5314807"),
                     published="2016-09-01", license="open"),
    "sfe_na16": dict(body="Society for Endocrinology", title="Society for Endocrinology Endocrine Emergency Guidance: Emergency management of severe symptomatic hyponatraemia in adult patients",
                     edition="Endocrine Connections 2016;5(5):G4-G6", doi="10.1530/EC-16-0058",
                     url="https://doi.org/10.1530/EC-16-0058", fetch=EPMC.format(pmc="PMC5314809"),
                     published="2016-09-01", license="open"),
    "jes_pheo25": dict(body="Japan Endocrine Society", title="Japan Endocrine Society Clinical Practice Guideline for the Diagnosis and Management of Pheochromocytoma and Paraganglioma 2025",
                       edition="Endocrine Journal 2026", doi="10.1507/endocrj.EJ25-0165",
                       url="https://doi.org/10.1507/endocrj.EJ25-0165", fetch=EPMC.format(pmc="PMC12819074"),
                       published="2026-01-01", license="open"),
    "eta_storm26": dict(body="ETA / BTA / Society for Endocrinology / WEDS",
                        title="Management of thyroid emergencies: joint consensus statement on management of thyroid storm",
                        edition="European Thyroid Journal 2026", doi="10.1530/ETJ-26-0043",
                        url="https://doi.org/10.1530/ETJ-26-0043", fetch=EPMC.format(pmc="PMC13506520"),
                        published="2026-06-01", license="open"),
})

# ---- Gastroenterology --------------------------------------------------------
SRC.update({
    "ng147": _nice("ng147", "Diverticular disease: diagnosis and management", "NG147, November 2019 (updated 2024)",
                   "Recommendations", "2019-11-27"),
    "cg184": _nice("cg184", "Gastro-oesophageal reflux disease and dyspepsia in adults: investigation and management",
                   "CG184, September 2014 (updated October 2019)", "Recommendations", "2014-09-03"),
    "ng12site": _nice("ng12", "Suspected cancer: recognition and referral", "NG12, June 2015 (updated 2025)",
                      "Recommendations-organised-by-site-of-cancer", "2015-06-23"),
    "ng129": _nice("ng129", "Crohn's disease: management", "NG129, May 2019", "Recommendations", "2019-05-03"),
    "ng130": _nice("ng130", "Ulcerative colitis: management", "NG130, May 2019 (updated 2025)", "Recommendations", "2019-05-03"),
    "wses_asbo17": dict(body="WSES", title="Bologna guidelines for diagnosis and management of adhesive small bowel obstruction (ASBO): 2017 update",
                        edition="World Journal of Emergency Surgery 2018;13:24", doi="10.1186/s13017-018-0185-2",
                        url="https://doi.org/10.1186/s13017-018-0185-2", fetch=EPMC.format(pmc="PMC6006983"),
                        published="2018-06-19", license="open"),
    "wses_ami22": dict(body="WSES", title="Acute mesenteric ischemia: updated guidelines of the World Society of Emergency Surgery",
                       edition="World Journal of Emergency Surgery 2022;17:54", doi="10.1186/s13017-022-00443-x",
                       url="https://doi.org/10.1186/s13017-022-00443-x", fetch=EPMC.format(pmc="PMC9580452"),
                       published="2022-10-19", license="open"),
    "wses_pud20": dict(body="WSES", title="Perforated and bleeding peptic ulcer: WSES guidelines",
                       edition="World Journal of Emergency Surgery 2020;15:3", doi="10.1186/s13017-019-0283-9",
                       url="https://doi.org/10.1186/s13017-019-0283-9", fetch=EPMC.format(pmc="PMC6947898"),
                       published="2020-01-07", license="open"),
    "dumping20": dict(body="International dumping syndrome consensus panel",
                      title="International consensus on the diagnosis and management of dumping syndrome",
                      edition="Nature Reviews Endocrinology 2020;16:448-466", doi="10.1038/s41574-020-0357-5",
                      url="https://doi.org/10.1038/s41574-020-0357-5", fetch=EPMC.format(pmc="PMC7351708"),
                      published="2020-06-03"),
    "cdc_hepa_dx": dict(body="CDC", title="Clinical Testing and Diagnosis for Hepatitis A", edition="CDC viral hepatitis clinical guidance",
                        url="https://www.cdc.gov/hepatitis-a/hcp/diagnosis-testing/index.html", published="2025-01-31",
                        license="open", countries="US"),
    "cdc_hepa": dict(body="CDC", title="Clinical Overview of Hepatitis A", edition="CDC viral hepatitis clinical guidance",
                     url="https://www.cdc.gov/hepatitis-a/hcp/clinical-overview/index.html", published="2025-01-31",
                     license="open", countries="US"),
    "cdc_hepb_dx": dict(body="CDC", title="Clinical Testing and Diagnosis for Hepatitis B", edition="CDC viral hepatitis clinical guidance",
                        url="https://www.cdc.gov/hepatitis-b/hcp/diagnosis-testing/index.html", published="2025-01-31",
                        license="open", countries="US"),
    "cdc_hepb": dict(body="CDC", title="Clinical Overview of Hepatitis B", edition="CDC viral hepatitis clinical guidance",
                     url="https://www.cdc.gov/hepatitis-b/hcp/clinical-overview/index.html", published="2025-01-31",
                     license="open", countries="US"),
    "cdc_td": dict(body="CDC", title="CDC Yellow Book: Travelers' Diarrhea", edition="CDC Yellow Book (Health Information for International Travel)",
                   url="https://www.cdc.gov/yellow-book/hcp/preparing-international-travelers/travelers-diarrhea.html",
                   published="2025-04-23", license="open", countries="US"),
    "who_diarr": dict(body="WHO", title="Diarrhoeal disease: fact sheet", edition="WHO fact sheet",
                      url="https://www.who.int/news-room/fact-sheets/detail/diarrhoeal-disease", published="2024-03-07",
                      license="open"),
    "cdc_cdiff": dict(body="CDC", title="Clinical Overview of C. diff Infection", edition="CDC healthcare-associated infection guidance",
                      url="https://www.cdc.gov/c-diff/hcp/clinical-overview/index.html", published="2024-04-25",
                      license="open", countries="US"),
})

# ---- Haematology --------------------------------------------------------------
SRC.update({
    "ng24rbc": _nice("ng24", "Blood transfusion", "NG24, November 2015 (updated February 2026)", "Red-blood-cell-transfusion",
                     "2015-11-18"),
    "ng24ps": _nice("ng24", "Blood transfusion", "NG24, November 2015 (updated February 2026)", "Patient-safety", "2015-11-18"),
    "cg143": _nice("cg143", "Sickle cell disease: managing acute painful episodes in hospital", "CG143, June 2012 (updated 2026)",
                   "Recommendations", "2012-06-27"),
    "itp_crit26": dict(body="McMaster ITP Emergency Management Guideline Group",
                       title="Guideline on the emergency management of critical bleeding in patients with immune thrombocytopenia",
                       edition="Blood Advances 2026", doi="10.1182/bloodadvances.2025018818",
                       url="https://doi.org/10.1182/bloodadvances.2025018818", fetch=EPMC.format(pmc="PMC13487680"),
                       published="2026-05-01", license="open"),
    "itp_cn25": dict(body="Chinese Society of Hematology", title="Synopsis of the 2025 guideline for the diagnosis and management of adult primary immune thrombocytopenia",
                     edition="Chinese Medical Journal 2026", doi="10.1097/CM9.0000000000004143",
                     url="https://doi.org/10.1097/CM9.0000000000004143", fetch=EPMC.format(pmc="PMC13384542"),
                     published="2026-02-01", license="open"),
    "dic14": dict(body="BCSH / JSTH / SISET / ISTH (comparative review)",
                  title="Diagnosis and treatment of disseminated intravascular coagulation (DIC) according to four DIC guidelines",
                  edition="Journal of Intensive Care 2014;2:15", doi="10.1186/2052-0492-2-15",
                  url="https://doi.org/10.1186/2052-0492-2-15", fetch=EPMC.format(pmc="PMC4267589"),
                  published="2014-02-20", license="open"),
    "haem_eg25": dict(body="Egyptian national hemophilia panel", title="Updated Egyptian national guidelines for management of hemophilia A in children and adolescents",
                      edition="Annals of Hematology 2025", doi="10.1007/s00277-025-06557-x",
                      url="https://doi.org/10.1007/s00277-025-06557-x", fetch=EPMC.format(pmc="PMC12619826"),
                      published="2025-11-01", license="open"),
})

# ---- Infectious diseases -------------------------------------------------------
SRC.update({
    "ng60": _nice("ng60", "HIV testing: increasing uptake among people who may have undiagnosed HIV", "NG60, December 2016",
                  "Recommendations", "2016-12-01"),
    "ng19": _nice("ng19", "Diabetic foot problems: prevention and management", "NG19, August 2015 (updated October 2019)",
                  "Recommendations", "2015-08-26"),
    "cdc_hiv_dx": dict(body="CDC", title="Clinical Testing Guidance for HIV", edition="CDC HIV Nexus clinician resources",
                       url="https://www.cdc.gov/hivnexus/hcp/diagnosis-testing/index.html", published="2024-12-19",
                       license="open", countries="US"),
    "cdc_ebv": dict(body="CDC", title="Clinical Overview of Epstein-Barr Virus (EBV)", edition="April 2024",
                    url="https://www.cdc.gov/epstein-barr/hcp/clinical-overview/index.html", published="2024-04-10",
                    license="open", countries="US"),
    "cdc_mono": dict(body="CDC", title="About Infectious Mononucleosis", edition="CDC EBV and mono",
                     url="https://www.cdc.gov/epstein-barr/about/mononucleosis.html", published="2024-05-09",
                     license="open", countries="US"),
    "cdc_tetanus": dict(body="CDC", title="Clinical Overview of Tetanus", edition="CDC clinical guidance",
                        url="https://www.cdc.gov/tetanus/hcp/clinical-overview/index.html", published="2024-08-30",
                        license="open", countries="US"),
    "who_tetanus": dict(body="WHO", title="Tetanus: fact sheet", edition="WHO fact sheet",
                        url="https://www.who.int/news-room/fact-sheets/detail/tetanus", published="2024-08-26",
                        license="open"),
})

# ---- Musculoskeletal and toxicology -----------------------------------------------
SRC.update({
    "ng219": _nice("ng219", "Gout: diagnosis and management", "NG219, June 2022", "Recommendations", "2022-06-09"),
    "cg124": _nice("cg124", "Hip fracture: management", "CG124, June 2011 (updated January 2023)", "Recommendations", "2011-06-22"),
    "ng59": _nice("ng59", "Low back pain and sciatica in over 16s: assessment and management", "NG59, November 2016 (updated 2026)",
                  "Recommendations", "2016-11-30"),
    "boast4": dict(body="British Orthopaedic Association", title="BOAST: Open Fractures", edition="BOA Standards for Trauma, December 2017",
                   url="https://www.boa.ac.uk/resource/boast-4-pdf.html", published="2017-12-01", license="open", countries="UK"),
    "boast10": dict(body="British Orthopaedic Association", title="BOAST: Diagnosis and Management of Compartment Syndrome of the Extremities",
                    edition="BOA Standards for Trauma, July 2014 (updated July 2025)",
                    url="https://www.boa.ac.uk/resource/boast-10-pdf.html", published="2025-07-01", license="open", countries="UK"),
    "aagbi_acs21": dict(body="Association of Anaesthetists", title="Regional analgesia for lower leg trauma and the risk of acute compartment syndrome: guideline from the Association of Anaesthetists",
                        edition="Anaesthesia 2021;76:1578-1592", doi="10.1111/anae.15504",
                        url="https://doi.org/10.1111/anae.15504", fetch=EPMC.format(pmc="PMC9292897"),
                        published="2021-06-01", license="open", countries="UK"),
    "aast_rhabdo22": dict(body="AAST Critical Care Committee", title="Rhabdomyolysis: an American Association for the Surgery of Trauma Critical Care Committee Clinical Consensus Document",
                          edition="Trauma Surgery and Acute Care Open 2022;7:e000836", doi="10.1136/tsaco-2021-000836",
                          url="https://doi.org/10.1136/tsaco-2021-000836", fetch=EPMC.format(pmc="PMC8804685"),
                          published="2022-01-25", license="open", countries="US"),
    "extrip_tca14": dict(body="EXTRIP Workgroup", title="Extracorporeal treatment for tricyclic antidepressant poisoning: recommendations from the EXTRIP Workgroup",
                         edition="Seminars in Dialysis 2014;27(4):381-389", doi="10.1111/sdi.12227",
                         url="https://doi.org/10.1111/sdi.12227", fetch=EPMC.format(pmc="PMC4282541"),
                         published="2014-07-01", license="open"),
})

# ---- Neurology ---------------------------------------------------------------------
SRC.update({
    "cg103": _nice("cg103", "Delirium: prevention, diagnosis and management in hospital and long-term care",
                   "CG103, July 2010 (updated January 2023)", "Recommendations", "2010-07-28"),
    "cg150": _nice("cg150", "Headaches in over 12s: diagnosis and management", "CG150, September 2012 (updated June 2025)",
                   "Recommendations", "2012-09-19"),
    "ng234": _nice("ng234", "Spinal metastases and metastatic spinal cord compression", "NG234, September 2023",
                   "Recommendations", "2023-09-06"),
    "coch_bell16": dict(body="Cochrane", title="Corticosteroids for Bell's palsy (idiopathic facial paralysis)",
                        edition="Cochrane Database of Systematic Reviews 2016, CD001942.pub5", doi="10.1002/14651858.CD001942.pub5",
                        url="https://doi.org/10.1002/14651858.CD001942.pub5",
                        fetch="https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:10.1002/14651858.CD001942.pub5&resultType=core&format=xml",
                        published="2016-07-18"),
    "coch_bell_av19": dict(body="Cochrane", title="Antiviral treatment for Bell's palsy (idiopathic facial paralysis)",
                           edition="Cochrane Database of Systematic Reviews 2019, CD001869.pub9", doi="10.1002/14651858.CD001869.pub9",
                           url="https://doi.org/10.1002/14651858.CD001869.pub9",
                           fetch="https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:10.1002/14651858.CD001869.pub9&resultType=core&format=xml",
                           published="2019-09-05"),
    "ean_enc26": dict(body="EAN / ESCMID", title="Diagnosis and Management of Infectious Encephalitis in Adults: Guidelines From the European Academy of Neurology and European Society of Clinical Microbiology and Infectious Diseases",
                      edition="European Journal of Neurology 2026", url="https://europepmc.org/article/PMC/PMC13650609",
                      fetch=EPMC.format(pmc="PMC13650609"), published="2026-06-01", license="open"),
    "gbs19": dict(body="International GBS expert group (IGOS)", title="Diagnosis and management of Guillain-Barré syndrome in ten steps",
                  edition="Nature Reviews Neurology 2019;15:671-683", doi="10.1038/s41582-019-0250-9",
                  url="https://doi.org/10.1038/s41582-019-0250-9", fetch=EPMC.format(pmc="PMC6821638"),
                  published="2019-09-20", license="open"),
    "mg16": dict(body="MGFA international consensus", title="International consensus guidance for management of myasthenia gravis: Executive summary",
                 edition="Neurology 2016;87(4):419-425", doi="10.1212/WNL.0000000000002790",
                 url="https://doi.org/10.1212/WNL.0000000000002790", fetch=EPMC.format(pmc="PMC4977114"),
                 published="2016-07-26", license="open"),
    "bppv_kas23": dict(body="AAO-HNSF (key action statements, reproduced)",
                       title="Clinical Practice Guideline: Benign Paroxysmal Positional Vertigo (Update) key action statements, as tabulated in: Adoption of clinical practice guidelines in cases of benign paroxysmal positional vertigo",
                       edition="European Archives of Oto-Rhino-Laryngology 2023;280:4381 (guideline: Otolaryngol Head Neck Surg 2017)",
                       doi="10.1007/s00405-023-07981-3", url="https://doi.org/10.1007/s00405-023-07981-3",
                       fetch=EPMC.format(pmc="PMC10133903"), published="2023-04-26", license="open"),
})

# ---- Obstetrics and gynaecology ----------------------------------------------------
SRC.update({
    "ng133": _nice("ng133", "Hypertension in pregnancy: diagnosis and management", "NG133, June 2019 (updated April 2023)",
                   "Recommendations", "2019-06-25"),
    "ng201": _nice("ng201", "Antenatal care", "NG201, August 2021", "Recommendations", "2021-08-19"),
    "ng126sx": _nice("ng126", "Ectopic pregnancy and miscarriage: diagnosis and initial management", "NG126, April 2019 (updated 2026)",
                     "Symptoms-and-signs-of-ectopic-pregnancy-and-initial-assessment", "2019-04-17"),
    "ng126dx": _nice("ng126", "Ectopic pregnancy and miscarriage: diagnosis and initial management", "NG126, April 2019 (updated 2026)",
                     "Diagnosis-of-viable-intrauterine-pregnancy-and-of-tubal-ectopic-pregnancy", "2019-04-17"),
    "ng126mc": _nice("ng126", "Ectopic pregnancy and miscarriage: diagnosis and initial management", "NG126, April 2019 (updated 2026)",
                     "Management-of-miscarriage", "2019-04-17"),
    "ng126ad": _nice("ng126", "Ectopic pregnancy and miscarriage: diagnosis and initial management", "NG126, April 2019 (updated 2026)",
                     "Anti-D-immunoglobulin-prophylaxis", "2019-04-17"),
    "gtg63": dict(body="RCOG", title="Antepartum Haemorrhage (Green-top Guideline No. 63)", edition="November 2011",
                  url="https://www.rcog.org.uk/media/pwdi1tef/gtg_63.pdf", published="2011-11-01", countries="UK"),
    "acog783": dict(body="ACOG", title="Adnexal Torsion in Adolescents (Committee Opinion No. 783)", edition="August 2019, reaffirmed 2021",
                    url="https://www.acog.org/clinical/guidance/committee-opinion/2019/08/adnexal-torsion-in-adolescents",
                    published="2019-08-01", countries="US"),
})

# ---- Psychiatry --------------------------------------------------------------------
SRC.update({
    "ng69": _nice("ng69", "Eating disorders: recognition and treatment", "NG69, May 2017 (updated December 2020)",
                  "Recommendations", "2017-05-23"),
    "ng222": _nice("ng222", "Depression in adults: treatment and management", "NG222, June 2022 (updated 2024)",
                   "Recommendations", "2022-06-29"),
    "ng116": _nice("ng116", "Post-traumatic stress disorder", "NG116, December 2018", "Recommendations", "2018-12-05"),
    "meed22": dict(body="Royal College of Psychiatrists", title="Medical emergencies in eating disorders (MEED): Guidance on recognition and management (CR233)",
                   edition="College Report CR233, May 2022",
                   url="https://www.rcpsych.ac.uk/docs/default-source/improving-care/better-mh-policy/college-reports/college-report-cr233-medical-emergencies-in-eating-disorders-(meed)-guidance.pdf?sfvrsn=2d327483_67",
                   published="2022-05-01", countries="UK"),
    "ss25": dict(body="Br J Clin Pharmacol (clinical toxicology review)", title="Management of serotonin syndrome (toxicity)",
                 edition="British Journal of Clinical Pharmacology 2025", doi="10.1111/bcp.16152",
                 url="https://doi.org/10.1111/bcp.16152", fetch=EPMC.format(pmc="PMC11862804"),
                 published="2025-03-01", license="open"),
})

# ---- Pulmonology -------------------------------------------------------------------
SRC.update({
    "ng9": _nice("ng9", "Bronchiolitis in children: diagnosis and management", "NG9, June 2015 (updated August 2021)",
                 "Recommendations", "2015-06-01"),
    "ng33": _nice("ng33", "Tuberculosis", "NG33, January 2016 (updated September 2019)", "Recommendations", "2016-01-13"),
    "ng202": _nice("ng202", "Obstructive sleep apnoea/hypopnoea syndrome and obesity hypoventilation syndrome in over 16s",
                   "NG202, August 2021", "1-Obstructive-sleep-apnoeahypopnoea-syndrome", "2021-08-20"),
    "esicm_ards23": dict(body="ESICM", title="ESICM guidelines on acute respiratory distress syndrome: definition, phenotyping and respiratory support strategies",
                         edition="Intensive Care Medicine 2023;49:727-759", doi="10.1007/s00134-023-07050-7",
                         url="https://link.springer.com/article/10.1007/s00134-023-07050-7", published="2023-06-16",
                         license="open"),
    "atsidsa_cap19": dict(body="ATS / IDSA", title="Diagnosis and Treatment of Adults with Community-acquired Pneumonia. An Official Clinical Practice Guideline of the American Thoracic Society and Infectious Diseases Society of America",
                          edition="Am J Respir Crit Care Med 2019;200(7):e45-e67", doi="10.1164/rccm.201908-1581ST",
                          url="https://doi.org/10.1164/rccm.201908-1581ST", fetch=EPMC.format(pmc="PMC6812437"),
                          published="2019-10-01", license="open", countries="US"),
    "cdc_co": dict(body="CDC", title="Clinical Guidance for Carbon Monoxide (CO) Poisoning", edition="CDC clinical guidance",
                   url="https://www.cdc.gov/carbon-monoxide/hcp/clinical-guidance/index.html", published="2024-04-23",
                   license="open", countries="US"),
    "ukhsa_co": dict(body="UKHSA", title="Carbon monoxide: toxicological overview", edition="UKHSA compendium of chemical hazards",
                     url="https://www.gov.uk/government/publications/carbon-monoxide-properties-incident-management-and-toxicology/carbon-monoxide-toxicological-overview",
                     published="2022-12-01", license="open", countries="UK"),
    "kcig_hemop18": dict(body="Korean Society of Radiology (K-CIG)", title="2018 Korean Clinical Imaging Guideline for Hemoptysis",
                         edition="Korean Journal of Radiology 2018;19(5):866-871", doi="10.3348/kjr.2018.19.5.866",
                         url="https://doi.org/10.3348/kjr.2018.19.5.866", fetch=EPMC.format(pmc="PMC6082761"),
                         published="2018-08-01", license="open"),
    "scii_hemop23": dict(body="Society of Chest Imaging and Interventions", title="Society of Chest Imaging and Interventions Consensus Guidelines for the Interventional Radiology Management of Hemoptysis",
                         edition="Indian Journal of Radiology and Imaging 2023;33(3)", doi="10.1055/s-0043-1762552",
                         url="https://doi.org/10.1055/s-0043-1762552", fetch=EPMC.format(pmc="PMC10289864"),
                         published="2023-03-01", license="open"),
    "bts_pleural23": dict(body="BTS", title="British Thoracic Society Guideline for pleural disease (summary)",
                          edition="Thorax 2023;78(Suppl 3)", doi="10.1136/thorax-2023-220304",
                          url="https://www.brit-thoracic.org.uk/document-library/guidelines/pleural-disease/bts-guideline-for-pleural-disease-summary-of-guideline/",
                          published="2023-07-01", countries="UK"),
})

# ---- Renal and urology -------------------------------------------------------------
SRC.update({
    "cg97": _nice("cg97", "Lower urinary tract symptoms in men: management", "CG97, May 2010 (updated June 2015)",
                  "Recommendations", "2010-05-23"),
    "ng118r": _nice("ng118", "Renal and ureteric stones: assessment and management", "NG118, January 2019",
                    "Recommendations", "2019-01-08"),
    "kdigo_gd21": dict(body="KDIGO", title="KDIGO 2021 Clinical Practice Guideline for the Management of Glomerular Diseases",
                       edition="Kidney International 2021;100(4S):S1-S276", doi="10.1016/j.kint.2021.05.021",
                       url="https://kdigo.org/wp-content/uploads/2017/02/KDIGO-Glomerular-Diseases-Guideline-2021-English.pdf",
                       published="2021-10-01"),
    "ipna_ssns23": dict(body="IPNA", title="IPNA clinical practice recommendations for the diagnosis and management of children with steroid-sensitive nephrotic syndrome",
                        edition="Pediatric Nephrology 2023;38(3):877-919", doi="10.1007/s00467-022-05739-3",
                        url="https://doi.org/10.1007/s00467-022-05739-3", fetch=EPMC.format(pmc="PMC9589698"),
                        published="2022-10-21", license="open"),
    "aua_priapism21": dict(body="AUA / SMSNA", title="Acute Ischemic Priapism: An AUA/SMSNA Guideline",
                           edition="J Urol 2021;206(5):1114-1121", doi="10.1097/JU.0000000000002236",
                           url="https://www.auanet.org/guidelines-and-quality/guidelines/acute-ischemic-priapism",
                           published="2021-09-08", countries="US"),
    "cdc_sti_epid21": dict(body="CDC", title="Sexually Transmitted Infections Treatment Guidelines, 2021: Epididymitis",
                           edition="MMWR Recomm Rep 2021;70(4)", url="https://www.cdc.gov/std/treatment-guidelines/epididymitis.htm",
                           published="2021-07-23", license="open", countries="US"),
    "burst_baus22": dict(body="BURST / BAUS", title="A BURST-BAUS consensus document for best practice in the conduct of scrotal exploration for suspected testicular torsion: the Finding consensus for orchIdopeXy In Torsion (FIX-IT) study",
                         edition="BJU International 2022", doi="10.1111/bju.15818", url="https://doi.org/10.1111/bju.15818",
                         fetch=EPMC.format(pmc="PMC9796508"), published="2022-06-10", license="open", countries="UK"),
})

# ---- Second tips for conditions previously covered by a single tip ------------------
SRC.update({
    "ng115c": _nice("ng115", "Chronic obstructive pulmonary disease in over 16s: diagnosis and management",
                    "NG115, December 2018 (updated 2026)", "Recommendations", "2018-12-05"),
    "ng109": _nice("ng109", "Urinary tract infection (lower): antimicrobial prescribing", "NG109, October 2018",
                   "Recommendations", "2018-10-31"),
    "ng191c": _nice("ng191", "COVID-19 rapid guideline: managing COVID-19", "NG191, March 2021 (updated)",
                    "5-Preventing-and-managing-acute-complications", "2021-03-23"),
    "wses_ssti18": dict(body="WSES / SIS-E", title="2018 WSES/SIS-E consensus conference: recommendations for the management of skin and soft-tissue infections",
                        edition="World Journal of Emergency Surgery 2018;13:58", doi="10.1186/s13017-018-0219-9",
                        url="https://doi.org/10.1186/s13017-018-0219-9", fetch=EPMC.format(pmc="PMC6295010"),
                        published="2018-12-14", license="open"),
})


def _c(sid: str, src: str, section: str, stages: List[str], en: str, tr: str, codes: List[str], *,
       specialties: List[str] | None = None, countries: List[str] | None = None,
       population: str = "adult") -> GuidelineStatement:
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
        section=section,
        published_date=meta.get("published", ""),
        license_tag=meta.get("license", "copyrighted-summarized"),
        scope={"countries": countries or [meta.get("countries", "GLOBAL")], "specialties": specialties or [],
               "population": population, "care_setting": ["ED"]},
        condition_codes=list(codes),
        topic=sid,
        stages=list(stages),
        status="draft",
    )


# Catalogue ICD-10 codes (server/condition_catalog.py).
AF, AS_, AHF, HTNE, ANG, IE, MYO, SVT, VT, CHB = (["I48.0"], ["I35.0"], ["I50.9"], ["I16.1"], ["I20.9"],
                                                  ["I33.0"], ["I40.9"], ["I47.1"], ["I47.2"], ["I44.2"])
ARREST, DROWN, SYNC = ["I46.9"], ["T75.1"], ["R55"]


def catalog_statements() -> List[GuidelineStatement]:  # noqa: C901 - a flat authored list
    S: List[GuidelineStatement] = []
    a = S.append

    # ======================= CARDIOLOGY =======================================
    # ---- Atrial fibrillation with rapid response (NICE NG196 section 1.8) ----
    a(_c("gs_nice_ng196_af_unstable_dccv", "ng196", "1.8.1", ["triage", "treatment"],
         "Carry out emergency electrical cardioversion, without delaying to achieve anticoagulation, in people with life-threatening haemodynamic instability caused by new-onset atrial fibrillation.",
         "Yeni başlangıçlı atriyal fibrilasyonun neden olduğu yaşamı tehdit eden hemodinamik instabilitesi olan kişilerde, antikoagülasyonu sağlamak için beklemeden acil elektriksel kardiyoversiyon uygulayın.",
         AF, specialties=["cardiology"]))
    a(_c("gs_nice_ng196_af_rate_or_rhythm_48h", "ng196", "1.8.2", ["treatment"],
         "In people with atrial fibrillation presenting acutely without life-threatening haemodynamic instability, offer either rate or rhythm control if the onset of the arrhythmia is less than 48 hours, and offer rate control if onset is more than 48 hours or is uncertain.",
         "Yaşamı tehdit eden hemodinamik instabilite olmadan akut başvuran atriyal fibrilasyonda, aritmi başlangıcı 48 saatten kısaysa hız ya da ritim kontrolü, başlangıç 48 saatten uzunsa veya belirsizse hız kontrolü önerin.",
         AF, specialties=["cardiology"]))
    a(_c("gs_nice_ng196_af_adhf_no_ccb", "ng196", "1.8.3", ["treatment"],
         "In people with atrial fibrillation presenting acutely with suspected concomitant acute decompensated heart failure, seek senior specialist input on the use of beta-blockers and do not use calcium-channel blockers.",
         "Eşlik eden akut dekompanse kalp yetmezliğinden şüphelenilen akut atriyal fibrilasyonda beta bloker kullanımı için kıdemli uzman görüşü alın ve kalsiyum kanal blokeri kullanmayın.",
         AF, specialties=["cardiology"]))
    a(_c("gs_nice_ng196_af_pharm_cardioversion", "ng196", "1.8.5; 1.8.7", ["treatment"],
         "If pharmacological cardioversion has been agreed for new-onset atrial fibrillation, offer a choice of flecainide or amiodarone to people with no evidence of structural or ischaemic heart disease, or amiodarone to people with evidence of structural heart disease; do not offer magnesium or a calcium-channel blocker for pharmacological cardioversion.",
         "Yeni başlangıçlı atriyal fibrilasyonda farmakolojik kardiyoversiyona karar verildiyse, yapısal veya iskemik kalp hastalığı kanıtı olmayanlara flekainid ya da amiodaron, yapısal kalp hastalığı olanlara amiodaron önerin; farmakolojik kardiyoversiyon için magnezyum veya kalsiyum kanal blokeri vermeyin.",
         AF, specialties=["cardiology"]))
    a(_c("gs_nice_ng196_af_delay_cardioversion_3w", "ng196", "1.8.6", ["disposition"],
         "In people with atrial fibrillation in whom the duration of the arrhythmia is greater than 48 hours or uncertain and considered for long-term rhythm control, delay cardioversion until they have been maintained on therapeutic anticoagulation for a minimum of 3 weeks, offering rate control during this period.",
         "Aritmi süresi 48 saatten uzun veya belirsiz olan ve uzun dönem ritim kontrolü düşünülen atriyal fibrilasyonda, kardiyoversiyonu en az 3 hafta terapötik antikoagülasyon sağlanana kadar erteleyin; bu sürede hız kontrolü verin.",
         AF, specialties=["cardiology"]))
    a(_c("gs_nice_ng196_af_cha2ds2vasc_doac", "ng196", "1.2.1; 1.6.3", ["disposition"],
         "Use the CHA2DS2-VASc stroke risk score to assess stroke risk in people with atrial fibrillation, and offer anticoagulation with a direct-acting oral anticoagulant to people with a CHA2DS2-VASc score of 2 or above, taking into account the risk of bleeding.",
         "Atriyal fibrilasyonda inme riskini CHA2DS2-VASc skoruyla değerlendirin ve kanama riskini göz önünde bulundurarak CHA2DS2-VASc skoru 2 veya üzerinde olanlara doğrudan etkili oral antikoagülan önerin.",
         AF, specialties=["cardiology"]))

    # ---- Severe aortic stenosis (NICE NG208) ---------------------------------
    a(_c("gs_nice_ng208_murmur_exertional_syncope", "ng208", "1.1.3", ["history", "workup"],
         "If valve disease is suspected, offer urgent (within 2 weeks) specialist assessment that includes echocardiogram, or if not available an urgent echocardiogram alone, to adults with a systolic murmur and exertional syncope.",
         "Kapak hastalığından şüpheleniliyorsa, sistolik üfürümü ve efor sırasında senkopu olan erişkinlere ekokardiyografiyi içeren acil (2 hafta içinde) uzman değerlendirmesi, bu yoksa yalnızca acil ekokardiyografi önerin.",
         AS_, specialties=["cardiology"]))
    a(_c("gs_nice_ng208_severe_symptoms_echo", "ng208", "1.1.3", ["triage", "workup"],
         "Consider urgent (within 2 weeks) specialist assessment that includes echocardiogram for adults with a murmur and severe symptoms (angina or breathlessness on minimal exertion or at rest) thought to be related to valvular heart disease.",
         "Kapak hastalığına bağlı olduğu düşünülen üfürüm ve ağır semptomları (minimal eforla veya istirahatte anjina ya da nefes darlığı) olan erişkinlerde ekokardiyografiyi içeren acil (2 hafta içinde) uzman değerlendirmesini düşünün.",
         AS_, specialties=["cardiology"]))
    a(_c("gs_nice_ng208_symptomatic_severe_intervention", "ng208", "1.3.1; 1.5.3; 1.5.4", ["disposition"],
         "Offer an intervention to adults with symptomatic severe heart valve disease: surgery as first-line intervention for severe aortic stenosis at low or intermediate surgical risk, and TAVI for non-bicuspid severe aortic stenosis at high surgical risk or if surgery is unsuitable.",
         "Semptomatik ağır kalp kapak hastalığı olan erişkinlere girişim önerin: düşük veya orta cerrahi riskli ağır aort darlığında ilk basamak girişim olarak cerrahi, yüksek cerrahi riskli veya cerrahiye uygun olmayan biküspit olmayan ağır aort darlığında TAVI.",
         AS_, specialties=["cardiology"]))

    # ---- Acute decompensated heart failure (NICE CG187) ----------------------
    a(_c("gs_nice_cg187_np_rule_out", "cg187", "1.2.2; 1.2.3", ["workup"],
         "In people presenting with new suspected acute heart failure, use a single measurement of serum natriuretic peptides to rule out the diagnosis (BNP less than 100 ng/litre, NT-proBNP less than 300 ng/litre); if natriuretic peptide levels are raised, perform transthoracic Doppler 2D echocardiography.",
         "Yeni şüpheli akut kalp yetmezliğiyle başvuranlarda tanıyı dışlamak için tek bir serum natriüretik peptid ölçümü kullanın (BNP 100 ng/litre altı, NT-proBNP 300 ng/litre altı); natriüretik peptid yüksekse transtorasik Doppler 2B ekokardiyografi yapın.",
         AHF + ["R06.0"], specialties=["cardiology"]))
    a(_c("gs_nice_cg187_iv_diuretic", "cg187", "1.3.3; 1.3.4; 1.3.5", ["treatment"],
         "Offer intravenous diuretic therapy to people with acute heart failure, using either a bolus or infusion strategy; for people already taking a diuretic, consider a higher dose than that on which the person was admitted, and closely monitor renal function, weight and urine output.",
         "Akut kalp yetmezliğinde bolus veya infüzyon stratejisiyle intravenöz diüretik tedavisi önerin; zaten diüretik kullananlarda yatıştaki dozdan daha yüksek bir doz düşünün ve böbrek fonksiyonu, kilo ve idrar çıkışını yakından izleyin.",
         AHF, specialties=["cardiology"]))
    a(_c("gs_nice_cg187_no_routine_opiates_nitrates", "cg187", "1.3.2; 1.3.7; 1.3.10; 1.3.11", ["treatment"],
         "Do not routinely offer opiates, nitrates, inotropes or vasopressors to people with acute heart failure; consider inotropes or vasopressors in people with potentially reversible cardiogenic shock in a setting where at least level 2 care can be provided.",
         "Akut kalp yetmezliğinde opiyat, nitrat, inotrop veya vazopresörleri rutin olarak vermeyin; potansiyel olarak geri döndürülebilir kardiyojenik şokta en az düzey 2 bakım sağlanabilen bir ortamda inotrop veya vazopresör düşünün.",
         AHF, specialties=["cardiology"]))
    a(_c("gs_nice_cg187_niv_acidaemia", "cg187", "1.4.1; 1.4.2", ["treatment"],
         "Do not routinely use non-invasive ventilation in acute heart failure and cardiogenic pulmonary oedema, but if a person has cardiogenic pulmonary oedema with severe dyspnoea and acidaemia consider starting non-invasive ventilation without delay.",
         "Akut kalp yetmezliği ve kardiyojenik akciğer ödeminde noninvaziv ventilasyonu rutin olarak kullanmayın; ancak ağır dispne ve asidemiyle seyreden kardiyojenik akciğer ödeminde noninvaziv ventilasyonu gecikmeden başlatmayı düşünün.",
         AHF, specialties=["cardiology"]))
    a(_c("gs_nice_cg187_continue_beta_blocker", "cg187", "1.5.1", ["treatment", "disposition"],
         "In a person presenting with acute heart failure who is already taking beta-blockers, continue the beta-blocker treatment unless they have a heart rate less than 50 beats per minute, second or third degree atrioventricular block, or shock.",
         "Akut kalp yetmezliğiyle başvuran ve zaten beta bloker kullanan kişide, kalp hızı dakikada 50'nin altında değilse, ikinci veya üçüncü derece atriyoventriküler blok ya da şok yoksa beta bloker tedavisine devam edin.",
         AHF, specialties=["cardiology"]))

    # ---- Hypertensive emergency (NICE NG136 section 1.5) ---------------------
    a(_c("gs_nice_ng136_same_day_180_120", "ng136", "1.5.2", ["triage", "disposition"],
         "Refer people for specialist assessment, carried out on the same day, if they have a clinic blood pressure of 180/120 mmHg and higher with signs of retinal haemorrhage or papilloedema (accelerated hypertension) or life-threatening symptoms such as new onset confusion, chest pain, signs of heart failure, or acute kidney injury.",
         "Klinik kan basıncı 180/120 mmHg ve üzerinde olup retina kanaması veya papil ödemi (akselere hipertansiyon) ya da yeni başlayan konfüzyon, göğüs ağrısı, kalp yetmezliği bulguları veya akut böbrek hasarı gibi yaşamı tehdit eden semptomları olanları aynı gün uzman değerlendirmesine yönlendirin.",
         HTNE, specialties=["cardiology"]))
    a(_c("gs_nice_ng136_phaeo_same_day", "ng136", "1.5.3", ["history", "disposition"],
         "Refer people for specialist assessment, carried out on the same day, if they have suspected phaeochromocytoma, for example labile or postural hypotension, headache, palpitations, pallor, abdominal pain or diaphoresis.",
         "Şüpheli feokromositoması olanları, örneğin değişken veya postüral hipotansiyon, baş ağrısı, çarpıntı, solukluk, karın ağrısı veya terleme varsa, aynı gün uzman değerlendirmesine yönlendirin.",
         HTNE + ["E27.5"], specialties=["cardiology", "endocrine"]))

    # ---- Stable angina (NICE CG126, CG95) ------------------------------------
    a(_c("gs_nice_cg95_angina_typicality", "cg95", "1.3.3.1", ["history"],
         "Anginal pain is constricting discomfort in the front of the chest, or in the neck, shoulders, jaw or arms, precipitated by physical exertion and relieved by rest or GTN within about 5 minutes; three of these features define typical angina, two atypical angina, and one or none non-anginal chest pain.",
         "Anjinal ağrı göğsün önünde veya boyun, omuz, çene ya da kollarda sıkıştırıcı rahatsızlıktır, fiziksel eforla ortaya çıkar ve istirahat veya GTN ile yaklaşık 5 dakika içinde geçer; bu özelliklerden üçü tipik anjinayı, ikisi atipik anjinayı, biri veya hiçbiri anjinal olmayan göğüs ağrısını tanımlar.",
         ANG, specialties=["cardiology"]))
    a(_c("gs_nice_cg95_ctca", "cg95", "1.3.4.3", ["workup"],
         "Offer 64-slice (or above) CT coronary angiography if clinical assessment indicates typical or atypical angina, or if it indicates non-anginal chest pain but the 12-lead resting ECG has been done and indicates ST-T changes or Q waves.",
         "Klinik değerlendirme tipik veya atipik anjinayı gösteriyorsa ya da anjinal olmayan göğüs ağrısını gösterse de 12 derivasyonlu istirahat EKG'si ST-T değişiklikleri veya Q dalgaları gösteriyorsa 64 kesit (veya üzeri) BT koroner anjiyografi önerin.",
         ANG, specialties=["cardiology"]))
    a(_c("gs_nice_cg95_acs_features", "cg95", "1.2.1.3; 1.2.1.4", ["triage"],
         "Initially assess people for symptoms which may indicate an ACS: pain in the chest or other areas lasting longer than 15 minutes, chest pain associated with nausea and vomiting, marked sweating or breathlessness, chest pain associated with haemodynamic instability, and new onset chest pain or abrupt deterioration in previously stable angina; do not use the response to glyceryl trinitrate (GTN) to make a diagnosis.",
         "Akut koroner sendromu düşündürebilecek belirtileri ilk olarak değerlendirin: göğüste veya başka bölgelerde 15 dakikadan uzun süren ağrı, bulantı ve kusma, belirgin terleme veya nefes darlığıyla birlikte göğüs ağrısı, hemodinamik instabiliteyle birlikte göğüs ağrısı ve yeni başlayan göğüs ağrısı ya da daha önce stabil olan anjinanın ani kötüleşmesi; tanı koymak için gliseril trinitrata (GTN) yanıtı kullanmayın.",
         ANG + ["R07.4"], specialties=["cardiology"]))
    a(_c("gs_nice_cg126_short_acting_nitrate", "cg126", "1.3.3; 1.3.4", ["treatment", "disposition"],
         "Offer a short-acting nitrate for preventing and treating episodes of angina, and advise people to repeat the dose after 5 minutes if the pain has not gone and to call an emergency ambulance if the pain has not gone 5 minutes after taking a second dose.",
         "Anjina ataklarını önlemek ve tedavi etmek için kısa etkili nitrat önerin; ağrı geçmezse dozu 5 dakika sonra tekrarlamalarını ve ikinci dozdan 5 dakika sonra ağrı geçmemişse acil ambulans çağırmalarını öğütleyin.",
         ANG, specialties=["cardiology"]))
    a(_c("gs_nice_cg126_bb_or_ccb_first_line", "cg126", "1.4.7; 1.3.5", ["treatment"],
         "Offer either a beta blocker or a calcium channel blocker as first-line treatment for stable angina, based on comorbidities, contraindications and the person's preference, and consider aspirin 75 mg daily taking into account the risk of bleeding.",
         "Stabil anjinada eşlik eden hastalıklar, kontrendikasyonlar ve kişinin tercihine göre ilk basamak tedavi olarak beta bloker ya da kalsiyum kanal blokeri önerin ve kanama riskini gözeterek günde 75 mg aspirini düşünün.",
         ANG, specialties=["cardiology"]))

    # ---- Infective endocarditis (JCS 2026) -----------------------------------
    a(_c("gs_jcs26_ie_cultures_3_sets", "jcs_ie26", "Diagnosis: blood cultures", ["workup", "treatment"],
         "When the patient is septic or experiencing acute heart failure, antimicrobial therapy should not be delayed for the sake of blood culture collection: blood cultures should be obtained promptly in 3 sets (minimum of 2 sets), and antimicrobial therapy should be initiated.",
         "Hasta septikse veya akut kalp yetmezliği yaşıyorsa antimikrobiyal tedavi kan kültürü alınması için geciktirilmemelidir: kan kültürleri hemen 3 set (en az 2 set) olarak alınmalı ve antimikrobiyal tedavi başlatılmalıdır.",
         IE, specialties=["cardiology", "infectious"]))
    a(_c("gs_jcs26_ie_tte_tee", "jcs_ie26", "Table 9: echocardiography", ["workup"],
         "TTE is recommended for all suspected cases of IE; TEE is recommended where adequate images cannot be obtained with TTE, in suspected IE with a prosthetic valve or any other device, and when IE is clinically suspected despite a negative result on TTE.",
         "Tüm şüpheli enfektif endokardit olgularında TTE önerilir; TTE ile yeterli görüntü alınamadığında, protez kapak veya başka bir cihaz varlığında şüpheli endokarditte ve TTE negatif olmasına rağmen klinik şüphe sürdüğünde TEE önerilir.",
         IE, specialties=["cardiology", "infectious"]))
    a(_c("gs_jcs26_ie_empirical_no_delay", "jcs_ie26", "Empirical therapy (Table 22)", ["treatment"],
         "When clinical suspicion of IE is high, initiation of antimicrobial therapy should not be delayed; prompt empirical treatment is also advisable in cases of hemodynamic instability, sepsis, embolic events, or valvular abscess.",
         "Enfektif endokardit klinik şüphesi yüksekse antimikrobiyal tedavinin başlatılması geciktirilmemelidir; hemodinamik instabilite, sepsis, embolik olay veya kapak absesi varlığında da hızlı ampirik tedavi önerilir.",
         IE, specialties=["cardiology", "infectious"]))
    a(_c("gs_jcs26_ie_hf_urgent_surgery", "jcs_ie26", "Indications for surgery: heart failure", ["disposition"],
         "Heart failure in IE patients often does not respond to medical therapy because valvular destruction is the primary cause; these patients warrant urgent or semi-urgent surgery, and unnecessary delays from relying solely on medical treatment should be avoided.",
         "Enfektif endokarditte kalp yetmezliği, birincil neden kapak yıkımı olduğundan çoğu kez tıbbi tedaviye yanıt vermez; bu hastalar acil veya yarı acil cerrahi gerektirir ve yalnızca tıbbi tedaviye güvenerek gereksiz gecikmeden kaçınılmalıdır.",
         IE, specialties=["cardiology", "infectious"]))

    # ---- Acute myocarditis (JCS 2023) ----------------------------------------
    a(_c("gs_jcs23_myo_ecg", "jcs_myo23", "Electrocardiography", ["workup"],
         "Electrocardiography is recommended for patients suspected of myocarditis, although there are no ECG findings specific to myocarditis, and the sensitivity of ECG is not necessarily high (47 to 85%).",
         "Miyokarditten şüphelenilen hastalarda elektrokardiyografi önerilir; ancak miyokardite özgü EKG bulgusu yoktur ve EKG'nin duyarlılığı her zaman yüksek değildir (yüzde 47-85).",
         MYO, specialties=["cardiology"]))
    a(_c("gs_jcs23_myo_troponin_mri", "jcs_myo23", "Definition: acute myocarditis", ["workup"],
         "Even when endomyocardial biopsy is not feasible, acute myocarditis usually shows an increase in high-sensitivity cardiac troponin, and cardiac magnetic resonance imaging (MRI) performed less than 30 days after onset shows findings of myocardial edema.",
         "Endomiyokardiyal biyopsi yapılamasa bile akut miyokarditte genellikle yüksek duyarlıklı kardiyak troponin artar ve başlangıçtan sonraki 30 gün içinde yapılan kardiyak manyetik rezonans görüntüleme (MRG) miyokardiyal ödem bulguları gösterir.",
         MYO, specialties=["cardiology"]))
    a(_c("gs_jcs23_myo_tamponade_echo", "jcs_myo23", "Echocardiography", ["workup", "disposition"],
         "Because cardiac tamponade may occur during the course of acute myocarditis, use echocardiography to check for temporal changes in the pericardial fluid and for early diastolic collapse of the right ventricular free wall suggesting cardiac tamponade.",
         "Akut miyokardit seyrinde kardiyak tamponat gelişebileceğinden, perikardiyal sıvıdaki zamansal değişiklikleri ve kardiyak tamponadı düşündüren sağ ventrikül serbest duvarının erken diyastolik kollapsını ekokardiyografiyle izleyin.",
         MYO + ["I31.4"], specialties=["cardiology"]))
    a(_c("gs_jcs23_myo_fulminant", "jcs_myo23", "Classification: fulminant myocarditis", ["disposition"],
         "A type of acute myocarditis that shows rapid collapse of hemodynamic status and follows a fatal course is called fulminant myocarditis.",
         "Hemodinamik durumun hızla çöktüğü ve ölümcül seyreden akut miyokardit tipine fulminan miyokardit denir.",
         MYO, specialties=["cardiology"]))

    # ---- Supraventricular tachycardia (ESC 2019 via Anatol J Cardiol) --------
    a(_c("gs_svt19_vagal_first", "svt19", "Acute management of narrow QRS tachycardias", ["treatment"],
         "The initial approach to acute management of narrow QRS tachycardia tends to be non-drug-based vagal maneuvers, with escalation to intravenous drugs or electrical cardioversion in the absence of early correction.",
         "Dar QRS'li taşikardinin akut tedavisinde ilk yaklaşım ilaç dışı vagal manevralardır; erken düzelme olmazsa intravenöz ilaçlara veya elektriksel kardiyoversiyona geçilir.",
         SVT, specialties=["cardiology"], countries=["GLOBAL", "TR"]))
    a(_c("gs_svt19_ccb_bb_after_adenosine", "svt19", "Acute management of narrow QRS tachycardias", ["treatment"],
         "Verapamil or diltiazem (i.v.) should be considered if vagal maneuvers and adenosine fail, but should be avoided in patients with hemodynamic instability, heart failure with reduced ejection fraction or a suspicion of ventricular tachycardia; beta-blockers (i.v. esmolol or metoprolol) should be considered if vagal maneuvers and adenosine fail.",
         "Vagal manevralar ve adenozin başarısız olursa IV verapamil veya diltiazem düşünülmelidir, ancak hemodinamik instabilite, düşük ejeksiyon fraksiyonlu kalp yetmezliği veya ventriküler taşikardi şüphesinde bunlardan kaçınılmalıdır; vagal manevralar ve adenozin başarısız olursa IV beta bloker (esmolol veya metoprolol) düşünülmelidir.",
         SVT, specialties=["cardiology"], countries=["GLOBAL", "TR"]))
    a(_c("gs_svt19_adenosine_preexcitation", "svt19", "Acute management of wide QRS tachycardias", ["treatment"],
         "Adenosine should be used with caution because it may produce AF with a rapid ventricular rate in pre-excited tachycardias, and with caution in patients with severe coronary artery disease.",
         "Adenozin, preeksite taşikardilerde hızlı ventrikül yanıtlı AF'ye yol açabileceğinden ve ağır koroner arter hastalığında dikkatle kullanılmalıdır.",
         SVT + VT, specialties=["cardiology"], countries=["GLOBAL", "TR"]))

    # ---- Ventricular tachycardia ---------------------------------------------
    a(_c("gs_svt19_wide_qrs_procainamide_amiodarone", "svt19", "Acute management of wide QRS tachycardias", ["treatment"],
         "In the acute management of a hemodynamically stable wide QRS tachycardia, procainamide (i.v.) should be considered if vagal maneuvers and adenosine fail, and amiodarone (i.v.) may be considered if vagal maneuvers and adenosine treatment fail.",
         "Hemodinamik olarak stabil geniş QRS'li taşikardinin akut tedavisinde vagal manevralar ve adenozin başarısız olursa IV prokainamid düşünülmeli, IV amiodaron düşünülebilir.",
         VT, specialties=["cardiology"], countries=["GLOBAL", "TR"]))
    a(_c("gs_costr20_refractory_vf_amiodarone", "costr20als", "Antiarrhythmic drugs during CPR", ["treatment"],
         "ILCOR suggests the use of amiodarone or lidocaine in adults with shock-refractory VF/pVT, and suggests against the routine use of magnesium in adults with shock-refractory VF/pVT.",
         "ILCOR, şoka dirençli VF/nabızsız VT'li erişkinlerde amiodaron veya lidokain kullanımını önerir ve şoka dirençli VF/nabızsız VT'de rutin magnezyum kullanımını önermez.",
         VT + ARREST, specialties=["cardiology", "emergency"]))

    # ---- Complete heart block -------------------------------------------------
    a(_c("gs_nice_cg109_ecg_red_flag", "cg109", "1.1.2.2; 1.1.2.3", ["workup"],
         "Record a 12-lead ECG using automated interpretation and treat as a red flag a conduction abnormality (for example, complete right or left bundle branch block or any degree of heart block), evidence of a long or short QT interval, or any ST segment or T wave abnormalities.",
         "Otomatik yorumlu 12 derivasyonlu EKG çekin ve ileti anormalliğini (örneğin tam sağ veya sol dal bloğu ya da herhangi bir derecede kalp bloğu), uzun veya kısa QT kanıtını ya da herhangi bir ST segment veya T dalgası anormalliğini kırmızı bayrak olarak kabul edin.",
         CHB + SYNC, specialties=["cardiology", "emergency"]))
    a(_c("gs_nice_cg109_refer_24h", "cg109", "1.1.4.2", ["disposition"],
         "Refer urgently for cardiovascular assessment, reviewed by an appropriate specialist within 24 hours, anyone with TLoC who also has an ECG abnormality, heart failure, TLoC during exertion, a family history of sudden cardiac death in people aged younger than 40 years or an inherited cardiac condition, new or unexplained breathlessness, or a heart murmur.",
         "Geçici bilinç kaybıyla birlikte EKG anormalliği, kalp yetmezliği, efor sırasında bilinç kaybı, 40 yaş altında ani kardiyak ölüm aile öyküsü veya kalıtsal kardiyak hastalık, yeni ya da açıklanamayan nefes darlığı veya kalp üfürümü olan herkesi uygun bir uzmanca 24 saat içinde değerlendirilmek üzere acil kardiyovasküler değerlendirmeye yönlendirin.",
         CHB + SYNC, specialties=["cardiology", "emergency"]))
    a(_c("gs_jcs22_avb_tte", "jcs_arr22", "AV block: diagnosis", ["workup"],
         "Perform TTE in patients with Mobitz type II 2nd-degree AV block, 2:1 AV block, paroxysmal AV block, advanced AV block, or complete AV block, and consider advanced diagnostic imaging when infiltrative cardiomyopathy, endocarditis, or adult congenital heart disease is suspected.",
         "Mobitz tip II ikinci derece AV blok, 2:1 AV blok, paroksismal AV blok, ileri AV blok veya tam AV bloğu olan hastalarda TTE yapın; infiltratif kardiyomiyopati, endokardit veya erişkin konjenital kalp hastalığından şüphelenildiğinde ileri tanısal görüntülemeyi düşünün.",
         CHB, specialties=["cardiology"]))

    # ---- Syncope, undifferentiated (NICE CG109) ------------------------------
    a(_c("gs_nice_cg109_uncomplicated_faint", "cg109", "1.1.4.3", ["history"],
         "Diagnose uncomplicated faint on the basis of the initial assessment when there are no features that suggest an alternative diagnosis and there are features suggestive of uncomplicated faint (the 3 'P's): posture (prolonged standing), provoking factors (such as pain or a medical procedure) and prodromal symptoms (such as sweating or feeling warm or hot before TLoC).",
         "Başka bir tanıyı düşündüren özellik yoksa ve komplike olmayan bayılmayı düşündüren özellikler (3 'P') varsa, ilk değerlendirmeye dayanarak komplike olmayan bayılma tanısı koyun: postür (uzun süre ayakta durma), tetikleyiciler (ağrı veya tıbbi bir işlem gibi) ve prodromal belirtiler (bilinç kaybından önce terleme veya sıcaklık hissi gibi).",
         SYNC, specialties=["emergency"]))
    a(_c("gs_nice_cg109_initial_assessment", "cg109", "1.1.2.1", ["exam"],
         "After TLoC, assess and record details of any previous TLoC, the person's medical history and any family history of cardiac disease, current medication that may have contributed to TLoC, vital signs, lying and standing blood pressure if clinically appropriate, and other cardiovascular and neurological signs.",
         "Geçici bilinç kaybı sonrası önceki bilinç kayıplarının ayrıntılarını, kişinin tıbbi öyküsünü ve aile kalp hastalığı öyküsünü, bilinç kaybına katkıda bulunmuş olabilecek mevcut ilaçları, yaşamsal bulguları, klinik olarak uygunsa yatarken ve ayakta kan basıncını ve diğer kardiyovasküler ve nörolojik bulguları değerlendirip kaydedin.",
         SYNC, specialties=["emergency"]))

    # ======================= EMERGENCY: arrest, drowning ======================
    a(_c("gs_costr20_epinephrine", "costr20als", "Vasopressors in cardiac arrest", ["treatment"],
         "ILCOR recommends administration of epinephrine during CPR: for nonshockable rhythms (pulseless electric activity or asystole) as soon as feasible, and for shockable rhythms (VF/pVT) after initial defibrillation attempts are unsuccessful; it suggests against vasopressin in place of or in addition to epinephrine.",
         "ILCOR, KPR sırasında epinefrin uygulanmasını önerir: şoklanamayan ritimlerde (nabızsız elektriksel aktivite veya asistoli) mümkün olan en kısa sürede, şoklanabilir ritimlerde (VF/nabızsız VT) ilk defibrilasyon girişimleri başarısız olduktan sonra; epinefrin yerine veya ona ek olarak vazopresin önermez.",
         ARREST, specialties=["emergency"]))
    a(_c("gs_costr20_capnography", "costr20als", "Airway: confirmation of tube placement", ["workup"],
         "ILCOR recommends using waveform capnography to confirm and continuously monitor the position of a tracheal tube during CPR in addition to clinical assessment.",
         "ILCOR, KPR sırasında trakeal tüpün yerini klinik değerlendirmeye ek olarak dalga formlu kapnografiyle doğrulamayı ve sürekli izlemeyi önerir.",
         ARREST, specialties=["emergency"]))
    a(_c("gs_costr20_pocus_reversible", "costr20als", "Point-of-care echocardiography", ["workup"],
         "If cardiac ultrasound can be performed without interfering with standard advanced cardiovascular life support protocols, it may be considered as an additional diagnostic tool to identify potentially reversible causes; avoid interpreting right-ventricular dilation in isolation as a diagnostic indicator of massive pulmonary embolism.",
         "Kardiyak ultrason standart ileri kardiyak yaşam desteği protokollerini aksatmadan yapılabiliyorsa, potansiyel olarak geri döndürülebilir nedenleri belirlemek için ek bir tanı aracı olarak düşünülebilir; sağ ventrikül dilatasyonunu tek başına masif pulmoner embolinin tanısal göstergesi olarak yorumlamayın.",
         ARREST, specialties=["emergency"]))
    a(_c("gs_costr20_ttm_after_rosc", "costr20als", "Postresuscitation care: temperature management", ["disposition"],
         "ILCOR recommends targeted temperature management for adults with out-of-hospital cardiac arrest with an initial shockable rhythm who remain unresponsive after ROSC, selecting and maintaining a constant target temperature between 32 °C and 36 °C.",
         "ILCOR, başlangıç ritmi şoklanabilir olan ve ROSC sonrası yanıtsız kalan hastane dışı kardiyak arestli erişkinlerde hedeflenmiş sıcaklık yönetimini ve 32 °C ile 36 °C arasında sabit bir hedef sıcaklığın seçilip korunmasını önerir.",
         ARREST, specialties=["emergency"]))
    a(_c("gs_costr23_ecpr", "costr23", "Extracorporeal CPR", ["disposition"],
         "ILCOR suggests that ECPR may be considered as a rescue therapy for selected patients with out-of-hospital cardiac arrest when conventional CPR is failing to restore spontaneous circulation in settings in which this can be implemented.",
         "ILCOR, uygulanabildiği ortamlarda konvansiyonel KPR spontan dolaşımı geri getiremediğinde seçilmiş hastane dışı kardiyak arest hastalarında ECPR'nin kurtarma tedavisi olarak düşünülebileceğini önerir.",
         ARREST, specialties=["emergency"]))
    a(_c("gs_costr23_drowning_aed", "costr23", "Drowning: AED use", ["treatment"],
         "In cardiac arrest after drowning, CPR should be started first and an AED used once CPR has started; dry the chest and ensure that the patient is not in water during attempted defibrillation.",
         "Boğulma sonrası kardiyak arestte önce KPR başlatılmalı ve KPR başladıktan sonra OED kullanılmalıdır; defibrilasyon girişimi sırasında göğsü kurulayın ve hastanın suyun içinde olmadığından emin olun.",
         DROWN, specialties=["emergency"]))
    a(_c("gs_costr23_drowning_ventilation_oxygen", "costr23", "Drowning: ventilation and oxygen", ["treatment"],
         "For health care professionals, provide ventilation in addition to chest compressions in cardiac arrest caused by drowning, and use the highest possible inspired oxygen concentration during resuscitation after drowning.",
         "Sağlık profesyonelleri boğulmaya bağlı kardiyak arestte göğüs kompresyonlarına ek olarak ventilasyon sağlamalı ve boğulma sonrası resüsitasyonda mümkün olan en yüksek inspire oksijen konsantrasyonunu kullanmalıdır.",
         DROWN, specialties=["emergency"]))
    a(_c("gs_costr23_drowning_spo2_unreliable", "costr23", "Drowning: post-ROSC oxygen titration", ["disposition"],
         "After drowning, follow the advanced life support recommendations for oxygen titration after ROSC, recognising that peripheral vasoconstriction may make pulse oximetry unreliable.",
         "Boğulma sonrası ROSC'tan sonra oksijen titrasyonu için ileri yaşam desteği önerilerini izleyin ve periferik vazokonstriksiyonun nabız oksimetresini güvenilmez kılabileceğini unutmayın.",
         DROWN, specialties=["emergency"]))

    # ---- Heat stroke --------------------------------------------------------
    HEAT, HYPO, TRAUMA, POISON, DIZZY, DYSP, FEVER, DVT = (["T67.0"], ["T68"], ["T07"], ["T65.9"], ["R42"],
                                                           ["R06.0"], ["R50.9"], ["I82.409"])
    a(_c("gs_cdc_heat_stroke_signs", "cdc_heat", "Heat stroke: symptoms", ["triage"],
         "Heat stroke is the most serious heat-related illness: the body temperature rises rapidly, the sweating mechanism fails, and symptoms include confusion, altered mental status, slurred speech, loss of consciousness, hot dry skin or profuse sweating, seizures and very high body temperature; it is fatal if treatment is delayed.",
         "Isı çarpması ısıya bağlı en ağır hastalıktır: vücut ısısı hızla yükselir, terleme mekanizması bozulur; belirtiler konfüzyon, bilinç değişikliği, peltek konuşma, bilinç kaybı, sıcak kuru deri veya yoğun terleme, nöbetler ve çok yüksek vücut ısısıdır; tedavi gecikirse ölümcüldür.",
         HEAT, specialties=["emergency"], countries=["US"]))
    a(_c("gs_cdc_heat_stroke_cooling", "cdc_heat", "Heat stroke: first aid", ["treatment"],
         "For heat stroke call for emergency medical care, move the person to a shaded, cool area, remove outer clothing and cool them quickly, with a cold water or ice bath if possible, or by wetting the skin, placing cold wet cloths or ice on the head, neck, armpits and groin, and circulating the air.",
         "Isı çarpmasında acil tıbbi yardım çağırın, kişiyi gölge ve serin bir alana alın, dış giysilerini çıkarın ve hızla soğutun: mümkünse soğuk su veya buz banyosuyla, ya da cildi ıslatarak, baş, boyun, koltuk altı ve kasıklara soğuk ıslak bez veya buz koyarak ve havayı dolaştırarak.",
         HEAT, specialties=["emergency"], countries=["US"]))
    a(_c("gs_heatcn20_cooling_targets", "heat_cn20", "On-site treatment: rapid cooling", ["treatment"],
         "The core temperature should be reduced below 39.0 °C within 30 min and below 38.5 °C within 2 h; stop cooling or reduce its intensity when the core temperature drops to 38.5 °C and maintain a rectal temperature of 37.0 to 38.5 °C to avoid hypothermia.",
         "Çekirdek ısı 30 dakika içinde 39,0 °C'nin, 2 saat içinde 38,5 °C'nin altına indirilmelidir; çekirdek ısı 38,5 °C'ye düştüğünde soğutmayı durdurun veya yoğunluğunu azaltın ve hipotermiden kaçınmak için rektal ısıyı 37,0-38,5 °C'de tutun.",
         HEAT, specialties=["emergency"], countries=["GLOBAL", "CN"]))
    a(_c("gs_heatcn20_rectal_temp", "heat_cn20", "Diagnosis: core temperature", ["exam"],
         "Rectal temperature is recommended as the standard mode for acquiring core temperature; if the history and clinical presentation are consistent with heat stroke, it cannot be excluded simply because the body temperature does not exceed 40 °C.",
         "Çekirdek ısıyı ölçmek için standart yöntem olarak rektal ısı önerilir; öykü ve klinik tablo ısı çarpmasıyla uyumluysa, vücut ısısı 40 °C'yi aşmıyor diye ısı çarpması dışlanamaz.",
         HEAT, specialties=["emergency"], countries=["GLOBAL", "CN"]))
    a(_c("gs_heatcn20_no_antipyretics", "heat_cn20", "On-site treatment: cooling by medication", ["treatment"],
         "Due to thermoregulatory center dysfunction in the early stage of heat stroke, the use of drugs, including nonsteroidal drugs and artificial hibernation compounds, to reduce body temperature during treatment on site is not recommended.",
         "Isı çarpmasının erken evresinde termoregülasyon merkezi işlev bozukluğu nedeniyle, sahada vücut ısısını düşürmek için nonsteroid ilaçlar ve yapay hibernasyon bileşikleri dahil ilaç kullanımı önerilmez.",
         HEAT, specialties=["emergency"], countries=["GLOBAL", "CN"]))

    # ---- Accidental hypothermia -------------------------------------------
    a(_c("gs_hypo21_staging_consciousness", "hypo21", "Diagnosis and staging", ["exam"],
         "Shivering should not be used to diagnose the degree of hypothermia, but if a patient is shivering, core temperature is 30 °C or higher; using the level of consciousness is the best way to assess hypothermia if a core temperature cannot be measured.",
         "Titreme hipoterminin derecesini belirlemek için kullanılmamalıdır; ancak hasta titriyorsa çekirdek ısı 30 °C veya üzerindedir; çekirdek ısı ölçülemiyorsa hipotermiyi değerlendirmenin en iyi yolu bilinç düzeyidir.",
         HYPO, specialties=["emergency"]))
    a(_c("gs_hypo21_gentle_horizontal", "hypo21", "Out-of-hospital management", ["treatment"],
         "Patients should be transported gently and horizontally to avoid triggering hypothermic cardiac arrest (rescue collapse); a hypothermic patient should be packaged with several layers, with wet clothing removed in a protected environment and heat packs applied to the trunk without touching the skin.",
         "Hipotermik kardiyak aresti (kurtarma kollapsı) tetiklememek için hastalar nazikçe ve yatay pozisyonda taşınmalıdır; hipotermik hasta birkaç katmanla sarılmalı, ıslak giysiler korunaklı bir ortamda çıkarılmalı ve ısı paketleri cilde temas etmeden gövdeye uygulanmalıdır.",
         HYPO, specialties=["emergency"]))
    a(_c("gs_hypo21_arrest_drugs_shocks", "hypo21", "Hypothermic cardiac arrest", ["treatment"],
         "In hypothermic cardiac arrest, if ventricular fibrillation persists after three shocks and the core temperature is below 30 °C, delay further defibrillation until the core temperature is above 30 °C; do not give epinephrine and amiodarone if the core temperature is below 30 °C.",
         "Hipotermik kardiyak arestte üç şoktan sonra ventriküler fibrilasyon sürüyor ve çekirdek ısı 30 °C'nin altındaysa, çekirdek ısı 30 °C'nin üzerine çıkana kadar ek defibrilasyonu erteleyin; çekirdek ısı 30 °C'nin altındaysa epinefrin ve amiodaron vermeyin.",
         HYPO + ARREST, specialties=["emergency"]))
    a(_c("gs_hypo21_ecls_criteria", "hypo21", "Patient referral and transport", ["disposition"],
         "The criteria for the direct transfer of a hypothermic patient to an ECLS centre are cardiac arrest, core temperature below 30 °C, systolic blood pressure below 90 mmHg, or ventricular dysrhythmia.",
         "Hipotermik hastanın doğrudan bir ECLS merkezine nakil kriterleri kardiyak arest, 30 °C'nin altında çekirdek ısı, 90 mmHg'nin altında sistolik kan basıncı veya ventriküler disritmidir.",
         HYPO, specialties=["emergency"]))

    # ---- Polytrauma --------------------------------------------------------
    a(_c("gs_eu23_trauma_tourniquet_compression", "trauma_eu23", "Recommendation 2", ["triage", "treatment"],
         "Use local compression of open wounds to limit life-threatening bleeding, and adjunct tourniquet use to stop life-threatening bleeding from open extremity injuries in the pre-surgical setting.",
         "Yaşamı tehdit eden kanamayı sınırlamak için açık yaralara lokal bası uygulayın ve cerrahi öncesi ortamda açık ekstremite yaralanmalarından kaynaklanan yaşamı tehdit eden kanamayı durdurmak için ek olarak turnike kullanın.",
         TRAUMA, specialties=["emergency", "trauma"]))
    a(_c("gs_eu23_trauma_airway", "trauma_eu23", "Recommendation 3", ["triage"],
         "Perform endotracheal intubation or alternative airway management without delay in the presence of airway obstruction, altered consciousness (GCS 8 or less), hypoventilation or hypoxaemia, and avoid hypoxaemia.",
         "Hava yolu tıkanıklığı, bilinç değişikliği (GKS 8 veya altı), hipoventilasyon veya hipoksemi varlığında gecikmeden endotrakeal entübasyon veya alternatif hava yolu yönetimi uygulayın ve hipoksemiden kaçının.",
         TRAUMA, specialties=["emergency", "trauma"]))
    a(_c("gs_eu23_trauma_permissive_hypotension", "trauma_eu23", "Recommendation 13", ["treatment"],
         "In the initial phase following trauma, use a restricted volume replacement strategy with a target systolic blood pressure of 80 to 90 mmHg (mean arterial pressure 50 to 60 mmHg) until major bleeding has been stopped in the absence of brain injury; in severe TBI (GCS 8 or less) maintain a mean arterial pressure of 80 mmHg or more.",
         "Travma sonrası ilk evrede, beyin hasarı yoksa majör kanama durdurulana kadar hedef sistolik kan basıncı 80-90 mmHg (ortalama arter basıncı 50-60 mmHg) olan kısıtlı hacim replasmanı uygulayın; ağır travmatik beyin hasarında (GKS 8 veya altı) ortalama arter basıncını 80 mmHg veya üzerinde tutun.",
         TRAUMA, specialties=["emergency", "trauma"]))
    a(_c("gs_eu23_trauma_txa", "trauma_eu23", "Recommendation 23", ["treatment"],
         "Give tranexamic acid to the trauma patient who is bleeding or at risk of significant bleeding as soon as possible and within 3 h after injury, at a loading dose of 1 g infused over 10 min followed by an i.v. infusion of 1 g over 8 h, without awaiting a viscoelastic assessment.",
         "Kanayan veya ciddi kanama riski taşıyan travma hastasına traneksamik asidi mümkün olan en kısa sürede ve yaralanmadan sonraki 3 saat içinde, 10 dakikada infüze edilen 1 g yükleme dozu ve ardından 8 saatte 1 g IV infüzyon olarak, viskoelastik değerlendirmeyi beklemeden verin.",
         TRAUMA, specialties=["emergency", "trauma"]))
    a(_c("gs_eu23_trauma_lactate_hb", "trauma_eu23", "Recommendations 9 and 10", ["workup"],
         "Use repeated haemoglobin or haematocrit measurements as a laboratory marker for bleeding, as an initial value in the normal range may mask early-phase bleeding, and blood lactate (or base deficit) to estimate and monitor the extent of bleeding and tissue hypoperfusion.",
         "Normal aralıktaki başlangıç değeri erken evre kanamayı maskeleyebileceğinden kanamanın laboratuvar belirteci olarak tekrarlayan hemoglobin veya hematokrit ölçümlerini, kanamanın ve doku hipoperfüzyonunun boyutunu tahmin etmek ve izlemek için kan laktatını (veya baz açığını) kullanın.",
         TRAUMA, specialties=["emergency", "trauma"]))
    a(_c("gs_nice_ng39_wbct", "ng39", "1.5.34", ["workup"],
         "Use whole-body CT (a vertex-to-toes scanogram followed by CT from vertex to mid-thigh) in adults (16 or over) with blunt major trauma and suspected multiple injuries, and do not use FAST as a screening modality to determine the need for CT.",
         "Künt majör travması ve şüpheli çoklu yaralanması olan erişkinlerde (16 yaş ve üzeri) tüm vücut BT (verteksten ayak parmaklarına skanogram ve ardından verteksten uyluk ortasına BT) kullanın ve BT gereksinimini belirlemek için FAST'ı tarama yöntemi olarak kullanmayın.",
         TRAUMA, specialties=["emergency", "trauma"]))
    a(_c("gs_nice_ng39_pelvic_binder_plasma", "ng39", "1.5.3; 1.5.24", ["treatment"],
         "If active bleeding is suspected from a pelvic fracture after blunt high-energy trauma, apply a purpose-made pelvic binder; for adults use a ratio of 1 unit of plasma to 1 unit of red blood cells to replace fluid volume.",
         "Künt yüksek enerjili travma sonrası pelvis kırığından aktif kanamadan şüpheleniliyorsa amaca yönelik üretilmiş pelvik bağlayıcı uygulayın; erişkinlerde sıvı hacmini yerine koymak için 1 ünite plazmaya 1 ünite eritrosit oranı kullanın.",
         TRAUMA, specialties=["emergency", "trauma"]))
    a(_c("gs_nice_ng39_damage_control", "ng39", "1.5.29; 1.5.37", ["disposition"],
         "Limit diagnostic imaging to the minimum needed to direct intervention in patients with suspected haemorrhage and haemodynamic instability who are not responding to volume resuscitation, and use damage control surgery in these patients.",
         "Şüpheli kanaması ve hacim resüsitasyonuna yanıt vermeyen hemodinamik instabilitesi olan hastalarda tanısal görüntülemeyi girişimi yönlendirmek için gereken en aza indirin ve bu hastalarda hasar kontrol cerrahisi uygulayın.",
         TRAUMA, specialties=["emergency", "trauma"]))

    # ---- Poisoning, unknown agent -------------------------------------------
    a(_c("gs_isccm19_poison_abc", "isccm_poison19", "Initial assessment: first priorities", ["triage"],
         "As with any unstable or critically ill patient, resuscitation (airway, breathing, circulation) with basic life support takes priority in the poisoned patient, together with ensuring the safety of the healthcare workers; diagnostic evaluation and therapeutic interventions often are initiated simultaneously.",
         "Her instabil veya kritik hastada olduğu gibi zehirlenmiş hastada da temel yaşam desteğiyle resüsitasyon (hava yolu, solunum, dolaşım) önceliklidir ve sağlık çalışanlarının güvenliği sağlanmalıdır; tanısal değerlendirme ve tedavi girişimleri çoğu kez eş zamanlı başlatılır.",
         POISON, specialties=["toxicology", "emergency"], countries=["GLOBAL", "IN"]))
    a(_c("gs_isccm19_poison_toxidrome", "isccm_poison19", "Toxidromes", ["exam"],
         "Classes of toxin produce characteristic combinations of symptoms and signs called toxidromes; the toxidrome-oriented physical examination may provide valuable insight into the class of toxin involved.",
         "Toksin sınıfları toksidrom adı verilen karakteristik belirti ve bulgu kombinasyonları oluşturur; toksidroma yönelik fizik muayene ilgili toksin sınıfı hakkında değerli bilgi sağlayabilir.",
         POISON, specialties=["toxicology", "emergency"], countries=["GLOBAL", "IN"]))
    a(_c("gs_isccm19_poison_labs", "isccm_poison19", "Diagnostic testing", ["workup"],
         "Because the history may be inaccurate, obtain a complete blood count, electrolytes, BUN and creatinine, liver function tests, serum lactate, arterial blood gas, an electrocardiogram and a urine pregnancy test in all women of childbearing age; toxicology screening results seldom directly influence patient management.",
         "Öykü yanıltıcı olabileceğinden tam kan sayımı, elektrolitler, BUN ve kreatinin, karaciğer fonksiyon testleri, serum laktatı, arter kan gazı, elektrokardiyogram ve doğurganlık çağındaki tüm kadınlarda idrar gebelik testi isteyin; toksikoloji tarama sonuçları hasta yönetimini nadiren doğrudan etkiler.",
         POISON, specialties=["toxicology", "emergency"], countries=["GLOBAL", "IN"]))
    a(_c("gs_isccm19_poison_airway_rsi", "isccm_poison19", "Supportive care: airway management", ["treatment"],
         "The loss of airway-protective reflexes and concern for aspiration or the presence of respiratory failure dictates the need to secure the airway; unless the patient is moribund, rapid sequence intubation with preoxygenation and neuromuscular blockade is the best approach.",
         "Hava yolu koruyucu reflekslerin kaybı ve aspirasyon endişesi ya da solunum yetmezliği varlığı hava yolunun güvenceye alınmasını gerektirir; hasta ölmek üzere değilse preoksijenasyon ve nöromüsküler blokajla hızlı ardışık entübasyon en iyi yaklaşımdır.",
         POISON, specialties=["toxicology", "emergency"], countries=["GLOBAL", "IN"]))

    # ---- Dizziness / vertigo, undifferentiated ------------------------------
    a(_c("gs_barany22_isolated_vertigo_stroke", "barany_vasc22", "Introduction; criteria for vascular vertigo", ["history", "exam"],
         "Strokes involving the brainstem or cerebellum can present with isolated vertigo, dizziness or imbalance; features that point to a vascular cause include focal neurological signs, at least one component of central HINTS (normal head impulse test, direction-changing gaze-evoked nystagmus or pronounced skew deviation), other central ocular motor abnormalities and increased risk for vascular events.",
         "Beyin sapı veya serebellumu tutan inmeler izole vertigo, baş dönmesi veya dengesizlikle başvurabilir; vasküler nedeni düşündüren özellikler fokal nörolojik bulgular, santral HINTS'in en az bir bileşeni (normal baş impuls testi, yön değiştiren bakışla uyarılan nistagmus veya belirgin skew deviasyonu), diğer santral okülomotor anormallikler ve artmış vasküler olay riskidir.",
         DIZZY + ["H81.1"], specialties=["neurology", "emergency"]))
    a(_c("gs_barany22_mri_false_negative", "barany_vasc22", "Notes: neuroimaging", ["workup"],
         "Although a diagnosis of acute stroke is primarily based on neuroimaging, initial MRIs including diffusion-weighted images are falsely negative in 12 to 50% within the first 48 hours in patients who are eventually determined to have had a stroke.",
         "Akut inme tanısı öncelikle nörogörüntülemeye dayansa da, sonunda inme geçirdiği belirlenen hastalarda difüzyon ağırlıklı görüntüler dahil ilk MRG'ler ilk 48 saatte yüzde 12-50 oranında yanlış negatiftir.",
         DIZZY, specialties=["neurology", "emergency"]))
    a(_c("gs_barany22_head_impulse", "barany_vasc22", "Notes: bedside examination", ["exam"],
         "Bedside head impulse testing is a good tool for differentiating isolated vertigo due to cerebellar strokes from acute unilateral vestibulopathy or vestibular neuritis; of the three bedside signs of HINTS, the horizontal head impulse test had the greatest combined sensitivity (0.85) and specificity (0.95) for central causes.",
         "Yatak başı baş impuls testi serebellar inmelere bağlı izole vertigoyu akut tek taraflı vestibülopati veya vestibüler nöritten ayırmada iyi bir araçtır; HINTS'in üç yatak başı bulgusundan yatay baş impuls testi santral nedenler için en yüksek birleşik duyarlılığa (0,85) ve özgüllüğe (0,95) sahiptir.",
         DIZZY, specialties=["neurology", "emergency"]))
    a(_c("gs_barany22_auvp_criteria", "barany_auvp22", "Diagnostic criteria for acute unilateral vestibulopathy", ["exam"],
         "Acute unilateral vestibulopathy requires acute or subacute onset of sustained spinning or non-spinning vertigo of moderate to severe intensity lasting at least 24 hours, spontaneous peripheral vestibular nystagmus that is direction-fixed and enhanced by removal of visual fixation, unambiguous evidence of reduced VOR function on the side opposite the fast phase, and no evidence for acute central disease.",
         "Akut tek taraflı vestibülopati; en az 24 saat süren, orta-ağır şiddette, akut veya subakut başlangıçlı sürekli dönme tipi veya dönme dışı vertigo, yönü sabit ve görsel fiksasyonun kaldırılmasıyla artan spontan periferik vestibüler nistagmus, hızlı fazın karşı tarafında azalmış VOR işlevine dair kesin kanıt ve akut santral hastalık kanıtı olmamasını gerektirir.",
         DIZZY, specialties=["neurology", "emergency"]))

    # ---- Dyspnoea, undifferentiated -----------------------------------------
    a(_c("gs_nice_ng158_pe_symptoms_cxr", "ng158", "1.1.15", ["history", "workup"],
         "For people who present with signs or symptoms of PE, such as chest pain, shortness of breath or coughing up blood, assess their general medical history, do a physical examination and offer a chest X-ray to exclude other causes.",
         "Göğüs ağrısı, nefes darlığı veya kan tükürme gibi PE belirti ya da bulgularıyla başvuranlarda genel tıbbi öyküyü değerlendirin, fizik muayene yapın ve diğer nedenleri dışlamak için akciğer grafisi önerin.",
         DYSP + ["I26.9", "R04.2"], specialties=["respiratory", "emergency"]))
    a(_c("gs_nice_ng158_perc", "ng158", "1.1.16", ["workup"],
         "If clinical suspicion of PE is low based on the overall clinical impression, from general medical history, physical examination and any initial investigations such as electrocardiography or chest X-ray, and other diagnoses are feasible, consider using the pulmonary embolism rule-out criteria (PERC) to help determine whether any further investigations for PE are needed.",
         "Genel tıbbi öykü, fizik muayene ve elektrokardiyografi veya akciğer grafisi gibi ilk tetkiklere dayanan genel klinik izlenime göre PE şüphesi düşükse ve başka tanılar olası ise, PE için ek tetkik gerekip gerekmediğine karar vermek için pulmoner emboli dışlama kriterlerini (PERC) kullanmayı düşünün.",
         DYSP + ["I26.9"], specialties=["respiratory", "emergency"]))
    a(_c("gs_nice_ng253_oxygen_targets", "ng253ab", "1.10.1", ["treatment"],
         "In suspected sepsis give oxygen to achieve a target saturation of 94% to 98% for people aged 18 years or over, or 88% to 92% for those at risk of hypercapnic respiratory failure.",
         "Şüpheli sepsiste 18 yaş ve üzerindekilerde yüzde 94-98, hiperkapnik solunum yetmezliği riski taşıyanlarda yüzde 88-92 hedef satürasyona ulaşmak için oksijen verin.",
         DYSP + FEVER + ["A41.9"], specialties=["emergency"]))

    # ---- Fever, undifferentiated --------------------------------------------
    a(_c("gs_nice_ng253_could_this_be_sepsis", "ng253cs", "1.1.1; 1.1.2", ["triage"],
         "Think 'could this be sepsis?' if a person presents with symptoms or signs that indicate possible infection, taking into account that people with sepsis may have non-specific, non-localised presentations, for example feeling very unwell, and may not have a high temperature.",
         "Olası enfeksiyonu gösteren belirti veya bulgularla başvuran kişide 'bu sepsis olabilir mi?' diye düşünün; sepsisli kişilerin örneğin kendini çok kötü hissetme gibi özgül olmayan, lokalize olmayan tablolarla başvurabileceğini ve yüksek ateşlerinin olmayabileceğini göz önünde bulundurun.",
         FEVER + ["A41.9"], specialties=["emergency", "infectious"]))
    a(_c("gs_nice_ng253_observations", "ng253f2f", "1.3.1", ["exam"],
         "Assess temperature, heart rate, respiratory rate, blood pressure, level of consciousness and oxygen saturation in people with suspected sepsis.",
         "Şüpheli sepsiste ateş, kalp hızı, solunum sayısı, kan basıncı, bilinç düzeyi ve oksijen satürasyonunu değerlendirin.",
         FEVER + ["A41.9"], specialties=["emergency", "infectious"]))
    a(_c("gs_nice_ng253_skin_exam", "ng253f2f", "1.3.3", ["exam"],
         "Examine people with suspected sepsis for mottled or ashen appearance, cyanosis of the skin, lips or tongue, non-blanching petechial or purpuric rash, any breach of skin integrity (for example, cuts, burns or skin infections) and other rash indicating potential infection.",
         "Şüpheli sepsisli kişileri benekli veya kül rengi görünüm, cilt, dudak veya dilde siyanoz, solmayan peteşiyal veya purpurik döküntü, cilt bütünlüğünün herhangi bir bozulması (örneğin kesikler, yanıklar veya cilt enfeksiyonları) ve olası enfeksiyonu gösteren diğer döküntüler açısından muayene edin.",
         FEVER + ["A41.9"], specialties=["emergency", "infectious"]))
    a(_c("gs_nice_ng253_fever_not_rule", "ng253f2f", "1.4.1; 1.4.2", ["triage"],
         "Do not rely on fever or hypothermia alone to rule sepsis either in or out, and take into account that some groups of people with sepsis may not develop a raised temperature, including people who are older or very frail, people having treatment for cancer, people severely ill with sepsis and people with a spinal cord injury.",
         "Sepsisi doğrulamak veya dışlamak için yalnızca ateşe veya hipotermiye güvenmeyin; yaşlı veya çok kırılgan kişiler, kanser tedavisi alanlar, sepsisle ağır hasta olanlar ve omurilik yaralanması olanlar gibi bazı sepsisli grupların ateşinin yükselmeyebileceğini göz önünde bulundurun.",
         FEVER + ["A41.9"], specialties=["emergency", "infectious"]))
    a(_c("gs_nice_ng253_neutropenic_suspect", "ng253cs", "1.1.10; 1.1.11", ["history", "disposition"],
         "Suspect neutropenic sepsis in people who become unwell and are having or have had systemic anticancer treatment within the last 30 days, or are receiving or have received immunosuppressant treatment, and refer patients with suspected neutropenic sepsis immediately for assessment in secondary or tertiary care.",
         "Son 30 gün içinde sistemik antikanser tedavi alan veya almış ya da immünosupresif tedavi alan veya almış olup kötüleşen kişilerde nötropenik sepsisten şüphelenin ve şüpheli nötropenik sepsisli hastaları ikinci veya üçüncü basamakta değerlendirilmek üzere hemen yönlendirin.",
         FEVER + ["D70.9", "C95.00"], specialties=["emergency", "oncology"]))

    # ---- Deep vein thrombosis (NICE NG158) ------------------------------------
    a(_c("gs_nice_ng158_dvt_wells", "ng158", "1.1.1; 1.1.2", ["history"],
         "For people who present with signs or symptoms of DVT, such as a swollen or painful leg, assess their general medical history and do a physical examination to exclude other causes, and if DVT is suspected use the 2-level DVT Wells score to estimate the clinical probability of DVT.",
         "Şişmiş veya ağrılı bacak gibi DVT belirti ya da bulgularıyla başvuranlarda diğer nedenleri dışlamak için genel tıbbi öyküyü değerlendirip fizik muayene yapın; DVT'den şüpheleniliyorsa klinik olasılığı tahmin etmek için iki düzeyli DVT Wells skorunu kullanın.",
         DVT, specialties=["haematology"]))
    a(_c("gs_nice_ng158_dvt_likely_us", "ng158", "1.1.3; 1.1.4", ["workup"],
         "Offer people with a likely DVT Wells score (2 points or more) a proximal leg vein ultrasound scan with the result available within 4 hours if possible, and a D-dimer test if the scan result is negative; if the scan cannot be obtained within 4 hours, offer a D-dimer test, then interim therapeutic anticoagulation and the scan.",
         "DVT Wells skoru olası (2 puan veya üzeri) olanlara mümkünse sonucu 4 saat içinde alınacak proksimal bacak venöz ultrasonu ve tarama negatifse D-dimer testi önerin; tarama 4 saat içinde yapılamıyorsa D-dimer testi, ardından geçici terapötik antikoagülasyon ve tarama önerin.",
         DVT, specialties=["haematology"]))
    a(_c("gs_nice_ng158_dvt_unlikely_ddimer", "ng158", "1.1.8", ["workup"],
         "Offer people with an unlikely DVT Wells score (1 point or less) a D-dimer test with the result available within 4 hours, or if the D-dimer test result cannot be obtained within 4 hours, offer interim therapeutic anticoagulation while awaiting the result.",
         "DVT Wells skoru olası olmayan (1 puan veya altı) kişilere sonucu 4 saat içinde alınacak D-dimer testi önerin; D-dimer sonucu 4 saat içinde alınamıyorsa beklerken geçici terapötik antikoagülasyon önerin.",
         DVT, specialties=["haematology"]))
    a(_c("gs_nice_ng158_doac_3_months", "ng158", "1.3.5; 1.3.8", ["treatment", "disposition"],
         "Offer either apixaban or rivaroxaban to people with confirmed proximal DVT or PE, and offer anticoagulation treatment for at least 3 months.",
         "Doğrulanmış proksimal DVT veya PE'si olanlara apiksaban ya da rivaroksaban önerin ve en az 3 ay antikoagülan tedavi önerin.",
         DVT + ["I26.9"], specialties=["haematology"]))

    # ======================= ENDOCRINE =======================================
    ADR, T2DM, HHS, HCA, HYPOG, HNA, HYPOT, PHEO, STORM = (["E27.2"], ["E11.9"], ["E11.00"], ["E83.52"], ["E16.2"],
                                                          ["E87.1"], ["E03.9"], ["E27.5"], ["E05.91"])
    # ---- Adrenal crisis (NICE NG243) -------------------------------------
    a(_c("gs_nice_ng243_suspect_crisis", "ng243", "1.6.1; 1.6.2", ["triage", "history"],
         "Consider adrenal crisis as a potentially reversible cause in people who are critically unwell with low blood pressure (including postural hypotension), hyperpigmentation, hyponatraemia, hypoglycaemia, circulatory shock or collapse, or a condition failing to respond to initial treatments, and in people with or at high risk of adrenal insufficiency who are unwell with milder symptoms such as lethargy, pallor, clamminess, confusion or weakness.",
         "Düşük kan basıncı (postüral hipotansiyon dahil), hiperpigmentasyon, hiponatremi, hipoglisemi, dolaşım şoku veya kollaps ya da ilk tedavilere yanıt vermeyen tablo ile kritik hasta olan kişilerde ve adrenal yetmezliği olan veya yüksek riskli olup letarji, solukluk, soğuk terleme, konfüzyon veya güçsüzlük gibi daha hafif belirtilerle kötüleşen kişilerde adrenal krizi potansiyel olarak geri döndürülebilir bir neden olarak düşünün.",
         ADR, specialties=["endocrine"]))
    a(_c("gs_nice_ng243_hydrocortisone_now", "ng243", "1.7.1; 1.4.6", ["treatment"],
         "Give intravenous or intramuscular hydrocortisone for suspected adrenal crisis immediately, being aware that the intramuscular dose can be given by anyone and there is no risk of overdose from hydrocortisone in an emergency situation; give 100 mg intramuscular or intravenous hydrocortisone to people admitted who are unable to absorb oral glucocorticoids.",
         "Şüpheli adrenal krizde intravenöz veya intramüsküler hidrokortizonu hemen verin; intramüsküler dozun herkes tarafından verilebileceğini ve acil durumda hidrokortizonla doz aşımı riski olmadığını unutmayın; oral glukokortikoidi emilemeyen yatırılan hastalara 100 mg intramüsküler veya intravenöz hidrokortizon verin.",
         ADR, specialties=["endocrine"]))
    a(_c("gs_nice_ng243_saline_monitor", "ng243", "1.7.3; 1.7.4", ["treatment"],
         "Give 1 litre of 0.9% sodium chloride intravenous infusion over 30 minutes to the person having an adrenal crisis, and ensure frequent monitoring of blood pressure, heart rate, electrolyte and glucose status.",
         "Adrenal kriz yaşayan kişiye 30 dakikada 1 litre yüzde 0,9 sodyum klorür intravenöz infüzyonu verin ve kan basıncı, kalp hızı, elektrolit ve glukoz durumunu sık izleyin.",
         ADR, specialties=["endocrine"]))
    a(_c("gs_nice_ng243_continue_cause_refer", "ng243", "1.7.5; 1.7.8; 1.7.9", ["disposition"],
         "Continue hydrocortisone by intravenous infusion over 24 hours, or intramuscular or intravenous injections 4 times a day, until the person is haemodynamically stable and able to take and absorb oral glucocorticoids; identify and treat any underlying cause and refer to the specialist endocrine team.",
         "Kişi hemodinamik olarak stabil olana ve oral glukokortikoidi alıp emebilene kadar hidrokortizona 24 saatlik intravenöz infüzyon veya günde 4 kez intramüsküler ya da intravenöz enjeksiyonla devam edin; altta yatan nedeni bulup tedavi edin ve uzman endokrin ekibine yönlendirin.",
         ADR, specialties=["endocrine"]))

    # ---- Newly diagnosed type 2 diabetes (NICE NG28, 2026 update) -------------
    a(_c("gs_nice_ng28_metformin_sglt2", "ng28im", "1.13.1; 1.14.1; 1.15.1", ["treatment"],
         "For adults with type 2 diabetes and no relevant comorbidity, offer modified-release metformin and an SGLT-2 inhibitor; the same applies to adults with heart failure, and adults with atherosclerotic cardiovascular disease are also offered subcutaneous semaglutide.",
         "İlgili eşlik eden hastalığı olmayan tip 2 diyabetli erişkinlere modifiye salımlı metformin ve SGLT-2 inhibitörü önerin; aynısı kalp yetmezliği olanlar için geçerlidir; aterosklerotik kardiyovasküler hastalığı olanlara ek olarak subkütan semaglutid önerilir.",
         T2DM, specialties=["endocrine"]))
    a(_c("gs_nice_ng28_hba1c_targets", "ng28bg", "1.5.7; 1.5.8", ["disposition"],
         "For adults managed by healthy living and diet, or with an initial regimen not associated with hypoglycaemia, support them to aim for an HbA1c level of 48 mmol/mol (6.5%); for adults on a medicine associated with hypoglycaemia, aim for 53 mmol/mol (7.0%).",
         "Sağlıklı yaşam ve diyetle ya da hipoglisemiyle ilişkili olmayan bir başlangıç rejimiyle izlenen erişkinlerin HbA1c düzeyini 48 mmol/mol (yüzde 6,5), hipoglisemiyle ilişkili bir ilaç kullananlarınkini 53 mmol/mol (yüzde 7,0) hedeflemesini destekleyin.",
         T2DM, specialties=["endocrine"]))
    a(_c("gs_nice_ng28_hba1c_monitoring", "ng28bg", "1.5.1", ["workup"],
         "Measure HbA1c levels in adults with type 2 diabetes every 3 to 6 months until HbA1c is stable on unchanging therapy, and every 6 months once the HbA1c level and blood glucose lowering therapy are stable.",
         "Tip 2 diyabetli erişkinlerde HbA1c'yi değişmeyen tedaviyle stabil olana kadar 3-6 ayda bir, HbA1c ve glukoz düşürücü tedavi stabil olduğunda 6 ayda bir ölçün.",
         T2DM, specialties=["endocrine"]))
    a(_c("gs_nice_ng28_structured_education", "ng28ed", "1.2.1", ["disposition"],
         "Offer structured education to adults with type 2 diabetes and their family members or carers at the time of diagnosis, with annual reinforcement and review.",
         "Tip 2 diyabetli erişkinlere ve aile üyelerine veya bakım verenlerine tanı anında yapılandırılmış eğitim önerin ve bunu yıllık olarak pekiştirip gözden geçirin.",
         T2DM, specialties=["endocrine"]))

    # ---- Hyperosmolar hyperglycaemic state (JBDS 06) -------------------------
    a(_c("gs_jbds_hhs_criteria", "jbds_hhs22", "Diagnosis", ["workup"],
         "Characteristic features of HHS are marked hypovolaemia, a measured or calculated serum osmolality usually of 320 mOsm/kg or more, marked hyperglycaemia (30 mmol/L or more) without significant hyperketonaemia (ketones 3.0 mmol/L or less) and without significant acidosis (pH 7.3 or more and bicarbonate 15.0 mmol/L or more); a mixed picture of HHS and DKA occurs relatively frequently.",
         "HHS'nin karakteristik özellikleri belirgin hipovolemi, genellikle 320 mOsm/kg veya üzeri ölçülen ya da hesaplanan serum osmolalitesi, belirgin hiperglisemi (30 mmol/L veya üzeri), anlamlı hiperketonemi (keton 3,0 mmol/L veya altı) ve anlamlı asidoz (pH 7,3 veya üzeri ve bikarbonat 15,0 mmol/L veya üzeri) olmamasıdır; HHS ve DKA'nın karışık tablosu oldukça sık görülür.",
         HHS, specialties=["endocrine"]))
    a(_c("gs_jbds_hhs_fluids_first", "jbds_hhs22", "Fluid replacement and insulin", ["treatment"],
         "Fluid replacement alone will lower glucose concentrations: a fixed rate intravenous insulin infusion should not be started as part of the initial treatment unless significant ketonaemia is present (more than 3.0 mmol/L or urine ketones more than 2+); intravenous fluids should be administered first and the infusion started only once the glucose has stopped falling, at 0.05 units/kg/hr.",
         "Yalnızca sıvı replasmanı glukoz düzeylerini düşürür: anlamlı ketonemi yoksa (3,0 mmol/L üzeri veya idrar ketonu 2+ üzeri) sabit hızlı intravenöz insülin infüzyonu ilk tedavinin parçası olarak başlatılmamalıdır; önce intravenöz sıvı verilmeli ve infüzyon ancak glukoz düşmeyi bıraktığında saatte 0,05 ünite/kg ile başlatılmalıdır.",
         HHS, specialties=["endocrine"]))
    a(_c("gs_jbds_hhs_rate_limits", "jbds_hhs22", "Executive summary", ["treatment"],
         "In HHS the fall in osmolality should not be more than 3.0 to 8.0 mOsm/kg/hr, the fall in glucose should not be more than 5.0 mmol/L/hr, and the rate of change of serum sodium should not exceed 10 mmol in 24 hours.",
         "HHS'de osmolalitedeki düşüş saatte 3,0-8,0 mOsm/kg'ı, glukozdaki düşüş saatte 5,0 mmol/L'yi geçmemeli ve serum sodyumundaki değişim hızı 24 saatte 10 mmol'ü aşmamalıdır.",
         HHS, specialties=["endocrine"]))
    a(_c("gs_jbds_hhs_hdu_criteria", "jbds_hhs22", "Criteria for level 2 care", ["disposition"],
         "Consider admission to a high-dependency unit or level 2 environment if measured or calculated osmolality is more than 350 mOsm/kg, sodium more than 160 mmol/L, venous or arterial pH below 7.1, potassium below 3.5 mmol/L or above 6 mmol/L on admission, or Glasgow Coma Scale below 12.",
         "Ölçülen veya hesaplanan osmolalite 350 mOsm/kg üzeri, sodyum 160 mmol/L üzeri, venöz veya arteriyel pH 7,1 altı, yatışta potasyum 3,5 mmol/L altı veya 6 mmol/L üzeri ya da Glasgow Koma Skalası 12 altı ise yüksek bağımlılık birimi veya düzey 2 ortama yatışı düşünün.",
         HHS, specialties=["endocrine"]))
    a(_c("gs_jbds_hhs_lmwh_feet", "jbds_hhs22", "Executive summary", ["treatment", "disposition"],
         "In HHS prophylactic LMWH is required in most people, and everyone should be assumed to be at high risk of foot ulceration, particularly if obtunded or uncooperative, with the heels appropriately protected and daily foot checks undertaken.",
         "HHS'de çoğu kişide profilaktik DMAH gerekir; özellikle bilinci bulanık veya uyumsuzsa herkes yüksek ayak ülseri riskli kabul edilmeli, topuklar uygun şekilde korunmalı ve günlük ayak kontrolü yapılmalıdır.",
         HHS, specialties=["endocrine"]))

    # ---- Hypercalcaemia (Society for Endocrinology) --------------------------
    a(_c("gs_sfe_ca_severity", "sfe_ca16", "Severity of hypercalcaemia", ["triage"],
         "Adjusted calcium below 3.0 mmol/L is often asymptomatic and does not usually require urgent correction; 3.0 to 3.5 mmol/L may be well tolerated if it has risen slowly but prompt treatment is usually indicated; above 3.5 mmol/L requires urgent correction due to the risk of dysrhythmia and coma.",
         "Düzeltilmiş kalsiyum 3,0 mmol/L altındaysa sıklıkla asemptomatiktir ve genellikle acil düzeltme gerektirmez; 3,0-3,5 mmol/L yavaş yükseldiyse iyi tolere edilebilir ancak genellikle hızlı tedavi gerekir; 3,5 mmol/L üzeri disritmi ve koma riski nedeniyle acil düzeltme gerektirir.",
         HCA, specialties=["endocrine"]))
    a(_c("gs_sfe_ca_workup", "sfe_ca16", "Investigation", ["workup"],
         "Check calcium adjusted for albumin, phosphate, PTH and urea and electrolytes, and an ECG for a shortened QT interval: high calcium with high PTH indicates primary or tertiary hyperparathyroidism, and high calcium with low PTH indicates malignancy or other less common causes.",
         "Albümine göre düzeltilmiş kalsiyum, fosfat, PTH, üre ve elektrolitlere ve kısalmış QT aralığı için EKG'ye bakın: yüksek kalsiyum ile yüksek PTH primer veya tersiyer hiperparatiroidiyi, yüksek kalsiyum ile düşük PTH malignite veya daha seyrek nedenleri gösterir.",
         HCA, specialties=["endocrine"]))
    a(_c("gs_sfe_ca_saline_bisphosphonate", "sfe_ca16", "Management", ["treatment"],
         "Rehydrate with intravenous 0.9% saline 4 to 6 L in 24 h, monitoring for fluid overload; loop diuretics are rarely used and are not effective for reducing serum calcium; if further treatment is required consider intravenous bisphosphonates such as zoledronic acid 4 mg over 15 min, with the calcium nadir at 2 to 4 days.",
         "24 saatte 4-6 L intravenöz yüzde 0,9 salinle rehidrate edin ve sıvı yüklenmesini izleyin; loop diüretikleri nadiren kullanılır ve serum kalsiyumunu düşürmede etkili değildir; ek tedavi gerekirse 15 dakikada 4 mg zoledronik asit gibi intravenöz bisfosfonatları düşünün; kalsiyum en düşük düzeye 2-4 günde ulaşır.",
         HCA, specialties=["endocrine"]))

    # ---- Severe hypoglycaemia (JBDS 01) -----------------------------------
    a(_c("gs_jbds_hypo_4_floor", "jbds_hypo23", "Definition", ["triage"],
         "All non-pregnant adults with diabetes in hospital with a blood glucose level less than 4.0 mmol/L, with or without symptoms of hypoglycaemia, should be treated: '4.0 is the floor'.",
         "Hastanede yatan, gebe olmayan diyabetli tüm erişkinler kan glukozu 4,0 mmol/L'nin altındaysa hipoglisemi belirtisi olsun ya da olmasın tedavi edilmelidir: '4,0 tabandır'.",
         HYPOG, specialties=["endocrine"]))
    a(_c("gs_jbds_hypo_conscious_15g", "jbds_hypo23", "Algorithm A: conscious, able to swallow", ["treatment"],
         "In people who are conscious and able to swallow, 15 to 20 g of rapid-acting carbohydrate is the treatment of choice; repeat the capillary blood glucose 10 to 15 minutes later and repeat the treatment if it is still less than 4.0 mmol/L, up to 3 treatments in total.",
         "Bilinci açık ve yutabilen kişilerde 15-20 g hızlı etkili karbonhidrat tercih edilen tedavidir; kapiller kan glukozunu 10-15 dakika sonra tekrarlayın ve hâlâ 4,0 mmol/L'nin altındaysa tedaviyi tekrarlayın, toplam en fazla 3 kez.",
         HYPOG, specialties=["endocrine"]))
    a(_c("gs_jbds_hypo_iv_glucose_glucagon", "jbds_hypo23", "Algorithm C: unconscious, seizing or very aggressive", ["treatment"],
         "For adults who are unconscious, having seizures or very aggressive, check airway, breathing, circulation, disability and exposure, stop any insulin infusion, and if IV access is available give 100 ml of 20% glucose at 400 ml/hour or 200 ml of 10% glucose at 800 ml/hour over 15 minutes; if no IV access is available give 1 mg glucagon IM.",
         "Bilinci kapalı, nöbet geçiren veya çok saldırgan erişkinlerde hava yolu, solunum, dolaşım, nörolojik durum ve maruziyeti kontrol edin, insülin infüzyonunu durdurun; IV yol varsa 15 dakikada saatte 400 ml hızla 100 ml yüzde 20 glukoz veya saatte 800 ml hızla 200 ml yüzde 10 glukoz verin; IV yol yoksa 1 mg glukagon IM verin.",
         HYPOG, specialties=["endocrine"]))
    a(_c("gs_jbds_hypo_long_acting_snack", "jbds_hypo23", "After treatment", ["disposition"],
         "Once blood glucose is above 4.0 mmol/L and the person has recovered, give a long-acting carbohydrate snack (20 g); people given glucagon require a larger portion of long-acting carbohydrate.",
         "Kan glukozu 4,0 mmol/L'nin üzerine çıkıp kişi düzeldiğinde uzun etkili karbonhidratlı bir atıştırmalık (20 g) verin; glukagon verilenler daha büyük bir uzun etkili karbonhidrat porsiyonu gerektirir.",
         HYPOG, specialties=["endocrine"]))

    # ---- Severe hyponatraemia (Society for Endocrinology) --------------------
    a(_c("gs_sfe_na_symptom_classes", "sfe_na16", "Clinical assessment", ["triage", "history"],
         "Severe symptoms of hyponatraemia are vomiting, cardiorespiratory arrest, seizures and reduced consciousness or coma (GCS 8 or less); moderately severe symptoms are nausea without vomiting, confusion and headache; management decisions should be made on the basis of presenting clinical symptoms and signs rather than the degree of hyponatraemia.",
         "Hiponatreminin ağır belirtileri kusma, kardiyopulmoner arest, nöbetler ve bilinç azalması veya komadır (GKS 8 veya altı); orta-ağır belirtiler kusmasız bulantı, konfüzyon ve baş ağrısıdır; yönetim kararları hiponatreminin derecesine göre değil, başvurudaki klinik belirti ve bulgulara göre verilmelidir.",
         HNA, specialties=["endocrine"]))
    a(_c("gs_sfe_na_hypertonic_5", "sfe_na16", "Treatment of severe symptomatic hyponatraemia", ["treatment"],
         "Patients with severe symptoms require immediate treatment with hypertonic saline irrespective of the cause, supervised by a senior clinician; the aim is a 5 mmol/L rise in serum sodium within the first hour, reducing the danger from cerebral oedema while minimising the risk of over-rapid correction and osmotic demyelination.",
         "Ağır belirtileri olan hastalar nedenden bağımsız olarak kıdemli bir klinisyen gözetiminde hemen hipertonik salinle tedavi edilmelidir; hedef ilk saatte serum sodyumunda 5 mmol/L artıştır; bu, serebral ödem tehlikesini azaltırken aşırı hızlı düzeltme ve ozmotik demiyelinizasyon riskini en aza indirir.",
         HNA, specialties=["endocrine"]))
    a(_c("gs_sfe_na_overcorrection_limits", "sfe_na16", "Managing over-correction", ["disposition"],
         "Over-correction of serum sodium risks osmotic demyelination: if the limit of 10 mmol/L in the first 24 h or 18 mmol/L in the first 48 h of treatment is exceeded, hypertonic fluid should be stopped; urine osmolality and urine sodium are central to defining the aetiology.",
         "Serum sodyumunun aşırı düzeltilmesi ozmotik demiyelinizasyon riski taşır: tedavinin ilk 24 saatinde 10 mmol/L veya ilk 48 saatinde 18 mmol/L sınırı aşılırsa hipertonik sıvı durdurulmalıdır; idrar osmolalitesi ve idrar sodyumu etiyolojiyi belirlemede merkezidir.",
         HNA, specialties=["endocrine"]))

    # ---- New hypothyroidism (NICE NG145) ---------------------------------------
    a(_c("gs_nice_ng145_tsh_first", "ng145", "1.2.8", ["workup"],
         "Consider measuring TSH alone for adults when secondary thyroid dysfunction (pituitary disease) is not suspected; if the TSH is above the reference range, measure FT4 in the same sample.",
         "Sekonder tiroid işlev bozukluğundan (hipofiz hastalığı) şüphelenilmeyen erişkinlerde yalnızca TSH ölçmeyi düşünün; TSH referans aralığın üzerindeyse aynı örnekte serbest T4 ölçün.",
         HYPOT, specialties=["endocrine"]))
    a(_c("gs_nice_ng145_levothyroxine_dose", "ng145", "1.3.6; 1.3.7", ["treatment"],
         "Consider starting levothyroxine at 1.6 micrograms per kilogram of body weight per day (rounded to the nearest 25 micrograms) for adults under 65 with primary hypothyroidism and no history of cardiovascular disease, and at 25 to 50 micrograms per day with titration for adults aged 65 and over and adults with a history of cardiovascular disease.",
         "Kardiyovasküler hastalık öyküsü olmayan 65 yaş altı primer hipotiroidili erişkinlerde levotiroksine günde vücut ağırlığının kilogramı başına 1,6 mikrogram (en yakın 25 mikrograma yuvarlanarak), 65 yaş ve üzeri ile kardiyovasküler hastalık öyküsü olan erişkinlerde günde 25-50 mikrogramla titrasyonla başlamayı düşünün.",
         HYPOT, specialties=["endocrine"]))
    a(_c("gs_nice_ng145_tsh_monitoring", "ng145", "1.4.1; 1.4.2; 1.4.3", ["disposition"],
         "Aim to maintain TSH within the reference range on levothyroxine, consider measuring TSH every 3 months until stable and then once a year, and be aware that TSH can take up to 6 months to return to the reference range after a very high starting level.",
         "Levotiroksin tedavisinde TSH'yi referans aralıkta tutmayı hedefleyin, TSH'yi stabil olana kadar 3 ayda bir, ardından yılda bir ölçmeyi düşünün ve başlangıçta çok yüksek olan TSH'nin referans aralığa dönmesinin 6 aya kadar sürebileceğini unutmayın.",
         HYPOT, specialties=["endocrine"]))
    a(_c("gs_nice_ng145_no_liothyronine", "ng145", "1.3.4; 1.3.5", ["treatment"],
         "Do not routinely offer liothyronine for primary hypothyroidism, either alone or in combination with levothyroxine, and do not offer natural thyroid extract.",
         "Primer hipotiroidide liotironini tek başına veya levotiroksinle kombinasyon halinde rutin olarak önermeyin ve doğal tiroid ekstresi önermeyin.",
         HYPOT, specialties=["endocrine"]))

    # ---- Phaeochromocytoma crisis (Japan Endocrine Society 2025) -------------
    a(_c("gs_jes25_ppgl_screening", "jes_pheo25", "Statements I-2-1; I-2-2", ["workup"],
         "Exercise, stress, body position, temperature, needle puncture, foods and medications can affect measured values; initial screening uses random urinary fractionated metanephrines (over three times the upper limit after correcting for creatinine), blood fractionated catecholamines (over three times the upper limit) or plasma-free fractionated metanephrines (above the upper limit).",
         "Egzersiz, stres, vücut pozisyonu, ısı, iğne girişi, besinler ve ilaçlar ölçülen değerleri etkileyebilir; ilk tarama kreatinine göre düzeltilmiş rastgele idrar fraksiyone metanefrinleri (üst sınırın üç katından fazla), kan fraksiyone katekolaminleri (üst sınırın üç katından fazla) veya plazma serbest fraksiyone metanefrinleri (üst sınırın üzerinde) ile yapılır.",
         PHEO, specialties=["endocrine"], countries=["GLOBAL", "JP"]))
    a(_c("gs_jes25_ppgl_crisis_phentolamine", "jes_pheo25", "Statements I-6-1; I-6-2", ["treatment"],
         "Hypertensive crisis can arise from various triggers in pheochromocytoma and paraganglioma, and early diagnosis and specific treatment are essential; intravenous phentolamine is administered, followed by an intravenous infusion, and after the acute phase treatment is switched to oral doxazosin, a selective alpha-1 blocker.",
         "Feokromositoma ve paragangliomada çeşitli tetikleyicilerle hipertansif kriz gelişebilir; erken tanı ve özgül tedavi esastır; intravenöz fentolamin verilir, ardından intravenöz infüzyon yapılır ve akut evreden sonra selektif alfa-1 bloker olan oral doksazosine geçilir.",
         PHEO + HTNE, specialties=["endocrine"], countries=["GLOBAL", "JP"]))
    a(_c("gs_jes25_ppgl_no_beta_first", "jes_pheo25", "Statement I-4; preoperative treatment", ["treatment"],
         "Administering a beta-blocker before an alpha-blocker is contraindicated, as it may cause a hypertensive attack; beta-blockers are added several days after sufficient alpha-blocker administration for severe catecholamine excess or tachycardia, and alpha-blockers should be given at least 7 to 14 days before surgery.",
         "Alfa blokerden önce beta bloker vermek hipertansif atağa yol açabileceğinden kontrendikedir; ağır katekolamin fazlalığı veya taşikardide beta blokerler yeterli alfa bloker uygulamasından birkaç gün sonra eklenir ve alfa blokerler ameliyattan en az 7-14 gün önce verilmelidir.",
         PHEO, specialties=["endocrine"], countries=["GLOBAL", "JP"]))
    a(_c("gs_jes25_ppgl_triggers_metoclopramide", "jes_pheo25", "Diagnosis: provocation tests", ["workup"],
         "Glucagon and metoclopramide loading tests are not recommended because of their low specificity and the risk of hypertensive crisis, and phentolamine is not recommended for diagnosis because of the risk of severe hypotension.",
         "Glukagon ve metoklopramid yükleme testleri düşük özgüllükleri ve hipertansif kriz riski nedeniyle önerilmez; fentolamin de ağır hipotansiyon riski nedeniyle tanı için önerilmez.",
         PHEO, specialties=["endocrine"], countries=["GLOBAL", "JP"]))

    # ---- Thyroid storm (ETA/BTA/SfE 2026) -----------------------------------
    a(_c("gs_eta26_storm_features", "eta_storm26", "Introduction; recognition and diagnosis", ["triage"],
         "Cardinal features suggestive of thyroid storm include fever (usually above 38.5 °C), tachycardia disproportionate to the level of fever, arrhythmia (particularly atrial fibrillation), cardiac decompensation and pulmonary oedema, altered mental status and gastrointestinal dysfunction; thyroid storm is a clinical diagnosis.",
         "Tiroid fırtınasını düşündüren temel özellikler ateş (genellikle 38,5 °C üzeri), ateşle orantısız taşikardi, aritmi (özellikle atriyal fibrilasyon), kardiyak dekompansasyon ve akciğer ödemi, mental durum değişikliği ve gastrointestinal işlev bozukluğudur; tiroid fırtınası klinik bir tanıdır.",
         STORM, specialties=["endocrine"], countries=["GLOBAL", "UK"]))
    a(_c("gs_eta26_storm_bwps", "eta_storm26", "Recognition and diagnosis: scoring", ["workup"],
         "A Burch and Wartofsky score of less than 25 points suggests thyroid storm is unlikely, a score of 25 to 44 points is suggestive of a possible impending crisis, and a score of 45 or more is highly suggestive of a thyroid crisis.",
         "Burch ve Wartofsky skoru 25 puanın altındaysa tiroid fırtınası olası değildir, 25-44 puan olası yaklaşan krizi düşündürür, 45 veya üzeri tiroid krizini kuvvetle düşündürür.",
         STORM, specialties=["endocrine"], countries=["GLOBAL", "UK"]))
    a(_c("gs_eta26_storm_beta_blockade", "eta_storm26", "Beta-blockade", ["treatment"],
         "Propranolol 60 to 80 mg every 4 h is recommended in the ATA and ETA guidelines; in suspected thyrotoxic cardiomyopathy, hypotension or evolving cardiogenic shock, beta-blockade may precipitate haemodynamic collapse, and a short-acting agent such as intravenous esmolol is preferred.",
         "ATA ve ETA kılavuzlarında 4 saatte bir 60-80 mg propranolol önerilir; şüpheli tirotoksik kardiyomiyopati, hipotansiyon veya gelişen kardiyojenik şokta beta blokaj hemodinamik çöküşe yol açabilir ve intravenöz esmolol gibi kısa etkili bir ajan tercih edilir.",
         STORM, specialties=["endocrine"], countries=["GLOBAL", "UK"]))
    a(_c("gs_eta26_storm_atd", "eta_storm26", "Antithyroid drugs", ["treatment"],
         "Give methimazole 60 to 80 mg/day or carbimazole 80 to 100 mg/day, strongly considering these rather than PTU if liver function is disturbed, or propylthiouracil 500 to 1,000 mg loading dose and then 250 mg every 4 h.",
         "Günde 60-80 mg metimazol veya günde 80-100 mg karbimazol verin (karaciğer fonksiyonu bozuksa PTU yerine bunları kuvvetle düşünün) ya da 500-1.000 mg yükleme dozu ve ardından 4 saatte bir 250 mg propiltiyourasil verin.",
         STORM, specialties=["endocrine"], countries=["GLOBAL", "UK"]))
    a(_c("gs_eta26_storm_hydrocortisone", "eta_storm26", "Corticosteroids", ["treatment"],
         "Give IV hydrocortisone 100 mg loading dose and then 50 mg four times a day; high-dose steroid therapy decreases conversion of T4 to T3, and serum potassium should be monitored closely after glucocorticoid administration.",
         "IV 100 mg hidrokortizon yükleme dozu ve ardından günde dört kez 50 mg verin; yüksek doz steroid tedavisi T4'ün T3'e dönüşümünü azaltır ve glukokortikoid sonrası serum potasyumu yakından izlenmelidir.",
         STORM, specialties=["endocrine"], countries=["GLOBAL", "UK"]))
    a(_c("gs_eta26_storm_iodine_after_1h", "eta_storm26", "Iodine/potassium iodide", ["treatment"],
         "If iodine is to be used, wait for 1 h post-administration of antithyroid drugs before administering iodide, because thyrotoxicosis could otherwise worsen; give Lugol's iodine 8 drops four times a day or SSKI 5 drops four times a day and discontinue once the patient is stabilised.",
         "İyot kullanılacaksa, aksi halde tirotoksikoz kötüleşebileceğinden iyodür vermeden önce antitiroid ilaç uygulamasından sonra 1 saat bekleyin; günde dört kez 8 damla Lugol iyodu veya günde dört kez 5 damla SSKI verin ve hasta stabil olunca kesin.",
         STORM, specialties=["endocrine"], countries=["GLOBAL", "UK"]))
    a(_c("gs_eta26_storm_hdu_icu", "eta_storm26", "Management setting", ["disposition"],
         "Patients with suspected or confirmed thyroid storm should be managed in a high-dependency or intensive care setting when there is evidence of significant organ dysfunction or clinical instability, such as haemodynamic instability requiring vasopressor support or an altered level of consciousness.",
         "Şüpheli veya doğrulanmış tiroid fırtınası olan hastalar, vazopresör desteği gerektiren hemodinamik instabilite veya bilinç düzeyi değişikliği gibi anlamlı organ işlev bozukluğu ya da klinik instabilite bulgusu varsa yüksek bağımlılık veya yoğun bakım ortamında izlenmelidir.",
         STORM, specialties=["endocrine"], countries=["GLOBAL", "UK"]))

    # ======================= GASTROENTEROLOGY ================================
    HEP, DUMP, SBO, DIV, GE, GORD, IBD, AMI, PUD, IDIA = (["K72.0"], ["K91.1"], ["K56.60"], ["K57.92"], ["A09"],
                                                          ["K21.9"], ["K51.90", "K50.90"], ["K55.0"], ["K25.1"], ["A09.0"])
    # ---- Acute hepatitis ----------------------------------------------------
    a(_c("gs_cdc_hepa_igm", "cdc_hepa_dx", "Laboratory markers", ["workup"],
         "IgM antibodies to HAV in serum, or HAV RNA in serum or stool, indicate an acute HAV infection; IgG and total anti-HAV are not helpful in diagnosing acute illness, and ALT and total bilirubin tests can aid in diagnosis.",
         "Serumda HAV'ye karşı IgM antikorları veya serumda ya da dışkıda HAV RNA'sı akut HAV enfeksiyonunu gösterir; IgG ve total anti-HAV akut hastalığın tanısında yararlı değildir; ALT ve total bilirubin testleri tanıya yardımcı olabilir.",
         HEP + ["B15.9"], specialties=["hepatology", "infectious"], countries=["US"]))
    a(_c("gs_cdc_hepb_igm_core", "cdc_hepb_dx", "Interpretation of serologic test results", ["workup"],
         "IgM anti-HBc positivity indicates recent infection with HBV (within less than 6 months) and should be ordered only when acute HBV infection is a concern; HBsAg positive, total anti-HBc positive, IgM anti-HBc positive and anti-HBs negative indicates acute infection.",
         "IgM anti-HBc pozitifliği yakın zamandaki (6 aydan kısa) HBV enfeksiyonunu gösterir ve yalnızca akut HBV enfeksiyonundan endişe edildiğinde istenmelidir; HBsAg pozitif, total anti-HBc pozitif, IgM anti-HBc pozitif ve anti-HBs negatif olması akut enfeksiyonu gösterir.",
         HEP + ["B16.9"], specialties=["hepatology", "infectious"], countries=["US"]))
    a(_c("gs_cdc_hepb_acute_supportive", "cdc_hepb", "Treatment and recovery", ["treatment"],
         "Acute hepatitis B can cause a more severe illness that requires hospitalization, and clinicians generally treat people with acute hepatitis B with supportive care depending on the symptoms; acute hepatitis B can lead to lifelong infection, or chronic hepatitis B.",
         "Akut hepatit B hastaneye yatış gerektiren daha ağır bir hastalığa yol açabilir; klinisyenler akut hepatit B'yi genellikle belirtilere göre destekleyici bakımla tedavi eder; akut hepatit B ömür boyu süren enfeksiyona, yani kronik hepatit B'ye dönüşebilir.",
         HEP + ["B16.9"], specialties=["hepatology", "infectious"], countries=["US"]))
    a(_c("gs_cdc_hepa_liver_failure_pep", "cdc_hepa", "Mortality; prevention", ["disposition"],
         "In rare cases hepatitis A can cause liver failure and even death, more commonly in older people and in people with chronic liver disease; hepatitis A vaccine and immune globulin can provide protection when administered within 2 weeks after exposure.",
         "Hepatit A nadiren karaciğer yetmezliğine ve hatta ölüme yol açabilir; bu durum yaşlılarda ve kronik karaciğer hastalığı olanlarda daha sıktır; hepatit A aşısı ve immünoglobulin maruziyetten sonraki 2 hafta içinde uygulandığında koruma sağlayabilir.",
         HEP + ["B15.9"], specialties=["hepatology", "infectious"], countries=["US"]))

    # ---- Dumping syndrome (international consensus 2020) ---------------------
    a(_c("gs_dump20_early_late", "dumping20", "Statements 3 and 5", ["history"],
         "Early dumping syndrome symptoms occur within the first hour after a meal, whereas late dumping syndrome usually occurs 1 to 3 h after a meal and is characterized by reactive hypoglycaemia.",
         "Erken damping sendromu belirtileri yemekten sonraki ilk saat içinde ortaya çıkarken, geç damping sendromu genellikle yemekten 1-3 saat sonra görülür ve reaktif hipoglisemiyle karakterizedir.",
         DUMP, specialties=["gastroenterology"]))
    a(_c("gs_dump20_ogtt", "dumping20", "Statements 34 and 35", ["workup"],
         "The modified OGTT is positive for early dumping syndrome with an early (30 min) increase in haematocrit of more than 3% or an increase in pulse rate of more than 10 bpm, and positive for late dumping syndrome with late (60 to 180 min after ingestion) hypoglycaemia below 50 mg/dl.",
         "Modifiye OGTT, 30. dakikada hematokritte yüzde 3'ten fazla erken artış veya nabızda dakikada 10'dan fazla artış olduğunda erken damping için, alımdan 60-180 dakika sonra 50 mg/dl altında geç hipoglisemi geliştiğinde geç damping için pozitiftir.",
         DUMP, specialties=["gastroenterology"]))
    a(_c("gs_dump20_diet_first", "dumping20", "Statements 43 to 46", ["treatment"],
         "Dietary modification is the initial approach: reduce the amount of food consumed at each meal, delay fluid intake until at least 30 min after meals, eliminate rapidly absorbable carbohydrates, and eat foods high in fibre and rich in protein, eaten slowly and chewed well.",
         "İlk yaklaşım diyet değişikliğidir: her öğünde tüketilen yiyecek miktarını azaltın, sıvı alımını yemekten en az 30 dakika sonraya erteleyin, hızlı emilen karbonhidratları çıkarın ve lif ve protein açısından zengin yiyecekleri yavaşça ve iyi çiğneyerek yiyin.",
         DUMP, specialties=["gastroenterology"]))
    a(_c("gs_dump20_acarbose_ssa", "dumping20", "Statements 49, 50 and 53", ["treatment", "disposition"],
         "Pharmacological intervention has to be considered in patients who do not respond to dietary modification: acarbose can be used for symptoms of late dumping syndrome, and somatostatin analogues are the preferred treatment for well-established dumping syndrome that does not respond to diet with or without acarbose.",
         "Diyet değişikliğine yanıt vermeyen hastalarda farmakolojik girişim düşünülmelidir: geç damping belirtileri için akarboz kullanılabilir; diyet ve akarboza yanıt vermeyen yerleşik damping sendromunda somatostatin analogları tercih edilen tedavidir.",
         DUMP, specialties=["gastroenterology"]))

    # ---- Bowel obstruction (WSES Bologna 2017) -------------------------------
    a(_c("gs_wses_asbo_ct", "wses_asbo17", "Diagnosis: CT scan", ["workup"],
         "CT scan is the preferred imaging for adhesive small bowel obstruction, with approximately 90% accuracy in predicting strangulation and the need for urgent surgery; signs of a closed loop, bowel ischemia and free fluid suggest the need for surgery without delay.",
         "Adezyona bağlı ince bağırsak tıkanıklığında tercih edilen görüntüleme BT'dir ve strangülasyonu ve acil cerrahi gereksinimini öngörmede yaklaşık yüzde 90 doğruluğa sahiptir; kapalı ans, bağırsak iskemisi ve serbest sıvı bulguları gecikmeden cerrahi gerektiğini düşündürür.",
         SBO, specialties=["surgery"]))
    a(_c("gs_wses_asbo_nom", "wses_asbo17", "Non-operative management", ["treatment"],
         "The cornerstone of non-operative management is nil per os and decompression using a naso-gastric or long intestinal tube; it is effective in approximately 70 to 90% of patients, and a trial of non-operative management can be continued safely for 72 h.",
         "Ameliyatsız tedavinin temeli ağızdan hiçbir şey verilmemesi ve nazogastrik veya uzun intestinal tüple dekompresyondur; hastaların yaklaşık yüzde 70-90'ında etkilidir ve ameliyatsız tedavi denemesi 72 saate kadar güvenle sürdürülebilir.",
         SBO, specialties=["surgery"]))
    a(_c("gs_wses_asbo_contrast_24h", "wses_asbo17", "Water-soluble contrast", ["workup", "disposition"],
         "In the absence of the need to perform immediate surgery, give water-soluble oral contrast and make a follow-up abdominal X-ray after 24 h: if the contrast has reached the colon, this is indicative of resolution of the bowel obstruction.",
         "Acil cerrahi gereksinimi yoksa suda çözünen oral kontrast verin ve 24 saat sonra kontrol batın grafisi çekin: kontrast kolona ulaştıysa bu, bağırsak tıkanıklığının çözüldüğünü gösterir.",
         SBO, specialties=["surgery"]))
    a(_c("gs_wses_asbo_labs_strangulation", "wses_asbo17", "History, examination and laboratory tests", ["exam", "workup"],
         "Evaluate for signs of peritonitis that might reveal strangulation or ischemia and for abdominal wall or groin hernias, remembering that the sensitivity of physical examination for strangulation is only 48%; the minimum laboratory tests include blood count, lactate, electrolytes, CRP and BUN or creatinine.",
         "Strangülasyon veya iskemiyi gösterebilecek peritonit bulgularını ve karın duvarı ya da kasık fıtıklarını değerlendirin; fizik muayenenin strangülasyonu saptamadaki duyarlılığının yalnızca yüzde 48 olduğunu unutmayın; en az tam kan sayımı, laktat, elektrolitler, CRP ve BUN veya kreatinin istenmelidir.",
         SBO, specialties=["surgery"]))

    # ---- Acute diverticulitis (NICE NG147) -----------------------------------
    a(_c("gs_nice_ng147_suspect_refer", "ng147", "1.3.1; 1.3.2", ["history", "triage"],
         "Suspect acute diverticulitis if a person presents with constant abdominal pain, usually severe and localising in the left lower quadrant, with fever, a sudden change in bowel habit, rectal bleeding or mucus, or left lower quadrant tenderness or mass; suspect complicated acute diverticulitis and refer for same-day hospital assessment if there is uncontrolled abdominal pain with features such as a mass, rigidity and guarding, or signs of sepsis.",
         "Genellikle şiddetli ve sol alt kadranda lokalize sürekli karın ağrısıyla birlikte ateş, ani bağırsak alışkanlığı değişikliği, rektal kanama veya mukus ya da sol alt kadranda hassasiyet veya kitle varsa akut divertikülitten şüphelenin; kitle, rijidite ve defans ya da sepsis bulguları gibi özelliklerle kontrol edilemeyen karın ağrısı varsa komplike akut divertikülitten şüphelenip aynı gün hastane değerlendirmesine yönlendirin.",
         DIV, specialties=["gastroenterology", "surgery"]))
    a(_c("gs_nice_ng147_bloods_ct24h", "ng147", "1.3.4; 1.3.5", ["workup"],
         "For people with suspected complicated acute diverticulitis offer a full blood count, urea and electrolytes and C-reactive protein, and if inflammatory markers are raised offer a contrast CT scan within 24 hours of hospital admission to confirm the diagnosis and plan management.",
         "Şüpheli komplike akut divertikülitte tam kan sayımı, üre ve elektrolitler ve C-reaktif protein isteyin; inflamatuvar belirteçler yüksekse tanıyı doğrulamak ve yönetimi planlamak için hastaneye yatıştan sonraki 24 saat içinde kontrastlı BT önerin.",
         DIV, specialties=["gastroenterology", "surgery"]))
    a(_c("gs_nice_ng147_no_abx_well", "ng147", "1.3.7; 1.3.8", ["treatment"],
         "For people with acute diverticulitis who are systemically well, consider a no antibiotic prescribing strategy, offer simple analgesia such as paracetamol and advise re-presenting if symptoms persist or worsen; offer an antibiotic if the person is systemically unwell, immunosuppressed or has significant comorbidity.",
         "Sistemik olarak iyi durumdaki akut divertikülitte antibiyotiksiz izlem stratejisini düşünün, parasetamol gibi basit analjezi önerin ve belirtiler sürer veya kötüleşirse yeniden başvurmalarını öğütleyin; sistemik olarak hasta, immünosupresif veya önemli eşlik eden hastalığı olanlara antibiyotik önerin.",
         DIV, specialties=["gastroenterology", "surgery"]))
    a(_c("gs_nice_ng147_coamoxiclav", "ng147", "1.3.13, table 2", ["treatment"],
         "The first-choice oral antibiotic for suspected or confirmed uncomplicated acute diverticulitis is co-amoxiclav 500/125 mg three times a day for 5 days, and the first-choice intravenous antibiotic for complicated acute diverticulitis is co-amoxiclav 1.2 g three times a day.",
         "Şüpheli veya doğrulanmış komplike olmayan akut divertikülitte ilk tercih oral antibiyotik 5 gün boyunca günde üç kez 500/125 mg ko-amoksiklav, komplike akut divertikülitte ilk tercih intravenöz antibiyotik günde üç kez 1,2 g ko-amoksiklavdır.",
         DIV, specialties=["gastroenterology", "surgery"]))
    a(_c("gs_nice_ng147_iv_review_48h", "ng147", "1.3.10; 1.3.11", ["disposition"],
         "Offer intravenous antibiotics to people admitted with suspected complicated acute diverticulitis and review them within 48 hours or after scanning if sooner, stepping down to oral antibiotics where possible.",
         "Şüpheli komplike akut divertikülitle yatırılanlara intravenöz antibiyotik verin ve 48 saat içinde ya da daha erkense tarama sonrasında gözden geçirerek mümkünse oral antibiyotiğe geçin.",
         DIV, specialties=["gastroenterology", "surgery"]))

    # ---- Gastroenteritis / infectious diarrhoea -------------------------------
    a(_c("gs_who_diarr_ors", "who_diarr", "Treatment", ["treatment"],
         "Diarrhoea should be treated with oral rehydration solution (ORS), a solution of clean water, sugar and salt that is absorbed in the small intestine and replaces the water and electrolytes lost in the faeces.",
         "İshal, ince bağırsakta emilen ve dışkıyla kaybedilen su ve elektrolitleri yerine koyan temiz su, şeker ve tuz çözeltisi olan oral rehidratasyon solüsyonuyla (ORS) tedavi edilmelidir.",
         GE + IDIA, specialties=["infectious", "gastroenterology"]))
    a(_c("gs_cdc_td_antimotility", "cdc_td", "Treatment: antimotility agents", ["treatment"],
         "Antimotility agents such as loperamide provide symptomatic relief, but antimotility agents alone are not recommended for patients with bloody diarrhea or those who have diarrhea and fever.",
         "Loperamid gibi antimotilite ajanları semptomatik rahatlama sağlar, ancak kanlı ishali olan veya ishalle birlikte ateşi olan hastalarda antimotilite ajanlarının tek başına kullanılması önerilmez.",
         GE + IDIA, specialties=["infectious", "gastroenterology"], countries=["US"]))
    a(_c("gs_cdc_td_azithromycin", "cdc_td", "Treatment: antibiotics (table)", ["treatment"],
         "Azithromycin 1,000 mg as a single or divided dose, or 500 mg once daily for 3 days, is the preferred treatment for dysentery or febrile diarrhea, and is used empirically as first-line treatment where fluoroquinolone-resistant bacteria are suspected.",
         "Tek veya bölünmüş doz olarak 1.000 mg ya da 3 gün boyunca günde bir kez 500 mg azitromisin dizanteri veya ateşli ishal için tercih edilen tedavidir ve florokinolona dirençli bakterilerden şüphelenilen bölgelerde ilk basamak ampirik tedavi olarak kullanılır.",
         IDIA + GE, specialties=["infectious"], countries=["US"]))
    a(_c("gs_cdc_td_fluoroquinolone_resistance", "cdc_td", "Antibiotic choice", ["treatment"],
         "Fluoroquinolones have historically been the most effective antibiotics for bacterial travelers' diarrhea, but resistance among Campylobacter and Shigella species globally now limits their use, and they are associated with tendinitis and QT interval prolongation.",
         "Florokinolonlar tarihsel olarak bakteriyel seyahat ishalinde en etkili antibiyotiklerdi, ancak Campylobacter ve Shigella türlerinde küresel direnç artık kullanımlarını sınırlıyor ve tendinit ile QT aralığı uzamasıyla ilişkilidirler.",
         IDIA, specialties=["infectious"], countries=["US"]))
    a(_c("gs_cdc_cdiff_test_isolate", "cdc_cdiff", "Treatment and recovery", ["workup", "disposition"],
         "If a patient has had three or more stools in 24 hours, isolate patients with possible C. diff immediately, order a C. diff test if stool softeners or laxatives were not used, and treat CDI with an appropriate course (about 10 days) of oral vancomycin or fidaxomicin.",
         "Hastanın 24 saatte üç veya daha fazla dışkılaması olduysa olası C. diff hastalarını hemen izole edin, dışkı yumuşatıcı veya laksatif kullanılmadıysa C. diff testi isteyin ve C. diff enfeksiyonunu uygun bir kür (yaklaşık 10 gün) oral vankomisin veya fidaksomisinle tedavi edin.",
         IDIA + GE, specialties=["infectious"], countries=["US"]))

    # ---- GORD (NICE CG184, NG12) --------------------------------------------
    a(_c("gs_nice_cg184_ppi_4_8_weeks", "cg184", "1.6.2; 1.6.7", ["treatment"],
         "Offer people with GORD a full-dose PPI for 4 or 8 weeks, and a full-dose PPI for 8 weeks to heal severe oesophagitis.",
         "GÖRH'lü kişilere 4 veya 8 hafta tam doz PPI, ağır özofajiti iyileştirmek için 8 hafta tam doz PPI önerin.",
         GORD, specialties=["gastroenterology"]))
    a(_c("gs_nice_ng12_dysphagia_refer", "ng12site", "1.2.1", ["history", "disposition"],
         "Refer people using a suspected cancer pathway referral for oesophageal cancer if they have dysphagia, or are aged 55 and over with weight loss and any of upper abdominal pain, reflux or dyspepsia.",
         "Disfajisi olanları veya kilo kaybıyla birlikte üst karın ağrısı, reflü ya da dispepsiden herhangi biri olan 55 yaş ve üzerindekileri özofagus kanseri için şüpheli kanser yolu sevkiyle yönlendirin.",
         GORD, specialties=["gastroenterology", "oncology"]))
    a(_c("gs_nice_cg184_hpylori_washout", "cg184", "1.4.2; 1.4.3", ["workup"],
         "Leave a 2-week washout period after proton pump inhibitor use before testing for Helicobacter pylori with a breath test or a stool antigen test, and offer empirical full-dose PPI therapy for 4 weeks to people with dyspepsia.",
         "Helicobacter pylori'yi nefes veya dışkı antijen testiyle test etmeden önce proton pompa inhibitörü kullanımından sonra 2 haftalık arınma süresi bırakın ve dispepsisi olanlara 4 hafta ampirik tam doz PPI önerin.",
         GORD, specialties=["gastroenterology"]))

    # ---- IBD flare (NICE NG130, NG129) -----------------------------------------
    a(_c("gs_nice_ng130_asuc_iv_steroids", "ng130", "1.2.21; 1.2.22", ["treatment"],
         "For people admitted to hospital with acute severe ulcerative colitis, ensure that a gastroenterologist and a colorectal surgeon collaborate, offer intravenous corticosteroids to induce remission and assess the likelihood that the person will need surgery.",
         "Akut ağır ülseratif kolitle hastaneye yatırılanlarda bir gastroenterolog ve bir kolorektal cerrahın birlikte çalışmasını sağlayın, remisyonu indüklemek için intravenöz kortikosteroid önerin ve cerrahi gereksinimi olasılığını değerlendirin.",
         IBD, specialties=["gastroenterology"]))
    a(_c("gs_nice_ng130_72h_rescue", "ng130", "1.2.24", ["disposition"],
         "Consider adding intravenous ciclosporin to intravenous corticosteroids or consider surgery for people who have little or no improvement within 72 hours of starting intravenous corticosteroids or whose symptoms worsen at any time despite corticosteroid treatment.",
         "İntravenöz kortikosteroid başladıktan sonraki 72 saat içinde çok az düzelen veya hiç düzelmeyen ya da kortikosteroide rağmen herhangi bir zamanda kötüleşen hastalarda intravenöz kortikosteroide intravenöz siklosporin eklemeyi veya cerrahiyi düşünün.",
         IBD, specialties=["gastroenterology"]))
    a(_c("gs_nice_ng130_surgery_predictors", "ng130", "1.2.26; 1.2.27", ["workup"],
         "Assess and document on admission and then daily the likelihood of needing surgery in acute severe ulcerative colitis, being aware of an increased likelihood with stool frequency more than 8 per day, pyrexia, tachycardia, colonic dilatation on abdominal X-ray, low albumin, low haemoglobin, high platelet count or C-reactive protein above 45 mg/l.",
         "Akut ağır ülseratif kolitte cerrahi gereksinimi olasılığını yatışta ve ardından her gün değerlendirip kaydedin; günde 8'den fazla dışkılama, ateş, taşikardi, batın grafisinde kolon dilatasyonu, düşük albümin, düşük hemoglobin, yüksek trombosit sayısı veya 45 mg/l üzeri C-reaktif protein ile olasılığın arttığını bilin.",
         IBD, specialties=["gastroenterology"]))
    a(_c("gs_nice_ng129_crohns_steroid", "ng129", "1.2.1; 1.2.5", ["treatment"],
         "Offer monotherapy with a conventional glucocorticosteroid (prednisolone, methylprednisolone or intravenous hydrocortisone) to induce remission in a first presentation or a single inflammatory exacerbation of Crohn's disease in a 12-month period, and do not offer budesonide or aminosalicylate treatment for severe presentations or exacerbations.",
         "Crohn hastalığının ilk başvurusunda veya 12 ay içindeki tek inflamatuvar alevlenmesinde remisyonu indüklemek için konvansiyonel glukokortikosteroid monoterapisi (prednizolon, metilprednizolon veya intravenöz hidrokortizon) önerin; ağır başvurularda veya alevlenmelerde budesonid veya aminosalisilat önermeyin.",
         IBD, specialties=["gastroenterology"]))

    # ---- Acute mesenteric ischaemia (WSES 2022) ------------------------------
    a(_c("gs_wses_ami_suspicion", "wses_ami22", "Diagnosis: clinical presentation", ["triage", "exam"],
         "Clinical signs of peritonitis may be subtle in acute mesenteric ischemia, so one must have a high index of suspicion; the classic presentation of severe, poorly localized abdominal pain that is out of proportion to the physical examination is becoming less common.",
         "Akut mezenter iskemide peritonit bulguları silik olabileceğinden şüphe eşiği düşük tutulmalıdır; fizik muayeneyle orantısız, şiddetli, iyi lokalize olmayan karın ağrısından oluşan klasik tablo giderek daha az görülmektedir.",
         AMI, specialties=["surgery"]))
    a(_c("gs_wses_ami_cta", "wses_ami22", "Recommendation 5", ["workup"],
         "Computed tomography angiography (CTA) should be performed without delay in any patient with suspicion for acute mesenteric ischemia; every 6 h of delay in diagnosis doubles mortality.",
         "Akut mezenter iskemiden şüphelenilen her hastada bilgisayarlı tomografi anjiyografi (BTA) gecikmeden yapılmalıdır; tanıdaki her 6 saatlik gecikme mortaliteyi ikiye katlar.",
         AMI, specialties=["surgery"]))
    a(_c("gs_wses_ami_lactate", "wses_ami22", "Recommendation 4", ["workup"],
         "No laboratory study can identify the presence or absence of ischemic bowel, although elevated L-lactate, leukocytosis and D-dimer may assist; lactic acidosis with abdominal pain in a patient who does not otherwise appear clinically ill should lead to consideration of early CTA.",
         "Hiçbir laboratuvar testi iskemik bağırsağın varlığını veya yokluğunu belirleyemez, ancak yüksek L-laktat, lökositoz ve D-dimer yardımcı olabilir; başka açıdan klinik olarak hasta görünmeyen bir hastada karın ağrısıyla birlikte laktik asidoz erken BTA'yı düşündürmelidir.",
         AMI, specialties=["surgery"]))
    a(_c("gs_wses_ami_resus_abx", "wses_ami22", "Recommendations 7 and 8", ["treatment"],
         "When the diagnosis of acute mesenteric ischemia is made, fluid resuscitation should commence immediately to enhance visceral perfusion, electrolyte abnormalities should be corrected, nasogastric decompression initiated, and broad-spectrum antibiotics immediately administered.",
         "Akut mezenter iskemi tanısı konduğunda visseral perfüzyonu artırmak için sıvı resüsitasyonu hemen başlatılmalı, elektrolit bozuklukları düzeltilmeli, nazogastrik dekompresyon başlatılmalı ve geniş spektrumlu antibiyotikler hemen verilmelidir.",
         AMI, specialties=["surgery"]))
    a(_c("gs_wses_ami_surgery_revasc", "wses_ami22", "Recommendations 9, 10 and 12", ["disposition"],
         "Prompt laparoscopy or laparotomy should be done for patients with overt peritonitis; endovascular revascularization procedures are the primary option for arterial occlusion when sufficient expertise is available, and mesenteric venous thrombosis can often be treated with a continuous infusion of unfractionated heparin.",
         "Belirgin peritoniti olan hastalarda hızla laparoskopi veya laparotomi yapılmalıdır; yeterli deneyim varsa arteriyel tıkanıklıkta endovasküler revaskülarizasyon birincil seçenektir; mezenterik ven trombozu çoğu kez sürekli fraksiyone olmayan heparin infüzyonuyla tedavi edilebilir.",
         AMI, specialties=["surgery"]))

    # ---- Perforated peptic ulcer (WSES 2020) ----------------------------------
    a(_c("gs_wses_pud_ct", "wses_pud20", "Diagnosis", ["workup"],
         "In patients with acute abdomen from suspected perforated peptic ulcer, perform routine laboratory studies and arterial blood gas analysis and a CT scan, with chest or abdominal X-ray as the initial assessment if a CT scan is not promptly available.",
         "Şüpheli peptik ülser perforasyonuna bağlı akut karında rutin laboratuvar tetkikleri, arter kan gazı analizi ve BT yapın; BT hemen yapılamıyorsa ilk değerlendirme olarak akciğer veya batın grafisi çekin.",
         PUD, specialties=["surgery"]))
    a(_c("gs_wses_pud_resus_map65", "wses_pud20", "Resuscitation", ["treatment"],
         "Perform rapid resuscitation in perforated peptic ulcer; in unstable patients restore physiological parameters with a mean arterial pressure of 65 mmHg or more, a urine output of 0.5 ml/kg/h or more, and lactate normalisation, with early recognition of associated sepsis.",
         "Peptik ülser perforasyonunda hızlı resüsitasyon yapın; instabil hastalarda ortalama arter basıncı 65 mmHg veya üzeri, idrar çıkışı 0,5 ml/kg/saat veya üzeri ve laktat normalleşmesiyle fizyolojik parametreleri düzeltin ve eşlik eden sepsisi erken tanıyın.",
         PUD, specialties=["surgery"]))
    a(_c("gs_wses_pud_surgery_asap", "wses_pud20", "Operative management", ["disposition"],
         "In patients with perforated peptic ulcer with significant pneumoperitoneum, extraluminal contrast extravasation or signs of peritonitis, operative treatment is recommended, performed as soon as possible, especially in patients with delayed presentation and patients older than 70 years.",
         "Belirgin pnömoperitoneum, lümen dışı kontrast kaçağı veya peritonit bulguları olan peptik ülser perforasyonunda cerrahi tedavi önerilir ve özellikle geç başvuranlarda ve 70 yaş üzerindekilerde mümkün olan en kısa sürede yapılmalıdır.",
         PUD, specialties=["surgery"]))

    # ======================= HAEMATOLOGY =====================================
    LEUK, ANAEM, DIC, HAEMO, ITP, SICKLE, TRX = (["C95.00"], ["D64.9"], ["D65"], ["D66"], ["D69.3"], ["D57.00"],
                                                 ["T80.919"])
    a(_c("gs_nice_ng12_leukaemia_fbc", "ng12site", "1.10.1", ["history", "workup"],
         "Consider a very urgent full blood count to assess for leukaemia in adults with any of the following: pallor, persistent fatigue, unexplained fever, unexplained persistent or recurrent infection, generalised lymphadenopathy, unexplained bruising, unexplained bleeding, unexplained petechiae or hepatosplenomegaly.",
         "Solukluk, kalıcı yorgunluk, açıklanamayan ateş, açıklanamayan kalıcı veya tekrarlayan enfeksiyon, yaygın lenfadenopati, açıklanamayan morarma, açıklanamayan kanama, açıklanamayan peteşi veya hepatosplenomegaliden herhangi biri olan erişkinlerde lösemiyi değerlendirmek için çok acil tam kan sayımını düşünün.",
         LEUK, specialties=["haematology", "oncology"]))
    a(_c("gs_nice_ng12_leukaemia_children_immediate", "ng12site", "1.10.2", ["disposition"],
         "Refer children and young people for immediate specialist assessment for leukaemia if they have unexplained petechiae or hepatosplenomegaly.",
         "Açıklanamayan peteşisi veya hepatosplenomegalisi olan çocuk ve gençleri lösemi açısından hemen uzman değerlendirmesine yönlendirin.",
         LEUK, specialties=["haematology", "oncology"], population="paediatric"))

    # ---- Symptomatic anaemia (NICE NG24) -------------------------------------
    a(_c("gs_nice_ng24_restrictive_70", "ng24rbc", "1.5.1; 1.5.2; 1.5.3", ["treatment"],
         "Use restrictive red blood cell transfusion thresholds for people who do not have major haemorrhage, acute coronary syndrome or a need for regular transfusions for chronic anaemia: consider a threshold of 70 g/litre and a target of 70 to 90 g/litre after transfusion, and a threshold of 80 g/litre with a target of 80 to 100 g/litre for people with acute coronary syndrome.",
         "Majör kanaması, akut koroner sendromu veya kronik anemi nedeniyle düzenli transfüzyon gereksinimi olmayanlarda kısıtlayıcı eritrosit transfüzyon eşikleri kullanın: 70 g/litre eşik ve transfüzyon sonrası 70-90 g/litre hedef, akut koroner sendromda 80 g/litre eşik ve 80-100 g/litre hedef düşünün.",
         ANAEM, specialties=["haematology"]))
    a(_c("gs_nice_ng24_single_unit", "ng24rbc", "1.6.1; 1.6.2", ["treatment", "disposition"],
         "Consider single-unit red blood cell transfusions for adults who do not have active bleeding, and after each single-unit transfusion clinically reassess and check haemoglobin levels, giving further transfusions if needed.",
         "Aktif kanaması olmayan erişkinlerde tek ünite eritrosit transfüzyonunu düşünün ve her tek ünite transfüzyondan sonra klinik olarak yeniden değerlendirip hemoglobin düzeyine bakın; gerekirse ek transfüzyon yapın.",
         ANAEM, specialties=["haematology"]))

    # ---- Acute transfusion reaction (NICE NG24 section 1.13) ----------------
    a(_c("gs_nice_ng24_monitor_reactions", "ng24ps", "1.13.1", ["exam", "workup"],
         "Monitor the person's condition and vital signs before, during and after blood transfusions, to detect acute transfusion reactions that may need immediate investigation and treatment.",
         "Acil araştırma ve tedavi gerektirebilecek akut transfüzyon reaksiyonlarını saptamak için kan transfüzyonundan önce, sırasında ve sonrasında kişinin durumunu ve yaşamsal bulgularını izleyin.",
         TRX, specialties=["haematology"]))
    a(_c("gs_nice_ng24_observe_setting", "ng24ps", "1.13.2", ["disposition"],
         "Observe people who are having or have had a blood transfusion in a suitable environment with staff who are able to monitor and manage acute reactions.",
         "Kan transfüzyonu alan veya almış kişileri akut reaksiyonları izleyip yönetebilecek personelin bulunduğu uygun bir ortamda gözlem altında tutun.",
         TRX, specialties=["haematology"]))

    # ---- Disseminated intravascular coagulation -----------------------------
    a(_c("gs_dic14_underlying_cause", "dic14", "Treatment of the underlying disease", ["treatment"],
         "The cornerstone of DIC treatment is treatment of the underlying disorder, such as antibiotics or surgical drainage in infectious diseases and anticancer drugs or surgery in malignant diseases; all four guidelines agree on this point.",
         "DİK tedavisinin temeli altta yatan bozukluğun tedavisidir; örneğin enfeksiyon hastalıklarında antibiyotik veya cerrahi drenaj, malign hastalıklarda antikanser ilaçlar veya cerrahi; dört kılavuzun tamamı bu konuda hemfikirdir.",
         DIC, specialties=["haematology"]))
    a(_c("gs_dic14_scoring", "dic14", "Diagnosis: scoring system", ["workup"],
         "The use of a scoring system is recommended by each of the four guidelines to diagnose DIC, and a combination of tests repeated over time (platelet count, prothrombin time, fibrinogen and fibrin-related markers) can be used to diagnose the disorder with reasonable certainty in most cases.",
         "Dört kılavuzun her biri DİK tanısında bir skorlama sistemi kullanılmasını önerir; zaman içinde tekrarlanan testlerin bir kombinasyonu (trombosit sayısı, protrombin zamanı, fibrinojen ve fibrinle ilişkili belirteçler) çoğu olguda tanıyı makul bir kesinlikle koydurabilir.",
         DIC, specialties=["haematology"]))
    a(_c("gs_dic14_platelets_ffp", "dic14", "Treatment: blood components", ["treatment"],
         "Platelet concentrate is generally given in DIC patients with active bleeding and a platelet count of 50 × 10^9/l or less, with a lower threshold of 10 to 20 × 10^9/l in non-bleeding patients after chemotherapy; fresh frozen plasma is used for active bleeding with a prolonged APTT or PT (greater than 1.5 times normal), at an initial dose of 15 ml/kg.",
         "Trombosit konsantresi genellikle aktif kanaması ve trombosit sayısı 50 × 10^9/l veya altı olan DİK hastalarına verilir; kemoterapi sonrası kanamayan hastalarda eşik 10-20 × 10^9/l'dir; taze donmuş plazma uzamış APTT veya PT (normalin 1,5 katından fazla) ile aktif kanamada 15 ml/kg başlangıç dozuyla kullanılır.",
         DIC, specialties=["haematology"]))

    # ---- Haemophilia with acute bleed (Egyptian national guidelines 2025) ------
    a(_c("gs_haemeg25_head_trauma", "haem_eg25", "CNS bleeding: recommendations", ["triage", "treatment"],
         "Any head trauma in people with haemophilia must be considered non-trivial until proven otherwise, and immediate treatment is recommended; if the patient is on home therapy, the product may be administered before leaving home or on route to the facility.",
         "Hemofilili kişilerde her kafa travması aksi kanıtlanana kadar önemsiz değildir ve hemen tedavi önerilir; hasta evde tedavi alıyorsa ürün evden çıkmadan veya merkeze giderken uygulanabilir.",
         HAEMO, specialties=["haematology"], population="paediatric"))
    a(_c("gs_haemeg25_pain_price", "haem_eg25", "Pain management", ["treatment"],
         "For pain management in haemophilia avoid non-steroidal anti-inflammatory drugs (COX-2 inhibitors are relatively safe), and in acute haemorrhage use the PRICE technique (protection, rest, ice, compression and elevation) to alleviate pain, with a stepwise analgesic ladder from paracetamol to strong opioids.",
         "Hemofilide ağrı yönetiminde nonsteroid antiinflamatuvar ilaçlardan kaçının (COX-2 inhibitörleri görece güvenlidir); akut kanamada ağrıyı hafifletmek için PRICE tekniğini (koruma, istirahat, buz, kompresyon ve elevasyon) kullanın ve parasetamolden güçlü opioidlere basamaklı analjezik merdiveni izleyin.",
         HAEMO, specialties=["haematology"], population="paediatric"))

    # ---- Immune thrombocytopenia -------------------------------------------
    a(_c("gs_itp26_critical_bleed_definition", "itp_crit26", "Summary of guideline process", ["triage"],
         "A critical bleed in immune thrombocytopenia is a bleed in a critical anatomical site (intracranial, intraspinal, intraocular with vision loss, retroperitoneal, pericardial, or intramuscular with compartment syndrome) or a bleed that results in hemodynamic instability or respiratory compromise in a patient with severe thrombocytopenia (platelets below 20 × 10^9/L).",
         "İmmün trombositopenide kritik kanama, kritik bir anatomik bölgede (kafa içi, spinal, görme kaybıyla göz içi, retroperitoneal, perikardiyal veya kompartman sendromuyla kas içi) olan ya da ağır trombositopenisi (trombosit 20 × 10^9/L altı) olan hastada hemodinamik instabilite veya solunum bozukluğuna yol açan kanamadır.",
         ITP, specialties=["haematology"]))
    a(_c("gs_itp26_steroids_ivig", "itp_crit26", "Recommendations 1 and 2", ["treatment"],
         "For a critical bleed in ITP the panel recommends high-dose corticosteroids, such as IV dexamethasone 40 mg per day for 4 days or IV methylprednisolone 1 g per day for 3 days, aiming for a rapid response within 24 to 48 hours, and IVIG over no IVIG, each in combination with the other recommended treatments.",
         "İTP'de kritik kanamada panel, 24-48 saatte hızlı yanıt hedefiyle 4 gün günde 40 mg IV deksametazon veya 3 gün günde 1 g IV metilprednizolon gibi yüksek doz kortikosteroidleri ve IVIG'i önerir; her biri diğer önerilen tedavilerle birlikte verilir.",
         ITP, specialties=["haematology"]))
    a(_c("gs_itp26_platelet_transfusion", "itp_crit26", "Recommendation 3", ["treatment"],
         "For adults with suspected or confirmed ITP and a platelet count below 20 × 10^9/L who present to the emergency department with a critical bleed, the panel recommends platelet transfusion over no platelet transfusion; for patients without critical ITP bleeding, platelet transfusions should generally be avoided.",
         "Şüpheli veya doğrulanmış İTP'si olup trombosit sayısı 20 × 10^9/L altında olan ve acil servise kritik kanamayla başvuran erişkinlerde panel trombosit transfüzyonunu önerir; kritik İTP kanaması olmayan hastalarda trombosit transfüzyonlarından genellikle kaçınılmalıdır.",
         ITP, specialties=["haematology"]))
    a(_c("gs_itp26_tranexamic", "itp_crit26", "Recommendation 4", ["treatment"],
         "For a critical bleed in ITP the panel recommends tranexamic acid over no tranexamic acid; dosing is 1 g IV every 6 to 8 hours for about 3 days, with ongoing use individualized and reassessed depending on thrombotic risk.",
         "İTP'de kritik kanamada panel traneksamik asidi önerir; doz yaklaşık 3 gün boyunca 6-8 saatte bir 1 g IV'dir ve devam eden kullanım trombotik riske göre bireyselleştirilip yeniden değerlendirilir.",
         ITP, specialties=["haematology"]))
    a(_c("gs_itp_cn25_exclusion", "itp_cn25", "Diagnostic evaluation", ["workup"],
         "The diagnosis of ITP remains one of exclusion: at least two consecutive blood tests showing a platelet count below 100 × 10^9/L, a normal peripheral smear, the absence of splenomegaly and the exclusion of other secondary causes.",
         "İTP tanısı dışlama tanısıdır: trombosit sayısının 100 × 10^9/L altında olduğunu gösteren en az iki ardışık kan testi, normal periferik yayma, splenomegali olmaması ve diğer sekonder nedenlerin dışlanması.",
         ITP, specialties=["haematology"], countries=["GLOBAL", "CN"]))

    # ---- Sickle cell crisis (NICE CG143) -------------------------------------
    a(_c("gs_nice_cg143_analgesia_30min", "cg143", "1.1.1; 1.1.3; 1.1.4", ["triage", "treatment"],
         "Treat an acute painful sickle cell episode as an acute medical emergency, assess pain with an age-appropriate pain scoring tool, and offer analgesia within 30 minutes of presentation.",
         "Akut ağrılı orak hücre atağını akut tıbbi acil durum olarak ele alın, ağrıyı yaşa uygun bir ağrı skorlama aracıyla değerlendirin ve başvurudan sonraki 30 dakika içinde analjezi verin.",
         SICKLE, specialties=["haematology"]))
    a(_c("gs_nice_cg143_observations_oxygen", "cg143", "1.1.5", ["exam"],
         "Clinically assess all patients presenting with an acute painful sickle cell episode, monitoring blood pressure, oxygen saturation on air (offer oxygen therapy if 95% or below), pulse rate, respiratory rate and temperature.",
         "Akut ağrılı orak hücre ataklı tüm hastaları kan basıncı, oda havasında oksijen satürasyonu (yüzde 95 veya altındaysa oksijen tedavisi verin), nabız, solunum sayısı ve ateşi izleyerek klinik olarak değerlendirin.",
         SICKLE, specialties=["haematology"]))
    a(_c("gs_nice_cg143_strong_opioid", "cg143", "1.1.8; 1.1.10; 1.1.11", ["treatment"],
         "Offer a bolus dose of a strong opioid to all patients presenting with severe pain, and to those with moderate pain who have already had some analgesia, together with regular paracetamol and NSAIDs unless contraindicated; do not offer pethidine.",
         "Şiddetli ağrıyla başvuran tüm hastalara ve daha önce bir miktar analjezi almış orta ağrılı hastalara güçlü bir opioidin bolus dozunu, kontrendikasyon yoksa düzenli parasetamol ve NSAİİ ile birlikte verin; petidin vermeyin.",
         SICKLE, specialties=["haematology"]))
    a(_c("gs_nice_cg143_reassess_30min", "cg143", "1.1.12; 1.1.16", ["disposition"],
         "Assess the effectiveness of pain relief every 30 minutes until satisfactory and at least every 4 hours thereafter, and monitor patients taking strong opioids for adverse events, including sedation score, every 1 hour for the first 6 hours.",
         "Ağrı kesmenin etkinliğini yeterli olana kadar 30 dakikada bir, sonra en az 4 saatte bir değerlendirin ve güçlü opioid alan hastaları ilk 6 saat boyunca saatte bir sedasyon skoru dahil yan etkiler açısından izleyin.",
         SICKLE, specialties=["haematology"]))
    a(_c("gs_nice_cg143_acute_chest", "cg143", "1.1.19; 1.1.21", ["workup"],
         "Be aware of the possibility of acute chest syndrome if there are abnormal respiratory signs or symptoms, chest pain, fever, or signs of hypoxia (oxygen saturation 95% or below or an escalating oxygen requirement), and do not use corticosteroids in an uncomplicated acute painful sickle cell episode.",
         "Anormal solunum belirti veya bulguları, göğüs ağrısı, ateş ya da hipoksi bulguları (oksijen satürasyonu yüzde 95 veya altı ya da artan oksijen gereksinimi) varsa akut göğüs sendromu olasılığını bilin; komplike olmayan akut ağrılı orak hücre atağında kortikosteroid kullanmayın.",
         SICKLE, specialties=["haematology"]))

    # ======================= INFECTIOUS DISEASES =============================
    HIV, MONO, OSTEO, TET = ["B20"], ["B27.90"], ["M86.9"], ["A35"]
    a(_c("gs_nice_ng60_test_indicator", "ng60", "1.1.5", ["workup"],
         "In all areas, offer and recommend HIV testing on admission to hospital, including emergency departments, to everyone not previously diagnosed with HIV who has symptoms that may indicate HIV or for whom HIV is part of the differential diagnosis, for example an infectious mononucleosis-like syndrome.",
         "Her bölgede, daha önce HIV tanısı almamış olup HIV'i düşündüren belirtileri olan veya ayırıcı tanısında HIV bulunan (örneğin enfeksiyöz mononükleoz benzeri sendrom) herkese, acil servisler dahil hastaneye yatışta HIV testi önerin ve tavsiye edin.",
         HIV + MONO, specialties=["infectious"]))
    a(_c("gs_nice_ng60_fourth_generation", "ng60", "1.1.3; 1.3.6", ["workup"],
         "Ensure both fourth-generation serological testing and point-of-care testing are available, and highlight the significantly reduced window period that results from newer tests such as fourth-generation serological testing.",
         "Hem dördüncü kuşak serolojik testin hem de yatak başı testin erişilebilir olmasını sağlayın ve dördüncü kuşak serolojik test gibi yeni testlerle belirgin biçimde kısalan pencere dönemini vurgulayın.",
         HIV, specialties=["infectious"]))
    a(_c("gs_cdc_hiv_nat_window", "cdc_hiv_dx", "Key points: types of HIV tests", ["workup"],
         "Each type of HIV test has its own window period, with nucleic acid tests (NAT), which detect HIV RNA, capable of detecting HIV the earliest; antigen/antibody combination tests detect HIV p24 antigen as well as antibodies.",
         "Her HIV testi türünün kendi pencere dönemi vardır; HIV RNA'sını saptayan nükleik asit testleri (NAT) HIV'i en erken saptayabilir; antijen/antikor kombinasyon testleri antikorların yanı sıra HIV p24 antijenini de saptar.",
         HIV, specialties=["infectious"], countries=["US"]))

    # ---- Infectious mononucleosis --------------------------------------------
    a(_c("gs_cdc_mono_no_penicillin_sports", "cdc_mono", "Treatment; avoid contact sports", ["treatment", "disposition"],
         "People with infectious mononucleosis should not take penicillin antibiotics like ampicillin or amoxicillin, and because the spleen may become enlarged they should avoid contact sports until fully recovered, as these may cause the spleen to rupture.",
         "Enfeksiyöz mononükleozu olan kişiler ampisilin veya amoksisilin gibi penisilin antibiyotikleri almamalıdır; dalak büyüyebileceğinden tam iyileşene kadar dalak rüptürüne yol açabilecek temas sporlarından kaçınmalıdır.",
         MONO, specialties=["infectious"], countries=["US"]))
    a(_c("gs_cdc_mono_supportive", "cdc_mono", "Treatment", ["treatment"],
         "Most people with infectious mononucleosis get better in 2 to 4 weeks; symptoms can be relieved by drinking fluids to stay hydrated, getting plenty of rest and taking over-the-counter medications for pain and fever.",
         "Enfeksiyöz mononükleozlu kişilerin çoğu 2-4 haftada iyileşir; belirtiler yeterli sıvı alarak, bol dinlenerek ve ağrı ve ateş için reçetesiz ilaçlar alarak hafifletilebilir.",
         MONO, specialties=["infectious"], countries=["US"]))
    a(_c("gs_cdc_ebv_testing_complications", "cdc_ebv", "Testing and diagnosis; complications", ["workup", "exam"],
         "Laboratory tests are not usually needed to diagnose infectious mononucleosis, but specific tests may be needed for patients who do not have a typical case; complications include peritonsillar abscesses, suppurative lymph nodes and blockage of the air passages in the nose and throat.",
         "Enfeksiyöz mononükleoz tanısı için genellikle laboratuvar testi gerekmez, ancak tipik olmayan olgularda özgül testler gerekebilir; komplikasyonlar arasında peritonsiller apse, süpüratif lenf nodları ve burun ile boğazdaki hava yollarının tıkanması vardır.",
         MONO, specialties=["infectious"], countries=["US"]))

    # ---- Osteomyelitis (NICE NG19, diabetic foot) ------------------------------
    a(_c("gs_nice_ng19_think_osteo", "ng19", "1.6.3; 1.6.4; 1.6.5", ["workup"],
         "Think about osteomyelitis if a person with diabetes has a local infection, a deep foot wound or a chronic foot wound; it may be present despite normal inflammatory markers, X-rays or probe-to-bone testing, and if it is suspected but not confirmed by initial X-ray, consider an MRI.",
         "Diyabetli kişide lokal enfeksiyon, derin ayak yarası veya kronik ayak yarası varsa osteomiyeliti düşünün; normal inflamatuvar belirteçlere, grafilere veya kemiğe sonda testine rağmen bulunabilir; şüpheleniliyor ancak ilk grafiyle doğrulanmıyorsa MRG'yi düşünün.",
         OSTEO, specialties=["infectious", "orthopaedics"]))
    a(_c("gs_nice_ng19_bone_sample", "ng19", "1.6.1; 1.6.6", ["workup", "treatment"],
         "If a diabetic foot infection is suspected and a wound is present, send a soft tissue or bone sample from the base of the debrided wound for microbiological examination, and start antibiotic treatment as soon as possible, taking samples before or as close as possible to the start of treatment.",
         "Diyabetik ayak enfeksiyonundan şüpheleniliyor ve yara varsa debride edilmiş yaranın tabanından yumuşak doku veya kemik örneğini mikrobiyolojik incelemeye gönderin ve örnekleri tedavinin başlangıcından önce veya mümkün olduğunca yakın alarak antibiyotik tedavisine mümkün olan en kısa sürede başlayın.",
         OSTEO, specialties=["infectious", "orthopaedics"]))
    a(_c("gs_nice_ng19_reassess", "ng19", "1.6.12; 1.6.15", ["disposition"],
         "Base antibiotic course length on the severity of the infection and the clinical response, and reassess people with suspected diabetic foot infection if symptoms worsen rapidly, do not start to improve within 1 to 2 days, or the person becomes systemically very unwell or has pain out of proportion to the infection.",
         "Antibiyotik süresini enfeksiyonun ağırlığına ve klinik yanıta göre belirleyin; belirtiler hızla kötüleşirse, 1-2 gün içinde düzelmeye başlamazsa veya kişi sistemik olarak çok kötüleşirse ya da enfeksiyonla orantısız ağrısı varsa şüpheli diyabetik ayak enfeksiyonunu yeniden değerlendirin.",
         OSTEO, specialties=["infectious", "orthopaedics"]))

    # ---- Tetanus ---------------------------------------------------------------
    a(_c("gs_cdc_tetanus_clinical_dx", "cdc_tetanus", "Diagnosis", ["history", "exam"],
         "There are no laboratory tests that can diagnose or rule out tetanus; healthcare providers diagnose tetanus clinically, in the absence of a more likely cause, from trismus (lockjaw), spasms, muscle rigidity and difficulty swallowing or breathing caused by muscle spasms.",
         "Tetanozu tanılayabilecek veya dışlayabilecek laboratuvar testi yoktur; sağlık çalışanları daha olası bir neden yoksa trismus (çene kilitlenmesi), spazmlar, kas rijiditesi ve kas spazmlarına bağlı yutma veya solunum güçlüğüne dayanarak tetanoza klinik olarak tanı koyar.",
         TET, specialties=["infectious"], countries=["US"]))
    a(_c("gs_who_tetanus_treatment", "who_tetanus", "Treatment", ["treatment"],
         "Tetanus is a medical emergency requiring care in hospital, immediate treatment with human tetanus immune globulin (TIG), aggressive wound care, drugs to control muscle spasms, antibiotics and tetanus vaccination.",
         "Tetanoz; hastanede bakım, insan tetanoz immünoglobulini (TIG) ile acil tedavi, agresif yara bakımı, kas spazmlarını kontrol eden ilaçlar, antibiyotikler ve tetanoz aşısı gerektiren tıbbi bir acil durumdur.",
         TET, specialties=["infectious"]))
    a(_c("gs_who_tetanus_no_immunity", "who_tetanus", "Treatment; symptoms", ["disposition"],
         "People who recover from tetanus do not have natural immunity and can be infected again, and therefore need to be immunized; the incubation period varies between 3 and 21 days after infection, with most cases within 14 days.",
         "Tetanozdan iyileşenlerde doğal bağışıklık gelişmez ve yeniden enfekte olabilirler; bu nedenle aşılanmaları gerekir; kuluçka süresi enfeksiyondan sonra 3-21 gün arasında değişir ve çoğu olgu 14 gün içinde görülür.",
         TET, specialties=["infectious"]))
    a(_c("gs_cdc_tetanus_prevention_tig", "cdc_tetanus", "Prevention; risk of death", ["treatment"],
         "Preventing tetanus involves proper wound care, use of tetanus vaccine and tetanus immune globulin (TIG) prophylaxis; even with modern intensive care, generalized tetanus results in death for about 1 in 10 cases.",
         "Tetanozun önlenmesi uygun yara bakımı, tetanoz aşısı kullanımı ve tetanoz immünoglobulini (TIG) profilaksisini içerir; modern yoğun bakıma rağmen jeneralize tetanoz olguların yaklaşık 10'da 1'inde ölümle sonuçlanır.",
         TET, specialties=["infectious"], countries=["US"]))

    # ======================= MUSCULOSKELETAL / TOXICOLOGY ======================
    GOUT, HIP, LBP, OPENFX, ACS_, RHAB, TCA = (["M10.9"], ["S72.009"], ["M54.5"], ["S82.90"], ["T79.A0"],
                                              ["M62.82"], ["T43.0X"])
    # ---- Acute gout (NICE NG219) -------------------------------------------
    a(_c("gs_nice_ng219_septic_first", "ng219", "1.1.3; 1.1.4", ["exam", "disposition"],
         "Assess the possibility of septic arthritis, calcium pyrophosphate crystal deposition and inflammatory arthritis in people presenting with a painful, red, swollen joint, and if septic arthritis is suspected refer immediately according to the local care pathway.",
         "Ağrılı, kızarık, şiş eklemle başvuranlarda septik artrit, kalsiyum pirofosfat kristal birikimi ve inflamatuvar artrit olasılığını değerlendirin; septik artritten şüpheleniliyorsa yerel bakım yoluna göre hemen yönlendirin.",
         GOUT + ["M00.9"], specialties=["rheumatology"]))
    a(_c("gs_nice_ng219_urate_aspiration", "ng219", "1.1.7; 1.1.8", ["workup"],
         "Measure the serum urate level to confirm the clinical diagnosis of gout (360 micromol/litre or more); if it is below 360 micromol/litre during a flare and gout is strongly suspected, repeat it later, and consider joint aspiration and microscopy of synovial fluid if the diagnosis remains uncertain.",
         "Gutun klinik tanısını doğrulamak için serum ürat düzeyini ölçün (360 mikromol/litre veya üzeri); atak sırasında 360 mikromol/litrenin altındaysa ve gut kuvvetle düşünülüyorsa daha sonra tekrarlayın; tanı belirsiz kalırsa eklem aspirasyonu ve sinovyal sıvı mikroskopisini düşünün.",
         GOUT, specialties=["rheumatology"]))
    a(_c("gs_nice_ng219_flare_first_line", "ng219", "1.3.1; 1.3.2; 1.3.3", ["treatment"],
         "Offer an NSAID, colchicine or a short course of an oral corticosteroid for first-line treatment of a gout flare, taking into account comorbidities, co-prescriptions and preferences; consider adding a proton pump inhibitor with an NSAID, and an intra-articular or intramuscular corticosteroid injection if NSAIDs and colchicine are contraindicated, not tolerated or ineffective.",
         "Gut atağının ilk basamak tedavisi için eşlik eden hastalıkları, birlikte kullanılan ilaçları ve tercihleri göz önünde bulundurarak NSAİİ, kolşisin veya kısa süreli oral kortikosteroid önerin; NSAİİ ile birlikte proton pompa inhibitörü eklemeyi, NSAİİ ve kolşisin kontrendike, tolere edilemez veya etkisizse eklem içi ya da kas içi kortikosteroid enjeksiyonunu düşünün.",
         GOUT, specialties=["rheumatology"]))
    a(_c("gs_nice_ng219_ult_timing_target", "ng219", "1.5.4; 1.5.6; 1.5.8", ["disposition"],
         "Start urate-lowering therapy at least 2 to 4 weeks after a gout flare has settled, offering allopurinol or febuxostat first line, and aim for a target serum urate level below 360 micromol/litre.",
         "Ürat düşürücü tedaviye gut atağı yatıştıktan en az 2-4 hafta sonra başlayın, ilk basamakta allopurinol veya febuksostat önerin ve 360 mikromol/litrenin altında hedef serum ürat düzeyi amaçlayın.",
         GOUT, specialties=["rheumatology"]))

    # ---- Hip fracture (NICE CG124) -------------------------------------------
    a(_c("gs_nice_cg124_mri_occult", "cg124", "1.1.1", ["workup"],
         "Offer MRI if hip fracture is suspected despite negative X-rays of the hip of an adequate standard; if MRI is not available within 24 hours or is contraindicated, consider CT.",
         "Yeterli standarttaki kalça grafileri negatif olmasına rağmen kalça kırığından şüpheleniliyorsa MRG önerin; MRG 24 saat içinde yapılamıyorsa veya kontrendikeyse BT'yi düşünün.",
         HIP, specialties=["orthopaedics"]))
    a(_c("gs_nice_cg124_analgesia_immediate", "cg124", "1.3.1; 1.3.2; 1.3.4; 1.3.5; 1.3.6", ["triage", "treatment"],
         "Assess pain immediately on presentation and within 30 minutes of initial analgesia, offer immediate analgesia to people with suspected hip fracture including those with cognitive impairment, offer paracetamol every 6 hours preoperatively with additional opioids if needed, and consider nerve blocks if these are insufficient.",
         "Ağrıyı başvuruda hemen ve ilk analjeziden sonraki 30 dakika içinde değerlendirin, bilişsel bozukluğu olanlar dahil şüpheli kalça kırığı olan herkese hemen analjezi verin, ameliyat öncesi 6 saatte bir parasetamol ve gerekirse ek opioid önerin, bunlar yetersizse sinir bloklarını düşünün.",
         HIP, specialties=["orthopaedics"]))
    a(_c("gs_nice_cg124_surgery_day", "cg124", "1.2.1; 1.2.2", ["disposition"],
         "Perform surgery on the day of, or the day after, admission, and identify and treat correctable comorbidities immediately so that surgery is not delayed, such as anaemia, anticoagulation, volume depletion, electrolyte imbalance, uncontrolled diabetes or heart failure.",
         "Ameliyatı yatış günü veya ertesi gün yapın ve ameliyatın gecikmemesi için anemi, antikoagülasyon, hacim kaybı, elektrolit bozukluğu, kontrolsüz diyabet veya kalp yetmezliği gibi düzeltilebilir eşlik eden hastalıkları hemen saptayıp tedavi edin.",
         HIP, specialties=["orthopaedics"]))
    a(_c("gs_nice_cg124_mobilise_day1", "cg124", "1.7.1", ["disposition"],
         "Offer people a physiotherapy assessment and, unless medically or surgically contraindicated, mobilisation on the day after surgery.",
         "Tıbbi veya cerrahi kontrendikasyon yoksa kişilere ameliyattan sonraki gün fizyoterapi değerlendirmesi ve mobilizasyon önerin.",
         HIP, specialties=["orthopaedics"]))

    # ---- Mechanical low back pain (NICE NG59) -------------------------------
    a(_c("gs_nice_ng59_alternative_dx", "ng59", "1.1.1", ["history"],
         "Think about alternative diagnoses when examining or reviewing people with low back pain, particularly if they develop new or changed symptoms, and exclude specific causes such as cancer, infection, trauma or inflammatory disease such as spondyloarthritis.",
         "Bel ağrılı kişileri muayene ederken veya gözden geçirirken, özellikle yeni ya da değişen belirtiler gelişirse alternatif tanıları düşünün ve kanser, enfeksiyon, travma veya spondiloartrit gibi inflamatuvar hastalık gibi özgül nedenleri dışlayın.",
         LBP + ["G83.4"], specialties=["musculoskeletal"]))
    a(_c("gs_nice_ng59_no_routine_imaging", "ng59", "1.1.4; 1.1.6", ["workup"],
         "Do not routinely offer imaging in a non-specialist setting for people with low back pain with or without sciatica, and in specialist settings consider imaging only if the result is likely to change management.",
         "Siyatiği olsun olmasın bel ağrılı kişilere uzman olmayan ortamda rutin görüntüleme önermeyin; uzman ortamda yalnızca sonuç yönetimi değiştirecekse görüntülemeyi düşünün.",
         LBP, specialties=["musculoskeletal"]))
    a(_c("gs_nice_ng59_nsaid_not_paracetamol", "ng59", "1.2.23; 1.2.24; 1.2.25; 1.2.26", ["treatment"],
         "Prescribe oral NSAIDs for low back pain at the lowest effective dose for the shortest possible period, with clinical assessment and gastroprotection as needed; consider weak opioids for acute low back pain only if an NSAID is contraindicated, not tolerated or ineffective, and do not offer paracetamol alone.",
         "Bel ağrısında oral NSAİİ'leri en düşük etkili dozda ve mümkün olan en kısa süre, gerektiğinde klinik değerlendirme ve gastroproteksiyonla reçete edin; akut bel ağrısında zayıf opioidleri yalnızca NSAİİ kontrendike, tolere edilemez veya etkisizse düşünün ve yalnızca parasetamol vermeyin.",
         LBP, specialties=["musculoskeletal"]))
    a(_c("gs_nice_ng59_self_management", "ng59", "1.2.1; 1.1.2", ["disposition"],
         "Provide advice and information to help people self-manage low back pain with or without sciatica, including encouragement to continue with normal activities, and consider risk stratification such as the STarT Back tool at first contact.",
         "Siyatiği olsun olmasın bel ağrısını kendi kendine yönetmelerine yardımcı olacak öneri ve bilgiler verin, normal etkinliklerini sürdürmeleri için cesaretlendirin ve ilk temasta STarT Back aracı gibi risk sınıflamasını düşünün.",
         LBP, specialties=["musculoskeletal"]))

    # ---- Open long-bone fracture (BOAST 4) ------------------------------------
    a(_c("gs_boast4_antibiotics_1h", "boast4", "Standards for practice", ["treatment"],
         "Intravenous prophylactic antibiotics should be administered as soon as possible, ideally within 1 hour of injury, for open fractures of long bones, hind foot or midfoot.",
         "Uzun kemik, arka ayak veya orta ayak açık kırıklarında intravenöz profilaktik antibiyotikler mümkün olan en kısa sürede, ideal olarak yaralanmadan sonraki 1 saat içinde verilmelidir.",
         OPENFX, specialties=["orthopaedics"]))
    a(_c("gs_boast4_neurovascular_splint", "boast4", "Standards for practice", ["exam"],
         "Examination of the injured limb should include assessment and documentation of vascular and neurological status, repeated systematically, particularly after reduction manoeuvres or the application of splints, and the limb should be re-aligned and splinted.",
         "Yaralı ekstremitenin muayenesi damar ve sinir durumunun değerlendirilip kaydedilmesini içermeli, özellikle redüksiyon manevraları veya atel uygulamasından sonra sistematik olarak tekrarlanmalı ve ekstremite hizalanıp atele alınmalıdır.",
         OPENFX, specialties=["orthopaedics"]))
    a(_c("gs_boast4_wound_photo_dressing", "boast4", "Standards for practice", ["treatment"],
         "Before formal debridement the wound should be handled only to remove gross contamination and to allow photography, then dressed with a saline-soaked gauze and covered with an occlusive film; mini-washouts outside the operating theatre are not indicated.",
         "Resmi debridmandan önce yaraya yalnızca kaba kirlenmeyi temizlemek ve fotoğraf çekmek için dokunulmalı, ardından salinle ıslatılmış gazlı bezle kapatılıp okluzif filmle örtülmelidir; ameliyathane dışında mini yıkamalar endike değildir.",
         OPENFX, specialties=["orthopaedics"]))
    a(_c("gs_boast4_orthoplastic_debridement", "boast4", "Standards for practice", ["disposition"],
         "Patients with open fractures of long bones, hind foot or midfoot should be taken directly or transferred to a specialist centre that can provide orthoplastic care; debridement should be performed immediately for highly contaminated wounds or associated vascular compromise, within 12 hours for other solitary high energy open fractures and within 24 hours for other low energy open fractures.",
         "Uzun kemik, arka ayak veya orta ayak açık kırığı olan hastalar doğrudan ortoplastik bakım sağlayabilen bir uzman merkeze götürülmeli veya nakledilmelidir; debridman yüksek derecede kirli yaralarda veya eşlik eden damar tehlikesinde hemen, diğer tek yüksek enerjili açık kırıklarda 12 saat içinde ve diğer düşük enerjili açık kırıklarda 24 saat içinde yapılmalıdır.",
         OPENFX, specialties=["orthopaedics"]))

    # ---- Acute compartment syndrome (BOAST 10, Association of Anaesthetists) --
    a(_c("gs_boast10_pain_out_of_proportion", "boast10", "Background", ["exam"],
         "Key clinical findings of acute compartment syndrome include pain out of proportion to the associated injury and pain on passive movement of the muscles of the involved compartments.",
         "Akut kompartman sendromunun temel klinik bulguları ilişkili yaralanmayla orantısız ağrı ve tutulan kompartman kaslarının pasif hareketiyle ağrıdır.",
         ACS_, specialties=["orthopaedics"]))
    a(_c("gs_boast10_hourly_release_30min", "boast10", "Standards for practice", ["workup", "treatment"],
         "Patients at risk of acute compartment syndrome should be assessed hourly with documentation; patients with symptoms or signs should have circumferential dressings released to expose the skin, the limb elevated and re-evaluation within 30 minutes.",
         "Akut kompartman sendromu riski taşıyan hastalar saatte bir değerlendirilip kaydedilmelidir; belirti veya bulgusu olanlarda cildi açığa çıkaracak şekilde çevresel sargılar gevşetilmeli, ekstremite yükseltilmeli ve 30 dakika içinde yeniden değerlendirme yapılmalıdır.",
         ACS_, specialties=["orthopaedics"]))
    a(_c("gs_boast10_pressures_decompression", "boast10", "Standards for practice; footnote", ["workup", "disposition"],
         "A difference between the diastolic blood pressure and the compartment pressure of less than 30 mmHg indicates an increased risk of compartment syndrome, and immediate surgical decompression of all involved compartments should follow a diagnosis of compartment syndrome.",
         "Diyastolik kan basıncı ile kompartman basıncı arasındaki farkın 30 mmHg'den az olması artmış kompartman sendromu riskini gösterir ve kompartman sendromu tanısını tüm tutulan kompartmanların hemen cerrahi dekompresyonu izlemelidir.",
         ACS_, specialties=["orthopaedics"]))
    a(_c("gs_aagbi21_breakthrough_pain", "aagbi_acs21", "Recommendations; clinical features", ["exam"],
         "Patients at risk of acute compartment syndrome should be identified on admission or at the time of surgery and managed within agreed multidisciplinary protocols; pain out of proportion to the injury is often the earliest sign, and breakthrough pain is considered a cardinal feature, although severe pain is not always present.",
         "Akut kompartman sendromu riski taşıyan hastalar yatışta veya ameliyat sırasında belirlenmeli ve üzerinde anlaşılmış multidisipliner protokollerle yönetilmelidir; yaralanmayla orantısız ağrı çoğu kez en erken bulgudur ve kırılma ağrısı temel özellik sayılır, ancak şiddetli ağrı her zaman bulunmaz.",
         ACS_, specialties=["anaesthesia", "orthopaedics"]))

    # ---- Rhabdomyolysis (AAST 2022) ----------------------------------------------
    a(_c("gs_aast_rhabdo_suspect_ck", "aast_rhabdo22", "Recommendations: presentation and laboratory evaluation", ["workup"],
         "Rhabdomyolysis is suggested by elevated serum CK (more than 5 times the upper limit of normal or more than 1000 IU/L), myoglobin, LDH, potassium, creatinine and AST; CK should be followed with serial measurement until a peak is identified, typically at 24 to 72 hours.",
         "Rabdomiyoliz yüksek serum CK (normalin üst sınırının 5 katından fazla veya 1000 IU/L üzeri), miyoglobin, LDH, potasyum, kreatinin ve AST ile düşündürülür; CK zirve saptanana kadar (genellikle 24-72 saatte) seri ölçümlerle izlenmelidir.",
         RHAB, specialties=["critical care"], countries=["US"]))
    a(_c("gs_aast_rhabdo_fluids", "aast_rhabdo22", "Recommendation: crystalloid type, rate and urine output goals", ["treatment"],
         "Either lactated Ringer's solution or saline is an acceptable fluid for resuscitation in rhabdomyolysis; a starting rate of 400 mL/hour can be initiated, with goal-directed therapy to a urine output of 1 to 3 mL/kg/hour and up to 300 mL/hour.",
         "Rabdomiyolizde resüsitasyon için laktatlı Ringer veya salin kabul edilebilir sıvıdır; saatte 400 mL başlangıç hızıyla başlanabilir ve idrar çıkışı saatte 1-3 mL/kg ve saatte 300 mL'ye kadar hedeflenir.",
         RHAB, specialties=["critical care"], countries=["US"]))
    a(_c("gs_aast_rhabdo_no_bicarb_rrt", "aast_rhabdo22", "Recommendations: bicarbonate, diuretics and RRT", ["treatment", "disposition"],
         "The use of sodium bicarbonate or diuretics for prevention of AKI in rhabdomyolysis is not recommended, and there is no role for renal replacement therapy to prevent AKI; RRT should be based on traditional indications for AKI.",
         "Rabdomiyolizde ABH'yi önlemek için sodyum bikarbonat veya diüretik kullanımı önerilmez ve ABH'yi önlemede renal replasman tedavisinin yeri yoktur; RRT geleneksel ABH endikasyonlarına göre verilmelidir.",
         RHAB, specialties=["critical care"], countries=["US"]))
    a(_c("gs_aast_rhabdo_potassium", "aast_rhabdo22", "Recommendation: electrolytes", ["workup"],
         "Hyperkalemia, hyperphosphatemia and hypocalcemia are the electrolyte abnormalities most commonly encountered in rhabdomyolysis, and correcting them should proceed meticulously; hyperkalemia is the abnormality that requires the most urgent attention.",
         "Rabdomiyolizde en sık görülen elektrolit bozuklukları hiperkalemi, hiperfosfatemi ve hipokalsemidir ve titizlikle düzeltilmelidir; en acil dikkat gerektiren bozukluk hiperkalemidir.",
         RHAB, specialties=["critical care"], countries=["US"]))

    # ---- Tricyclic antidepressant overdose (EXTRIP 2014) -------------------------
    a(_c("gs_extrip_tca_ecg_qrs", "extrip_tca14", "Pharmacology and toxicity", ["workup"],
         "TCA concentrations are less predictive than ECG findings to identify high-risk patients: QRS duration is a better predictor of seizures and ventricular arrhythmia than serum concentrations, and an R wave in aVR of more than 3 mm had a good predictive value for seizures or arrhythmias.",
         "Yüksek riskli hastaları belirlemede TSA düzeyleri EKG bulgularından daha az öngörücüdür: QRS süresi nöbet ve ventriküler aritmiyi serum düzeylerinden daha iyi öngörür ve aVR'de 3 mm'den büyük R dalgası nöbet veya aritmi için iyi öngörü değerine sahiptir.",
         TCA, specialties=["toxicology"]))
    a(_c("gs_extrip_tca_bicarbonate", "extrip_tca14", "Management", ["treatment"],
         "Although there is no specific antidote for TCA poisoning, sodium bicarbonate remains the therapy of choice for symptomatic patients, especially those presenting with seizures, fluid-unresponsive hypotension, or typical ECG findings (ventricular dysrhythmia, QRS more than 100 ms, prominent R waves in aVR).",
         "TSA zehirlenmesinin özgül bir antidotu olmasa da sodyum bikarbonat semptomatik hastalarda, özellikle nöbet, sıvıya yanıtsız hipotansiyon veya tipik EKG bulgularıyla (ventriküler disritmi, 100 ms'den uzun QRS, aVR'de belirgin R dalgaları) başvuranlarda seçilecek tedavi olmaya devam eder.",
         TCA, specialties=["toxicology"]))
    a(_c("gs_extrip_tca_no_ectr", "extrip_tca14", "Recommendations: executive summary", ["disposition"],
         "The EXTRIP workgroup recommends not to perform extracorporeal treatment in patients with TCA poisoning.",
         "EXTRIP çalışma grubu TSA zehirlenmesi olan hastalarda ekstrakorporeal tedavi uygulanmamasını önerir.",
         TCA, specialties=["toxicology"]))

    # ======================= NEUROLOGY =========================================
    BELL, DELIR, ENC, GBS, MIG, MGC, SCC, BPPV = (["G51.0"], ["F05"], ["G04.90"], ["G61.0"], ["G43.909"],
                                                  ["G70.01"], ["G95.20"], ["H81.1"])
    # ---- Bell palsy (Cochrane) --------------------------------------------------
    a(_c("gs_coch_bell_steroids", "coch_bell16", "Main results; authors' conclusions", ["treatment"],
         "Moderate- to high-quality evidence from randomised trials shows significant benefit from treating Bell's palsy with corticosteroids: 17% of participants given corticosteroids had incomplete recovery of facial motor function at six months or more, against 28% of controls, and the number needed to treat to avoid one incomplete recovery was 10.",
         "Randomize çalışmalardan elde edilen orta-yüksek kaliteli kanıt Bell paralizisinin kortikosteroidle tedavisinden anlamlı yarar gösterir: kortikosteroid verilenlerin yüzde 17'sinde altı ay veya sonrasında yüz motor işlevinde tam olmayan iyileşme görülürken bu oran kontrollerde yüzde 28'dir ve bir tam olmayan iyileşmeyi önlemek için tedavi edilmesi gereken sayı 10'dur.",
         BELL, specialties=["neurology"]))
    a(_c("gs_coch_bell_antivirals", "coch_bell_av19", "Authors' conclusions", ["treatment"],
         "Corticosteroids alone were probably more effective than antivirals alone in Bell's palsy, there was no clear benefit from antivirals alone over placebo, and the combination of antivirals and corticosteroids may have little or no effect on incomplete recovery compared with corticosteroids alone, although it probably reduced late sequelae.",
         "Bell paralizisinde tek başına kortikosteroidler büyük olasılıkla tek başına antivirallerden daha etkiliydi, tek başına antivirallerin plaseboya göre açık bir yararı yoktu ve antiviral ile kortikosteroid kombinasyonunun tam olmayan iyileşme üzerinde tek başına kortikosteroide göre çok az etkisi olabilir ya da hiç olmayabilir, ancak geç sekelleri büyük olasılıkla azalttı.",
         BELL, specialties=["neurology"]))

    # ---- Delirium (NICE CG103) ----------------------------------------------------
    a(_c("gs_nice_cg103_recent_change", "cg103", "1.3.1", ["triage", "history"],
         "At presentation, assess people at risk for recent (within hours or days) changes or fluctuations that may indicate delirium, which may be reported by the person or a carer or relative and may affect cognitive function, perception, physical function or social behaviour.",
         "Başvuruda risk altındaki kişileri, kişinin kendisi ya da bir bakım veren veya yakını tarafından bildirilebilen ve bilişsel işlevi, algıyı, fiziksel işlevi veya sosyal davranışı etkileyebilen, deliryumu düşündüren yakın zamanlı (saatler veya günler içinde) değişiklikler ya da dalgalanmalar açısından değerlendirin.",
         DELIR, specialties=["geriatrics", "neurology"]))
    a(_c("gs_nice_cg103_4at", "cg103", "1.6.1", ["exam"],
         "If indicators of delirium are identified, a practitioner who is competent to do so should carry out an assessment using the 4AT tool, or in critical care or the recovery room the CAM-ICU or Intensive Care Delirium Screening Checklist.",
         "Deliryum belirteçleri saptanırsa yetkin bir uygulayıcı 4AT aracıyla, yoğun bakımda veya ameliyat sonrası derlenme odasında ise CAM-ICU veya Yoğun Bakım Deliryum Tarama Kontrol Listesi ile değerlendirme yapmalıdır.",
         DELIR, specialties=["geriatrics", "neurology"]))
    a(_c("gs_nice_cg103_hypoactive", "cg103", "1.3.2", ["exam"],
         "Be particularly vigilant for changes that may indicate hypoactive delirium, which are often missed, such as withdrawal, slow responses, reduced mobility and movement, worsened concentration and reduced appetite.",
         "Sık gözden kaçan hipoaktif deliryumu gösterebilecek içe kapanma, yavaş yanıtlar, azalmış hareketlilik, kötüleşen konsantrasyon ve azalmış iştah gibi değişikliklere özellikle dikkat edin.",
         DELIR, specialties=["geriatrics", "neurology"]))
    a(_c("gs_nice_cg103_cause_deescalate", "cg103", "1.7.1; 1.7.2; 1.7.3", ["treatment"],
         "In people diagnosed with delirium, identify and manage the possible underlying cause or combination of causes, ensure effective communication, reorientation and reassurance, and if the person is distressed or a risk to themselves or others, first use verbal and non-verbal de-escalation techniques.",
         "Deliryum tanısı konan kişilerde olası altta yatan nedeni veya nedenler kombinasyonunu belirleyip yönetin, etkili iletişim, yeniden yönlendirme ve güvence sağlayın; kişi sıkıntılıysa veya kendisi ya da başkaları için risk oluşturuyorsa önce sözel ve sözel olmayan yatıştırma tekniklerini kullanın.",
         DELIR, specialties=["geriatrics", "neurology"]))
    a(_c("gs_nice_cg103_haloperidol_short", "cg103", "1.7.4; 1.7.5", ["treatment", "disposition"],
         "If de-escalation is ineffective or inappropriate in a distressed person with delirium, consider short-term haloperidol (usually for 1 week or less), starting at the lowest clinically appropriate dose and titrating cautiously; if delirium does not resolve, re-evaluate for underlying causes and assess for possible dementia.",
         "Sıkıntılı deliryum hastasında yatıştırma etkisiz veya uygunsuzsa kısa süreli haloperidol (genellikle 1 hafta veya daha az) düşünün, klinik olarak uygun en düşük dozla başlayıp dikkatle titre edin; deliryum düzelmezse altta yatan nedenleri yeniden değerlendirin ve olası demans açısından değerlendirin.",
         DELIR, specialties=["geriatrics", "neurology"]))

    # ---- Viral encephalitis (EAN/ESCMID 2026) -----------------------------------
    a(_c("gs_ean26_aciclovir_6h", "ean_enc26", "Recommendation 9", ["treatment"],
         "Upon suspicion of encephalitis, initiation of IV aciclovir is recommended as soon as possible, ideally within 6 h from presentation to hospital; pregnancy is not considered an absolute contraindication for aciclovir initiation.",
         "Ensefalit şüphesinde IV asiklovirin mümkün olan en kısa sürede, ideal olarak hastaneye başvurudan sonraki 6 saat içinde başlatılması önerilir; gebelik asiklovir başlatılması için mutlak kontrendikasyon sayılmaz.",
         ENC, specialties=["neurology", "infectious"]))
    a(_c("gs_ean26_hsv_normal_tests", "ean_enc26", "Question 9a", ["workup", "treatment"],
         "HSV is a common cause of infectious encephalitis in adults in Europe (10% to 20% of suspected cases) and HSV encephalitis can present with an initially normal CSF leukocyte count, negative CSF HSV PCR and normal MRI brain appearances; temporal lobe hyperintensity on MRI supports continuing aciclovir if the first PCR is negative.",
         "HSV Avrupa'da erişkinlerde enfeksiyöz ensefalitin sık bir nedenidir (şüpheli olguların yüzde 10-20'si) ve HSV ensefaliti başlangıçta normal BOS lökosit sayısı, negatif BOS HSV PCR ve normal beyin MRG görünümüyle başvurabilir; MRG'de temporal lob hiperintensitesi ilk PCR negatifse asiklovire devam etmeyi destekler.",
         ENC, specialties=["neurology", "infectious"]))
    a(_c("gs_ean26_pathogen_pcr", "ean_enc26", "Recommendation: CSF multiplex PCR", ["workup"],
         "The guideline conditionally recommends against replacing pathogen-specific PCR testing of CSF with multiplex CSF PCR panels for the diagnosis of adult patients with suspected infectious encephalitis.",
         "Kılavuz, şüpheli enfeksiyöz ensefaliti olan erişkinlerin tanısında BOS'un patojene özgü PCR testinin multipleks BOS PCR panelleriyle değiştirilmemesini koşullu olarak önerir.",
         ENC, specialties=["neurology", "infectious"]))
    a(_c("gs_ean26_seizure_monitoring", "ean_enc26", "EEG and seizure management", ["disposition"],
         "Patients with suspected encephalitis at higher risk of seizures, for example those with HSV encephalitis, an abnormal Glasgow Coma Scale or a greater degree of temporal lobe oedema, should be considered for transfer to settings with capacity for continuous or prolonged EEG monitoring.",
         "HSV ensefaliti, anormal Glasgow Koma Skalası veya daha belirgin temporal lob ödemi olanlar gibi nöbet riski yüksek şüpheli ensefalit hastaları sürekli veya uzun süreli EEG izlemi yapılabilen ortamlara nakil için değerlendirilmelidir.",
         ENC, specialties=["neurology", "infectious"]))

    # ---- Guillain-Barre syndrome (ten steps, 2019) ---------------------------------
    a(_c("gs_gbs19_csf_dissociation", "gbs19", "Step 2: diagnosis, CSF examination", ["workup"],
         "The classic finding in GBS is an elevated CSF protein level with a normal CSF cell count (albumino-cytological dissociation), but protein levels are normal in 30 to 50% of patients in the first week after onset, so normal CSF protein does not rule out the diagnosis.",
         "GBS'deki klasik bulgu normal BOS hücre sayısıyla birlikte yüksek BOS proteinidir (albüminositolojik disosiyasyon), ancak protein düzeyi başlangıçtan sonraki ilk haftada hastaların yüzde 30-50'sinde normaldir; bu nedenle normal BOS proteini tanıyı dışlamaz.",
         GBS, specialties=["neurology"]))
    a(_c("gs_gbs19_icu_criteria", "gbs19", "Step 3: when to admit to the ICU", ["disposition"],
         "Admit patients with GBS to the ICU for evolving respiratory distress with imminent respiratory insufficiency, severe autonomic cardiovascular dysfunction, severe swallowing dysfunction or diminished cough reflex, or rapid progression of weakness; imminent respiratory insufficiency includes inability to count to 15 in a single breath or a vital capacity below 15 to 20 ml/kg or below 1 l.",
         "GBS hastalarını yaklaşan solunum yetmezliğiyle gelişen solunum sıkıntısı, ağır otonom kardiyovasküler işlev bozukluğu, ağır yutma bozukluğu veya azalmış öksürük refleksi ya da güçsüzlüğün hızlı ilerlemesi varsa yoğun bakıma yatırın; yaklaşan solunum yetmezliği tek nefeste 15'e kadar sayamamayı veya 15-20 ml/kg altı ya da 1 l altı vital kapasiteyi içerir.",
         GBS, specialties=["neurology"]))
    a(_c("gs_gbs19_ivig_plex", "gbs19", "Step 4: when to start treatment", ["treatment"],
         "Immunomodulatory therapy should be started if patients are unable to walk independently for 10 m; IVIg (0.4 g/kg body weight daily for 5 days) and plasma exchange (200 to 250 ml plasma/kg in five sessions) are equally effective, and IVIg is usually the treatment of choice as it is easier to administer.",
         "Hastalar 10 m bağımsız yürüyemiyorsa immünomodülatör tedavi başlatılmalıdır; IVIg (5 gün boyunca günde 0,4 g/kg) ve plazma değişimi (beş seansta 200-250 ml plazma/kg) eşit derecede etkilidir ve uygulaması daha kolay olduğu için genellikle IVIg tercih edilir.",
         GBS, specialties=["neurology"]))
    a(_c("gs_gbs19_time_course", "gbs19", "Step 1: clinical features", ["history"],
         "Disease onset in GBS is acute or subacute and patients typically reach maximum disability within 2 weeks; in patients who reach maximum disability within 24 h of onset or after 4 weeks, alternative diagnoses should be considered.",
         "GBS'de başlangıç akut veya subakuttur ve hastalar genellikle 2 hafta içinde en ağır tabloya ulaşır; başlangıçtan sonraki 24 saat içinde veya 4 haftadan sonra en ağır tabloya ulaşanlarda alternatif tanılar düşünülmelidir.",
         GBS, specialties=["neurology"]))

    # ---- Migraine (NICE CG150) -----------------------------------------------------
    a(_c("gs_nice_cg150_triptan_combo", "cg150", "1.3.10; 1.3.11", ["treatment"],
         "Offer combination therapy with an oral triptan and an NSAID, or an oral triptan and paracetamol, for the acute treatment of migraine; for people who prefer only 1 drug, consider monotherapy with an oral triptan, NSAID, aspirin (900 mg) or paracetamol.",
         "Migrenin akut tedavisi için oral triptan ile NSAİİ ya da oral triptan ile parasetamol kombinasyonu önerin; tek ilaç tercih edenlerde oral triptan, NSAİİ, aspirin (900 mg) veya parasetamol monoterapisini düşünün.",
         MIG, specialties=["neurology"]))
    a(_c("gs_nice_cg150_non_oral_antiemetic", "cg150", "1.3.14", ["treatment"],
         "If oral preparations for the acute treatment of migraine are ineffective or not tolerated, consider a non-oral preparation of metoclopramide or prochlorperazine, and consider adding a non-oral NSAID or triptan.",
         "Migrenin akut tedavisinde oral preparatlar etkisiz veya tolere edilemiyorsa metoklopramid veya proklorperazinin oral olmayan bir preparatını düşünün ve oral olmayan bir NSAİİ veya triptan eklemeyi düşünün.",
         MIG, specialties=["neurology"]))
    a(_c("gs_nice_cg150_aura_atypical", "cg150", "1.2.2; 1.2.4", ["history"],
         "Suspect aura when neurological symptoms are fully reversible, develop gradually over at least 5 minutes and last 5 to 60 minutes; consider further investigations or referral for atypical aura symptoms such as motor weakness, double vision, visual symptoms affecting only 1 eye or poor balance.",
         "Nörolojik belirtiler tamamen geri dönüşlüyse, en az 5 dakikada yavaş yavaş gelişiyorsa ve 5-60 dakika sürüyorsa aurayı düşünün; motor güçsüzlük, çift görme, yalnızca bir gözü etkileyen görsel belirtiler veya denge bozukluğu gibi atipik aura belirtilerinde ek tetkik veya sevki düşünün.",
         MIG, specialties=["neurology"]))
    a(_c("gs_nice_cg150_moh_imaging", "cg150", "1.2.7; 1.3.3", ["disposition"],
         "Be alert to medication overuse headache in people taking triptans, opioids, ergots or combination analgesics on 10 days per month or more, or paracetamol, aspirin or an NSAID on 15 days per month or more, for 3 months or more; do not refer people diagnosed with migraine for neuroimaging solely for reassurance.",
         "3 ay veya daha uzun süre ayda 10 gün veya daha fazla triptan, opioid, ergot veya kombine analjezik ya da ayda 15 gün veya daha fazla parasetamol, aspirin veya NSAİİ kullananlarda ilaç aşırı kullanımı baş ağrısına dikkat edin; migren tanısı konan kişileri yalnızca güvence vermek için nörogörüntülemeye yönlendirmeyin.",
         MIG, specialties=["neurology"]))

    # ---- Myasthenic crisis (MGFA consensus 2016) -------------------------------------
    a(_c("gs_mg16_crisis_admit", "mg16", "Impending and manifest myasthenic crisis, statement 1", ["disposition"],
         "Impending myasthenic crisis requires hospital admission and close observation of respiratory and bulbar function, with the ability to transfer to an intensive care unit, and manifest myasthenic crisis requires admission to an intensive care or step-down unit to monitor for or manage respiratory failure and bulbar dysfunction.",
         "Yaklaşan miyastenik kriz hastaneye yatış ve yoğun bakıma nakil olanağıyla solunum ve bulber işlevin yakından izlenmesini, belirgin miyastenik kriz ise solunum yetmezliği ve bulber işlev bozukluğunu izlemek veya yönetmek için yoğun bakım ya da ara yoğun bakım birimine yatışı gerektirir.",
         MGC, specialties=["neurology"]))
    a(_c("gs_mg16_plex_ivig_crisis", "mg16", "Impending and manifest myasthenic crisis, statements 2 and 3", ["treatment"],
         "PLEX and IVIg are the mainstay of management in myasthenic crisis and are used as short-term treatment; corticosteroids or other immunosuppressive agents are often started at the same time, but because corticosteroids may cause transient worsening, it may be appropriate to wait several days for PLEX or IVIg to have an effect before starting them.",
         "Plazma değişimi ve IVIg miyastenik krizde yönetimin temelidir ve kısa süreli tedavi olarak kullanılır; kortikosteroidler veya diğer immünosupresifler çoğu kez aynı anda başlatılır, ancak kortikosteroidler geçici kötüleşmeye yol açabileceğinden başlamadan önce plazma değişimi veya IVIg'nin etki etmesi için birkaç gün beklemek uygun olabilir.",
         MGC, specialties=["neurology"]))
    a(_c("gs_mg16_secretions_choice", "mg16", "Myasthenic crisis; IVIg and PLEX statement 2", ["treatment"],
         "Cholinesterase inhibitors increase airway secretions, which may exacerbate breathing difficulties in crisis; the choice between PLEX and IVIg depends on individual factors (PLEX cannot be used in patients with sepsis and IVIg cannot be used in renal failure) and on availability.",
         "Kolinesteraz inhibitörleri hava yolu sekresyonlarını artırarak krizde solunum güçlüğünü kötüleştirebilir; plazma değişimi ile IVIg arasındaki seçim bireysel etkenlere (sepsisli hastada plazma değişimi, böbrek yetmezliğinde IVIg kullanılamaz) ve erişilebilirliğe bağlıdır.",
         MGC, specialties=["neurology"]))

    # ---- Metastatic spinal cord compression (NICE NG234) --------------------------------
    a(_c("gs_nice_ng234_emergency_coordinator", "ng234", "1.3.2; 1.3.3", ["triage"],
         "Immediately contact the MSCC coordinator if a person with a past or current diagnosis of cancer presents with symptoms or signs of cord compression and treat this as an oncological emergency; seek advice within 24 hours if they present with pain suggesting spinal metastases.",
         "Geçmişte veya halen kanser tanısı olan kişi omurilik basısı belirti veya bulgularıyla başvurursa MSCC koordinatörüyle hemen iletişime geçin ve bunu onkolojik acil durum olarak ele alın; spinal metastazı düşündüren ağrıyla başvurursa 24 saat içinde görüş alın.",
         SCC, specialties=["oncology", "neurology"]))
    a(_c("gs_nice_ng234_mri_24h", "ng234", "1.5.2; 1.5.5", ["workup"],
         "Offer an MRI scan to people with suspected MSCC as soon as possible and always within 24 hours, including sagittal sequences of the whole spine.",
         "Şüpheli MSCC'si olanlara mümkün olan en kısa sürede ve her zaman 24 saat içinde, tüm omurganın sagital sekanslarını içeren MRG önerin.",
         SCC, specialties=["oncology", "neurology"]))
    a(_c("gs_nice_ng234_dexamethasone_16", "ng234", "1.8.1; 1.8.2", ["treatment"],
         "For people with neurological symptoms or signs of MSCC, offer 16 mg of oral dexamethasone (or equivalent parenteral dose) as soon as possible and continue 16 mg daily while awaiting surgery or radiotherapy; if MSCC is subsequently ruled out, discontinue it.",
         "MSCC'nin nörolojik belirti veya bulguları olanlara mümkün olan en kısa sürede 16 mg oral deksametazon (veya eşdeğer parenteral doz) verin ve cerrahi ya da radyoterapi beklerken günde 16 mg sürdürün; MSCC daha sonra dışlanırsa kesin.",
         SCC, specialties=["oncology", "neurology"]))
    a(_c("gs_nice_ng234_flat_nursing", "ng234", "1.4.3; 1.4.4", ["disposition"],
         "Nurse people who are immobilised in a supine position to minimise weight bearing by the spine, and seek early advice (within 24 hours) from an expert and start assessment of spinal stability to minimise the duration of immobilisation.",
         "Hareketsiz bırakılan kişileri omurganın yük taşımasını en aza indirmek için sırtüstü pozisyonda bakın ve hareketsizlik süresini kısaltmak için bir uzmandan erken (24 saat içinde) görüş alıp spinal stabilite değerlendirmesine başlayın.",
         SCC, specialties=["oncology", "neurology"]))

    # ---- BPPV (AAO-HNSF 2017 key action statements) -------------------------------------
    a(_c("gs_bppv_dix_hallpike", "bppv_kas23", "Key action statements 1a and 1b", ["exam"],
         "Clinicians should diagnose posterior semicircular canal BPPV when vertigo associated with torsional, up-beating nystagmus is provoked by the Dix-Hallpike maneuver, and should perform a supine roll test for lateral canal BPPV if the history is compatible and the Dix-Hallpike test shows horizontal or no nystagmus.",
         "Klinisyenler Dix-Hallpike manevrasıyla torsiyonel, yukarı vuran nistagmusla birlikte vertigo tetiklendiğinde arka semisirküler kanal BPPV tanısı koymalı; öykü uyumluysa ve Dix-Hallpike testi yatay nistagmus gösteriyor ya da hiç göstermiyorsa lateral kanal BPPV için sırtüstü yuvarlama testi yapmalıdır.",
         BPPV, specialties=["neurology", "ent"]))
    a(_c("gs_bppv_no_imaging_no_suppressants", "bppv_kas23", "Key action statements 3a and 6", ["workup", "treatment"],
         "Clinicians should not obtain radiographic imaging in a patient who meets diagnostic criteria for BPPV, and should not routinely treat BPPV with vestibular suppressant medications.",
         "Klinisyenler BPPV tanı kriterlerini karşılayan hastada radyolojik görüntüleme istememeli ve BPPV'yi rutin olarak vestibüler baskılayıcı ilaçlarla tedavi etmemelidir.",
         BPPV, specialties=["neurology", "ent"]))
    a(_c("gs_bppv_crp", "bppv_kas23", "Key action statements 4a and 4c; Epley", ["treatment", "disposition"],
         "Clinicians should treat, or refer to a clinician who can treat, patients with posterior canal BPPV with a canal repositioning procedure, the most successful being the Epley maneuver; observation with follow-up may be offered as initial management.",
         "Klinisyenler arka kanal BPPV'li hastaları kanal yeniden konumlandırma manevrasıyla (en başarılısı Epley manevrasıdır) tedavi etmeli veya tedavi edebilecek bir klinisyene yönlendirmelidir; ilk yaklaşım olarak izlemli gözlem önerilebilir.",
         BPPV, specialties=["neurology", "ent"]))

    # ======================= OBSTETRICS / GYNAECOLOGY =========================
    ECL, PET, HG, CYST, TORS, ABR, TMISC = (["O15.9"], ["O14.90"], ["O21.0"], ["N83.8"], ["N83.51"], ["O45.9"],
                                            ["O20.0"])
    # ---- Pre-eclampsia and eclampsia (NICE NG133) ----------------------------
    a(_c("gs_nice_ng133_admit_concerns", "ng133", "1.5.2", ["triage", "disposition"],
         "Offer admission to hospital for women with pre-eclampsia if there are concerns for the wellbeing of the woman or baby, such as a sustained systolic blood pressure of 160 mmHg or higher, or a new and persistent rise in creatinine (90 micromol/litre or more) or in alanine transaminase (over 70 IU/litre).",
         "Kadın veya bebeğin iyiliği konusunda endişe varsa, örneğin sürekli 160 mmHg veya üzeri sistolik kan basıncı ya da kreatininde (90 mikromol/litre veya üzeri) veya alanin transaminazda (70 IU/litre üzeri) yeni ve kalıcı artış varsa preeklampsili kadınlara hastaneye yatış önerin.",
         PET + ECL, specialties=["obstetrics"]))
    a(_c("gs_nice_ng133_labetalol_target", "ng133", "1.5.6; table 2", ["treatment"],
         "Offer labetalol to treat hypertension in pregnant women with pre-eclampsia, nifedipine if labetalol is not suitable and methyldopa if neither is suitable, aiming for a blood pressure of 135/85 mmHg or less once on treatment.",
         "Preeklampsili gebelerde hipertansiyonu tedavi etmek için labetalol, labetalol uygun değilse nifedipin, ikisi de uygun değilse metildopa önerin ve tedavi altında 135/85 mmHg veya altı kan basıncı hedefleyin.",
         PET, specialties=["obstetrics"]))
    a(_c("gs_nice_ng133_plgf", "ng133", "1.4.4", ["workup"],
         "Offer placental growth factor (PLGF)-based testing to help rule out pre-eclampsia in women presenting with suspected pre-eclampsia, for example with gestational hypertension, between 20 weeks and 36 weeks and 6 days of pregnancy.",
         "Gebeliğin 20. haftası ile 36 hafta 6 gün arasında, örneğin gestasyonel hipertansiyonla, şüpheli preeklampsiyle başvuran kadınlarda preeklampsiyi dışlamaya yardımcı olmak için plasental büyüme faktörü (PLGF) temelli test önerin.",
         PET, specialties=["obstetrics"]))
    a(_c("gs_nice_ng133_mgso4_regimen", "ng133", "1.8.1; 1.8.4", ["treatment"],
         "Give intravenous magnesium sulfate to a woman with severe hypertension or severe pre-eclampsia who has or previously had an eclamptic fit, using the Collaborative Eclampsia Trial regimen: a loading dose of 4 g intravenously over 5 to 15 minutes, then an infusion of 1 g/hour for 24 hours after the last fit, with recurrent fits treated with a further 2 g to 4 g over 5 to 15 minutes.",
         "Eklamptik nöbet geçiren veya geçirmiş ağır hipertansiyonlu ya da ağır preeklampsili kadına Collaborative Eclampsia Trial rejimiyle intravenöz magnezyum sülfat verin: 5-15 dakikada 4 g intravenöz yükleme dozu, ardından son nöbetten sonra 24 saat boyunca saatte 1 g infüzyon; tekrarlayan nöbetler 5-15 dakikada ek 2-4 g ile tedavi edilir.",
         ECL + PET, specialties=["obstetrics"]))
    a(_c("gs_nice_ng133_no_diazepam_phenytoin", "ng133", "1.8.5; 1.8.6", ["treatment"],
         "Do not use diazepam, phenytoin or other anticonvulsants as an alternative to magnesium sulfate in women with eclampsia, and treat severe hypertension in critical care immediately with labetalol (oral or intravenous), oral nifedipine or intravenous hydralazine.",
         "Eklampsili kadınlarda magnezyum sülfata alternatif olarak diazepam, fenitoin veya başka antikonvülzan kullanmayın ve yoğun bakımdaki ağır hipertansiyonu hemen labetalol (oral veya intravenöz), oral nifedipin veya intravenöz hidralazinle tedavi edin.",
         ECL, specialties=["obstetrics"]))
    a(_c("gs_nice_ng133_mgso4_severe_features", "ng133", "1.8.3", ["workup", "treatment"],
         "Consider magnesium sulfate if one or more features of severe pre-eclampsia is present: ongoing or recurring severe headaches, visual scotomata, nausea or vomiting, epigastric pain, oliguria and severe hypertension, or progressive deterioration in laboratory blood tests such as rising creatinine or liver transaminases or a falling platelet count.",
         "Ağır preeklampsinin bir veya daha fazla özelliği varsa magnezyum sülfatı düşünün: süregelen veya tekrarlayan şiddetli baş ağrıları, görsel skotomlar, bulantı veya kusma, epigastrik ağrı, oligüri ve ağır hipertansiyon ya da yükselen kreatinin veya karaciğer transaminazları ya da düşen trombosit sayısı gibi laboratuvar tetkiklerinde ilerleyici kötüleşme.",
         PET + ECL, specialties=["obstetrics"]))
    a(_c("gs_nice_ng133_senior_birth", "ng133", "1.5.8; 1.8.9", ["disposition"],
         "Involve a senior obstetrician in any decisions on timing of birth for women with pre-eclampsia, and if early birth is considered likely within 7 days offer a course of antenatal corticosteroids.",
         "Preeklampsili kadınlarda doğum zamanlamasıyla ilgili tüm kararlara kıdemli bir kadın doğum uzmanını dahil edin ve 7 gün içinde erken doğum olası görülüyorsa antenatal kortikosteroid kürü önerin.",
         PET + ECL, specialties=["obstetrics"]))

    # ---- Hyperemesis gravidarum (NICE NG201) --------------------------------------
    a(_c("gs_nice_ng201_nvp_antiemetic", "ng201", "1.4.4; 1.4.5", ["treatment"],
         "For pregnant women with nausea and vomiting who choose a pharmacological treatment, offer an antiemetic, discussing the advantages and disadvantages of different antiemetics and taking into account her preferences and experience in previous pregnancies.",
         "Farmakolojik tedavi seçen bulantı-kusmalı gebelere farklı antiemetiklerin avantaj ve dezavantajlarını tartışıp tercihlerini ve önceki gebeliklerdeki deneyimini göz önünde bulundurarak bir antiemetik önerin.",
         HG, specialties=["obstetrics"]))
    a(_c("gs_nice_ng201_iv_fluids_inpatient", "ng201", "1.4.6; 1.4.7", ["treatment", "disposition"],
         "For pregnant women with moderate-to-severe nausea and vomiting consider intravenous fluids, ideally on an outpatient basis, and consider inpatient care if vomiting is severe and not responding to primary care or outpatient management, which will include women with hyperemesis gravidarum.",
         "Orta-ağır bulantı ve kusması olan gebelerde ideal olarak ayaktan intravenöz sıvı düşünün; kusma şiddetliyse ve birinci basamak veya ayaktan tedaviye yanıt vermiyorsa yatarak bakımı düşünün; hiperemezis gravidarumlu kadınlar da buna dahildir.",
         HG, specialties=["obstetrics"]))
    a(_c("gs_nice_ng201_nvp_reassure", "ng201", "1.4.1; 1.4.2", ["history"],
         "Reassure women that mild to moderate nausea and vomiting are common in pregnancy and likely to resolve before 16 to 20 weeks, recognising that by the time they seek advice they may have already tried a number of interventions.",
         "Hafif-orta bulantı ve kusmanın gebelikte sık olduğunu ve muhtemelen 16-20. haftadan önce geçeceğini söyleyerek kadınlara güvence verin; danışmaya geldiklerinde birçok yöntemi zaten denemiş olabileceklerini göz önünde bulundurun.",
         HG, specialties=["obstetrics"]))

    # ---- Early pregnancy: pregnancy test for pelvic pain (NICE NG126) -------------
    a(_c("gs_nice_ng126_pregnancy_test_pain", "ng126sx", "1.4.1 to 1.4.5", ["workup"],
         "Be aware that atypical presentation for ectopic pregnancy is common and that its symptoms and signs can resemble those of other conditions; think about offering a pregnancy test to women of reproductive age even when symptoms are non-specific, and refer women who are haemodynamically unstable directly to A&E.",
         "Ektopik gebeliğin atipik başvurusunun sık olduğunu ve belirti ve bulgularının başka durumlara benzeyebileceğini unutmayın; belirtiler özgül olmasa bile doğurganlık çağındaki kadınlara gebelik testi önermeyi düşünün ve hemodinamik olarak instabil kadınları doğrudan acil servise yönlendirin.",
         CYST + TORS + TMISC, specialties=["gynaecology"]))

    # ---- Ovarian torsion (ACOG 783) ---------------------------------------------
    a(_c("gs_acog783_presentation", "acog783", "Abstract", ["history"],
         "The most common clinical symptom of adnexal torsion is sudden-onset abdominal pain that is intermittent, nonradiating and associated with nausea and vomiting; in adolescents torsion involves an ovary without an associated mass or cyst in as many as 46% of cases.",
         "Adneksiyal torsiyonun en sık klinik belirtisi aralıklı, yayılmayan ve bulantı ile kusmanın eşlik ettiği ani başlangıçlı karın ağrısıdır; ergenlerde torsiyon olguların yüzde 46'sına kadarında eşlik eden kitle veya kist olmayan bir overi tutar.",
         TORS, specialties=["gynaecology"], countries=["US"], population="adolescent"))
    a(_c("gs_acog783_doppler_laparoscopy", "acog783", "Abstract", ["workup", "disposition"],
         "There are no clinical or imaging criteria sufficient to confirm the preoperative diagnosis of adnexal torsion and Doppler flow alone should not guide clinical decision making; if ovarian torsion is suspected, timely diagnostic laparoscopy is indicated to preserve ovarian function and future fertility.",
         "Adneksiyal torsiyonun ameliyat öncesi tanısını doğrulamaya yetecek klinik veya görüntüleme kriteri yoktur ve klinik karar yalnızca Doppler akımına göre verilmemelidir; over torsiyonundan şüpheleniliyorsa over işlevini ve gelecekteki doğurganlığı korumak için zamanında tanısal laparoskopi endikedir.",
         TORS, specialties=["gynaecology"], countries=["US"], population="adolescent"))
    a(_c("gs_acog783_detorsion", "acog783", "Abstract", ["treatment"],
         "A minimally invasive surgical approach is recommended with detorsion and preservation of the adnexal structures regardless of the appearance of the ovary; a torsed ovary should not be removed unless oophorectomy is unavoidable.",
         "Overin görünümünden bağımsız olarak detorsiyon ve adneksiyal yapıların korunmasıyla minimal invaziv cerrahi yaklaşım önerilir; ooforektomi kaçınılmaz değilse torsiyone over çıkarılmamalıdır.",
         TORS, specialties=["gynaecology"], countries=["US"], population="adolescent"))

    # ---- Placental abruption (RCOG GTG 63) -----------------------------------
    a(_c("gs_gtg63_clinical_diagnosis", "gtg63", "Section 8: diagnosis", ["workup"],
         "Placental abruption is a clinical diagnosis and there are no sensitive or reliable diagnostic tests available: ultrasound can be used to diagnose placenta praevia but does not exclude abruption, and the Kleihauer test is not a sensitive test for diagnosing abruption.",
         "Plasenta dekolmanı klinik bir tanıdır ve duyarlı veya güvenilir tanı testi yoktur: ultrason plasenta previa tanısında kullanılabilir ancak dekolmanı dışlamaz ve Kleihauer testi dekolman tanısında duyarlı değildir.",
         ABR, specialties=["obstetrics"]))
    a(_c("gs_gtg63_bloods_crossmatch", "gtg63", "8.1.1 Blood tests", ["workup"],
         "In cases of major or massive antepartum haemorrhage, analyse a full blood count and coagulation screen and cross-match 4 units of blood; the initial haemoglobin may not reflect the amount of blood lost.",
         "Majör veya masif antepartum kanamada tam kan sayımı ve pıhtılaşma taraması yapın ve 4 ünite kan çapraz eşleştirin; ilk hemoglobin kaybedilen kan miktarını yansıtmayabilir.",
         ABR, specialties=["obstetrics"]))
    a(_c("gs_gtg63_anti_d_kleihauer", "gtg63", "Anti-D immunoglobulin", ["treatment"],
         "Anti-D immunoglobulin should be given to all non-sensitised RhD-negative women after any presentation with antepartum haemorrhage, and a Kleihauer test should be performed in RhD-negative women to quantify fetomaternal haemorrhage and gauge the dose.",
         "Antepartum kanamayla başvuran tüm duyarlanmamış RhD negatif kadınlara anti-D immünoglobulin verilmeli ve RhD negatif kadınlarda fetomaternal kanamayı ölçüp dozu belirlemek için Kleihauer testi yapılmalıdır.",
         ABR, specialties=["obstetrics"]))
    a(_c("gs_gtg63_ctg_mdt", "gtg63", "Fetal monitoring; place of care", ["disposition"],
         "Women in labour with active vaginal bleeding, and those with any clinical suspicion of abruption, should be recommended continuous electronic fetal monitoring, with care in a maternity unit with facilities for resuscitation and emergency operative delivery.",
         "Aktif vajinal kanamayla doğum eylemindeki kadınlara ve dekolmandan klinik olarak şüphelenilen herkese, resüsitasyon ve acil operatif doğum olanakları olan bir doğum ünitesinde sürekli elektronik fetal izlem önerilmelidir.",
         ABR, specialties=["obstetrics"]))

    # ---- Threatened miscarriage (NICE NG126) ------------------------------------
    a(_c("gs_nice_ng126_progesterone", "ng126mc", "1.9.1; 1.9.2", ["treatment"],
         "Offer vaginal micronised progesterone 400 mg twice daily to women with an intrauterine pregnancy confirmed by a scan who have vaginal bleeding and have previously had a miscarriage; with no previous miscarriage, advise returning if bleeding gets worse or persists beyond 14 days.",
         "Ultrasonla doğrulanmış intrauterin gebeliği olan, vajinal kanaması bulunan ve daha önce düşük yapmış kadınlara günde iki kez 400 mg vajinal mikronize progesteron önerin; önceki düşük yoksa kanama artarsa veya 14 günden uzun sürerse yeniden başvurmalarını öğütleyin.",
         TMISC, specialties=["obstetrics"]))
    a(_c("gs_nice_ng126_epas_refer_expectant", "ng126sx", "1.4.9; 1.4.10", ["disposition"],
         "Refer women with bleeding who have pain, a pregnancy of 6 weeks' gestation or more, or a pregnancy of uncertain gestation to an early pregnancy assessment service; use expectant management for a pregnancy of less than 6 weeks' gestation with bleeding but no pain or risk factors, with a repeat urine pregnancy test after 7 to 10 days.",
         "Kanaması olup ağrısı olan, 6 hafta veya üzerinde gebeliği ya da gestasyon yaşı belirsiz gebeliği olan kadınları erken gebelik değerlendirme birimine yönlendirin; ağrısı veya risk faktörü olmadan kanayan 6 haftadan küçük gebelikte 7-10 gün sonra idrar gebelik testi tekrarıyla bekleme yaklaşımını kullanın.",
         TMISC, specialties=["obstetrics"]))
    a(_c("gs_nice_ng126_tvus", "ng126dx", "1.5.1; 1.6.3", ["workup"],
         "Offer a transvaginal ultrasound scan to identify the location of the pregnancy and whether there is a fetal pole and heartbeat; if the crown-rump length is less than 7.0 mm with no visible heartbeat, perform a second scan a minimum of 7 days later before making a diagnosis.",
         "Gebeliğin yerini ve fetal kutup ile kalp atımı olup olmadığını belirlemek için transvajinal ultrason önerin; baş-popo mesafesi 7,0 mm'den küçük ve kalp atımı görünmüyorsa tanı koymadan önce en az 7 gün sonra ikinci bir tarama yapın.",
         TMISC, specialties=["obstetrics"]))
    a(_c("gs_nice_ng126_anti_d_threatened", "ng126ad", "1.18.1; 1.18.3", ["treatment"],
         "Do not offer anti-D immunoglobulin prophylaxis for threatened miscarriage up to and including 11+6 weeks' gestation; consider anti-D at least 250 IU for RhD-negative women at 12+0 to 12+6 weeks with threatened miscarriage and heavy or recurrent bleeding.",
         "11+6 haftaya kadar (dahil) düşük tehdidinde anti-D immünoglobulin profilaksisi önermeyin; 12+0 ile 12+6 hafta arasında ağır veya tekrarlayan kanamalı düşük tehdidi olan RhD negatif kadınlarda en az 250 IU anti-D düşünün.",
         TMISC, specialties=["obstetrics"]))

    # ======================= PSYCHIATRY =======================================
    AN, BED, MDD, PTSD, SERO = ["F50.00"], ["F50.81"], ["F32.9"], ["F43.10"], ["T43.225"]
    # ---- Eating disorders (NICE NG69, RCPsych MEED) --------------------------------
    a(_c("gs_nice_ng69_assess_refer", "ng69", "1.2.9; 1.2.10", ["history", "disposition"],
         "In people with a suspected eating disorder assess physical health, including any physical effects of malnutrition or compensatory behaviours such as vomiting, and associated mental health problems including depression, anxiety and self-harm; if an eating disorder is suspected, refer immediately to a community-based, age-appropriate eating disorder service.",
         "Şüpheli yeme bozukluğu olan kişilerde malnütrisyonun veya kusma gibi telafi edici davranışların fiziksel etkileri dahil fiziksel sağlığı ve depresyon, anksiyete ve kendine zarar verme dahil eşlik eden ruh sağlığı sorunlarını değerlendirin; yeme bozukluğundan şüpheleniliyorsa hemen toplum temelli, yaşa uygun bir yeme bozukluğu hizmetine yönlendirin.",
         AN + BED, specialties=["psychiatry"]))
    a(_c("gs_nice_ng69_weight_goal_no_drug_only", "ng69", "1.3.2; 1.3.24", ["treatment"],
         "When treating anorexia nervosa, helping people to reach a healthy body weight or BMI for their age is a key goal, and medication should not be offered as the sole treatment for anorexia nervosa.",
         "Anoreksiya nervoza tedavisinde kişilerin yaşlarına göre sağlıklı vücut ağırlığına veya BKİ'ye ulaşmasına yardımcı olmak temel hedeftir ve ilaç anoreksiya nervozanın tek tedavisi olarak önerilmemelidir.",
         AN, specialties=["psychiatry"]))
    a(_c("gs_meed22_risk_red", "meed22", "Table 1: risk assessment framework", ["triage"],
         "In the MEED risk assessment framework, red (high impending risk to life) in adults includes a BMI below 13 and an awake heart rate below 40, with BMI 13 to 14.9 and heart rate 40 to 50 rated amber.",
         "MEED risk değerlendirme çerçevesinde erişkinlerde kırmızı (yaşamı tehdit eden yüksek risk) 13'ün altında BKİ ve uyanıkken 40'ın altında kalp hızını içerir; 13-14,9 BKİ ve 40-50 kalp hızı sarı (amber) kabul edilir.",
         AN, specialties=["psychiatry"], countries=["UK"]))
    a(_c("gs_meed22_qtc", "meed22", "Table 1: ECG abnormalities", ["workup"],
         "ECG abnormalities in the MEED risk framework: for 18+ years a QTc over 450 ms (females) or 430 ms (males), or any other significant ECG abnormality, rates as high concern.",
         "MEED risk çerçevesinde EKG anormallikleri: 18 yaş ve üzerinde kadında 450 ms'nin, erkekte 430 ms'nin üzerindeki QTc veya başka anlamlı bir EKG anormalliği yüksek endişe düzeyindedir.",
         AN, specialties=["psychiatry"], countries=["UK"]))
    a(_c("gs_meed22_refeeding", "meed22", "Table 6: refeeding", ["treatment"],
         "If at high risk of refeeding syndrome, start at 20 kcal/kg/day of food or supplements, increasing by 5 kcal/kg every 2 days to about 60 kcal/kg/day or more, and monitor electrolytes every 12 to 24 hours for 5 days to detect refeeding syndrome (low phosphate, potassium and magnesium).",
         "Refeeding sendromu riski yüksekse günde 20 kcal/kg yiyecek veya takviyeyle başlayın, 2 günde bir 5 kcal/kg artırarak günde yaklaşık 60 kcal/kg veya üzerine çıkın ve refeeding sendromunu (düşük fosfat, potasyum ve magnezyum) saptamak için 5 gün boyunca 12-24 saatte bir elektrolitleri izleyin.",
         AN, specialties=["psychiatry"], countries=["UK"]))

    # ---- Binge eating disorder (NICE NG69) ------------------------------------
    a(_c("gs_nice_ng69_bed_guided_self_help", "ng69", "1.4.1; 1.4.2; 1.4.4", ["treatment"],
         "Offer a binge-eating-disorder-focused guided self-help programme to adults with binge eating disorder, explaining that psychological treatments have a limited effect on body weight and that weight loss is not a therapy target in itself; if guided self-help is unacceptable, contraindicated or ineffective after 4 weeks, offer group eating-disorder-focused CBT.",
         "Tıkınırcasına yeme bozukluğu olan erişkinlere bu bozukluğa odaklı yönlendirilmiş kendi kendine yardım programı önerin; psikolojik tedavilerin vücut ağırlığı üzerinde sınırlı etkisi olduğunu ve kilo kaybının kendi başına tedavi hedefi olmadığını açıklayın; yönlendirilmiş kendi kendine yardım kabul edilemez, kontrendike veya 4 hafta sonra etkisizse grup yeme bozukluğu odaklı BDT önerin.",
         BED, specialties=["psychiatry"]))

    # ---- Major depressive disorder (NICE NG222) ------------------------------------
    a(_c("gs_nice_ng222_ask_suicide", "ng222", "1.2.8; 1.2.9", ["history", "triage"],
         "Always ask people with depression directly about suicidal ideation and intent; if there is a risk of self-harm or suicide assess social support and arrange help appropriate to the level of need, and refer urgently to specialist mental health services if the person presents considerable immediate risk to themselves or others.",
         "Depresyonu olan kişilere intihar düşüncesini ve niyetini her zaman doğrudan sorun; kendine zarar verme veya intihar riski varsa sosyal desteği değerlendirin ve gereksinim düzeyine uygun yardım düzenleyin; kişi kendisi veya başkaları için ciddi ve acil risk oluşturuyorsa uzman ruh sağlığı hizmetlerine acilen yönlendirin.",
         MDD, specialties=["psychiatry"]))
    a(_c("gs_nice_ng222_review_2_4_weeks", "ng222", "1.4.3; 1.2.10", ["disposition"],
         "For all people with depression having treatment, review how well the treatment is working between 2 and 4 weeks after starting, monitor for side effects and suicidal ideation particularly in the early weeks, and advise them of the potential for increased agitation, anxiety and suicidal ideation in the initial stages.",
         "Tedavi alan tüm depresyon hastalarında tedaviye başladıktan 2-4 hafta sonra tedavinin ne kadar işe yaradığını gözden geçirin, özellikle ilk haftalarda yan etkileri ve intihar düşüncesini izleyin ve tedavinin başında artmış ajitasyon, anksiyete ve intihar düşüncesi olasılığı konusunda bilgi verin.",
         MDD, specialties=["psychiatry"]))
    a(_c("gs_nice_ng222_overdose_toxicity", "ng222", "1.2.12; 1.4.23", ["treatment"],
         "If a person with depression is at risk of suicide, do not withhold treatment on the basis of their suicide risk, take into account toxicity in overdose, limit the amount of medicine available if necessary, and do not routinely start treatment with TCAs, except lofepramine, as they are associated with the greatest risk in overdose.",
         "Depresyonlu kişi intihar riski taşıyorsa intihar riski nedeniyle tedaviyi esirgemeyin, aşırı dozdaki toksisiteyi göz önünde bulundurun, gerekirse eldeki ilaç miktarını sınırlayın ve aşırı dozda en yüksek riskle ilişkili olduklarından lofepramin dışındaki TSA'larla rutin olarak tedaviye başlamayın.",
         MDD, specialties=["psychiatry"]))

    # ---- PTSD (NICE NG116) -----------------------------------------------------------
    a(_c("gs_nice_ng116_tfcbt", "ng116", "1.6.15; 1.6.16", ["treatment"],
         "Offer an individual trauma-focused CBT intervention to adults who have acute stress disorder or clinically important symptoms of PTSD within the last month, and to adults with PTSD who have presented more than 1 month after a traumatic event, such as cognitive processing therapy, cognitive therapy for PTSD, narrative exposure therapy or prolonged exposure therapy.",
         "Son bir ay içinde akut stres bozukluğu veya klinik olarak önemli TSSB belirtileri olan erişkinlere ve travmatik olaydan 1 aydan uzun süre sonra başvuran TSSB'li erişkinlere bilişsel işleme terapisi, TSSB için bilişsel terapi, anlatı maruz bırakma terapisi veya uzun süreli maruz bırakma terapisi gibi bireysel travma odaklı BDT önerin.",
         PTSD, specialties=["psychiatry"]))
    a(_c("gs_nice_ng116_no_debrief_no_benzo", "ng116", "1.6.5; 1.6.24", ["treatment"],
         "Do not offer psychologically-focused debriefing for the prevention or treatment of PTSD, and do not offer drug treatments, including benzodiazepines, to prevent PTSD in adults.",
         "TSSB'nin önlenmesi veya tedavisi için psikolojik odaklı çözümleme (debriefing) önermeyin ve erişkinlerde TSSB'yi önlemek için benzodiazepinler dahil ilaç tedavisi önermeyin.",
         PTSD + ["F43.0"], specialties=["psychiatry"]))
    a(_c("gs_nice_ng116_emdr_ssri", "ng116", "1.6.19; 1.6.25", ["treatment", "disposition"],
         "Offer EMDR to adults with PTSD who have presented more than 3 months after a non-combat-related trauma, and consider venlafaxine or an SSRI such as sertraline for adults with PTSD if the person has a preference for drug treatment, reviewing it regularly.",
         "Savaş dışı bir travmadan 3 aydan uzun süre sonra başvuran TSSB'li erişkinlere EMDR önerin ve ilaç tedavisini tercih eden TSSB'li erişkinlerde venlafaksin veya sertralin gibi bir SSRI düşünüp düzenli olarak gözden geçirin.",
         PTSD, specialties=["psychiatry"]))
    a(_c("gs_nice_ng116_comprehensive_assessment", "ng116", "1.2.2; 1.6.4", ["history"],
         "Assessment of people with PTSD should be comprehensive, including physical, psychological and social needs and a risk assessment; consider active monitoring with follow-up within 1 month for people with subthreshold symptoms within 1 month of a traumatic event.",
         "TSSB'li kişilerin değerlendirmesi fiziksel, psikolojik ve sosyal gereksinimleri ve risk değerlendirmesini içerecek şekilde kapsamlı olmalıdır; travmatik olaydan sonraki 1 ay içinde eşik altı belirtileri olanlarda 1 ay içinde izlemle aktif izlemeyi düşünün.",
         PTSD, specialties=["psychiatry"]))

    # ---- Serotonin syndrome (BJCP 2025) ------------------------------------------------
    a(_c("gs_ss25_clonus_features", "ss25", "Clinical features", ["exam"],
         "Serotonin toxicity is characterised by neuromuscular excitation (clonus, hyperreflexia, myoclonus, rigidity), autonomic excitation (hyperthermia, tachycardia, mydriasis) and altered mental state; the autonomic and mental state changes can be non-specific, whereas clonus (spontaneous, inducible or ocular) is far more indicative.",
         "Serotonin toksisitesi nöromüsküler uyarılma (klonus, hiperrefleksi, miyoklonus, rijidite), otonom uyarılma (hipertermi, taşikardi, midriyazis) ve mental durum değişikliğiyle karakterizedir; otonom ve mental değişiklikler özgül olmayabilirken klonus (spontan, uyarılabilir veya oküler) çok daha belirleyicidir.",
         SERO, specialties=["toxicology", "psychiatry"]))
    a(_c("gs_ss25_severity_management", "ss25", "Management", ["treatment"],
         "Management of serotonin toxicity is determined by severity: mild toxicity requires reduction or cessation of serotonergic agents and benzodiazepines, while severe toxicity with hyperthermia and rigidity requires aggressive resuscitative care with rapid cooling and decreasing muscle activity with benzodiazepines, paralysis and intubation.",
         "Serotonin toksisitesinin yönetimi ağırlığa göre belirlenir: hafif toksisite serotonerjik ajanların azaltılmasını veya kesilmesini ve benzodiazepinleri gerektirirken, hipertermi ve rijiditeyle seyreden ağır toksisite hızlı soğutma ve benzodiazepin, paralizi ve entübasyonla kas aktivitesinin azaltılmasını içeren agresif resüsitasyon gerektirir.",
         SERO, specialties=["toxicology", "psychiatry"]))
    a(_c("gs_ss25_life_threatening", "ss25", "Clinical features: severity", ["triage"],
         "Life-threatening serotonin toxicity is distinguished by hyperthermia above 40 °C with a rapidly rising temperature over hours and increasing rigidity, particularly truncal.",
         "Yaşamı tehdit eden serotonin toksisitesi, saatler içinde hızla yükselen 40 °C üzeri hipertermi ve özellikle gövdede artan rijiditeyle ayırt edilir.",
         SERO, specialties=["toxicology", "psychiatry"]))
    a(_c("gs_ss25_antagonists_limited", "ss25", "Serotonin antagonists", ["treatment"],
         "There is limited human data and no controlled studies on serotonin antagonists such as cyproheptadine in serotonin toxicity; their clinical effect is likely due to sedation and they do not appear to decrease the duration of toxicity.",
         "Serotonin toksisitesinde siproheptadin gibi serotonin antagonistleri hakkında insan verisi sınırlıdır ve kontrollü çalışma yoktur; klinik etkileri muhtemelen sedasyona bağlıdır ve toksisitenin süresini kısaltmıyor görünürler.",
         SERO, specialties=["toxicology", "psychiatry"]))

    # ======================= PULMONOLOGY =======================================
    ARDS, ASP, BRON, CO, HEMOP, OSA, PLEF, TB = (["J80"], ["J69.0"], ["J21.9"], ["T58"], ["R04.2"], ["G47.33"],
                                                 ["J90"], ["A15.0"])
    # ---- ARDS (ESICM 2023) ---------------------------------------------------------
    a(_c("gs_esicm23_low_tidal", "esicm_ards23", "Recommendation: tidal volume", ["treatment"],
         "Use low tidal volume ventilation strategies (4 to 8 ml/kg predicted body weight), compared to larger tidal volumes, to reduce mortality in patients with ARDS not due to COVID-19.",
         "COVID-19'a bağlı olmayan ARDS'li hastalarda mortaliteyi azaltmak için daha büyük tidal hacimler yerine düşük tidal hacimli ventilasyon stratejileri (öngörülen vücut ağırlığına göre 4-8 ml/kg) kullanın.",
         ARDS, specialties=["critical care"]))
    a(_c("gs_esicm23_prone", "esicm_ards23", "Recommendation: prone position", ["treatment"],
         "Use prone position as compared to supine position for patients with moderate-severe ARDS (PaO2/FiO2 below 150 mmHg and PEEP of 5 cmH2O or more, despite optimisation of ventilation settings) to reduce mortality.",
         "Ventilasyon ayarları optimize edilmesine rağmen orta-ağır ARDS'li hastalarda (PaO2/FiO2 150 mmHg altı ve PEEP 5 cmH2O veya üzeri) mortaliteyi azaltmak için sırtüstü yerine yüzüstü pozisyon kullanın.",
         ARDS, specialties=["critical care"]))
    a(_c("gs_esicm23_hfno", "esicm_ards23", "Recommendation: HFNO", ["treatment"],
         "Non-mechanically ventilated patients with acute hypoxaemic respiratory failure not due to cardiogenic pulmonary oedema or acute exacerbation of COPD should receive high-flow nasal oxygen as compared to conventional oxygen therapy to reduce the risk of intubation.",
         "Kardiyojenik akciğer ödemi veya KOAH alevlenmesine bağlı olmayan akut hipoksemik solunum yetmezliği olan, mekanik ventilasyon uygulanmayan hastalar entübasyon riskini azaltmak için konvansiyonel oksijen yerine yüksek akımlı nazal oksijen almalıdır.",
         ARDS + ["J96.0"], specialties=["critical care"]))
    a(_c("gs_esicm23_no_recruitment_ecmo", "esicm_ards23", "Recommendations: recruitment manoeuvres; ECMO", ["treatment", "disposition"],
         "Do not use prolonged high-pressure recruitment manoeuvres (airway pressure of 35 cmH2O or more for at least one minute) in ARDS, and treat patients with severe ARDS meeting EOLIA trial eligibility criteria with ECMO in an ECMO centre that meets defined organisational standards.",
         "ARDS'de uzun süreli yüksek basınçlı alveoler açma manevraları (en az bir dakika 35 cmH2O veya üzeri hava yolu basıncı) uygulamayın ve EOLIA çalışması uygunluk kriterlerini karşılayan ağır ARDS'li hastaları tanımlanmış örgütsel standartları karşılayan bir ECMO merkezinde ECMO ile tedavi edin.",
         ARDS, specialties=["critical care"]))

    # ---- Aspiration pneumonitis (ATS/IDSA 2019) -------------------------------------
    a(_c("gs_atsidsa19_no_anaerobic", "atsidsa_cap19", "Question 10: anaerobic coverage", ["treatment"],
         "ATS/IDSA suggest not routinely adding anaerobic coverage for suspected aspiration pneumonia unless lung abscess or empyema is suspected.",
         "ATS/IDSA, akciğer apsesi veya ampiyemden şüphelenilmedikçe şüpheli aspirasyon pnömonisinde rutin olarak anaerop kapsamı eklenmemesini önerir.",
         ASP, specialties=["respiratory", "infectious"], countries=["US"]))
    a(_c("gs_atsidsa19_pneumonitis_supportive", "atsidsa_cap19", "Question 10: summary of the evidence", ["treatment", "disposition"],
         "Patients who aspirate gastric contents are considered to have aspiration pneumonitis, and many have resolution of symptoms within 24 to 48 hours and require only supportive treatment, without antibiotics.",
         "Mide içeriğini aspire eden hastalarda aspirasyon pnömoniti olduğu kabul edilir ve birçoğunda belirtiler 24-48 saat içinde düzelir ve antibiyotik olmadan yalnızca destekleyici tedavi gerekir.",
         ASP, specialties=["respiratory", "infectious"], countries=["US"]))

    # ---- Bronchiolitis (NICE NG9) --------------------------------------------------
    a(_c("gs_nice_ng9_emergency_referral", "ng9", "1.2.1; 1.1.10", ["triage"],
         "Immediately refer babies and children with bronchiolitis for emergency hospital care (usually by 999 ambulance) if they have apnoea (observed or reported), look seriously unwell to a healthcare professional, have severe respiratory distress (for example grunting, marked chest recession or a respiratory rate of over 70 breaths/minute) or central cyanosis.",
         "Bronşiyolitli bebek ve çocukları apne (görülen veya bildirilen), sağlık çalışanına ciddi hasta görünme, ağır solunum sıkıntısı (örneğin inleme, belirgin göğüs çekilmesi veya dakikada 70'in üzerinde solunum) ya da santral siyanoz varsa hemen acil hastane bakımına (genellikle 112 ambulansıyla) yönlendirin.",
         BRON, specialties=["paediatrics"], population="paediatric"))
    a(_c("gs_nice_ng9_oxygen_thresholds", "ng9", "1.4.4; 1.3.2", ["treatment", "disposition"],
         "Give oxygen supplementation to babies and children with bronchiolitis if their oxygen saturation is persistently less than 90% for children aged 6 weeks and over, or less than 92% for babies under 6 weeks or children of any age with underlying health conditions.",
         "Bronşiyolitli bebek ve çocuklarda oksijen satürasyonu 6 hafta ve üzeri çocuklarda sürekli yüzde 90'ın, 6 haftanın altındaki bebeklerde veya altta yatan sağlık sorunu olan her yaştaki çocukta yüzde 92'nin altındaysa oksijen desteği verin.",
         BRON, specialties=["paediatrics"], population="paediatric"))
    a(_c("gs_nice_ng9_do_not_treat", "ng9", "1.4.3; 1.3.7", ["treatment", "workup"],
         "Do not use antibiotics, hypertonic saline, nebulised adrenaline, salbutamol, montelukast, ipratropium bromide or systemic or inhaled corticosteroids to treat bronchiolitis, and do not routinely perform a chest X-ray, because changes may mimic pneumonia.",
         "Bronşiyolit tedavisinde antibiyotik, hipertonik salin, nebülize adrenalin, salbutamol, montelukast, ipratropium bromür veya sistemik ya da inhaler kortikosteroid kullanmayın ve değişiklikler pnömoniyi taklit edebileceğinden rutin akciğer grafisi çekmeyin.",
         BRON, specialties=["paediatrics"], population="paediatric"))
    a(_c("gs_nice_ng9_course", "ng9", "1.1.2; 1.1.8", ["history", "exam"],
         "When diagnosing bronchiolitis, take into account that symptoms usually peak between 3 and 5 days and that cough resolves in 90% of infants within 3 weeks, and measure oxygen saturation in every baby and child presenting with suspected bronchiolitis.",
         "Bronşiyolit tanısında belirtilerin genellikle 3-5. günlerde zirve yaptığını ve öksürüğün bebeklerin yüzde 90'ında 3 hafta içinde geçtiğini göz önünde bulundurun ve şüpheli bronşiyolitle başvuran her bebek ve çocukta oksijen satürasyonunu ölçün.",
         BRON, specialties=["paediatrics"], population="paediatric"))

    # ---- Carbon monoxide poisoning (CDC, UKHSA) --------------------------------------
    a(_c("gs_cdc_co_oxygen_hbo", "cdc_co", "Management", ["treatment"],
         "Administer 100% oxygen until the patient is symptom-free, usually about 4 to 5 hours, and consider hyperbaric oxygen when the carboxyhaemoglobin level is more than 25 to 30%, or there is cardiac involvement, severe acidosis, unconsciousness or neurological impairment; hyperbaric oxygen is the treatment of choice for pregnant women.",
         "Hasta belirtisiz olana kadar, genellikle yaklaşık 4-5 saat yüzde 100 oksijen verin; karboksihemoglobin yüzde 25-30'un üzerindeyse veya kardiyak tutulum, ağır asidoz, bilinç kaybı ya da nörolojik bozukluk varsa hiperbarik oksijeni düşünün; gebelerde hiperbarik oksijen tercih edilen tedavidir.",
         CO, specialties=["toxicology", "emergency"], countries=["US"]))
    a(_c("gs_cdc_co_pulse_ox", "cdc_co", "Diagnosis", ["workup"],
         "The conventional two-wavelength pulse oximeter is not accurate when carboxyhaemoglobin is present, and carboxyhaemoglobin levels do not correlate well with severity, outcomes or response to therapy, so clinical symptoms and the history of exposure must be assessed; women of childbearing age should have a pregnancy test.",
         "Karboksihemoglobin varlığında geleneksel iki dalga boylu nabız oksimetresi doğru değildir ve karboksihemoglobin düzeyleri ağırlık, sonuç veya tedaviye yanıtla iyi ilişkili değildir; bu nedenle klinik belirtiler ve maruziyet öyküsü değerlendirilmeli, doğurganlık çağındaki kadınlara gebelik testi yapılmalıdır.",
         CO, specialties=["toxicology", "emergency"], countries=["US"]))
    a(_c("gs_ukhsa_co_symptoms", "ukhsa_co", "Health effects of acute exposure", ["history"],
         "The most common symptoms following acute carbon monoxide exposure are headache, nausea and vomiting, vertigo, alteration in consciousness and subjective weakness, and exposure can result in non-specific symptoms such as lethargy and flu-like symptoms which may be misdiagnosed.",
         "Akut karbon monoksit maruziyetinden sonra en sık belirtiler baş ağrısı, bulantı ve kusma, vertigo, bilinç değişikliği ve öznel güçsüzlüktür; maruziyet yanlış tanı konabilecek letarji ve grip benzeri belirtiler gibi özgül olmayan belirtilere yol açabilir.",
         CO, specialties=["toxicology", "emergency"], countries=["UK"]))

    # ---- Haemoptysis (SCII 2023, K-CIG 2018) -------------------------------------------
    a(_c("gs_scii23_life_threatening", "scii_hemop23", "Statement 1B", ["triage"],
         "Life-threatening haemoptysis may be defined as more than 150 mL in 24 hours, a rate of 100 mL/h, or haemoptysis that causes airway obstruction, respiratory failure or haemodynamic instability requiring blood transfusion; patients die because of asphyxiation and not exsanguination.",
         "Yaşamı tehdit eden hemoptizi 24 saatte 150 mL'den fazla, saatte 100 mL hızında ya da hava yolu tıkanıklığı, solunum yetmezliği veya kan transfüzyonu gerektiren hemodinamik instabiliteye yol açan hemoptizi olarak tanımlanabilir; hastalar kan kaybından değil asfiksiden ölür.",
         HEMOP, specialties=["respiratory", "radiology"]))
    a(_c("gs_scii23_airway_position", "scii_hemop23", "Initial management", ["treatment"],
         "For life-threatening haemoptysis management starts with airway management, haemodynamic stabilisation and then control of the source; if the bleeding side is known it is placed in the dependent position to prevent aspiration of blood into the normal lung.",
         "Yaşamı tehdit eden hemoptizide yönetim hava yolu yönetimi, hemodinamik stabilizasyon ve ardından kaynağın kontrolüyle başlar; kanayan taraf biliniyorsa kanın sağlam akciğere aspire edilmesini önlemek için o taraf aşağıda kalacak şekilde yatırılır.",
         HEMOP, specialties=["respiratory", "radiology"]))
    a(_c("gs_scii23_cta_bae", "scii_hemop23", "Statements 4 and 7A", ["workup", "disposition"],
         "CT angiography is best suited for evaluating the cause and source of bleeding in a vitally stable patient, and bronchial artery embolisation is recommended in life-threatening or massive haemoptysis after initial stabilisation.",
         "Yaşamsal bulguları stabil hastada kanamanın nedenini ve kaynağını değerlendirmek için en uygun yöntem BT anjiyografidir ve yaşamı tehdit eden veya masif hemoptizide ilk stabilizasyondan sonra bronşiyal arter embolizasyonu önerilir.",
         HEMOP, specialties=["respiratory", "radiology"]))
    a(_c("gs_kcig18_cxr_ct", "kcig_hemop18", "Recommendations 1-1 to 1-3", ["workup"],
         "Chest radiography is suggested for initial evaluation in all adults with haemoptysis, and contrast-enhanced chest CT is recommended for those with two risk factors for lung cancer (over 40 years old and more than 30 pack-years) or with moderate (more than 30 mL/24 hours) or recurrent haemoptysis.",
         "Hemoptizili tüm erişkinlerde ilk değerlendirmede akciğer grafisi önerilir; akciğer kanseri için iki risk faktörü (40 yaş üzeri ve 30 paket-yıldan fazla) olanlarda veya orta (24 saatte 30 mL'den fazla) ya da tekrarlayan hemoptizide kontrastlı toraks BT önerilir.",
         HEMOP, specialties=["respiratory", "radiology"], countries=["GLOBAL", "KR"]))

    # ---- Obstructive sleep apnoea (NICE NG202) ------------------------------------------
    a(_c("gs_nice_ng202_ess_stopbang", "ng202", "1.1.3; 1.1.4", ["history"],
         "When assessing people with suspected OSAHS use the Epworth Sleepiness Scale and consider the STOP-Bang Questionnaire, but do not use the Epworth Sleepiness Scale alone to determine if referral is needed, because not all people with OSAHS have excessive sleepiness.",
         "Şüpheli OSAHS'li kişileri değerlendirirken Epworth Uykululuk Ölçeğini kullanın ve STOP-Bang Anketini düşünün; ancak OSAHS'li herkeste aşırı uykululuk olmadığından sevk gereksinimini yalnızca Epworth ölçeğine göre belirlemeyin.",
         OSA, specialties=["respiratory"]))
    a(_c("gs_nice_ng202_priority_driving", "ng202", "1.2.2", ["disposition"],
         "Within the sleep service, prioritise people with suspected OSAHS for rapid assessment if they have a vocational driving job, a job for which vigilance is critical for safety, or unstable cardiovascular disease.",
         "Uyku servisinde mesleği sürücülük olan, güvenlik için dikkatin kritik olduğu bir işte çalışan veya instabil kardiyovasküler hastalığı olan şüpheli OSAHS'li kişilere hızlı değerlendirme önceliği verin.",
         OSA, specialties=["respiratory"]))
    a(_c("gs_nice_ng202_polygraphy_cpap", "ng202", "1.3.1; 1.5.2", ["workup", "treatment"],
         "Offer home respiratory polygraphy to people with suspected OSAHS, and offer fixed-level CPAP to people with mild OSAHS whose symptoms affect their quality of life and usual daytime activities.",
         "Şüpheli OSAHS'li kişilere evde solunum poligrafisi önerin ve belirtileri yaşam kalitesini ve olağan gündüz etkinliklerini etkileyen hafif OSAHS'li kişilere sabit düzeyli CPAP önerin.",
         OSA, specialties=["respiratory"]))

    # ---- Pleural effusion (BTS 2023) --------------------------------------------------
    a(_c("gs_bts23_image_guided", "bts_pleural23", "Investigation of the undiagnosed unilateral pleural effusion", ["workup"],
         "Image-guided thoracentesis should always be used to reduce the risk of complications, sending 25 to 50 mL of pleural fluid, and pleural fluid cytology should be an initial diagnostic test in suspected secondary pleural malignancy.",
         "Komplikasyon riskini azaltmak için torasentez her zaman görüntüleme eşliğinde yapılmalı ve 25-50 mL plevral sıvı gönderilmelidir; şüpheli sekonder plevral malignitede plevral sıvı sitolojisi ilk tanı testlerinden biri olmalıdır.",
         PLEF, specialties=["respiratory"], countries=["UK"]))
    a(_c("gs_bts23_ph_drain", "bts_pleural23", "Pleural infection", ["workup", "treatment"],
         "In parapneumonic effusion or suspected pleural infection where diagnostic aspiration does not yield frank pus, perform immediate pH analysis: a pleural fluid pH of 7.2 or less implies a high risk of complex parapneumonic effusion or pleural infection and an intercostal drain should be inserted if safe.",
         "Parapnömonik efüzyonda veya şüpheli plevral enfeksiyonda tanısal aspirasyonla açık irin gelmiyorsa hemen pH analizi yapın: 7,2 veya altındaki plevral sıvı pH'ı komplike parapnömonik efüzyon veya plevral enfeksiyon için yüksek risk anlamına gelir ve güvenliyse interkostal dren yerleştirilmelidir.",
         PLEF, specialties=["respiratory"], countries=["UK"]))
    a(_c("gs_bts23_lights", "bts_pleural23", "Table 1: Light's criteria", ["workup"],
         "Pleural fluid is an exudate if one or more of Light's criteria are met: pleural fluid protein divided by serum protein above 0.5, pleural fluid LDH divided by serum LDH above 0.6, or pleural fluid LDH above two thirds of the upper limit of normal for serum LDH.",
         "Light kriterlerinden biri veya daha fazlası karşılanırsa plevral sıvı eksüdadır: plevral sıvı proteininin serum proteinine oranı 0,5'ten büyük, plevral sıvı LDH'sinin serum LDH'sine oranı 0,6'dan büyük veya plevral sıvı LDH'si serum LDH'si normal üst sınırının üçte ikisinden büyük.",
         PLEF, specialties=["respiratory"], countries=["UK"]))
    a(_c("gs_bts23_ntprobnp", "bts_pleural23", "Serum biomarkers", ["workup"],
         "Serum NT-proBNP should be considered to support a diagnosis of heart failure in patients with a unilateral pleural effusion suspected of having heart failure, but serum biomarkers should not be used in isolation, as multiple conditions may co-exist.",
         "Kalp yetmezliğinden şüphelenilen tek taraflı plevral efüzyonlu hastalarda kalp yetmezliği tanısını desteklemek için serum NT-proBNP düşünülmelidir, ancak birden fazla durum birlikte bulunabileceğinden serum biyobelirteçleri tek başına kullanılmamalıdır.",
         PLEF, specialties=["respiratory"], countries=["UK"]))

    # ---- Pulmonary tuberculosis (NICE NG33) -------------------------------------------
    a(_c("gs_nice_ng33_cxr_sputum", "ng33", "1.3.2.1; 1.3.2.2", ["workup"],
         "Take a chest X-ray and, if appearances suggest TB, send 3 deep cough sputum samples, preferably including 1 early morning sample, for TB microscopy and culture, before starting treatment if possible.",
         "Akciğer grafisi çekin ve görünüm tüberkülozu düşündürüyorsa, mümkünse tedaviye başlamadan önce tüberküloz mikroskopisi ve kültürü için tercihen biri sabah erken olmak üzere 3 derin öksürük balgamı gönderin.",
         TB, specialties=["respiratory", "infectious"]))
    a(_c("gs_nice_ng33_naat", "ng33", "1.3.3.1", ["workup"],
         "Request rapid diagnostic nucleic acid amplification tests for the M. tuberculosis complex on primary specimens if there is clinical suspicion of TB disease and the person has HIV, or rapid information would alter care or the need for a large contact-tracing initiative.",
         "Tüberküloz hastalığından klinik olarak şüpheleniliyor ve kişide HIV varsa ya da hızlı bilgi bakımı veya geniş bir temaslı taraması gereksinimini değiştirecekse, birincil örneklerde M. tuberculosis kompleksi için hızlı tanısal nükleik asit amplifikasyon testleri isteyin.",
         TB, specialties=["respiratory", "infectious"]))
    a(_c("gs_nice_ng33_standard_regimen", "ng33", "1.3.7.2", ["treatment"],
         "For people with active TB without central nervous system involvement, offer isoniazid (with pyridoxine), rifampicin, pyrazinamide and ethambutol for 2 months, then isoniazid (with pyridoxine) and rifampicin for a further 4 months, modified according to drug susceptibility testing.",
         "Merkezi sinir sistemi tutulumu olmayan aktif tüberkülozda 2 ay izoniazid (piridoksinle), rifampisin, pirazinamid ve etambutol, ardından 4 ay daha izoniazid (piridoksinle) ve rifampisin önerin; ilaç duyarlılık testine göre düzenleyin.",
         TB, specialties=["respiratory", "infectious"]))
    a(_c("gs_nice_ng33_single_room", "ng33", "1.5.1.2; 1.5.1.6", ["disposition"],
         "Put people with suspected infectious or confirmed pulmonary TB who remain in hospital in a single room, and do not admit them to a ward containing immunocompromised people unless they can be cared for in a negative pressure room.",
         "Hastanede kalan şüpheli bulaştırıcı veya doğrulanmış akciğer tüberkülozlu kişileri tek kişilik odaya alın ve negatif basınçlı odada bakılamayacaklarsa immünosupresif hastaların bulunduğu bir servise yatırmayın.",
         TB, specialties=["respiratory", "infectious"]))

    # ======================= RENAL AND UROLOGY =================================
    RET, BPH, NEPH, GN, TORS_T, EPID, PRI, COLIC = (["R33.9"], ["N40.1"], ["N04.9"], ["N05.9"], ["N44.00"],
                                                   ["N45.3"], ["N48.30"], ["N23", "N20.1"])
    # ---- Urinary retention / BPH (NICE CG97) ------------------------------------------
    a(_c("gs_nice_cg97_catheterise_alpha", "cg97", "1.7.1; 1.7.2", ["treatment"],
         "Immediately catheterise men with acute retention, and offer an alpha blocker to men for managing acute urinary retention before removal of the catheter.",
         "Akut idrar retansiyonu olan erkekleri hemen kateterize edin ve kateter çıkarılmadan önce akut idrar retansiyonunun yönetimi için alfa bloker önerin.",
         RET + BPH, specialties=["urology"]))
    a(_c("gs_nice_cg97_chronic_retention", "cg97", "1.7.4; 1.7.5", ["workup", "disposition"],
         "Carry out a serum creatinine test and imaging of the upper urinary tract in men with chronic urinary retention (residual volume greater than 1 litre or presence of a palpable or percussable bladder), and catheterise men who have impaired renal function or hydronephrosis secondary to chronic urinary retention.",
         "Kronik idrar retansiyonu olan erkeklerde (rezidü hacim 1 litreden fazla veya palpe ya da perküte edilebilen mesane) serum kreatinin testi ve üst üriner sistem görüntülemesi yapın ve kronik idrar retansiyonuna bağlı böbrek işlev bozukluğu veya hidronefrozu olan erkekleri kateterize edin.",
         RET + BPH, specialties=["urology"]))
    a(_c("gs_nice_cg97_history_meds", "cg97", "1.1.1; 1.1.2", ["history", "exam"],
         "At initial assessment, offer men with LUTS an assessment of their general medical history, review current medication including herbal and over-the-counter medicines to identify drugs that may be contributing, and offer a physical examination including the abdomen, external genitalia and a digital rectal examination.",
         "İlk değerlendirmede alt üriner sistem semptomları olan erkeklere genel tıbbi öykü değerlendirmesi önerin, katkıda bulunabilecek ilaçları belirlemek için bitkisel ve reçetesiz ilaçlar dahil mevcut ilaçları gözden geçirin ve karın, dış genital organlar ve parmakla rektal muayeneyi içeren fizik muayene önerin.",
         RET + BPH, specialties=["urology"]))
    a(_c("gs_nice_cg97_dipstick_creatinine", "cg97", "1.1.4; 1.1.7", ["workup"],
         "Offer men with LUTS a urine dipstick test to detect blood, glucose, protein, leucocytes and nitrites, and a serum creatinine test (plus eGFR) only if you suspect renal impairment, for example a palpable bladder, nocturnal enuresis, recurrent urinary tract infections or a history of renal stones.",
         "Alt üriner sistem semptomları olan erkeklere kan, glukoz, protein, lökosit ve nitrit saptamak için idrar çubuk testi önerin; serum kreatinin testini (eGFR ile birlikte) yalnızca böbrek işlev bozukluğundan şüpheleniyorsanız, örneğin palpe edilen mesane, gece enürezisi, tekrarlayan idrar yolu enfeksiyonları veya böbrek taşı öyküsü varsa önerin.",
         BPH + RET, specialties=["urology"]))
    a(_c("gs_nice_cg97_alpha_5ari", "cg97", "1.4.3; 1.4.6", ["treatment"],
         "Offer an alpha blocker (alfuzosin, doxazosin, tamsulosin or terazosin) to men with moderate to severe LUTS, and a 5-alpha reductase inhibitor to men with LUTS and a prostate estimated to be larger than 30 g or a PSA level greater than 1.4 ng/ml who are at high risk of progression.",
         "Orta-ağır alt üriner sistem semptomları olan erkeklere alfa bloker (alfuzosin, doksazosin, tamsulosin veya terazosin), prostatı 30 g'dan büyük tahmin edilen veya PSA düzeyi 1,4 ng/ml'den yüksek olan ve ilerleme riski yüksek erkeklere 5-alfa redüktaz inhibitörü önerin.",
         BPH, specialties=["urology"]))

    # ---- Renal colic (NICE NG118) ------------------------------------------------------
    a(_c("gs_nice_ng118_alpha_blocker", "ng118r", "Medical expulsive therapy", ["treatment"],
         "Consider alpha blockers for adults, children and young people with distal ureteric stones less than 10 mm.",
         "10 mm'den küçük distal üreter taşı olan erişkinler, çocuklar ve gençlerde alfa blokerleri düşünün.",
         COLIC, specialties=["urology"]))
    a(_c("gs_nice_ng118_surgery_48h", "ng118r", "Surgical treatment timing", ["treatment", "disposition"],
         "Offer surgical treatment (including SWL) to adults with ureteric stones and renal colic within 48 hours of diagnosis or readmission, if pain is ongoing and not tolerated or the stone is unlikely to pass.",
         "Üreter taşı ve renal koliği olan erişkinlere, ağrı devam ediyor ve tolere edilemiyorsa veya taşın düşmesi olası değilse, tanı ya da yeniden yatıştan sonraki 48 saat içinde cerrahi tedavi (ESWL dahil) önerin.",
         COLIC, specialties=["urology"]))

    # ---- Glomerular disease (KDIGO 2021) -----------------------------------------------
    a(_c("gs_kdigo21_sediment", "kdigo_gd21", "Practice Point 1.3.1", ["workup"],
         "Routine evaluation of urine sediment for erythrocyte morphology and the presence of red cell casts and/or acanthocytes is indicated in all forms of glomerular disease.",
         "Tüm glomerüler hastalık türlerinde idrar sedimentinin eritrosit morfolojisi ve eritrosit silendirleri ve/veya akantositler açısından rutin değerlendirmesi endikedir.",
         GN + NEPH, specialties=["nephrology"]))
    a(_c("gs_kdigo21_biopsy", "kdigo_gd21", "Practice Point 1.1.1", ["workup", "disposition"],
         "The kidney biopsy is the gold standard for the diagnostic evaluation of glomerular diseases; however, under some circumstances, treatment may proceed without a kidney biopsy confirmation of diagnosis.",
         "Böbrek biyopsisi glomerüler hastalıkların tanısal değerlendirmesinde altın standarttır; ancak bazı durumlarda tedaviye böbrek biyopsisiyle tanı doğrulanmadan başlanabilir.",
         GN + NEPH, specialties=["nephrology"]))
    a(_c("gs_kdigo21_anca_no_delay", "kdigo_gd21", "Practice Point 9.1.1; 9.1.2", ["treatment", "disposition"],
         "With a clinical presentation compatible with small-vessel vasculitis and positive MPO- or PR3-ANCA serology, waiting for a kidney biopsy to be performed or reported should not delay starting immunosuppressive therapy, especially in patients who are rapidly deteriorating, and patients with ANCA-associated vasculitis should be treated at centres with experience in its management.",
         "Küçük damar vaskülitiyle uyumlu klinik tablo ve pozitif MPO- veya PR3-ANCA serolojisi varlığında, böbrek biyopsisinin yapılmasını veya sonuçlanmasını beklemek, özellikle hızla kötüleşen hastalarda immünosupresif tedavinin başlanmasını geciktirmemelidir ve ANCA ilişkili vaskülitli hastalar bu konuda deneyimli merkezlerde tedavi edilmelidir.",
         GN, specialties=["nephrology"]))
    a(_c("gs_kdigo21_anti_gbm", "kdigo_gd21", "Practice Points 11.1.1; 11.2.1", ["workup", "treatment"],
         "Diagnosis of anti-GBM disease should be made without delay in all patients with suspected RPGN, and treatment for anti-GBM disease should start without delay if this diagnosis is suspected, even before the diagnosis is confirmed.",
         "Şüpheli hızlı ilerleyen glomerülonefritli tüm hastalarda anti-GBM hastalığı tanısı gecikmeden konmalı ve bu tanıdan şüpheleniliyorsa anti-GBM hastalığının tedavisine tanı doğrulanmadan bile gecikmeden başlanmalıdır.",
         GN, specialties=["nephrology"]))
    a(_c("gs_kdigo21_anti_gbm_plex", "kdigo_gd21", "Recommendation 11.2.1", ["treatment"],
         "KDIGO recommends initiating immunosuppression with cyclophosphamide and glucocorticoids plus plasmapheresis in all patients with anti-GBM glomerulonephritis except those who are treated with dialysis at presentation, have 100% crescents or more than 50% global glomerulosclerosis in an adequate biopsy sample, and do not have pulmonary haemorrhage.",
         "KDIGO, başvuruda diyalize giren, yeterli biyopsi örneğinde yüzde 100 kresent veya yüzde 50'den fazla global glomerüloskleroz olan ve pulmoner kanaması olmayanlar dışında tüm anti-GBM glomerülonefritli hastalarda siklofosfamid ve glukokortikoid artı plazmaferezle immünosupresyon başlatılmasını önerir.",
         GN, specialties=["nephrology"]))
    a(_c("gs_kdigo21_ns_oedema", "kdigo_gd21", "Chapter 1: management of oedema in nephrotic syndrome", ["treatment"],
         "The mainstays of treatment of nephrotic oedema are diuretics accompanied by moderate dietary sodium restriction (1.5 to 2 g/d or 60 to 90 mmol/d of sodium), and loop diuretics are considered first-line, with twice daily administration usually preferred.",
         "Nefrotik ödem tedavisinin temelini orta düzeyde diyet sodyum kısıtlamasıyla (günde 1,5-2 g veya 60-90 mmol sodyum) birlikte diüretikler oluşturur; kıvrım diüretikleri birinci basamak kabul edilir ve genellikle günde iki kez uygulama tercih edilir.",
         NEPH, specialties=["nephrology"]))
    a(_c("gs_kdigo21_ns_anticoag", "kdigo_gd21", "Practice Point 1.7.1", ["treatment"],
         "Full anticoagulation is indicated for patients with thromboembolic events occurring in the context of nephrotic syndrome, and prophylactic anticoagulation should be employed when the risk of thromboembolism exceeds the estimated patient-specific risks of an anticoagulation-induced serious bleeding event.",
         "Nefrotik sendrom bağlamında tromboembolik olay gelişen hastalarda tam antikoagülasyon endikedir ve tromboembolizm riski hastaya özgü tahmini ciddi antikoagülan kaynaklı kanama riskini aştığında profilaktik antikoagülasyon uygulanmalıdır.",
         NEPH, specialties=["nephrology"]))

    # ---- Childhood nephrotic syndrome (IPNA 2023) -----------------------------------------
    a(_c("gs_ipna23_workup", "ipna_ssns23", "Diagnosis: recommendations", ["workup"],
         "IPNA recommends a work-up for nephrotic syndrome in all children with gravity-dependent oedema, confirming nephrotic range proteinuria at least once by quantification before initiating treatment, and does not recommend routine kidney biopsy and genetic testing in children who present with typical features and age over 1 year.",
         "IPNA, yerçekimine bağlı ödemi olan tüm çocuklarda nefrotik sendrom açısından inceleme yapılmasını, tedaviye başlamadan önce nefrotik düzeyde proteinürinin en az bir kez ölçülerek doğrulanmasını önerir ve tipik özelliklerle başvuran 1 yaş üzeri çocuklarda rutin böbrek biyopsisi ve genetik test önermez.",
         NEPH, specialties=["nephrology", "paediatrics"], population="paediatric"))
    a(_c("gs_ipna23_exam_infection", "ipna_ssns23", "Table 2: initial work-up", ["exam"],
         "In a child with nephrotic syndrome examine blood pressure, volume status and extent of oedema (ascites, pericardial and pleural effusions), lymphadenopathy, and signs of infection (respiratory tract, skin, peritonitis, urinary tract).",
         "Nefrotik sendromlu çocukta kan basıncını, volüm durumunu ve ödemin yaygınlığını (asit, perikardiyal ve plevral efüzyonlar), lenfadenopatiyi ve enfeksiyon bulgularını (solunum yolu, deri, peritonit, idrar yolu) muayene edin.",
         NEPH, specialties=["nephrology", "paediatrics"], population="paediatric"))
    a(_c("gs_ipna23_prednisolone", "ipna_ssns23", "Treatment of the initial episode", ["treatment"],
         "Children with their first episode of idiopathic nephrotic syndrome should receive daily prednisolone for 4 weeks at 60 mg/m2 or 2 mg/kg (maximum dose 60 mg/day), followed by alternate day prednisolone at 40 mg/m2 or 1.5 mg/kg (maximum dose of 40 mg on alternate days) for 4 weeks.",
         "İlk idiyopatik nefrotik sendrom atağı olan çocuklar 4 hafta boyunca günlük 60 mg/m2 veya 2 mg/kg (en fazla günde 60 mg) prednizolon, ardından 4 hafta gün aşırı 40 mg/m2 veya 1,5 mg/kg (gün aşırı en fazla 40 mg) prednizolon almalıdır.",
         NEPH, specialties=["nephrology", "paediatrics"], population="paediatric"))
    a(_c("gs_ipna23_hypovolaemia", "ipna_ssns23", "Management of oedema and hypovolaemia", ["treatment"],
         "In children with nephrotic syndrome and signs of hypovolaemia, withhold diuretics because of the risk of thrombosis, hypovolaemic shock and AKI, discontinue ACE inhibitors or ARBs, and use 20% or 25% albumin infusions.",
         "Nefrotik sendromlu ve hipovolemi bulguları olan çocuklarda tromboz, hipovolemik şok ve ABH riski nedeniyle diüretikleri kesin, ACE inhibitörlerini veya ARB'leri bırakın ve yüzde 20 veya 25 albümin infüzyonu kullanın.",
         NEPH, specialties=["nephrology", "paediatrics"], population="paediatric"))

    # ---- Priapism (AUA/SMSNA 2021) --------------------------------------------------
    a(_c("gs_aua21_priapism_emergency", "aua_priapism21", "Background", ["triage"],
         "Prolonged (more than 4 hours) acute ischaemic priapism represents a medical emergency and may lead to cavernosal fibrosis and subsequent erectile dysfunction, so all patients with priapism should be evaluated emergently.",
         "Uzamış (4 saatten uzun) akut iskemik priapizm tıbbi bir acil durumdur ve kavernozal fibroza ve ardından erektil disfonksiyona yol açabilir; bu nedenle priapizmli tüm hastalar acilen değerlendirilmelidir.",
         PRI, specialties=["urology", "emergency"], countries=["US"]))
    a(_c("gs_aua21_priapism_dx", "aua_priapism21", "Guideline statements: diagnosis", ["history", "workup"],
         "In patients presenting with priapism, clinicians should complete a medical, sexual, and surgical history, perform a physical examination including the genitalia and perineum, and obtain a corporal blood gas at the initial presentation.",
         "Priapizmle başvuran hastalarda klinisyenler tıbbi, cinsel ve cerrahi öyküyü tamamlamalı, genital bölge ve perineyi içeren fizik muayene yapmalı ve ilk başvuruda korporal kan gazı almalıdır.",
         PRI, specialties=["urology", "emergency"], countries=["US"]))
    a(_c("gs_aua21_priapism_phenylephrine", "aua_priapism21", "Guideline statements: pre-surgical management", ["treatment"],
         "Clinicians should manage acute ischaemic priapism with intracavernosal phenylephrine and corporal aspiration, with or without irrigation, as first line therapy and prior to operative interventions, and should monitor blood pressure and heart rate during phenylephrine injections.",
         "Klinisyenler akut iskemik priapizmi birinci basamak tedavi olarak ve cerrahi girişimlerden önce intrakavernozal fenilefrin ve korporal aspirasyonla (irrigasyonlu veya irrigasyonsuz) yönetmeli ve fenilefrin enjeksiyonları sırasında kan basıncını ve kalp hızını izlemelidir.",
         PRI, specialties=["urology", "emergency"], countries=["US"]))
    a(_c("gs_aua21_priapism_no_conservative", "aua_priapism21", "Guideline statements: diagnosis", ["treatment"],
         "In a patient with diagnosed acute ischaemic priapism, conservative therapies (observation, oral medications, cold compresses, exercise) are unlikely to be successful and should not delay definitive therapies.",
         "Akut iskemik priapizm tanısı konmuş hastada konservatif tedavilerin (gözlem, oral ilaçlar, soğuk kompres, egzersiz) başarılı olma olasılığı düşüktür ve kesin tedavileri geciktirmemelidir.",
         PRI, specialties=["urology", "emergency"], countries=["US"]))
    a(_c("gs_aua21_priapism_shunt", "aua_priapism21", "Guideline statements: surgical management", ["disposition"],
         "Clinicians should perform a distal corporoglandular shunt, with or without tunneling, in patients with acute ischaemic priapism who have failed pharmacologic intracavernosal reversal and corporal aspiration, with or without irrigation.",
         "Farmakolojik intrakavernozal geri döndürme ve korporal aspirasyonun (irrigasyonlu veya irrigasyonsuz) başarısız olduğu akut iskemik priapizmli hastalarda klinisyenler tünelli veya tünelsiz distal korporoglandüler şant yapmalıdır.",
         PRI, specialties=["urology"], countries=["US"]))

    # ---- Epididymo-orchitis and torsion (CDC STI 2021) ----------------------------------
    a(_c("gs_cdc21_epid_torsion", "cdc_sti_epid21", "Diagnostic considerations", ["triage", "exam"],
         "Spermatic cord (testicular) torsion, a surgical emergency, should be considered in all cases of acute epididymitis; for men with severe unilateral pain with sudden onset, or whose test results do not support urethritis or urinary tract infection, immediate referral to a urologist for evaluation for testicular torsion is vital because testicular viability might be compromised.",
         "Cerrahi bir acil durum olan spermatik kord (testis) torsiyonu tüm akut epididimit olgularında düşünülmelidir; ani başlayan şiddetli tek taraflı ağrısı olan veya test sonuçları üretrit ya da idrar yolu enfeksiyonunu desteklemeyen erkeklerde testis canlılığı tehlikede olabileceğinden testis torsiyonu değerlendirmesi için hemen ürolojiye sevk hayati önem taşır.",
         EPID + TORS_T, specialties=["urology", "emergency"], countries=["US"]))
    a(_c("gs_cdc21_epid_ultrasound", "cdc_sti_epid21", "Diagnostic considerations", ["workup"],
         "Ultrasound should be used primarily for ruling out torsion of the spermatic cord in acute, unilateral, painful scrotal swelling; however, because partial spermatic cord torsion can mimic epididymitis on scrotal ultrasound, differentiation when torsion is not ruled out by ultrasound should be made on the basis of clinical evaluation.",
         "Akut, tek taraflı, ağrılı skrotal şişlikte ultrason öncelikle spermatik kord torsiyonunu dışlamak için kullanılmalıdır; ancak kısmi spermatik kord torsiyonu skrotal ultrasonda epididimiti taklit edebileceğinden, ultrasonla torsiyon dışlanamadığında ayrım klinik değerlendirmeye göre yapılmalıdır.",
         EPID + TORS_T, specialties=["urology", "emergency"], countries=["US"]))
    a(_c("gs_cdc21_epid_tests", "cdc_sti_epid21", "Diagnostic considerations", ["workup"],
         "All suspected cases of acute epididymitis should be tested for C. trachomatis and N. gonorrhoeae by NAAT, with urine the preferred specimen for men, and urine bacterial cultures should also be performed for all men.",
         "Tüm şüpheli akut epididimit olguları C. trachomatis ve N. gonorrhoeae açısından NAAT ile test edilmeli, erkeklerde tercih edilen örnek idrar olmalı ve tüm erkeklerde idrar bakteri kültürü de yapılmalıdır.",
         EPID, specialties=["urology", "infectious"], countries=["US"]))
    a(_c("gs_cdc21_epid_regimens", "cdc_sti_epid21", "Treatment", ["treatment"],
         "For acute epididymitis most likely caused by chlamydia or gonorrhoea give ceftriaxone 500 mg IM in a single dose plus doxycycline 100 mg orally 2 times/day for 10 days; for epididymitis most likely caused by enteric organisms only give levofloxacin 500 mg orally once daily for 10 days.",
         "Büyük olasılıkla klamidya veya gonoreye bağlı akut epididimitte tek doz kas içi 500 mg seftriakson artı 10 gün günde 2 kez oral 100 mg doksisiklin verin; büyük olasılıkla yalnızca enterik mikroorganizmalara bağlı epididimitte 10 gün günde bir kez oral 500 mg levofloksasin verin.",
         EPID, specialties=["urology", "infectious"], countries=["US"]))
    a(_c("gs_cdc21_epid_partners", "cdc_sti_epid21", "Management of sex partners", ["disposition"],
         "Men who have acute sexually transmitted epididymitis confirmed or suspected to be caused by N. gonorrhoeae or C. trachomatis should be instructed to refer all sex partners during the previous 60 days before symptom onset for evaluation, testing, and presumptive treatment.",
         "N. gonorrhoeae veya C. trachomatis kaynaklı olduğu doğrulanan ya da şüphelenilen cinsel yolla bulaşan akut epididimiti olan erkeklere, belirtiler başlamadan önceki 60 gün içindeki tüm cinsel partnerlerini değerlendirme, test ve ampirik tedavi için yönlendirmeleri söylenmelidir.",
         EPID, specialties=["urology", "infectious"], countries=["US"]))
    a(_c("gs_cdc21_epid_admit", "cdc_sti_epid21", "Treatment", ["disposition"],
         "Hospitalisation should be considered for epididymitis when severe pain or fever indicates other diagnoses (torsion, testicular infarction, abscess, or necrotising fasciitis) or when men are unable to comply with an antimicrobial regimen.",
         "Şiddetli ağrı veya ateş başka tanılara (torsiyon, testis enfarktı, apse veya nekrotizan fasiit) işaret ettiğinde ya da erkekler antimikrobiyal tedaviye uyum sağlayamadığında epididimitte hastaneye yatış düşünülmelidir.",
         EPID, specialties=["urology", "infectious"], countries=["US"]))

    # ---- Testicular torsion (BURST/BAUS 2022) ---------------------------------------------
    a(_c("gs_burst22_exploration_timing", "burst_baus22", "Introduction", ["treatment", "disposition"],
         "The current gold standard investigation and treatment for testicular torsion is emergency scrotal exploration, ideally performed within 4 to 6 h of symptom onset, to untwist a torted testicle; if viable after untwisting it is fixed, usually along with the contralateral testicle, and if unviable a simple orchidectomy is performed.",
         "Testis torsiyonunda güncel altın standart inceleme ve tedavi, dönmüş testisi geri çevirmek için ideal olarak belirtilerin başlangıcından sonraki 4-6 saat içinde yapılan acil skrotal eksplorasyondur; geri çevrildikten sonra canlıysa genellikle karşı testisle birlikte sabitlenir, canlı değilse basit orşiektomi yapılır.",
         TORS_T, specialties=["urology"], countries=["UK"]))
    a(_c("gs_burst22_contralateral", "burst_baus22", "Scenario A: torsion found intra-operatively", ["treatment", "disposition"],
         "Where torsion is found intra-operatively, if viable, the testis should be untwisted and fixed to prevent future torsion, and the contralateral side should be explored and fixed too; if the testis remains of uncertain viability, it should be replaced and orchidectomy avoided.",
         "Ameliyat sırasında torsiyon bulunursa, canlıysa testis geri çevrilmeli ve gelecekte torsiyonu önlemek için sabitlenmeli, karşı taraf da eksplore edilip sabitlenmelidir; testisin canlılığı belirsiz kalırsa yerine konmalı ve orşiektomiden kaçınılmalıdır.",
         TORS_T, specialties=["urology"], countries=["UK"]))

    # ======================= SECOND TIPS FOR SINGLE-TIP CONDITIONS =============
    HEADACHE, COPD_X, UTI_L, NSTI, COVID = ["R51"], ["J44.1"], ["N39.0"], ["M72.6"], ["U07.1"]
    a(_c("gs_nice_cg150_moh_reassurance", "cg150", "1.2.7; 1.3.3", ["history", "disposition"],
         "Be alert to medication overuse headache in people whose headache developed or worsened while taking triptans, opioids, ergots or combination analgesics on 10 days per month or more, or paracetamol, aspirin or an NSAID on 15 days per month or more, for 3 months or more, and do not refer people diagnosed with tension-type headache, migraine, cluster headache or medication overuse headache for neuroimaging solely for reassurance.",
         "Baş ağrısı, 3 ay veya daha uzun süre ayda 10 gün veya daha fazla triptan, opioid, ergot veya kombine analjezik ya da ayda 15 gün veya daha fazla parasetamol, aspirin veya NSAİİ kullanırken başlayan veya kötüleşen kişilerde ilaç aşırı kullanımı baş ağrısına dikkat edin ve gerilim tipi baş ağrısı, migren, küme baş ağrısı veya ilaç aşırı kullanımı baş ağrısı tanısı konan kişileri yalnızca güvence vermek için nörogörüntülemeye yönlendirmeyin.",
         HEADACHE, specialties=["neurology", "emergency"]))
    a(_c("gs_nice_ng115_hospital_tests", "ng115c", "1.3.3", ["workup"],
         "In all people presenting to hospital with an acute exacerbation of COPD obtain a chest X-ray, measure arterial blood gas tensions and record the inspired oxygen concentration, record an ECG, perform a full blood count and urea and electrolytes, send a sputum sample for microscopy and culture if purulent, and take blood cultures if the person has pyrexia.",
         "Akut KOAH alevlenmesiyle hastaneye başvuran herkeste akciğer grafisi çekin, arter kan gazı ölçün ve solunan oksijen konsantrasyonunu kaydedin, EKG çekin, tam kan sayımı ile üre ve elektrolitlere bakın, balgam pürülansa mikroskopi ve kültür için gönderin ve ateşi varsa kan kültürü alın.",
         COPD_X, specialties=["respiratory", "emergency"]))
    a(_c("gs_nice_ng115_where_to_treat", "ng115c", "1.3.1; Table 7", ["disposition"],
         "Factors favouring hospital rather than home treatment of a COPD exacerbation include inability to cope at home, severe breathlessness, poor or deteriorating general condition, cyanosis, worsening peripheral oedema, impaired level of consciousness, already receiving long-term oxygen therapy, living alone or not coping, acute confusion and rapid rate of onset.",
         "KOAH alevlenmesinde evde yerine hastanede tedaviyi destekleyen etkenler evde baş edememe, ağır nefes darlığı, kötü veya kötüleşen genel durum, siyanoz, kötüleşen periferik ödem, bozulmuş bilinç düzeyi, zaten uzun süreli oksijen tedavisi alıyor olma, yalnız yaşama veya baş edememe, akut konfüzyon ve hızlı başlangıçtır.",
         COPD_X, specialties=["respiratory", "emergency"]))
    a(_c("gs_nice_ng109_women", "ng109", "Table 1: non-pregnant women", ["treatment"],
         "First-choice antibiotics for lower UTI in non-pregnant women: nitrofurantoin (if eGFR is 45 ml/minute or more) 100 mg modified-release twice a day for 3 days, or trimethoprim (if there is a low risk of resistance) 200 mg twice a day for 3 days.",
         "Gebe olmayan kadınlarda alt İYE için ilk tercih antibiyotikler: nitrofurantoin (eGFR 45 ml/dakika veya üzerindeyse) 3 gün günde iki kez 100 mg değiştirilmiş salımlı ya da trimetoprim (direnç riski düşükse) 3 gün günde iki kez 200 mg.",
         UTI_L, specialties=["infectious", "primary care"]))
    a(_c("gs_nice_ng109_men", "ng109", "Table 3: men", ["treatment"],
         "For men aged 16 years and over with lower UTI, nitrofurantoin (if eGFR is 45 ml/minute or more) is given as 100 mg modified-release twice a day for 7 days, and nitrofurantoin is not recommended for men with suspected prostate involvement because it is unlikely to reach therapeutic levels in the prostate.",
         "16 yaş ve üzeri alt İYE'li erkeklerde nitrofurantoin (eGFR 45 ml/dakika veya üzerindeyse) 7 gün günde iki kez 100 mg değiştirilmiş salımlı verilir; prostatta terapötik düzeye ulaşması olası olmadığından prostat tutulumundan şüphelenilen erkeklerde nitrofurantoin önerilmez.",
         UTI_L, specialties=["infectious", "primary care"]))
    a(_c("gs_nice_ng109_backup_refer", "ng109", "1.1 Managing lower UTI", ["treatment", "disposition"],
         "Give self-care advice to all people with lower UTI, consider a back-up antibiotic prescription (to use if symptoms do not start to improve within 48 hours or worsen at any time) or an immediate prescription, and refer people aged 16 years and over to hospital if they have any symptoms or signs suggesting a more serious illness or condition, for example sepsis.",
         "Alt İYE'li herkese öz bakım önerisi verin, yedek antibiyotik reçetesi (belirtiler 48 saat içinde düzelmeye başlamazsa veya herhangi bir zamanda kötüleşirse kullanılmak üzere) ya da hemen reçete düşünün ve daha ciddi bir hastalık veya durumu, örneğin sepsisi düşündüren belirti veya bulguları olan 16 yaş ve üzeri kişileri hastaneye sevk edin.",
         UTI_L, specialties=["infectious", "primary care"]))
    a(_c("gs_nice_ng191_lmwh", "ng191c", "5.3.2; 5.3.3", ["treatment"],
         "Offer a standard prophylactic dose of a low molecular weight heparin as soon as possible, and within 14 hours of admission, to young people and adults with COVID-19 who need supplemental oxygen, CPAP, NIV or invasive mechanical ventilation and who do not have an increased bleeding risk, and continue it for a minimum of 7 days, including after discharge.",
         "Ek oksijen, CPAP, NIV veya invaziv mekanik ventilasyon gereken ve kanama riski artmamış COVID-19'lu genç ve erişkinlere olabildiğince erken ve yatıştan sonraki 14 saat içinde standart profilaktik doz düşük molekül ağırlıklı heparin önerin ve taburculuk sonrası dahil en az 7 gün sürdürün.",
         COVID, specialties=["infectious", "respiratory"]))
    a(_c("gs_wses18_nsti_signs", "wses_ssti18", "How should necrotizing infections be diagnosed?", ["exam"],
         "Clinical signs of necrotising soft-tissue infection include pain out of proportion, oedema extending beyond the erythema, and fever, and a rapidly progressive soft-tissue infection should always be suspected as a necrotising infection.",
         "Nekrotizan yumuşak doku enfeksiyonunun klinik bulguları orantısız ağrı, eritemin ötesine uzanan ödem ve ateştir; hızla ilerleyen bir yumuşak doku enfeksiyonundan her zaman nekrotizan enfeksiyon olarak şüphelenilmelidir.",
         NSTI, specialties=["surgery", "infectious"]))
    a(_c("gs_wses18_nsti_imaging", "wses_ssti18", "Imaging", ["workup"],
         "Imaging studies should not delay surgical consultation and intervention in suspected necrotising soft-tissue infection.",
         "Şüpheli nekrotizan yumuşak doku enfeksiyonunda görüntüleme çalışmaları cerrahi konsültasyonu ve girişimi geciktirmemelidir.",
         NSTI, specialties=["surgery", "infectious"]))
    a(_c("gs_wses18_nsti_clindamycin", "wses_ssti18", "Antimicrobial therapy", ["treatment"],
         "Either clindamycin or linezolid should be included in the empirical antibiotic regimen of necrotising soft-tissue infection.",
         "Nekrotizan yumuşak doku enfeksiyonunun ampirik antibiyotik rejimine klindamisin veya linezolid eklenmelidir.",
         NSTI, specialties=["surgery", "infectious"]))
    a(_c("gs_wses18_nsti_reexplore", "wses_ssti18", "Source control", ["disposition"],
         "Consider planning the first re-exploration within 12 to 24 h and repeat re-exploration until the patient is free of necrosis; a multidisciplinary team is mandatory for the management of necrotising soft-tissue infections.",
         "İlk yeniden eksplorasyonu 12-24 saat içinde planlamayı düşünün ve hastada nekroz kalmayana kadar yeniden eksplorasyonu tekrarlayın; nekrotizan yumuşak doku enfeksiyonlarının yönetiminde multidisipliner ekip zorunludur.",
         NSTI, specialties=["surgery", "infectious"]))

    return S


def by_id() -> Dict[str, GuidelineStatement]:
    return {s.id: s for s in catalog_statements()}
