#!/usr/bin/env python3
"""Regenerate frontend/src/feed/explore-airports.json from OurAirports.

The Explore picker (frontend/src/ui/place-picker.ts) can jump to an
airport by ICAO or IATA code or by name ("KMSP", "ATW", "heathrow"). This
script takes OurAirports' public-domain airport list and keeps every
large and medium airport worldwide plus US small airports, as long as
they have a four-character ICAO code, writing compact rows with the big
airports first so they win ties in search.

    python3 scripts/build-airports.py

Pass --csv to reuse an airports.csv already on disk (stdlib only).

Data: OurAirports (https://ourairports.com/data/), public domain.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
OUT = Path(__file__).resolve().parent.parent / "frontend" / "src" / "feed" / "explore-airports.json"
RANK = {"large_airport": 0, "medium_airport": 1, "small_airport": 2}
ICAO = re.compile(r"[A-Z0-9]{4}")


def icao_of(row: dict) -> str:
    for field in ("icao_code", "gps_code", "ident"):
        code = (row.get(field) or "").strip().upper()
        if ICAO.fullmatch(code) and not code.isdigit():
            return code
    return ""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--csv", type=Path, help="airports.csv already on disk")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    if args.csv:
        text = args.csv.read_text(encoding="utf-8")
    else:
        print(f"downloading {URL}", file=sys.stderr)
        req = urllib.request.Request(URL, headers={"User-Agent": "adsb-3d-build-airports"})
        with urllib.request.urlopen(req, timeout=300) as resp:
            text = resp.read().decode("utf-8")

    picked: dict[str, tuple] = {}
    for row in csv.DictReader(io.StringIO(text)):
        kind = row.get("type") or ""
        if kind not in RANK:
            continue
        if kind == "small_airport" and row.get("iso_country") != "US":
            continue
        # Only the ICAO column for small fields: their gps_code is often an
        # FAA identifier that merely looks like one.
        code = icao_of(row) if kind != "small_airport" else (row.get("icao_code") or "").strip().upper()
        if not ICAO.fullmatch(code or ""):
            continue
        try:
            lat = round(float(row["latitude_deg"]), 4)
            lon = round(float(row["longitude_deg"]), 4)
        except (KeyError, ValueError):
            continue
        try:
            alt = max(0, int(round(float(row.get("elevation_ft") or 0) / 10.0)) * 10)
        except ValueError:
            alt = 0
        key = (RANK[kind], 0 if row.get("scheduled_service") == "yes" else 1, row.get("name") or "")
        entry = (key, [code, (row.get("iata_code") or "").strip().upper(), (row.get("name") or "").strip(),
                       (row.get("municipality") or "").strip(), (row.get("iso_country") or "").strip(), lat, lon, alt])
        # One airport per ICAO code; the more significant row wins.
        if code not in picked or key < picked[code][0]:
            picked[code] = entry

    rows = [entry for _, entry in sorted(picked.values(), key=lambda e: (e[0], e[1][0]))]
    if len(rows) < 3000:
        print(f"only {len(rows)} airports found; refusing to overwrite the data file", file=sys.stderr)
        return 1
    doc = {
        "source": "OurAirports (https://ourairports.com/data/), public domain",
        "generated": datetime.date.today().isoformat(),
        # [icao, iata, name, municipality, country, lat, lon, elevation ft];
        # large airports first, then medium, then US small fields.
        "airports": rows,
    }
    args.out.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(rows)} airports, {args.out.stat().st_size} bytes -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
