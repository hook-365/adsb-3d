"""Startup backfills must work on a compressed hypertable: no ctid."""
import asyncio
from datetime import datetime, timezone

import main

T = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)


class FakeConn:
    def __init__(self, rows):
        self.rows = rows
        self.selects = []
        self.updates = []

    async def fetch(self, query, *params):
        self.selects.append(query)
        return self.rows

    async def execute(self, query, *params):
        self.updates.append((query, params))


def test_decode_backfill_keys_rows_by_time_and_text(monkeypatch):
    rows = [
        {"time": T, "label": "H1", "text": "decodable"},
        {"time": T, "label": "H1", "text": "noise"},
    ]
    monkeypatch.setattr(
        main, "decode_message",
        lambda label, text: {"kind": "position", "summary": "x"} if text == "decodable" else None,
    )
    conn = FakeConn(rows)
    asyncio.run(main.backfill_decoded(conn))

    assert "ctid" not in conn.selects[0]
    assert len(conn.updates) == 1
    query, params = conn.updates[0]
    assert "ctid" not in query and "decoded IS NULL" in query
    assert params == ({"kind": "position", "summary": "x"}, T, "decodable")


def test_chatter_backfill_writes_only_hits():
    rows = [
        {"time": T, "label": "81", "text": "HI. GATE PLS. THANKS."},
        {"time": T, "label": "16", "text": "LAT N 44.837/LON W 089.303"},
    ]
    conn = FakeConn(rows)
    asyncio.run(main.backfill_chatter(conn))

    assert "ctid" not in conn.selects[0]
    assert [params for _, params in conn.updates] == [(T, "HI. GATE PLS. THANKS.")]
