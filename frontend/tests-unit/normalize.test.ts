// @vitest-environment jsdom
// The import chain (normalize.ts -> core/config -> feed/feeds) touches
// `window` at module load, so this suite needs jsdom. Pin HOME to a known
// location so distance-from-home math is predictable.
import { beforeAll, describe, expect, it } from 'vitest';
import { deriveEmergency, normalizeRawAircraft } from '../src/feed/normalize';
import { setHome } from '../src/core/config';
import type { RawAircraft } from '../src/core/types';

beforeAll(() => {
  setHome({ lat: 45, lon: -90, altFt: 1000, name: 'Test Home' });
});

function raw(over: Partial<RawAircraft> = {}): RawAircraft {
  return {
    hex: 'ABC123',
    lat: 45,
    lon: -90,
    ...over,
  };
}

describe('normalizeRawAircraft drop rules', () => {
  it('drops when lat is missing', () => {
    const r = raw();
    delete (r as Partial<RawAircraft>).lat;
    expect(normalizeRawAircraft(r, 0)).toBeNull();
  });

  it('drops when lon is missing', () => {
    const r = raw();
    delete (r as Partial<RawAircraft>).lon;
    expect(normalizeRawAircraft(r, 0)).toBeNull();
  });

  it('drops NaN lat/lon', () => {
    expect(normalizeRawAircraft(raw({ lat: NaN }), 0)).toBeNull();
    expect(normalizeRawAircraft(raw({ lon: NaN }), 0)).toBeNull();
  });

  it('drops aircraft outside RANGE_NM of home', () => {
    // ~1 degree of latitude ≈ 60nm; 10 degrees ≈ 600nm, well past 250nm.
    expect(normalizeRawAircraft(raw({ lat: 55 }), 0)).toBeNull();
  });

  it('keeps aircraft within range', () => {
    expect(normalizeRawAircraft(raw({ lat: 45.1, lon: -90.1 }), 0)).not.toBeNull();
  });
});

describe('normalizeRawAircraft altitude ladder', () => {
  it("alt_baro === 'ground' sets onGround and altFt 0", () => {
    const a = normalizeRawAircraft(raw({ alt_baro: 'ground' }), 0)!;
    expect(a.onGround).toBe(true);
    expect(a.altFt).toBe(0);
    expect(a.altFtKnown).toBe(true);
  });

  it('numeric alt_baro wins over alt_geom', () => {
    const a = normalizeRawAircraft(raw({ alt_baro: 10000, alt_geom: 10500 }), 0)!;
    expect(a.altFt).toBe(10000);
    expect(a.altFtKnown).toBe(true);
  });

  it('falls back to alt_geom when alt_baro is absent', () => {
    const a = normalizeRawAircraft(raw({ alt_geom: 12000 }), 0)!;
    expect(a.altFt).toBe(12000);
    expect(a.altFtKnown).toBe(true);
  });

  it('neither field present leaves altFtKnown false at altFt 0', () => {
    const a = normalizeRawAircraft(raw(), 0)!;
    expect(a.altFtKnown).toBe(false);
    expect(a.altFt).toBe(0);
  });
});

describe('normalizeRawAircraft seen/lastSeenMs', () => {
  it('prefers seen_pos over seen', () => {
    const a = normalizeRawAircraft(raw({ seen: 100, seen_pos: 5 }), 10_000)!;
    expect(a.lastSeenMs).toBe(10_000 - 5000);
  });

  it('falls back to seen when seen_pos is absent', () => {
    const a = normalizeRawAircraft(raw({ seen: 7 }), 10_000)!;
    expect(a.lastSeenMs).toBe(10_000 - 7000);
  });

  it('defaults to 0 seconds when neither is present', () => {
    const a = normalizeRawAircraft(raw(), 10_000)!;
    expect(a.lastSeenMs).toBe(10_000);
  });
});

describe('normalizeRawAircraft dbFlags', () => {
  it('decodes each individual bit', () => {
    expect(normalizeRawAircraft(raw({ dbFlags: 1 }), 0)!.military).toBe(true);
    expect(normalizeRawAircraft(raw({ dbFlags: 2 }), 0)!.specialInterest).toBe(true);
    expect(normalizeRawAircraft(raw({ dbFlags: 4 }), 0)!.privacyIcao).toBe(true);
    expect(normalizeRawAircraft(raw({ dbFlags: 8 }), 0)!.ladd).toBe(true);
  });

  it('decodes all bits combined (15)', () => {
    const a = normalizeRawAircraft(raw({ dbFlags: 15 }), 0)!;
    expect(a.military).toBe(true);
    expect(a.specialInterest).toBe(true);
    expect(a.privacyIcao).toBe(true);
    expect(a.ladd).toBe(true);
  });

  it('defaults to false when dbFlags is absent', () => {
    const a = normalizeRawAircraft(raw(), 0)!;
    expect(a.military).toBe(false);
    expect(a.specialInterest).toBe(false);
    expect(a.privacyIcao).toBe(false);
    expect(a.ladd).toBe(false);
  });
});

describe('normalizeRawAircraft string fields', () => {
  it('whitespace-only flight becomes null', () => {
    const a = normalizeRawAircraft(raw({ flight: '   ' }), 0)!;
    expect(a.callsign).toBeNull();
  });

  it('trims a valid flight', () => {
    const a = normalizeRawAircraft(raw({ flight: ' UAL123 ' }), 0)!;
    expect(a.callsign).toBe('UAL123');
  });

  it('lowercases hex', () => {
    const a = normalizeRawAircraft(raw({ hex: 'ABC123' }), 0)!;
    expect(a.hex).toBe('abc123');
  });
});

describe('deriveEmergency', () => {
  it('maps 7500/7600/7700 squawks regardless of the emergency field', () => {
    expect(deriveEmergency('7500', undefined)).toBe('hijack (7500)');
    expect(deriveEmergency('7600', undefined)).toBe('no radio (7600)');
    expect(deriveEmergency('7700', undefined)).toBe('emergency (7700)');
  });

  it('squawk wins over a differing emergency field', () => {
    expect(deriveEmergency('7700', 'none')).toBe('emergency (7700)');
  });

  it("'none' emergency field with no matching squawk yields null", () => {
    expect(deriveEmergency('1200', 'none')).toBeNull();
    expect(deriveEmergency(null, 'none')).toBeNull();
  });

  it('passes through a non-none emergency field when squawk does not match', () => {
    expect(deriveEmergency('1200', 'general')).toBe('general');
    expect(deriveEmergency(null, 'lifeguard')).toBe('lifeguard');
  });

  it('returns null when neither squawk nor emergency field is set', () => {
    expect(deriveEmergency(null, undefined)).toBeNull();
  });
});
