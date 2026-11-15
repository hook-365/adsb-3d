#!/usr/bin/env python3
"""Regenerate frontend/src/world/airspace-data.json from FAA open data.

The 3D airspace layer (frontend/src/world/airspace.ts) draws US Class B, C
and D airspace and special use airspace (MOA, restricted, prohibited,
warning, alert) as extruded volumes. The FAA publishes both as GeoJSON
through its Aeronautical Data Delivery Service (ADDS), but at survey
density: about 570 MB and several million vertices. This script downloads
the two datasets, keeps the fields the layer uses, simplifies every outline
to roughly 50 m and writes one compact file that is committed to the repo,
so the running container never talks to the FAA.

Run it when a new chart cycle changes airspace (stdlib only):

    python3 scripts/build-airspace.py

Pass --class-file / --sua-file to reuse GeoJSON already on disk.

Source: https://adds-faa.opendata.arcgis.com (bulk download URLs as given
in the ADDS readme). Not for navigation.
"""

from __future__ import annotations

import argparse
import datetime
import json
import math
import sys
import tempfile
import urllib.request
from pathlib import Path

HUB = "https://hub.arcgis.com/api/v3/datasets/{item}_0/downloads/data?format=geojson&spatialRefId=4326&where=1%3D1"
CLASS_ITEM = "c6a62360338e408cb1512366ad61559e"
SUA_ITEM = "dd0d1b726e504137ab3c41b21835d05b"

OUT = Path(__file__).resolve().parent.parent / "frontend" / "src" / "world" / "airspace-data.json"

# Douglas-Peucker tolerance in degrees (about 50 m) and output precision
# (4 decimals, about 11 m). A Class B shelf is miles across; neither shows.
TOLERANCE_DEG = 0.0005
DECIMALS = 4
# "Unlimited" ceilings are capped here: well above anything ADS-B shows.
UNLIMITED_FT = 60000

CLASS_KINDS = {"B", "C", "D"}
# FAA TYPE_CODE for special use airspace -> kind id used by the frontend.
SUA_KINDS = {"MOA": "MOA", "R": "R", "P": "P", "W": "W", "A": "A"}


def download(item: str, dest: Path) -> None:
    url = HUB.format(item=item)
    print(f"downloading {url}", file=sys.stderr)
    req = urllib.request.Request(url, headers={"User-Agent": "adsb-3d-build-airspace"})
    with urllib.request.urlopen(req, timeout=600) as resp, dest.open("wb") as fh:
        while chunk := resp.read(1 << 20):
            fh.write(chunk)


def features(path: Path):
    """Yield features from the FAA export, which writes one per line.

    Streaming by line keeps memory flat on a 570 MB file; a differently
    formatted file falls back to loading it whole.
    """
    found = False
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line.startswith('{"type":"Feature"') and not line.startswith('{ "type": "Feature"'):
                continue
            found = True
            yield json.loads(line.rstrip(","))
    if not found:
        with path.open(encoding="utf-8") as fh:
            yield from json.load(fh)["features"]


