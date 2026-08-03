#!/bin/sh
set -e

# =============================================================================
# Map Tile Pre-caching Function (runs in background)
# =============================================================================
precache_tiles() {
    CACHE_DIR="/tiles"
    ZOOM=${MAP_ZOOM:-8}
    GRID_SIZE=${MAP_GRID_SIZE:-21}
    HALF_GRID=$((GRID_SIZE / 2))

    # Calculate center tile from lat/lon
    LAT=${LATITUDE:-45.0000}
    LON=${LONGITUDE:--90.0000}

    # Tile calculation (Mercator projection)
    N=$(echo "2^$ZOOM" | bc)
    CENTER_X=$(echo "($LON + 180) / 360 * $N" | bc)
    # Y calculation requires more complex math
    LAT_RAD=$(echo "$LAT * 3.14159265359 / 180" | bc -l)
    CENTER_Y=$(echo "(1 - l(s($LAT_RAD) + 1/c($LAT_RAD)) / 3.14159265359) / 2 * $N" | bc -l | cut -d. -f1)

    echo "[tile-cache] Starting background tile pre-cache..."
    echo "[tile-cache] Location: $LAT, $LON -> Tile center: $CENTER_X, $CENTER_Y (zoom $ZOOM)"
    echo "[tile-cache] Grid: ${GRID_SIZE}x${GRID_SIZE} tiles per provider"

    # Define tile providers (name|url_template)
    # URL uses {z}/{y}/{x} placeholders - note ESRI uses y/x order!
    PROVIDERS="
dark|https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png
carto_voyager|https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png
hillshade|https://services.arcgisonline.com/arcgis/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}
topo|https://a.tile.opentopomap.org/{z}/{x}/{y}.png
satellite|https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
osm|https://a.tile.openstreetmap.org/{z}/{x}/{y}.png
terrain_rgb|https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
"

    TOTAL_TILES=$((GRID_SIZE * GRID_SIZE * 7))
    CACHED=0
    SKIPPED=0
    FAILED=0

    echo "$PROVIDERS" | while IFS='|' read -r NAME URL_TEMPLATE; do
        [ -z "$NAME" ] && continue

        PROVIDER_DIR="$CACHE_DIR/$NAME/$ZOOM"
        mkdir -p "$PROVIDER_DIR"

        # Loop through grid
        DY=-$HALF_GRID
        while [ $DY -le $HALF_GRID ]; do
            DX=-$HALF_GRID
            while [ $DX -le $HALF_GRID ]; do
                TILE_X=$((CENTER_X + DX))
                TILE_Y=$((CENTER_Y + DY))

                # Ensure positive tile coordinates
                [ $TILE_X -lt 0 ] && TILE_X=$((TILE_X + N))
                [ $TILE_Y -lt 0 ] && TILE_Y=$((TILE_Y + N))

                TILE_DIR="$PROVIDER_DIR/$TILE_Y"
                TILE_FILE="$TILE_DIR/$TILE_X"

                # Skip if already cached
                if [ -f "$TILE_FILE" ]; then
                    SKIPPED=$((SKIPPED + 1))
                else
                    mkdir -p "$TILE_DIR"

                    # Build URL from template
                    URL=$(echo "$URL_TEMPLATE" | sed "s/{z}/$ZOOM/g" | sed "s/{x}/$TILE_X/g" | sed "s/{y}/$TILE_Y/g")

                    # Download tile (silent, with timeout)
                    if wget -q -T 10 --user-agent="adsb-3d/1.0 (homelab tile cache)" -O "$TILE_FILE" "$URL" 2>/dev/null; then
                        CACHED=$((CACHED + 1))
                    else
                        rm -f "$TILE_FILE"
                        FAILED=$((FAILED + 1))
                    fi

                    # Small delay to be nice to tile servers
                    sleep 0.05
                fi

                DX=$((DX + 1))
            done
            DY=$((DY + 1))
        done

        echo "[tile-cache] $NAME: done"
    done

    echo "[tile-cache] Complete! Cached: $CACHED, Skipped: $SKIPPED, Failed: $FAILED"
}

