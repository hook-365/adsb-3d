# Configuration

All deploy-time configuration is environment variables. `.env.example` and `docker-compose.example.yml` in the repo root carry every one of these with a comment, ready to uncomment.

## Main image (`adsb-3d`)

| Variable | Default | Purpose |
|---|---|---|
| `LATITUDE` / `LONGITUDE` / `ALTITUDE` | none | Receiver location; `ALTITUDE` in **feet** MSL (as are all `FEEDN_ALT`) |
| `LOCATION_NAME` | `Home` | Display name |
| `FEEDER_URL` | `http://ultrafeeder` | Anything publishing `/data/aircraft.json`; must be reachable from the container |
| `ENABLE_HISTORICAL` | `false` | Historical playback UI (needs track-service) |
| `ENABLE_ACARS` | `false` | ACARS panel (needs acars-service) |
| `ENABLE_WEATHER3D` | `false` | 3D storm volumes and the other MRMS layers, US only (needs weather-service) |
| `ENABLE_WINDS_ALOFT` | `false` | Winds aloft layer and the wind row on the aircraft card, from [Open-Meteo](https://open-meteo.com) (free tier is non-commercial; credited on screen). No sidecar: nginx proxies and caches it hourly |
| `WINDS_API_KEY` | none | Optional Open-Meteo API key for commercial or heavier use; switches the proxy to their customer endpoint. Never sent to browsers |
| `WEATHER_FIELDS` (weather-service) | `echotop18,echotop30,freezing,preciprate,preciptype,mesh,lightning` | Which MRMS 2-D products the sidecar fetches; add `bbtop,bbbottom` for the melting layer (15 MB each per fetch), or trim the list |
| `ENABLE_VOICE` | `false` | VHF voice scanner panel (see [docs/VOICE.md](VOICE.md)) |
| `EXPLORE_PROVIDER` | none | `flyitalyadsb`, `adsb.lol`, `adsb.fi` or `airplanes.live`; adds the *Explore* feed (pick any city). See [Explore](FEEDS.md#explore-any-city) |
| `EXPLORE_API_KEY` | none | API key for `flyitalyadsb` (setting it alone selects that provider) |
| `EXPLORE_FALLBACK_PROVIDER` | none | A second provider from the same list, used automatically while `EXPLORE_PROVIDER` is failing. See [Explore](FEEDS.md#explore-any-city) |
| `EXPLORE_POLL_S` | `10` | Seconds between Explore polls and the per-city cache window; a free key allows 30 requests a minute |
| `ENABLE_TERRAIN` | `true` | Deploy-level 3D-terrain kill switch (users can also turn it off per-browser) |
| `ENABLE_UPDATE_CHECK` | `true` | The container asks GitHub once a day for the latest release and the settings panel shows a badge when it is newer. Runs server-side only (one request per deployment per day, no viewer IPs); `false` disables it entirely |
| `ENABLE_DATA_REFRESH` | `true` | The container asks the FAA once a day whether a new edition of its procedure data is out (approaches, arrivals, departures, airways, navaids; one every 28 days) and, when it is, downloads it (about 9 MB) and rebuilds the app's copy, a few seconds of work. Runs server-side only (no viewer IPs); `false` keeps the copy built into the image, which the airport card marks out of date once its 28 days are up |
| `HIDE_TOWER` | `false` | Hide the home tower marker |
| `TRACK_API_HOST` | `track-service:8000` | nginx upstream |
| `ROUTE_CACHE_TTL_SECONDS` (track-service) | `86400` | How long the shared route cache keeps an answer before asking adsb.im again |
| `ROUTE_MIN_INTERVAL_SECONDS` (track-service) | `180` | Minimum spacing between route requests to adsb.im; newly seen callsigns coalesce until it passes |
| `ROUTE_API_CONTACT` (adsb-3d and track-service) | none | Contact (email or site) sent to adsb.im and tile providers in the User-Agent (`adsb-3d/<version> (+repo; contact)`); they ask for one. Unset = no contact sent, warning at start |
| `ACARS_API_HOST` | `acars-service:8000` | nginx upstream |
| `WEATHER_API_HOST` | `weather-service:8000` | nginx upstream for `/weather-api/` |
| `VOICE_EVENTS_HOST` | none | nginx upstream for `/voice/calls` + `/voice/ws`, which is what the frontend uses |
| `VOICE_STREAM_HOST` | none | required when voice is on; point at any reachable `host:port` (legacy Icecast block, not played by the frontend) |
| `CARTO_API_KEY` | none | Free [CARTO basemaps key](https://carto.com/basemaps/apikey) that unlocks the Carto Dark and Carto Voyager basemaps. Fetched by the browser directly from CARTO (their terms forbid proxying), one key per deployment. Without it those two entries are hidden and the default basemap falls back to OpenStreetMap |
| `DNS_RESOLVER` | `127.0.0.11` | nginx `resolver` address(es) for upstream lookups; override on runtimes without Docker's embedded DNS (e.g. Kubernetes CoreDNS) |
| `MAP_ZOOM` / `MAP_GRID_SIZE` | `8` / `21` | boot-time tile pre-cache around the station (zoom level / grid width); only active with the `/tiles` volume mounted |

## Multi-feed

`FEEDN_NAME`, `FEEDN_LAT`, `FEEDN_LON`, `FEEDN_ALT`,
`FEEDN_URL`, `FEEDN_COLOR`, `FEEDN_ACARS`. See [Multi-feed](FEEDS.md#multi-feed).
(`FEEDS_CONFIG` accepts the raw JSON feed array directly and skips the
`FEEDN_*` synthesis; see `.env.example` for the shape.)

## Backend services

Set on the `track-service`, `acars-service` and `weather-service`
containers, not the main image (see the compose example):

| Variable | Default | Purpose |
|---|---|---|
| `FEEDER_URL` | `http://ultrafeeder` | same feeder the frontend uses; both services poll it |
| `FEEDER_POLL_SECONDS` | heuristic | live-stream poll cadence override (defaults per feeder type) |
| `COLLECTION_INTERVAL` | `5` | seconds between DB track snapshots (track-service) |
| `RETENTION_DAYS` | `90` | TimescaleDB retention for tracks and ACARS messages |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | `timescaledb-adsb` / `5432` / `adsb_tracks` / `adsb` / none | TimescaleDB connection; password has no default on purpose |
| `ACARS_HOST` / `ACARS_PORT` | `acarshub` / `15550` | acarshub / acars_router JSON-over-TCP feed (acars-service); `15550` is the ACARS lane, `15555` VDL Mode 2 |
| `LATITUDE` / `LONGITUDE` (weather-service) | none | optional; pre-warms a pinned storm volume for the local feed at startup. Other feeds are cropped on demand from the viewer's `lat`/`lon` |
| `WEATHER3D_RADIUS_NM` | `250` | half-width of each feed's crop box in nautical miles (weather-service) |
| `WEATHER3D_REFRESH_S` | `300` | seconds between NOAA MRMS downloads (weather-service); floor `120`, lower values are raised to it |
| `WEATHER3D_LOCATION_TTL_S` | `1800` | drop a feed location nobody asked about for this long; pinned pre-warm never expires (weather-service) |
| `ROUTE_API_CONTACT` (weather-service) | none | contact sent to NOAA in the User-Agent, same as the other services |
| `STATION_ID` | `adsb-3d` | station identifier stamped on stored ACARS messages |

ACARS messages are decoded into human-readable summaries (position reports, arrivals, weather requests, and CPDLC/ADS-C/AFN datalink) shown above the raw text; see [acars-service/README.md](../acars-service/README.md#message-decoding).

## Reverse proxy and security

`BASE_PATH` overrides the auto-detected subpath
(see [Reverse proxy](REVERSE-PROXY.md)). `TRUSTED_PROXY_CIDR` (comma-
separated CIDRs) makes rate limiting key on the real client IP behind
a fronting proxy instead of one shared bucket. `CORS_ALLOW_ORIGIN`
(default empty = no CORS headers) opts a specific origin (or `*`)
back in if another site consumes the API directly.

---

Back to the [README](../README.md) or the [documentation index](README.md).
