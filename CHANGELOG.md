# Changelog

All notable changes to ADS-B 3D are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

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
