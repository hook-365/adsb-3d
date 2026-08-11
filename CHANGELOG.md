# Changelog

All notable changes to ADS-B 3D are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Fixed

- **VR/AR diorama interaction, from issue #6 hardware feedback (Quest 3,
  tyzbit).** Free-fly locomotion is pan-only while the diorama clip box
  is active — left-stick X/Y still slides the world under the fixed box,
  but right-stick height and turning are suppressed so the box floor and
  walls can't visibly move. Diorama clipping is now AR-only: it no
  longer activates in immersive-vr sessions, and the wrist-menu toggle
  is hidden there (desktop settings panel keeps the row, reworded to
  say AR). The diorama-size slider's floor dropped from 0.1 m to 0.03 m
  so the box can still be made smaller than the map at the lowest AR/VR
  zoom, where the old floor matched the map's minimum footprint exactly
  and clipping looked inert.

## [0.9.0] - 2026-08-11

### Added

- **`docker-publish` now gates image builds on frontend and backend
  checks.** `frontend-ci.yml` and `backend-integration.yml` gained
  `workflow_call:` triggers; `docker-publish.yml` calls both as
  `frontend-checks` / `backend-checks` jobs and every
  `build-and-push-*` job now `needs: [frontend-checks, backend-checks]`.
  Neither called workflow references secrets, so no `secrets: inherit`
  is needed.
- **CI: backend unit tests, lint jobs, container lint, Playwright e2e.**
  New `backend-ci.yml` runs pytest per-service (matrix over
  `track-service`/`acars-service`) plus a `ruff check` job.
  `frontend-ci.yml` gained parallel `lint` (eslint) and advisory `e2e`
  (Playwright, `continue-on-error`, cached browsers, uploads
  `test-results` on failure) jobs, plus a concurrency group. New advisory
  `container-lint.yml` runs shellcheck over the deploy scripts and
  hadolint over all three Dockerfiles.
- **eslint flat config (`frontend/eslint.config.js`) and `ruff.toml`.**
  ESLint: js/ts recommended (non-type-checked) across all frontend source
  and tests, plus a type-aware tier (`projectService`) over `src/**` only
  enabling `no-floating-promises` and `no-explicit-any`. `npm run lint`
  is clean with no rules downgraded — fixed the handful of trivial hits
  (two `prefer-const`, one unsafe non-null-asserted optional chain in a
  test). Ruff (default `E4,E7,E9,F` rule set, target py311) covers
  `track-service` and `acars-service`; fixed an unused `signal` import
  and two single-line `if:` statements in `track-service/main.py`. Both
  services' `requirements-dev.txt` gained `ruff~=0.7`.
- **Regenerated `tests/README.md`** with an accurate per-file unit-test
  table (jsdom files noted), Playwright e2e, backend pytest, and lint
  sections. Removed the legacy `tests/smoke-test.html` manual browser page,
  superseded by the Vitest/Playwright/pytest suites.
- **pytest suites for `track-service` and `acars-service`.** Pure-logic
  coverage: WS diff gating, resolution/downsample math, feeder-poll
  heuristics, the route cache + adsb.im circuit breaker, `ensure_utc`,
  and 4xx validation paths for `track-service`; ACARS message field
  mapping/coercion (including the `flight` whitespace/null fix), the
  `/labels` endpoint, and the WS hub-status payload for `acars-service`.
  Each service gets its own `requirements-dev.txt` + `pytest.ini`; both
  name their module `main.py`; run pytest from inside each service
  directory, never in one session across both.
- **Unit test coverage for `aircraft/reconciler`.** Real Three.js objects
  under jsdom (no WebGL) exercise entry build/remove/re-add, rev-gating
  (label refresh skipped on a `lastSeenMs`-only resync), the emergency
  ring, selection handoff — including the semantic that a removed
  *selected* aircraft keeps its selection mirror in the reconciler and
  gets `applySelection` re-applied through `syncFrame`'s re-entry branch
  when it reappears — filter-exempt selection, and `positionOf`.
- **Unit test coverage for `feed/feeds` and `feed/live`.** Covers feed-config
  normalization/validation, local-vs-remote trail-cap and backfill-window
  policy, initial-feed selection (URL param, stored id, stale-id cleanup,
  fallback), and the WS-first/HTTP-fallback live transport (connect
  timeout, reconnect/retry, feeder-age caching, snapshot/diff map
  mutation). `feed/live.ts` gained `applyWsMessage`, a pure export of the
  snapshot/diff mutation previously inlined in `ws.onmessage`.
- **Unit test coverage for `core/time-context`, `core/url-state`, and
  `feed/normalize`.** Replaces the Phase 0 smoke placeholder with real
  coverage of historical playback state transitions, URL deep-linking
  round-trips, and raw-aircraft normalization (drop rules, altitude
  ladder, dbFlags, emergency derivation).
