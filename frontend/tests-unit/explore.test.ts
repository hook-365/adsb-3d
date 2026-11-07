// @vitest-environment jsdom
// Explore feed (feed/explore.ts): preset-place feed construction, URL and
// storage memory, and the feeds.ts integration (slot appended when the
// deploy has a key, place pick = feed switch).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildExploreFeed,
  exploreFeedId,
  exploreLiveUrl,
  explorePollMs,
  initialPlace,
  isExploreFeedId,
  placeIdFromFeedId,
  writePlaceParam,
} from '../src/feed/explore';
import { DEFAULT_PLACE_ID, EXPLORE_PLACES, EXPLORE_REGIONS, findPlace } from '../src/feed/explore-places';

describe('explore-places catalog', () => {
  it('has unique ids, sane coordinates and a known region', () => {
    const ids = new Set<string>();
    for (const p of EXPLORE_PLACES) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.lat).toBeGreaterThan(-90);
      expect(p.lat).toBeLessThan(90);
      expect(p.lon).toBeGreaterThanOrEqual(-180);
      expect(p.lon).toBeLessThanOrEqual(180);
      expect(EXPLORE_REGIONS).toContain(p.region);
      expect(p.altFt).toBeGreaterThanOrEqual(0);
    }
    expect(findPlace(DEFAULT_PLACE_ID)).not.toBeNull();
  });

  it('findPlace tolerates null and unknown ids', () => {
    expect(findPlace(null)).toBeNull();
    expect(findPlace('atlantis')).toBeNull();
  });
});

describe('explore feed shape', () => {
  it('rounds poll coordinates to two decimals so viewers share a cache key', () => {
    expect(exploreLiveUrl(41.9028, 12.4964)).toBe('/data/explore/aircraft.json?lat=41.90&lon=12.50');
    expect(exploreLiveUrl(-33.8688, 151.2093)).toBe('/data/explore/aircraft.json?lat=-33.87&lon=151.21');
  });

  it('builds a live-only feed whose id carries the place', () => {
    const f = buildExploreFeed(findPlace('tokyo')!);
    expect(f.id).toBe('explore:tokyo');
    expect(isExploreFeedId(f.id)).toBe(true);
    expect(placeIdFromFeedId(f.id)).toBe('tokyo');
    expect(placeIdFromFeedId('local')).toBeNull();
    expect(f.supportsWs).toBe(false);
    expect(f.supportsHistory).toBe(false);
    expect(f.acarsApiBase).toBeNull();
    expect(f.prefetchRoutes).toBe(false);
    expect(f.home.name).toBe('Tokyo');
    expect(f.liveUrl).toMatch(/^\/data\/explore\/aircraft\.json\?lat=/);
  });

  it('credits the configured provider, with the licence only where one applies', async () => {
    const { exploreAttribution } = await import('../src/feed/explore');
    window.EXPLORE_CONFIG = { enabled: true, provider: 'flyitalyadsb' };
    expect(exploreAttribution()).toContain('flyitalyadsb.com');
    expect(exploreAttribution()).toContain('CC BY-SA 4.0');
    window.EXPLORE_CONFIG = { enabled: true, provider: 'adsb.lol' };
    expect(exploreAttribution()).toContain('ODbL 1.0');
    window.EXPLORE_CONFIG = { enabled: true, provider: 'adsb.fi' };
    expect(exploreAttribution()).toContain('href="https://adsb.fi"');
    expect(exploreAttribution()).not.toContain('CC BY-SA');
    window.EXPLORE_CONFIG = { enabled: true, provider: 'something-else' };
    expect(exploreAttribution()).toBe('data something-else');
    delete window.EXPLORE_CONFIG;
  });

  it('takes the poll cadence from EXPLORE_CONFIG with a 10 s default', () => {
    window.EXPLORE_CONFIG = { enabled: true, pollS: 2.5 };
    expect(explorePollMs()).toBe(2500);
    window.EXPLORE_CONFIG = { enabled: true, pollS: -1 };
    expect(explorePollMs()).toBe(10_000);
    delete window.EXPLORE_CONFIG;
    expect(explorePollMs()).toBe(10_000);
  });
});

