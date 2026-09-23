import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  ImageLoader,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
  Vector3
} from 'three';
import { HOME, RANGE_NM, TERRAIN_ENABLED } from '../core/config';
import { CARTO_API_KEY, CARTO_PATHS, CARTO_SUBDOMAINS } from '../core/basemaps';
import { toScene } from '../core/coords';
import { getSettings, subscribeSettings, type Basemap } from '../core/settings';
import { ELEVATION_ZOOM, elevationFtAt, ensureElevationTile } from './elevation';
import { DIORAMA_PLANES } from './diorama-clip';
import { CHUNK_TILES, edgeBracket, rectDistanceToOrigin, terrainSegmentsFor } from './tile-grid';

// Web Mercator basemap. Most providers go through nginx at
// /tiles/{provider}/{z}/{y}/{x} with a local on-disk cache pre-warmed by
// entrypoint.sh at zoom 8; other zooms fall through to the upstream
// (ESRI/OSM/OpenTopoMap/VFRMap) and pay a network round trip the first time.
//
// CARTO is the exception: its basemap terms prohibit server-side proxying
// or caching and require a per-deployment API key, so the Dark and Voyager
// layers are fetched by the browser directly from CARTO's CDN with
// `?key=` appended (see CARTO_API_KEY in core/config.ts). Without a key
// those two basemaps are unavailable — core/basemaps.ts isBasemapAvailable()
// hides them from the pickers and effectiveBasemap() substitutes OSM.
//
// We compute each tile's geographic corners and project them through the
// same ENU helper the aircraft use, which gives a tile mesh that matches
// the rest of the scene's coordinate frame exactly.
//
// Draw-call budget: tiles are batched into CHUNK_TILES² chunks, each one
// mesh whose texture is a canvas atlas the tile images are painted into
// as they arrive. At z8 the ~100 visible tiles cost ~9 draw calls instead
// of ~100 (z9 hi-res: ~25 instead of ~300) — this dominated XR frame time.

export type TileProvider =
  | 'dark'
  | 'carto_voyager'
  | 'hillshade'
  | 'topo'
  | 'satellite'
  | 'osm'
  // US aeronautical charts via VFRMap (FAA-published, 56-day cycle).
  // The nginx upstream re-renders the URL at container start once it
  // discovers the current cycle date. US-only coverage.
  | 'sectional'         // pure VFR sectional
  | 'sectional_hybrid'  // VFR sectional overlaid with OSM roads
  | 'helicopter'        // helicopter route chart
  | 'ifr_low'           // IFR low-altitude enroute
  | 'ifr_high';         // IFR high-altitude enroute

// Per-provider metadata. `tms: true` means the upstream uses the TMS
// y-axis convention (origin at south) instead of standard XYZ — the
// URL builder flips y for those before going to nginx.
const PROVIDER_META: Record<TileProvider, { tms: boolean }> = {
  dark: { tms: false },
  carto_voyager: { tms: false },
  hillshade: { tms: false },
  topo: { tms: false },
  satellite: { tms: false },
  osm: { tms: false },
  sectional: { tms: true },
  sectional_hybrid: { tms: true },
  helicopter: { tms: true },
  ifr_low: { tms: true },
  ifr_high: { tms: true },
};

const DEFAULT_ZOOM = 8;

/**
 * URL for one tile. CARTO goes straight to their CDN (subdomain picked by
 * tile coordinate so a layer fans out over a-d, as their Leaflet snippet
 * does); everything else goes through the nginx proxy at /tiles.
 */
function tileUrl(provider: TileProvider, basePath: string, z: number, x: number, yForUrl: number): string {
  const cartoPath = CARTO_PATHS[provider as Basemap];
  if (cartoPath && CARTO_API_KEY) {
    const sub = CARTO_SUBDOMAINS[(x + yForUrl) % CARTO_SUBDOMAINS.length]!;
    return `https://${sub}.basemaps.cartocdn.com/${cartoPath}/${z}/${x}/${yForUrl}.png?key=${encodeURIComponent(CARTO_API_KEY)}`;
  }
  return `${basePath}/tiles/${provider}/${z}/${yForUrl}/${x}`;
}

