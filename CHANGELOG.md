# Changelog

All notable changes to ADS-B 3D are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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
