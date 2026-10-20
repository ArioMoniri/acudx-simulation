"""Deterministic draft normalisation between the author (or repair) and the council.

The first live run on the GPU worker (Qwen3-14B-AWQ, 2026-10-20) produced drafts
that were medically reasonable but structurally incomplete: every treatment had
``code: ""``, IV fluid effects started after 1 to 2 *seconds*, and ``labs``,
``imaging`` and ``red_flags`` were empty. Each of those used to cost a 60 to 110 s
repair round and still ended ``degraded``. This module fixes what code can fix,
before any judge runs, and records every change:

* **Treatment codes.** Every treatment is resolved to a catalogue code: the
  condition's own fixture or system-profile codes (``case_generator._resolve_fixture``,
  the vocabulary the judges and the Director use) first, then the web treatment
  catalogue (``web/src/domain/treatments.ts``, mirrored in :data:`WEB_TREATMENT_CATALOG`),
  then any code that exists in another fixture. A label maps by token overlap or by
  treatment class. A ``neutral`` item that maps to nothing (for example "NPO") is
  dropped with a note; an indicated or contraindicated item that maps to nothing
  keeps ``code: ""`` and fails the safety judge deterministically (a veto, so it
  is repaired).
* **Effect onsets and magnitudes** are clamped to :data:`TREATMENT_CLASSES`, a
  per-class table of plausible onset windows, allowed vital keys and largest
  delta, with the source of each row. The safety judge flags any effect outside
  the table (``implausible_effects``).
* **Gap fill.** Empty ``labs``, ``imaging``, ``red_flags``, ``exam``,
  ``vitals_trajectory`` and a missing contraindicated distractor are filled from
  the condition fixture (the same data the deterministic template uses); a
  ``red-flags`` HPI answer that reports a positive finding is marked
  ``red_flag``. Every filled field is listed in ``meta.gap_filled``.
* **Lab units.** A lab whose LOINC code is in ``server/results/reference_ranges.json``
  takes the table's UCUM unit when the authored unit is equivalent, and its
  missing reference interval; a non-equivalent unit is left for the consistency
  judge to reject (``lab_unit``).

Nothing here invents clinical content: every filled value comes from a reviewed
fixture or reference table.
"""

from __future__ import annotations

import random
import re
from functools import lru_cache
from typing import Any, Optional

from server import case_fixtures
from server import case_generator as CG

# --------------------------------------------------------------------------- #
# Web treatment catalogue (mirror of web/src/domain/treatments.ts)            #
# --------------------------------------------------------------------------- #
# (code, label_en, label_tr, generic class). test_case_quality parses the TS
# file and fails when the two drift apart.
WEB_TREATMENT_CATALOG: tuple[tuple[str, str, str, Optional[str]], ...] = (
    ("7806", "Oxygen", "Oksijen", "oxygen"),
    ("313002", "IV fluid bolus (NS / RL)", "İ.V. sıvı bolusu (SF / RL)", "fluids"),
    ("1191", "Aspirin", "Aspirin", "antiplatelet"),
    ("4917", "Nitroglycerin (GTN)", "Nitrogliserin (GTN)", "nitrate"),
    ("7052", "Morphine", "Morfin", "opioid"),
    ("2193", "Ceftriaxone", "Seftriakson", "antibiotic"),
    ("435", "Salbutamol nebuliser", "Salbutamol nebül", "bronchodilator"),
    ("448", "Adenosine", "Adenozin", "antiarrhythmic"),
    ("5856", "Insulin infusion (fixed rate)", "İnsülin infüzyonu (sabit hız)", "insulin"),
    ("7242", "Naloxone", "Nalokson", "naloxone"),
    ("6470", "Lorazepam", "Lorazepam", "benzodiazepine"),
    ("161", "Paracetamol", "Parasetamol", "antipyretic"),
    ("26225", "Ondansetron", "Ondansetron", "antiemetic"),
    ("3992-im", "Adrenaline IM 0.5 mg (anaphylaxis)", "Adrenalin İ.M. 0.5 mg (anafilaksi)", "adrenaline_im"),
    ("3992", "Adrenaline IV (arrest / refractory anaphylaxis infusion)",
     "Adrenalin İ.V. (arrest / dirençli anafilaksi infüzyonu)", "vasopressor"),
    ("8410", "Alteplase (thrombolysis)", "Alteplaz (tromboliz)", "thrombolytic"),
)
WEB_CODES: frozenset[str] = frozenset(c for c, *_ in WEB_TREATMENT_CATALOG)

