import type { Aircraft } from '../core/types';
import type { AircraftStore } from '../aircraft/store';

// Route cache + batched prefetcher, backed by adsb.im's routeset API.
//
// Requests go through the nginx `/routeset` proxy (no track-service
// needed, so live-only installs get routes too). Each lookup carries the
// aircraft's current position: adsb.im checks the route against it and
// returns a `plausible` flag, which we keep so the UI can mark stale or
// wrong routes instead of stating them as fact.
//
// On first paint (and whenever new callsigns appear in the feed), debounce
// briefly then POST the unseen set in one shot. Subsequent per-callsign
// reads from `getRoute()` hit the cache. Both resolutions and "no route
// known" are cached so we don't re-ask.

export interface RouteInfo {
  /** Endpoints of the leg the aircraft is currently flying. */
  origin: string;
  destination: string;
  origin_name?: string;
  destination_name?: string;
  /** adsb.im's check of the route against the aircraft's position. */
  plausible: boolean;
  /** Every stop, in order, when the flight number covers more than one leg. */
  stops?: string[];
}

export interface RouteQuery {
  callsign: string;
  lat: number;
  lon: number;
}

const ROUTESET_URL = '/routeset';

const cache = new Map<string, RouteInfo | null>();
const inflight = new Map<string, Promise<RouteInfo | null>>();

/** Drop all cached and in-flight route lookups. Used on feed switch. */
export function clearRouteCache(): void {
  cache.clear();
  inflight.clear();
}

const BATCH_DEBOUNCE_MS = 300;
const BATCH_MAX_CALLSIGNS = 100;

interface RawAirport {
  iata?: string | null;
  icao?: string | null;
  name?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface RawRouteEntry {
  callsign?: string | null;
  _airports?: RawAirport[] | null;
  plausible?: boolean | number | null;
}

function airportCode(a: RawAirport): string {
  return a.iata || a.icao || '?';
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle angular distance in radians. */
function arc(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Index of the leg the position most likely sits on: the one whose detour
 * (origin → position → destination, minus the direct leg) is smallest.
 * Legs with airports lacking coordinates are skipped; falls back to 0.
 */
export function currentLegIndex(airports: RawAirport[], lat: number, lon: number): number {
  let best = 0;
  let bestDetour = Infinity;
  for (let i = 0; i + 1 < airports.length; i++) {
    const a = airports[i]!;
    const b = airports[i + 1]!;
    if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) continue;
    const detour = arc(a.lat, a.lon, lat, lon) + arc(lat, lon, b.lat, b.lon) - arc(a.lat, a.lon, b.lat, b.lon);
    if (detour < bestDetour) {
      bestDetour = detour;
      best = i;
    }
  }
  return best;
}

export function normalizeRoute(entry: RawRouteEntry | undefined, lat: number, lon: number): RouteInfo | null {
  const airports = entry?._airports ?? [];
  if (airports.length < 2) return null;
  const leg = currentLegIndex(airports, lat, lon);
  const from = airports[leg]!;
  const to = airports[leg + 1]!;
  const out: RouteInfo = {
    origin: airportCode(from),
    destination: airportCode(to),
    plausible: !!entry?.plausible,
  };
  if (from.name) out.origin_name = from.name;
  if (to.name) out.destination_name = to.name;
  if (airports.length > 2) out.stops = airports.map(airportCode);
  return out;
}

async function fetchRoutes(queries: RouteQuery[]): Promise<void> {
  if (queries.length === 0) return;
  try {
    const res = await fetch(ROUTESET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planes: queries.map((q) => ({ callsign: q.callsign, lat: q.lat, lng: q.lon })),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    const byCallsign = new Map<string, RawRouteEntry>();
    if (Array.isArray(body)) {
      for (const item of body as RawRouteEntry[]) {
        const cs = item?.callsign?.trim().toUpperCase();
        if (cs) byCallsign.set(cs, item);
      }
    }
    for (const q of queries) {
      cache.set(q.callsign, normalizeRoute(byCallsign.get(q.callsign.toUpperCase()), q.lat, q.lon));
    }
  } catch {
    // Mark each as null so we don't spam retries (rate limit, upstream
    // down). The click-to-select path won't retry either; a feed switch
    // or reload clears the cache.
    for (const q of queries) {
      if (!cache.has(q.callsign)) cache.set(q.callsign, null);
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
export function ensureRoute(query: RouteQuery): Promise<RouteInfo | null> {
  const cached = cache.get(query.callsign);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = inflight.get(query.callsign);
  if (existing) return existing;
  const p = fetchRoutes([query])
    .then(() => cache.get(query.callsign) ?? null)
    .finally(() => inflight.delete(query.callsign));
  inflight.set(query.callsign, p);
  return p;
}

/**
 * Watch the store and warm the cache for callsigns we haven't seen yet,
 * batching them into a single routeset POST after a short debounce.
 *
 * Returns an `unsubscribe` function so feed-switch teardown can stop the
 * prefetcher from emitting requests after switch.
 */
export function attachRouteBatchPrefetcher(store: AircraftStore): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let detached = false;
  // Latest position per queued callsign, so the lookup is checked
  // against where the aircraft is when the batch fires.
  const queued = new Map<string, RouteQuery>();

  const flush = (): void => {
    timer = null;
    if (detached || queued.size === 0) return;
    const batch = Array.from(queued.values()).slice(0, BATCH_MAX_CALLSIGNS);
    for (const q of batch) queued.delete(q.callsign);
    void fetchRoutes(batch).then(() => {
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
      if (inflight.has(a.callsign)) continue;
      if (!queued.has(a.callsign)) added = true;
      queued.set(a.callsign, { callsign: a.callsign, lat: a.lat, lon: a.lon });
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
