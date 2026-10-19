"""Case generator v2: a LangGraph pipeline with a judge council and repair loop.

    sample_condition -> author -> {clinical_consistency, safety_dosing, pedagogy}
        -> aggregate -> (repair -> judges -> aggregate)* -> ground -> finalize

* ``sample_condition`` draws the condition spine from the catalog, seeded, and
  consults the learner memory (avoid repeats, steer to weak systems).
* ``author`` asks the casegen model for a full draft as structured JSON
  (temperature 0.7). No template is merged in: the draft is the model's.
* The three judges run in parallel via ``Send``; ``aggregate`` takes the
  majority with a safety veto; ``repair`` asks the model to fix the listed
  issues, at most ``max_repairs`` times.
* ``ground`` attaches guideline anchors strictly by existing statement id.
* ``finalize`` validates with pydantic, overwrites the authoritative codes,
  and records the case in learner memory.

Every node appends a trace event (see ``trace.py``) that the checkpointer
persists with the state, so ``GET /v2/case/{thread_id}`` can replay the run.
"""

from __future__ import annotations

import json
import operator
import random
import time
import uuid
from dataclasses import dataclass
from typing import Annotated, Any, Optional, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from server.case_generator import (
    APPROPRIATENESS, DISPOSITIONS, INTENTS, MANEUVERS, GeneratedCaseSpec, _clamp,
)
from server.condition_catalog import list_systems, sample_condition
from server.orchestration import judges as J
from server.orchestration.anchors import anchor_from_statement, candidate_ids, resolve_anchors, statement_index
from server.orchestration.llm import ModelOutputInvalid, StructuredLLM, schema_of
from server.orchestration.memory import LearnerMemory
from server.orchestration.trace import make_event, summarize

MAX_REPAIRS_DEFAULT = 2
AUTHOR_TEMPERATURE = 0.7
REPAIR_TEMPERATURE = 0.3
AUTHOR_MAX_TOKENS = 2400
WEAK_SYSTEM_STEER_P = 0.6   # chance a learner's weakest system is targeted


class AuthorDraft(GeneratedCaseSpec):
    """What the author returns: the spec plus *ids* of guideline statements."""

    guideline_anchor_ids: list[str] = []


AUTHOR_SCHEMA = schema_of(AuthorDraft, drop=("guideline_anchors",))


class CaseGenState(TypedDict, total=False):
    request: dict[str, Any]
    thread_id: str
    seed: int
    locale: str
    condition: dict[str, Any]
    acuity: int
    difficulty: int
    candidate_anchor_ids: list[str]
    draft: dict[str, Any]
    votes: Annotated[list[dict[str, Any]], operator.add]
    round: int
    repairs: int
    council: dict[str, Any]
    anchors: list[dict[str, Any]]
    spec: dict[str, Any]
    status: str
    trace: Annotated[list[dict[str, Any]], operator.add]


@dataclass
class CaseGenDeps:
    llm: Optional[StructuredLLM]
    memory: Optional[LearnerMemory] = None
    max_repairs: int = MAX_REPAIRS_DEFAULT


class CouncilRejected(RuntimeError):
    """Raised when the council vetoed the draft and repairs are exhausted."""


# --------------------------------------------------------------------------- #
# Request normalisation                                                        #
# --------------------------------------------------------------------------- #
def normalize_request(req: dict[str, Any]) -> dict[str, Any]:
    c = dict(req or {})
    seed = c.get("seed")
    try:
        seed = int(seed) & 0x7FFFFFFF if seed is not None else None
    except (TypeError, ValueError):
        seed = None
    explicit_seed = seed is not None
    if seed is None:
        seed = random.Random().randrange(1, 2**31 - 1)
    locale = str(c.get("locale") or "en").lower()
    if locale not in ("en", "tr"):
        locale = "en"
    diff = c.get("difficulty")
    try:
        diff = _clamp(int(diff), 1, 5) if diff is not None else None
    except (TypeError, ValueError):
        diff = None
    return {
        "seed": seed, "explicit_seed": explicit_seed, "locale": locale,
        "system": c.get("system") or None, "difficulty": diff,
        "complaint": c.get("complaint") or None,
        "learner_id": str(c["learner_id"]) if c.get("learner_id") else None,
        "session_id": str(c["session_id"]) if c.get("session_id") else None,
    }


