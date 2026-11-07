// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { makeFieldGrid, parseFieldManifest } from '../src/world/weather-fields';
import { paintPrecip, precipRgba, rateToDbz, RANK_HAIL, RANK_SNOW } from '../src/world/precip-layer';
import { buildSheet } from '../src/world/freezing-level';

const base = {
  coverage: true, builtAt: 1,
  bounds: { west: -90, east: -88, south: 44, north: 46 }, nx: 3, ny: 2,
  fields: {
    preciprate: { time: 1, unit: 'mm/h', scale: 32, offset: 0, log: true, url: '/r' },
    preciptype: { time: 1, unit: 'rank', scale: 1, offset: 0, log: false, url: '/t' },
    freezing: { time: 1, unit: 'm', scale: 1 / 40, offset: 0, log: false, url: '/f' },
  },
};
const m = parseFieldManifest(base)!;

describe('precip layer painting', () => {
  it('colours rate on the radar ramp via Marshall-Palmer, with type as a tint', () => {
    expect(rateToDbz(1)).toBeCloseTo(23.0, 0);      // 200 R^1.6 at 1 mm/h
    expect(rateToDbz(10)).toBeCloseTo(39.0, 0);
    expect(rateToDbz(50)).toBeCloseTo(50.2, 0);
    expect(precipRgba(0, 1)[3]).toBe(0);            // dry
    expect(precipRgba(0.2, 1)[3]).toBe(0);          // below the 18 dBZ stop
    expect(precipRgba(1, 1).slice(0, 3)).toEqual([4, 233, 231]);     // 23 dBZ: first green-cyan stop
    expect(precipRgba(10, 1).slice(0, 3)).toEqual([1, 197, 1]);      // 39 dBZ: green
    expect(precipRgba(50, 1).slice(0, 3)).toEqual([253, 149, 0]);    // 50 dBZ: orange, same as the cloud
    expect(precipRgba(50, 1)[3]).toBeGreaterThan(precipRgba(1, 1)[3]);
    // Tints pull toward white for snow and magenta for hail, on the same base.
    const snow = precipRgba(10, RANK_SNOW);
    expect(snow[0]).toBeGreaterThan(1);
    expect(snow[2]).toBeGreaterThan(1);
    const hail = precipRgba(10, RANK_HAIL);
    expect(hail[2]).toBeGreaterThan(100);
  });
  it('paints one RGBA pixel per cell, using the type grid when shapes match', () => {
    const rate = makeFieldGrid('preciprate', m.fields.preciprate!, m, new Uint8Array([0, 32, 96, 0, 0, 0]));
    const type = makeFieldGrid('preciptype', m.fields.preciptype!, m, new Uint8Array([0, RANK_SNOW, RANK_HAIL, 0, 0, 0]));
    const px = paintPrecip(rate, type);
    expect(px.length).toBe(24);
    expect(px[3]).toBe(0);                      // dry cell transparent
    expect(px[7]).toBeGreaterThan(0);           // snow at 1 mm/h paints
    expect(px[8]!).toBeGreaterThan(100);        // hail at 7 mm/h carries the magenta tint
    expect(px[11]!).toBeGreaterThan(px[7]!);    // heavier is more opaque
  });
});

describe('freezing level sheet', () => {
  it('places one vertex per cell at the unpacked height and skips holes', () => {
    // 4000 m everywhere except a hole at cell 4.
    const codes = new Uint8Array([100, 100, 100, 100, 0, 100]);
    const grid = makeFieldGrid('freezing', m.fields.freezing!, m, codes);
    const { positions, indices } = buildSheet(grid);
    expect(positions.length).toBe(18);
    // Two quads share the hole (cell 4 = row 1, col 1) as a corner: it
    // kills the left quad's second triangle and both of the right quad's,
    // leaving one triangle.
    expect(indices.length).toBe(3);
    expect(positions[1]).toBeGreaterThan(0);   // y of cell 0: above ground
  });
});

describe('freezing level mask', () => {
  it('cuts the sheet to cells with precipitation when a same-shape mask is given', () => {
    const codes = new Uint8Array([100, 100, 100, 100, 100, 100]);
    const grid = makeFieldGrid('freezing', m.fields.freezing!, m, codes);
    // Rain only in the left column (cells 0 and 3): no whole quad survives.
    const rain = makeFieldGrid('preciprate', m.fields.preciprate!, m, new Uint8Array([32, 0, 0, 32, 0, 0]));
    expect(buildSheet(grid, rain).indices.length).toBe(0);
    // Rain everywhere: both quads, four triangles.
    const wet = makeFieldGrid('preciprate', m.fields.preciprate!, m, new Uint8Array([32, 32, 32, 32, 32, 32]));
    expect(buildSheet(grid, wet).indices.length).toBe(12);
    // A mask of a different shape is ignored.
    const other = parseFieldManifest({ ...base, nx: 2, ny: 2 })!;
    const odd = makeFieldGrid('preciprate', other.fields.preciprate!, other, new Uint8Array(4));
    expect(buildSheet(grid, odd).indices.length).toBe(12);
  });
});

describe('severe cell regions', () => {
  it('finds 4-connected regions above the threshold with centroid, peak and extent', async () => {
    const { findRegions } = await import('../src/world/severe-cells');
    const mm = parseFieldManifest({ ...base, nx: 4, ny: 3, fields: { mesh: { time: 1, unit: 'mm', scale: 2, offset: 0, log: false, url: '/m' } } })!;
    // mm codes (x2): two cells of 30 mm joined, one lone 40 mm cell, one 10 mm (below).
    const codes = new Uint8Array([
      60, 60, 0, 0,
      0, 0, 0, 80,
      20, 0, 0, 0,
    ]);
    const grid = makeFieldGrid('mesh', mm.fields.mesh!, mm, codes);
    const regions = findRegions(grid, 25, 'hail');
    expect(regions.map((r) => [r.max, r.cells])).toEqual([[40, 1], [30, 2]]);   // strongest first
    expect(findRegions(grid, 25, 'hail', 12, 2).map((r) => r.cells)).toEqual([2]); // minCells drops the lone cell
    const pair = regions[1]!;
    expect(pair.lat).toBeCloseTo(46 - (2 / 3) / 2);               // top row centre
    expect(pair.lon).toBeCloseTo(-90 + 0.5 * 0.5 + 0.25);         // between cols 0 and 1
    expect(pair.radiusNm).toBeGreaterThan(1.5);
  });
});

describe('lightning rates', () => {
  it('turns density into per-second flash rates over active cells only', async () => {
    const { activeCells, flashRatePerSec } = await import('../src/world/lightning');
    expect(flashRatePerSec(0, 100)).toBe(0);
    expect(flashRatePerSec(0.6, 100)).toBeCloseTo(1);           // 0.6/km²/min * 100 km² = 60/min
    const lm = parseFieldManifest({ ...base, fields: { lightning: { time: 1, unit: 'f', scale: 40, offset: 0, log: false, url: '/l' } } })!;
    const grid = makeFieldGrid('lightning', lm.fields.lightning!, lm, new Uint8Array([0, 40, 0, 0, 0, 0]));
    const cells = activeCells(grid);
    expect(cells).toHaveLength(1);
    expect(cells[0]!.rate).toBeGreaterThan(0);
    expect(cells[0]!.lat).toBeCloseTo(45.5);
  });
});
