import { describe, expect, it } from 'vitest';
import { currentLegIndex, normalizeRoute, type RawRouteEntry } from '../src/feed/routes';

const DAL = { iata: 'DAL', icao: 'KDAL', name: 'Dallas Love Field', lat: 32.85, lon: -96.85 };
const PHX = { iata: 'PHX', icao: 'KPHX', name: 'Phoenix Sky Harbor', lat: 33.43, lon: -112.01 };
const LAS = { iata: 'LAS', icao: 'KLAS', name: 'Harry Reid', lat: 36.08, lon: -115.15 };

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