/**
 * Effective basemap tile zoom for the current Settings.hiResTiles value
 * (issue #6). +1 zoom level halves each tile's geographic span in both
 * axes — 4x the tile count (and fetches/textures) for the same ground
 * coverage, sharper imagery at that bandwidth/memory cost. Applies
 * everywhere (desktop and XR), see the setting's own doc comment in
 * core/settings.ts.
 */
export function currentTileZoom(): number {
  return DEFAULT_ZOOM + (getSettings().hiResTiles ? 1 : 0);
}

// 3D terrain (issue #7): with the toggle on, each tile becomes an N×N
// vertex grid displaced by terrarium elevation instead of a flat quad.
// This module is the single gate — when terrainActive() is false no
// elevation tile is ever fetched, so elevationFtAt() returns 0 everywhere
// and every other consumer (rings, ground icons, AGL) degrades to the
// flat world automatically.
//
// TERRAIN_SEGMENTS is the near-field grid at DEFAULT_ZOOM. Hi-res tiles
// are half the span, so they get half the segments: vertex spacing (and
// the terrain's look) stays identical, only the imagery sharpens. Tiles
// centred beyond TERRAIN_LOD_FAR_NM halve again; edges shared with a
// coarser neighbour are pinned to its vertices so no cracks open.
const TERRAIN_SEGMENTS = 48;
const TERRAIN_LOD_FAR_NM = 120;

export function terrainActive(): boolean {
  return TERRAIN_ENABLED && getSettings().terrain3d;
}

// Toggling terrain reloads the page (same pattern as the altitude-curve
// slider): tile and ring geometry bake the displacement in.
let lastTerrain3d = getSettings().terrain3d;
subscribeSettings((s) => {
  if (s.terrain3d !== lastTerrain3d) {
    lastTerrain3d = s.terrain3d;
    if (typeof location !== 'undefined') location.reload();
  }
});

function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
}
function tileXToLon(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}
function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// Approximate tile span at home latitude in NM, for a given zoom level. At
// z=8 lat=45° this is ~60 NM; z=9 (hiResTiles) is half that, so the tile
// grid below must cover twice as many tiles per axis for the same
// RANGE_NM — parametrized on zoom (not a DEFAULT_ZOOM-only constant) so
// currentTileZoom()'s +1 bump doesn't silently under-cover the range.
function tileNmAtHome(z: number): number {
  const lat = HOME.lat;
  const tileLonDeg = 360 / Math.pow(2, z);
  const nmPerLonDeg = 60 * Math.cos((lat * Math.PI) / 180);
  return tileLonDeg * nmPerLonDeg;
}

const tmpV = new Vector3();
const tmpA = new Vector3();
const tmpB = new Vector3();

/** Scene-space distance from home to the nearest point of a tile's footprint. */
function tileDistanceNm(z: number, x: number, y: number): number {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [tx, ty] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]] as const) {
    toScene(tileYToLat(ty, z), tileXToLon(tx, z), 0, tmpV);
    minX = Math.min(minX, tmpV.x);
    maxX = Math.max(maxX, tmpV.x);
    minZ = Math.min(minZ, tmpV.z);
    maxZ = Math.max(maxZ, tmpV.z);
  }
  return rectDistanceToOrigin(minX, maxX, minZ, maxZ);
}

function terrainSegments(z: number, x: number, y: number): number {
  const base = Math.max(12, TERRAIN_SEGMENTS >> Math.max(0, z - DEFAULT_ZOOM));
  toScene(tileYToLat(y + 0.5, z), tileXToLon(x + 0.5, z), 0, tmpV);
  return terrainSegmentsFor(base, Math.hypot(tmpV.x, tmpV.z), TERRAIN_LOD_FAR_NM);
}

