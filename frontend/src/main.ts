// Theme runs side-effects on import (applies tokens to :root). Keep this
// at the top so the first paint already carries the active palette and we
// don't flash the fallback values that live in :root in style.css.
import { setTheme } from './core/theme';
import { applyDomStrings, t } from './core/i18n';

// Translate index.html's static markup (data-i18n attributes) before any
// panel code reads or clones it. Dynamic strings go through t() at their
// call sites instead.
applyDomStrings();
import { Vector2, Vector3 } from 'three';
import { StereoEffect } from 'three/examples/jsm/effects/StereoEffect.js';
import { AircraftStore } from './aircraft/store';

// On user selection, lift the per-hex trail cap and refetch a much larger
// history window. Anchored at 24h since that comfortably covers any
// realistic in-scope flight; the track-service returns what it actually
// has so we never block on truly old data. The per-hex cap survives the
// aircraft dropping out and re-entering scope within the session.
const SELECTION_BACKFILL_MS = 24 * 60 * 60 * 1000;
import { AircraftReconciler, setLineResolution } from './aircraft/reconciler';
import { resolveAcarsPending, subscribeAcars } from './aircraft/acars-store';
import { getSettings, subscribeSettings, updateSettings, type VrQuality } from './core/settings';
import { getXrState, subscribeXr } from './core/xr';
import { setupXrControllers } from './world/xr-controllers';
import { XrBillboard } from './aircraft/xr-billboard';
import { setWristMenuActions, XrWristMenu } from './world/xr-wrist-menu';
import { XrArPlace } from './world/xr-ar-place';
import { faceWorldPoint, setupXrLocomotion } from './world/xr-locomotion';
import { distanceFromHomeNm } from './core/coords';
import { getActiveFeed, getFeeds, getFeedMode } from './feed/feeds';
import { createWorld } from './world/scene';
import { attachControls } from './world/controls';
import { createLabelRenderer } from './world/labels';
import { createAircraftList } from './ui/aircraft-list';
import { createAircraftDetail } from './ui/aircraft-detail';
import { attachPanelToggle } from './ui/panel-toggle';
import { mountFeedSelector } from './ui/feed-selector';
import { mountSettingsPanel } from './ui/settings-panel';
import { mountShapeChip } from './ui/shape-chip';
import { mountAltitudeLegend } from './ui/altitude-legend';
import { mountHud, refreshSubtitle } from './ui/hud';
// ACARS browser modal is loaded dynamically on first open click — most
// pageviews never open it, so the modal UI shouldn't bloat the cold-load
// bundle. The HUD chip and aircraft-list ACARS badges live in the main
// bundle (they're tiny and active whenever the active feed has ACARS).
import type { AcarsBrowserHandle } from './ui/acars-browser';
import { mountTimeControls } from './ui/time-controls';
// Voice panel module is loaded dynamically inside syncVoicePanel when
// the feature is enabled — it's a sizable chunk (audio decode + media
// session UI) that deployments without ENABLE_VOICE never need to ship.
import { attachPicking } from './interaction/picking';
import { setHome } from './core/config';
import { groundSceneY } from './world/elevation';
import { readSelectedHex, readTimeState, writeSelectedHex, writeTimeState } from './core/url-state';
import { getSearchQuery, setSearchQuery } from './core/filter';
import { initSession } from './app/session';
import {
  getTimeContext,
  setHistorical,
  subscribeTime,
  tickPlayback,
} from './core/time-context';

const hudAcars = document.getElementById('hud-acars') as HTMLElement;
const aircraftCount = document.getElementById('aircraft-count')!;
const frameRate = document.getElementById('frame-rate')!;
const canvas = document.getElementById('scene') as HTMLCanvasElement;

mountFeedSelector({ feeds: getFeeds(), active: getActiveFeed(), mode: getFeedMode() });
mountSettingsPanel();
mountShapeChip();
mountTimeControls();
mountAltitudeLegend();
mountHud();

const world = createWorld(canvas);
const controls = attachControls(world.camera, world.renderer);
const labelRenderer = createLabelRenderer();

// Side-by-side stereo rendering — Tier 1 of the VR support request
// (issue #6). No WebXR; just a split left/right-eye view that works on
// any display and feeds a Google Cardboard / phone VR headset. The
// CSS2D label layer is a single DOM overlay that can't be split per eye,
// so it's hidden while stereo is on. StereoEffect leaves the renderer
// viewport parked on the right half after each frame, so switching back
// to mono has to restore the full-frame viewport explicitly.
//
// `stereo-on` on <body> lets CSS drop chrome that can't be split per eye
// — notably the footer status bar, which spans both eye halves.
const stereoEffect = new StereoEffect(world.renderer);
function applyStereoMode(): void {
  const on = getSettings().stereo;
  labelRenderer.domElement.style.display = on ? 'none' : '';
  document.body.classList.toggle('stereo-on', on);
  if (!on) {
    world.renderer.setScissorTest(false);
    world.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  }
}
subscribeSettings(applyStereoMode);
applyStereoMode();

