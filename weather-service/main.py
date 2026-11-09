#!/usr/bin/env python3
"""
Weather Service
Turns NOAA MRMS 3-D reflectivity into small storm volumes for adsb-3d.

- Background task: every WEATHER3D_REFRESH_S, downloads the 33 constant-altitude
  MRMS slices once (CONUS, ~15-20 MB) and keeps the compressed bytes. Each
  slice is decoded once and cropped to every location viewers have asked for
  (+/- WEATHER3D_RADIUS_NM), block-max downsampled to <= 256 cells a side.
- REST API: /volume?lat=&lon= registers a location and returns its manifest;
  /volume.bin?loc=<key> is that location's gzip'd uint8 dBZ volume (z-major:
  level, then rows north to south, then columns west to east). One sidecar
  serves every feed of a multi-feed viewer; a location nobody asks about for
  WEATHER3D_LOCATION_TTL_S is dropped. LATITUDE/LONGITUDE, if set, pre-warm a
  location at startup so the local feed never waits.

- 2-D fields (WEATHER_FIELDS): echo tops, freezing level, precipitation
  rate/type, hail size and lightning, each one MRMS grid cropped the
  same way and packed to uint8: /fields?lat=&lon= (manifest per field) and
  /field.bin?loc=&f=<id>. Big hourly model fields are re-fetched on their own
  slower cadence.

No database. MRMS covers CONUS only; a location outside it gets coverage
false. US government data, public domain.
"""

from __future__ import annotations

import asyncio
import gzip
import logging
import os
import sys
import time
from dataclasses import dataclass, field

import httpx
import numpy as np
from fastapi import FastAPI, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

import mrms

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)
# httpx logs every request at INFO; 33 lines per refresh is noise.
logging.getLogger("httpx").setLevel(logging.WARNING)


# ============================================================================
# VERSION
# ============================================================================
# One version for the whole project: the repo-root VERSION file, copied into
# the image next to this file at build time (with "+<build>" metadata for
# non-release builds). Falls back to the repo-root file when run from a
# checkout (tests, dev).
def _read_version() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    for candidate in (os.path.join(here, "VERSION"), os.path.join(here, os.pardir, "VERSION")):
        try:
            with open(candidate, encoding="utf-8") as fh:
                value = fh.read().strip()
            if value:
                return value
        except OSError:
            continue
    return "0.0.0+unknown"


APP_VERSION = _read_version()

ROUTE_API_CONTACT = os.getenv("ROUTE_API_CONTACT", "").strip()
USER_AGENT = f"adsb-3d/{APP_VERSION} weather-service (+https://github.com/hook-365/adsb-3d" + (
    f"; {ROUTE_API_CONTACT}" if ROUTE_API_CONTACT else "") + ")"


# ============================================================================
# CONFIG
# ============================================================================
def _float_env(name: str, default: float | None) -> float | None:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.error("%s=%r is not a number", name, raw)
        return default


PREWARM_LAT = _float_env("LATITUDE", None)
PREWARM_LON = _float_env("LONGITUDE", None)
RADIUS_NM = max(25.0, min(_float_env("WEATHER3D_RADIUS_NM", 250.0) or 250.0, 600.0))
MIN_REFRESH_S = 120.0


def clamp_refresh_s(raw: float | None) -> float:
    """WEATHER3D_REFRESH_S with its floor applied: NOAA publishes MRMS every
    two minutes, so anything below MIN_REFRESH_S only hammers their server
    for identical files. Unset/garbage falls back to 300."""
    return max(MIN_REFRESH_S, raw or 300.0)


REFRESH_S = clamp_refresh_s(_float_env("WEATHER3D_REFRESH_S", 300.0))
LOCATION_TTL_S = max(REFRESH_S, _float_env("WEATHER3D_LOCATION_TTL_S", 1800.0) or 1800.0)
MAX_LOCATIONS = 16
DOWNLOADS_AT_ONCE = 4
TIMEOUT_S = 45.0


