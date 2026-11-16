#!/usr/bin/env python3
"""Regenerate the airport radio frequencies from OurAirports.

The airport card (frontend/src/ui/airport-panel.ts) lists the frequencies
published for an airport: ATIS, clearance, ground, tower, approach,
departure, CTAF. This script takes OurAirports' airport-frequencies.csv,
keeps the airports the app knows (feed/explore-airports.json, so run
build-airports.py first) and the civil VHF channels, and writes

  frontend/src/world/frequencies-data.json

    python3 scripts/build-frequencies.py

Pass --csv to reuse a download (stdlib only). Refresh it when you refresh
the runways.

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

URL = "https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv"
ROOT = Path(__file__).resolve().parent.parent
AIRPORTS = ROOT / "frontend" / "src" / "feed" / "explore-airports.json"
OUT = ROOT / "frontend" / "src" / "world" / "frequencies-data.json"
# The order a flight meets them in; anything else sorts after, by name.
ORDER = ["ATIS", "AWOS", "ASOS", "CLD", "GND", "TWR", "CTAF", "UNIC", "DEP", "APP", "A/D"]
# The civil aeronautical voice band, MHz. Outside it are military UHF and
# company HF channels a scanner in this band will never hear.
BAND = (118.0, 137.0)
MAX_PER_AIRPORT = 16


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--csv", type=Path, help="airport-frequencies.csv already on disk")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    known = {row[0] for row in json.loads(AIRPORTS.read_text(encoding="utf-8"))["airports"]}
    if args.csv:
        text = args.csv.read_text(encoding="utf-8")
    else:
        print(f"downloading {URL}", file=sys.stderr)
        req = urllib.request.Request(URL, headers={"User-Agent": "adsb-3d-build-frequencies"})
        with urllib.request.urlopen(req, timeout=300) as resp:
            text = resp.read().decode("utf-8")

    by_airport: dict[str, list] = {}
    for row in csv.DictReader(io.StringIO(text)):
        icao = (row.get("airport_ident") or "").strip().upper()
        if icao not in known:
            continue
        try:
            mhz = float(row.get("frequency_mhz") or "")
        except ValueError:
            continue
        if not BAND[0] <= mhz <= BAND[1]:
            continue
        kind = (row.get("type") or "").strip().upper()[:8]
        name = " ".join((row.get("description") or "").split())[:40]
        if not kind:
            continue
        by_airport.setdefault(icao, []).append([kind, "" if name.upper() == kind else name, round(mhz, 3)])

    count = 0
    for icao, rows in by_airport.items():
        rows.sort(key=lambda r: (ORDER.index(r[0]) if r[0] in ORDER else len(ORDER), r[0], r[1], r[2]))
        seen: set[tuple] = set()
        kept = []
        for r in rows:
            if (r[0], r[2]) in seen:
                continue
            seen.add((r[0], r[2]))
            kept.append(r)
        by_airport[icao] = kept[:MAX_PER_AIRPORT]
        count += len(by_airport[icao])

    if count < 8000:
        print(f"only {count} frequencies found; refusing to overwrite the data file", file=sys.stderr)
        return 1
    doc = {
        "source": "OurAirports (https://ourairports.com/data/), public domain",
        "generated": datetime.date.today().isoformat(),
        # icao -> [[type, description ('' when it only repeats the type), MHz]]
        "frequencies": dict(sorted(by_airport.items())),
    }
    args.out.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{count} frequencies at {len(by_airport)} airports, {args.out.stat().st_size} bytes -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
