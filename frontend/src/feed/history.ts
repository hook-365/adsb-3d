import type { Aircraft } from '../core/types';
import type { AircraftStore, TrailPoint } from '../aircraft/store';

// Historical trail backfill from the track-service.
//
// We batch hexes that need backfill and fire one `/tracks/bulk/timelapse`
// request every BATCH_DEBOUNCE_MS, scoped to the visible set via the
// `hexes=` parameter. That collapses what used to be N parallel
// per-aircraft fetches into one round trip. Per-aircraft `/tracks/{hex}`
// is still used by `refresh()` for explicit user-triggered re-fetches.

interface RawTrackPoint {
  time?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string | null;
  alt_geom?: number | null;
}

interface RawAircraftTrack {
  icao?: string;
  positions?: RawTrackPoint[];
}

interface RawBulkResponse {
  tracks?: RawAircraftTrack[];
}

interface RawSingleResponse {
  positions?: RawTrackPoint[];
}

const BACKFILL_WINDOW_MS = 30 * 60 * 1000;
// Short enough that the cold-load wave doesn't sit idle, long enough that
// rapidly-arriving aircraft from a single feed snapshot batch into one call.
const BATCH_DEBOUNCE_MS = 50;
const BATCH_MAX_HEXES = 200;
// Empty-result backoff: collector may not have caught up yet for newly
// observed aircraft. Start short so a transient gap clears quickly; back
// off to 5min for hexes that are persistently empty.
const RETRY_INITIAL_MS = 30 * 1000;
const RETRY_MAX_MS = 5 * 60 * 1000;

function parsePoint(p: RawTrackPoint): TrailPoint | null {
  if (typeof p.lat !== 'number' || typeof p.lon !== 'number' || !p.time) return null;
  const ms = Date.parse(p.time);
  if (Number.isNaN(ms)) return null;
  let altFt = 0;
  if (typeof p.alt_baro === 'number') altFt = p.alt_baro;
  else if (typeof p.alt_geom === 'number') altFt = p.alt_geom;
  // alt_baro may be the string "ground" — leave altFt at 0 in that case.
  return { ms, lat: p.lat, lon: p.lon, altFt };
}

function parsePoints(raw: RawTrackPoint[] | undefined): TrailPoint[] {
  const out: TrailPoint[] = [];
  for (const p of raw ?? []) {
    const tp = parsePoint(p);
    if (tp) out.push(tp);
  }
  out.sort((a, b) => a.ms - b.ms);
  return out;
}

/** Fetch a single aircraft's history. Used by `HistoryBackfill.refresh()`. */
export async function fetchHistory(
  apiBase: string,
  hex: string,
  sinceMs: number,
): Promise<TrailPoint[]> {
  const start = new Date(sinceMs).toISOString();
  const end = new Date().toISOString();
  const url = `${apiBase}/tracks/${encodeURIComponent(hex)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&resolution=full`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as RawSingleResponse;
    return parsePoints(body.positions);
  } catch {
    return [];
  }
}

async function fetchBulkHistory(
  apiBase: string,
  hexes: readonly string[],
  sinceMs: number,
): Promise<Map<string, TrailPoint[]>> {
  const start = new Date(sinceMs).toISOString();
  const end = new Date().toISOString();
  // 15s buckets: trail cap is 600 points and we keep ~30 min, so anything
  // finer than this is wasted bytes (the live feed appends from now on).
  const params = new URLSearchParams({
    start,
    end,
    resolution: '15s',
    hexes: hexes.join(','),
  });
  const url = `${apiBase}/tracks/bulk/timelapse?${params.toString()}`;
  const result = new Map<string, TrailPoint[]>();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return result;
    const body = (await res.json()) as RawBulkResponse;
    for (const t of body.tracks ?? []) {
      if (!t.icao) continue;
      result.set(t.icao.toLowerCase(), parsePoints(t.positions));
    }
  } catch {
    // result stays empty; caller treats missing hexes as "no data, retry later"
  }
  return result;
}

type Status = 'queued' | 'inflight' | 'done' | { retryAt: number };

function nextRetryDelay(attempts: number): number {
  // attempt 1 → 30s, 2 → 60s, 3 → 120s, 4 → 240s, 5+ → 300s (cap)
  const base = RETRY_INITIAL_MS * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(base, RETRY_MAX_MS);
}

