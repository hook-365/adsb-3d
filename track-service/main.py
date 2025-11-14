#!/usr/bin/env python3
"""
ADS-B Track Service
Combined collector + API service for historical aircraft track data
- Background task: Polls feeder every 5 seconds, writes to TimescaleDB
- REST API: FastAPI endpoints for historical track queries
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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

# Shared database pool (used by both collector and API)
db_pool = None

# Background collector task
collector_instance = None
collector_task = None


def ensure_utc(dt: datetime) -> datetime:
    """Ensure datetime object is timezone-aware (UTC)"""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def run_database_migrations(db_pool):
    """
    Run automatic database migrations on startup.
    Enables compression for existing deployments that upgrade.
    """
    logger.info("=" * 60)
    logger.info("Running database migrations...")
    logger.info("=" * 60)

    try:
        async with db_pool.acquire() as conn:
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

        logger.info(f"Collector initialized: {self.ultrafeeder_url} (interval: {self.collection_interval}s)")

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
                        db_data = json.loads(content)

                        # Extract only military aircraft (flag "10")
                        military_db = {}
                        for icao_hex, aircraft_info in db_data.items():
                            if len(aircraft_info) >= 3 and aircraft_info[2] == "10":
                                military_db[icao_hex.upper()] = {
                                    "tail": aircraft_info[0],
                                    "type": aircraft_info[1],
                                    "flag": aircraft_info[2],
                                    "description": aircraft_info[3] if len(aircraft_info) > 3 else ""
                                }

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
        """Fetch current aircraft data from feeder"""
        try:
            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(f"{self.ultrafeeder_url}/data/aircraft.json") as resp:
                    if resp.status == 200:
                        return await resp.json()
                    else:
                        logger.warning(f"HTTP {resp.status} from feeder")
                        return None
        except asyncio.TimeoutError:
            logger.warning("Timeout fetching aircraft data")
            return None
        except Exception as e:
            logger.error(f"Error fetching aircraft data: {e}")
            return None

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
                aircraft.get('alt_baro'),
                aircraft.get('alt_geom'),
                aircraft.get('gs'),
                aircraft.get('track'),
                aircraft.get('baro_rate'),
                aircraft.get('squawk'),
                aircraft.get('emergency'),
                aircraft.get('category'),
                aircraft.get('nav_altitude_mcp'),
                aircraft.get('rssi'),
                aircraft.get('messages'),
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
            async with self.db_pool.acquire() as conn:
                # Batch insert positions
                await conn.executemany('''
                    INSERT INTO aircraft_positions
                    (time, icao, flight, lat, lon, alt_baro, alt_geom, gs, track,
                     baro_rate, squawk, emergency, category, nav_altitude_mcp,
                     rssi, messages, seen)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                ''', positions)

                # Upsert metadata
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
        last_db_refresh = datetime.utcnow()

        while self.running:
            try:
                # Refresh military database every 24 hours
                if datetime.utcnow() - last_db_refresh > timedelta(hours=24):
                    logger.info("24 hours elapsed, refreshing military database...")
                    await self.load_military_database()
                    last_db_refresh = datetime.utcnow()

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
        """Start the collector"""
        try:
            # Load military aircraft database
            await self.load_military_database()

            await self.collect_loop()
        except Exception as e:
            logger.error(f"Collector fatal error: {e}", exc_info=True)

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
        # Create shared database pool
        db_pool = await asyncpg.create_pool(
            **DB_CONFIG,
            min_size=2,
            max_size=20,
            command_timeout=60
        )
        logger.info(f"Database pool created: {DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['database']}")

        # Test connection
        async with db_pool.acquire() as conn:
            version = await conn.fetchval('SELECT version()')
            logger.info(f"Connected to: {version}")

        # Run database migrations (compression, schema updates)
        await run_database_migrations(db_pool)

        # Start background collector
        collector_instance = AircraftTrackCollector(db_pool)
        collector_task = asyncio.create_task(collector_instance.run())
        logger.info("Background collector started")

    except Exception as e:
        logger.error(f"Failed to start service: {e}")
        raise


@app.on_event("shutdown")
async def shutdown():
    """Stop collector and close database connection pool"""
    global db_pool, collector_instance, collector_task

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

    # Close database pool
    if db_pool:
        await db_pool.close()
        logger.info("Database pool closed")


# ============================================================================
# REST API ENDPOINTS
# ============================================================================

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


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        async with db_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")

        collector_status = "running" if collector_instance and collector_instance.running else "stopped"

        return {
            "status": "healthy",
            "database": "connected",
            "collector": collector_status
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")


@app.get("/tracks/{icao}")
async def get_aircraft_track(
    icao: str,
    start: Optional[datetime] = Query(None, description="Start time (UTC)"),
    end: Optional[datetime] = Query(None, description="End time (UTC)"),
    resolution: str = Query("full", regex="^(full|1min|5min)$", description="Data resolution")
):
    """
    Get historical track for specific aircraft by ICAO code.

    - **icao**: Aircraft ICAO 24-bit address (hex)
    - **start**: Start timestamp (defaults to 24 hours ago)
    - **end**: End timestamp (defaults to now)
    - **resolution**: Data resolution (full, 1min, 5min)
    """
    # Default to last 24 hours if no time range specified
    if not end:
        end = datetime.now(timezone.utc)
    else:
        end = ensure_utc(end)
    if not start:
        start = end - timedelta(hours=24)
    else:
        start = ensure_utc(start)

    # Choose appropriate table based on time range and resolution
    time_range = end - start
    if resolution == "5min" or time_range > timedelta(days=30):
        table = "aircraft_tracks_5min"
        time_col = "bucket"
    elif resolution == "1min" or time_range > timedelta(days=7):
        table = "aircraft_tracks_1min"
        time_col = "bucket"
    else:
        table = "aircraft_positions"
        time_col = "time"

    query = f"""
        SELECT {time_col} as time, lat, lon, alt_baro, gs, track, flight
        FROM {table}
        WHERE icao = $1 AND {time_col} BETWEEN $2 AND $3
        ORDER BY {time_col}
    """

    try:
        async with db_pool.acquire() as conn:
            rows = await conn.fetch(query, icao.lower(), start, end)

        positions = [
            {
                "time": row['time'].isoformat(),
                "lat": float(row['lat']),
                "lon": float(row['lon']),
                "alt_baro": row['alt_baro'],
                "gs": float(row['gs']) if row['gs'] else None,
                "track": float(row['track']) if row['track'] else None,
                "flight": row['flight']
            }
            for row in rows
        ]

        return {
            "icao": icao.lower(),
            "start": start.isoformat(),
            "end": end.isoformat(),
            "resolution": resolution,
            "positions": positions
        }

    except Exception as e:
        logger.error(f"Error fetching track for {icao}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tracks/bulk/timelapse")
async def get_bulk_tracks_timelapse(
    start: datetime = Query(..., description="Start time (UTC)"),
    end: datetime = Query(..., description="End time (UTC)"),
    resolution: str = Query("5min", regex="^(full|1min|5min)$"),
    max_tracks: int = Query(500, le=10000, description="Maximum aircraft to return"),
    min_altitude: Optional[int] = Query(None, description="Minimum altitude filter (feet)"),
    max_altitude: Optional[int] = Query(None, description="Maximum altitude filter (feet)"),
    military_only: bool = Query(False, description="Filter to only military aircraft")
):
    """
    Get bulk tracks for time-lapse visualization.

    Returns all aircraft tracks within time window, optimized for 3D rendering.
    """
    # Ensure UTC timezone awareness
    start = ensure_utc(start)
    end = ensure_utc(end)

    logger.info(f"Query time range: start={start}, end={end} (UTC)")

    # Choose appropriate table based on resolution and time range
    time_range = end - start

    # If user explicitly requested full resolution, honor it regardless of time range
    if resolution == "full":
        table = "aircraft_positions"
        time_col = "time"
    elif resolution == "5min" or (resolution == "auto" and time_range > timedelta(days=7)):
        table = "aircraft_tracks_5min"
        time_col = "bucket"
    elif resolution == "1min" or (resolution == "auto" and time_range > timedelta(days=2)):
        table = "aircraft_tracks_1min"
        time_col = "bucket"
    else:
        # Default to full resolution for short queries
        table = "aircraft_positions"
        time_col = "time"

    # Build filters
    filters = [f"{time_col} BETWEEN $1 AND $2"]
    params = [start, end]
    param_idx = 2

    if min_altitude is not None:
        param_idx += 1
        filters.append(f"alt_baro >= ${param_idx}")
        params.append(min_altitude)

    if max_altitude is not None:
        param_idx += 1
        filters.append(f"alt_baro <= ${param_idx}")
        params.append(max_altitude)

    # Add military filter to ranked_aircraft CTE
    military_join = ""
    military_where = ""
    if military_only:
        military_join = "LEFT JOIN aircraft_metadata m_filter ON t.icao = m_filter.icao"
        military_where = "AND (m_filter.is_military = true OR m_filter.is_military IS NULL)"

    # Query with LIMIT for top N most active aircraft
    query = f"""
        WITH ranked_aircraft AS (
            SELECT t.icao, COUNT(*) as position_count
            FROM {table} t
            {military_join}
            WHERE {' AND '.join(filters)} {military_where}
            GROUP BY t.icao
            ORDER BY position_count DESC
            LIMIT ${param_idx + 1}
        )
        SELECT
            p.{time_col} as time,
            p.icao,
            p.flight,
            p.lat,
            p.lon,
            p.alt_baro,
            p.gs,
            p.track,
            m.aircraft_type,
            m.registration,
            m.type_description,
            COALESCE(m.is_military, false) as is_military
        FROM {table} p
        JOIN ranked_aircraft r ON p.icao = r.icao
        LEFT JOIN aircraft_metadata m ON p.icao = m.icao
        WHERE {' AND '.join(filters)}
        ORDER BY p.icao, p.{time_col}
    """

    params.append(max_tracks)

    logger.info(f"Querying {table} with filters: {filters}")
    logger.info(f"Parameters: {params}")

    try:
        async with db_pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            logger.info(f"Query returned {len(rows)} rows")

        # Group by aircraft for efficient frontend rendering
        tracks_by_aircraft = {}
        for row in rows:
            icao = row['icao']
            if icao not in tracks_by_aircraft:
                tracks_by_aircraft[icao] = {
                    'icao': icao,
                    'flight': row['flight'],
                    'aircraft_type': row['aircraft_type'],
                    'registration': row['registration'],
                    'type_description': row['type_description'],
                    'is_military': row['is_military'],
                    'positions': []
                }

            tracks_by_aircraft[icao]['positions'].append({
                'time': row['time'].isoformat(),
                'lat': float(row['lat']),
                'lon': float(row['lon']),
                'alt': row['alt_baro'],
                'gs': float(row['gs']) if row['gs'] else None,
                'track': float(row['track']) if row['track'] else None
            })

        return {
            'time_range': {
                'start': start.isoformat(),
                'end': end.isoformat(),
                'resolution': resolution
            },
            'stats': {
                'unique_aircraft': len(tracks_by_aircraft),
                'total_positions': len(rows),
                'time_span_hours': (end - start).total_seconds() / 3600
            },
            'tracks': list(tracks_by_aircraft.values())
        }

    except Exception as e:
        logger.error(f"Error fetching bulk tracks: {e}")
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
        async with db_pool.acquire() as conn:
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
        async with db_pool.acquire() as conn:
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
        async with db_pool.acquire() as conn:
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
        async with db_pool.acquire() as conn:
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
        async with db_pool.acquire() as conn:
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
        async with db_pool.acquire() as conn:
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
        async with db_pool.acquire() as conn:
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
        async with db_pool.acquire() as conn:
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


@app.get("/query")
async def custom_query(
    sql: str = Query(..., description="SQL query to execute (SELECT only)"),
    limit: int = Query(100, le=1000, description="Maximum rows to return")
):
    """
    Execute a custom SQL query (SELECT only, read-only).

    **WARNING**: This endpoint is for LAN use only. Queries are limited to SELECT statements.
    """
    # Security: Only allow SELECT queries
    sql_upper = sql.strip().upper()
    if not sql_upper.startswith('SELECT'):
        raise HTTPException(status_code=400, detail="Only SELECT queries are allowed")

    # Block dangerous keywords
    dangerous = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE', 'GRANT', 'REVOKE']
    for keyword in dangerous:
        if keyword in sql_upper:
            raise HTTPException(status_code=400, detail=f"Keyword '{keyword}' is not allowed")

    # Add LIMIT if not present
    if 'LIMIT' not in sql_upper:
        sql = f"{sql.rstrip(';')} LIMIT {limit}"

    try:
        async with db_pool.acquire() as conn:
            rows = await conn.fetch(sql)

        # Convert to list of dicts
        results = []
        for row in rows:
            result = {}
            for key in row.keys():
                value = row[key]
                # Convert datetime to ISO string
                if isinstance(value, datetime):
                    result[key] = value.isoformat()
                else:
                    result[key] = value
            results.append(result)

        return {
            'query': sql,
            'row_count': len(results),
            'results': results
        }

    except Exception as e:
        logger.error(f"Error executing custom query: {e}")
        raise HTTPException(status_code=400, detail=f"Query error: {str(e)}")


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
