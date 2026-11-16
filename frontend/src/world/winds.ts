import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { HOME, WINDS_ENABLED, subscribeHome } from '../core/config';
import { toScene } from '../core/coords';
import { t } from '../core/i18n';
import { setLoading } from '../core/loading';
import { getSettings, subscribeSettings } from '../core/settings';
import { DIORAMA_PLANES } from './diorama-clip';
import { yieldToAircraft } from './label-yield';

// Winds aloft: the forecast wind at five heights over a grid of points
// around the feed's home. Drawn as flat arrows with the speed in knots, at
// the height of the one chosen level, and read at
// any position and altitude for the aircraft card's wind row.
//
// Source: Open-Meteo's forecast API through the nginx /wx/winds proxy,
// cached an hour (ENABLE_WINDS_ALOFT; off by default, because their free
// API is for non-commercial use). Each grid point counts against their
// daily allowance, which is why the grid is 7 by 7 and no finer.
//
// It is a model forecast for the current hour on a 70 NM grid: good for
// "there is a 90 knot jet from the west up there", not for the gust on
// short final. Everything above the loader is pure.

const WINDS_URL = '/wx/winds';
const POLL_MS = 30 * 60 * 1000;
/** Grid points per side and the spacing between them, NM. */
export const GRID = 7;
const SPACING_NM = 70;
/** Pressure levels asked for, and the altitude each sits at in a standard atmosphere. */
export const LEVELS: readonly { hPa: number; altFt: number }[] = [
  { hPa: 850, altFt: 5000 },
  { hPa: 700, altFt: 10000 },
  { hPa: 500, altFt: 18000 },
  { hPa: 300, altFt: 30000 },
  { hPa: 250, altFt: 34000 },
];
const COLOR = 0xbfe6ff;
/** Arrow length: a floor so light winds still read, then NM per knot, capped short of the next grid point. */
const MIN_ARROW_NM = 6;
const NM_PER_KT = 0.3;
const MAX_ARROW_NM = 46;
/** Half widths of the shaft and the head, and the head's longest length, NM. */
const SHAFT_HALF_NM = 1.1;
const HEAD_HALF_NM = 3.4;
const HEAD_NM = 8;

export interface Wind {
  /** Degrees true the wind blows FROM. */
  dirDeg: number;
  speedKt: number;
}

export interface WindGrid {
  /** South-west corner and spacing, degrees. */
  lat0: number;
  lon0: number;
  dLat: number;
  dLon: number;
  /** [level][row south to north][column west to east] as east and north components, knots; NaN where missing. */
  u: Float32Array[];
  v: Float32Array[];
}

/** The grid's latitudes and longitudes around a point, rounded so a place always asks for the same grid. */
export function gridAxes(lat: number, lon: number): { lats: number[]; lons: number[] } {
  const round = (v: number): number => Math.round(v * 2) / 2;
  const dLat = SPACING_NM / 60;
  // From the rounded latitude, so nearby places get an identical grid.
  const dLon = SPACING_NM / (60 * Math.max(0.2, Math.cos((round(lat) * Math.PI) / 180)));
  const lat0 = round(lat - (dLat * (GRID - 1)) / 2);
  const lon0 = round(lon - (dLon * (GRID - 1)) / 2);
  const step = (v: number): number => Math.round(v * 100) / 100;
  return {
    lats: Array.from({ length: GRID }, (_, i) => step(Math.max(-89, Math.min(89, lat0 + dLat * i)))),
    lons: Array.from({ length: GRID }, (_, i) => step(lon0 + dLon * i)),
  };
}

/**
 * Pure: Open-Meteo's answer (one object per requested point, in request
 * order: every longitude of the first latitude, then the next) → a grid.
 * Null when the answer is not the shape asked for.
 */
export function parseWinds(json: unknown, lats: readonly number[], lons: readonly number[]): WindGrid | null {
  if (!Array.isArray(json) || json.length !== lats.length * lons.length) return null;
  const n = lats.length * lons.length;
  const u = LEVELS.map(() => new Float32Array(n).fill(Number.NaN));
  const v = LEVELS.map(() => new Float32Array(n).fill(Number.NaN));
  (json as { hourly?: Record<string, unknown> }[]).forEach((point, i) => {
    LEVELS.forEach(({ hPa }, level) => {
      const speed = (point?.hourly?.[`wind_speed_${hPa}hPa`] as unknown[] | undefined)?.[0];
      const dir = (point?.hourly?.[`wind_direction_${hPa}hPa`] as unknown[] | undefined)?.[0];
      if (typeof speed !== 'number' || typeof dir !== 'number') return;
      // Blowing FROM dir: the air moves toward dir + 180.
      const to = ((dir + 180) * Math.PI) / 180;
      u[level]![i] = speed * Math.sin(to);
      v[level]![i] = speed * Math.cos(to);
    });
  });
  return {
    lat0: lats[0]!,
    lon0: lons[0]!,
    dLat: lats.length > 1 ? lats[1]! - lats[0]! : 1,
    dLon: lons.length > 1 ? lons[1]! - lons[0]! : 1,
    u,
    v,
  };
}

