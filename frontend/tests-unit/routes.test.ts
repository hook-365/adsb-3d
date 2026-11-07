import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachRouteBatchPrefetcher,
  clearRouteCache,
  currentLegIndex,
  ensureRoute,
  isAirlineCallsign,
  isRoutePrefetchActive,
  normalizeRoute,
  type RawRouteEntry,
} from '../src/feed/routes';
import { AircraftStore } from '../src/aircraft/store';

const DAL = { iata: 'DAL', icao: 'KDAL', name: 'Dallas Love Field', lat: 32.85, lon: -96.85 };
const PHX = { iata: 'PHX', icao: 'KPHX', name: 'Phoenix Sky Harbor', lat: 33.43, lon: -112.01 };
const LAS = { iata: 'LAS', icao: 'KLAS', name: 'Harry Reid', lat: 36.08, lon: -115.15 };

describe('isAirlineCallsign', () => {
  it('accepts airline code plus flight number', () => {
    for (const cs of ['UAL1', 'SWA1234', 'BAW12AB', 'dal2', ' AAL100 ']) {
      expect(isAirlineCallsign(cs)).toBe(true);
    }
  });

  it('rejects registrations and other non-flight-number callsigns', () => {
    // N484EM is #15's example: adsb.im had an old MSP-EWR trip on file.
    for (const cs of ['N484EM', 'N12345', 'GABCD', 'CFABC', 'DEABC', '']) {
      expect(isAirlineCallsign(cs)).toBe(false);
    }
  });
});

describe('currentLegIndex', () => {
  it('picks the leg the position sits on', () => {
    // Between DAL and PHX.
    expect(currentLegIndex([DAL, PHX, LAS], 33.1, -104)).toBe(0);
    // Between PHX and LAS.
    expect(currentLegIndex([DAL, PHX, LAS], 34.8, -113.6)).toBe(1);
  });

  it('skips legs without coordinates and falls back to the first', () => {
    const noCoords = { iata: 'XXX' };
    expect(currentLegIndex([noCoords, PHX, LAS], 34.8, -113.6)).toBe(1);
    expect(currentLegIndex([noCoords, { iata: 'YYY' }], 0, 0)).toBe(0);
  });
});

describe('normalizeRoute', () => {
  it('returns null for unknown routes', () => {
    expect(normalizeRoute({ callsign: 'ZZZ1', _airports: [] }, 0, 0)).toBeNull();
    expect(normalizeRoute(undefined, 0, 0)).toBeNull();
  });

  it('keeps the plausible flag and names for a single leg', () => {
    const entry: RawRouteEntry = { callsign: 'UAL1', _airports: [DAL, PHX], plausible: true };
    expect(normalizeRoute(entry, 33.1, -104)).toEqual({
      origin: 'DAL',
      destination: 'PHX',
      origin_name: 'Dallas Love Field',
      destination_name: 'Phoenix Sky Harbor',
      plausible: true,
    });
  });

  it('treats a missing or falsy plausible flag as doubtful', () => {
    expect(normalizeRoute({ _airports: [DAL, PHX] }, 33.1, -104)?.plausible).toBe(false);
    expect(normalizeRoute({ _airports: [DAL, PHX], plausible: 0 }, 33.1, -104)?.plausible).toBe(false);
  });

  it('shows the current leg of a multi-stop flight and lists every stop', () => {
    const route = normalizeRoute({ _airports: [DAL, PHX, LAS], plausible: true }, 34.8, -113.6);
    expect(route?.origin).toBe('PHX');
    expect(route?.destination).toBe('LAS');
    expect(route?.stops).toEqual(['DAL', 'PHX', 'LAS']);
  });

  it('falls back to ICAO when an airport has no IATA code', () => {
    const route = normalizeRoute({ _airports: [{ icao: 'KXYZ' }, PHX], plausible: true }, 33, -110);
    expect(route?.origin).toBe('KXYZ');
  });
});


describe('on-demand lookups (no prefetcher)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearRouteCache();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function postMock(entries: RawRouteEntry[] = []) {
    return vi.fn().mockResolvedValue({ ok: true, json: async () => entries });
  }

  it('batches selections into one priority POST after the short window', async () => {
    const fetchMock = postMock([
      { callsign: 'DAL451', _airports: [DAL, PHX], plausible: true },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    expect(isRoutePrefetchActive()).toBe(false);
    const a = ensureRoute({ callsign: 'DAL451', lat: 33, lon: -100 });
    const b = ensureRoute({ callsign: 'SWA123', lat: 33, lon: -100 });
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.priority).toBe(true);
    expect(body.planes.map((p: { callsign: string }) => p.callsign)).toEqual(['DAL451', 'SWA123']);
    expect((await a)?.origin).toBe('DAL');
    expect(await b).toBeNull();
    // Cached now: no second request.
    await ensureRoute({ callsign: 'DAL451', lat: 33, lon: -100 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('with a prefetcher attached, selection sends nothing of its own', async () => {
    const fetchMock = postMock();
    vi.stubGlobal('fetch', fetchMock);
    const store = new AircraftStore();
    const detach = attachRouteBatchPrefetcher(store);
    expect(isRoutePrefetchActive()).toBe(true);
    void ensureRoute({ callsign: 'DAL451', lat: 33, lon: -100 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled();
    detach();
    expect(isRoutePrefetchActive()).toBe(false);
  });
});