# Strip unit suffix from ALTITUDE for JavaScript (e.g., "1234ft" -> "1234")
# mlat-client needs the suffix, but config.js needs a pure number
ALTITUDE_NUM=$(echo "${ALTITUDE:-1234}" | sed 's/[^0-9.]//g')

# Escape LOCATION_NAME for embedding in a JS single-quoted string.
# A literal ' in the value would break the string; escape it as \'.
LOCATION_NAME_JS=$(printf '%s' "${LOCATION_NAME:-}" | sed "s/'/\\\\'/g")

# Validate FEEDS_CONFIG is legal JSON before embedding it in config.js.
# An injected value with unescaped characters could break the JS file.
if [ -n "${FEEDS_CONFIG:-}" ] && [ "${FEEDS_CONFIG}" != "null" ]; then
    if ! echo "${FEEDS_CONFIG}" | jq empty 2>/dev/null; then
        echo "[ERROR] FEEDS_CONFIG is not valid JSON — refusing to embed it in config.js"
        echo "[ERROR] FEEDS_CONFIG value: ${FEEDS_CONFIG}"
        exit 1
    fi
fi

# =============================================================================
# Simplified multi-feed config (FEED1_NAME, FEED1_LAT, ... FEED2_NAME, ...)
# =============================================================================
# Friendlier alternative to hand-crafting FEEDS_CONFIG JSON. If any
# FEED1_NAME is set AND FEEDS_CONFIG isn't already provided, we walk
# the FEED1..FEEDN_* environment variables and synthesize FEEDS_CONFIG
# + FEEDN_DATA_HOST/FEEDN_API_HOST + FEED_MODE here. The downstream
# code (window.FEEDS_CONFIG, nginx-block generator) consumes those as
# usual — no changes there.
#
# Per slot:
#   FEED{N}_NAME   - Display name (required; absence ends the loop)
#   FEED{N}_LAT    - Receiver latitude  (required)
#   FEED{N}_LON    - Receiver longitude (required)
#   FEED{N}_ALT    - Receiver altitude in feet (optional, default 0)
#   FEED{N}_URL    - host:port of the remote adsb-3d (required for N>=2;
#                    ignored for N=1, which always uses local services)
#   FEED{N}_COLOR  - Hex badge color (optional)
#   FEED{N}_ACARS  - "true" to enable ACARS for this feed (optional)
# =============================================================================
if [ -n "${FEED1_NAME:-}" ] && [ -z "${FEEDS_CONFIG:-}" ]; then
    echo "[feeds] Building FEEDS_CONFIG from simplified FEEDN_* variables..."
    FEEDS_JSON_PARTS=""
    SLOT=1
    while [ "$SLOT" -le 20 ]; do
        eval "NAME=\${FEED${SLOT}_NAME:-}"
        if [ -z "$NAME" ]; then
            # Feed slots must be numbered contiguously from 1. If a later slot
            # is set, warn — otherwise it would be silently dropped here.
            NEXT=$((SLOT + 1))
            eval "NEXT_NAME=\${FEED${NEXT}_NAME:-}"
            if [ -n "$NEXT_NAME" ]; then
                echo "[feeds] WARNING: FEED${SLOT}_NAME is not set, but FEED${NEXT}_NAME is."
                echo "[feeds] Feed slots must be contiguous — FEED${NEXT} and beyond will be ignored."
            fi
            break
        fi
        eval "LAT=\${FEED${SLOT}_LAT:-}"
        eval "LON=\${FEED${SLOT}_LON:-}"
        eval "ALT=\${FEED${SLOT}_ALT:-0}"
        eval "URL=\${FEED${SLOT}_URL:-}"
        eval "COLOR=\${FEED${SLOT}_COLOR:-#4a9eff}"
        eval "ACARS_ON=\${FEED${SLOT}_ACARS:-}"
        # Slot 1 (local) inherits ENABLE_ACARS when FEED1_ACARS isn't set, so
        # the global flag still means something in multi-feed mode.
        if [ -z "$ACARS_ON" ]; then
            if [ "$SLOT" -eq 1 ]; then ACARS_ON="${ENABLE_ACARS:-false}"; else ACARS_ON="false"; fi
        fi

        if [ -z "$LAT" ] || [ -z "$LON" ]; then
            echo "[feeds] WARNING: FEED${SLOT}_LAT and FEED${SLOT}_LON are required for slot ${SLOT}; skipping"
            SLOT=$((SLOT + 1))
            continue
        fi

        if [ "$SLOT" -eq 1 ]; then
            # Slot 1 is always local (uses default nginx /data/ and /api/ blocks).
            # Also seed LATITUDE/LONGITUDE/etc so the rest of the script (tile
            # pre-cache, ENV_CONFIG fallback) gets the same coordinates.
            FEED_ID="local"
            LIVE_URL="/data/aircraft.json"
            API_BASE="/api"
            export LATITUDE="${LATITUDE:-$LAT}"
            export LONGITUDE="${LONGITUDE:-$LON}"
            export ALTITUDE="${ALTITUDE:-${ALT}ft}"
            export LOCATION_NAME="${LOCATION_NAME:-$NAME}"
        else
            FEED_ID="feed${SLOT}"
            LIVE_URL="/data/feeds/${SLOT}/aircraft.json"
            API_BASE="/api/feeds/${SLOT}"

            # A remote feed needs an upstream for live data and one for the
            # track API. Two ways to supply them:
            #   Simple — FEED{N}_URL: one host serves both (another adsb-3d).
            #   Split  — FEED{N}_DATA_HOST + FEED{N}_API_HOST: separate
            #            upstreams, e.g. a tar1090 for data plus a dedicated
            #            track-service for the API.
            eval "DATA_HOST=\${FEED${SLOT}_DATA_HOST:-}"
            eval "API_HOST=\${FEED${SLOT}_API_HOST:-}"
            if [ -n "$URL" ]; then
                # Strip protocol + trailing slash; that host serves both.
                HOST=$(echo "$URL" | sed -e 's|^https\?://||' -e 's|/$||')
                DATA_HOST="$HOST"
                API_HOST="$HOST"
            fi
            if [ -z "$DATA_HOST" ] || [ -z "$API_HOST" ]; then
                echo "[feeds] WARNING: remote slot ${SLOT} needs FEED${SLOT}_URL, or both FEED${SLOT}_DATA_HOST and FEED${SLOT}_API_HOST; skipping"
                SLOT=$((SLOT + 1))
                continue
            fi
            export "FEED${SLOT}_DATA_HOST=$DATA_HOST"
            export "FEED${SLOT}_API_HOST=$API_HOST"
        fi

        ACARS_FRAGMENT=""
        if [ "$ACARS_ON" = "true" ]; then
            ACARS_FRAGMENT=',"acars":{"enabled":true}'
        fi

        FEED_JSON="{\"id\":\"${FEED_ID}\",\"name\":\"${NAME}\",\"liveUrl\":\"${LIVE_URL}\",\"apiBase\":\"${API_BASE}\",\"color\":\"${COLOR}\",\"home\":{\"lat\":${LAT},\"lon\":${LON},\"alt\":${ALT}}${ACARS_FRAGMENT}}"
        if [ -z "$FEEDS_JSON_PARTS" ]; then
            FEEDS_JSON_PARTS="$FEED_JSON"
        else
            FEEDS_JSON_PARTS="${FEEDS_JSON_PARTS},${FEED_JSON}"
        fi

        echo "[feeds] Slot ${SLOT}: ${NAME} (${LAT}, ${LON})"
        SLOT=$((SLOT + 1))
    done

    FEED_COUNT=$((SLOT - 1))
    if [ "$FEED_COUNT" -gt 0 ]; then
        export FEEDS_CONFIG="[${FEEDS_JSON_PARTS}]"
        if [ "$FEED_COUNT" -ge 2 ] && [ -z "${FEED_MODE:-}" ]; then
            export FEED_MODE="multi"
        fi
        echo "[feeds] Synthesized FEEDS_CONFIG with ${FEED_COUNT} feed(s); FEED_MODE=${FEED_MODE:-single}"
    else
        echo "[feeds] WARNING: FEED1_NAME was set but no valid feeds parsed"
    fi
