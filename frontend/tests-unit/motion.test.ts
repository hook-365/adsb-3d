import { describe, expect, it } from 'vitest';
import {
  MotionTracker,
  sampleRing,
  DELAY_FACTOR,
  CADENCE_RESEED_RUN,
  MIN_SNAP_GAP_MS,
  type Fix,
} from '../src/aircraft/motion';
import { AircraftStore } from '../src/aircraft/store';
import type { Aircraft } from '../src/core/types';

const fix = (ms: number, over: Partial<Fix> = {}): Fix => ({
  lat: 0,
  lon: 0,
  altFt: 10000,
  trackDeg: null,
  ms,
  ...over,
});

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

// A snap gap large enough that no test bracket triggers it unless intended.
const NO_SNAP = 1_000_000;

describe('sampleRing', () => {
  it('returns null with fewer than two fixes', () => {
    expect(sampleRing([], NO_SNAP, 500)).toBeNull();
    expect(sampleRing([fix(1000)], NO_SNAP, 500)).toBeNull();
  });

  it('lerps lat/lon/alt midway between two bracketing fixes', () => {
    const ring = [
      fix(1000, { lat: 39, lon: -84, altFt: 10000 }),
      fix(6000, { lat: 40, lon: -83, altFt: 12000 }),
    ];
    const s = sampleRing(ring, NO_SNAP, 3500);
    expect(s).not.toBeNull();
    expect(s!.lat).toBeCloseTo(39.5, 10);
    expect(s!.lon).toBeCloseTo(-83.5, 10);
    expect(s!.altFt).toBeCloseTo(11000, 8);
    expect(s!.ms).toBe(3500);
  });

  it('picks the correct bracket in a longer ring', () => {
    const ring = [
      fix(1000, { lat: 0 }),
      fix(2000, { lat: 1 }),
      fix(3000, { lat: 2 }),
      fix(4000, { lat: 3 }),
    ];
    const s = sampleRing(ring, NO_SNAP, 2500);
    expect(s!.lat).toBeCloseTo(1.5, 10);
  });

  it('interpolates heading across the 0-degree wrap by the shortest arc', () => {
    const ring = [
      fix(1000, { trackDeg: 350 }),
      fix(2000, { trackDeg: 10 }),
    ];
    const s = sampleRing(ring, NO_SNAP, 1500);
    expect(s!.trackDeg).toBeCloseTo(0, 8);
    const back = sampleRing(
      [fix(1000, { trackDeg: 10 }), fix(2000, { trackDeg: 350 })],
      NO_SNAP,
      1500,
    );
    expect(back!.trackDeg).toBeCloseTo(0, 8);
  });

  it('falls back to the non-null heading when one side is missing', () => {
    const s = sampleRing(
      [fix(1000, { trackDeg: null }), fix(2000, { trackDeg: 90 })],
      NO_SNAP,
      1500,
    );
    expect(s!.trackDeg).toBe(90);
    const s2 = sampleRing(
      [fix(1000, { trackDeg: 45 }), fix(2000, { trackDeg: null })],
      NO_SNAP,
      1500,
    );
    expect(s2!.trackDeg).toBe(45);
    const s3 = sampleRing(
      [fix(1000, { trackDeg: null }), fix(2000, { trackDeg: null })],
      NO_SNAP,
      1500,
    );
    expect(s3!.trackDeg).toBeNull();
  });

  it('interpolates longitude across the antimeridian by the shortest arc', () => {
    const ring = [
      fix(1000, { lon: 179.5 }),
      fix(2000, { lon: -179.5 }),
    ];
    const s = sampleRing(ring, NO_SNAP, 1500);
    // Midpoint is ±180, never ~0.
    expect(Math.abs(Math.abs(s!.lon) - 180)).toBeLessThan(1e-8);
  });

  it('snaps to the newer fix when the bracket gap exceeds the snap threshold', () => {
    const ring = [
      fix(1000, { lat: 0 }),
      fix(1000 + MIN_SNAP_GAP_MS + 1, { lat: 5 }),
    ];
    const s = sampleRing(ring, MIN_SNAP_GAP_MS, 6000);
    expect(s!.lat).toBe(5);
    expect(s!.ms).toBe(1000 + MIN_SNAP_GAP_MS + 1);
  });

  it('holds at the newest fix when displayMs has passed it (feed gap: freeze, never extrapolate)', () => {
    const ring = [fix(1000, { lat: 0 }), fix(6000, { lat: 1 })];
    const s = sampleRing(ring, NO_SNAP, 99_000);
    expect(s!.lat).toBe(1);
    expect(s!.ms).toBe(6000);
  });

  it('holds at the oldest fix when displayMs precedes the ring', () => {
    const ring = [fix(5000, { lat: 2 }), fix(6000, { lat: 3 })];
    const s = sampleRing(ring, NO_SNAP, 1000);
    expect(s!.lat).toBe(2);
    expect(s!.ms).toBe(5000);
  });
});

