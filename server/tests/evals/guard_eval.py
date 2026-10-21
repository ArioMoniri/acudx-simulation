"""Interview guard eval: labelled EN and TR student messages, scored per label.

Three modes:

* rules   : the deterministic layer alone (what serves when no model is configured);
* replay  : the full pipeline (rules + model, :func:`server.interview.guard.combine`) over
            RECORDED model outputs in ``server/tests/evals/recorded/*.jsonl``. Each line is
            ``{"id", "model", "recorded_at", "output": {label, reason, language, intent}}``
            exactly as the classifier model returned it in a live run;
* live    : calls the classifier model through the gateway (``ACUDX_EVAL_LIVE=1`` and
            ``ANTHROPIC_KEY``), scores it, and writes a new recording for replay.

Run ``python -m server.tests.evals.guard_eval [rules|replay|live]`` for a table.
"""

from __future__ import annotations

import datetime as _dt
import json
import sys
from pathlib import Path
from typing import Any, Iterable, Optional

from server.interview.guard import LABELS, GuardDecision, combine, parse_model, rule_classify

HERE = Path(__file__).resolve().parent
EVAL_SET = HERE / "guard_eval_set.jsonl"
RECORDED = HERE / "recorded"


def load_set(path: Path = EVAL_SET) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def scores(gold: list[str], pred: list[str]) -> dict[str, Any]:
    """Per-label precision, recall, F1 and support; accuracy and macro F1."""
    per: dict[str, dict[str, float]] = {}
    for lab in LABELS:
        tp = sum(1 for g, p in zip(gold, pred) if g == lab and p == lab)
        fp = sum(1 for g, p in zip(gold, pred) if g != lab and p == lab)
        fn = sum(1 for g, p in zip(gold, pred) if g == lab and p != lab)
        prec = tp / (tp + fp) if tp + fp else 1.0
        rec = tp / (tp + fn) if tp + fn else 1.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        per[lab] = {"precision": round(prec, 3), "recall": round(rec, 3), "f1": round(f1, 3),
                    "support": sum(1 for g in gold if g == lab)}
    acc = sum(1 for g, p in zip(gold, pred) if g == p) / max(1, len(gold))
    macro = sum(v["f1"] for v in per.values()) / len(per)
    return {"n": len(gold), "accuracy": round(acc, 3), "macro_f1": round(macro, 3), "per_label": per}


def confusions(items: list[dict[str, Any]], pred: list[str]) -> list[dict[str, str]]:
    return [{"id": it["id"], "gold": it["label"], "pred": p, "text": it["text"]}
            for it, p in zip(items, pred) if it["label"] != p]


def run_rules(items: Optional[list[dict[str, Any]]] = None) -> dict[str, Any]:
    items = items or load_set()
    pred = [rule_classify(it["text"]).label for it in items]
    return {"mode": "rules", **scores([it["label"] for it in items], pred), "errors": confusions(items, pred)}


def load_recording(path: Path) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            out[row["id"]] = row
    return out


def run_replay(recording: Path, items: Optional[list[dict[str, Any]]] = None) -> dict[str, Any]:
    """Rules + recorded model outputs through :func:`combine`, as the server would decide."""
    items = items or load_set()
    rec = load_recording(recording)
    pred: list[str] = []
    missing = 0
    for it in items:
        row = rec.get(it["id"])
        model: Optional[GuardDecision] = parse_model(row["output"], row.get("model")) if row else None
        missing += row is None
        pred.append(combine(rule_classify(it["text"]), model).label)
    models = sorted({str(r.get("model")) for r in rec.values()})
    return {"mode": "replay", "recording": recording.name, "models": models, "missing": missing,
            **scores([it["label"] for it in items], pred), "errors": confusions(items, pred)}


async def run_live(gateway: Any, items: Optional[list[dict[str, Any]]] = None,
                   out_dir: Path = RECORDED) -> dict[str, Any]:
    """Classify every item with the live model, write the recording, score the pipeline."""
    from server.interview.guard import CLASSIFIER_SCHEMA, model_messages  # noqa: PLC0415

    items = items or load_set()
    rows: list[dict[str, Any]] = []
    model_name = "unknown"
    for it in items:
        data, res = await gateway.chat_json(model_messages(it["text"], "chest pain"), schema=CLASSIFIER_SCHEMA,
                                            schema_name="interview_guard", task="guard", max_tokens=200)
        model_name = getattr(res, "model", model_name)
        rows.append({"id": it["id"], "model": model_name, "provider": getattr(res, "provider", None),
                     "recorded_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
                     "output": data})
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = out_dir / f"{model_name}-{stamp}.jsonl"
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    report = run_replay(path, items)
    report["mode"] = "live"
    report["written"] = str(path)
    return report


def table(report: dict[str, Any]) -> str:
    lines = [f"mode={report['mode']} n={report['n']} accuracy={report['accuracy']} macro_f1={report['macro_f1']}"]
    lines.append(f"{'label':<18} {'prec':>6} {'rec':>6} {'f1':>6} {'n':>4}")
    for lab, v in report["per_label"].items():
        lines.append(f"{lab:<18} {v['precision']:>6.3f} {v['recall']:>6.3f} {v['f1']:>6.3f} {v['support']:>4}")
    for e in report.get("errors", [])[:40]:
        lines.append(f"  miss {e['id']}: gold={e['gold']} pred={e['pred']} :: {e['text'][:70]}")
    return "\n".join(lines)


def recordings() -> Iterable[Path]:
    return sorted(RECORDED.glob("*.jsonl")) if RECORDED.exists() else []


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else "rules"
    if mode == "rules":
        print(table(run_rules()))
    elif mode == "replay":
        files = list(recordings())
        if not files:
            print("no recordings under server/tests/evals/recorded/ (run the live mode first)")
        for f in files:
            print(table(run_replay(f)))
    elif mode == "live":
        import asyncio  # noqa: PLC0415

        from server.config import Settings  # noqa: PLC0415
        from server.model_gateway import ModelGateway  # noqa: PLC0415

        async def go() -> dict[str, Any]:
            gw = ModelGateway(Settings())
            await gw.start()
            try:
                return await run_live(gw)
            finally:
                await gw.aclose()

        print(table(asyncio.run(go())))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