fi

# Generate config.js from environment variables
cat > /usr/share/nginx/html/config.js <<EOF
// Auto-generated configuration from environment variables

// BASE_PATH configuration
// Can be set explicitly via BASE_PATH env var, or auto-detected from URL
const CONFIGURED_BASE_PATH = '${BASE_PATH:-}';
const AUTO_BASE_PATH = (() => {
    // If explicitly configured, use that
    if (CONFIGURED_BASE_PATH) {
        return CONFIGURED_BASE_PATH;
    }

    // Otherwise, auto-detect from URL path
    const path = window.location.pathname;

    // Common subdirectory patterns
    if (path.startsWith('/3d')) return '/3d';
    if (path.startsWith('/adsb')) return '/adsb';
    if (path.startsWith('/adsb-3d')) return '/adsb-3d';

    // Default to root deployment
    return '';
})();

// Environment configuration
window.ENV_CONFIG = {
    homeLocation: {
        lat: ${LATITUDE:-45.0000},
        lon: ${LONGITUDE:--90.0000},
        alt: ${ALTITUDE_NUM}
    },
    locationName: '${LOCATION_NAME_JS}'
};

// ADSB configuration
window.ADSB_CONFIG = {
    BASE_PATH: AUTO_BASE_PATH
};

// Historical mode configuration
// When enabled, expects track-service to be running
window.HISTORICAL_CONFIG = {
    enabled: ${ENABLE_HISTORICAL:-false}
};

