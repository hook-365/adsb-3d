# ADS-B Track Service

Combined collector + REST API service for historical aircraft track data.

## Components

**Background Collector:**
- Polls feeder every 5 seconds for current aircraft data
- Stores positions in TimescaleDB
- Maintains aircraft metadata (type, registration, operator)
- Updates military aircraft database from tar1090-db (24h cache)

**REST API (FastAPI):**
- `/health` - Health check (database + collector status)
- `/tracks/{icao}` - Get track for specific aircraft
- `/tracks/bulk/timelapse` - Bulk tracks for 3D visualization
- `/aircraft/unique` - Unique aircraft statistics
- `/aircraft/metadata/bulk` - Bulk metadata lookup by ICAO hex list
- `/heatmap` - Aircraft-density heatmap over a time window
- `/stats/summary` - Summary statistics
- `/stats/rarity` - Aircraft rarity breakdown by total sightings
- `/stats/aircraft-types` - Statistics grouped by aircraft type
- `/stats/military` - Military vs civilian breakdown and top military aircraft
- `/stats/records` - Highest altitude and fastest groundspeed records
- `/stats/time-analysis` - Time-of-day and day-of-week traffic patterns
- `/stats/database` - Database size and TimescaleDB compression stats
- `/route/{callsign}` - Single callsign → origin/destination route lookup
- `/route/batch` - Batch callsign → route lookup
- `/docs` - Swagger API documentation

**WebSocket:**
- `WebSocket /ws/live` - Primary live-data path. On connect the server
  sends a `{type: "snapshot", now, feeder_age_s, aircraft: [...]}` frame
  with all currently-tracked aircraft. Subsequent per-tick frames are
  `{type: "diff", now, feeder_age_s, added, updated, removed}`. Every 5
  ticks (~5 s) all still-present aircraft are re-broadcast as `updated`
  (heartbeat) to keep client-side `seen`/`lastSeenMs` fresh for stationary
  aircraft. `feeder_age_s` is seconds since the last successful upstream
  feeder fetch (or `null` on first connect before any fetch completes);
  clients use it to detect a dead upstream readsb while the track-service
  itself is still healthy. The frontend connects here first and falls back
  to polling `/data/aircraft.json` directly if the socket cannot be
  established.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FEEDER_URL` | `http://ultrafeeder` | ADS-B feeder URL |
| `DB_HOST` | `timescaledb-adsb` | Database hostname |
| `DB_PORT` | `5432` | Database port |
| `DB_NAME` | `adsb_tracks` | Database name |
| `DB_USER` | `adsb` | Database user |
| `DB_PASSWORD` | - | Database password |
| `COLLECTION_INTERVAL` | `5` | Polling interval (seconds) |
| `RETENTION_DAYS` | `90` | Delete positions older than this many days |

## API Endpoints

### Health Check
```
GET /health
```
Returns `{status, database, collector}`. Result is cached for 1 s so frequent
Docker health-check probes do not hit the pool on every call.

### Single Aircraft Track
```
GET /tracks/{icao}?start=<ISO>&end=<ISO>&resolution=full|Ns
```
Historical positions for one ICAO hex. `resolution=full` returns every sample;
`resolution=Ns` (e.g. `15s`, `300s`) applies a server-side `time_bucket`
average. Default window: last 24 h.

Response: `{icao, start, end, resolution, positions: [{time, lat, lon, alt_baro, alt_geom}]}`

### Bulk Timelapse Tracks
```
GET /tracks/bulk/timelapse?start=<ISO>&end=<ISO>&resolution=full|Ns
    &max_tracks=500&min_altitude=&max_altitude=&military_only=false
    &hexes=abc123,def456
```
Bulk track data for many aircraft in one round trip. Pass `hexes` to scope to
specific aircraft; without it, returns the top-N most active in the window.

Response: `{time_range: {start, end, resolution}, stats: {unique_aircraft, total_positions, time_span_hours}, tracks: [{icao, positions: [{time, lat, lon, alt_baro, alt_geom, flight, gs, track, category}]}]}`

### Bulk Metadata Lookup
```
POST /aircraft/metadata/bulk
Content-Type: application/json

{"hexes": ["abc123", "def456", ...]}  # up to 1000 hexes
```
Enriches position-only timelapse responses with registration, type, operator,
and military flag. Hexes not present in the metadata table are silently omitted.

Response: `{results: {<hex>: {registration, aircraft_type, type_description, owner_operator, is_military}}}`

### Unique Aircraft
```
GET /aircraft/unique?start=<ISO>&end=<ISO>&min_sightings=1
```
Aircraft seen during the period, ordered by days seen. Default: last 30 days,
limit 200 results.

### Heatmap
```
GET /heatmap?start=<ISO>&end=<ISO>&cell=0.01&bbox=lat0,lon0,lat1,lon1
    &min_altitude=&max_altitude=&military_only=false
```
Aircraft-density heatmap over a time window. Each cell in the response
represents one grid square (size = `cell` degrees); `count` is the number of
unique ICAO hexes that passed through it. Cells with zero touches are omitted.
`bbox` restricts the result to a viewport — strongly recommended for long
windows to keep response sizes manageable.

