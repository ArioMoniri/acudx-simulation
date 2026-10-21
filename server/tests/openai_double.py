"""In-process OpenAI-compatible test double for the orchestration tests.

A tiny FastAPI app exposing ``POST /v1/chat/completions`` and ``GET /v1/models``.
It reads the ``ROLE:`` marker at the top of the system prompt and answers with
schema-valid JSON for that role, so the graph can be exercised end to end with
no network and no model. Behaviour is steered through a :class:`Scenario`.

This file lives under ``server/tests`` on purpose (protocol section 2: test
doubles are allowed only under ``tests/``).
"""

from __future__ import annotations

import asyncio
import json
import random
import re
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

from server.case_fixtures import CONDITION_FIXTURES
from server.case_generator import build_template_spec
from server.condition_catalog import CATALOG

_COND_BY_ID = {c["id"]: c for c in CATALOG}
_ANCHOR_LINE = re.compile(r"^- (gs_[a-z0-9_]+):", re.MULTILINE)


@dataclass
class Scenario:
    model: str = "qwen2.5-7b-instruct"
    author_unsafe: bool = False          # flip a fixture-contraindicated treatment to "indicated"
    author_spo2_over_100: bool = False   # emit triage spo2 = 104 (consistency judge must catch it)
    repair_fixes: bool = True            # when False, repair re-emits the same broken draft
    judge_verdicts: dict[str, str] = field(default_factory=dict)  # model-phase verdict per judge
    judge_free_text: set[str] = field(default_factory=set)       # judges whose fail cites no evidence
    judge_delay_s: float = 0.0                                    # simulated judge latency
    author_delay_s: float = 0.0                                   # simulated author / repair latency
    live_drafts: list[dict[str, Any]] = field(default_factory=list)  # author replies replayed verbatim
    propose_bogus_anchor: bool = True    # author proposes one id that does not exist
    author_bad_json: int = 0             # number of author calls that return non-JSON
    s1_bad: int = 0                      # S1 replies that fail the deterministic gate
    s1_drug_dose: bool = False           # S1 opening states a dose (gate must reject)
    layer_fail: set[str] = field(default_factory=set)   # layers that always answer non-JSON
    layer_delay_s: float = 0.0
    stream_chunk: int = 24               # characters per streamed delta
    treatments_unsafe_first: bool = False  # first table marks a contraindicated row indicated
    event_unsafe: bool = False           # branch events name a drug and the event safety judge fails them
    render_drops_numbers: bool = False   # TR renderings drop every digit (the rendering gate must reject)
    director_reply: dict[str, Any] = field(default_factory=dict)  # fields that replace the narrator's reply
    prompt_tokens: int = 1200
    completion_tokens: int = 800
    calls: list[dict[str, Any]] = field(default_factory=list)

    def role_calls(self, prefix: str) -> list[dict[str, Any]]:
        return [c for c in self.calls if c["role"].startswith(prefix)]


def _role_of(messages: list[dict[str, Any]]) -> str:
    for m in messages:
        if m.get("role") == "system":
            first = str(m.get("content") or "").splitlines()[0]
            if first.startswith("ROLE:"):
                return first.split(":", 1)[1].strip()
    return "unknown"


def _condition_id(text: str) -> str:
    m = re.search(r"condition_id: ([a-z0-9_]+)", text) or re.search(r"CONDITION: ([a-z0-9_]+)", text)
    return m.group(1) if m else "acs_stemi"


def _draft_for(cond_id: str, user_text: str, sc: Scenario, *, broken: bool) -> dict[str, Any]:
    cond = _COND_BY_ID.get(cond_id) or _COND_BY_ID["acs_stemi"]
    m = re.search(r"acuity_esi: (\d)", user_text)
    acuity = int(m.group(1)) if m else int(cond["typical_acuity"])
    m = re.search(r"difficulty: (\d)", user_text)
    difficulty = int(m.group(1)) if m else int(cond["difficulty"])
    spec = build_template_spec(cond, seed=4242, locale="en", acuity=acuity, difficulty=difficulty,
                               rng=random.Random(4242))
    spec.pop("guideline_anchors", None)
    proposed = _ANCHOR_LINE.findall(user_text)[:1]
    if sc.propose_bogus_anchor:
        proposed.append("gs_does_not_exist")
    spec["guideline_anchor_ids"] = proposed
    # Mark the red flag so pedagogy passes. A missing contraindicated distractor
    # is gap-filled from the fixture by server/orchestration/normalize.py.
    for h in spec["hpi"]:
        if h["intent"] == "red-flags":
            h["red_flag"] = True
    if broken and sc.author_unsafe:
        contra = {t[0] for t in (CONDITION_FIXTURES.get(cond["id"]) or {}).get("treatments", []) if t[3] == "contraindicated"}
        for t in spec["treatments"]:
            if t["code"] in contra:
                t["appropriateness"] = "indicated"
    if broken and sc.author_spo2_over_100:
        spec["triage_vitals"]["spo2"] = 104
    return spec


