// @vitest-environment jsdom
import dataText from '../src/world/runways-data.json?raw';
import { describe, expect, it } from 'vitest';
import { approachPath, decodeRunways, runwayCorners, runwayLengthFt, sitesNear, type Runway } from '../src/world/airports';
import type { Airport } from '../src/feed/explore-airports';

const table = decodeRunways(JSON.parse(dataText));

describe('committed runway data', () => {
  it('decodes thousands of runways', () => {
    let n = 0;
    for (const list of table.values()) n += list.length;
    expect(table.size).toBeGreaterThan(4000);
    expect(n).toBeGreaterThan(6000);
  });

  it('has the four runways at Minneapolis, all lit and paved, about two miles long', () => {
    const msp = table.get('KMSP')!;
    expect(msp.map((r) => `${r.lowIdent}/${r.highIdent}`).sort()).toEqual(['04/22', '12L/30R', '12R/30L', '17/35']);
    for (const r of msp) {
      expect(r.lighted && r.hard).toBe(true);
      expect(runwayLengthFt(r)).toBeGreaterThan(7000);
      expect(runwayLengthFt(r)).toBeLessThan(12000);
    }
  });

  it('drops malformed rows instead of throwing', () => {
    expect(decodeRunways(null).size).toBe(0);
    expect(decodeRunways({ runways: { KXXX: [['a', 'b', 'x', 1, 2, 3, 0, 0, 0, 0, 0], 'junk'] } }).size).toBe(0);
  });
});

// A runway due north, one nautical mile long, on the equator for easy numbers.
const NORTH: Runway = {
  lowIdent: '36', highIdent: '18',
  lowLat: 0, lowLon: 0, highLat: 1 / 60, highLon: 0,
  widthFt: 150, lighted: true, hard: true, lowElevFt: 100, highElevFt: 100,
};

describe('runwayCorners', () => {
  it('makes a rectangle as wide as asked, square to the centreline', () => {
    const c = runwayCorners(NORTH, 0.1);
    // East-west spread at each end is the width, in degrees of longitude.
    expect(Math.abs(c[0]![1] - c[3]![1]) * 60).toBeCloseTo(0.1, 6);
    expect(Math.abs(c[1]![1] - c[2]![1]) * 60).toBeCloseTo(0.1, 6);
    // And the long sides still run the length of the runway.
    expect((c[1]![0] - c[0]![0]) * 60).toBeCloseTo(1, 6);
    expect(c[0]![0]).toBeCloseTo(c[3]![0], 9);
  });
});

describe('approachPath', () => {
  it('comes down three degrees along the extended centreline to the threshold', () => {
    // Landing northbound on 36: the path is south of the low end.
    const path = approachPath(NORTH.lowLat, NORTH.lowLon, NORTH.lowElevFt, NORTH.highLat, NORTH.highLon, 10, 5);
    expect(path).toHaveLength(6);
    const [farLat, farLon, farAlt] = path[0]!;
    expect(farLat * 60).toBeCloseTo(-10, 6);
    expect(farLon).toBeCloseTo(0, 9);
    // 10 NM at 3 degrees is about 3,184 ft above the threshold.
    expect(farAlt - 100).toBeGreaterThan(3150);
    expect(farAlt - 100).toBeLessThan(3220);
    expect(path[5]).toEqual([0, 0, 100]);
    for (let i = 1; i < path.length; i++) expect(path[i]![2]).toBeLessThan(path[i - 1]![2]);
  });
});

describe('sitesNear', () => {
  const airport = (icao: string, lat: number, lon: number): Airport =>
    ({ icao, iata: '', name: icao, city: '', haystack: '', place: { id: icao, name: icao, country: 'US', region: 'airports', lat, lon, altFt: 0 } }) as unknown as Airport;

  it('keeps airports in range that have runway data, in the order given', () => {
    const runways = new Map([['KAAA', [NORTH]], ['KCCC', [NORTH]]]);
    const sites = sitesNear(
      [airport('KAAA', 0, 0), airport('KBBB', 0, 0.1), airport('KCCC', 0, 0.2), airport('KDDD', 0, 9)],
      runways,
      50,
      (_lat, lon) => lon * 60,
    );
    expect(sites.map((s) => s.airport.icao)).toEqual(['KAAA', 'KCCC']);
    expect(sites[1]!.distanceNm).toBeCloseTo(12, 6);
  });
});