def _fields_env() -> list[str]:
    raw_env = os.getenv("WEATHER_FIELDS")
    if raw_env is None:
        return list(mrms.DEFAULT_FIELDS)
    out: list[str] = []
    for item in raw_env.split(","):
        item = item.strip().lower()
        if not item:
            continue
        if item not in mrms.PRODUCTS:
            logger.error("WEATHER_FIELDS: unknown product %r (known: %s)", item, ", ".join(mrms.PRODUCTS))
            continue
        out.append(item)
    return out


FIELDS = _fields_env()


# ============================================================================
# STATE
# ============================================================================
@dataclass
class VolumeSet:
    time: int                 # MRMS valid time, unix seconds (newest level)
    built_at: float           # unix seconds the build finished
    bounds: dict
    nx: int
    ny: int
    nz: int
    heights_km: list[float]
    levels_missing: list[float]
    data: bytes               # uint8, nz*ny*nx
    gz: bytes = field(repr=False, default=b"")

    def manifest(self, key: str) -> dict:
        return {
            "coverage": True,
            "time": self.time,
            "builtAt": int(self.built_at),
            "bounds": self.bounds,
            "nx": self.nx,
            "ny": self.ny,
            "nz": self.nz,
            "heightsKm": self.heights_km,
            "levelsMissing": self.levels_missing,
            "url": f"/volume.bin?loc={key}&t={self.time}",
        }


@dataclass
class FieldSet:
    """One location's packed 2-D products (uint8 grids, one per product)."""
    built_at: float
    bounds: dict
    nx: int
    ny: int
    times: dict[str, int]                 # product id -> MRMS valid time
    data: dict[str, bytes]                # product id -> uint8 ny*nx
    gz: dict[str, bytes] = field(repr=False, default_factory=dict)

    def manifest(self, key: str) -> dict:
        fields = {}
        for pid, t in self.times.items():
            p = mrms.PRODUCTS[pid]
            fields[pid] = {
                "time": t,
                "unit": p.unit,
                "scale": p.scale,
                "offset": p.offset,
                "log": p.log,
                "url": f"/field.bin?loc={key}&f={pid}&t={t}",
            }
        return {
            "coverage": True,
            "builtAt": int(self.built_at),
            "bounds": self.bounds,
            "nx": self.nx,
            "ny": self.ny,
            "fields": fields,
        }


@dataclass
class Location:
    key: str
    lat: float
    lon: float
    last_requested: float
    pinned: bool = False      # LATITUDE/LONGITUDE pre-warm never expires
    volume: VolumeSet | None = None
    fields: FieldSet | None = None
    error: str | None = None


@dataclass
class RawLevels:
    """The last successful download: gz bytes per level (None = failed)."""
    gz: list[bytes | None]
    fetched_at: float


@dataclass
class RawField:
    gz: bytes
    fetched_at: float


raw_fields: dict[str, RawField] = {}   # product id -> last good download


def location_key(lat: float, lon: float) -> str:
    """Two decimals (~1 km): feeds closer than that share one crop."""
    return f"{lat:.2f},{lon:.2f}"


locations: dict[str, Location] = {}
raw: RawLevels | None = None
last_error: str | None = None
started_at = time.time()
refresh_task: asyncio.Task | None = None
build_lock = asyncio.Lock()
wake = asyncio.Event()      # set when a new location wants an immediate build


def register(lat: float, lon: float, *, pinned: bool = False) -> Location:
    key = location_key(lat, lon)
    loc = locations.get(key)
    now = time.time()
    if loc is None:
        if len(locations) >= MAX_LOCATIONS:
            # Evict the stalest unpinned one rather than refuse.
            victims = sorted((x for x in locations.values() if not x.pinned), key=lambda x: x.last_requested)
            if victims:
                del locations[victims[0].key]
        loc = Location(key=key, lat=lat, lon=lon, last_requested=now, pinned=pinned)
        locations[key] = loc
        logger.info("location %s registered%s", key, " (pinned)" if pinned else "")
    loc.last_requested = now
    loc.pinned = loc.pinned or pinned
    return loc


