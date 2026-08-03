import { describe, expect, it } from 'vitest';
import {
  ACARS_STALE_THRESHOLD_S,
  FEEDER_STALE_THRESHOLD_S,
  classifyAcars,
  classifyLive,
  getHealth,
  setFeedHealth,
  subscribeHealth,
} from '../src/core/health';

describe('classifyLive', () => {
  it('reports down when the transport has failed', () => {
    expect(classifyLive({ ok: false })).toBe('down');
    expect(classifyLive({ ok: false, feederAgeS: 2 })).toBe('down');
  });

  it('reports ok for a fresh feeder', () => {
    expect(classifyLive({ ok: true, feederAgeS: 0 })).toBe('ok');
    expect(classifyLive({ ok: true, feederAgeS: FEEDER_STALE_THRESHOLD_S })).toBe('ok');
  });

  it('reports stale beyond the feeder threshold', () => {
    expect(classifyLive({ ok: true, feederAgeS: FEEDER_STALE_THRESHOLD_S + 1 })).toBe('stale');
  });

  it('reports stale when the server has never fetched its feeder', () => {
    expect(classifyLive({ ok: true, feederAgeS: null })).toBe('stale');
  });

  it('reports ok on the HTTP path where feeder age is absent', () => {
    // HTTP fallback fails fast on a dead feeder, so absence means fresh.
    expect(classifyLive({ ok: true })).toBe('ok');
  });
});

describe('classifyAcars', () => {
  const base = { transportOk: true, hubConnected: true, hubAgeS: 5 };

  it('reports down without a status or transport', () => {
    expect(classifyAcars(null)).toBe('down');
    expect(classifyAcars({ ...base, transportOk: false })).toBe('down');
  });

  it('reports stale when the hub is disconnected or silent', () => {
    expect(classifyAcars({ ...base, hubConnected: false })).toBe('stale');
    expect(classifyAcars({ ...base, hubAgeS: null })).toBe('stale');
    expect(classifyAcars({ ...base, hubAgeS: ACARS_STALE_THRESHOLD_S + 1 })).toBe('stale');
  });

  it('reports ok for a recent message', () => {
    expect(classifyAcars(base)).toBe('ok');
    expect(classifyAcars({ ...base, hubAgeS: ACARS_STALE_THRESHOLD_S })).toBe('ok');
  });
});

describe('health singleton', () => {
  it('emits current state on subscribe and on change', () => {
    const seen: string[] = [];
    const unsub = subscribeHealth((h) => seen.push(h.feed.state));
    setFeedHealth({ mode: 'live', state: 'ok', feederAgeS: 1 });
    unsub();
    setFeedHealth({ mode: 'live', state: 'down', feederAgeS: null });
    expect(seen.length).toBe(2);
    expect(seen[1]).toBe('ok');
    expect(getHealth().feed.state).toBe('down');
  });
});
