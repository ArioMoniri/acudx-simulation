"""Cold start of a GPU worker (docs/architecture/18 section 6.8).

Live 2026-10-21 on production: 17 min 20 s from a cold launch to live video, because Chatterbox, the
avatar runner and the image edit server were built from source on every worker, one after another
behind vLLM. These tests pin the fix: content-keyed images taken from the registry or the Lambda
filesystem cache before any build, the AcuDx code mounted (never part of a key), and a parallel
start-up order in which vLLM goes last.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
CLOUD_INIT = ROOT / "infra" / "gpu-worker" / "cloud-init.yaml"


def _wi():
    spec = importlib.util.spec_from_file_location("worker_images", ROOT / "infra" / "gpu-worker" / "worker_images.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["worker_images"] = mod
    spec.loader.exec_module(mod)
    return mod


def _files() -> dict[str, str]:
    return {f["path"]: f["content"] for f in yaml.safe_load(CLOUD_INIT.read_text(encoding="utf-8"))["write_files"]}


def _runcmd() -> list[str]:
    cmds = yaml.safe_load(CLOUD_INIT.read_text(encoding="utf-8"))["runcmd"]
    return [c if isinstance(c, str) else " ".join(c) for c in cmds]


def _compose() -> dict:
    return yaml.safe_load(_files()["/opt/acudx/docker-compose.yml"])


def _images_sh(tmp_path: Path) -> Path:
    p = tmp_path / "images.sh"
    p.write_text(_files()["/opt/acudx/images.sh"], encoding="utf-8")
    return p


@pytest.mark.parametrize("shell", ["bash", "sh"])
def test_shell_and_python_compute_the_same_image_key(tmp_path, shell):
    """runcmd sources images.sh under /bin/sh, so it must be POSIX; and the workflow's keys (Python)
    must equal the worker's (shell), or a worker never finds the image the workflow pushed."""
    if shutil.which(shell) is None:
        pytest.fail(f"{shell} not available")
    a = tmp_path / "a.txt"
    b = tmp_path / "b.txt"
    a.write_text("FROM python:3.12\nRUN echo ı ş ğ\n", encoding="utf-8")
    b.write_text("numpy==1.26.4\n", encoding="utf-8")
    sh = _images_sh(tmp_path)
    out = subprocess.run([shell, "-c", f'. "{sh}"; image_key c7269433 "{a}" "{b}"'], capture_output=True, text=True,
                         env={**os.environ, "TIMELINE": str(tmp_path / "t.txt")}, check=True)
    want = _wi().image_key([a.read_bytes(), b.read_bytes()], "c7269433")
    assert out.stdout.strip() == want and len(want) == 16


def test_keys_cover_dependencies_only_never_the_mounted_acudx_code():
    wi = _wi()
    keys = {s.name: wi.key_for(s) for s in wi.IMAGES}
    assert set(keys) == {"chatterbox", "avatar", "imagegen"}
    assert all(len(k) == 16 and int(k, 16) >= 0 for k in keys.values())
    for spec in wi.IMAGES:
        assert not any(f.endswith(".py") for f in spec.files), spec.name
    sh = _files()["/opt/acudx/images.sh"]
    assert 'chatterbox_key() { image_key "$CHATTERBOX_REF" /opt/acudx/chatterbox.Dockerfile; }' in sh
    assert ('avatar_key() { image_key "$LIVETALKING_REF" /opt/acudx/avatar/Dockerfile.acudx '
            "/opt/acudx/avatar/acudx-constraints.txt; }") in sh
    assert 'imagegen_key() { image_key "" /opt/acudx/imagegen/Dockerfile; }' in sh