def expire_locations() -> None:
    cutoff = time.time() - LOCATION_TTL_S
    for key in [k for k, x in locations.items() if not x.pinned and x.last_requested < cutoff]:
        del locations[key]
        logger.info("location %s expired", key)


# ============================================================================
# DOWNLOAD + BUILD
# ============================================================================
async def download_levels(fetch=None) -> RawLevels:
    """All 33 levels as gz bytes, 4 at a time. A failed level is None; only a
    total failure raises. `fetch(km) -> bytes` can be injected for tests."""
    n = len(mrms.LEVELS_KM)
    out: list[bytes | None] = [None] * n
    sem = asyncio.Semaphore(DOWNLOADS_AT_ONCE)

    async def one(i: int, client: httpx.AsyncClient | None) -> None:
        km = mrms.LEVELS_KM[i]
        try:
            async with sem:
                if fetch is not None:
                    out[i] = await fetch(km)
                else:
                    r = await client.get(mrms.level_url(km))  # type: ignore[union-attr]
                    r.raise_for_status()
                    out[i] = r.content
        except Exception as e:  # noqa: BLE001 - one bad level must not sink the refresh
            logger.warning("level %s km: %s", km, e)

    if fetch is None:
        async with httpx.AsyncClient(timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT},
                                     follow_redirects=True) as client:
            await asyncio.gather(*(one(i, client) for i in range(n)))
    else:
        await asyncio.gather(*(one(i, None) for i in range(n)))
    if all(b is None for b in out):
        raise RuntimeError("no MRMS levels available")
    return RawLevels(gz=out, fetched_at=time.time())


async def download_fields(fetch=None, now: float | None = None) -> int:
    """Re-fetch every enabled 2-D product that is due (its own refresh_s,
    else every cycle). Failures keep the previous download. Returns how
    many were refreshed. `fetch(product) -> bytes` can be injected."""
    now = time.time() if now is None else now
    due = [mrms.PRODUCTS[pid] for pid in FIELDS
           if pid not in raw_fields or now - raw_fields[pid].fetched_at >= mrms.PRODUCTS[pid].refresh_s]
    if not due:
        return 0
    sem = asyncio.Semaphore(DOWNLOADS_AT_ONCE)
    got = 0

    async def one(p: mrms.Product, client: httpx.AsyncClient | None) -> None:
        nonlocal got
        try:
            async with sem:
                if fetch is not None:
                    body = await fetch(p)
                else:
                    r = await client.get(p.url)  # type: ignore[union-attr]
                    r.raise_for_status()
                    body = r.content
            raw_fields[p.id] = RawField(gz=body, fetched_at=now)
            got += 1
        except Exception as e:  # noqa: BLE001 - one bad product must not sink the refresh
            logger.warning("field %s: %s", p.id, e)

    if fetch is None:
        async with httpx.AsyncClient(timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT},
                                     follow_redirects=True) as client:
            await asyncio.gather(*(one(p, client) for p in due))
    else:
        await asyncio.gather(*(one(p, None) for p in due))
    return got