_EVIDENCE_LINE = re.compile(r"^- ((?:catalog|fixture)\.[^:]+): (.*)$", re.MULTILINE)


def _judge_reply(role: str, sc: Scenario, user_text: str = "") -> dict[str, Any]:
    """A verdict in the evidence-bound shape. A failing judge cites the first
    EVIDENCE line of the prompt (bound) unless ``judge_free_text`` asks for the
    unbound opinions the live 14B judges produced."""
    name = role.split(":", 1)[1] if ":" in role else role
    verdict = sc.judge_verdicts.get(name, "pass")
    if verdict == "pass":
        return {"verdict": "pass", "issues": [], "notes": []}
    if name in sc.judge_free_text:
        return {"verdict": "fail", "issues": [f"{name}: model-phase opinion without evidence"], "notes": []}
    m = _EVIDENCE_LINE.search(user_text)
    key, value = (m.group(1), m.group(2)) if m else ("catalog.label", "")
    return {"verdict": "fail", "notes": [],
            "issues": [{"field": "exam", "evidence": key, "evidence_value": value,
                        "problem": f"{name}: contradicts the reference", "fix": f"{name}: fix it"}]}


_LAYER = re.compile(r"^LAYER: ([a-z_.\-0-9]+)", re.MULTILINE)


def _case_condition(text: str) -> str:
    m = re.search(r'"id":"([a-z0-9_]+)"', text)
    return m.group(1) if m else _condition_id(text)


def _s1_reply(user_text: str, sc: Scenario) -> dict[str, Any]:
    cond = _COND_BY_ID.get(_condition_id(user_text)) or _COND_BY_ID["acs_stemi"]
    seed = random.Random(len(sc.calls)).randrange(1, 10_000)
    spec = build_template_spec(cond, seed=seed, locale="en", acuity=int(cond["typical_acuity"]),
                               difficulty=int(cond["difficulty"]), rng=random.Random(seed))
    lo, hi = cond.get("age") or (20, 80)
    sex = cond.get("sex") if cond.get("sex") in ("male", "female") else spec["demographics"]["sex"]
    if sex not in ("male", "female"):
        sex = "female"
    m = re.search(r'presenting with "([^"]+)"', user_text)
    complaint = (f"I have {m.group(1)} and it is getting worse" if m else spec["chief_complaint_en"])
    opening_hpi = [h for h in spec["hpi"] if h["intent"] in ("onset", "character", "severity", "location")][:3]
    if not opening_hpi:
        opening_hpi = [{"intent": "onset", "answer_en": "It started a few hours ago."}]
    cands = _ANCHOR_LINE.findall(user_text)[:1]
    reply = {
        "opening": {
            "demographics": {"age": max(lo, min(hi, int(spec["demographics"]["age"]))), "sex": sex,
                             "name": spec["demographics"]["name_hint"]},
            "chief_complaint": complaint,
            "triage_note": "Arrived by ambulance, alert, looks unwell."
                           + (" Given 300 mg aspirin." if sc.s1_drug_dose else ""),
            "triage_vitals": spec["triage_vitals"],
            "persona": {"affect": "worried", "communication": "short answers", "health_literacy": "average"},
            "opening_statements": [{"intent": h["intent"], "text": h["answer_en"]} for h in opening_hpi],
        },
        "kernel": {
            "key_positives": [h["answer_en"][:100] for h in spec["hpi"][:4]] or ["finding one", "finding two"],
            "key_negatives": ["no recent travel", "no trauma"],
            "severity": "moderate", "course": "deteriorating",
            "branches": [{"id": "missed_time_critical_treatment", "trigger": "no definitive treatment in time",
                          "effect": "worsening perfusion"}],
            "red_flags": ([{"text": r["en"], "channel": r.get("channel", "clinician")}
                           for r in spec.get("red_flags") or []][:3]
                          or [{"text": "worsening vital signs", "channel": "clinician"}]),
            "exam_systems": ["cardiovascular", "respiratory"],
            "anchor_ids": cands,
        },
    }
    if sc.s1_bad > 0:
        sc.s1_bad -= 1
        reply["opening"]["chief_complaint"] = ""
    return reply


