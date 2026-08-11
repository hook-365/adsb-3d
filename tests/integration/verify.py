#!/usr/bin/env python3
"""End-to-end assertions for the containerized ADS-B 3D stack."""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import aiohttp
import asyncpg


VIEWER_URL = os.getenv("VIEWER_URL", "http://viewer").rstrip("/")
LIVE_VIEWER_URL = os.getenv("LIVE_VIEWER_URL", "http://viewer-live-only").rstrip("/")


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"PASS: {message}", flush=True)


async def get_json(session: aiohttp.ClientSession, url: str) -> dict:
    async with session.get(url) as response:
        body = await response.text()
        check(response.status == 200, f"GET {url} returns 200 (got {response.status}: {body[:200]})")
        return json.loads(body)


async def eventually_json(
    session: aiohttp.ClientSession,
    url: str,
    predicate,
    description: str,
    timeout: float = 45.0,
) -> dict:
    deadline = time.monotonic() + timeout
    last: object = None
    while time.monotonic() < deadline:
        try:
            async with session.get(url) as response:
                last = await response.json(content_type=None)
                if response.status == 200 and predicate(last):
                    check(True, description)
                    return last
        except (aiohttp.ClientError, json.JSONDecodeError) as exc:
            last = exc
        await asyncio.sleep(1)
    raise AssertionError(f"timed out waiting for {description}; last response: {last!r}")


async def verify_nginx_and_config(session: aiohttp.ClientSession) -> None:
    async with session.get(f"{VIEWER_URL}/health") as response:
        check(response.status == 200 and (await response.text()).strip() == "OK", "viewer nginx health route")

    live = await get_json(session, f"{VIEWER_URL}/data/aircraft.json")
    check(any(a.get("hex") == "abc123" for a in live["aircraft"]), "local readsb route passes fixture aircraft")

    remote_live = await get_json(session, f"{VIEWER_URL}/data/feeds/2/aircraft.json")
    check(any(a.get("hex") == "def456" for a in remote_live["aircraft"]), "multi-feed data route reaches remote feed")

    remote_health = await get_json(session, f"{VIEWER_URL}/api/feeds/2/health")
    check(remote_health["status"] == "fixture-healthy", "multi-feed API route rewrites to remote service")

    remote_track = await get_json(session, f"{VIEWER_URL}/api/feeds/2/tracks/abc123")
    check(remote_track.get("source") == "remote-fixture", "multi-feed nested API route preserves the backend path")

    async with session.get(f"{VIEWER_URL}/config.js") as response:
        config = await response.text()
    check("window.HISTORICAL_CONFIG = {\n    enabled: true" in config, "historical feature flag is rendered")
    check("window.ACARS_CONFIG = {\n    enabled: true" in config, "ACARS feature flag is rendered")
    check("mode: 'multi'" in config, "multi-feed mode is rendered")
    match = re.search(r"window\.FEEDS_CONFIG = (\[.*\]);", config)
    check(match is not None, "generated multi-feed JSON is present")
    feeds = json.loads(match.group(1))
    check([feed["name"] for feed in feeds] == ["CI Local", "CI Remote"], "generated feed order and names")
    check(feeds[1]["liveUrl"] == "/data/feeds/2/aircraft.json", "generated remote live URL")
    check(feeds[1]["apiBase"] == "/api/feeds/2", "generated remote API base")

    async with session.get(f"{LIVE_VIEWER_URL}/config.js") as response:
        live_config = await response.text()
    check("window.HISTORICAL_CONFIG = {\n    enabled: false" in live_config, "live-only historical flag is disabled")
    check("window.ACARS_CONFIG = {\n    enabled: false" in live_config, "live-only ACARS flag is disabled")
    check("mode: 'single'" in live_config, "live-only viewer remains single-feed")
    live_only_data = await get_json(session, f"{LIVE_VIEWER_URL}/data/aircraft.json")
    check(len(live_only_data["aircraft"]) == 2, "live-only deployment proxies readsb independently")


