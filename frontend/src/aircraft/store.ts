import type { Aircraft } from '../core/types';

// Source of truth for live aircraft state plus their accrued position
// histories ("trails"). Feeds write here; the reconciler reads here.
// Nothing else mutates aircraft data.

export interface TrailPoint {
  lat: number;
  lon: number;
  altFt: number;
  ms: number;
}

export type StoreListener = (snapshot: ReadonlyMap<string, Aircraft>) => void;

// Module-level default trail cap. Feeds with high-density traffic (e.g.
// Europe) keep the conservative 600 (~10 min @ 1Hz). The local feed can
// flip this to Number.POSITIVE_INFINITY so survey aircraft, slow patterns
// and orbital traffic keep their full in-scope history. Per-hex overrides
// (see `setTrailCap`) take precedence — used by the "extend on selection"
// path to let one aircraft on a busy feed grow past the global cap.
export const MAX_TRAIL_POINTS = 600;
let defaultTrailCap: number = MAX_TRAIL_POINTS;

/** Set the per-feed default trail cap. Number.POSITIVE_INFINITY = unlimited. */
export function setDefaultTrailCap(cap: number): void {
  defaultTrailCap = cap;
}

/** Currently-active default trail cap (per-feed). */
export function getDefaultTrailCap(): number {
  return defaultTrailCap;
}

const MIN_MOVE_DEG = 0.0001; // ~11 m at the equator; suppresses jitter
const MIN_TRAIL_DT_MS = 500;
// When an aircraft hasn't moved enough to clear MIN_MOVE_DEG, fall back to
// a sparse sample every STATIONARY_RESAMPLE_MS so a 12-hour parked plane
// doesn't accumulate one point per second (~43k points). Still gives one
// point per minute as a "still here" marker, so the trail reflects that
// the aircraft was present without ballooning memory.
const STATIONARY_RESAMPLE_MS = 60_000;

function trimToCap(points: TrailPoint[], cap: number): TrailPoint[] {
  if (!Number.isFinite(cap) || points.length <= cap) return points;
  points.splice(0, points.length - cap);
  return points;
}

// True when any field the reconciler / aircraft-list panel actually reads
// has changed between two records. Fields the detail panel reads (operator,
// squawk, AP nav, etc.) are intentionally excluded — the detail panel is a
// one-aircraft-at-a-time view that re-renders on every snapshot tick and
// does not gate on rev. `lastSeenMs` / `lastUpdateMs` are also excluded
// because they advance every feed tick even when nothing about the
// aircraft has changed visually; the staleness fade reads `lastSeenMs`
// directly each frame via wall-clock math.
function renderFieldsChanged(prev: Aircraft, next: Aircraft): boolean {
  return (
    prev.lat !== next.lat ||
    prev.lon !== next.lon ||
    prev.altFt !== next.altFt ||
    prev.trackDeg !== next.trackDeg ||
    prev.onGround !== next.onGround ||
    prev.callsign !== next.callsign ||
    prev.registration !== next.registration ||
    prev.typeCode !== next.typeCode ||
    prev.military !== next.military ||
    prev.emergency !== next.emergency ||
    prev.specialInterest !== next.specialInterest ||
    prev.privacyIcao !== next.privacyIcao ||
    prev.ladd !== next.ladd ||
    prev.groundSpeedKt !== next.groundSpeedKt ||
    prev.verticalRateFpm !== next.verticalRateFpm
  );
}