def _layer_reply(layer: str, text: str, sc: Scenario) -> dict[str, Any]:
    from server.orchestration.staged import EXAM_SYSTEMS, HISTORY_CLUSTERS

    cond = _COND_BY_ID.get(_case_condition(text)) or _COND_BY_ID["acs_stemi"]
    spec = build_template_spec(cond, seed=99, locale="en", acuity=int(cond["typical_acuity"]),
                               difficulty=int(cond["difficulty"]), rng=random.Random(99))
    kind, _, sub = layer.partition(".")
    if kind == "history":
        intents = HISTORY_CLUSTERS[sub]
        items = [{"intent": h["intent"], "text": h["answer_en"], "red_flag": h["intent"] == "red-flags",
                  "topic": h.get("topic") or ""} for h in spec["hpi"] if h["intent"] in intents][:4]
        while len(items) < 2:
            intent = intents[len(items) % len(intents)]
            items.append({"intent": intent, "text": f"About my {intent}: nothing unusual.", "red_flag": False,
                          "topic": ""})
        out: dict[str, Any] = {"items": items}
        if sub == "background":
            out.update({"pmh": spec.get("pmh_en") or "None", "meds": spec.get("meds_en") or "None",
                        "allergies": spec.get("allergies_en") or "No known drug allergies"})
        return out
    if kind == "exam":
        mans = EXAM_SYSTEMS[sub]
        items = [{"maneuver": e["maneuver"], "system": e["system_en"], "finding": e["finding_en"],
                  "abnormal": bool(e["abnormal"])} for e in spec["exam"] if e["maneuver"] in mans][:3]
        return {"items": items or [{"maneuver": mans[0], "system": sub, "finding": f"{sub}: unremarkable",
                                    "abnormal": False}]}
    if kind == "treatments":
        rows = [{"code": t["code"], "label": t["label_en"], "appropriateness": t["appropriateness"],
                 "effects": t["effects"], "narrative": t.get("narrative_en") or ""} for t in spec["treatments"]]
        # Five rows, as a terse author writes, but always with the fixture's contraindicated
        # distractor: a plain [:5] cut it for the conditions that list it sixth or later
        # (septic_arthritis, sepsis, septic shock, CAP), and the safety gate then vetoed the table.
        contra_rows = [r for r in rows if r["appropriateness"] == "contraindicated"]
        if contra_rows and not any(r["appropriateness"] == "contraindicated" for r in rows[:5]):
            rows = rows[:4] + contra_rows[:1]
        rows = rows[:5]
        if sc.treatments_unsafe_first:
            sc.treatments_unsafe_first = False
            contra = {t[0] for t in (CONDITION_FIXTURES.get(cond["id"]) or {}).get("treatments", [])
                      if t[3] == "contraindicated"}
            for r in rows:
                if r["code"] in contra:
                    r["appropriateness"] = "indicated"
        return {"treatments": rows, "disposition": spec["disposition"]}
    if kind == "results":
        return {"labs": [{"code": lab["code"], "label": lab["label_en"], "value": lab["value"], "unit": lab["unit"],
                          "ref_low": lab.get("ref_low"), "ref_high": lab.get("ref_high"), "flag": lab["flag"]}
                         for lab in spec["labs"]][:5],
                "imaging": [{"code": im["code"], "modality": im["modality_en"], "findings": im["findings_en"],
                             "image_query": im.get("image_query_en") or ""} for im in spec["imaging"]][:2]}
    if kind == "event" and sc.event_unsafe:
        return {"facts": ["Given 10 mg morphine and now drowsy."],
                "nurse_call": "Doctor, the patient is very drowsy after the morphine.",
                "exam_changes": [], "affect": "drowsy"}
    if kind == "event":
        return {"facts": ["The patient is more breathless and clammy."],
                "nurse_call": "Doctor, the pressure is dropping and the patient looks worse.",
                "exam_changes": [{"maneuver": "skin", "finding": "Mottled knees, capillary refill 4 s."}],
                "affect": "frightened"}
    return {"teaching_points": ["Recognise the red flags early.", "Treat the time-critical cause first."],
            "missed_cues": []}