// Per-eye-half exit buttons (issue #6): stereo drops the footer and the
// settings gear only appears in one eye, so each half needs its own way
// back to mono — especially under WayVR / crossed-eye viewing where
// hunting for one-eyed chrome breaks the fused image. Shown via the
// body.stereo-on class, one centered in each half.
for (const side of ['left', 'right'] as const) {
  const exitBtn = document.createElement('button');
  exitBtn.type = 'button';
  exitBtn.className = `stereo-exit stereo-exit-${side}`;
  exitBtn.textContent = t('misc.exit_stereo');
  exitBtn.addEventListener('click', () => updateSettings({ stereo: false }));
  document.body.appendChild(exitBtn);
}

// Theme bridge: Settings owns persistence, theme module owns application.
// Apply once on boot to honor a stored preference, then re-apply on change.
// Deduped: updateSettings fires per-frame from XR thumbstick scaling, and
// re-running the whole theme pipeline (CSS vars, canvas redraws) each
// frame is pure waste when the selection hasn't moved.
setTheme(getSettings().theme);
let lastThemeSelection = getSettings().theme;
subscribeSettings((s) => {
  if (s.theme !== lastThemeSelection) {
    lastThemeSelection = s.theme;
    setTheme(s.theme);
  }
});

// XR controllers + billboard for Phase 2. Controllers attach to the
// scene (meter-space, outside xrRoot — they track the user's hands at
// real-world scale); the billboard lives inside xrRoot so it shrinks
// with the airspace and stays the right size relative to the cones.
// Controllers are inert until a session is presenting, so registering
// them eagerly at boot is fine.
const xrBillboard = new XrBillboard(world.xrRoot);
const xrWristMenu = new XrWristMenu();
// AR place mode (issue #6): armed from the wrist menu, a gaze reticle
// tracks real surfaces via hit-test and the next trigger drops the
// scope there. The menu row displays state it can't observe through
// settings, hence the explicit refresh after toggling.
const xrArPlace = new XrArPlace({
  renderer: world.renderer,
  scene: world.scene,
  xrRoot: world.xrRoot,
});
setWristMenuActions({
  toggleArPlace: () => {
    xrArPlace.toggle();
    xrWristMenu.refresh();
  },
  arPlaceActive: () => xrArPlace.isActive(),
});
const xrControllers = setupXrControllers({
  renderer: world.renderer,
  scene: world.scene,
  // Pick proxies are attached under aircraftRoot by reconciler.ts; the
  // raycast walks descendants so historical entries are pickable too.
  pickRoot: world.aircraftRoot,
  onPick: applySelection,
  // Right-hand trigger on the wrist menu must NOT also deselect — let
  // the menu absorb the press before aircraft picking runs. We only
  // arm the intercept for the non-left controller so the user can't
  // accidentally activate menu rows with the hand the menu is on.
  // (Handedness is unknown until 'connected' fires; before that we
  // let both controllers try — better to risk a stray menu hit than
  // to drop the very first press on a slow-reporting runtime.)
  onSelectIntercept: (controller) => {
    // Menu first — while place mode is armed, its own wrist-menu row must
    // stay reachable so the user can disarm without placing.
    if (xrControllers.getControllerByHandedness('left') !== controller) {
      if (xrWristMenu.trySelect(controller)) return true;
    }
    // Place mode swallows every other trigger: places when the reticle
    // has a surface, otherwise just guards against a stray deselect.
    if (xrArPlace.handleSelect()) {
      xrWristMenu.refresh();
      return true;
    }
    return false;
  },
  // Attach the menu to whichever physical controller turns out to be
  // the left hand. If handedness is 'none' (some 3DOF controllers
  // never report) the menu just won't attach — acceptable for v1.
  onHandednessKnown: (controller, h) => {
    if (h === 'left') xrWristMenu.attachTo(controller);
  },
});