- **Keyboard and screen-reader access for the aircraft list and ACARS
  browser.** The aircraft list (`#panel-list`) is now a proper
  `role="listbox"`: ArrowUp/ArrowDown move a virtual active row via
  `aria-activedescendant` (not roving tabindex — virtualized rows detach
  from the DOM as they scroll out and can't reliably hold browser focus),
  Enter/Space select through the same path as a click, and the active row
  is always scrolled into view first so it's actually mounted. Rows carry
  `role="option"`, a stable `id`, and `aria-selected`; virtualization
  spacers are `role="presentation"`. The ACARS browser dialog now saves
  and restores focus across open/close and traps Tab navigation within
  itself while open (`aria-modal="true"`). The aircraft-count HUD text
  gets a visually-hidden `aria-live="polite"` sibling, throttled to at
  most one announcement per 10s so a screen reader doesn't narrate every
  single in/out on a busy scope.

### Changed

- **`docker-compose.example.yml` aligned with `.env.example`.** The example
  `adsb-3d` service now loads an `.env` file (inline `environment:` still
  wins on a name collision), and mirrors `docker-compose.dev.yml`'s
  `security_opt: no-new-privileges:true` and `mem_limit: 192m`. Added a
  commented-out tiles volume for persisting the map tile cache / enabling
  boot-time pre-caching. `.env.example` now documents every deploy-relevant
  variable the entrypoint and both backend services actually read:
  `FEEDER_HOST` (legacy `FEEDER_URL` alias), `FEEDS_CONFIG` (raw-JSON
  alternative to `FEEDN_*`), `RETENTION_DAYS`, `FEEDER_POLL_SECONDS`, and
  `COLLECTION_INTERVAL`.
- **Frontend perf: settings persistence, detail panel, HUD, ground-chrome
  draping.** `core/settings.ts` debounces its localStorage write (~300ms,
  flushed immediately on `pagehide`/tab-hide) instead of writing on every
  call — `current` and listener fanout stay synchronous, only persistence
  trails behind. `ui/aircraft-detail.ts`'s settings subscriber now skips
  `render()` unless one of the four keys it actually reads (`acarsMessages`
  plus the three unit choices) changed. The per-frame aircraft-count HUD
  write in `main.ts` is now gated on the count actually changing.
  `world/scene.ts` coalesces bursts of elevation-tile decodes into one
  `drapeGroundChrome()` call per animation frame instead of one per tile.
- **Frontend perf: aircraft list sort and ACARS chip updates.**
  `ui/aircraft-list.ts`'s `recomputeSorted` now precomputes each row's sort
  key once (flight text, or a single `distanceFromHomeNm` call for the
  distance column) instead of re-deriving it inside every pairwise
  comparison of the sort. New ACARS messages no longer trigger a full
  list re-render — a mounted row's tag chips repaint directly from its
  recomputed mask, which also fixes ACARS chips previously appearing one
  data-tick late (the mask recompute was gated on the store's rev counter,
  which ACARS arrivals don't bump).
- **Frontend perf: reconciler pick layers, trail buffer disposal, windowed
  trails.** Pick proxies and the ground-icon `InstancedMesh` now live on a
  dedicated three.js render layer (`PICK_LAYER`), and both raycasters
  (`interaction/picking.ts`, `world/xr-controllers.ts`) scope to it — a
  click/tap/controller-select no longer triangle-tests every cone and
  silhouette mesh on scope, only the (few) pickable proxies. `growTrailBuffer`
  now allocates a fresh `LineSegmentsGeometry` on grow instead of rebinding
  attributes onto the live one, so the old interleaved buffers actually get
  disposed instead of orphaned. Trails under a length cap (settings.trailLength)
  now track a windowed start index into the store's trail array instead of
  slicing it down to the cap on every refresh — the tail-append fast path
  applies under a cap too, and the window only advances (forcing one rebuild)
  once enough head has actually expired (>64 points or >10% of the window).

### Fixed

- **`docker restart` no longer serves stale nginx config.** `nginx.conf`
  now ships as a pristine template (`/etc/nginx/templates/default.conf.template`)
  that entrypoint.sh renders fresh into `conf.d/default.conf` on every boot,
  instead of reading and overwriting `conf.d/default.conf` in place — the
  old approach consumed the `### DYNAMIC_FEED_DATA_BLOCKS ###` /
  `### DYNAMIC_FEED_API_BLOCKS ###` markers on first boot, so a plain
  `docker restart` silently kept whatever feed blocks (or lack thereof)
  happened to be rendered at image build time. The entrypoint now runs
  `nginx -t` before handing off to nginx, printing the last 50 lines of the
  rendered config and exiting 1 on failure instead of letting nginx itself
  fail with a buried error. The vfrmap.com chart-cycle scrape retries up to
  3 times (5s apart) before falling back to disabling sectional tiles for
  that boot.
- **Container healthcheck reflects viewer health, not feeder uptime.**
  `docker-healthcheck.sh` no longer probes `/data/aircraft.json`; it checks
  nginx liveness plus the presence of entrypoint-rendered `config.js`
  (`window.ENV_CONFIG`). A stale or rebooting feeder no longer flips the
  viewer container unhealthy and triggers an orchestrator restart of an
  otherwise-working viewer — feeder staleness is already surfaced in-app
  via `feeder_age_s` on WS frames.
- **track-service broadcast loop and collector no longer die silently.**
  `ws_broadcast_loop` tolerates a non-object feeder JSON body and non-dict
  aircraft entries instead of crashing the tick loop, and the whole
  fetch/diff/broadcast body is wrapped so one bad tick logs and continues
  instead of killing the loop for the container's lifetime. The collector's
  `run()` now restarts `collect_loop` with backoff (5s doubling to 300s)
  on an unhandled exception instead of exiting once. WS sends get a 2s
  per-socket timeout so a stalled browser tab can't hang the broadcast.
  `/health` now reports task liveness (`collector` and a new `broadcast`
  key) and returns 503 if either background task has actually died.
  Military-database JSON parsing (~15 MB) moved off the event loop via
  `asyncio.to_thread`.
- **Bounded DB pool acquisition.** `asyncpg.Pool.acquire()` has no default
  timeout at all (it waits forever, not the 30s a stale comment in
  track-service claimed) — every `acquire()` call in both track-service
  and acars-service now passes an explicit `DB_ACQUIRE_TIMEOUT` (10s;
  3s on `/health` so the 5s Docker healthcheck curl gets a real 503
  instead of hanging), which is what actually makes the existing
  `except asyncio.TimeoutError -> 503` handlers reachable.
- **Bounded expensive track-service queries.** `/tracks/bulk/timelapse`
  caps at `BULK_MAX_POSITIONS` (200k) rows via a deterministic
  `ORDER BY icao, time` + `LIMIT`, and reports `truncated` in the
  response stats when it hits the cap. `/heatmap` now rejects windows
  over 7 days outright, and over 24h when no `bbox` is given, instead of
  scanning the whole hypertable. `/stats/database` uses TimescaleDB's
  `approximate_row_count()` for the (large) `aircraft_positions` table
  instead of an exact `COUNT(*)`; the small `aircraft_metadata` table
  keeps its exact count.
- **Pydantic request models for track-service POST bodies.** `POST
  /aircraft/metadata/bulk` and `POST /route/batch` now validate their
  bodies against `MetadataBulkRequest`/`RouteBatchRequest` instead of a
  raw `dict` with manual `.get()`/`isinstance` checks. This also fixes a
  latent 500: a non-string entry in `callsigns` previously crashed
  `cs.strip()` inside the handler instead of failing request validation.
- **acars-service collector resilience.** Hub reconnects now back off
  exponentially with jitter (5s doubling to 300s) instead of hammering a
  down hub every 5s; the line-assembly buffer resets if it exceeds 1MiB
  with no newline in sight; messages flush on a 30s wall-clock timer as
  well as buffer-size, so a slow-arriving flight's messages don't sit
  stale; WS broadcast sends get a 1s per-client timeout so a stalled
  browser tab can't backpressure TCP ingest; and the collector's `run()`
  restarts `collect_loop` with backoff instead of exiting once on an
  unhandled exception. `/health` now reports collector status from task
  liveness rather than just the `running` flag.
- **acars-service type coercion + per-row insert fallback.** Hub JSON
  fields are now coerced through `_to_int`/`_to_float`/`_to_text` instead
  of stored raw, so a hub sending e.g. a string in a numeric field can't
  poison the batch insert. Fixes a latent crash on an explicit JSON
  `null` for `flight` (`data.get('flight', '').strip()` raises on `None`;
  now `(data.get('flight') or '').strip()`). A failed batch insert now
  retries row-by-row instead of dropping the whole batch, logging one
  summary line with per-row stored/dropped counts.
- **Frontend correctness batch.** Tile-layer disposal now flags the group
  before tearing it down, so a texture that finishes decoding after a feed
  switch or basemap change gets disposed instead of leaking onto the GPU
  (moved into `world/tiles.ts` as `disposeTileLayer`, shared by
  `world/scene.ts`). `feed/acars.ts` now tracks its settled transport the
  same way `feed/live.ts` does, fixing the 3s WS-connect-timeout HTTP
  fallback being dead code (it gated on the `ws` handle, which is already
  set while still `CONNECTING`). `feed/voice-calls.ts` now tears its
  socket, reconnect timer, and prune interval all the way down once every
  subscriber has gone away, and reconnects with exponential backoff +
  jitter instead of a flat 2s retry. The window resize handler no longer
  races `applyWindowSize()` for line-material resolution sync — it now
  runs as the last step of `applyWindowSize()` itself. Clipboard writes
  across `main.ts` and `ui/aircraft-detail.ts` no longer leave unhandled
  promise rejections, and the share button's original label is captured
  once at setup instead of risking a null/"Copied!" race on rapid clicks.

### Security

- **Env-driven CORS and trusted-proxy real IP.** The hardcoded wildcard
  `Access-Control-Allow-Origin: *` on `/data/`, `/api/`, `/voice/calls`, and
  `/acars-api/` (and the equivalent blocks generated per remote feed) is
  gone — CORS headers are now off by default (same-origin through nginx) and
  only sent when `CORS_ALLOW_ORIGIN` is set (validated against `*` or a
  single `http(s)://host` origin). `/api/` and `/acars-api/` now
  `proxy_hide_header` the FastAPI backends' own wildcard CORS headers so
  nginx's env-driven value is authoritative — a browser rejects a response
  with two `Access-Control-Allow-Origin` headers. New `TRUSTED_PROXY_CIDR`
  (comma-separated CIDRs, validated) configures `set_real_ip_from` +
  `real_ip_header X-Forwarded-For` + `real_ip_recursive on` so per-client
  rate limiting sees the real client IP when this container sits behind
  another reverse proxy; empty/off by default. The public tile/image proxy
  CORS headers (used for map imagery) are unchanged.
- **Security response headers on every route; constrained third-party image
  proxies.** nginx now sends `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: SAMEORIGIN`, `Content-Security-Policy: frame-ancestors
  'self'`, and `Referrer-Policy: strict-origin-when-cross-origin` on every
  response (new `nginx/security-headers.conf`, included from the server
  block and re-included in every location that sets its own `add_header`,
  since nginx's header inheritance is all-or-nothing per level). `nginx/http.conf`
  now sets `server_tokens off`. The legacy `/images/` and `/photos/` proxies
  (airport-data.com, planespotters.net) are now regex-constrained to actual
  image-file paths instead of proxying any path underneath them.
  `location = /images/sprites.png` still wins (nginx exact-match locations
  always take priority regardless of file order).
- **Docker base images pinned; frontend build uses `npm ci`.** `node:20-alpine`
  → `node:20.19-alpine`, `nginx:alpine` → `nginx:1.29-alpine`,
  `python:3.11-slim` → `python:3.11.13-slim` (track-service, acars-service).
  The frontend build stage now runs `npm ci` against the committed
  `package-lock.json` instead of `npm install`, so a build fails loudly on a
  missing/out-of-sync lockfile rather than silently drifting dependency
  versions. Alpine `apk` packages in the runtime image stay unpinned
  deliberately — Alpine repos drop superseded package builds, so pinning
  those breaks rebuilds within days.
- **Root-owned entrypoint and webroot.** The container no longer chowns
  `/entrypoint.sh`, the healthcheck script, or the served webroot to the
  nginx worker user — a compromised worker can no longer rewrite the
  root-executed entrypoint or persist injected JS in served assets. Only
  the tile proxy cache stays worker-writable.
- **`tests/` no longer ships in the image.** The test directory (smoke
  page, integration compose files, fixtures) was copied into the public
  webroot and fetchable by anyone.
- **`config.js` rendering is validated and escaped.** LATITUDE/LONGITUDE
  are validated numeric, FEED_MODE is a strict enum, BASE_PATH is
  shape-checked, booleans are normalized, and LOCATION_NAME/BASE_PATH are
  JS-escaped. Synthesized `FEEDN_*` feed JSON is now built with `jq`
  (proper escaping) and re-validated after synthesis, so a quote or
  script tag in a feed name can no longer break — or script — the page.
  Also fixes `FEED1_ALT` being ignored by `config.js` (it was computed
  before feed synthesis ran).
- **Remote strings escaped before `innerHTML`.** adsb.im route names,
  the feeder's verbatim `emergency` field, and voice-service call
  label/frequency now pass through a shared `escapeHtml` (new
  `ui/html.ts`); previously a hostile upstream could inject markup.

## [0.8.4] - 2026-08-11

### Changed

- **Trail length is now in minutes.** The slider steps through 0, 1, 2,
  5, 10, 15, 30, 60 minutes, and full, and truncation happens by sample
  timestamp instead of point count — "5 min" means five real minutes of
  history even for parked aircraft that sample sparsely. Stored
  point-based values from 0.8.0-0.8.3 migrate automatically.

## [0.8.3] - 2026-08-11

### Added

- **Diorama clipping (issue #6).** New "Diorama clipping" toggle + size
  slider (0.1-2.0 m): in VR/AR the airspace clips to an open-top box
  anchored where the scope is placed, so passthrough AR reads as a desk
  ornament. Zooming never moves the map vertically while the box is
  active, free-fly works in AR with the box on (the world slides under
  the fixed frame), and clipped-away aircraft can't be selected.
- **XR follow mode.** "Follow selected aircraft" toggle: the world
  slides horizontally so the selection holds position over the diorama
  (or wherever it was when follow engaged). Both new toggles also live
  on a new wrist-menu page 4.
- **Stereo info panel.** In desktop side-by-side stereo, selecting an
  aircraft shows a per-eye info card (callsign, type/operator, route,
  altitude with climb/descent, speed, heading, squawk, range) — DOM
  panels straddle the two halves and can't serve a phone viewer.

### Fixed

- The heatmap now mounts under the XR world root, so it moves and
  scales with the scene in VR/AR instead of floating in room space.
- The XR selection cone points down the laser instead of the controller
  body.
- Leaving VR/AR with diorama clipping enabled no longer leaves the
  desktop view clipped (appeared as a darkened, empty scope).

## [0.8.2] - 2026-08-10

### Fixed

- **C-5 Galaxy detail pass.** Four engine nacelles at the drawn pod
  positions (the drawn pods previously extruded as sawtooth teeth on
  the wing leading edges).
- **T-tail stabilizers are real planforms now.** The raised tailplane
  on the C-17, C-5, and Il-62 is a swept, tapered surface measured
  from each drawing instead of a rectangle, and the fins are shaped so
  the stab root seats fully on the fin tip chord (the C-17's met at a
  point weld; part of its stab hung behind the fin).
- **VR quality changes from the wrist menu now stick.** Mid-session
  changes are parked and applied when the session ends (the runtime
  allocates eye buffers at session start); previously they were
  silently dropped with a console warning.
- The "Can't change size while VR device is presenting" warning at
  session end is gone (window resize replay now waits for three's own
  session cleanup).

## [0.8.1] - 2026-08-10

### Fixed

- **C-5 and Il-62 T-tails were far too wide.** Both shapes' raised
  tailplanes were built from bad measurements of the drawn artwork
  (C-5: span 0.6 vs the drawn 0.26; Il-62: 0.56 vs 0.20, with the band
  placed past the drawing's edge), which made the tail read as a second
  main wing. Re-measured by rasterizing the silhouettes; the clip bands
  now remove the full drawn stabilizer and the raised tailplanes match
  the drawn footprint.

## [0.8.0] - 2026-08-10

### Added

- **History trails controls.** Trails can finally be turned off, and a
  new trail-length slider caps the rendered points per aircraft (50-600,
  or "full"). Render-side only — history keeps collecting, so re-enabling
  or lengthening restores instantly. The selected aircraft always shows
  its full trail. The trails toggle is also on wrist-menu page 3 in VR.

### Changed

- **Settings panel reorganized into collapsible sections.** The flat
  22-row scroll is now five groups — Appearance, Aircraft, Map,
  VR & Stereo, Units — each click-to-expand with the open/closed state
  remembered across sessions. Aircraft chrome (shape, trails, ground
  icons, altitude lines, labels) now lives together in one section, and
  map layers (basemap, 3D terrain, range rings, altitude curve) in
  another. A new drift-guard test ensures every setting has a panel row
  or a documented exclusion, so no future setting ships without UI.

### Fixed

- The WebXR e2e spec asserted `requiredFeatures` on session requests;
  the app has always requested `local-floor` as optional.

## [0.7.4] - 2026-08-10

### Changed

- **VR draw-call reduction (issue #6).** Quest profiling showed ~200
  aircraft producing ~3,000 draw calls at 17-19 fps regardless of the
  quality preset — the headset is draw-call bound, not fill-rate bound,
  and ground icons were the single biggest cost. Three changes, each
  benefiting desktop and stereo modes too:
  - **Instanced ground icons.** The per-aircraft silhouette sprite
    (one 72-triangle draped mesh + material each) is now an
    `InstancedMesh` pool with one draw call per active shape
    (~10-30 on a live scope instead of one per aircraft). Altitude
    tint + stale fade ride a per-instance RGBA attribute; terrain
    conformity is a planar tilt from a 3-sample surface normal
    instead of the old 49-sample per-vertex drape. Icon
    click-to-select still works via instanced raycast ids.
  - **Fleet-wide altitude lines.** All per-aircraft one-segment lines
    collapse into a single instanced `LineSegments2` (one draw call
    total).
  - **Invisible pick proxies no longer render.** The forgiving
    raycast spheres around each aircraft were fully transparent yet
    still drawn every frame in both eyes.
  Net: roughly 39% fewer draw calls on a 200-aircraft VR scene, with
  trails and marker bodies now the remaining candidates if more
  headroom is needed.

### Fixed

- Entering VR no longer spams "Can't change size while VR device is
  presenting" (window resizes are deferred until session end), and the
  CSS2D label LOD pass no longer burns CPU while presenting (labels
  are never rendered in-headset).

## [0.7.3] - 2026-08-10

### Fixed

- **Altitude colors rendered washed-out.** Three.js r152+ interprets
  `setHSL()` in the linear working color space by default, so every
  altitude-derived color (cones, trails, ground icons, labels, legend,
  heatmap) was gamma-encoded a second time on output and displayed
  paler than tar1090's CSS `hsl()` — high-altitude red-magenta came out
  pastel pink. All altitude ramp colors are now declared as sRGB, so
  the rendered palette matches tar1090 exactly. A round-trip test pins
  the sRGB behavior.

## [0.7.2] - 2026-08-10

### Changed

- **Exact tar1090 altitude palette.** The altitude color ramp was a
  3-stop approximation that pinned at magenta from 40,000 ft up; it now
  matches tar1090's `ColorByAlt` exactly: all nine hue stops (finer
  orange-to-yellow banding below 11,000 ft), 88% saturation, the
  per-hue lightness table, and the final magenta-to-red segment so
  50,000+ ft traffic reads red like it does on globe.adsb.fi. Applies
  to cones, trails, ground icons, labels, and the heatmap (which now
  shares the ramp instead of keeping its own copy). The footer legend
  extends to 50k+ ft, and ground aircraft are tar1090's dim grey
  instead of blue-grey. A drift-guard test asserts the published
  tar1090 values.

## [0.7.1] - 2026-08-10

### Added

- **Full-catalog feature audit.** Every applicable shape now carries
  all four passes (fuselage, wings, tail, vertical stabilizer): 26 more
  single fins across military, transport and delta types; twin-fin
  support (A-10 on its boom tips, F/A-18, F-15, F-35, Lancaster,
  Rutan winglets); real T-tails for the C-5 and Il-62; and the full
  fin-plus-four-turboprops treatment for the C-130.
- **Helicopters reimagined.** Drawn blades are clipped out of the slab
  so each type has a single chunky four-blade rotor riding a taller
  mast, plus a vertical tail rotor beside the boom tip. The Eurocopter
  Tiger, previously mis-filed as fixed-wing, is now a proper
  helicopter.
- **Inspection camera.** The orbit clamp is now ground-relative
  instead of target-relative, so a followed aircraft at altitude can
  be viewed from below while the camera still respects terrain; zoom
  minimum drops while following so a marker can fill the frame.

### Fixed

- A planform clip that legitimately empties the slab (Chinook) is no
  longer treated as a failure that restored the drawn blades.

## [0.7.0] - 2026-08-07

### Added

- **Procedural 3D aircraft detail.** Silhouette markers now build real
  bodies from the tar1090 drawings: a lofted fuselage tube following
  each silhouette's measured width profile (12 stations, generated from
  the artwork itself), engine nacelles with intake lips sitting on the
  drawn pods, swept tail fins, and helicopter rotor blades at each
  drawing's actual blade angles. 70 of the 92 catalog shapes are
  annotated; the rest keep the flat extrusion. Everything stays one
  shared geometry per shape, within the VR triangle budget.
- **A true T-tail for the C-17**: the drawn body-level stabilizer is
  clipped out of the planform and rebuilt atop the fin.
- **Camera follow polish.** Panning (drag or arrow keys) releases the
  follow while keeping the selection; orbit and zoom stay locked on the
  plane. Recenter with a plane selected resumes the chase instead of
  resetting home.
- **Minimizable aircraft card.** A minimize button collapses the detail
  card to a floating pill (callsign, altitude, speed) so the map stays
  usable while following; tap to restore. Localized in EN/DE/ES.

### Fixed

- **Late type data no longer leaves the wrong marker.** Shape
  resolution re-runs when enrichment arrives, so a helicopter appears
  as a helicopter without a page reload.
- **Phone HUD overlaps**: the voice chip drops to its own row below the
  header, and the new aircraft pill clears the bottom bar.

## [0.6.1] - 2026-08-05

### Fixed

- **AR free-fly no longer dislocates a placed scope.** In AR sessions
  that granted hit-test, movement is locked to scope style (scale and
  orbit); free-fly translation would slide the map off its real-world
  surface. Headsets without hit-test keep free-fly as their only
  manual-placement tool.
- **Headset performance in busy airspace.** Slowness at every quality
  preset means geometry-bound, not fill-bound: while presenting, trails
  now render at half point density capped to the most recent 300
  points. An `[xr] perf` console line (frame time, fps, draw calls)
  logs every 5 s in-session to guide further tuning.

## [0.6.0] - 2026-08-05

The VR/AR release, hardware-tested end to end on a Quest 3 by
[@tyzbit](https://github.com/tyzbit), who also recorded the demo video
now embedded in the README.

### Added

- **AR place mode.** AR sessions request WebXR hit-test; a wrist-menu
  "Place scope" row arms a gaze reticle that tracks real surfaces, and
  the next trigger pull parks the scope there (tables, beds, desks).
- **Paged, parity-guarded wrist menu.** Rows generate from a
  declarative spec (display / VR behavior / units, 14 settings) with a
  pager pinned to the bottom slot. A drift-guard test forces every
  Settings key onto the menu or into a documented exclusion list.
- **Per-eye stereo controls.** Side-by-side stereo now renders the
  selected-aircraft billboard in both eyes and adds an "Exit stereo"
  button per eye half for WayVR / crossed-eye viewing.
- **Fat lines.** Altitude lines and trails render as real thick lines
  (LineSegments2), width scaled to render resolution, killing the 1px
  shimmer on supersampled headset buffers.
- **Measured render-resolution readout.** The VR quality row shows the
  actual per-eye pixels the runtime granted last session, so "would a
  higher preset help" is answerable (spoiler: ultra outruns the panel).
- **Separate AR world scale.** AR spawns 10x smaller than VR (a
  diorama sharing a furnished room), persisted independently, driven by
  the same thumbstick gesture, shrinkable to about a foot across.
- **Mobile bottom sheet.** On phones the aircraft detail card is a
  fixed-height sheet over the footer: map always visible, content
  scrolls inside, photo docked beside the airframe grid at its natural
  aspect ratio, compacted spacing throughout.

### Fixed

- **Orbit rotation mirrored around the wrong point** (issue #6 VR#8):
  the turn math rotated position and yaw in opposite directions,
  composing into an orbit around the pivot's reflection. Free-fly
  turning was corrupted by the same bug.
- **Free-fly feel**: yaw sense flipped to first-person expectations,
  vertical needs a deliberate mostly-vertical push (no more height
  drift mid-turn), and thumbstick zoom anchors on the selection or
  scope center instead of dragging the world sideways.
- **AR left-thumbstick freeze**: a settings write recolored the sky AR
  removes; the event system now isolates subscriber failures so one
  bad listener can never kill the render loop.
- **Controller cone off-center**: the cone now tracks gripSpace (the
  physical hand) while the laser stays on the aim ray.
- **Wrist menu missing its AR-only row at session start** (it only
  redrew on hover), and the recenter button teleporting to the desktop
  camera's position instead of the headset's.

### Changed

- **Flat mode grounds at the home field, not sea level.** Without 3D
  terrain, aircraft altitudes now render relative to the home field's
  elevation (clamped at the map plane), so a jet rolling out at a
  4,200 ft-elevation airport sits on the map instead of floating
  field-elevation-high above it. With terrain on, geometry stays true
  MSL. Docs now state explicitly that `ALTITUDE` and every `FEEDN_ALT`
  are feet MSL.

## [0.5.2] - 2026-08-03

### Fixed

- **3D-terrain polish for ground chrome.** Ground icons now drape over
  the terrain like the range rings do (segmented, heading-aware,
  shadow-style) instead of being sliced by slopes; the emergency ring
  rides the terrain rather than sea level; and an elevation tile
  arriving now re-anchors every aircraft immediately instead of leaving
  ground chrome at sea level until each aircraft's next data tick.

## [0.5.1] - 2026-08-03

### Added

- **Full-stack integration test suite + CI** (#9, contributed by
  @ValkyrieUK). A deterministic public Docker Compose stack — readsb and
  ACARS fixtures, TimescaleDB, both backends, the production nginx image
  in live-only and multi-feed modes — verified end to end on every push,
  including a backend restart to catch non-idempotent schema startup.

### Changed

- **track-service polls remote feeders every 5 s instead of every 1 s.**
  Heuristic default: docker-internal hostnames and non-global IPs keep
  the 1 s cadence; anything on the public internet gets 5 s — hammering
  someone else's home connection once a second around the clock was
  impolite. `FEEDER_POLL_SECONDS` overrides in either direction (needed
  for feeders behind local proxy containers or tunnels, which look
  local to the heuristic). WS heartbeats tighten to every 3 ticks on
  slow cadences so the frontend's staleness gauge keeps its margin.

### Fixed

- **Fresh installs silently ended up with no retention policy** (#9,
  contributed by @ValkyrieUK). asyncpg requires a timedelta for the
  `::interval` parameter, so `add_retention_policy` failed on clean
  database init; the service then restarted healthy with retention
  permanently missing. Existing databases were unaffected. A startup
  migration now detects the missing policy and adds it automatically,
  so upgrading to this release repairs affected databases on restart.
- The integration stack's timescaledb healthcheck probed the unix
  socket, which the postgres image's init-phase temporary server also
  answers — the suite raced its own backend on fast machines. Forced
  through TCP.

## [0.5.0] - 2026-08-03

A community-issues release — everything in it traces to a GitHub issue
(#6, #7, #8, #10).

### Added

- **Localization.** Every UI string now routes through a typed `t()`
  helper backed by per-namespace string tables (`core/strings/`).
  English ships as the source of truth, with machine-drafted German and
  Spanish awaiting native-speaker review (#10). The language setting
  (`Auto` / English / Deutsch / Español) follows the browser locale by
  default, and a drift-guard test enforces key and `{placeholder}`
  parity across locales so translations can't silently rot.
- **Altitude scale slider** (#8). A continuous vertical-scale bias from
  low-altitude detail (square-root curve — pattern traffic spreads
  apart) through linear to high-altitude detail (squared — flight
  levels spread apart). Every position pins 45,000 ft to the same scene
  height, and the curve applies everywhere altitude becomes height:
  aircraft, trails, historical playback, heatmap, terrain, VR.
- **3D terrain** (#7, opt-in). The basemap displaces to real ground
  elevation from AWS Open Data terrarium tiles (proxied + disk-cached
  like other basemaps, no API key; SRTM voids and glitch needles are
  sanitized). Range rings, their labels, and the home marker drape over
  the ground; ground icons and altitude-line feet anchor to terrain;
  the camera stays above the surface; the detail card gains an AGL
  readout where ground rises ≥100 ft. `ENABLE_TERRAIN=false` disables
  it deploy-wide.
- **VR comfort options** (#6). Two orthogonal settings, in the panel
  and on the wrist menu: movement model (*scope* — the world scales and
  orbits around you — vs *free-fly* — fly along your gaze, strafe,
  change height, grip+stick to scale) and turn style (30° snap vs
  smooth). B/Y cycles the selection through aircraft nearest-first and
  swings the view to face each one.

### Fixed

- **AR froze on any settings change** — most visibly the left
  thumbstick (#6). The theme pipeline tried to recolor the sky that
  passthrough removes, and the throw killed the XR frame loop. The
  settings/theme subscriber fan-outs now isolate exceptions so one bad
  listener can never freeze rendering again.
- A/X recenter teleported the world to the desktop camera's position
  ("pressing A makes the screen go all black"); it now derives the pose
  from the actual headset.
- The wrist-menu Labels row was a no-op in headsets (it toggled the
  hidden DOM labels); it now governs the floating aircraft billboard,
  which also enforces a minimum angular size so it stays readable at
  distance. AR keeps the basemap visible as a floating diorama, and VR
  starts at table height instead of a distant disc.

## [0.4.0] - 2026-05-28

A frontend + backend performance and UX push. The headline goal was
to make the Europe / Hetzner feed (~1500 contacts) feel as snappy
as the local feed in both initial load and steady state, and to
let survey aircraft and loitering tankers keep their full in-scope
trails instead of being cut off at 10 minutes.

### Added

- **Click to extend trail.** Selecting any aircraft now lifts its
  per-hex trail cap and triggers a 24 h history backfill, so a
  single survey orbiting an airfield gets its full pattern even on
  a busy feed. The per-hex cap survives the aircraft dropping out
  and reappearing within the session.
- **URL deep-link isolation.** Loading a shared `#hex` link now
  also applies that hex as the search query, so the recipient
  lands on just that aircraft and its trail. Clearing the search
  box brings the rest of the fleet back.
- **Per-feed trail policy.** The local feed defaults to unlimited
  trail length with a 4 h history backfill window, so survey
  aircraft and loitering tankers keep their full in-scope history.
  Higher-density feeds keep the conservative 600-point cap and
  30 min backfill.
- **Stationary sample dedup.** Aircraft that haven't moved past the
  jitter threshold only sample once per minute instead of once per
  second, so a parked aircraft over 12 hours accumulates ~720
  trail points instead of ~43k.
- **Altitude inheritance.** The Aircraft record carries an
  `altFtKnown` flag and the store keeps a per-hex last-known
  altitude cache; transient frames that lack `alt_baro` and
  `alt_geom` substitute the prior good altitude instead of
  snapping the cone to ground. Historical backfill does the same
  forward-inheritance walk during `parsePoints`.

### Changed

- **Aircraft list is now virtualized.** Only rows inside the
  scroll viewport (plus a small overscan) get real DOM. Initial
  load on Europe is dramatically faster and scroll feels native
  at any fleet size. Filter / sort / search changes re-target
  scroll to keep the selected row in view; snapshot-only updates
  leave scrollTop alone.
- **Search filters the map.** Typing in the panel search box
  now hides non-matching aircraft from the scene as well as the
  list, matching the behavior of the MIL / GROUND / AIR / EMERG
  filter buttons. Selected aircraft are exempt.
- **Lazy-loaded feature modules.** The voice panel, historical
  playback, heatmap layer, and ACARS browser modal are dynamic
  imports now. They no longer ship in the cold-load bundle for
  deployments (or sessions) that don't use them.
- **Browser tab title** reads `ADS-B 3D · {feed location}` and
  updates on feed switch.
- **Backend `track-service`.** `/tracks/{hex}` and
  `/tracks/bulk/timelapse` auto-downsample when `resolution=full`
  is requested over a window wider than 4 hours; targets ~7200
  points across the window, so a 24 h selection-extension call
  returns ~700 kB instead of ~8.6 MB. asyncpg pool `max_size`
  raised from 20 to 40 so multi-tab and bursty backfill traffic
  no longer pushes the acquire timeout.

### Fixed

- **Invisible-aircraft clicks.** Three.js's raycaster doesn't
  honor `Group.visible = false`, so invisible pick proxies inside
  filtered-out aircraft were still registering hits. Clicking on
  empty sky in MIL-filter mode no longer surfaces civilian
  aircraft hiding underneath.
- **Trails dipping to ground.** Transient upstream frames with
  no altitude data used to snap the cone and trail to zero
  altitude. The new altitude inheritance keeps the cone at its
  last known altitude through the gap, both live and on backfill.

### Performance

The reconciler is the biggest contributor; together these changes
take the steady-state per-frame cost on Europe from "noticeably
laggy" to "indistinguishable from local".

- Reconciler `syncFrame` gates per-aircraft work on per-hex `rev`
  counters from the store. Most frames find every aircraft at the
  same rev as last frame and skip the full refresh block.
- `altitudeColorCached` / `altitudeColorStyleCached` return shared
  `Color` instances and interned CSS strings bucketed by 250 ft
  altitude steps. `refreshTrail`, `refreshColor`, `refreshLabel`
  switched over, saving ~450 k `Color` allocations per second on
  a busy feed.
- Yaw quaternion math is cached against `lastTrackDeg` and shared
  between the cone and the ground icon.
- `updateLabelLOD` skips its per-entry pass when the camera hasn't
  moved past a small epsilon since the last call.
- Settings subscriber only walks the entry map when one of the
  three visibility-relevant keys actually flipped.
- **Label frustum culling.** Labels whose anchor is outside the
  camera view are flipped to `visible = false` so
  `CSS2DRenderer` skips them; a panned-in view on Europe does
  ~150 DOM transform writes per render instead of ~1500.
- **Growable + incremental trail buffers.** Trail buffer
  allocations grow by doubling as needed. A fast path appends
  only the new tail segments to existing buffer slots when the
  trail's first sample is unchanged. A selected aircraft with a
  multi-hour trail goes from rewriting the entire buffer every
  refresh to writing one new segment.

### Tests

127 → 145 unit tests across reconciler / store / filter / altitude
color / `parsePoints` altitude inheritance.

## [0.3.0] — 2026-05-27

### Added

- **WebXR (Phase 5 — passthrough AR)** — a second action button,
  *Enter AR*, requests an `immersive-ar` session on devices that
  support it (Quest 3, Vision Pro). In passthrough mode the basemap,
  sky, and fog all disappear so the headset's camera feed shows
  through — aircraft float in your living room. `WebGLRenderer` now
  constructs with `alpha: true` so the framebuffer can carry per-pixel
  transparency; `world.setPassthrough()` swaps the scene's clear
  state on session entry / exit. `XrState` gains `arSupported` and
  `presentingMode`; the button auto-disables on devices without AR
  support or when a VR session is already running.

- **WebXR (Phase 4 — comfort locomotion)** —

  - **Left thumbstick Y** scales `xrRoot` up and down on an
    exponential curve, persisted via a new `Settings.vrScale` (range
    0.001 to 1.0 — continent-on-a-desk to room-scale walking through
    the airspace).
  - **Right thumbstick X** snap-turns the world 30° around a vertical
    axis through the user's head. Edge-triggered: one snap per push,
    re-arms when the stick returns to centre. Comfort-first; no smooth
    rotation.
  - **Right A/X button** recenters `xrRoot` 1.5 m in front of and
    0.5 m below the headset, rotation reset to zero. Useful after
    physically wandering or after a snap-turn run.

  Input reads from `XRSession.inputSources[].gamepad` directly each
  frame — Three.js's `WebXRManager` doesn't surface gamepad axes /
  buttons on the controller `Group`s, so the new `world/xr-locomotion`
  module walks the session itself.

- **WebXR (Phase 3 — in-VR wrist menu)** — a canvas-backed plane
  attached to the left controller, tilted toward the eye like
  checking a watch. Five rows — *Theme*, *Basemap*, *Range rings*,
  *Labels*, *Alt lines* — each cycling or toggling its setting
  through the existing `updateSettings` / `setTheme` singletons.
  Redraws on every settings or theme change so the displayed value
  always matches reality.

  The right controller's laser hovers menu rows and the trigger
  activates them. `world/xr-controllers.ts` gained an optional
  `onSelectIntercept` callback so a hit on the menu suppresses the
  aircraft pick that would otherwise fire on the same press, plus a
  `getControllerByHandedness('left' | 'right')` getter so the menu
  can attach to whichever physical controller the XR runtime reports
  as the left hand (the index passed to `getController()` is just
  connect order; handedness arrives lazily on the `connected`
  XRInputSource event).

- **WebXR (Phase 2 — controllers + picking + world billboard)** —
  builds on Phase 1's session pipeline:

  - **Controllers** appear as small accent-tinted cones with a laser
    pointer line extending forward. Materials retint with the active
    theme. Both hands work identically. No `XRControllerModelFactory`
    dependency (would have pulled a runtime CDN profile fetch) — the
    cones convey "you're holding something" without it.
  - **Aircraft picking** — squeezing the trigger raycasts from the
    controller against the same `aircraft-pick` proxies the mouse
    raycaster already uses. First aircraft hit becomes selected;
    triggering in empty space deselects. Routes through the existing
    `applySelection()` so the reconciler, follow-camera, URL state,
    and detail-panel state all stay in sync.
  - **World-space billboard** — Sprite + canvas hovering above the
    selected aircraft. Shows callsign / registration / type / altitude
    / speed / heading / emergency badge. Theme-aware (retints on
    theme change); only redraws when the underlying data actually
    changes, not per frame.
  - **Tabletop scale** — `xrRoot` is now scaled to 0.01 (1 NM = 1 cm)
    and positioned 1.5 m in front of the user at chest height when a
    session starts; restored to identity on exit. Without this Phase 2
    would have been unusable — controllers report poses in real
    metres while the scene is in NM. Phase 4 will turn this into an
    interactive slider with comfort options.

- **WebXR (Phase 1 — viewing only)** — an "Enter VR" button in the
  Stereo / VR section of the settings panel opens an immersive WebXR
  session (`immersive-vr`, `local-floor` reference space) for any
  connected headset (Meta Quest, Vision Pro, Index, …). Phase 1
  delivers head-tracked viewing only — no controller input, no in-VR
  UI. The button auto-disables with an explanation when WebXR isn't
  supported.

  Implementation notes:

  - `core/xr.ts` — subscribe-singleton (matching `core/settings.ts` /
    `core/theme.ts`) that probes `navigator.xr.isSessionSupported`
    once at boot and owns the session lifecycle. Renderer is injected
    so `core/` stays free of Three.js imports.
  - `main.ts` render loop converted from `requestAnimationFrame` to
    `renderer.setAnimationLoop`, required for WebXR (the headset
    runtime drives frame timing at 72/90/120 Hz instead of the page's
    fixed 60 Hz). Branches on `renderer.xr.isPresenting` to bypass
    OrbitControls + StereoEffect during a session.
  - `world/scene.ts` adds an `xrRoot` group that wraps tile layer,
    range rings, cardinals, home marker, and aircraft root. Lights
    stay outside the group so lighting is scale-independent.
  - Settings panel gains a reusable `kind: 'button'` row type with an
    optional `subscribe()` for live label / disabled-state updates.
  - `body.xr-on` CSS class hides every DOM overlay while presenting so
    the mirror canvas reads as the unobstructed scene.

## [0.2.0] — 2026-05-27

### Added

- **Color themes** — five palettes selectable from a new "Theme" section at
  the top of the settings panel:
  - **Midnight Glass** (default) — the original cyan-on-navy glass look.
  - **Daylight** — high-contrast light mode with deep cyan accents; good
    for projector / daytime use.
  - **Sectional Chart** — FAA VFR aesthetic with parchment background,
    Class B magenta and Class C/D blue. Pairs naturally with the new
    sectional basemaps below.
  - **Phosphor CRT** — green-on-black radar/scope look with amber warnings
    and CSS-driven phosphor bloom on text.
  - **High Contrast** — WCAG-AA palette, zero blur, opaque black panels,
    pure-saturation accents.

  `Auto` (the default) follows `prefers-color-scheme` and flips between
  Midnight Glass and Daylight live as your system theme changes. Theme
  choice persists per browser via the existing `Settings` store. Three.js
  materials (range rings, selection ring, emergency halo, ACARS ping) update
  in place — no scene rebuild — so switching is instant. The altitude color
  ramp (`core/altitude-color.ts`) is deliberately **not** themed; it's a
  data convention shared with the heatmap.

- **FAA aeronautical chart basemaps** — five US chart layers served via
  [vfrmap.com](https://vfrmap.com): Sectional, Sectional + OSM road overlay,
  Helicopter, IFR Low enroute, IFR High enroute. Pick from
  `Settings → Display → Basemap`. US coverage only.

  The container discovers the current FAA 56-day chart cycle date at boot
  by scraping vfrmap.com's frontend JS, exports it as `${VFRMAP_CYCLE}`,
  and bakes it into the nginx tile-proxy URLs via envsubst. Scrape failure
  is non-fatal (sectional tiles 404 cleanly while every other basemap keeps
  working). Restarting the container monthly keeps charts current; without
  a restart, tiles will start 404'ing after the upstream rotates (~8 weeks).

### Changed

- **`frontend/src/style.css` tokenized** — every color literal now reads
  from a `--token` CSS custom property, with opacity tints produced at
  use-site via `color-mix(in srgb, var(--token) NN%, transparent)`. Themes
  define ~25 base hex colors and every shade, border, and glow re-derives
  automatically. Zero visual change in Midnight Glass.

- **Theme tokens live in `core/theme.ts`** — singleton with `getTheme()` /
  `setTheme()` / `subscribeTheme()` matching the project's existing
  subscribe-pattern (see `core/settings.ts`, `core/filter.ts`). The token
  set is enforced across themes by a Vitest drift guard
  (`tests-unit/theme.test.ts`).

## [0.1.1] — 2026-05-22

### Fixed

- `HIDE_TOWER=true` now also hides the home-position marker on the map, not
  just the coordinate readout in the HUD — the receiver location is no longer
  pinpointed on the map when the flag is set.

## [0.1.0] — 2026-05-21

First public release of the rewrite. Replaces the original 14k-line
vanilla-JS monolith (`app.js`) with a typed, reconciler-driven architecture.

> **Upgrading from an earlier release?** There are breaking changes —
> `ENABLE_HISTORICAL` now defaults to `false`, `ENABLE_SATELLITES` is removed,
> and `ENABLE_VOICE=true` now requires `VOICE_STREAM_HOST` + `VOICE_EVENTS_HOST`.
> See the README's [Upgrading](README.md#upgrading) section for the full list.

### Added

- **TypeScript / Vite frontend** — ~30 modules under `frontend/src/`,
  replacing the pre-refactor `public/app.js` monolith. Strict TypeScript
  throughout; Vitest unit tests for core data-path logic.
- **Inverted dataflow + reconciler** — `AircraftStore` is now the single
  source of truth; a per-frame reconciler diffs it against the Three.js scene.
  Trail cleanup is deterministic and orphan-safe.
- **Historical playback** — time-controls strip with live / historical toggle,
  presets (last 1h / 24h / 7d), scrubber, play/pause, and 1× / 4× / 16× / 60×
  speed. Requires `track-service` + TimescaleDB (`ENABLE_HISTORICAL=true`).
- **3D airway-density heatmap** — every aircraft's recorded flight path rendered
  as altitude-colored `LineSegments` with additive blending over a user-selected
  time window. Highlights airways, approach corridors, and traffic patterns in 3D.
- **ACARS support** (`acars-service` bridge + frontend integration)
  - `acars-service` connects to an external acarshub TCP feed (port 15550),
    decodes labels, and stores messages in TimescaleDB.
  - Per-aircraft ACARS panel in the detail card, with OOOI flight-phase chip
    (taxi-out / airborne / taxi-in / at gate) derived from gate-out / wheels-off /
    wheels-on / gate-in timestamps.
  - Route override: ACARS-broadcast destination + ETA supersedes adsb.im when
    the datalink contradicts the public route database.
  - Full-page ACARS browser modal with search and label filter.
  - 3D ping ring in the scene when a message lands for an aircraft on scope.
  - Enabled with `ENABLE_ACARS=true`.
- **VHF voice scanner panel** — optional UI panel (top-right) for a companion
  rtl_airband + Icecast + voice-events stack. A *call feed*: every radio
  transmission is recorded as a discrete, channel-tagged audio clip. Scanner
  mode auto-plays calls as they land ("watch for the drop"); a live
  channel-activity strip shows per-channel transmissions; any past call is
  click-to-replay; the collapsed chip shows a green dot, pings on each
  transmission, and labels the playing channel + frequency. The web view keeps
  the last hour of calls. The panel is **local-feed-only** — it is not mounted
  on remote feeds, so it never implies ATC coverage you don't have. See
  `docs/VOICE.md`. Enabled with `ENABLE_VOICE=true`.
- **Camera panning controls** — arrow keys and right-mouse-drag pan the view
  across the map (`R` recenters); see the README Controls section.
- **Multi-feed switching** — flat `FEEDN_*` env vars; entrypoint synthesises
  per-feed nginx proxy blocks. In-place feed switch: HOME re-projects, basemap
  recenters, store clears, new WebSocket comes up — no page reload.
- **WebSocket diff stream** (`/ws/live`) — track-service pushes a snapshot on
  connect and per-tick `{added, updated, removed}` diffs. Frontend falls back
  transparently to direct readsb polling if the socket cannot connect.
- **Vitest unit tests** — `smoke.test.ts`, `build-trail-up-to.test.ts`,
  `store.test.ts`, `historical.test.ts` in `frontend/tests-unit/`.

### Changed

- Basemap tile layer now has six providers: dark, Carto Voyager, hillshade,
  topo, ESRI satellite imagery, and OSM.
- First-run defaults tuned for newcomers: the basemap now defaults to **dark**
  and per-aircraft ground icons are **on** out of the box — both still
  adjustable in Settings, and existing stored preferences are untouched.
- Detail card layout reorganised: planespotters photo, route row, autopilot/MCP
  data, ACARS chip, and click-to-copy callsign/hex all in a single card.
- Emergency squawks (7500 / 7600 / 7700) get a pulsing red ring and are pinned
  to the top of the aircraft list.
- URL state (`?mode=historical&from=…&to=…&t=…&rate=4`) captured by the share
  button; restored on page load.
- **`ENABLE_HISTORICAL` now defaults to `false`** (was `true`) — a fresh deploy
  with no `track-service` no longer shows a non-functional historical UI.
- `ENABLE_VOICE=true` now requires `VOICE_STREAM_HOST` + `VOICE_EVENTS_HOST`;
  the container fails fast with a clear error rather than generating an invalid
  nginx config.
- `track-service` and `acars-service` containers now run as a non-root user
  (uid `10001`); all images declare a `HEALTHCHECK`.

### Removed

- **Satellite tracking overlay** — CelesTrak TLE integration and
  `ENABLE_SATELLITES` env var removed from the frontend and entrypoint. No
  satellite code remains in the frontend source.
- Simplified terrain: OpenTopography 3D terrain loader (`terrain-loader.js`)
  from the legacy app is not present in the redesigned frontend; basemap tiles
  provide visual elevation context instead.
- Legacy monolith entry (`public/app.js`, `public/acars.js`,
  `public/tile-manager.js`, `public/theme-manager.js`) replaced by the Vite
  build output.

---

[Unreleased]: https://github.com/hook-365/adsb-3d/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/hook-365/adsb-3d/releases/tag/v0.1.0
