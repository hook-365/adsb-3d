// Theme runs side-effects on import (applies tokens to :root). Keep this
// at the top so the first paint already carries the active palette and we
// don't flash the fallback values that live in :root in style.css.
import { setTheme } from './core/theme';
import { Vector3 } from 'three';
import { StereoEffect } from 'three/examples/jsm/effects/StereoEffect.js';
import { AircraftStore, setDefaultTrailCap } from './aircraft/store';

// On user selection, lift the per-hex trail cap and refetch a much larger
// history window. Anchored at 24h since that comfortably covers any
// realistic in-scope flight; the track-service returns what it actually
// has so we never block on truly old data. The per-hex cap survives the
// aircraft dropping out and re-entering scope within the session.
const SELECTION_BACKFILL_MS = 24 * 60 * 60 * 1000;
import { AircraftReconciler } from './aircraft/reconciler';
import { LiveFeed } from './feed/live';
import { AcarsFeed, type AcarsStatus } from './feed/acars';
import { HistoryBackfill } from './feed/history';
// Historical-mode feed + heatmap layer are loaded dynamically on first
// entry to historical mode — see enterHistoricalMode. Both modules are
// only needed when the user actually switches to historical playback and
// would otherwise inflate the cold-load bundle for everyone.
import type { HistoricalFeed as HistoricalFeedType } from './feed/historical';
import type { HeatmapLayer as HeatmapLayerType } from './world/heatmap';
import { addAcarsMessage, clearAcars, resolveAcarsPending, subscribeAcars } from './aircraft/acars-store';
import { getSettings, subscribeSettings } from './core/settings';
import { subscribeXr } from './core/xr';
import { setupXrControllers } from './world/xr-controllers';
import { XrBillboard } from './aircraft/xr-billboard';
import { XrWristMenu } from './world/xr-wrist-menu';
import { setupXrLocomotion } from './world/xr-locomotion';
import {
  attachRouteBatchPrefetcher,
  configureRoutesApi,
  clearRouteCache,
} from './feed/routes';
import {
  getActiveFeed,
  getFeeds,
  getFeedMode,
  onFeedSwitch,
  type Feed,
} from './feed/feeds';
import { createWorld } from './world/scene';
import { attachControls } from './world/controls';
import { createLabelRenderer } from './world/labels';
import { createAircraftList } from './ui/aircraft-list';
import { createAircraftDetail } from './ui/aircraft-detail';
import { attachPanelToggle } from './ui/panel-toggle';
import { mountFeedSelector } from './ui/feed-selector';
import { mountSettingsPanel } from './ui/settings-panel';
import { mountAltitudeLegend } from './ui/altitude-legend';
// ACARS browser modal is loaded dynamically on first open click — most
// pageviews never open it, so the modal UI shouldn't bloat the cold-load
// bundle. The HUD chip and aircraft-list ACARS badges live in the main
// bundle (they're tiny and active whenever the active feed has ACARS).
import type { AcarsBrowserHandle } from './ui/acars-browser';
import { mountTimeControls } from './ui/time-controls';
// Voice panel module is loaded dynamically inside syncVoicePanel when
// the feature is enabled — it's a sizable chunk (audio decode + media
// session UI) that deployments without ENABLE_VOICE never need to ship.
import { showLoading, type LoadingHandle } from './ui/loading-overlay';
import { attachPicking } from './interaction/picking';
import { HOME, setHome } from './core/config';
import { readSelectedHex, readTimeState, writeSelectedHex, writeTimeState } from './core/url-state';
import { setSearchQuery } from './core/filter';
import {
  getTimeContext,
  setHistorical,
  subscribeTime,
  tickPlayback,
  type TimeContext,
} from './core/time-context';

const hudLocName = document.getElementById('hud-loc-name')!;
const hudLocCoords = document.getElementById('hud-loc-coords')!;
// Privacy flag from entrypoint.sh (HIDE_TOWER). When set, the HUD omits the
// precise receiver coordinates — the map still centres on HOME, but the exact
// lat/lon isn't spelled out on screen.
const hideCoords = Boolean(
  (window as { TOWER_CONFIG?: { hidden?: boolean } }).TOWER_CONFIG?.hidden,
);
const hudLive = document.querySelector<HTMLElement>('.hud-live')!;
const hudAcars = document.getElementById('hud-acars') as HTMLElement;
const hudAcarsLabel = document.getElementById('hud-acars-label')!;
const feedStatus = document.getElementById('feed-status')!;

