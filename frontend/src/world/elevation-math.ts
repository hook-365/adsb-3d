// Pure terrarium/elevation math, split from elevation.ts so unit tests can
// import it without dragging in the browser-only module graph (coords →
// config → feeds reads window at init).

export const TILE_PX = 256;

/** Decode one terrarium pixel to meters. */
export function terrariumToMeters(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Remove isolated elevation glitches (classic SRTM artifacts, common near
 * water boundaries). A pixel is a glitch when at most one of its 8
 * neighbors is within `thresholdM` of its own height — a genuine
 * 1-pixel-wide ridgeline still has 2 supporting neighbors along the
 * ridge, while a needle spike (point or pair) has 0-1. Glitches are
 * replaced by the neighbor median. Reads from a snapshot so the pass is
 * order-independent.
 */
export function despikeInPlace(grid: Float32Array, thresholdM: number): void {
  const src = grid.slice();
  const neighbors: number[] = [];
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const i = y * TILE_PX + x;
      const v = src[i]!;
      neighbors.length = 0;
      let support = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= TILE_PX || ny >= TILE_PX) continue;
          const n = src[ny * TILE_PX + nx]!;
          neighbors.push(n);
          if (Math.abs(n - v) <= thresholdM) support++;
        }
      }
      if (support <= 1) {
        neighbors.sort((a, b) => a - b);
        grid[i] = neighbors[Math.floor(neighbors.length / 2)]!;
      }
    }
  }
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