async def verify_track_api(session: aiohttp.ClientSession) -> None:
    health = await get_json(session, f"{VIEWER_URL}/api/health")
    check(health == {"status": "healthy", "database": "connected", "collector": "running", "broadcast": "running"}, "track health through nginx")

    track = await eventually_json(
        session,
        f"{VIEWER_URL}/api/tracks/abc123",
        lambda body: len(body.get("positions", [])) >= 2,
        "collector ingests multiple readsb samples and history returns them",
    )
    check(track["icao"] == "abc123", "history response identifies the requested ICAO")
    check(track["positions"][0]["time"] <= track["positions"][-1]["time"], "history positions are chronological")

    end = datetime.now(timezone.utc) + timedelta(minutes=1)
    start = end - timedelta(hours=1)
    query = urlencode(
        {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "cell": "0.01",
            "bbox": "51.0,-1.0,52.0,0.5",
        }
    )
    heatmap = await eventually_json(
        session,
        f"{VIEWER_URL}/api/heatmap?{query}",
        lambda body: len(body.get("cells", [])) >= 1,
        "heatmap aggregates ingested positions",
    )
    check(heatmap["cell_deg"] == 0.01, "heatmap preserves requested grid size")
    check(sum(cell["count"] for cell in heatmap["cells"]) >= 1, "heatmap reports aircraft density")


async def verify_acars_api(session: aiohttp.ClientSession) -> None:
    health = await get_json(session, f"{VIEWER_URL}/acars-api/health")
    check(health["status"] == "healthy" and health["collector"] == "running", "ACARS health through nginx")
    recent = await eventually_json(
        session,
        f"{VIEWER_URL}/acars-api/messages/recent?minutes=60&limit=20",
        lambda body: body.get("count", 0) >= 2,
        "ACARS TCP messages are parsed, persisted, and queryable",
    )
    messages = recent["messages"]
    check(any(m["flight"] == "TST123" and m["label"] == "Q0" for m in messages), "ACARS OOOI fixture fields survive ingestion")
    check(any(m["station_id"] == "CI_STATION" for m in messages), "ACARS station identity is attached")


async def verify_database() -> None:
    conn = await asyncpg.connect(
        host=os.getenv("DB_HOST", "timescaledb"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "adsb_tracks"),
        user=os.getenv("DB_USER", "adsb"),
        password=os.getenv("DB_PASSWORD", "ci-only-password"),
    )
    try:
        tables = await conn.fetch(
            """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('aircraft_positions', 'aircraft_metadata', 'acars_messages')
            """
        )
        table_names = {row["table_name"] for row in tables}
        check(table_names == {"aircraft_positions", "aircraft_metadata", "acars_messages"}, "clean startup creates every backend table")

        hypertables = {
            row["hypertable_name"]: row["compression_enabled"]
            for row in await conn.fetch(
                """
                SELECT hypertable_name, compression_enabled
                FROM timescaledb_information.hypertables
                WHERE hypertable_name IN ('aircraft_positions', 'acars_messages')
                """
            )
        }
        check(set(hypertables) == {"aircraft_positions", "acars_messages"}, "position and ACARS tables are Timescale hypertables")
        check(all(hypertables.values()), "compression is enabled for both hypertables")

        jobs = await conn.fetch(
            """
            SELECT proc_name, hypertable_name, config::text AS config
            FROM timescaledb_information.jobs
            WHERE hypertable_name IN ('aircraft_positions', 'acars_messages')
            """
        )
        job_map = {(row["hypertable_name"], row["proc_name"]): row["config"] for row in jobs}
        check(("aircraft_positions", "policy_compression") in job_map, "track compression policy exists")
        check(("acars_messages", "policy_compression") in job_map, "ACARS compression policy exists")
        check(("aircraft_positions", "policy_retention") in job_map, "track retention policy exists")
        check(("acars_messages", "policy_retention") in job_map, "ACARS retention policy exists")
        check("14 days" in job_map[("aircraft_positions", "policy_retention")], "track retention honours RETENTION_DAYS=14")
        check("30 days" in job_map[("acars_messages", "policy_retention")], "ACARS retention policy is 30 days")

        has_military = await conn.fetchval(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'aircraft_metadata' AND column_name = 'is_military'
            )
            """
        )
        check(has_military, "current aircraft_metadata migration state is present")
        check(await conn.fetchval("SELECT COUNT(*) FROM aircraft_positions") >= 2, "position rows reached TimescaleDB")
        check(await conn.fetchval("SELECT COUNT(*) FROM acars_messages") >= 2, "ACARS rows reached TimescaleDB")
        check(await conn.fetchval("SELECT COUNT(*) FROM aircraft_metadata WHERE icao = 'abc123'") == 1, "aircraft metadata upsert ran")
    finally:
        await conn.close()


async def main() -> None:
    timeout = aiohttp.ClientTimeout(total=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        await verify_nginx_and_config(session)
        await verify_track_api(session)
        await verify_acars_api(session)
    await verify_database()
    print("All ADS-B 3D integration checks passed.", flush=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr, flush=True)
        raise
