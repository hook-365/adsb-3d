"""Human-readable decoding of ACARS message content.

Two tiers, matching what the airframe actually sends:

- Tier 1 (this module's own parsers): airline free-text formats that
  carry structured data — FANS/ARINC-618 position reports (``#M1x POS…``),
  in-range / arrival messages, progress reports, and weather requests.
  These are not covered by libacars because they're operator conventions
  layered on top of plain ACARS text.

- Tier 2 (``decode_libacars``): ATS applications — CPDLC, ADS-C, AFN — are
  decoded upstream by vdlm2dec's libacars link and arrive as a nested JSON
  object. We flatten that into a one-line summary; the structured object is
  passed through untouched for clients that want the detail.

``decode_message`` returns a dict with at least ``kind`` and ``summary``,
or ``None`` when nothing decodable is recognized (the raw text still shows
in the UI, so a miss costs nothing).
"""

from __future__ import annotations

import re
from typing import Optional

# ── Coordinate helpers ──────────────────────────────────────────────────


def _dm_to_deg(deg: int, min_tenths: int, hemi: str) -> float:
    """Degrees + minutes.tenths (as an int of tenths) → signed decimal degrees."""
    val = deg + (min_tenths / 10.0) / 60.0
    if hemi in ("S", "W"):
        val = -val
    return round(val, 5)


# ``N44046`` = N 44°04.6′ (2-digit deg, 3-digit MM.m); ``W089578`` = W 089°57.8′.
_POS_COMPACT = re.compile(r"([NS])(\d{2})(\d{3})([EW])(\d{3})(\d{3})")
# Decimal form: ``N 45.828,W 90.852`` or ``N 45.378 W 090.611``.
_POS_DECIMAL = re.compile(
    r"([NS])\s*(\d{1,2}(?:\.\d+)?)\s*[, ]\s*([EW])\s*(\d{1,3}(?:\.\d+)?)"
)


def _parse_compact_pos(text: str) -> Optional[dict]:
    m = _POS_COMPACT.search(text)
    if not m:
        return None
    lat = _dm_to_deg(int(m.group(2)), int(m.group(3)), m.group(1))
    lon = _dm_to_deg(int(m.group(5)), int(m.group(6)), m.group(4))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return {"lat": lat, "lon": lon}


def _parse_decimal_pos(text: str) -> Optional[dict]:
    m = _POS_DECIMAL.search(text)
    if not m:
        return None
    lat = float(m.group(2))
    lon = float(m.group(4))
    if m.group(1) == "S":
        lat = -lat
    if m.group(3) == "W":
        lon = -lon
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return {"lat": round(lat, 5), "lon": round(lon, 5)}


def _fmt_coord(lat: float, lon: float) -> str:
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    return f"{abs(lat):.3f}°{ns} {abs(lon):.3f}°{ew}"


def _fmt_hhmmss(t: str) -> str:
    """``021948`` → ``02:19:48Z``; ``0225`` → ``02:25Z``. Pass through anything odd."""
    if re.fullmatch(r"\d{6}", t):
        return f"{t[0:2]}:{t[2:4]}:{t[4:6]}Z"
    if re.fullmatch(r"\d{4}", t):
        return f"{t[0:2]}:{t[2:4]}Z"
    return t


# ── Tier 1: FANS position report (``#M1x POS…``) ─────────────────────────

_M1_POS = re.compile(
    r"#M\d[A-Z]POS"
    r"([NS]\d{5})([EW]\d{6})"  # lat, lon (compact)
    r"(?:,([A-Z0-9]+))?"  # current/over waypoint
    r"(?:,(\d{4,6}))?"  # time over
    r"(?:,(\d{2,3}))?"  # flight level
    r"(?:,([A-Z0-9]+))?"  # next waypoint
    r"(?:,(\d{4,6}))?"  # eta next
    r"(?:,([A-Z0-9]+))?"  # next+1 waypoint
    r"(?:,([MP]\d{2,3}))?"  # SAT (M=minus, P=plus)
    r"(?:,(\d{6}))?"  # wind ddd/sss
)


def _decode_m1_position(text: str) -> Optional[dict]:
    m = _M1_POS.search(text)
    if not m:
        return None
    pos = _parse_compact_pos(m.group(1) + m.group(2))
    if not pos:
        return None
    over, t_over, fl, nxt, eta, nxt2, sat, wind = m.groups()[2:]

    parts: list[str] = []
    if over:
        loc = f"over {over}"
        if t_over:
            loc += f" at {_fmt_hhmmss(t_over)}"
        parts.append(loc)
    else:
        parts.append("position report")
    parts.append(_fmt_coord(pos["lat"], pos["lon"]))
    if fl:
        parts.append(f"FL{int(fl):03d}")
    if nxt:
        seg = f"next {nxt}"
        if eta:
            seg += f" ETA {_fmt_hhmmss(eta)}"
        parts.append(seg)
    if nxt2:
        parts.append(f"then {nxt2}")
    if sat:
        temp = int(sat[1:]) * (-1 if sat[0] == "M" else 1)
        parts.append(f"SAT {temp}°C")
    if wind:
        parts.append(f"wind {int(wind[:3])}°/{int(wind[3:])}kt")

    out: dict = {"kind": "position", "summary": ", ".join(parts), "position": pos}
    if fl:
        out["flight_level"] = int(fl)
    if nxt:
        out["next_waypoint"] = nxt
    return out


