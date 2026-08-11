from datetime import datetime, timezone

import pytest

import main


def now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()


class TestTTL:
    def test_positive_result_valid_within_ttl(self):
        main.route_cache.clear()
        main.route_cache["UAL1"] = ({"origin": {}}, now_ts())
        assert main._is_route_cached("UAL1") is True

    def test_positive_result_expires_after_ttl(self):
        main.route_cache.clear()
        stale_ts = now_ts() - main.ROUTE_CACHE_TTL - 1
        main.route_cache["UAL1"] = ({"origin": {}}, stale_ts)
        assert main._is_route_cached("UAL1") is False

    def test_negative_result_valid_within_negative_ttl(self):
        main.route_cache.clear()
        main.route_cache["UAL1"] = (None, now_ts())
        assert main._is_route_cached("UAL1") is True

    def test_negative_result_expires_after_negative_ttl(self):
        main.route_cache.clear()
        stale_ts = now_ts() - main.ROUTE_NEGATIVE_TTL - 1
        main.route_cache["UAL1"] = (None, stale_ts)
        assert main._is_route_cached("UAL1") is False

    def test_unknown_callsign_not_cached(self):
        main.route_cache.clear()
        assert main._is_route_cached("GHOST") is False

    def test_get_cached_route_returns_ellipsis_on_miss(self):
        main.route_cache.clear()
        assert main._get_cached_route("GHOST") is ...

    def test_get_cached_route_returns_data_on_hit(self):
        main.route_cache.clear()
        main.route_cache["UAL1"] = ({"origin": "x"}, now_ts())
        assert main._get_cached_route("UAL1") == {"origin": "x"}


class TestEvictionSweep:
    def test_expired_entries_are_swept(self):
        main.route_cache.clear()
        stale_ts = now_ts() - main.ROUTE_CACHE_TTL - 1
        main.route_cache["OLD1"] = ({"origin": {}}, stale_ts)
        main.route_cache["FRESH1"] = ({"origin": {}}, now_ts())
        main._route_cache_evict_expired()
        assert "OLD1" not in main.route_cache
        assert "FRESH1" in main.route_cache

    def test_oldest_trimmed_past_cap(self, monkeypatch):
        main.route_cache.clear()
        monkeypatch.setattr(main, "ROUTE_CACHE_MAX", 3)
        base = now_ts()
        for i in range(5):
            main.route_cache[f"CS{i}"] = ({"origin": {}}, base + i)
        main._route_cache_evict_expired()
        assert len(main.route_cache) == 3
        # The three most-recently-written entries should survive.
        assert set(main.route_cache.keys()) == {"CS2", "CS3", "CS4"}


class FakeResponse:
    def __init__(self, status: int, body):
        self.status = status
        self._body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def json(self):
        return self._body


class FakeSession:
    def __init__(self, response: FakeResponse | None = None, raise_exc: Exception | None = None):
        self._response = response
        self._raise_exc = raise_exc

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def post(self, url, json=None):
        if self._raise_exc:
            raise self._raise_exc
        return self._response


@pytest.mark.asyncio
class TestCircuitBreaker:
    async def test_five_failures_opens_the_circuit(self, monkeypatch):
        main.route_cache.clear()
        monkeypatch.setattr(main, "_route_circuit_failures", 0)
        monkeypatch.setattr(main, "_route_circuit_open_until", 0.0)

        def failing_session(*args, **kwargs):
            return FakeSession(raise_exc=RuntimeError("boom"))

        monkeypatch.setattr(main.aiohttp, "ClientSession", failing_session)

        for _ in range(main.ROUTE_CIRCUIT_THRESHOLD):
            await main._fetch_routes_from_adsb_im(["UAL1"])

        assert main._route_circuit_failures >= main.ROUTE_CIRCUIT_THRESHOLD
        assert main._route_circuit_open_until > now_ts()

    async def test_open_circuit_short_circuits_without_calling_aiohttp(self, monkeypatch):
        main.route_cache.clear()
        monkeypatch.setattr(main, "_route_circuit_open_until", now_ts() + 60)

        called = False

        def should_not_be_called(*args, **kwargs):
            nonlocal called
            called = True
            return FakeSession()

        monkeypatch.setattr(main.aiohttp, "ClientSession", should_not_be_called)

        result = await main._fetch_routes_from_adsb_im(["UAL1"])
        assert result == {}
        assert called is False

    async def test_success_resets_failure_count(self, monkeypatch):
        main.route_cache.clear()
        monkeypatch.setattr(main, "_route_circuit_failures", 3)
        monkeypatch.setattr(main, "_route_circuit_open_until", 0.0)

        response = FakeResponse(200, [])

        def ok_session(*args, **kwargs):
            return FakeSession(response=response)

        monkeypatch.setattr(main.aiohttp, "ClientSession", ok_session)

        await main._fetch_routes_from_adsb_im(["UAL1"])
        assert main._route_circuit_failures == 0
