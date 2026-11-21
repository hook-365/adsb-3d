// Explore feed: watch any city in the world through a global aggregator's
// radius API instead of a fixed receiver.
//
// entrypoint.sh renders window.EXPLORE_CONFIG from EXPLORE_API_KEY. When
// enabled, feeds.ts appends one extra feed whose home is a preset place
// (explore-places.ts). The browser never sees the key: it polls
// /data/explore/aircraft.json?lat=&lon= and nginx forwards that to the
// provider with the key and User-Agent attached, caching each location's
// response for the poll interval so N viewers on one city cost one
// upstream call per interval.
//
// The feed's id carries the place (`explore:rome`) so picking another
// city is an ordinary feed switch in app/session.ts: stores clear, HOME
// recenters, the camera resets. The place is remembered like the feed
// itself (URL ?place= > this tab > browser) so links and reloads land on
// the same city.

import {
  DEFAULT_PLACE_ID,
  findPlace,
  rememberPlaceRecord,
  type ExplorePlace,
} from './explore-places';
import type { Feed } from './feeds';

export const EXPLORE_FEED_PREFIX = 'explore:';
export const EXPLORE_LIVE_PATH = '/data/explore/aircraft.json';

const PLACE_STORAGE_KEY = 'adsb3d_explore_place';
const PLACE_URL_PARAM = 'place';
const DEFAULT_POLL_MS = 10_000;
/** Dot colour for every Explore city (receivers carry their own FEEDn_COLOR). */
export const EXPLORE_COLOR = '#9b7bff';

interface ExploreConfigShape {
  enabled?: boolean;
  /** Seconds between polls; the deploy tunes this to its API plan. */
  pollS?: number;
  /** EXPLORE_PROVIDER id; picks the attribution line. */
  provider?: string;
  /** EXPLORE_FALLBACK_PROVIDER id, or empty: nginx switches to it when the first fails. */
  fallbackProvider?: string;
}

/** Aggregators the entrypoint knows how to proxy, with the credit each asks for. */
export const EXPLORE_PROVIDERS: Readonly<Record<string, { name: string; url: string; licence?: string }>> = {
  flyitalyadsb: { name: 'flyitalyadsb.com', url: 'https://flyitalyadsb.com', licence: 'CC BY-SA 4.0' },
  'adsb.lol': { name: 'adsb.lol', url: 'https://adsb.lol', licence: 'ODbL 1.0' },
  'adsb.fi': { name: 'adsb.fi', url: 'https://adsb.fi' },
  'airplanes.live': { name: 'airplanes.live', url: 'https://airplanes.live' },
};

declare global {
  interface Window {
    EXPLORE_CONFIG?: ExploreConfigShape;
  }
}

function config(): ExploreConfigShape {
  return typeof window !== 'undefined' ? (window.EXPLORE_CONFIG ?? {}) : {};
}

export function exploreEnabled(): boolean {
  return config().enabled === true;
}

export function explorePollMs(): number {
  const s = config().pollS;
  if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) return DEFAULT_POLL_MS;
  // Never faster than the default: the aggregators are free community
  // services. The entrypoint enforces the same floor on the nginx cache.
  return Math.max(DEFAULT_POLL_MS, Math.round(s * 1000));
}

export function isExploreFeedId(id: string): boolean {
  return id.startsWith(EXPLORE_FEED_PREFIX);
}

export function exploreFeedId(placeId: string): string {
  return `${EXPLORE_FEED_PREFIX}${placeId}`;
}

export function placeIdFromFeedId(id: string): string | null {
  return isExploreFeedId(id) ? id.slice(EXPLORE_FEED_PREFIX.length) : null;
}

/**
 * Poll URL for a place. Coordinates are rounded to two decimals (~1 km)
 * so every viewer of the same preset hits the same nginx cache key.
 */
export function exploreLiveUrl(lat: number, lon: number): string {
  return `${EXPLORE_LIVE_PATH}?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`;
}

const LICENCE_URLS: Record<string, string> = {
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
  'ODbL 1.0': 'https://opendatacommons.org/licenses/odbl/1-0/',
};

function providerCredit(id: string): string {
  const p = EXPLORE_PROVIDERS[id] ?? { name: id || 'aggregator', url: '' };
  const name = p.url ? `<a href="${p.url}" target="_blank" rel="noopener">${p.name}</a>` : p.name;
  const licenceUrl = p.licence ? LICENCE_URLS[p.licence] : undefined;
  const licence =
    p.licence && licenceUrl ? ` (<a href="${licenceUrl}" target="_blank" rel="noopener">${p.licence}</a>)` : '';
  return `${name}${licence}`;
}

/**
 * Credit the providers ask for (a licence condition for some), shown while
 * the feed is active. With a fallback configured nginx may answer from
 * either one, request by request, so both are credited.
 */
export function exploreAttribution(): string {
  const primary = config().provider ?? '';
  const fallback = config().fallbackProvider ?? '';
  const credit = `data ${providerCredit(primary)}`;
  return fallback && fallback !== primary ? `${credit} / ${providerCredit(fallback)}` : credit;
}

export function buildExploreFeed(place: ExplorePlace): Feed {
  return {
    id: exploreFeedId(place.id),
    name: place.name,
    color: EXPLORE_COLOR,
    liveUrl: exploreLiveUrl(place.lat, place.lon),
    // No track-service behind this feed: live polling only. apiBase is a
    // dead path so nothing accidentally resolves to the local /api.
    apiBase: '/data/explore',
    home: { lat: place.lat, lon: place.lon, altFt: place.altFt, name: place.name },
    supportsWs: false,
    supportsHistory: false,
    acarsApiBase: null,
    trailMaxPoints: 600,
    backfillWindowMs: 0,
    pollMs: explorePollMs(),
    pollAfterResponse: true,
    prefetchRoutes: false,
  };
}

// Place memory mirrors feeds.ts's rememberFeed: per-tab first, browser-wide
// as the seed for new tabs. Storage may be unavailable (privacy mode).
export function rememberPlace(placeId: string): void {
  try {
    window.sessionStorage.setItem(PLACE_STORAGE_KEY, placeId);
    window.localStorage.setItem(PLACE_STORAGE_KEY, placeId);
  } catch {
    // ignore
  }
  rememberPlaceRecord(findPlace(placeId));
}

// The ?place= the page was opened with, read before feeds.ts rewrites the
// URL to the feed it could resolve. A link to an airport names a place
// that is unknown until the airport list has loaded; the feed selector
// uses this to finish the trip once it has.
const requestedPlace =
  typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get(PLACE_URL_PARAM) : null;

export function requestedPlaceId(): string | null {
  return requestedPlace;
}

function storedPlace(storage: Storage): ExplorePlace | null {
  try {
    return findPlace(storage.getItem(PLACE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Resolve the place for boot: URL ?place= > this tab > browser > default. */
export function initialPlace(): ExplorePlace {
  const url = new URL(window.location.href);
  return (
    findPlace(url.searchParams.get(PLACE_URL_PARAM)) ??
    findPlace(placeIdFromFeedId(url.searchParams.get('feed') ?? '')) ??
    storedPlace(window.sessionStorage) ??
    storedPlace(window.localStorage) ??
    findPlace(DEFAULT_PLACE_ID)!
  );
}

/** Keep ?place= in step with the active feed (set on explore, cleared otherwise). */
export function writePlaceParam(url: URL, feedId: string): void {
  const placeId = placeIdFromFeedId(feedId);
  if (placeId) url.searchParams.set(PLACE_URL_PARAM, placeId);
  else url.searchParams.delete(PLACE_URL_PARAM);
}
