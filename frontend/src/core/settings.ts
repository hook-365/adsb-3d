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

export type DistanceUnit = 'nm' | 'km';
export type SpeedUnit = 'kt' | 'mph' | 'kmh';
export type AltitudeUnit = 'ft' | 'm';
export type Basemap = 'dark' | 'carto_voyager' | 'hillshade' | 'topo' | 'satellite' | 'osm';

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
  /** Slippy-map basemap provider proxied by nginx /tiles/{provider}/... */
  basemap: Basemap;
  distanceUnit: DistanceUnit;
  speedUnit: SpeedUnit;
  altitudeUnit: AltitudeUnit;
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
  basemap: 'dark',
  distanceUnit: 'nm',
  speedUnit: 'kt',
  altitudeUnit: 'ft',
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
