"""The worker's speaches STT at boot (docs/architecture/18 6.3.12).

Live 2026-10-22 every worker answered 404 "model not installed": speaches 0.8 ignores PRELOAD_MODELS
(deprecated in 0.7) and runs as uid 1000, so its own ``POST /v1/models`` download into the root-owned
shared cache failed with 500. The template now pins the image by digest, fetches the model as root at a
pinned revision with refs/main written for the offline loader, and checks it with a real transcription.
"""

from __future__ import annotations

import http.server
import json
import os
import subprocess
import sys
import threading
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
CLOUD_INIT = ROOT / "infra" / "gpu-worker" / "cloud-init.yaml"


def _doc() -> dict:
    return yaml.safe_load(CLOUD_INIT.read_text(encoding="utf-8"))


def _files() -> dict[str, str]:
    return {f["path"]: f["content"] for f in _doc()["write_files"]}


def _env() -> dict[str, str]:
    return dict(line.split("=", 1) for line in _files()["/opt/acudx/.env"].splitlines() if "=" in line)


def test_speaches_is_pinned_by_digest_and_runs_offline_without_dead_settings():
    env = _env()
    assert env["SPEACHES_IMAGE"].startswith("ghcr.io/speaches-ai/speaches:0.8.3-cuda-12.4.1@sha256:")
    assert env["STT_MODEL"] == "deepdml/faster-whisper-large-v3-turbo-ct2"
    assert len(env["STT_MODEL_REV"]) == 40
    compose = yaml.safe_load(_files()["/opt/acudx/docker-compose.yml"])
    sp = compose["services"]["speaches"]
    assert sp["image"].startswith("${SPEACHES_IMAGE:-ghcr.io/speaches-ai/speaches:0.8.3-cuda-12.4.1@sha256:")
    envs = sp["environment"]
    # Settings speaches 0.8 does not read must not pretend to configure it.
    assert not any(e.startswith(("PRELOAD_MODELS", "STT_MODEL_TTL")) for e in envs)
    assert "WHISPER__TTL=-1" in envs and "HF_HUB_OFFLINE=1" in envs and "HF_HOME=/hf" in envs
    assert sp["healthcheck"]["test"] == ["CMD", "python", "/opt/stt-check.py"]
    assert "/opt/acudx/stt-check.py:/opt/stt-check.py:ro" in sp["volumes"]


def test_stt_model_is_fetched_as_root_at_the_pinned_revision_and_checked():
    sh = _files()["/opt/acudx/stt.sh"]
    assert "--user 0:0" in sh and "$SPEACHES_IMAGE" in sh
    assert "revision='$rev'" in sh and "'README.md'" in sh and "'model.bin'" in sh
    assert 'fetch "$STT_MODEL" "$STT_MODEL_REV"' in sh and 'STT_EXTRA_MODELS' in sh
    assert 'printf \'%s\' "$rev" > "$repo/refs/main"' in sh
    assert "chmod -R a+rX" in sh and "stt-check.py" in sh and "stt.json" in sh
    # a watchdog for the worker's life: publishes the speaches log and restarts a speaches that keeps failing
    assert "while true; do" in sh and "stt-log.txt" in sh and "restart speaches" in sh and "restarts\" -ge 3" in sh
    subprocess.run(["bash", "-n"], input=sh, text=True, check=True)
    rc = "\n".join(c if isinstance(c, str) else " ".join(c) for c in _doc()["runcmd"])
    up = rc.index("docker compose up -d speaches kokoro kokoro2")
    assert rc.index("nohup /opt/acudx/stt.sh", up) > up


class _Speaches(http.server.BaseHTTPRequestHandler):
    status = 200

    def do_POST(self):  # noqa: N802 - http.server API
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n)
        type(self).seen = body
        out = (json.dumps({"text": ""}) if self.status == 200 else
               json.dumps({"detail": "Model 'x' is not installed locally."})).encode()
        self.send_response(self.status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):  # noqa: D401 - quiet
        pass


@pytest.mark.parametrize("status,rc", [(200, 0), (404, 2), (500, 1)])
def test_stt_check_exit_codes(tmp_path, status, rc):
    script = tmp_path / "stt-check.py"
    script.write_text(_files()["/opt/acudx/stt-check.py"], encoding="utf-8")
    _Speaches.status = status
    srv = http.server.HTTPServer(("127.0.0.1", 0), _Speaches)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        env = {**os.environ, "STT_MODEL": "deepdml/faster-whisper-large-v3-turbo-ct2",
               "STT_CHECK_URL": f"http://127.0.0.1:{srv.server_address[1]}/v1/audio/transcriptions"}
        p = subprocess.run([sys.executable, "-I", str(script)], env=env, capture_output=True, text=True, timeout=30)
    finally:
        srv.shutdown()
    assert p.returncode == rc, p.stdout + p.stderr
    assert json.loads(p.stdout)["ok"] is (status == 200)
    assert b'name="model"\r\n\r\ndeepdml/faster-whisper-large-v3-turbo-ct2' in _Speaches.seen
    assert b"RIFF" in _Speaches.seen
