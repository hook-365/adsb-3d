// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readSelectedHex, readTimeState, writeSelectedHex, writeTimeState } from '../src/core/url-state';
import type { TimeContext } from '../src/core/time-context';

function setUrl(url: string): void {
  window.history.replaceState(null, '', url);
}

beforeEach(() => {
  setUrl('http://localhost:3000/');
});

describe('readSelectedHex', () => {
  it('reads a valid 6-hex hash', () => {
    setUrl('http://localhost:3000/#abc123');
    expect(readSelectedHex()).toBe('abc123');
  });

  it('rejects an invalid hex', () => {
    setUrl('http://localhost:3000/#not-a-hex');
    expect(readSelectedHex()).toBeNull();
    setUrl('http://localhost:3000/#abc12'); // too short
    expect(readSelectedHex()).toBeNull();
  });

  it('returns null with no hash', () => {
    expect(readSelectedHex()).toBeNull();
  });
});

describe('writeSelectedHex', () => {
  it('clears the hash when passed null', () => {
    setUrl('http://localhost:3000/foo#abc123');
    writeSelectedHex(null);
    expect(window.location.hash).toBe('');
  });

  it('round-trips a hex through write then read', () => {
    writeSelectedHex('def456');
    expect(readSelectedHex()).toBe('def456');
  });
});

describe('readTimeState', () => {
  it('returns null without mode=historical', () => {
    setUrl('http://localhost:3000/?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z');
    expect(readTimeState()).toBeNull();
  });

  it('returns null with missing from/to', () => {
    setUrl('http://localhost:3000/?mode=historical&from=2026-01-01T00:00:00Z');
    expect(readTimeState()).toBeNull();
  });

  it('returns null with unparseable from/to', () => {
    setUrl('http://localhost:3000/?mode=historical&from=not-a-date&to=2026-01-02T00:00:00Z');
    expect(readTimeState()).toBeNull();
  });

  it('returns null when to <= from (inverted window)', () => {
    setUrl('http://localhost:3000/?mode=historical&from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z');
    expect(readTimeState()).toBeNull();
  });

  it('drops a cursor outside the window', () => {
    setUrl(
      'http://localhost:3000/?mode=historical&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z&t=2026-01-03T00:00:00Z'
    );
    const s = readTimeState()!;
    expect(s.cursorMs).toBeNull();
  });

  it('defaults an invalid rate to 1', () => {
    setUrl(
      'http://localhost:3000/?mode=historical&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z&rate=7'
    );
    expect(readTimeState()!.rate).toBe(1);
  });

  it('accepts valid rates', () => {
    for (const rate of [1, 4, 16, 60]) {
      setUrl(
        `http://localhost:3000/?mode=historical&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z&rate=${rate}`
      );
      expect(readTimeState()!.rate).toBe(rate);
    }
  });
});

describe('writeTimeState', () => {
  it('round-trips a historical context', () => {
    const ctx: TimeContext = {
      mode: 'historical',
      window: { startMs: Date.parse('2026-01-01T00:00:00Z'), endMs: Date.parse('2026-01-02T00:00:00Z') },
      cursorMs: Date.parse('2026-01-01T12:00:00Z'),
      playing: false,
      rate: 4,
      heatmap: false,
    };
    writeTimeState(ctx);
    const s = readTimeState()!;
    expect(s.window).toEqual(ctx.window);
    expect(s.cursorMs).toBe(ctx.cursorMs);
    expect(s.rate).toBe(4);
  });

  it('deletes historical params for a live context', () => {
    setUrl(
      'http://localhost:3000/?mode=historical&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z&t=2026-01-01T12:00:00Z&rate=4'
    );
    writeTimeState({ mode: 'live', window: null, cursorMs: null, playing: false, rate: 1, heatmap: false });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('mode')).toBeNull();
    expect(params.get('from')).toBeNull();
    expect(params.get('to')).toBeNull();
    expect(params.get('t')).toBeNull();
    expect(params.get('rate')).toBeNull();
  });

  it('omits rate=1 from the URL', () => {
    writeTimeState({
      mode: 'historical',
      window: { startMs: 0, endMs: 1000 },
      cursorMs: 500,
      playing: false,
      rate: 1,
      heatmap: false,
    });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('rate')).toBeNull();
  });

  it('preserves unrelated query params', () => {
    setUrl('http://localhost:3000/?feed=local&other=x');
    writeTimeState({
      mode: 'historical',
      window: { startMs: 0, endMs: 1000 },
      cursorMs: 500,
      playing: false,
      rate: 1,
      heatmap: false,
    });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('feed')).toBe('local');
    expect(params.get('other')).toBe('x');
  });

  it('preserves the hash', () => {
    setUrl('http://localhost:3000/#abc123');
    writeTimeState({
      mode: 'historical',
      window: { startMs: 0, endMs: 1000 },
      cursorMs: 500,
      playing: false,
      rate: 1,
      heatmap: false,
    });
    expect(window.location.hash).toBe('#abc123');
  });
});
