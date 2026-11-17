// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildHeightLut, manifestUrl, parseVolumeManifest, rampTable } from '../src/world/storms';

const manifest = {
  coverage: true,
  time: 1_762_380_000,
  builtAt: 1_762_380_100,
  bounds: { west: -100.37, east: -89.63, south: 34.82, north: 43.18 },
  nx: 214,
  ny: 167,
  nz: 3,
  heightsKm: [0.5, 1, 2],
  levelsMissing: [],
  url: '/volume.bin?loc=39.00,-95.00&t=1762380000',
};

describe('manifestUrl', () => {
  it('carries the active home at 4 decimals so one sidecar serves every feed', () => {
    expect(manifestUrl(44.123456, -88.9)).toBe('/weather-api/volume?lat=44.1235&lon=-88.9000');
  });
});

describe('parseVolumeManifest', () => {
  it('accepts a weather-service manifest and copies it', () => {
    const m = parseVolumeManifest(manifest);
    expect(m).not.toBeNull();
    expect(m!.nz).toBe(3);
    expect(m!.heightsKm).toEqual([0.5, 1, 2]);
    expect(m!.heightsKm).not.toBe(manifest.heightsKm);
  });
  it('rejects coverage:false, junk, and inconsistent shapes', () => {
    expect(parseVolumeManifest({ coverage: false, home: true })).toBeNull();
    expect(parseVolumeManifest(null)).toBeNull();
    expect(parseVolumeManifest({ ...manifest, heightsKm: [0.5, 1] })).toBeNull();
    expect(parseVolumeManifest({ ...manifest, bounds: { ...manifest.bounds, east: -101 } })).toBeNull();
    expect(parseVolumeManifest({ ...manifest, nz: 1, heightsKm: [0.5] })).toBeNull();
  });
});

describe('buildHeightLut', () => {
  it('maps each layer height to that layer centre and is monotonic', () => {
    // Non-linear layer spacing, like the altitude curve produces.
    const layerY = [0, 1, 4, 9, 16];
    const nz = layerY.length;
    const lut = buildHeightLut(layerY, 1601);
    const at = (y: number): number => lut[Math.round((y / 16) * 1600)]!;
    for (let k = 0; k < nz; k++) expect(at(layerY[k]!)).toBeCloseTo((k + 0.5) / nz, 3);
    // Halfway between layer 1 (y=1) and layer 2 (y=4) in height is halfway in depth.
    expect(at(2.5)).toBeCloseTo((1.5 + 0.5) / nz, 3);
    for (let i = 1; i < lut.length; i++) expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]!);
    expect(lut[0]).toBeCloseTo(0.5 / nz, 6);
    expect(lut[lut.length - 1]).toBeCloseTo((nz - 0.5) / nz, 6);
  });
  it('tolerates underground layers clamped to one height (flat mode)', () => {
    const lut = buildHeightLut([0, 0, 0, 2, 4], 9);
    expect(Number.isNaN(lut[0])).toBe(false);
    // y=0 resolves to the LAST clamped layer, so the march starts at real data.
    expect(lut[0]).toBeCloseTo((2 + 0.5) / 5, 6);
    expect(lut[8]).toBeCloseTo((4 + 0.5) / 5, 6);
  });
});

describe('rampTable', () => {
  it('is transparent below 18 dBZ and opaque-ish red by 55', () => {
    const t = rampTable(64);
    const entry = (dbz: number): number[] => {
      const i = Math.round((dbz / 80) * 63) * 4;
      return [...t.slice(i, i + 4)];
    };
    expect(entry(0)[3]).toBe(0);
    expect(entry(10)[3]).toBe(0);
    expect(entry(20)[3]).toBeGreaterThan(0);
    const red = entry(56);
    expect(red[0]).toBeGreaterThan(200);
    expect(red[3]).toBeGreaterThan(entry(20)[3]!);
  });
});

describe('buildKmLut', () => {
  it('maps box y back to km through the irregular layer spacing', async () => {
    const { buildKmLut } = await import('../src/world/storms');
    // Layers at scene y 0, 10, 40 for 0.5, 1, 19 km: non-linear on purpose.
    const lut = buildKmLut([0, 10, 40], [0.5, 1, 19], 5);
    expect(lut[0]).toBeCloseTo(0.5);
    expect(lut[1]).toBeCloseTo(1);          // y=10: exactly layer 1
    expect(lut[2]).toBeCloseTo(1 + 18 / 3); // y=20: a third of the way 10..40
    expect(lut[4]).toBeCloseTo(19);
  });
});

describe('buildOccupancy', () => {
  it('reports a clear-sky volume as empty', async () => {
    const { buildOccupancy } = await import('../src/world/storms');
    const occ = buildOccupancy(new Uint8Array(32 * 32 * 3).fill(5), 32, 32, 3);
    expect(occ.any).toBe(false);
    expect(occ.data.some((v) => v !== 0)).toBe(false);
  });

  it('marks the block holding an echo in any layer, grown by the dilation', async () => {
    const { buildOccupancy } = await import('../src/world/storms');
    const nx = 64;
    const ny = 64;
    const nz = 3;
    const vol = new Uint8Array(nx * ny * nz);
    // One cell in the top layer, at x = 36, y = 20: block (4, 2) of an 8 x 8 map.
    vol[36 + nx * (20 + ny * 2)] = 40;
    const occ = buildOccupancy(vol, nx, ny, nz, 8, 1);
    expect([occ.w, occ.h, occ.any]).toEqual([8, 8, true]);
    // The value is the storm's top layer plus one (the echo is in layer 2).
    const at = (x: number, y: number): number => occ.data[y * occ.w + x]!;
    expect(at(4, 2)).toBe(3);
    expect([at(3, 1), at(5, 3)]).toEqual([3, 3]);
    expect([at(6, 2), at(4, 4), at(0, 0)]).toEqual([0, 0, 0]);
  });

  it('keeps the tallest top where grown neighbourhoods overlap', async () => {
    const { buildOccupancy } = await import('../src/world/storms');
    const nx = 64;
    const ny = 64;
    const nz = 6;
    const vol = new Uint8Array(nx * ny * nz);
    vol[4 + nx * (4 + ny * 1)] = 40; // block (0, 0), top layer 1
    vol[20 + nx * (4 + ny * 5)] = 40; // block (2, 0), top layer 5
    const occ = buildOccupancy(vol, nx, ny, nz, 8, 1);
    expect(occ.data[0]).toBe(2);
    expect(occ.data[1]).toBe(6); // between the two: the taller wins
    expect(occ.data[2]).toBe(6);
  });

  it('asks for enough coarse strides that none can step over a grown cell', async () => {
    const { minCoarseSteps } = await import('../src/world/storms');
    // 256 x 256 volume, 8-cell blocks grown by 2: a stride may span 32 cells of a 362-cell diagonal.
    expect(minCoarseSteps(256, 256, 8, 2)).toBe(12);
    expect(minCoarseSteps(256, 256, 8, 1)).toBe(23);
  });
});

describe('parseStormScale', () => {
  it('reads a fraction and refuses anything that is not a reduction', async () => {
    const { parseStormScale } = await import('../src/world/storms');
    expect(parseStormScale('?stormScale=0.5')).toBe(0.5);
    expect(parseStormScale('?perf=1')).toBeNull();
    expect(parseStormScale('?stormScale=1')).toBeNull();
    expect(parseStormScale('?stormScale=0')).toBeNull();
    expect(parseStormScale('?stormScale=abc')).toBeNull();
  });
});