def test_the_acudx_code_is_mounted_into_the_containers():
    svc = _compose()["services"]
    avatar = svc["avatar"]["volumes"]
    for f in ("acudx_avatar_server.py", "acudx_fetch_models.py", "acudx_register.py"):
        assert f"/opt/acudx/avatar/{f}:/app/{f}:ro" in avatar
    for name in ("chatterbox", "chatterbox2"):
        vols = svc[name]["volumes"]
        assert "/opt/acudx/chatterbox-acudx-patch.py:/app/app/acudx_patch.py:ro" in vols
        assert "${CHATTERBOX_CACHE:-/opt/acudx/chatterbox-cache}:/cache" in vols
    assert "/opt/acudx/imagegen/acudx_imagegen.py:/app/acudx_imagegen.py:ro" in svc["imagegen"]["volumes"]
    assert "COPY acudx_imagegen.py" not in _files()["/opt/acudx/imagegen/Dockerfile"]


def test_model_caches_live_on_the_lambda_filesystem():
    rc = "\n".join(_runcmd())
    assert 'ln -s "$FS/hf" /opt/acudx/hf' in rc
    assert 'CHATTERBOX_CACHE=$FS/chatterbox-cache' in rc
    assert "ACUDX_IMAGE_REGISTRY=ghcr.io/ariomoniri" in _files()["/opt/acudx/.env"]


def _fake_docker(tmp_path: Path, *, registry_has: bool, local_has: bool = False) -> Path:
    """A ``docker`` on PATH that logs its arguments and answers like the real one for the calls
    ensure_image makes."""
    bindir = tmp_path / "bin"
    bindir.mkdir()
    log = tmp_path / "docker.log"
    script = f"""#!/bin/sh
echo "$@" >> "{log}"
case "$1" in
  image) [ "{int(local_has)}" = 1 ] || grep -qE '^(tag|load) ' "{log}" && exit 0; exit 1 ;;
  pull) [ "{int(registry_has)}" = 1 ] && exit 0; exit 1 ;;
  load) exit 0 ;;
  save) shift; out=""; while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done; echo tar > "$out"; exit 0 ;;
  tag) exit 0 ;;
esac
exit 0
"""
    d = bindir / "docker"
    d.write_text(script, encoding="utf-8")
    d.chmod(0o755)
    return bindir


def _ensure(tmp_path: Path, bindir: Path, *, registry: str, cache: Path) -> tuple[str, str]:
    sh = _images_sh(tmp_path)
    timeline = tmp_path / "timeline.txt"
    env = {**os.environ, "PATH": f"{bindir}:{os.environ['PATH']}", "ACUDX_IMAGE_REGISTRY": registry,
           "ACUDX_IMAGE_CACHE": str(cache), "TIMELINE": str(timeline), "ACUDX_FS": str(tmp_path)}
    subprocess.run(["sh", "-c", f'. "{sh}"; ensure_image avatar acudx/avatar-runner:x k123 '
                    f'sh -c "echo built >> {tmp_path}/build.log"; wait'], env=env, check=True)
    return (tmp_path / "docker.log").read_text(encoding="utf-8"), timeline.read_text(encoding="utf-8")


def test_ensure_image_pulls_from_the_registry_before_building(tmp_path):
    bindir = _fake_docker(tmp_path, registry_has=True)
    log, timeline = _ensure(tmp_path, bindir, registry="ghcr.io/ariomoniri", cache=tmp_path / "cache")
    assert "pull -q ghcr.io/ariomoniri/acudx-avatar:k123" in log
    assert "tag ghcr.io/ariomoniri/acudx-avatar:k123 acudx/avatar-runner:x" in log
    assert not (tmp_path / "build.log").exists()
    assert "image avatar pulled k123" in timeline


def test_ensure_image_loads_the_filesystem_cache_when_the_registry_has_none(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "avatar-k123.tar").write_text("tar", encoding="utf-8")
    bindir = _fake_docker(tmp_path, registry_has=False)
    log, timeline = _ensure(tmp_path, bindir, registry="ghcr.io/ariomoniri", cache=cache)
    assert f"load -i {cache}/avatar-k123.tar" in log
    assert not (tmp_path / "build.log").exists()
    assert "image avatar not in registry k123" in timeline


