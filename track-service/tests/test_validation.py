# Only 4xx (validation-failure) paths are exercised here. Valid-input paths
# would reach `db_pool.acquire(...)` and hang/crash since this suite never
# runs the FastAPI startup event (no real database available in CI) — see
# conftest.py and main.py's `@app.on_event("startup")`. Instantiating
# TestClient WITHOUT `with ... as client:` is what keeps startup from firing.
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


class TestTrackValidation:
    def test_bad_icao_too_long_returns_400(self):
        resp = client.get("/tracks/012345678")
        assert resp.status_code == 400

    def test_bad_icao_non_hex_returns_400(self):
        resp = client.get("/tracks/zzzzzz")
        assert resp.status_code == 400

    def test_bad_resolution_returns_422(self):
        resp = client.get("/tracks/abc123", params={"resolution": "not-a-resolution"})
        assert resp.status_code == 422


class TestRecordsValidation:
    def test_days_zero_returns_422(self):
        resp = client.get("/stats/records", params={"days": 0})
        assert resp.status_code == 422

    def test_days_over_max_returns_422(self):
        resp = client.get("/stats/records", params={"days": 366})
        assert resp.status_code == 422
