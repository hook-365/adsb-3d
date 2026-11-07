import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
} from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { WEATHER3D_ENABLED, subscribeHome } from '../core/config';
import { t } from '../core/i18n';
import { getSettings, subscribeSettings } from '../core/settings';
import { DIORAMA_PLANES } from './diorama-clip';
import { terrainSurface } from './tiles';
import { subscribeField, type FieldGrid } from './weather-fields';

// Severe cells: MRMS MESH (maximum estimated hail size, mm) and
// RotationTrack30min (low-level azimuthal shear swath, 0.001/s) scanned for
// connected regions above a threshold. Each region gets a ground ring
// sized to its extent and a label ("hail 38 mm", "rotation"), so a
// deviation around a cell is self-explanatory. The ring and label reuse
// the aircraft styling; depth-tested, so they hide behind terrain.

/** Severe thresholds. 25 mm hail is "severe" by NWS definition. For
 * rotation the 30-minute swath product lights up along any sheared front
 * at the 0.005/s screening value, so the marker uses 0.010/s, roughly a
 * weak mesocyclone, and asks for a few contiguous cells. */
export const HAIL_MIN_MM = 25;
export const ROTATION_MIN = 10; // 0.001/s units
export const HAIL_MIN_CELLS = 1;
export const ROTATION_MIN_CELLS = 3;
export const MAX_REGIONS = 12;
export const MAX_LABELS = 8;

export interface Region {
  kind: 'hail' | 'rotation';
  lat: number;
  lon: number;
  /** Peak value in the product's unit (mm, or 0.001/s). */
  max: number;
  /** Rough radius in NM from the region's cell extent. */
  radiusNm: number;
  cells: number;
}

/**
 * Pure: 4-connected regions where `grid.unpack(code) >= min`, centroid
 * weighted by value, extent from the bounding box. Tiny regions (one
 * cell) are kept: a single 1 km hail core is still a hail core.
 */
export function findRegions(grid: FieldGrid, min: number, kind: Region['kind'], maxRegions = MAX_REGIONS, minCells = 1): Region[] {
  const { nx, ny, bounds, codes } = grid;
  const seen = new Uint8Array(nx * ny);
  const dLon = (bounds.east - bounds.west) / nx;
  const dLat = (bounds.north - bounds.south) / ny;
  const out: Region[] = [];
  const stack: number[] = [];
  for (let start = 0; start < nx * ny; start++) {
    if (seen[start] || !(grid.unpack(codes[start]!) >= min)) continue;
    let sumW = 0;
    let sumR = 0;
    let sumC = 0;
    let max = 0;
    let n = 0;
    let r0 = ny;
    let r1 = -1;
    let c0 = nx;
    let c1 = -1;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const v = grid.unpack(codes[i]!);
      const r = Math.floor(i / nx);
      const c = i % nx;
      sumW += v;
      sumR += r * v;
      sumC += c * v;
      if (v > max) max = v;
      n++;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
      const nb = [i - 1, i + 1, i - nx, i + nx];
      if (c === 0) nb[0] = -1;
      if (c === nx - 1) nb[1] = -1;
      for (const j of nb) {
        if (j < 0 || j >= nx * ny || seen[j]) continue;
        if (grid.unpack(codes[j]!) >= min) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    const rc = sumR / sumW;
    const cc = sumC / sumW;
    const lat = bounds.north - (rc + 0.5) * dLat;
    const lon = bounds.west + (cc + 0.5) * dLon;
    const spanLatNm = (r1 - r0 + 1) * dLat * 60;
    const spanLonNm = (c1 - c0 + 1) * dLon * 60 * Math.cos((lat * Math.PI) / 180);
    if (n < minCells) continue;
    out.push({ kind, lat, lon, max, radiusNm: Math.max(1.5, Math.max(spanLatNm, spanLonNm) / 2), cells: n });
  }
  // Strongest first; a swath of marginal cells shouldn't crowd out the core.
  out.sort((a, b) => b.max - a.max);
  return out.slice(0, maxRegions);
}

export function severeActive(): boolean {
  return WEATHER3D_ENABLED && getSettings().weatherSevere;
}

export function regionLabel(region: Region): string {
  return region.kind === 'hail'
    ? t('misc.severe_hail', { mm: Math.round(region.max) })
    : t('misc.severe_rotation');
}

export function mountSevereCells(parent: Group): void {
  const group = new Group();
  group.name = 'severe-cells';
  let unsubHail: (() => void) | null = null;
  let unsubRot: (() => void) | null = null;
  let hail: FieldGrid | null = null;
  let rot: FieldGrid | null = null;
  const tmp = new Vector3();
  const hailMat = new MeshBasicMaterial({ color: 0xff6b3d, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false, clippingPlanes: DIORAMA_PLANES });
  const rotMat = new MeshBasicMaterial({ color: 0xff3fb0, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false, clippingPlanes: DIORAMA_PLANES });
  const ringGeo = new RingGeometry(0.82, 1, 48);
  ringGeo.rotateX(-Math.PI / 2);

  const clear = (): void => {
    for (const child of Array.from(group.children)) {
      group.remove(child);
      child.traverse((o) => {
        if (o instanceof CSS2DObject) o.element.remove();
      });
    }
  };

  const place = (): void => {
    clear();
    if (!severeActive()) return;
    const regions = [
      ...(hail ? findRegions(hail, HAIL_MIN_MM, 'hail', MAX_REGIONS, HAIL_MIN_CELLS) : []),
      ...(rot ? findRegions(rot, ROTATION_MIN, 'rotation', MAX_REGIONS, ROTATION_MIN_CELLS) : []),
    ].sort((a, b) => b.max / (b.kind === 'hail' ? HAIL_MIN_MM : ROTATION_MIN) - a.max / (a.kind === 'hail' ? HAIL_MIN_MM : ROTATION_MIN));
    regions.forEach((region, rank) => {
      terrainSurface(region.lat, region.lon, tmp);
      const ring = new Mesh(ringGeo, region.kind === 'hail' ? hailMat : rotMat);
      ring.position.set(tmp.x, tmp.y + 0.3, tmp.z);
      ring.scale.setScalar(region.radiusNm);
      ring.renderOrder = 3;
      ring.frustumCulled = false;
      // Rings for every region, labels only for the strongest few: a
      // frontal swath can hold dozens and the words would tile the map.
      if (rank < MAX_LABELS) {
        const el = document.createElement('div');
        el.className = `aircraft-label severe-label severe-${region.kind}`;
        el.textContent = regionLabel(region);
        const label = new CSS2DObject(el);
        label.position.set(0, 0.6 / region.radiusNm, 0);
        ring.add(label);
      }
      group.add(ring);
    });
  };

  const sync = (): void => {
    const on = severeActive();
    if (on && !unsubHail) {
      unsubHail = subscribeField('mesh', (g) => { hail = g; place(); });
      unsubRot = subscribeField('rotation', (g) => { rot = g; place(); });
      parent.add(group);
    } else if (!on && unsubHail) {
      unsubHail();
      unsubRot?.();
      unsubHail = unsubRot = null;
      hail = rot = null;
      clear();
      parent.remove(group);
    }
  };

  subscribeSettings(sync);
  subscribeHome(() => {
    hail = rot = null;
    clear();
  });
  sync();
}
