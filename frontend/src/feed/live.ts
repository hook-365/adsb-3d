import type { Aircraft, AircraftJsonFeed, RawAircraft } from '../core/types';
import { POLL_INTERVAL_MS } from '../core/config';
import { normalizeRawAircraft } from './normalize';

// Live aircraft feed.
//
// Prefers a server-pushed WebSocket diff stream (track-service /ws/live):
// snapshot on connect, then per-tick {added, updated, removed}. Falls back
// to polling readsb's /data/aircraft.json directly if the socket can't
// connect or drops, and retries the WS in the background while on HTTP so
// we eventually self-heal back onto the cheap path.
//
// Listeners always see the full normalized Aircraft list on each emit,
// regardless of which transport produced it.

export interface FeedStatus {
  ok: boolean;
  count: number;
  errored?: string;
  source?: 'ws' | 'http';
  lastSyncMs: number;
  /**
   * Seconds since the track-service last successfully fetched its upstream
   * readsb feeder. Higher = staler data. Only populated on the WS path
   * (the HTTP fallback already fails fast on a dead feeder via res.status,
   * so its absence here just means "feed is fresh enough that res.ok").
   */
  feederAgeS?: number | null;
}

export type FeedListener = (records: Aircraft[], status: FeedStatus) => void;

export interface SnapshotMsg {
  type: 'snapshot';
  now: number;
  feeder_age_s?: number | null;
  aircraft: RawAircraft[];
}
export interface DiffMsg {
  type: 'diff';
  now: number;
  feeder_age_s?: number | null;
  added?: RawAircraft[];
  updated?: RawAircraft[];
  removed?: string[];
}
export type WsMsg = SnapshotMsg | DiffMsg;

/**
 * Pure snapshot/diff map-mutation body of the WS onmessage handler, split
 * out so it's independently testable without a live WebSocket. Mutates
 * `map` in place; hex keys are lowercased; records without a `hex` are
 * skipped.
 */
export function applyWsMessage(map: Map<string, RawAircraft>, msg: WsMsg): void {
  if (msg.type === 'snapshot') {
    map.clear();
    for (const a of msg.aircraft) {
      if (a.hex) map.set(a.hex.toLowerCase(), a);
    }
  } else if (msg.type === 'diff') {
    for (const a of msg.added ?? []) if (a.hex) map.set(a.hex.toLowerCase(), a);
    for (const a of msg.updated ?? []) if (a.hex) map.set(a.hex.toLowerCase(), a);
    for (const h of msg.removed ?? []) map.delete(h.toLowerCase());
  }
}

const WS_CONNECT_TIMEOUT_MS = 3000;
const WS_RETRY_INTERVAL_MS = 30_000;

export interface LiveFeedConfig {
  /** Path or URL fetched at POLL_INTERVAL_MS for the HTTP fallback. */
  liveUrl: string;
  /**
   * WebSocket URL for the diff stream, or null when this feed's track-service
   * doesn't speak the new protocol — we go straight to HTTP polling and skip
   * the connect attempt entirely. Pass an absolute path like `/api/ws/live`
   * (resolved against the current host) or a full ws[s]:// URL.
   */
  wsUrl: string | null;
}

