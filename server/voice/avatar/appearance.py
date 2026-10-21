"""How the patient looks and sounds right now, from the server's case state only.

The live call shows one patient story: the face on the video, the voice, the vitals on the monitor
and the lab results all come from the same case thread. This module turns that thread (the case
spec the Director was built from, plus the Director's current state and course snapshot) into a
:class:`Look`, a small set of visible signs with a level each (1 mild, 2 marked):

* signs the case text states (exam findings, triage note, chief complaint, history answers):
  diaphoresis, jaundice, cyanosis, pallor, mottling, accessory muscle use; a cough only shapes the
  voice;
* signs the live state shows (Director vitals and bedside snapshot): fever flush from the
  temperature, breathlessness from the respiratory rate and SpO2, cyanosis from SpO2 under 85,
  pallor and mottling from the skin and perfusion, pain from the pain score, drowsiness and
  unresponsiveness from consciousness, GCS and the arrest state.

Nothing else is ever added: a sign without evidence in the thread is not drawn. The image generator
receives an edit instruction that keeps the person (identity, framing, lighting) and lists only
these changes (:func:`edit_prompt`). A ladder of 3 to 5 looks is prepared at call start (improved,
presenting, worse, critical, and unresponsive for ESI 1 and 2), and :func:`choose_variant` picks
the prepared picture that matches the live look without showing any sign the patient does not
have now (a picture's signs are a subset of the live signs, at the same or a lower level); the
exact look is generated in the background when it is missing.

Education only; synthetic patients.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any

SIGN_ORDER = ("fever_flush", "diaphoresis", "pallor", "mottling", "cyanosis", "jaundice", "resp_distress",
              "accessory_muscles", "pain", "drowsy", "unresponsive",
              # Findings a case states on the face or neck (2026-10-21, owner list). Appended, so the
              # keys of looks made before stay the same.
              "petechiae", "purpura", "urticaria", "scleral_icterus", "flushing", "periorbital_oedema",
              "facial_droop", "facial_swelling", "dehydration", "wound", "burn")
# Rashes and skin lesions: the "clear, uniform skin" instruction is dropped when one of these is drawn.
SKIN_LESIONS = ("mottling", "petechiae", "purpura", "urticaria", "wound", "burn")
# Signs the live state can change from one Director step to the next (the ladder varies these);
# the others are findings the case text states and stay until the patient improves.
LIVE_SIGNS = ("fever_flush", "resp_distress", "accessory_muscles", "pain", "drowsy", "pallor", "mottling", "cyanosis")

_TEXT_EVIDENCE: dict[str, re.Pattern[str]] = {
    "diaphoresis": re.compile(r"diaphore|sweat|clammy|terl|ter içinde|soğuk ter", re.I),
    "jaundice": re.compile(r"jaundic|icter|yellow(?:ish)?\s+(?:skin|sclera|eyes)|sarılık|ikter", re.I),
    # Only central cyanosis shows on a face; "cyanosis around the nail beds" is peripheral.
    "cyanosis": re.compile(r"(?:central|perioral|circumoral)\s+cyano|cyano\w*\s+(?:\w+\s+){0,3}(?:lips?|mouth|face)|"
                           r"blue lips|bluish lips|dudaklarda morarma|santral siyanoz", re.I),
    "pallor": re.compile(r"\bpale\b|pallor|soluk", re.I),
    "mottling": re.compile(r"mottl|livedo|alacalı", re.I),
    "accessory_muscles": re.compile(r"accessory muscle|intercostal|subcostal|recession|retraction|tripod|"
                                    r"yardımcı solunum kas", re.I),
    "resp_distress": re.compile(r"respiratory distress|short(?:ness)? of breath|breathless|dyspn|tachypn|"
                                r"difficulty breathing|laboured breathing|labored breathing|nefes darlığı|takipne", re.I),
    "petechiae": re.compile(r"petechia|peteşi", re.I),
    # Meningococcal and other non-blanching purpuric rashes.
    "purpura": re.compile(r"purpur|non-?blanching (?:rash|spots|lesions)|solmayan döküntü|purpura", re.I),
    "urticaria": re.compile(r"urticari|hives|wheals|ürtiker|kurdeşen", re.I),
    "scleral_icterus": re.compile(r"scleral icterus|icteric sclera|yellow sclera|skleral ikter|skleralar? sarı", re.I),
    # Non-febrile flushing (anaphylaxis, carcinoid, niacin); a fever flush comes from the temperature.
    "flushing": re.compile(r"\bflush(?:ed|ing)\b|yüz kızarması|yüzde kızarıklık", re.I),
    "periorbital_oedema": re.compile(r"periorbital (?:o?edema|swelling|puffiness)|puffy eyelids|swollen eyelids|"
                                     r"göz çevresinde ödem|periorbital ödem", re.I),
    "facial_droop": re.compile(r"facial droop|drooping of the (?:face|mouth)|mouth droop|facial (?:palsy|weakness)|"
                               r"asymmetric smile|yüzde kayma|ağız kenarında düşüklük|fasiyal paralizi", re.I),
    "facial_swelling": re.compile(r"(?:facial|lip|tongue|face|lips) (?:swelling|o?edema)|swollen (?:face|lips?|tongue)|"
                                  r"angio-?o?edema|anjiyoödem|dudaklarda şişlik|yüzde şişlik", re.I),
    "dehydration": re.compile(r"dehydrat|dry (?:mucous membranes|mucosa|lips)|sunken eyes|dry mouth|"
                              r"dehidrat|ağız kuruluğu|çökük göz", re.I),
    # Wounds and burns are drawn only where a head-and-shoulders portrait shows them.
    "wound": re.compile(r"(?:lacerat\w*|abrasion|wound|cut|graze|bruis\w*|hematoma|haematoma)\s+(?:\w+\s+){0,4}"
                        r"(?:forehead|scalp|face|cheek|chin|brow|eyebrow|temple|lip|nose|neck)|"
                        r"(?:forehead|scalp|facial|cheek|chin|brow|lip)\s+(?:lacerat|abrasion|wound|cut|bruis|hematoma|haematoma)|"
                        r"alında (?:kesi|yara)|yüzde (?:kesi|yara)", re.I),
    "burn": re.compile(r"(?:burns?|scald\w*)\s+(?:\w+\s+){0,4}(?:face|forehead|cheek|neck|chin)|"
                       r"(?:facial|face|neck)\s+burns?|singed (?:eyebrows|facial hair|nasal hair)|yüzde yanık", re.I),
}
_COUGH = re.compile(r"cough|öksür", re.I)
# A finding inside a negated clause ("no signs of cyanosis or clubbing", "not jaundiced", "denies
# cough", "siyanoz yok") is absent. Clauses split on sentence and clause punctuation and on "but".
_CLAUSE = re.compile(r"[.;:!?\n]+|,\s+(?:but|however|ama|fakat)\s+|\s+but\s+", re.I)
_NEG_BEFORE = re.compile(r"\b(?:no|not|without|denies|denied|negative\s+for|absent|absence\s+of|free\s+of|"
                         r"nor|never)\b", re.I)
_NEG_AFTER = re.compile(r"\b(?:yok|değil|saptanmadı|izlenmedi|absent|not\s+seen|not\s+present)\b", re.I)


def _evident(rx: re.Pattern[str], text: str) -> bool:
    """``rx`` matches in a clause that does not negate it."""
    for clause in _CLAUSE.split(text):
        m = rx.search(clause)
        if m is None:
            continue
        if _NEG_BEFORE.search(clause[: m.start()]) or _NEG_AFTER.search(clause[m.end():]):
            continue
        return True
    return False

_PHRASES: dict[str, tuple[str, str]] = {
    # Live findings 2026-10-21 (FLUX.2 klein 4B on the worker): "flushed red cheeks" gave two painted
    # blush patches, "feverish redness" a blotchy rash (a finding the case does not have), "an even
    # pink-red tint" a lobster-red face; "a little pinker and warmer than in the original, subtle and
    # even" reads as fever (docs/media/live-avatar/state-sync/prompt-tuning/).
    # The colour itself is added by the gateway (tint.warm_flush): even, never blotchy.
    "fever_flush": ("a slightly tired, feverish look in the eyes",
                    "a feverish, unwell look: tired, heavy, glassy eyes"),
    "diaphoresis": ("a light sheen of sweat on the forehead and upper lip",
                    "beads of sweat on the forehead and damp hair at the temples"),
    "pallor": ("pale, washed-out skin", "very pale, greyish skin"),
    "mottling": ("faint blotchy mottled skin on the neck", "marked purple-grey mottled skin on the neck and chin"),
    # Live 2026-10-21: "slightly bluish lips" came out as a saturated blue, close to lipstick.
    "cyanosis": ("a faint dusky blue-grey tinge to the natural lip colour", "dusky blue-grey lips and a greyish tinge around the mouth"),
    "jaundice": ("a yellow tinge to the skin and to the whites of the eyes",
                 "deep yellow skin and yellow whites of the eyes"),
    "resp_distress": ("looks short of breath, nostrils slightly flared, neck a little tense",
                      "struggling to breathe, nostrils flared, neck muscles straining"),
    "accessory_muscles": ("visible neck muscle strain with each breath", "neck muscles standing out with each breath"),
    "pain": ("a pained expression with the brow slightly furrowed", "grimacing in pain, brow tightly furrowed, eyes narrowed"),
    "drowsy": ("heavy eyelids, looks tired and drowsy", "half-closed eyes, looks exhausted and barely awake"),
    "unresponsive": ("eyes closed, face slack", "eyes closed, face slack and grey, unresponsive"),
    "petechiae": ("a few tiny pinpoint dark red dots on the cheeks and neck that look like they would not fade under pressure",
                  "many tiny pinpoint dark red petechial dots scattered over the face and neck"),
    "purpura": ("a few small irregular purple-red non-blanching spots on the cheek and neck",
                "several purple-red non-blanching purpuric patches on the face and neck"),
    "urticaria": ("a few raised pink wheals (hives) on the neck and cheek",
                  "many raised pink-white wheals (hives) with red edges on the face and neck"),
    "scleral_icterus": ("a faint yellow tinge to the whites of the eyes", "clearly yellow whites of the eyes"),
    "flushing": ("an even pink flush over the cheeks and neck", "a deep even red flush over the whole face and neck"),
    "periorbital_oedema": ("slightly puffy swollen eyelids", "markedly swollen puffy eyelids, eyes narrowed by the swelling"),
    "facial_droop": ("a slight droop of one corner of the mouth", "a clear droop of one side of the face and mouth"),
    "facial_swelling": ("mildly swollen lips", "markedly swollen lips and puffy swollen face"),
    "dehydration": ("dry cracked lips and slightly sunken eyes", "very dry cracked lips, sunken eyes and dark circles"),
    "wound": ("a small cleaned laceration with a little dried blood on the forehead",
              "a sutured laceration on the forehead with bruising around it"),
    "burn": ("a patch of red, superficial burn on one cheek", "red, blistered partial-thickness burn on one cheek and the chin"),
}


@dataclass
class Look:
    signs: dict[str, int]
    phase: str = "stable"
    identity: dict[str, Any] = field(default_factory=dict)
    cough: bool = False

    @property
    def key(self) -> str:
        body = ",".join(f"{s}{self.signs[s]}" for s in SIGN_ORDER if self.signs.get(s))
        return hashlib.sha256(body.encode("utf-8")).hexdigest()[:10]

    def public(self) -> dict[str, Any]:
        return {"key": self.key, "phase": self.phase, "signs": {s: self.signs[s] for s in SIGN_ORDER if s in self.signs},
                "cough": self.cough}

    def with_signs(self, signs: dict[str, int], phase: str | None = None) -> "Look":
        return Look(signs={k: v for k, v in signs.items() if v > 0}, phase=phase or self.phase,
                    identity=dict(self.identity), cough=self.cough)


def _num(v: Any, default: float | None = None) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _case_text(spec: dict[str, Any], director: dict[str, Any] | None) -> str:
    parts: list[str] = [str(spec.get("chief_complaint_en") or ""), str(spec.get("triage_note") or "")]
    for e in spec.get("exam") or []:
        if isinstance(e, dict):
            parts.append(str(e.get("finding_en") or ""))
    for h in spec.get("hpi") or []:
        if isinstance(h, dict):
            parts.append(str(h.get("answer_en") or ""))
    snap = (director or {}).get("snapshot") or {}
    for f in snap.get("findings") or []:
        if isinstance(f, dict):
            parts.append(str(f.get("finding_en") or f.get("text") or f.get("en") or ""))
        elif isinstance(f, str):
            parts.append(f)
    return "\n".join(p for p in parts if p)


def look_from_case(spec: dict[str, Any], director: dict[str, Any] | None) -> Look:
    """The look for the live state of one case thread (``spec`` = the source spec, ``director`` = the
    stored Director state, a :class:`server.orchestration.director.CaseState` dump, or None at arrival)."""
    d = director or {}
    snap = d.get("snapshot") or {}
    vitals = dict(spec.get("triage_vitals") or {})
    vitals.update({k: v for k, v in (snap.get("vitals") or d.get("vitals") or {}).items() if v is not None})
    bed = snap.get("bedside") or {}
    affect = d.get("affect") or {}
    phase = str(snap.get("phase") or ("stable" if not d else "stable"))
    text = _case_text(spec, d)
    signs: dict[str, int] = {}

    for sign, rx in _TEXT_EVIDENCE.items():
        if _evident(rx, text):
            signs[sign] = 1

    temp = _num(vitals.get("tempC"))
    if temp is not None and temp >= 38.0:
        signs["fever_flush"] = 2 if temp >= 39.0 else 1
    if signs.get("fever_flush"):
        # A febrile "flushed" face is the fever flush (an even tint added after the edit); asking the
        # model for a flush as well drew blotches (prompt tuning 2026-10-21).
        signs.pop("flushing", None)
    rr, spo2 = _num(vitals.get("rr")), _num(vitals.get("spo2"))
    if (rr is not None and rr >= 30) or (spo2 is not None and spo2 < 88):
        signs["resp_distress"] = 2
    elif (rr is not None and rr >= 24) or (spo2 is not None and spo2 < 92):
        signs["resp_distress"] = 1
    # The case text describes the arrival; once the live vitals have settled, the signs it stated go.
    if rr is not None and rr <= 20 and (spo2 is None or spo2 >= 95):
        signs.pop("resp_distress", None)
        signs.pop("accessory_muscles", None)
    if temp is not None and temp < 37.8 and str(bed.get("skin") or "") not in ("cool", "mottled"):
        signs.pop("diaphoresis", None)
    if spo2 is not None and spo2 < 85:
        signs["cyanosis"] = 2 if spo2 < 80 else max(1, signs.get("cyanosis", 0))
    if signs.get("resp_distress") == 2 and "accessory_muscles" in signs:
        signs["accessory_muscles"] = 2
    skin = str(bed.get("skin") or "")
    sbp = _num(vitals.get("systolic"))
    mott = _num(bed.get("mottling"), 0.0) or 0.0
    if skin in ("cool", "mottled") or (sbp is not None and sbp < 90):
        signs["pallor"] = max(signs.get("pallor", 0), 2 if (sbp is not None and sbp < 80) or skin == "mottled" else 1)
        if skin == "cool" and "diaphoresis" not in signs:
            signs["diaphoresis"] = 1   # cool and clammy: the course engine's poor-perfusion skin
    if skin == "mottled" or mott >= 2:
        signs["mottling"] = 2 if mott >= 3 else 1
    pain = max(_num(bed.get("pain"), 0.0) or 0.0, _num(affect.get("pain"), 0.0) or 0.0)
    if pain >= 6:
        signs["pain"] = 2 if pain >= 8 else 1
    cons = str(affect.get("consciousness") or "").lower()
    gcs = _num(bed.get("gcs"), 15.0) or 15.0
    arrest = phase == "arrest" or bed.get("pulse") is False
    if arrest or cons == "unresponsive" or gcs <= 8:
        signs["unresponsive"] = 2 if arrest else 1
        signs.pop("drowsy", None)
        signs.pop("pain", None)
        signs.pop("resp_distress", None)
        signs.pop("accessory_muscles", None)
    elif cons == "drowsy" or gcs <= 13:
        signs["drowsy"] = 2 if gcs <= 10 else 1
    if arrest:
        phase = "arrest"
    demo = spec.get("demographics") or {}
    identity = {"age": demo.get("age"), "sex": demo.get("sex"), "ethnicity": demo.get("ethnicity") or None}
    return Look(signs=signs, phase=phase, identity=identity, cough=_evident(_COUGH, text))


# Colour-only signs the gateway paints after the edit (tint.warm_flush), never the model: asked for a
# flush, the model drew two red cheek patches (live 2026-10-21, prod-path capture, non-febrile flushing).
TINT_SIGNS = ("flushing",)


def tint_level(look: Look) -> int:
    """Level of the even warm tint painted over the face after the edit (fever flush or flushing)."""
    return max([int(look.signs.get(s, 0)) for s in ("fever_flush", *TINT_SIGNS)])


def edit_prompt(look: Look) -> str:
    """Instruction for an identity-preserving image edit of the case portrait."""
    changes = [_PHRASES[s][min(2, look.signs[s]) - 1] for s in SIGN_ORDER
               if look.signs.get(s) and s not in TINT_SIGNS]
    who = []
    if look.identity.get("age"):
        who.append(f"{int(look.identity['age'])} years old")
    if look.identity.get("sex"):
        who.append(str(look.identity["sex"]))
    if look.identity.get("ethnicity"):
        who.append(str(look.identity["ethnicity"]))
    person = f" ({', '.join(who)})" if who else ""
    mouth = "Keep the mouth closed and relaxed." if not look.signs.get("unresponsive") else "Keep the mouth closed."
    # Never a sign the case does not have: a colour change drifted into blotches that read as a rash on
    # some faces (live 2026-10-21, p35), so clear, uniform skin is part of every instruction.
    skin = ("" if any(look.signs.get(s) for s in SKIN_LESIONS) else
            " Keep the skin clear and uniform: no blotches, no rash, no spots, no patches.")
    if look.signs.get("facial_droop"):
        mouth = "Keep the mouth closed."
    # Our own guardrails (the open-weight model runs without a hosted filter): a clothed head-and-shoulders
    # clinical photo, only the listed findings, no blood or injury unless a wound or burn is listed.
    guard = (" Clinical teaching photo: fully clothed, head and shoulders only, no nudity, nothing sexual"
             + ("" if look.signs.get("wound") or look.signs.get("burn") else ", no blood, no injuries") + ".")
    head = (f"Edit this photo of a hospital patient{person}. Keep the same person: identical face identity, age, "
            "hairstyle, clothing, head position, camera framing, background and lighting. " + mouth + skin + guard)
    if not changes:
        return head + " Make the person look well and comfortable. Photorealistic, natural skin texture, no text."
    return head + " Change only this: " + "; ".join(changes) + ". Photorealistic, natural skin texture, no text."


def _intensify(look: Look, step: int, phase: str) -> Look:
    out = dict(look.signs)
    for s in LIVE_SIGNS:
        if out.get(s):
            out[s] = max(0, min(2, out[s] + step))
    return look.with_signs(out, phase)


def ladder(look: Look, *, acuity_esi: int | None = None) -> list[tuple[str, Look]]:
    """The looks prepared at call start: presenting, worse, critical, improved, and unresponsive when
    the case is ESI 1 or 2 (or already deteriorating). Duplicates collapse; 3 to 5 entries."""
    if look.signs.get("unresponsive"):
        return [("presenting", look), ("improved", look.with_signs(
            {k: v for k, v in look.signs.items() if k != "unresponsive"} | {"drowsy": 2}, "improving"))]
    worse = _intensify(look, +1, "deteriorating")
    crit_signs = dict(worse.signs)
    crit_signs["drowsy"] = max(1, crit_signs.get("drowsy", 0))
    critical = look.with_signs(crit_signs, "peri_arrest")
    improved = _intensify(look, -1, "improving")
    if improved.signs.get("diaphoresis") and not improved.signs.get("fever_flush"):
        improved.signs.pop("diaphoresis", None)
    items = [("presenting", look), ("worse", worse), ("critical", critical), ("improved", improved)]
    esi = acuity_esi if acuity_esi is not None else 3
    if esi <= 2 or look.phase in ("deteriorating", "peri_arrest"):
        items.append(("unresponsive", look.with_signs(
            {k: v for k, v in look.signs.items() if k in ("jaundice", "pallor", "mottling", "cyanosis")}
            | {"unresponsive": 2}, "arrest")))
    out: list[tuple[str, Look]] = []
    seen: set[str] = set()
    for name, lk in items:
        if lk.key not in seen:
            seen.add(lk.key)
            out.append((name, lk))
    return out


def choose_variant(live: Look, prepared: dict[str, Look]) -> Look | None:
    """The prepared look closest to ``live`` that shows nothing the patient does not have now:
    every sign of the picture is present live at the same or a higher level. Ties go to the
    picture that shows the most of the live signs."""
    if live.key in prepared:
        return prepared[live.key]
    best: tuple[int, int, Look] | None = None
    for lk in prepared.values():
        if any(live.signs.get(s, 0) < lvl for s, lvl in lk.signs.items()):
            continue
        if bool(live.signs.get("unresponsive")) != bool(lk.signs.get("unresponsive")):
            continue
        covered = sum(lvl for lvl in lk.signs.values())
        missing = sum(max(0, live.signs[s] - lk.signs.get(s, 0)) for s in live.signs)
        score = (covered, -missing)
        if best is None or score > (best[0], best[1]):
            best = (score[0], score[1], lk)
    return best[2] if best is not None else None


def voice_style(look: Look) -> dict[str, Any]:
    """TTS speed and the persona lines that make the voice match the picture."""
    lines: list[str] = []
    speed = 1.0
    if look.signs.get("unresponsive"):
        return {"speed": 0.8, "silent": look.signs["unresponsive"] >= 2 or look.phase == "arrest",
                "persona_lines": ["you can only mumble a word or two"]}
    rd = look.signs.get("resp_distress", 0)
    if rd:
        speed = min(speed, 0.92 if rd == 1 else 0.85)
        lines.append("you are short of breath: speak in short phrases of a few words, with '...' where you stop "
                     "for breath")
    if look.signs.get("pain", 0) >= 1:
        lines.append("you are in pain: now and then a short 'ah' or 'ow' slips out")
    if look.signs.get("drowsy"):
        speed = min(speed, 0.85)
        lines.append("you are drowsy: speak slowly and quietly, only a few words")
    if look.signs.get("fever_flush", 0) >= 2:
        lines.append("you feel hot, shivery and weak")
    if look.cough:
        lines.append("you cough now and then: write it as (cough)")
    return {"speed": speed, "silent": False, "persona_lines": lines}


_COUGH_MARK = re.compile(r"\((?:cough|coughs|coughing|öksürük|öksürür)\)", re.I)
_STAGE = re.compile(r"\*[^*]{1,40}\*\s*")


def speakable(text: str, lang: str) -> str:
    """What the TTS reads: '(cough)' becomes a cough sound, '*winces*' stage directions are dropped."""
    cough = "öhö," if lang == "tr" else "ahem,"
    out = _COUGH_MARK.sub(cough, text)
    out = _STAGE.sub("", out)
    return re.sub(r"\s{2,}", " ", out).strip()
