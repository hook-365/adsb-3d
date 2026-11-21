# Configuration

Everything is set with environment variables in your compose file. There
is one example, and it has every setting in it: the required block at the
top is all you need for live traffic, and everything optional is below
it, commented out.

It is the same file as [`docker-compose.example.yml`](../docker-compose.example.yml)
in the repo root, so you can copy that and start uncommenting.

```yaml
# ADS-B 3D: the one example.
#
# Every setting there is, in one file. The REQUIRED block is all you need
# for live traffic. Everything under OPTIONAL is off or at its default
# until you uncomment it. Values shown on commented lines are the defaults
# unless the comment says otherwise.

services:
  adsb-3d:
    image: ghcr.io/hook-365/adsb-3d:latest
    container_name: adsb-3d
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    mem_limit: 192m
    ports:
      - "8086:80"
    environment:
      # ══ REQUIRED ══════════════════════════════════════════════════════
      # Where your receiver is. Altitude is in feet MSL, like every
      # altitude in this file.
      - LATITUDE=45.0000
      - LONGITUDE=-90.0000
      - ALTITUDE=1000
      - LOCATION_NAME=My Station
      # Anything that serves readsb's /data/aircraft.json (ultrafeeder,
      # tar1090, readsb, dump1090-fa). It has to be reachable from inside
      # this container. Use the feeder's IP and port, or its service name
      # if it is on the same Docker network as this container.
      - FEEDER_URL=http://192.0.2.50:8080
      # - FEEDER_URL=http://ultrafeeder
      # - FEEDER_URL=https://adsb.example.com

      # ══ OPTIONAL ══════════════════════════════════════════════════════

      # ── Worth setting ────────────────────────────────────────────────
      # A contact (email or site) sent in the User-Agent to adsb.im for
      # route lookups and to the map tile providers. They ask for one.
      # Unset sends none and the container warns at start.
      # - ROUTE_API_CONTACT=you@example.com
      # Free key from https://carto.com/basemaps/apikey. Unlocks the Carto
      # Dark and Carto Voyager basemaps, fetched by the browser straight
      # from CARTO (their terms forbid proxying). One key per deployment.
      # - CARTO_API_KEY=your-key

      # ── Explore: watch any city ──────────────────────────────────────
      # Adds the Explore places to the feed picker. Pick one provider.
      # Their limits and licences are in docs/CONFIGURATION.md.
      # - EXPLORE_PROVIDER=adsb.lol         # no key
      # - EXPLORE_PROVIDER=adsb.fi          # no key
      # - EXPLORE_PROVIDER=airplanes.live   # no key
      # - EXPLORE_PROVIDER=flyitalyadsb     # needs the free key below
      # - EXPLORE_API_KEY=fia_xxxx
      # A second provider that takes over while the first one is failing.
      # - EXPLORE_FALLBACK_PROVIDER=adsb.lol
      # Seconds between polls, and how long each city is cached.
      # - EXPLORE_POLL_S=10

      # ── Features that need nothing else ──────────────────────────────
      # Winds aloft, from Open-Meteo (their free tier is non-commercial).
      # - ENABLE_WINDS_ALOFT=true           # default false
      # - WINDS_API_KEY=                    # optional paid Open-Meteo key
      # Hide the home tower marker, for privacy on a public instance.
      # - HIDE_TOWER=true                   # default false
      # Remove 3D terrain for everyone. Users can turn it off themselves.
      # - ENABLE_TERRAIN=false              # default true
      # The container asks GitHub once a day whether a newer release is
      # out, and the settings panel shows a badge. No viewer data is sent.
      # - ENABLE_UPDATE_CHECK=false         # default true
      # The container refreshes its FAA procedure data when a new edition
      # is published, every 28 days.
      # - ENABLE_DATA_REFRESH=false         # default true

      # ── Features that need another service (see the services below) ──
      # - ENABLE_HISTORICAL=true            # needs track-service + timescaledb
      # - ENABLE_ACARS=true                 # needs acars-service
      # - ENABLE_WEATHER3D=true             # needs weather-service, US only
      # Where nginx finds them, if you renamed or moved the services.
      # - TRACK_API_HOST=track-service:8000
      # - ACARS_API_HOST=acars-service:8000
      # - WEATHER_API_HOST=weather-service:8000

      # ── Voice scanner (needs your own voice stack, see docs/VOICE.md) ─
      # Both hosts are required when ENABLE_VOICE is true.
      # - ENABLE_VOICE=true                 # default false
      # - VOICE_EVENTS_HOST=voice-events:8001   # what the frontend uses
      # - VOICE_STREAM_HOST=voice-icecast:8000  # legacy stream, not played

      # ── More than one receiver ───────────────────────────────────────
      # One block per receiver, numbered from 1 with no gaps. Slot 1 is
      # this station. Slots 2 and up are other adsb-3d instances.
      # - FEED1_NAME=Home Station
      # - FEED1_LAT=45.0000
      # - FEED1_LON=-90.0000
      # - FEED1_ALT=1000
      # - FEED1_ACARS=true                  # optional, this feed has ACARS
      #
      # - FEED2_NAME=Remote Site
      # - FEED2_URL=192.0.2.10:8086         # host:port of that adsb-3d
      # - FEED2_LAT=43.0000
      # - FEED2_LON=-89.0000
      # - FEED2_COLOR=#ff8c4c               # optional badge colour
      #
      # If a remote feed's live data and its track API are on different
      # hosts, give the pair instead of FEED3_URL:
      # - FEED3_NAME=Remote Site B
      # - FEED3_LAT=43.0000
      # - FEED3_LON=-87.0000
      # - FEED3_DATA_HOST=192.0.2.20:8080         # serves /data/aircraft.json
      # - FEED3_API_HOST=track-service-feed3:8000 # serves the track API
      #
      # Or hand-write the feed list as JSON and skip FEEDN_* entirely:
      # - FEEDS_CONFIG=[{"id":"local","name":"Home","liveUrl":"/data/aircraft.json","apiBase":"/api","home":{"lat":45.0,"lon":-90.0,"alt":1000}}]

      # ── Behind a reverse proxy ───────────────────────────────────────
      # A subpath. /3d, /adsb and /adsb-3d are detected by themselves; set
      # this for any other path, or if your proxy strips the prefix.
      # - BASE_PATH=/mypath
      # Your proxy's address range, so rate limiting counts each real
      # visitor and not the proxy as one client. Comma-separated.
      # - TRUSTED_PROXY_CIDR=192.0.2.0/24
      # Only if another site calls this instance's API directly. An
      # origin, or *. Unset sends no CORS headers.
      # - CORS_ALLOW_ORIGIN=https://dashboard.example.com

      # ── Rarely needed ────────────────────────────────────────────────
      # Map tiles pre-cached around your station at start: zoom level and
      # grid width. Only active with the /tiles volume below.
      # - MAP_ZOOM=8
      # - MAP_GRID_SIZE=21
      # DNS server nginx uses to find upstreams. The default is Docker's
      # own. Set it on runtimes without that, such as Kubernetes.
      # - DNS_RESOLVER=127.0.0.11
    # Keeps the map tile cache across restarts and turns on the pre-cache.
    # volumes:
    #   - adsb-3d-tiles:/tiles

  # ══ OPTIONAL SERVICES ═════════════════════════════════════════════════
  # The database password is read from a .env file next to this one, so
  # the three services that use it can never disagree. Copy .env.example
  # to .env and set DB_PASSWORD there.

  # ── Historical playback and the heatmap: ENABLE_HISTORICAL=true ───────
  # track-service:
  #   image: ghcr.io/hook-365/adsb-track-service:latest
  #   container_name: track-service
  #   restart: unless-stopped
  #   depends_on:
  #     - timescaledb-adsb
  #   environment:
  #     - FEEDER_URL=http://192.0.2.50:8080   # the same feeder as above
  #     - ROUTE_API_CONTACT=you@example.com   # the same contact as above
  #     - DB_HOST=timescaledb-adsb
  #     - DB_PORT=5432
  #     - DB_NAME=adsb_tracks
  #     - DB_USER=adsb
  #     - DB_PASSWORD=${DB_PASSWORD:?set DB_PASSWORD in your .env file}
  #     # - COLLECTION_INTERVAL=5             # seconds between stored positions
  #     # - RETENTION_DAYS=90                 # history kept; set before first start
  #     # - FEEDER_POLL_SECONDS=1             # live poll rate; default depends on the feeder
  #     # - ROUTE_CACHE_TTL_SECONDS=86400     # how long a route answer is kept
  #     # - ROUTE_MIN_INTERVAL_SECONDS=180    # least time between requests to adsb.im

  # timescaledb-adsb:
  #   image: timescale/timescaledb:2.17.2-pg16
  #   container_name: timescaledb-adsb
  #   restart: unless-stopped
  #   environment:
  #     - POSTGRES_DB=adsb_tracks
  #     - POSTGRES_USER=adsb
  #     - POSTGRES_PASSWORD=${DB_PASSWORD:?set DB_PASSWORD in your .env file}
  #   volumes:
  #     - timescaledb-data:/var/lib/postgresql/data

  # ── ACARS: ENABLE_ACARS=true ──────────────────────────────────────────
  # Needs your own acarshub or acars_router, and the database above.
  # acars-service:
  #   image: ghcr.io/hook-365/adsb-acars-service:latest
  #   container_name: acars-service
  #   restart: unless-stopped
  #   depends_on:
  #     - timescaledb-adsb
  #   environment:
  #     - ACARS_HOST=acarshub                 # your acarshub or acars_router
  #     - ACARS_PORT=15550                    # 15550 is ACARS, 15555 is VDL Mode 2
  #     - DB_HOST=timescaledb-adsb
  #     - DB_PORT=5432
  #     - DB_NAME=adsb_tracks
  #     - DB_USER=adsb
  #     - DB_PASSWORD=${DB_PASSWORD:?set DB_PASSWORD in your .env file}
  #     # - STATION_ID=adsb-3d                # stamped on stored messages

  # ── 3D storms and the other NOAA layers: ENABLE_WEATHER3D=true ────────
  # US only. No database. One service covers every feed.
  # weather-service:
  #   image: ghcr.io/hook-365/adsb-weather-service:latest
  #   container_name: weather-service
  #   restart: unless-stopped
  #   environment:
  #     - ROUTE_API_CONTACT=you@example.com   # sent to NOAA in the User-Agent
  #     # Your station again, so its storms are ready before anyone asks.
  #     # - LATITUDE=45.0000
  #     # - LONGITUDE=-90.0000
  #     # - WEATHER3D_RADIUS_NM=250           # how far around each feed
  #     # - WEATHER3D_REFRESH_S=300           # seconds between downloads, 120 at least
  #     # - WEATHER3D_LOCATION_TTL_S=1800     # forget a feed nobody is watching
  #     # Which 2-D layers to fetch. Add bbtop,bbbottom for the melting
  #     # layer (15 MB each per fetch).
  #     # - WEATHER_FIELDS=echotop18,echotop30,freezing,preciprate,preciptype,mesh,lightning

# Uncomment the ones you turned on above.
# volumes:
#   timescaledb-data:
#   adsb-3d-tiles:
```

