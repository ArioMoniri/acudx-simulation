#!/usr/bin/env python3
"""Download, verify and index the official terminologies AcuDx ships or links to.

Subcommands (run from the repository root, Python 3.10+, standard library only):

  icd10cm   CDC/NCHS ICD-10-CM FY2027 code descriptions + alphabetic index
            (public domain). Writes server/terminology/data/icd10cm-fy2027.json.gz
            (every code, billable flag, index-term synonyms). Redistributed.
  icd11     WHO ICD-11 MMS 2026-01 simple tabulation (CC BY-ND 3.0 IGO). Writes
            server/terminology/data/icd11-mms-2026-01.json.gz holding code, title and
            URI for every coded entity, unmodified. The WHO ICD-11 terms of use
            (sections 1.2.2 and 1.2.3, https://icd.who.int/en/docs/icd11-license.pdf)
            do not treat incorporation into software as an adaptation when code,
            title and URI are kept and WHO is attributed, so it is redistributed
            with the citation in NOTICE. No ICD-10 to ICD-11 crosswalk is produced
            (section 1.2.4 requires a separate WHO agreement).
  loinc     Looks up every LOINC code used by the lab and imaging catalogues on the
            HL7 public terminology server (tx.fhir.org, which serves the current
            LOINC release under the LOINC licence) and writes the official long
            common name, class, status and example UCUM unit to
            server/terminology/data/loinc-verified.json. Fails on an unknown or
            inactive code. LOINC is redistributable with its notice (see NOTICE).
  ranges    Fetches each reference-range source page cited in
            server/results/reference_ranges.json and records whether the cited
            low/high numbers appear on that page (data/terminology/range-verification.json).
  web       Writes web/src/domain/generated/orderCatalog.generated.json from the server
            catalogues (labels, LOINC codes, sections, turnaround) for order entry.
  check     Offline CI gate: outputs match MANIFEST.json, the web catalogue is in
            sync, every LOINC code in use is verified and active. No network.
  all       Everything above except check.

Every downloaded file is cached under data/terminology/cache/ (git-ignored) and its
SHA-256, size, URL, licence and fetch date are written to data/terminology/MANIFEST.json.
A second run with an unchanged upstream file reuses the cache and checks the checksum.

LOINC downloads from loinc.org need a free account; this script does not need one
because it only resolves individual codes. To work from the full LOINC table instead:
sign in at https://loinc.org/downloads/, download "LOINC Table File (CSV)" for the
current release, unzip it to data/terminology/cache/loinc/ and run
``build_terminology.py loinc --loinc-csv data/terminology/cache/loinc/LoincTable/Loinc.csv``.

Downloaded archives are treated as untrusted data: they are only parsed (zip, XML,
TSV), never executed. Education only.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import hashlib
import html
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from typing import Any, Iterable, Optional

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CACHE = os.path.join(ROOT, "data", "terminology", "cache")
MANIFEST = os.path.join(ROOT, "data", "terminology", "MANIFEST.json")
OUT_DIR = os.path.join(ROOT, "server", "terminology", "data")
RESULTS = os.path.join(ROOT, "server", "results")

ICD10CM = {
    "release": "FY2027",
    "effective": "2026-10-01",
    "descriptions_url": "https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/2027/icd10cm-code-descriptions-2027.zip",
    "index_url": "https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/2027/icd10cm-table-and-index-2027.zip",
    "licence": "Public domain (US Government work, CDC/NCHS). https://www.cdc.gov/nchs/icd/icd-10-cm/",
}
ICD11 = {
    "release": "2026-01",
    "url": "https://icdcdn.who.int/static/releasefiles/2026-01/SimpleTabulation-ICD-11-MMS-en.zip",
    "licence": "CC BY-ND 3.0 IGO, World Health Organization. https://icd.who.int/en/docs/icd11-license.pdf",
    "browser": "https://icd.who.int/browse/2026-01/mms/en",
}
TX_SERVER = "https://tx.fhir.org/r4"
USER_AGENT = "AcuDx-terminology-builder/1.0 (+https://github.com/ArioMoniri/acudx-simulation)"


# --------------------------------------------------------------------------- #
# Download + manifest                                                          #
# --------------------------------------------------------------------------- #
def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest() -> dict[str, Any]:
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as fh:
            return json.load(fh)
    return {"schema_version": 1, "files": {}, "outputs": {}}


def save_manifest(m: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(m, fh, indent=2, sort_keys=True)
        fh.write("\n")


def _get(url: str, timeout: int = 120, accept: str = "*/*") -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    last: Optional[Exception] = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError) as exc:  # transient network
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"download failed: {url}: {last}")


def fetch(name: str, url: str, licence: str, redistributed: bool, manifest: dict[str, Any]) -> str:
    """Download ``url`` into the cache once; verify the recorded checksum on reuse."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, os.path.basename(urllib.parse.urlparse(url).path))
    rec = manifest["files"].get(name)
    if os.path.exists(path) and rec and rec.get("url") == url:
        digest = _sha256(path)
        if digest != rec["sha256"]:
            raise SystemExit(f"checksum mismatch for cached {path}: {digest} != {rec['sha256']} (delete it to re-download)")
        return path
    data = _get(url)
    with open(path, "wb") as fh:
        fh.write(data)
    digest = _sha256(path)
    if rec and rec.get("url") == url and rec.get("sha256") != digest:
        print(f"note: upstream {name} changed (sha256 {rec['sha256'][:12]} -> {digest[:12]})", file=sys.stderr)
    manifest["files"][name] = {"url": url, "sha256": digest, "bytes": len(data), "fetched_at": _now(),
                               "licence": licence, "redistributed_in_repo": redistributed,
                               "cache_path": os.path.relpath(path, ROOT)}
    return path


