import { describe, expect, it } from 'vitest';
import {
  autoResolution,
  pickAngle,
  pickNumeric,
  synthSampleAt,
  type HistoricalSample,
} from '../src/feed/historical';

const makeSample = (
  ms: number,
  overrides: Partial<HistoricalSample> = {},
): HistoricalSample => ({
  ms,
  lat: 0,
  lon: 0,
  altFt: 0,
  flight: null,
  gsKt: null,
  trackDeg: null,
  category: null,
  ...overrides,
});

describe('pickNumeric', () => {
  it('both null returns null', () => {
    expect(pickNumeric(null, null, 0.5)).toBeNull();
  });
  it('a null returns b', () => {
    expect(pickNumeric(null, 10, 0.5)).toBe(10);
  });
  it('b null returns a', () => {
    expect(pickNumeric(10, null, 0.5)).toBe(10);
  });
  it('interpolates linearly at t=0.5', () => {
    expect(pickNumeric(0, 100, 0.5)).toBe(50);
  });
  it('t=0 returns a, t=1 returns b', () => {
    expect(pickNumeric(0, 100, 0)).toBe(0);
    expect(pickNumeric(0, 100, 1)).toBe(100);
  });
});

describe('pickAngle', () => {
  it('both null returns null', () => {
    expect(pickAngle(null, null, 0.5)).toBeNull();
  });
  it('one null returns the other', () => {
    expect(pickAngle(null, 90, 0.5)).toBe(90);
    expect(pickAngle(90, null, 0.5)).toBe(90);
  });
  it('interpolates linearly within a quadrant', () => {
    expect(pickAngle(0, 90, 0.5)!).toBeCloseTo(45);
  });
  it('wraps shortest-path forward: 350° → 10° at t=0.5 lands on 0°, not 180°', () => {
    expect(pickAngle(350, 10, 0.5)!).toBeCloseTo(0);
  });
  it('wraps shortest-path backward: 10° → 350° at t=0.5 lands on 0°', () => {
    expect(pickAngle(10, 350, 0.5)!).toBeCloseTo(0);
  });
  it('t=0 returns a, t=1 returns b (both normalized into [0, 360))', () => {
    expect(pickAngle(350, 10, 0)!).toBeCloseTo(350);
    expect(pickAngle(350, 10, 1)!).toBeCloseTo(10);
  });
  it('180° pair is ambiguous; pins current direction (via 270°)', () => {
    // The shortest-path math hits exactly -180; the implementation goes
    // negative, taking us via 270 rather than 90. Test pins behavior,
    // not spec — either direction would be a valid choice.
    expect(pickAngle(0, 180, 0.5)!).toBeCloseTo(270);
  });
});

describe('autoResolution', () => {
  const H = 3_600_000;
  it('1 hour or less returns full resolution', () => {
    expect(autoResolution(1_000)).toBe('full');
    expect(autoResolution(H)).toBe('full');
  });
  it('1h–6h returns 5s', () => {
    expect(autoResolution(H + 1)).toBe('5s');
    expect(autoResolution(6 * H)).toBe('5s');
  });
  it('6h–24h returns 15s', () => {
    expect(autoResolution(6 * H + 1)).toBe('15s');
    expect(autoResolution(24 * H)).toBe('15s');
  });
  it('24h–72h returns 30s', () => {
    expect(autoResolution(24 * H + 1)).toBe('30s');
    expect(autoResolution(72 * H)).toBe('30s');
  });
  it('beyond 72h returns 60s', () => {
    expect(autoResolution(72 * H + 1)).toBe('60s');
    expect(autoResolution(168 * H)).toBe('60s');
  });
});

describe('synthSampleAt', () => {
  it('empty array returns null', () => {
    expect(synthSampleAt([], 1000)).toBeNull();
  });

  it('null when cursor is more than MAX_GAP_MS before the only sample', () => {
    const s = makeSample(100_000);
    expect(synthSampleAt([s], 0)).toBeNull(); // 100s before > 60s gap
  });

  it('returns the only sample when cursor is within MAX_GAP_MS before it', () => {
    const s = makeSample(60_000, { lat: 1, lon: 2 });
    expect(synthSampleAt([s], 0)).toEqual({ sample: s, interpolated: false });
  });

  it('null when cursor is more than MAX_GAP_MS after the only sample', () => {
    expect(synthSampleAt([makeSample(0)], 100_000)).toBeNull();
  });

  it('returns the only sample when cursor is within MAX_GAP_MS after it', () => {
    const s = makeSample(0, { lat: 1, lon: 2 });
    expect(synthSampleAt([s], 60_000)).toEqual({ sample: s, interpolated: false });
  });

  it('cursor exactly at first sample ms returns it non-interpolated', () => {
    const s0 = makeSample(1000, { lat: 1, lon: 2 });
    const s1 = makeSample(2000);
    const r = synthSampleAt([s0, s1], 1000);
    expect(r?.interpolated).toBe(false);
    expect(r?.sample).toBe(s0);
  });

  it('interpolates linearly mid-span', () => {
    const s0 = makeSample(0, { lat: 10, lon: 20, altFt: 1000 });
    const s1 = makeSample(10_000, { lat: 20, lon: 40, altFt: 2000 });
    const r = synthSampleAt([s0, s1], 5000);
    expect(r?.interpolated).toBe(true);
    expect(r?.sample.ms).toBe(5000);
    expect(r?.sample.lat).toBeCloseTo(15);
    expect(r?.sample.lon).toBeCloseTo(30);
    expect(r?.sample.altFt).toBeCloseTo(1500);
  });

  it('interpolated trackDeg wraps shortest path', () => {
    const s0 = makeSample(0, { trackDeg: 350 });
    const s1 = makeSample(10_000, { trackDeg: 10 });
    const r = synthSampleAt([s0, s1], 5000);
    expect(r?.sample.trackDeg!).toBeCloseTo(0);
  });

  it('flight/category prefer after; fall back to before when after is null', () => {
    const s0 = makeSample(0, { flight: 'UAL1', category: 'A3' });
    const s1 = makeSample(10_000, { flight: null, category: null });
    const r = synthSampleAt([s0, s1], 5000);
    expect(r?.sample.flight).toBe('UAL1');
    expect(r?.sample.category).toBe('A3');
  });

  it('span > 2×MAX_GAP_MS, cursor near before → returns before, non-interpolated', () => {
    const before = makeSample(0);
    const after = makeSample(200_000); // span 200s > 120s
    expect(synthSampleAt([before, after], 30_000)).toEqual({
      sample: before,
      interpolated: false,
    });
  });

  it('span > 2×MAX_GAP_MS, cursor near after → returns after, non-interpolated', () => {
    const before = makeSample(0);
    const after = makeSample(200_000);
    expect(synthSampleAt([before, after], 170_000)).toEqual({
      sample: after,
      interpolated: false,
    });
  });

  it('span > 2×MAX_GAP_MS, cursor mid-gap (>MAX_GAP_MS from both) → null', () => {
    const before = makeSample(0);
    const after = makeSample(200_000);
    expect(synthSampleAt([before, after], 100_000)).toBeNull();
  });
});
