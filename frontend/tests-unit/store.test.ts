import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AircraftStore,
  MAX_TRAIL_POINTS,
  getDefaultTrailCap,
  setDefaultTrailCap,
  type TrailPoint,
} from '../src/aircraft/store';
import type { Aircraft } from '../src/core/types';

// Module-level default trail cap is process-wide singleton state. Restore
// it after each test so changes here don't leak into the rest of the suite.
afterEach(() => {
  setDefaultTrailCap(MAX_TRAIL_POINTS);
});

const pt = (ms: number, lat = 0, lon = 0, altFt = 0): TrailPoint => ({ ms, lat, lon, altFt });

function ac(hex: string, over: Partial<Aircraft> = {}): Aircraft {
  return {
    hex,
    callsign: null,
    registration: null,
    typeCode: null,
    description: null,
    category: null,
    operator: null,
    lat: 0,
    lon: 0,
    altFt: 10000,
    altFtKnown: true,
    onGround: false,
    groundSpeedKt: null,
    trackDeg: null,
    verticalRateFpm: null,
    military: false,
    specialInterest: false,
    privacyIcao: false,
    ladd: false,
    squawk: null,
    emergency: null,
    apAltMcpFt: null,
    apAltFmsFt: null,
    apHeadingDeg: null,
    apQnhHpa: null,
    apModes: null,
    lastSeenMs: 1_000,
    lastUpdateMs: 1_000,
    ...over,
  };
}

describe('AircraftStore.setTrail', () => {
  it('empty array deletes the existing entry', () => {
    const s = new AircraftStore();
    s.setTrail('abc', [pt(1), pt(2)]);
    expect(s.trails('abc')).toHaveLength(2);
    s.setTrail('abc', []);
    expect(s.trails('abc')).toBeUndefined();
  });

  it('stores under-cap input at the given length', () => {
    const s = new AircraftStore();
    s.setTrail('abc', [pt(1), pt(2), pt(3)]);
    expect(s.trails('abc')).toHaveLength(3);
  });

  it('trims over-cap input to the last MAX_TRAIL_POINTS points', () => {
    const s = new AircraftStore();
    const n = MAX_TRAIL_POINTS + 100;
    const input: TrailPoint[] = [];
    for (let i = 0; i < n; i++) input.push(pt(i));
    s.setTrail('abc', input);
    const stored = s.trails('abc')!;
    expect(stored).toHaveLength(MAX_TRAIL_POINTS);
    expect(stored[0]!.ms).toBe(n - MAX_TRAIL_POINTS);
    expect(stored[stored.length - 1]!.ms).toBe(n - 1);
  });

  it('array-copies its input: pushing onto the source after the call does not lengthen the stored trail', () => {
    // setTrail spreads `[...trimmed]` so callers can mutate the array
    // shape (push/splice/length=). It does NOT deep-copy individual
    // TrailPoint fields — callers in practice always pass freshly
    // built TrailPoints, so the cheaper shallow copy is enough.
    const s = new AircraftStore();
    const input = [pt(1, 10), pt(2, 20)];
    s.setTrail('abc', input);
    input.push(pt(3, 30));
    input.length = 0;
    expect(s.trails('abc')).toHaveLength(2);
  });
});

