// ACARS message stream client.
//
// Mirrors the shape of feed/live.ts: WebSocket-first, HTTP fallback,
// emits both messages and a connection-state status to listeners.
//
// Backend: acars-service. Endpoints (proxied at /acars-api/* by nginx):
//   GET  /messages/recent?minutes=30&limit=100  → bootstrap + HTTP fallback
//   WS   /ws                                    → live stream
//
// WS frame types:
//   {type: 'connected', hub_connected, last_message_age_s, ...}
//   {type: 'heartbeat', hub_connected, last_message_age_s, messages_received}
//   {type: 'new_message', message: {...}}

export interface AcarsMessage {
  /** ISO timestamp of when acars-service stamped the message. */
  time: string;
  /** Lowercase ICAO hex (we lowercase on intake). May be null. */
  icao: string | null;
  flight: string | null;
  reg: string | null;
  /** ACARS label code (e.g. "H1", "5Z"). */
  label: string | null;
  /** Block id assigned by the ACARS protocol (one char). */
  blockId: string | null;
  /** Message sequence number (e.g. "M01A"). */
  msgNum: string | null;
  /** Raw or partially-decoded message body. */
  text: string | null;
  freq: string | null;
  level: number | null;
  /** Decode error count from acarsdec. 0 means a clean decode. */
  error: number | null;
  mode: string | null;
  /** Station id of the receiver that decoded this message. */
  stationId: string | null;
  destination: string | null;
  eta: string | null;
  /** OOOI timestamps (raw strings from acarshub, e.g. "184230"). */
  gtout: string | null;
  wloff: string | null;
  wlin: string | null;
  gtin: string | null;
  position: { lat: number; lon: number; alt: number | null } | null;
}

export interface AcarsStatus {
  /** Track-service-connected says nothing about the SDR-side hub; this is the truthful one. */
  hubConnected: boolean;
  /** Seconds since last decoded message arrived from acarshub. null = never since startup. */
  hubAgeS: number | null;
  /** Whether our WS / HTTP transport is currently up. */
  transportOk: boolean;
}

export type AcarsListener = (msg: AcarsMessage, status: AcarsStatus) => void;
export type AcarsStatusListener = (status: AcarsStatus) => void;

export interface AcarsFeedConfig {
  /** Base path for the per-feed ACARS API (e.g. `/acars-api`). */
  apiBase: string;
}

interface RawMessage {
  time?: string;
  icao?: string | null;
  flight?: string | null;
  reg?: string | null;
  label?: string | null;
  block_id?: string | null;
  msg_num?: string | null;
  text?: string | null;
  freq?: string | null;
  level?: number | null;
  error?: number | null;
  mode?: string | null;
  station_id?: string | null;
  destination?: string | null;
  eta?: string | null;
  gtout?: string | null;
  wloff?: string | null;
  wlin?: string | null;
  gtin?: string | null;
  position?: { lat?: number; lon?: number; alt?: number | null } | null;
}

interface NewMessageFrame {
  type: 'new_message';
  message: RawMessage;
}
interface ConnectedFrame {
  type: 'connected';
  hub_connected?: boolean;
  last_message_age_s?: number | null;
}
interface HeartbeatFrame {
  type: 'heartbeat';
  hub_connected?: boolean;
  last_message_age_s?: number | null;
}
type WsFrame = NewMessageFrame | ConnectedFrame | HeartbeatFrame;

interface RecentBody {
  messages?: RawMessage[];
}

const WS_CONNECT_TIMEOUT_MS = 3000;
const WS_RETRY_INTERVAL_MS = 30_000;
const HTTP_POLL_INTERVAL_MS = 30_000;