# --------------------------------------------------------------------------- #
# Treatment classes: keywords, plausible onset window, allowed effects        #
# --------------------------------------------------------------------------- #
_MIN = 60_000
_H = 3_600_000

# name -> {keywords, onset (min_ms, max_ms), caps {vital: largest |delta|}, source}
# ``caps`` empty means the class moves no tracked vital inside a session.
TREATMENT_CLASSES: dict[str, dict[str, Any]] = {
    "oxygen": {
        "keywords": ("oxygen", "o2", "nasal cannula", "non rebreather", "nonrebreather", "venturi", "high flow",
                     "hfnc", "niv", "cpap", "bipap", "non invasive ventilation", "oksijen"),
        "onset": (1 * _MIN, 15 * _MIN), "caps": {"spo2": 8, "rr": 4, "hr": 6},
        "source": "BTS 2017 emergency oxygen guideline, recheck SpO2 minutes after a change "
                  "https://doi.org/10.1136/thoraxjnl-2016-209729",
    },
    "fluids": {
        "keywords": ("fluid", "fluids", "saline", "crystalloid", "ringer", "hartmann", "bolus", "sıvı", "serum fizyolojik"),
        "onset": (5 * _MIN, 30 * _MIN), "caps": {"systolic": 20, "diastolic": 12, "hr": 15},
        "source": "NICE CG174: 500 mL crystalloid bolus over less than 15 minutes, then reassess "
                  "https://www.nice.org.uk/guidance/cg174 ; SSC adult guidelines "
                  "https://www.sccm.org/SurvivingSepsisCampaign/Guidelines",
    },
    "antipyretic": {
        "keywords": ("paracetamol", "acetaminophen", "antipyretic", "parasetamol"),
        "onset": (30 * _MIN, 2 * _H), "caps": {"tempC": 1.5, "pain": 3, "hr": 8},
        "source": "OFIRMEV label section 14.2: antipyretic effect measured over a 6-hour study "
                  "https://www.accessdata.fda.gov/drugsatfda_docs/label/2010/022450lbl.pdf",
    },
    "antibiotic": {
        "keywords": ("antibiotic", "antibiotics", "antimicrobial", "abx", "vancomycin", "piperacillin", "tazobactam",
                     "ceftriaxone", "cefotaxime", "meropenem", "amoxicillin", "co amoxiclav", "gentamicin",
                     "clarithromycin", "azithromycin", "doxycycline", "ciprofloxacin", "levofloxacin", "metronidazole",
                     "antibiyotik"),
        "onset": (6 * _H, 72 * _H), "caps": {},
        "source": "Halm et al. JAMA 1998: median time to clinical stability in CAP is days "
                  "https://jamanetwork.com/journals/jama/fullarticle/187516",
    },
    "opioid": {
        "keywords": ("morphine", "fentanyl", "opioid", "oxycodone", "hydromorphone", "diamorphine", "morfin"),
        "onset": (2 * _MIN, 20 * _MIN), "caps": {"pain": 4, "hr": 10, "rr": 4, "spo2": 3},
        "source": "AcuDx generic class table web/src/domain/treatments.ts (review 02 finding 36)",
    },
    "analgesia": {
        "keywords": ("analgesia", "analgesic", "nsaid", "ibuprofen", "ketorolac", "diclofenac", "analjezi"),
        "onset": (5 * _MIN, 60 * _MIN), "caps": {"pain": 4, "hr": 8},
        "source": "AcuDx generic class table web/src/domain/treatments.ts; case_generator system profiles",
    },
    "nitrate": {
        "keywords": ("gtn", "nitroglycerin", "nitroglycerine", "nitrate", "glyceryl trinitrate", "nitrat"),
        "onset": (1 * _MIN, 10 * _MIN), "caps": {"systolic": 20, "diastolic": 10, "pain": 3, "hr": 10},
        "source": "ACCF/AHA 2013 STEMI guideline https://www.ahajournals.org/doi/10.1161/CIR.0b013e3182742cf6",
    },
    "bronchodilator": {
        "keywords": ("salbutamol", "albuterol", "nebuliser", "nebulizer", "nebulised", "nebulized", "nebulisers",
                     "ipratropium", "bronchodilator", "nebül", "bronkodilatör"),
        "onset": (2 * _MIN, 20 * _MIN), "caps": {"rr": 6, "spo2": 5, "hr": 15},
        "source": "BTS/SIGN 2019 asthma guideline "
                  "https://www.brit-thoracic.org.uk/document-library/guidelines/asthma/btssign-guideline-for-the-management-of-asthma-2019/",
    },
    "adrenaline_im": {
        "keywords": ("adrenaline im", "epinephrine im", "intramuscular adrenaline", "intramuscular epinephrine",
                     "adrenalin im"),
        "onset": (3 * _MIN, 15 * _MIN), "caps": {"systolic": 30, "diastolic": 15, "spo2": 6, "rr": 6, "hr": 20},
        "source": "Resuscitation Council UK 2021 anaphylaxis (repeat IM dose after 5 minutes) "
                  "https://www.resus.org.uk/library/additional-guidance/guidance-anaphylaxis/emergency-treatment",
    },
    "vasopressor": {
        "keywords": ("noradrenaline", "norepinephrine", "vasopressor", "vasopressin", "adrenaline infusion",
                     "adrenaline iv", "epinephrine infusion", "phenylephrine", "vazopresör"),
        "onset": (1 * _MIN, 15 * _MIN), "caps": {"systolic": 40, "diastolic": 20, "hr": 25},
        "source": "SSC adult guidelines (vasopressors for MAP 65 mmHg) "
                  "https://www.sccm.org/SurvivingSepsisCampaign/Guidelines",
    },
    "benzodiazepine": {
        "keywords": ("lorazepam", "diazepam", "midazolam", "benzodiazepine", "benzodiazepin"),
        "onset": (1 * _MIN, 15 * _MIN), "caps": {"hr": 15, "rr": 4, "systolic": 15, "diastolic": 10},
        "source": "AcuDx generic class table web/src/domain/treatments.ts",
    },
    "rhythm": {
        "keywords": ("cardioversion", "cardiovert", "defibrillation", "defibrillate", "defib", "adenosine",
                     "vagal", "pacing", "kardiyoversiyon", "defibrilasyon", "adenozin"),
        "onset": (10_000, 5 * _MIN), "caps": {"hr": 100, "systolic": 40, "diastolic": 20, "spo2": 10, "rr": 6},
        "source": "AHA 2020 adult ACLS (tachycardia algorithm: adenosine, synchronised cardioversion) "
                  "https://www.ahajournals.org/doi/10.1161/CIR.0000000000000916",
    },
    "procedure": {
        "keywords": ("ercp", "pci", "drainage", "surgery", "surgical", "theatre", "laparotomy", "laparoscopic",
                     "cholecystectomy", "appendicectomy", "appendectomy", "thrombectomy", "decompression",
                     "needle", "chest drain", "pericardiocentesis", "reduction", "drenaj", "cerrahi"),
        "onset": (1 * _MIN, 3 * _H), "caps": {"pain": 4, "systolic": 30, "diastolic": 15, "hr": 25, "rr": 8,
                                              "spo2": 10},
        "source": "ESC 2023 ACS (reperfusion pain relief ~90 min after PCI activation) "
                  "https://doi.org/10.1093/eurheartj/ehad191",
    },
}

