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
No reactivity library. Examples: `core/settings.ts`, `core/theme.ts`,
`core/time-context.ts`, `core/filter.ts`, `feed/feeds.ts`,
`feed/voice-calls.ts`, `aircraft/acars-store.ts`.

`src/` directories:
- `core/` — `settings`, `theme`, `filter`, `time-context`, `units`, `coords`,
  `url-state`, `config`, `types`.
- `feed/` — data sources: `live`, `historical`, `history`, `acars`, `routes`,
  `feeds` (multi-feed switching), `voice-calls`, `normalize`.
- `aircraft/` — `store`, `reconciler`, `shapes` (vendored tar1090 catalog),
  `shape-geometry` (extrudes silhouettes + merges procedural 3D features),
  `shape-features` (hand/auto-measured feature annotations per shape),
  `fuselage-profiles.json` (generated width profiles; regenerate by
  rasterizing silhouettes, do not hand-edit), `shape-lab` (dev-only tuning
  harness, `npm run dev` + `?shapeLab=1`), `acars-store`.
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

### Adding 3D detail to an aircraft shape

Silhouette markers are the tar1090 planform extruded thin, plus procedural
parts merged into one shared geometry per shape: a lofted fuselage tube
(width profile from `fuselage-profiles.json`), engine nacelles, tail fin,
rotors, and an optional `planformClip` band (used with a raised `tailplane`
on T-tails, since every drawing already contains a body-level stabilizer).

1. Add or edit the shape's entry in `aircraft/shape-features.ts`. All
   fields are fractions of the shape's own viewBox; read positions off the
   drawing (render it with a grid) so parts land on the drawn features.
2. Eyeball in the dev harness (`?shapeLab=1`) or live.
3. The drift-guard test (`tests-unit/shape-features.test.ts`, the one
   vitest file that runs under jsdom) checks catalog existence, fraction
   sanity, engine symmetry, and exact per-part triangle accounting.

Unannotated shapes keep the plain extrusion. The reconciler is untouched by
all of this: geometry stays one `BufferGeometry` per shape name.

### Adding a theme

Themes are `ThemeTokens` objects in `core/theme.ts`. Each defines ~25 base
hex colors; CSS uses `color-mix(in srgb, var(--token) NN%, transparent)` at
the use-site for all opacity variants, so a theme never has to enumerate
every tint. Three.js materials live under `three.*` on the token object
and are bridged in `world/scene.ts` + `aircraft/reconciler.ts` (sky,
range rings, home marker, trail/selection/emergency/ACARS-ping materials)
which subscribe and mutate `.color` in place — no scene rebuild on switch.
The altitude color ramp (`core/altitude-color.ts`) is **not** themed —
it's a data convention shared with the heatmap.

1. Add a `ThemeTokens` entry to `THEMES` in `core/theme.ts` (every key,
   including `three.*`). Copy `midnightGlassTokens` as a starting point.
2. Add a `THEME_OPTIONS` entry so the settings picker shows it.
3. The drift-guard test (`tests-unit/theme.test.ts`) will fail if any
   token is missing or extra.

### Adding a locale

UI strings live in `core/strings/<code>/` as per-namespace modules (one per
owning UI module; keys are flat and dot-prefixed, e.g. `detail.route`) and
are consumed via `t()` from `core/i18n.ts`. English is the source of truth
and the compile-time key registry. Static `index.html` markup translates via
`data-i18n` attributes applied once at boot. Changing the language reloads
the page. Aviation data (callsigns, airport names, ACARS payloads, aircraft
types, unit abbreviations) is deliberately not translated.

1. Create `core/strings/<code>/` mirroring the `en/` modules plus an
   `index.ts` merging them.
2. Register the locale in `LOCALES` in `core/i18n.ts`, extend
   `LanguageSelection` in `core/settings.ts`, and add a picker option in
   `ui/settings-panel.ts` (label in the language's own name).
3. The drift-guard test (`tests-unit/i18n.test.ts`) fails on missing/extra
   keys or `{placeholder}` mismatches against English.

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
  default `false`. `ENABLE_TERRAIN` (default `true`) is the deploy-level
  kill switch for 3D terrain; users also get a `terrain3d` settings toggle.
  Elevation comes from AWS Open Data terrarium tiles via the nginx
  `/tiles/terrain_rgb/` proxy; `world/elevation.ts` decodes and samples
  them, and everything altitude-shaped flows through `toScene()` so
  terrain follows the altitude-curve slider automatically.
- Multi-feed: flat `FEEDN_*` env vars; the entrypoint synthesizes per-feed
  nginx proxy blocks. Slot 1 is always the local feed.
- Security posture: nginx ships conservative security headers
  (`nginx/security-headers.conf`) and no CORS headers by default.
  `CORS_ALLOW_ORIGIN` (empty default) opts a specific origin — or `*` —
  back in; `TRUSTED_PROXY_CIDR` enables real-IP resolution so rate
  limiting keys on the client, not a fronting proxy. The entrypoint
  validates/escapes everything it renders into `config.js`, renders the
  nginx config from a pristine template each boot (`docker restart` is
  config-idempotent), and gates startup on `nginx -t`.
- The voice scanner is **call-based** (one audio clip per radio transmission)
  and **local-feed-only** — see `docs/VOICE.md`.
- **FAA chart tiles** (sectional, IFR, helicopter): `entrypoint.sh` scrapes
  `vfrmap.com/js/map.js` at boot to discover the current 56-day chart cycle
  date, exports it as `${VFRMAP_CYCLE}`, and envsubst bakes it into the
  nginx tile-proxy URLs. A scrape failure is non-fatal — the chart proxies
  fall through to 404 cleanly while everything else keeps working. The
  container needs an occasional restart (~monthly) to pick up new cycles.

## Dev workflow

From `frontend/`:
- `npm run dev` — Vite dev server; proxies backend routes to
  `http://localhost:8080` (override with `DEV_BACKEND`).
- `npm run typecheck` — `tsc -b --noEmit`, strict.
- `npm run test` — Vitest, one-shot (`npm run test:watch` for watch mode).
  Unit tests live in `frontend/tests-unit/`.
- `npm run lint` — eslint (flat config, includes type-aware
  `no-floating-promises` / `no-explicit-any` over `src/`).
- `npm run build` — `tsc -b && vite build` → `dist/`.

Backend: each service has a pytest suite (`cd track-service && pytest`,
same for `acars-service` — run per-service, both modules are `main.py`)
and `ruff check track-service acars-service` from the repo root.

Full container against an existing backend:
`docker compose -f docker-compose.dev.yml --project-directory . up --build`.

Always run typecheck + test + lint + build before considering frontend
work done.

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
