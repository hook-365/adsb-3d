"""Shared route cache: one upstream call per collection window, cached per callsign."""
import asyncio

import pytest

import main


def _entry(cs, frm, to):
    return {"callsign": cs, "_airport_codes_iata": f"{frm}-{to}",
            "_airports": [{"iata": frm}, {"iata": to}], "plausible": True}


@pytest.fixture
def batcher(monkeypatch):
    monkeypatch.setattr(main, "ROUTE_BATCH_WINDOW", 0.05)
    b = main.RouteBatcher()
    b.calls = []

    async def fake_post(payload):
        b.calls.append([p["callsign"] for p in payload["planes"]])
        return 200, [_entry(p["callsign"], "DLH", "ORD") for p in payload["planes"] if p["callsign"] != "NOROUTE1"]

    monkeypatch.setattr(b, "_post_upstream", fake_post)
    return b


async def test_concurrent_viewers_share_one_upstream_call(batcher):
    a, b_, c = await asyncio.gather(
        batcher.lookup([{"callsign": "SKW5754", "lat": 1, "lng": 2}]),
        batcher.lookup([{"callsign": "DAL451"}, {"callsign": "SKW5754"}]),
        batcher.lookup([{"callsign": "NOROUTE1"}]),
    )
    assert batcher.calls == [["SKW5754", "DAL451", "NOROUTE1"]]
    assert [e["callsign"] for e in a] == ["SKW5754"]
    assert sorted(e["callsign"] for e in b_) == ["DAL451", "SKW5754"]
    assert c == []  # no route known is a valid, cached answer


async def test_cached_callsigns_answer_without_upstream(batcher):
    await batcher.lookup([{"callsign": "SKW5754"}, {"callsign": "NOROUTE1"}])
    assert len(batcher.calls) == 1
    out = await batcher.lookup([{"callsign": "skw5754 "}, {"callsign": "NOROUTE1"}])
    assert len(batcher.calls) == 1
    assert [e["callsign"] for e in out] == ["SKW5754"]
    assert batcher.stats["cache_hits"] == 2


async def test_callsigns_arriving_mid_request_get_their_own_window(batcher):
    first = asyncio.create_task(batcher.lookup([{"callsign": "AAA111"}]))
    await asyncio.sleep(0.01)
    second = asyncio.create_task(batcher.lookup([{"callsign": "BBB222"}]))
    await asyncio.gather(first, second)
    assert batcher.calls == [["AAA111", "BBB222"]]  # joined the open window


async def test_refusal_backs_off_and_does_not_hang_callers(batcher, monkeypatch):
    async def refuse(payload):
        batcher.calls.append("refused")
        return 403, None
    monkeypatch.setattr(batcher, "_post_upstream", refuse)
    out = await asyncio.wait_for(batcher.lookup([{"callsign": "SKW5754"}]), 2)
    assert out == [] and batcher.calls == ["refused"]
    # While backing off, new lookups answer immediately with nothing, no upstream call
    out = await asyncio.wait_for(batcher.lookup([{"callsign": "DAL451"}]), 0.5)
    assert out == [] and batcher.calls == ["refused"]


async def test_junk_callsigns_are_ignored(batcher):
    out = await batcher.lookup([{"callsign": ""}, {"callsign": "bad callsign!"}, {"callsign": "x" * 20}])
    assert out == [] and batcher.calls == []
