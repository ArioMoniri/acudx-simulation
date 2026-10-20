#!/usr/bin/env python3
"""Store one recorded live model case as a case thread in a local gateway's CaseStore.

    python3 video/scripts/seed-thread.py <db_path> <thread_id> <owner> < record.json

Used by scripts/record-walkthrough.mjs. The recorder replays a recorded live
model case (server/tests/fixtures/live, the same output the e2e suite replays)
as the staged stream; the gateway the dev server proxies to must hold the same
thread so that POST /v2/director/step runs the real Clinical Director (its
course engine and narrator) on that case, bound to the learner's thread.

Written through the server's own CaseStore, so the provenance rule applies:
only a record with ``source == "model"`` is accepted. Every layer is marked
ready because the recorded case is complete (nothing for the gateway to write).
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from server.orchestration.store import CaseStore  # noqa: E402

LAYERS = (
    "history.presenting", "history.associated", "history.background",
    "exam.general", "exam.cardiovascular", "exam.respiratory", "exam.abdominal",
    "exam.neurological", "exam.msk_skin", "exam.ent_special", "treatments", "results",
)


def main() -> None:
    db, thread_id, owner = sys.argv[1], sys.argv[2], sys.argv[3]
    rec = json.load(sys.stdin)
    spec = dict(rec["spec"])
    spec["meta"] = {**spec.get("meta", {}), "thread_id": thread_id, "layers": {n: "ready" for n in LAYERS}}
    if spec["meta"].get("source") != "model":
        sys.exit("refusing: the record is not model generated")
    state = {
        "thread_id": thread_id, "owner": owner or None, "requester": owner or None, "source": "model",
        "request": {"learner_id": owner or None}, "spec": spec, "status": "complete",
        "opening": {"chief_complaint": spec.get("chief_complaint_en"), "triage_vitals": spec.get("triage_vitals")},
        "layers": {n: {"status": "ready", "data": {}, "seen": False} for n in LAYERS},
        "layer_order": list(LAYERS), "director": None, "models": spec["meta"].get("models") or [],
        "recorded_from": rec.get("thread_id"),
    }
    CaseStore(db).put(thread_id, state)
    print(f"seeded {thread_id} (owner {owner or '-'}) from recorded thread {rec.get('thread_id')}")


if __name__ == "__main__":
    main()
