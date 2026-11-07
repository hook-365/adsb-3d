import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import { WEATHER3D_ENABLED, subscribeHome } from '../core/config';
import { toScene } from '../core/coords';
import { getSettings, subscribeSettings } from '../core/settings';
import { DIORAMA_PLANES } from './diorama-clip';
import { terrainSurface } from './tiles';
import { getField, subscribeField, type FieldGrid } from './weather-fields';

// Lightning: MRMS NLDN_CG_001min_AvgDensity (cloud-to-ground flashes per
// km² per minute, 1-minute cadence) turned back into flashes. Each cell's
// density times its area gives a flash rate; every frame each active cell
// rolls for a strike, and a strike is a bright point at cloud base with a
// thin channel to the ground that fades over a quarter second. Statistical
// rather than literal (NLDN's per-strike positions aren't in the grid),
// but the rhythm and placement match the real storm. Capped at MAX_FLASHES
// live at once; dense cores just saturate.

const MAX_FLASHES = 256;
const FLASH_LIFE_MS = 280;
const CLOUD_BASE_FT = 6000;
const CLOUD_BASE_JITTER_FT = 3000;

export function lightningActive(): boolean {
  return WEATHER3D_ENABLED && getSettings().weatherLightning;
}

/** Pure: expected flashes per second for one cell of density d (flashes/km²/min) and area km². */
export function flashRatePerSec(densityPerKm2Min: number, cellAreaKm2: number): number {
  if (!(densityPerKm2Min > 0)) return 0;
  return (densityPerKm2Min * cellAreaKm2) / 60;
}

/** Pure: cells with lightning and their per-second rates. */
export function activeCells(grid: FieldGrid): Array<{ lat: number; lon: number; rate: number; dLat: number; dLon: number }> {
  const { nx, ny, bounds, codes } = grid;
  const dLon = (bounds.east - bounds.west) / nx;
  const dLat = (bounds.north - bounds.south) / ny;
  const out: Array<{ lat: number; lon: number; rate: number; dLat: number; dLon: number }> = [];
  for (let i = 0; i < nx * ny; i++) {
    const d = grid.unpack(codes[i]!);
    if (!(d > 0)) continue;
    const r = Math.floor(i / nx);
    const c = i % nx;
    const lat = bounds.north - (r + 0.5) * dLat;
    const lon = bounds.west + (c + 0.5) * dLon;
    const areaKm2 = dLat * 111.2 * dLon * 111.2 * Math.cos((lat * Math.PI) / 180);
    out.push({ lat, lon, rate: flashRatePerSec(d, areaKm2), dLat, dLon });
  }
  return out;
}

/** Latest density near a coordinate, flashes/km²/min, or NaN. */
export function lightningNear(lat: number, lon: number): number {
  const g = getField('lightning');
  return g ? g.maxNear(lat, lon, 2) : Number.NaN;
}

export function mountLightning(parent: Group): void {
  let unsub: (() => void) | null = null;
  let cells: ReturnType<typeof activeCells> = [];
  const born = new Float32Array(MAX_FLASHES).fill(-1e9);
  const ptPos = new Float32Array(MAX_FLASHES * 3);
  const linePos = new Float32Array(MAX_FLASHES * 6);
  let next = 0;
  let live = 0;
  const tmp = new Vector3();
  const ground = new Vector3();

  const ptGeo = new BufferGeometry();
  ptGeo.setAttribute('position', new BufferAttribute(ptPos, 3));
  ptGeo.setDrawRange(0, 0);
  const points = new Points(ptGeo, new PointsMaterial({
    color: 0xfff4c0, size: 2.4, sizeAttenuation: true, transparent: true, opacity: 0.95,
    blending: AdditiveBlending, depthWrite: false, clippingPlanes: DIORAMA_PLANES,
  }));
  const lineGeo = new BufferGeometry();
  lineGeo.setAttribute('position', new BufferAttribute(linePos, 3));
  lineGeo.setDrawRange(0, 0);
  const lines = new LineSegments(lineGeo, new LineBasicMaterial({
    color: 0xdfe8ff, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false,
    clippingPlanes: DIORAMA_PLANES,
  }));
  const group = new Group();
  group.name = 'lightning';
  group.add(points, lines);
  for (const o of [points, lines]) {
    o.frustumCulled = false;
    o.renderOrder = 11;
  }

  const spawn = (lat: number, lon: number): void => {
    const i = next;
    next = (next + 1) % MAX_FLASHES;
    const altFt = CLOUD_BASE_FT + Math.random() * CLOUD_BASE_JITTER_FT;
    toScene(lat, lon, altFt, tmp);
    terrainSurface(lat, lon, ground);
    ptPos.set([tmp.x, tmp.y, tmp.z], i * 3);
    linePos.set([tmp.x, tmp.y, tmp.z, ground.x, ground.y + 0.05, ground.z], i * 6);
    born[i] = performance.now();
    live = Math.min(MAX_FLASHES, live + 1);
  };

  let lastFrame = performance.now();
  const onFrame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!lightningActive()) return;
    for (const c of cells) {
      // Poisson thinning: one roll per cell per frame is plenty at these rates.
      if (Math.random() < c.rate * dt) {
        spawn(c.lat + (Math.random() - 0.5) * c.dLat, c.lon + (Math.random() - 0.5) * c.dLon);
      }
    }
    // Expire: we draw the whole ring buffer but collapse dead flashes to a
    // far-away point so they cost nothing visible.
    let any = false;
    for (let i = 0; i < MAX_FLASHES; i++) {
      if (now - born[i]! > FLASH_LIFE_MS) {
        if (born[i]! > -1e8) {
          ptPos[i * 3 + 1] = -1e5;
          linePos[i * 6 + 1] = -1e5;
          linePos[i * 6 + 4] = -1e5;
          born[i] = -1e9;
        }
      } else any = true;
    }
    ptGeo.setDrawRange(0, any ? MAX_FLASHES : 0);
    lineGeo.setDrawRange(0, any ? MAX_FLASHES * 2 : 0);
    (ptGeo.attributes.position as BufferAttribute).needsUpdate = true;
    (lineGeo.attributes.position as BufferAttribute).needsUpdate = true;
  };
  points.onBeforeRender = onFrame;

  const sync = (): void => {
    const on = lightningActive();
    if (on && !unsub) {
      unsub = subscribeField('lightning', (g) => { cells = g ? activeCells(g) : []; });
      parent.add(group);
    } else if (!on && unsub) {
      unsub();
      unsub = null;
      cells = [];
      born.fill(-1e9);
      ptGeo.setDrawRange(0, 0);
      lineGeo.setDrawRange(0, 0);
      parent.remove(group);
    }
  };

  subscribeSettings(sync);
  subscribeHome(() => {
    cells = [];
    born.fill(-1e9);
  });
  sync();
}
