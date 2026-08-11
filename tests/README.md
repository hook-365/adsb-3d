# ADS-B 3D — Test Suite

## Unit tests (Vitest)

The unit test suite lives in `frontend/tests-unit/` and runs via Vitest.
Most files run under Vitest's default `node` environment; files that touch
`window`/DOM APIs opt into `jsdom` per-file via a `// @vitest-environment
jsdom` pragma at the top (noted below).

```sh
cd frontend
npm install
npm run test         # run once
npm run test:watch   # watch mode
```

### Test files

| File | What it covers |
|------|---------------|
| `altitude-color.test.ts` | tar1090 altitude → color palette, bucketed cached lookups. |
| `altitude-curve.test.ts` | Altitude-curve bias/exponent warping used by the scene-height mapping. |
| `altline-arena.test.ts` | Fleet-wide instanced altitude-line arena (issue #6 draw-call batching). |
| `build-trail-up-to.test.ts` | Trail construction: time-slicing, altitude normalization, ground handling. |
| `diorama-clip.test.ts` | Diorama clip-box plane math shared across XR desk-ornament materials. |
| `elevation.test.ts` | Terrarium tile decoding and bilinear elevation sampling. |
| `feeds.test.ts` *(jsdom)* | Feed-config normalization/validation, trail-cap/backfill policy, initial-feed selection, boot pipeline. |
| `filter.test.ts` | Aircraft list/scene visibility filter + search query singleton. |
| `health.test.ts` | Live/ACARS connection-health classification. |
| `historical.test.ts` | Historical playback interpolation helpers (`pickNumeric`, `pickAngle`, resolution auto-selection). |
| `i18n.test.ts` | Locale key-parity drift guard against the English source of truth. |
| `icon-instances.test.ts` *(jsdom)* | Instanced ground-icon pool bucketing and per-frame commit. |
| `live.test.ts` *(jsdom)* | `applyWsMessage` diff/snapshot mutation; `LiveFeed` WS-first/HTTP-fallback transport. |
| `normalize.test.ts` *(jsdom)* | Raw-aircraft normalization: drop rules, altitude ladder, dbFlags, `deriveEmergency`. |
| `parse-points.test.ts` | Historical sample parsing with forward-inherited altitude. |
| `reconciler.test.ts` *(jsdom)* | `AircraftReconciler` entry lifecycle, rev-gating, emergency ring, selection handoff, filter visibility, `positionOf`. |
| `scope.test.ts` | `createScope` lifecycle/teardown helper. |
| `settings-panel.test.ts` *(jsdom)* | Settings-schema parity drift guard. |
| `shape-features.test.ts` *(jsdom)* | tar1090 shape catalog + procedural 3D feature annotations drift guard. |
| `store.test.ts` | `AircraftStore` — trails, rev-gating, trail caps, altitude inheritance, stationary dedup. |
| `theme.test.ts` | Theme-token parity drift guard against the reference theme. |
| `time-context.test.ts` | Live/historical time-context singleton: cursor clamping, playback tick, rate. |
| `url-state.test.ts` *(jsdom)* | URL deep-linking: selected-hex hash, historical time-state query params. |
| `xr-locomotion.test.ts` | VR pivot-rotation rigid-transform regression coverage. |
| `xr-wrist-menu.test.ts` | Settings-parity drift guard for the VR wrist menu. |

CI runs `npm run typecheck && npm run test && npm run build` on every PR.

## Playwright e2e

`frontend/tests-e2e/` holds browser end-to-end specs (WebXR session flows).
They run against a production build:

```sh
cd frontend
npm run build
npm run test:e2e
```

## Backend unit tests (pytest)

`track-service/` and `acars-service/` each carry a `tests/` directory of
pure-logic pytest coverage (WS diff gating, resolution/downsample math,
route-cache + circuit breaker, ACARS message parsing/coercion, hub-status,
etc.) plus their own `requirements-dev.txt` and `pytest.ini`. Both services
name their module `main.py`, so always run pytest from inside one service's
directory — never in a single session spanning both:

```sh
cd track-service
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest

cd ../acars-service
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest
```

## Lint

```sh
cd frontend && npm run lint     # eslint flat config
ruff check track-service acars-service   # from the repo root
```

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

## Manual end-to-end checklist

See `docs/PRODUCTION-CHECKLIST.md` for the full pre-release checklist covering
browser compatibility, deployment scenarios, feeder compatibility, and optional
feature verification (historical, ACARS, voice).
