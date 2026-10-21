"""The GPU worker's three source-built images: build contexts and cache keys, from cloud-init.yaml.

cloud-init writes every file the worker needs; three images are built from them on a worker that has
no prebuilt copy (Chatterbox Multilingual TTS, the LiveTalking + MuseTalk avatar runner, the FLUX.2
klein image edit server). Each image is keyed by the sha256 of its inputs, exactly as
``image_key`` in the worker's /opt/acudx/images.sh computes it: the files' bytes in order, then the
pinned upstream commit, first 16 hex characters. The AcuDx Python code is mounted into the
containers at run time and is not part of any key, so a code change never forces a rebuild.

Used by .github/workflows/gpu-worker-images.yml to build and push
``ghcr.io/<owner>/acudx-<name>:<key>`` (the worker pulls that first), and by the tests.

    python infra/gpu-worker/worker_images.py keys                 # name key upstream ref
    python infra/gpu-worker/worker_images.py context <name> <dir> # write that image's build inputs
"""

from __future__ import annotations

import hashlib
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

CLOUD_INIT = Path(__file__).with_name("cloud-init.yaml")


@dataclass(frozen=True)
class ImageSpec:
    name: str
    local_tag: str
    files: tuple[str, ...]          # worker paths, in key order
    pin_var: str | None             # .env variable holding the upstream commit
    upstream: str | None            # git repository the context is checked out from
    context_files: dict[str, str]   # worker path -> path inside the build context
    dockerfile: str                 # path inside the build context


IMAGES: tuple[ImageSpec, ...] = (
    ImageSpec(
        name="chatterbox", local_tag="acudx/chatterbox-tts-api:a5f4661-cu124",
        files=("/opt/acudx/chatterbox.Dockerfile",), pin_var="CHATTERBOX_REF",
        upstream="https://github.com/travisvn/chatterbox-tts-api",
        context_files={"/opt/acudx/chatterbox.Dockerfile": "docker/Dockerfile.acudx.gpu",
                       "/opt/acudx/chatterbox-acudx-patch.py": "app/acudx_patch.py"},
        dockerfile="docker/Dockerfile.acudx.gpu"),
    ImageSpec(
        name="avatar", local_tag="acudx/avatar-runner:c726943-cu128",
        files=("/opt/acudx/avatar/Dockerfile.acudx", "/opt/acudx/avatar/acudx-constraints.txt"),
        pin_var="LIVETALKING_REF", upstream="https://github.com/lipku/LiveTalking",
        context_files={"/opt/acudx/avatar/Dockerfile.acudx": "Dockerfile.acudx",
                       "/opt/acudx/avatar/acudx-constraints.txt": "acudx-constraints.txt",
                       "/opt/acudx/avatar/acudx_avatar_server.py": "acudx_avatar_server.py",
                       "/opt/acudx/avatar/acudx_fetch_models.py": "acudx_fetch_models.py",
                       "/opt/acudx/avatar/acudx_register.py": "acudx_register.py"},
        dockerfile="Dockerfile.acudx"),
    ImageSpec(
        name="imagegen", local_tag="acudx/imagegen:flux2-klein-4b-cu128",
        files=("/opt/acudx/imagegen/Dockerfile",), pin_var=None, upstream=None,
        context_files={"/opt/acudx/imagegen/Dockerfile": "Dockerfile",
                       "/opt/acudx/imagegen/acudx_imagegen.py": "acudx_imagegen.py"},
        dockerfile="Dockerfile"),
)


def _cloud_init(path: Path = CLOUD_INIT) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def written_files(path: Path = CLOUD_INIT) -> dict[str, str]:
    """Every write_files entry: worker path -> content."""
    return {f["path"]: f["content"] for f in _cloud_init(path)["write_files"]}


def env_pins(path: Path = CLOUD_INIT) -> dict[str, str]:
    env = written_files(path)["/opt/acudx/.env"]
    out: dict[str, str] = {}
    for line in env.splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def image_key(contents: list[bytes], pin: str) -> str:
    """The same bytes ``image_key`` in images.sh hashes: the files in order, then the pin."""
    h = hashlib.sha256()
    for c in contents:
        h.update(c)
    h.update(pin.encode("utf-8"))
    return h.hexdigest()[:16]


def key_for(spec: ImageSpec, path: Path = CLOUD_INIT) -> str:
    files = written_files(path)
    pin = env_pins(path).get(spec.pin_var, "") if spec.pin_var else ""
    return image_key([files[f].encode("utf-8") for f in spec.files], pin)


def write_context(spec: ImageSpec, out: Path, path: Path = CLOUD_INIT) -> None:
    """The cloud-init files of ``spec`` placed where runcmd / avatar.sh place them in the build context
    (the upstream checkout at the pinned commit must already be in ``out``)."""
    files = written_files(path)
    for src, rel in spec.context_files.items():
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(files[src], encoding="utf-8")


def main(argv: list[str]) -> int:
    if len(argv) >= 1 and argv[0] == "keys":
        pins = env_pins()
        for spec in IMAGES:
            print(spec.name, key_for(spec), spec.upstream or "-", pins.get(spec.pin_var, "-") if spec.pin_var else "-",
                  spec.dockerfile)
        return 0
    if len(argv) == 3 and argv[0] == "context":
        spec = next((s for s in IMAGES if s.name == argv[1]), None)
        if spec is None:
            print(f"unknown image {argv[1]!r}", file=sys.stderr)
            return 2
        write_context(spec, Path(argv[2]))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
