// @vitest-environment jsdom
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { normalizeRoute } from '../src/feed/routes';
import { greatCircle, routeHalf, routeProfile } from '../src/world/route-line';

const MSP = { lat: 44.88, lon: -93.22 };
const LHR = { lat: 51.47, lon: -0.45 };

describe('greatCircle', () => {
  it('starts and ends on the two points', () => {
    const path = greatCircle(MSP, LHR, 16);
    expect(path).toHaveLength(17);
    expect(path[0]!.lat).toBeCloseTo(MSP.lat, 6);
    expect(path[0]!.lon).toBeCloseTo(MSP.lon, 6);
    expect(path[16]!.lat).toBeCloseTo(LHR.lat, 6);
    expect(path[16]!.lon).toBeCloseTo(LHR.lon, 6);
  });

  it('bows toward the pole, as a great circle across the Atlantic does', () => {
    const mid = greatCircle(MSP, LHR, 2)[1]!;
    expect(mid.lat).toBeGreaterThan(55);
  });

  it('keeps longitude continuous across the antimeridian', () => {
    const path = greatCircle({ lat: 35, lon: 170 }, { lat: 35, lon: -170 }, 8);
    for (let i = 1; i < path.length; i++) {
      expect(Math.abs(path[i]!.lon - path[i - 1]!.lon)).toBeLessThan(10);
    }
    expect(path[8]!.lon).toBeCloseTo(190, 6);
  });

  it('survives two identical points', () => {
    const path = greatCircle(MSP, MSP, 4);
    expect(path.every((p) => Math.abs(p.lat - MSP.lat) < 1e-9 && Math.abs(p.lon - MSP.lon) < 1e-9)).toBe(true);
  });
});

describe('routeProfile', () => {
  it('is level near the aircraft and on the ground at the airport, without going back up', () => {
    expect(routeProfile(0)).toBe(1);
    expect(routeProfile(0.5)).toBe(1);
    expect(routeProfile(1)).toBe(0);
    let prev = 1;
    for (let f = 0; f <= 1.0001; f += 0.05) {
      const v = routeProfile(f);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
  });
});

describe('routeHalf', () => {
  const flat = (lat: number, lon: number, altFt: number, out: Vector3): Vector3 => out.set(lon, altFt, lat);
  const aircraft = { callsign: 'DAL1', lat: 45, lon: -93, altFt: 30000 };

  it('runs from the aircraft at altitude to the airport on the ground', () => {
    const pts = routeHalf(aircraft, { lat: 45, lon: -92 }, 1e9, () => 0, flat);
    expect(pts[0]).toBeCloseTo(-93, 9);
    expect(pts[1]).toBe(30000);
    expect(pts[2]).toBeCloseTo(45, 9);
    expect(pts[pts.length - 3]).toBeCloseTo(-92, 6);
    expect(pts[pts.length - 2]).toBeCloseTo(0, 6);
  });

  it('stops where the path leaves the scope', () => {
    // "Distance" grows with longitude east of the aircraft; the scope ends half way.
    const pts = routeHalf(aircraft, { lat: 45, lon: -92 }, 0.5, (_lat, lon) => lon + 93, flat);
    const lastLon = pts[pts.length - 3]!;
    expect(lastLon).toBeLessThanOrEqual(-92.5 + 1e-9);
    expect(lastLon).toBeGreaterThan(-92.6);
  });
});

describe('normalizeRoute', () => {
  it('keeps the current leg endpoints for the route line', () => {
    const route = normalizeRoute(
      {
        callsign: 'DAL1',
        plausible: true,
        _airports: [
          { iata: 'MSP', lat: MSP.lat, lon: MSP.lon },
          { iata: 'LHR', lat: LHR.lat, lon: LHR.lon },
        ],
      },
      46,
      -80,
    );
    expect(route?.origin_pos).toEqual(MSP);
    expect(route?.destination_pos).toEqual(LHR);
  });

  it('leaves them out when the service sends no coordinates', () => {
    const route = normalizeRoute({ callsign: 'X', _airports: [{ iata: 'AAA' }, { iata: 'BBB' }] }, 0, 0);
    expect(route?.origin_pos).toBeUndefined();
    expect(route?.destination_pos).toBeUndefined();
  });
});