// Threshold beyond which we consider WS-reported feeder freshness "stale"
// — i.e. the track-service is connected but its upstream readsb hasn't
// answered for a while. Heartbeats fire every 5s so 30s leaves a margin
// for transient hiccups.
const FEEDER_STALE_THRESHOLD_S = 30;
const aircraftCount = document.getElementById('aircraft-count')!;
const frameRate = document.getElementById('frame-rate')!;
const canvas = document.getElementById('scene') as HTMLCanvasElement;

const feedMode = getFeedMode();
let activeFeed = getActiveFeed();

mountFeedSelector({ feeds: getFeeds(), active: activeFeed, mode: feedMode });
mountSettingsPanel();
mountTimeControls();
mountAltitudeLegend();

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

// Theme bridge: Settings owns persistence, theme module owns application.
// Apply once on boot to honor a stored preference, then re-apply on change.
setTheme(getSettings().theme);
subscribeSettings((s) => setTheme(s.theme));

// XR controllers + billboard for Phase 2. Controllers attach to the
// scene (meter-space, outside xrRoot — they track the user's hands at
// real-world scale); the billboard lives inside xrRoot so it shrinks
// with the airspace and stays the right size relative to the cones.
// Controllers are inert until a session is presenting, so registering
// them eagerly at boot is fine.
const xrBillboard = new XrBillboard(world.xrRoot);
const xrWristMenu = new XrWristMenu();
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
    if (xrControllers.getControllerByHandedness('left') === controller) return false;
    return xrWristMenu.trySelect(controller);
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
const VR_OFFSET_Y = 0.8;        // chest height
const VR_OFFSET_Z = -1.5;       // 1.5 m in front
subscribeXr((s) => {
  document.body.classList.toggle('xr-on', s.presenting);
  if (s.presenting) {
    labelRenderer.domElement.style.display = 'none';
    world.xrRoot.scale.setScalar(getSettings().vrScale);
    world.xrRoot.position.set(0, VR_OFFSET_Y, VR_OFFSET_Z);
    world.xrRoot.rotation.set(0, 0, 0);
    // AR (passthrough) hides the basemap + sky + fog so the room
    // shows through. VR keeps the opaque sky as today. Passthrough
    // is also off for the desktop view that follows session end.
    world.setPassthrough(s.presentingMode === 'ar');
  } else {
    if (!getSettings().stereo) labelRenderer.domElement.style.display = '';
    world.xrRoot.scale.setScalar(1);
    world.xrRoot.position.set(0, 0, 0);
    world.xrRoot.rotation.set(0, 0, 0);
    world.setPassthrough(false);
    // The wrist menu lives under the left controller; the controller
    // Group itself is recycled when the next session starts, but the
    // menu Mesh holds a stale parent ref. Detach explicitly so the
    // next 'connected' / onHandednessKnown re-attaches cleanly.
    xrWristMenu.detach();
  }
});

// Live-apply vrScale changes while a session is active. The
// xr-locomotion module drives this via updateSettings on every frame
// the user is pushing the thumbstick; subscribing here keeps the
// wrist-menu display + persistence as the single source of truth.
subscribeSettings((s) => {
  if (world.renderer.xr.isPresenting) {
    world.xrRoot.scale.setScalar(s.vrScale);
  }
});

const xrLocomotion = setupXrLocomotion({
  renderer: world.renderer,
  camera: world.camera,
  xrRoot: world.xrRoot,
});

const initialSelectedHex = readSelectedHex();

const store = new AircraftStore();
const reconciler = new AircraftReconciler(store, world.aircraftRoot, world.camera);

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