// ACARS mode configuration
// When enabled, expects acars-service to be running
window.ACARS_CONFIG = {
    enabled: ${ENABLE_ACARS:-false}
};

// Voice scanner configuration (VHF AM aviation voice).
// When enabled, expects the voice-events sidecar (VOICE_EVENTS_HOST):
//   - /voice/calls            -> JSON index of recorded transmissions
//   - /voice/calls/<id>/audio -> per-call MP3 (Range-capable)
//   - /voice/ws               -> WebSocket push for new calls + activity
// VOICE_STREAM_HOST keeps the legacy /voice/scanner.mp3 nginx block valid
// but the frontend no longer plays the mixed stream. See docs/VOICE.md.
window.VOICE_CONFIG = {
    enabled: ${ENABLE_VOICE:-false}
};

// Tower visibility (set HIDE_TOWER=true to hide home tower marker and remove toggle)
window.TOWER_CONFIG = {
    hidden: ${HIDE_TOWER:-false}
};

// Terrain configuration (AWS Terrain-RGB tiles - free, no API key).
// Deploy-level kill switch; users also get a per-browser settings toggle.
window.TERRAIN_CONFIG = {
    enabled: ${ENABLE_TERRAIN:-true}
};

// Multi-feed configuration
// single = local feed only (no dropdown)
// multi = feed selector dropdown with all configured feeds
window.FEED_MODE_CONFIG = {
    mode: '${FEED_MODE:-single}'
};

// Feeds configuration
// In single mode: auto-generated from LATITUDE/LONGITUDE/LOCATION_NAME
// In multi mode: parsed from FEEDS_CONFIG env var (JSON array)
window.FEEDS_CONFIG = ${FEEDS_CONFIG:-null};
EOF

