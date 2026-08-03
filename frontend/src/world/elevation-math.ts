// Pure terrarium/elevation math, split from elevation.ts so unit tests can
// import it without dragging in the browser-only module graph (coords →
// config → feeds reads window at init).

export const TILE_PX = 256;

/** Decode one terrarium pixel to meters. */
export function terrariumToMeters(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Bilinear sample of a TILE_PX×TILE_PX elevation grid at fractional pixel
 * coordinates, clamped to the tile.
 */
export function bilinearSample(grid: Float32Array, px: number, py: number): number {
  const cx = Math.min(Math.max(px, 0), TILE_PX - 1);
  const cy = Math.min(Math.max(py, 0), TILE_PX - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, TILE_PX - 1);
  const y1 = Math.min(y0 + 1, TILE_PX - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const top = grid[y0 * TILE_PX + x0]! * (1 - fx) + grid[y0 * TILE_PX + x1]! * fx;
  const bottom = grid[y1 * TILE_PX + x0]! * (1 - fx) + grid[y1 * TILE_PX + x1]! * fx;
  return top * (1 - fy) + bottom * fy;
}