describe('AircraftStore.mergeHistory', () => {
  it('empty history is a no-op (does not fire listener)', () => {
    const s = new AircraftStore();
    const spy = vi.fn();
    s.subscribe(spy);
    s.mergeHistory('abc', []);
    expect(spy).not.toHaveBeenCalled();
  });

  it('merges into empty existing → history becomes the full trail', () => {
    const s = new AircraftStore();
    s.mergeHistory('abc', [pt(1), pt(2), pt(3)]);
    expect(s.trails('abc')!.map((p) => p.ms)).toEqual([1, 2, 3]);
  });

  it('prepends strictly-older history ahead of the existing trail', () => {
    const s = new AircraftStore();
    s.setTrail('abc', [pt(100), pt(200)]);
    s.mergeHistory('abc', [pt(10), pt(50)]);
    expect(s.trails('abc')!.map((p) => p.ms)).toEqual([10, 50, 100, 200]);
  });

  it('drops history at the first overlap with existing oldest (ascending early-break)', () => {
    const s = new AircraftStore();
    s.setTrail('abc', [pt(100), pt(200)]);
    s.mergeHistory('abc', [pt(50), pt(99), pt(100), pt(150)]);
    expect(s.trails('abc')!.map((p) => p.ms)).toEqual([50, 99, 100, 200]);
  });

  it('fully-overlapping history is a no-op (no listener fire, trail unchanged)', () => {
    const s = new AircraftStore();
    s.setTrail('abc', [pt(100), pt(200)]);
    const spy = vi.fn();
    s.subscribe(spy);
    s.mergeHistory('abc', [pt(100), pt(150), pt(200)]);
    expect(spy).not.toHaveBeenCalled();
    expect(s.trails('abc')!.map((p) => p.ms)).toEqual([100, 200]);
  });

  it('caps total length at MAX_TRAIL_POINTS, trimming the oldest points', () => {
    const s = new AircraftStore();
    const existing: TrailPoint[] = [];
    for (let i = 0; i < 500; i++) existing.push(pt(1000 + i));
    s.setTrail('abc', existing);
    const history: TrailPoint[] = [];
    for (let i = 0; i < 200; i++) history.push(pt(i));
    s.mergeHistory('abc', history);
    const stored = s.trails('abc')!;
    expect(stored).toHaveLength(MAX_TRAIL_POINTS);
    // Concatenated would be [0..199, 1000..1499] = 700; trim first 100.
    expect(stored[0]!.ms).toBe(100);
    expect(stored[stored.length - 1]!.ms).toBe(1499);
  });

  it('listener fires exactly once on a successful merge', () => {
    const s = new AircraftStore();
    const spy = vi.fn();
    s.subscribe(spy);
    s.mergeHistory('abc', [pt(1)]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('AircraftStore.getRev', () => {
  it('unknown hex reads 0', () => {
    const s = new AircraftStore();
    expect(s.getRev('abc')).toBe(0);
  });

  it('first sight bumps a new aircraft to rev 1', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc')]);
    expect(s.getRev('abc')).toBe(1);
  });

  it('resync with identical render-relevant fields does not bump rev', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc', { lat: 10, lon: 20, altFt: 30000 })]);
    expect(s.getRev('abc')).toBe(1);
    // lastSeenMs / lastUpdateMs advance every feed tick but are excluded
    // from the comparison set — bumping them alone must not dirty the rev.
    s.syncFromFeed([ac('abc', { lat: 10, lon: 20, altFt: 30000, lastSeenMs: 2_000, lastUpdateMs: 2_000 })]);
    expect(s.getRev('abc')).toBe(1);
  });

  it('changing a render-relevant field bumps rev', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc', { altFt: 30000 })]);
    s.syncFromFeed([ac('abc', { altFt: 31000 })]);
    expect(s.getRev('abc')).toBe(2);
  });

  it('drop on a feed sync clears the rev', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc')]);
    s.syncFromFeed([]);
    expect(s.getRev('abc')).toBe(0);
  });

  it('clear() resets revs for all hexes', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc'), ac('def')]);
    s.clear();
    expect(s.getRev('abc')).toBe(0);
    expect(s.getRev('def')).toBe(0);
  });

  it('rev bumps once per resync that changes a field, not per field changed', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc', { altFt: 30000, callsign: 'A' })]);
    s.syncFromFeed([ac('abc', { altFt: 31000, callsign: 'B', groundSpeedKt: 420 })]);
    expect(s.getRev('abc')).toBe(2);
  });
});

