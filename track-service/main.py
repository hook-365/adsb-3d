#!/usr/bin/env python3
"""
ADS-B Track Service
Combined collector + API service for historical aircraft track data
- Background task: Polls feeder every 5 seconds, writes to TimescaleDB
- REST API: FastAPI endpoints for historical track queries
"""

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response
import hashlib
import time
from datetime import datetime, timedelta, timezone
from typing import List, Optional
import asyncpg
import aiohttp
import asyncio
import os
import sys
import signal
import logging
import json
import re

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)

# ============================================================================
# FASTAPI APPLICATION
# ============================================================================

app = FastAPI(
    title="ADS-B Track Service",
    description="Historical aircraft track collection and API",
    version="1.0.0"
)

# CORS for 3D viewer access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # LAN only, no authentication needed
    allow_methods=["*"],
    allow_headers=["*"],
)

# Bulk track payloads compress ~5-10x; cheap win on the wire.
app.add_middleware(GZipMiddleware, minimum_size=1024)

# Shared database pool (used by both collector and API)
db_pool = None

# Background collector task
collector_instance = None
collector_task = None

# Live diff broadcast state (see /ws/live)
ws_subscribers: set = set()
_ws_subscribers_lock = asyncio.Lock()  # guards add/discard/snapshot
ws_last_snapshot: dict = {}        # hex (lower) -> last seen RawAircraft dict
ws_broadcast_task = None

# Per-send timeout for WS broadcast fan-out; a stalled browser tab shouldn't
# be able to hold up the tick loop indefinitely.
WS_SEND_TIMEOUT = 2.0

# Pool.acquire() has no default timeout (it waits forever); every acquire
# below passes this explicitly so a saturated pool surfaces as a 503 instead
# of a hung request. /health uses a shorter timeout of its own (see below)
# so the 5s Docker healthcheck curl gets a real answer.
DB_ACQUIRE_TIMEOUT = 10.0


def _default_poll_seconds(feeder_url: str) -> float:
    """
    Feeder fetch cadence: 1 s against local infrastructure, 5 s against
    someone else's feeder on the public internet — polling a stranger's
    home connection every second around the clock is impolite (issue #6
    era multi-feed feedback). Heuristic: dotless hostnames (docker
    service names) and private/loopback IPs are local; anything else is
    remote. Proxied or tunneled feeders look local to this heuristic, so
    FEEDER_POLL_SECONDS overrides it either way.
    """
    from urllib.parse import urlparse
    import ipaddress
    host = urlparse(feeder_url if '://' in feeder_url else f'http://{feeder_url}').hostname or ''
    if not host or '.' not in host:
        return 1.0
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return 5.0  # dotted DNS name → assume remote
    return 5.0 if ip.is_global else 1.0


_feeder_url_for_poll = os.getenv('FEEDER_URL', os.getenv('ULTRAFEEDER_URL', 'http://ultrafeeder'))
try:
    WS_TICK_SECONDS = float(os.getenv('FEEDER_POLL_SECONDS', '') or _default_poll_seconds(_feeder_url_for_poll))
    if WS_TICK_SECONDS <= 0:
        raise ValueError('must be > 0')
except ValueError:
    logging.getLogger(__name__).warning('Invalid FEEDER_POLL_SECONDS; falling back to heuristic default')
    WS_TICK_SECONDS = _default_poll_seconds(_feeder_url_for_poll)
# Every Nth tick, broadcast all currently-tracked aircraft as "updated"
# regardless of whether their fields changed. This keeps the client's `seen`
# / lastSeenMs accurate for parked/stationary aircraft that otherwise
# wouldn't trigger a diff. At ~30 aircraft and ~80 bytes each, this is
# ~2.5KB every 5s — cheap insurance against drift. With slow (remote)
# ticks the count is reduced so the heartbeat stays well inside the
# frontend's 30 s feeder-staleness threshold.
WS_HEARTBEAT_EVERY = 5 if WS_TICK_SECONDS <= 3.0 else 3
# Fields that, when changed between ticks, mean "this aircraft moved/updated".
# `seen` is excluded on purpose — it ticks every second for everyone and would
# defeat the diff entirely.
WS_DIFF_FIELDS = ('lat', 'lon', 'alt_baro', 'alt_geom', 'gs', 'track',
                  'baro_rate', 'flight', 'squawk', 'category', 'nav_altitude_mcp')

# Most recent successful readsb fetch — populated by ws_broadcast_loop and
# consumed by AircraftTrackCollector so the two don't both poll the feeder.
latest_feeder_body: dict | None = None
latest_feeder_fetched_monotonic: float = 0.0


def _feeder_age_seconds() -> float | None:
    """
    Seconds since the last successful feeder fetch, or None if we've
    never had one. Surfaced on every WS frame so clients can flag a
    stale connection (track-service alive, upstream readsb dead).
    """
    if latest_feeder_fetched_monotonic == 0.0:
        return None
    return round(time.monotonic() - latest_feeder_fetched_monotonic, 1)

# Route cache (callsign -> (data, timestamp)) with TTL
route_cache = {}
ROUTE_CACHE_TTL = 3600          # 1 hour positive results
ROUTE_NEGATIVE_TTL = 300        # 5 min negative results

# adsb.im circuit breaker state
_route_circuit_failures = 0
_route_circuit_open_until = 0.0
ROUTE_CIRCUIT_THRESHOLD = 5
ROUTE_CIRCUIT_BACKOFF = 120     # seconds


def ensure_utc(dt: datetime) -> datetime:
    """Ensure datetime object is timezone-aware (UTC)"""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def initialize_database_schema(db_pool):
    """
    Initialize database schema if tables don't exist.
    This runs automatically on first startup - no user action required.
    """
    logger.info("=" * 60)
    logger.info("Checking database schema...")
    logger.info("=" * 60)

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            # Check if our tables exist
            tables_exist = await conn.fetchval("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_schema = 'public'
                    AND table_name = 'aircraft_positions'
                )
            """)

            if tables_exist:
                logger.info("✓ Database schema already exists")
                return

            logger.info("✗ Tables not found - initializing database...")

            # Create TimescaleDB extension
            await conn.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE")
            logger.info("✓ TimescaleDB extension enabled")

            # Create aircraft_positions table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS aircraft_positions (
                    time TIMESTAMPTZ NOT NULL,
                    icao TEXT NOT NULL,
                    flight TEXT,
                    lat DOUBLE PRECISION NOT NULL,
                    lon DOUBLE PRECISION NOT NULL,
                    alt_baro INTEGER,
                    alt_geom INTEGER,
                    gs DOUBLE PRECISION,
                    track DOUBLE PRECISION,
                    baro_rate INTEGER,
                    squawk TEXT,
                    emergency TEXT,
                    category TEXT,
                    nav_altitude_mcp INTEGER,
                    rssi DOUBLE PRECISION,
                    messages INTEGER,
                    seen DOUBLE PRECISION
                )
            """)
            logger.info("✓ Created aircraft_positions table")

            # Convert to hypertable
            await conn.execute("""
                SELECT create_hypertable('aircraft_positions', 'time',
                    chunk_time_interval => INTERVAL '7 days',
                    if_not_exists => TRUE)
            """)
            logger.info("✓ Converted to TimescaleDB hypertable (7-day chunks)")

            # Enable compression
            await conn.execute("""
                ALTER TABLE aircraft_positions SET (
                    timescaledb.compress,
                    timescaledb.compress_segmentby = 'icao',
                    timescaledb.compress_orderby = 'time DESC'
                )
            """)
            logger.info("✓ Compression enabled (70-80% storage savings)")

            # Create aircraft_metadata table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS aircraft_metadata (
                    icao TEXT PRIMARY KEY,
                    registration TEXT,
                    aircraft_type TEXT,
                    type_description TEXT,
                    owner_operator TEXT,
                    year TEXT,
                    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    total_sightings INTEGER DEFAULT 1,
                    is_military BOOLEAN DEFAULT false
                )
            """)
            logger.info("✓ Created aircraft_metadata table")

            # Create indexes
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_positions_icao_time ON aircraft_positions (icao, time DESC);
                CREATE INDEX IF NOT EXISTS idx_positions_time ON aircraft_positions (time DESC);
                CREATE INDEX IF NOT EXISTS idx_metadata_reg ON aircraft_metadata (registration);
                CREATE INDEX IF NOT EXISTS idx_metadata_type ON aircraft_metadata (aircraft_type);
                CREATE INDEX IF NOT EXISTS idx_metadata_last_seen ON aircraft_metadata (last_seen DESC);
                CREATE INDEX IF NOT EXISTS idx_metadata_military ON aircraft_metadata (is_military) WHERE is_military = true;
            """)
            logger.info("✓ Created indexes for fast queries")

            # Add compression policy (compress data older than 7 days)
            await conn.execute("""
                SELECT add_compression_policy('aircraft_positions', INTERVAL '7 days',
                    if_not_exists => TRUE)
            """)
            logger.info("✓ Added automatic compression policy (>7 days old)")

            # Add retention policy (configurable via RETENTION_DAYS env var)
            try:
                retention_days = int(os.getenv('RETENTION_DAYS', '90'))
                if retention_days < 1:
                    raise ValueError("must be >= 1")
            except (ValueError, TypeError) as _e:
                logger.warning(f"Invalid RETENTION_DAYS env var ({_e}); defaulting to 90")
                retention_days = 90
            await conn.execute(
                "SELECT add_retention_policy('aircraft_positions', $1::interval, if_not_exists => TRUE)",
                timedelta(days=retention_days)
            )
            logger.info(f"✓ Added retention policy ({retention_days} days)")

            logger.info("=" * 60)
            logger.info("✅ Database initialization complete!")
            logger.info("=" * 60)

    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise


