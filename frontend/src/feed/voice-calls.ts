// voice-calls.ts — data module for the call-based voice scanner.
//
// Singleton that owns the single WebSocket connection to /voice/ws and the
// rolling in-memory call list. All consumers (voice-panel.ts, etc.) subscribe
// here rather than opening their own connections.
//
// Subscribe pattern: identical to core/settings.ts and feed/feeds.ts —
// register a listener, get back an unsubscribe function. No framework.
//
// WS message types (two):
//   {type:'activity', ts, channels:{label:{freq,active,...}}}
//   {type:'call',    call:{...}}
//
// The indexer's audioUrl is /calls/<id>/audio (its own namespace).
// The browser must request it through the proxy as /voice/calls/<id>/audio.
// Use audioUrlFor(call) everywhere instead of call.audioUrl directly.

const WS_URL_FN = (): string => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/voice/ws`;
};

// The web UI shows only the last hour of calls — plenty of recent context
// without an ever-growing list. The indexer keeps more on the backend.
const HISTORY_WINDOW_MS = 60 * 60 * 1000;
const RECONNECT_DELAY_MS = 2_000;

function callsUrl(): string {
  return `/voice/calls?since=${Date.now() - HISTORY_WINDOW_MS}&limit=300`;
}

// ─── Public types ──────────────────────────────────────────────────────────

export interface Call {
  id: string;
  channel: string;
  label: string;
  freq: string;
  startedAt: number; // unix ms
  durationS: number;
  /** Raw audioUrl from the indexer: /calls/<id>/audio. Use audioUrlFor(). */
  audioUrl: string;
}

export interface ChannelActivityState {
  freq: string;
  active: boolean;
  activity: number;
  signal_dbfs: number | null;
  noise_dbfs: number | null;
}

export type ActivityPayload = Record<string, ChannelActivityState>;

/** Prefix the indexer's audioUrl with /voice to reach the nginx proxy. */
export function audioUrlFor(call: Call): string {
  // call.audioUrl is /calls/<id>/audio — prepend the proxy namespace.
  return `/voice${call.audioUrl}`;
}

// ─── Internal WS message shapes ───────────────────────────────────────────

interface WsActivityMessage {
  type: 'activity';
  ts: number;
  channels: ActivityPayload;
}

interface WsCallMessage {
  type: 'call';
  call: Call;
}

type WsMessage = WsActivityMessage | WsCallMessage;

// ─── Subscriber sets ──────────────────────────────────────────────────────

type CallsListener = (calls: readonly Call[], newCall: Call | null) => void;
type ActivityListener = (payload: ActivityPayload) => void;
type ConnectionListener = (connected: boolean) => void;

const callsListeners = new Set<CallsListener>();
const activityListeners = new Set<ActivityListener>();
const connectionListeners = new Set<ConnectionListener>();

// ─── State ────────────────────────────────────────────────────────────────

let calls: Call[] = [];
let wsConnected = false;
let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let initialized = false;

// ─── Helpers ──────────────────────────────────────────────────────────────

function notifyCalls(newCall: Call | null): void {
  for (const fn of callsListeners) fn(calls, newCall);
}

function notifyActivity(payload: ActivityPayload): void {
  for (const fn of activityListeners) fn(payload);
}

function notifyConnection(connected: boolean): void {
  for (const fn of connectionListeners) fn(connected);
}

/** Drop calls older than the 1-hour history window. Returns true if any
 *  were removed, so callers can decide whether to notify subscribers. */
function pruneOld(): boolean {
  const cutoff = Date.now() - HISTORY_WINDOW_MS;
  const before = calls.length;
  calls = calls.filter((c) => c.startedAt >= cutoff);
  return calls.length !== before;
}

function prependCall(call: Call): void {
  // Avoid duplicates (e.g. if a call appears in both the initial fetch and
  // a subsequent WS push during the boot window).
  if (calls.some((c) => c.id === call.id)) return;
  calls = [call, ...calls];
  pruneOld();
}

// ─── WebSocket ────────────────────────────────────────────────────────────

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

function connect(): void {
  try {
    ws = new WebSocket(WS_URL_FN());
  } catch (err) {
    console.warn('[voice-calls] WebSocket ctor failed', err);
    scheduleReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    wsConnected = true;
    notifyConnection(true);
  });

  ws.addEventListener('message', (e) => {
    let msg: WsMessage;
    try {
      msg = JSON.parse(e.data as string) as WsMessage;
    } catch {
      return; // ignore malformed frames
    }

    if (msg.type === 'activity') {
      notifyActivity(msg.channels);
    } else if (msg.type === 'call') {
      const call = msg.call;
      prependCall(call);
      notifyCalls(call);
    }
  });

  ws.addEventListener('close', () => {
    wsConnected = false;
    notifyConnection(false);
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    // The close event fires next and handles reconnect scheduling.
    console.warn('[voice-calls] WebSocket error');
  });
}

// ─── Initial fetch ────────────────────────────────────────────────────────

async function fetchInitial(): Promise<void> {
  try {
    const res = await fetch(callsUrl());
    if (!res.ok) {
      console.warn('[voice-calls] initial fetch failed', res.status);
      return;
    }
    const data = (await res.json()) as Call[];
    if (!Array.isArray(data)) return;
    // Fetch returns newest-first; prepend oldest-first so prependCall
    // ends with the right order.
    for (let i = data.length - 1; i >= 0; i--) {
      const c = data[i];
      if (c) prependCall(c);
    }
    notifyCalls(null);
  } catch (err) {
    console.warn('[voice-calls] initial fetch error', err);
  }
}

// ─── Lazy init ────────────────────────────────────────────────────────────
// Called once when the first subscriber registers. Avoids opening a
// connection when the voice panel is hidden / voice not configured.

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  void fetchInitial();
  connect();
  // Age calls out of the 1-hour window even when no new calls are arriving.
  window.setInterval(() => {
    if (pruneOld()) notifyCalls(null);
  }, 60_000);
}

// ─── Public API ───────────────────────────────────────────────────────────

export function getCalls(): readonly Call[] {
  return calls;
}

/** Subscribe to call-list changes. `newCall` is the just-arrived call (null
 *  for bulk initial load). Returns an unsubscribe function. */
export function subscribeCalls(fn: CallsListener): () => void {
  ensureInit();
  callsListeners.add(fn);
  return () => { callsListeners.delete(fn); };
}

/** Subscribe to per-channel activity updates from the WebSocket.
 *  Returns an unsubscribe function. */
export function subscribeActivity(fn: ActivityListener): () => void {
  ensureInit();
  activityListeners.add(fn);
  return () => { activityListeners.delete(fn); };
}

/** Subscribe to WebSocket connection state changes (true = connected).
 *  Fires immediately with the current state when registered. */
export function subscribeConnection(fn: ConnectionListener): () => void {
  ensureInit();
  connectionListeners.add(fn);
  fn(wsConnected); // fire immediately with current state
  return () => { connectionListeners.delete(fn); };
}
