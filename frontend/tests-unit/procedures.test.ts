// @vitest-environment jsdom
import indexText from '../src/world/procedures-index.json?raw';
import { describe, expect, it } from 'vitest';
import { destination, finalPath } from '../src/world/procedure-geometry';
import {
  approachName,
  approachRunway,
  bestFinals,
  daysLeft,
  decodeIndex,
  finalInUse,
  type FinalApproach,
  type TrafficSample,
} from '../src/world/procedures';

const index = decodeIndex(JSON.parse(indexText))!;

describe('committed procedure index', () => {
  it('covers the country and says which edition it is', () => {
    expect(Object.keys(index.airports).length).toBeGreaterThan(2500);
    expect(index.cycle).toMatch(/^\d{4}$/);
    expect(Date.parse(index.expires) - Date.parse(index.effective)).toBe(28 * 86_400_000);
  });

  it('has Minneapolis: 26 approaches, 8 arrivals, 9 departures', () => {
    const msp = index.airports.KMSP!;
    expect([msp.a.length, msp.s.length, msp.d.length]).toEqual([26, 8, 9]);
    expect(msp.a).toContain('I12R');
    expect(msp.s).toContain('BAINY4');
  });

  it('has the ILS 12R final as published: ZESTY, KINNS, the runway', () => {
    const ils = index.airports.KMSP!.f.find((f) => f.id === 'I12R')!;
    expect(ils.rw).toBe('RW12R');
    expect(ils.va).toBe(-3);
    expect(ils.legs.map((l) => `${l[0]} ${l[3]} ${l[4]}`)).toEqual(['ZESTY 4000 I', 'KINNS 3000 F', 'RW12R 892 M']);
    // KINNS is on the extended centreline north-west of the field.
    expect(ils.legs[1]![1]).toBeCloseTo(44.945, 2);
    expect(ils.legs[1]![2]).toBeCloseTo(-93.367, 2);
  });

  it('rejects something that is not an index', () => {
    expect(decodeIndex(null)).toBeNull();
    expect(decodeIndex({ airports: {} })).toBeNull();
  });
});

describe('names', () => {
  it('reads approach identifiers the way a chart titles them', () => {
    expect(approachName('I12R')).toBe('ILS 12R');
    expect(approachName('R30LZ')).toBe('RNAV (GPS) Z 30L');
    expect(approachName('H35-Y')).toBe('RNAV (RNP) Y 35');
    expect(approachName('L04')).toBe('LOC 04');
    expect(approachName('VDM-A')).toBe('VOR-A');
    expect(approachRunway('R30LZ')).toBe('30L');
    expect(approachRunway('H35-Y')).toBe('35');
    expect(approachRunway('VDM-A')).toBe('');
  });
});

describe('bestFinals', () => {
  const f = (id: string, rw: string): FinalApproach => ({ id, rw, va: -3, legs: [] });
  it('keeps one per runway end, best guidance first', () => {
    const picked = bestFinals([f('L12R', 'RW12R'), f('R12RZ', 'RW12R'), f('I12R', 'RW12R'), f('R30LY', 'RW30L'), f('R30LZ', 'RW30L'), f('VDM-A', '')]);
    expect(picked.map((p) => p.id).sort()).toEqual(['I12R', 'R30LZ']);
  });
  it('chooses the ILS on every Minneapolis runway end that has one', () => {
    const picked = bestFinals(index.airports.KMSP!.f);
    expect(picked.filter((p) => p.id.startsWith('I')).map((p) => p.rw).sort()).toEqual(['RW12L', 'RW12R', 'RW30L', 'RW30R', 'RW35']);
  });
});

describe('finalInUse', () => {
  // A final flown due east to a threshold at (45, -93), 800 ft.
  const final = finalPath([
    ['FAF', 45, -93.2, 3000, 'F', '+'],
    ['RW09', 45, -93, 800, 'M', ''],
  ]);
  const at = (bearingFrom: number, nm: number, over: Partial<TrafficSample> = {}): TrafficSample => {
    const [lat, lon] = destination(45, -93, bearingFrom, nm);
    return { lat, lon, altFt: 2500, onGround: false, trackDeg: 90, verticalRateFpm: -700, ...over };
  };

  it('sees an aircraft established on the final', () => {
    expect(finalInUse(final, [at(270, 6)])).toBe(true);
  });
  it('ignores traffic that is not landing on it', () => {
    expect(finalInUse(final, [at(270, 6, { trackDeg: 270 })])).toBe(false); // going the other way
    expect(finalInUse(final, [at(270, 6, { trackDeg: 130 })])).toBe(false); // crossing
    expect(finalInUse(final, [at(250, 6)])).toBe(false); // two miles off the centreline
    expect(finalInUse(final, [at(270, 20)])).toBe(false); // too far out
    expect(finalInUse(final, [at(90, 3)])).toBe(false); // already past the threshold
    expect(finalInUse(final, [at(270, 6, { altFt: 12000 })])).toBe(false); // overflying
    expect(finalInUse(final, [at(270, 6, { verticalRateFpm: 1500 })])).toBe(false); // climbing
    expect(finalInUse(final, [at(270, 6, { onGround: true })])).toBe(false);
    expect(finalInUse(final, [])).toBe(false);
  });
});

describe('daysLeft', () => {
  it('counts down to the day the edition is superseded and goes negative after', () => {
    const edition = { expires: '2026-11-26' };
    expect(daysLeft(edition, Date.UTC(2026, 10, 15, 12))).toBe(10);
    expect(daysLeft(edition, Date.UTC(2026, 10, 27, 12))).toBe(-2);
  });
});
