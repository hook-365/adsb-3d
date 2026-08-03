// Vertical-scale curves for the altitude → scene-height mapping (issue #8).
// Pure math, no imports — consumed by core/coords.ts and unit-tested
// directly.
//
// Every curve pins the same ceiling: 45,000 ft lands at the same scene
// height regardless of curve, so switching curves redistributes the space
// below the ceiling instead of rescaling the whole scene.
//
// - 'linear'      — current behavior; height proportional to altitude.
// - 'spread_low'  — sqrt curve. Pattern-altitude traffic separates clearly
//                   (1,000 vs 8,000 ft far apart); the flight levels
//                   compress (FL310 vs FL380 close together).
// - 'spread_high' — squared curve, the inverse: low altitudes compress and
//                   the flight levels spread, for users watching enroute
//                   traffic.

export type AltitudeCurve = 'linear' | 'spread_low' | 'spread_high';

/** Reference ceiling the curves normalize against. */
export const CURVE_CEILING_FT = 45000;

/**
 * Warp a normalized altitude fraction u = altFt / CURVE_CEILING_FT.
 * Monotonic, f(0) = 0, f(1) = 1 for every curve. Odd-symmetric
 * (f(-u) = -f(u)) so slightly-negative baro altitudes — airfields below
 * sea level, QNH quirks on the ground — stay continuous instead of
 * producing NaN.
 */
export function warpAltitudeFraction(u: number, curve: AltitudeCurve): number {
  switch (curve) {
    case 'spread_low':
      return Math.sign(u) * Math.sqrt(Math.abs(u));
    case 'spread_high':
      return u * Math.abs(u);
    case 'linear':
      return u;
  }
}