export interface HistoryBackfillConfig {
  apiBase: string;
  /**
   * When false, the instance subscribes to nothing and never fetches —
   * used for feeds whose track-service still runs the legacy code without
   * the new `/tracks?resolution=Ns` + `hexes=` shapes. Trails populate
   * from live data going forward instead of being backfilled.
   */
  enabled: boolean;
}

export class HistoryBackfill {
  private readonly status = new Map<string, Status>();
  // Attempt counter survives across status transitions (queued → inflight →
  // {retryAt} → queued ...) so the backoff actually grows on persistent
  // empty results rather than resetting every cycle.
  private readonly attempts = new Map<string, number>();
  private readonly queue = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private readonly apiBase: string;
  private readonly enabled: boolean;

  private storeUnsub: (() => void) | null = null;
  private stopped = false;

  constructor(private readonly store: AircraftStore, config: HistoryBackfillConfig) {
    this.apiBase = config.apiBase;
    this.enabled = config.enabled;
    if (this.enabled) {
      this.storeUnsub = store.subscribe((snapshot) => this.scan(snapshot));
    }
  }

  /** Detach from the store and prevent any further fetches. Used on feed switch. */
  stop(): void {
    this.stopped = true;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.storeUnsub) {
      this.storeUnsub();
      this.storeUnsub = null;
    }
    this.queue.clear();
  }

  /** Force a refresh for one aircraft (e.g. on user selection). */
  refresh(hex: string): void {
    if (!this.enabled) return;
    this.status.delete(hex);
    this.attempts.delete(hex);
    void this.refreshOne(hex);
  }

  private scan(snapshot: ReadonlyMap<string, Aircraft>): void {
    if (this.stopped) return;
    const now = Date.now();
    let added = false;
    for (const hex of snapshot.keys()) {
      const s = this.status.get(hex);
      if (s === 'queued' || s === 'inflight' || s === 'done') continue;
      if (s && typeof s === 'object' && s.retryAt > now) continue;
      this.queue.add(hex);
      this.status.set(hex, 'queued');
      added = true;
    }
    if (added) this.scheduleFlush();
    // Prune tracking state for aircraft that are no longer in the snapshot
    // so the maps don't grow unboundedly as aircraft cycle in and out.
    for (const hex of this.status.keys()) {
      if (!snapshot.has(hex)) {
        this.status.delete(hex);
        this.attempts.delete(hex);
      }
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null || this.flushing) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, BATCH_DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    if (this.stopped || this.flushing || this.queue.size === 0) return;
    this.flushing = true;
    try {
      const batch = Array.from(this.queue).slice(0, BATCH_MAX_HEXES);
      for (const hex of batch) {
        this.queue.delete(hex);
        this.status.set(hex, 'inflight');
      }

      const sinceMs = Date.now() - BACKFILL_WINDOW_MS;
      const tracks = await fetchBulkHistory(this.apiBase, batch, sinceMs);
      // The instance may have been torn down while we were awaiting the
      // network round trip — drop the result rather than mutating a store
      // that's about to be repopulated by a different feed.
      if (this.stopped) return;

      for (const hex of batch) {
        const points = tracks.get(hex) ?? [];
        if (points.length === 0) {
          const attempts = (this.attempts.get(hex) ?? 0) + 1;
          this.attempts.set(hex, attempts);
          this.status.set(hex, { retryAt: Date.now() + nextRetryDelay(attempts) });
          continue;
        }
        this.attempts.delete(hex);
        this.store.mergeHistory(hex, points);
        this.status.set(hex, 'done');
      }
    } finally {
      this.flushing = false;
      if (!this.stopped && this.queue.size > 0) this.scheduleFlush();
    }
  }

  private async refreshOne(hex: string): Promise<void> {
    this.status.set(hex, 'inflight');
    const points = await fetchHistory(this.apiBase, hex, Date.now() - BACKFILL_WINDOW_MS);
    if (points.length === 0) {
      const attempts = (this.attempts.get(hex) ?? 0) + 1;
      this.attempts.set(hex, attempts);
      this.status.set(hex, { retryAt: Date.now() + nextRetryDelay(attempts) });
      return;
    }
    this.attempts.delete(hex);
    this.store.mergeHistory(hex, points);
    this.status.set(hex, 'done');
  }
}