# ARINC-618 "#DxB" position report (very common): a DSP sublabel, a short
# code, origin+dest ICAO, a compact lat/lon, time, then temperature and wind.
#   #DFBD3M002KBOSKSEAN45125W08945402333600M049265055G0009
_DFB_POS = re.compile(
    r"#D[A-Z]B[A-Z0-9]{0,8}?([A-Z]{4})([A-Z]{4})([NS]\d{5})([EW]\d{6})(\d{6})?"
)
_DFB_TEMP = re.compile(r"([MP]\d{3})")


# ABS variant: ``#DFBABS…_N973AK  KSEAKBOS555`` with the position as signed
# decimal-thousandths on a continuation line (``45559 -88415`` → 45.559,
# -88.415). Route is always present; coordinates only sometimes.
_DFB_ROUTE = re.compile(r"#D[A-Z]B[A-Z0-9]{0,10}?_?\s*[A-Z0-9]*?\s*([A-Z]{4})([A-Z]{4})")
_DFB_DEC_POS = re.compile(r"\b(\d{5})\s+(-\d{5})")


def _decode_dfb_position(text: str) -> Optional[dict]:
    m = _DFB_POS.search(text)
    if m:
        pos = _parse_compact_pos(m.group(3) + m.group(4))
        if pos:
            origin, dest = m.group(1), m.group(2)
            parts = [f"{origin}→{dest}", _fmt_coord(pos["lat"], pos["lon"])]
            t_over = m.group(5)
            if t_over:
                parts.append(f"at {_fmt_hhmmss(t_over)}")
            tm = _DFB_TEMP.search(text[m.end():])
            if tm:
                temp = int(tm.group(1)[1:]) * (-1 if tm.group(1)[0] == "M" else 1)
                parts.append(f"SAT {temp}°C")
            return {
                "kind": "position",
                "summary": ", ".join(parts),
                "position": pos,
                "origin": origin,
                "destination": dest,
            }

    # ABS / route-only variant: at least name the leg, plus decimal coords
    # when they're present and unambiguous.
    r = _DFB_ROUTE.match(text)
    if not r:
        return None
    origin, dest = r.group(1), r.group(2)
    parts = [f"{origin}→{dest}"]
    out: dict = {"kind": "progress", "origin": origin, "destination": dest}
    dm = _DFB_DEC_POS.search(text)
    if dm:
        lat = int(dm.group(1)) / 1000.0
        lon = int(dm.group(2)) / 1000.0
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            pos = {"lat": round(lat, 5), "lon": round(lon, 5)}
            out["position"] = pos
            out["kind"] = "position"
            parts.append(_fmt_coord(lat, lon))
    out["summary"] = ", ".join(parts)
    return out


# ── Tier 1: airports / ETA / arrival / weather ──────────────────────────

_ICAO_PAIR = re.compile(r"\b([A-Z]{4})[ /]([A-Z]{4})\b")
_ETA = re.compile(r"ETA[ :]*([0-9]{3,4}Z?)", re.IGNORECASE)


def _icao_pair(text: str) -> Optional[tuple[str, str]]:
    m = _ICAO_PAIR.search(text)
    # Guard against matching arbitrary 4-letter word pairs: require at least
    # one to start with K/C/E/... isn't reliable, so require the token to look
    # like an airport (both all-caps letters, already enforced) AND the pair to
    # be adjacent via space or slash (enforced). Good enough for ops messages.
    return (m.group(1), m.group(2)) if m else None


def _decode_arrival(text: str) -> Optional[dict]:
    if "INRANG" not in text.upper():
        return None
    pair = _icao_pair(text)
    eta = _ETA.search(text)
    parts = ["In range"]
    if pair:
        parts.append(f"{pair[0]}→{pair[1]}")
    if eta:
        parts.append(f"ETA {_fmt_hhmmss(eta.group(1).rstrip('Zz'))}")
    out: dict = {"kind": "arrival", "summary": ", ".join(parts)}
    if pair:
        out["origin"], out["destination"] = pair
    return out


