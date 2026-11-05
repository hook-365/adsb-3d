import { describe, expect, it } from 'vitest';
import { newEmergencies, flightName } from '../src/ui/emergency-toast';
import type { Aircraft } from '../src/core/types';

function ac(hex: string, emergency: string | null, callsign: string | null = null): Aircraft {
  return { hex, emergency, callsign, registration: null, squawk: emergency ? '7700' : null } as unknown as Aircraft;
}

describe('newEmergencies', () => {
  it('fires once per episode and re-arms after the state clears', () => {
    const snap1 = new Map([['a', ac('a', 'emergency (7700)', 'DAL1')], ['b', ac('b', null)]]);
    const r1 = newEmergencies(snap1, new Set());
    expect(r1.fired.map((a) => a.hex)).toEqual(['a']);
    // Still squawking: nothing new.
    const r2 = newEmergencies(snap1, r1.active);
    expect(r2.fired).toEqual([]);
    // Cleared, then squawking again: fires again.
    const r3 = newEmergencies(new Map([['a', ac('a', null)]]), r2.active);
    expect(r3.active.size).toBe(0);
    const r4 = newEmergencies(snap1, r3.active);
    expect(r4.fired.map((a) => a.hex)).toEqual(['a']);
  });
});

describe('flightName', () => {
  it('prefers callsign, then registration, then hex', () => {
    expect(flightName(ac('abc123', null, 'UAL5'))).toBe('UAL5');
    expect(flightName({ ...ac('abc123', null), registration: 'N123' } as Aircraft)).toBe('N123');
    expect(flightName(ac('abc123', null))).toBe('ABC123');
  });
});
