import { describe, expect, it } from 'vitest';
import { alertFor, flightName, matchesWatch, parseWatchlist, scanAlerts, type AlertKind } from '../src/core/alerts';
import type { Aircraft } from '../src/core/types';

function ac(hex: string, over: Partial<Aircraft> = {}): Aircraft {
  return { hex, emergency: null, callsign: null, registration: null, squawk: null, military: false, ...over } as unknown as Aircraft;
}
const NONE = { military: false, watch: [] as string[] };
const snap = (...list: Aircraft[]): Map<string, Aircraft> => new Map(list.map((a) => [a.hex, a]));

describe('parseWatchlist / matchesWatch', () => {
  it('splits on commas and spaces, ignores case and dashes, keeps a trailing star', () => {
    expect(parseWatchlist(' n123ab, rch* ;G-ABCD  a1b2c3 x')).toEqual(['N123AB', 'RCH*', 'GABCD', 'A1B2C3']);
  });

  it('matches callsign, registration or hex exactly, or by prefix with a star', () => {
    const w = parseWatchlist('N123AB, RCH*, a1b2c3');
    expect(matchesWatch(ac('ffffff', { registration: 'N123AB' }), w)).toBe(true);
    expect(matchesWatch(ac('ffffff', { callsign: 'RCH871' }), w)).toBe(true);
    expect(matchesWatch(ac('a1b2c3'), w)).toBe(true);
    expect(matchesWatch(ac('ffffff', { callsign: 'N123ABC' }), w)).toBe(false);
    expect(matchesWatch(ac('ffffff', { callsign: 'UAL1' }), [])).toBe(false);
  });
});

describe('alertFor', () => {
  it('ranks emergency over a notable squawk over the watchlist over military', () => {
    const rules = { military: true, watch: ['UAL1'] };
    const all = { callsign: 'UAL1', military: true };
    expect(alertFor(ac('a', { ...all, emergency: 'emergency (7700)', squawk: '7700' }), rules)?.kind).toBe('emergency');
    expect(alertFor(ac('a', { ...all, squawk: '7400' }), rules)).toEqual({ kind: 'squawk', detail: 'unmanned, lost link (7400)' });
    expect(alertFor(ac('a', all), rules)?.kind).toBe('watch');
    expect(alertFor(ac('a', { military: true }), rules)?.kind).toBe('military');
    expect(alertFor(ac('a', { military: true }), NONE)).toBeNull();
  });
});

describe('scanAlerts', () => {
  it('fires once per episode and re-arms after the state clears', () => {
    const on = snap(ac('a', { emergency: 'emergency (7700)', callsign: 'DAL1' }), ac('b'));
    const r1 = scanAlerts(on, new Map(), NONE, false);
    expect(r1.fired.map((f) => f.aircraft.hex)).toEqual(['a']);
    expect(scanAlerts(on, r1.active, NONE, false).fired).toEqual([]);
    const r3 = scanAlerts(snap(ac('a')), r1.active, NONE, false);
    expect(r3.active.size).toBe(0);
    expect(scanAlerts(on, r3.active, NONE, false).fired.map((f) => f.aircraft.hex)).toEqual(['a']);
  });

  it('fires again when an aircraft becomes something more urgent, not less', () => {
    const rules = { military: true, watch: [] };
    const mil = new Map<string, AlertKind>([['a', 'military']]);
    const up = scanAlerts(snap(ac('a', { military: true, emergency: 'no radio (7600)' })), mil, rules, false);
    expect(up.fired.map((f) => f.kind)).toEqual(['emergency']);
    const down = scanAlerts(snap(ac('a', { military: true })), up.active, rules, false);
    expect(down.fired).toEqual([]);
    expect(down.active.get('a')).toBe('military');
  });

  it('a first look announces emergencies but not what was already on the scope', () => {
    const rules = { military: true, watch: ['UAL1'] };
    const first = snap(ac('m', { military: true }), ac('w', { callsign: 'UAL1' }), ac('e', { emergency: 'hijack (7500)' }));
    const r = scanAlerts(first, new Map(), rules, true);
    expect(r.fired.map((f) => f.aircraft.hex)).toEqual(['e']);
    expect([...r.active.keys()].sort()).toEqual(['e', 'm', 'w']);
    // One that arrives afterwards does fire.
    const next = new Map(first).set('n', ac('n', { military: true }));
    expect(scanAlerts(next, r.active, rules, false).fired.map((f) => f.aircraft.hex)).toEqual(['n']);
  });
});

describe('flightName', () => {
  it('prefers callsign, then registration, then hex', () => {
    expect(flightName(ac('abc123', { callsign: 'UAL5' }))).toBe('UAL5');
    expect(flightName(ac('abc123', { registration: 'N123' }))).toBe('N123');
    expect(flightName(ac('abc123'))).toBe('ABC123');
  });
});