function normalize(raw: RawMessage): AcarsMessage | null {
  const time = raw.time;
  if (!time) return null;
  return {
    time,
    icao: raw.icao ? raw.icao.toLowerCase() : null,
    flight: raw.flight ? raw.flight.trim() || null : null,
    reg: raw.reg ?? null,
    label: raw.label ?? null,
    blockId: raw.block_id ?? null,
    msgNum: raw.msg_num ?? null,
    text: raw.text ?? null,
    freq: raw.freq ?? null,
    level: raw.level ?? null,
    error: raw.error ?? null,
    mode: raw.mode ?? null,
    stationId: raw.station_id ?? null,
    destination: raw.destination ?? null,
    eta: raw.eta ?? null,
    gtout: raw.gtout ?? null,
    wloff: raw.wloff ?? null,
    wlin: raw.wlin ?? null,
    gtin: raw.gtin ?? null,
    position:
      raw.position && typeof raw.position.lat === 'number' && typeof raw.position.lon === 'number'
        ? { lat: raw.position.lat, lon: raw.position.lon, alt: raw.position.alt ?? null }
        : null,
  };
}

function resolveWsUrl(apiBase: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${apiBase}/ws`;
}

export class AcarsFeed {
  private readonly listeners = new Set<AcarsListener>();
  private readonly statusListeners = new Set<AcarsStatusListener>();
  private readonly apiBase: string;
  private readonly wsUrl: string;

  private ws: WebSocket | null = null;
  private wsConnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private httpTimer: ReturnType<typeof setTimeout> | null = null;
  private httpAborter: AbortController | null = null;
  private running = false;
  // Mirrors feed/live.ts's gating: `this.ws` is set as soon as the socket
  // is constructed (still CONNECTING), so gating the HTTP path on it made
  // the 3s connect-timeout fallback dead code — fallbackToHttp's own guard
  // (`this.ws`) blocked it every time. Track the settled transport instead.
  private source: 'ws' | 'http' | null = null;

  private status: AcarsStatus = {
    hubConnected: false,
    hubAgeS: null,
    transportOk: false,
  };
  // Lowest-time-seen guard so the HTTP poll fallback doesn't re-emit the
  // same messages we already pushed via WS or a previous poll cycle.
  private lastSeenMs = 0;

  constructor(config: AcarsFeedConfig) {
    this.apiBase = config.apiBase;
    this.wsUrl = resolveWsUrl(config.apiBase);
  }

  subscribe(fn: AcarsListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  subscribeStatus(fn: AcarsStatusListener): () => void {
    // No synchronous fire-on-subscribe — callers might be wiring this
    // up from inside their own initialization (e.g. main.ts's
    // startSession), and the immediate callback can hit a `session`
    // binding that's still in the temporal dead zone. The next
    // heartbeat (≤5s) will deliver the current state anyway.
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Pull a small recent window first so the UI has data before any
    // WS frames arrive. Then connect WS.
    void this.bootstrap();
    this.connectWs();
  }

  stop(): void {
    this.running = false;
    this.clearWsConnectTimer();
    this.clearWsRetryTimer();
    this.closeWs();
    this.stopHttp();
    this.source = null;
    this.setStatus({ ...this.status, transportOk: false });
  }

  // ────────────────────────────────────────────────────────────────────

  private async bootstrap(): Promise<void> {
    try {
      const url = `${this.apiBase}/messages/recent?minutes=30&limit=100`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as RecentBody;
      const messages = body.messages ?? [];
      // /messages/recent returns newest-first; replay oldest-first so the
      // UI's "most recent at top" caches end up in the right order.
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = normalize(messages[i]!);
        if (!m) continue;
        const ms = Date.parse(m.time);
        if (ms > this.lastSeenMs) this.lastSeenMs = ms;
        this.emit(m);
      }
    } catch {
      // Bootstrap failure isn't fatal — WS or HTTP fallback will catch up.
    }
  }

  private connectWs(): void {
    if (!this.running || this.ws) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl);
    } catch {
      this.fallbackToHttp();
      return;
    }
    this.ws = ws;

    this.wsConnectTimer = setTimeout(() => {
      // Connect timed out — start HTTP polling for messages so the UI
      // sees something. Leave the WS handshake attempt running; if it
      // eventually opens we hand back to WS in onopen.
      this.fallbackToHttp();
    }, WS_CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      this.clearWsConnectTimer();
      this.clearWsRetryTimer();
      this.source = 'ws';
      this.setStatus({ ...this.status, transportOk: true });
      this.stopHttp();
    };

    ws.onmessage = (evt) => {
      let frame: WsFrame;
      try {
        frame = JSON.parse(evt.data as string) as WsFrame;
      } catch {
        return;
      }
      if (frame.type === 'new_message') {
        const m = normalize(frame.message);
        if (m) {
          const ms = Date.parse(m.time);
          if (ms > this.lastSeenMs) this.lastSeenMs = ms;
          this.emit(m);
        }
      } else if (frame.type === 'heartbeat' || frame.type === 'connected') {
        this.setStatus({
          hubConnected: Boolean(frame.hub_connected),
          hubAgeS: frame.last_message_age_s ?? null,
          transportOk: true,
        });
      }
    };

    ws.onerror = () => {
      // onclose follows; let it handle the fallback.
    };

    ws.onclose = () => {
      this.ws = null;
      this.clearWsConnectTimer();
      this.source = null;
      this.setStatus({ ...this.status, transportOk: false });
      if (!this.running) return;
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
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  private clearWsConnectTimer(): void {
    if (this.wsConnectTimer) clearTimeout(this.wsConnectTimer);
    this.wsConnectTimer = null;
  }

  private scheduleWsRetry(): void {
    if (this.wsRetryTimer || !this.running) return;
    this.wsRetryTimer = setTimeout(() => {
      this.wsRetryTimer = null;
      if (!this.running || this.ws) return;
      this.connectWs();
    }, WS_RETRY_INTERVAL_MS);
  }

  private clearWsRetryTimer(): void {
    if (this.wsRetryTimer) clearTimeout(this.wsRetryTimer);
    this.wsRetryTimer = null;
  }

  // ────────────────────────────────────────────────────────────────────
  // HTTP fallback: re-poll /messages/recent every 30s and emit anything
  // newer than `lastSeenMs`. ACARS is bursty enough that this is a fine
  // bridge while WS is unavailable.

  private fallbackToHttp(): void {
    if (!this.running || this.httpTimer || this.httpAborter) return;
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
    this.httpAborter?.abort();
    this.httpAborter = new AbortController();
    try {
      const url = `${this.apiBase}/messages/recent?minutes=5&limit=200`;
      const res = await fetch(url, { cache: 'no-store', signal: this.httpAborter.signal });
      if (res.ok) {
        const body = (await res.json()) as RecentBody;
        const messages = body.messages ?? [];
        // Newest-first → reverse for chronological emit.
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = normalize(messages[i]!);
          if (!m) continue;
          const ms = Date.parse(m.time);
          if (ms <= this.lastSeenMs) continue;
          this.lastSeenMs = ms;
          this.emit(m);
        }
        this.setStatus({ ...this.status, transportOk: true });
      } else {
        this.setStatus({ ...this.status, transportOk: false });
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      this.setStatus({ ...this.status, transportOk: false });
    }
    // TS narrows `this.source` from the early-return above and can't see
    // that ws.onopen (an async callback) may have reassigned it across the
    // await — cast through the full union like feed/live.ts does.
    if (!this.running || (this.source as 'ws' | 'http' | null) === 'ws') return;
    this.httpTimer = setTimeout(() => void this.httpTick(), HTTP_POLL_INTERVAL_MS);
  }

  // ────────────────────────────────────────────────────────────────────

  private emit(msg: AcarsMessage): void {
    for (const fn of this.listeners) fn(msg, this.status);
  }

  private setStatus(next: AcarsStatus): void {
    if (
      next.hubConnected === this.status.hubConnected &&
      next.hubAgeS === this.status.hubAgeS &&
      next.transportOk === this.status.transportOk
    ) {
      return;
    }
    this.status = next;
    for (const fn of this.statusListeners) fn(this.status);
  }
}
