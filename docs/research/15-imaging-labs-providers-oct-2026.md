# 15. Imaging, ECG and Lab Result Providers for the Simulated EHR (October 2026)

**Scope.** When a learner orders a CXR, CT, MRI, ultrasound, ECG or lab panel inside AcuDx, the platform must return a result that is (a) correct for the simulated condition and the elapsed time, (b) realistic enough to teach interpretation, and (c) legally redistributable in an open-source web app. This document surveys the real image banks, synthetic generators, ECG simulators, physiology engines, lab reference sources and browser viewers available as of 2026-10-19, with licenses and costs, and ends with a recommended result-generation pipeline.

**Grounding.** Every factual claim carries its URL inline. License terms were read from the publisher page where it was reachable; where only a secondary source was reachable this is flagged. Verified 2026-10-19.

**Headline.** Most of the famous CXR corpora (MIMIC-CXR, CheXpert, VinDr-CXR, PadChest, Stanford AIMI, RSNA challenge sets) forbid redistribution, so they cannot be shipped inside AcuDx. The runtime image bank must be built from CC BY / public-domain sources (NIH ChestX-ray14, TCIA, MedPix 2.0 on Zenodo, Open-i filtered by license, Wikimedia Commons, TotalSegmentator, AMOS22, PTB-XL, MIT-BIH, MedalCare-XL). Synthetic generation is a fallback for conditions with no suitable real image, must be labelled as synthetic, and should never be the primary teaching image where a real one exists.

---

## 1. Real image banks: what can actually be served at runtime

### 1.1 Summary table