echo "Generated config.js with location: ${LOCATION_NAME:-[no name set]} (${LATITUDE:-45.0000}, ${LONGITUDE:--90.0000}, ${ALTITUDE:-1234})"

# BASE_PATH configuration
if [ -n "${BASE_PATH}" ]; then
    echo "BASE_PATH explicitly configured: ${BASE_PATH}"
else
    echo "BASE_PATH will be auto-detected from URL (supports /3d, /adsb, /adsb-3d, or root)"
fi

# Historical mode configuration
if [ "${ENABLE_HISTORICAL:-false}" = "true" ]; then
    echo "Historical mode enabled - Track Service will be auto-detected at /api/health"
else
    echo "Historical mode disabled - running in live-only mode"
fi

# ACARS mode configuration
if [ "${ENABLE_ACARS}" = "true" ]; then
    echo "ACARS mode enabled - ACARS Service will be auto-detected at /acars-api/health"
else
    echo "ACARS mode disabled"
fi

# Voice scanner configuration
if [ "${ENABLE_VOICE}" = "true" ]; then
    echo "Voice scanner enabled - /voice/calls + /voice/ws proxied to ${VOICE_EVENTS_HOST}"
else
    echo "Voice scanner disabled (set ENABLE_VOICE=true to enable; requires the voice-services stack)"
fi

# Terrain configuration (default enabled - AWS tiles are free)
if [ "${ENABLE_TERRAIN:-true}" = "true" ]; then
    echo "3D Terrain enabled - using AWS Terrain-RGB tiles"
else
    echo "3D Terrain disabled via ENABLE_TERRAIN=false"
fi

# Feed mode configuration
if [ "${FEED_MODE}" = "multi" ]; then
    if [ -n "${FEEDS_CONFIG}" ]; then
        FEED_COUNT=$(echo "${FEEDS_CONFIG}" | jq 'length')
        echo "Feed mode: MULTI - ${FEED_COUNT} feeds configured via FEEDS_CONFIG"
    else
        echo "Feed mode: MULTI - Using auto-generated local feed (no FEEDS_CONFIG provided)"
    fi
else
    echo "Feed mode: SINGLE - Local feed only (no dropdown)"
fi

# Parse FEEDER_URL to extract full base URL for nginx
# Supports:
#   - FEEDER_URL=http://192.0.2.50:8080
#   - FEEDER_URL=http://ultrafeeder
#   - FEEDER_URL=https://adsb.example.com
#   - FEEDER_URL=http://skymon.ruskowski.de/tar1090  (preserves /tar1090 path)
# Falls back to FEEDER_HOST for backward compatibility
if [ -n "${FEEDER_URL}" ]; then
    # Remove protocol prefix but preserve hostname, port, and path
    export FEEDER_HOST=$(echo "${FEEDER_URL}" | sed -e 's|^https\?://||')
    # Extract just the hostname (no port, no path) for Host header
    export FEEDER_HOSTNAME=$(echo "${FEEDER_HOST}" | sed -e 's|:.*||' -e 's|/.*||')
    echo "Using feeder URL: ${FEEDER_URL} (nginx upstream: ${FEEDER_HOST}, hostname: ${FEEDER_HOSTNAME})"
elif [ -n "${FEEDER_HOST}" ]; then
    # Backward compatibility: use FEEDER_HOST directly
    export FEEDER_HOSTNAME=$(echo "${FEEDER_HOST}" | sed -e 's|:.*||' -e 's|/.*||')
    echo "Using feeder host (legacy): ${FEEDER_HOST} (hostname: ${FEEDER_HOSTNAME})"
else
    # Default fallback
    export FEEDER_HOST=ultrafeeder
    export FEEDER_HOSTNAME=ultrafeeder
    echo "Using default feeder host: ${FEEDER_HOST}"
fi