function fromComponents(u: number, v: number): Wind | null {
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  const speedKt = Math.hypot(u, v);
  // Back to "from": opposite the direction of travel.
  const dirDeg = (((Math.atan2(u, v) * 180) / Math.PI + 180) % 360 + 360) % 360;
  return { dirDeg, speedKt };
}

/**
 * Pure: the wind at a position and altitude, interpolated across the grid
 * and between levels (components, not angles, so 350 and 010 average to
 * north). Null outside the grid's footprint or where data is missing.
 * Below the lowest level and above the highest, that level's wind is used.
 */
export function windAt(grid: WindGrid, lat: number, lon: number, altFt: number): Wind | null {
  const fx = (lon - grid.lon0) / grid.dLon;
  const fy = (lat - grid.lat0) / grid.dLat;
  if (fx < 0 || fy < 0 || fx > GRID - 1 || fy > GRID - 1) return null;
  const x0 = Math.min(GRID - 2, Math.floor(fx));
  const y0 = Math.min(GRID - 2, Math.floor(fy));
  const tx = fx - x0;
  const ty = fy - y0;
  const sample = (arr: Float32Array): number => {
    const a = arr[y0 * GRID + x0]!;
    const b = arr[y0 * GRID + x0 + 1]!;
    const c = arr[(y0 + 1) * GRID + x0]!;
    const d = arr[(y0 + 1) * GRID + x0 + 1]!;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  let lower = 0;
  while (lower < LEVELS.length - 2 && altFt > LEVELS[lower + 1]!.altFt) lower++;
  const lo = LEVELS[lower]!;
  const hi = LEVELS[lower + 1]!;
  const f = Math.max(0, Math.min(1, (altFt - lo.altFt) / (hi.altFt - lo.altFt)));
  const u = sample(grid.u[lower]!) * (1 - f) + sample(grid.u[lower + 1]!) * f;
  const v = sample(grid.v[lower]!) * (1 - f) + sample(grid.v[lower + 1]!) * f;
  return fromComponents(u, v);
}

/**
 * Pure: the wind along and across a track. Positive `headKt` is a headwind
 * (negative a tailwind); positive `crossKt` is from the right.
 */
export function windComponents(wind: Wind, trackDeg: number): { headKt: number; crossKt: number } {
  const angle = ((wind.dirDeg - trackDeg) * Math.PI) / 180;
  return { headKt: wind.speedKt * Math.cos(angle), crossKt: wind.speedKt * Math.sin(angle) };
}

/** Speed of sound in the standard atmosphere, knots. */
function soundSpeedKt(altFt: number): number {
  const kelvin = Math.max(216.65, 288.15 - 0.0019812 * altFt);
  return 661.47 * Math.sqrt(kelvin / 288.15);
}

/**
 * True airspeed and Mach from ground speed and the wind: the ground
 * velocity less the air's own. An estimate twice over (a forecast wind, a
 * standard-atmosphere temperature), good to a few knots.
 */
export function airspeed(wind: Wind, trackDeg: number, groundSpeedKt: number, altFt: number): { tasKt: number; mach: number } {
  const rad = Math.PI / 180;
  // The wind blows FROM dirDeg, so the air moves toward the opposite heading.
  const airEast = -wind.speedKt * Math.sin(wind.dirDeg * rad);
  const airNorth = -wind.speedKt * Math.cos(wind.dirDeg * rad);
  const east = groundSpeedKt * Math.sin(trackDeg * rad) - airEast;
  const north = groundSpeedKt * Math.cos(trackDeg * rad) - airNorth;
  const tasKt = Math.hypot(east, north);
  return { tasKt, mach: tasKt / soundSpeedKt(altFt) };
}

export function windsActive(): boolean {
  return WINDS_ENABLED && getSettings().windsAloft;
}

// ── Loader ──────────────────────────────────────────────────────────

let grid: WindGrid | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let generation = 0;
const listeners = new Set<() => void>();

/** The loaded grid, or null while the layer is off or loading. */
export function getWinds(): WindGrid | null {
  return grid;
}

export function subscribeWinds(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function publish(next: WindGrid | null): void {
  if (next === grid) return;
  grid = next;
  for (const fn of listeners) fn();
}

async function poll(): Promise<void> {
  const mine = ++generation;
  const first = grid === null;
  if (first) setLoading('winds', t('settings.winds_aloft'));
  try {
    const { lats, lons } = gridAxes(HOME.lat, HOME.lon);
    // One point per (lat, lon) pair, row by row, as parseWinds expects.
    const latArg = lats.flatMap((la) => lons.map(() => la)).join(',');
    const lonArg = lats.flatMap(() => lons).join(',');
    const res = await fetch(`${WINDS_URL}?lat=${latArg}&lon=${lonArg}`);
    const next = res.ok ? parseWinds(await res.json(), lats, lons) : null;
    if (mine !== generation || !windsActive()) return;
    if (next) publish(next);
  } catch {
    // Offline or over the allowance: keep what is shown.
  } finally {
    if (first) setLoading('winds', null);
  }
}

function syncPolling(): void {
  const on = windsActive();
  if (on && timer === undefined) {
    timer = setInterval(() => void poll(), POLL_MS);
    void poll();
  } else if (!on && timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
    generation++;
    publish(null);
  }
}

/**
 * Pure: the flat arrow for one wind, as triangle vertices [x, z] in scene
 * units around its grid point (x east, z south). It points where the air
 * is going and its length grows with speed, up to MAX_ARROW_NM.
 */
export function arrowOutline(u: number, v: number): [number, number][] {
  const kt = Math.hypot(u, v);
  const len = Math.min(MAX_ARROW_NM, MIN_ARROW_NM + kt * NM_PER_KT);
  const ex = u / kt;
  const ez = -v / kt;
  // Perpendicular, for the widths.
  const px = -ez;
  const pz = ex;
  const head = Math.min(len * 0.45, HEAD_NM);
  const at = (along: number, across: number): [number, number] => [ex * along + px * across, ez * along + pz * across];
  const tail = -len / 2;
  const neck = len / 2 - head;
  const s = SHAFT_HALF_NM;
  const h = HEAD_HALF_NM;
  return [
    // Shaft, two triangles.
    at(tail, -s), at(neck, -s), at(neck, s),
    at(tail, -s), at(neck, s), at(tail, s),
    // Head.
    at(neck, -h), at(len / 2, 0), at(neck, h),
  ];
}

export function mountWinds(parent: Group): void {
  const material = new MeshBasicMaterial({
    color: COLOR,
    transparent: true,
    opacity: 0.5,
    side: DoubleSide,
    depthWrite: false,
    clippingPlanes: DIORAMA_PLANES,
  });
  const labelGroup = new Group();
  labelGroup.name = 'winds-labels';
  parent.add(labelGroup);
  yieldToAircraft(labelGroup);
  let arrows: Mesh | null = null;
  const a = new Vector3();

  const dispose = (): void => {
    for (const child of Array.from(labelGroup.children)) {
      labelGroup.remove(child);
      if (child instanceof CSS2DObject) child.element.remove();
    }
    if (!arrows) return;
    arrows.removeFromParent();
    arrows.geometry.dispose();
    arrows = null;
  };

  const rebuild = (): void => {
    dispose();
    if (!grid || !windsActive()) return;
    const level = Math.max(0, LEVELS.findIndex((l) => String(l.hPa) === getSettings().windsLevel));
    const altFt = LEVELS[level]!.altFt;
    const positions: number[] = [];
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const u = grid.u[level]![row * GRID + col]!;
        const v = grid.v[level]![row * GRID + col]!;
        const kt = Math.hypot(u, v);
        if (!Number.isFinite(kt) || kt < 3) continue;
        // Drawn at the height of the level the forecast is for.
        toScene(grid.lat0 + grid.dLat * row, grid.lon0 + grid.dLon * col, altFt, a);
        for (const [x, z] of arrowOutline(u, v)) positions.push(a.x + x, a.y, a.z + z);
        const el = document.createElement('div');
        el.className = 'aircraft-label wind-label';
        el.textContent = String(Math.round(kt));
        const label = new CSS2DObject(el);
        label.position.copy(a);
        labelGroup.add(label);
      }
    }
    if (positions.length === 0) return;
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    arrows = new Mesh(geom, material);
    arrows.frustumCulled = false;
    arrows.renderOrder = 6;
    arrows.raycast = () => {};
    arrows.userData = { kind: 'winds' };
    parent.add(arrows);
  };

  subscribeWinds(rebuild);
  let lastKey = '';
  subscribeSettings(() => {
    syncPolling();
    const s = getSettings();
    const key = `${s.windsAloft}|${s.windsLevel}|${s.altitudeExaggeration}|${s.altitudeCurveBias}`;
    if (key === lastKey) return;
    lastKey = key;
    rebuild();
  });
  subscribeHome(() => {
    if (!windsActive()) return;
    publish(null);
    void poll();
  });
  syncPolling();
}
