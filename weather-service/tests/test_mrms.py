"""Decode + crop maths against a synthetic MRMS-shaped GRIB2 message, and the
HTTP surface with an injected fetcher. No network."""

import gzip
import struct
from io import BytesIO

import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

import main
import mrms

# A tiny "CONUS": 0.01 deg cells, 40 cols x 30 rows, north-west corner at
# 45.0N 265.0E (= -95.0), like MRMS stores longitude 0..360.
NI, NJ = 40, 30
LAT1, LON1 = 45.0, 265.0
LAT2, LON2 = LAT1 - (NJ - 1) * 0.01, LON1 + (NI - 1) * 0.01
# MRMS packing: R=-999*10, E=0, D=1 -> dBZ = (R + raw) / 10
R, E, D = -9990.0, 0, 1


def _section(num: int, body: bytes) -> bytes:
    return struct.pack(">IB", 5 + len(body), num) + body


def make_grib2(dbz: np.ndarray, *, lon1: float = LON1, ref=(2026, 11, 5, 18, 30, 0)) -> bytes:
    """Wrap a float dBZ grid (row 0 = north) as the GRIB2 subset we parse."""
    raw = np.round(dbz * 10 - R).astype(np.uint16)
    buf = BytesIO()
    Image.fromarray(raw).save(buf, format="PNG")
    png = buf.getvalue()

    s1 = bytearray(16)
    struct.pack_into(">HBBBBB", s1, 7, *ref)  # +12 from section start = +7 into body
    s3 = bytearray(67)
    struct.pack_into(">H", s3, 7, 0)                  # template 3.0 at o+12
    struct.pack_into(">II", s3, 25, NI, NJ)           # o+30, o+34
    struct.pack_into(">ii", s3, 41, int(LAT1 * 1e6), int(lon1 * 1e6))  # o+46, o+50
    struct.pack_into(">ii", s3, 50, int(LAT2 * 1e6), int((lon1 + (NI - 1) * 0.01) * 1e6))  # o+55, o+59
    s5 = bytearray(20)
    struct.pack_into(">H", s5, 4, 41)                 # template 5.41 at o+9
    struct.pack_into(">f", s5, 6, R)                  # o+11
    struct.pack_into(">HH", s5, 10, E, D)             # o+15, o+17
    s5[14] = 16                                       # bits at o+19
    return (b"GRIB" + b"\0\0\0" + bytes([2]) + struct.pack(">Q", 0)
            + _section(1, bytes(s1)) + _section(3, bytes(s3)) + _section(5, bytes(s5))
            + _section(7, png) + b"7777")


def storm_grid(peak: float = 55.0) -> np.ndarray:
    g = np.zeros((NJ, NI), dtype=np.float32)
    g[10:14, 20:26] = peak          # a cell
    g[12, 22] = peak + 5            # its core
    g[0, 0] = -99.0                 # no-coverage sentinel
    g[NJ - 1, NI - 1] = -999.0      # missing sentinel
    return g


def test_parse_grib2_fields():
    msg = mrms.parse_grib2(make_grib2(storm_grid()))
    assert (msg.ni, msg.nj) == (NI, NJ)
    assert msg.lat1 == pytest.approx(LAT1)
    assert msg.lon1 == pytest.approx(LON1)
    assert msg.west == pytest.approx(-95.0)
    assert msg.east == pytest.approx(-95.0 + (NI - 1) * 0.01)
    assert msg.north == pytest.approx(LAT1)
    assert msg.cell_deg == pytest.approx(0.01)
    assert msg.reference == R
    assert (msg.binary_scale, msg.decimal_scale, msg.bits) == (E, D, 16)
    assert msg.ref_time is not None and msg.ref_time.year == 2026 and msg.ref_time.hour == 18


def test_parse_rejects_garbage():
    with pytest.raises(ValueError):
        mrms.parse_grib2(b"NOTGRIB" + bytes(40))


def test_sign_magnitude_scales():
    assert mrms._sign_magnitude(0x8001) == -1
    assert mrms._sign_magnitude(0x0003) == 3


def test_decode_slice_scale_and_sentinels():
    g = storm_grid()
    msg = mrms.parse_grib2(make_grib2(g))
    dbz = mrms.decode_slice(msg)
    assert dbz.shape == (NJ, NI)
    assert dbz[12, 22] == pytest.approx(60.0, abs=0.05)
    assert dbz[10, 20] == pytest.approx(55.0, abs=0.05)
    assert dbz[0, 0] == 0.0 and dbz[NJ - 1, NI - 1] == 0.0
    assert dbz[5, 5] == 0.0


