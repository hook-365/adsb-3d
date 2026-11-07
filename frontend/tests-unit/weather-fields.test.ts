// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { makeFieldGrid, parseFieldManifest } from '../src/world/weather-fields';

const manifest = {
  coverage: true,
  builtAt: 1,
  bounds: { west: -90, east: -88, south: 44, north: 46 },
  nx: 4,
  ny: 4,
  fields: {
    echotop18: { time: 100, unit: 'km', scale: 10, offset: 0, log: false, url: '/field.bin?loc=k&f=echotop18&t=100' },
    preciprate: { time: 100, unit: 'mm/h', scale: 32, offset: 0, log: true, url: '/field.bin?loc=k&f=preciprate&t=100' },
    bad: { time: 'x', scale: 10, url: '/nope' },
  },
};

describe('parseFieldManifest', () => {
  it('accepts a well-formed manifest and drops malformed fields', () => {
    const m = parseFieldManifest(manifest)!;
    expect(m).not.toBeNull();
    expect(Object.keys(m.fields)).toEqual(['echotop18', 'preciprate']);
    expect(m.fields.preciprate!.log).toBe(true);
  });
  it('rejects coverage:false and broken shapes', () => {
    expect(parseFieldManifest({ coverage: false })).toBeNull();
    expect(parseFieldManifest({ ...manifest, nx: 0 })).toBeNull();
    expect(parseFieldManifest({ ...manifest, bounds: { west: 'a' } })).toBeNull();
  });
});

describe('FieldGrid', () => {
  const m = parseFieldManifest(manifest)!;
  // Row 0 is north. Put 12.0 km (code 120) at row 1, col 2 and nothing elsewhere.
  const codes = new Uint8Array(16);
  codes[1 * 4 + 2] = 120;
  const echo = makeFieldGrid('echotop18', m.fields.echotop18!, m, codes);

  it('unpacks linear and log codes, with 0 meaning no data', () => {
    expect(echo.unpack(120)).toBeCloseTo(12);
    expect(Number.isNaN(echo.unpack(0))).toBe(true);
    const rate = makeFieldGrid('preciprate', m.fields.preciprate!, m, codes);
    expect(rate.unpack(32)).toBeCloseTo(1);     // 2^(32/32) - 1
    expect(rate.unpack(96)).toBeCloseTo(7);     // 2^3 - 1
  });

  it('samples by nearest cell with row 0 at the north edge', () => {
    // Row 1 spans lat 45.0..45.5, col 2 spans lon -89.0..-88.5.
    expect(echo.valueAt(45.25, -88.75)).toBeCloseTo(12);
    expect(Number.isNaN(echo.valueAt(45.75, -88.75))).toBe(true);   // row 0: empty
    expect(Number.isNaN(echo.valueAt(50, -88.75))).toBe(true);      // outside
    expect(echo.codeAt(50, -88.75)).toBe(-1);
  });

  it('maxNear scans a neighbourhood', () => {
    expect(echo.maxNear(44.25, -89.75, 0)).toBeNaN();     // far corner, nothing
    expect(echo.maxNear(44.25, -89.75, 3)).toBeCloseTo(12); // whole grid in reach
    expect(echo.maxNear(45.75, -88.75, 1)).toBeCloseTo(12); // one row away
  });
});