def build_fields(fields: dict[str, RawField], locs: list[Location], radius_nm: float) -> dict[str, FieldSet]:
    """CPU: decode each product once, crop + pack it for every location.
    Products on a finer grid than the reflectivity levels (0.005 deg
    products) get a proportionally larger block so every field of a
    location shares one nx x ny grid and one set of bounds."""
    per_loc: dict[str, dict[str, np.ndarray]] = {x.key: {} for x in locs}
    times: dict[str, dict[str, int]] = {x.key: {} for x in locs}
    bounds: dict[str, dict] = {}
    shapes: dict[str, tuple[int, int]] = {}
    for pid, rf in fields.items():
        product = mrms.PRODUCTS[pid]
        try:
            msg = mrms.parse_grib2(gzip.decompress(rf.gz))
            t = int(msg.ref_time.timestamp()) if msg.ref_time else int(rf.fetched_at)
            for loc in locs:
                try:
                    win = mrms.crop_window(msg, loc.lat, loc.lon, radius_nm)
                except ValueError:
                    continue
                # Reference block from the first product seen for this location
                # at the coarsest (0.01) grid; finer grids scale it up.
                cropped = mrms.decode_field(msg, win)
                block = mrms.block_for(win.shape)
                packed = mrms.pack_field(cropped, product, block)
                ref_shape = shapes.get(loc.key)
                if ref_shape is None:
                    shapes[loc.key] = packed.shape
                    bounds[loc.key] = mrms.window_bounds_after_block(win, block, msg.cell_deg)
                elif packed.shape != ref_shape:
                    # Grid mismatch (different resolution rounding): resample by
                    # nearest neighbour onto the reference shape.
                    ry = (np.arange(ref_shape[0]) * packed.shape[0] / ref_shape[0]).astype(int)
                    rx = (np.arange(ref_shape[1]) * packed.shape[1] / ref_shape[1]).astype(int)
                    packed = packed[ry][:, rx]
                per_loc[loc.key][pid] = packed
                times[loc.key][pid] = t
        except Exception as e:  # noqa: BLE001
            logger.warning("field %s: %s", pid, e)
    now = time.time()
    result: dict[str, FieldSet] = {}
    for loc in locs:
        grids = per_loc[loc.key]
        if not grids:
            continue
        ny, nx = shapes[loc.key]
        data = {pid: g.tobytes() for pid, g in grids.items()}
        result[loc.key] = FieldSet(
            built_at=now, bounds=bounds[loc.key], nx=nx, ny=ny,
            times=times[loc.key], data=data,
            gz={pid: gzip.compress(b, compresslevel=6) for pid, b in data.items()},
        )
    return result


def build_volumes(levels: RawLevels, locs: list[Location], radius_nm: float) -> dict[str, VolumeSet]:
    """CPU: decode each level once, crop it for every location. Runs in a
    thread. A failed level is filled from its nearest good neighbour and
    listed in levels_missing."""
    n = len(mrms.LEVELS_KM)
    per_loc: dict[str, list[np.ndarray | None]] = {x.key: [None] * n for x in locs}
    bounds: dict[str, dict] = {}
    times: list[int] = []
    for i, gz_bytes in enumerate(levels.gz):
        if gz_bytes is None:
            continue
        try:
            msg = mrms.parse_grib2(gzip.decompress(gz_bytes))
            if msg.ref_time:
                times.append(int(msg.ref_time.timestamp()))
            full = None
            for loc in locs:
                try:
                    win = mrms.crop_window(msg, loc.lat, loc.lon, radius_nm)
                except ValueError:
                    continue
                if full is None:
                    full = mrms.decode_slice(msg)          # once per level
                dbz = full[win.row0:win.row1, win.col0:win.col1]
                block = mrms.block_for(win.shape)
                per_loc[loc.key][i] = mrms.downsample_max(dbz, block)
                bounds.setdefault(loc.key, mrms.window_bounds_after_block(win, block, msg.cell_deg))
        except Exception as e:  # noqa: BLE001
            logger.warning("level %s km: %s", mrms.LEVELS_KM[i], e)
    now = time.time()
    result: dict[str, VolumeSet] = {}
    for loc in locs:
        grids = per_loc[loc.key]
        good = [i for i, g in enumerate(grids) if g is not None]
        if not good:
            continue
        shape = grids[good[0]].shape  # type: ignore[union-attr]
        for i in good:
            if grids[i].shape != shape:  # type: ignore[union-attr]
                grids[i] = None
        good = [i for i, g in enumerate(grids) if g is not None]
        missing: list[float] = []
        for i in range(n):
            if grids[i] is None:
                grids[i] = grids[min(good, key=lambda j: abs(j - i))]
                missing.append(mrms.HEIGHTS_KM[i])
        data = np.stack(grids, axis=0).tobytes()
        result[loc.key] = VolumeSet(
            time=max(times) if times else int(now),
            built_at=now,
            bounds=bounds[loc.key],
            nx=shape[1], ny=shape[0], nz=n,
            heights_km=list(mrms.HEIGHTS_KM),
            levels_missing=missing,
            data=data,
            gz=gzip.compress(data, compresslevel=6),
        )
    return result


