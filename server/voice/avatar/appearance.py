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
              "accessory_muscles", "pain", "drowsy", "unresponsive")
# Signs the live state can change from one Director step to the next (the ladder varies these);
# the others are findings the case text states and stay until the patient improves.
LIVE_SIGNS = ("fever_flush", "resp_distress", "pain", "drowsy", "pallor", "mottling", "cyanosis")

_TEXT_EVIDENCE: dict[str, re.Pattern[str]] = {
    "diaphoresis": re.compile(r"diaphore|sweat|clammy|terl|ter içinde|soğuk ter", re.I),
    "jaundice": re.compile(r"jaundic|icter|yellow(?:ish)?\s+(?:skin|sclera|eyes)|sarılık|ikter", re.I),
    "cyanosis": re.compile(r"cyano|blue lips|bluish|siyano|morarma", re.I),
    "pallor": re.compile(r"\bpale\b|pallor|soluk", re.I),
    "mottling": re.compile(r"mottl|livedo|alacalı", re.I),
    "accessory_muscles": re.compile(r"accessory muscle|intercostal|subcostal|recession|retraction|tripod|"
                                    r"yardımcı solunum kas", re.I),
}
_COUGH = re.compile(r"cough|öksür", re.I)

_PHRASES: dict[str, tuple[str, str]] = {
    "fever_flush": ("slightly flushed pink cheeks", "clearly flushed red cheeks and a feverish, glassy look in the eyes"),
    "diaphoresis": ("a light sheen of sweat on the forehead and upper lip",
                    "beads of sweat on the forehead and damp hair at the temples"),
    "pallor": ("pale, washed-out skin", "very pale, greyish skin"),
    "mottling": ("faint blotchy mottled skin on the neck", "marked purple-grey mottled skin on the neck and chin"),
    "cyanosis": ("slightly bluish lips", "clearly blue-grey lips"),
    "jaundice": ("a yellow tinge to the skin and to the whites of the eyes",
                 "deep yellow skin and yellow whites of the eyes"),
    "resp_distress": ("looks short of breath, nostrils slightly flared, neck a little tense",
                      "struggling to breathe, nostrils flared, neck muscles straining"),
    "accessory_muscles": ("visible neck muscle strain with each breath", "neck muscles standing out with each breath"),
    "pain": ("a pained expression with the brow slightly furrowed", "grimacing in pain, brow tightly furrowed, eyes narrowed"),
    "drowsy": ("heavy eyelids, looks tired and drowsy", "half-closed eyes, looks exhausted and barely awake"),
    "unresponsive": ("eyes closed, face slack", "eyes closed, face slack and grey, unresponsive"),
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
        if rx.search(text):
            signs[sign] = 1

    temp = _num(vitals.get("tempC"))
    if temp is not None and temp >= 38.0:
        signs["fever_flush"] = 2 if temp >= 39.0 else 1
    rr, spo2 = _num(vitals.get("rr")), _num(vitals.get("spo2"))
    if (rr is not None and rr >= 30) or (spo2 is not None and spo2 < 88):
        signs["resp_distress"] = 2
    elif (rr is not None and rr >= 24) or (spo2 is not None and spo2 < 92):
        signs["resp_distress"] = 1
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
    return Look(signs=signs, phase=phase, identity=identity, cough=bool(_COUGH.search(text)))


def edit_prompt(look: Look) -> str:
    """Instruction for an identity-preserving image edit of the case portrait."""
    changes = [_PHRASES[s][min(2, look.signs[s]) - 1] for s in SIGN_ORDER if look.signs.get(s)]
    who = []
    if look.identity.get("age"):
        who.append(f"{int(look.identity['age'])} years old")
    if look.identity.get("sex"):
        who.append(str(look.identity["sex"]))
    if look.identity.get("ethnicity"):
        who.append(str(look.identity["ethnicity"]))
    person = f" ({', '.join(who)})" if who else ""
    mouth = "Keep the mouth closed and relaxed." if not look.signs.get("unresponsive") else "Keep the mouth closed."
    head = (f"Edit this photo of a hospital patient{person}. Keep the same person: identical face identity, age, "
            "hairstyle, clothing, head position, camera framing, background and lighting. " + mouth)
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
