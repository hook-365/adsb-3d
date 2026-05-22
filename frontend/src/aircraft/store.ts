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

export const MAX_TRAIL_POINTS = 600; // ~10 min @ 1 Hz
const MIN_MOVE_DEG = 0.0001; // ~11 m at the equator; suppresses jitter
const MIN_TRAIL_DT_MS = 500;

export class AircraftStore {
  private readonly records = new Map<string, Aircraft>();
  private readonly trailMap = new Map<string, TrailPoint[]>();
  private readonly listeners = new Set<StoreListener>();

  get snapshot(): ReadonlyMap<string, Aircraft> {
    return this.records;
  }

  trails(hex: string): readonly TrailPoint[] | undefined {
    return this.trailMap.get(hex);
  }

  subscribe(fn: StoreListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Drop all aircraft + trail history. Used when switching feeds in place. */
  clear(): void {
    this.records.clear();
    this.trailMap.clear();
    this.notify();
  }

  /** Replace state with the latest feed snapshot. Aircraft missing from `next` are dropped. */
  syncFromFeed(next: Aircraft[]): void {
    const keep = new Set<string>();
    for (const a of next) {
      keep.add(a.hex);
      this.records.set(a.hex, a);
      this.appendTrail(a);
    }
    for (const hex of this.records.keys()) {
      if (!keep.has(hex)) {
        this.records.delete(hex);
        this.trailMap.delete(hex);
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
      this.trailMap.delete(hex);
      return;
    }
    // Cap at MAX_TRAIL_POINTS — the reconciler's pre-allocated
    // BufferAttribute can't hold more without overflow.
    const trimmed = points.length > MAX_TRAIL_POINTS
      ? points.slice(points.length - MAX_TRAIL_POINTS)
      : points;
    // Copy so callers can mutate their source without aliasing.
    this.trailMap.set(hex, [...trimmed]);
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
    if (merged.length > MAX_TRAIL_POINTS) merged.splice(0, merged.length - MAX_TRAIL_POINTS);
    this.trailMap.set(hex, merged);
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
      const movedEnough =
        Math.abs(a.lat - last.lat) > MIN_MOVE_DEG || Math.abs(a.lon - last.lon) > MIN_MOVE_DEG;
      if (dt < MIN_TRAIL_DT_MS && !movedEnough) return;
    }
    trail.push({ lat: a.lat, lon: a.lon, altFt: a.altFt, ms: a.lastUpdateMs });
    if (trail.length > MAX_TRAIL_POINTS) trail.splice(0, trail.length - MAX_TRAIL_POINTS);
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.records);
  }
}

export const TRAIL_CAPACITY = MAX_TRAIL_POINTS;