async def rebuild(locs: list[Location]) -> None:
    """Crop the cached raw levels for `locs` (those with no volume for the
    current raw set, or all of them after a fresh download)."""
    global last_error
    if raw is None or not locs:
        return
    async with build_lock:
        t0 = time.monotonic()
        try:
            built = await asyncio.to_thread(build_volumes, raw, locs, RADIUS_NM)
        except Exception as e:  # noqa: BLE001
            last_error = str(e)
            logger.error("volume build failed: %s", e)
            return
        for loc in locs:
            vol = built.get(loc.key)
            if vol is None:
                loc.error = "outside the MRMS grid"
                loc.volume = None
            else:
                loc.volume, loc.error = vol, None
        last_error = None
        logger.info("built %d location(s) in %.1fs: %s", len(built), time.monotonic() - t0,
                    ", ".join(f"{k} {v.nx}x{v.ny}x{v.nz} {len(v.gz) // 1024}KB" for k, v in built.items()))
        if raw_fields:
            t1 = time.monotonic()
            try:
                built_fields = await asyncio.to_thread(build_fields, dict(raw_fields), locs, RADIUS_NM)
            except Exception as e:  # noqa: BLE001
                logger.error("field build failed: %s", e)
                return
            for loc in locs:
                loc.fields = built_fields.get(loc.key)
            logger.info("built fields for %d location(s) in %.1fs: %s", len(built_fields), time.monotonic() - t1,
                        ", ".join(f"{k} {len(v.data)} fields {sum(len(g) for g in v.gz.values()) // 1024}KB"
                                  for k, v in built_fields.items()))


async def refresh_loop() -> None:
    global raw, last_error
    next_download = 0.0
    while True:
        now = time.monotonic()
        if now >= next_download:
            try:
                raw = await download_levels()
                last_error = None
                next_download = time.monotonic() + REFRESH_S
                expire_locations()
                if FIELDS:
                    n_fields = await download_fields()
                    if n_fields:
                        logger.info("refreshed %d field(s)", n_fields)
                await rebuild(list(locations.values()))
            except Exception as e:  # noqa: BLE001
                last_error = str(e)
                logger.error("MRMS download failed: %s", e)
                next_download = time.monotonic() + 60.0
        else:
            # A viewer asked about a new location: crop the cached levels now.
            stale = [x for x in locations.values()
                     if x.volume is None or x.volume.built_at < (raw.fetched_at if raw else 0)
                     or (raw_fields and x.fields is None)]
            if stale:
                await rebuild(stale)
        wake.clear()
        try:
            await asyncio.wait_for(wake.wait(), timeout=max(1.0, next_download - time.monotonic()))
        except asyncio.TimeoutError:
            pass


