"""Review 06b F26 and acceptance test 10: one physiology model for server and browser.

* The browser table (``web/src/domain/courseTables.generated.ts``) must equal
  what the server tables generate today.
* The shared parity fixture (``server/tests/fixtures/course_parity.json``) must
  equal what the Director produces today; the Vitest suite
  (``web/src/domain/clinicalCourseParity.test.ts``) replays the same inputs
  through ``clinicalCourse.ts`` and requires the same vitals within 1 unit.

Regenerate both with ``.venv/bin/python scripts/gen_course_tables.py``.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from server.orchestration import course as C

ROOT = Path(__file__).resolve().parents[2]


def _gen():
    spec = importlib.util.spec_from_file_location("gen_course_tables", ROOT / "scripts/gen_course_tables.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def test_browser_course_table_equals_the_server_table():
    gen = _gen()
    ts = (ROOT / "web/src/domain/courseTables.generated.ts").read_text(encoding="utf-8")
    assert ts == gen.ts_source(), "courseTables.generated.ts is stale: run scripts/gen_course_tables.py"
    body = ts[ts.index("= {") + 2: ts.rindex(";")]
    assert json.loads(body) == json.loads(json.dumps(gen.tables()))


def test_parity_fixture_equals_the_director_today():
    gen = _gen()
    stored = json.loads((ROOT / "server/tests/fixtures/course_parity.json").read_text(encoding="utf-8"))
    assert stored == json.loads(json.dumps(gen.parity_fixture())), "course_parity.json is stale"


def test_engine_reproduces_the_fixture_from_inputs_alone():
    """The fixture input (no library, no Director) is enough to rebuild the vitals."""
    stored = json.loads((ROOT / "server/tests/fixtures/course_parity.json").read_text(encoding="utf-8"))
    for case in stored["cases"]:
        for mark, want in case["expect"].items():
            snap = C.simulate(case["input"], int(mark) * 60_000)
            assert snap["vitals"] == want["vitals"], (case["condition_id"], case["label"], mark)
            assert snap["phase"] == want["phase"], (case["condition_id"], case["label"], mark)


def test_client_omission_and_stem_tables_mirror_the_director():
    """06b F09 and F29: omission rows are never administered on either side."""
    from server.orchestration import director as D
    ts = (ROOT / "web/src/domain/treatmentMatch.ts").read_text(encoding="utf-8")
    block = ts[ts.index("export const OMISSION_ROW_STEMS"):]
    block = block[:block.index("];")]
    import re
    assert set(re.findall(r'"([^"]+)"', block)) == set(D.OMISSION_ROW_STEMS)