// XR session class — hides DOM chrome while immersive, hides the CSS2D
// label layer (Three.js owns the WebGL canvas during a session and the
// DOM doesn't composite over the headset output anyway). Style rules
// keyed to `body.xr-on` live in style.css alongside the stereo-on ones.
//
// On session start the world is positioned chest-high in front of the
// user and scaled by Settings.vrScale (Phase 4 turned the fixed Phase
// 2 tabletop scale into a persisted setting; the left thumbstick
// drives it live via xr-locomotion). On end, transform is reset so
// the desktop view goes back to identity.
// Board-game placement (issue #6 feedback): table height and close enough
// to lean over, so the first thing you see is the airspace below you
// rather than a distant disc at eye level.
const VR_OFFSET_Y = 0.65;       // table height
const VR_OFFSET_Z = -0.9;       // 90 cm in front
// In a headset the camera near/far are metres. The desktop default of
// near=1 m clips anything you lean toward and eats the wrist menu, which
// rides ~0.3–0.5 m off your hand — reported as VR clipping + menu flicker
// (issue #6). Three.js copies the reference camera's near/far onto the
// XR array camera each frame, so lowering near here while presenting and
// restoring it on exit is all that's needed.
const VR_NEAR = 0.05;           // 5 cm — close-up geometry and the wrist menu stay visible
const DESKTOP_NEAR = 1;         // matches the PerspectiveCamera constructed in scene.ts
subscribeXr((s) => {
  document.body.classList.toggle('xr-on', s.presenting);
  if (s.presenting) {
    labelRenderer.domElement.style.display = 'none';
    world.camera.near = VR_NEAR;
    world.camera.updateProjectionMatrix();
    // AR keeps its own (10x smaller) scale — the diorama shares a real
    // room, VR fills an empty one (issue #6 hardware feedback).
    world.xrRoot.scale.setScalar(
      s.presentingMode === 'ar' ? getSettings().arScale : getSettings().vrScale,
    );
    world.xrRoot.position.set(0, VR_OFFSET_Y, VR_OFFSET_Z);
    world.xrRoot.rotation.set(0, 0, 0);
    // AR (passthrough) hides the basemap + sky + fog so the room
    // shows through. VR keeps the opaque sky as today. Passthrough
    // is also off for the desktop view that follows session end.
    world.setPassthrough(s.presentingMode === 'ar');
  } else {
    if (!getSettings().stereo) labelRenderer.domElement.style.display = '';
    world.camera.near = DESKTOP_NEAR;
    world.camera.updateProjectionMatrix();
    world.xrRoot.scale.setScalar(1);
    world.xrRoot.position.set(0, 0, 0);
    world.xrRoot.rotation.set(0, 0, 0);
    world.setPassthrough(false);
    // The wrist menu lives under the left controller; the controller
    // Group itself is recycled when the next session starts, but the
    // menu Mesh holds a stale parent ref. Detach explicitly so the
    // next 'connected' / onHandednessKnown re-attaches cleanly.
    xrWristMenu.detach();
    // A hit-test source doesn't survive its session; disarm place mode.
    xrArPlace.stop();
  }
});

// Live-apply vrScale changes while a session is active. The
// xr-locomotion module drives this via updateSettings on every frame
// the user is pushing the thumbstick; subscribing here keeps the
// wrist-menu display + persistence as the single source of truth.
subscribeSettings((s) => {
  if (world.renderer.xr.isPresenting) {
    world.xrRoot.scale.setScalar(
      getXrState().presentingMode === 'ar' ? s.arScale : s.vrScale,
    );
  }
  applyVrQuality(s.vrQuality);
});

// WebXR framebuffer supersampling. setFramebufferScaleFactor only takes
// effect when the next session's base layer is created, so applying it on
// every settings change (and once at boot below) means whatever the user
// picked is already in place by the time they tap Enter VR. 1.0 is the
// runtime's native recommended resolution; >1 supersamples for sharper
// distant aircraft (issue #6) at a GPU cost.
const VR_QUALITY_SCALE: Record<VrQuality, number> = {
  low: 0.7,
  balanced: 1.0,
  high: 1.4,
  ultra: 2.0,
};
let lastVrQuality: VrQuality | null = null;
// Quality changed from the wrist menu mid-session (issue #6): three warns
// and ignores setFramebufferScaleFactor while presenting, so park the
// value and apply it once the session ends — the next Enter VR gets it.
let pendingVrQuality: VrQuality | null = null;
function applyVrQuality(quality: VrQuality): void {
  if (quality === lastVrQuality) return;
  if (world.renderer.xr.isPresenting) {
    pendingVrQuality = quality;
    return;
  }
  lastVrQuality = quality;
  world.renderer.xr.setFramebufferScaleFactor(VR_QUALITY_SCALE[quality]);
}
applyVrQuality(getSettings().vrQuality);
subscribeXr((s) => {
  if (!s.presenting && pendingVrQuality !== null) {
    const q = pendingVrQuality;
    pendingVrQuality = null;
    // Next frame: our XrState flips before three's own session-end
    // cleanup clears isPresenting, so applying synchronously would still
    // hit the warning.
    requestAnimationFrame(() => applyVrQuality(q));
  }
});

