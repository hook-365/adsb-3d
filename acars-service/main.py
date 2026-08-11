#!/usr/bin/env python3
"""
ACARS Service
Collects ACARS messages from ACARS Hub and provides REST API for adsb-3d integration.

- Background task: Connects to ACARS Hub TCP port (15550), receives JSON messages
- Database: Stores messages in TimescaleDB with automatic schema initialization
- REST API: FastAPI endpoints for querying messages by flight, aircraft, or time range
"""

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta, timezone
from typing import List, Optional
import asyncpg
import asyncio
import os
import random
import sys
import json
import logging
import time

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
    title="ACARS Service",
    description="ACARS message collection and API for adsb-3d",
    version="1.0.0"
)

# CORS for 3D viewer access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared database pool
db_pool = None

# Background collector
collector_instance = None
collector_task = None

# Pool.acquire() has no default timeout (it waits forever); every acquire
# below passes this explicitly so a saturated pool surfaces as a 503 instead
# of a hung request. /health uses a shorter timeout of its own so the
# Docker healthcheck curl gets a real answer.
DB_ACQUIRE_TIMEOUT = 10.0

# Per-send timeout for WS broadcast fan-out; a stalled browser tab can't be
# allowed to backpressure TCP ingest from the hub.
WS_SEND_TIMEOUT = 1.0


# WebSocket connection manager for real-time streaming
class ConnectionManager:
    """Manages WebSocket connections for real-time message broadcasting."""

    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket client connected ({len(self.active_connections)} total)")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"WebSocket client disconnected ({len(self.active_connections)} total)")

    async def broadcast(self, message: dict):
        """Broadcast a message to all connected clients in parallel.
        Uses gather so a slow/dead client doesn't block the others."""
        if not self.active_connections:
            return

        targets = list(self.active_connections)
        results = await asyncio.gather(
            *(asyncio.wait_for(connection.send_json(message), WS_SEND_TIMEOUT) for connection in targets),
            return_exceptions=True,
        )
        for connection, result in zip(targets, results):
            if isinstance(result, Exception):
                logger.debug(f"Failed to send to client: {result}")
                self.disconnect(connection)

ws_manager = ConnectionManager()