export class AircraftStore {
  private readonly records = new Map<string, Aircraft>();
  private readonly trailMap = new Map<string, TrailPoint[]>();
  private readonly listeners = new Set<StoreListener>();
  // Per-hex monotonic counters. `recordRev` bumps when any render-relevant
  // field in the Aircraft changes; `trailRev` bumps when the trail array
  // is mutated (appended, replaced, or merged). Consumers compare against
  // a cached "last seen" rev to skip redundant work each frame. New
  // aircraft start at rev 1 on first sight so a brand-new entry compared
  // against an entry's default lastRev=0 reads as "dirty" automatically.
  private readonly recordRev = new Map<string, number>();
  private readonly trailRev = new Map<string, number>();
  // Per-hex cap override. When absent, getTrailCap falls back to the
  // module-level defaultTrailCap (which the active feed configures at
  // boot). Used by setSelected → "extend this one aircraft" so a Europe
  // user can investigate a single survey orbiting an airfield without
  // ballooning memory for the other ~1500 contacts.
  private readonly trailCaps = new Map<string, number>();
  // Per-hex last-known altitude. Used to patch frames that arrive with no
  // alt_baro / alt_geom (readsb publishes those occasionally and the
  // normalizer flags them via altFtKnown=false). Without this, a single
  // missing-altitude frame would teleport the cone to the ground and
  // dip the trail with it. First-ever sighting of an aircraft with no
  // altitude data still passes through at altFt=0 so the dot appears at
  // all; the cache fills in once a real altitude arrives.
  private readonly lastKnownAlt = new Map<string, number>();

  get snapshot(): ReadonlyMap<string, Aircraft> {
    return this.records;
  }

  trails(hex: string): readonly TrailPoint[] | undefined {
    return this.trailMap.get(hex);
  }

  /** Monotonic counter that advances when any render-relevant Aircraft field changes. 0 for unknown hexes. */
  getRev(hex: string): number {
    return this.recordRev.get(hex) ?? 0;
  }

  /** Monotonic counter that advances when the trail for this hex grows or is replaced. 0 for unknown hexes. */
  getTrailRev(hex: string): number {
    return this.trailRev.get(hex) ?? 0;
  }

  /** Effective trail cap for this hex: per-hex override if set, else the feed default. */
  getTrailCap(hex: string): number {
    return this.trailCaps.get(hex) ?? defaultTrailCap;
  }

  /** Per-hex cap override. Pass `Number.POSITIVE_INFINITY` to lift the cap entirely. */
  setTrailCap(hex: string, cap: number): void {
    this.trailCaps.set(hex, cap);
    // Re-trim immediately if the new cap is lower than the existing trail
    // length; raising the cap is a no-op until new points arrive.
    const trail = this.trailMap.get(hex);
    if (trail && Number.isFinite(cap) && trail.length > cap) {
      trimToCap(trail, cap);
      this.trailRev.set(hex, (this.trailRev.get(hex) ?? 0) + 1);
    }
  }

