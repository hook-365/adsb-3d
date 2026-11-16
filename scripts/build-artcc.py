#!/usr/bin/env python3
"""Regenerate the US air route traffic control centre boundaries.

The airspace layer (frontend/src/world/artcc.ts) can outline the centres
(ARTCCs: Minneapolis, Chicago, ...) and say which one an aircraft is in.
This script takes the FAA's "Airspace Boundary" open dataset, keeps the
ARTCC outlines and writes

  frontend/src/world/artcc-data.json

    python3 scripts/build-artcc.py

Pass --geojson to reuse a download (stdlib only). The boundaries change
rarely; refresh with the airspace file.

Data: FAA Aeronautical Information Services open data
(https://adds-faa.opendata.arcgis.com), public domain. Not for navigation.
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
import urllib.request
from pathlib import Path

URL = (
    "https://hub.arcgis.com/api/v3/datasets/67885972e4e940b2aa6d74024901c561_0/downloads/data"
    "?format=geojson&spatialRefId=4326&where=1%3D1"
)
OUT = Path(__file__).resolve().parent.parent / "frontend" / "src" / "world" / "artcc-data.json"
DECIMALS = 3  # about 100 m; a centre is hundreds of miles across


def rings(geometry: dict) -> list[list[list[float]]]:
    """Outer rings of a Polygon or MultiPolygon, as [[lat, lon], ...]."""
    polys = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    out = []
    for poly in polys:
        ring = [[round(lat, DECIMALS), round(lon, DECIMALS)] for lon, lat, *_ in poly[0]]
        # Rounding can repeat a point; a repeat adds nothing.
        ring = [p for i, p in enumerate(ring) if i == 0 or p != ring[i - 1]]
        if len(ring) >= 4:
            out.append(ring)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--geojson", type=Path, help="the dataset's GeoJSON export already on disk")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    if args.geojson:
        doc = json.loads(args.geojson.read_text(encoding="utf-8"))
    else:
        print(f"downloading {URL}", file=sys.stderr)
        req = urllib.request.Request(URL, headers={"User-Agent": "adsb-3d-build-artcc"})
        with urllib.request.urlopen(req, timeout=600) as resp:
            doc = json.loads(resp.read().decode("utf-8"))

    # A centre is listed once per level (low, high) with nearly the same
    # outline: the low one is the one traffic near an airport is in.
    centres: dict[str, dict] = {}
    for feature in doc.get("features", []):
        p = feature.get("properties") or {}
        ident = (p.get("IDENT") or "").strip().upper()
        if p.get("TYPE_CODE") != "ARTCC" or not ident or not feature.get("geometry"):
            continue
        if ident in centres and p.get("LEVEL_") != "L":
            continue
        outline = rings(feature["geometry"])
        if outline:
            centres[ident] = {"id": ident, "name": (p.get("NAME") or ident).strip().title(), "rings": outline}

    if len(centres) < 18:
        print(f"only {len(centres)} centres found; refusing to overwrite the data file", file=sys.stderr)
        return 1
    out = {
        "source": "FAA Aeronautical Information Services open data, public domain. Not for navigation.",
        "generated": datetime.date.today().isoformat(),
        "centres": [centres[k] for k in sorted(centres)],
    }
    args.out.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    points = sum(len(r) for c in centres.values() for r in c["rings"])
    print(f"{len(centres)} centres, {points} points, {args.out.stat().st_size} bytes -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