# Any effect, whatever its class, takes at least this long (a bolus is not
# infused, a drug is not absorbed, in seconds).
MIN_ONSET_MS = 10_000

_TOKEN = re.compile(r"[a-z0-9çğıöşü]+")
_STOP = frozenset({
    "iv", "po", "im", "sc", "sl", "for", "with", "and", "the", "of", "to", "in", "a", "an", "if", "as", "per",
    "mg", "ml", "g", "l", "kg", "units", "dose", "start", "give", "administer", "needed", "via", "plus", "or",
    "ve", "ile", "için",
})


# Items that are investigations or monitoring, not therapy: never the target of a
# class match ("Blood cultures before antibiotics" is not an antibiotic).
_INVESTIGATION = frozenset({
    "culture", "cultures", "test", "check", "monitoring", "serial", "ecg", "assessment", "observations", "obs",
    "document", "screen", "exclude", "kültür", "kültürü", "test",
})


def _tokens(text: str) -> set[str]:
    return {t for t in _TOKEN.findall((text or "").lower().replace("_", " ")) if t not in _STOP and len(t) > 1}


def _phrase_in(phrase: str, text: str) -> bool:
    hay = " " + " ".join(_TOKEN.findall((text or "").lower().replace("_", " "))) + " "
    return (" " + " ".join(_TOKEN.findall(phrase.lower())) + " ") in hay