describe('place memory', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('prefers ?place= over storage and falls back to the default', () => {
    expect(initialPlace().id).toBe(DEFAULT_PLACE_ID);
    window.localStorage.setItem('adsb3d_explore_place', 'sydney');
    expect(initialPlace().id).toBe('sydney');
    window.sessionStorage.setItem('adsb3d_explore_place', 'denver');
    expect(initialPlace().id).toBe('denver');
    window.history.replaceState(null, '', '/?place=london');
    expect(initialPlace().id).toBe('london');
  });

  it('reads the place out of a ?feed=explore:<place> link too', () => {
    window.history.replaceState(null, '', '/?feed=explore:dubai');
    expect(initialPlace().id).toBe('dubai');
  });

  it('writePlaceParam sets the param for explore ids and clears it otherwise', () => {
    const url = new URL('https://x.test/?place=rome');
    writePlaceParam(url, 'local');
    expect(url.searchParams.has('place')).toBe(false);
    writePlaceParam(url, exploreFeedId('milan'));
    expect(url.searchParams.get('place')).toBe('milan');
  });
});

describe('feeds.ts integration', () => {
  beforeEach(() => {
    vi.resetModules();
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    window.FEEDS_CONFIG = null;
    window.FEED_MODE_CONFIG = { mode: 'single' };
  });

  it('adds no slot and stays single without a key', async () => {
    delete window.EXPLORE_CONFIG;
    const feeds = await import('../src/feed/feeds');
    expect(feeds.getExploreFeed()).toBeNull();
    expect(feeds.getFeedMode()).toBe('single');
  });

  it('appends the explore slot and flips to multi when enabled', async () => {
    window.EXPLORE_CONFIG = { enabled: true, pollS: 1 };
    const feeds = await import('../src/feed/feeds');
    const slot = feeds.getExploreFeed();
    expect(slot?.id).toBe(`explore:${DEFAULT_PLACE_ID}`);
    expect(feeds.getFeeds()).toHaveLength(2);
    expect(feeds.getFeedMode()).toBe('multi');
    expect(feeds.getActiveFeed().id).toBe('local');
  });

  it('picking a place switches feeds in place and remembers it', async () => {
    window.EXPLORE_CONFIG = { enabled: true, pollS: 1 };
    const feeds = await import('../src/feed/feeds');
    const seen: string[] = [];
    feeds.onFeedSwitch((next) => seen.push(next.id));
    feeds.selectExplorePlace('milan');
    expect(seen).toEqual(['explore:milan']);
    expect(feeds.getActiveFeed().id).toBe('explore:milan');
    expect(feeds.getExploreFeed()?.home.name).toBe('Milan');
    expect(feeds.getFeeds()).toHaveLength(2);
    expect(new URL(window.location.href).searchParams.get('place')).toBe('milan');
    expect(new URL(window.location.href).searchParams.get('feed')).toBe('explore:milan');
    expect(window.localStorage.getItem('adsb3d_explore_place')).toBe('milan');
    // Unknown place: no-op.
    feeds.selectExplorePlace('atlantis');
    expect(seen).toHaveLength(1);
    // Back to local clears the place param.
    feeds.selectFeed('local');
    expect(new URL(window.location.href).searchParams.has('place')).toBe(false);
  });

  it('switching between two cities while on explore is a real feed switch', async () => {
    window.EXPLORE_CONFIG = { enabled: true, pollS: 1 };
    window.history.replaceState(null, '', '/?feed=explore:rome');
    const feeds = await import('../src/feed/feeds');
    expect(feeds.getActiveFeed().id).toBe('explore:rome');
    const seen: string[] = [];
    feeds.onFeedSwitch((next) => seen.push(next.id));
    feeds.selectExplorePlace('tokyo');
    expect(seen).toEqual(['explore:tokyo']);
    expect(feeds.getActiveFeed().id).toBe('explore:tokyo');
    expect(feeds.getActiveFeed().home.name).toBe('Tokyo');
    expect(feeds.getExploreFeed()?.id).toBe('explore:tokyo');
    expect(feeds.getFeeds().filter((f) => f.id.startsWith('explore:'))).toHaveLength(1);
    expect(new URL(window.location.href).searchParams.get('place')).toBe('tokyo');
  });

  it('boots on the explore slot from a shared link', async () => {
    window.EXPLORE_CONFIG = { enabled: true, pollS: 1 };
    window.history.replaceState(null, '', '/?feed=explore:tokyo');
    const feeds = await import('../src/feed/feeds');
    expect(feeds.getActiveFeed().id).toBe('explore:tokyo');
    expect(feeds.getActiveFeed().home.name).toBe('Tokyo');
  });
});