/** One tile's geometry, in chunk-atlas UV space, waiting to be merged. */
interface TilePiece {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Atlas UV for a fractional position (fx, fy ∈ [0,1], y southward) inside cell (lx, ly). */
function atlasU(lx: number, fx: number): number {
  return (lx + fx) / CHUNK_TILES;
}
function atlasV(ly: number, fy: number): number {
  // CanvasTexture flipY: canvas row 0 (north) is v = 1.
  return 1 - (ly + fy) / CHUNK_TILES;
}

function buildFlatPiece(z: number, x: number, y: number, lx: number, ly: number, dropY: number): TilePiece {
  const positions = new Float32Array(12);
  const uvs = new Float32Array(8);
  // NW, NE, SW, SE.
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;
  corners.forEach(([fx, fy], v) => {
    toScene(tileYToLat(y + fy, z), tileXToLon(x + fx, z), 0, tmpV);
    positions[v * 3] = tmpV.x;
    positions[v * 3 + 1] = dropY;
    positions[v * 3 + 2] = tmpV.z;
    uvs[v * 2] = atlasU(lx, fx);
    uvs[v * 2 + 1] = atlasV(ly, fy);
  });
  // NW-NE-SW + NE-SE-SW, the original tile winding.
  return { positions, uvs, indices: new Uint32Array([0, 1, 2, 1, 3, 2]) };
}

/** Exact terrain vertex at grid index (i, j) of an s-segment tile. */
function sampleTerrain(z: number, x: number, y: number, s: number, i: number, j: number, out: Vector3): Vector3 {
  const lat = tileYToLat(y + j / s, z);
  const lon = tileXToLon(x + i / s, z);
  return toScene(lat, lon, elevationFtAt(lat, lon), out);
}

/**
 * Terrain tile: an s² grid displaced by ground elevation, projected through
 * the same toScene() as the aircraft so terrain follows the altitude-curve
 * slider automatically. Rows are spaced evenly in Mercator y (not latitude)
 * so the draped imagery's v coordinate stays linear. Edge vertices that a
 * coarser neighbour doesn't have are placed on that neighbour's edge line.
 */
function buildTerrainPiece(z: number, x: number, y: number, lx: number, ly: number, dropY: number): TilePiece {
  const s = terrainSegments(z, x, y);
  const north = terrainSegments(z, x, y - 1);
  const south = terrainSegments(z, x, y + 1);
  const west = terrainSegments(z, x - 1, y);
  const east = terrainSegments(z, x + 1, y);

  const positions = new Float32Array((s + 1) * (s + 1) * 3);
  const uvs = new Float32Array((s + 1) * (s + 1) * 2);
  for (let j = 0; j <= s; j++) {
    for (let i = 0; i <= s; i++) {
      // Pick the neighbour this vertex's edge is shared with, if any.
      let b: { i0: number; i1: number; t: number } | null = null;
      let alongI = true;
      if (j === 0 && i > 0 && i < s) b = edgeBracket(i, s, north);
      else if (j === s && i > 0 && i < s) b = edgeBracket(i, s, south);
      else if (i === 0 && j > 0 && j < s) { b = edgeBracket(j, s, west); alongI = false; }
      else if (i === s && j > 0 && j < s) { b = edgeBracket(j, s, east); alongI = false; }

      if (b && b.i0 !== b.i1) {
        if (alongI) {
          sampleTerrain(z, x, y, s, b.i0, j, tmpA);
          sampleTerrain(z, x, y, s, b.i1, j, tmpB);
        } else {
          sampleTerrain(z, x, y, s, i, b.i0, tmpA);
          sampleTerrain(z, x, y, s, i, b.i1, tmpB);
        }
        tmpV.lerpVectors(tmpA, tmpB, b.t);
      } else {
        sampleTerrain(z, x, y, s, i, j, tmpV);
      }

      const v = j * (s + 1) + i;
      positions[v * 3] = tmpV.x;
      positions[v * 3 + 1] = tmpV.y + dropY;
      positions[v * 3 + 2] = tmpV.z;
      uvs[v * 2] = atlasU(lx, i / s);
      uvs[v * 2 + 1] = atlasV(ly, j / s);
    }
  }
  const indices = new Uint32Array(s * s * 6);
  let o = 0;
  for (let j = 0; j < s; j++) {
    for (let i = 0; i < s; i++) {
      const a = j * (s + 1) + i;
      const b = a + 1;
      const c = a + (s + 1);
      const d = c + 1;
      indices[o++] = a; indices[o++] = b; indices[o++] = c;
      indices[o++] = b; indices[o++] = d; indices[o++] = c;
    }
  }
  return { positions, uvs, indices };
}

const CELL_PX = 256;
// Chunk rebuilds are coalesced on a timer, not requestAnimationFrame: the
// window rAF doesn't run while an immersive XR session is presenting, and
// a basemap change can be made from the wrist menu.
const FLUSH_MS = 50;

interface Chunk {
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  material: MeshBasicMaterial;
  mesh: Mesh | null;
  pieces: Map<string, TilePiece>;
  dirty: boolean;
}

interface LayerState {
  chunks: Map<string, Chunk>;
  flushTimer: ReturnType<typeof setTimeout> | undefined;
}

const layerStates = new WeakMap<Group, LayerState>();

function createChunk(terrain: boolean): Chunk {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CHUNK_TILES * CELL_PX;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  // DoubleSide because our triangle winding produces a -y face normal; the
  // camera looks down at +y so without DoubleSide the tile is culled.
  // Terrain writes depth — mountains must occlude aircraft, trails, and
  // rings behind them; the flat map stays out of the depth buffer.
  const material = new MeshBasicMaterial({
    map: texture,
    depthWrite: terrain,
    side: DoubleSide,
    clippingPlanes: DIORAMA_PLANES,
  });
  return { ctx: canvas.getContext('2d')!, texture, material, mesh: null, pieces: new Map(), dirty: false };
}

function rebuildChunk(group: Group, chunk: Chunk, key: string): void {
  let vertCount = 0;
  let indexCount = 0;
  for (const p of chunk.pieces.values()) {
    vertCount += p.positions.length / 3;
    indexCount += p.indices.length;
  }
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = new Uint32Array(indexCount);
  let vo = 0;
  let io = 0;
  for (const p of chunk.pieces.values()) {
    positions.set(p.positions, vo * 3);
    uvs.set(p.uvs, vo * 2);
    for (let k = 0; k < p.indices.length; k++) indices[io + k] = p.indices[k]! + vo;
    vo += p.positions.length / 3;
    io += p.indices.length;
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('uv', new BufferAttribute(uvs, 2));
  geom.setIndex(new BufferAttribute(indices, 1));
  geom.computeBoundingSphere();

  if (chunk.mesh) {
    chunk.mesh.geometry.dispose();
    chunk.mesh.geometry = geom;
  } else {
    chunk.mesh = new Mesh(geom, chunk.material);
    chunk.mesh.renderOrder = -10; // draw before transparent overlays (rings, trails, altitude lines)
    chunk.mesh.userData = { kind: 'tile-chunk', chunk: key };
    group.add(chunk.mesh);
  }
  chunk.texture.needsUpdate = true;
  chunk.dirty = false;
}

export interface TileLayerOptions {
  provider?: TileProvider;
  zoom?: number;
  basePath?: string;
  /** Drop tiles slightly below y=0 so range rings/grids stay crisply on top. */
  dropY?: number;
}

export function createTileLayer(options: TileLayerOptions = {}): Group {
  const provider = options.provider ?? 'dark';
  const zoom = options.zoom ?? DEFAULT_ZOOM;
  const basePath = options.basePath ?? '';
  const dropY = options.dropY ?? -0.4;
  const terrain = terrainActive();

  const group = new Group();
  group.name = `tiles-${provider}-z${zoom}`;
  const state: LayerState = { chunks: new Map(), flushTimer: undefined };
  layerStates.set(group, state);

  const cx = lonToTileX(HOME.lon, zoom);
  const cy = latToTileY(HOME.lat, zoom);
  const cxFloor = Math.floor(cx);
  const cyFloor = Math.floor(cy);

  // Cover RANGE_NM in each direction, +1 tile padding so the range ring is
  // never at a tile boundary. Square-grid corners that can't come within a
  // tile of the range ring are skipped (~20% of the grid).
  const tileNm = tileNmAtHome(zoom);
  const half = Math.ceil(RANGE_NM / tileNm) + 1;
  const gridX0 = cxFloor - half;
  const gridY0 = cyFloor - half;
  const nMax = Math.pow(2, zoom);

  const scheduleFlush = (): void => {
    if (state.flushTimer !== undefined) return;
    state.flushTimer = setTimeout(() => {
      state.flushTimer = undefined;
      if (group.userData['disposed']) return;
      for (const [key, chunk] of state.chunks) if (chunk.dirty) rebuildChunk(group, chunk, key);
    }, FLUSH_MS);
  };

  const loader = new ImageLoader();
  loader.setCrossOrigin('anonymous');

  let queued = 0;
  let loaded = 0;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const x = cxFloor + dx;
      const y = cyFloor + dy;
      // Skip out-of-range tiles at world poles/wraps (z=8 has 256 tiles per side).
      if (x < 0 || y < 0 || x >= nMax || y >= nMax) continue;
      if (tileDistanceNm(zoom, x, y) > RANGE_NM + tileNm) continue;

      const chunkX = Math.floor((x - gridX0) / CHUNK_TILES);
      const chunkY = Math.floor((y - gridY0) / CHUNK_TILES);
      const lx = x - gridX0 - chunkX * CHUNK_TILES;
      const ly = y - gridY0 - chunkY * CHUNK_TILES;
      const chunkKey = `${chunkX}/${chunkY}`;

      queued++;
      // TMS providers number y from the south, XYZ from the north. nginx
      // proxies what we send straight through to the upstream, so flip
      // here before constructing the URL.
      const yForUrl = PROVIDER_META[provider].tms ? nMax - 1 - y : y;
      const url = tileUrl(provider, basePath, zoom, x, yForUrl);

      const place = (image: HTMLImageElement): void => {
        // The layer may have been disposed (feed switch / basemap change)
        // while this tile or its elevation was in flight.
        if (group.userData['disposed']) return;
        let chunk = state.chunks.get(chunkKey);
        if (!chunk) {
          chunk = createChunk(terrain);
          state.chunks.set(chunkKey, chunk);
        }
        chunk.ctx.drawImage(image, lx * CELL_PX, ly * CELL_PX, CELL_PX, CELL_PX);
        chunk.pieces.set(
          `${x}/${y}`,
          terrain ? buildTerrainPiece(zoom, x, y, lx, ly, dropY) : buildFlatPiece(zoom, x, y, lx, ly, dropY),
        );
        chunk.dirty = true;
        loaded++;
        scheduleFlush();
      };

      loader.load(
        url,
        (image) => {
          if (!terrain) {
            place(image);
            return;
          }
          // Ensure the covering elevation tile plus its 3×3 neighborhood
          // before building, so edge vertices sample loaded neighbors and
          // two adjacent tiles agree at their shared seam. Elevation is
          // always sampled at ELEVATION_ZOOM, whatever the basemap zoom.
          const shift = Math.max(0, zoom - ELEVATION_ZOOM);
          const ex = x >> shift;
          const ey = y >> shift;
          const ensures: Promise<void>[] = [];
          for (let ny = -1; ny <= 1; ny++) {
            for (let nx = -1; nx <= 1; nx++) {
              ensures.push(ensureElevationTile(ELEVATION_ZOOM, ex + nx, ey + ny));
            }
          }
          void Promise.all(ensures).then(() => place(image));
        },
        undefined,
        () => {
          // 404 / network failure: silently skip. The disc/grid still
          // give spatial reference, and tiles will retry on reload.
          loaded++;
        }
      );
    }
  }
  group.userData = { provider, zoom, queued, disposed: false, get loaded() { return loaded; } };

  return group;
}

// Disposes every chunk's geometry/material/atlas texture, and — critically —
// flags the group as disposed BEFORE tearing anything down. In-flight image
// and elevation requests queued by createTileLayer() resolve asynchronously
// (feed switch / basemap change can fire well before every tile lands); the
// load callbacks check this flag and drop the tile instead of resurrecting
// a chunk in a group nobody owns anymore.
export function disposeTileLayer(layer: Group): void {
  layer.userData['disposed'] = true;
  const state = layerStates.get(layer);
  if (!state) return;
  clearTimeout(state.flushTimer);
  for (const chunk of state.chunks.values()) {
    chunk.mesh?.geometry.dispose();
    chunk.texture.dispose();
    chunk.material.dispose();
  }
  state.chunks.clear();
  layerStates.delete(layer);
}
