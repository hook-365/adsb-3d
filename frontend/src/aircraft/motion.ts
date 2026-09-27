import type { Aircraft } from '../core/types';
import type { AircraftStore } from './store';

// Smooth-motion sampler: delayed interpolation between the last two real
// fixes. The tracker watches the store for position changes and keeps a
// short per-aircraft fix history; the reconciler calls `sample()` once per
// visible aircraft per frame and drives the scene with the result. Nothing
// here writes to the store — trails and records stay real data only.
//
// Displayed positions run ~one update-interval in the past (per-aircraft
// adaptive). Late data freezes the aircraft at its newest fix — we never
// extrapolate into guessed space — and a bracket gap far beyond the
// aircraft's usual cadence snaps instead of slow-gliding across it.
// See docs/superpowers/specs/2026-07-02-smooth-motion-design.md.

export interface Fix {
  lat: number;
  lon: number;
  altFt: number;
  trackDeg: number | null;
  /** Feed emission time (Aircraft.lastUpdateMs) — same clock the trail uses. */
  ms: number;
}

/** A displayed position. `ms` is the display time for interpolated results,
 * or the fix's own time when holding/snapping. */
export type SampledFix = Fix;

export const DELAY_FACTOR = 1.2;
export const MIN_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 12_000;
export const SNAP_GAP_FACTOR = 3;
export const MIN_SNAP_GAP_MS = 10_000;
/** Cap on the gap-EMA seed. A first-observed gap can be a coverage hole
 * rather than the feed cadence; no real feeder updates slower than this,
 * so seeding above it would legitimize gliding across an outage. */
export const MAX_SEED_CADENCE_MS = 15_000;
/** Last N fixes kept per aircraft. Two suffice to interpolate; the extra
 * depth tolerates a delay estimate that momentarily spans two brackets. */
const RING_SIZE = 4;
/** Consecutive rejected gaps after which the cadence is taken to have
 *  really changed (a fringe target thinning out) rather than being a
 *  one-off coverage hole: the EMA is reseeded from the latest gap. */
export const CADENCE_RESEED_RUN = 3;
const GAP_EMA_ALPHA = 0.3;
const OFFSET_EMA_ALPHA = 0.2;

