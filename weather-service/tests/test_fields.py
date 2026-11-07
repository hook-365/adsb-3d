"""2-D products: sentinel-aware decode, pooling + uint8 packing, the field
download cadence, per-location builds and the /fields endpoints. Uses the
synthetic GRIB2 writer from test_mrms (values packed with one decimal)."""

import gzip

import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient

import main
import mrms
from test_mrms import HOME_LAT, HOME_LON, NI, NJ, REF_TIME, make_grib2


def field_grid(fill: float, *, spot: float | None = None) -> np.ndarray:
    g = np.full((NJ, NI), fill, dtype=np.float32)
    if spot is not None:
        g[11:13, 21:24] = spot
    g[0, 0] = -3.0        # no coverage
    g[1, 1] = -1.0        # no echo
    return g


def _loc(lat, lon):
    return main.Location(key=main.location_key(lat, lon), lat=lat, lon=lon, last_requested=0.0)


# ---------------------------------------------------------------------------
# mrms.py
# ---------------------------------------------------------------------------
def test_decode_field_keeps_values_and_nans_sentinels():
    msg = mrms.parse_grib2(make_grib2(field_grid(4.5, spot=12.0)))
    v = mrms.decode_field(msg)
    assert np.isnan(v[0, 0]) and np.isnan(v[1, 1])
    assert v[12, 22] == pytest.approx(12.0) and v[5, 5] == pytest.approx(4.5)


def test_pack_field_max_mean_log_and_rank():
    echo = mrms.PRODUCTS["echotop18"]
    a = np.array([[1.0, np.nan], [2.5, 12.0]], dtype=np.float32)
    assert mrms.pack_field(a, echo, 2).tolist() == [[120]]          # max 12.0 km * 10
    assert mrms.pack_field(a, echo, 1).tolist() == [[10, 0], [25, 120]]  # NaN -> 0
    frz = mrms.PRODUCTS["freezing"]
    h = np.array([[4000.0, np.nan], [4400.0, 4000.0]], dtype=np.float32)
    assert mrms.pack_field(h, frz, 2).tolist() == [[round(4133.33 / 40)]]  # nanmean ignores the hole
    rate = mrms.PRODUCTS["preciprate"]
    r = np.array([[0.0, 1.0], [7.0, 255.0]], dtype=np.float32)
    packed = mrms.pack_field(r, rate, 1)
    assert packed[0, 0] == 0 and packed[0, 1] == 32 and packed[1, 0] == 96   # 32*log2(1+v)
    assert packed[1, 1] == 255                                              # clamps
    flags = mrms.PRODUCTS["preciptype"]
    f = np.array([[96.0, 7.0], [1.0, 0.0]], dtype=np.float32)
    assert mrms.pack_field(f, flags, 2).tolist() == [[4]]   # hail (7) outranks tropical convective (96)
    assert mrms.pack_field(f, flags, 1).tolist() == [[3, 4], [1, 0]]


def test_product_urls_and_defaults():
    assert mrms.PRODUCTS["echotop18"].url == "https://mrms.ncep.noaa.gov/2D/EchoTop_18/MRMS_EchoTop_18.latest.grib2.gz"
    assert all(pid in mrms.PRODUCTS for pid in mrms.DEFAULT_FIELDS)
    assert "bbtop" not in mrms.DEFAULT_FIELDS      # 15 MB each: opt-in


# ---------------------------------------------------------------------------
# main.py: download cadence, build, endpoints
# ---------------------------------------------------------------------------
def _fetcher(values: dict[str, float], fail: set[str] = frozenset()):
    calls: list[str] = []

    async def fetch(product: mrms.Product) -> bytes:
        calls.append(product.id)
        if product.id in fail:
            raise RuntimeError("boom")
        return gzip.compress(make_grib2(field_grid(values.get(product.id, 1.0), spot=values.get(product.id, 1.0) * 2)))
    fetch.calls = calls  # type: ignore[attr-defined]
    return fetch


