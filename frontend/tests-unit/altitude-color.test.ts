import { describe, expect, it } from 'vitest';
import {
  altitudeColor,
  altitudeColorCached,
  altitudeColorStyleCached,
  altitudeHue,
  altitudeLightness,
  ALT_AIR_S,
  ALT_MILITARY_HEX,
} from '../src/core/altitude-color';

// The cached lookups bucket altitudes into 250 ft slots. Values inside the
// same bucket must return the same Color instance (allocation-free); the
// bucket center must match the uncached (allocating) value bit-for-bit so
// the legend, cones, trails, icons, and labels all agree on hue.

const APPROX = (n: number) => Math.round(n * 1e6) / 1e6;

// Drift guard against tar1090's ColorByAlt (html/defaults.js). These are
// the exact published stop values — if we retune the ramp we no longer
// match globe.adsb.fi and this file should be updated deliberately.
describe('tar1090 ColorByAlt parity', () => {
  it('hue stops match tar1090 exactly', () => {
    expect(altitudeHue(0)).toBe(20);
    expect(altitudeHue(2000)).toBe(32.5);
    expect(altitudeHue(4000)).toBe(43);
    expect(altitudeHue(6000)).toBe(54);
    expect(altitudeHue(8000)).toBe(72);
    expect(altitudeHue(9000)).toBe(85);
    expect(altitudeHue(11000)).toBe(140);
    expect(altitudeHue(40000)).toBe(300);
    expect(altitudeHue(51000)).toBe(360);
  });

  it('clamps to red above the top stop instead of magenta', () => {
    expect(altitudeHue(60000)).toBe(360);
    // hue 360 must wrap to pure red, not clamp inside Three
    const c = altitudeColor(60000, false);
    expect(c.r).toBeGreaterThan(0.8);
    expect(APPROX(c.g)).toBe(APPROX(c.b)); // red channel dominant, g == b
  });

  it('saturation and lightness table match tar1090', () => {
    expect(ALT_AIR_S).toBe(0.88);
    expect(altitudeLightness(20)).toBe(0.5);
    expect(altitudeLightness(140)).toBe(0.41);
    expect(altitudeLightness(240)).toBe(0.58);
    expect(altitudeLightness(300)).toBe(0.43);
    expect(altitudeLightness(360)).toBe(0.53);
  });

  it('interpolates hue between stops', () => {
    expect(altitudeHue(10000)).toBeCloseTo(85 + (140 - 85) * 0.5, 6);
    expect(altitudeHue(45500)).toBeCloseTo(300 + 60 * (5500 / 11000), 6);
  });
});

describe('altitudeColorCached', () => {
  it('military branch returns a single shared instance', () => {
    const a = altitudeColorCached(0, true, false);
    const b = altitudeColorCached(35000, true, false);
    expect(a).toBe(b);
    const ref = altitudeColor(0, true);
    expect(APPROX(a.r)).toBe(APPROX(ref.r));
    expect(APPROX(a.g)).toBe(APPROX(ref.g));
    expect(APPROX(a.b)).toBe(APPROX(ref.b));
    // sanity: military uses the explicit hex
    expect(a.getHex()).toBe(ALT_MILITARY_HEX);
  });

  it('ground branch returns a single shared instance', () => {
    const a = altitudeColorCached(0, false, true);
    const b = altitudeColorCached(99999, false, true);
    expect(a).toBe(b);
    const ref = altitudeColor(0, false, true);
    expect(APPROX(a.r)).toBe(APPROX(ref.r));
    expect(APPROX(a.g)).toBe(APPROX(ref.g));
    expect(APPROX(a.b)).toBe(APPROX(ref.b));
  });

  it('two altitudes in the same 250 ft bucket return the same instance', () => {
    const a = altitudeColorCached(10000, false, false);
    const b = altitudeColorCached(10240, false, false);
    expect(a).toBe(b);
  });

  it('two altitudes in different buckets return different instances', () => {
    const a = altitudeColorCached(10000, false, false);
    const b = altitudeColorCached(10300, false, false);
    expect(a).not.toBe(b);
  });

  it('bucket value matches uncached value at bucket start', () => {
    // Pick a bucket center inside the interpolated air range. 11000 ft
    // hashes to a stable bucket; the uncached path at that exact altitude
    // does the same setHSL call as cache precompute.
    const cached = altitudeColorCached(11000, false, false);
    const fresh = altitudeColor(11000, false, false);
    expect(APPROX(cached.r)).toBe(APPROX(fresh.r));
    expect(APPROX(cached.g)).toBe(APPROX(fresh.g));
    expect(APPROX(cached.b)).toBe(APPROX(fresh.b));
  });

  it('clamps below the low bound to the first bucket', () => {
    const lowest = altitudeColorCached(-9999, false, false);
    const justAtMin = altitudeColorCached(-1000, false, false);
    expect(lowest).toBe(justAtMin);
  });

  it('clamps above the high bound to the last bucket', () => {
    // The last bucket covers altitudes ≥ 80000 ft; everything above that
    // floor collapses to the same shared Color instance.
    const highest = altitudeColorCached(150000, false, false);
    const justAtMax = altitudeColorCached(80000, false, false);
    expect(highest).toBe(justAtMax);
  });
});

describe('altitudeColorStyleCached', () => {
  it('military and ground each return a stable single string', () => {
    expect(altitudeColorStyleCached(0, true, false)).toBe(altitudeColorStyleCached(35000, true, false));
    expect(altitudeColorStyleCached(0, false, true)).toBe(altitudeColorStyleCached(99999, false, true));
  });

  it('air buckets return identical strings within the bucket', () => {
    expect(altitudeColorStyleCached(10000, false, false)).toBe(altitudeColorStyleCached(10240, false, false));
  });

  it('air buckets return distinct strings across bucket boundaries', () => {
    expect(altitudeColorStyleCached(10000, false, false)).not.toBe(altitudeColorStyleCached(10300, false, false));
  });

  it('matches the underlying cached Color.getStyle()', () => {
    const s = altitudeColorStyleCached(11000, false, false);
    expect(s).toBe(altitudeColorCached(11000, false, false).getStyle());
  });
});
