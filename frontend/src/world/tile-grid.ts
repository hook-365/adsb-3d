// Pure basemap-grid math, split from tiles.ts so unit tests can import it
// without the browser-only module graph (same reason as elevation-math.ts).

/** Tiles per chunk side. One chunk = one mesh + one atlas texture (1024² at 256px tiles). */
export const CHUNK_TILES = 4;

/**
 * Nearest distance (scene units = NM) from the scene origin to an
 * axis-aligned rectangle. Tile footprints are near-rectangular in the ENU
 * frame, so the bounding box of the four projected corners is enough to
 * decide whether a tile can touch the range circle.
 */
export function rectDistanceToOrigin(minX: number, maxX: number, minZ: number, maxZ: number): number {
  const dx = minX > 0 ? minX : maxX < 0 ? -maxX : 0;
  const dz = minZ > 0 ? minZ : maxZ < 0 ? -maxZ : 0;
  return Math.hypot(dx, dz);
}

/**
 * Terrain grid resolution for one tile. `base` is the near-field segment
 * count for the tile's zoom; tiles whose centre lies beyond `farNm` get
 * half. Always a power-of-two ratio so neighbouring edges nest exactly.
 */
export function terrainSegmentsFor(base: number, centerDistNm: number, farNm: number): number {
  return centerDistNm > farNm ? Math.max(2, base / 2) : base;
}

/**
 * Crack-free edge sampling between tiles of different resolution. For grid
 * index `i` on an edge with `fine` segments, shared with a neighbour that
 * has `coarse` segments, returns the two indices of the coarse vertices
 * bracketing `i` and the lerp weight between them. When `i` already lands
 * on a coarse vertex (or the neighbour is not coarser), i0 === i1 === i.
 */
export function edgeBracket(i: number, fine: number, coarse: number): { i0: number; i1: number; t: number } {
  if (coarse >= fine) return { i0: i, i1: i, t: 0 };
  const r = fine / coarse;
  const i0 = Math.floor(i / r) * r;
  if (i0 === i) return { i0: i, i1: i, t: 0 };
  return { i0, i1: i0 + r, t: (i - i0) / r };
}