  subscribe(fn: StoreListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Drop all aircraft + trail history. Used when switching feeds in place. */
  clear(): void {
    this.records.clear();
    this.trailMap.clear();
    this.recordRev.clear();
    this.trailRev.clear();
    this.trailCaps.clear();
    this.lastKnownAlt.clear();
    this.notify();
  }

  /** Replace state with the latest feed snapshot. Aircraft missing from `next` are dropped. */
  syncFromFeed(next: Aircraft[]): void {
    const keep = new Set<string>();
    for (let a of next) {
      keep.add(a.hex);
      // Altitude inheritance: if the incoming frame didn't carry altitude,
      // substitute the last known value rather than treat it as ground.
      // Frames with altFtKnown=true refresh the cache so subsequent gaps
      // pick the most recent good altitude.
      if (a.altFtKnown) {
        this.lastKnownAlt.set(a.hex, a.altFt);
      } else {
        const cached = this.lastKnownAlt.get(a.hex);
        if (cached !== undefined) {
          a = { ...a, altFt: cached, altFtKnown: true };
        }
        // else: brand-new aircraft we've never seen with altitude. Pass
        // it through at altFt=0 so it still appears; the next frame with
        // real altitude will both fill the cache and bump the rev so the
        // cone snaps to the correct altitude.
      }
      const prev = this.records.get(a.hex);
      if (!prev || renderFieldsChanged(prev, a)) {
        this.recordRev.set(a.hex, (this.recordRev.get(a.hex) ?? 0) + 1);
      }
      this.records.set(a.hex, a);
      this.appendTrail(a);
    }
    for (const hex of this.records.keys()) {
      if (!keep.has(hex)) {
        this.records.delete(hex);
        this.trailMap.delete(hex);
        this.recordRev.delete(hex);
        this.trailRev.delete(hex);
        this.lastKnownAlt.delete(hex);
        // Per-hex cap overrides intentionally survive drop-and-reappear
        // within the same session: a survey aircraft you selected to
        // extend should stay extended if it pops back into coverage.
      }
    }
    this.notify();
  }

  /**
   * Wholesale-replace the trail for a single hex. Used by the
   * historical playback feed: the canonical trail at cursor time is
   * "every real ADS-B sample with ms <= cursor", not the appendTrail
   * stream of synthetic interpolated emissions. Live mode never calls
   * this — appendTrail in syncFromFeed remains the live source.
   */
  setTrail(hex: string, points: readonly TrailPoint[]): void {
    if (points.length === 0) {
      if (this.trailMap.delete(hex)) {
        this.trailRev.set(hex, (this.trailRev.get(hex) ?? 0) + 1);
      }
      return;
    }
    // Cap per-hex (feed default unless overridden). Unlimited skips the
    // slice entirely; the reconciler's growable buffer absorbs whatever
    // length we hand it.
    const cap = this.getTrailCap(hex);
    const trimmed = Number.isFinite(cap) && points.length > cap
      ? points.slice(points.length - cap)
      : points;
    // Copy so callers can mutate their source without aliasing.
    this.trailMap.set(hex, [...trimmed]);
    this.trailRev.set(hex, (this.trailRev.get(hex) ?? 0) + 1);
  }

  /**
   * Merge backfilled history into the trail map. Historical points
   * older than the trail's existing oldest sample are prepended; points
   * that overlap or post-date the live tail are dropped (the live feed
   * is the canonical source for "now").
   */
  mergeHistory(hex: string, history: readonly TrailPoint[]): void {
    if (history.length === 0) return;
    const existing = this.trailMap.get(hex) ?? [];
    const oldestLive = existing.length > 0 ? existing[0]!.ms : Number.POSITIVE_INFINITY;
    const filtered: TrailPoint[] = [];
    for (const p of history) {
      if (p.ms >= oldestLive) break; // history is sorted ascending; rest will all overlap
      filtered.push(p);
    }
    if (filtered.length === 0) return;
    const merged = filtered.concat(existing);
    trimToCap(merged, this.getTrailCap(hex));
    this.trailMap.set(hex, merged);
    this.trailRev.set(hex, (this.trailRev.get(hex) ?? 0) + 1);
    this.notify();
  }

  private appendTrail(a: Aircraft): void {
    let trail = this.trailMap.get(a.hex);
    if (!trail) {
      trail = [];
      this.trailMap.set(a.hex, trail);
    }
    const last = trail.length > 0 ? trail[trail.length - 1] : undefined;
    if (last) {
      const dt = a.lastUpdateMs - last.ms;
      // Always suppress sub-MIN_TRAIL_DT_MS resamples: the feed sometimes
      // re-emits the same position within a few hundred ms and we'd just
      // double-stamp.
      if (dt < MIN_TRAIL_DT_MS) return;
      const movedEnough =
        Math.abs(a.lat - last.lat) > MIN_MOVE_DEG || Math.abs(a.lon - last.lon) > MIN_MOVE_DEG;
      // Stationary path: aircraft hasn't moved meaningfully since the last
      // trail point. Defer the append until STATIONARY_RESAMPLE_MS so the
      // trail isn't choked by parked aircraft or a hover with sub-meter
      // GPS jitter. The first post-stationary motion is still captured
      // immediately because as soon as it moves, movedEnough flips true.
      if (!movedEnough && dt < STATIONARY_RESAMPLE_MS) return;
    }
    trail.push({ lat: a.lat, lon: a.lon, altFt: a.altFt, ms: a.lastUpdateMs });
    trimToCap(trail, this.getTrailCap(a.hex));
    this.trailRev.set(a.hex, (this.trailRev.get(a.hex) ?? 0) + 1);
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.records);
  }
}

export const TRAIL_CAPACITY = MAX_TRAIL_POINTS;