# Set default TRACK_API_HOST if not provided (for nginx proxy)
export TRACK_API_HOST=${TRACK_API_HOST:-track-service:8000}
echo "Track Service host for proxy: ${TRACK_API_HOST}"

# Set default ACARS_API_HOST if not provided (for nginx proxy)
export ACARS_API_HOST=${ACARS_API_HOST:-acars-service:8000}
echo "ACARS Service host for proxy: ${ACARS_API_HOST}"

# Voice host wiring.
if [ "${ENABLE_VOICE:-false}" = "true" ]; then
    # Voice enabled — both upstream hosts are required. Without them envsubst
    # produces an invalid proxy_pass and nginx refuses to start. Fail fast
    # with a clear message instead of a cryptic nginx syntax error.
    if [ -z "${VOICE_STREAM_HOST:-}" ] || [ -z "${VOICE_EVENTS_HOST:-}" ]; then
        echo "[ERROR] ENABLE_VOICE=true requires both VOICE_STREAM_HOST and VOICE_EVENTS_HOST."
        echo "[ERROR]   VOICE_STREAM_HOST=<icecast-host>:<port>   e.g. voice-icecast:8000"
        echo "[ERROR]   VOICE_EVENTS_HOST=<events-host>:<port>    e.g. voice-events:8001"
        echo "[ERROR] See docs/VOICE.md. Refusing to start with an invalid nginx config."
        exit 1
    fi
else
    # Voice disabled — set dummy hosts so envsubst still produces valid nginx
    # syntax (proxy_pass http:///... would otherwise stop nginx from starting).
    export VOICE_STREAM_HOST=${VOICE_STREAM_HOST:-127.0.0.1:65535}
    export VOICE_EVENTS_HOST=${VOICE_EVENTS_HOST:-127.0.0.1:65535}
fi

# =============================================================================
# Host value validation
# =============================================================================
# Host values are embedded verbatim into nginx proxy_pass directives.
# Guard against shell/nginx injection by restricting to safe characters.
_validate_host() {
    local varname="$1"
    local val="$2"
    # Allow: hostname, IP, hostname:port, IP:port (with optional path prefix)
    if ! echo "$val" | grep -qE '^[A-Za-z0-9._:/-]+$'; then
        echo "[ERROR] ${varname} contains invalid characters: '${val}'"
        echo "[ERROR] Host values must match ^[A-Za-z0-9._:/-]+\$"
        exit 1
    fi
}
_validate_host "FEEDER_HOST" "${FEEDER_HOST}"
_validate_host "TRACK_API_HOST" "${TRACK_API_HOST}"
_validate_host "ACARS_API_HOST" "${ACARS_API_HOST}"

# =============================================================================
# Dynamic Feed Configuration (nginx proxy blocks generated from FEEDS_CONFIG)
# =============================================================================
# FEEDS_CONFIG JSON array defines feeds. For each remote feed (non-local),
# we generate nginx location blocks using FEED{N}_DATA_HOST and FEED{N}_API_HOST
# environment variables, where N is the feed's slot number (2, 3, 4, etc.)
#
# The slot number is derived from the feed's apiBase path:
#   /api/feeds/2 -> slot 2 -> FEED2_DATA_HOST, FEED2_API_HOST
#   /api/feeds/3 -> slot 3 -> FEED3_DATA_HOST, FEED3_API_HOST
# =============================================================================

FEED_DATA_BLOCKS=""
FEED_API_BLOCKS=""

