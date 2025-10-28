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
- `/stats/summary` - Summary statistics
- `/docs` - Swagger API documentation

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

## Architecture

```
FastAPI Server (port 8000)
    │
    ├─► Background Task: Collector Loop (every 5s)
    │   └─► Polls FEEDER_URL → Writes to TimescaleDB
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