const xrLocomotion = setupXrLocomotion({
  renderer: world.renderer,
  camera: world.camera,
  xrRoot: world.xrRoot,
  // In AR with hit-test, free-fly translation would slide a placed
  // scope off its real surface (issue #6) — force scope-style movement
  // there. AR devices without hit-test keep free-fly (their only way
  // to position the map manually). VR is unaffected.
  freeflyAllowed: () => getXrState().presentingMode !== 'ar' || !xrArPlace.isSupported(),
  // Orbit the selected aircraft when one is picked (matches the desktop
  // follow-cam), else fall back to the scope center. positionOf returns a
  // fresh Vector3 in xrRoot-local space; localToWorld maps it into the
  // world space the snap-turn maths runs in. reconciler/xrSelectedHex are
  // declared below but only read when a snap actually fires, long after boot.
  // B/Y: advance the selection through aircraft ordered by distance from
  // home, wrapping, then swing the world so the new target sits in front
  // of the headset (issue #6 control-scheme feedback).
  onCycleAircraft: () => {
    const ordered = [...store.snapshot.values()]
      .map((a) => ({ hex: a.hex, d: distanceFromHomeNm(a.lat, a.lon) }))
      .sort((p, q) => p.d - q.d)
      .map((p) => p.hex);
    if (ordered.length === 0) return;
    const idx = xrSelectedHex ? ordered.indexOf(xrSelectedHex) : -1;
    const nextHex = ordered[(idx + 1) % ordered.length]!;
    applySelection(nextHex);
    const local = reconciler.positionOf(nextHex);
    if (local) {
      faceWorldPoint(world.xrRoot, world.renderer.xr.getCamera(), world.xrRoot.localToWorld(local));
    }
  },
  getOrbitPivot: () => {
    if (!xrSelectedHex) return null;
    const local = reconciler.positionOf(xrSelectedHex);
    return local ? world.xrRoot.localToWorld(local) : null;
  },
});

const initialSelectedHex = readSelectedHex();

const store = new AircraftStore();
const reconciler = new AircraftReconciler(store, world.aircraftRoot, world.camera);

// Fat-line materials (altitude lines, trails) need the drawing-buffer
// size for their px→clip conversion. Keep it synced across resizes and
// XR sessions; the XR branch uses the measured per-eye layer size, which
// lands on XrState one frame after the session starts.
const lineResSize = new Vector2();
function syncLineResolution(): void {
  const xs = getXrState();
  if (xs.presenting && xs.layerResolution) {
    setLineResolution(xs.layerResolution.perEyeWidth, xs.layerResolution.height);
  } else {
    world.renderer.getDrawingBufferSize(lineResSize);
    setLineResolution(lineResSize.x, lineResSize.y);
  }
}
// Runs after scene.ts's own resize handler (registered first), so the
// drawing-buffer size is already updated when we read it.
window.addEventListener('resize', syncLineResolution);
subscribeXr(syncLineResolution);
syncLineResolution();

// Headsets are vertex-bound before they're fill-bound (issue #6: busy
// scenes chug at every quality preset), so presenting flips the
// reconciler into decimated-trail mode.
subscribeXr((s) => {
  reconciler.setXrMode(s.presenting);
  // Label LOD is skipped entirely while presenting (CSS2D never renders
  // in-headset); force a full pass on exit so opacities un-stale even if
  // the desktop camera hasn't moved.
  if (!s.presenting) reconciler.invalidateLabelLOD();
});

// ACARS messages from acarshub frequently arrive without an ICAO hex —
// just flight/reg. Each store snapshot, walk pending unresolved messages
// and reattach them to any aircraft whose callsign/reg now matches.
store.subscribe((snapshot) => resolveAcarsPending(snapshot));

// Visual ping on the 3D scene whenever an ACARS message lands for an
// aircraft on scope. Hex='' means "everything cleared" — skip those.
subscribeAcars((hex) => {
  if (!hex) return;
  reconciler.triggerAcarsPing(hex);
});

const aircraftList = createAircraftList(store);
attachPanelToggle(store);

// Voice scanner panel — VHF AM monitor. Opt-in via ENABLE_VOICE on
// the server (entrypoint.sh emits window.VOICE_CONFIG). When disabled
// the host div stays hidden and nothing is mounted so the chip never
// renders in deployments that don't have the voice-services stack.
const voicePanelHost = document.getElementById('voice-panel');
const voiceEnabled = Boolean(
  (window as { VOICE_CONFIG?: { enabled?: boolean } }).VOICE_CONFIG?.enabled,
);
// The voice scanner is the home station's own SDR — it only has audio for
// the local feed. Mount it only while the local feed is active; switching to
// a remote feed destroys it (chip gone, playback stopped) so it never implies
// ATC coverage for a location we don't actually monitor.
let voicePanelHandle: { destroy(): void } | null = null;
// Pending dynamic-import promise so concurrent syncVoicePanel calls
// (e.g. a rapid feed switch) coalesce to one chunk load and one mount.
let voicePanelMountPromise: Promise<void> | null = null;
function syncVoicePanel(): void {
  if (!voicePanelHost || !voiceEnabled) return;
  const showVoice = getActiveFeed().id === 'local';
  if (showVoice && !voicePanelHandle && !voicePanelMountPromise) {
    voicePanelHost.hidden = false;
    voicePanelMountPromise = (async () => {
      const { mountVoicePanel } = await import('./ui/voice-panel');
      // The active feed may have changed by the time the chunk finished
      // loading (user clicked away while we were fetching). In that case
      // do not mount — syncVoicePanel will be re-invoked on the next
      // switch and re-evaluate the condition.
      if (getActiveFeed().id === 'local' && voicePanelHost) {
        voicePanelHandle = mountVoicePanel(voicePanelHost);
      } else if (voicePanelHost) {
        voicePanelHost.hidden = true;
      }
      voicePanelMountPromise = null;
    })();
  } else if (!showVoice && voicePanelHandle) {
    voicePanelHandle.destroy();
    voicePanelHandle = null;
    voicePanelHost.hidden = true;
  }
}
syncVoicePanel();
const aircraftDetail = createAircraftDetail(store, {
  onClear: () => {
    aircraftList.setSelected(null);
    applySelection(null);
  },
});