def simplify_open(pts: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    """Iterative Douglas-Peucker on an open polyline."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        dx, dy = pts[b][0] - ax, pts[b][1] - ay
        length = math.hypot(dx, dy) or 1e-12
        worst, worst_i = 0.0, -1
        for i in range(a + 1, b):
            d = abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / length
            if d > worst:
                worst, worst_i = d, i
        if worst > tol:
            keep[worst_i] = True
            stack.append((a, worst_i))
            stack.append((worst_i, b))
    return [p for p, k in zip(pts, keep) if k]


def simplify_ring(ring: list[list[float]], tol: float) -> list[float] | None:
    """Simplify a closed ring; returns flat [lon, lat, ...] without the
    repeated closing point, or None when it collapses.

    A closed ring's first and last points coincide, which gives plain
    Douglas-Peucker a zero-length baseline, so the ring is split at the
    point farthest from its start and each half simplified on its own.
    """
    pts = [(p[0], p[1]) for p in ring]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        return None
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    first = simplify_open(pts[: far + 1], tol)
    second = simplify_open(pts[far:] + [pts[0]], tol)
    merged = first[:-1] + second[:-1]
    flat: list[float] = []
    prev = None
    for x, y in merged:
        q = (round(x, DECIMALS), round(y, DECIMALS))
        if q != prev:
            flat.extend(q)
            prev = q
    if len(flat) >= 4 and flat[0] == flat[-2] and flat[1] == flat[-1]:
        flat = flat[:-2]
    return flat if len(flat) >= 6 else None


def geometry(geom: dict | None) -> list[list[list[float]]]:
    """GeoJSON (Multi)Polygon -> [polygon][ring][flat lon/lat]; ring 0 is the outline."""
    if not geom:
        return []
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    out = []
    for poly in polys:
        rings = [r for r in (simplify_ring(ring, TOLERANCE_DEG) for ring in poly) if r]
        if rings and poly and simplify_ring(poly[0], TOLERANCE_DEG):
            out.append(rings)
    return out


def limit(val, uom, code) -> tuple[int, bool] | None:
    """One vertical limit -> (feet, above_ground). None when unusable."""
    if code == "UNLTD":
        return UNLIMITED_FT, False
    try:
        v = float(val)
    except (TypeError, ValueError):
        return None
    if v < 0:  # -9998 "not applicable" sentinel
        return None
    feet = v * 100 if uom == "FL" else v
    return int(round(feet)), code == "SFC"


def volume(props: dict, kind: str, geom: dict | None) -> dict | None:
    sector = props.get("SECTOR") or ""
    # Exclusion rows describe a hole in a neighbouring row, not a volume.
    # (The EXCLUSION column is not that flag: it also marks parents.)
    if sector.upper().startswith("EXCLUSION"):
        return None
    lo = limit(props.get("LOWER_VAL"), props.get("LOWER_UOM"), props.get("LOWER_CODE"))
    hi = limit(props.get("UPPER_VAL"), props.get("UPPER_UOM"), props.get("UPPER_CODE"))
    if lo is None:
        lo = (0, True)
    if hi is None:
        return None
    # Same reference and not above the floor: nothing to draw.
    if lo[1] == hi[1] and hi[0] <= lo[0]:
        return None
    polys = geometry(geom)
    if not polys:
        return None
    out: dict = {"n": (props.get("NAME") or "").strip(), "k": kind, "lo": lo[0], "hi": hi[0]}
    if lo[1]:
        out["la"] = 1
    if hi[1]:
        out["ha"] = 1
    if props.get("UPPER_CODE") == "UNLTD":
        out["u"] = 1
    if sector:
        out["s"] = sector.strip()
    times = (props.get("TIMESOFUSE") or "").strip()
    if times:
        out["t"] = times
    out["g"] = polys
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--class-file", type=Path, help="Class_Airspace GeoJSON already on disk")
    ap.add_argument("--sua-file", type=Path, help="Special_Use_Airspace GeoJSON already on disk")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        class_file = args.class_file
        if class_file is None:
            class_file = Path(tmp) / "class.geojson"
            download(CLASS_ITEM, class_file)
        sua_file = args.sua_file
        if sua_file is None:
            sua_file = Path(tmp) / "sua.geojson"
            download(SUA_ITEM, sua_file)

        volumes: list[dict] = []
        counts: dict[str, int] = {}
        for feat in features(class_file):
            kind = feat["properties"].get("CLASS")
            if kind in CLASS_KINDS:
                v = volume(feat["properties"], kind, feat.get("geometry"))
                if v:
                    volumes.append(v)
                    counts[kind] = counts.get(kind, 0) + 1
        for feat in features(sua_file):
            kind = SUA_KINDS.get(feat["properties"].get("TYPE_CODE") or "")
            if kind:
                v = volume(feat["properties"], kind, feat.get("geometry"))
                if v:
                    volumes.append(v)
                    counts[kind] = counts.get(kind, 0) + 1

    if not volumes:
        print("no volumes produced; refusing to overwrite the data file", file=sys.stderr)
        return 1
    # Stable order so a refresh diffs cleanly.
    volumes.sort(key=lambda v: (v["k"], v["n"], v.get("s", ""), v["lo"], v["hi"], v["g"][0][0][:2]))
    doc = {
        "source": "FAA Aeronautical Data Delivery Service (adds-faa.opendata.arcgis.com)",
        "generated": datetime.date.today().isoformat(),
        "volumes": volumes,
    }
    args.out.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    vertices = sum(len(r) // 2 for v in volumes for p in v["g"] for r in p)
    print(f"{len(volumes)} volumes {counts}, {vertices} vertices, {args.out.stat().st_size} bytes -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
