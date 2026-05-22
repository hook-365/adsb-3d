# Changelog

All notable changes to ADS-B 3D are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

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

[0.1.0]: https://github.com/hook-365/adsb-3d/releases/tag/v0.1.0
