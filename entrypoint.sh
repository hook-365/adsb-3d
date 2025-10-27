#!/bin/sh
set -e

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
        alt: ${ALTITUDE:-1234}
    },
    locationName: '${LOCATION_NAME:-}'
};

// ADSB configuration
window.ADSB_CONFIG = {
    BASE_PATH: AUTO_BASE_PATH
};

// Historical mode configuration
// When enabled, expects track-api service to be running
window.HISTORICAL_CONFIG = {
    enabled: ${ENABLE_HISTORICAL:-true}
};
EOF

echo "Generated config.js with location: ${LOCATION_NAME:-[no name set]} (${LATITUDE:-45.0000}, ${LONGITUDE:--90.0000}, ${ALTITUDE:-1234})"

# BASE_PATH configuration
if [ -n "${BASE_PATH}" ]; then
    echo "BASE_PATH explicitly configured: ${BASE_PATH}"
else
    echo "BASE_PATH will be auto-detected from URL (supports /3d, /adsb, /adsb-3d, or root)"
fi

# Historical mode configuration
if [ "${ENABLE_HISTORICAL}" = "false" ]; then
    echo "Historical mode disabled - running in live-only mode"
else
    echo "Historical mode enabled - Track API will be auto-detected at /api/health"
fi

# Parse FEEDER_URL to extract hostname for nginx
# Supports:
#   - FEEDER_URL=http://192.168.1.50:8080
#   - FEEDER_URL=http://ultrafeeder
#   - FEEDER_URL=https://adsb.example.com
# Falls back to FEEDER_HOST for backward compatibility
if [ -n "${FEEDER_URL}" ]; then
    # Extract hostname from URL (remove http://, https://, and any port/path)
    export FEEDER_HOST=$(echo "${FEEDER_URL}" | sed -e 's|^https\?://||' -e 's|/.*||')
    echo "Using feeder URL: ${FEEDER_URL} (extracted host: ${FEEDER_HOST})"
elif [ -n "${FEEDER_HOST}" ]; then
    # Backward compatibility: use FEEDER_HOST directly
    echo "Using feeder host (legacy): ${FEEDER_HOST}"
else
    # Default fallback
    export FEEDER_HOST=ultrafeeder
    echo "Using default feeder host: ${FEEDER_HOST}"
fi

# Set default TRACK_API_HOST if not provided (for nginx proxy)
export TRACK_API_HOST=${TRACK_API_HOST:-track-api:8000}
echo "Track API host for proxy: ${TRACK_API_HOST}"

# Replace environment variables in nginx config
envsubst '${FEEDER_HOST} ${TRACK_API_HOST}' < /etc/nginx/conf.d/default.conf > /etc/nginx/conf.d/default.conf.tmp
mv /etc/nginx/conf.d/default.conf.tmp /etc/nginx/conf.d/default.conf

# Start nginx
exec nginx -g "daemon off;"