function applySelection(hex: string | null): void {
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
  session.history.refresh(hex, SELECTION_BACKFILL_MS);
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
    shareBtn.textContent = 'copied!';
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

// Live clocks: local + UTC. Once a second is plenty for HH:MM display,
// and pinning the update to the start of each minute would cost more
// scheduling complexity than it saves at 1 Hz.
const clocksEl = document.getElementById('clocks')!;
function fmtHHMM(d: Date, utc: boolean): string {
  const h = utc ? d.getUTCHours() : d.getHours();
  const m = utc ? d.getUTCMinutes() : d.getMinutes();
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
function tickClocks(): void {
  const now = new Date();
  clocksEl.textContent = `${fmtHHMM(now, false)} · ${fmtHHMM(now, true)}Z`;
}
tickClocks();
setInterval(tickClocks, 1000);

window.addEventListener('resize', () => {
  world.camera.aspect = window.innerWidth / window.innerHeight;
  world.camera.updateProjectionMatrix();
  world.renderer.setSize(window.innerWidth, window.innerHeight, false);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

// Publish the actual height of the status footer as `--footer-h` on
// :root so the sidebar + detail card can sit just above it. The footer
// gets significantly taller in historical mode (time-controls expand
// to a full row) and even taller on mobile when its flex-wrap kicks
// in, so a static CSS bottom would either over- or under-shoot.
const statusEl = document.getElementById('status') as HTMLElement;
const publishFooterHeight = (): void => {
  // Round up so we never undershoot by a fractional pixel.
  const h = Math.ceil(statusEl.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--footer-h', `${h}px`);
};
publishFooterHeight();
new ResizeObserver(publishFooterHeight).observe(statusEl);

// ────────────────────────────────────────────────────────────────────
// Feed session: per-feed lifecycle (live socket, history backfill,
// route prefetcher). Torn down on switch and recreated against the
// new feed; everything else (world, store, reconciler, UI) persists.

interface FeedSession {
  feed: Feed;
  liveFeed: LiveFeed;
  history: HistoryBackfill;
  acars: AcarsFeed | null;
  detachRoutePrefetcher: () => void;
  /** The initial-connect loading overlay, null once the first snapshot arrives. */
  connectLoader: LoadingHandle | null;
}

function feedNamePrefix(feed: Feed): string {
  return feedMode === 'multi' ? `${feed.name} · ` : '';
}

function applySubtitle(): void {
  hudLocName.textContent = HOME.name;
  // Browser tab title tracks the active feed's location. Static across
  // the session (no live count or selected aircraft) so the tab doesn't
  // flicker every render; updates when the feed switches because
  // applySubtitle() is called again from the feed-switch handler.
  document.title = HOME.name ? `ADS-B 3D · ${HOME.name}` : 'ADS-B 3D';
  if (hideCoords) {
    hudLocCoords.hidden = true;
    return;
  }
  // Hemisphere-suffixed coords read more like an aviation chart and avoid
  // the awkward leading minus on western longitudes.
  const ns = HOME.lat >= 0 ? 'N' : 'S';
  const ew = HOME.lon >= 0 ? 'E' : 'W';
  hudLocCoords.textContent =
    `${Math.abs(HOME.lat).toFixed(3)}°${ns}  ${Math.abs(HOME.lon).toFixed(3)}°${ew}  ·  ${HOME.altFt.toLocaleString()} ft`;
}

function startSession(feed: Feed): FeedSession {
  configureRoutesApi(feed.apiBase);
  // Per-feed trail policy: local gets unlimited, others stay at the safe
  // 600 (see feeds.ts). Set this before LiveFeed starts pushing snapshots
  // so the very first appendTrail uses the right cap.
  setDefaultTrailCap(feed.trailMaxPoints);
  const liveFeed = new LiveFeed({
    liveUrl: feed.liveUrl,
    wsUrl: feed.supportsWs ? `${feed.apiBase}/ws/live` : null,
  });
  // Surface the initial connect with the centered loading card so the
  // user knows we're alive while the WebSocket negotiates. Cleared on
  // the first successful snapshot. Also stored on the session so
  // stopSession() can dismiss it if the session is torn down before
  // the first snapshot arrives (feed switch, entering historical mode).
  const connectLoader: LoadingHandle = showLoading(
    'Connecting',
    `${feed.name}`
  );
  const prefix = feedNamePrefix(feed);
  liveFeed.subscribe((records, status) => {
    if (session.connectLoader && status.ok) {
      session.connectLoader.done();
      session.connectLoader = null;
    }
    store.syncFromFeed(records);
    // Tri-state: 'ok' when fresh, 'stale' when WS connected but the
    // backend's upstream feeder hasn't updated recently, 'down' when the
    // socket / HTTP both fail.
    let state: 'ok' | 'stale' | 'down';
    if (!status.ok) {
      state = 'down';
    } else if (
      typeof status.feederAgeS === 'number' &&
      status.feederAgeS > FEEDER_STALE_THRESHOLD_S
    ) {
      state = 'stale';
    } else if (status.feederAgeS === null) {
      // Server says it has never had a successful feeder fetch.
      state = 'stale';
    } else {
      state = 'ok';
    }

    hudLive.dataset.state = state;
    hudLive.textContent = state === 'down' ? 'down' : state === 'stale' ? 'stale' : 'live';

    // Bottom pill is just feed identity + a short status word. Transport
    // (ws/http) is an implementation detail; the HUD pulse already conveys
    // liveness; the aircraft-count chip beside it shows the number.
    const head = prefix.replace(/ · $/, '') || feed.name;
    if (state === 'down') {
      feedStatus.textContent = `${head} · down`;
      feedStatus.className = 'err';
    } else if (state === 'stale') {
      const ageStr =
        typeof status.feederAgeS === 'number'
          ? ` ${Math.round(status.feederAgeS)}s`
          : '';
      feedStatus.textContent = `${head} · stale${ageStr}`;
      feedStatus.className = 'warn';
    } else {
      feedStatus.textContent = head;
      feedStatus.className = 'ok';
    }
  });
  liveFeed.start();

  const history = new HistoryBackfill(store, {
    apiBase: feed.apiBase,
    enabled: feed.supportsHistory,
    windowMs: feed.backfillWindowMs,
  });

  const detachRoutePrefetcher = attachRouteBatchPrefetcher(store);

  // ACARS — only when this feed has it configured AND the user hasn't
  // disabled the feature. The settings toggle gates the wire-up entirely
  // (saves opening a socket the user doesn't want) but if it's off at
  // boot and they enable it later, applyAcarsLifecycle() picks it up.
  const acars = createAcarsForFeed(feed);

  return { feed, liveFeed, history, acars, detachRoutePrefetcher, connectLoader };
}

function createAcarsForFeed(feed: Feed): AcarsFeed | null {
  if (!feed.acarsApiBase) return null;
  if (!getSettings().acarsMessages) return null;
  const acars = new AcarsFeed({ apiBase: feed.acarsApiBase });
  acars.subscribe((msg) => addAcarsMessage(msg));
  acars.subscribeStatus((s) => updateAcarsHud(s));
  acars.start();
  return acars;
}

// Threshold beyond which we consider the ACARS hub silent. ACARS is
// bursty so we're more lenient here than the 30s feeder threshold.
const ACARS_STALE_THRESHOLD_S = 600;

function updateAcarsHud(status: AcarsStatus | null): void {
  if (!session?.feed.acarsApiBase || !getSettings().acarsMessages) {
    hudAcars.hidden = true;
    return;
  }
  hudAcars.hidden = false;
  let state: 'ok' | 'stale' | 'down';
  if (!status || !status.transportOk) {
    state = 'down';
  } else if (!status.hubConnected) {
    state = 'stale';
  } else if (status.hubAgeS === null) {
    // Connected but no message has ever arrived — hub is silent.
    state = 'stale';
  } else if (status.hubAgeS > ACARS_STALE_THRESHOLD_S) {
    state = 'stale';
  } else {
    state = 'ok';
  }
  hudAcars.dataset.state = state;
  if (state === 'ok' && status?.hubAgeS !== null && status?.hubAgeS !== undefined) {
    const ageS = Math.round(status.hubAgeS);
    hudAcarsLabel.textContent = ageS < 60 ? `acars · ${ageS}s` : `acars · ${Math.round(ageS / 60)}m`;
  } else if (state === 'stale') {
    hudAcarsLabel.textContent = 'acars silent';
  } else if (state === 'down') {
    hudAcarsLabel.textContent = 'acars down';
  } else {
    hudAcarsLabel.textContent = 'acars';
  }
}

function stopSession(session: FeedSession): void {
  // Dismiss the initial-connect overlay if it never resolved (e.g. the user
  // switched feeds or entered historical mode before the first snapshot).
  if (session.connectLoader) {
    session.connectLoader.done();
    session.connectLoader = null;
  }
  session.liveFeed.stop();
  session.history.stop();
  session.acars?.stop();
  session.acars = null;
  session.detachRoutePrefetcher();
}

let session: FeedSession = startSession(activeFeed);
applySubtitle();
updateAcarsHud(null);

// ────────────────────────────────────────────────────────────────────
// Historical-mode session: when the user switches to historical, the
// live session is paused and a HistoricalFeed drives the store from
// the playback cursor. Switching back to live resumes the live feed.

let historicalFeed: HistoricalFeedType | null = null;
let heatmapLayer: HeatmapLayerType | null = null;
// Bumped on every enter/exit; in-flight `enterHistoricalMode` calls check
// their captured token against the current value and bail if the user
// pivoted away during the chunk load.
let historicalEnterToken = 0;
let historicalEnterInFlight = false;

async function enterHistoricalMode(ctx: TimeContext): Promise<void> {
  if (!ctx.window) return;
  const myToken = ++historicalEnterToken;
  // Pause live transport. stopSession handles the connectLoader dismissal,
  // the acars null-out, and route prefetcher teardown — avoids a double-stop
  // when exitHistoricalMode later calls stopSession on the same session.
  stopSession(session);
  hudAcars.hidden = true;
  // ACARS browser stays open across mode switches if we don't close it,
  // leaving stale live messages visible during historical playback.
  // Modal was lazily mounted; if it was never opened there's nothing to close.
  acarsBrowser?.close();

  store.clear();
  feedStatus.textContent = `${feedNamePrefix(activeFeed)}historical · loading…`;
  feedStatus.className = 'warn';
  hudLive.dataset.state = 'stale';
  hudLive.textContent = 'historical';

  // Surface the bulk fetch with the centered loading card. Cleared on
  // load completion or error so the world becomes interactive again.
  let histLoader: LoadingHandle | null = showLoading(
    'Loading historical',
    formatWindowLabel(ctx.window)
  );

  // Pull in the historical playback + heatmap chunks lazily. Both are
  // sizable (volumetric rendering, bulk-tracks decoder) and only matter
  // once the user toggles historical mode.
  const [historicalMod, heatmapMod] = await Promise.all([
    import('./feed/historical'),
    import('./world/heatmap'),
  ]);
  // User flipped back to live while the chunks were loading — abandon
  // this enter without touching shared state. exitHistoricalMode already
  // bumped the token to invalidate us.
  if (myToken !== historicalEnterToken) {
    if (histLoader) { histLoader.done(); histLoader = null; }
    return;
  }
  if (!heatmapLayer) heatmapLayer = new heatmapMod.HeatmapLayer(world.scene);
  const buildTrailUpTo = historicalMod.buildTrailUpTo;
  const localHeatmap = heatmapLayer;

  historicalFeed = new historicalMod.HistoricalFeed({ apiBase: activeFeed.apiBase });
  historicalFeed.subscribe((records, status) => {
    store.syncFromFeed(records);
    // Replace each live aircraft's trail with the real samples that
    // pre-date the cursor. Without this the trail would carry forward
    // appendTrail's synthetic per-frame positions (smearing future
    // points behind a backward scrub) and rely on interpolation
    // artifacts instead of broadcast samples.
    if (historicalFeed && status.cursorMs !== null) {
      const tracks = historicalFeed.getTracks();
      const cursor = status.cursorMs;
      for (const a of records) {
        const samples = tracks.get(a.hex);
        if (!samples) continue;
        store.setTrail(a.hex, buildTrailUpTo(samples, cursor));
      }
    }
    feedStatus.textContent = `${feedNamePrefix(activeFeed)}historical · ${status.visibleCount}/${status.aircraftCount}`;
    feedStatus.className = 'ok';
  });
  // Track which (loaded, cellCount-flavored) signature we last rebuilt
  // the airway layer for. The status fires every cursor tick once
  // playback starts, so without a cheap idempotent check we'd rebuild
  // a million-segment LineSegments mesh on every frame.
  let lastBuildSignature: string | null = null;
  historicalFeed.subscribeStatus((status) => {
    if (status.errored) {
      feedStatus.textContent = `${feedNamePrefix(activeFeed)}historical · error`;
      feedStatus.className = 'err';
      if (histLoader) { histLoader.done(); histLoader = null; }
    } else if (status.loading) {
      feedStatus.textContent = `${feedNamePrefix(activeFeed)}historical · loading…`;
      feedStatus.className = 'warn';
      lastBuildSignature = null; // new fetch in flight; allow rebuild on completion
      if (!histLoader) {
        histLoader = showLoading('Loading historical', formatWindowLabel(historicalFeed?.getWindow() ?? null));
      }
    }
    // Rebuild on the loaded transition. Signature uses aircraftCount as
    // a cheap proxy for "has the underlying dataset changed".
    if (status.loaded && historicalFeed) {
      const sig = `${status.aircraftCount}`;
      if (sig !== lastBuildSignature) {
        localHeatmap.rebuildFromTracks(historicalFeed.getTracks());
        heatmapBuiltWindowKey = lastWindowKey;
        lastBuildSignature = sig;
      }
      if (histLoader) { histLoader.done(); histLoader = null; }
    }
  });
  void historicalFeed.start(ctx.window, ctx.cursorMs ?? undefined);
}

function formatWindowLabel(window: { startMs: number; endMs: number } | null): string {
  if (!window) return '';
  const hours = (window.endMs - window.startMs) / 3_600_000;
  if (hours <= 1.01) return 'last 1 hour';
  if (hours <= 24.01) return `last ${Math.round(hours)} hours`;
  const days = hours / 24;
  return `last ${Math.round(days)} days`;
}

function exitHistoricalMode(): void {
  // Invalidate any in-flight enterHistoricalMode that hasn't resolved yet.
  ++historicalEnterToken;
  if (historicalFeed) {
    historicalFeed.stop();
    historicalFeed = null;
  }
  heatmapLayer?.clear();
  store.clear();
  // enterHistoricalMode already called stopSession() to tear down the live
  // feed. Spin up a fresh session against the current feed instead of
  // trying to resume the stopped one.
  session = startSession(activeFeed);
  updateAcarsHud(null);
}

// Cache the last-seen window so we can distinguish "cursor moved" (cheap)
// from "window changed" (re-fetch). Subscriber fires on every cursor tick
// during playback, so the comparison must be O(1).
let lastWindowKey: string | null = null;
// Heatmap is fetched once per (window, on/off) — track the last window
// we built data for so toggling visibility doesn't refetch.
let heatmapBuiltWindowKey: string | null = null;

subscribeTime((ctx) => {
  writeTimeState(ctx);
  const windowKey = ctx.window ? `${ctx.window.startMs}|${ctx.window.endMs}` : null;

  if (ctx.mode === 'historical') {
    if (!historicalFeed && !historicalEnterInFlight) {
      historicalEnterInFlight = true;
      void enterHistoricalMode(ctx).finally(() => { historicalEnterInFlight = false; });
      lastWindowKey = windowKey;
    } else if (historicalFeed && windowKey !== lastWindowKey && ctx.window) {
      void historicalFeed.start(ctx.window, ctx.cursorMs ?? undefined);
      lastWindowKey = windowKey;
    } else if (historicalFeed && ctx.cursorMs !== null) {
      historicalFeed.setCursor(ctx.cursorMs);
    }

    // Heatmap: build from the playback feed's loaded tracks (no
    // separate fetch). When the window changes the feed re-loads and
    // its status subscriber triggers a rebuild. Toggling visibility
    // here is cheap — the geometry stays cached. The null guard catches
    // the brief gap between enter trigger and chunk-load completion.
    if (heatmapLayer && ctx.heatmap && historicalFeed && heatmapBuiltWindowKey !== windowKey) {
      const tracks = historicalFeed.getTracks();
      if (tracks.size > 0) {
        heatmapLayer.rebuildFromTracks(tracks);
        heatmapBuiltWindowKey = windowKey;
      }
    }
    heatmapLayer?.setVisible(ctx.heatmap);
  } else if (historicalFeed || historicalEnterInFlight) {
    exitHistoricalMode();
    lastWindowKey = null;
    heatmapBuiltWindowKey = null;
  }
});

// Initial URL → if it carries a historical window, enter that mode.
const urlTimeState = readTimeState();
if (urlTimeState && urlTimeState.window) {
  setHistorical(urlTimeState.window, urlTimeState.cursorMs ?? undefined);
}

// Settings can flip the ACARS feature on/off mid-session. Spin the WS
// up/down to match without rebuilding the whole feed session.
subscribeSettings((s) => {
  if (s.acarsMessages && !session.acars) {
    session.acars = createAcarsForFeed(session.feed);
  } else if (!s.acarsMessages && session.acars) {
    session.acars.stop();
    session.acars = null;
    clearAcars();
  }
  updateAcarsHud(null);
});

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
}

onFeedSwitch((next) => {
  // 1. Stop everything bound to the old feed before mutating shared
  //    state. Pending HTTP/WS callbacks that race the swap check
  //    `stopped`/`detached` and bail.
  stopSession(session);

  // 2. Drop selection — selected hex is per-feed and routes/airframes
  //    won't carry over.
  followHex = null;
  returningHome = true;
  applySelection(null);
  aircraftList.setSelected(null);

  // 3. Wipe shared caches that key off feed identity.
  store.clear();
  clearRouteCache();
  clearAcars();
  updateAcarsHud(null);

  // 4. Recenter the world: HOME mutates in place so coords/distances
  //    immediately reproject to the new origin; the basemap tile mesh
  //    coordinates were baked at construction time, so swap that layer.
  //    Camera goes back to the default orbit so the first frame of the
  //    new feed shows its tower from a predictable angle.
  setHome(next.home);
  world.recenter();
  world.camera.position.set(0, 220, 280);
  controls.target.set(0, 0, 0);
  controls.update();
  applySubtitle();
  feedStatus.textContent = `${feedNamePrefix(next)}connecting…`;
  feedStatus.className = 'warn';
  hudLive.dataset.state = 'stale';
  hudLive.textContent = 'connecting';

  // 5. Spin up new feed session.
  activeFeed = next;
  session = startSession(next);

  // 6. Voice scanner belongs to the local station only — show it for the
  //    local feed, tear it down for remote feeds (no false ATC coverage).
  syncVoicePanel();

  heatmapLayer?.clear();
  heatmapBuiltWindowKey = null;
});

let lastFrame = performance.now();
let frames = 0;
let fpsAccumMs = 0;

function tick(t: number): void {
  const dt = t - lastFrame;
  lastFrame = t;
  frames++;
  fpsAccumMs += dt;

  // Advance the historical playback cursor when playing. tickPlayback
  // emits a time-context change, which our subscriber funnels into
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

  if (followHex) {
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
  reconciler.syncFrame();
  reconciler.updateLabelLOD();
  aircraftCount.textContent = `aircraft: ${reconciler.count}`;

  // Update the XR billboard only while an immersive session is active.
  // Outside of XR the CSS2D label + #panel-detail already cover the same
  // information, and creating Canvas updates per frame would be wasted
  // work. Skip when nothing is selected too.
  if (world.renderer.xr.isPresenting && xrSelectedHex) {
    const a = store.snapshot.get(xrSelectedHex);
    const pos = reconciler.positionOf(xrSelectedHex);
    xrBillboard.update(a ?? null, pos);
  } else if (world.renderer.xr.isPresenting) {
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
