"""The web image build runs tsc over the tests too: every server fixture a web test imports
must be copied into the build stage (docs/review/09 defect 3: the image did not build)."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_every_server_fixture_imported_by_web_is_copied_into_the_web_image():
    dockerfile = (ROOT / "deploy" / "Dockerfile.web").read_text()
    imported: set[str] = set()
    for f in (ROOT / "web" / "src").rglob("*.ts"):
        for m in re.finditer(r"""from\s+["'](?:\.\./)+server/tests/fixtures/([\w.-]+\.json)["']""", f.read_text()):
            imported.add(m.group(1))
    assert "sim_clock_parity.json" in imported
    missing = [name for name in sorted(imported) if f"server/tests/fixtures/{name}" not in dockerfile]
    assert not missing, f"deploy/Dockerfile.web does not copy {missing}"