def ensure_utc(dt: datetime) -> datetime:
    """Ensure datetime object is timezone-aware (UTC)"""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def initialize_database_schema(db_pool):
    """Initialize ACARS database schema if tables don't exist."""
    logger.info("=" * 60)
    logger.info("Checking ACARS database schema...")
    logger.info("=" * 60)

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            # Check if our table exists
            table_exists = await conn.fetchval("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_schema = 'public'
                    AND table_name = 'acars_messages'
                )
            """)

            if table_exists:
                logger.info("ACARS tables already exist")
                return

            logger.info("Creating ACARS tables...")

            # Create TimescaleDB extension if not exists
            await conn.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE")

            # Create acars_messages table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS acars_messages (
                    time TIMESTAMPTZ NOT NULL,
                    flight TEXT,
                    reg TEXT,
                    icao TEXT,
                    label TEXT,
                    block_id TEXT,
                    msg_num TEXT,
                    text TEXT,
                    freq REAL,
                    level INTEGER,
                    error INTEGER,
                    mode TEXT DEFAULT 'ACARS',
                    station_id TEXT,
                    -- Additional fields from ACARS Hub
                    dsta TEXT,
                    eta TEXT,
                    gtout TEXT,
                    gtin TEXT,
                    wloff TEXT,
                    wlin TEXT,
                    lat DOUBLE PRECISION,
                    lon DOUBLE PRECISION,
                    alt INTEGER
                )
            """)
            logger.info("Created acars_messages table")

            # Convert to hypertable (7-day chunks)
            await conn.execute("""
                SELECT create_hypertable('acars_messages', 'time',
                    chunk_time_interval => INTERVAL '7 days',
                    if_not_exists => TRUE)
            """)
            logger.info("Converted to TimescaleDB hypertable")

            # Create indexes
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_acars_flight ON acars_messages (flight, time DESC);
                CREATE INDEX IF NOT EXISTS idx_acars_reg ON acars_messages (reg, time DESC);
                CREATE INDEX IF NOT EXISTS idx_acars_icao ON acars_messages (icao, time DESC);
                CREATE INDEX IF NOT EXISTS idx_acars_label ON acars_messages (label, time DESC);
                CREATE INDEX IF NOT EXISTS idx_acars_time ON acars_messages (time DESC);
            """)
            logger.info("Created indexes")

            # Enable compression
            await conn.execute("""
                ALTER TABLE acars_messages SET (
                    timescaledb.compress,
                    timescaledb.compress_segmentby = 'flight',
                    timescaledb.compress_orderby = 'time DESC'
                )
            """)

            # Add compression policy (compress data older than 7 days)
            await conn.execute("""
                SELECT add_compression_policy('acars_messages', INTERVAL '7 days',
                    if_not_exists => TRUE)
            """)
            logger.info("Compression enabled")

            # Add retention policy (30 days)
            await conn.execute("""
                SELECT add_retention_policy('acars_messages', INTERVAL '30 days',
                    if_not_exists => TRUE)
            """)
            logger.info("Retention policy set (30 days)")

            logger.info("=" * 60)
            logger.info("ACARS database initialization complete!")
            logger.info("=" * 60)

    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise


# ============================================================================
# ACARS COLLECTOR (Background Task)
# ============================================================================

# Hard cap on the line-assembly buffer. ACARS Hub sends newline-delimited
# JSON; if a read chunk arrives without a newline and the buffer grows past
# this with still no newline in sight, something is wrong upstream (binary
# garbage, protocol mismatch) — reset rather than grow unbounded.
MAX_LINE_BUFFER_BYTES = 1_048_576

class ACARSCollector:
    """Connects to ACARS Hub TCP port and collects messages."""

    def __init__(self, db_pool):
        self.db_pool = db_pool
        self.acars_host = os.getenv('ACARS_HOST', 'acarshub')
        self.acars_port = int(os.getenv('ACARS_PORT', '15550'))
        self.station_id = os.getenv('STATION_ID', 'adsb-3d')
        self.running = True
        self.reconnect_delay = 5  # seconds
        self.message_buffer = []
        self.buffer_size = 10  # Batch insert size
        self.max_buffer_size = 1000  # Hard cap to prevent OOM if DB is down
        self.flush_interval = 30.0  # Wall-clock flush even if buffer_size isn't reached
        self.last_flush = time.monotonic()
        self.stats = {
            'messages_received': 0,
            'messages_stored': 0,
            'messages_dropped': 0,
            'connection_errors': 0,
            'last_message_time': None
        }
        # Honest connection-state signal so the frontend can distinguish
        # "service alive, hub talking" from "service alive, hub dead".
        self.hub_connected: bool = False

        logger.info(f"ACARS Collector initialized: {self.acars_host}:{self.acars_port}")

    async def connect(self):
        """
        Establish TCP connection to ACARS Hub.

        Retries with exponential backoff + jitter (starting at
        self.reconnect_delay, doubling to a 300s cap) instead of a fixed
        5s retry, so a hub that's down for a while doesn't get hammered
        forever at the same cadence.
        """
        delay = self.reconnect_delay
        while self.running:
            try:
                logger.info(f"Connecting to ACARS Hub at {self.acars_host}:{self.acars_port}...")
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(self.acars_host, self.acars_port),
                    timeout=10
                )
                logger.info("Connected to ACARS Hub!")
                self.stats['connection_errors'] = 0
                self.hub_connected = True
                return reader, writer
            except asyncio.TimeoutError:
                logger.warning(f"Connection timeout, retrying in {delay:.1f}s...")
            except ConnectionRefusedError:
                logger.warning(f"Connection refused, retrying in {delay:.1f}s...")
            except Exception as e:
                logger.error(f"Connection error: {e}, retrying in {delay:.1f}s...")

            self.stats['connection_errors'] += 1
            await asyncio.sleep(delay + random.uniform(0, delay * 0.25))
            delay = min(delay * 2, 300)

        return None, None

    @staticmethod
    def _to_int(v):
        """Best-effort int coercion; None (not a crash) on anything unusable."""
        if v is None:
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _to_float(v):
        """Best-effort float coercion; None (not a crash) on anything unusable."""
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _to_text(v):
        """Best-effort text coercion; None for falsy/missing values."""
        if not v:
            return None
        try:
            return str(v)
        except (TypeError, ValueError):
            return None

    def parse_acars_message(self, data: dict) -> dict:
        """Parse ACARS Hub JSON message into database format."""
        try:
            # ACARS Hub sends messages with various fields
            # Common fields: flight, tail, text, label, block_id, msg_num, freq, level, error
            return {
                'time': datetime.now(timezone.utc),
                'flight': (data.get('flight') or '').strip() or None,
                'reg': self._to_text(data.get('tail') or data.get('reg')),
                'icao': self._to_text(data.get('icao')),
                'label': self._to_text(data.get('label')),
                'block_id': self._to_text(data.get('block_id')),
                'msg_num': self._to_text(data.get('msg_num') or data.get('msgno')),
                'text': self._to_text(data.get('text') or data.get('message')),
                'freq': self._to_float(data.get('freq')),
                'level': self._to_int(data.get('level') or data.get('signal')),
                'error': self._to_int(data.get('error')),
                'mode': data.get('mode', 'ACARS'),
                'station_id': self.station_id,
                # OOOI data (Out of gate, Off ground, On ground, Into gate)
                'dsta': self._to_text(data.get('dsta')),  # Destination airport
                'eta': self._to_text(data.get('eta')),    # Estimated time of arrival
                'gtout': self._to_text(data.get('gtout')),  # Gate out time
                'gtin': self._to_text(data.get('gtin')),    # Gate in time
                'wloff': self._to_text(data.get('wloff')),  # Wheels off time
                'wlin': self._to_text(data.get('wlin')),    # Wheels on time
                # Position data (if available)
                'lat': self._to_float(data.get('lat')),
                'lon': self._to_float(data.get('lon')),
                'alt': self._to_int(data.get('alt'))
            }
        except Exception as e:
            logger.error(f"Error parsing ACARS message: {e}")
            return None

    _INSERT_SQL = '''
        INSERT INTO acars_messages
        (time, flight, reg, icao, label, block_id, msg_num, text,
         freq, level, error, mode, station_id,
         dsta, eta, gtout, gtin, wloff, wlin, lat, lon, alt)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                $14, $15, $16, $17, $18, $19, $20, $21, $22)
    '''

    @staticmethod
    def _to_record(m: dict) -> tuple:
        """Build the positional-parameter tuple for one message row."""
        return (
            m['time'], m['flight'], m['reg'], m['icao'], m['label'],
            m['block_id'], m['msg_num'], m['text'], m['freq'], m['level'],
            m['error'], m['mode'], m['station_id'],
            m['dsta'], m['eta'], m['gtout'], m['gtin'], m['wloff'], m['wlin'],
            m['lat'], m['lon'], m['alt']
        )

    async def store_messages(self, messages: List[dict]):
        """Batch insert messages into database, falling back to per-row
        inserts if the batch as a whole fails (e.g. one bad row poisons an
        executemany) so a single malformed message doesn't drop the batch."""
        self.last_flush = time.monotonic()
        if not messages:
            return

        try:
            async with self.db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
                try:
                    await conn.executemany(self._INSERT_SQL, [self._to_record(m) for m in messages])
                    self.stats['messages_stored'] += len(messages)
                    logger.debug(f"Stored {len(messages)} ACARS messages")
                except Exception as e:
                    stored = 0
                    dropped = 0
                    for m in messages:
                        try:
                            await conn.execute(self._INSERT_SQL, *self._to_record(m))
                            stored += 1
                        except Exception:
                            dropped += 1
                    self.stats['messages_stored'] += stored
                    self.stats['messages_dropped'] += dropped
                    logger.error(
                        f"batch insert failed ({e}); per-row retry stored {stored}, dropped {dropped}"
                    )

        except Exception as e:
            self.stats['messages_dropped'] += len(messages)
            logger.error(f"Database error storing {len(messages)} messages (dropped): {e}")

    async def collect_loop(self):
        """Main collection loop."""
        while self.running:
            reader, writer = await self.connect()
            if not reader:
                continue

            try:
                buffer = b''
                while self.running:
                    try:
                        # Read data with timeout
                        data = await asyncio.wait_for(reader.read(4096), timeout=60)
                        if not data:
                            logger.warning("Connection closed by ACARS Hub")
                            break

                        buffer += data

                        if len(buffer) > MAX_LINE_BUFFER_BYTES and b'\n' not in buffer:
                            logger.warning("no newline in >1MiB from hub; resetting line buffer")
                            buffer = b''
                            continue

                        # Process complete JSON lines
                        while b'\n' in buffer:
                            line, buffer = buffer.split(b'\n', 1)
                            if not line.strip():
                                continue

                            try:
                                msg_data = json.loads(line.decode('utf-8'))
                                parsed = self.parse_acars_message(msg_data)

                                if parsed:
                                    self.message_buffer.append(parsed)
                                    self.stats['messages_received'] += 1
                                    self.stats['last_message_time'] = datetime.now(timezone.utc)

                                    # Log interesting messages
                                    flight = parsed.get('flight') or 'UNKNOWN'
                                    label = parsed.get('label') or '??'
                                    logger.info(f"ACARS [{label}] {flight}: {(parsed.get('text') or '')[:50]}...")

                                    # Broadcast to WebSocket clients
                                    await ws_manager.broadcast({
                                        "type": "new_message",
                                        "message": {
                                            "time": parsed['time'].isoformat(),
                                            "flight": parsed.get('flight'),
                                            "reg": parsed.get('reg'),
                                            "icao": parsed.get('icao'),
                                            "label": parsed.get('label'),
                                            "block_id": parsed.get('block_id'),
                                            "msg_num": parsed.get('msg_num'),
                                            "text": parsed.get('text'),
                                            "freq": parsed.get('freq'),
                                            "level": parsed.get('level'),
                                            "error": parsed.get('error'),
                                            "mode": parsed.get('mode'),
                                            "station_id": parsed.get('station_id'),
                                            "destination": parsed.get('dsta'),
                                            "eta": parsed.get('eta'),
                                            "gtout": parsed.get('gtout'),
                                            "wloff": parsed.get('wloff'),
                                            "wlin": parsed.get('wlin'),
                                            "gtin": parsed.get('gtin'),
                                            "position": {
                                                "lat": parsed.get('lat'),
                                                "lon": parsed.get('lon'),
                                                "alt": parsed.get('alt')
                                            } if parsed.get('lat') and parsed.get('lon') else None
                                        }
                                    })

                                    # Cap buffer to prevent unbounded memory growth
                                    if len(self.message_buffer) > self.max_buffer_size:
                                        dropped = len(self.message_buffer) - self.max_buffer_size
                                        self.message_buffer = self.message_buffer[-self.max_buffer_size:]
                                        self.stats['messages_dropped'] += dropped
                                        logger.warning(f"Buffer overflow: dropped {dropped} oldest messages")

                                    # Batch store when buffer is full
                                    if len(self.message_buffer) >= self.buffer_size:
                                        await self.store_messages(self.message_buffer)
                                        self.message_buffer = []

                            except json.JSONDecodeError as e:
                                logger.debug(f"Invalid JSON: {e}")
                            except Exception as e:
                                logger.error(f"Error processing message: {e}")

                        # Wall-clock flush: a slow-arriving flight might never
                        # fill buffer_size before the messages go stale, so
                        # flush on a timer too, once per read chunk.
                        if self.message_buffer and time.monotonic() - self.last_flush >= self.flush_interval:
                            await self.store_messages(self.message_buffer)
                            self.message_buffer = []

                    except asyncio.TimeoutError:
                        # No data for 60 seconds - flush buffer and continue
                        if self.message_buffer:
                            await self.store_messages(self.message_buffer)
                            self.message_buffer = []
                        continue

            except Exception as e:
                logger.error(f"Collection error: {e}")

            finally:
                self.hub_connected = False
                if writer:
                    writer.close()
                    try:
                        await writer.wait_closed()
                    except Exception:
                        pass

            # Flush any remaining messages
            if self.message_buffer:
                await self.store_messages(self.message_buffer)
                self.message_buffer = []

            if self.running:
                logger.info(f"Reconnecting in {self.reconnect_delay}s...")
                await asyncio.sleep(self.reconnect_delay)

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
        """Stop the collector gracefully."""
        logger.info("Stopping ACARS collector...")
        self.running = False