def _write_output(manifest: dict[str, Any], key: str, path: str, **meta: Any) -> None:
    manifest["outputs"][key] = {"path": os.path.relpath(path, ROOT), "sha256": _sha256(path),
                                "bytes": os.path.getsize(path), "built_at": _now(), **meta}


# --------------------------------------------------------------------------- #
# ICD-10-CM                                                                    #
# --------------------------------------------------------------------------- #
def dotted(code: str) -> str:
    code = code.strip().upper().replace(".", "")
    return code if len(code) <= 3 else f"{code[:3]}.{code[3:]}"


def _title_text(el: Optional[ET.Element]) -> str:
    if el is None:
        return ""
    parts = [el.text or ""]
    for child in el:
        # <nemod> holds non-essential modifiers in parentheses; keep them as text.
        parts.append(" " + "".join(child.itertext()))
        parts.append(child.tail or "")
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def parse_icd10cm_index(xml_bytes: bytes) -> dict[str, list[str]]:
    """Map dotted code -> index phrases (main term plus subterm path), with simple
    ``see`` cross references resolved one level ("Attack, heart" -> Infarct, myocardium)."""
    root = ET.fromstring(xml_bytes)
    by_code: dict[str, list[str]] = {}
    by_path: dict[str, set[str]] = {}
    sees: list[tuple[str, str]] = []

    def key(parts: list[str]) -> str:
        # "Infarct, infarction" + "myocardium, myocardial (acute)" -> "infarct, myocardium"
        return ", ".join(re.split(r"[,(]", p, maxsplit=1)[0].strip().lower() for p in parts if p)

    def walk(el: ET.Element, trail: list[str]) -> None:
        title = _title_text(el.find("title"))
        path = trail + ([title] if title else [])
        code_el = el.find("code")
        phrase = ", ".join(p for p in path if p)
        if code_el is not None and code_el.text:
            code = dotted(code_el.text.rstrip("-"))
            by_code.setdefault(code, []).append(phrase)
            by_path.setdefault(key(path), set()).add(code)
        see = el.find("see")
        if see is not None and see.text:
            sees.append((phrase, re.sub(r"\s+", " ", "".join(see.itertext())).strip()))
        for sub in el.findall("term"):
            walk(sub, path)

    for letter in root.findall("letter"):
        for main in letter.findall("mainTerm"):
            walk(main, [])
    for phrase, target in sees:
        for code in by_path.get(key([t.strip() for t in target.split(",")]), ()):
            by_code.setdefault(code, []).append(phrase)
    return by_code


