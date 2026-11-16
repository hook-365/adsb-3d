#!/usr/bin/env python3
"""Regenerate frontend/src/world/navdata.json from the FAA's CIFP.

The navigation layer (frontend/src/world/navdata.ts) draws the airways,
the VORs and NDBs, and the named fixes along the airways. They come from
the same Coded Instrument Flight Procedures edition as the instrument
procedures (scripts/build-procedures.py), so run the two together, once
per 28-day cycle.

    python3 scripts/build-navdata.py

Pass --zip to reuse a CIFP zip already on disk (stdlib only).

Data: FAA CIFP, not copyrighted. Not for navigation.
"""

from __future__ import annotations

import argparse
import datetime
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

API = "https://external-api.faa.gov/apra/cifp/chart?edition=current"
OUT_DIR = Path(__file__).resolve().parent.parent / "frontend" / "src" / "world"
UA = {"User-Agent": "adsb-3d-build-navdata", "Accept": "application/json"}


def coord(text: str) -> float | None:
    text = text.strip()
    if len(text) < 9 or text[0] not in "NSEW":
        return None
    digits = text[1:]
    try:
        if text[0] in "NS":
            d, m, s = int(digits[0:2]), int(digits[2:4]), int(digits[4:8]) / 100.0
        else:
            d, m, s = int(digits[0:3]), int(digits[3:5]), int(digits[5:9]) / 100.0
    except ValueError:
        return None
    value = d + m / 60.0 + s / 3600.0
    return round(-value if text[0] in "SW" else value, 4)


def position(line: str, at: int = 32) -> tuple[float, float] | None:
    lat, lon = coord(line[at:at + 9]), coord(line[at + 9:at + 19])
    return (lat, lon) if lat is not None and lon is not None else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--zip", type=Path, help="CIFP_YYMMDD.zip already on disk")
    ap.add_argument("--out", type=Path, default=OUT_DIR, help="directory to write into (default: the frontend's)")
    args = ap.parse_args()
    OUT = args.out / "navdata.json"  # noqa: N806
    if args.zip:
        blob = args.zip.read_bytes()
    else:
        with urllib.request.urlopen(urllib.request.Request(API, headers=UA), timeout=60) as resp:
            url = json.loads(resp.read().decode("utf-8"))["edition"][0]["product"]["url"]
        print(f"downloading {url}", file=sys.stderr)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as resp:
            blob = resp.read()
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        lines = z.read("FAACIFP18").decode("latin-1").splitlines()

    # (ident, region) -> position, for everything an airway can pass over.
    where: dict[tuple[str, str], tuple[float, float]] = {}
    navaids: list[list] = []
    for line in lines:
        if len(line) < 132 or line[0] != "S" or line[21] not in "01":
            continue
        section, sub = line[4], line[5]
        if section == "E" and sub == "A":
            pos = position(line)
            if pos:
                where[(line[13:18].strip(), line[19:21])] = pos
        elif section == "D" and sub in " B":
            pos = position(line) or position(line, 55)
            if not pos:
                continue
            ident, region = line[13:17].strip(), line[19:21]
            where[(ident, region)] = pos
            freq = line[22:27].strip()
            name = line[93:123].strip().title()
            if sub == "B":
                # NDB frequency is in tenths of kHz.
                navaids.append([ident, "N", pos[0], pos[1], int(freq) / 10.0 if freq.isdigit() else 0, name])
            elif line[27] == "V":
                # A VOR, with or without DME or TACAN. ILS DMEs and lone
                # TACANs are left out: not something an airway turns on.
                kind = "T" if line[28] == "T" else "D" if line[28] == "D" else "V"
                navaids.append([ident, kind, pos[0], pos[1], int(freq) / 100.0 if freq.isdigit() else 0, name])

    # Airways: consecutive ER records of one route in one area are its fixes in order.
    airways: list[list] = []
    points: dict[tuple[str, str], int] = {}
    table: list[list] = []
    current: tuple[str, str] | None = None
    for line in lines:
        if len(line) < 132 or line[0] != "S" or line[4] != "E" or line[5] != "R":
            continue
        key = (line[1:4], line[13:18].strip())
        fix = (line[29:34].strip(), line[34:36])
        pos = where.get(fix)
        if key != current:
            current = key
            # level: L low, H high, B both
            airways.append([key[1], line[45] if line[45] in "LH" else "B", []])
        if pos is None:
            continue
        if fix not in points:
            points[fix] = len(table)
            table.append([fix[0], pos[0], pos[1]])
        airways[-1][2].append(points[fix])
    airways = [a for a in airways if len(a[2]) >= 2]

    if len(airways) < 1000 or len(navaids) < 800:
        print(f"only {len(airways)} airways and {len(navaids)} navaids; refusing to overwrite", file=sys.stderr)
        return 1
    doc = {
        "source": "FAA Coded Instrument Flight Procedures (CIFP), not copyrighted. Not for navigation.",
        "generated": datetime.date.today().isoformat(),
        # [ident, kind (V VOR, D VOR/DME, T VORTAC, N NDB), lat, lon, frequency (MHz, or kHz for an NDB), name]
        "navaids": navaids,
        # [ident, lat, lon]: every fix or navaid an airway passes over
        "points": table,
        # [ident, level (L low, H high, B both), [index into points, ...]]
        "airways": airways,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(airways)} airways over {len(table)} points, {len(navaids)} navaids, {OUT.stat().st_size} bytes -> {OUT}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
