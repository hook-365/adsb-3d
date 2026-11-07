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