The rest of this page is the few things that don't fit in a comment.

## Explore providers

Explore shows an area's traffic from a community aggregator. Live only:
no history, ACARS or voice for that feed, and routes are looked up only
for the aircraft you select. Any key stays in the container, and each
city is cached for the poll interval, so however many people watch one
city it costs one upstream request per interval.

| `EXPLORE_PROVIDER` | Key | Notes |
|---|---|---|
| `flyitalyadsb` | `EXPLORE_API_KEY`, free and self-serve at [flyitalyadsb.com](https://flyitalyadsb.com/en/data/api/) | 30 requests/min on the free plan; feeders get Pro limits on the same key. Data is CC BY-SA 4.0 |
| `adsb.lol` | none | No published limit ("dynamic"); data is ODbL 1.0; feeding them is encouraged |
| `adsb.fi` | none | 1 request/s per IP; personal, non-commercial use only; cite with a link |
| `airplanes.live` | none | No published limit; site terms are non-commercial |

The provider is credited on screen while the feed is active. Keep that
visible: it is a licence condition for some of them. If you have a
receiver, feed them. They run on hobbyist data.

## Reverse proxy

adsb-3d is plain HTTP on port 80 of the container, and any reverse proxy
can sit in front of it. Setting up a proxy host and certificates is
covered far better by your proxy's own documentation. What adsb-3d needs
from it:

- **Forward everything to port 80.** One upstream, no per-path rules.
- **Pass WebSockets through.** Without them the viewer falls back to
  slower polling and the feed status never goes green.
- **Serve HTTPS if you want VR or AR.** Browsers only offer WebXR on a
  secure origin.

`/health` answers `OK` once the container is up. The settings that go
with a proxy (`BASE_PATH`, `TRUSTED_PROXY_CIDR`, `CORS_ALLOW_ORIGIN`) are
in the example above. The container sends its own security headers and
rate limits its own endpoints, so you don't need to add those.

## Upgrading

Pull the new image and restart; settings and data carry over. From
0.12.2 the settings panel shows an **Update available** badge when a
newer release exists, and the first load after an upgrade shows what
changed.

**Routes (origin / destination) stopped showing?** Releases before
0.12 sent route lookups to [adsb.im](https://adsb.im) one callsign at a
time and may be rate-limited or blocked there. Pull a current image
(`:latest` or `0.12.2`+) and restart; routes come back, and from 0.12.2
the settings panel tells you when a newer release exists. See
[#17](https://github.com/hook-365/adsb-3d/issues/17).

What changed in each release is in the [changelog](../CHANGELOG.md).

---

Back to the [README](../README.md).
