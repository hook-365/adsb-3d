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

