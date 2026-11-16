#!/usr/bin/env python3
"""Regenerate the airport ground detail from OpenStreetMap.

Up close, the airports layer (frontend/src/world/airport-ground.ts) draws
an airport's taxiways, aprons, terminal buildings and gate numbers. This
script asks the Overpass API for those features around the biggest
airports the app knows and writes

  frontend/src/world/airport-ground-index.json   icao -> [offset, length]
  frontend/src/world/airport-ground.pack         one gzipped JSON chunk per
                                                 airport, end to end

    python3 scripts/build-airport-ground.py --count 300

The app range-requests one airport's chunk when the camera gets close, so
nobody downloads the pack whole, and nothing asks Overpass at runtime: the
public servers are often slow or full, which is also why this script is
patient. It asks for a few airports per query, waits and retries across
mirrors, and keeps every answer in --cache so an interrupted run resumes. Airports are the large ones
with scheduled service, most runway first (--count of them).

Run build-airports.py and build-runways.py first: airports are taken in
the app's own order (largest first) and boxed around their runways.
Stdlib only.

Data: (c) OpenStreetMap contributors, ODbL 1.0
(https://www.openstreetmap.org/copyright). The app credits it while the
layer is drawn.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import gzip
import io
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AIRPORTS = ROOT / "frontend" / "src" / "feed" / "explore-airports.json"
RUNWAYS = ROOT / "frontend" / "src" / "world" / "runways-data.json"
INDEX = ROOT / "frontend" / "src" / "world" / "airport-ground-index.json"
PACK = ROOT / "frontend" / "src" / "world" / "airport-ground.pack"
AIRPORTS_CSV = "https://davidmegginson.github.io/ourairports-data/airports.csv"
MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
UA = {"User-Agent": "adsb-3d-build-airport-ground (https://github.com/hook-365/adsb-3d)"}
# Room around the runways for the terminals and aprons, degrees of latitude (about 0.7 NM).
MARGIN_DEG = 0.012
SCALE = 100000  # 1e-5 degree, about a metre
# Douglas-Peucker tolerance, in the same units (about 1.5 m).
TOLERANCE = 1.5
MAX_GATES = 400


def ranked(csv_path: Path | None) -> list[str]:
    """ICAO codes of the app's large airports with scheduled service, most runway first.

    OurAirports has no traffic figures; total runway length is a fair
    stand-in for "big", and it puts the hubs at the front.
    """
    if csv_path:
        text = csv_path.read_text(encoding="utf-8")
    else:
        print(f"downloading {AIRPORTS_CSV}", file=sys.stderr)
        with urllib.request.urlopen(urllib.request.Request(AIRPORTS_CSV, headers=UA), timeout=300) as resp:
            text = resp.read().decode("utf-8")
    known = {row[0] for row in json.loads(AIRPORTS.read_text(encoding="utf-8"))["airports"]}
    runways = json.loads(RUNWAYS.read_text(encoding="utf-8"))["runways"]

    def length(icao: str) -> float:
        return sum(math.hypot(r[4] - r[2], (r[5] - r[3]) * math.cos(math.radians(r[2]))) for r in runways.get(icao, []))

    out = []
    for row in csv.DictReader(io.StringIO(text)):
        if row.get("type") != "large_airport" or row.get("scheduled_service") != "yes":
            continue
        for field in ("icao_code", "gps_code", "ident"):
            code = (row.get(field) or "").strip().upper()
            if code in known:
                out.append(code)
                break
    return sorted(set(out), key=lambda icao: (-length(icao), icao))


def boxes(order: list[str], count: int) -> list[tuple[str, tuple[float, float, float, float]]]:
    runways = json.loads(RUNWAYS.read_text(encoding="utf-8"))["runways"]
    out = []
    for icao in order:
        ends = [(r[2], r[3]) for r in runways.get(icao, [])] + [(r[4], r[5]) for r in runways.get(icao, [])]
        if not ends:
            continue
        lats = [p[0] for p in ends]
        lons = [p[1] for p in ends]
        widen = MARGIN_DEG / max(0.2, math.cos(math.radians(lats[0])))
        box = (min(lats) - MARGIN_DEG, min(lons) - widen, max(lats) + MARGIN_DEG, max(lons) + widen)
        # A box across the antimeridian or absurdly large is a data slip.
        if box[2] - box[0] > 0.3 or box[3] - box[1] > 0.5:
            continue
        out.append((icao, tuple(round(v, 4) for v in box)))
        if len(out) >= count:
            break
    return out


def query(group: list[tuple[str, tuple[float, float, float, float]]]) -> str:
    parts = []
    for _, (s, w, n, e) in group:
        box = f"({s},{w},{n},{e})"
        parts.append(f'way["aeroway"~"^(taxiway|taxilane|apron|terminal)$"]{box};node["aeroway"="gate"]{box};')
    return f"[out:json][timeout:120];({''.join(parts)});out tags geom qt;"


def fetch(q: str, attempt_limit: int) -> list[dict]:
    body = urllib.parse.urlencode({"data": q}).encode("ascii")
    wait = 20
    for attempt in range(attempt_limit):
        url = MIRRORS[attempt % len(MIRRORS)]
        try:
            req = urllib.request.Request(url, data=body, headers=UA)
            with urllib.request.urlopen(req, timeout=300) as resp:
                doc = json.loads(resp.read().decode("utf-8"))
            # A timed-out query answers 200 with a remark and partial data.
            if "remark" in doc and "elements" in doc and "timed out" in str(doc["remark"]):
                raise OSError(doc["remark"])
            return doc["elements"]
        except (OSError, ValueError, KeyError, urllib.error.URLError) as err:
            print(f"  {url.split('/')[2]}: {str(err)[:80]}; waiting {wait}s", file=sys.stderr)
            time.sleep(wait)
            wait = min(wait * 2, 300)
    raise SystemExit("Overpass did not answer; run again later (the cache keeps what was fetched)")


def simplify(points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Douglas-Peucker on integer [lat, lon] points (longitude is not scaled: close enough at this size)."""
    if len(points) < 3:
        return points
    if points[0] == points[-1]:
        # A ring has no chord to measure from: cut it at the point farthest
        # from its start and simplify the two halves.
        far = max(range(len(points)), key=lambda i: math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]))
        if far in (0, len(points) - 1):
            return points
        return simplify(points[: far + 1]) + simplify(points[far:])[1:]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy) or 1.0
        worst, at = 0.0, -1
        for i in range(a + 1, b):
            d = abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / length
            if d > worst:
                worst, at = d, i
        if worst > TOLERANCE and at > 0:
            keep[at] = True
            stack.extend(((a, at), (at, b)))
    return [p for p, k in zip(points, keep) if k]


