#!/usr/bin/env python3
"""Regenerate frontend/src/feed/explore-cities.json from GeoNames.

The Explore picker (frontend/src/ui/place-picker.ts) lists a curated set
of world cities and, as you type, searches every US city in this file.
GeoNames' cities15000 dump has each populated place over 15,000 people
with coordinates, elevation and population; this script keeps the US
ones, drops sections of larger cities, and writes compact rows sorted by
population so the biggest match comes first.

    python3 scripts/build-cities.py

Pass --zip to reuse a cities15000.zip already on disk (stdlib only).

Data: GeoNames (https://www.geonames.org), licensed CC BY 4.0. Keep the
credit in README.md.
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

URL = "https://download.geonames.org/export/dump/cities15000.zip"
OUT = Path(__file__).resolve().parent.parent / "frontend" / "src" / "feed" / "explore-cities.json"
FT_PER_M = 3.28084
# PPLX is a section of a populated place (Hollywood, Brooklyn): the city
# it belongs to is already in the list and covers the same sky.
SKIP_FEATURE_CODES = {"PPLX"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--zip", type=Path, help="cities15000.zip already on disk")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    if args.zip:
        blob = args.zip.read_bytes()
    else:
        print(f"downloading {URL}", file=sys.stderr)
        req = urllib.request.Request(URL, headers={"User-Agent": "adsb-3d-build-cities"})
        with urllib.request.urlopen(req, timeout=300) as resp:
            blob = resp.read()
    text = zipfile.ZipFile(io.BytesIO(blob)).read("cities15000.txt").decode("utf-8")

    rows = []
    for line in text.splitlines():
        f = line.split("\t")
        if len(f) < 17 or f[8] != "US" or f[7] in SKIP_FEATURE_CODES or not f[10]:
            continue
        elevation_m = f[15] or f[16] or "0"
        rows.append(
            {
                "id": int(f[0]),
                "name": f[1],
                "state": f[10],
                "lat": round(float(f[4]), 4),
                "lon": round(float(f[5]), 4),
                "alt": max(0, int(round(float(elevation_m) * FT_PER_M / 10.0)) * 10),
                "pop": int(f[14] or 0),
            }
        )
    if len(rows) < 1000:
        print(f"only {len(rows)} US cities found; refusing to overwrite the data file", file=sys.stderr)
        return 1
    rows.sort(key=lambda r: (-r["pop"], r["name"], r["state"], r["id"]))
    doc = {
        "source": "GeoNames cities15000 (https://www.geonames.org), CC BY 4.0",
        "generated": datetime.date.today().isoformat(),
        # [name, state, lat, lon, elevation ft], most populous first. Ids are
        # derived from name + state in explore-places.ts, so keep the order
        # rule stable: it breaks ties between same-named cities in a state.
        "cities": [[r["name"], r["state"], r["lat"], r["lon"], r["alt"]] for r in rows],
    }
    args.out.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(rows)} cities, {args.out.stat().st_size} bytes -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