Response: `{time_range: {start, end}, cell_deg: 0.01, cells: [{lat, lon, count}]}`

### Summary Statistics
```
GET /stats/summary?days=7
```
Unique aircraft count, total positions, altitude averages, and first/last
position timestamps for the requested window (1–90 days).

### Rarity Statistics
```
GET /stats/rarity
```
Breaks down the aircraft_metadata table by total sightings into six
rarity buckets (extremely_rare ≤10, very_rare ≤50, rare ≤100, uncommon ≤500,
common ≤1000, very_common >1000) with up to 10 example aircraft per bucket.

Response: `{summary: {extremely_rare, very_rare, rare, uncommon, common, very_common, total}, examples: {<bucket>: [{icao, registration, aircraft_type, type_description, sightings}]}}`

### Aircraft-Type Statistics
```
GET /stats/aircraft-types?limit=50
```
Counts, total sightings, average sightings per aircraft, and military count
grouped by ICAO type code. `limit` is 1–200 (default 50).

Response array: `[{type, description, aircraft_count, total_sightings, avg_sightings, military_count}]`

### Military Statistics
```
GET /stats/military
```
Military vs civilian breakdown from aircraft_metadata, plus the top 20
most-sighted military aircraft.

Response: `{summary: {military, civilian, total, military_percentage}, top_military: [{icao, registration, type, description, sightings, last_seen}]}`

### Records
```
GET /stats/records?days=30
```
Highest baro altitude (feet) and fastest groundspeed (knots) seen in the
requested window (1–365 days), with aircraft identification details.

Response: `{period_days, records: {highest_altitude: {icao, registration, type, description, value, unit, time, flight}, fastest_groundspeed: {...}}}`

### Time-of-Day / Day-of-Week Analysis
```
GET /stats/time-analysis?days=7
```
Traffic patterns by UTC hour and day of week (1–90 days). Useful for spotting
peak activity windows.

Response: `{period_days, by_hour: [{hour, unique_aircraft, positions}], by_day_of_week: [{day, day_num, unique_aircraft, positions}]}`

### Database Statistics
```
GET /stats/database
```
Live database size, per-table sizes, TimescaleDB compression status (enabled,
total chunks, compressed chunks, ratio), and row counts for both tables.

Response: `{database_size, tables: [{schema, table, size}], compression: {enabled, total_chunks, compressed_chunks, compression_ratio}, row_counts: {aircraft_positions, aircraft_metadata}}`

### Single Route Lookup
```
GET /route/{callsign}
```
Resolves one callsign to an origin/destination airport pair via the adsb.im
routeset API. Results are cached in memory (1 h for positive, 5 min for
negative). Sets `Cache-Control` and `ETag` response headers so the browser
HTTP cache absorbs reloads; returns `304 Not Modified` when the ETag matches.

Response: `{callsign, origin, destination, origin_name, destination_name, origin_icao, destination_icao, plausible, source: "adsb.im"}`

### Batch Route Lookup
```
POST /route/batch
Content-Type: application/json

{"callsigns": ["AAL1690", "UAL432", ...]}  # up to 100 callsigns
```
Batch callsign → origin/destination lookup via adsb.im. Cache hits are
returned immediately; misses are fetched from adsb.im in a single request.
A circuit breaker opens for 120 s after 5 consecutive upstream failures.

Response: `{results: {<callsign>: {callsign, origin, destination, ...}}, cached_count, fetched_count}`

## Architecture

```
FastAPI Server (port 8000)
    │
    ├─► Background Task: WS Broadcast Loop (1 Hz)
    │   └─► Fetches FEEDER_URL → publishes to WS clients
    │       └─► Shares snapshot → Collector reads without re-fetching
    │
    ├─► Background Task: Collector Loop (every 5s)
    │   └─► Samples shared feeder snapshot → Writes to TimescaleDB
    │
    └─► REST Endpoints
        └─► Query TimescaleDB → Return JSON
```

## Build & Run

```bash
# Build image
docker build -t adsb-track-service .

# Run container
docker run -d \
  -p 8000:8000 \
  -e FEEDER_URL=http://ultrafeeder \
  -e DB_HOST=timescaledb-adsb \
  -e DB_PASSWORD=your_password \
  adsb-track-service
```

## Shared Database Pool

Both the collector and API use a single `asyncpg` connection pool (2-20 connections) for efficiency.

## Graceful Shutdown

When the container stops:
1. Collector receives stop signal
2. Collector completes current cycle
3. Database pool closes cleanly

## Credits

- **Mictronics readsb-protobuf**: Military aircraft database (GPL-3.0)
  - Source: https://github.com/Mictronics/readsb-protobuf
  - Database file: `webapp/src/db/aircrafts.json`
