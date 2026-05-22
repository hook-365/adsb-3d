# ADS-B 3D

Real-time 3D visualization of ADS-B aircraft, with historical playback,
3D airway-density heatmaps, and optional ACARS message decoding. One
Docker image: it serves the viewer and reverse-proxies your existing
ADS-B feeder.

Works with anything that publishes readsb's `aircraft.json` — tar1090,
ultrafeeder, dump1090-fa, readsb-protobuf, and so on.

**[Live demo →](https://adsb3d.hook.technology)** — explore a running instance in your browser.

> [!WARNING]
> **Ran the older monolithic version?** This is a ground-up rewrite and
> carries **breaking changes** — read [Upgrading](#upgrading) before you pull.

![ADS-B 3D live view](Live.png)

## What you get

**Live mode** — per-second updates with a tar1090 altitude color palette
across cones, trails, ground icons, and labels. Click an aircraft for a
detail card: photo, filed route, airframe, and autopilot data when
broadcast. Filter pills (`All / Air / Ground / Mil / Emerg`) drive both
the list and the 3D scene; emergency squawks get a pulsing red ring.
Mobile-friendly — the sidebar collapses and settings open as a sheet.

![Aircraft list with filter pills](Sidebar.png)
![Aircraft detail card](Aircraft-Details.png)

**Historical mode** (needs track-service + TimescaleDB) — scrub a
timestamp cursor across the last 1h / 24h / 7d at 1×–60× speed. The **3D
airway-density** overlay renders every flight path at its real altitude,
so busy airways and approach corridors light up as bright bundles in the
sky.

![3D airway-density heatmap](Heatmap.png)

**ACARS** (needs acars-service) — per-aircraft datalink messages in the
detail card with an OOOI flight-phase chip (taxi-out / airborne / taxi-in
/ at gate), a searchable full-page browser, and a 3D ping ring when a
message lands for an aircraft on scope.

**Multi-feed** — point at several receivers and the status bar grows a
feed picker. Switching is in-place — no page reload.

**Voice scanner** (needs a separate voice stack) — an optional VHF
airband call feed, shown only on the local feed. See
[docs/VOICE.md](docs/VOICE.md).

## Prerequisites

- Docker Engine 20+ and Docker Compose v2
- An ADS-B feeder already publishing `aircraft.json` (tar1090,
  ultrafeeder, dump1090-fa, readsb-protobuf, …)

## Quick start

```yaml
services:
  adsb-3d:
    image: ghcr.io/hook-365/adsb-3d:latest
    ports: ["8086:80"]
    environment:
      - LATITUDE=45.0000
      - LONGITUDE=-90.0000
      - ALTITUDE=1000
      - LOCATION_NAME=My Station
      - FEEDER_URL=http://ultrafeeder
```

`docker compose up -d`, then open `http://localhost:8086/` — your
aircraft should appear within a few seconds.

**`FEEDER_URL` must be reachable from inside the container.** A bare
service name like `http://ultrafeeder` only resolves if adsb-3d shares a
Docker network with your feeder. If it doesn't, use the feeder's host IP
and port — e.g. `http://192.168.1.50:8080`. If the page loads but stays
empty, this is almost always why: check `docker logs adsb-3d` (the
container reports `unhealthy` until it can reach the feeder).

For a fuller setup, copy `.env.example` to `.env` and start from
`docker-compose.example.yml` — both are in the repo root, with
track-service, ACARS, and TimescaleDB ready to uncomment.

- **Historical mode:** add `track-service` + `timescaledb` and set
  `ENABLE_HISTORICAL=true`.
- **ACARS:** run `acars-service` against an acarshub TCP feed and set
  `ENABLE_ACARS=true`.
- **Voice scanner:** set `ENABLE_VOICE=true` plus `VOICE_STREAM_HOST` /
  `VOICE_EVENTS_HOST` — full walkthrough in [docs/VOICE.md](docs/VOICE.md).

## Reverse proxy

adsb-3d runs on a subdomain or a subpath (`example.com/3d`). The
entrypoint auto-detects the subpaths `/3d`, `/adsb`, and `/adsb-3d` when
your proxy passes the prefix through; set `BASE_PATH` if the proxy strips
the prefix or uses a different path. Worked configs for nginx, Traefik,
Caddy, Apache, and Nginx Proxy Manager are in
[docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md).

## Multi-feed

Define each feed with flat `FEEDN_*` env vars — the entrypoint
synthesises the rest:

```env
FEED1_NAME=Home Station
FEED1_LAT=45.0000
FEED1_LON=-90.0000
FEED1_ALT=1000
FEED1_ACARS=true              # optional

FEED2_NAME=Remote Site A
FEED2_URL=192.0.2.10:8086     # host:port of another adsb-3d instance
FEED2_LAT=43.0000
FEED2_LON=-89.0000
FEED2_COLOR=#ff8c4c           # optional

FEED3_NAME=Remote Site B
FEED3_URL=192.0.2.20:8086
FEED3_LAT=43.0000
FEED3_LON=-87.0000
```

Slot 1 is always local — `FEED1_URL` is ignored. Slots 2+ point at other
adsb-3d instances and the entrypoint wires up the nginx proxy blocks.
Parsing stops at the first missing `FEEDN_NAME`.

## Environment variables

**Core:**

| Variable | Default | Purpose |
|---|---|---|
| `LATITUDE` / `LONGITUDE` / `ALTITUDE` | — | Receiver location |
| `LOCATION_NAME` | `Home` | Display name |
| `FEEDER_URL` | `http://ultrafeeder` | Anything publishing `/data/aircraft.json` — must be reachable from the container |
| `ENABLE_HISTORICAL` | `false` | Historical playback UI (needs track-service) |
| `ENABLE_ACARS` | `false` | ACARS panel (needs acars-service) |
| `ENABLE_VOICE` | `false` | VHF voice scanner panel (see [docs/VOICE.md](docs/VOICE.md)) |
| `HIDE_TOWER` | `false` | Hide the home tower marker |
| `TRACK_API_HOST` | `track-service:8000` | nginx upstream |
| `ACARS_API_HOST` | `acars-service:8000` | nginx upstream |
| `VOICE_EVENTS_HOST` | — | nginx upstream for `/voice/calls` + `/voice/ws` — what the frontend uses |
| `VOICE_STREAM_HOST` | — | required when voice is on; point at any reachable `host:port` (legacy Icecast block, not played by the frontend) |

**Multi-feed:** `FEEDN_NAME`, `FEEDN_LAT`, `FEEDN_LON`, `FEEDN_ALT`,
`FEEDN_URL`, `FEEDN_COLOR`, `FEEDN_ACARS` — see [Multi-feed](#multi-feed).

**Advanced / rarely needed:** `MAP_ZOOM` (`8`) and `MAP_GRID_SIZE` (`21`)
tune the initial basemap view; `BASE_PATH` overrides the reverse-proxy
subpath (see [Reverse proxy](#reverse-proxy)); `FEED_MODE` is
auto-synthesized from your `FEEDN_*` slots — don't set it manually.

**Track-service** (when running it directly): `FEEDER_URL`, `DB_HOST`,
`DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `COLLECTION_INTERVAL`
(default 5s), `RETENTION_DAYS` (default 90).

## Controls

Mouse: **left-drag** orbits the camera, **scroll** zooms, **right-drag** pans
the view (moves the center point).

| Key | Action |
|---|---|
| Arrow keys | Pan the view across the map |
| `R` | Recenter camera + clear selection |
| `/` | Focus the list search box |
| `Esc` | Close settings panel or ACARS browser |

## Upgrading

The older version was a single ~14k-line vanilla-JS app; this is a
TypeScript / Three.js rewrite. Most deployments keep working after a
pull, but review these first:

- **`ENABLE_HISTORICAL` defaults to `false`** (was `true`) — set it
  explicitly to `true` if you run `track-service`.
- **`ENABLE_SATELLITES` is removed** — delete it; satellite tracking is
  gone (also remove any `/tle` rule from an external reverse proxy).
- **`ENABLE_VOICE=true` now requires `VOICE_STREAM_HOST` +
  `VOICE_EVENTS_HOST`** — the container fails fast without them.
- **`track-service` / `acars-service` run as non-root** (uid `10001`) —
  host paths bind-mounted into them must be writable by that uid.
- In-browser settings (basemap, units, label density) **reset once** —
  `localStorage` keys changed in the rewrite.
- Multi-feed: a hand-written `FEEDS_CONFIG` JSON still works, but flat
  `FEEDN_*` variables are now recommended.

Full detail in [CHANGELOG.md](CHANGELOG.md).

## Architecture

```
                ┌──────── browser ────────┐
                │  Vite/TS Three.js app   │
                └───────────┬─────────────┘
                            │
                       nginx (port 80)
                            │
      ┌──────────┬──────────┼──────────┬──────────────┐
      │          │          │          │              │
   /data/...  /api/...   /ws/...  /api/feeds/N/...  /acars-api/
      │          │          │          │              │
 ultrafeeder  track-service │   remote adsb-3d   acars-service
                  │             instance (slot N)
                  ▼
            TimescaleDB
       (aircraft_positions
        + aircraft_metadata
        + acars_messages)
```

- **`frontend/`** — Vite + TypeScript + Three.js viewer, no framework.
- **`track-service/`** — FastAPI + asyncpg; a live WebSocket diff stream
  plus a TimescaleDB history collector.
- **`acars-service/`** — FastAPI bridge to an acarshub TCP feed.
- **`nginx/`** — reverse proxy + static host; `entrypoint.sh` renders the
  config (including per-feed proxy blocks) from env vars at start.

See [CLAUDE.md](CLAUDE.md) for a deeper architecture orientation.

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
with `DEV_BACKEND`. To run the full container against an existing backend:

```sh
docker compose -f docker-compose.dev.yml --project-directory . up --build -d
# → http://localhost:8186/
```

## Credits

- **tar1090** ([wiedehopf/tar1090](https://github.com/wiedehopf/tar1090),
  GPL v2+) — SVG aircraft shape catalog and the altitude → color palette.
- **readsb / dump1090-fa** — upstream Mode S/ADS-B decoder.
- **planespotters.net** — aircraft photographs in the detail panel.
- **adsb.im** — callsign → route resolution.
- **OpenStreetMap, Carto, ESRI, OpenTopoMap** — basemap tile providers.

## License

Source code is MIT (see `LICENSE`). Vendored tar1090 data
(`frontend/src/aircraft/shapes-data.json`) is GPL v2+ per upstream — if
you redistribute the built app, GPL governs that component.
