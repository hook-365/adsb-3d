// User-facing settings store. One module-level singleton, persisted to
// localStorage, with a subscribe API so consumers (reconciler, world,
// detail panel, etc.) can react to changes without coupling to the UI.
//
// To add a setting:
//   1. Add the key to Settings + DEFAULTS below.
//   2. Add a row to SETTINGS_SCHEMA in ui/settings-panel.ts (label + UI hint).
//   3. Subscribe wherever it matters via `subscribeSettings()`.
//
// All settings are global to the session; nothing here is feed-specific.

import type { ThemeSelection } from './theme';

export type DistanceUnit = 'nm' | 'km';
export type SpeedUnit = 'kt' | 'mph' | 'kmh';
export type AltitudeUnit = 'ft' | 'm';
/**
 * Immersive-VR render quality. Maps to a WebXR framebuffer scale factor in
 * main.ts: higher supersamples the headset's eye buffers so distant aircraft
 * stay sharp, at a GPU cost. 'balanced' is the runtime's native recommended
 * resolution (factor 1.0).
 */
export type VrQuality = 'low' | 'balanced' | 'high' | 'ultra';
/**
 * VR movement model (issue #6): 'scope' = world moves around a stationary
 * observer (left stick scales); 'freefly' = user flies through the
 * airspace (left stick strafes/flies, grip+stick scales, right stick Y
 * changes height).
 */
export type XrMoveMode = 'scope' | 'freefly';
/** VR turn style: 30° snap steps (comfort default) vs continuous rotation. */
export type XrTurnStyle = 'snap' | 'smooth';
/**
 * UI language selection. Lives here (not core/i18n.ts) so settings stays
 * import-cycle-free; i18n.ts consumes settings, never the reverse.
 */
export type LanguageSelection = 'auto' | 'en' | 'de' | 'es';
/**
 * In-air aircraft marker style. 'cone' = classic heading cone; 'sphere' =
 * undirected orb (trails carry the heading); 'silhouette' = the aircraft's
 * tar1090 type silhouette extruded into a flat 3D shape (see
 * aircraft/shape-geometry.ts). Ground sprites are unaffected.
 */
export type AircraftShapeStyle = 'cone' | 'sphere' | 'silhouette';
/**
 * Canonical basemap list, in display order. The settings panel dropdown
 * and the VR wrist-menu cycler both render from this array (each with
 * its own Record<Basemap, label> map, so a new entry is a compile error
 * until both UIs label it) — previously the two hardcoded diverging
 * copies.
 */
export const BASEMAP_VALUES = [
  'dark',
  'carto_voyager',
  'osm',
  'topo',
  'hillshade',
  'satellite',
  // US-only aeronautical charts (FAA, served via VFRMap).
  'sectional',
  'sectional_hybrid',
  'helicopter',
  'ifr_low',
  'ifr_high',
] as const;
export type Basemap = (typeof BASEMAP_VALUES)[number];

export interface Settings {
  /** In-air marker style — see AircraftShapeStyle. */
  aircraftShape: AircraftShapeStyle;
  /** Render the per-aircraft tar1090 ground icon at the foot of the altitude line. */
  groundSprites: boolean;
  /** Vertical line connecting each aircraft to its projection on the ground. */
  altitudeLines: boolean;
  /** Render per-aircraft position history trails. */
  historyTrails: boolean;
  /**
   * Approximate minutes of trail rendered per aircraft, truncated by
   * sample timestamp. -1 = full (whatever the feed's own cap collected —
   * unlimited on the local feed); 0 = none. Render-side only: history
   * keeps being collected at the feed cap, so raising this back restores
   * the longer trail instantly. The selected aircraft always renders
   * full. (Pre-0.8.4 payloads stored a point count, 0 = full — migrated
   * in load().)
   */
  trailLength: number;
  /** Concentric range rings every 50 NM out to RANGE_NM. */
  rangeRings: boolean;
  /** CSS labels above aircraft cones (callsign / reg / hex). */
  aircraftLabels: boolean;
  /**
   * 0 = all labels always visible (no distance culling).
   * Higher values tighten the visibility radius around the camera so
   * close-zoom views show fewer competing labels. Operated as a 0–100
   * slider so users can dial in their own clutter tolerance.
   */
  labelDensity: number;
  /** Subscribe to the ACARS message stream + render its UI. */
  acarsMessages: boolean;
  /**
   * XR "desk ornament" clipping: clip the airspace to an open-top box
   * around the placed scope so it reads as a bounded diorama in
   * passthrough AR (issue #6). No effect outside an XR session.
   */
  dioramaClip: boolean;
  /** Diorama box width in metres (wall to wall). */
  dioramaSize: number;
  /**
   * XR follow mode: while presenting with an aircraft selected, the
   * world slides horizontally so the aircraft stays over the scope
   * center (or the diorama box center when clipping is on).
   */
  xrFollow: boolean;
  /**
   * Side-by-side stereo rendering (left/right eye halves) for Google
   * Cardboard or a phone VR headset. CSS2D labels are hidden while on —
   * a single DOM layer can't be split per-eye.
   */
  stereo: boolean;
  /**
   * Stereo eye separation as a 1–100 slider. Eye offset scales with
   * viewing distance; higher values give stronger depth but more eye
   * strain. Only applies while `stereo` is on.
   */
  stereoStrength: number;
  /**
   * Immersive-VR world scale. 1.0 = 1 scene unit (= 1 NM) per real
   * metre — the user stands inside the radar volume at 1:1. 0.01 =
   * tabletop scale (250 NM scope fits as a 5 m disc). Persists across
   * sessions so a user who likes "room scale" doesn't have to thumb
   * back up to it every time they put the headset on. Modified by the
   * left thumbstick in VR (Phase 4) and applied to xrRoot.scale.
   */
  vrScale: number;
  /**
   * Immersive-AR world scale — the passthrough sibling of vrScale, kept
   * separate because the comfortable sizes differ by an order of
   * magnitude: VR fills an empty void, AR shares a furnished room
   * (issue #6: the diorama should start desk-sized, not room-sized).
   * Driven by the same left-thumbstick gesture while an AR session is
   * active; persisted independently.
   */
  arScale: number;
  /**
   * Immersive-VR render quality (framebuffer supersampling). Applied via
   * renderer.xr.setFramebufferScaleFactor; takes effect on the next VR
   * entry, not mid-session. See VrQuality.
   */
  vrQuality: VrQuality;
  /** VR movement model — see XrMoveMode. Read per-frame by xr-locomotion. */
  xrMoveMode: XrMoveMode;
  /** VR turn style — see XrTurnStyle. Read per-frame by xr-locomotion. */
  xrTurnStyle: XrTurnStyle;
  /** Slippy-map basemap provider proxied by nginx /tiles/{provider}/... */
  basemap: Basemap;
  distanceUnit: DistanceUnit;
  speedUnit: SpeedUnit;
  altitudeUnit: AltitudeUnit;
  /**
   * Color theme. 'auto' follows the system prefers-color-scheme; named
   * themes (e.g. 'midnight-glass', 'daylight') pin the palette regardless.
   * See core/theme.ts for the registry and authoring guide.
   */
  theme: ThemeSelection;
  /**
   * UI language. 'auto' resolves navigator.language against the locales
   * registered in core/i18n.ts, falling back to English. Changing this
   * reloads the page (strings are baked into the DOM at panel build time).
   */
  language: LanguageSelection;
  /**
   * Vertical-scale bias for altitude → scene height, -100..100 (see
   * core/altitude-curve.ts). 0 = linear; negative spreads low altitudes
   * apart, positive spreads the flight levels. Changing it reloads the
   * page (debounced) — trails, heatmap voxels, and other baked geometry
   * embed the mapping.
   */
  altitudeCurveBias: number;
  /**
   * Render the basemap at real ground elevation (world/elevation.ts).
   * ANDed with the deploy-level TERRAIN_ENABLED kill switch. Changing it
   * reloads the page — tile geometry bakes the displacement in.
   */
  terrain3d: boolean;
}

