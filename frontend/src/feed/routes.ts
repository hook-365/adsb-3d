import type { Aircraft } from '../core/types';
import type { AircraftStore } from '../aircraft/store';

// Route cache + batched prefetcher.
//
// On first paint (and whenever new callsigns appear in the feed), debounce
// briefly then POST /api/route/batch with the unseen callsign set in one
// shot. Subsequent per-callsign reads from `getRoute()` hit the cache.
//
// Both successful resolutions and "no route known" are cached so we don't
// re-ask. The browser HTTP cache (Cache-Control on /route/{callsign}) is
// the second line of defense across reloads.

export interface RouteInfo {
  origin: string;
  destination: string;
  origin_name?: string;
  destination_name?: string;
}

const cache = new Map<string, RouteInfo | null>();
const inflight = new Map<string, Promise<RouteInfo | null>>();
let apiBase = '/api';

/**
 * Set the per-feed API base used by `getRoute` / `ensureRoute` /
 * `attachRouteBatchPrefetcher`. Called at boot and again on Phase 2b
 * feed switching, paired with `clearRouteCache()` so cross-feed callsign
 * resolutions don't bleed.
 */
export function configureRoutesApi(base: string): void {
  apiBase = base;
}

/** Drop all cached and in-flight route lookups. Used on feed switch. */
export function clearRouteCache(): void {
  cache.clear();
  inflight.clear();
}

const BATCH_DEBOUNCE_MS = 300;
const BATCH_MAX_CALLSIGNS = 100; // server caps at 100 anyway

interface RawRouteEntry {
  origin?: string | null;
  destination?: string | null;
  origin_name?: string | null;
  destination_name?: string | null;
}

interface BatchResponse {
  results?: Record<string, RawRouteEntry>;
}

function normalize(entry: RawRouteEntry | undefined): RouteInfo | null {
  if (!entry || !entry.origin || !entry.destination) return null;
  const out: RouteInfo = { origin: entry.origin, destination: entry.destination };
  if (entry.origin_name) out.origin_name = entry.origin_name;
  if (entry.destination_name) out.destination_name = entry.destination_name;
  return out;
}

async function fetchOne(callsign: string): Promise<RouteInfo | null> {
  try {
    const res = await fetch(`${apiBase}/route/${encodeURIComponent(callsign)}`);
    if (!res.ok) {
      cache.set(callsign, null);
      return null;
    }
    const body = (await res.json()) as {
      origin?: string | null;
      destination?: string | null;
      origin_name?: string | null;
      destination_name?: string | null;
    };
    const route = normalize(body);
    cache.set(callsign, route);
    return route;
  } catch {
    cache.set(callsign, null);
    return null;
  }
}

async function fetchBatch(callsigns: string[]): Promise<void> {
  if (callsigns.length === 0) return;
  try {
    const res = await fetch(`${apiBase}/route/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callsigns }),
    });
    if (!res.ok) {
      // On failure, mark each as null so we don't spam retries; the
      // selection-time fetchOne() can still fill in if the user clicks.
      for (const cs of callsigns) {
        if (!cache.has(cs)) cache.set(cs, null);
      }
      return;
    }
    const body = (await res.json()) as BatchResponse;
    const results = body.results ?? {};
    for (const cs of callsigns) {
      const route = normalize(results[cs]);
      cache.set(cs, route);
    }
  } catch {
    for (const cs of callsigns) {
      if (!cache.has(cs)) cache.set(cs, null);
    }
  }
}

/** Returns cached entry, or `undefined` if the callsign hasn't been resolved yet. */
export function getRoute(callsign: string): RouteInfo | null | undefined {
  return cache.get(callsign);
}

/**
 * Per-callsign fetch (for the click-to-select path that wants an answer
 * fast, not whenever the next batch happens to fire). Coalesces against
 * any in-flight request for the same callsign.
 */
export function ensureRoute(callsign: string): Promise<RouteInfo | null> {
  const cached = cache.get(callsign);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = inflight.get(callsign);
  if (existing) return existing;
  const p = fetchOne(callsign).finally(() => inflight.delete(callsign));
  inflight.set(callsign, p);
  return p;
}

/**
 * Watch the store and warm the cache for callsigns we haven't seen yet,
 * batching them into a single /api/route/batch POST after a short debounce.
 *
 * Returns an `unsubscribe` function so feed-switch teardown can stop the
 * prefetcher from emitting requests against the old apiBase after switch.
 */
export function attachRouteBatchPrefetcher(store: AircraftStore): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let detached = false;
  const queued = new Set<string>();

  const flush = (): void => {
    timer = null;
    if (detached || queued.size === 0) return;
    const batch = Array.from(queued).slice(0, BATCH_MAX_CALLSIGNS);
    for (const cs of batch) queued.delete(cs);
    void fetchBatch(batch).then(() => {
      // If more arrived during the request, schedule another flush.
      if (!detached && queued.size > 0 && timer === null) {
        timer = setTimeout(flush, BATCH_DEBOUNCE_MS);
      }
    });
  };

  const unsubscribe = store.subscribe((snapshot: ReadonlyMap<string, Aircraft>) => {
    if (detached) return;
    let added = false;
    for (const a of snapshot.values()) {
      if (!a.callsign) continue;
      if (cache.has(a.callsign)) continue;
      if (queued.has(a.callsign)) continue;
      if (inflight.has(a.callsign)) continue;
      queued.add(a.callsign);
      added = true;
    }
    if (added && timer === null) {
      timer = setTimeout(flush, BATCH_DEBOUNCE_MS);
    }
  });

  return () => {
    detached = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    queued.clear();
    unsubscribe();
  };
}
