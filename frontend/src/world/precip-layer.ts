import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Group,
} from 'three';
import { WEATHER3D_ENABLED, subscribeHome } from '../core/config';
import { getSettings, subscribeSettings } from '../core/settings';
import { DIORAMA_PLANES } from './diorama-clip';
import { terrainSurface } from './tiles';
import { getField, subscribeField, type FieldGrid } from './weather-fields';
import { rampColor } from './storms';

// Surface precipitation from MRMS (PrecipRate mm/h + PrecipFlag type):
// a ground overlay painted from the two field grids, draped over the
// terrain like the basemap. On deployments with weather-service this is
// what the "Weather radar" toggle draws inside MRMS coverage: 2-minute
// cadence, no third party. Colour is the SAME NWS reflectivity ramp the
// 3D volume uses, with the surface rate converted to an equivalent dBZ
// through Marshall-Palmer (Z = 200 R^1.6), so the floor and the cloud
// above it read on one scale. Precipitation type is a tint on top: hail
// pulls toward magenta, snow toward white; rain and convective cells are
// the plain ramp (convection shows as the stronger colour it is).
// Outside coverage, or without the sidecar, world/radar.ts keeps drawing
// RainViewer; the two never overlap (see precipLayerActive).

/** Rank codes from the sidecar's PrecipFlag collapse. */
export const RANK_NONE = 0;
export const RANK_STRATIFORM = 1;
export const RANK_SNOW = 2;
export const RANK_CONVECTIVE = 3;
export const RANK_HAIL = 4;

/** Type tints blended over the ramp colour (rgb, weight). */
const TYPE_TINT: Partial<Record<number, readonly [number, number, number, number]>> = {
  [RANK_SNOW]: [255, 255, 255, 0.45],
  [RANK_HAIL]: [255, 60, 220, 0.55],
};

/** Pure: Marshall-Palmer rain rate (mm/h) to reflectivity (dBZ): Z = 200 R^1.6. */
export function rateToDbz(rateMmH: number): number {
  if (!(rateMmH > 0)) return Number.NEGATIVE_INFINITY;
  return 10 * Math.log10(200 * Math.pow(rateMmH, 1.6));
}

let covered = false;

/**
 * True when the MRMS surface layer is the one to draw: the user wants
 * precipitation, the sidecar exists, and a grid for this home has
 * arrived (so RainViewer is not pre-empted outside coverage).
 */
export function precipLayerActive(): boolean {
  return WEATHER3D_ENABLED && getSettings().weatherRadar && covered;
}

/** Pure: colour a rate/type pair on the radar ramp. Transparent below the
 * ramp's first stop (18 dBZ, about 0.4 mm/h); alpha follows the ramp. */
export function precipRgba(rateMmH: number, rank: number): [number, number, number, number] {
  const c = rampColor(rateToDbz(rateMmH));
  if (!c) return [0, 0, 0, 0];
  let [r, g, b] = c;
  const tint = TYPE_TINT[rank];
  if (tint) {
    const w = tint[3];
    r = Math.round(r * (1 - w) + tint[0] * w);
    g = Math.round(g * (1 - w) + tint[1] * w);
    b = Math.round(b * (1 - w) + tint[2] * w);
  }
  return [r, g, b, Math.min(230, c[3] + 60)];
}

/** Pure: paint the two grids into RGBA pixels, row 0 north. */
export function paintPrecip(rate: FieldGrid, type: FieldGrid | null): Uint8ClampedArray {
  const { nx, ny } = rate;
  const px = new Uint8ClampedArray(nx * ny * 4);
  for (let i = 0; i < nx * ny; i++) {
    const r = rate.unpack(rate.codes[i]!);
    const rank = type && type.nx === nx && type.ny === ny ? type.codes[i]! : RANK_STRATIFORM;
    const [cr, cg, cb, ca] = precipRgba(r, rank);
    px[i * 4] = cr;
    px[i * 4 + 1] = cg;
    px[i * 4 + 2] = cb;
    px[i * 4 + 3] = ca;
  }
  return px;
}

