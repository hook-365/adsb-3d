# Changelog

All notable changes to ADS-B 3D are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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