if [ -n "${FEEDS_CONFIG}" ] && [ "${FEEDS_CONFIG}" != "null" ]; then
    echo "[feeds] Parsing FEEDS_CONFIG for remote feeds..."

    # Get number of feeds
    FEED_COUNT=$(echo "${FEEDS_CONFIG}" | jq 'length')
    echo "[feeds] Found ${FEED_COUNT} feed(s) in configuration"

    # Process each feed
    i=0
    while [ $i -lt $FEED_COUNT ]; do
        FEED_ID=$(echo "${FEEDS_CONFIG}" | jq -r ".[$i].id")
        FEED_NAME=$(echo "${FEEDS_CONFIG}" | jq -r ".[$i].name")
        LIVE_URL=$(echo "${FEEDS_CONFIG}" | jq -r ".[$i].liveUrl")
        API_BASE=$(echo "${FEEDS_CONFIG}" | jq -r ".[$i].apiBase")

        # Skip local feed (handled by default /data/ and /api/ blocks)
        if [ "$FEED_ID" = "local" ]; then
            echo "[feeds] Slot 1 (local): ${FEED_NAME} -> using default nginx blocks"
            i=$((i + 1))
            continue
        fi

        # Extract slot number from apiBase (e.g., /api/feeds/2 -> 2)
        SLOT=$(echo "$API_BASE" | sed -n 's|.*/feeds/\([0-9]*\).*|\1|p')

        if [ -z "$SLOT" ]; then
            echo "[feeds] WARNING: Could not determine slot number from apiBase: $API_BASE"
            i=$((i + 1))
            continue
        fi

        # Look up environment variables for this slot
        DATA_HOST_VAR="FEED${SLOT}_DATA_HOST"
        API_HOST_VAR="FEED${SLOT}_API_HOST"

        eval DATA_HOST=\${$DATA_HOST_VAR:-}
        eval API_HOST=\${$API_HOST_VAR:-}

        if [ -z "$DATA_HOST" ] || [ -z "$API_HOST" ]; then
            echo "[feeds] WARNING: Slot ${SLOT} (${FEED_NAME}): Missing ${DATA_HOST_VAR} or ${API_HOST_VAR}"
            i=$((i + 1))
            continue
        fi

        _validate_host "$DATA_HOST_VAR" "$DATA_HOST"
        _validate_host "$API_HOST_VAR" "$API_HOST"

        echo "[feeds] Slot ${SLOT}: ${FEED_NAME} -> data=${DATA_HOST}, api=${API_HOST}"

        # Extract data path prefix from liveUrl (e.g., /data/feeds/2/aircraft.json -> /data/feeds/2/)
        DATA_PATH=$(echo "$LIVE_URL" | sed 's|/[^/]*$|/|')

        # Generate nginx data proxy block
        FEED_DATA_BLOCKS="${FEED_DATA_BLOCKS}
    # Feed slot ${SLOT}: ${FEED_NAME} - live data proxy
    location ${DATA_PATH} {
        proxy_pass http://${DATA_HOST}/data/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods 'GET, OPTIONS';
        add_header Access-Control-Allow-Headers 'Origin, Content-Type, Accept';
    }
"

        # Generate nginx WS proxy block FIRST so it wins prefix-match against
        # the broader API block below for paths under ${API_BASE}/ws/. The
        # local /ws/ block has the same shape — long timeouts, buffering off
        # — required for a persistent /ws/live socket.
        FEED_API_BLOCKS="${FEED_API_BLOCKS}
    # Feed slot ${SLOT}: ${FEED_NAME} - WS proxy
    location ${API_BASE}/ws/ {
        set \$feed${SLOT}_ws ${API_HOST};
        rewrite ^${API_BASE}/ws/(.*)\$ /ws/\$1 break;
        proxy_pass http://\$feed${SLOT}_ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_connect_timeout 10s;
        proxy_buffering off;
    }