/** Shortest-arc angular difference b−a in (−180, 180]. */
function arcDelta(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

function lerpTrack(a: number | null, b: number | null, t: number): number | null {
  if (a === null) return b;
  if (b === null) return a;
  const r = a + arcDelta(a, b) * t;
  return ((r % 360) + 360) % 360;
}

function lerpLon(a: number, b: number, t: number): number {
  const r = a + arcDelta(a, b) * t;
  return ((r + 540) % 360) - 180;
}

function copyFix(src: Fix, out: SampledFix): SampledFix {
  out.lat = src.lat;
  out.lon = src.lon;
  out.altFt = src.altFt;
  out.trackDeg = src.trackDeg;
  out.ms = src.ms;
  return out;
}

/**
 * Pure sampler over a time-ordered fix ring. Writes the position to
 * display at `displayMs` into `out` and returns it, or returns null when
 * there isn't enough data to say anything smarter than the raw record
 * (fewer than two fixes). `out` defaults to a fresh object; the tracker
 * passes a reused one so the per-frame hot path allocates nothing.
 */
export function sampleRing(
  ring: readonly Fix[],
  snapGapMs: number,
  displayMs: number,
  out: SampledFix = { lat: 0, lon: 0, altFt: 0, trackDeg: null, ms: 0 },
): SampledFix | null {
  if (ring.length < 2) return null;
  const newest = ring[ring.length - 1]!;
  // Display time has caught up to (or passed) the newest real fix: hold
  // there. Freezing is the designed gap behavior — the staleness fade
  // communicates the rest.
  if (displayMs >= newest.ms) return copyFix(newest, out);
  for (let i = ring.length - 1; i >= 1; i--) {
    const b = ring[i]!;
    const a = ring[i - 1]!;
    if (displayMs < a.ms) continue;
    const gap = b.ms - a.ms;
    // Coverage gap far beyond this aircraft's usual cadence: snap to the
    // newer side rather than glide across miles of unobserved sky.
    if (gap > snapGapMs) return copyFix(b, out);
    const t = (displayMs - a.ms) / gap;
    out.lat = a.lat + (b.lat - a.lat) * t;
    out.lon = lerpLon(a.lon, b.lon, t);
    out.altFt = a.altFt + (b.altFt - a.altFt) * t;
    out.trackDeg = lerpTrack(a.trackDeg, b.trackDeg, t);
    out.ms = displayMs;
    return out;
  }
  // Older than everything we kept (delay estimate just grew): hold at the
  // oldest fix; display time catches up within a frame or two.
  return copyFix(ring[0]!, out);
}

export interface MotionTrackerOptions {
  nowFn?: () => number;
  /** Time mode probe — smoothing is live-only; historical playback drives
   * the store with synthetic cursor-time records that must not be tracked. */
  modeFn?: () => 'live' | 'historical';
}

export class MotionTracker {
  private readonly rings = new Map<string, Fix[]>();
  private readonly gapEmaMs = new Map<string, number>();
  // Consecutive rejected (coverage-gap-sized) gaps per aircraft.
  private readonly outlierRun = new Map<string, number>();
  // sample() result, reused across calls: valid until the next sample().
  private readonly scratch: SampledFix = { lat: 0, lon: 0, altFt: 0, trackDeg: null, ms: 0 };
  // Wall-clock minus fix-clock, EMA across all pushes. Absorbs feed clock
  // skew and typical delivery lag so `sample()` can subtract a stable
  // offset instead of trusting the two clocks to agree.
  private offsetEmaMs: number | null = null;
  private readonly nowFn: () => number;
  private readonly modeFn: () => 'live' | 'historical';

  constructor(store: AircraftStore, opts: MotionTrackerOptions = {}) {
    this.nowFn = opts.nowFn ?? Date.now;
    this.modeFn = opts.modeFn ?? (() => 'live');
    // Page-lifetime singleton alongside the reconciler — the unsubscribe
    // handle is intentionally discarded, matching the reconciler's own
    // settings subscription.
    store.subscribe((snapshot) => this.onSnapshot(snapshot));
  }

  private onSnapshot(snapshot: ReadonlyMap<string, Aircraft>): void {
    if (this.modeFn() !== 'live') {
      if (this.rings.size > 0) {
        this.rings.clear();
        this.gapEmaMs.clear();
        this.outlierRun.clear();
      }
      return;
    }
    for (const hex of this.rings.keys()) {
      if (!snapshot.has(hex)) {
        this.rings.delete(hex);
        this.gapEmaMs.delete(hex);
        this.outlierRun.delete(hex);
      }
    }
    // Newest fix timestamp pushed during this notify. All records in one
    // feed tick share a lastUpdateMs, so the offset EMA below must update
    // once per tick — per-fix updates would apply the blend N times and
    // wholesale-replace the average with this tick's instantaneous
    // delivery latency, re-importing exactly the jitter it exists to damp.
    let tickMs = 0;
    for (const a of snapshot.values()) {
      if (!Number.isFinite(a.lastUpdateMs) || a.lastUpdateMs <= 0) continue;
      let ring = this.rings.get(a.hex);
      const newest = ring && ring.length > 0 ? ring[ring.length - 1]! : undefined;
      if (newest) {
        // Only a real position change is a fix. Records churn for other
        // reasons (callsign, squawk) and parked aircraft re-emit the same
        // spot every tick; pushing those would fabricate zero-length or
        // stretched-out glides.
        if (a.lastUpdateMs <= newest.ms) continue;
        if (a.lat === newest.lat && a.lon === newest.lon && a.altFt === newest.altFt) continue;
        const gap = a.lastUpdateMs - newest.ms;
        const prevEma = this.gapEmaMs.get(a.hex);
        if (prevEma === undefined) {
          this.gapEmaMs.set(a.hex, Math.min(gap, MAX_SEED_CADENCE_MS));
        } else if (gap <= Math.max(SNAP_GAP_FACTOR * prevEma, MIN_SNAP_GAP_MS)) {
          this.gapEmaMs.set(a.hex, prevEma + GAP_EMA_ALPHA * (gap - prevEma));
          this.outlierRun.delete(a.hex);
        } else {
          // A coverage gap, not cadence information. Folding it into the
          // EMA would raise the snap threshold to ~21x cadence (the gap
          // inflates the very EMA the snap test divides by) and balloon
          // the display delay — the aircraft would glide across unobserved
          // sky. But a RUN of them means the cadence itself changed (a
          // fringe target thinning out): without a reseed the stale fast
          // EMA would snap every fix forever.
          const run = (this.outlierRun.get(a.hex) ?? 0) + 1;
          if (run >= CADENCE_RESEED_RUN) {
            this.gapEmaMs.set(a.hex, Math.min(gap, MAX_SEED_CADENCE_MS));
            this.outlierRun.delete(a.hex);
          } else {
            this.outlierRun.set(a.hex, run);
          }
        }
      }
      if (!ring) {
        ring = [];
        this.rings.set(a.hex, ring);
      }
      ring.push({
        lat: a.lat,
        lon: a.lon,
        altFt: a.altFt,
        trackDeg: a.trackDeg,
        ms: a.lastUpdateMs,
      });
      if (ring.length > RING_SIZE) ring.shift();
      if (a.lastUpdateMs > tickMs) tickMs = a.lastUpdateMs;
    }
    if (tickMs > 0) {
      const offset = this.nowFn() - tickMs;
      this.offsetEmaMs =
        this.offsetEmaMs === null
          ? offset
          : this.offsetEmaMs + OFFSET_EMA_ALPHA * (offset - this.offsetEmaMs);
    }
  }

  /**
   * Displayed position for `hex` at wall-clock `nowMs`, or null when the
   * aircraft has no interpolation history yet (caller falls back to the
   * raw record — today's snap behavior). The returned object is reused:
   * consume it before the next call.
   */
  sample(hex: string, nowMs: number): SampledFix | null {
    const ring = this.rings.get(hex);
    if (!ring || ring.length < 2) return null;
    const ema = this.gapEmaMs.get(hex);
    if (ema === undefined || ema <= 0) return null;
    const delay = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, DELAY_FACTOR * ema));
    const displayMs = nowMs - (this.offsetEmaMs ?? 0) - delay;
    const snapGap = Math.max(SNAP_GAP_FACTOR * ema, MIN_SNAP_GAP_MS);
    return sampleRing(ring, snapGap, displayMs, this.scratch);
  }
}
