import { afterEach, describe, expect, it, vi } from 'vitest';
import { acarsHistoryUrl, fetchAcarsHistory } from '../src/feed/acars';
import { fmtStamp, historyWindow, toLocalInputValue } from '../src/ui/acars-panel';

const NOW = Date.UTC(2026, 10, 13, 18, 0, 0);
const HOUR = 3_600_000;

describe('historyWindow', () => {
  it('maps a preset to hours back from now', () => {
    expect(historyWindow('6', NOW)).toEqual({ startMs: NOW - 6 * HOUR, endMs: NOW });
  });

  it('rejects a nonsense preset', () => {
    expect(historyWindow('0', NOW)).toBeNull();
    expect(historyWindow('abc', NOW)).toBeNull();
  });

  it('reads a custom range as local datetimes', () => {
    const from = toLocalInputValue(new Date(NOW - 5 * HOUR));
    const to = toLocalInputValue(new Date(NOW - 2 * HOUR));
    expect(historyWindow('custom', NOW, from, to)).toEqual({ startMs: NOW - 5 * HOUR, endMs: NOW - 2 * HOUR });
  });

  it('treats an empty "to" as now', () => {
    const from = toLocalInputValue(new Date(NOW - 5 * HOUR));
    expect(historyWindow('custom', NOW, from, '')).toEqual({ startMs: NOW - 5 * HOUR, endMs: NOW });
  });

  it('rejects a missing start or an inverted range', () => {
    const early = toLocalInputValue(new Date(NOW - 5 * HOUR));
    const late = toLocalInputValue(new Date(NOW - 2 * HOUR));
    expect(historyWindow('custom', NOW, '', late)).toBeNull();
    expect(historyWindow('custom', NOW, late, early)).toBeNull();
    expect(historyWindow('custom', NOW, early, early)).toBeNull();
  });
});

describe('fmtStamp', () => {
  it('shows only the time for today and adds the date otherwise', () => {
    const now = new Date(2026, 10, 13, 18, 0, 0);
    const today = fmtStamp(new Date(2026, 10, 13, 9, 5, 7).toISOString(), now);
    const earlier = fmtStamp(new Date(2026, 10, 11, 9, 5, 7).toISOString(), now);
    expect(today).toContain('09:05:07');
    expect(earlier).toContain('09:05:07');
    expect(earlier.length).toBeGreaterThan(today.length);
    expect(earlier).toContain('11');
  });

  it('is empty for an unparseable time', () => {
    expect(fmtStamp('nope')).toBe('');
  });
});

describe('acarsHistoryUrl', () => {
  it('sends the window as ISO and omits unset filters', () => {
    const url = new URL(acarsHistoryUrl('/acars-api', { startMs: NOW - HOUR, endMs: NOW }), 'http://x');
    expect(url.pathname).toBe('/acars-api/messages/search');
    expect(url.searchParams.get('start')).toBe('2026-11-13T17:00:00.000Z');
    expect(url.searchParams.get('end')).toBe('2026-11-13T18:00:00.000Z');
    expect(url.searchParams.get('limit')).toBe('200');
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('label')).toBe(false);
    expect(url.searchParams.has('before')).toBe(false);
    expect(url.searchParams.has('chatter')).toBe(false);
  });

  it('asks for chatter only when set', () => {
    const url = new URL(acarsHistoryUrl('/acars-api', { startMs: NOW - HOUR, endMs: NOW, chatter: true }), 'http://x');
    expect(url.searchParams.get('chatter')).toBe('true');
  });

  it('encodes search, label and cursor', () => {
    const url = new URL(
      acarsHistoryUrl('/acars-api', {
        startMs: NOW - HOUR,
        endMs: NOW,
        q: ' ground stop & more ',
        label: 'H1',
        before: '2026-11-13T17:30:00+00:00',
        limit: 50,
      }),
      'http://x'
    );
    expect(url.searchParams.get('q')).toBe('ground stop & more');
    expect(url.searchParams.get('label')).toBe('H1');
    expect(url.searchParams.get('before')).toBe('2026-11-13T17:30:00+00:00');
    expect(url.searchParams.get('limit')).toBe('50');
  });
});

describe('fetchAcarsHistory', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(body: unknown, ok = true, status = 200): void {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok, status, json: () => Promise.resolve(body) })));
  }

  it('normalizes messages and carries the cursor while more pages exist', async () => {
    stubFetch({
      has_more: true,
      next_before: '2026-11-13T17:30:00+00:00',
      messages: [
        { time: '2026-11-13T17:45:00+00:00', icao: 'A1B2C3', flight: ' UAL12 ', block_id: '3', chatter: true },
        { flight: 'no-time-is-dropped' },
      ],
    });
    const page = await fetchAcarsHistory('/acars-api', { startMs: NOW - HOUR, endMs: NOW });
    expect(page.nextBefore).toBe('2026-11-13T17:30:00+00:00');
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).toMatchObject({ icao: 'a1b2c3', flight: 'UAL12', blockId: '3', chatter: true });
  });

  it('has no cursor on the last page', async () => {
    stubFetch({ has_more: false, next_before: null, messages: [] });
    const page = await fetchAcarsHistory('/acars-api', { startMs: NOW - HOUR, endMs: NOW });
    expect(page).toEqual({ messages: [], nextBefore: null });
  });

  it('throws on an HTTP error', async () => {
    stubFetch({}, false, 503);
    await expect(fetchAcarsHistory('/acars-api', { startMs: NOW - HOUR, endMs: NOW })).rejects.toThrow('503');
  });
});
