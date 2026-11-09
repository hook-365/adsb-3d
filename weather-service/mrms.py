"""
NOAA MRMS 3-D reflectivity: pure decode + crop maths, no I/O.

MRMS (Multi-Radar Multi-Sensor) merges every US radar into one CONUS mosaic
and publishes it as 33 constant-altitude slices (0.5 to 19 km MSL), each a
7000 x 3500 grid at 0.01 degrees (~1 km), refreshed every ~2 minutes:

    https://mrms.ncep.noaa.gov/3DRefl/MergedReflectivityQC_<km>/
        MRMS_MergedReflectivityQC_<km>.latest.grib2.gz

A slice is a GRIB2 message whose data section is a 16-bit greyscale PNG
(data template 5.41): dBZ = (R + raw * 2^E) / 10^D. We read the handful of
GRIB2 fields we need by offset and let Pillow decode the PNG, so no GRIB
library is involved. US government work, public domain.

Everything here is deterministic and unit-tested; `main.py` does the
fetching and scheduling.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO

import numpy as np
from PIL import Image

# Some MRMS products ship on a 0.005 deg grid (14000 x 7000, 98 MP), past
# Pillow's default decompression-bomb guard. The data is trusted (NOAA).
Image.MAX_IMAGE_PIXELS = None

# Every MRMS level, km MSL, as spelled in the URL.
LEVELS_KM = [
    "00.50", "00.75", "01.00", "01.25", "01.50", "01.75", "02.00", "02.25",
    "02.50", "02.75", "03.00", "03.50", "04.00", "04.50", "05.00", "05.50",
    "06.00", "06.50", "07.00", "07.50", "08.00", "08.50", "09.00", "10.00",
    "11.00", "12.00", "13.00", "14.00", "15.00", "16.00", "17.00", "18.00",
    "19.00",
]
HEIGHTS_KM = [float(k) for k in LEVELS_KM]

BASE_URL = "https://mrms.ncep.noaa.gov/3DRefl"

# Rough CONUS mosaic extent; a home outside it has no MRMS coverage at all.
CONUS_WEST, CONUS_EAST = -130.0, -60.0
CONUS_SOUTH, CONUS_NORTH = 20.0, 55.0

NM_PER_DEG_LAT = 60.0
# Longest crop side after downsampling. 256^2 * 33 levels = 2.2 MB raw.
MAX_CELLS = 256


def level_url(km: str) -> str:
    return f"{BASE_URL}/MergedReflectivityQC_{km}/MRMS_MergedReflectivityQC_{km}.latest.grib2.gz"


@dataclass
class Grib2Msg:
    ni: int
    nj: int
    lat1: float
    lon1: float
    lat2: float
    lon2: float
    reference: float
    binary_scale: int
    decimal_scale: int
    bits: int
    ref_time: datetime | None
    png: bytes

    @property
    def cell_deg(self) -> float:
        """Grid spacing, derived rather than assumed (MRMS is 0.01)."""
        return abs(self.lat1 - self.lat2) / max(self.nj - 1, 1)

    @property
    def west(self) -> float:
        return _lon180(min(self.lon1, self.lon2))

    @property
    def east(self) -> float:
        return _lon180(max(self.lon1, self.lon2))

    @property
    def south(self) -> float:
        return min(self.lat1, self.lat2)

    @property
    def north(self) -> float:
        return max(self.lat1, self.lat2)


def _lon180(v: float) -> float:
    return v - 360.0 if v > 180.0 else v


def _sign_magnitude(v: int) -> int:
    # GRIB signed integers are sign-magnitude, not two's complement.
    return -(v & 0x7FFF) if v & 0x8000 else v


def parse_grib2(buf: bytes) -> Grib2Msg:
    """The few GRIB2 fields a lat/lon PNG-packed message needs."""
    if buf[:4] != b"GRIB" or buf[7] != 2:
        raise ValueError("not a GRIB2 message")
    out: dict = {"ref_time": None, "bits": 0}
    o = 16
    n = len(buf)
    while o < n - 4:
        if buf[o:o + 4] == b"7777":
            break
        (length,) = struct.unpack_from(">I", buf, o)
        if length < 5:
            raise ValueError("corrupt GRIB2 section length")
        section = buf[o + 4]
        if section == 1:
            year, month, day, hour, minute, second = struct.unpack_from(">HBBBBB", buf, o + 12)
            try:
                out["ref_time"] = datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
            except ValueError:
                out["ref_time"] = None
        elif section == 3:
            (template,) = struct.unpack_from(">H", buf, o + 12)
            if template != 0:
                raise ValueError("unsupported grid template (expected lat/lon, 3.0)")
            out["ni"], out["nj"] = struct.unpack_from(">II", buf, o + 30)
            (lat1, lon1) = struct.unpack_from(">ii", buf, o + 46)
            (lat2, lon2) = struct.unpack_from(">ii", buf, o + 55)
            out["lat1"], out["lon1"] = lat1 / 1e6, lon1 / 1e6
            out["lat2"], out["lon2"] = lat2 / 1e6, lon2 / 1e6
        elif section == 5:
            (template,) = struct.unpack_from(">H", buf, o + 9)
            if template != 41:
                raise ValueError("unsupported data template (expected PNG, 5.41)")
            (out["reference"],) = struct.unpack_from(">f", buf, o + 11)
            e, d = struct.unpack_from(">HH", buf, o + 15)
            out["binary_scale"] = _sign_magnitude(e)
            out["decimal_scale"] = _sign_magnitude(d)
            out["bits"] = buf[o + 19]
        elif section == 7:
            out["png"] = bytes(buf[o + 5:o + length])
        o += length
    if "png" not in out or "ni" not in out or "reference" not in out:
        raise ValueError("incomplete GRIB2 message")
    return Grib2Msg(**out)


def decode_slice(msg: Grib2Msg, win: "Window | None" = None) -> np.ndarray:
    """One level as float32 dBZ, row 0 = north, optionally cropped to `win`
    before the float conversion so a full CONUS slice costs one uint16 copy
    (49 MB), not a 100 MB float one. Missing / no-coverage sentinels (-99,
    -999) and genuine negative dBZ all become 0."""
    img = Image.open(BytesIO(msg.png))
    raw = np.asarray(img)
    if raw.ndim != 2:
        raise ValueError("MRMS PNG is not single-channel")
    if raw.shape != (msg.nj, msg.ni):
        raise ValueError(f"PNG {raw.shape} does not match grid {(msg.nj, msg.ni)}")
    if win is not None:
        raw = raw[win.row0:win.row1, win.col0:win.col1]
    scale = 2.0 ** msg.binary_scale / 10.0 ** msg.decimal_scale
    offset = msg.reference / 10.0 ** msg.decimal_scale
    dbz = raw.astype(np.float32) * np.float32(scale) + np.float32(offset)
    np.maximum(dbz, 0.0, out=dbz)
    return dbz


def has_coverage(lat: float, lon: float) -> bool:
    return CONUS_SOUTH <= lat <= CONUS_NORTH and CONUS_WEST <= lon <= CONUS_EAST


@dataclass(frozen=True)
class Window:
    row0: int
    row1: int
    col0: int
    col1: int
    # Geographic bounds of the cropped cells, edge to edge (half-cell margin).
    west: float
    east: float
    south: float
    north: float

    @property
    def shape(self) -> tuple[int, int]:
        return (self.row1 - self.row0, self.col1 - self.col0)


def crop_window(msg: Grib2Msg, lat: float, lon: float, radius_nm: float) -> Window:
    """Index window covering +/- radius_nm around (lat, lon), clamped to the
    grid. Rows run north to south, columns west to east."""
    cell = msg.cell_deg
    half_lat = radius_nm / NM_PER_DEG_LAT
    cos_lat = max(np.cos(np.radians(lat)), 0.2)
    half_lon = half_lat / cos_lat
    # Cell centre k sits at north - k*cell (rows) and west + k*cell (cols).
    row0 = int(np.floor((msg.north - (lat + half_lat)) / cell))
    row1 = int(np.ceil((msg.north - (lat - half_lat)) / cell)) + 1
    col0 = int(np.floor(((lon - half_lon) - msg.west) / cell))
    col1 = int(np.ceil(((lon + half_lon) - msg.west) / cell)) + 1
    row0, row1 = max(row0, 0), min(row1, msg.nj)
    col0, col1 = max(col0, 0), min(col1, msg.ni)
    if row1 <= row0 or col1 <= col0:
        raise ValueError("crop window lies outside the MRMS grid")
    return Window(
        row0, row1, col0, col1,
        west=msg.west + col0 * cell - cell / 2,
        east=msg.west + (col1 - 1) * cell + cell / 2,
        south=msg.north - (row1 - 1) * cell - cell / 2,
        north=msg.north - row0 * cell + cell / 2,
    )


def block_for(shape: tuple[int, int], max_cells: int = MAX_CELLS) -> int:
    """Smallest block size that brings the longest side under max_cells."""
    longest = max(shape)
    return max(1, int(np.ceil(longest / max_cells)))


def downsample_max(a: np.ndarray, block: int) -> np.ndarray:
    """Block-max pooling to uint8 dBZ (round half up, clamp 0..255). The max
    keeps the strongest echo, so a storm core never averages away. Trailing
    rows/cols that do not fill a block are dropped."""
    if block <= 1:
        out = a
    else:
        h = (a.shape[0] // block) * block
        w = (a.shape[1] // block) * block
        if h == 0 or w == 0:
            raise ValueError("crop smaller than one block")
        out = a[:h, :w].reshape(h // block, block, w // block, block).max(axis=(1, 3))
    out = np.floor(out + 0.5)
    return np.clip(out, 0, 255).astype(np.uint8)


def window_bounds_after_block(win: Window, block: int, cell: float) -> dict:
    """Bounds of the cells that survive `downsample_max` (dropped remainder
    rows/cols shrink the east and south edges)."""
    rows, cols = win.shape
    rows_kept = (rows // block) * block
    cols_kept = (cols // block) * block
    return {
        "west": win.west,
        "east": win.west + cols_kept * cell,
        "south": win.north - rows_kept * cell,
        "north": win.north,
    }


# ============================================================================
# 2-D PRODUCTS (echo tops, freezing level, precipitation, hail,
# lightning): one GRIB2 grid each from https://mrms.ncep.noaa.gov/2D/<name>/,
# same PNG packing as the reflectivity levels. Each is cropped like a level
# and packed to uint8 for the browser; `scale`/`offset`/`log` in the
# manifest tell it how to unpack: value = log ? (2^(code/scale) - 1) : code/scale + offset.
# ============================================================================
BASE_URL_2D = "https://mrms.ncep.noaa.gov/2D"


@dataclass(frozen=True)
class Product:
    id: str            # short id used in WEATHER_FIELDS, manifests and URLs
    name: str          # MRMS product name as spelled in the URL
    unit: str
    scale: float       # uint8 code = value * scale (or log2(1+value) * scale)
    pool: str          # "max" (keep the worst cell), "mean" (smooth heights), "rank"
    refresh_s: float   # how often to re-download; the big hourly model fields need not be fetched every cycle
    log: bool = False
    offset: float = 0.0

    @property
    def url(self) -> str:
        return f"{BASE_URL_2D}/{self.name}/MRMS_{self.name}.latest.grib2.gz"


# Precip type: MRMS PrecipFlag codes collapse to a severity rank so a block
# keeps its worst cell and the browser needs one small legend.
#   0 none, 1 stratiform (warm 1, cool 10, tropical 91), 2 snow (3),
#   3 convective (6, 96), 4 hail (7)
PRECIP_RANK = {0: 0, 1: 1, 10: 1, 91: 1, 3: 2, 6: 3, 96: 3, 7: 4}

PRODUCTS: dict[str, Product] = {
    "echotop18": Product("echotop18", "EchoTop_18", "km", scale=10.0, pool="max", refresh_s=0),
    "echotop30": Product("echotop30", "EchoTop_30", "km", scale=10.0, pool="max", refresh_s=0),
    "freezing": Product("freezing", "Model_0degC_Height", "m", scale=1 / 40.0, pool="mean", refresh_s=3600),
    "bbtop": Product("bbtop", "BrightBandTopHeight", "m", scale=1 / 40.0, pool="mean", refresh_s=900),
    "bbbottom": Product("bbbottom", "BrightBandBottomHeight", "m", scale=1 / 40.0, pool="mean", refresh_s=900),
    "preciprate": Product("preciprate", "PrecipRate", "mm/h", scale=32.0, pool="max", refresh_s=0, log=True),
    "preciptype": Product("preciptype", "PrecipFlag", "rank", scale=1.0, pool="rank", refresh_s=0),
    "mesh": Product("mesh", "MESH", "mm", scale=2.0, pool="max", refresh_s=0),
    "lightning": Product("lightning", "NLDN_CG_001min_AvgDensity", "flashes/km2/min", scale=40.0, pool="max", refresh_s=0),
}
# Fetched unless WEATHER_FIELDS says otherwise. The bright-band pair is
# ~15 MB each per fetch, so it is opt-in.
DEFAULT_FIELDS = ["echotop18", "echotop30", "freezing", "preciprate", "preciptype", "mesh", "lightning"]


def decode_field(msg: Grib2Msg, win: "Window | None" = None) -> np.ndarray:
    """One 2-D product as float32 with MRMS sentinels (-1 no echo, -3 no
    coverage, -99/-999 missing) turned into NaN. Unlike decode_slice this
    keeps genuine negatives (none of the products here have any)."""
    img = Image.open(BytesIO(msg.png))
    raw = np.asarray(img)
    if raw.ndim != 2:
        raise ValueError("MRMS PNG is not single-channel")
    if raw.shape != (msg.nj, msg.ni):
        raise ValueError(f"PNG {raw.shape} does not match grid {(msg.nj, msg.ni)}")
    if win is not None:
        raw = raw[win.row0:win.row1, win.col0:win.col1]
    scale = 2.0 ** msg.binary_scale / 10.0 ** msg.decimal_scale
    offset = msg.reference / 10.0 ** msg.decimal_scale
    v = raw.astype(np.float32) * np.float32(scale) + np.float32(offset)
    v[v < -0.5] = np.nan
    return v


def pack_field(a: np.ndarray, product: Product, block: int) -> np.ndarray:
    """Crop (float32, NaN = no data) -> uint8 grid for the browser: pool each
    block x block cell by the product's rule, then apply its packing. NaN
    packs to 0, so 0 always means "nothing here"."""
    if product.pool == "rank":
        a = rank_precip_flags(a)   # rank first, so max-pooling keeps the worst type
    if block > 1:
        h = (a.shape[0] // block) * block
        w = (a.shape[1] // block) * block
        if h == 0 or w == 0:
            raise ValueError("crop smaller than one block")
        b = a[:h, :w].reshape(h // block, block, w // block, block)
        with np.errstate(all="ignore"):
            if product.pool == "mean":
                pooled = np.nanmean(b, axis=(1, 3))
            else:
                pooled = np.nanmax(b, axis=(1, 3))
    else:
        pooled = a
    v = np.nan_to_num(pooled, nan=0.0)
    if product.log:
        v = np.log2(1.0 + np.maximum(v, 0.0)) * product.scale
    else:
        v = (v - product.offset) * product.scale
    return np.clip(np.floor(v + 0.5), 0, 255).astype(np.uint8)


def rank_precip_flags(a: np.ndarray) -> np.ndarray:
    """Raw PrecipFlag codes -> severity rank (float32 with NaN kept) so block
    pooling keeps the worst type, not the largest code number."""
    out = np.full(a.shape, np.nan, dtype=np.float32)
    for code, rank in PRECIP_RANK.items():
        out[a == code] = rank
    return out