# ============================================================================
# FASTAPI LIFECYCLE EVENTS
# ============================================================================

heartbeat_task: Optional[asyncio.Task] = None


@app.on_event("startup")
async def startup():
    """Initialize database and start collector."""
    global db_pool, collector_instance, collector_task, heartbeat_task

    # Database configuration (uses same TimescaleDB as track-service)
    DB_CONFIG = {
        'host': os.getenv('DB_HOST', 'timescaledb-adsb'),
        'port': int(os.getenv('DB_PORT', '5432')),
        'database': os.getenv('DB_NAME', 'adsb_tracks'),
        'user': os.getenv('DB_USER', 'adsb'),
        'password': os.getenv('DB_PASSWORD', ''),
    }

    try:
        # Create database pool
        db_pool = await asyncpg.create_pool(
            **DB_CONFIG,
            min_size=2,
            max_size=10,
            command_timeout=60,
            timeout=10.0  # New-connection CONNECT timeout, not an acquire() timeout
        )
        logger.info(f"Database pool created: {DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['database']}")

        # Initialize schema
        await initialize_database_schema(db_pool)

        # Start collector
        collector_instance = ACARSCollector(db_pool)
        collector_task = asyncio.create_task(collector_instance.run())
        logger.info("ACARS collector started")

        # Start the WS heartbeat broadcaster — pushes hub_connected +
        # last_message_age_s to all clients every 5s so they can flag a
        # silent acarshub even when our service is healthy.
        heartbeat_task = asyncio.create_task(_heartbeat_loop())
        logger.info("ACARS WS heartbeat started")

    except Exception as e:
        logger.error(f"Failed to start service: {e}")
        raise


