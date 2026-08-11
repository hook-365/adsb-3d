// Session manager — owns "what is driving the aircraft store right now"
// as an explicit state machine with two states: live(feed) and
// historical(feed, window). Every structural change (feed switch, mode
// switch, window change) funnels through one transition path; per-frame
// cursor movement is deliberately NOT a transition and short-circuits to
// the active historical feed.
//
// Each state is realized as a bundle: the driver plus its attachments
// (history backfill, route prefetcher, ACARS, loading overlay), all
// registered in one Scope so teardown is a single dispose() with no
// per-attachment bookkeeping. Bundles report facts into core/health;
// the HUD owns the wording.
//
// Async chunk loads (historical playback + heatmap are lazy imports)
// are guarded by a generation counter: transition() bumps it, in-flight
// continuations compare their captured value and bail if the user
// pivoted away mid-load.

import type { Object3D } from 'three';
import { AircraftStore, setDefaultTrailCap } from '../aircraft/store';
import { addAcarsMessage, clearAcars } from '../aircraft/acars-store';
import {
  classifyAcars,
  classifyLive,
  setAcarsHealth,
  setFeedHealth,
  setFeedIdentity,
} from '../core/health';
import { t } from '../core/i18n';
import { getSettings, subscribeSettings } from '../core/settings';
import { createScope } from '../core/scope';
import {
  setLive,
  subscribeTime,
  type HistoricalWindow,
} from '../core/time-context';
import { AcarsFeed } from '../feed/acars';
import {
  getActiveFeed,
  getFeedMode,
  onFeedSwitch,
  type Feed,
} from '../feed/feeds';
import { HistoryBackfill } from '../feed/history';
import { LiveFeed } from '../feed/live';
import {
  attachRouteBatchPrefetcher,
  clearRouteCache,
  configureRoutesApi,
} from '../feed/routes';
import { showLoading, type LoadingHandle } from '../ui/loading-overlay';
// Historical-mode feed + heatmap layer are loaded dynamically on first
// entry to historical mode — see bootHistorical. Both modules are only
// needed when the user actually switches to historical playback and
// would otherwise inflate the cold-load bundle for everyone.
import type { HistoricalFeed as HistoricalFeedType } from '../feed/historical';
import type { HeatmapLayer as HeatmapLayerType } from '../world/heatmap';

export type SessionState =
  | { kind: 'live'; feed: Feed }
  | { kind: 'historical'; feed: Feed; window: HistoricalWindow; cursorMs: number | null };

export interface SessionHooks {
  /**
   * View-level reset when the active feed identity changes: selection,
   * camera, HOME/world recenter, subtitle, voice panel. Called after the
   * stores are cleared and before the new bundle boots.
   */
  onFeedChanged(next: Feed): void;
  /** Called when leaving live mode (close the ACARS browser, etc.). */
  onEnterHistorical(): void;
}

export interface SessionApi {
  /**
   * Force a history refetch for one aircraft — the selection
   * trail-extension flow. No-op while in historical playback.
   */
  refreshHistory(hex: string, windowMs: number): void;
  getState(): Readonly<SessionState>;
}

type ActiveBundle =
  | { kind: 'live'; stop(): void; history: HistoryBackfill }
  | {
      kind: 'historical';
      stop(): void;
      retarget(window: HistoricalWindow, cursorMs: number | null): void;
      setCursor(ms: number): void;
      getFeed(): HistoricalFeedType | null;
    };

function windowKey(w: HistoricalWindow | null): string | null {
  return w ? `${w.startMs}|${w.endMs}` : null;
}

function formatWindowLabel(window: { startMs: number; endMs: number } | null): string {
  if (!window) return '';
  const hours = (window.endMs - window.startMs) / 3_600_000;
  if (hours <= 1.01) return t('main.window_last_hour');
  if (hours <= 24.01) return t('main.window_last_hours', { n: Math.round(hours) });
  const days = hours / 24;
  return t('main.window_last_days', { n: Math.round(days) });
}