def test_crop_window_centres_on_home_and_clamps():
    msg = mrms.parse_grib2(make_grib2(storm_grid()))
    # Home at row 12 / col 22 cell centre.
    lat = msg.north - 12 * 0.01
    lon = msg.west + 22 * 0.01
    win = mrms.crop_window(msg, lat, lon, radius_nm=3.0)  # 0.05 deg lat
    assert win.row0 <= 12 - 5 and win.row1 >= 12 + 5
    assert win.col0 <= 22 - 7 and win.col1 >= 22 + 7
    assert win.north > lat > win.south and win.west < lon < win.east
    big = mrms.crop_window(msg, lat, lon, radius_nm=5000)
    assert (big.row0, big.row1, big.col0, big.col1) == (0, NJ, 0, NI)
    with pytest.raises(ValueError):
        mrms.crop_window(msg, lat + 10, lon, radius_nm=3.0)


def test_decode_with_window_matches_full_decode():
    msg = mrms.parse_grib2(make_grib2(storm_grid()))
    win = mrms.crop_window(msg, msg.north - 0.12, msg.west + 0.22, radius_nm=3.0)
    full = mrms.decode_slice(msg)
    part = mrms.decode_slice(msg, win)
    np.testing.assert_array_equal(part, full[win.row0:win.row1, win.col0:win.col1])


def test_downsample_max_keeps_core_and_rounds_half_up():
    a = np.zeros((6, 8), dtype=np.float32)
    a[2, 3] = 47.5
    a[5, 7] = 300.0
    out = mrms.downsample_max(a, 2)
    assert out.shape == (3, 4) and out.dtype == np.uint8
    assert out[1, 1] == 48
    assert out[2, 3] == 255
    assert mrms.downsample_max(a, 1).shape == a.shape
    # Remainder rows/cols are dropped, and the bounds helper shrinks to match.
    b = np.ones((7, 9), dtype=np.float32)
    assert mrms.downsample_max(b, 2).shape == (3, 4)
    win = mrms.Window(0, 7, 0, 9, west=-100.0, east=-99.91, south=44.93, north=45.0)
    bounds = mrms.window_bounds_after_block(win, 2, 0.01)
    assert bounds["east"] == pytest.approx(-100.0 + 8 * 0.01)
    assert bounds["south"] == pytest.approx(45.0 - 6 * 0.01)


def test_block_for():
    assert mrms.block_for((200, 100)) == 1
    assert mrms.block_for((257, 100)) == 2
    assert mrms.block_for((1000, 1000)) == 4


def test_has_coverage():
    assert mrms.has_coverage(40.0, -95.0)
    assert not mrms.has_coverage(51.5, -0.1)
    assert not mrms.has_coverage(21.3, -157.8)


# ---------------------------------------------------------------------------
# download + build with an injected fetcher
# ---------------------------------------------------------------------------
HOME_LAT = LAT1 - 0.12
HOME_LON = -95.0 + 0.22
OTHER_LAT = LAT1 - 0.20
OTHER_LON = -95.0 + 0.10
REF_TIME = int(__import__("datetime").datetime(2026, 11, 5, 18, 30, tzinfo=__import__("datetime").timezone.utc).timestamp())


def _fetcher(fail_levels=(), peak_by_level=None):
    async def fetch(km: str) -> bytes:
        if km in fail_levels:
            raise RuntimeError("HTTP 404")
        peak = (peak_by_level or {}).get(km, 55.0)
        return gzip.compress(make_grib2(storm_grid(peak)))
    return fetch


def _loc(lat, lon, **kw):
    return main.Location(key=main.location_key(lat, lon), lat=lat, lon=lon, last_requested=0.0, **kw)


