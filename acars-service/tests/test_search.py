"""/messages/search: query building, paging and window clamping."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import main

T0 = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)
T1 = datetime(2026, 11, 13, 18, 0, tzinfo=timezone.utc)

BLANK_ROW = {col.strip(): None for col in main.MESSAGE_COLUMNS.split(",")}


def row(time: datetime, **extra) -> dict:
    return {**BLANK_ROW, "time": time, **extra}


class FakeConn:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    async def fetch(self, query, *params):
        self.calls.append((query, params))
        return self.rows[: params[-1]]


class FakePool:
    def __init__(self, rows):
        self.conn = FakeConn(rows)

    def acquire(self, timeout=None):
        conn = self.conn

        class Ctx:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *exc):
                return False

        return Ctx()


def search(monkeypatch, rows, **kwargs):
    pool = FakePool(rows)
    monkeypatch.setattr(main, "db_pool", pool)
    defaults = dict(start=None, end=None, q=None, label=None, before=None, limit=200, chatter=False)
    body = asyncio.run(main.search_messages(**{**defaults, **kwargs}))
    return body, pool.conn.calls[0]


class TestLikePattern:
    def test_wraps_term_as_substring(self):
        assert main.like_pattern("UAL123") == "%UAL123%"

    def test_escapes_wildcards(self):
        assert main.like_pattern("50%_a\\b") == "%50\\%\\_a\\\\b%"


class TestBuildSearchQuery:
    def test_window_only(self):
        sql, params = main.build_search_query(T0, T1, limit=50)
        assert "time >= $1" in sql and "time < $2" in sql
        assert "ILIKE" not in sql and "label =" not in sql
        assert params == [T0, T1, 51]

    def test_term_matches_every_search_column_with_one_param(self):
        sql, params = main.build_search_query(T0, T1, q="  GROUND STOP ", limit=10)
        for col in main.SEARCH_COLUMNS:
            assert f"{col} ILIKE $3" in sql
        assert params == [T0, T1, "%GROUND STOP%", 11]

    def test_label_is_exact_and_numbered_after_term(self):
        sql, params = main.build_search_query(T0, T1, q="x", label="H1", limit=10)
        assert "label = $4" in sql
        assert "LIMIT $5" in sql
        assert params == [T0, T1, "%x%", "H1", 11]

    def test_cursor_tightens_upper_bound(self):
        cursor = T0 + timedelta(hours=1)
        _, params = main.build_search_query(T0, T1, before=cursor)
        assert params[1] == cursor

    def test_cursor_past_end_is_ignored(self):
        _, params = main.build_search_query(T0, T1, before=T1 + timedelta(hours=1))
        assert params[1] == T1

    def test_chatter_adds_flag_filter_without_a_param(self):
        sql, params = main.build_search_query(T0, T1, chatter=True, limit=10)
        assert " AND chatter" in sql
        assert params == [T0, T1, 11]

    def test_blank_term_is_no_filter(self):
        sql, _ = main.build_search_query(T0, T1, q="   ")
        assert "ILIKE" not in sql


class TestSearchEndpoint:
    def test_last_page_has_no_cursor(self, monkeypatch):
        now = datetime.now(timezone.utc)
        rows = [row(now - timedelta(minutes=i), flight=f"UAL{i}") for i in range(1, 4)]
        body, _ = search(monkeypatch, rows, limit=5)
        assert body["count"] == 3
        assert body["has_more"] is False
        assert body["next_before"] is None
        assert [m["flight"] for m in body["messages"]] == ["UAL1", "UAL2", "UAL3"]

    def test_full_page_returns_cursor_of_last_row(self, monkeypatch):
        now = datetime.now(timezone.utc)
        rows = [row(now - timedelta(minutes=i)) for i in range(1, 5)]
        body, _ = search(monkeypatch, rows, limit=2)
        assert body["count"] == 2
        assert body["has_more"] is True
        assert body["next_before"] == rows[1]["time"].isoformat()

    def test_defaults_to_last_24_hours(self, monkeypatch):
        _, (_, params) = search(monkeypatch, [])
        start, end = params[0], params[1]
        assert end - start == timedelta(hours=24)
        assert abs((datetime.now(timezone.utc) - end).total_seconds()) < 5

    def test_start_clamped_to_retention(self, monkeypatch):
        now = datetime.now(timezone.utc)
        _, (_, params) = search(monkeypatch, [], start=now - timedelta(days=90))
        assert now - params[0] <= main.SEARCH_MAX_AGE + timedelta(seconds=5)

    def test_naive_datetimes_are_utc(self, monkeypatch):
        now = datetime.now(timezone.utc)
        naive = (now - timedelta(hours=2)).replace(tzinfo=None)
        _, (_, params) = search(monkeypatch, [], start=naive)
        assert params[0] == now - timedelta(hours=2)

    def test_inverted_window_is_rejected(self, monkeypatch):
        now = datetime.now(timezone.utc)
        with pytest.raises(HTTPException) as exc:
            search(monkeypatch, [], start=now - timedelta(hours=1), end=now - timedelta(hours=2))
        assert exc.value.status_code == 400

    def test_position_and_icao_are_serialized(self, monkeypatch):
        now = datetime.now(timezone.utc)
        rows = [row(now - timedelta(minutes=1), icao="A1B2C3", lat=41.5, lon=-87.9, alt=35000)]
        body, _ = search(monkeypatch, rows)
        msg = body["messages"][0]
        assert msg["position"] == {"lat": 41.5, "lon": -87.9, "alt": 35000}
        assert msg["icao"] == main.normalize_icao("A1B2C3")
        assert msg["chatter"] is False
