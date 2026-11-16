// @vitest-environment jsdom
import indexText from '../src/world/procedures-index.json?raw';
import { describe, expect, it } from 'vitest';
import type { TrailPoint } from '../src/aircraft/store';
import type { Aircraft } from '../src/core/types';
import type { Airport } from '../src/feed/explore-airports';
import {
  inProcedureCoverage,
  inferActivity,
  matchFinal,
  matchProcedure,
  nearestAirport,
  runwayUnder,
  trailTurnDeg,
  type ActivityContext,
  type ProcedureCandidate,
} from '../src/world/activity';
import type { Runway } from '../src/world/airports';
import { destination } from '../src/world/procedure-geometry';
import { decodeIndex } from '../src/world/procedures';

const index = decodeIndex(JSON.parse(indexText))!;

const plane = (over: Partial<Aircraft>): Aircraft =>
  ({
    hex: 'abc123',
    callsign: 'TST1',
    lat: 45,
    lon: -93,
    altFt: 5000,
    onGround: false,
    groundSpeedKt: 200,
    trackDeg: 90,
    verticalRateFpm: 0,
    ...over,
  }) as Aircraft;

const airport = (icao: string, lat: number, lon: number): Airport =>
  ({ icao, iata: '', name: icao, city: '', haystack: '', place: { lat, lon, altFt: 900 } }) as unknown as Airport;

// An east-west runway, 09 at the west end.
const runway: Runway = {
  lowIdent: '09',
  highIdent: '27',
  lowLat: 45,
  lowLon: -93.02,
  highLat: 45,
  highLon: -92.98,
  widthFt: 150,
  lighted: true,
  hard: true,
  lowElevFt: 900,
  highElevFt: 900,
};

const ctx = (over: Partial<ActivityContext> = {}): ActivityContext => ({
  nowMs: 1_000_000,
  trail: [],
  route: null,
  airports: [airport('KTST', 45, -93)],
  runwaysOf: () => [runway],
  index: null,
  candidates: [],
  ...over,
});

describe('ground', () => {
  it('finds the nearest airport inside the limit only', () => {
    const list = [airport('KFAR', 46, -93), airport('KNEAR', 45.01, -93)];
    expect(nearestAirport(45, -93, list, 4)?.airport.icao).toBe('KNEAR');
    expect(nearestAirport(40, -93, list, 4)).toBeNull();
  });
  it('names the runway end by the direction of the roll', () => {
    expect(runwayUnder(45, -93, 90, [runway])).toBe('09');
    expect(runwayUnder(45, -93, 270, [runway])).toBe('27');
    expect(runwayUnder(45.01, -93, 90, [runway])).toBeNull();
  });
  it('tells parked, taxiing and rolling apart', () => {
    expect(inferActivity(plane({ onGround: true, groundSpeedKt: 0 }), ctx())).toEqual({ kind: 'parked', icao: 'KTST' });
    expect(inferActivity(plane({ onGround: true, groundSpeedKt: 14, lat: 45.005 }), ctx())).toEqual({ kind: 'taxi', icao: 'KTST' });
    expect(inferActivity(plane({ onGround: true, groundSpeedKt: 120 }), ctx())).toEqual({ kind: 'runway', icao: 'KTST', runway: '09' });
  });
  it('still answers away from any airport', () => {
    expect(inferActivity(plane({ onGround: true, groundSpeedKt: 0 }), ctx({ airports: null }))).toEqual({ kind: 'parked', icao: null });
  });
});

describe('final', () => {
  const ils = index.airports.KMSP!.f.find((f) => f.id === 'I12R')!;
  const [, kLat, kLon] = ils.legs[1]!; // KINNS, on the 12R centreline
  it('puts an aircraft at KINNS on final for 12R, not the parallel 12L', () => {
    const [, tLat, tLon] = ils.legs[2]!;
    const dLat = tLat - kLat;
    const dLon = (tLon - kLon) * Math.cos((kLat * Math.PI) / 180);
    const track = ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
    const a = plane({ lat: kLat, lon: kLon, altFt: 3000, trackDeg: track, verticalRateFpm: -700 });
    const fit = matchFinal(a, index)!;
    expect(fit.icao).toBe('KMSP');
    expect(fit.runway).toBe('12R');
    expect(fit.nm).toBeGreaterThan(4);
    expect(inferActivity(a, ctx({ index })).kind).toBe('final');
  });
  it('ignores an aircraft crossing the final', () => {
    expect(matchFinal(plane({ lat: kLat, lon: kLon, altFt: 3000, trackDeg: 30, verticalRateFpm: -700 }), index)).toBeNull();
  });
});