# --------------------------------------------------------------------------- #
# Prompts                                                                      #
# --------------------------------------------------------------------------- #
_AUTHOR_SYSTEM = (
    "ROLE: author\n"
    "You are a medical-education case author for a training simulator. You invent "
    "SYNTHETIC patients only, never real people or records. You output ONE JSON "
    "object matching the given schema and nothing else. Every human-readable field "
    "is bilingual (_en and _tr). The clinical picture must be internally consistent "
    "with the condition, ESI acuity and difficulty, and a three-judge council will "
    "reject contradictions, unsafe treatment labels and missing red flags."
)


def author_messages(cond: dict[str, Any], *, locale: str, acuity: int, difficulty: int,
                    candidates: list[str]) -> list[dict[str, str]]:
    rf = "; ".join(f"{r['en']} / {r['tr']}" for r in cond.get("red_flags", [])) or "(none)"
    index = statement_index()
    cand_lines = "\n".join(
        f"- {sid}: {anchor_from_statement(index[sid])['statement_en'][:160]}"
        for sid in candidates if sid in index
    ) or "- (none available; return an empty list)"
    dsm = f"\n- DSM-5-TR: {cond['dsm5tr']}" if cond.get("dsm5tr") else ""
    user = f"""Author a full case. Output JSON only.

CONDITION
- condition_id: {cond['id']}
- label_en: {cond['label_en']}
- label_tr: {cond['label_tr']}
- system: {cond['system']}
- ICD-11: {cond.get('icd11', '')}
- ICD-10: {cond.get('icd10', '')}{dsm}
- typical complaint: {cond['typical_complaint_en']} / {cond['typical_complaint_tr']}
- red flags: {rf}

CONSTRAINTS
- primary locale: {locale}
- acuity_esi: {acuity} (1 = most acute .. 5 = least); difficulty: {difficulty} (1 .. 5)
- hpi[].intent MUST be one of: {', '.join(INTENTS)}; include "onset"; mark red-flag positives red_flag=true
- exam[].maneuver MUST be one of: {', '.join(MANEUVERS)}
- treatments[].appropriateness MUST be one of: {', '.join(APPROPRIATENESS)}; include at least one indicated and one contraindicated
- treatments[].effects[].key in hr, systolic, diastolic, rr, spo2, tempC, pain; deltas modest and signed
- disposition one of: {', '.join(DISPOSITIONS)}
- vitals physiologically plausible for the acuity (SpO2 <= 100, diastolic < systolic); ~4 trajectory points with increasing atMs from 0
- 5-8 hpi items, 3-4 exam items, 2-4 labs with ref ranges and flags, 1-2 imaging, 3-4 treatments
- guideline_anchor_ids: pick 1-3 ids ONLY from this list (never invent an id):
{cand_lines}
"""
    return [{"role": "system", "content": _AUTHOR_SYSTEM}, {"role": "user", "content": user}]


