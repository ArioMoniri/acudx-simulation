"""Attending / tutor layer: suggested next actions for the generative chat UI.

Only runs when the learner turned guidance on. It never names the diagnosis: every action is
built from the case's own catalogue (the order codes the results layer can answer, the
history intents not asked yet, the EHR views) and checked against
:func:`server.interview.patient.forbidden_terms` before it leaves the server.

Action shapes (docs/architecture/20-chat-contract.md section 3)::

    {"kind": "order", "code", "system": "LOINC" | "RADLEX" | "local", "label"}
    {"kind": "navigate", "target": "results" | "imaging" | "orders" | "vitals" | "notes" | "diagnosis" | "guide",
     "ref"?}
    {"kind": "ask", "text"}

:func:`candidate_actions` lists what is possible; :func:`suggest` lets the tutor model pick
up to three (structured output whose enums are the candidates, so it cannot invent a code)
and falls back to a deterministic pick, labelled ``source = "rules"``, when no model answers.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

from server.interview.guard import HISTORY_INTENTS
from server.interview.patient import PatientView, forbidden_terms, leaks

log = logging.getLogger("acudx.interview.tutor")

NAV_TARGETS: tuple[str, ...] = ("results", "imaging", "orders", "vitals", "notes", "diagnosis", "guide")
_LOINC = re.compile(r"^\d{1,6}-\d$")
_RADLEX = re.compile(r"^(RID|RPID)\d+$", re.I)

ASK_TEXT: dict[str, dict[str, str]] = {
    "onset": {"en": "When exactly did this start?", "tr": "Bu tam olarak ne zaman başladı?"},
    "location": {"en": "Can you show me where you feel it?", "tr": "Nerede hissettiğinizi gösterebilir misiniz?"},
    "character": {"en": "What does it feel like?", "tr": "Nasıl bir his?"},
    "radiation": {"en": "Does it spread anywhere else?", "tr": "Başka bir yere yayılıyor mu?"},
    "severity": {"en": "How bad is it, from 0 to 10?", "tr": "0 ile 10 arasında ne kadar şiddetli?"},
    "timing": {"en": "Is it constant, or does it come and go?", "tr": "Sürekli mi, yoksa gelip gidiyor mu?"},
    "aggravating": {"en": "Does anything make it worse?", "tr": "Kötüleştiren bir şey var mı?"},
    "relieving": {"en": "Does anything make it better?", "tr": "Rahatlatan bir şey var mı?"},
    "associated-symptoms": {"en": "Have you noticed any other symptoms?", "tr": "Başka belirtiler fark ettiniz mi?"},
    "red-flags": {"en": "Any fainting, confusion or new weakness?", "tr": "Bayılma, bilinç bulanıklığı ya da yeni güçsüzlük oldu mu?"},
    "risk-factors": {"en": "Any recent travel, surgery or long periods in bed?", "tr": "Yakın zamanda seyahat, ameliyat ya da uzun yatak istirahati oldu mu?"},
    "ice": {"en": "What are you most worried this might be?", "tr": "En çok neyden endişe ediyorsunuz?"},
    "past-medical-history": {"en": "What illnesses have you had before?", "tr": "Daha önce hangi hastalıkları geçirdiniz?"},
    "medications": {"en": "Which medicines do you take?", "tr": "Hangi ilaçları kullanıyorsunuz?"},
    "allergies": {"en": "Are you allergic to any medicine?", "tr": "Herhangi bir ilaca alerjiniz var mı?"},
    "family-history": {"en": "Does anything run in your family?", "tr": "Ailenizde sık görülen bir hastalık var mı?"},
    "social-history": {"en": "Do you smoke or drink alcohol?", "tr": "Sigara ya da alkol kullanıyor musunuz?"},
}


def code_system(code: str) -> str:
    c = (code or "").strip()
    if _LOINC.match(c):
        return "LOINC"
    if _RADLEX.match(c):
        return "RADLEX"
    return "local"


def _loc(locale: str) -> str:
    return "tr" if (locale or "").lower().startswith("tr") else "en"


def candidate_actions(state: dict[str, Any], view: PatientView, *, asked: set[str], locale: str
                      ) -> dict[str, list[dict[str, Any]]]:
    """Everything the tutor may suggest for this thread, by kind."""
    loc = _loc(locale)
    spec = state.get("spec") or {}
    director = state.get("director") if isinstance(state.get("director"), dict) else {}
    ordered = set(((director.get("revealed") or {}).get("order")) or [])
    orders: list[dict[str, Any]] = []
    for lab in spec.get("labs") or []:
        code = str(lab.get("code") or "")
        if code and code not in ordered:
            orders.append({"kind": "order", "code": code, "system": code_system(code),
                           "label": str(lab.get(f"label_{loc}") or lab.get("label_en") or code)})
    for img in spec.get("imaging") or []:
        code = str(img.get("code") or "")
        if code and code not in ordered:
            orders.append({"kind": "order", "code": code, "system": code_system(code),
                           "label": str(img.get(f"modality_{loc}") or img.get("modality_en") or code)})
    asks = [{"kind": "ask", "text": ASK_TEXT[i][loc], "intent": i} for i in HISTORY_INTENTS
            if i not in asked and i in ASK_TEXT]
    navs = [{"kind": "navigate", "target": t} for t in NAV_TARGETS]
    if view.trend == "worse":
        navs.sort(key=lambda a: a["target"] != "vitals")
    return {"order": orders, "ask": asks, "navigate": navs}


def _clean(actions: list[dict[str, Any]], terms: list[str]) -> list[dict[str, Any]]:
    out = []
    for a in actions:
        text = " ".join(str(a.get(k) or "") for k in ("label", "text", "ref"))
        if leaks(text, terms):
            continue
        out.append({k: v for k, v in a.items() if k != "intent"})
    return out[:3]


def deterministic(cands: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """One of each kind, in clinical order: the next history question, an order, a view."""
    out: list[dict[str, Any]] = []
    if cands["ask"]:
        out.append(cands["ask"][0])
    if cands["order"]:
        out.append(cands["order"][0])
    if cands["navigate"]:
        out.append(cands["navigate"][0])
    return out


TUTOR_SYSTEM = (
    "You are the attending supervising a medical student in a simulated encounter. Pick at most three next "
    "steps that help the student reason, from the CANDIDATES only. Never name or hint at a diagnosis, never "
    "say which result to expect, never judge. Prefer history questions while the history is thin, orders "
    "once the main history is taken, the vitals view when the patient is getting worse. For an ask action "
    "you may rephrase the question in the student's language, still without a diagnosis. Return only JSON."
)


def tutor_schema(cands: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    order_codes = [a["code"] for a in cands["order"]] or ["none"]
    return {
        "type": "object",
        "properties": {"actions": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "kind": {"enum": ["order", "navigate", "ask"]},
                "code": {"enum": order_codes + ["none"]},
                "target": {"enum": list(NAV_TARGETS) + ["none"]},
                "text": {"type": "string"},
            },
            "required": ["kind", "code", "target", "text"], "additionalProperties": False}}},
        "required": ["actions"], "additionalProperties": False,
    }


def tutor_messages(view: PatientView, transcript: list[dict[str, str]], cands: dict[str, list[dict[str, Any]]],
                   locale: str) -> list[dict[str, str]]:
    last = "\n".join(f"{'student' if t.get('role') == 'doctor' else 'patient'}: {t.get('text', '')[:200]}"
                     for t in transcript[-8:])
    lines = [f"Student language: {_loc(locale)}. Patient: {view.chief_complaint}. Trend: {view.trend}.",
             f"History sections the student has drawn out so far: {', '.join(view.ready_history) or 'none'}.",
             "RECENT TURNS", last or "(none)", "CANDIDATES",
             "orders: " + "; ".join(f"{a['code']}={a['label']}" for a in cands["order"][:12]),
             "asks: " + "; ".join(a["text"] for a in cands["ask"][:8]),
             "views: " + ", ".join(a["target"] for a in cands["navigate"])]
    return [{"role": "system", "content": TUTOR_SYSTEM}, {"role": "user", "content": "\n".join(lines)}]


async def suggest(gateway: Any, state: dict[str, Any], view: PatientView, transcript: list[dict[str, str]], *,
                  asked: set[str], locale: str) -> tuple[list[dict[str, Any]], str]:
    """``(actions, source)``; ``source`` is ``model`` or ``rules``."""
    cands = candidate_actions(state, view, asked=asked, locale=locale)
    terms = forbidden_terms(state)
    if gateway is not None:
        try:
            data, _res = await gateway.chat_json(tutor_messages(view, transcript, cands, locale),
                                                 schema=tutor_schema(cands), schema_name="tutor_actions",
                                                 task="tutor", max_tokens=400)
            picked = _from_model(data, cands)
            if picked:
                return _clean(picked, terms), "model"
        except Exception as exc:  # noqa: BLE001 - GatewayError, EgressBlocked
            log.info("tutor model unavailable (%s); deterministic actions", type(exc).__name__)
    return _clean(deterministic(cands), terms), "rules"


def _from_model(data: dict[str, Any], cands: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    by_code = {a["code"]: a for a in cands["order"]}
    out: list[dict[str, Any]] = []
    for a in data.get("actions") or []:
        kind = a.get("kind")
        if kind == "order" and a.get("code") in by_code:
            out.append(by_code[a["code"]])
        elif kind == "navigate" and a.get("target") in NAV_TARGETS:
            out.append({"kind": "navigate", "target": a["target"]})
        elif kind == "ask" and str(a.get("text") or "").strip():
            out.append({"kind": "ask", "text": str(a["text"]).strip()[:200]})
    return out[:3]


def ask_intents(text: Optional[str]) -> Optional[str]:
    """The history intent an ask action's template belongs to (for asked-set bookkeeping)."""
    for intent, t in ASK_TEXT.items():
        if text in (t["en"], t["tr"]):
            return intent
    return None


__all__ = ["ASK_TEXT", "NAV_TARGETS", "candidate_actions", "code_system", "deterministic", "suggest",
           "tutor_messages", "tutor_schema"]