# ============================================================================
# FASTAPI APPLICATION
# ============================================================================
app = FastAPI(
    title="Weather Service",
    description="NOAA MRMS 3-D storm volumes for adsb-3d",
    version=APP_VERSION,
)
# nginx strips these again; they only matter when hitting the service directly.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.on_event("startup")
async def startup() -> None:
    global refresh_task
    if PREWARM_LAT is not None and PREWARM_LON is not None:
        if mrms.has_coverage(PREWARM_LAT, PREWARM_LON):
            register(PREWARM_LAT, PREWARM_LON, pinned=True)
        else:
            logger.warning("LATITUDE/LONGITUDE %.2f,%.2f is outside the MRMS CONUS mosaic", PREWARM_LAT, PREWARM_LON)
    logger.info("MRMS volumes +/- %.0f nm, refresh %.0fs, location TTL %.0fs, fields [%s], UA %s",
                RADIUS_NM, REFRESH_S, LOCATION_TTL_S, ", ".join(FIELDS) or "none", USER_AGENT)
    refresh_task = asyncio.create_task(refresh_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    if refresh_task:
        refresh_task.cancel()


@app.get("/")
async def root() -> dict:
    return {"name": "Weather Service", "version": APP_VERSION, "docs": "/docs"}


@app.get("/health")
async def health() -> Response:
    """200 while the MRMS download loop is working or still warming up; 503
    once two refresh periods have passed without a successful download so
    Docker marks the container unhealthy."""
    age = time.time() - started_at
    payload = {
        "status": "healthy",
        "version": APP_VERSION,
        "lastDownload": int(raw.fetched_at) if raw else None,
        "lastError": last_error,
        "fields": {pid: int(rf.fetched_at) for pid, rf in raw_fields.items()},
        "locations": [
            {"key": x.key, "pinned": x.pinned, "volumeTime": x.volume.time if x.volume else None,
             "levelsMissing": x.volume.levels_missing if x.volume else None, "error": x.error}
            for x in locations.values()
        ],
    }
    code = 200
    if raw is None:
        warming = age < 2 * REFRESH_S
        payload["status"] = "starting" if warming else "unhealthy"
        code = 200 if warming else 503
    return JSONResponse(payload, status_code=code)


@app.get("/volume")
async def volume_manifest(lat: float = Query(..., ge=-90, le=90),
                          lon: float = Query(..., ge=-180, le=180)) -> Response:
    headers = {"Cache-Control": "no-store"}
    if not mrms.has_coverage(lat, lon):
        return JSONResponse({"coverage": False}, headers=headers)
    loc = register(lat, lon)
    if loc.volume is None:
        wake.set()
        return JSONResponse({"coverage": True, "building": True, "error": loc.error or last_error},
                            status_code=503, headers=headers)
    return JSONResponse(loc.volume.manifest(loc.key), headers=headers)


@app.get("/fields")
async def fields_manifest(lat: float = Query(..., ge=-90, le=90),
                          lon: float = Query(..., ge=-180, le=180)) -> Response:
    """Manifest of every enabled 2-D product cropped around (lat, lon):
    shared bounds and grid, per-field valid time, packing and URL."""
    headers = {"Cache-Control": "no-store"}
    if not FIELDS:
        return JSONResponse({"coverage": False, "reason": "no fields enabled"}, headers=headers)
    if not mrms.has_coverage(lat, lon):
        return JSONResponse({"coverage": False}, headers=headers)
    loc = register(lat, lon)
    if loc.fields is None:
        wake.set()
        return JSONResponse({"coverage": True, "building": True, "error": loc.error or last_error},
                            status_code=503, headers=headers)
    return JSONResponse(loc.fields.manifest(loc.key), headers=headers)


@app.get("/field.bin")
async def field_bin(loc: str = Query(..., max_length=32), f: str = Query(..., max_length=16)) -> Response:
    entry = locations.get(loc)
    if entry is None or entry.fields is None or f not in entry.fields.gz:
        return JSONResponse({"error": "no such field for that location"}, status_code=404)
    entry.last_requested = time.time()
    fs = entry.fields
    return Response(
        content=fs.gz[f],
        media_type="application/octet-stream",
        headers={
            "Content-Encoding": "gzip",
            "Cache-Control": "public, max-age=60",
            "X-Field-Time": str(fs.times[f]),
            "X-Field-Shape": f"{fs.ny}x{fs.nx}",
        },
    )


@app.get("/volume.bin")
async def volume_bin(loc: str = Query(..., max_length=32)) -> Response:
    entry = locations.get(loc)
    if entry is None or entry.volume is None:
        return JSONResponse({"error": "no volume for that location"}, status_code=404)
    entry.last_requested = time.time()
    vol = entry.volume
    # Pre-gzipped at build time so a popular deployment never recompresses
    # per viewer; GZipMiddleware leaves already-encoded responses alone.
    return Response(
        content=vol.gz,
        media_type="application/octet-stream",
        headers={
            "Content-Encoding": "gzip",
            "Cache-Control": "public, max-age=60",
            "X-Volume-Time": str(vol.time),
            "X-Volume-Shape": f"{vol.nz}x{vol.ny}x{vol.nx}",
        },
    )
