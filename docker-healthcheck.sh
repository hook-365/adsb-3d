#!/bin/sh
# Healthcheck for adsb-3d container.
#
# Container health means: nginx is serving, and entrypoint.sh's rendered
# config is actually in place. It deliberately does NOT probe the feeder's
# aircraft.json — feeder staleness is surfaced in-app via feeder_age_s on
# WS frames (and the live-data poll), not via container health. A feeder
# reboot (or a slow upstream) must not make an orchestrator restart a
# viewer that is otherwise working fine.

# Step 1: Basic nginx liveness
curl -sf --max-time 5 http://127.0.0.1/health > /dev/null || exit 1

# Step 2: entrypoint-rendered config.js is present and looks real.
curl -sf --max-time 5 http://127.0.0.1/config.js | grep -q 'window.ENV_CONFIG' || exit 1

exit 0
