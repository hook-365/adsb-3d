import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Group,
} from 'three';
import { HOME, WEATHER3D_ENABLED, subscribeHome } from '../core/config';
import { toScene } from '../core/coords';
import { getSettings, subscribeSettings } from '../core/settings';
import { DIORAMA_PLANES } from './diorama-clip';
import { getField, subscribeField, type FieldGrid } from './weather-fields';

// Freezing level: MRMS Model_0degC_Height (m MSL, hourly) drawn as a
// translucent sheet across the scope at the height where the air crosses
// 0 °C. Aircraft at or just below it in cloud are where airframe icing
// lives, so the sheet is the aviation-flavoured layer: a glance tells you
// which traffic is in the band. Where the optional bright-band fields are
// enabled on the sidecar (BrightBandTop/BottomHeight, m AGL), the sheet
// thickens into the actual melting layer; without them it is a single
// surface at 0 °C.
//
// Geometry: one vertex per field cell (<= 256 a side) projected through
// toScene() so it follows the altitude curve and sits at true height over
// the terrain, rebuilt whenever a newer grid lands or HOME moves. Where
// the precipitation-rate field is available the sheet is cut to the cells
// with precipitation: icing needs visible moisture, and a sheet over the
// whole scope read as haze. Without that field the sheet is drawn whole,
// fainter.

const FT_PER_M = 3.28084;
const SHEET_COLOR = 0x9fd8ff;
const SHEET_OPACITY = 0.22;
const SHEET_OPACITY_UNMASKED = 0.08;
const MASK_MIN_MM_H = 0.1;
const SHEET_MAX_SIDE = 64;

export function freezingLevelActive(): boolean {
  return WEATHER3D_ENABLED && getSettings().weatherFreezingLevel;
}

/** Latest freezing level at a coordinate, feet MSL, or NaN. */
let latest: FieldGrid | null = null;
export function freezingLevelFtAt(lat: number, lon: number): number {
  if (!latest) return Number.NaN;
  const m = latest.valueAt(lat, lon);
  return Number.isFinite(m) ? m * FT_PER_M : Number.NaN;
}

/** Pure: sheet vertices (x, y, z) and triangle indices for a field grid,
 * with a hole wherever the grid has no data or `mask` (same shape, e.g.
 * precipitation rate) is below `maskMin`. */
export function buildSheet(
  grid: FieldGrid,
  mask: FieldGrid | null = null,
  maskMin = MASK_MIN_MM_H,
  maxSide = SHEET_MAX_SIDE,
): { positions: Float32Array; indices: Uint32Array } {
  const useMask = mask !== null && mask.nx === grid.nx && mask.ny === grid.ny;
  const { nx, ny, bounds } = grid;
  // The freezing level is a smooth hourly model field: a vertex every few
  // cells is plenty, and keeps the sheet to a few thousand triangles.
  const step = Math.max(1, Math.ceil(Math.max(nx, ny) / maxSide));
  const cols = Math.ceil(nx / step);
  const rows = Math.ceil(ny / step);
  const positions = new Float32Array(cols * rows * 3);
  const valid = new Uint8Array(cols * rows);
  const tmp = new Vector3();
  const dLon = (bounds.east - bounds.west) / nx;
  const dLat = (bounds.north - bounds.south) / ny;
  for (let r = 0; r < rows; r++) {
    const row = Math.min(ny - 1, r * step);
    const lat = bounds.north - (row + 0.5) * dLat;
    for (let c = 0; c < cols; c++) {
      const col = Math.min(nx - 1, c * step);
      const lon = bounds.west + (col + 0.5) * dLon;
      const src = row * nx + col;
      const i = r * cols + c;
      const m = grid.unpack(grid.codes[src]!);
      if (!Number.isFinite(m)) continue;
      if (useMask && !(mask!.maxNear(lat, lon, step > 1 ? Math.ceil(step / 2) : 0) >= maskMin)) continue;
      toScene(lat, lon, m * FT_PER_M, tmp);
      positions[i * 3] = tmp.x;
      positions[i * 3 + 1] = tmp.y;
      positions[i * 3 + 2] = tmp.z;
      valid[i] = 1;
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      if (valid[a] && valid[b] && valid[d]) idx.push(a, b, d);
      if (valid[b] && valid[e] && valid[d]) idx.push(b, e, d);
    }
  }
  return { positions, indices: new Uint32Array(idx) };
}

export function mountFreezingLevel(parent: Group): void {
  let mesh: Mesh | null = null;
  let unsub: (() => void) | null = null;
  let unsubMask: (() => void) | null = null;
  const material = new MeshBasicMaterial({
    color: SHEET_COLOR,
    transparent: true,
    opacity: SHEET_OPACITY,
    side: DoubleSide,
    depthWrite: false,
    clippingPlanes: DIORAMA_PLANES,
  });

  const dispose = (): void => {
    if (mesh) {
      parent.remove(mesh);
      mesh.geometry.dispose();
      mesh = null;
    }
  };

  const place = (): void => {
    dispose();
    if (!freezingLevelActive() || !latest) return;
    const mask = getField('preciprate');
    const { positions, indices } = buildSheet(latest, mask);
    material.opacity = mask && mask.nx === latest.nx && mask.ny === latest.ny ? SHEET_OPACITY : SHEET_OPACITY_UNMASKED;
    if (indices.length === 0) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    mesh = new Mesh(geometry, material);
    mesh.renderOrder = 9;
    mesh.frustumCulled = false;
    mesh.userData = { kind: 'freezing-level' };
    parent.add(mesh);
  };

  const sync = (): void => {
    const on = freezingLevelActive();
    if (on && !unsub) {
      unsub = subscribeField('freezing', (grid) => {
        latest = grid;
        place();
      });
      unsubMask = subscribeField('preciprate', () => place());
    } else if (!on && unsub) {
      unsub();
      unsubMask?.();
      unsub = unsubMask = null;
      latest = null;
      dispose();
    }
  };

  subscribeSettings(sync);
  subscribeHome(() => {
    // The field module drops its grids on a feed switch and re-polls; the
    // sheet follows when the new one lands. Until then draw nothing at
    // the wrong place.
    latest = null;
    dispose();
    void HOME;
  });
  sync();
}