def _decode_wxrq(text: str) -> Optional[dict]:
    if "WXRQ" not in text.upper():
        return None
    stations = re.findall(r"/STA\s+([A-Z]{4})", text)
    summary = "Weather request"
    if stations:
        summary += ": " + ", ".join(stations)
    return {"kind": "wxrq", "summary": summary, "stations": stations}


def _decode_generic_position(label: Optional[str], text: str) -> Optional[dict]:
    """Fallback for the many airline position formats that embed a plain
    lat/lon and (often) an altitude — plot the fix even when the rest of the
    format is operator-specific."""
    pos = _parse_decimal_pos(text)
    if not pos:
        return None
    # Altitude: a bare 4-6 digit field that reads as feet (10000-45000) near
    # the coordinates. Conservative — only when it's unambiguous.
    alt = None
    for m in re.finditer(r"\b(\d{4,5})\b", text):
        v = int(m.group(1))
        if 8000 <= v <= 45000:
            alt = v
            break
    parts = ["position", _fmt_coord(pos["lat"], pos["lon"])]
    if alt is not None:
        parts.append(f"{alt:,} ft")
    out: dict = {"kind": "position", "summary": ", ".join(parts), "position": pos}
    if alt is not None:
        out["altitude_ft"] = alt
    return out


# ── Tier 2: ATS applications (CPDLC / ADS-C / AFN) ───────────────────────

_ATS_IMI = {
    "AFN": ("afn", "AFN (log-on / facilities notification)"),
    "ADS": ("adsc", "ADS-C (automatic position contract)"),
    "CR1": ("cpdlc", "CPDLC connect request"),
    "CC1": ("cpdlc", "CPDLC connect confirm"),
    "DR1": ("cpdlc", "CPDLC disconnect"),
    "AT1": ("cpdlc", "CPDLC message"),
}
# ARINC 622 preamble: GGGGGGG.IMI, optionally led by a slash and/or wrapped in
# a media-advisory prefix (``#M1B/BA USADCXA.AT1…``). Anchor on the known IMI
# set so we don't mistake ordinary "WORD.WO" text for a datalink message.
_ATS_PREAMBLE = re.compile(
    r"(?:^|[\s/])([A-Z]{3}[A-Z0-9]{1,4})\.(" + "|".join(_ATS_IMI) + r")(?:[./]|$)"
)


def _classify_ats(text: str) -> Optional[dict]:
    """Recognize an ARINC 622 ATS message and name the application and ground
    facility. Full element decoding is libacars' job (see ``decode_libacars``);
    this is the honest fallback when the upstream decode isn't attached."""
    m = _ATS_PREAMBLE.search(text.strip())
    if not m:
        return None
    facility, imi = m.group(1), m.group(2)
    kind, desc = _ATS_IMI[imi]
    return {
        "kind": kind,
        "summary": f"{desc} · {facility}",
        "facility": facility,
        "imi": imi,
        "note": "raw datalink payload; full element text needs libacars at the decoder",
    }


def decode_libacars(obj: dict) -> Optional[dict]:
    """Summarize a libacars decode object attached by vdlm2dec.

    vdlm2dec nests the decode under a top-level key; we accept the common
    shapes. Returns a summary + the raw structured object, or None.
    """
    lib = obj.get("libacars") or obj.get("decoded")
    if not isinstance(lib, (dict, list)):
        return None
    entries = lib if isinstance(lib, list) else [lib]
    kinds: list[str] = []
    for e in entries:
        if not isinstance(e, dict):
            continue
        for key in ("cpdlc", "adsc", "afn", "media_adv", "miam"):
            if key in e:
                kinds.append(
                    {
                        "cpdlc": "CPDLC",
                        "adsc": "ADS-C",
                        "afn": "AFN",
                        "media_adv": "media advisory",
                        "miam": "MIAM",
                    }[key]
                )
    if not kinds:
        return None
    return {
        "kind": "ats",
        "summary": " + ".join(dict.fromkeys(kinds)) + " (decoded)",
        "libacars": lib,
    }


# ── Entry point ─────────────────────────────────────────────────────────

# Tier-1 text decoders, tried in order; first non-None wins.
_TEXT_DECODERS = (
    _decode_m1_position,
    _decode_dfb_position,
    _decode_arrival,
    _decode_wxrq,
    _classify_ats,
)


def decode_message(label: Optional[str], text: Optional[str], raw: Optional[dict] = None) -> Optional[dict]:
    """Return a decode summary for one ACARS message, or None.

    ``raw`` is the original upstream JSON, consulted for a libacars decode
    (Tier 2) which takes precedence over our own text parsing.
    """
    if raw is not None:
        lib = decode_libacars(raw)
        if lib:
            return lib
    if not text:
        return None
    for fn in _TEXT_DECODERS:
        try:
            out = fn(text)
        except Exception:
            out = None
        if out:
            return out
    # Last resort: any embedded lat/lon becomes a plottable fix.
    return _decode_generic_position(label, text)