const DEFAULTS: Settings = {
  // Silhouette by default: the 3D type shapes are the product's best first
  // impression, and the top-right chip / settings row are the opt-out.
  aircraftShape: 'silhouette',
  groundSprites: true,
  altitudeLines: true,
  historyTrails: true,
  trailLength: -1,
  rangeRings: true,
  aircraftLabels: true,
  labelDensity: 0,
  acarsMessages: true,
  dioramaClip: false,
  dioramaSize: 0.9,
  xrFollow: false,
  stereo: false,
  stereoStrength: 50,
  vrScale: 0.01,
  // 10x smaller than the VR tabletop default — hardware feedback on
  // issue #6: at 0.01 the AR diorama dwarfs real furniture.
  arScale: 0.001,
  vrQuality: 'balanced',
  xrMoveMode: 'scope',
  xrTurnStyle: 'snap',
  basemap: 'carto_voyager',
  distanceUnit: 'nm',
  speedUnit: 'kt',
  altitudeUnit: 'ft',
  theme: 'auto',
  language: 'auto',
  altitudeCurveBias: 0,
  // Off by default: an extra ~25 tile fetches + displaced geometry that
  // deserves an opt-in, and flat remains the familiar baseline look.
  terrain3d: false,
};

const STORAGE_KEY = 'adsb3d_settings_v1';

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // trailLength migration (0.8.0-0.8.3 stored a POINT count with
    // 0 = full; now minutes with -1 = full, 0 = none). Points landed at
    // ~1/s, so points/60 ≈ minutes.
    if (typeof parsed.trailLength === 'number') {
      if (parsed.trailLength === 0) parsed.trailLength = -1;
      else if (parsed.trailLength >= 50) {
        parsed.trailLength = Math.max(1, Math.round(parsed.trailLength / 60));
      }
    }
    // Merge against defaults so a stored payload from an older version
    // doesn't drop new keys to undefined.
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Readonly<Settings> {
  return current;
}

/** Factory defaults — used by the settings panel to offer per-row resets. */
export function getDefaultSettings(): Readonly<Settings> {
  return DEFAULTS;
}

// The localStorage write is debounced (below) — updateSettings can be called
// at high frequency (WebXR thumbstick scale, VR quality slider drag) and a
// synchronous write on every call is a needless main-thread stall. The
// singleton contract itself stays synchronous: `current` and the listener
// fanout happen immediately, only the persistence write trails behind.
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 300;

function flushPersist(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // localStorage may be unavailable (privacy mode); behave as session-only.
  }
}

function schedulePersist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(flushPersist, PERSIST_DEBOUNCE_MS);
}

// Registered once at module init: a pending debounced write must not be
// lost to a tab close or backgrounding (mobile Safari, in particular, never
// reliably fires 'unload').
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPersist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPersist();
  });
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  schedulePersist();
  // Isolate subscribers: one throwing listener must not starve the rest,
  // and updateSettings is called from inside the WebXR animation loop
  // (thumbstick scale), where an uncaught throw kills rendering outright
  // (issue #6, AR freeze).
  for (const fn of listeners) {
    try {
      fn(current);
    } catch (e) {
      console.error('[settings] subscriber failed:', e);
    }
  }
}

export function subscribeSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