async def run_database_migrations(db_pool):
    """
    Run automatic database migrations on startup.
    Enables compression for existing deployments that upgrade.
    """
    logger.info("=" * 60)
    logger.info("Running database migrations...")
    logger.info("=" * 60)

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            # Check if compression is enabled
            logger.info("Checking TimescaleDB compression status...")
            compression_enabled = await conn.fetchval("""
                SELECT compression_enabled
                FROM timescaledb_information.hypertables
                WHERE hypertable_name = 'aircraft_positions'
            """)

            if compression_enabled:
                logger.info("✓ Compression already enabled - skipping")
            else:
                logger.info("✗ Compression not enabled - enabling now...")
                await conn.execute("""
                    ALTER TABLE aircraft_positions SET (
                        timescaledb.compress,
                        timescaledb.compress_segmentby = 'icao',
                        timescaledb.compress_orderby = 'time DESC'
                    )
                """)
                logger.info("✓ Compression enabled successfully!")
                logger.info("  → Segments by ICAO for better compression")
                logger.info("  → Orders by time DESC for query performance")
                logger.info("  → Expected storage savings: 70-80%")

            # Retention policy self-heal: releases before v0.5.1 failed the
            # add_retention_policy call on clean-database init (a str was
            # passed for an ::interval parameter), then restarted healthy
            # with the policy permanently missing — clean init never re-runs
            # once tables exist, so affected databases grew without bound.
            # if_not_exists makes this a no-op everywhere else.
            logger.info("Checking aircraft_positions retention policy...")
            has_retention = await conn.fetchval("""
                SELECT EXISTS (
                    SELECT 1 FROM timescaledb_information.jobs
                    WHERE proc_name = 'policy_retention'
                      AND hypertable_name = 'aircraft_positions'
                )
            """)
            if has_retention:
                logger.info("✓ Retention policy present")
            else:
                logger.info("✗ Retention policy missing (pre-v0.5.1 clean-init bug) - adding...")
                try:
                    retention_days = int(os.getenv('RETENTION_DAYS', '90'))
                    if retention_days < 1:
                        raise ValueError("must be >= 1")
                except (ValueError, TypeError):
                    retention_days = 90
                await conn.execute(
                    "SELECT add_retention_policy('aircraft_positions', $1::interval, if_not_exists => TRUE)",
                    timedelta(days=retention_days)
                )
                logger.info(f"✓ Retention policy added ({retention_days} days)")

            # Check if is_military column exists
            logger.info("Checking aircraft_metadata schema...")
            has_military = await conn.fetchval("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'aircraft_metadata' AND column_name = 'is_military'
                )
            """)

            if has_military:
                logger.info("✓ Military aircraft column present")
            else:
                logger.info("✗ Adding is_military column...")
                await conn.execute("""
                    ALTER TABLE aircraft_metadata ADD COLUMN is_military BOOLEAN DEFAULT false
                """)
                await conn.execute("""
                    CREATE INDEX idx_metadata_military ON aircraft_metadata (is_military) WHERE is_military = true
                """)
                logger.info("✓ Military aircraft tracking enabled!")

            # Check compression policy
            logger.info("Checking compression policy...")
            has_policy = await conn.fetchval("""
                SELECT COUNT(*) FROM timescaledb_information.jobs
                WHERE proc_name = 'policy_compression'
                AND hypertable_name = 'aircraft_positions'
            """)

            if has_policy > 0:
                logger.info("✓ Automatic compression policy active (compresses data >7 days old)")
            else:
                logger.info("⚠ No compression policy found - chunks won't auto-compress")
                logger.info("  Run init scripts to add compression policy")

        logger.info("=" * 60)
        logger.info("Database migrations complete!")
        logger.info("=" * 60)

    except Exception as e:
        logger.error(f"Error during database migrations: {e}")
        logger.error("Service will continue, but compression may not be enabled")
        logger.error("Check TimescaleDB logs for details")


# ============================================================================
# AIRCRAFT TRACK COLLECTOR (Background Task)
# ============================================================================

def _parse_military_db(content: str) -> dict:
    """
    Parse the ~15 MB tar1090-db JSON blob and extract military aircraft
    (flag "10") into a compact hex -> info dict. Run off the event loop via
    asyncio.to_thread — json.loads + this dict comprehension over ~15 MB
    blocks the loop for long enough to stall WS ticks otherwise.
    """
    db_data = json.loads(content)
    military_db = {}
    for icao_hex, aircraft_info in db_data.items():
        if len(aircraft_info) >= 3 and aircraft_info[2] == "10":
            military_db[icao_hex.upper()] = {
                "tail": aircraft_info[0],
                "type": aircraft_info[1],
                "flag": aircraft_info[2],
                "description": aircraft_info[3] if len(aircraft_info) > 3 else ""
            }
    return military_db


class AircraftTrackCollector:
    def __init__(self, db_pool):
        self.db_pool = db_pool  # Use shared pool
        self.ultrafeeder_url = os.getenv('FEEDER_URL', os.getenv('ULTRAFEEDER_URL', 'http://ultrafeeder'))
        self.collection_interval = int(os.getenv('COLLECTION_INTERVAL', '5'))
        self.running = True

        # Military aircraft database (tar1090-db)
        self.military_database = None
        self.military_db_last_updated = None
        self.military_db_loading = False

        logger.info(f"Collector initialized: interval={self.collection_interval}s "
                    f"(samples shared feeder snapshot from ws_broadcast_loop)")

    async def load_military_database(self):
        """Load military aircraft database from tar1090-db (Mictronics)."""
        if self.military_db_loading:
            logger.debug("Military database load already in progress")
            return False

        self.military_db_loading = True
        try:
            # Check if we need to refresh (cache for 24 hours)
            if (self.military_database is not None and
                self.military_db_last_updated is not None and
                datetime.now(timezone.utc) - self.military_db_last_updated < timedelta(hours=24)):
                logger.info("Military database cache still valid (< 24h old)")
                return True

            logger.info("Downloading military aircraft database from tar1090-db...")

            timeout = aiohttp.ClientTimeout(total=60, sock_connect=10, sock_read=50)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(
                    "https://raw.githubusercontent.com/Mictronics/readsb-protobuf/dev/webapp/src/db/aircrafts.json"
                ) as response:
                    if response.status == 200:
                        content = await response.text()
                        military_db = await asyncio.to_thread(_parse_military_db, content)

                        self.military_database = military_db
                        self.military_db_last_updated = datetime.now(timezone.utc)

                        logger.info(f"Successfully loaded {len(military_db)} military aircraft from tar1090-db")
                        return True
                    else:
                        logger.warning(f"Failed to load military database: HTTP {response.status}")
                        self.military_database = {}
                        self.military_db_last_updated = datetime.now(timezone.utc)
                        return False

        except asyncio.TimeoutError:
            logger.error("Timeout loading military aircraft database")
            self.military_database = {}
            self.military_db_last_updated = datetime.now(timezone.utc)
            return False
        except Exception as e:
            logger.error(f"Error loading military aircraft database: {e}")
            self.military_database = {}
            self.military_db_last_updated = datetime.now(timezone.utc)
            return False
        finally:
            self.military_db_loading = False

    def is_military_aircraft(self, aircraft):
        """Determine if aircraft is military using tar1090-db database lookup ONLY."""
        # Database must be loaded first
        if self.military_database is None:
            return False

        hex_code = aircraft.get('hex')
        if not hex_code:
            return False

        # Simple database lookup - no pattern matching or keywords
        return hex_code.upper() in self.military_database

    async def fetch_aircraft_data(self):
        """
        Read the latest feeder snapshot published by ws_broadcast_loop.

        The WS broadcast loop is the single upstream fetcher; this method
        just samples the shared global. Returns None if the snapshot is
        missing or stale (older than ~15s, e.g. broadcast loop wedged).
        """
        if latest_feeder_body is None:
            return None
        age = time.monotonic() - latest_feeder_fetched_monotonic
        if age > 15.0:
            logger.warning(f"shared feeder snapshot is stale ({age:.1f}s old)")
            return None
        return latest_feeder_body

    @staticmethod
    def _to_int(v):
        """Cast to int for COPY protocol (strict typing, no float→int coercion)."""
        if v is None or v == 'ground':
            return None
        return int(v)

    async def store_positions(self, aircraft_data):
        """Batch insert aircraft positions and update metadata"""
        if not aircraft_data or 'aircraft' not in aircraft_data:
            return

        aircraft_list = aircraft_data.get('aircraft', [])
        if not aircraft_list:
            return

        positions = []
        metadata_updates = []
        now = datetime.now(timezone.utc)

        for aircraft in aircraft_list:
            # Skip if no position data
            if 'lat' not in aircraft or 'lon' not in aircraft:
                continue

            icao = aircraft.get('hex', '').lower()
            if not icao:
                continue

            # Position record
            positions.append((
                now,
                icao,
                aircraft.get('flight', '').strip() if aircraft.get('flight') else None,
                aircraft.get('lat'),
                aircraft.get('lon'),
                self._to_int(aircraft.get('alt_baro')),
                self._to_int(aircraft.get('alt_geom')),
                aircraft.get('gs'),
                aircraft.get('track'),
                self._to_int(aircraft.get('baro_rate')),
                aircraft.get('squawk'),
                aircraft.get('emergency'),
                aircraft.get('category'),
                self._to_int(aircraft.get('nav_altitude_mcp')),
                aircraft.get('rssi'),
                self._to_int(aircraft.get('messages')),
                aircraft.get('seen')
            ))

            # Metadata update (only if we have registration or type info)
            if aircraft.get('r') or aircraft.get('t') or aircraft.get('category'):
                is_military = self.is_military_aircraft(aircraft)
                metadata_updates.append((
                    icao,
                    aircraft.get('r'),          # registration
                    aircraft.get('t'),          # type
                    aircraft.get('desc'),       # description
                    aircraft.get('ownOp'),      # owner/operator
                    aircraft.get('year'),
                    is_military                 # military flag
                ))

        if not positions:
            logger.debug("No positions to store")
            return

        try:
            async with self.db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
                async with conn.transaction():
                    # Bulk insert positions via COPY protocol (fastest bulk insert method)
                    await conn.copy_records_to_table(
                        'aircraft_positions',
                        records=positions,
                        columns=[
                            'time', 'icao', 'flight', 'lat', 'lon',
                            'alt_baro', 'alt_geom', 'gs', 'track', 'baro_rate',
                            'squawk', 'emergency', 'category', 'nav_altitude_mcp',
                            'rssi', 'messages', 'seen'
                        ]
                    )

                    # Upsert metadata (requires ON CONFLICT, so executemany inside transaction)
                    if metadata_updates:
                        await conn.executemany('''
                            INSERT INTO aircraft_metadata
                            (icao, registration, aircraft_type, type_description, owner_operator, year, is_military, last_seen, total_sightings)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 1)
                            ON CONFLICT (icao) DO UPDATE SET
                                registration = COALESCE(EXCLUDED.registration, aircraft_metadata.registration),
                                aircraft_type = COALESCE(EXCLUDED.aircraft_type, aircraft_metadata.aircraft_type),
                                type_description = COALESCE(EXCLUDED.type_description, aircraft_metadata.type_description),
                                owner_operator = COALESCE(EXCLUDED.owner_operator, aircraft_metadata.owner_operator),
                                year = COALESCE(EXCLUDED.year, aircraft_metadata.year),
                                is_military = EXCLUDED.is_military,
                                last_seen = NOW(),
                                total_sightings = aircraft_metadata.total_sightings + 1
                        ''', metadata_updates)

                logger.info(f"Stored {len(positions)} positions, updated {len(metadata_updates)} metadata records")

        except Exception as e:
            logger.error(f"Database error storing positions: {e}")

    async def collect_loop(self):
        """Main collection loop"""
        logger.info(f"Starting collection loop (interval: {self.collection_interval}s)")

        consecutive_errors = 0
        max_consecutive_errors = 10
        last_db_refresh = datetime.now(timezone.utc)

        while self.running:
            try:
                # Refresh military database every 24 hours
                if datetime.now(timezone.utc) - last_db_refresh > timedelta(hours=24):
                    logger.info("24 hours elapsed, refreshing military database...")
                    await self.load_military_database()
                    last_db_refresh = datetime.now(timezone.utc)

                data = await self.fetch_aircraft_data()

                if data:
                    await self.store_positions(data)
                    consecutive_errors = 0
                else:
                    consecutive_errors += 1
                    if consecutive_errors >= max_consecutive_errors:
                        logger.error(f"Too many consecutive errors ({consecutive_errors}), pausing for 60 seconds")
                        await asyncio.sleep(60)
                        consecutive_errors = 0

                await asyncio.sleep(self.collection_interval)

            except Exception as e:
                consecutive_errors += 1
                logger.error(f"Collection error ({consecutive_errors}/{max_consecutive_errors}): {e}", exc_info=True)
                await asyncio.sleep(self.collection_interval)

    async def run(self):
        """
        Start the collector, restarting collect_loop with backoff if it ever
        exits via an unhandled exception. collect_loop already retries most
        transient errors internally; this is the outer safety net so a bug
        there doesn't permanently kill collection for the life of the
        container.
        """
        delay = 5.0
        max_delay = 300.0
        while self.running:
            started = time.monotonic()
            try:
                # Load military aircraft database (opens its own short-lived session)
                await self.load_military_database()
                await self.collect_loop()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"Collector fatal error: {e}", exc_info=True)
                if not self.running:
                    break
                if time.monotonic() - started > 60:
                    delay = 5.0
                else:
                    delay = min(delay * 2, max_delay)
                logger.info(f"Restarting collector in {delay:.0f}s...")
                await asyncio.sleep(delay)
            else:
                # collect_loop returned normally (self.running went False)
                break

    def stop(self):
        """Stop the collector gracefully"""
        logger.info("Stopping collector...")
        self.running = False


# ============================================================================
# FASTAPI LIFECYCLE EVENTS
# ============================================================================

@app.on_event("startup")
async def startup():
    """Initialize database connection pool and start collector"""
    global db_pool, collector_instance, collector_task

    # Database configuration
    DB_CONFIG = {
        'host': os.getenv('DB_HOST', 'timescaledb-adsb'),
        'port': int(os.getenv('DB_PORT', '5432')),
        'database': os.getenv('DB_NAME', 'adsb_tracks'),
        'user': os.getenv('DB_USER', 'adsb'),
        'password': os.getenv('DB_PASSWORD', ''),
    }

    try:
        # Create shared database pool.
        #
        # Sizing: steady-state load is ~3 connections (WS broadcast loop,
        # collector, occasional REST). max_size=40 leaves headroom for
        # bursty backfill requests when the frontend boots — a fresh
        # page on the Europe feed batches up to 200 hex backfills, plus
        # a per-aircraft selection-extension can fire while the bulk is
        # still in flight. 20 was tight; 40 keeps us comfortable even
        # under multi-tab load. asyncpg's Pool.acquire() has no default
        # timeout at all — it waits forever by default — so every
        # acquire() call below passes DB_ACQUIRE_TIMEOUT explicitly,
        # which is what actually makes the `except asyncio.TimeoutError
        # -> 503` handlers reachable.
        db_pool = await asyncpg.create_pool(
            **DB_CONFIG,
            min_size=2,
            max_size=40,
            command_timeout=60
        )
        logger.info(f"Database pool created: {DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['database']}")
        logger.info(
            f"Feeder poll cadence: {WS_TICK_SECONDS:g}s "
            f"({'FEEDER_POLL_SECONDS override' if os.getenv('FEEDER_POLL_SECONDS') else 'heuristic default'}), "
            f"WS heartbeat every {WS_HEARTBEAT_EVERY} ticks"
        )

        # Test connection
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            version = await conn.fetchval('SELECT version()')
            logger.info(f"Connected to: {version}")

        # Initialize database schema if needed (automatic, no user action required)
        await initialize_database_schema(db_pool)

        # Run database migrations (compression, schema updates)
        await run_database_migrations(db_pool)

        # Start background collector
        collector_instance = AircraftTrackCollector(db_pool)
        collector_task = asyncio.create_task(collector_instance.run())
        logger.info("Background collector started")

        # Start live diff broadcast loop (independent 1Hz fetcher)
        global ws_broadcast_task
        ws_broadcast_task = asyncio.create_task(ws_broadcast_loop())
        logger.info("WS live broadcast loop started")

    except Exception as e:
        logger.error(f"Failed to start service: {e}")
        raise


@app.on_event("shutdown")
async def shutdown():
    """Stop collector and close database connection pool"""
    global db_pool, collector_instance, collector_task, ws_broadcast_task

    # Stop collector
    if collector_instance:
        collector_instance.stop()
        logger.info("Collector stop signal sent")

    if collector_task:
        try:
            await asyncio.wait_for(collector_task, timeout=10.0)
            logger.info("Collector task completed")
        except asyncio.TimeoutError:
            logger.warning("Collector task did not complete in time")
            collector_task.cancel()

    # Stop WS broadcast loop and drop subscribers
    if ws_broadcast_task:
        ws_broadcast_task.cancel()
        try:
            await ws_broadcast_task
        except (asyncio.CancelledError, Exception):
            pass
    async with _ws_subscribers_lock:
        remaining = list(ws_subscribers)
        ws_subscribers.clear()
    for ws in remaining:
        try:
            await ws.close()
        except Exception:
            pass

    # Close database pool
    if db_pool:
        await db_pool.close()
        logger.info("Database pool closed")


# ============================================================================
# REST API ENDPOINTS
# ============================================================================

# ============================================================================
# LIVE DIFF BROADCAST (WebSocket)
# ============================================================================
#
# The frontend's live-feed path is normally readsb's /data/aircraft.json
# polled at 1Hz. This endpoint replaces that polling with a server-pushed
# diff stream: snapshot on connect, then per-tick {added, updated, removed}
# until disconnect. Bytes saved come from skipping aircraft that didn't move
# between ticks (parked / ground / out-of-range stale records). Falls back
# transparently on the client side if the socket can't connect.

def _has_meaningful_change(old: dict, new: dict) -> bool:
    for f in WS_DIFF_FIELDS:
        if old.get(f) != new.get(f):
            return True
    return False


async def _ws_broadcast(message: dict):
    """Send a message to all subscribers in parallel; drop dead sockets."""
    async with _ws_subscribers_lock:
        if not ws_subscribers:
            return
        targets = list(ws_subscribers)
    results = await asyncio.gather(
        *(asyncio.wait_for(ws.send_json(message), WS_SEND_TIMEOUT) for ws in targets),
        return_exceptions=True,
    )
    dead = [ws for ws, r in zip(targets, results) if isinstance(r, Exception)]
    if dead:
        async with _ws_subscribers_lock:
            for ws in dead:
                ws_subscribers.discard(ws)
        for ws in dead:
            try:
                await ws.close()
            except Exception:
                pass


async def ws_broadcast_loop():
    """
    1Hz fetch readsb → diff vs last tick → broadcast to WS subscribers.

    This is the single upstream-fetch loop in the service: the DB collector
    reads the result via `latest_feeder_body` instead of issuing its own
    request. Every Nth tick, all tracked aircraft are broadcast as `updated`
    (a heartbeat) so client-side `seen` / lastSeenMs stays fresh.
    """
    global ws_last_snapshot, latest_feeder_body, latest_feeder_fetched_monotonic

    feeder_url = os.getenv('FEEDER_URL', os.getenv('ULTRAFEEDER_URL', 'http://ultrafeeder'))
    timeout = aiohttp.ClientTimeout(total=2)
    tick_count = 0

    async with aiohttp.ClientSession(timeout=timeout) as session:
        while True:
            try:
                tick_started = time.monotonic()
                tick_count += 1
                is_heartbeat_tick = tick_count % WS_HEARTBEAT_EVERY == 0
                fetch_ok = False
                added: list = []
                updated: list = []
                removed: list = []
                now_ts = time.time()

                try:
                    async with session.get(f"{feeder_url}/data/aircraft.json") as resp:
                        if resp.status == 200:
                            body = await resp.json()
                            if isinstance(body, dict):
                                fetch_ok = True
                            else:
                                logger.warning("feeder returned non-object JSON body; ignoring tick")
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.warning(f"ws broadcast feeder fetch failed: {e}")

                if fetch_ok:
                    # Publish to the shared latest-snapshot slot first so the DB
                    # collector can sample it on its own cadence.
                    latest_feeder_body = body
                    latest_feeder_fetched_monotonic = time.monotonic()

                    raw_aircraft_list = body.get('aircraft')
                    aircraft_list = raw_aircraft_list if isinstance(raw_aircraft_list, list) else []
                    now_ts = body.get('now') or now_ts

                    current: dict = {}
                    for a in aircraft_list:
                        if not isinstance(a, dict):
                            continue
                        h = a.get('hex')
                        if not h:
                            continue
                        current[h.lower()] = a

                    prev = ws_last_snapshot
                    added = [a for h, a in current.items() if h not in prev]
                    removed = [h for h in prev if h not in current]

                    if is_heartbeat_tick:
                        # Heartbeat: every still-present hex counts as "updated"
                        # so its fresh `seen` is shipped to clients.
                        updated = [a for h, a in current.items() if h in prev]
                    else:
                        updated = [a for h, a in current.items()
                                   if h in prev and _has_meaningful_change(prev[h], a)]

                    ws_last_snapshot = current

                # Emit on diff ticks AND on heartbeat ticks regardless of fetch
                # outcome. The heartbeat path keeps feeder_age_s flowing to
                # clients so they can detect a dead-upstream feeder (the
                # otherwise-healthy WS would lie about being live forever).
                has_diff_content = bool(added or updated or removed)
                if ws_subscribers and (has_diff_content or is_heartbeat_tick):
                    try:
                        await _ws_broadcast({
                            "type": "diff",
                            "now": now_ts,
                            "feeder_age_s": _feeder_age_seconds(),
                            "added": added,
                            "updated": updated,
                            "removed": removed,
                        })
                    except Exception as e:
                        logger.debug(f"ws broadcast send failed: {e}")

                elapsed = time.monotonic() - tick_started
                await asyncio.sleep(max(0.0, WS_TICK_SECONDS - elapsed))
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"ws broadcast loop tick failed: {e}", exc_info=True)
                continue


@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    """
    Stream live aircraft updates as diffs.

    Protocol:
      - Server → client on connect: {type: 'snapshot', now, aircraft: [...]}
      - Server → client per tick:   {type: 'diff', now, added, updated, removed}
      - Client → server: anything triggers a graceful close (we don't read);
        connection ends when the client closes the socket.
    """
    await websocket.accept()
    snapshot_aircraft = list(ws_last_snapshot.values())
    try:
        await websocket.send_json({
            "type": "snapshot",
            "now": time.time(),
            "feeder_age_s": _feeder_age_seconds(),
            "aircraft": snapshot_aircraft,
        })
    except Exception:
        return

    async with _ws_subscribers_lock:
        ws_subscribers.add(websocket)
    try:
        # We don't expect inbound messages; receive_text() blocks until the
        # peer closes, at which point we clean up.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"ws connection ended: {e}")
    finally:
        async with _ws_subscribers_lock:
            ws_subscribers.discard(websocket)


@app.get("/")
async def root():
    """API root endpoint"""
    return {
        "name": "ADS-B Track Service",
        "version": "1.0.0",
        "docs": "/docs",
        "components": {
            "collector": "active",
            "api": "active"
        }
    }


_health_cache: dict = {"ts": 0.0, "ok": False, "err": None}
HEALTH_CACHE_TTL = 1.0


@app.get("/health")
async def health_check():
    """Health check. DB ping result is cached for 1s so frequent probes
    (e.g. Docker healthcheck running every second) don't hit the pool."""
    now = time.monotonic()
    if now - _health_cache["ts"] > HEALTH_CACHE_TTL:
        try:
            async with db_pool.acquire(timeout=3.0) as conn:
                await conn.fetchval("SELECT 1")
            _health_cache.update(ts=now, ok=True, err=None)
        except Exception as e:
            _health_cache.update(ts=now, ok=False, err=str(e))

    if not _health_cache["ok"]:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {_health_cache['err']}")

    # Task liveness, not just the `running` flag — a crashed/backoff-restarting
    # collector still has `running` True, but a genuinely dead task (one that
    # exited its while-loop after stop()) shows as .done().
    collector_status = "running" if collector_task and not collector_task.done() else "stopped"
    broadcast_status = "running" if ws_broadcast_task and not ws_broadcast_task.done() else "stopped"
    if (collector_task and collector_task.done()) or (ws_broadcast_task and ws_broadcast_task.done()):
        raise HTTPException(status_code=503, detail="Service unhealthy: background task exited")

    return {
        "status": "healthy",
        "database": "connected",
        "collector": collector_status,
        "broadcast": broadcast_status,
    }


RESOLUTION_REGEX = r"^(full|\d+s)$"


def _resolve_resolution(resolution: str):
    """
    Return (mode, bucket_seconds) for the requested resolution.

    `mode` is 'raw' (every sample) or 'bucket' (server-side `time_bucket`
    aggregate). bucket_seconds is an int that callers pass as a $N parameter
    (cast to interval in SQL) rather than interpolating into the query text.
    All queries hit `aircraft_positions` directly — finer-grained rollups are
    produced on demand via `time_bucket`, so there are no continuous-aggregate
    tables to keep in sync.
    """
    if resolution == "full":
        return "raw", None
    # regex guarantees `\d+s` at this point
    seconds = int(resolution[:-1])
    if seconds < 1 or seconds > 3600:
        raise HTTPException(status_code=400, detail="resolution seconds out of range")
    if seconds == 1:
        return "raw", None
    return "bucket", seconds


# Maximum window (seconds) for which we honor an explicit `resolution=full`
# request. Beyond this, we transparently downsample to keep the response
# bounded — at 1 Hz sampling, 4 hours of raw points is ~14k records (a
# comfortable cold-load JSON for the frontend). The selection-extension
# path on the frontend asks for 24h windows; without this guard it would
# pull ~86k points per click on a busy aircraft.
RAW_FULL_MAX_WINDOW_SECONDS = 4 * 3600
# When auto-downsampling kicks in we aim for this many points across the
# window. 7200 = ~2h of 1 Hz data, which is plenty of detail for any
# trail-rendering use case and stays well under the multi-MB JSON
# parse-stall threshold on the client.
AUTO_DOWNSAMPLE_TARGET_POINTS = 7200


def _autodownsample_if_window_too_wide(
    mode: str,
    bucket_seconds: Optional[int],
    window_seconds: float,
) -> tuple[str, Optional[int], Optional[str]]:
    """
    If the caller asked for raw (`resolution=full`) but the window is too
    large, transparently switch to a `time_bucket` aggregate sized to land
    near AUTO_DOWNSAMPLE_TARGET_POINTS. Returns (mode, bucket_seconds,
    effective_resolution) where `effective_resolution` is a human-readable
    note ("`Ns (auto)`") to echo back in the response, or None when the
    original resolution was honored as-is.
    """
    if mode != "raw" or window_seconds <= RAW_FULL_MAX_WINDOW_SECONDS:
        return mode, bucket_seconds, None
    bucket = max(2, int(window_seconds // AUTO_DOWNSAMPLE_TARGET_POINTS))
    # Clamp to the SQL-side validation range used by _resolve_resolution.
    bucket = min(bucket, 3600)
    return "bucket", bucket, f"{bucket}s (auto)"


_ICAO_RE = re.compile(r'^[0-9a-fA-F]{1,7}$')


@app.get("/tracks/{icao}")
async def get_aircraft_track(
    icao: str,
    start: Optional[datetime] = Query(None, description="Start time (UTC)"),
    end: Optional[datetime] = Query(None, description="End time (UTC)"),
    resolution: str = Query("full", regex=RESOLUTION_REGEX, description="full | Ns (e.g. 15s)")
):
    """
    Historical track for one ICAO.

    - **resolution=full**: every collected sample.
    - **resolution=Ns**: server-side `time_bucket` averaging (e.g. `15s`, `300s`).
    """
    if not _ICAO_RE.match(icao):
        raise HTTPException(status_code=400, detail="icao must be 1-7 hex characters")

    if not end:
        end = datetime.now(timezone.utc)
    else:
        end = ensure_utc(end)
    if not start:
        start = end - timedelta(hours=24)
    else:
        start = ensure_utc(start)

    mode, bucket_seconds = _resolve_resolution(resolution)
    # If the caller asked for full raw points over a multi-hour window we
    # downsample server-side rather than ship a multi-MB JSON payload that
    # would stall the client's JSON.parse on the main thread. The frontend
    # selection-extension path takes this branch for 24h windows.
    window_seconds = (end - start).total_seconds()
    mode, bucket_seconds, auto_note = _autodownsample_if_window_too_wide(
        mode, bucket_seconds, window_seconds
    )

    if mode == "bucket":
        # bucket_seconds is a validated int; passed as $4::interval — no user
        # string reaches the SQL text.
        query = """
            SELECT
                time_bucket(($4::int * INTERVAL '1 second'), time) AS time,
                AVG(lat)::float8 AS lat,
                AVG(lon)::float8 AS lon,
                MAX(alt_baro) AS alt_baro,
                MAX(alt_geom) AS alt_geom
            FROM aircraft_positions
            WHERE icao = $1 AND time BETWEEN $2 AND $3
            GROUP BY 1
            ORDER BY 1
        """
        query_args = (icao.lower(), start, end, bucket_seconds)
    else:
        query = """
            SELECT time, lat, lon, alt_baro, alt_geom
            FROM aircraft_positions
            WHERE icao = $1 AND time BETWEEN $2 AND $3
            ORDER BY time
        """
        query_args = (icao.lower(), start, end)

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            rows = await conn.fetch(query, *query_args, timeout=30)

        positions = [
            {
                "time": row['time'].isoformat(),
                "lat": float(row['lat']),
                "lon": float(row['lon']),
                "alt_baro": row['alt_baro'],
                "alt_geom": row['alt_geom'],
            }
            for row in rows
        ]

        return {
            "icao": icao.lower(),
            "start": start.isoformat(),
            "end": end.isoformat(),
            "resolution": resolution,
            "effective_resolution": auto_note or resolution,
            "positions": positions
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching track for {icao}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tracks/bulk/timelapse")
async def get_bulk_tracks_timelapse(
    start: datetime = Query(..., description="Start time (UTC)"),
    end: datetime = Query(..., description="End time (UTC)"),
    resolution: str = Query("full", regex=RESOLUTION_REGEX),
    max_tracks: int = Query(500, le=10000, description="Maximum aircraft to return"),
    min_altitude: Optional[int] = Query(None, description="Minimum altitude filter (feet)"),
    max_altitude: Optional[int] = Query(None, description="Maximum altitude filter (feet)"),
    military_only: bool = Query(False, description="Filter to only military aircraft"),
    hexes: Optional[str] = Query(None, description="Comma-separated ICAO hex list to scope the query")
):
    """
    Bulk tracks for many aircraft in one round trip.

    Pass `hexes=abc123,def456` to scope the query to specific aircraft (the
    common frontend case: backfill trails for everything currently visible).
    Without `hexes`, returns the top-N most active aircraft in the window.

    Position shape mirrors `/tracks/{icao}` so a single client-side parser
    works for both endpoints. Aircraft metadata (registration, type, etc.)
    is intentionally NOT included — call `/aircraft/unique` or similar if
    you need it.
    """
    start = ensure_utc(start)
    end = ensure_utc(end)
    time_range = end - start

    hex_list: List[str] = []
    if hexes:
        hex_list = [h.strip().lower() for h in hexes.split(',') if h.strip()]
        hex_list = list(dict.fromkeys(hex_list))[:500]

    mode, bucket_seconds = _resolve_resolution(resolution)
    # Same auto-downsample guard as the single-hex endpoint: bulk callers
    # asking for raw points over a long window get a server-side aggregate
    # to keep the response from ballooning. The frontend's bulk backfill
    # passes explicit `15s` resolution today so this branch typically
    # passes through unchanged; the guard catches direct API users only.
    window_seconds = (end - start).total_seconds()
    mode, bucket_seconds, auto_note = _autodownsample_if_window_too_wide(
        mode, bucket_seconds, window_seconds
    )

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            filters = ["time BETWEEN $1 AND $2"]
            params: list = [start, end]

            if hex_list:
                filters.append(f"icao = ANY(${len(params) + 1}::text[])")
                params.append(hex_list)
            if min_altitude is not None:
                filters.append(f"alt_baro >= ${len(params) + 1}")
                params.append(min_altitude)
            if max_altitude is not None:
                filters.append(f"alt_baro <= ${len(params) + 1}")
                params.append(max_altitude)

            # Military filter requires a metadata lookup. Use a subquery (not
            # a join on every position row) so we don't blow up the result set.
            if military_only:
                filters.append(
                    "icao IN (SELECT icao FROM aircraft_metadata WHERE is_military = true)"
                )

            where_clause = " AND ".join(filters)

            # When hexes is supplied the caller has chosen the set; skip the
            # ranking CTE entirely.
            if not hex_list:
                params.append(max_tracks)
                limit_idx = len(params)
                rank_cte = f"""
                    WITH ranked_aircraft AS (
                        SELECT icao
                        FROM aircraft_positions
                        WHERE {where_clause}
                        GROUP BY icao
                        ORDER BY COUNT(*) DESC
                        LIMIT ${limit_idx}
                    )
                """
                hex_filter = "icao IN (SELECT icao FROM ranked_aircraft)"
            else:
                rank_cte = ""
                hex_filter = "TRUE"

            if mode == "bucket":
                # bucket_seconds is a validated int; passed as the last $N
                # parameter and cast to interval in SQL — no user string in
                # the query text.
                params.append(bucket_seconds)
                bucket_param = f"${len(params)}"
                # Bucketed mode keeps a single representative kinematics
                # sample per bucket via a window-function-style subquery.
                # For the playback feed we need flight/gs/track on every
                # row so the historical viewer can paint cones with the
                # right callsign + heading; the bucket aggregate would
                # otherwise lose those fields.
                query = f"""
                    {rank_cte}
                    SELECT
                        icao,
                        time_bucket(({bucket_param}::int * INTERVAL '1 second'), time) AS time,
                        AVG(lat)::float8 AS lat,
                        AVG(lon)::float8 AS lon,
                        MAX(alt_baro) AS alt_baro,
                        MAX(alt_geom) AS alt_geom,
                        (array_agg(flight ORDER BY time DESC))[1] AS flight,
                        AVG(gs)::float8 AS gs,
                        AVG(track)::float8 AS track,
                        MAX(category) AS category
                    FROM aircraft_positions
                    WHERE {where_clause} AND {hex_filter}
                    GROUP BY icao, 2
                    ORDER BY icao, 2
                """
            else:
                query = f"""
                    {rank_cte}
                    SELECT
                        time,
                        icao,
                        lat,
                        lon,
                        alt_baro,
                        alt_geom,
                        flight,
                        gs,
                        track,
                        category
                    FROM aircraft_positions
                    WHERE {where_clause} AND {hex_filter}
                    ORDER BY icao, time
                """

            rows = await conn.fetch(query, *params, timeout=30)

        tracks_by_aircraft: dict = {}
        for row in rows:
            icao = row['icao']
            entry = tracks_by_aircraft.get(icao)
            if entry is None:
                entry = {'icao': icao, 'positions': []}
                tracks_by_aircraft[icao] = entry
            entry['positions'].append({
                'time': row['time'].isoformat(),
                'lat': float(row['lat']),
                'lon': float(row['lon']),
                'alt_baro': row['alt_baro'],
                'alt_geom': row['alt_geom'],
                'flight': row.get('flight'),
                'gs': row['gs'] if row.get('gs') is not None else None,
                'track': row['track'] if row.get('track') is not None else None,
                'category': row.get('category'),
            })

        return {
            'time_range': {
                'start': start.isoformat(),
                'end': end.isoformat(),
                'resolution': resolution,
                'effective_resolution': auto_note or resolution
            },
            'stats': {
                'unique_aircraft': len(tracks_by_aircraft),
                'total_positions': len(rows),
                'time_span_hours': time_range.total_seconds() / 3600
            },
            'tracks': list(tracks_by_aircraft.values())
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching bulk tracks: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/aircraft/metadata/bulk")
async def get_metadata_bulk(payload: dict):
    """
    Bulk metadata lookup for a list of ICAO hexes. Used by the historical
    playback feed to enrich position-only timelapse responses with
    registration / type / operator / military-flag.
    """
    raw = payload.get('hexes') or []
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="hexes must be a list")
    hexes = [str(h).strip().lower() for h in raw if isinstance(h, (str,)) and str(h).strip()]
    hexes = list(dict.fromkeys(hexes))[:1000]
    if not hexes:
        return {"results": {}}

    query = """
        SELECT icao, registration, aircraft_type, type_description,
               owner_operator, is_military
        FROM aircraft_metadata
        WHERE icao = ANY($1::text[])
    """
    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            rows = await conn.fetch(query, hexes)
        results = {
            row['icao']: {
                'registration': row['registration'],
                'aircraft_type': row['aircraft_type'],
                'type_description': row['type_description'],
                'owner_operator': row['owner_operator'],
                'is_military': bool(row['is_military']),
            }
            for row in rows
        }
        return {"results": results}
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Database pool acquisition timeout")
    except Exception as e:
        logger.error(f"Bulk metadata lookup failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/heatmap")
async def get_heatmap(
    start: datetime = Query(..., description="Start time (UTC)"),
    end: datetime = Query(..., description="End time (UTC)"),
    cell: float = Query(0.01, gt=0, le=1.0, description="Grid cell size in degrees"),
    bbox: Optional[str] = Query(None, description="lat0,lon0,lat1,lon1 — restrict to a viewport"),
    min_altitude: Optional[int] = Query(None),
    max_altitude: Optional[int] = Query(None),
    military_only: bool = Query(False),
):
    """
    Aircraft-density heatmap over a time window.

    Returns one cell per grid square that any aircraft touched during the
    window, with `count` = number of unique ICAO hexes that passed
    through that cell. Cells with zero touches are omitted.

    Query is bounded by `bbox` to keep response sizes sane on long
    windows. Without a bbox, the result includes every cell the receiver
    has ever picked up — fine for short windows, expensive for 7d.
    """
    start = ensure_utc(start)
    end = ensure_utc(end)

    filters = ["time BETWEEN $1 AND $2"]
    params: list = [start, end]
    if bbox:
        try:
            parts = [float(x) for x in bbox.split(',')]
            if len(parts) != 4:
                raise ValueError
            lat0, lon0, lat1, lon1 = parts
            if lat0 > lat1: lat0, lat1 = lat1, lat0
            if lon0 > lon1: lon0, lon1 = lon1, lon0
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail="bbox must be lat0,lon0,lat1,lon1")
        filters.append(f"lat BETWEEN ${len(params) + 1} AND ${len(params) + 2}")
        params.extend([lat0, lat1])
        filters.append(f"lon BETWEEN ${len(params) + 1} AND ${len(params) + 2}")
        params.extend([lon0, lon1])
    if min_altitude is not None:
        filters.append(f"alt_baro >= ${len(params) + 1}")
        params.append(min_altitude)
    if max_altitude is not None:
        filters.append(f"alt_baro <= ${len(params) + 1}")
        params.append(max_altitude)
    if military_only:
        filters.append("icao IN (SELECT icao FROM aircraft_metadata WHERE is_military = true)")

    # cell is a validated Python float (gt=0, le=1.0); pass as a $N parameter
    # so no user-supplied value is interpolated into the SQL text.
    params.append(cell)
    cell_param = f"${len(params)}"
    where_clause = " AND ".join(filters)
    query = f"""
        SELECT
            (floor(lat / {cell_param})::int) AS cy,
            (floor(lon / {cell_param})::int) AS cx,
            COUNT(DISTINCT icao) AS count
        FROM aircraft_positions
        WHERE {where_clause}
        GROUP BY cy, cx
    """
    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            rows = await conn.fetch(query, *params, timeout=30)
        cells = [
            {
                'lat': (row['cy'] + 0.5) * cell,
                'lon': (row['cx'] + 0.5) * cell,
                'count': row['count'],
            }
            for row in rows
        ]
        return {
            'time_range': {'start': start.isoformat(), 'end': end.isoformat()},
            'cell_deg': cell,
            'cells': cells,
        }
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Database pool acquisition timeout")
    except Exception as e:
        logger.error(f"Heatmap query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/aircraft/unique")
async def get_unique_aircraft(
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    min_sightings: int = Query(1, ge=1, description="Minimum sightings required")
):
    """Get unique/interesting aircraft seen during time period"""
    if not start:
        start = datetime.now(timezone.utc) - timedelta(days=30)
    else:
        start = ensure_utc(start)
    if not end:
        end = datetime.now(timezone.utc)
    else:
        end = ensure_utc(end)

    query = """
        SELECT
            m.icao,
            m.registration,
            m.aircraft_type,
            m.type_description,
            m.owner_operator,
            m.year,
            COUNT(DISTINCT DATE(p.time)) as days_seen,
            MAX(p.time) as last_seen,
            COUNT(*) as total_positions
        FROM aircraft_metadata m
        JOIN aircraft_positions p ON m.icao = p.icao
        WHERE p.time BETWEEN $1 AND $2
        GROUP BY m.icao, m.registration, m.aircraft_type, m.type_description,
                 m.owner_operator, m.year
        HAVING COUNT(DISTINCT DATE(p.time)) >= $3
        ORDER BY days_seen DESC, total_positions DESC
        LIMIT 200
    """

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            rows = await conn.fetch(query, start, end, min_sightings)

        return [
            {
                'icao': row['icao'],
                'registration': row['registration'],
                'aircraft_type': row['aircraft_type'],
                'type_description': row['type_description'],
                'owner_operator': row['owner_operator'],
                'year': row['year'],
                'days_seen': row['days_seen'],
                'last_seen': row['last_seen'].isoformat(),
                'total_positions': row['total_positions']
            }
            for row in rows
        ]

    except Exception as e:
        logger.error(f"Error fetching unique aircraft: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats/summary")
async def get_stats_summary(
    days: int = Query(7, ge=1, le=90, description="Number of days to analyze")
):
    """Get summary statistics for recent period"""
    start = datetime.now(timezone.utc) - timedelta(days=days)

    query = """
        SELECT
            COUNT(DISTINCT icao) as unique_aircraft,
            COUNT(*) as total_positions,
            MIN(time) as first_position,
            MAX(time) as last_position,
            AVG(alt_baro) as avg_altitude,
            MAX(alt_baro) as max_altitude
        FROM aircraft_positions
        WHERE time >= $1 AND alt_baro IS NOT NULL
    """

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            row = await conn.fetchrow(query, start)

        return {
            'period_days': days,
            'unique_aircraft': row['unique_aircraft'],
            'total_positions': row['total_positions'],
            'first_position': row['first_position'].isoformat() if row['first_position'] else None,
            'last_position': row['last_position'].isoformat() if row['last_position'] else None,
            'avg_altitude_ft': int(row['avg_altitude']) if row['avg_altitude'] else None,
            'max_altitude_ft': row['max_altitude']
        }

    except Exception as e:
        logger.error(f"Error fetching stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats/rarity")
async def get_rarity_stats():
    """Get aircraft rarity statistics based on total sightings"""
    query = """
        SELECT
            COUNT(*) FILTER (WHERE total_sightings <= 10) as extremely_rare,
            COUNT(*) FILTER (WHERE total_sightings > 10 AND total_sightings <= 50) as very_rare,
            COUNT(*) FILTER (WHERE total_sightings > 50 AND total_sightings <= 100) as rare,
            COUNT(*) FILTER (WHERE total_sightings > 100 AND total_sightings <= 500) as uncommon,
            COUNT(*) FILTER (WHERE total_sightings > 500 AND total_sightings <= 1000) as common,
            COUNT(*) FILTER (WHERE total_sightings > 1000) as very_common,
            COUNT(*) as total_aircraft
        FROM aircraft_metadata
    """

    # Get examples for each category
    examples_query = """
        SELECT icao, registration, aircraft_type, type_description, total_sightings,
               CASE
                   WHEN total_sightings <= 10 THEN 'extremely_rare'
                   WHEN total_sightings <= 50 THEN 'very_rare'
                   WHEN total_sightings <= 100 THEN 'rare'
                   WHEN total_sightings <= 500 THEN 'uncommon'
                   WHEN total_sightings <= 1000 THEN 'common'
                   ELSE 'very_common'
               END as category
        FROM aircraft_metadata
        ORDER BY total_sightings
        LIMIT 200
    """

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            stats = await conn.fetchrow(query)
            examples = await conn.fetch(examples_query)

        # Group examples by category
        by_category = {}
        for ex in examples:
            cat = ex['category']
            if cat not in by_category:
                by_category[cat] = []
            if len(by_category[cat]) < 10:  # Max 10 examples per category
                by_category[cat].append({
                    'icao': ex['icao'],
                    'registration': ex['registration'],
                    'aircraft_type': ex['aircraft_type'],
                    'type_description': ex['type_description'],
                    'sightings': ex['total_sightings']
                })

        return {
            'summary': {
                'extremely_rare': stats['extremely_rare'],
                'very_rare': stats['very_rare'],
                'rare': stats['rare'],
                'uncommon': stats['uncommon'],
                'common': stats['common'],
                'very_common': stats['very_common'],
                'total': stats['total_aircraft']
            },
            'examples': by_category
        }

    except Exception as e:
        logger.error(f"Error fetching rarity stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats/aircraft-types")
async def get_aircraft_type_stats(limit: int = Query(50, le=200)):
    """Get statistics by aircraft type"""
    query = """
        SELECT
            aircraft_type,
            type_description,
            COUNT(*) as aircraft_count,
            SUM(total_sightings) as total_sightings,
            AVG(total_sightings) as avg_sightings_per_aircraft,
            COUNT(*) FILTER (WHERE is_military = true) as military_count
        FROM aircraft_metadata
        WHERE aircraft_type IS NOT NULL
        GROUP BY aircraft_type, type_description
        ORDER BY aircraft_count DESC
        LIMIT $1
    """

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            rows = await conn.fetch(query, limit)

        return [
            {
                'type': row['aircraft_type'],
                'description': row['type_description'],
                'aircraft_count': row['aircraft_count'],
                'total_sightings': row['total_sightings'],
                'avg_sightings': round(float(row['avg_sightings_per_aircraft']), 1),
                'military_count': row['military_count']
            }
            for row in rows
        ]

    except Exception as e:
        logger.error(f"Error fetching aircraft type stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats/military")
async def get_military_stats():
    """Get military aircraft statistics"""
    summary_query = """
        SELECT
            COUNT(*) FILTER (WHERE is_military = true) as military_aircraft,
            COUNT(*) FILTER (WHERE is_military = false) as civilian_aircraft,
            COUNT(*) as total_aircraft
        FROM aircraft_metadata
    """

    top_military_query = """
        SELECT icao, registration, aircraft_type, type_description, total_sightings, last_seen
        FROM aircraft_metadata
        WHERE is_military = true
        ORDER BY total_sightings DESC
        LIMIT 20
    """

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            summary = await conn.fetchrow(summary_query)
            top_military = await conn.fetch(top_military_query)

        return {
            'summary': {
                'military': summary['military_aircraft'],
                'civilian': summary['civilian_aircraft'],
                'total': summary['total_aircraft'],
                'military_percentage': round(100.0 * summary['military_aircraft'] / summary['total_aircraft'], 2) if summary['total_aircraft'] > 0 else 0
            },
            'top_military': [
                {
                    'icao': row['icao'],
                    'registration': row['registration'],
                    'type': row['aircraft_type'],
                    'description': row['type_description'],
                    'sightings': row['total_sightings'],
                    'last_seen': row['last_seen'].isoformat()
                }
                for row in top_military
            ]
        }

    except Exception as e:
        logger.error(f"Error fetching military stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats/records")
async def get_records(days: int = Query(30, ge=1, le=365)):
    """Get altitude and speed records"""
    start = datetime.now(timezone.utc) - timedelta(days=days)

    query = """
        WITH ranked_positions AS (
            SELECT
                p.*,
                m.registration,
                m.aircraft_type,
                m.type_description,
                ROW_NUMBER() OVER (PARTITION BY 'altitude' ORDER BY p.alt_baro DESC NULLS LAST) as alt_rank,
                ROW_NUMBER() OVER (PARTITION BY 'speed' ORDER BY p.gs DESC NULLS LAST) as speed_rank
            FROM aircraft_positions p
            LEFT JOIN aircraft_metadata m ON p.icao = m.icao
            WHERE p.time >= $1
              AND (p.alt_baro IS NOT NULL OR p.gs IS NOT NULL)
        )
        SELECT * FROM (
            SELECT 'highest_altitude' as record_type, icao, registration, aircraft_type, type_description,
                   alt_baro as value, time, flight
            FROM ranked_positions WHERE alt_rank = 1
            UNION ALL
            SELECT 'fastest_groundspeed' as record_type, icao, registration, aircraft_type, type_description,
                   gs as value, time, flight
            FROM ranked_positions WHERE speed_rank = 1
        ) records
    """

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            rows = await conn.fetch(query, start)

        records = {}
        for row in rows:
            records[row['record_type']] = {
                'icao': row['icao'],
                'registration': row['registration'],
                'type': row['aircraft_type'],
                'description': row['type_description'],
                'value': float(row['value']) if row['value'] else None,
                'unit': 'feet' if row['record_type'] == 'highest_altitude' else 'knots',
                'time': row['time'].isoformat(),
                'flight': row['flight']
            }

        return {
            'period_days': days,
            'records': records
        }

    except Exception as e:
        logger.error(f"Error fetching records: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats/time-analysis")
async def get_time_analysis(days: int = Query(7, ge=1, le=90)):
    """Get time-of-day and day-of-week patterns"""
    start = datetime.now(timezone.utc) - timedelta(days=days)

    hourly_query = """
        SELECT
            EXTRACT(HOUR FROM time) as hour,
            COUNT(DISTINCT icao) as unique_aircraft,
            COUNT(*) as positions
        FROM aircraft_positions
        WHERE time >= $1
        GROUP BY EXTRACT(HOUR FROM time)
        ORDER BY hour
    """

    daily_query = """
        SELECT
            TO_CHAR(time, 'Day') as day_name,
            EXTRACT(DOW FROM time) as day_num,
            COUNT(DISTINCT icao) as unique_aircraft,
            COUNT(*) as positions
        FROM aircraft_positions
        WHERE time >= $1
        GROUP BY TO_CHAR(time, 'Day'), EXTRACT(DOW FROM time)
        ORDER BY day_num
    """

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            hourly = await conn.fetch(hourly_query, start)
            daily = await conn.fetch(daily_query, start)

        return {
            'period_days': days,
            'by_hour': [
                {
                    'hour': int(row['hour']),
                    'unique_aircraft': row['unique_aircraft'],
                    'positions': row['positions']
                }
                for row in hourly
            ],
            'by_day_of_week': [
                {
                    'day': row['day_name'].strip(),
                    'day_num': int(row['day_num']),
                    'unique_aircraft': row['unique_aircraft'],
                    'positions': row['positions']
                }
                for row in daily
            ]
        }

    except Exception as e:
        logger.error(f"Error fetching time analysis: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats/database")
async def get_database_stats():
    """Get database size and health statistics"""
    queries = {
        'total_size': """
            SELECT pg_size_pretty(pg_database_size(current_database())) as size
        """,
        'table_sizes': """
            SELECT
                schemaname,
                tablename,
                pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
                pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY size_bytes DESC
        """,
        'compression_stats': """
            SELECT
                hypertable_name,
                compression_enabled,
                (SELECT COUNT(*) FROM timescaledb_information.chunks WHERE hypertable_name = h.hypertable_name) as total_chunks,
                (SELECT COUNT(*) FROM timescaledb_information.chunks WHERE hypertable_name = h.hypertable_name AND is_compressed = true) as compressed_chunks
            FROM timescaledb_information.hypertables h
            WHERE hypertable_name = 'aircraft_positions'
        """,
        'row_counts': """
            SELECT
                'aircraft_positions' as table_name,
                COUNT(*) as row_count
            FROM aircraft_positions
            UNION ALL
            SELECT
                'aircraft_metadata' as table_name,
                COUNT(*) as row_count
            FROM aircraft_metadata
        """
    }

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            total_size = await conn.fetchrow(queries['total_size'])
            table_sizes = await conn.fetch(queries['table_sizes'])
            compression = await conn.fetchrow(queries['compression_stats'])
            row_counts = await conn.fetch(queries['row_counts'])

        return {
            'database_size': total_size['size'],
            'tables': [
                {
                    'schema': row['schemaname'],
                    'table': row['tablename'],
                    'size': row['size']
                }
                for row in table_sizes
            ],
            'compression': {
                'enabled': compression['compression_enabled'],
                'total_chunks': compression['total_chunks'],
                'compressed_chunks': compression['compressed_chunks'],
                'compression_ratio': round(100.0 * compression['compressed_chunks'] / compression['total_chunks'], 1) if compression['total_chunks'] > 0 else 0
            },
            'row_counts': {row['table_name']: row['row_count'] for row in row_counts}
        }

    except Exception as e:
        logger.error(f"Error fetching database stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# FLIGHT ROUTE LOOKUPS (adsb.im routeset API)
# ============================================================================

ADSB_IM_ROUTE_URL = "https://adsb.im/api/0/routeset"
ADSB_IM_TIMEOUT = aiohttp.ClientTimeout(total=10)


ROUTE_CACHE_MAX = 2000  # hard cap; evict expired entries on each write

def _route_cache_evict_expired() -> None:
    """Remove entries whose TTL has lapsed. Called before each cache write."""
    now = datetime.now(timezone.utc).timestamp()
    expired = [
        cs for cs, (data, ts) in list(route_cache.items())
        if (now - ts) >= (ROUTE_NEGATIVE_TTL if data is None else ROUTE_CACHE_TTL)
    ]
    for cs in expired:
        route_cache.pop(cs, None)
    # If still over cap after expiry sweep, trim oldest entries
    if len(route_cache) > ROUTE_CACHE_MAX:
        oldest = sorted(route_cache, key=lambda k: route_cache[k][1])
        for cs in oldest[:len(route_cache) - ROUTE_CACHE_MAX]:
            route_cache.pop(cs, None)


def _is_route_cached(callsign: str) -> bool:
    """Check if a valid cache entry exists for this callsign."""
    if callsign not in route_cache:
        return False
    data, ts = route_cache[callsign]
    ttl = ROUTE_NEGATIVE_TTL if data is None else ROUTE_CACHE_TTL
    return (datetime.now(timezone.utc).timestamp() - ts) < ttl


def _get_cached_route(callsign: str):
    """Return cached data, or Ellipsis as a cache-miss sentinel."""
    if _is_route_cached(callsign):
        return route_cache[callsign][0]
    return ...


def _format_route_response(callsign: str, data: dict | None) -> dict:
    """Convert internal cache shape to API response shape."""
    if not data:
        return {"callsign": callsign, "origin": None, "destination": None, "source": "adsb.im"}
    return {
        "callsign": callsign,
        "origin": data["origin"]["iata"] or data["origin"]["icao"],
        "destination": data["destination"]["iata"] or data["destination"]["icao"],
        "origin_name": data["origin"]["name"],
        "destination_name": data["destination"]["name"],
        "origin_icao": data["origin"]["icao"],
        "destination_icao": data["destination"]["icao"],
        "plausible": data.get("plausible", True),
        "source": "adsb.im",
    }


async def _fetch_routes_from_adsb_im(callsigns: list) -> dict:
    """
    Call adsb.im routeset API with a list of callsigns.
    Returns dict: callsign -> internal_data (or None for not-found).
    Updates route_cache for all results.
    """
    global _route_circuit_failures, _route_circuit_open_until

    now = datetime.now(timezone.utc).timestamp()

    # Circuit breaker check
    if now < _route_circuit_open_until:
        logger.warning(f"Route circuit open, skipping fetch for {len(callsigns)} callsigns")
        return {}

    payload = {"planes": [{"callsign": cs, "lat": 0.0, "lng": 0.0} for cs in callsigns]}

    try:
        async with aiohttp.ClientSession(timeout=ADSB_IM_TIMEOUT) as session:
            async with session.post(ADSB_IM_ROUTE_URL, json=payload) as resp:
                if resp.status != 200:
                    raise ValueError(f"HTTP {resp.status}")
                raw_results = await resp.json()

        _route_circuit_failures = 0  # reset on success

        _route_cache_evict_expired()
        results = {}
        returned_callsigns = set()

        for item in raw_results:
            cs = item.get("callsign", "").strip().upper()
            if not cs:
                continue
            returned_callsigns.add(cs)

            airports = item.get("_airports", [])
            if len(airports) >= 2 and airports[0].get("iata") and airports[1].get("iata"):
                dep, arr = airports[0], airports[1]
                data = {
                    "origin": {"iata": dep["iata"], "icao": dep.get("icao", ""), "name": dep.get("name", "")},
                    "destination": {"iata": arr["iata"], "icao": arr.get("icao", ""), "name": arr.get("name", "")},
                    "plausible": bool(item.get("plausible", True)),
                }
                route_cache[cs] = (data, now)
                results[cs] = data
            else:
                # Not found or incomplete
                route_cache[cs] = (None, now)
                results[cs] = None

        # Cache negative for callsigns not in response at all
        for cs in callsigns:
            upper = cs.upper()
            if upper not in returned_callsigns:
                route_cache[upper] = (None, now)

        found = sum(1 for v in results.values() if v)
        logger.info(f"adsb.im route fetch: {len(callsigns)} requested, {found} found")
        return results

    except Exception as e:
        _route_circuit_failures += 1
        logger.warning(f"adsb.im route fetch failed ({_route_circuit_failures}): {e}")
        if _route_circuit_failures >= ROUTE_CIRCUIT_THRESHOLD:
            _route_circuit_open_until = now + ROUTE_CIRCUIT_BACKOFF
            logger.error(f"Route circuit opened for {ROUTE_CIRCUIT_BACKOFF}s")
        return {}


@app.post("/route/batch")
async def get_routes_batch(body: dict):
    """
    Batch route lookup for multiple callsigns via adsb.im.
    Accepts: {"callsigns": ["AAL1690", "UAL432", ...]}
    Returns cached results immediately; fetches uncached from adsb.im.
    """
    callsigns_raw = body.get("callsigns", [])
    if not callsigns_raw or not isinstance(callsigns_raw, list):
        raise HTTPException(status_code=400, detail="callsigns array required")

    callsigns = [cs.strip().upper() for cs in callsigns_raw if cs and cs.strip()]
    callsigns = list(dict.fromkeys(callsigns))[:100]  # deduplicate, cap at 100

    cache_hits = {}
    cache_misses = []

    for cs in callsigns:
        cached = _get_cached_route(cs)
        if cached is not ...:
            cache_hits[cs] = cached
        else:
            cache_misses.append(cs)

    fetched = {}
    if cache_misses:
        fetched = await _fetch_routes_from_adsb_im(cache_misses)

    results = {}
    for cs in callsigns:
        data = cache_hits.get(cs, fetched.get(cs))
        results[cs] = _format_route_response(cs, data)

    return {
        "results": results,
        "cached_count": len(cache_hits),
        "fetched_count": len(cache_misses),
    }


def _route_cache_headers(payload: dict) -> dict:
    """
    Cache-Control + ETag for /route/{callsign}.

    Routes are stable for hours/days; let the browser absorb reloads.
    Negative results (no origin/destination) get a shorter TTL so a
    backfill arriving server-side reaches users sooner.
    """
    has_route = bool(payload.get("origin") and payload.get("destination"))
    max_age = ROUTE_CACHE_TTL if has_route else ROUTE_NEGATIVE_TTL
    etag_src = f"{payload.get('callsign','')}|{payload.get('origin','')}|{payload.get('destination','')}"
    etag = '"' + hashlib.sha1(etag_src.encode()).hexdigest()[:16] + '"'
    return {
        "Cache-Control": f"public, max-age={max_age}",
        "ETag": etag,
    }


@app.get("/route/{callsign}")
async def get_flight_route(callsign: str, request: Request):
    """
    Single callsign route lookup via adsb.im.
    Reads cache; fetches on miss. Sets Cache-Control + ETag so the browser
    HTTP cache absorbs reloads.
    """
    callsign = callsign.strip().upper()
    if not callsign:
        raise HTTPException(status_code=400, detail="Callsign required")

    cached = _get_cached_route(callsign)
    if cached is not ...:
        payload = _format_route_response(callsign, cached)
    else:
        fetched = await _fetch_routes_from_adsb_im([callsign])
        payload = _format_route_response(callsign, fetched.get(callsign))

    headers = _route_cache_headers(payload)
    inm = request.headers.get("if-none-match")
    if inm and inm == headers["ETag"]:
        return Response(status_code=304, headers=headers)
    return JSONResponse(content=payload, headers=headers)


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        ws_per_message_deflate=True,
    )