describe('AircraftStore trail cap', () => {
  it('default cap is MAX_TRAIL_POINTS', () => {
    expect(getDefaultTrailCap()).toBe(MAX_TRAIL_POINTS);
  });

  it('setDefaultTrailCap raises the default applied by appendTrail', () => {
    setDefaultTrailCap(10);
    const s = new AircraftStore();
    for (let i = 0; i < 25; i++) {
      s.syncFromFeed([ac('abc', { lat: 10 + i * 0.01, lon: 20, lastUpdateMs: 1000 + i * 1000 })]);
    }
    expect(s.trails('abc')!.length).toBe(10);
  });

  it('setDefaultTrailCap with Infinity disables trimming', () => {
    setDefaultTrailCap(Number.POSITIVE_INFINITY);
    const s = new AircraftStore();
    for (let i = 0; i < 1500; i++) {
      s.syncFromFeed([ac('abc', { lat: 10 + i * 0.01, lon: 20, lastUpdateMs: 1000 + i * 1000 })]);
    }
    expect(s.trails('abc')!.length).toBe(1500);
  });

  it('per-hex setTrailCap overrides the default for that hex', () => {
    setDefaultTrailCap(5);
    const s = new AircraftStore();
    s.setTrailCap('abc', 50);
    for (let i = 0; i < 30; i++) {
      s.syncFromFeed([ac('abc', { lat: 10 + i * 0.01, lon: 20, lastUpdateMs: 1000 + i * 1000 })]);
    }
    expect(s.trails('abc')!.length).toBe(30);
  });

  it('per-hex setTrailCap immediately trims an existing over-cap trail', () => {
    const s = new AircraftStore();
    for (let i = 0; i < 50; i++) {
      s.syncFromFeed([ac('abc', { lat: 10 + i * 0.01, lon: 20, lastUpdateMs: 1000 + i * 1000 })]);
    }
    expect(s.trails('abc')!.length).toBe(50);
    s.setTrailCap('abc', 10);
    expect(s.trails('abc')!.length).toBe(10);
  });

  it('setTrailCap to Infinity does not re-trim or affect existing trail length', () => {
    const s = new AircraftStore();
    for (let i = 0; i < 50; i++) {
      s.syncFromFeed([ac('abc', { lat: 10 + i * 0.01, lon: 20, lastUpdateMs: 1000 + i * 1000 })]);
    }
    const beforeLen = s.trails('abc')!.length;
    s.setTrailCap('abc', Number.POSITIVE_INFINITY);
    expect(s.trails('abc')!.length).toBe(beforeLen);
  });

  it('per-hex cap survives drop-and-reappear within the same session', () => {
    const s = new AircraftStore();
    s.setTrailCap('abc', 25);
    s.syncFromFeed([ac('abc')]);
    // Aircraft leaves the feed.
    s.syncFromFeed([]);
    expect(s.trails('abc')).toBeUndefined();
    // Aircraft reappears — its custom cap should still apply.
    expect(s.getTrailCap('abc')).toBe(25);
  });

  it('setTrail honors per-hex cap on input slicing', () => {
    const s = new AircraftStore();
    s.setTrailCap('abc', 5);
    const input: TrailPoint[] = [];
    for (let i = 0; i < 20; i++) input.push(pt(i));
    s.setTrail('abc', input);
    expect(s.trails('abc')!.length).toBe(5);
    // Should keep the most recent N (the highest ms values).
    expect(s.trails('abc')![0]!.ms).toBe(15);
    expect(s.trails('abc')![4]!.ms).toBe(19);
  });

  it('setTrail with unlimited cap stores the full input', () => {
    setDefaultTrailCap(Number.POSITIVE_INFINITY);
    const s = new AircraftStore();
    const input: TrailPoint[] = [];
    for (let i = 0; i < 2000; i++) input.push(pt(i));
    s.setTrail('abc', input);
    expect(s.trails('abc')!.length).toBe(2000);
  });

  it('mergeHistory honors per-hex cap', () => {
    const s = new AircraftStore();
    s.setTrailCap('abc', 100);
    // Seed live trail with 50 points starting at ms=1000.
    const liveSeed: TrailPoint[] = [];
    for (let i = 0; i < 50; i++) liveSeed.push(pt(1000 + i));
    s.setTrail('abc', liveSeed);
    // Merge 200 history points strictly older than ms=1000.
    const hist: TrailPoint[] = [];
    for (let i = 0; i < 200; i++) hist.push(pt(i));
    s.mergeHistory('abc', hist);
    expect(s.trails('abc')!.length).toBe(100);
    // Most recent 100: ms=950..1049 (last 50 history + 50 live).
    expect(s.trails('abc')![0]!.ms).toBe(150);
  });
});

