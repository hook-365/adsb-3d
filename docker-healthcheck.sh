#!/bin/sh
# Healthcheck for adsb-3d container.
# 1. Verify nginx is serving the /health endpoint.
# 2. Verify the aircraft data pipe returns parseable JSON.
#    An empty aircraft list is still healthy — planes may not be overhead.

# Step 1: Basic nginx liveness
curl -sf --max-time 5 http://127.0.0.1/health > /dev/null || exit 1

# Step 2: Aircraft data endpoint reachable AND returns valid JSON.
# Capture the body into a variable so curl's exit status is checked
# directly. A piped `curl | jq` would mask an upstream 502: curl -f
# emits an empty body, and `jq empty` exits 0 on empty input.
BODY=$(curl -sf --max-time 8 http://127.0.0.1/data/aircraft.json) || exit 1
printf '%s' "$BODY" | jq empty > /dev/null 2>&1 || exit 1

exit 0
