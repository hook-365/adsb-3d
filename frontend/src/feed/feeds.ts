import type { HomeLocation } from '../core/types';

// Multi-feed bootstrap.
//
// entrypoint.sh injects two window globals:
//   window.FEED_MODE_CONFIG = { mode: 'single' | 'multi' }
//   window.FEEDS_CONFIG     = [ {id, name, liveUrl, apiBase, home, color, ...}, ... ]
//                           | null
//
// We read both at module load, build a normalized Feed[] list, pick the
// active feed (URL ?feed=ID > localStorage > first), and freeze that for
// the rest of the session. Switching is a hard reload (Phase 1) — write
// the new id and call location.reload(). Phase 2 will replace that with
// in-place re-init once HOME is mutable across the scene.
//
// supportsWs / supportsHistory are feature gates: today only the local
// track-service runs the redesigned image with /ws/live and the new
// /tracks?resolution=Ns + hexes= shapes. Remote feeds run the legacy
// track-service, so live works (HTTP poll on /data/feeds/N/aircraft.json)
// but WS and history backfill are skipped. Both flip true in Phase 2a
// once the backend rolls out.

export type FeedMode = 'single' | 'multi';

export interface Feed {
  id: string;
  name: string;
  color: string;
  liveUrl: string;
  apiBase: string;
  home: HomeLocation;
  /** Whether this feed's track-service speaks the new WS protocol. */
  supportsWs: boolean;
  /** Whether this feed's track-service supports the new history endpoints. */
  supportsHistory: boolean;
  /** ACARS API base (e.g. `/acars-api`) when this feed has ACARS enabled, else null. */
  acarsApiBase: string | null;
  /**
   * Trail cap in points (≈ seconds @ 1Hz). The local feed defaults to
   * `Number.POSITIVE_INFINITY` so survey aircraft and orbital patterns
   * keep their full in-scope history. High-density feeds (Europe) keep
   * the conservative 600 so per-aircraft GPU memory stays bounded.
   */
  trailMaxPoints: number;
  /**
   * How far back the history backfill asks the track-service for. Set
   * proportional to `trailMaxPoints` (with a 30 min floor for cold-load
   * goodness) so we never fetch data the trail would immediately trim.
   * Unlimited cap → 24h.
   */
  backfillWindowMs: number;
}

interface RawFeedConfig {
  id?: string;
  name?: string;
  liveUrl?: string;
  apiBase?: string;
  color?: string;
  home?: { lat?: number; lon?: number; alt?: number };
  acars?: { enabled?: boolean; apiBase?: string };
}

interface FeedModeConfig {
  mode?: FeedMode;
}

interface EnvConfigShape {
  homeLocation?: { lat?: number; lon?: number; alt?: number };
  locationName?: string;
}

declare global {
  interface Window {
    FEEDS_CONFIG?: RawFeedConfig[] | null;
    FEED_MODE_CONFIG?: FeedModeConfig;
    ENV_CONFIG?: EnvConfigShape;
  }
}

const STORAGE_KEY = 'adsb3d_selected_feed';
const URL_PARAM = 'feed';
const LOCAL_API_BASE = '/api';

// Default trail cap policy. The local feed is small enough to absorb
// unlimited per-aircraft trails (~50 contacts on a typical receiver);
// every other feed stays at the safe 600 because Europe-scale fleets
// would blow up GPU memory with multi-MB per-aircraft buffers.
const DEFAULT_BACKFILL_FLOOR_MS = 30 * 60 * 1000;
// 4 hours covers the longest realistic loiter on the local feed (tankers,
// survey patterns) without dragging in stale all-day history. At 15s
// resolution × ~50 aircraft, the bulk cold-load response is a few MB
// instead of the ~30 MB a 24h window would produce.
const UNLIMITED_BACKFILL_MS = 4 * 60 * 60 * 1000;

function defaultTrailMaxPoints(feedId: string): number {
  return feedId === 'local' ? Number.POSITIVE_INFINITY : 600;
}

function defaultBackfillWindowMs(trailMaxPoints: number): number {
  if (!Number.isFinite(trailMaxPoints)) return UNLIMITED_BACKFILL_MS;
  // Trail samples land at ~1 Hz, so points ≈ seconds. Floor at 30 min so
  // cold-load shows a comfortable trail even for very small caps.
  return Math.max(trailMaxPoints * 1000, DEFAULT_BACKFILL_FLOOR_MS);
}

function fallbackFeed(): Feed {
  // Single-feed fallback synthesized from window.ENV_CONFIG (the same
  // shape core/config.ts uses for HOME). Keeps the redesign functional
  // even when entrypoint.sh hasn't written FEEDS_CONFIG.
  const env = window.ENV_CONFIG ?? {};
  // ACARS_CONFIG is emitted by entrypoint.sh from ENABLE_ACARS — when on,
  // /acars-api is served by the same nginx and points at acars-service.
  const acarsEnabled = Boolean((window as { ACARS_CONFIG?: { enabled?: boolean } }).ACARS_CONFIG?.enabled);
  const trailMaxPoints = defaultTrailMaxPoints('local');
  return {
    id: 'local',
    name: env.locationName ?? 'Local',
    color: '#4a9eff',
    liveUrl: '/data/aircraft.json',
    apiBase: LOCAL_API_BASE,
    home: {
      lat: env.homeLocation?.lat ?? 45.0000,
      lon: env.homeLocation?.lon ?? -90.0000,
      altFt: env.homeLocation?.alt ?? 1270,
      name: env.locationName ?? 'Home',
    },
    supportsWs: true,
    supportsHistory: true,
    acarsApiBase: acarsEnabled ? '/acars-api' : null,
    trailMaxPoints,
    backfillWindowMs: defaultBackfillWindowMs(trailMaxPoints),
  };
}