"

        # Generate nginx API proxy block
        FEED_API_BLOCKS="${FEED_API_BLOCKS}
    # Feed slot ${SLOT}: ${FEED_NAME} - API proxy
    location ${API_BASE}/ {
        limit_req zone=track_api_limit burst=20 nodelay;
        limit_req_status 429;
        set \$block_query 0;
        if (\$arg_max_tracks ~ \"^(1000[1-9]|10[1-9][0-9]{2}|1[1-9][0-9]{3}|[2-9][0-9]{4}|[0-9]{6,})\$\") {
            set \$block_query 1;
        }
        if (\$block_query = 1) {
            return 413;
        }
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_connect_timeout 15s;
        add_header X-RateLimit-Limit \"60/min\" always;
        add_header X-RateLimit-Burst \"20\" always;
        set \$feed${SLOT}_api ${API_HOST};
        rewrite ^${API_BASE}/(.*)\$ /\$1 break;
        proxy_pass http://\$feed${SLOT}_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods 'GET, OPTIONS';
        add_header Access-Control-Allow-Headers 'Origin, Content-Type, Accept';
    }
"

        i=$((i + 1))
    done
else
    echo "[feeds] No FEEDS_CONFIG provided - single feed mode"
fi

# Discover the current FAA chart cycle date from vfrmap.com so the sectional/
# IFR tile proxies stay valid through the next 56-day refresh. The cycle is
# embedded in vfrmap.com's frontend JS as `f='YYYYMMDD'`. Best-effort: if the
# scrape fails (no network at boot, vfrmap down), fall back to an empty value
# so sectional tiles 404 cleanly while every other basemap keeps working.
VFRMAP_CYCLE="$(curl -fsS --max-time 5 https://vfrmap.com/js/map.js?7 2>/dev/null \
    | grep -oE "f='[0-9]{8}'" | head -1 | grep -oE '[0-9]{8}' || true)"
if [ -n "$VFRMAP_CYCLE" ]; then
    echo "[vfrmap] FAA chart cycle: $VFRMAP_CYCLE"
else
    echo "[vfrmap] WARN: could not fetch chart cycle from vfrmap.com — sectional tiles will be unavailable until next restart"
fi
export VFRMAP_CYCLE

# Replace placeholders in nginx config with generated blocks
# First, replace basic environment variables
envsubst '${FEEDER_HOST} ${FEEDER_HOSTNAME} ${TRACK_API_HOST} ${ACARS_API_HOST} ${VOICE_STREAM_HOST} ${VOICE_EVENTS_HOST} ${VFRMAP_CYCLE}' < /etc/nginx/conf.d/default.conf > /etc/nginx/conf.d/default.conf.tmp
mv /etc/nginx/conf.d/default.conf.tmp /etc/nginx/conf.d/default.conf

# Then, insert dynamic feed blocks at placeholders
if [ -n "$FEED_DATA_BLOCKS" ]; then
    # Use awk to insert blocks (sed has issues with multiline)
    awk -v blocks="$FEED_DATA_BLOCKS" '{
        if (/### DYNAMIC_FEED_DATA_BLOCKS ###/) {
            print blocks
        } else {
            print
        }
    }' /etc/nginx/conf.d/default.conf > /etc/nginx/conf.d/default.conf.tmp
    mv /etc/nginx/conf.d/default.conf.tmp /etc/nginx/conf.d/default.conf
fi

if [ -n "$FEED_API_BLOCKS" ]; then
    awk -v blocks="$FEED_API_BLOCKS" '{
        if (/### DYNAMIC_FEED_API_BLOCKS ###/) {
            print blocks
        } else {
            print
        }
    }' /etc/nginx/conf.d/default.conf > /etc/nginx/conf.d/default.conf.tmp
    mv /etc/nginx/conf.d/default.conf.tmp /etc/nginx/conf.d/default.conf
fi

echo "[nginx] Configuration generated with $(echo "$FEED_DATA_BLOCKS" | grep -c 'location' || echo 0) remote feed(s)"

# Start background tile pre-caching (non-blocking)
# Only if tiles directory is writable (volume mounted)
if [ -d "/tiles" ] && [ -w "/tiles" ]; then
    echo "Starting background tile pre-cache..."
    precache_tiles &
else
    echo "Tile caching disabled (no /tiles volume mounted)"
fi

# Start nginx
exec nginx -g "daemon off;"