def classify_treatment(text: str) -> list[str]:
    """Treatment classes named in a label or code (several for combined items)."""
    out = [name for name, row in TREATMENT_CLASSES.items() if any(_phrase_in(k, text) for k in row["keywords"])]
    # Intramuscular adrenaline is its own class; a bare "adrenaline" is the IV pressor.
    if "adrenaline_im" in out and "vasopressor" in out:
        out.remove("vasopressor")
    if not out and (_phrase_in("adrenaline", text) or _phrase_in("epinephrine", text)):
        out.append("vasopressor")
    return out


def _treatment_text(t: dict[str, Any]) -> str:
    return " ".join(str(t.get(k) or "") for k in ("label_en", "label_tr", "code"))


# --------------------------------------------------------------------------- #
# Vocabulary                                                                   #
# --------------------------------------------------------------------------- #
def condition_treatments(cond: dict[str, Any]) -> list[dict[str, Any]]:
    """The condition's fixture (or system-profile) treatments in spec shape."""
    return CG._treatments(CG._resolve_fixture(cond))


@lru_cache(maxsize=1)
def all_fixture_codes() -> frozenset[str]:
    codes: set[str] = set()
    for fx in case_fixtures.CONDITION_FIXTURES.values():
        codes.update(t[0] for t in fx.get("treatments", []))
    for prof in CG._PROFILES.values():
        codes.update(t[0] for t in prof.get("treatments", []))
    return frozenset(codes)


def known_treatment_code(code: str) -> bool:
    return bool(code) and (code in WEB_CODES or code in all_fixture_codes())


def resolve_treatment_code(t: dict[str, Any], vocab: list[dict[str, Any]]) -> Optional[str]:
    """Catalogue code for one authored treatment, or None when nothing fits."""
    code = str(t.get("code") or "").strip()
    vocab_codes = {v["code"] for v in vocab}
    if code and (code in vocab_codes or known_treatment_code(code)):
        return code
    text = _treatment_text(t)
    toks = _tokens(f"{t.get('label_en') or ''} {code}")
    appr = str(t.get("appropriateness") or "neutral")
    # 1. Token overlap with the condition's own items.
    best, best_score = None, 0.0
    for v in vocab:
        vt = _tokens(f"{v['label_en']} {v['code']}")
        if not toks or not vt:
            continue
        score = len(toks & vt) / len(toks | vt)
        if v["appropriateness"] == appr:
            score += 0.05
        if score > best_score:
            best, best_score = v["code"], score
    if best is not None and best_score >= 0.5:
        return best
    # 2. Same treatment class and the same appropriateness in the condition vocabulary.
    classes = classify_treatment(text)
    if classes:
        for v in vocab:
            if v["appropriateness"] == appr and not (_tokens(_treatment_text(v)) & _INVESTIGATION) \
                    and set(classify_treatment(_treatment_text(v))) & set(classes):
                return v["code"]
        # 3. The web catalogue entry of that class. Not for a contraindicated
        # item: "Delay antibiotics" must not become the code for ceftriaxone.
        if appr != "contraindicated":
            for wcode, _en, _tr, wcls in WEB_TREATMENT_CATALOG:
                if wcls in classes:
                    return wcode
    if appr == "contraindicated":
        return None
    # 4. Exact web label (for example "Ondansetron").
    for wcode, en, _tr, _cls in WEB_TREATMENT_CATALOG:
        if _tokens(en) and _tokens(en) <= toks:
            return wcode
    return None


