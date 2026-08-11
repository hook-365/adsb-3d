#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
COMPOSE_FILE="$SCRIPT_DIR/compose.yml"
PROJECT_NAME="adsb3d-integration-${GITHUB_RUN_ID:-local}"

cleanup() {
    status=$?
    if [ "$status" -ne 0 ]; then
        docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" ps || true
        docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" logs --no-color || true
    fi
    docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" down --volumes --remove-orphans || true
    exit "$status"
}
trap cleanup EXIT INT TERM

docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" build
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" up -d --wait \
    timescaledb fixture-feeder fixture-acars track-service acars-service viewer viewer-live-only

echo "Running full-stack verification..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" run --rm integration-tests

echo "Restarting backend services to verify idempotent schema startup..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" restart track-service acars-service
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" up -d --wait track-service acars-service viewer

echo "Re-running verification after backend restart..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" run --rm integration-tests

echo "Checking viewer nginx config is idempotent across a restart..."
CONF_BEFORE=$(mktemp)
CONF_AFTER=$(mktemp)
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" exec -T viewer cat /etc/nginx/conf.d/default.conf > "$CONF_BEFORE"
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" restart viewer
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" up -d --wait viewer
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" exec -T viewer cat /etc/nginx/conf.d/default.conf > "$CONF_AFTER"
if ! diff -u "$CONF_BEFORE" "$CONF_AFTER"; then
    echo "FAIL: viewer's rendered nginx config changed after a restart (should be byte-identical)"
    rm -f "$CONF_BEFORE" "$CONF_AFTER"
    exit 1
fi
rm -f "$CONF_BEFORE" "$CONF_AFTER"
echo "PASS: viewer nginx config is identical before and after restart"