// Camera follow: when an aircraft is selected, the orbit pivot eases toward
// its live position every frame (continuous damped pursuit, not a one-shot
// slide). When deselected, the pivot eases back to scene origin and stops.
const FOLLOW_LERP = 0.12;
const HOME_TARGET = new Vector3(0, 0, 0);
let followHex: string | null = null;
let returningHome = false;

// Pan breaks follow: a deliberate pan is the user asking to look somewhere
// else, so the pivot stops chasing the aircraft while the selection (and
// card) stay. Orbit and zoom never move the target, so target displacement
// over a gesture is the pan signature — and the follow lerp pauses during
// the gesture so it can't pollute the measurement. Recenter or re-selecting
// resumes the chase.
let controlsInteracting = false;
const targetAtGestureStart = new Vector3();
controls.addEventListener('start', () => {
  controlsInteracting = true;
  targetAtGestureStart.copy(controls.target);
});
controls.addEventListener('end', () => {
  controlsInteracting = false;
  if (followHex) {
    const dist = world.camera.position.distanceTo(controls.target);
    if (controls.target.distanceTo(targetAtGestureStart) > dist * 0.02) followHex = null;
  }
});

// On phones the aircraft list and detail panel both fight for the right
// edge — when an aircraft is selected, the detail card's close × ends
// up sitting over the list's sort headers / filter pills. Auto-collapse
// the list on small viewports so the detail card has the screen to
// itself; the user can reopen the list via the hamburger toggle.
const MOBILE_BREAKPOINT_PX = 768;

function autoCollapseListOnMobile(hex: string | null): void {
  if (window.innerWidth >= MOBILE_BREAKPOINT_PX) return;
  const panel = document.getElementById('aircraft-panel');
  const toggle = document.getElementById('panel-toggle');
  if (!panel || !toggle) return;
  if (hex) {
    panel.classList.add('collapsed');
    toggle.setAttribute('aria-expanded', 'false');
  }
}

// Tracks the current selection so the per-frame XR billboard update can
// look the aircraft up without piggybacking on aircraftDetail's internal
// state. Kept in sync inside applySelection().
let xrSelectedHex: string | null = null;

// Share-link solo view (the boot block below seeds the search box with the
// linked hex): remember the seeded value so the first deselect can dissolve
// the solo view along with the selection that justified it. Only an
// untouched seeded query is cleared — if the user has edited the search
// since, it's theirs and it survives.
let seededSearchHex: string | null = null;

function applySelection(hex: string | null): void {
  if (hex === null && seededSearchHex !== null) {
    if (getSearchQuery() === seededSearchHex) aircraftList.clearSearch();
    seededSearchHex = null;
  }
  xrSelectedHex = hex;
  reconciler.setSelected(hex);
  aircraftDetail.setSelected(hex);
  followHex = hex;
  returningHome = hex === null;
  writeSelectedHex(hex);
  autoCollapseListOnMobile(hex);
  if (hex) extendTrailForSelection(hex);
}

// Lift the per-hex trail cap to unlimited and trigger a 24h history
// backfill. Together these give the clicked aircraft full session-long
// trail coverage regardless of the feed's default cap — so a single
// survey orbiting an airfield on the Europe feed can be investigated
// without bumping the cap for the other ~1500 contacts.
function extendTrailForSelection(hex: string): void {
  store.setTrailCap(hex, Number.POSITIVE_INFINITY);
  session.refreshHistory(hex, SELECTION_BACKFILL_MS);
}

aircraftList.onSelect(applySelection);

// ACARS browser modal — clicking the HUD ACARS chip opens it. Lazily
// mounted on first open so deployments without ACARS-heavy use never pay
// for the modal UI. The handle is cached after first mount; subsequent
// opens just toggle().
let acarsBrowser: AcarsBrowserHandle | null = null;
let acarsBrowserMounting: Promise<AcarsBrowserHandle> | null = null;
function ensureAcarsBrowser(): Promise<AcarsBrowserHandle> {
  if (acarsBrowser) return Promise.resolve(acarsBrowser);
  if (acarsBrowserMounting) return acarsBrowserMounting;
  acarsBrowserMounting = (async () => {
    const { mountAcarsBrowser } = await import('./ui/acars-browser');
    acarsBrowser = mountAcarsBrowser({
      onSelectAircraft: (hex) => {
        if (!hex) return;
        aircraftList.setSelected(hex);
        applySelection(hex);
      },
      resolveHex: (msg) => {
        if (msg.icao) return msg.icao;
        if (!msg.flight && !msg.reg) return null;
        for (const a of store.snapshot.values()) {
          if (msg.flight && a.callsign === msg.flight) return a.hex;
          if (msg.reg && a.registration === msg.reg) return a.hex;
        }
        return null;
      },
    });
    return acarsBrowser;
  })();
  return acarsBrowserMounting;
}