| Source | Modality / size | License | Redistribute in web app? | Attribution |
|---|---|---|---|---|
| NIH ChestX-ray14 | 112,120 frontal CXR, 14 labels | NIH states no usage restrictions; asks for link, acknowledgement, citation ([HF card quoting NIH FAQ](https://huggingface.co/datasets/timm/nih-chest-xray-14), [Kaggle mirror](https://www.kaggle.com/datasets/nih-chest-xrays/data), [NIH Box](https://nihcc.app.box.com/v/ChestXray-NIHCC)) | Yes | "Data provided by the NIH Clinical Center"; cite Wang et al. CVPR 2017 |
| TCIA collections | Thousands of CT/MR/PET series, DICOM | Mostly CC BY 3.0 or 4.0 per collection; commercial use allowed on CC BY sets ([TCIA policy](https://www.cancerimagingarchive.net/data-usage-policies-and-restrictions/)) | Yes for CC BY collections; mirrors must pass terms downstream | Cite each collection's DOI; cite Clark et al. 2013 for TCIA generally |
| TotalSegmentator dataset | 1,228 CT volumes, 117 structures | CC BY 4.0 ([Zenodo](https://zenodo.org/records/10047292)) | Yes | Cite Wasserthal et al., Radiology AI 2023 (doi 10.1148/ryai.230024) |
| AMOS22 | 500 CT + 100 MRI, 15 abdominal organs, plus unlabeled parts | CC BY 4.0 ([Zenodo](https://zenodo.org/records/7262581)) | Yes | Cite Ji et al., NeurIPS 2022 |
| MedPix 2.0 (Zenodo) | ~12k curated cases, images + JSON case/description files, 328 MB | CC BY 4.0 ([Zenodo 12624810](https://zenodo.org/records/12624810), [paper](https://link.springer.com/article/10.1007/s41019-025-00297-8)) | Yes | Cite MedPix 2.0 paper and NLM MedPix |
| MedPix (NLM site) | Teaching file, many modalities | NLM: free for personal use and local teaching; contact contributor for other uses; not CC ([Open-i FAQ](https://openi.nlm.nih.gov/faq), [data.gov entry](https://catalog.data.gov/dataset/medpix)) | Not as a bulk mirror | Use the Zenodo 2.0 release instead |
| Open-i (NLM) | ~3.7M images from PMC open-access articles, MedPix, others; public GET /api/search, no key ([NLM catalog](https://catalog.data.gov/dataset/open-i/resource/e200d2db-98e4-48d5-a397-89dd75b12675), [third-party client](https://glama.ai/mcp/servers/LeviReisJs/mcp-openi-server)) | Per-image; NLM "cannot grant permission", license link on each image detail page ([FAQ](https://openi.nlm.nih.gov/faq)) | Yes, only for images whose own license is CC BY / CC0; filter by license type ([UI filters](https://library.mskcc.org/blog/page/219)) | Cite the source article and author per the image's CC license |
| Wikimedia Commons | Radiographs, CT, MR, US, ECG tracings | CC BY, CC BY-SA, CC0, PD only; NC licenses not accepted ([Commons:Licensing](https://commons.wikimedia.org/wiki/Commons:Licensing)) | Yes; BY-SA derivatives must stay BY-SA ([Reusing content](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)) | Author, license link, note changes |
| PTB-XL | 21,799 12-lead ECGs, 10 s, 500 Hz, SCP labels | CC BY 4.0 ([PhysioNet license page](https://physionet.org/content/ptb-xl/view-license/1.0.3/)) | Yes | Cite Wagner et al. 2020 and PhysioNet |
| MIT-BIH Arrhythmia | 48 half-hour 2-lead records | ODC-By 1.0, open access ([PhysioNet](https://physionet.org/content/mitdb/1.0.0/)) | Yes | Cite Moody & Mark 2001, doi 10.13026/C2F305 |
| MedalCare-XL | 16,900 synthetic 12-lead ECGs, 8 classes incl. MI subtypes, LBBB, RBBB, AVB | CC BY 4.0 ([Sci Data](https://pmc.ncbi.nlm.nih.gov/articles/PMC10409805/), Zenodo 10.5281/zenodo.8068944) | Yes (already synthetic, label as such) | Cite Gillette et al. 2023 |
| MIMIC-CXR / MIMIC-CXR-JPG | 377,110 CXR + 227,827 reports | PhysioNet Credentialed Health Data License 1.5.0; CITI training; DUA; "will not share" ([PhysioNet](https://physionet.org/content/mimic-cxr-jpg/2.1.0/), [license text](https://physionet.org/about/licenses/physionet-credentialed-health-data-license-150/)) | No | n/a |
| VinDr-CXR | 18,000 PA CXR, 22 local + 6 global labels, boxes | Same PhysioNet credentialed license ([PhysioNet](https://physionet.org/content/vindr-cxr/1.0.0/)) | No | n/a |
| CheXpert / CheXpert Plus | 224k CXR | Stanford Research Use Agreement: non-commercial, no redistribution ([CheXpert Plus paper](https://arxiv.org/html/2405.19538v2), [TFDS note](https://www.tensorflow.org/datasets/catalog/chexpert)) | No | n/a |
| Stanford AIMI shared datasets | Many | Research Use Agreement: personal non-commercial research only, no distribution; commercial license separately ([AIMI](https://aimi.stanford.edu/shared-datasets), [LERA terms](https://aimi.stanford.edu/datasets/lera-lower-extremity-radiographs)) | No | n/a |
| PadChest | 160k+ CXR, 1.02 TB | Research Use Agreement, requester "commits to not sharing" ([BIMCV](https://bimcv.cipf.es/bimcv-projects/padchest/)) | No | n/a |
| RSNA challenge sets (ICH, RSPECT PE, ICA aneurysm, etc.) | CT | Non-commercial only; "may not share or redistribute" ([AWS registry ICH](https://github.com/awslabs/open-data-registry/blob/main/datasets/rsna-intracranial-hemorrhage-detection.yaml), [RSPECT](https://registry.opendata.aws/rsna-pulmonary-embolism-detection), [RSNA-ICA](https://registry.opendata.aws/rsna-intracranial-aneurysm-detection-dataset/), [MIRA](https://imaging.rsna.org/)) | No | n/a |
| Radiopaedia | ~60k cases, all modalities | CC BY-NC-SA 3.0 as modified by Terms; "not available for bulk download", not for ML datasets ([Terms](https://radiopaedia.org/terms?lang=us), [old licence page](https://radiopaedia.org/licence-old?lang=us)) | No bulk mirror. Deep-link to a case (with attribution) is fine; embedding in a commercial SaaS tier is not | Link out, attribute case author and Radiopaedia |

### 1.2 Practical notes per source

- **NIH ChestX-ray14** is the only large, label-rich CXR corpus with no redistribution restriction, so it is the backbone of the CXR bank. Labels are NLP-derived and noisy ([HF card](https://huggingface.co/datasets/timm/nih-chest-xray-14)); AcuDx must curate a per-condition subset (a few hundred images) with a radiologist sign-off rather than trusting labels blindly. Kaggle's CC0 label is Kaggle's, not NIH's; follow the NIH attribution request.
- **TCIA** is the main CT/MR source. Each collection page lists its license in the Data Access table, and anyone mirroring data must pass the terms downstream and must not try to reconstruct faces ([TCIA policy](https://www.cancerimagingarchive.net/data-usage-policies-and-restrictions/)). Controlled-access collections moved to NCI CRDC/dbGaP in April 2025 and are out of reach for AcuDx. For acute-care teaching the CC BY oncology collections still yield normal-ish chest/abdomen CT, incidental pneumonia, effusions, PE on CTPA and lung nodules.
- **TotalSegmentator** and **AMOS22** give whole-body and abdominal CT/MR with organ masks under CC BY 4.0; useful as "normal anatomy" baselines and as segmentation masks for synthetic conditioning (section 2).
- **MedPix 2.0 on Zenodo** is the best multi-modality teaching-case source (case text, diagnosis, modality, images) under CC BY 4.0 ([Zenodo](https://zenodo.org/records/12624810)). It is a curated subset of NLM MedPix; the live NLM site has stricter, non-CC terms, so build only from the Zenodo files.
- **Open-i** exposes a public search API with image-type, collection and license refinements ([NLM catalog](https://catalog.data.gov/dataset/open-i/resource/e200d2db-98e4-48d5-a397-89dd75b12675)). Harvest at build time, keep only CC BY / CC0 PMC figures, and store the article DOI and author for attribution. The FAQ is explicit that copyright stays with the authors or journal ([FAQ](https://openi.nlm.nih.gov/faq)).
- **Wikimedia Commons** is useful for rarer ultrasound and ECG tracings. Wikilegal notes that privacy and patient confidentiality law can apply even to freely licensed medical images ([Wikilegal](https://meta.wikimedia.org/wiki/Wikilegal/Copyright_of_Medical_Imaging)), so prefer de-identified clinical images with a clear uploader statement.
- **Radiopaedia** must be treated as a link-out reference. Its Terms say it is "not designed or intended to be used as an imaging data-set" and is not available for bulk download ([Terms](https://radiopaedia.org/terms?lang=us)). A paid partnership is the only route to in-app embedding.
- **Credentialed sets (MIMIC, VinDr, CheXpert, PadChest, AIMI)** are still valuable to AcuDx developers for *training or validating* internal models and for *deriving per-condition statistical priors* (e.g., distribution of effusion size), but nothing pixel-derived can ship. PhysioNet's position is that derived datasets must be shared back on PhysioNet under the same agreement ([MIMIC-IV page](https://physionet.org/content/mimiciv/)).

### 1.3 Attribution pattern for the app

Every served image carries a provenance record: `{source, source_id, license, license_url, author, citation, modifications}` and the viewer footer renders "Image: NIH Clinical Center ChestX-ray14 (no restrictions), Wang et al. 2017" or "CT: TCIA collection XYZ, CC BY 4.0, doi:...". CC BY requires credit, license link and a note of changes ([Commons reuse guide](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)). Keep BY-SA items in a separate bucket because cropped or annotated derivatives must stay BY-SA.

---

## 2. Synthetic medical image generation (state as of October 2026)

### 2.1 Models and their licenses

| Model | What it does | Weights | License | Fit for AcuDx |
|---|---|---|---|---|
| **RoentGen-v2** (Stanford MIMI, 2025) | Text-to-CXR, SD 2.1 fine-tune, controls findings plus age and sex; 565k-image synthetic companion set ([GitHub](https://github.com/StanfordMIMI/RoentGen-v2), [arXiv 2508.16783](https://arxiv.org/abs/2508.16783)) | Gated on HF: must attest MIMIC-CXR credentialing and only share with credentialed users ([HF card](https://huggingface.co/stanfordmimi/RoentGen-v2)) | Code MIT; weights gated by MIMIC DUA | Generated images may be used for "research and educational use" per card, but weight access requires a credentialed developer; run server-side only |
| RoentGen v1 (2022) | Text-to-CXR, SD 1.4 | On request to MIMIC-credentialed researchers ([GitHub](https://github.com/StanfordMIMI/RoentGen), [Nat BME 2024](https://www.nature.com/articles/s41551-024-01246-y)) | Research | Superseded by v2 |
| **Cheff** (Weber et al., PAKDD 2023) | Cascaded latent diffusion, report-conditioned, ~1 MP output, trained on MaCheX (650k CXR) ([GitHub](https://github.com/saiboxx/chexray-diffusion), [arXiv 2303.11224](https://arxiv.org/pdf/2303.11224)) | Public: autoencoder, unconditional and report-conditioned LDM, super-res | MIT | Most permissive open CXR generator; verify output quality per condition |
| **MONAI CXR LDM** | 512x512 CXR conditioned on report findings/impressions, CLIP text encoder from SD 2.1 ([HF README](https://huggingface.co/MONAI/cxr_image_synthesis_latent_diffusion_model/blob/main/docs/README.md), [training repo](https://github.com/Warvito/generative_chestxray), [MONAI Generative paper, FID 8.83 on MIMIC-CXR](https://arxiv.org/pdf/2307.15208)) | Public | No license stated on card; repo code Apache 2.0 via MONAI | Usable baseline; confirm license with maintainers before shipping |
| **RadEdit** (Microsoft) | Text-to-CXR LDM trained from scratch on MIMIC-CXR + NIH + CheXpert (487,680 frontal images); mask-guided editing to add or remove findings ([HF card](https://huggingface.co/microsoft/radedit), [paper](https://arxiv.org/pdf/2312.12865)) | Public (UNet only; VAE and BioViL-T text encoder assembled separately) | Weights MSRLA (research only); "any deployed use case... is out of scope"; pipeline MIT | Not for production AcuDx; fine for offline dataset curation experiments |
| **MAISI / MAISI-v2** (NVIDIA MONAI) | 3D CT latent diffusion up to 512x512x768 with paired segmentation masks; body-region and organ/tumor-size control; v2 adds rectified flow for ~33x speedup ([NGC card](https://catalog.ngc.nvidia.com/orgs/nvidia/monaitoolkit/models/monai_maisi_ct_generative), [MAISI WACV 2025](https://openaccess.thecvf.com/content/WACV2025/papers/Guo_MAISI_Medical_AI_for_Synthetic_Imaging_WACV_2025_paper.pdf), [MAISI-v2 arXiv 2508.05772](https://arxiv.org/pdf/2508.05772), [tutorial](https://github.com/Project-MONAI/tutorials/blob/main/generation/maisi/README.md)) | Public | Code Apache 2.0; weights NVIDIA "NCLS v1" ([NGC](https://catalog.ngc.nvidia.com/orgs/nvidia/monaitoolkit/models/monai_maisi_ct_generative)) | Needs 58 GB GPU for 512^3 inference; best used offline to pre-render a CT library, not at request time |
| **MedSyn / MedSyn2** (Batmanghelich lab) | Text-guided anatomy-aware 3D chest CT; MedSyn2 adds segmentation prompts ([GitHub](https://github.com/batmanlab/MedSyn), [TMI paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC11656526/), [MedSyn2 arXiv 2606.00967](https://arxiv.org/pdf/2606.00967)) | Partial; UPMC-trained weights by application | CC BY-NC | Non-commercial only; blocks any paid AcuDx tier |
| MedVAE (Stanford) | 2D/3D medical autoencoders trained on 1.05M images ([HF](https://huggingface.co/stanfordmimi/MedVAE)) | Public | See card | Component for a custom LDM, not a generator |
| Rectified-flow CXR foundation models (2026 preprints) | Larger text-to-CXR models ([arXiv 2606.19460](https://arxiv.org/html/2606.19460v1), [arXiv 2509.03903](https://arxiv.org/pdf/2509.03903)) | Varies | Varies | Track; not yet proven for teaching use |

Community HF fine-tunes (DreamBooth/LoRA on NIH or pneumonia sets, e.g. [KidderLab/Chest_X-ray](https://huggingface.co/KidderLab/Chest_X-ray), [Osama03 LoRA](https://huggingface.co/Osama03/Medical-X-ray-image-generation-stable-diffusion)) exist but lack validation and should not be used.

### 2.2 Quality and failure modes (why synthetic cannot be primary)

- **Radiologists are fooled, which is the problem, not the feature.** Tordjman et al., Radiology 2026 (doi 10.1148/radiol.252094): 17 radiologists, 264 radiographs, half synthetic (GPT-4o and RoentGen). Unprompted, only 41% noticed synthetic images; after being told, mean accuracy ~75% on GPT-4o images and ~70% on RoentGen CXR. Characteristic flaws: overly smooth bones, unnaturally straight spines, overly symmetrical lungs, uniform vessel patterns, "too clean" fractures confined to one cortex ([RSNA news](https://www.rsna.org/news/2026/march/chatgpt-generated-radiographs), [press release](https://www.rsna.org/media/press/2026/2645)). For education these artefacts teach wrong anatomy.
- **Hallucinated or shortcut pathology.** Analysis of RoentGen output found latent "hallucinations" detectable by downstream classifiers ([arXiv 2312.06979](https://arxiv.org/abs/2312.06979)). RoentMod (npj Digit Med 2026) uses synthetic edits precisely to expose shortcut learning; two readers judged 745/800 edited CXR realistic, i.e., ~7% were not ([RoentMod](https://www.nature.com/articles/s41746-026-02497-6)).
- **Laterality and unprompted content.** Multimodal LLM image generation has been reported to add unprompted laterality markers and mis-sided findings ([arXiv 2508.07031 summary](https://pith.science/paper/2508.07031)). Text-to-image CXR models do not reliably honour "left" vs "right"; AcuDx must verify side with a detector or hand review.
- **RadEdit's own card** lists VAE artefacts, bias to US inpatient data, erroneous automated labels and failure on complex prompts ([HF card](https://huggingface.co/microsoft/radedit)).
- **Fairness upside.** Diffusion-synthesised CXR can improve classifier fairness and performance when used as augmentation ([PLOS Digit Health](https://journals.plos.org/digitalhealth/article?id=10.1371%2Fjournal.pdig.0001277)), which is a developer-side use, not a learner-facing one.

### 2.3 Recommendation: when synthetic, and how to label it

1. **Real first.** For every condition in the AcuDx case library, curate 5 to 30 real, license-clean images (section 1) with radiologist-verified findings. This covers the common acute presentations (pneumonia, effusion, pneumothorax, CHF, consolidation, PE on CTPA, ICH on CT, bowel obstruction, fractures).
2. **Synthetic only as a fallback** for (a) rare conditions with no CC-licensed image, (b) demographic matching when a case needs a specific age/sex/body habitus and the bank has none, (c) serial imaging where a "day 2" follow-up of the same patient is pedagogically needed. Generate offline with Cheff (MIT) or RoentGen-v2 (if a credentialed developer runs it), run a laterality check and a pathology classifier, and have a clinician approve before adding to the bank. Never generate at request time.
3. **Label every synthetic image three ways.** (a) Visible "SYNTHETIC IMAGE, for education" burn-in in the viewer corner; (b) DICOM/JSON metadata flag `synthetic: true` with generator name and version; (c) a C2PA manifest embedded in the PNG/JPEG with a `c2pa.created` action whose `digitalSourceType` is `http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia` ([CAI assertion docs](https://opensource.contentauthenticity.org/docs/manifest/writing/assertions-actions)). Use `c2pa-rs` (MIT or Apache 2.0, with a C API) ([GitHub](https://github.com/contentauth/c2pa-rs)). Note C2PA is a signed self-assertion, not a detector, and metadata can be stripped on re-upload ([CAI how it works](https://contentauthenticity.org/how-it-works), [OpenAI C2PA note](https://help.openai.com/en/articles/8912793-c2pa-in-chatgpt-images)), so the visible label and database flag are the controls that matter inside AcuDx. Validators disagree on edge cases ([arXiv 2604.24890](https://arxiv.org/html/2604.24890v1)), so do not rely on C2PA for anything safety-critical.
4. **Keep synthetic out of assessment.** Scored interpretation items should use real images only, so a learner is never penalised for an artefact of the generator.

---

## 3. ECG: synthesis and rendering

### 3.1 Signal generation options

| Tool | Approach | Pathology support | License |
|---|---|---|---|
| **NeuroKit2** `ecg_simulate(method="ecgsyn" or "multileads")` | McSharry ECGSYN dynamical model; 12-lead via projection; parameters `ti`, `ai`, `bi` set wave timing, amplitude, width; HR, HRV, Laplacian noise ([docs](https://neuropsychology.github.io/NeuroKit/functions/ecg.html), [PyPI](https://pypi.org/project/neurokit2/)) | Generic morphology perturbation only; the "abnormal 12-lead" example randomises parameters, no named pathologies ([example](https://neuropsychology.github.io/NeuroKit/examples/ecg_generate_12leads/ecg_generate_12leads.html)) | MIT |
| ECGSYN (McSharry 2003) | Original 3-ODE model, PhysioNet C/Matlab | Rate and morphology parameters only | Open (PhysioNet) |
| **MedalCare-XL** | 16,900 pre-computed 12-lead, 500 Hz, 10 s, from openCARP electrophysiology simulations; healthy, 1st-degree AVB, LBBB, RBBB, MI (6 subclasses by vessel and transmurality), LAE, FAM, IAB; amplitudes matched to PTB-XL ([Sci Data](https://pmc.ncbi.nlm.nih.gov/articles/PMC10409805/)) | Yes, physiologically simulated | CC BY 4.0 |
| **PTB-XL** (real) | 21,799 real 12-lead with SCP-ECG diagnostic codes (MI, STTC, CD, HYP, AF, etc.) ([PhysioNet](https://physionet.org/content/ptb-xl/1.0.3/)) | Yes, real pathology including AF and STEMI patterns | CC BY 4.0 |
| MIT-BIH Arrhythmia (real) | 2-lead rhythm strips rich in PVCs, AF, blocks ([PhysioNet](https://physionet.org/content/mitdb/1.0.0/)) | Rhythm pathologies | ODC-By |
| ECGEN | Deep generative 12-lead (PyTorch Lightning) ([PyPI](https://pypi.org/project/ecgen/)) | Learned | Check repo |
| echogen | Sum-of-Gaussians 12-lead generator on PyPI, currently **quarantined** by PyPI and ships a call-home "canary" ([PyPI](https://pypi.org/project/echogen/)) | Unknown | Do not use |
| UAOSIM-ECG | Open hardware 12-lead simulator ([IEEE](https://ieeexplore.ieee.org/document/9626054)) | Teaching device | n/a for web |

**Recommended approach.** Use a *template library plus parametric engine*: pick a real PTB-XL or MedalCare-XL 10-second template matching the case diagnosis (STEMI territory, AF, LBBB, hyperkalaemia patterns from PTB-XL STTC class), then let a NeuroKit2/ECGSYN-style engine resample it to the simulated heart rate and add noise, and apply rule-based morphology edits for dynamic states the physiology engine produces (rate, PR, QTc, ST shift magnitude). The engine is deterministic given the case seed, so the same case always yields the same strip. ST elevation territories, reciprocal depression and progression over serial ECGs are encoded as explicit rules, not learned, so they are auditable by a cardiologist.

### 3.2 Rendering at standard calibration

Standard clinical paper is 25 mm/s and 10 mm/mV with 1 mm minor and 5 mm major grid. Options:

- **dcmjs-ecg** (MIT): renders DICOM 12-lead waveform objects to SVG in Node or browser; `speed` defaults to 25 mm/s, `amplitude` must be set to 10 mm/mV (default 5), optional 40 Hz low-pass ([GitHub](https://github.com/PantelisGeorgiadis/dcmjs-ecg)). Best fit if AcuDx stores ECGs as DICOM Waveform (SOP 12-lead ECG), which also gives a PACS-like artifact.
- **LIRYC-IHU/ecg-viewer**: React + WebGL, parses DICOM 12-lead, 12x1, 6x2, 3x4 layouts ([GitHub](https://github.com/LIRYC-IHU/ecg-viewer)).
- Simple custom canvas/SVG: draw grid at 1 mm = `px_per_mm` (derive from CSS DPI or let the user calibrate), map `x = t * 25 * px_per_mm`, `y = -mV * 10 * px_per_mm`; 10-second 3x4 plus rhythm strip is ~250 mm wide. Canvas is fine for live monitor strips; SVG is preferable for the static 12-lead printout so it exports to PDF cleanly. Example starter repos: [Akitha-Chanupama/ECG_Visualizer](https://github.com/Akitha-Chanupama/ECG_Visualizer).

---

## 4. Labs: reference ranges, trajectories and physiology engines

### 4.1 Terminology and unit sources

- **LOINC** (Regenstrief): distributed free; license grants perpetual, royalty-free use, copy and distribution for commercial or non-commercial purposes, subject to attribution notice and the rule that LOINC Parts may only be used as presented ([LOINC FAQ](https://loinc.org/kb/faq/basics), [license](https://loinc.org/kb/license), [third-party compliance notes](https://github.com/monarch-initiative/monarch-app/issues/1465)). Store every lab as a LOINC code so FHIR Observation export is clean.
- **UCUM** (Regenstrief): v1.1 license (June 2024) is royalty-free, allows reproduction and distribution and interoperating software, forbids derivative "competing" unit standards and content changes; requires copyright notice and license reference ([UCUM license](https://ucum.org/license)).
- **Reference intervals.** No single CC-licensed master table exists. Practical sources: the NBME public laboratory values table (conventional and SI) for USMLE-style ranges ([NBME](https://www.nbme.org/laboratory-values/)); CALIPER pediatric database, free online, 100+ analytes by age and sex ([CALIPER white paper](https://www.tandfonline.com/doi/full/10.1080/10408363.2017.1379945)); institutional directories such as ARUP and Mayo are copyrighted test catalogs and should be consulted, not copied. AcuDx should author its own `reference_ranges.json` (analyte, LOINC, UCUM unit, sex, age band, low, high, critical low/high, source citation) and have a clinical pathologist sign it. Keep SI and conventional in parallel for Turkish and US deployments.

### 4.2 Synthetic patient data

- **Synthea** (MITRE) is Apache 2.0 ([LICENSE](https://github.com/synthetichealth/synthea/blob/master/LICENSE)); its PhysiologySimulator wraps SBML models and can generate arrhythmia ECGs, at ~50% throughput cost ([Coherent paper](https://www.mdpi.com/2079-9292/11/8/1199)). Caution: module lab ranges are hand-authored and can be wrong; an October 2026 issue reports CABG-pathway arterial pH 6.8 to 7.3 and bilirubin 6 to 15 mg/dL ([issue #1737](https://github.com/synthetichealth/synthea/issues/1737)). Use Synthea for background history and medication lists, not for acute lab trajectories.
- **Synthea Coherent Data Set**: CC BY 4.0, FHIR + DICOM + ECG + genomics + notes, on AWS Open Data ([registry](https://registry.opendata.aws/synthea-coherent-data/), [paper](https://www.mdpi.com/2079-9292/11/8/1199)). Good for populating a realistic prior-encounters tab.
- **MIMIC-IV** labs (credentialed) can inform the *statistical priors* (e.g., lactate distribution in sepsis) at development time but cannot be redistributed, and PhysioNet asks that derived datasets be re-shared under the same agreement ([MIMIC-IV](https://physionet.org/content/mimiciv/)). The MIMIC-IV demo (100 patients) is open access ([demo](https://physionet.org/content/mimic-iv-demo/)).

### 4.3 Physiology engines for real-time vitals and drug response

| Engine | License | Real time | Drugs | Notes |
|---|---|---|---|---|
| **Pulse Physiology Engine** (Kitware) | Apache 2.0 ([FAQ](https://pulse.kitware.com/_f_a_q.html)) | 20 ms time step, real-time or faster ([About](https://pulse.kitware.com/_about_pulse.html)) | PBPK + sigmoid Emax PD; 17 validated drugs: albuterol, etomidate, epinephrine, fentanyl, furosemide, ketamine, lorazepam, midazolam, morphine, naloxone, pralidoxime, prednisone, rocuronium, succinylcholine, propofol, norepinephrine, phenylephrine; effects on HR, SBP/DBP, RR, TV, neuromuscular block, sedation, bronchodilation, pupils; IV bolus, infusion, IM, inhaled ([Drugs methodology](https://pulse.kitware.com/_drugs_methodology.html)) | Conditions include sepsis and ARDS; actions include fluids and pressors ([arXiv 2502.06011](https://arxiv.org/pdf/2502.06011)). Documented limits: plasma concentration calculation "currently incorrect", no drug interactions, no true overdose, immediate-onset bias. C++ with Python, Java, C# bindings. |
| **BioGears** (ARA) | Apache 2.0 ([FAQ](https://www.biogearsengine.com/documentation/_f_a_q.html), [JOSS](https://www.theoj.org/joss-papers/joss.02645/10.21105.joss.02645.pdf)) | ~8x real time | Similar PK/PD lineage (Pulse forked BioGears 6.1.1) | Less active than Pulse; keep as reference |
| OpenPhysiology / Simbionic | No current public release located in this search | n/a | n/a | Do not plan on them |

**Recommendation.** Run Pulse server-side as the deterministic vitals engine for every live case. Map AcuDx case conditions to Pulse conditions and insults (sepsis, ARDS, hemorrhage, pneumothorax, airway obstruction, asthma attack, acute stress) and map learner orders to Pulse actions (fluids, pressors, opioids, sedatives, bronchodilators, intubation, oxygen). Pulse exposes blood chemistry (pH, pCO2, pO2, bicarbonate, lactate, glucose, electrolytes, haematocrit) which seeds the gas and chemistry panels. For analytes Pulse does not model (troponin, CRP, procalcitonin, creatinine kinetics over days, LFTs, coagulation, cell counts), add a lightweight **lab kinetics layer** (section 5) driven by case onset time and interventions.

---

## 5. Point-of-care test realism

- **VBG vs ABG.** Meta-analyses show venous pH is ~0.03 lower than arterial (Byrne 2014: 18 studies, 1,768 subjects, difference 0.033, 95% CI 0.029 to 0.038) and bicarbonate ~1.2 mEq/L lower (Kelly 2013), while pCO2 agreement is poor (venous-arterial bias limits roughly -10.7 to +2.4 mmHg; 95% LoA up to ±20 mmHg), so venous pCO2 only screens for hypercapnia ([Byrne, Respirology](https://onlinelibrary.wiley.com/doi/10.1111/resp.12225), [Kelly, HKJEM](https://journals.sagepub.com/doi/10.1177/102490791302000307), [Bloom et al. 2013](https://pubmed.ncbi.nlm.nih.gov/23903783/)). Implement: VBG = ABG with pH -0.03 ±0.02, HCO3 -1.2 ±1.5, pCO2 +5 ±6 mmHg, pO2 replaced by venous 35 to 45 mmHg; in shock widen the venoarterial gaps.
- **Troponin kinetics.** hs-cTnI peaks at a median ~8 to 9 h and hs-cTnT ~11 to 12 h after NSTEMI or STEMI/PCI; hs-cTnI falls faster (50% of peak at ~45 h vs ~116 h for hs-cTnT); half-lives across hs assays 12.4 to 17.3 h in STEMI; hs-cTnT may show a second peak around day 4 to 5 ([JALM 2019](https://doi.org/10.1373/jalm.2019.029785), [Clin Chim Acta 2020](https://www.sciencedirect.com/science/article/abs/pii/S0009898120300644), [STEMI kinetics 2023](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10432699/), [second peak](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8841767/)). Early rise means about a third of patients cross rule-out thresholds only ~3 h after onset. Implement a two-phase gamma-like curve per assay (hs-cTnT Elecsys: 99th percentile 14 ng/L; hs-cTnI Architect: 26 ng/L female-specific cutoffs vary) parameterised by infarct size, onset time, reperfusion time; make delta (0/1 h or 0/3 h) consistent with ESC algorithms.
- **Lactate clearance.** Healthy lactate half-life is 15 to 30 min; in sepsis clearance >10% over 2 to 6 h of resuscitation predicts survival; 6-hour lactate level itself predicted 30-day mortality better than percent clearance in a 363-patient cohort (AUC 0.72 vs 0.66) ([Medicine 2021](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7899836/), [Crit Care 2014](https://ccforum.biomedcentral.com/articles/10.1186/cc13362), [J Intensive Care 2016](https://jintensivecare.biomedcentral.com/track/pdf/10.1186/s40560-016-0142-7)). Implement: lactate production term tied to Pulse tissue hypoperfusion, clearance first-order with half-life ~1 to 2 h once perfusion restores, slower in liver failure or ongoing shock; repeat at 2 h and 6 h for the sepsis bundle.

---

## 6. DICOM in the browser

| Component | Role | License |
|---|---|---|
| **Cornerstone3D v5.x** | Rendering, tools, volume loading, segmentation; used by OHIF ([GitHub releases](https://github.com/cornerstonejs/cornerstone3D/releases)) | MIT ([LICENSE](https://github.com/cornerstonejs/cornerstone3D/blob/main/LICENSE)) |
| **OHIF Viewer v3.12.x stable, v3.13 beta (Cornerstone v5, theming, study list)** ([release notes](https://docs.ohif.org/release-notes/), [news](https://ohif.org/news/)) | Zero-footprint full viewer; embeddable via modes/extensions | MIT ([LICENSE](https://github.com/OHIF/Viewers/blob/master/LICENSE)) |
| **dicomParser** | Fast P10 parsing in browser/Node | MIT ([GitHub](https://github.com/cornerstonejs/dicomParser)) |
| **dcmjs** | Read/write DICOM, Part 10 <-> DICOM JSON (DICOMweb), SEG, SR, waveforms ([GitHub](https://github.com/dcmjs-org/dcmjs)) | MIT |
| **static-dicomweb** (RadicalImaging, formerly OHIF static-wado) | `mkdicomweb create` converts DICOM to static QIDO/WADO-RS JSON + frames, served from Nginx or S3; also a small server and SCP ([GitHub](https://github.com/RadicalImaging/static-dicomweb)) | MIT |
| Orthanc + DICOMweb plugin | Full PACS with WADO-RS/QIDO/STOW ([Orthanc](https://www.orthanc-server.com/static.php?page=dicomweb)) | Core GPLv3; DICOMweb plugin AGPLv3 ([Wikipedia](https://en.wikipedia.org/wiki/Orthanc_(server)), [plugin page](https://www.orthanc-server.com/static.php?page=dicomweb)) |
| dcm4chee-arc-light | Enterprise archive | MPL 1.1 / GPL 2 / LGPL 2.1 tri-license per comparison table ([PMC table](https://pmc.ncbi.nlm.nih.gov/articles/PMC10584756/table/Tab3)); verify in repo |

**How to serve series.** AcuDx needs no live PACS. At build time, convert each curated study (real or approved synthetic) to static DICOMweb with `mkdicomweb`, which yields `studies/{uid}/series/{uid}/metadata` JSON and per-frame files that OHIF or a thin Cornerstone3D viewer reads over plain HTTPS from object storage behind a CDN. Patient identity in headers is replaced by the simulated patient's name, MRN and acquisition datetime at conversion (dcmjs can rewrite tags), so the viewer shows the simulated patient, not the dataset donor. Use `ImageComments` or a private tag plus the JSON provenance record for source and license, and a burned-in overlay for synthetic images. The AGPL Orthanc plugin is avoided entirely, which keeps the whole imaging stack MIT.

---

## 7. Recommended AcuDx architecture: result-generation pipeline

```
Learner order (CXR / CT / US / ECG / labs, time t)
        |
        v
[1] Case State Service  (deterministic; seed = case_id + session)
    - Pulse Physiology Engine instance (Apache 2.0): vitals, gases, lactate, glucose, electrolytes
    - Lab Kinetics Layer: troponin, CK, CRP, PCT, WBC, Hb, creatinine, LFTs, coags, D-dimer
      (parametric curves keyed to onset, severity, interventions)
    - Imaging Finding State: structured findings per organ system with severity and laterality
        |
        v
[2] Result Resolver
    - Labs: value + LOINC + UCUM + flag vs reference_ranges.json + realistic TAT delay
    - ECG: template (PTB-XL / MedalCare-XL) selected by finding state -> parametric resample
            to current HR/intervals -> rule edits -> DICOM Waveform -> dcmjs-ecg SVG @25mm/s
    - Imaging: query Image Bank by (modality, view, findings, laterality, age band, sex)
          hit  -> real study (NIH CXR14 / TCIA / MedPix 2.0 / Open-i CC / Commons)
          miss -> pre-rendered approved synthetic (Cheff MIT or RoentGen-v2 offline,
                  laterality-checked, clinician-approved, C2PA-signed, burn-in label)
          none -> "Image unavailable; see report" (never generate live)
        |
        v
[3] Narrative Layer (LLM)
    - Radiology report / ECG read / lab comment written FROM the structured finding state,
      constrained by a schema; the model never invents findings not in state
    - Attribution footer assembled from provenance record
        |
        v
[4] Delivery: static DICOMweb on object storage + CDN -> OHIF / Cornerstone3D (MIT) in the EHR tab
```

**Design rules.**
1. Truth lives in the structured state, not in the image or the LLM. The image is selected to match the state; the narrative is generated from the state; grading compares the learner's interpretation to the state.
2. Everything shipped is MIT, Apache 2.0, CC BY, CC0 or ODC-By. BY-SA items are quarantined to an optional pack. NC-licensed and DUA-gated data never enters the bank.
3. Synthetic is offline, reviewed, labelled, and excluded from scored items.
4. Deterministic seeds guarantee reproducible results for the same case so that educators can review exactly what a learner saw.

**Costs.** All runtime components are free software. Storage: a curated bank of ~5,000 CXR (~0.5 GB as 8-bit JPEG/PNG or ~2 GB as 16-bit DICOM) plus ~300 CT series (~100 to 300 GB raw, ~50 GB after JPEG 2000 lossless in static DICOMweb) is a few dollars per month on object storage plus CDN egress. Synthetic generation is a one-time GPU cost: CXR models run on a 16 to 24 GB GPU; MAISI 512^3 CT needs ~58 GB GPU memory ([NGC](https://catalog.ngc.nvidia.com/orgs/nvidia/monaitoolkit/models/monai_maisi_ct_generative)), so rent an 80 GB instance for a batch job rather than keeping one online. Pulse runs on CPU at real time per patient; one modest VM handles dozens of concurrent sessions. The main cost is clinician review time for curation, which is the right place to spend it.

**Open items.**
- Confirm the MONAI CXR LDM weight license with the maintainers before any use (card has no license field).
- Decide whether a MIMIC-credentialed core developer will run RoentGen-v2 offline; its outputs are described as usable for education but the card gates weights to credentialed users ([HF](https://huggingface.co/stanfordmimi/RoentGen-v2)).
- Ultrasound remains the thinnest real-image modality; Open-i PMC figures and Commons are the main CC sources, and no mature open text-to-US generator was found. Consider a partnership (e.g., with an academic POCUS group) for a CC BY clip library.
- Build and sign the `reference_ranges.json` with a pathologist; keep SI and conventional units.

---

## 15-line summary

1. Big-name CXR corpora (MIMIC-CXR, VinDr-CXR, CheXpert, PadChest, Stanford AIMI, RSNA challenge sets) forbid redistribution; they cannot ship inside AcuDx.
2. License-clean image bank sources: NIH ChestX-ray14 (no restrictions, attribute NIH), TCIA CC BY collections, TotalSegmentator and AMOS22 (CC BY 4.0), MedPix 2.0 on Zenodo (CC BY 4.0), Open-i filtered to CC BY/CC0, Wikimedia Commons.
3. Radiopaedia is CC BY-NC-SA with a no-bulk-download clause: link out, never mirror.
4. ECG: PTB-XL (CC BY 4.0) and MIT-BIH (ODC-By) give real pathology; MedalCare-XL (CC BY 4.0) gives 16,900 simulated 12-leads with MI, LBBB, RBBB, AVB classes; NeuroKit2 (MIT) handles rate/interval resampling.
5. Render ECGs with dcmjs-ecg (MIT) at 25 mm/s and set amplitude to 10 mm/mV; store as DICOM Waveform.
6. Synthetic CXR: Cheff (MIT) is the most permissive open generator; RoentGen-v2 weights are gated to MIMIC-credentialed users; RadEdit is research-only (MSRLA); MedSyn is CC BY-NC; MAISI-v2 CT is Apache code with NVIDIA NCLS weights and needs ~58 GB GPU.
7. Radiology 2026 (Tordjman): radiologists spotted synthetic radiographs only 41% unprompted and ~75% when warned; flaws include too-smooth bones, straight spines, symmetrical lungs and mis-sided clean fractures.
8. Use synthetic only offline, laterality-checked and clinician-approved, with a visible burn-in label, a database flag and a C2PA manifest (c2pa-rs, MIT/Apache) using digitalSourceType trainedAlgorithmicMedia; keep synthetic out of scored items.
9. Labs: code with LOINC (free, redistributable with notice) and UCUM (royalty-free v1.1 license); author an in-house signed reference_ranges.json seeded from NBME and CALIPER tables.
10. Pulse Physiology Engine (Apache 2.0) runs in real time with PBPK/PD for 17 drugs including pressors, opioids, sedatives, paralytics and bronchodilators; it supplies gases, lactate and electrolytes and reacts to fluids and pressors.
11. Add a parametric lab kinetics layer for troponin (hs-cTnI peak ~8 h, hs-cTnT ~11 h, half-lives 12 to 17 h), CRP, PCT, creatinine and others that Pulse does not model.
12. VBG realism: venous pH about 0.03 lower, HCO3 about 1.2 lower, pCO2 unreliable (LoA up to ±20 mmHg); lactate clearance >10% at 2 to 6 h is the resuscitation target.
13. Synthea (Apache 2.0) and the Coherent dataset (CC BY 4.0) populate background history; do not trust Synthea module lab ranges for acute values.
14. Viewer stack is fully MIT: Cornerstone3D v5, OHIF v3.12/3.13, dicomParser, dcmjs, static-dicomweb served from object storage plus CDN; avoid the AGPL Orthanc DICOMweb plugin.
15. Architecture: deterministic case state (Pulse + kinetics + structured findings) selects a real image, falls back to approved synthetic, and an LLM writes the report only from the structured state; all runtime software is free, the real cost is clinician curation.
