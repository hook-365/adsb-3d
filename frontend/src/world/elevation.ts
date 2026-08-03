// Terrain elevation service (issue #7). Subscribe-pattern singleton in the
// style of core/settings.ts: tiles.ts drives which terrarium tiles get
// fetched (ensureElevationTile), everyone else samples via elevationFtAt()
// and re-drapes on the subscription callback as tiles arrive.
//
// Source: AWS Open Data terrarium tiles proxied + disk-cached by nginx at
// /tiles/terrain_rgb/{z}/{y}/{x} (same path convention as the basemap
// providers). Elevation is encoded in RGB: meters = (R*256 + G + B/256)
// - 32768; ocean pixels go negative, which the altitude-curve's odd
// symmetry already handles.
//
// elevationFtAt() returns 0 for anything not (yet) loaded, so consumers
// degrade to today's flat-world behavior with no special casing.

import { Vector3 } from 'three';
import { enuToLatLon, toScene } from '../core/coords';
import { TILE_PX, bilinearSample, terrariumToMeters } from './elevation-math';

const FT_PER_M = 3.28084;

function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
}

// Loaded tiles keyed "z/x/y". `null` marks a failed fetch so we don't
// retry every frame; a reload retries naturally.
const tiles = new Map<string, Float32Array | null>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

export function subscribeElevation(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Fetch + decode one terrarium tile (idempotent; concurrent calls share
 * one request). Resolves whether the fetch succeeded or not — failure just
 * leaves that tile flat.
 */
export function ensureElevationTile(z: number, x: number, y: number): Promise<void> {
  const key = `${z}/${x}/${y}`;
  if (tiles.has(key)) return Promise.resolve();
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const p = (async () => {
    try {
      const res = await fetch(`/tiles/terrain_rgb/${z}/${y}/${x}`);
      if (!res.ok) throw new Error(`terrain tile ${key}: HTTP ${res.status}`);
      const bitmap = await createImageBitmap(await res.blob());
      const canvas = document.createElement('canvas');
      canvas.width = TILE_PX;
      canvas.height = TILE_PX;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, TILE_PX, TILE_PX);
      const grid = new Float32Array(TILE_PX * TILE_PX);
      for (let i = 0; i < grid.length; i++) {
        const o = i * 4;
        let m = terrariumToMeters(data[o]!, data[o + 1]!, data[o + 2]!);
        // Sanitize nodata/void pixels: SRTM voids decode to ±32k m and
        // render as kilometer-tall spikes. Anything below the Dead Sea or
        // above Everest is not terrain — treat as sea level. This also
        // flattens deep-ocean bathymetry, which is what an aircraft viz
        // wants anyway (real below-sea-level land like -430 m survives).
        if (m < -450 || m > 9000) m = 0;
        grid[i] = m * FT_PER_M;
      }
      tiles.set(key, grid);
      for (const fn of listeners) fn();
    } catch {
      // Missing tile (ocean at high zooms, proxy outage): stay flat there.
      tiles.set(key, null);
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, p);
  return p;
}

/** Zoom the sampler reads at — kept in lockstep with the basemap grid in tiles.ts. */
export const ELEVATION_ZOOM = 8;

/**
 * Ground elevation in feet ASL at a coordinate, or 0 if the covering tile
 * isn't loaded (or failed). Bilinear within the owning tile; the sub-pixel
 * clamp at tile edges is well under a metre of disagreement.
 */
const groundV = new Vector3();

/**
 * Scene-space ground height at an ENU offset from home (NM east/north) —
 * elevation through the same toScene() curve the aircraft use. 0-ish in a
 * flat world. Shared by ring draping (scene.ts) and the camera's
 * terrain-collision clamp (main.ts).
 */
export function groundSceneY(eastNm: number, northNm: number): number {
  const { lat, lon } = enuToLatLon(eastNm, northNm);
  toScene(lat, lon, elevationFtAt(lat, lon), groundV);
  return groundV.y;
}

export function elevationFtAt(lat: number, lon: number): number {
  const z = ELEVATION_ZOOM;
  const tx = lonToTileX(lon, z);
  const ty = latToTileY(lat, z);
  const grid = tiles.get(`${z}/${Math.floor(tx)}/${Math.floor(ty)}`);
  if (!grid) return 0;
  return bilinearSample(grid, (tx - Math.floor(tx)) * TILE_PX - 0.5, (ty - Math.floor(ty)) * TILE_PX - 0.5);
}