@app.on_event("shutdown")
async def shutdown():
    """Stop collector and close database pool."""
    global db_pool, collector_instance, collector_task, heartbeat_task

    if heartbeat_task:
        heartbeat_task.cancel()

    if collector_instance:
        collector_instance.stop()

    if collector_task:
        try:
            await asyncio.wait_for(collector_task, timeout=10.0)
        except asyncio.TimeoutError:
            collector_task.cancel()

    if db_pool:
        await db_pool.close()
        logger.info("Database pool closed")


# ============================================================================
# REST API ENDPOINTS
# ============================================================================

@app.get("/")
async def root():
    """API root endpoint."""
    return {
        "name": "ACARS Service",
        "version": "1.0.0",
        "docs": "/docs"
    }


_acars_health_cache: dict = {"ts": 0.0, "ok": False, "payload": None, "err": None}
ACARS_HEALTH_CACHE_TTL = 2.0  # seconds — cheap for Docker probes, still fresh enough


@app.get("/health")
async def health_check():
    """Health check. A cheap DB ping is cached for 2s; the expensive stats
    aggregate is reused from the same cached result, so frequent Docker probes
    don't hit the pool on every call."""
    now = time.monotonic()
    if now - _acars_health_cache["ts"] > ACARS_HEALTH_CACHE_TTL:
        try:
            async with db_pool.acquire(timeout=3.0) as conn:
                # Lightweight liveness check first, then stats in same connection.
                await conn.fetchval("SELECT 1")
                row = await conn.fetchrow("""
                    SELECT
                        COUNT(*) as total,
                        COUNT(*) FILTER (WHERE time > NOW() - INTERVAL '24 hours') as last_24h,
                        MAX(time) as last_message
                    FROM acars_messages
                """)
            # Task liveness, not just the `running` flag — a crashed/backoff-
            # restarting collector still has `running` True, but a genuinely
            # dead task (exited its while-loop after stop()) shows as .done().
            collector_status = "running" if collector_task and not collector_task.done() else "stopped"
            session_stats = collector_instance.stats if collector_instance else {}
            payload = {
                "status": "healthy",
                "database": "connected",
                "collector": collector_status,
                "stats": {
                    "messages_total": row['total'],
                    "messages_24h": row['last_24h'],
                    "messages_this_session": session_stats.get('messages_received', 0),
                    "messages_dropped": session_stats.get('messages_dropped', 0),
                    "last_message": row['last_message'].isoformat() if row['last_message'] else None
                }
            }
            _acars_health_cache.update(ts=now, ok=True, payload=payload, err=None)
        except asyncio.TimeoutError:
            _acars_health_cache.update(ts=now, ok=False, payload=None,
                                       err="Database pool acquisition timeout")
        except Exception as e:
            _acars_health_cache.update(ts=now, ok=False, payload=None, err=str(e))

    if not _acars_health_cache["ok"]:
        raise HTTPException(status_code=503,
                            detail=f"Service unhealthy: {_acars_health_cache['err']}")
    return _acars_health_cache["payload"]


