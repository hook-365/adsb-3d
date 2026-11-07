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
  type ExplorePlace,
} from './explore-places';
import type { Feed } from './feeds';

export const EXPLORE_FEED_PREFIX = 'explore:';
export const EXPLORE_LIVE_PATH = '/data/explore/aircraft.json';

const PLACE_STORAGE_KEY = 'adsb3d_explore_place';
const PLACE_URL_PARAM = 'place';
const DEFAULT_POLL_MS = 10_000;

interface ExploreConfigShape {
  enabled?: boolean;
  /** Seconds between polls; the deploy tunes this to its API plan. */
  pollS?: number;
  /** EXPLORE_PROVIDER id; picks the attribution line. */
  provider?: string;
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
  return Math.round(s * 1000);
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

/** Credit the active provider asks for (a licence condition for some), shown while the feed is active. */
export function exploreAttribution(): string {
  const id = config().provider ?? '';
  const p = EXPLORE_PROVIDERS[id] ?? { name: id || 'aggregator', url: '' };
  const name = p.url
    ? `<a href="${p.url}" target="_blank" rel="noopener">${p.name}</a>`
    : p.name;
  const LICENCE_URLS: Record<string, string> = {
    'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
    'ODbL 1.0': 'https://opendatacommons.org/licenses/odbl/1-0/',
  };
  const licenceUrl = p.licence ? LICENCE_URLS[p.licence] : undefined;
  const licence = p.licence && licenceUrl
    ? ` (<a href="${licenceUrl}" target="_blank" rel="noopener">${p.licence}</a>)`
    : '';
  return `data ${name}${licence}`;
}

export function buildExploreFeed(place: ExplorePlace): Feed {
  return {
    id: exploreFeedId(place.id),
    name: place.name,
    color: '#9b7bff',
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
