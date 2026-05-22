import type { HomeLocation } from './types';
import { getActiveFeed } from '../feed/feeds';

// HOME is the active feed's location, picked at boot by feed/feeds.ts.
// Phase 2b makes it mutable: switching feeds calls setHome() which mutates
// HOME's fields *in place* (same object reference) so consumers that
// `import { HOME }` and read `HOME.lat` keep seeing the current value
// without re-importing or re-binding. Modules that derive cached scalars
// from HOME (e.g. coords.ts caches cos(HOME.lat)) should subscribe via
// subscribeHome() and recompute on the callback.

const initialHome: HomeLocation = getActiveFeed().home;

export const HOME: HomeLocation = {
  lat: initialHome.lat,
  lon: initialHome.lon,
  altFt: initialHome.altFt,
  name: initialHome.name,
};

const homeListeners = new Set<(h: HomeLocation) => void>();

export function setHome(next: HomeLocation): void {
  HOME.lat = next.lat;
  HOME.lon = next.lon;
  HOME.altFt = next.altFt;
  HOME.name = next.name;
  for (const fn of homeListeners) fn(HOME);
}

export function subscribeHome(fn: (h: HomeLocation) => void): () => void {
  homeListeners.add(fn);
  return () => {
    homeListeners.delete(fn);
  };
}

// Visible range from home. Aircraft outside this radius are dropped.
export const RANGE_NM = 250;

// Scene scale: 1 unit = 1 nautical mile horizontally, exaggerated vertically
// so altitude reads at a glance (real altitudes are tiny next to range).
export const ALT_EXAGGERATION = 12;

// Polling cadence (ms). readsb publishes ~1 Hz.
export const POLL_INTERVAL_MS = 1000;
