import { describe, it, expect } from 'vitest';
import {
  CURVE_CEILING_FT,
  warpAltitudeFraction,
  type AltitudeCurve,
} from '../src/core/altitude-curve';

const CURVES: AltitudeCurve[] = ['linear', 'spread_low', 'spread_high'];

/** Scene-height separation of two altitudes under a curve, in ceiling units. */
function separation(loFt: number, hiFt: number, curve: AltitudeCurve): number {
  return (
    warpAltitudeFraction(hiFt / CURVE_CEILING_FT, curve) -
    warpAltitudeFraction(loFt / CURVE_CEILING_FT, curve)
  );
}

describe('altitude curves', () => {
  for (const curve of CURVES) {
    it(`${curve}: pins 0 ft and the ceiling`, () => {
      expect(warpAltitudeFraction(0, curve)).toBe(0);
      expect(warpAltitudeFraction(1, curve)).toBe(1);
    });

    it(`${curve}: is monotonic through the ceiling and a bit beyond`, () => {
      let prev = -Infinity;
      for (let u = -0.1; u <= 1.2; u += 0.01) {
        const y = warpAltitudeFraction(u, curve);
        expect(y).toBeGreaterThan(prev);
        expect(Number.isNaN(y)).toBe(false);
        prev = y;
      }
    });

    it(`${curve}: is odd-symmetric around 0`, () => {
      expect(warpAltitudeFraction(-0.05, curve)).toBeCloseTo(
        -warpAltitudeFraction(0.05, curve),
        12,
      );
    });
  }

  // The acceptance examples straight from issue #8: 1,000 vs 8,000 ft should
  // read far apart under spread_low, while FL310 vs FL380 pull together —
  // and spread_high inverts both.
  it('spread_low separates pattern altitudes and compresses flight levels', () => {
    expect(separation(1000, 8000, 'spread_low')).toBeGreaterThan(separation(1000, 8000, 'linear'));
    expect(separation(31000, 38000, 'spread_low')).toBeLessThan(separation(31000, 38000, 'linear'));
  });

  it('spread_high compresses pattern altitudes and separates flight levels', () => {
    expect(separation(1000, 8000, 'spread_high')).toBeLessThan(separation(1000, 8000, 'linear'));
    expect(separation(31000, 38000, 'spread_high')).toBeGreaterThan(separation(31000, 38000, 'linear'));
  });
});
