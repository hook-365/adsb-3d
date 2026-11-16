// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { decodeChunk, decodeLine, ribbonQuads } from '../src/world/airport-ground';

describe('airport ground detail', () => {
  it('unpacks a delta-coded line', () => {
    expect(decodeLine([4488000, -9322000, 100, -200, -50, 0], 100000)).toEqual([
      [44.88, -93.22],
      [44.881, -93.222],
      [44.8805, -93.222],
    ]);
  });
  it('reads a chunk and leaves out what does not fit', () => {
    const chunk = decodeChunk(
      {
        t: [[1, [4488000, -9322000, 100, 0]], [0, [4488000, -9322000]], 'nope'],
        a: [[4488000, -9322000, 100, 0, 0, 100], [1, 2]],
        b: [],
        g: [['H1', 4487333, -9322979], [7, 1, 2]],
      },
      100000,
    );
    expect(chunk.taxi).toHaveLength(1);
    expect(chunk.taxi[0]!.main).toBe(true);
    expect(chunk.aprons).toHaveLength(1);
    expect(chunk.gates).toEqual([{ ref: 'H1', lat: 44.87333, lon: -93.22979 }]);
    expect(decodeChunk(null, 100000)).toEqual({ taxi: [], aprons: [], terminals: [], gates: [] });
  });
  it('builds a ribbon of the asked width across each segment', () => {
    // One segment running north: the ribbon's width is east-west.
    const [quad] = ribbonQuads([[45, -93], [45.01, -93]], 0.02);
    expect(quad).toHaveLength(4);
    const widthNm = Math.abs(quad![0]![1] - quad![3]![1]) * 60 * Math.cos((45 * Math.PI) / 180);
    expect(widthNm).toBeCloseTo(0.02, 4);
    expect(quad![0]![0]).toBeCloseTo(45);
    expect(ribbonQuads([[45, -93], [45, -93]], 0.02)).toEqual([]);
  });
});