@app.get("/messages/recent")
async def get_recent_messages(
    minutes: int = Query(30, ge=1, le=1440, description="Time window in minutes"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum messages to return"),
    flight: Optional[str] = Query(None, description="Filter by flight number"),
    label: Optional[str] = Query(None, description="Filter by message label")
):
    """Get recent ACARS messages."""
    start = datetime.now(timezone.utc) - timedelta(minutes=minutes)

    filters = ["time >= $1"]
    params = [start]
    param_idx = 1

    if flight:
        param_idx += 1
        filters.append(f"flight ILIKE ${param_idx}")
        params.append(f"%{flight}%")

    if label:
        param_idx += 1
        filters.append(f"label = ${param_idx}")
        params.append(label)

    query = f"""
        SELECT time, flight, reg, icao, label, block_id, msg_num, text,
               freq, level, error, mode, station_id,
               dsta, eta, gtout, gtin, wloff, wlin, lat, lon, alt
        FROM acars_messages
        WHERE {' AND '.join(filters)}
        ORDER BY time DESC
        LIMIT ${param_idx + 1}
    """
    params.append(limit)

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            rows = await conn.fetch(query, *params)

        return {
            "count": len(rows),
            "time_range": {
                "start": start.isoformat(),
                "end": datetime.now(timezone.utc).isoformat()
            },
            "messages": [
                {
                    "time": row['time'].isoformat(),
                    "flight": row['flight'],
                    "reg": row['reg'],
                    "icao": row['icao'],
                    "label": row['label'],
                    "block_id": row['block_id'],
                    "msg_num": row['msg_num'],
                    "text": row['text'],
                    "freq": row['freq'],
                    "level": row['level'],
                    "error": row['error'],
                    "mode": row['mode'],
                    "station_id": row['station_id'],
                    "destination": row['dsta'],
                    "eta": row['eta'],
                    "gtout": row['gtout'],
                    "wloff": row['wloff'],
                    "wlin": row['wlin'],
                    "gtin": row['gtin'],
                    "position": {
                        "lat": row['lat'],
                        "lon": row['lon'],
                        "alt": row['alt']
                    } if row['lat'] and row['lon'] else None
                }
                for row in rows
            ]
        }

    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Database pool acquisition timeout")
    except Exception as e:
        logger.error(f"Error fetching recent messages: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/messages/flight/{flight}")
async def get_messages_by_flight(
    flight: str,
    hours: int = Query(24, ge=1, le=168, description="Time window in hours"),
    limit: int = Query(50, ge=1, le=500)
):
    """Get ACARS messages for a specific flight."""
    start = datetime.now(timezone.utc) - timedelta(hours=hours)

    query = """
        SELECT time, flight, reg, icao, label, text, freq, level, mode,
               dsta, eta, gtout, gtin, wloff, wlin, lat, lon, alt
        FROM acars_messages
        WHERE flight ILIKE $1 AND time >= $2
        ORDER BY time DESC
        LIMIT $3
    """

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            rows = await conn.fetch(query, f"%{flight}%", start, limit)

        return {
            "flight": flight,
            "count": len(rows),
            "messages": [
                {
                    "time": row['time'].isoformat(),
                    "flight": row['flight'],
                    "reg": row['reg'],
                    "icao": row['icao'],
                    "label": row['label'],
                    "text": row['text'],
                    "freq": row['freq'],
                    "level": row['level'],
                    "mode": row['mode'],
                    "oooi": {
                        "destination": row['dsta'],
                        "eta": row['eta'],
                        "gate_out": row['gtout'],
                        "gate_in": row['gtin'],
                        "wheels_off": row['wloff'],
                        "wheels_on": row['wlin']
                    },
                    "position": {
                        "lat": row['lat'],
                        "lon": row['lon'],
                        "alt": row['alt']
                    } if row['lat'] and row['lon'] else None
                }
                for row in rows
            ]
        }

    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Database pool acquisition timeout")
    except Exception as e:
        logger.error(f"Error fetching messages for flight {flight}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/messages/aircraft/{identifier}")
async def get_messages_by_aircraft(
    identifier: str,
    hours: int = Query(24, ge=1, le=168),
    limit: int = Query(50, ge=1, le=500)
):
    """
    Get ACARS messages for a specific aircraft.
    Identifier can be ICAO hex code or registration.
    """
    start = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Try matching both icao and registration
    query = """
        SELECT time, flight, reg, icao, label, text, freq, level, mode,
               dsta, eta, lat, lon, alt
        FROM acars_messages
        WHERE (icao ILIKE $1 OR reg ILIKE $1) AND time >= $2
        ORDER BY time DESC
        LIMIT $3
    """

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            rows = await conn.fetch(query, f"%{identifier}%", start, limit)

        return {
            "identifier": identifier,
            "count": len(rows),
            "messages": [
                {
                    "time": row['time'].isoformat(),
                    "flight": row['flight'],
                    "reg": row['reg'],
                    "icao": row['icao'],
                    "label": row['label'],
                    "text": row['text'],
                    "freq": row['freq'],
                    "level": row['level'],
                    "mode": row['mode'],
                    "destination": row['dsta'],
                    "eta": row['eta'],
                    "position": {
                        "lat": row['lat'],
                        "lon": row['lon'],
                        "alt": row['alt']
                    } if row['lat'] and row['lon'] else None
                }
                for row in rows
            ]
        }

    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Database pool acquisition timeout")
    except Exception as e:
        logger.error(f"Error fetching messages for aircraft {identifier}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats")
async def get_stats(days: int = Query(7, ge=1, le=30)):
    """Get ACARS message statistics."""
    start = datetime.now(timezone.utc) - timedelta(days=days)

    queries = {
        'summary': """
            SELECT
                COUNT(*) as total_messages,
                COUNT(DISTINCT flight) as unique_flights,
                COUNT(DISTINCT reg) as unique_aircraft,
                MIN(time) as first_message,
                MAX(time) as last_message
            FROM acars_messages
            WHERE time >= $1
        """,
        'by_label': """
            SELECT label, COUNT(*) as count
            FROM acars_messages
            WHERE time >= $1 AND label IS NOT NULL
            GROUP BY label
            ORDER BY count DESC
            LIMIT 20
        """,
        'by_hour': """
            SELECT
                EXTRACT(HOUR FROM time) as hour,
                COUNT(*) as count
            FROM acars_messages
            WHERE time >= $1
            GROUP BY EXTRACT(HOUR FROM time)
            ORDER BY hour
        """,
        'top_flights': """
            SELECT flight, COUNT(*) as message_count
            FROM acars_messages
            WHERE time >= $1 AND flight IS NOT NULL
            GROUP BY flight
            ORDER BY message_count DESC
            LIMIT 10
        """
    }

    try:
        async with db_pool.acquire(timeout=DB_ACQUIRE_TIMEOUT) as conn:
            summary = await conn.fetchrow(queries['summary'], start)
            by_label = await conn.fetch(queries['by_label'], start)
            by_hour = await conn.fetch(queries['by_hour'], start)
            top_flights = await conn.fetch(queries['top_flights'], start)

        return {
            "period_days": days,
            "summary": {
                "total_messages": summary['total_messages'],
                "unique_flights": summary['unique_flights'],
                "unique_aircraft": summary['unique_aircraft'],
                "first_message": summary['first_message'].isoformat() if summary['first_message'] else None,
                "last_message": summary['last_message'].isoformat() if summary['last_message'] else None
            },
            "by_label": [
                {"label": row['label'], "count": row['count']}
                for row in by_label
            ],
            "by_hour": [
                {"hour": int(row['hour']), "count": row['count']}
                for row in by_hour
            ],
            "top_flights": [
                {"flight": row['flight'], "messages": row['message_count']}
                for row in top_flights
            ],
            "collector": collector_instance.stats if collector_instance else {}
        }

    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Database pool acquisition timeout")
    except Exception as e:
        logger.error(f"Error fetching stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/labels")
async def get_label_descriptions():
    """Get ACARS label descriptions."""
    # Standard ACARS label descriptions
    return {
        "labels": {
            "H1": "Message to/from operations",
            "5U": "Weather request",
            "5Z": "Squawk code assignment",
            "10": "PIREP (Pilot Report)",
            "12": "ATIS (Automatic Terminal Information)",
            "15": "Ground handling",
            "16": "Departure/arrival info",
            "17": "Runway surface conditions",
            "20": "NOTAM (Notice to Airmen)",
            "21": "Weather data",
            "22": "METAR/TAF",
            "23": "Winds aloft",
            "24": "SIGMET/AIRMET",
            "26": "Flight plan modification",
            "30": "Gate assignment",
            "40": "Connecting flight info",
            "44": "Boarding info",
            "80": "Crew scheduling",
            "83": "Fuel request",
            "Q0": "OOOI (Out, Off, On, In)",
            "QA": "ETA report",
            "QB": "OFF report",
            "QC": "ON report",
            "QD": "IN report",
            "QE": "OUT report",
            "QF": "Wheels off",
            "QG": "Wheels on",
            "QH": "Position report",
            "QK": "Block time report",
            "QL": "Arrival estimate",
            "QM": "Flight phase report",
            "QN": "Fuel remaining",
            "QP": "ETA update",
            "QQ": "Full OOOI report",
            "QR": "Diversion report",
            "QS": "Emergency report",
            "SA": "Departure clearance",
            "SQ": "Squawk assignment",
            "_d": "Free text downlink",
            "BA": "Beacon alert",
            "B1": "Request clearance",
            "B2": "Clearance acceptance",
            "B3": "Clearance rejected",
            "B6": "Departure request",
            "C1": "Position",
            "RA": "Engine data",
            "A0": "ADS-C periodic report"
        }
    }


# ============================================================================
# WEBSOCKET ENDPOINT
# ============================================================================

def _hub_status_payload() -> dict:
    """
    Connection state + last-message age, surfaced on every WS frame.
    Lets the frontend distinguish "service is up but acarshub is silent"
    from "service is up and messages are flowing".
    """
    last_ms = collector_instance.stats.get('last_message_time') if collector_instance else None
    last_message_age_s = None
    if last_ms is not None:
        last_message_age_s = round((datetime.now(timezone.utc) - last_ms).total_seconds(), 1)
    return {
        "hub_connected": bool(collector_instance and collector_instance.hub_connected),
        "last_message_age_s": last_message_age_s,
        "messages_received": collector_instance.stats.get('messages_received', 0) if collector_instance else 0,
    }


async def _heartbeat_loop():
    """Push a status frame to every WS subscriber every 5 seconds."""
    while True:
        try:
            await asyncio.sleep(5)
            if ws_manager.active_connections:
                await ws_manager.broadcast({"type": "heartbeat", **_hub_status_payload()})
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug(f"heartbeat tick failed: {e}")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time ACARS message streaming.

    Clients connect here to receive new messages as they arrive.
    Messages are broadcast in JSON format with type 'new_message'.
    """
    await ws_manager.connect(websocket)
    try:
        # Send a welcome message with current connection count + hub state
        # so a freshly-connected client immediately knows whether to expect
        # data or to show "no data yet" without waiting for a heartbeat.
        await websocket.send_json({
            "type": "connected",
            "message": "Connected to ACARS stream",
            "clients": len(ws_manager.active_connections),
            **_hub_status_payload(),
        })

        # Keep connection alive - just wait for disconnect
        while True:
            try:
                # Wait for any incoming message (ping/pong or close)
                data = await websocket.receive_text()
                # Handle ping/pong for connection keepalive
                if data == "ping":
                    await websocket.send_text("pong")
            except WebSocketDisconnect:
                break
            except Exception:
                break
    finally:
        ws_manager.disconnect(websocket)


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