async def test_download_and_build_shape_and_fill():
    levels = await main.download_levels(fetch=_fetcher(fail_levels={"02.00", "19.00"}))
    assert levels.gz[6] is None and levels.gz[32] is None and levels.gz[0] is not None
    built = main.build_volumes(levels, [_loc(HOME_LAT, HOME_LON), _loc(OTHER_LAT, OTHER_LON)], 3.0)
    assert set(built) == {main.location_key(HOME_LAT, HOME_LON), main.location_key(OTHER_LAT, OTHER_LON)}
    vol = built[main.location_key(HOME_LAT, HOME_LON)]
    assert vol.nz == 33 and vol.ny > 0 and vol.nx > 0
    assert len(vol.data) == vol.nz * vol.ny * vol.nx
    assert vol.levels_missing == [2.0, 19.0]
    arr = np.frombuffer(vol.data, dtype=np.uint8).reshape(vol.nz, vol.ny, vol.nx)
    assert arr.max() == 60
    # Missing level 2.00 (index 6) copies a neighbour, so it is identical to 1.75.
    np.testing.assert_array_equal(arr[6], arr[5])
    assert vol.time == REF_TIME
    assert gzip.decompress(vol.gz) == vol.data
    assert vol.bounds["north"] > HOME_LAT > vol.bounds["south"]
    assert vol.bounds["west"] < HOME_LON < vol.bounds["east"]
    other = built[main.location_key(OTHER_LAT, OTHER_LON)]
    assert other.bounds != vol.bounds


async def test_download_total_failure_raises():
    with pytest.raises(RuntimeError):
        await main.download_levels(fetch=_fetcher(fail_levels=set(mrms.LEVELS_KM)))


def test_build_skips_location_outside_grid():
    levels = main.RawLevels(gz=[gzip.compress(make_grib2(storm_grid()))] * 33, fetched_at=0.0)
    built = main.build_volumes(levels, [_loc(HOME_LAT, HOME_LON), _loc(30.0, -80.0)], 3.0)
    assert list(built) == [main.location_key(HOME_LAT, HOME_LON)]


def test_register_and_expire(monkeypatch):
    monkeypatch.setattr(main, "locations", {})
    a = main.register(HOME_LAT, HOME_LON, pinned=True)
    b = main.register(OTHER_LAT, OTHER_LON)
    assert main.register(HOME_LAT + 0.001, HOME_LON) is a          # same 0.01 deg cell
    b.last_requested -= main.LOCATION_TTL_S + 1
    a.last_requested -= main.LOCATION_TTL_S + 1
    main.expire_locations()
    assert list(main.locations) == [a.key]                         # pinned survives


# ---------------------------------------------------------------------------
# HTTP surface
# ---------------------------------------------------------------------------
async def _client():
    return AsyncClient(transport=ASGITransport(app=main.app), base_url="http://t")


async def test_endpoints_before_and_after_build(monkeypatch):
    monkeypatch.setattr(main, "locations", {})
    monkeypatch.setattr(main, "raw", None)
    q = f"lat={HOME_LAT}&lon={HOME_LON}"
    async with await _client() as c:
        assert (await c.get("/")).json()["name"] == "Weather Service"
        r = await c.get(f"/volume?{q}")
        assert r.status_code == 503 and r.json()["coverage"] is True and r.json()["building"] is True
        assert main.wake.is_set()
        key = main.location_key(HOME_LAT, HOME_LON)
        assert key in main.locations
        assert (await c.get(f"/volume.bin?loc={key}")).status_code == 404
        h = await c.get("/health")
        assert h.status_code == 200 and h.json()["status"] == "starting"
        assert (await c.get("/volume?lat=51.5&lon=-0.1")).json() == {"coverage": False}
        assert (await c.get("/volume?lat=999&lon=0")).status_code == 422

    levels = await main.download_levels(fetch=_fetcher())
    monkeypatch.setattr(main, "raw", levels)
    await main.rebuild(list(main.locations.values()))
    async with await _client() as c:
        m = (await c.get(f"/volume?{q}")).json()
        assert m["coverage"] and m["nz"] == 33 and m["url"] == f"/volume.bin?loc={key}&t={REF_TIME}"
        assert m["heightsKm"][0] == 0.5 and m["heightsKm"][-1] == 19.0
        vol = main.locations[key].volume
        b = await c.get(m["url"], headers={"Accept-Encoding": "gzip"})
        assert b.status_code == 200
        assert b.headers["content-encoding"] == "gzip"
        assert b.headers["x-volume-shape"] == f"33x{vol.ny}x{vol.nx}"
        # httpx transparently decodes; the bytes must be the raw volume once.
        assert b.content == vol.data
        h = (await c.get("/health")).json()
        assert h["status"] == "healthy" and h["locations"][0]["volumeTime"] == REF_TIME