hudAcars.addEventListener('click', () => {
  if (hudAcars.hidden) return;
  void ensureAcarsBrowser().then((h) => h.toggle());
});
hudAcars.style.cursor = 'pointer';
hudAcars.setAttribute('role', 'button');
hudAcars.setAttribute('tabindex', '0');
hudAcars.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    void ensureAcarsBrowser().then((h) => h.toggle());
  }
});

attachPicking({
  canvas,
  camera: world.camera,
  reconciler,
  onSelect: (hex) => {
    aircraftList.setSelected(hex);
    applySelection(hex);
  },
});

function recenterView(): void {
  // With a selection active, recenter means "back to the aircraft" — it
  // resumes the follow a pan broke rather than abandoning the selection.
  // Without one, it stays the classic home-view reset.
  if (xrSelectedHex) {
    followHex = xrSelectedHex;
    return;
  }
  applySelection(null);
  aircraftList.setSelected(null);
  world.camera.position.set(0, 220, 280);
  controls.target.set(0, 0, 0);
  controls.update();
}

// Pan the orbit centre across the ground plane — bound to the arrow keys so
// mouse-only users can move the view without a touchpad's two-finger drag.
// (Right-drag also pans, via OrbitControls.) Direction is relative to where
// the camera looks; the step scales with zoom so it feels consistent.
function panView(dx: number, dz: number): void {
  // Keyboard pan is as deliberate as a drag — it breaks the follow too.
  followHex = null;
  const forward = new Vector3().subVectors(controls.target, world.camera.position);
  forward.y = 0;
  if (forward.lengthSq() === 0) return;
  forward.normalize();
  const right = new Vector3(-forward.z, 0, forward.x);
  const dist = world.camera.position.distanceTo(controls.target);
  const step = Math.max(15, dist * 0.07);
  const move = new Vector3()
    .addScaledVector(right, dx * step)
    .addScaledVector(forward, dz * step);
  world.camera.position.add(move);
  controls.target.add(move);
  controls.update();
}

document.getElementById('recenter-btn')!.addEventListener('click', recenterView);

// Share button — copies the current URL (feed param + selected-hex hash)
// to the clipboard. Pairs with the click-to-copy callsign in the detail
// panel: "what feed, what aircraft" lands in someone's chat in two clicks.
const shareBtn = document.getElementById('share-btn') as HTMLButtonElement;
shareBtn.addEventListener('click', () => {
  void navigator.clipboard?.writeText(window.location.href).then(() => {
    shareBtn.classList.add('copied');
    const original = shareBtn.textContent;
    shareBtn.textContent = t('main.share_copied');
    setTimeout(() => {
      shareBtn.classList.remove('copied');
      shareBtn.textContent = original;
    }, 1100);
  });
});

// Keyboard shortcuts — only when the user isn't typing into an input.
document.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'r' || e.key === 'R') {
    recenterView();
    e.preventDefault();
  } else if (e.key === '/') {
    const search = document.getElementById('panel-search') as HTMLInputElement | null;
    search?.focus();
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    panView(0, 1);
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    panView(0, -1);
    e.preventDefault();
  } else if (e.key === 'ArrowLeft') {
    panView(-1, 0);
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    panView(1, 0);
    e.preventDefault();
  }
});

function applyWindowSize(): void {
  world.camera.aspect = window.innerWidth / window.innerHeight;
  world.camera.updateProjectionMatrix();
  world.renderer.setSize(window.innerWidth, window.innerHeight, false);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', () => {
  // The XR runtime owns the framebuffer while presenting — three refuses
  // setSize with a console warning, and headsets fire window resizes on
  // session entry. Dropped resizes are replayed on session end below.
  if (world.renderer.xr.isPresenting) return;
  applyWindowSize();
});
subscribeXr((s) => {
  // Next frame, not synchronously: our XrState flips before three's own
  // session-end cleanup clears isPresenting, and an immediate setSize
  // still triggers the "Can't change size while presenting" warning
  // (caught by tyzbit's issue #6 logs).
  if (!s.presenting) requestAnimationFrame(applyWindowSize);
});

// ────────────────────────────────────────────────────────────────────
// Session manager: owns live/historical bundles, feed switching, and
// health reporting (app/session.ts). main.ts only supplies the
// view-level hooks that touch the world/camera/panels.