function normalizeFeed(raw: RawFeedConfig): Feed | null {
  if (!raw.id || !raw.name || !raw.liveUrl || !raw.home) return null;
  if (typeof raw.home.lat !== 'number' || typeof raw.home.lon !== 'number') return null;
  const apiBase = raw.apiBase ?? LOCAL_API_BASE;
  // Phase 2a rolled the redesigned track-service to every remote feed in
  // FEEDS_CONFIG, so all feeds now speak the new WS protocol and the new
  // /tracks?resolution=Ns + hexes= shapes. Both flags stay true; the
  // gating plumbing remains in case a future feed lags behind.
  // Per-feed ACARS opt-in. FEEDS_CONFIG entries can carry
  // `acars: { enabled: true, apiBase: '/acars-api' }` to enable the
  // ACARS panel for that feed. apiBase defaults to '/acars-api' when
  // enabled is true and no path is given.
  let acarsApiBase: string | null = null;
  if (raw.acars?.enabled) {
    acarsApiBase = raw.acars.apiBase || '/acars-api';
  }
  const trailMaxPoints = defaultTrailMaxPoints(raw.id);
  return {
    id: raw.id,
    name: raw.name,
    color: raw.color ?? '#4a9eff',
    liveUrl: raw.liveUrl,
    apiBase,
    home: {
      lat: raw.home.lat,
      lon: raw.home.lon,
      altFt: raw.home.alt ?? 0,
      name: raw.name,
    },
    supportsWs: true,
    supportsHistory: true,
    acarsApiBase,
    trailMaxPoints,
    backfillWindowMs: defaultBackfillWindowMs(trailMaxPoints),
  };
}

function loadAllFeeds(): Feed[] {
  const raw = window.FEEDS_CONFIG;
  if (!Array.isArray(raw) || raw.length === 0) return [fallbackFeed()];
  const out: Feed[] = [];
  for (const r of raw) {
    const f = normalizeFeed(r);
    if (f) out.push(f);
  }
  return out.length > 0 ? out : [fallbackFeed()];
}

function pickInitial(feeds: Feed[]): Feed {
  // URL takes precedence so a shared link lands on the right feed even if
  // the user's localStorage points elsewhere.
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get(URL_PARAM);
  if (fromUrl) {
    const hit = feeds.find((f) => f.id === fromUrl);
    if (hit) {
      window.localStorage.setItem(STORAGE_KEY, hit.id);
      return hit;
    }
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const hit = feeds.find((f) => f.id === stored);
    if (hit) return hit;
    // Stored id no longer matches any configured feed — clear it.
    window.localStorage.removeItem(STORAGE_KEY);
  }
  return feeds[0]!;
}

const allFeeds: Feed[] = loadAllFeeds();
let activeFeed: Feed = pickInitial(allFeeds);
const mode: FeedMode = window.FEED_MODE_CONFIG?.mode === 'multi' ? 'multi' : 'single';

// Phase 2b: main.ts registers an in-place switch handler here. selectFeed
// invokes it instead of reloading the page when present, so cone meshes,
// labels, controls, etc. stay alive across feeds. Without a handler we
// fall back to the Phase 1 hard reload so the module is self-contained.
type SwitchHandler = (next: Feed) => void;
let switchHandler: SwitchHandler | null = null;

export function onFeedSwitch(handler: SwitchHandler): void {
  switchHandler = handler;
}

// Make sure the URL reflects the active feed in multi-mode so copy-paste
// links carry the selection. Use replaceState — no history entry.
if (mode === 'multi') {
  const url = new URL(window.location.href);
  if (url.searchParams.get(URL_PARAM) !== activeFeed.id) {
    url.searchParams.set(URL_PARAM, activeFeed.id);
    window.history.replaceState(null, '', url.toString());
  }
}

export function getFeeds(): readonly Feed[] {
  return allFeeds;
}

export function getActiveFeed(): Feed {
  return activeFeed;
}

export function getFeedMode(): FeedMode {
  return mode;
}

/**
 * Switch to a different feed. Writes URL + localStorage so a copied link
 * lands on the new feed, then either invokes the in-place switch handler
 * (registered via onFeedSwitch) or falls back to a hard reload when no
 * handler is present.
 */
export function selectFeed(id: string): void {
  if (id === activeFeed.id) return;
  const next = allFeeds.find((f) => f.id === id);
  if (!next) return;
  window.localStorage.setItem(STORAGE_KEY, id);
  const url = new URL(window.location.href);
  url.searchParams.set(URL_PARAM, id);
  // Clear the per-aircraft hash — the selected hex won't exist on the new
  // feed and following it across feeds isn't meaningful.
  url.hash = '';
  window.history.replaceState(null, '', url.toString());
  activeFeed = next;
  if (switchHandler) {
    switchHandler(next);
  } else {
    throw new Error('No feed switch handler registered');
  }
}
