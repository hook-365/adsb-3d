# ADS-B 3D — Test Suite

## Unit tests (Vitest)

The unit test suite lives in `frontend/tests-unit/` and runs via Vitest.

```sh
cd frontend
npm install
npm run test         # run once
npm run test -- --watch   # watch mode
```

### Test files

| File | What it covers |
|------|---------------|
| `smoke.test.ts` | Module import smoke test — verifies key exports exist and basic types are correct. |
| `build-trail-up-to.test.ts` | Trail construction logic: time-slicing, altitude normalization, ground handling. |
| `store.test.ts` | `AircraftStore` — add/update/remove, `mergeHistory`, reconciler diffs. |
| `historical.test.ts` | `HistoricalFeed` playback cursor, interpolation, and `buildTrailUpTo` integration. |

CI runs `npm run typecheck && npm run test && npm run build` on every PR.

## Backend and deployment integration tests

`integration/` boots a deterministic public test stack with Docker Compose:

- a moving readsb-compatible `aircraft.json` fixture;
- a TCP ACARS fixture;
- TimescaleDB, track-service, and acars-service;
- the production viewer/nginx image in both live-only and full multi-feed modes.

The verifier exercises track ingestion and history, heatmap aggregation, ACARS
ingestion, schema creation, compression and retention policies, nginx routing,
feature flags, and multi-feed proxy generation. It then restarts both backend
services and repeats the suite to catch non-idempotent database startup.

Run it locally anywhere Docker Compose v2 is available:

```sh
tests/integration/run.sh
```

No receiver, radio hardware, credentials, or external service is required.
GitHub Actions runs the same command on public `ubuntu-latest` runners.

## Browser smoke test

`tests/smoke-test.html` is a legacy browser-based test page from the early
refactor phase. It can still be loaded against a running container to verify
that key DOM elements exist and the 3D scene initialises:

```
http://localhost:8086/tests/smoke-test.html
```

This is a manual sanity check only. For automated coverage, use the Vitest
suite above.

## Manual end-to-end checklist

See `docs/PRODUCTION-CHECKLIST.md` for the full pre-release checklist covering
browser compatibility, deployment scenarios, feeder compatibility, and optional
feature verification (historical, ACARS, voice).
