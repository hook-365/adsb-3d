#!/usr/bin/env python3
"""Regenerate frontend/src/world/runways-data.json from OurAirports.

The airports layer (frontend/src/world/airports.ts) draws each runway
where it lies and, for lit hard-surface runways, the approach path to it.
This script takes OurAirports' public-domain runway list and keeps the
open runways with both ends surveyed, for the airports the app already
knows (frontend/src/feed/explore-airports.json: every large and medium
airport worldwide, and US small fields with an ICAO code).

    python3 scripts/build-runways.py

Pass --csv to reuse a runways.csv already on disk (stdlib only).

Data: OurAirports (https://ourairports.com/data/), public domain.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import io
import json
import sys
import urllib.request
from pathlib import Path

URL = "https://davidmegginson.github.io/ourairports-data/runways.csv"
ROOT = Path(__file__).resolve().parent.parent
AIRPORTS = ROOT / "frontend" / "src" / "feed" / "explore-airports.json"
OUT = ROOT / "frontend" / "src" / "world" / "runways-data.json"
# Surfaces an airliner or a business jet would use; OurAirports spells
# them many ways ("ASP", "ASPH-G", "CON", "PEM", "Asphalt").
HARD = ("ASP", "CON", "PEM", "BIT", "TAR", "PAV", "MAC")


def num(text: str | None) -> float | None:
    try:
        return float(text) if text not in (None, "") else None
    except ValueError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--csv", type=Path, help="runways.csv already on disk")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    known = {row[0] for row in json.loads(AIRPORTS.read_text(encoding="utf-8"))["airports"]}
    if args.csv:
        text = args.csv.read_text(encoding="utf-8")
    else:
        print(f"downloading {URL}", file=sys.stderr)
        req = urllib.request.Request(URL, headers={"User-Agent": "adsb-3d-build-runways"})
        with urllib.request.urlopen(req, timeout=300) as resp:
            text = resp.read().decode("utf-8")

    by_airport: dict[str, list] = {}
    count = 0
    for row in csv.DictReader(io.StringIO(text)):
        icao = (row.get("airport_ident") or "").strip().upper()
        if icao not in known or (row.get("closed") or "0").strip() == "1":
            continue
        ends = [num(row.get(k)) for k in ("le_latitude_deg", "le_longitude_deg", "he_latitude_deg", "he_longitude_deg")]
        if any(v is None for v in ends):
            continue
        le_lat, le_lon, he_lat, he_lon = ends
        # A runway of no length, or with an end off the planet, is a data slip.
        if (le_lat, le_lon) == (he_lat, he_lon) or not all(-90 <= v <= 90 for v in (le_lat, he_lat)):
            continue
        width = num(row.get("width_ft")) or 0
        surface = (row.get("surface") or "").upper()
        by_airport.setdefault(icao, []).append([
            (row.get("le_ident") or "").strip().upper(),
            (row.get("he_ident") or "").strip().upper(),
            round(le_lat, 5), round(le_lon, 5), round(he_lat, 5), round(he_lon, 5),
            int(round(min(max(width, 0), 500))),
            1 if (row.get("lighted") or "0").strip() == "1" else 0,
            1 if surface.startswith(HARD) else 0,
            int(round(num(row.get("le_elevation_ft")) or 0)),
            int(round(num(row.get("he_elevation_ft")) or 0)),
        ])
        count += 1

    if count < 5000:
        print(f"only {count} runways found; refusing to overwrite the data file", file=sys.stderr)
        return 1
    doc = {
        "source": "OurAirports (https://ourairports.com/data/), public domain",
        "generated": datetime.date.today().isoformat(),
        # icao -> [[low ident, high ident, low lat, low lon, high lat, high lon,
        #           width ft, lighted, hard surface, low elevation ft, high elevation ft]]
        "runways": dict(sorted(by_airport.items())),
    }
    args.out.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{count} runways at {len(by_airport)} airports, {args.out.stat().st_size} bytes -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