def build_icd10cm(manifest: dict[str, Any]) -> str:
    desc_zip = fetch("icd10cm_fy2027_descriptions", ICD10CM["descriptions_url"], ICD10CM["licence"], True, manifest)
    index_zip = fetch("icd10cm_fy2027_table_index", ICD10CM["index_url"], ICD10CM["licence"], True, manifest)
    with zipfile.ZipFile(desc_zip) as z:
        order_name = next(n for n in z.namelist() if re.search(r"icd10cm-order-\d{4}\.txt$", n))
        order_text = z.read(order_name).decode("utf-8", "replace")
    with zipfile.ZipFile(index_zip) as z:
        idx_name = next(n for n in z.namelist() if re.search(r"icd10cm-index-\d{4}\.xml$", n))
        synonyms = parse_icd10cm_index(z.read(idx_name))
    codes: list[list[Any]] = []
    for line in order_text.splitlines():
        # Fixed width: order(5) space code(7) space billable(1) space short(60) space long.
        if len(line) < 16:
            continue
        code = dotted(line[6:13].strip())
        billable = line[14] == "1"
        long_title = line[77:].strip() or line[16:76].strip()
        syn = []
        seen = {long_title.lower()}
        for s in synonyms.get(code, []):
            if s.lower() not in seen:
                seen.add(s.lower())
                syn.append(s)
        codes.append([code, long_title, 1 if billable else 0, syn[:12]])
    out = os.path.join(OUT_DIR, "icd10cm-fy2027.json.gz")
    os.makedirs(OUT_DIR, exist_ok=True)
    payload = {"system": "http://hl7.org/fhir/sid/icd-10-cm", "release": ICD10CM["release"], "effective": ICD10CM["effective"],
               "source": ICD10CM["descriptions_url"], "index_source": ICD10CM["index_url"], "licence": ICD10CM["licence"],
               "fields": ["code", "title", "billable", "index_terms"], "codes": codes}
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.GzipFile(out, "wb", mtime=0) as fh:  # mtime 0: byte-identical rebuilds
        fh.write(raw)
    _write_output(manifest, "icd10cm", out, count=len(codes), billable=sum(c[2] for c in codes))
    print(f"icd10cm: {len(codes)} codes ({sum(c[2] for c in codes)} billable) -> {os.path.relpath(out, ROOT)}")
    return out


# --------------------------------------------------------------------------- #
# ICD-11 MMS (cache only, not redistributed)                                   #
# --------------------------------------------------------------------------- #
def build_icd11(manifest: dict[str, Any]) -> str:
    zpath = fetch("icd11_mms_2026_01_simple_tabulation", ICD11["url"], ICD11["licence"], True, manifest)
    with zipfile.ZipFile(zpath) as z:
        name = next(n for n in z.namelist() if n.endswith(".txt") and "SimpleTabulation" in n)
        text = z.read(name).decode("utf-8-sig", "replace")
    rows = list(csv.reader(io.StringIO(text), delimiter="\t"))
    header = rows[0]
    col = {h.strip(): i for i, h in enumerate(header)}
    out_rows: list[list[Any]] = []
    for r in rows[1:]:
        if len(r) <= col["Code"]:
            continue
        code = r[col["Code"]].strip()
        if not code:
            continue
        title = r[col["Title"]].strip().strip('"').lstrip("- ").strip()
        uri = r[col["Linearization URI"]].strip()
        leaf = r[col.get("isLeaf", col.get("IsLeaf", 0))].strip().lower() == "true"
        out_rows.append([code, title, 1 if leaf else 0, uri])
    out = os.path.join(OUT_DIR, "icd11-mms-2026-01.json.gz")
    os.makedirs(OUT_DIR, exist_ok=True)
    payload = {"system": "http://id.who.int/icd/release/11/mms", "release": ICD11["release"], "licence": ICD11["licence"],
               "citation": ("International Classification of Diseases, Eleventh Revision (ICD-11), World Health Organization "
                            "(WHO) 2019 https://icd.who.int/browse11. Licensed under the Creative Commons "
                            "Attribution-NoDerivatives 3.0 IGO licence (CC BY-ND 3.0 IGO)."),
               "browser": ICD11["browser"], "source": ICD11["url"],
               "fields": ["code", "title", "leaf", "uri"], "codes": out_rows}
    with gzip.GzipFile(out, "wb", mtime=0) as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    manifest["outputs"].pop("icd11_cache_index", None)
    _write_output(manifest, "icd11", out, count=len(out_rows))
    print(f"icd11: {len(out_rows)} coded entities -> {os.path.relpath(out, ROOT)}")
    return out


