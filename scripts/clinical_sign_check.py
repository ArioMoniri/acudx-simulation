"""Clinical-sign test set for the patient appearance model (docs/media/live-avatar/signs/).

One adult case portrait per visible sign is edited on a GPU worker's image edit server (the same
``/imagegen/edit`` the live call uses, with :func:`server.voice.avatar.appearance.edit_prompt`), and
each edit is scored by a vision check (Claude, original and edit side by side): is the requested sign
clearly visible, is anything else drawn that was not asked for, does the person stay the same. The
sheet (sheet.jpg), the pictures and the scores (signs.json) go to ``--out``.

usage: WORKER_TOKEN=... ANTHROPIC_KEY=... python -I scripts/clinical_sign_check.py \
         --worker https://<ip>.sslip.io --out docs/media/live-avatar/signs
Without ANTHROPIC_KEY the pictures and the sheet are still made and the scores say "not scored".
Education only; synthetic patients; no minors are used for any sign.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import os
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import httpx  # noqa: E402

from server.voice.avatar import appearance as ap  # noqa: E402
from server.voice.avatar import musetalk as mt  # noqa: E402
from server.voice.avatar.tint import warm_flush  # noqa: E402

# (sign, level, portrait id, plain description for the vision check). Adults only.
SIGN_SET: list[tuple[str, int, str, str]] = [
    ("petechiae", 2, "p11", "tiny pinpoint red-purple petechiae on the face or neck"),
    ("purpura", 2, "p25", "a purpuric, non-blanching purple-red rash (as in meningococcal sepsis) on the face or neck"),
    ("urticaria", 2, "p08", "urticaria: raised pink wheals (hives) on the face or neck"),
    ("jaundice", 2, "p05", "jaundice: yellow skin"),
    ("scleral_icterus", 2, "p22", "scleral icterus: yellow whites of the eyes"),
    ("cyanosis", 2, "p26", "central cyanosis: blue-grey lips and perioral area"),
    ("pallor", 2, "p13", "pallor: pale, greyish skin"),
    ("mottling", 2, "p16", "mottled, blotchy purple-grey skin on the neck or face"),
    ("diaphoresis", 2, "p14", "diaphoresis: visible beads of sweat"),
    ("flushing", 2, "p03", "flushing: an even red flush of the face and neck"),
    ("fever_flush", 2, "p04", "a feverish, unwell face with a warm flush"),
    ("facial_droop", 2, "p24", "facial droop: one side of the face and mouth drooping"),
    ("periorbital_oedema", 2, "p09", "periorbital oedema: swollen puffy eyelids"),
    ("facial_swelling", 2, "p31", "facial or lip swelling (angioedema)"),
    ("wound", 2, "p19", "a wound (laceration) on the forehead"),
    ("burn", 2, "p23", "a burn on the cheek or chin"),
    ("dehydration", 2, "p06", "dehydration: dry cracked lips and sunken eyes"),
    ("resp_distress", 2, "p15", "respiratory distress: flared nostrils, straining"),
    ("accessory_muscles", 2, "p17", "accessory muscle use: neck muscles standing out"),
]

VISION_PROMPT = """You are checking a medical-education image edit. Image 1 is the original synthetic patient \
portrait, image 2 is the edit. The edit was asked to show exactly one finding: {desc}.
Answer only JSON: {{"visible": true|false (is the finding clearly visible in image 2 and not in image 1), \
"confidence": 0..1, "same_person": true|false, "unintended": [other clinical findings visible in image 2 \
that were not asked for], "notes": "one short sentence"}}"""


def _jpeg(img_bytes: bytes, size: int = 360) -> bytes:
    from PIL import Image

    im = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    im.thumbnail((size, size))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=88)
    return out.getvalue()


async def score(client: httpx.AsyncClient, key: str, model: str, base: bytes, edit: bytes, desc: str) -> dict:
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(_jpeg(base, 640)).decode()}},
        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(_jpeg(edit, 640)).decode()}},
        {"type": "text", "text": VISION_PROMPT.format(desc=desc)},
    ]
    r = await client.post("https://api.anthropic.com/v1/messages", timeout=120.0,
                          headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                          json={"model": model, "max_tokens": 400, "messages": [{"role": "user", "content": content}]})
    r.raise_for_status()
    text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
    try:
        return json.loads(text[text.index("{"): text.rindex("}") + 1])
    except ValueError:
        return {"visible": None, "notes": text[:200]}


def sheet(rows: list[dict], out: Path) -> None:
    from PIL import Image, ImageDraw

    cell, pad, label_h = 240, 8, 46
    cols = 5
    n = len(rows)
    lines = (n + cols - 1) // cols
    W, H = cols * (cell + pad) + pad, lines * (cell + label_h + pad) + pad
    canvas = Image.new("RGB", (W, H), (250, 250, 248))
    d = ImageDraw.Draw(canvas)
    for i, row in enumerate(rows):
        x = pad + (i % cols) * (cell + pad)
        y = pad + (i // cols) * (cell + label_h + pad)
        im = Image.open(out / row["file"]).convert("RGB")
        im.thumbnail((cell, cell))
        canvas.paste(im, (x + (cell - im.width) // 2, y))
        v = row.get("vision") or {}
        verdict = "not scored" if v.get("visible") is None else ("PASS" if v.get("visible") else "FAIL")
        conf = v.get("confidence")
        d.text((x, y + cell + 4), row["sign"], fill=(20, 20, 20))
        d.text((x, y + cell + 20), f"{verdict}" + (f" ({conf:.2f})" if isinstance(conf, (int, float)) else ""),
               fill=(0, 110, 60) if verdict == "PASS" else (170, 30, 30) if verdict == "FAIL" else (90, 90, 90))
    canvas.save(out / "sheet.jpg", "JPEG", quality=90)


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--worker", required=True)
    p.add_argument("--out", default=str(REPO / "docs" / "media" / "live-avatar" / "signs"))
    p.add_argument("--model", default="claude-opus-5-5")
    p.add_argument("--only", default="")
    a = p.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    worker = mt.WorkerAvatar(a.worker.rstrip("/"), os.environ["WORKER_TOKEN"])
    key = os.environ.get("ANTHROPIC_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    only = {s for s in a.only.split(",") if s}
    rows: list[dict] = []
    async with httpx.AsyncClient() as client:
        health = await mt.imagegen_health(client, worker)
        for sign, level, photo, desc in SIGN_SET:
            if only and sign not in only:
                continue
            portrait = mt.portrait_path(photo)
            assert portrait is not None, photo
            look = ap.Look(signs={sign: level})
            prompt = ap.edit_prompt(look)
            t0 = time.monotonic()
            try:
                img, meta = await mt.imagegen_edit(client, worker, portrait.read_bytes(), prompt, seed=1234)
            except (mt.AvatarWorkerError, httpx.HTTPError) as exc:
                rows.append({"sign": sign, "photo": photo, "error": str(exc)[:200]})
                continue
            if sign == "fever_flush":
                img = warm_flush(img, level)   # the live path adds the fever colour after the edit
            fname = f"{sign}-{photo}.jpg"
            (out / fname).write_bytes(img)
            row = {"sign": sign, "level": level, "photo": photo, "file": fname, "prompt": prompt,
                   "gen_ms": meta.get("gen_ms"), "mode": meta.get("mode"), "wall_ms": round((time.monotonic() - t0) * 1000)}
            if key:
                try:
                    row["vision"] = await score(client, key, a.model, portrait.read_bytes(), img, desc)
                except httpx.HTTPError as exc:
                    row["vision"] = {"visible": None, "notes": f"vision check failed: {type(exc).__name__}"}
            else:
                row["vision"] = {"visible": None, "notes": "not scored: no ANTHROPIC_KEY"}
            print(json.dumps({k: row[k] for k in ("sign", "photo", "gen_ms")} | {"vision": row["vision"]}), flush=True)
            rows.append(row)
    good = [r for r in rows if "file" in r]
    if good:
        sheet(good, out)
    scored = [r for r in good if (r.get("vision") or {}).get("visible") is not None]
    summary = {"model": health.get("model"), "licence": health.get("licence"), "mode": health.get("mode"),
               "vision_model": a.model if key else None, "signs": len(rows),
               "passed": sum(1 for r in scored if r["vision"]["visible"]), "scored": len(scored),
               "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    (out / "signs.json").write_text(json.dumps({"summary": summary, "rows": rows}, indent=2) + "\n")
    print(json.dumps(summary))


if __name__ == "__main__":
    asyncio.run(main())