describe('MotionTracker', () => {
  function tracker(nowRef: { now: number }, mode: { m: 'live' | 'historical' } = { m: 'live' }) {
    const store = new AircraftStore();
    const t = new MotionTracker(store, {
      nowFn: () => nowRef.now,
      modeFn: () => mode.m,
    });
    return { store, t };
  }

  it('needs two distinct-position fixes before sampling', () => {
    const nowRef = { now: 1000 };
    const { store, t } = tracker(nowRef);
    store.syncFromFeed([ac('a', { lat: 39, lastUpdateMs: 1000, lastSeenMs: 1000 })]);
    expect(t.sample('a', 2000)).toBeNull();
  });

  it('interpolates between two feed ticks with the adaptive delay', () => {
    const nowRef = { now: 1000 };
    const { store, t } = tracker(nowRef);
    store.syncFromFeed([ac('a', { lat: 39, lon: -84, lastUpdateMs: 1000, lastSeenMs: 1000 })]);
    nowRef.now = 6000;
    store.syncFromFeed([ac('a', { lat: 40, lon: -83, lastUpdateMs: 6000, lastSeenMs: 6000 })]);
    // gap EMA = 5000 → delay = 1.2 × 5000 = 6000, arrival offset EMA = 0.
    const delay = DELAY_FACTOR * 5000;
    const s = t.sample('a', 6000 + delay - 2500); // displayMs lands at 3500
    expect(s).not.toBeNull();
    expect(s!.lat).toBeCloseTo(39.5, 10);
  });

  it('ignores ticks where the position did not change (parked aircraft hold)', () => {
    const nowRef = { now: 1000 };
    const { store, t } = tracker(nowRef);
    store.syncFromFeed([ac('a', { lat: 39, lastUpdateMs: 1000 })]);
    nowRef.now = 6000;
    store.syncFromFeed([ac('a', { lat: 39, lastUpdateMs: 6000 })]);
    expect(t.sample('a', 10_000)).toBeNull(); // still only one distinct fix
  });

  it('drops non-monotonic timestamps', () => {
    const nowRef = { now: 6000 };
    const { store, t } = tracker(nowRef);
    store.syncFromFeed([ac('a', { lat: 39, lastUpdateMs: 6000, lastSeenMs: 6000 })]);
    store.syncFromFeed([ac('a', { lat: 40, lastUpdateMs: 5000, lastSeenMs: 5000 })]);
    expect(t.sample('a', 10_000)).toBeNull();
  });

  it('prunes aircraft that leave the feed', () => {
    const nowRef = { now: 1000 };
    const { store, t } = tracker(nowRef);
    store.syncFromFeed([ac('a', { lat: 39, lastUpdateMs: 1000 })]);
    nowRef.now = 2000;
    store.syncFromFeed([ac('a', { lat: 39.1, lastUpdateMs: 2000 })]);
    expect(t.sample('a', 5000)).not.toBeNull();
    store.syncFromFeed([]); // aircraft gone
    expect(t.sample('a', 5000)).toBeNull();
  });

  it('snaps across a coverage gap instead of gliding (gap must not pollute the EMA)', () => {
    // 5s cadence establishes the EMA, then an 18s outage. 18s > 3 x 5s, so
    // the spec says snap. The regression this guards: folding the 18s gap
    // into the EMA first raises the snap threshold above the gap itself,
    // and the aircraft glides across unobserved sky.
    const nowRef = { now: 1000 };
    const { store, t } = tracker(nowRef);
    const tick = (ms: number, lat: number) => {
      nowRef.now = ms;
      store.syncFromFeed([ac('a', { lat, lon: -84, lastUpdateMs: ms, lastSeenMs: ms })]);
    };
    tick(1000, 39.0);
    tick(6000, 39.1);
    tick(11000, 39.2);
    tick(29_000, 39.9); // 18s coverage gap
    // Display time lands inside the gap bracket: must be the newer fix
    // (snap), never an interpolated mid-gap position.
    const s = t.sample('a', 30_000);
    expect(s).not.toBeNull();
    expect(s!.lat).toBe(39.9);
  });

  it('snaps when the very first observed gap is a coverage hole (seed clamp)', () => {
    const nowRef = { now: 1000 };
    const { store, t } = tracker(nowRef);
    store.syncFromFeed([ac('a', { lat: 39.0, lastUpdateMs: 1000, lastSeenMs: 1000 })]);
    nowRef.now = 61_000;
    store.syncFromFeed([ac('a', { lat: 40.0, lastUpdateMs: 61_000, lastSeenMs: 61_000 })]);
    // 60s first gap: seed clamps to 15s, snap threshold 45s < 60s -> snap.
    const s = t.sample('a', 70_000);
    expect(s).not.toBeNull();
    expect(s!.lat).toBe(40.0);
  });

  it('ignores and clears state while in historical mode', () => {
    const nowRef = { now: 1000 };
    const mode = { m: 'live' as 'live' | 'historical' };
    const { store, t } = tracker(nowRef, mode);
    store.syncFromFeed([ac('a', { lat: 39, lastUpdateMs: 1000 })]);
    nowRef.now = 2000;
    store.syncFromFeed([ac('a', { lat: 39.1, lastUpdateMs: 2000 })]);
    expect(t.sample('a', 5000)).not.toBeNull();
    mode.m = 'historical';
    store.syncFromFeed([ac('a', { lat: 50, lastUpdateMs: 99_000 })]);
    expect(t.sample('a', 100_000)).toBeNull();
  });
});