# --------------------------------------------------------------------------- #
# LOINC                                                                        #
# --------------------------------------------------------------------------- #
def catalogue_loinc_codes() -> dict[str, list[str]]:
    """Every LOINC code the shipped catalogues use, with where it is used."""
    used: dict[str, list[str]] = {}

    def add(code: Optional[str], where: str) -> None:
        if code and re.fullmatch(r"\d{1,7}-\d", code):
            used.setdefault(code, []).append(where)

    with open(os.path.join(RESULTS, "reference_ranges.json"), encoding="utf-8") as fh:
        rr = json.load(fh)
    for a in rr["analytes"]:
        add(a["loinc"], "analyte")
    with open(os.path.join(RESULTS, "lab_catalog.json"), encoding="utf-8") as fh:
        lab = json.load(fh)
    for o in lab["orderables"]:
        add(o.get("loinc"), f"orderable:{o['code']}")
    with open(os.path.join(RESULTS, "imaging_catalog.json"), encoding="utf-8") as fh:
        img = json.load(fh)
    for p in img["procedures"]:
        add(p.get("loinc"), f"imaging:{p['code']}")
    return used


def _lookup_tx(code: str) -> dict[str, Any]:
    url = f"{TX_SERVER}/CodeSystem/$lookup?" + urllib.parse.urlencode({"system": "http://loinc.org", "code": code})
    try:
        body = json.loads(_get(url, timeout=60, accept="application/fhir+json"))
    except RuntimeError as exc:
        return {"code": code, "found": False, "error": str(exc)}
    if body.get("resourceType") != "Parameters":
        return {"code": code, "found": False, "error": "not found"}
    out: dict[str, Any] = {"code": code, "found": True}
    for p in body.get("parameter", []):
        if p.get("name") == "display":
            out["display"] = p.get("valueString")
        elif p.get("name") == "version":
            out["version"] = p.get("valueString")
        elif p.get("name") == "property":
            parts = {x["name"]: next((v for k, v in x.items() if k.startswith("value")), None) for x in p.get("part", [])}
            key = parts.get("code")
            if key in ("STATUS", "EXAMPLE_UCUM_UNITS", "CLASSTYPE", "ORDER_OBS", "inactive", "PanelType"):
                out[key] = parts.get("value")
            if key == "CLASSTYPE":
                out["CLASSTYPE_display"] = next((x.get("valueString") for x in p.get("part", []) if x["name"] == "description"), None)
    return out