# --------------------------------------------------------------------------- #
# Effect plausibility                                                          #
# --------------------------------------------------------------------------- #
def effect_problems(t: dict[str, Any]) -> list[str]:
    """Human-readable reasons why a treatment's effects are implausible (empty when fine)."""
    classes = classify_treatment(_treatment_text(t))
    label = t.get("code") or t.get("label_en") or "?"
    out: list[str] = []
    for eff in t.get("effects") or []:
        key = str(eff.get("key") or "")
        try:
            onset = float(eff.get("onsetMs", 0))
            delta = abs(float(eff.get("delta", 0)))
        except (TypeError, ValueError):
            out.append(f"treatment {label}: non-numeric effect")
            continue
        if onset < MIN_ONSET_MS:
            out.append(f"treatment {label}: effect {key} onset {int(onset)} ms is implausibly fast "
                       f"(minimum {MIN_ONSET_MS} ms)")
            continue
        if not classes:
            continue
        rows = [TREATMENT_CLASSES[c] for c in classes]
        allowing = [r for r in rows if key in r["caps"]]
        if not allowing:
            out.append(f"treatment {label}: a {'/'.join(classes)} treatment does not move {key} within a session")
            continue
        if not any(r["onset"][0] <= onset <= r["onset"][1] for r in allowing):
            lo = min(r["onset"][0] for r in allowing)
            hi = max(r["onset"][1] for r in allowing)
            out.append(f"treatment {label}: effect {key} onset {int(onset)} ms outside {lo}-{hi} ms "
                       f"for {'/'.join(classes)}")
        cap = max(r["caps"][key] for r in allowing)
        if delta > cap:
            out.append(f"treatment {label}: effect {key} delta {delta:g} exceeds {cap:g} for {'/'.join(classes)}")
    return out


def clamp_effects(t: dict[str, Any]) -> list[str]:
    """Clamp a treatment's effects in place to its class table. Returns notes."""
    classes = classify_treatment(_treatment_text(t))
    label = t.get("code") or t.get("label_en") or "?"
    notes: list[str] = []
    kept: list[dict[str, Any]] = []
    for eff in t.get("effects") or []:
        key = str(eff.get("key") or "")
        try:
            onset = float(eff.get("onsetMs", 0))
            delta = float(eff.get("delta", 0))
        except (TypeError, ValueError):
            notes.append(f"{label}: dropped non-numeric effect {key}")
            continue
        new_onset, new_delta = max(onset, MIN_ONSET_MS), delta
        if classes:
            allowing = [TREATMENT_CLASSES[c] for c in classes if key in TREATMENT_CLASSES[c]["caps"]]
            if not allowing:
                notes.append(f"{label}: dropped {key} effect ({'/'.join(classes)} does not move it in a session)")
                continue
            if not any(r["onset"][0] <= new_onset <= r["onset"][1] for r in allowing):
                lo = min(r["onset"][0] for r in allowing)
                hi = max(r["onset"][1] for r in allowing)
                new_onset = min(max(new_onset, lo), hi)
            cap = max(r["caps"][key] for r in allowing)
            if abs(new_delta) > cap:
                new_delta = cap if new_delta > 0 else -cap
        if new_onset != onset or new_delta != delta:
            notes.append(f"{label}: effect {key} {delta:g}@{int(onset)}ms clamped to {new_delta:g}@{int(new_onset)}ms")
        kept.append({**eff, "key": key, "delta": new_delta, "onsetMs": int(new_onset)})
    t["effects"] = kept
    return notes


# --------------------------------------------------------------------------- #
# Labs                                                                         #
# --------------------------------------------------------------------------- #
def _canon_unit(u: Any) -> str:
    s = str(u or "").strip().lower().replace(" ", "").replace("^", "*").replace("×", "x")
    s = s.replace("x10*", "10*").replace("mmhg", "mm[hg]").replace("μ", "u").replace("µ", "u")
    return {"ng/ml": "ug/l", "iu/l": "u/l", "miu/l": "m[iu]/l", "/hpf": "/[hpf]"}.get(s, s)


_DIMENSIONLESS = frozenset({"", "[ph]", "{ratio}", "ratio", "ph"})


def unit_matches(authored: Any, reference: Any) -> bool:
    a, r = _canon_unit(authored), _canon_unit(reference)
    return a == r or (a in _DIMENSIONLESS and r in _DIMENSIONLESS)


# (LOINC, authored unit canon) -> factor to the reference-table unit. Standard
# SI to conventional conversion factors (molar masses: glucose 180.16 g/mol,
# creatinine 113.12, bilirubin 584.7, calcium 40.08, magnesium 24.31,
# phosphorus 30.97, lactate 90.08), as in the NBME table that
# reference_ranges.json transcribes https://www.nbme.org/laboratory-values/
UNIT_CONVERSIONS: dict[tuple[str, str], float] = {
    ("2345-7", "mmol/l"): 18.016,
    ("21198-7", "u/l"): 1.0,          # 1 IU/L = 1 mIU/mL

    ("2160-0", "umol/l"): 1 / 88.42,
    ("1975-2", "umol/l"): 1 / 17.1,
    ("1968-7", "umol/l"): 1 / 17.1,
    ("17861-6", "mmol/l"): 4.008,
    ("19123-9", "mmol/l"): 2.431,
    ("2777-1", "mmol/l"): 3.097,
    ("2524-7", "mg/dl"): 1 / 9.008,
    ("718-7", "g/l"): 0.1,
    ("1751-7", "g/l"): 0.1,
    ("2885-2", "g/l"): 0.1,
    ("1988-5", "mg/dl"): 10.0,
    ("67151-1", "ug/l"): 1000.0,
    ("89579-7", "ug/l"): 1000.0,
    ("48065-7", "mg/l"): 1000.0,
}