describe('AircraftStore altitude inheritance', () => {
  it('first frame with altFtKnown=false passes through at altFt=0', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc', { altFt: 0, altFtKnown: false })]);
    expect(s.snapshot.get('abc')!.altFt).toBe(0);
  });

  it('subsequent altFtKnown=false frame inherits last known altitude', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc', { altFt: 31000, altFtKnown: true })]);
    s.syncFromFeed([ac('abc', { altFt: 0, altFtKnown: false, lastUpdateMs: 2000 })]);
    expect(s.snapshot.get('abc')!.altFt).toBe(31000);
    expect(s.snapshot.get('abc')!.altFtKnown).toBe(true);
  });

  it('altFtKnown=true updates the cache for later inheritance', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc', { altFt: 10000, altFtKnown: true })]);
    s.syncFromFeed([ac('abc', { altFt: 22000, altFtKnown: true, lastUpdateMs: 2000 })]);
    s.syncFromFeed([ac('abc', { altFt: 0, altFtKnown: false, lastUpdateMs: 3000 })]);
    // Should inherit the more recent 22000, not the older 10000.
    expect(s.snapshot.get('abc')!.altFt).toBe(22000);
  });

  it('ground frame sets cache to zero; later no-altitude frame stays at zero', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc', { altFt: 0, altFtKnown: true, onGround: true })]);
    s.syncFromFeed([ac('abc', { altFt: 0, altFtKnown: false, lastUpdateMs: 2000 })]);
    expect(s.snapshot.get('abc')!.altFt).toBe(0);
  });

  it('clear() drops the altitude cache', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc', { altFt: 31000, altFtKnown: true })]);
    s.clear();
    s.syncFromFeed([ac('abc', { altFt: 0, altFtKnown: false })]);
    // Cache was cleared → no inherited value, fresh aircraft passes through at 0.
    expect(s.snapshot.get('abc')!.altFt).toBe(0);
  });

  it('aircraft dropping from feed removes its altitude cache entry', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc', { altFt: 31000, altFtKnown: true })]);
    s.syncFromFeed([]); // aircraft leaves
    s.syncFromFeed([ac('abc', { altFt: 0, altFtKnown: false, lastUpdateMs: 3000 })]);
    // After the drop, no inherited altitude → passes through at 0.
    expect(s.snapshot.get('abc')!.altFt).toBe(0);
  });

  it('does not infect other aircraft (cache is per-hex)', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc', { altFt: 35000, altFtKnown: true })]);
    s.syncFromFeed([ac('def', { altFt: 0, altFtKnown: false })]);
    expect(s.snapshot.get('def')!.altFt).toBe(0);
  });
});

describe('AircraftStore.appendTrail stationary dedup', () => {
  it('moving aircraft appends every position update past the dt floor', () => {
    setDefaultTrailCap(Number.POSITIVE_INFINITY);
    const s = new AircraftStore();
    // 10 seconds of clearly-moving updates at 1Hz.
    for (let i = 0; i < 10; i++) {
      s.syncFromFeed([
        ac('abc', { lat: 10 + i * 0.001, lon: 20, lastUpdateMs: 1000 + i * 1000 }),
      ]);
    }
    expect(s.trails('abc')!.length).toBe(10);
  });

  it('stationary aircraft appends only once per ~60s, not once per second', () => {
    setDefaultTrailCap(Number.POSITIVE_INFINITY);
    const s = new AircraftStore();
    // 5 minutes of "no movement" updates at 1Hz. With the stationary
    // dedup gate, only the initial point plus one per minute should land.
    for (let i = 0; i < 300; i++) {
      s.syncFromFeed([ac('abc', { lat: 10, lon: 20, lastUpdateMs: 1000 + i * 1000 })]);
    }
    const trail = s.trails('abc')!;
    // First point (1000ms) + one ~every 60s. 300s of stationary updates →
    // first sample, then samples at offsets 60s, 120s, 180s, 240s, 300s.
    expect(trail.length).toBeGreaterThanOrEqual(5);
    expect(trail.length).toBeLessThanOrEqual(7);
  });

  it('twelve-hour parked aircraft stays small (not ~43k points)', () => {
    setDefaultTrailCap(Number.POSITIVE_INFINITY);
    const s = new AircraftStore();
    for (let i = 0; i < 12 * 60 * 60; i++) {
      s.syncFromFeed([ac('abc', { lat: 10, lon: 20, lastUpdateMs: 1000 + i * 1000 })]);
    }
    const trail = s.trails('abc')!;
    // ~720 points expected (one per minute). Allow generous slack for
    // first/last edge cases; the cap that matters is "not anywhere near
    // the 43200 we'd get without the dedup."
    expect(trail.length).toBeLessThan(800);
    expect(trail.length).toBeGreaterThan(600);
  });

  it('transition from stationary to moving captures the first motion sample', () => {
    setDefaultTrailCap(Number.POSITIVE_INFINITY);
    const s = new AircraftStore();
    // Sit still for 90 seconds.
    for (let i = 0; i < 90; i++) {
      s.syncFromFeed([ac('abc', { lat: 10, lon: 20, lastUpdateMs: 1000 + i * 1000 })]);
    }
    const beforeMove = s.trails('abc')!.length;
    // Now move (delta crosses MIN_MOVE_DEG): should append immediately.
    s.syncFromFeed([ac('abc', { lat: 10.001, lon: 20, lastUpdateMs: 91_000 })]);
    expect(s.trails('abc')!.length).toBe(beforeMove + 1);
  });

  it('sub-MIN_TRAIL_DT_MS bursts are suppressed even when moving', () => {
    setDefaultTrailCap(Number.POSITIVE_INFINITY);
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc', { lat: 10, lon: 20, lastUpdateMs: 1000 })]);
    // Same aircraft re-emitted 100ms later, with movement. The 500ms gate
    // still applies — protects against feed double-stamps.
    s.syncFromFeed([ac('abc', { lat: 10.01, lon: 20, lastUpdateMs: 1100 })]);
    expect(s.trails('abc')!.length).toBe(1);
  });
});

