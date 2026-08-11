// @vitest-environment jsdom
// feed/feeds.ts reads window.FEEDS_CONFIG / window.FEED_MODE_CONFIG /
// window.location / localStorage at *module load time*, so most of this
// suite has to reset the module registry and re-import after seeding
// those globals for each scenario.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeFeed, pickInitial, type Feed } from '../src/feed/feeds';

function baseRaw() {
  return {
    id: 'local',
    name: 'Local',
    liveUrl: '/data/aircraft.json',
    home: { lat: 45, lon: -90 },
  };
}

describe('normalizeFeed', () => {
  it('rejects when id is missing', () => {
    const r = baseRaw();
    delete (r as Partial<typeof r>).id;
    expect(normalizeFeed(r)).toBeNull();
  });

  it('rejects when name is missing', () => {
    const r = baseRaw();
    delete (r as Partial<typeof r>).name;
    expect(normalizeFeed(r)).toBeNull();
  });

  it('rejects when liveUrl is missing', () => {
    const r = baseRaw();
    delete (r as Partial<typeof r>).liveUrl;
    expect(normalizeFeed(r)).toBeNull();
  });

  it('rejects when home is missing', () => {
    const r = baseRaw();
    delete (r as Partial<typeof r>).home;
    expect(normalizeFeed(r)).toBeNull();
  });

  it('rejects non-numeric home.lat', () => {
    const r = baseRaw();
    (r.home as { lat: unknown }).lat = 'nope';
    expect(normalizeFeed(r)).toBeNull();
  });

  it('applies defaults: apiBase, color, altFt, acars path', () => {
    const f = normalizeFeed(baseRaw())!;
    expect(f.apiBase).toBe('/api');
    expect(f.color).toBe('#4a9eff');
    expect(f.home.altFt).toBe(0);
    expect(f.acarsApiBase).toBeNull();
  });

  it('enables acars with default apiBase when enabled:true and no path given', () => {
    const f = normalizeFeed({ ...baseRaw(), acars: { enabled: true } })!;
    expect(f.acarsApiBase).toBe('/acars-api');
  });

  it('honors an explicit acars apiBase', () => {
    const f = normalizeFeed({ ...baseRaw(), acars: { enabled: true, apiBase: '/custom-acars' } })!;
    expect(f.acarsApiBase).toBe('/custom-acars');
  });

  it("local feed id gets unlimited trailMaxPoints and the 4h backfill window", () => {
    const f = normalizeFeed({ ...baseRaw(), id: 'local' })!;
    expect(f.trailMaxPoints).toBe(Number.POSITIVE_INFINITY);
    expect(f.backfillWindowMs).toBe(4 * 60 * 60 * 1000);
  });

  it('non-local feed id gets trailMaxPoints 600 and the 30 min floor backfill window', () => {
    const f = normalizeFeed({ ...baseRaw(), id: 'remote-1' })!;
    expect(f.trailMaxPoints).toBe(600);
    expect(f.backfillWindowMs).toBe(30 * 60 * 1000);
  });
});

describe('pickInitial', () => {
  const feeds: Feed[] = [
    normalizeFeed({ id: 'a', name: 'A', liveUrl: '/a.json', home: { lat: 1, lon: 2 } })!,
    normalizeFeed({ id: 'b', name: 'B', liveUrl: '/b.json', home: { lat: 1, lon: 2 } })!,
  ];

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', 'http://localhost:3000/');
  });

  it('URL param wins and persists to localStorage', () => {
    window.history.replaceState(null, '', 'http://localhost:3000/?feed=b');
    const picked = pickInitial(feeds);
    expect(picked.id).toBe('b');
    expect(window.localStorage.getItem('adsb3d_selected_feed')).toBe('b');
  });

  it('uses the stored id when no URL param', () => {
    window.localStorage.setItem('adsb3d_selected_feed', 'b');
    const picked = pickInitial(feeds);
    expect(picked.id).toBe('b');
  });

  it('cleans up a stale stored id and falls back to the first feed', () => {
    window.localStorage.setItem('adsb3d_selected_feed', 'ghost');
    const picked = pickInitial(feeds);
    expect(picked.id).toBe('a');
    expect(window.localStorage.getItem('adsb3d_selected_feed')).toBeNull();
  });

  it('falls back to the first feed with nothing set', () => {
    const picked = pickInitial(feeds);
    expect(picked.id).toBe('a');
  });
});

describe('boot pipeline (module re-import)', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    window.history.replaceState(null, '', 'http://localhost:3000/');
    delete (window as { FEEDS_CONFIG?: unknown }).FEEDS_CONFIG;
    delete (window as { FEED_MODE_CONFIG?: unknown }).FEED_MODE_CONFIG;
    delete (window as { ENV_CONFIG?: unknown }).ENV_CONFIG;
  });

  it('filters invalid entries out of FEEDS_CONFIG', async () => {
    window.FEEDS_CONFIG = [
      { id: 'good', name: 'Good', liveUrl: '/g.json', home: { lat: 1, lon: 2 } },
      { id: 'bad', name: 'Bad' }, // missing liveUrl/home
    ];
    const mod = await import('../src/feed/feeds');
    const feeds = mod.getFeeds();
    expect(feeds).toHaveLength(1);
    expect(feeds[0]!.id).toBe('good');
  });

  it('synthesizes a fallback feed from ENV_CONFIG when FEEDS_CONFIG is absent', async () => {
    window.ENV_CONFIG = { homeLocation: { lat: 12, lon: 34, alt: 500 }, locationName: 'Test Site' };
    const mod = await import('../src/feed/feeds');
    const feeds = mod.getFeeds();
    expect(feeds).toHaveLength(1);
    expect(feeds[0]!.id).toBe('local');
    expect(feeds[0]!.home.lat).toBe(12);
    expect(feeds[0]!.home.name).toBe('Test Site');
  });
});