export function initSession(opts: {
  store: AircraftStore;
  // Root the heatmap mounts under — xrRoot so it moves/scales with the
  // world in XR (it was previously the raw Scene: an XR placement bug).
  scene: Object3D;
  hooks: SessionHooks;
}): SessionApi {
  const { store, scene, hooks } = opts;

  // Bumped on every transition; async continuations captured under an
  // older generation must not touch shared state.
  let gen = 0;

  // The heatmap layer is created lazily on first historical entry and
  // then cached for the page lifetime — its geometry survives mode
  // toggles so flipping the airway view back on doesn't refetch/rebuild.
  let heatmapLayer: HeatmapLayerType | null = null;
  // Which window's tracks the heatmap geometry was last built from, so
  // toggling visibility doesn't rebuild and a new window forces one.
  let heatmapBuiltWindowKey: string | null = null;

  function bootLive(feed: Feed): ActiveBundle {
    const scope = createScope();
    configureRoutesApi(feed.apiBase);
    // Per-feed trail policy: local gets unlimited, others stay at the safe
    // 600 (see feeds.ts). Set this before LiveFeed starts pushing snapshots
    // so the very first appendTrail uses the right cap.
    setDefaultTrailCap(feed.trailMaxPoints);
    setFeedIdentity({ name: feed.name, multi: getFeedMode() === 'multi' });
    setFeedHealth({ mode: 'live', state: 'connecting', feederAgeS: null });

    // Surface the initial connect with the centered loading card so the
    // user knows we're alive while the WebSocket negotiates. Cleared on
    // the first successful snapshot, or by scope disposal if the bundle
    // is torn down before one arrives (feed switch, entering historical).
    let connectLoader: LoadingHandle | null = showLoading(
      t('main.connecting_feed'),
      feed.name,
    );
    scope.own(() => {
      connectLoader?.done();
      connectLoader = null;
    });

    const liveFeed = new LiveFeed({
      liveUrl: feed.liveUrl,
      wsUrl: feed.supportsWs ? `${feed.apiBase}/ws/live` : null,
    });
    liveFeed.subscribe((records, status) => {
      if (connectLoader && status.ok) {
        connectLoader.done();
        connectLoader = null;
      }
      store.syncFromFeed(records);
      setFeedHealth({
        mode: 'live',
        state: classifyLive(status),
        feederAgeS: status.feederAgeS ?? null,
      });
    });
    liveFeed.start();
    scope.own(() => liveFeed.stop());

    const history = new HistoryBackfill(store, {
      apiBase: feed.apiBase,
      enabled: feed.supportsHistory,
      windowMs: feed.backfillWindowMs,
    });
    scope.own(() => history.stop());

    scope.own(attachRouteBatchPrefetcher(store));

    // ACARS — only when this feed has it configured AND the user hasn't
    // disabled the feature. The settings toggle can flip mid-session, so
    // the socket is spun up/down to match without rebuilding the bundle.
    let acars: AcarsFeed | null = null;
    const syncAcars = (): void => {
      const want = Boolean(feed.acarsApiBase) && getSettings().acarsMessages;
      if (want && !acars) {
        acars = new AcarsFeed({ apiBase: feed.acarsApiBase! });
        acars.subscribe((msg) => addAcarsMessage(msg));
        acars.subscribeStatus((s) =>
          setAcarsHealth({ state: classifyAcars(s), hubAgeS: s.hubAgeS }),
        );
        acars.start();
        // Chip shows as down until the first status arrives.
        setAcarsHealth({ state: classifyAcars(null), hubAgeS: null });
      } else if (!want && acars) {
        acars.stop();
        acars = null;
        clearAcars();
        setAcarsHealth(null);
      } else if (!want) {
        setAcarsHealth(null);
      }
    };
    syncAcars();
    scope.own(subscribeSettings(syncAcars));
    scope.own(() => {
      acars?.stop();
      acars = null;
    });

    return { kind: 'live', stop: () => scope.dispose(), history };
  }

  function bootHistorical(
    feed: Feed,
    window: HistoricalWindow,
    cursorMs: number | null,
  ): ActiveBundle {
    const scope = createScope();
    const myGen = gen;
    // ACARS chip is meaningless against replayed data — hide it.
    setAcarsHealth(null);
    setFeedHealth({
      mode: 'historical',
      state: 'loading',
      visibleCount: 0,
      aircraftCount: 0,
    });

    // Surface the bulk fetch with the centered loading card. Cleared on
    // load completion or error so the world becomes interactive again.
    let histLoader: LoadingHandle | null = showLoading(
      t('main.loading_historical'),
      formatWindowLabel(window),
    );
    scope.own(() => {
      histLoader?.done();
      histLoader = null;
    });

    let feedInstance: HistoricalFeedType | null = null;
    // Latest desired target. retarget() during the async chunk load just
    // updates these; the post-load code starts against the newest values,
    // so a window scrub that races the import isn't dropped.
    let targetWindow = window;
    let targetCursor = cursorMs;

    void (async () => {
      // Pull in the historical playback + heatmap chunks lazily. Both are
      // sizable (volumetric rendering, bulk-tracks decoder) and only
      // matter once the user toggles historical mode.
      const [historicalMod, heatmapMod] = await Promise.all([
        import('../feed/historical'),
        import('../world/heatmap'),
      ]);
      // User pivoted away while the chunks were loading — the bundle is
      // already disposed; do not touch shared state.
      if (gen !== myGen) return;
      if (!heatmapLayer) heatmapLayer = new heatmapMod.HeatmapLayer(scene);
      const buildTrailUpTo = historicalMod.buildTrailUpTo;
      const localHeatmap = heatmapLayer;

      const hf = new historicalMod.HistoricalFeed({ apiBase: feed.apiBase });
      feedInstance = hf;
      scope.own(() => {
        hf.stop();
        feedInstance = null;
      });

      hf.subscribe((records, status) => {
        store.syncFromFeed(records);
        // Replace each live aircraft's trail with the real samples that
        // pre-date the cursor. Without this the trail would carry forward
        // appendTrail's synthetic per-frame positions (smearing future
        // points behind a backward scrub) and rely on interpolation
        // artifacts instead of broadcast samples.
        if (status.cursorMs !== null) {
          const tracks = hf.getTracks();
          const cursor = status.cursorMs;
          for (const a of records) {
            const samples = tracks.get(a.hex);
            if (!samples) continue;
            store.setTrail(a.hex, buildTrailUpTo(samples, cursor));
          }
        }
        setFeedHealth({
          mode: 'historical',
          state: 'ok',
          visibleCount: status.visibleCount,
          aircraftCount: status.aircraftCount,
        });
      });

      // Track which (loaded, cellCount-flavored) signature we last rebuilt
      // the airway layer for. The status fires every cursor tick once
      // playback starts, so without a cheap idempotent check we'd rebuild
      // a million-segment LineSegments mesh on every frame.
      let lastBuildSignature: string | null = null;
      hf.subscribeStatus((status) => {
        if (status.errored) {
          setFeedHealth({
            mode: 'historical',
            state: 'error',
            visibleCount: status.visibleCount,
            aircraftCount: status.aircraftCount,
          });
          if (histLoader) {
            histLoader.done();
            histLoader = null;
          }
        } else if (status.loading) {
          setFeedHealth({
            mode: 'historical',
            state: 'loading',
            visibleCount: status.visibleCount,
            aircraftCount: status.aircraftCount,
          });
          lastBuildSignature = null; // new fetch in flight; allow rebuild on completion
          if (!histLoader) {
            histLoader = showLoading(
              t('main.loading_historical'),
              formatWindowLabel(hf.getWindow()),
            );
          }
        }
        // Rebuild on the loaded transition. Signature uses aircraftCount as
        // a cheap proxy for "has the underlying dataset changed".
        if (status.loaded) {
          const sig = `${status.aircraftCount}`;
          if (sig !== lastBuildSignature) {
            localHeatmap.rebuildFromTracks(hf.getTracks());
            heatmapBuiltWindowKey = windowKey(hf.getWindow());
            lastBuildSignature = sig;
          }
          if (histLoader) {
            histLoader.done();
            histLoader = null;
          }
        }
      });

      void hf.start(targetWindow, targetCursor ?? undefined);
    })();

    return {
      kind: 'historical',
      stop: () => scope.dispose(),
      retarget: (w, c) => {
        targetWindow = w;
        targetCursor = c;
        if (feedInstance) void feedInstance.start(w, c ?? undefined);
      },
      setCursor: (ms) => feedInstance?.setCursor(ms),
      getFeed: () => feedInstance,
    };
  }

  let state: SessionState = { kind: 'live', feed: getActiveFeed() };
  let active: ActiveBundle = bootLive(state.feed);

  function transition(next: SessionState): void {
    const prev = state;
    gen++;
    active.stop();
    state = next;

    const feedChanged = prev.feed.id !== next.feed.id;
    if (feedChanged) {
      // Wipe shared caches that key off feed identity, then let the view
      // layer recenter (HOME, camera, subtitle, voice panel, selection).
      store.clear();
      clearRouteCache();
      clearAcars();
      heatmapLayer?.clear();
      heatmapBuiltWindowKey = null;
      hooks.onFeedChanged(next.feed);
    } else if (prev.kind !== next.kind) {
      store.clear();
      if (next.kind === 'live') {
        heatmapLayer?.clear();
        heatmapBuiltWindowKey = null;
      }
    }
    if (next.kind === 'historical' && prev.kind !== 'historical') {
      hooks.onEnterHistorical();
    }

    active =
      next.kind === 'live'
        ? bootLive(next.feed)
        : bootHistorical(next.feed, next.window, next.cursorMs);
  }

  subscribeTime((ctx) => {
    if (ctx.mode === 'historical' && ctx.window) {
      if (state.kind !== 'historical') {
        transition({
          kind: 'historical',
          feed: state.feed,
          window: ctx.window,
          cursorMs: ctx.cursorMs,
        });
      } else if (windowKey(ctx.window) !== windowKey(state.window)) {
        state = { ...state, window: ctx.window, cursorMs: ctx.cursorMs };
        if (active.kind === 'historical') active.retarget(ctx.window, ctx.cursorMs);
      } else if (ctx.cursorMs !== null && active.kind === 'historical') {
        // Cursor movement is high-frequency (every playback frame) and
        // deliberately not a transition.
        active.setCursor(ctx.cursorMs);
      }

      // Heatmap: built from the playback feed's loaded tracks (no separate
      // fetch). The status subscriber rebuilds on load completion; this
      // covers toggling the heatmap on for an already-loaded window. The
      // getFeed() null guard covers the gap before the chunk load lands.
      const key = windowKey(ctx.window);
      if (heatmapLayer && ctx.heatmap && heatmapBuiltWindowKey !== key && active.kind === 'historical') {
        const tracks = active.getFeed()?.getTracks();
        if (tracks && tracks.size > 0) {
          heatmapLayer.rebuildFromTracks(tracks);
          heatmapBuiltWindowKey = key;
        }
      }
      heatmapLayer?.setVisible(ctx.heatmap);
    } else if (ctx.mode === 'live' && state.kind === 'historical') {
      transition({ kind: 'live', feed: state.feed });
    }
  });

  onFeedSwitch((next) => {
    const wasHistorical = state.kind === 'historical';
    // Feed switch always lands on the new feed's live view — the selected
    // window may not exist (or be meaningful) on the other feed's history.
    transition({ kind: 'live', feed: next });
    // Reset the time context AFTER the transition so our own subscriber
    // sees live/live and no-ops; the time-controls UI and URL follow.
    if (wasHistorical) setLive();
  });

  return {
    refreshHistory(hex, windowMs) {
      if (active.kind === 'live') active.history.refresh(hex, windowMs);
    },
    getState() {
      return state;
    },
  };
}