describe('AircraftStore.getTrailRev', () => {
  it('unknown hex reads 0', () => {
    const s = new AircraftStore();
    expect(s.getTrailRev('abc')).toBe(0);
  });

  it('first feed sync bumps trailRev once (initial point pushed)', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc', { lat: 10, lon: 20 })]);
    expect(s.getTrailRev('abc')).toBe(1);
  });

  it('resync with identical position does not bump trailRev (move threshold not crossed)', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc', { lat: 10, lon: 20, lastUpdateMs: 1_000 })]);
    expect(s.getTrailRev('abc')).toBe(1);
    // Same lat/lon, very small dt — appendTrail's gate suppresses the push.
    s.syncFromFeed([ac('abc', { lat: 10, lon: 20, lastUpdateMs: 1_100 })]);
    expect(s.getTrailRev('abc')).toBe(1);
  });

  it('resync that moves enough bumps trailRev', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc', { lat: 10, lon: 20, lastUpdateMs: 1_000 })]);
    s.syncFromFeed([ac('abc', { lat: 10.01, lon: 20.01, lastUpdateMs: 2_000 })]);
    expect(s.getTrailRev('abc')).toBe(2);
  });

  it('setTrail bumps trailRev', () => {
    const s = new AircraftStore();
    s.setTrail('abc', [pt(1)]);
    expect(s.getTrailRev('abc')).toBe(1);
    s.setTrail('abc', [pt(1), pt(2)]);
    expect(s.getTrailRev('abc')).toBe(2);
  });

  it('setTrail([]) on existing trail bumps trailRev; on missing hex it does not', () => {
    const s = new AircraftStore();
    expect(s.getTrailRev('abc')).toBe(0);
    s.setTrail('abc', []);
    expect(s.getTrailRev('abc')).toBe(0);
    s.setTrail('abc', [pt(1)]);
    expect(s.getTrailRev('abc')).toBe(1);
    s.setTrail('abc', []);
    expect(s.getTrailRev('abc')).toBe(2);
  });

  it('mergeHistory bumps trailRev only when it actually merges', () => {
    const s = new AircraftStore();
    s.setTrail('abc', [pt(100)]);
    expect(s.getTrailRev('abc')).toBe(1);
    // No-op merge: all history overlaps the existing oldest sample.
    s.mergeHistory('abc', [pt(100), pt(150)]);
    expect(s.getTrailRev('abc')).toBe(1);
    // Real merge: history points strictly older than existing oldest.
    s.mergeHistory('abc', [pt(10), pt(50)]);
    expect(s.getTrailRev('abc')).toBe(2);
  });

  it('drop on a feed sync clears trailRev', () => {
    const s = new AircraftStore();
    s.syncFromFeed([ac('abc')]);
    s.syncFromFeed([]);
    expect(s.getTrailRev('abc')).toBe(0);
  });
});