def _convert(value: Any, factor: float, decimals: int) -> Any:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        try:
            value = float(value)
        except (TypeError, ValueError):
            return value
    return round(float(value) * factor, decimals)


def _ranges() -> dict[str, Any]:
    from server.results.engine import load_ranges

    return load_ranges()["_by_loinc"]


def _lab_code_by_label(label: str) -> Optional[str]:
    low = (label or "").strip().lower()
    if not low:
        return None
    # Exact name or abbreviation only: "Carboxyhaemoglobin" is not "Haemoglobin"
    # and "Free T4" is not "Thyroxine (T4), total".
    for code, a in _ranges().items():
        name = str(a.get("name") or "").lower()
        short = str(a.get("short") or "").lower()
        if low == name or (short and low == short) or low == name.split(",")[0].split(" (")[0]:
            return code
    return None


def normalize_labs(labs: list[dict[str, Any]], sex: str, age: int) -> list[str]:
    from server.results.engine import reference_range

    notes: list[str] = []
    ranges = _ranges()
    for lab in labs:
        code = str(lab.get("code") or "").strip()
        if not code:   # an authored code (even one outside the table) is never replaced
            mapped = _lab_code_by_label(str(lab.get("label_en") or ""))
            if mapped:
                lab["code"] = code = mapped
                notes.append(f"lab {lab.get('label_en')}: code set to {mapped}")
        a = ranges.get(code)
        if a is None or a.get("qualitative"):
            continue
        ref_unit = a.get("unit") or ""
        factor = UNIT_CONVERSIONS.get((code, _canon_unit(lab.get("unit"))))
        if not lab.get("unit"):
            lab["unit"] = ref_unit
            notes.append(f"lab {code}: unit set to {ref_unit}")
        elif unit_matches(lab["unit"], ref_unit) and lab["unit"] != ref_unit:
            lab["unit"] = ref_unit
        elif factor is not None:
            dec = int(a.get("decimals", 1) or 0)
            old = f"{lab.get('value')} {lab.get('unit')}"
            for k in ("value", "ref_low", "ref_high"):
                if lab.get(k) is not None:
                    lab[k] = _convert(lab[k], factor, dec)
            lab["unit"] = ref_unit
            notes.append(f"lab {code}: {old} converted to {lab['value']} {ref_unit}")
        if lab.get("ref_low") is None or lab.get("ref_high") is None:
            rr = reference_range(code, sex, age)
            if rr is not None and unit_matches(lab.get("unit"), ref_unit):
                lab["ref_low"], lab["ref_high"] = rr["low"], rr["high"]
                notes.append(f"lab {code}: reference interval from reference_ranges.json")
    return notes


def lab_unit_problems(labs: list[dict[str, Any]]) -> list[str]:
    ranges = _ranges()
    out: list[str] = []
    for lab in labs or []:
        a = ranges.get(str(lab.get("code") or ""))
        if a is None or a.get("qualitative") or not lab.get("unit"):
            continue
        if not unit_matches(lab["unit"], a.get("unit")):
            out.append(f"lab {lab.get('code')}: unit {lab['unit']!r} does not match reference unit "
                       f"{a.get('unit')!r} (rule:lab_unit)")
    return out


# --------------------------------------------------------------------------- #
# The normaliser                                                               #
# --------------------------------------------------------------------------- #
_NEGATED = re.compile(r"^\s*(no|none|denies|denied|nil|not|negative|yok|hayır)\b", re.I)


