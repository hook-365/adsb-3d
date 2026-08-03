import { describe, it, expect } from 'vitest';
import { terrariumToMeters, bilinearSample, despikeInPlace } from '../src/world/elevation-math';

describe('terrarium decoding', () => {
  it('decodes the documented reference values', () => {
    // meters = (R*256 + G + B/256) - 32768
    expect(terrariumToMeters(128, 0, 0)).toBe(0); // sea level
    expect(terrariumToMeters(128, 248, 0)).toBe(248); // verified live tile pixel
    expect(terrariumToMeters(0, 0, 0)).toBe(-32768); // encoding floor
    expect(terrariumToMeters(128, 0, 128)).toBeCloseTo(0.5, 6); // blue = 1/256 m steps
  });

  it('decodes below-sea-level terrain as negative', () => {
    expect(terrariumToMeters(127, 200, 0)).toBeLessThan(0);
  });
});

describe('bilinear sampling', () => {
  // A 256×256 grid with a horizontal gradient: value = column index.
  const grid = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) grid[y * 256 + x] = x;
  }

  it('returns exact values at pixel centers', () => {
    expect(bilinearSample(grid, 10, 40)).toBe(10);
  });

  it('interpolates between pixels', () => {
    expect(bilinearSample(grid, 10.5, 0)).toBeCloseTo(10.5, 6);
  });

  it('clamps outside the tile instead of reading garbage', () => {
    expect(bilinearSample(grid, -3, 0)).toBe(0);
    expect(bilinearSample(grid, 300, 0)).toBe(255);
  });
});

describe('despike', () => {
  it('removes an isolated glitch needle', () => {
    const grid = new Float32Array(256 * 256).fill(200);
    grid[100 * 256 + 100] = 5200; // lone SRTM glitch
    despikeInPlace(grid, 400);
    expect(grid[100 * 256 + 100]).toBe(200);
  });

  it('preserves a genuine ridgeline', () => {
    const grid = new Float32Array(256 * 256).fill(200);
    for (let y = 0; y < 256; y++) grid[y * 256 + 80] = 1800; // N-S ridge, neighbor-supported
    despikeInPlace(grid, 400);
    expect(grid[100 * 256 + 80]).toBe(1800);
  });

  it('leaves ordinary slopes untouched', () => {
    const grid = new Float32Array(256 * 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) grid[y * 256 + x] = x * 3; // gentle gradient
    }
    const before = grid.slice();
    despikeInPlace(grid, 400);
    expect(grid).toEqual(before);
  });
});