def _lookup_csv(path: str) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    with open(path, encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            out[row["LOINC_NUM"]] = {"code": row["LOINC_NUM"], "found": True, "display": row.get("LONG_COMMON_NAME"),
                                     "STATUS": row.get("STATUS"), "EXAMPLE_UCUM_UNITS": row.get("EXAMPLE_UCUM_UNITS"),
                                     "ORDER_OBS": row.get("ORDER_OBS"), "CLASS": row.get("CLASS"),
                                     "version": row.get("VersionLastChanged")}
    return out


def build_loinc(manifest: dict[str, Any], loinc_csv: Optional[str] = None) -> str:
    used = catalogue_loinc_codes()
    table = _lookup_csv(loinc_csv) if loinc_csv else None
    out_path = os.path.join(OUT_DIR, "loinc-verified.json")
    previous: dict[str, Any] = {}
    if os.path.exists(out_path):
        with open(out_path, encoding="utf-8") as fh:
            previous = {c["code"]: c for c in json.load(fh)["codes"]}
    rows, bad = [], []
    for code in sorted(used, key=lambda c: (int(c.split("-")[0]), c)):
        rec = (table or {}).get(code) if table is not None else _lookup_tx(code)
        if rec is None:
            rec = {"code": code, "found": False, "error": "not in LOINC table"}
        if not rec.get("found") and code in previous and "error" in rec and "download failed" in rec["error"]:
            rec = previous[code]  # offline rerun keeps the last verified record
        rec["used_by"] = sorted(set(used[code]))
        if not rec.get("found") or str(rec.get("STATUS", "ACTIVE")).upper() not in ("ACTIVE", "TRIAL") or rec.get("inactive") is True:
            bad.append(rec)
        rows.append(rec)
    version = next((r.get("version") for r in rows if r.get("version")), None)
    payload = {"system": "http://loinc.org", "loinc_version": version,
               "resolved_via": loinc_csv and "LOINC table CSV" or f"{TX_SERVER} CodeSystem/$lookup",
               "verified_at": _now()[:10], "licence": "LOINC licence, https://loinc.org/license/ (notice in NOTICE)",
               "codes": rows}
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    _write_output(manifest, "loinc_verified", out_path, count=len(rows), loinc_version=version, failures=len(bad))
    print(f"loinc: {len(rows)} codes verified against LOINC {version}; {len(bad)} unknown or inactive")
    for b in bad:
        print(f"  BAD {b['code']}: {b.get('error') or b.get('STATUS')} used by {b['used_by']}", file=sys.stderr)
    return out_path if not bad else ""


# --------------------------------------------------------------------------- #
# Reference-range source verification                                          #
# --------------------------------------------------------------------------- #
def _page_text(url: str) -> str:
    raw = _get(url, timeout=60, accept="text/html").decode("utf-8", "replace")
    raw = re.sub(r"<(script|style)\b.*?</\1>", " ", raw, flags=re.S | re.I)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw)))


def _number_forms(x: float) -> Iterable[str]:
    if float(x).is_integer():
        n = int(x)
        yield str(n)
        yield f"{n:,}"
    else:
        yield f"{x:g}"
        yield f"{x:.1f}"
        yield f"{x:.2f}"