describe('procedures', () => {
  const at = (lat: number, lon: number): { lat: number; lon: number; altFt: null } => ({ lat, lon, altFt: null });
  // Two arrivals that share their last leg (B to C) and differ before it.
  const fixes = [
    { name: 'BRAVO', lat: 45, lon: -94, altFt: null, limit: '', role: '' },
    { name: 'CHARL', lat: 45, lon: -93.5, altFt: null, limit: '', role: '' },
  ];
  const north: ProcedureCandidate = { kind: 'star', icao: 'KTST', id: 'NORTH1', fixes, paths: [[at(45.5, -94.5), at(45, -94), at(45, -93.5)]] };
  const south: ProcedureCandidate = { kind: 'star', icao: 'KTST', id: 'SOUTH1', fixes, paths: [[at(44.5, -94.5), at(45, -94), at(45, -93.5)]] };
  const now = 1_000_000;

  it('matches a track along a leg and names the next fix', () => {
    const hit = matchProcedure(plane({ lat: 45.002, lon: -93.8, trackDeg: 90 }), [], now, [north])!;
    expect(hit.candidate.id).toBe('NORTH1');
    expect(hit.next).toBe('CHARL');
  });
  it('uses the trail to pick between procedures that share the leg', () => {
    const trail: TrailPoint[] = [
      { lat: 44.6, lon: -94.4, altFt: 9000, ms: now - 300_000 },
      { lat: 44.8, lon: -94.2, altFt: 8000, ms: now - 200_000 },
      { lat: 45, lon: -94, altFt: 7000, ms: now - 100_000 },
    ];
    expect(matchProcedure(plane({ lat: 45, lon: -93.8, trackDeg: 90 }), trail, now, [north, south])!.candidate.id).toBe('SOUTH1');
  });
  it('rejects a track across the leg or far from it', () => {
    expect(matchProcedure(plane({ lat: 45, lon: -93.8, trackDeg: 180 }), [], now, [north])).toBeNull();
    expect(matchProcedure(plane({ lat: 45.2, lon: -93.8, trackDeg: 90 }), [], now, [north])).toBeNull();
  });
  it('only offers a departure to an aircraft that is not descending', () => {
    const sid: ProcedureCandidate = { ...north, kind: 'sid', id: 'OUT2' };
    const a = { lat: 45, lon: -93.8, trackDeg: 90 };
    expect(inferActivity(plane({ ...a, verticalRateFpm: 1500 }), ctx({ candidates: [sid] }))).toEqual({ kind: 'sid', icao: 'KTST', id: 'OUT2', next: 'CHARL' });
    expect(inferActivity(plane({ ...a, verticalRateFpm: -1500 }), ctx({ candidates: [sid] })).kind).toBe('descent');
  });
});

describe('holding and the rest', () => {
  const now = 1_000_000;
  it('adds up the turns of an orbit and not of a straight line', () => {
    const orbit: TrailPoint[] = [];
    for (let i = 0; i <= 24; i++) {
      const [lat, lon] = destination(45, -93, i * 15, 2);
      orbit.push({ lat, lon, altFt: 6000, ms: now - (24 - i) * 15_000 });
    }
    expect(Math.abs(trailTurnDeg(orbit, now))).toBeGreaterThan(300);
    expect(inferActivity(plane({}), ctx({ trail: orbit, nowMs: now }))).toEqual({ kind: 'holding' });
    const straight: TrailPoint[] = Array.from({ length: 20 }, (_, i) => ({ lat: 45, lon: -94 + i * 0.05, altFt: 6000, ms: now - (20 - i) * 15_000 }));
    expect(Math.abs(trailTurnDeg(straight, now))).toBeLessThan(5);
  });
  it('falls back to the vertical picture, with the route when there is one', () => {
    expect(inferActivity(plane({ altFt: 36000 }), ctx()).kind).toBe('cruise');
    expect(inferActivity(plane({ altFt: 4500 }), ctx()).kind).toBe('level');
    expect(inferActivity(plane({ verticalRateFpm: 1800 }), ctx()).kind).toBe('climb');
    const route = { origin: 'AAA', destination: 'BBB', origin_icao: 'KAAA', destination_icao: 'KBBB', plausible: true, origin_pos: { lat: 45, lon: -93.2 }, destination_pos: { lat: 45, lon: -92 } };
    expect(inferActivity(plane({ verticalRateFpm: 1800 }), ctx({ route }))).toEqual({ kind: 'departing', icao: 'KAAA' });
    const arriving = inferActivity(plane({ verticalRateFpm: -1500 }), ctx({ route }));
    expect(arriving.kind).toBe('arriving');
    expect(inferActivity(plane({ verticalRateFpm: -1500 }), ctx({ route: { ...route, plausible: false } })).kind).toBe('descent');
  });
  it('sees a landing and a take-off it watched', () => {
    expect(inferActivity(plane({ altFt: 1000, groundSpeedKt: 130, verticalRateFpm: -200 }), ctx())).toEqual({ kind: 'landing', icao: 'KTST' });
    const trail: TrailPoint[] = [{ lat: 45, lon: -93, altFt: 950, ms: 900_000 }];
    expect(inferActivity(plane({ lat: 45.1, altFt: 4000, verticalRateFpm: 2000 }), ctx({ trail }))).toEqual({ kind: 'departing', icao: 'KTST' });
  });
  it('knows where the FAA publishes procedures', () => {
    expect(inProcedureCoverage(44.9, -93.2)).toBe(true);
    expect(inProcedureCoverage(61.2, -150)).toBe(true);
    expect(inProcedureCoverage(51.5, -0.1)).toBe(false);
  });
});
