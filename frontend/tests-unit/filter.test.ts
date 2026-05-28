import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setFilter,
  passesFilter,
  getSearchQuery,
  setSearchQuery,
  subscribeSearchQuery,
} from '../src/core/filter';
import type { Aircraft } from '../src/core/types';

function ac(over: Partial<Aircraft> = {}): Aircraft {
  return {
    hex: 'a1b2c3',
    callsign: null,
    registration: null,
    typeCode: null,
    description: null,
    category: null,
    operator: null,
    lat: 0,
    lon: 0,
    altFt: 10000,
    altFtKnown: true,
    onGround: false,
    groundSpeedKt: null,
    trackDeg: null,
    verticalRateFpm: null,
    military: false,
    specialInterest: false,
    privacyIcao: false,
    ladd: false,
    squawk: null,
    emergency: null,
    apAltMcpFt: null,
    apAltFmsFt: null,
    apHeadingDeg: null,
    apQnhHpa: null,
    apModes: null,
    lastSeenMs: 1_000,
    lastUpdateMs: 1_000,
    ...over,
  };
}

// The filter module is a process-wide singleton. Reset both slots between
// tests so order doesn't leak state between them.
beforeEach(() => {
  setFilter('all');
  setSearchQuery('');
});
afterEach(() => {
  setFilter('all');
  setSearchQuery('');
});

describe('passesFilter (status only)', () => {
  it('all accepts every aircraft', () => {
    setFilter('all');
    expect(passesFilter(ac({ onGround: true }))).toBe(true);
    expect(passesFilter(ac({ military: true }))).toBe(true);
  });

  it('air rejects ground aircraft', () => {
    setFilter('air');
    expect(passesFilter(ac({ onGround: false }))).toBe(true);
    expect(passesFilter(ac({ onGround: true }))).toBe(false);
  });

  it('ground rejects airborne aircraft', () => {
    setFilter('ground');
    expect(passesFilter(ac({ onGround: true }))).toBe(true);
    expect(passesFilter(ac({ onGround: false }))).toBe(false);
  });

  it('mil only accepts military aircraft', () => {
    setFilter('mil');
    expect(passesFilter(ac({ military: true }))).toBe(true);
    expect(passesFilter(ac({ military: false }))).toBe(false);
  });

  it('emerg only accepts aircraft with an emergency string', () => {
    setFilter('emerg');
    expect(passesFilter(ac({ emergency: 'squawk 7700' }))).toBe(true);
    expect(passesFilter(ac({ emergency: null }))).toBe(false);
  });
});

describe('search query', () => {
  it('empty query passes everything that passes the status key', () => {
    setSearchQuery('');
    expect(passesFilter(ac({ callsign: 'AAL123' }))).toBe(true);
    expect(passesFilter(ac({ callsign: null, registration: null }))).toBe(true);
  });

  it('whitespace-only query is treated as empty', () => {
    setSearchQuery('   ');
    expect(getSearchQuery()).toBe('');
    expect(passesFilter(ac({ callsign: 'AAL123' }))).toBe(true);
  });

  it('matches uppercase ASCII callsign with lowercase user input', () => {
    setSearchQuery('aal');
    expect(passesFilter(ac({ callsign: 'AAL123' }))).toBe(true);
    expect(passesFilter(ac({ callsign: 'UAL456' }))).toBe(false);
  });

  it('matches uppercase ASCII callsign with uppercase user input', () => {
    setSearchQuery('AAL');
    expect(passesFilter(ac({ callsign: 'AAL123' }))).toBe(true);
  });

  it('matches mixed-case haystack via dual-case query probe', () => {
    setSearchQuery('123');
    expect(passesFilter(ac({ callsign: 'aaL123' }))).toBe(true);
  });

  it('matches registration', () => {
    setSearchQuery('N12');
    expect(passesFilter(ac({ registration: 'N12345' }))).toBe(true);
    expect(passesFilter(ac({ registration: 'G-ABCD' }))).toBe(false);
  });

  it('matches normalized lowercase hex with lowercase user input', () => {
    setSearchQuery('a1b');
    expect(passesFilter(ac({ hex: 'a1b2c3' }))).toBe(true);
    expect(passesFilter(ac({ hex: 'def456' }))).toBe(false);
  });

  it('matches lowercase hex even when user types uppercase', () => {
    setSearchQuery('A1B');
    expect(passesFilter(ac({ hex: 'a1b2c3' }))).toBe(true);
  });

  it('combines with status filter: must pass both', () => {
    setFilter('air');
    setSearchQuery('AAL');
    expect(passesFilter(ac({ callsign: 'AAL123', onGround: false }))).toBe(true);
    // status-only fail: matching callsign but on the ground.
    expect(passesFilter(ac({ callsign: 'AAL123', onGround: true }))).toBe(false);
    // search-only fail: in the air but the callsign doesn't match.
    expect(passesFilter(ac({ callsign: 'UAL456', onGround: false }))).toBe(false);
  });

  it('no callsign or registration falls through to hex check', () => {
    setSearchQuery('a1b');
    expect(passesFilter(ac({ callsign: null, registration: null, hex: 'a1b2c3' }))).toBe(true);
  });

  it('aircraft with only registration still matches on registration', () => {
    setSearchQuery('N12');
    expect(passesFilter(ac({ callsign: null, registration: 'N12345' }))).toBe(true);
  });
});

describe('setSearchQuery / subscribeSearchQuery', () => {
  it('persists the trimmed value via getSearchQuery', () => {
    setSearchQuery('  AAL  ');
    expect(getSearchQuery()).toBe('AAL');
  });

  it('subscriber fires on real change', () => {
    const spy = vi.fn();
    const unsub = subscribeSearchQuery(spy);
    setSearchQuery('AAL');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith('AAL');
    unsub();
  });

  it('subscriber does not fire when set to the same trimmed value', () => {
    const spy = vi.fn();
    const unsub = subscribeSearchQuery(spy);
    setSearchQuery('AAL');
    setSearchQuery('  AAL  ');
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('unsubscribe stops further notifications', () => {
    const spy = vi.fn();
    const unsub = subscribeSearchQuery(spy);
    unsub();
    setSearchQuery('AAL');
    expect(spy).not.toHaveBeenCalled();
  });
});