def _stream(content: str, sc: Scenario) -> StreamingResponse:
    async def gen():
        step = max(1, sc.stream_chunk)
        for i in range(0, len(content), step):
            chunk = {"model": sc.model, "choices": [{"index": 0, "delta": {"content": content[i:i + step]},
                                                     "finish_reason": None}]}
            yield "data: " + json.dumps(chunk) + "\n\n"
        yield "data: " + json.dumps({"model": sc.model, "choices": [{"index": 0, "delta": {},
                                                                     "finish_reason": "stop"}]}) + "\n\n"
        yield "data: " + json.dumps({"model": sc.model, "choices": [], "usage": {
            "prompt_tokens": sc.prompt_tokens, "completion_tokens": sc.completion_tokens}}) + "\n\n"
        yield "data: [DONE]\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")


def build_double(sc: Scenario) -> FastAPI:
    app = FastAPI()

    @app.get("/v1/models")
    async def models() -> dict[str, Any]:
        return {"object": "list", "data": [{"id": sc.model, "object": "model"}]}

    @app.post("/v1/chat/completions")
    async def chat(request: Request) -> Any:
        body = await request.json()
        messages = body.get("messages") or []
        role = _role_of(messages)
        user_text = "\n".join(str(m.get("content") or "") for m in messages if m.get("role") == "user")
        sc.calls.append({"role": role, "model": body.get("model"), "temperature": body.get("temperature"),
                         "response_format": body.get("response_format", {}).get("type"),
                         "max_tokens": body.get("max_tokens"), "stream": bool(body.get("stream")),
                         "system": next((str(m.get("content") or "") for m in messages if m.get("role") == "system"), ""),
                         "user": user_text})
        if role in ("author", "repair") and sc.author_delay_s:
            await asyncio.sleep(sc.author_delay_s)
        layer_m = _LAYER.search(user_text)
        if role == "author" and user_text.startswith("STAGE: s1"):
            content = json.dumps({"opening": _s1_reply(user_text, sc)["opening"]})
        elif role == "author" and user_text.startswith("STAGE: kernel"):
            content = json.dumps(_s1_reply(user_text, sc)["kernel"])
        elif role == "author.layer" and layer_m:
            layer = layer_m.group(1)
            if sc.layer_delay_s:
                await asyncio.sleep(sc.layer_delay_s)
            if layer in sc.layer_fail:
                content = "not json"
            else:
                system = next((str(m.get("content") or "") for m in messages if m.get("role") == "system"), "")
                content = json.dumps(_layer_reply(layer, system, sc))
        elif role == "judge:safety_event":
            content = json.dumps({"verdict": "fail", "issues": ["morphine dose unsafe for this event"]}
                                 if sc.event_unsafe else {"verdict": "pass", "issues": []})
        elif role == "author.render":
            m = re.search(r"^TEXTS\n(.*)$", user_text, re.MULTILINE)
            texts = json.loads(m.group(1)) if m else []
            tag = "[EN] " if re.search(r"^TARGET: English$", user_text, re.MULTILINE) else "[TR] "
            out = [tag + (re.sub(r"\d", "", t) if sc.render_drops_numbers else t) for t in texts]
            content = json.dumps({"texts": out}, ensure_ascii=False)
        elif role == "author" and sc.live_drafts:
            content = json.dumps(sc.live_drafts.pop(0), ensure_ascii=False)
        elif role == "author":
            if sc.author_bad_json > 0:
                sc.author_bad_json -= 1
                content = "Sorry, I cannot produce that right now."
            else:
                content = json.dumps(_draft_for(_condition_id(user_text), user_text, sc, broken=True))
        elif role == "repair":
            content = json.dumps(_draft_for(_condition_id(user_text), user_text, sc, broken=not sc.repair_fixes))
        elif role.startswith("judge"):
            if sc.judge_delay_s:
                await asyncio.sleep(sc.judge_delay_s)
            content = json.dumps(_judge_reply(role, sc, user_text))
        elif role == "director":
            content = json.dumps({"utterance_en": "It hurts, doctor, please help.", "utterance_tr": "Acıyor doktor, lütfen yardım edin.",
                                  "pain": 7, "mood_en": "scared", "mood_tr": "korkmuş", **sc.director_reply})
        else:
            content = "{}"
        if body.get("stream"):
            return _stream(content, sc)
        return {
            "id": "chatcmpl-double", "object": "chat.completion", "model": sc.model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": sc.prompt_tokens, "completion_tokens": sc.completion_tokens,
                      "total_tokens": sc.prompt_tokens + sc.completion_tokens},
        }

    return app