def test_ensure_image_builds_once_and_saves_it_for_the_next_worker(tmp_path):
    cache = tmp_path / "cache"
    bindir = _fake_docker(tmp_path, registry_has=False)
    log, timeline = _ensure(tmp_path, bindir, registry="", cache=cache)
    assert (tmp_path / "build.log").read_text(encoding="utf-8").strip() == "built"
    assert "tag acudx/avatar-runner:x acudx-cache/avatar:k123" in log
    assert (cache / "avatar-k123.tar").is_file()
    assert "image avatar built k123" in timeline and "saved to cache" in timeline


def test_start_up_is_parallel_and_vllm_starts_last():
    rc = _runcmd()
    joined = "\n".join(rc)

    def at(fragment: str) -> int:
        return next(i for i, c in enumerate(rc) if fragment in c)

    fetch = at('mark "images: fetching"')
    voices = at("docker compose up -d --no-build chatterbox")
    vllm = at("docker compose up -d --wait vllm")
    assert fetch < voices < vllm
    assert at("nohup /opt/acudx/avatar.sh") < vllm and at("nohup /opt/acudx/imagegen.sh") < vllm
    # every image at once, in the background
    assert "vllm/vllm-openai:v0.11.0 ghcr.io/speaches-ai/speaches:0.8.3-cuda" in rc[fetch]
    assert 'docker pull -q "$img"' in rc[fetch] and ") &" in rc[fetch]
    assert "ensure_image chatterbox" in rc[fetch]
    # no build on the critical path when an image exists
    assert "up -d --build chatterbox" not in joined
    # vLLM waits for the runner's memory and Chatterbox's model
    assert '"initialization_state":"ready"' in rc[vllm] and "status.json" in rc[vllm]
    # the voice warm-up runs as soon as the voice is up
    assert "seed-voices.sh" in rc[voices]
    avatar = _files()["/opt/acudx/avatar.sh"]
    assert 'ensure_image avatar acudx/avatar-runner:c726943-cu128 "$(avatar_key)"' in avatar
    assert "vllm_health" not in avatar
    imagegen = _files()["/opt/acudx/imagegen.sh"]
    assert 'ensure_image imagegen acudx/imagegen:flux2-klein-4b-cu128 "$(imagegen_key)"' in imagegen
    assert imagegen.index('"state":"ready"') < imagegen.index("http://localhost:8000/health") < imagegen.index(
        "up -d imagegen")


def test_the_workflow_builds_from_the_same_keys():
    wf = (ROOT / ".github" / "workflows" / "gpu-worker-images.yml").read_text(encoding="utf-8")
    assert "python infra/gpu-worker/worker_images.py keys" in wf
    assert "python infra/gpu-worker/worker_images.py context" in wf
    assert "ghcr.io/$owner/acudx-${{ matrix.name }}:${{ matrix.key }}" in wf
    assert "packages: write" in wf
    yaml.safe_load(wf)


def test_build_context_matches_where_the_worker_puts_the_files(tmp_path):
    wi = _wi()
    spec = next(s for s in wi.IMAGES if s.name == "chatterbox")
    wi.write_context(spec, tmp_path)
    assert (tmp_path / "docker/Dockerfile.acudx.gpu").read_text(encoding="utf-8") == _files()["/opt/acudx/chatterbox.Dockerfile"]
    rc = "\n".join(_runcmd())
    assert "/opt/acudx/chatterbox-tts-api/docker/Dockerfile.acudx.gpu" in rc
    assert "/opt/acudx/chatterbox-tts-api/app/acudx_patch.py" in rc


def test_the_worker_is_ready_for_a_call_before_vllm_has_loaded():
    """vLLM loads last, so /healthz (the gateway's readiness probe) answers once vLLM or the avatar runner
    answers /health; the live call does not wait for the LLM the production route does not use."""
    caddy = _files()["/opt/acudx/Caddyfile"]
    block = caddy[caddy.index("handle /healthz {"):]
    block = block[:block.index("handle /diag/")]
    assert "rewrite * /health" in block and "reverse_proxy vllm:8000 avatar:8010 {" in block
    assert "lb_policy first" in block and "health_uri /health" in block
    avatar = _files()["/opt/acudx/avatar.sh"]
    assert "chatterbox_health" not in avatar and "vllm_health" not in avatar