def normalize_draft(draft: dict[str, Any], cond: dict[str, Any], *, seed: int) -> dict[str, Any]:
    """Normalise ``draft`` in place. Returns ``{gap_filled, notes, unresolved_codes}``."""
    gap: list[str] = []
    notes: list[str] = []
    rng = random.Random((int(seed) ^ 0x6A09E667) & 0x7FFFFFFF)
    prof = CG._resolve_fixture(cond)
    demo = draft.get("demographics") or {}
    sex = str(demo.get("sex") or "female")
    try:
        age = int(demo.get("age") or 45)
    except (TypeError, ValueError):
        age = 45
    vocab = condition_treatments(cond)

    # -- treatments ----------------------------------------------------------- #
    treatments = [dict(t) for t in (draft.get("treatments") or []) if isinstance(t, dict)]
    if not treatments:
        treatments = [dict(t) for t in vocab]
        gap.append("treatments")
    resolved: list[dict[str, Any]] = []
    unresolved: list[str] = []
    seen: set[str] = set()
    for t in treatments:
        code = resolve_treatment_code(t, vocab)
        before = str(t.get("code") or "")
        if code is None:
            if str(t.get("appropriateness") or "neutral") == "neutral":
                notes.append(f"dropped uncoded neutral treatment {t.get('label_en')!r}")
                continue
            unresolved.append(str(t.get("label_en") or before or "?"))
            t["code"] = ""
            resolved.append(t)
            continue
        if code != before:
            notes.append(f"treatment {t.get('label_en')!r}: code {before!r} -> {code!r}")
        if code in seen:
            notes.append(f"merged duplicate treatment {t.get('label_en')!r} into {code}")
            continue
        seen.add(code)
        t["code"] = code
        t["effects"] = [dict(e) for e in (t.get("effects") or []) if isinstance(e, dict)]
        resolved.append(t)
    for t in resolved:
        notes.extend(clamp_effects(t))
    appr = [str(t.get("appropriateness") or "neutral") for t in resolved]
    for want in ("indicated", "contraindicated"):
        if want not in appr:
            extra = [dict(v) for v in vocab if v["appropriateness"] == want and v["code"] not in seen]
            if extra:
                resolved.extend(extra)
                seen.update(v["code"] for v in extra)
                gap.append(f"treatments.{want}")
    if "treatments" in gap:
        gap = [g for g in gap if not g.startswith("treatments.")]
    draft["treatments"] = resolved

    # -- labs, imaging, red flags, exam, trajectory --------------------------- #
    if not draft.get("labs"):
        draft["labs"] = CG._labs(prof, rng, sex)
        gap.append("labs")
    notes.extend(normalize_labs(draft["labs"], sex, age))
    if not draft.get("imaging"):
        draft["imaging"] = CG._imaging(prof)
        gap.append("imaging")
    if not draft.get("red_flags"):
        flags = CG._red_flags(cond)
        if flags:
            draft["red_flags"] = flags
            gap.append("red_flags")
    if not draft.get("exam"):
        draft["exam"] = CG._exam(cond, prof, rng)
        gap.append("exam")
    traj = draft.get("vitals_trajectory") or []
    triage = draft.get("triage_vitals") or {}
    if len(traj) < 2 and all(k in triage for k in ("hr", "systolic", "diastolic", "rr", "spo2", "tempC")):
        try:
            tv = {k: (float(triage[k]) if k == "tempC" else int(float(triage[k]))) for k in
                  ("hr", "systolic", "diastolic", "rr", "spo2", "tempC")}
            acuity = int(draft.get("acuity_esi") or cond.get("typical_acuity") or 3)
            draft["vitals_trajectory"] = CG._trajectory(tv, acuity, cond)
            gap.append("vitals_trajectory")
        except (TypeError, ValueError):
            pass

    # -- hpi red flag --------------------------------------------------------- #
    hpi = draft.get("hpi") or []
    if cond.get("red_flags") and hpi and not any(bool(h.get("red_flag")) for h in hpi):
        for h in hpi:
            if str(h.get("intent") or "") == "red-flags" and str(h.get("answer_en") or "").strip() \
                    and not _NEGATED.match(str(h.get("answer_en") or "")):
                h["red_flag"] = True
                gap.append("hpi.red_flag")
                break

    return {"gap_filled": gap, "notes": notes, "unresolved_codes": unresolved}


__all__ = [
    "MIN_ONSET_MS", "TREATMENT_CLASSES", "WEB_CODES", "WEB_TREATMENT_CATALOG", "all_fixture_codes",
    "clamp_effects", "classify_treatment", "condition_treatments", "effect_problems", "known_treatment_code",
    "lab_unit_problems", "normalize_draft", "normalize_labs", "resolve_treatment_code", "unit_matches",
]
