import { describe, it, expect } from 'vitest';
import {
  CURVE_CEILING_FT,
  biasToExponent,
  warpAltitudeFraction,
} from '../src/core/altitude-curve';

/** Scene-height separation of two altitudes under a bias, in ceiling units. */
function separation(loFt: number, hiFt: number, bias: number): number {
  const k = biasToExponent(bias);
  return (
    warpAltitudeFraction(hiFt / CURVE_CEILING_FT, k) -
    warpAltitudeFraction(loFt / CURVE_CEILING_FT, k)
  );
}

describe('altitude curve', () => {
  it('bias maps log-symmetrically to the exponent', () => {
    expect(biasToExponent(0)).toBe(1);
    expect(biasToExponent(-100)).toBeCloseTo(0.5, 12);
    expect(biasToExponent(100)).toBeCloseTo(2, 12);
    // Symmetry: opposite biases give reciprocal exponents.
    expect(biasToExponent(-40) * biasToExponent(40)).toBeCloseTo(1, 12);
  });

  for (const bias of [-100, -50, 0, 50, 100]) {
    const k = biasToExponent(bias);

    it(`bias ${bias}: pins 0 ft and the ceiling`, () => {
      expect(warpAltitudeFraction(0, k)).toBe(0);
      expect(warpAltitudeFraction(1, k)).toBe(1);
    });

    it(`bias ${bias}: is monotonic through the ceiling and a bit beyond`, () => {
      let prev = -Infinity;
      for (let u = -0.1; u <= 1.2; u += 0.01) {
        const y = warpAltitudeFraction(u, k);
        expect(y).toBeGreaterThan(prev);
        expect(Number.isNaN(y)).toBe(false);
        prev = y;
      }
    });

    it(`bias ${bias}: is odd-symmetric around 0`, () => {
      expect(warpAltitudeFraction(-0.05, k)).toBeCloseTo(-warpAltitudeFraction(0.05, k), 12);
    });
  }

  // The acceptance examples straight from issue #8 at the slider extremes:
  // 1,000 vs 8,000 ft reads far apart under low-detail bias while FL310 vs
  // FL380 pulls together — and high-detail bias inverts both.
  it('bias -100 separates pattern altitudes and compresses flight levels', () => {
    expect(separation(1000, 8000, -100)).toBeGreaterThan(separation(1000, 8000, 0));
    expect(separation(31000, 38000, -100)).toBeLessThan(separation(31000, 38000, 0));
  });

  it('bias 100 compresses pattern altitudes and separates flight levels', () => {
    expect(separation(1000, 8000, 100)).toBeLessThan(separation(1000, 8000, 0));
    expect(separation(31000, 38000, 100)).toBeGreaterThan(separation(31000, 38000, 0));
  });

  // The point of the slider: intermediate biases land strictly between
  // linear and the extreme, so the effect ramps smoothly.
  it('half bias lands between linear and full bias', () => {
    const lo = separation(1000, 8000, 0);
    const mid = separation(1000, 8000, -50);
    const hi = separation(1000, 8000, -100);
    expect(mid).toBeGreaterThan(lo);
    expect(mid).toBeLessThan(hi);
  });
});
