import { describe, expect, it } from 'vitest';
import {
  altitudeColor,
  altitudeColorCached,
  altitudeColorStyleCached,
  ALT_MILITARY_HEX,
} from '../src/core/altitude-color';

// The cached lookups bucket altitudes into 250 ft slots. Values inside the
// same bucket must return the same Color instance (allocation-free); the
// bucket center must match the uncached (allocating) value bit-for-bit so
// the legend, cones, trails, icons, and labels all agree on hue.

const APPROX = (n: number) => Math.round(n * 1e6) / 1e6;

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
