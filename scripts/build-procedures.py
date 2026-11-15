#!/usr/bin/env python3
"""Regenerate the published instrument procedures from the FAA's CIFP.

The airports layer (frontend/src/world/procedures.ts) draws US instrument
approaches, arrivals (STARs) and departures (SIDs) as the FAA publishes
them. This script takes the current Coded Instrument Flight Procedures
edition (ARINC 424, 132-column records, a new edition every 28 days) and
writes two files:

  frontend/src/world/procedures-index.json
      per airport: the final segment of every runway approach, the names of
      all its procedures, its magnetic variation, and where its full detail
      sits in the pack; plus the edition's cycle and dates.
  frontend/src/world/procedures.pack
      every airport's complete procedures as one gzipped JSON chunk each,
      end to end. The app range-requests the one airport it needs.

    python3 scripts/build-procedures.py

Pass --zip to reuse a CIFP zip already on disk (stdlib only). Run it once
per cycle; the app shows the edition's dates and says when it is out of
date.

Data: FAA CIFP (https://www.faa.gov/air_traffic/flight_info/aeronav/
digital_products/cifp/), not copyrighted. Not for navigation.
"""

from __future__ import annotations

import argparse
import datetime
import gzip
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

API = "https://external-api.faa.gov/apra/cifp/chart?edition=current"
ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "frontend" / "src" / "world" / "procedures-index.json"
PACK = ROOT / "frontend" / "src" / "world" / "procedures.pack"
UA = {"User-Agent": "adsb-3d-build-procedures", "Accept": "application/json"}
KINDS = {"D": "sid", "E": "star", "F": "approach"}


def coord(text: str) -> float | None:
    """'N44531604' / 'W093140287' (degrees, minutes, seconds, hundredths) -> degrees."""
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
    return round(-value if text[0] in "SW" else value, 5)


def position(line: str, at: int = 32) -> list[float] | None:
    lat, lon = coord(line[at:at + 9]), coord(line[at + 9:at + 19])
    return [lat, lon] if lat is not None and lon is not None else None


def altitude(text: str) -> int | None:
    """'03000', ' 0869', 'FL240' -> feet."""
    text = text.strip()
    if not text:
        return None
    try:
        return int(text[2:]) * 100 if text.startswith("FL") else int(text)
    except ValueError:
        return None


def tenths(text: str) -> float | None:
    text = text.strip()
    if not text or not text.isdigit():
        return None
    return int(text) / 10.0


def variation(text: str) -> float:
    """'E0060' -> 6.0 (east positive), 'W0003' -> -0.3."""
    text = text.strip()
    if len(text) != 5 or text[0] not in "EW" or not text[1:].isdigit():
        return 0.0
    value = int(text[1:]) / 10.0
    return value if text[0] == "E" else -value


def fetch_zip() -> tuple[bytes, dict]:
    print(f"asking {API}", file=sys.stderr)
    with urllib.request.urlopen(urllib.request.Request(API, headers=UA), timeout=60) as resp:
        edition = json.loads(resp.read().decode("utf-8"))["edition"][0]
    url = edition["product"]["url"]
    print(f"downloading {url}", file=sys.stderr)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as resp:
        return resp.read(), edition


