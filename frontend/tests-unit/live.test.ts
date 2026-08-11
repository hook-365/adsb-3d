// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyWsMessage, LiveFeed, type DiffMsg, type SnapshotMsg } from '../src/feed/live';
import { setHome } from '../src/core/config';
import type { RawAircraft } from '../src/core/types';

// ── applyWsMessage (pure) ───────────────────────────────────────────────

function rawAc(hex: string): RawAircraft {
  return { hex, lat: 45, lon: -90 };
}

describe('applyWsMessage', () => {
  it('snapshot replaces the map wholesale', () => {
    const map = new Map<string, RawAircraft>([['zzz', rawAc('zzz')]]);
    const msg: SnapshotMsg = { type: 'snapshot', now: 1, aircraft: [rawAc('AAA'), rawAc('bbb')] };
    applyWsMessage(map, msg);
    expect(map.has('zzz')).toBe(false);
    expect(map.has('aaa')).toBe(true);
    expect(map.has('bbb')).toBe(true);
  });

  it('lowercases hexes on snapshot', () => {
    const map = new Map<string, RawAircraft>();
    applyWsMessage(map, { type: 'snapshot', now: 1, aircraft: [rawAc('ABCDEF')] });
    expect(map.has('abcdef')).toBe(true);
    expect(map.has('ABCDEF')).toBe(false);
  });

  it('skips records without a hex on snapshot', () => {
    const map = new Map<string, RawAircraft>();
    applyWsMessage(map, { type: 'snapshot', now: 1, aircraft: [{ hex: '', lat: 1, lon: 2 } as RawAircraft] });
    expect(map.size).toBe(0);
  });

  it('diff: added and updated upsert (case-insensitive), removed deletes', () => {
    const map = new Map<string, RawAircraft>([['aaa', rawAc('aaa')]]);
    const msg: DiffMsg = {
      type: 'diff',
      now: 1,
      added: [rawAc('BBB')],
      updated: [{ ...rawAc('AAA'), lat: 50 }],
      removed: [],
    };
    applyWsMessage(map, msg);
    expect(map.has('bbb')).toBe(true);
    expect(map.get('aaa')!.lat).toBe(50);
  });

  it('diff: removed deletes case-insensitively', () => {
    const map = new Map<string, RawAircraft>([['aaa', rawAc('aaa')]]);
    applyWsMessage(map, { type: 'diff', now: 1, removed: ['AAA'] });
    expect(map.has('aaa')).toBe(false);
  });

  it('diff tolerates absent added/updated/removed arrays', () => {
    const map = new Map<string, RawAircraft>([['aaa', rawAc('aaa')]]);
    expect(() => applyWsMessage(map, { type: 'diff', now: 1 })).not.toThrow();
    expect(map.has('aaa')).toBe(true);
  });
});

// ── LiveFeed transport ──────────────────────────────────────────────────

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((evt: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    instances.push(this);
  }
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  triggerMessage(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  triggerClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

let instances: MockWebSocket[] = [];

beforeEach(() => {
  instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.useFakeTimers();
  setHome({ lat: 45, lon: -90, altFt: 1000, name: 'Test Home' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function okFetch(aircraft: RawAircraft[] = []) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ now: Date.now() / 1000, messages: 1, aircraft }),
  });
}

describe('LiveFeed transport', () => {
  it('wsUrl null → polling only, no WebSocket constructed', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const feed = new LiveFeed({ liveUrl: '/data/aircraft.json', wsUrl: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(instances).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalled();
    feed.stop();
  });

  it('connect timeout falls back to HTTP while CONNECTING; onopen hands back to WS with no further fetches', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const feed = new LiveFeed({ liveUrl: '/data/aircraft.json', wsUrl: '/ws/live' });
    feed.start();
    expect(instances).toHaveLength(1);
    // Timeout fires -> falls back to HTTP.
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // WS eventually opens -> hands back, stops HTTP polling.
    instances[0]!.triggerOpen();
    const callsAtOpen = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock.mock.calls.length).toBe(callsAtOpen);
    feed.stop();
  });

  it('snapshot emits normalized records with source ws', async () => {
    const feed = new LiveFeed({ liveUrl: '/data/aircraft.json', wsUrl: '/ws/live' });
    const listener = vi.fn();
    feed.subscribe(listener);
    feed.start();
    instances[0]!.triggerOpen();
    instances[0]!.triggerMessage({
      type: 'snapshot',
      now: 1000,
      aircraft: [{ hex: 'abc123', lat: 45, lon: -90 }],
    });
    expect(listener).toHaveBeenCalled();
    const [records, status] = listener.mock.calls[listener.mock.calls.length - 1]!;
    expect(records).toHaveLength(1);
    expect(records[0].hex).toBe('abc123');
    expect(status.source).toBe('ws');
    feed.stop();
  });

  it('feeder_age_s is cached across heartbeats with no aircraft change', async () => {
    const feed = new LiveFeed({ liveUrl: '/data/aircraft.json', wsUrl: '/ws/live' });
    const listener = vi.fn();
    feed.subscribe(listener);
    feed.start();
    instances[0]!.triggerOpen();
    instances[0]!.triggerMessage({ type: 'snapshot', now: 1000, feeder_age_s: 5, aircraft: [] });
    let last = listener.mock.calls[listener.mock.calls.length - 1]!;
    expect(last[1].feederAgeS).toBe(5);
    // Heartbeat diff with no feeder_age_s field: cached value persists.
    instances[0]!.triggerMessage({ type: 'diff', now: 1001 });
    last = listener.mock.calls[listener.mock.calls.length - 1]!;
    expect(last[1].feederAgeS).toBe(5);
    feed.stop();
  });

  it('onclose falls back to HTTP and schedules a 30s retry that constructs a second WebSocket', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const feed = new LiveFeed({ liveUrl: '/data/aircraft.json', wsUrl: '/ws/live' });
    feed.start();
    instances[0]!.triggerOpen();
    instances[0]!.triggerClose();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalled(); // fell back to HTTP
    await vi.advanceTimersByTimeAsync(30_000);
    expect(instances).toHaveLength(2); // retry constructed a new WS
    feed.stop();
  });

  it('retry no-ops if a WS connection is already established by the time it fires', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const feed = new LiveFeed({ liveUrl: '/data/aircraft.json', wsUrl: '/ws/live' });
    feed.start();
    instances[0]!.triggerOpen();
    instances[0]!.triggerClose();
    await vi.advanceTimersByTimeAsync(0);
    // A fresh connect happens (e.g. via some other path) before the retry timer fires.
    expect(instances).toHaveLength(1);
    instances[0]!.triggerOpen();
    await vi.advanceTimersByTimeAsync(30_000);
    // Retry timer fired but source is already 'ws' -> no second instance created.
    expect(instances).toHaveLength(1);
    feed.stop();
  });

  it('stop() clears timers so no further fetches or WS activity occur', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const feed = new LiveFeed({ liveUrl: '/data/aircraft.json', wsUrl: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    const callsBeforeStop = fetchMock.mock.calls.length;
    feed.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock.mock.calls.length).toBe(callsBeforeStop);
  });

  it('HTTP error emits ok:false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const feed = new LiveFeed({ liveUrl: '/data/aircraft.json', wsUrl: null });
    const listener = vi.fn();
    feed.subscribe(listener);
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    const [, status] = listener.mock.calls[listener.mock.calls.length - 1]!;
    expect(status.ok).toBe(false);
    feed.stop();
  });
});