export function mountPrecipLayer(parent: Group): void {
  let mesh: Mesh | null = null;
  let texture: CanvasTexture | null = null;
  let unsubRate: (() => void) | null = null;
  let unsubType: (() => void) | null = null;
  const canvas = document.createElement('canvas');
  const material = new MeshBasicMaterial({
    transparent: true,
    opacity: 0.85,
    side: DoubleSide,
    depthWrite: false,
    clippingPlanes: DIORAMA_PLANES,
  });
  const tmp = new Vector3();

  const dispose = (): void => {
    if (mesh) {
      parent.remove(mesh);
      mesh.geometry.dispose();
      mesh = null;
    }
  };

  const paint = (rate: FieldGrid): void => {
    const type = getField('preciptype');
    canvas.width = rate.nx;
    canvas.height = rate.ny;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(rate.nx, rate.ny);
    img.data.set(paintPrecip(rate, type));
    ctx.putImageData(img, 0, 0);
    if (!texture) {
      texture = new CanvasTexture(canvas);
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      material.map = texture;
      material.needsUpdate = true;
    } else {
      texture.needsUpdate = true;
    }
  };

  /** Draped grid over the field bounds: one vertex per cell, on the drawn terrain plus a hair. */
  const build = (rate: FieldGrid): void => {
    dispose();
    const { nx, ny, bounds } = rate;
    // Cap the mesh density: the texture carries the detail, the mesh only
    // needs to follow the terrain.
    const sx = Math.max(1, Math.ceil(nx / 96));
    const sy = Math.max(1, Math.ceil(ny / 96));
    const cols = Math.floor(nx / sx) + 1;
    const rows = Math.floor(ny / sy) + 1;
    const positions = new Float32Array(cols * rows * 3);
    const uvs = new Float32Array(cols * rows * 2);
    for (let r = 0; r < rows; r++) {
      const fy = Math.min(1, (r * sy) / ny);
      const lat = bounds.north - fy * (bounds.north - bounds.south);
      for (let c = 0; c < cols; c++) {
        const fx = Math.min(1, (c * sx) / nx);
        const lon = bounds.west + fx * (bounds.east - bounds.west);
        terrainSurface(lat, lon, tmp);
        const i = r * cols + c;
        positions[i * 3] = tmp.x;
        positions[i * 3 + 1] = tmp.y + 0.25;
        positions[i * 3 + 2] = tmp.z;
        uvs[i * 2] = fx;
        uvs[i * 2 + 1] = 1 - fy;
      }
    }
    const idx = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let o = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        idx[o++] = a; idx[o++] = a + 1; idx[o++] = a + cols;
        idx[o++] = a + 1; idx[o++] = a + cols + 1; idx[o++] = a + cols;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(idx, 1));
    mesh = new Mesh(geometry, material);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    mesh.userData = { kind: 'precip' };
    parent.add(mesh);
  };

  let lastKey = '';
  const refresh = (): void => {
    const rate = getField('preciprate');
    const wasCovered = covered;
    covered = rate !== null;
    if (!rate || !WEATHER3D_ENABLED || !getSettings().weatherRadar) {
      dispose();
      if (wasCovered !== covered) notify();
      return;
    }
    paint(rate);
    const key = `${rate.nx}x${rate.ny}@${rate.bounds.west},${rate.bounds.north}`;
    if (!mesh || key !== lastKey) {
      lastKey = key;
      build(rate);
    }
    if (wasCovered !== covered) notify();
  };

  const sync = (): void => {
    const want = WEATHER3D_ENABLED && getSettings().weatherRadar;
    if (want && !unsubRate) {
      unsubRate = subscribeField('preciprate', refresh);
      unsubType = subscribeField('preciptype', refresh);
    } else if (!want && unsubRate) {
      unsubRate();
      unsubType?.();
      unsubRate = unsubType = null;
      covered = false;
      dispose();
      notify();
    }
    refresh();
  };

  subscribeSettings(sync);
  subscribeHome(() => {
    covered = false;
    lastKey = '';
    dispose();
    notify();
  });
  sync();
}

// RainViewer (world/radar.ts) and the attribution bar need to know when
// this layer takes over; a tiny listener set keeps them in step.
const listeners = new Set<() => void>();
function notify(): void {
  for (const fn of listeners) fn();
}
export function subscribePrecipLayer(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