def edition_of(name: str) -> datetime.date | None:
    """'CIFP_261029.zip' -> 2026-10-29."""
    digits = "".join(c for c in Path(name).stem if c.isdigit())
    try:
        return datetime.date(2000 + int(digits[0:2]), int(digits[2:4]), int(digits[4:6]))
    except (ValueError, IndexError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--zip", type=Path, help="CIFP_YYMMDD.zip already on disk")
    ap.add_argument("--effective", help="edition's effective date (YYYY-MM-DD) when --zip's name does not carry it")
    args = ap.parse_args()

    if args.zip:
        blob = args.zip.read_bytes()
        effective = datetime.date.fromisoformat(args.effective) if args.effective else edition_of(args.zip.name)
    else:
        blob, edition = fetch_zip()
        effective = edition_of(edition["product"]["url"].rsplit("/", 1)[-1])
    if effective is None:
        print("cannot tell the edition's effective date; pass --effective", file=sys.stderr)
        return 1
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        lines = z.read("FAACIFP18").decode("latin-1").splitlines()

    # ── Pass 1: everything that has a position ─────────────────────────
    enroute: dict[tuple[str, str], list[float]] = {}  # (ident, region)
    terminal: dict[tuple[str, str], list[float]] = {}  # (airport, ident)
    airports: dict[str, dict] = {}
    runways: dict[tuple[str, str], dict] = {}  # (airport, 'RW12R')
    for line in lines:
        if len(line) < 132 or line[0] != "S":
            continue
        section, sub6, sub13 = line[4], line[5], line[12]
        if section == "E" and sub6 == "A" and line[21] in "01":
            pos = position(line)
            if pos:
                enroute[(line[13:18].strip(), line[19:21])] = pos
        elif section == "D" and sub6 in " B" and line[21] in "01":
            # A DME-only station keeps its position in the second pair.
            pos = position(line) or position(line, 55)
            if pos:
                enroute[(line[13:17].strip(), line[19:21])] = pos
        elif section == "P" and line[21] in "01":
            airport = line[6:10].strip()
            if sub13 == "A":
                pos = position(line)
                if pos:
                    airports[airport] = {"pos": pos, "var": variation(line[51:56])}
                    terminal[(airport, airport)] = pos
            elif sub13 in "CN":
                pos = position(line)
                if pos:
                    terminal[(airport, line[13:18].strip())] = pos
            elif sub13 == "G":
                pos = position(line)
                if pos:
                    ident = line[13:18].strip()
                    terminal[(airport, ident)] = pos
                    runways[(airport, ident)] = {"elev": altitude(line[66:71]), "tch": altitude(line[75:77])}

    def resolve(airport: str, ident: str, region: str, section: str) -> list[float] | None:
        if not ident:
            return None
        if section.startswith("P"):
            return terminal.get((airport, ident)) or enroute.get((ident, region))
        return enroute.get((ident, region)) or terminal.get((airport, ident))

    # ── Pass 2: procedure legs ─────────────────────────────────────────
    # airport -> kind -> procedure id -> [segment], a segment being the legs
    # of one (route type, transition) in file order.
    procs: dict[str, dict[str, dict[str, list[dict]]]] = {}
    unresolved = 0
    broken: set[tuple[str, str, str]] = set()
    for line in lines:
        if len(line) < 132 or line[0] != "S" or line[4] != "P" or line[12] not in KINDS:
            continue
        # '2' and up are continuation records (level of service and the like).
        if line[38] not in "01":
            continue
        airport = line[6:10].strip()
        kind = KINDS[line[12]]
        proc = line[13:19].strip()
        route, transition = line[19], line[20:25].strip()
        path = line[47:49]
        leg: dict = {"l": path}
        ident = line[29:34].strip()
        if ident:
            pos = resolve(airport, ident, line[34:36], line[36:38])
            if pos is None:
                unresolved += 1
                broken.add((airport, kind, proc))
                continue
            leg["f"] = ident
            leg["p"] = pos
        role = line[42]
        if role.strip():
            leg["r"] = role  # F final approach fix, M missed approach point, A/B/I initial/intermediate/final course
        if line[39] == "G":
            leg["rw"] = 1  # the fix is a runway threshold
        if line[40] == "Y":
            leg["fo"] = 1  # fly-over
        if line[43].strip():
            leg["t"] = line[43]  # L / R
        desc = line[82]
        alt1, alt2 = altitude(line[84:89]), altitude(line[89:94])
        if desc.strip():
            leg["ad"] = desc
        if alt1 is not None:
            leg["a1"] = alt1
        if alt2 is not None:
            leg["a2"] = alt2
        course = line[70:74].strip()
        if course:
            if course.endswith("T") and course[:-1].isdigit():
                leg["c"] = float(int(course[:-1]))
                leg["ct"] = 1  # already true
            elif course.isdigit():
                leg["c"] = int(course) / 10.0
        dist = line[74:78].strip()
        if dist:
            if dist.startswith("T") and dist[1:].isdigit():
                leg["tm"] = int(dist[1:]) / 10.0  # minutes (holds)
            elif dist.isdigit():
                leg["d"] = int(dist) / 10.0  # NM
        angle = line[102:106].strip()
        if angle and angle.lstrip("-").isdigit():
            leg["va"] = int(angle) / 100.0
        speed = line[99:102].strip()
        if speed.isdigit():
            leg["s"] = int(speed)
        if path == "RF":
            centre = resolve(airport, line[106:111].strip(), line[112:114], line[114:116])
            radius = line[56:62].strip()
            if centre is None or not radius.isdigit():
                unresolved += 1
                broken.add((airport, kind, proc))
                continue
            leg["cp"] = centre
            leg["rad"] = int(radius) / 1000.0
        elif path in ("AF", "CD", "VD", "CR", "VR", "FD"):
            navaid = resolve(airport, line[50:54].strip(), line[54:56], line[78:80])
            if navaid:
                leg["np"] = navaid
            for key, text in (("th", line[62:66]), ("rho", line[66:70])):
                value = tenths(text)
                if value is not None:
                    leg[key] = value
        segments = procs.setdefault(airport, {}).setdefault(kind, {}).setdefault(proc, [])
        if not segments or segments[-1]["r"] != route or segments[-1]["t"] != transition:
            segments.append({"r": route, "t": transition, "legs": []})
        segments[-1]["legs"].append(leg)

    for airport, kind, proc in broken:
        procs.get(airport, {}).get(kind, {}).pop(proc, None)

    # ── Output ─────────────────────────────────────────────────────────
    pack = bytearray()
    index: dict[str, dict] = {}
    counts = {"approach": 0, "star": 0, "sid": 0}
    for airport in sorted(procs):
        kinds = {k: v for k, v in procs[airport].items() if v}
        if not kinds or airport not in airports:
            continue
        for kind, table in kinds.items():
            counts[kind] += len(table)
        chunk = gzip.compress(json.dumps(kinds, separators=(",", ":")).encode("utf-8"), compresslevel=9, mtime=0)
        finals = []
        for proc, segments in sorted(kinds.get("approach", {}).items()):
            # The final route is the one that is not a transition ('A').
            final = next((s for s in segments if s["r"] != "A"), None)
            if not final:
                continue
            legs = []
            for leg in final["legs"]:
                if "p" not in leg:
                    break
                entry = [leg["f"], leg["p"][0], leg["p"][1], leg.get("a1"), leg.get("r", ""), leg.get("ad", "")]
                legs.append(entry)
                if leg.get("r") == "M":
                    break
            # A final needs its fix and its missed approach point.
            if len(legs) < 2 or legs[-1][4] != "M":
                continue
            runway = legs[-1][0] if legs[-1][0].startswith("RW") else ""
            angle = next((leg["va"] for leg in final["legs"] if "va" in leg), None)
            finals.append({"id": proc, "rw": runway, "va": angle, "legs": legs})
        index[airport] = {
            "v": airports[airport]["var"],
            "o": len(pack),
            "n": len(chunk),
            "a": sorted(kinds.get("approach", {})),
            "s": sorted(kinds.get("star", {})),
            "d": sorted(kinds.get("sid", {})),
            "f": finals,
        }
        pack += chunk

    total = sum(counts.values())
    if len(index) < 2500 or total < 12000:
        print(f"only {len(index)} airports and {total} procedures; refusing to overwrite", file=sys.stderr)
        return 1
    # Cycle "2611" is the eleventh edition of 2026: one every 28 days.
    number = (effective.timetuple().tm_yday - 1) // 28 + 1
    doc = {
        "source": "FAA Coded Instrument Flight Procedures (CIFP), not copyrighted. Not for navigation.",
        "cycle": f"{effective.year % 100:02d}{number:02d}",
        "effective": effective.isoformat(),
        "expires": (effective + datetime.timedelta(days=28)).isoformat(),
        # icao -> v magnetic variation (east positive); o, n: offset and
        # length of its gzipped chunk in procedures.pack; a, s, d: approach,
        # STAR and SID identifiers; f: final segments, legs as
        # [fix, lat, lon, altitude ft or null, role, altitude description].
        "airports": index,
    }
    INDEX.write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")
    PACK.write_bytes(bytes(pack))
    print(
        f"{len(index)} airports: {counts['approach']} approaches, {counts['star']} STARs, {counts['sid']} SIDs; "
        f"{unresolved} unresolved legs ({len(broken)} procedures dropped)\n"
        f"cycle {doc['cycle']}, effective {doc['effective']}\n"
        f"{INDEX.stat().st_size} bytes -> {INDEX}\n{PACK.stat().st_size} bytes -> {PACK}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