def build_range_verification(manifest: dict[str, Any]) -> str:
    with open(os.path.join(RESULTS, "reference_ranges.json"), encoding="utf-8") as fh:
        rr = json.load(fh)
    pages: dict[str, str] = {}
    rows = []
    for a in rr["analytes"]:
        url = a.get("source", "")
        rec: dict[str, Any] = {"loinc": a["loinc"], "name": a["name"], "source": url}
        if a.get("qualitative"):
            rec["check"] = "qualitative (normal value only)"
            rows.append(rec)
            continue
        if not url.startswith("http") or "doi.org" in url:
            rec["check"] = "DOI source: not machine-checked; a reviewer confirms against the paper"
            rows.append(rec)
            continue
        try:
            text = pages.get(url) or pages.setdefault(url, _page_text(url))
        except RuntimeError as exc:
            rec["check"] = f"fetch failed: {exc}"
            rows.append(rec)
            continue
        found = []
        if not a.get("ranges"):
            rec["check"] = "no reference interval (interpreted against serum or criteria)"
            rows.append(rec)
            continue
        # Bounds stored as a unit conversion are checked as printed on the page.
        numbers = [float(x) for x in a.get("source_numbers") or []] or [
            float(r[b]) for r in a["ranges"] for b in ("low", "high") if r.get(b) is not None]
        for v in numbers:
            found.append(any(f in text for f in _number_forms(v)) or v == 0)
        rec["check"] = "numbers found on page" if all(found) else "some numbers not found on page"
        rec["all_numbers_found"] = all(found)
        rows.append(rec)
    out = os.path.join(ROOT, "data", "terminology", "range-verification.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"verified_at": _now()[:10], "analytes": rows}, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    ok = sum(1 for r in rows if r.get("all_numbers_found"))
    _write_output(manifest, "range_verification", out, count=len(rows), numbers_found=ok)
    print(f"ranges: {ok}/{len(rows)} analytes had every cited bound found on the source page")
    return out


# --------------------------------------------------------------------------- #
# Web catalogue + offline consistency check (CI)                               #
# --------------------------------------------------------------------------- #
WEB_CATALOG = os.path.join(ROOT, "web", "src", "domain", "generated", "orderCatalog.generated.json")


def _public_catalog() -> dict[str, Any]:
    sys.path.insert(0, ROOT)
    from server.results import catalog  # noqa: PLC0415  (repository code, not downloaded data)

    return catalog.public_catalog()


def _catalog_bytes() -> bytes:
    return (json.dumps(_public_catalog(), indent=1, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def build_web(manifest: dict[str, Any]) -> str:
    os.makedirs(os.path.dirname(WEB_CATALOG), exist_ok=True)
    with open(WEB_CATALOG, "wb") as fh:
        fh.write(_catalog_bytes())
    _write_output(manifest, "web_order_catalog", WEB_CATALOG)
    print(f"web: order catalogue -> {os.path.relpath(WEB_CATALOG, ROOT)}")
    return WEB_CATALOG


def check() -> int:
    """Offline CI gate: committed outputs match the manifest, the web catalogue is
    in sync with the server catalogues, and every LOINC code in use was verified."""
    problems: list[str] = []
    manifest = load_manifest()
    for key, rec in manifest.get("outputs", {}).items():
        path = os.path.join(ROOT, rec["path"])
        if key == "web_order_catalog":
            continue
        if not os.path.exists(path):
            problems.append(f"{key}: missing {rec['path']} (run build_terminology.py {key.split('_')[0]})")
        elif _sha256(path) != rec["sha256"]:
            problems.append(f"{key}: {rec['path']} does not match MANIFEST.json (rebuild and commit both)")
    if not os.path.exists(WEB_CATALOG) or open(WEB_CATALOG, "rb").read() != _catalog_bytes():
        problems.append("web catalogue out of date: run `python scripts/terminology/build_terminology.py web`")
    verified_path = os.path.join(OUT_DIR, "loinc-verified.json")
    with open(verified_path, encoding="utf-8") as fh:
        verified = {c["code"]: c for c in json.load(fh)["codes"]}
    for code, where in catalogue_loinc_codes().items():
        rec = verified.get(code)
        if rec is None:
            problems.append(f"LOINC {code} ({', '.join(where)}) not verified: run build_terminology.py loinc")
        elif not rec.get("found") or str(rec.get("STATUS", "ACTIVE")).upper() not in ("ACTIVE", "TRIAL"):
            problems.append(f"LOINC {code} is {rec.get('STATUS') or rec.get('error')}")
    for p in problems:
        print("terminology check:", p, file=sys.stderr)
    print(f"terminology check: {'FAILED' if problems else 'ok'} ({len(problems)} problem(s))")
    return 1 if problems else 0


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["icd10cm", "icd11", "loinc", "ranges", "web", "check", "all"])
    ap.add_argument("--loinc-csv", help="path to Loinc.csv from the official LOINC table download")
    args = ap.parse_args(argv)
    if args.command == "check":
        return check()
    manifest = load_manifest()
    status = 0
    try:
        if args.command in ("web", "all"):
            build_web(manifest)
        if args.command in ("icd10cm", "all"):
            build_icd10cm(manifest)
        if args.command in ("icd11", "all"):
            build_icd11(manifest)
        if args.command in ("loinc", "all"):
            if not build_loinc(manifest, args.loinc_csv):
                status = 2
        if args.command in ("ranges", "all"):
            build_range_verification(manifest)
    finally:
        save_manifest(manifest)
    return status


if __name__ == "__main__":
    sys.exit(main())
