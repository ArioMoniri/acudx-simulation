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


def build_double(sc: Scenario) -> FastAPI:
    app = FastAPI()

    @app.get("/v1/models")
    async def models() -> dict[str, Any]:
        return {"object": "list", "data": [{"id": sc.model, "object": "model"}]}

    @app.post("/v1/chat/completions")
    async def chat(request: Request) -> dict[str, Any]:
        body = await request.json()
        messages = body.get("messages") or []
        role = _role_of(messages)
        user_text = "\n".join(str(m.get("content") or "") for m in messages if m.get("role") == "user")
        sc.calls.append({"role": role, "model": body.get("model"), "temperature": body.get("temperature"),
                         "response_format": body.get("response_format", {}).get("type")})
        if role in ("author", "repair") and sc.author_delay_s:
            await asyncio.sleep(sc.author_delay_s)
        if role == "author" and sc.live_drafts:
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
                                  "pain": 7, "mood_en": "scared", "mood_tr": "korkmuş"})
        else:
            content = "{}"
        return {
            "id": "chatcmpl-double", "object": "chat.completion", "model": sc.model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": sc.prompt_tokens, "completion_tokens": sc.completion_tokens,
                      "total_tokens": sc.prompt_tokens + sc.completion_tokens},
        }

    return app
