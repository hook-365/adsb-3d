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
export type Basemap =
  | 'dark'
  | 'carto_voyager'
  | 'hillshade'
  | 'topo'
  | 'satellite'
  | 'osm'
  // US-only aeronautical charts (FAA, served via VFRMap).
  | 'sectional'
  | 'sectional_hybrid'
  | 'helicopter'
  | 'ifr_low'
  | 'ifr_high';

export interface Settings {
  /** Render the per-aircraft tar1090 ground icon at the foot of the altitude line. */
  groundSprites: boolean;
  /** Vertical line connecting each aircraft to its projection on the ground. */
  altitudeLines: boolean;
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
   * Immersive-VR render quality (framebuffer supersampling). Applied via
   * renderer.xr.setFramebufferScaleFactor; takes effect on the next VR
   * entry, not mid-session. See VrQuality.
   */
  vrQuality: VrQuality;
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
}

const DEFAULTS: Settings = {
  groundSprites: true,
  altitudeLines: true,
  rangeRings: true,
  aircraftLabels: true,
  labelDensity: 0,
  acarsMessages: true,
  stereo: false,
  stereoStrength: 50,
  vrScale: 0.01,
  vrQuality: 'balanced',
  basemap: 'dark',
  distanceUnit: 'nm',
  speedUnit: 'kt',
  altitudeUnit: 'ft',
  theme: 'auto',
};

const STORAGE_KEY = 'adsb3d_settings_v1';

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
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

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // localStorage may be unavailable (privacy mode); behave as session-only.
  }
  for (const fn of listeners) fn(current);
}

export function subscribeSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
