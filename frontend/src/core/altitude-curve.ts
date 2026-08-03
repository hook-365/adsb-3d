// Vertical-scale curve for the altitude → scene-height mapping (issue #8).
// Pure math, no imports — consumed by core/coords.ts and unit-tested
// directly.
//
// One continuous power-curve family instead of discrete presets: the user
// slides a bias in [-100, 100] which maps log-symmetrically to an exponent
// k = 2^(bias/100) in [0.5, 2], and height = u^k of the normalized
// altitude. Bias 0 is exactly linear; -100 is the sqrt curve (pattern
// traffic spreads apart, flight levels compress); +100 is the squared
// curve (the inverse, for enroute watchers); everything between is a
// proportionally milder blend.
//
// Every exponent pins the same ceiling: 45,000 ft lands at the same scene
// height regardless of bias, so the slider redistributes the space below
// the ceiling instead of rescaling the whole scene.

/** Reference ceiling the curve normalizes against. */
export const CURVE_CEILING_FT = 45000;

/** Slider bias (-100 = low-altitude detail … 100 = high-altitude detail) → exponent. */
export function biasToExponent(bias: number): number {
  return 2 ** (bias / 100);
}

/**
 * Warp a normalized altitude fraction u = altFt / CURVE_CEILING_FT by the
 * power curve u^exponent. Monotonic, f(0) = 0, f(1) = 1 for every
 * exponent. Odd-symmetric (f(-u) = -f(u)) so slightly-negative baro
 * altitudes — airfields below sea level, QNH quirks on the ground — stay
 * continuous instead of producing NaN.
 */
export function warpAltitudeFraction(u: number, exponent: number): number {
  return Math.sign(u) * Math.abs(u) ** exponent;
}
