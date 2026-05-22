# CLAUDE.md

Orientation for an AI assistant working in this repo. Project-specific only —
no deployment/homelab details (those live in env vars and `.env`, never here).

## What this is

ADS-B 3D — real-time 3D visualization of ADS-B aircraft traffic. A single
nginx Docker image serves a Vite / TypeScript / Three.js frontend and reverse-
proxies a user-supplied ADS-B feeder plus two optional FastAPI services. The
frontend uses **no framework** — DOM and Three.js directly.

Three feature tiers, all optional and off by default: historical playback
(needs `track-service` + TimescaleDB), ACARS messages (needs `acars-service`),
and a VHF voice scanner (needs an external voice-services stack).

## Repo layout

- `frontend/` — Vite + TS + Three.js app (~37 modules under `src/`). Built to
  static assets, served by nginx.
- `track-service/` — FastAPI + asyncpg. Live WebSocket diff stream + a
  historical-data collector writing to TimescaleDB.
- `acars-service/` — FastAPI bridge to an external acarshub TCP JSON feed.
- `nginx/` — reverse-proxy + static-host config templates.
- `Dockerfile` + `entrypoint.sh` — single image. The entrypoint renders
  `config.js` (frontend runtime config) and the nginx config from environment
  variables at container start.
- `docs/` — `VOICE.md`, `REVERSE-PROXY.md`, `PRODUCTION-CHECKLIST.md`.

## Frontend architecture

The defining pattern is **inverted dataflow + a reconciler**:

- `aircraft/store.ts` (`AircraftStore`) is the single source of truth for
  aircraft state.
- `aircraft/reconciler.ts` runs once per frame: it diffs the store against the
  Three.js scene and creates / updates / removes a per-aircraft `Group` (cone,
  ground icon, altitude line, trail, CSS label, rings). **The reconciler owns
  the aircraft scene graph — do not add or remove aircraft objects elsewhere.**

State is shared via **subscribe-pattern singletons**: a module-level singleton
exposing `getX()` / `updateX()` / `subscribeX()` backed by a listener `Set`.
No reactivity library. Examples: `core/settings.ts`, `core/time-context.ts`,
`core/filter.ts`, `feed/feeds.ts`, `feed/voice-calls.ts`,
`aircraft/acars-store.ts`.

`src/` directories:
- `core/` — `settings`, `filter`, `time-context`, `units`, `coords`,
  `url-state`, `config`, `types`.
- `feed/` — data sources: `live`, `historical`, `history`, `acars`, `routes`,
  `feeds` (multi-feed switching), `voice-calls`, `normalize`.
- `aircraft/` — `store`, `reconciler`, `shapes` (vendored tar1090 catalog),
  `acars-store`.
- `world/` — `scene`, `controls` (Three.js OrbitControls), `tiles` (basemap),
  `labels`, `heatmap` (3D airway-density).
- `ui/` — DOM panels: `aircraft-list`, `aircraft-detail`, `settings-panel`,
  `time-controls`, `voice-panel`, `acars-browser`, `feed-selector`, etc.
- `interaction/` — `picking` (raycaster).
- `main.ts` — wires everything together at boot.

### Adding a setting

1. Add the key to `Settings` + `DEFAULTS` in `core/settings.ts`.
2. Add a row to `SETTINGS_SCHEMA` in `ui/settings-panel.ts`.
3. React to it where it matters via `subscribeSettings()`.

Settings persist to `localStorage` and are merged against `DEFAULTS` on load,
so a payload from an older version never drops new keys.

## Backend services

- `track-service` — a feeder-fetch loop drives a `/ws/live` diff stream
  (snapshot on connect, then `{added, updated, removed}` diffs, periodic
  heartbeats carrying `feeder_age_s`) and a separate DB collector. REST
  endpoints for per-aircraft tracks, bulk timelapse, heatmap aggregation,
  stats, and adsb.im route lookup.
- `acars-service` — connects to an acarshub TCP JSON feed, decodes message
  labels, stores them in TimescaleDB, and exposes REST + a `/ws` push socket.
- Both run as a non-root user (uid `10001`) and declare a `HEALTHCHECK`.

## Configuration & runtime

All deploy-time config is environment variables. `entrypoint.sh` renders
`config.js` and the nginx proxy blocks from them at container start; disabled
features get dummy upstreams so the generated nginx config is always valid.

- Feature flags: `ENABLE_HISTORICAL`, `ENABLE_ACARS`, `ENABLE_VOICE` — all
  default `false`.
- Multi-feed: flat `FEEDN_*` env vars; the entrypoint synthesizes per-feed
  nginx proxy blocks. Slot 1 is always the local feed.
- The voice scanner is **call-based** (one audio clip per radio transmission)
  and **local-feed-only** — see `docs/VOICE.md`.

## Dev workflow

From `frontend/`:
- `npm run dev` — Vite dev server; proxies backend routes to
  `http://localhost:8080` (override with `DEV_BACKEND`).
- `npm run typecheck` — `tsc -b --noEmit`, strict.
- `npm run test` — Vitest, one-shot (`npm run test:watch` for watch mode).
  Unit tests live in `frontend/tests-unit/`.
- `npm run build` — `tsc -b && vite build` → `dist/`.

Full container against an existing backend:
`docker compose -f docker-compose.dev.yml --project-directory . up --build`.

Always run typecheck + test + build before considering frontend work done.

## Conventions

- Strict TypeScript; avoid `any`. Match the style of surrounding code.
- Cross-module state goes through a subscribe-pattern singleton, not imports
  of mutable module state.
- Three.js: share geometry/material across aircraft; give an entry its own
  instance only for what must animate independently.
- Never commit `.env` or real coordinates/hostnames/IPs. Examples use
  placeholder coordinates and TEST-NET (`192.0.2.x`) addresses.
- `frontend/src/aircraft/shapes-data.json` is vendored from tar1090 and is
  **GPL v2+**; the rest of the source is MIT.
