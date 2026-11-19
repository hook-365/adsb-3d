// @vitest-environment jsdom
import indexText from '../src/world/procedures-index.json?raw';
import { describe, expect, it } from 'vitest';
import type { TrailPoint } from '../src/aircraft/store';
import type { Aircraft } from '../src/core/types';
import type { Airport } from '../src/feed/explore-airports';
import {
  inProcedureCoverage,
  formationPartner,
  inferActivity,
  matchFinal,
  matchRunwayFinal,
  matchProcedure,
  matchRefuelTrack,
  nearestAirport,
  runwayUnder,
  trailTurnDeg,
  type ActivityContext,
  type ProcedureCandidate,
} from '../src/world/activity';
import type { Runway } from '../src/world/airports';
import { destination } from '../src/world/procedure-geometry';
import { decodeIndex } from '../src/world/procedures';
import { decodeRefuelTracks, refuelDrawing } from '../src/world/refueling';
import refuelText from '../src/world/refueling-data.json?raw';

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

describe('final where nothing is published', () => {
  // 5 NM west of the 09 threshold, on the centreline, heading east and descending.
  const onFinal = plane({ lat: 45, lon: -93.02 - 5 / (60 * Math.cos((45 * Math.PI) / 180)), altFt: 2500, trackDeg: 90, verticalRateFpm: -700 });
  it('names the runway end from the runway alone', () => {
    const fit = matchRunwayFinal(onFinal, [airport('EGTS', 45, -93)], () => [runway], () => false)!;
    expect(fit.runway).toBe('09');
    expect(fit.nm).toBeCloseTo(5, 0);
    expect(inferActivity(onFinal, ctx())).toMatchObject({ kind: 'final', icao: 'KTST', runway: '09' });
  });
  it('leaves airports with published finals to those, and ignores unlit strips', () => {
    expect(matchRunwayFinal(onFinal, [airport('EGTS', 45, -93)], () => [runway], () => true)).toBeNull();
    expect(matchRunwayFinal(onFinal, [airport('EGTS', 45, -93)], () => [{ ...runway, lighted: false }], () => false)).toBeNull();
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

describe('refueling tracks', () => {
  const tracks = decodeRefuelTracks(JSON.parse(refuelText));
  // Westbound along AR-109's long leg at 45.78 N, one point a minute at 360 kt.
  const run = (lat: number, fromLon: number, minutes: number): TrailPoint[] =>
    Array.from({ length: minutes + 1 }, (_, i) => ({ lat, lon: fromLon - i * 0.143, altFt: 27_000, ms: 1_000_000 - (minutes - i) * 60_000 }));
  const trail = run(45.78, -88.5, 5);
  const tanker = plane({ lat: 45.78, lon: trail.at(-1)!.lon, altFt: 27_000, groundSpeedKt: 360, trackDeg: 271, military: true });

  it('decodes the generated file', () => {
    expect(tracks.length).toBeGreaterThan(100);
    expect(tracks.every((t) => t.pts.length >= 2 && t.bbox[0] <= t.bbox[2])).toBe(true);
    expect(decodeRefuelTracks({ tracks: [{ id: 'X', pts: [[1, 2]] }, { id: 3 }] })).toEqual([]);
  });
  it('names the track a run along it is on, flown either way', () => {
    expect(matchRefuelTrack(tanker, trail, 1_000_000, tracks)?.id).toBe('AR-109');
    const back = [...trail].reverse().map((p, i) => ({ ...p, ms: trail[i]!.ms }));
    expect(matchRefuelTrack({ ...tanker, lon: back.at(-1)!.lon, trackDeg: 91 }, back, 1_000_000, tracks)?.id).toBe('AR-109');
  });
  it('needs a run along the track, not a crossing or a fresh contact', () => {
    expect(matchRefuelTrack({ ...tanker, trackDeg: 180 }, trail, 1_000_000, tracks)).toBeNull();
    expect(matchRefuelTrack(tanker, trail.slice(-2), 1_000_000, tracks)).toBeNull();
    const cut = trail.map((p, i) => ({ ...p, lat: 45.78 + (trail.length - 1 - i) * 0.1 }));
    expect(matchRefuelTrack(tanker, cut, 1_000_000, tracks)).toBeNull();
    expect(matchRefuelTrack({ ...tanker, lat: 46.4 }, run(46.4, -88.5, 5), 1_000_000, tracks)).toBeNull();
  });
  it('finds who is flying in formation', () => {
    const receiver = plane({ hex: 'ae0001', callsign: 'RCH101', lat: 45.78, lon: tanker.lon + 0.01, altFt: 26_900, groundSpeedKt: 362, trackDeg: 270 });
    const others = [
      tanker,
      plane({ hex: 'a00001', lat: 45.78, lon: tanker.lon + 0.01, altFt: 31_000, groundSpeedKt: 360, trackDeg: 270 }),
      plane({ hex: 'a00002', lat: 45.79, lon: tanker.lon, altFt: 27_000, groundSpeedKt: 360, trackDeg: 90 }),
      plane({ hex: 'a00003', lat: 45.9, lon: tanker.lon, altFt: 27_000, groundSpeedKt: 360, trackDeg: 270 }),
    ];
    expect(formationPartner(tanker, others)).toBeNull();
    expect(formationPartner(tanker, [...others, receiver])?.hex).toBe('ae0001');
  });
  it('reports it for military aircraft only', () => {
    const receiver = plane({ hex: 'ae0001', callsign: 'RCH101', lat: 45.78, lon: tanker.lon + 0.01, altFt: 26_900, groundSpeedKt: 362, trackDeg: 270 });
    const c = ctx({ trail, airports: [], refuelTracks: tracks, others: [tanker, receiver] });
    expect(inferActivity(tanker, c)).toEqual({ kind: 'refuel', track: 'AR-109', with: 'RCH101' });
    expect(inferActivity(tanker, { ...c, others: [tanker] })).toEqual({ kind: 'refuel', track: 'AR-109', with: null });
    expect(inferActivity({ ...tanker, military: false }, c).kind).toBe('cruise');
  });
});

describe('refueling track drawing', () => {
  const tracks = decodeRefuelTracks(JSON.parse(refuelText));
  const from = (lat: number, lon: number) => (aLat: number, aLon: number) =>
    Math.hypot((aLat - lat) * 60, (aLon - lon) * 60 * Math.cos((lat * Math.PI) / 180));

  it('keeps a long leg that crosses the scope with both ends outside it', () => {
    const leg = decodeRefuelTracks({ tracks: [{ id: 'LONG', pts: [[45, -100], [45, -86]] }] });
    const { pieces, labels } = refuelDrawing(leg, from(45, -93), 100, 6, 60, 10);
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.length % 4).toBe(0);
    // Only the part inside the scope is cut up and kept: about 200 of its 590 NM.
    expect(pieces.length / 4).toBeLessThan(40);
    for (let i = 0; i < pieces.length; i += 4) {
      expect(Math.min(from(45, -93)(pieces[i]!, pieces[i + 1]!), from(45, -93)(pieces[i + 2]!, pieces[i + 3]!))).toBeLessThanOrEqual(100);
    }
    expect(labels.map((l) => l.id)).toEqual(['LONG']);
    // Named where the line passes closest to the middle, to within a piece.
    expect(labels[0]!.nm).toBeLessThanOrEqual(6);
  });
  it('draws nothing far from every track, and little of the country for one scope', () => {
    expect(refuelDrawing(tracks, from(-30, 20), 250, 6, 160, 24).pieces).toEqual([]);
    const all = refuelDrawing(tracks, () => 0, 250, 6, 160, 24).pieces.length;
    const local = refuelDrawing(tracks, from(45, -89.5), 262, 6, 160, 24);
    expect(local.pieces.length).toBeLessThan(all / 8);
    expect(local.labels.map((l) => l.id)).toEqual(expect.arrayContaining(['AR-321', 'AR-109']));
    expect(local.labels.length).toBeLessThanOrEqual(24);
    expect(local.labels[0]!.nm).toBeLessThanOrEqual(local.labels.at(-1)!.nm);
  });
});