const session = initSession({
  store,
  scene: world.scene,
  hooks: {
    onFeedChanged(next) {
      // Selection is per-feed — routes/airframes won't carry over.
      applySelection(null);
      aircraftList.setSelected(null);
      // Recenter the world: HOME mutates in place so coords/distances
      // immediately reproject to the new origin; the basemap tile mesh
      // coordinates were baked at construction time, so swap that layer.
      // Camera goes back to the default orbit so the first frame of the
      // new feed shows its tower from a predictable angle.
      setHome(next.home);
      world.recenter();
      world.camera.position.set(0, 220, 280);
      controls.target.set(0, 0, 0);
      controls.update();
      refreshSubtitle();
      // Voice scanner belongs to the local station only — show it for the
      // local feed, tear it down for remote feeds (no false ATC coverage).
      syncVoicePanel();
    },
    onEnterHistorical() {
      // ACARS browser stays open across mode switches if we don't close
      // it, leaving stale live messages visible during historical
      // playback. Lazily mounted — nothing to close if never opened.
      acarsBrowser?.close();
    },
  },
});

// Keep the URL's time-state params in sync with the time context.
subscribeTime((ctx) => writeTimeState(ctx));

// Initial URL → if it carries a historical window, enter that mode.
const urlTimeState = readTimeState();
if (urlTimeState && urlTimeState.window) {
  setHistorical(urlTimeState.window, urlTimeState.cursorMs ?? undefined);
}

if (initialSelectedHex) {
  aircraftList.setSelected(initialSelectedHex);
  applySelection(initialSelectedHex);
  // Shared link → solo view. Apply the hex as a search filter so the
  // rest of the fleet drops out of both the scene and the list, the way
  // it would if the recipient had typed the identifier into the search
  // box manually. The selected aircraft is exempt from passesFilter in
  // both the reconciler and the list (`isSelected || passesFilter(a)`),
  // so it stays visible regardless of the query. The recipient can
  // clear the search input at the top of the list panel to bring the
  // rest of the traffic back. Setting the input's .value programmatically
  // doesn't fire 'input', so we call setSearchQuery directly to push
  // the change into the filter singleton + list/reconciler subscribers.
  const searchInput = document.getElementById('panel-search') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.value = initialSelectedHex;
  }
  setSearchQuery(initialSelectedHex);
  seededSearchHex = initialSelectedHex;
}

let lastFrame = performance.now();
// XR perf telemetry accumulators (see the presenting branch in tick).
let xrPerfMs = 0;
let xrPerfFrames = 0;
let frames = 0;
let fpsAccumMs = 0;