describe('cadence change', () => {
  // A target whose cadence drops abruptly (fringe coverage thinning out)
  // must glide again once the slower cadence is sustained — a single long
  // gap is still a coverage hole, but a run of them is the new cadence.
  function trackerWithSlowdown(slowFixes: number) {
    let now = 0;
    const store = new AircraftStore();
    const tr = new MotionTracker(store, { nowFn: () => now });
    let lat = 40;
    const push = (ms: number) => {
      now = ms;
      lat += 0.01;
      store.syncFromFeed([ac('abc', { lat, lastSeenMs: ms, lastUpdateMs: ms })]);
    };
    for (let t = 0; t <= 8_000; t += 2_000) push(t); // 2 s cadence
    let t = 8_000;
    for (let k = 0; k < slowFixes; k++) push((t += 15_000)); // then 15 s
    return { tr, lastMs: t, lastLat: lat };
  }

  it('keeps treating fewer than a run of long gaps as coverage holes (snap)', () => {
    const { tr, lastMs, lastLat } = trackerWithSlowdown(CADENCE_RESEED_RUN - 1);
    // Display time falls inside the 15 s bracket, which exceeds the 2 s
    // cadence's snap threshold: the newer fix shows as-is.
    expect(tr.sample('abc', lastMs + 1_000)!.lat).toBeCloseTo(lastLat, 6);
  });

  it('reseeds after a sustained slowdown and glides across the slow bracket', () => {
    const { tr, lastMs, lastLat } = trackerWithSlowdown(CADENCE_RESEED_RUN + 1);
    const s = tr.sample('abc', lastMs);
    expect(s).not.toBeNull();
    // Between the previous fix and the newest: interpolated, not snapped.
    expect(s!.lat).toBeGreaterThan(lastLat - 0.01 + 1e-6);
    expect(s!.lat).toBeLessThan(lastLat - 1e-6);
  });
});