def encode(points: list[tuple[int, int]]) -> list[int]:
    """Flat [lat, lon, dlat, dlon, ...]: first point absolute, the rest as steps."""
    out: list[int] = []
    prev = (0, 0)
    for p in points:
        out.extend((p[0] - prev[0], p[1] - prev[1]))
        prev = p
    return out


def chunk_for(box: tuple[float, float, float, float], elements: list[dict]) -> dict | None:
    s, w, n, e = box
    taxi: list[list] = []
    aprons: list[list[int]] = []
    terminals: list[list[int]] = []
    gates: list[list] = []
    for el in elements:
        kind = (el.get("tags") or {}).get("aeroway")
        if el["type"] == "node":
            ref = ((el.get("tags") or {}).get("ref") or "").strip()[:6]
            if kind == "gate" and ref and s <= el["lat"] <= n and w <= el["lon"] <= e:
                gates.append([ref, round(el["lat"] * SCALE), round(el["lon"] * SCALE)])
            continue
        geometry = el.get("geometry") or []
        bounds = el.get("bounds") or {}
        # Belongs to this airport when its own box overlaps the airport's.
        if not geometry or bounds.get("maxlat", -90) < s or bounds.get("minlat", 90) > n:
            continue
        if bounds.get("maxlon", -180) < w or bounds.get("minlon", 180) > e:
            continue
        points = simplify([(round(p["lat"] * SCALE), round(p["lon"] * SCALE)) for p in geometry])
        closed = len(points) >= 4 and points[0] == points[-1]
        if kind in ("taxiway", "taxilane") and len(points) >= 2:
            taxi.append([1 if kind == "taxiway" else 0, encode(points)])
        elif kind == "apron" and closed:
            aprons.append(encode(points[:-1]))
        elif kind == "terminal" and closed:
            terminals.append(encode(points[:-1]))
    if not taxi and not aprons and not terminals:
        return None
    gates.sort(key=lambda g: g[0])
    return {"t": taxi, "a": aprons, "b": terminals, "g": gates[:MAX_GATES]}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--count", type=int, default=300, help="how many airports, largest first")
    ap.add_argument("--batch", type=int, default=6, help="airports per Overpass query")
    ap.add_argument("--cache", type=Path, default=ROOT / ".cache" / "airport-ground", help="where answers are kept between runs")
    ap.add_argument("--attempts", type=int, default=12, help="tries per query before giving up")
    ap.add_argument("--airports-csv", type=Path, help="OurAirports airports.csv already on disk")
    ap.add_argument("--cached-only", action="store_true", help="build from what the cache holds; ask Overpass for nothing")
    args = ap.parse_args()

    wanted = boxes(ranked(args.airports_csv), args.count)
    args.cache.mkdir(parents=True, exist_ok=True)
    chunks: dict[str, dict] = {}
    for start in range(0, len(wanted), args.batch):
        group = wanted[start : start + args.batch]
        cached = args.cache / f"{'-'.join(icao for icao, _ in group)}.json"
        if cached.exists():
            elements = json.loads(cached.read_text(encoding="utf-8"))
        elif args.cached_only:
            continue
        else:
            print(f"{start + len(group)}/{len(wanted)}: {' '.join(icao for icao, _ in group)}", file=sys.stderr)
            elements = fetch(query(group), args.attempts)
            cached.write_text(json.dumps(elements, separators=(",", ":")), encoding="utf-8")
            time.sleep(3)
        for icao, box in group:
            chunk = chunk_for(box, elements)
            if chunk:
                chunks[icao] = chunk

    if len(chunks) < min(20, args.count // 2):
        print(f"only {len(chunks)} airports have ground detail; refusing to overwrite", file=sys.stderr)
        return 1
    pack = bytearray()
    index: dict[str, list[int]] = {}
    for icao in sorted(chunks):
        blob = gzip.compress(json.dumps(chunks[icao], separators=(",", ":")).encode("utf-8"), compresslevel=9, mtime=0)
        index[icao] = [len(pack), len(blob)]
        pack.extend(blob)
    doc = {
        "source": "(c) OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)",
        "generated": datetime.date.today().isoformat(),
        # Coordinates in a chunk are integers of 1e-5 degree: the first
        # point of a line absolute, the rest as steps from the one before.
        # t: [[1 taxiway | 0 taxilane, line]], a: apron rings, b: terminal
        # rings, g: [[gate, lat, lon]].
        "scale": SCALE,
        "airports": index,
    }
    INDEX.write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")
    PACK.write_bytes(bytes(pack))
    print(f"{len(index)} airports, {len(pack)} bytes -> {PACK}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
