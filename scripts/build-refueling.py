#!/usr/bin/env python3
"""Regenerate the US air refueling tracks.

The aircraft card (frontend/src/world/activity.ts) can say that a military
aircraft is flying along a published air refueling track ("AR-109"). This
script takes the track overlay tar1090 ships, the same lines its map draws
as "US A2A Refueling", and writes

  frontend/src/world/refueling-data.json

    python3 scripts/build-refueling.py

Pass --geojson to reuse a download (stdlib only). The tracks change rarely.

Data: tar1090's US_A2A_refueling.geojson
(https://github.com/wiedehopf/tar1090), GPL v2+: the generated file carries
that licence, not this repo's MIT. Not for navigation.
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
import urllib.request
from pathlib import Path

URL = "https://raw.githubusercontent.com/wiedehopf/tar1090/master/html/geojson/US_A2A_refueling.geojson"
OUT = Path(__file__).resolve().parent.parent / "frontend" / "src" / "world" / "refueling-data.json"
DECIMALS = 3  # about 100 m; a track is miles wide


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--geojson", type=Path, help="the overlay's GeoJSON already on disk")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    if args.geojson:
        doc = json.loads(args.geojson.read_text(encoding="utf-8"))
    else:
        print(f"downloading {URL}", file=sys.stderr)
        req = urllib.request.Request(URL, headers={"User-Agent": "adsb-3d-build-refueling"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            doc = json.loads(resp.read().decode("utf-8"))

    tracks: dict[str, dict] = {}
    for feature in doc.get("features", []):
        # One feature spells its key "name " with a trailing space.
        props = {k.strip(): v for k, v in (feature.get("properties") or {}).items()}
        name = " ".join(str(props.get("name") or "").split())
        geometry = feature.get("geometry") or {}
        if geometry.get("type") == "LineString":
            line = geometry["coordinates"]
        elif geometry.get("type") == "Polygon":
            line = geometry["coordinates"][0]
        else:
            continue
        pts = [[round(lat, DECIMALS), round(lon, DECIMALS)] for lon, lat, *_ in line]
        pts = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
        if name and len(pts) >= 2:
            tracks[name] = {"id": name, "pts": pts}

    if len(tracks) < 100:
        print(f"only {len(tracks)} tracks found; refusing to overwrite the data file", file=sys.stderr)
        return 1
    out = {
        "source": "tar1090 US_A2A_refueling.geojson (https://github.com/wiedehopf/tar1090), GPL v2+. Not for navigation.",
        "generated": datetime.date.today().isoformat(),
        "tracks": [tracks[k] for k in sorted(tracks)],
    }
    args.out.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    points = sum(len(t["pts"]) for t in tracks.values())
    print(f"{len(tracks)} tracks, {points} points, {args.out.stat().st_size} bytes -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