function resolveWsUrl(input: string | null): string | null {
  if (input === null) return null;
  if (/^wss?:\/\//.test(input)) return input;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${input.startsWith('/') ? '' : '/'}${input}`;
}

export class LiveFeed {
  private readonly listeners = new Set<FeedListener>();
  private readonly httpUrl: string;
  private readonly wsUrl: string | null;

  // Transport state
  private ws: WebSocket | null = null;
  private wsConnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private httpTimer: ReturnType<typeof setTimeout> | null = null;
  private httpAborter: AbortController | null = null;
  private running = false;
  private source: 'ws' | 'http' | null = null;

  // WS path keeps a hex → raw map so diffs can be applied incrementally
  // and emitted as a full list (preserves the listener contract).
  private wsRaw = new Map<string, RawAircraft>();
  // Latest feeder freshness reported by the track-service. null → server
  // never had a successful feeder fetch; undefined → field absent (older
  // server). Higher numbers mean staler data.
  private wsFeederAgeS: number | null | undefined = undefined;

  constructor(config: LiveFeedConfig) {
    this.httpUrl = config.liveUrl;
    this.wsUrl = resolveWsUrl(config.wsUrl);
  }

  subscribe(fn: FeedListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.wsUrl) {
      this.connectWs();
    } else {
      // No WS for this feed — go straight to HTTP polling. The retry timer
      // never fires since wsUrl stays null for the lifetime of the instance.
      this.fallbackToHttp();
    }
  }

  stop(): void {
    this.running = false;
    this.clearWsConnectTimer();
    this.clearWsRetryTimer();
    this.closeWs();
    this.stopHttp();
  }

  // ────────────────────────────────────────────────────────────────────
  // WebSocket transport

  private connectWs(): void {
    if (!this.running || this.ws || !this.wsUrl) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl);
    } catch {
      this.fallbackToHttp();
      return;
    }
    this.ws = ws;

    this.wsConnectTimer = setTimeout(() => {
      // Connect timed out — start HTTP so the user sees data, but leave
      // the WS handshake attempt running. If it eventually opens we'll
      // hand back to WS in onopen.
      this.fallbackToHttp();
    }, WS_CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      this.clearWsConnectTimer();
      this.clearWsRetryTimer();
      this.source = 'ws';
      this.stopHttp();
    };

    ws.onmessage = (evt) => {
      let msg: WsMsg;
      try {
        msg = JSON.parse(evt.data as string) as WsMsg;
      } catch {
        return;
      }
      if (msg.type !== 'snapshot' && msg.type !== 'diff') return;
      applyWsMessage(this.wsRaw, msg);
      // The server includes feeder_age_s on every frame (snapshot + diff)
      // when it's running the redesigned track-service. Cache it so each
      // emit reflects the latest freshness reading even on heartbeat-only
      // ticks (no aircraft changes but the age moved).
      if (msg.feeder_age_s !== undefined) {
        this.wsFeederAgeS = msg.feeder_age_s;
      }
      this.emitFromWs(msg.now);
    };

    ws.onerror = () => {
      // onerror always followed by onclose; let close handle the fallback.
    };

    ws.onclose = () => {
      this.ws = null;
      this.clearWsConnectTimer();
      if (!this.running) return;
      // If we were on WS, hand off to HTTP and schedule a reconnect.
      this.source = null;
      this.fallbackToHttp();
      this.scheduleWsRetry();
    };
  }

  private closeWs(): void {
    if (!this.ws) return;
    this.ws.onopen = null;
    this.ws.onmessage = null;
    this.ws.onerror = null;
    this.ws.onclose = null;
    try { this.ws.close(); } catch { /* ignore */ }
    this.ws = null;
    this.wsRaw.clear();
    this.wsFeederAgeS = undefined;
  }

  private clearWsConnectTimer(): void {
    if (this.wsConnectTimer) clearTimeout(this.wsConnectTimer);
    this.wsConnectTimer = null;
  }

  private scheduleWsRetry(): void {
    if (this.wsRetryTimer || !this.running || !this.wsUrl) return;
    this.wsRetryTimer = setTimeout(() => {
      this.wsRetryTimer = null;
      if (!this.running || this.source === 'ws') return;
      this.connectWs();
    }, WS_RETRY_INTERVAL_MS);
  }

  private clearWsRetryTimer(): void {
    if (this.wsRetryTimer) clearTimeout(this.wsRetryTimer);
    this.wsRetryTimer = null;
  }

  private emitFromWs(serverNow: number): void {
    const nowMs = Math.round((serverNow || Date.now() / 1000) * 1000);
    const records: Aircraft[] = [];
    for (const raw of this.wsRaw.values()) {
      const a = normalizeRawAircraft(raw, nowMs);
      if (a) records.push(a);
    }
    const status: FeedStatus = {
      ok: true,
      count: records.length,
      source: 'ws',
      lastSyncMs: Date.now(),
    };
    if (this.wsFeederAgeS !== undefined) status.feederAgeS = this.wsFeederAgeS;
    for (const fn of this.listeners) fn(records, status);
  }

  // ────────────────────────────────────────────────────────────────────
  // HTTP transport (fallback)

  private fallbackToHttp(): void {
    if (!this.running) return;
    if (this.httpTimer || this.httpAborter) return; // already polling
    this.source = 'http';
    void this.httpTick();
  }

  private stopHttp(): void {
    if (this.httpTimer) clearTimeout(this.httpTimer);
    this.httpTimer = null;
    this.httpAborter?.abort();
    this.httpAborter = null;
  }

  private async httpTick(): Promise<void> {
    if (!this.running || this.source === 'ws') return;
    const start = performance.now();
    let status: FeedStatus = { ok: false, count: 0, source: 'http', lastSyncMs: Date.now() };
    let records: Aircraft[] = [];

    this.httpAborter?.abort();
    this.httpAborter = new AbortController();
    try {
      const res = await fetch(this.httpUrl, { cache: 'no-store', signal: this.httpAborter.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as AircraftJsonFeed;
      const nowMs = Math.round((body.now ?? Date.now() / 1000) * 1000);
      records = (body.aircraft ?? [])
        .map((r) => normalizeRawAircraft(r, nowMs))
        .filter((a): a is Aircraft => a !== null);
      status = { ok: true, count: records.length, source: 'http', lastSyncMs: Date.now() };
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      status = {
        ok: false,
        count: 0,
        errored: (err as Error).message,
        source: 'http',
        lastSyncMs: Date.now()
      };
    }

    // WS may have raced ahead and connected during the await; in that case
    // the WS onopen handler already promoted us to source='ws' and stopped
    // HTTP. Don't fire a stale HTTP emit on top of fresh WS data.
    if ((this.source as 'ws' | 'http' | null) !== 'ws') {
      for (const fn of this.listeners) fn(records, status);
    }

    const elapsed = performance.now() - start;
    const wait = Math.max(0, POLL_INTERVAL_MS - elapsed);
    this.httpTimer = setTimeout(() => void this.httpTick(), wait);
  }
}