async def test_download_fields_respects_each_products_cadence(monkeypatch):
    monkeypatch.setattr(main, "FIELDS", ["echotop18", "freezing"])
    monkeypatch.setattr(main, "raw_fields", {})
    fetch = _fetcher({"echotop18": 5.0, "freezing": 3000.0})
    assert await main.download_fields(fetch=fetch, now=1000.0) == 2
    # Next cycle 300 s later: the 2-minute echo top is due, the hourly model field is not.
    assert await main.download_fields(fetch=fetch, now=1300.0) == 1
    assert fetch.calls == ["echotop18", "freezing", "echotop18"]
    # A failure keeps the previous download.
    fetch2 = _fetcher({}, fail={"echotop18"})
    before = main.raw_fields["echotop18"].gz
    assert await main.download_fields(fetch=fetch2, now=1700.0) == 0
    assert main.raw_fields["echotop18"].gz == before


async def test_build_fields_shared_grid_and_packing(monkeypatch):
    monkeypatch.setattr(main, "FIELDS", ["echotop18", "mesh"])
    monkeypatch.setattr(main, "raw_fields", {})
    await main.download_fields(fetch=_fetcher({"echotop18": 6.0, "mesh": 10.0}), now=0.0)
    built = main.build_fields(main.raw_fields, [_loc(HOME_LAT, HOME_LON), _loc(30.0, -80.0)], 3.0)
    assert list(built) == [main.location_key(HOME_LAT, HOME_LON)]   # the other is outside the grid
    fs = built[main.location_key(HOME_LAT, HOME_LON)]
    assert set(fs.data) == {"echotop18", "mesh"} and fs.times["echotop18"] == REF_TIME
    echo = np.frombuffer(fs.data["echotop18"], dtype=np.uint8).reshape(fs.ny, fs.nx)
    assert echo.max() == 120 and echo.min() >= 0                     # spot 12 km * 10
    mesh = np.frombuffer(fs.data["mesh"], dtype=np.uint8).reshape(fs.ny, fs.nx)
    assert mesh.max() == 40                                           # spot 20 mm * 2
    assert fs.bounds["north"] > HOME_LAT > fs.bounds["south"]
    m = fs.manifest("k")
    assert m["fields"]["mesh"]["url"] == f"/field.bin?loc=k&f=mesh&t={REF_TIME}"
    assert m["fields"]["echotop18"]["scale"] == 10.0 and m["fields"]["echotop18"]["log"] is False


async def test_fields_endpoints(monkeypatch):
    monkeypatch.setattr(main, "locations", {})
    monkeypatch.setattr(main, "raw", None)
    monkeypatch.setattr(main, "raw_fields", {})
    monkeypatch.setattr(main, "FIELDS", ["echotop18"])
    q = f"lat={HOME_LAT}&lon={HOME_LON}"
    async with AsyncClient(transport=ASGITransport(app=main.app), base_url="http://t") as c:
        r = await c.get(f"/fields?{q}")
        assert r.status_code == 503 and r.json()["building"] is True
        assert (await c.get("/fields?lat=51.5&lon=-0.1")).json() == {"coverage": False}
        key = main.location_key(HOME_LAT, HOME_LON)
        assert (await c.get(f"/field.bin?loc={key}&f=echotop18")).status_code == 404
    levels = main.RawLevels(gz=[gzip.compress(make_grib2(field_grid(10.0)))] * 33, fetched_at=0.0)
    monkeypatch.setattr(main, "raw", levels)
    await main.download_fields(fetch=_fetcher({"echotop18": 7.0}), now=0.0)
    await main.rebuild(list(main.locations.values()))
    async with AsyncClient(transport=ASGITransport(app=main.app), base_url="http://t") as c:
        m = (await c.get(f"/fields?{q}")).json()
        assert m["coverage"] and m["nx"] > 0 and "echotop18" in m["fields"]
        b = await c.get(m["fields"]["echotop18"]["url"])
        assert b.status_code == 200 and b.headers["x-field-shape"] == f"{m['ny']}x{m['nx']}"
        assert len(b.content) == m["nx"] * m["ny"]
        assert (await c.get(f"/field.bin?loc={key}&f=nope")).status_code == 404
        h = (await c.get("/health")).json()
        assert "echotop18" in h["fields"]

    monkeypatch.setattr(main, "FIELDS", [])
    async with AsyncClient(transport=ASGITransport(app=main.app), base_url="http://t") as c:
        assert (await c.get(f"/fields?{q}")).json()["coverage"] is False