// three's setAnimationLoop passes the XRFrame as the second argument
// while a session is presenting — the hit-test API (AR place mode) only
// exists on the frame object.
function tick(frameTime: number, xrFrame?: XRFrame): void {
  const dt = frameTime - lastFrame;
  lastFrame = frameTime;
  frames++;
  fpsAccumMs += dt;

  // Advance the historical playback cursor when playing. tickPlayback
  // emits a time-context change, which the session manager funnels into
  // historicalFeed.setCursor — which re-emits a synthetic snapshot.
  const ctx = getTimeContext();
  if (ctx.mode === 'historical' && ctx.playing) {
    tickPlayback(dt);
  }
  if (fpsAccumMs >= 500) {
    const fps = (frames * 1000) / fpsAccumMs;
    frameRate.textContent = `${fps.toFixed(0)} fps`;
    frames = 0;
    fpsAccumMs = 0;
  }

  // Ground-relative orbit clamp: the stock maxPolarAngle stops at the
  // horizontal plane through the TARGET, which is needlessly strict when
  // the target is an aircraft at altitude — you could never see a belly.
  // Instead allow the orbit to dip as far below the target's horizon as
  // terrain clearance at the current distance permits: camera height is
  // target.y + dist*cos(polar), so the ground constraint solves to an
  // acos. On a ground-level target this lands at (just under) the classic
  // horizon clamp, so map browsing is unchanged. The hard camera-height
  // clamp below stays as the backstop for damping overshoot.
  if (!world.renderer.xr.isPresenting) {
    const t = controls.target;
    const dist = Math.max(world.camera.position.distanceTo(t), 0.001);
    const headroom = t.y - (groundSceneY(t.x, -t.z) + 1.2);
    const cosMax = Math.max(-1, Math.min(1, -headroom / dist));
    controls.maxPolarAngle = Math.min(Math.PI - 0.15, Math.acos(cosMax) - 0.02);
    // Inspection zoom: while following an aircraft the minimum distance
    // drops so the marker (5.5-unit footprint) can fill the view; free
    // map browsing keeps the original floor.
    controls.minDistance = followHex ? 8 : 30;
  }

  if (followHex && !controlsInteracting) {
    const pos = reconciler.positionOf(followHex);
    if (pos) controls.target.lerp(pos, FOLLOW_LERP);
  } else if (returningHome) {
    controls.target.lerp(HOME_TARGET, FOLLOW_LERP);
    if (controls.target.lengthSq() < 0.01) {
      controls.target.set(0, 0, 0);
      returningHome = false;
    }
  }
  controls.update();
  // Terrain collision: OrbitControls' polar clamp keeps the camera above
  // the y=0 plane, but 3D terrain rises above it — zooming toward a hill
  // could put the eye underground. Hold a small clearance above the
  // sampled ground. Skipped in XR, where the headset owns the camera.
  if (!world.renderer.xr.isPresenting) {
    const camGroundY =
      groundSceneY(world.camera.position.x, -world.camera.position.z) + 0.6;
    if (world.camera.position.y < camGroundY) world.camera.position.y = camGroundY;
  }
  reconciler.syncFrame();
  // CSS2D labels are never rendered while presenting (the render branch
  // below skips labelRenderer), so the LOD pass would be pure wasted
  // frustum math + DOM writes there.
  if (!world.renderer.xr.isPresenting) reconciler.updateLabelLOD();
  aircraftCount.textContent = t('main.aircraft_count', { n: reconciler.count });

  // Update the XR billboard while an immersive session is active — and in
  // side-by-side stereo, where it's the only per-aircraft text that renders
  // correctly in both eyes (CSS2D labels are a single DOM overlay and get
  // hidden; issue #6 asked for UI presence in both halves). In plain
  // desktop view the CSS2D label + #panel-detail already cover the same
  // information, so skip the per-frame canvas work there.
  const stereoDesktop = !world.renderer.xr.isPresenting && getSettings().stereo;
  if ((world.renderer.xr.isPresenting || stereoDesktop) && xrSelectedHex) {
    const a = store.snapshot.get(xrSelectedHex);
    const pos = reconciler.positionOf(xrSelectedHex);
    // The wrist menu's Labels row maps to aircraftLabels; in a headset the
    // billboard IS the label, so the toggle governs it (issue #6, VR#7 —
    // CSS2D labels are hidden in XR, making the toggle appear dead).
    xrBillboard.update(getSettings().aircraftLabels ? (a ?? null) : null, pos);
    // Angular-size floor measures from the eye actually in use.
    xrBillboard.keepReadable(
      world.renderer.xr.isPresenting ? world.renderer.xr.getCamera() : world.camera,
    );
  } else {
    xrBillboard.hide();
  }

  // Wrist-menu hover: each frame in XR, raycast the right controller's
  // forward axis against the menu and update its highlighted row. Cheap
  // (one intersectObject call against a single Plane).
  if (world.renderer.xr.isPresenting) {
    const right = xrControllers.getControllerByHandedness('right');
    xrWristMenu.updateHover(right);
    // Thumbstick + button input (scale / snap-turn / recenter).
    xrLocomotion.tick(dt);
    // AR place-mode reticle follows the gaze hit point.
    if (xrFrame) xrArPlace.tick(xrFrame);
    // Perf telemetry (issue #6: "runs poorly at every quality"):
    // frame time + draw stats every 5 s, visible via the remote-
    // inspected headset console. Quality-independent slowness means
    // vertex/draw-call bound — drawCalls is the number to watch.
    xrPerfMs += dt;
    xrPerfFrames++;
    if (xrPerfMs >= 5000) {
      const render = world.renderer.info.render;
      console.info('[xr] perf', {
        avgFrameMs: Math.round((xrPerfMs / xrPerfFrames) * 10) / 10,
        fps: Math.round(1000 / (xrPerfMs / xrPerfFrames)),
        drawCalls: render.calls,
        triangles: render.triangles,
        aircraft: reconciler.count,
      });
      xrPerfMs = 0;
      xrPerfFrames = 0;
    }
  }

  if (world.renderer.xr.isPresenting) {
    // WebXR session active — the runtime owns camera transforms (from the
    // headset IMU), so OrbitControls + stereo are bypassed. CSS2D labels
    // can't paint over the XR-managed WebGL canvas so we skip the label
    // renderer too; world-space sprite labels (xrBillboard above) carry
    // the per-aircraft text.
    world.renderer.render(world.scene, world.camera);
  } else if (getSettings().stereo) {
    // Put the zero-parallax plane on the orbit target and scale eye
    // separation with viewing distance, so the depth stays comfortable
    // whether zoomed out to the whole airspace or in on one aircraft.
    const dist = world.camera.position.distanceTo(controls.target);
    world.camera.focus = dist;
    stereoEffect.setEyeSeparation(dist * getSettings().stereoStrength * 0.0005);
    stereoEffect.render(world.scene, world.camera);
  } else {
    world.renderer.render(world.scene, world.camera);
    labelRenderer.render(world.scene, world.camera);
  }
}

// setAnimationLoop is required for WebXR: it lets the headset's frame
// scheduler drive the loop instead of the page's rAF, which would
// otherwise pump at 60 Hz while the headset wants 72/90/120. Falls
// through to standard rAF when no XR session is active.
world.renderer.setAnimationLoop(tick);

// Dev-only silhouette-feature tuning harness; overlays the app so it
// needs no boot restructuring, and the dynamic import keeps it out of
// the production bundle. See aircraft/shape-lab.ts.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('shapeLab')) {
  void import('./aircraft/shape-lab').then((m) => m.mountShapeLab());
}
