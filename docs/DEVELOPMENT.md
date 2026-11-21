# Architecture and development

## Architecture

```
                ┌──────── browser ────────┐
                │  Vite/TS Three.js app   │
                └───────────┬─────────────┘
                            │
                       nginx (port 80)
                            │
      ┌──────────┬──────────┼──────────┬──────────────┬───────────────┐
      │          │          │          │              │               │
   /data/...  /api/...   /ws/...  /api/feeds/N/...  /acars-api/   /weather-api/
      │          │          │          │              │               │
 ultrafeeder  track-service │   remote adsb-3d   acars-service  weather-service
                  │             instance (slot N)                 (NOAA MRMS)
                  ▼
            TimescaleDB
       (aircraft_positions
        + aircraft_metadata
        + acars_messages)
```

- **`frontend/`**: Vite + TypeScript + Three.js viewer, no framework.
- **`track-service/`**: FastAPI + asyncpg; a live WebSocket diff stream
  plus a TimescaleDB history collector.
- **`acars-service/`**: FastAPI bridge to an acarshub TCP feed.
- **`weather-service/`**: FastAPI sidecar that downloads NOAA MRMS 3D
  reflectivity once and serves a small volume cropped around each feed.
- **`nginx/`**: reverse proxy + static host; `entrypoint.sh` renders the
  config (including per-feed proxy blocks) from env vars at start.

See [CLAUDE.md](../CLAUDE.md) for a deeper architecture orientation.

## Development

```sh
cd frontend
npm install
npm run dev         # Vite dev server
npm run typecheck   # tsc, strict
npm run test        # Vitest
npm run build       # → dist/
```

`npm run dev` proxies backend routes to `http://localhost:8080`; override
with `DEV_BACKEND`.

Several data files in the frontend are generated from public sources and
committed, so the running container never fetches them. Regenerate with
the matching script (Python 3, standard library only) and commit the
result:

| Script | Writes | Source | When |
|---|---|---|---|
| `scripts/build-airspace.py` | `frontend/src/world/airspace-data.json` | FAA ADDS Class Airspace and Special Use Airspace | When a chart cycle changes airspace |
| `scripts/build-cities.py` | `frontend/src/feed/explore-cities.json` | GeoNames `cities15000` (CC BY 4.0) | Rarely |
| `scripts/build-airports.py` | `frontend/src/feed/explore-airports.json` | OurAirports `airports.csv` (public domain) | When airports or codes change |
| `scripts/build-runways.py` | `frontend/src/world/runways-data.json` | OurAirports `runways.csv` (public domain) | After `build-airports.py`, or when runways change |
| `scripts/build-frequencies.py` | `frontend/src/world/frequencies-data.json` | OurAirports `airport-frequencies.csv` (public domain) | With the runways |
| `scripts/build-artcc.py` | `frontend/src/world/artcc-data.json` | FAA open data, Airspace Boundary (public domain) | Rarely; with the airspace file |
| `scripts/build-refueling.py` | `frontend/src/world/refueling-data.json` | tar1090's `US_A2A_refueling.geojson` (GPL v2+) | Rarely |
| `scripts/build-airport-ground.py` | `frontend/src/world/airport-ground-index.json`, `airport-ground.pack` | OpenStreetMap through the Overpass API (ODbL) | Occasionally. Slow: the public Overpass servers are often busy, so it retries and resumes from `.cache/` |
| `scripts/build-procedures.py` | `frontend/src/world/procedures-index.json`, `procedures.pack` | FAA CIFP (not copyrighted) | Every 28 days, when a new edition is effective |
| `scripts/build-navdata.py` | `frontend/src/world/navdata.json` | FAA CIFP (not copyrighted) | With `build-procedures.py` |
| `scripts/refresh-cifp.py` | runs the two above from one download | FAA CIFP | Before a release. Running containers run the same script daily for themselves (`ENABLE_DATA_REFRESH`) |

To run the full container against an existing backend:

```sh
docker compose -f docker-compose.dev.yml --project-directory . up --build -d
# → http://localhost:8186/
```

---

Back to the [README](../README.md) or the [documentation index](README.md).