def repair_messages(draft: dict[str, Any], cond: dict[str, Any], issues: list[str], hints: list[str]) -> list[dict[str, str]]:
    system = (
        "ROLE: repair\n"
        "You are the same case author. The judge council rejected your draft. Return the "
        "COMPLETE corrected case as ONE JSON object in the same schema, changing only what "
        "the issues require and keeping everything else identical."
    )
    user = (
        f"CONDITION: {cond.get('id')} ({cond.get('label_en')})\n\n"
        "ISSUES\n" + "\n".join(f"- {i}" for i in issues) + "\n\n"
        "HINTS\n" + ("\n".join(f"- {h}" for h in hints) or "- (none)") + "\n\n"
        f"DRAFT\n{json.dumps(draft, ensure_ascii=False, separators=(',', ':'))}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


# --------------------------------------------------------------------------- #
# Deterministic safety overrides (used only when the council is exhausted)     #
# --------------------------------------------------------------------------- #
def apply_safety_overrides(spec: dict[str, Any], cond: dict[str, Any]) -> list[str]:
    """Force fixture-known appropriateness, cap effects, clamp vitals. Returns notes."""
    notes: list[str] = []
    contra = J.fixture_contraindicated_codes(cond.get("id", ""))
    indicated = J.fixture_indicated_codes(cond.get("id", ""))
    for t in spec.get("treatments") or []:
        code = str(t.get("code") or "")
        if code in contra and t.get("appropriateness") != "contraindicated":
            t["appropriateness"] = "contraindicated"
            notes.append(f"{code}: forced contraindicated (fixture)")
        if code in indicated and t.get("appropriateness") != "indicated":
            t["appropriateness"] = "indicated"
            notes.append(f"{code}: forced indicated (fixture)")
        for eff in t.get("effects") or []:
            cap = J.EFFECT_CAPS.get(str(eff.get("key") or ""))
            try:
                d = float(eff.get("delta", 0))
            except (TypeError, ValueError):
                d = 0.0
            if cap is not None and abs(d) > cap:
                eff["delta"] = cap if d > 0 else -cap
                notes.append(f"{code}: effect {eff.get('key')} clamped to {eff['delta']}")
    for v in [spec.get("triage_vitals") or {}, *(spec.get("vitals_trajectory") or [])]:
        for key, (lo, hi) in J.VITAL_BOUNDS.items():
            try:
                val = float(v.get(key))
            except (TypeError, ValueError):
                continue
            if not (lo <= val <= hi):
                v[key] = max(lo, min(hi, val))
                notes.append(f"vitals {key} clamped to {v[key]}")
        try:
            if float(v.get("diastolic", 0)) >= float(v.get("systolic", 0)):
                v["diastolic"] = max(J.VITAL_BOUNDS["diastolic"][0], float(v["systolic"]) - 30)
                notes.append("diastolic lowered below systolic")
        except (TypeError, ValueError):
            pass
    return notes


# --------------------------------------------------------------------------- #
# Graph construction                                                           #
# --------------------------------------------------------------------------- #
def build_casegen_graph(deps: CaseGenDeps):
    """Compile the case generator graph. ``checkpointer`` is attached by the caller."""

    def node_sample_condition(state: CaseGenState) -> dict[str, Any]:
        started = time.monotonic()
        req = normalize_request(state.get("request") or {})
        rng = random.Random(req["seed"])
        exclude: set[str] = set()
        steer_system: str | None = None
        learner_id = req["learner_id"]
        if learner_id and deps.memory is not None:
            exclude = set(deps.memory.conditions_seen(learner_id))
            weak = deps.memory.weak_systems(learner_id)
            if weak and not req["system"] and rng.random() < WEAK_SYSTEM_STEER_P:
                steer_system = weak[0]
        cond = sample_condition(
            system=req["system"] or steer_system, difficulty=req["difficulty"],
            complaint=req["complaint"], rng=rng, exclude_ids=exclude or None,
        )
        acuity = int(cond["typical_acuity"])
        difficulty = req["difficulty"] if req["difficulty"] is not None else int(cond["difficulty"])
        return {
            "request": req, "seed": req["seed"], "locale": req["locale"], "condition": cond,
            "acuity": acuity, "difficulty": difficulty,
            "candidate_anchor_ids": candidate_ids(cond),
            "round": 0, "repairs": 0, "status": "sampled",
            "thread_id": state.get("thread_id") or str(uuid.uuid4()),
            "trace": [make_event(
                "sample_condition", started=started, condition_id=cond["id"], system=cond["system"],
                steered_system=steer_system, excluded=len(exclude), systems=len(list_systems()),
            )],
        }

    async def _author_call(messages: list[dict[str, str]], temperature: float):
        assert deps.llm is not None
        try:
            return await deps.llm.complete_json(
                messages, schema=AUTHOR_SCHEMA, schema_name="generated_case_spec",
                role="casegen", temperature=temperature, max_tokens=AUTHOR_MAX_TOKENS,
            )
        except ModelOutputInvalid:
            # One retry for a malformed reply; a second failure propagates (502).
            return await deps.llm.complete_json(
                messages, schema=AUTHOR_SCHEMA, schema_name="generated_case_spec",
                role="casegen", temperature=temperature, max_tokens=AUTHOR_MAX_TOKENS,
            )

    def _stamp_authoritative(draft: dict[str, Any], state: CaseGenState) -> dict[str, Any]:
        cond = state["condition"]
        draft["condition"] = {
            "icd11": cond.get("icd11", ""), "icd10": cond.get("icd10", ""),
            "dsm5tr": cond.get("dsm5tr"), "label_en": cond["label_en"],
            "label_tr": cond["label_tr"], "system": cond["system"],
        }
        draft["seed"] = state["seed"]
        draft["locale"] = state["locale"]
        draft["difficulty"] = state["difficulty"]
        draft.setdefault("acuity_esi", state["acuity"])
        return draft

    async def node_author(state: CaseGenState) -> dict[str, Any]:
        if deps.llm is None:
            raise RuntimeError("author requires a model; no StructuredLLM configured")
        started = time.monotonic()
        messages = author_messages(
            state["condition"], locale=state["locale"], acuity=state["acuity"],
            difficulty=state["difficulty"], candidates=state.get("candidate_anchor_ids") or [],
        )
        reply = await _author_call(messages, AUTHOR_TEMPERATURE)
        draft = _stamp_authoritative(dict(reply.data), state)
        return {
            "draft": draft, "status": "authored",
            "trace": [make_event(
                "author", started=started, model=reply.model, model_requested=reply.model_requested,
                provider=reply.provider, tokens_in=reply.tokens_in, tokens_out=reply.tokens_out,
                temperature=AUTHOR_TEMPERATURE,
            )],
        }

    def fan_out(state: CaseGenState) -> list[Send]:
        return [Send(name, dict(state)) for name in J.JUDGES]

    def make_judge(name: str):
        async def node(state: CaseGenState) -> dict[str, Any]:
            vote, event = await J.run_judge(
                name, state["draft"], state["condition"], deps.llm, round_no=int(state.get("round", 0)),
            )
            return {"votes": [vote], "trace": [event]}
        node.__name__ = f"judge_{name}"
        return node

    def node_aggregate(state: CaseGenState) -> dict[str, Any]:
        started = time.monotonic()
        agg = J.aggregate_votes(state.get("votes") or [], int(state.get("round", 0)))
        return {
            "council": agg, "status": f"council_{agg['decision']}",
            "trace": [make_event(
                "aggregate", started=started, decision=agg["decision"], passes=agg["passes"],
                vetoed=agg["vetoed"], round=agg["round"], issues=len(agg["issues"]),
            )],
        }

    def route_after_aggregate(state: CaseGenState) -> str:
        council = state.get("council") or {}
        if council.get("decision") == "accept":
            return "ground"
        if int(state.get("repairs", 0)) < deps.max_repairs:
            return "repair"
        return "ground"

    async def node_repair(state: CaseGenState) -> dict[str, Any]:
        if deps.llm is None:
            raise RuntimeError("repair requires a model; no StructuredLLM configured")
        started = time.monotonic()
        council = state.get("council") or {}
        messages = repair_messages(
            state["draft"], state["condition"], council.get("issues") or [], council.get("repair_hints") or [],
        )
        reply = await _author_call(messages, REPAIR_TEMPERATURE)
        draft = _stamp_authoritative(dict(reply.data), state)
        repairs = int(state.get("repairs", 0)) + 1
        return {
            "draft": draft, "repairs": repairs, "round": int(state.get("round", 0)) + 1,
            "status": "repaired",
            "trace": [make_event(
                "repair", started=started, model=reply.model, model_requested=reply.model_requested,
                provider=reply.provider, tokens_in=reply.tokens_in, tokens_out=reply.tokens_out,
                repair_no=repairs, issues=len(council.get("issues") or []),
            )],
        }

    def node_ground(state: CaseGenState) -> dict[str, Any]:
        started = time.monotonic()
        proposed = (state.get("draft") or {}).get("guideline_anchor_ids") or []
        anchors, dropped = resolve_anchors(list(proposed), state["condition"])
        return {
            "anchors": anchors, "status": "grounded",
            "trace": [make_event(
                "ground", started=started, attached=[a["statement_id"] for a in anchors],
                dropped_ids=dropped, proposed=len(proposed),
            )],
        }

    def node_finalize(state: CaseGenState) -> dict[str, Any]:
        started = time.monotonic()
        cond = state["condition"]
        council = state.get("council") or {}
        draft = dict(state["draft"])
        draft.pop("guideline_anchor_ids", None)
        draft["guideline_anchors"] = [
            {"statement_en": a["statement_en"], "statement_tr": a["statement_tr"],
             "source": a["source"], "citation": a["citation"]}
            for a in state.get("anchors") or []
        ]
        notes: list[str] = []
        degraded = False
        if council.get("decision") != "accept":
            if council.get("vetoed"):
                notes.extend(apply_safety_overrides(draft, cond))
            degraded = True
        try:
            spec = GeneratedCaseSpec.model_validate(draft).model_dump()
        except Exception as exc:  # pydantic.ValidationError, surfaced as 502 by the route
            raise ModelOutputInvalid(f"final draft failed schema validation: {str(exc)[:300]}") from exc
        # Authoritative overrides: codes, seed, locale, difficulty are never model-sourced.
        spec["condition"] = {
            "icd11": cond.get("icd11", ""), "icd10": cond.get("icd10", ""),
            "dsm5tr": cond.get("dsm5tr"), "label_en": cond["label_en"],
            "label_tr": cond["label_tr"], "system": cond["system"],
        }
        spec["seed"] = state["seed"]
        spec["locale"] = state["locale"]
        spec["difficulty"] = state["difficulty"]
        spec["guideline_anchors"] = [
            {**ga, "statement_id": a["statement_id"]}
            for ga, a in zip(spec["guideline_anchors"], state.get("anchors") or [])
        ]
        req = state.get("request") or {}
        if req.get("learner_id") and deps.memory is not None:
            deps.memory.record_case(req["learner_id"], cond["id"], cond["system"])
        trace_event = make_event(
            "finalize", started=started, council_decision=council.get("decision"),
            repairs=int(state.get("repairs", 0)), degraded=degraded, overrides=notes,
        )
        full_trace = list(state.get("trace") or []) + [trace_event]
        models = sorted({str(e["model"]) for e in full_trace if e.get("model")})
        spec["meta"] = {
            "source": "model",
            "generator": "v2",
            "model": models[0] if len(models) == 1 else (models or None),
            "models": models,
            "condition_id": cond["id"],
            "thread_id": state.get("thread_id"),
            "council": {
                "decision": council.get("decision"), "rounds": int(state.get("round", 0)) + 1,
                "repairs": int(state.get("repairs", 0)), "vetoed": bool(council.get("vetoed")),
                "issues": council.get("issues") or [],
            },
            "degraded": degraded,
            "note": "council_exhausted; deterministic safety overrides applied: " + "; ".join(notes)
            if degraded else None,
            "latency_ms": summarize(full_trace)["latency_ms"],
            "trace_summary": summarize(full_trace),
        }
        return {"spec": spec, "status": "done", "trace": [trace_event]}

    g: StateGraph = StateGraph(CaseGenState)
    g.add_node("sample_condition", node_sample_condition)
    g.add_node("author", node_author)
    for name in J.JUDGES:
        g.add_node(name, make_judge(name))
    g.add_node("aggregate", node_aggregate)
    g.add_node("repair", node_repair)
    g.add_node("ground", node_ground)
    g.add_node("finalize", node_finalize)

    g.add_edge(START, "sample_condition")
    g.add_edge("sample_condition", "author")
    g.add_conditional_edges("author", fan_out, list(J.JUDGES))
    for name in J.JUDGES:
        g.add_edge(name, "aggregate")
    g.add_conditional_edges("aggregate", route_after_aggregate, {"ground": "ground", "repair": "repair"})
    g.add_conditional_edges("repair", fan_out, list(J.JUDGES))
    g.add_edge("ground", "finalize")
    g.add_edge("finalize", END)
    return g


def initial_state(request: dict[str, Any], thread_id: str | None = None) -> CaseGenState:
    return {
        "request": dict(request or {}), "thread_id": thread_id or str(uuid.uuid4()),
        "votes": [], "trace": [], "round": 0, "repairs": 0, "status": "new",
    }


def template_spec(request: dict[str, Any]) -> dict[str, Any]:
    """The deterministic template, labelled honestly (``meta.source = template``)."""
    from server.case_generator import build_template_spec

    req = normalize_request(request)
    rng = random.Random(req["seed"])
    cond = sample_condition(
        system=req["system"], difficulty=req["difficulty"], complaint=req["complaint"], rng=rng,
    )
    acuity = int(cond["typical_acuity"])
    difficulty = req["difficulty"] if req["difficulty"] is not None else int(cond["difficulty"])
    spec = build_template_spec(
        cond, seed=req["seed"], locale=req["locale"], acuity=acuity, difficulty=difficulty,
        rng=random.Random(req["seed"] ^ 0x5DEECE66),
    )
    anchors, _ = resolve_anchors([], cond)
    spec["guideline_anchors"] = [
        {"statement_en": a["statement_en"], "statement_tr": a["statement_tr"],
         "source": a["source"], "citation": a["citation"], "statement_id": a["statement_id"]}
        for a in anchors
    ]
    out = GeneratedCaseSpec.model_validate(spec).model_dump()
    out["guideline_anchors"] = spec["guideline_anchors"]
    out["meta"] = {
        "source": "template", "generator": "v2", "model": None, "condition_id": cond["id"],
        "degraded": True, "note": "deterministic template; not model-generated", "latency_ms": 0.0,
    }
    return out


__all__ = [
    "AUTHOR_SCHEMA", "AuthorDraft", "CaseGenDeps", "CaseGenState", "CouncilRejected",
    "apply_safety_overrides", "author_messages", "build_casegen_graph", "initial_state",
    "normalize_request", "repair_messages", "template_spec",
]
