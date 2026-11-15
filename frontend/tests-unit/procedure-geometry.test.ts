import { describe, expect, it } from 'vitest';
import {
  altitudeLimit,
  arcPoints,
  bearing,
  destination,
  distanceNm,
  finalPath,
  holdPattern,
  interceptNm,
  interpolateAltitudes,
  legAltitude,
  segmentGeometry,
  type Leg,
  type Segment,
} from '../src/world/procedure-geometry';

const seg = (legs: Leg[]): Segment => ({ r: 'R', t: '', legs });
const HERE: [number, number] = [45, -93];

describe('geodesy', () => {
  it('goes out a distance on a bearing and measures it back', () => {
    const [lat, lon] = destination(45, -93, 90, 10);
    expect(distanceNm(45, -93, lat, lon)).toBeCloseTo(10, 4);
    expect(bearing(45, -93, lat, lon)).toBeCloseTo(90, 0);
    expect(lat).toBeCloseTo(45, 2);
  });
});

describe('arcPoints', () => {
  it('turns the way it is told, ends included', () => {
    const right = arcPoints(45, -93, 5, 350, 20, true);
    const left = arcPoints(45, -93, 5, 350, 20, false);
    // 30 degrees clockwise against 330 the other way.
    expect(right.length).toBeLessThan(left.length);
    for (const [lat, lon] of [...right, ...left]) expect(distanceNm(45, -93, lat, lon)).toBeCloseTo(5, 3);
    expect(bearing(45, -93, right[0]![0], right[0]![1])).toBeCloseTo(350, 1);
    expect(bearing(45, -93, right[right.length - 1]![0], right[right.length - 1]![1])).toBeCloseTo(20, 1);
  });
});

describe('altitudes', () => {
  it('reads the limit a leg puts on its fix', () => {
    expect(legAltitude({ l: 'TF', ad: '+', a1: 3000 })).toBe(3000);
    expect(legAltitude({ l: 'TF', ad: 'B', a1: 7000, a2: 5000 })).toBe(5000);
    expect(legAltitude({ l: 'TF' })).toBeNull();
    expect(altitudeLimit({ l: 'TF', ad: '+', a1: 3000 })).toBe('≥3,000');
    expect(altitudeLimit({ l: 'TF', ad: '-', a1: 10000 })).toBe('≤10,000');
    expect(altitudeLimit({ l: 'TF', ad: 'B', a1: 7000, a2: 5000 })).toBe('5,000–7,000');
    expect(altitudeLimit({ l: 'TF', a1: 892 })).toBe('892');
    expect(altitudeLimit({ l: 'TF' })).toBe('');
  });

  it('fills the gaps by distance and carries the ends', () => {
    const pts = [
      { lat: 45, lon: -93, altFt: null },
      { lat: 45, lon: -92.9, altFt: 4000 },
      { lat: 45, lon: -92.8, altFt: null },
      { lat: 45, lon: -92.7, altFt: 2000 },
      { lat: 45, lon: -92.6, altFt: null },
    ];
    interpolateAltitudes(pts);
    expect(pts.map((p) => Math.round(p.altFt!))).toEqual([4000, 4000, 3000, 2000, 2000]);
  });
});

describe('segmentGeometry', () => {
  it('draws straight legs fix to fix and lists the fixes with their limits', () => {
    const a = destination(...HERE, 90, 10);
    const b = destination(...HERE, 90, 20);
    const g = segmentGeometry(
      seg([
        { l: 'IF', f: 'AAA', p: HERE, ad: '+', a1: 4000, r: 'I' },
        { l: 'TF', f: 'BBB', p: a, ad: '+', a1: 3000, r: 'F' },
        { l: 'CF', f: 'RW09', p: b, a1: 900, r: 'M', rw: 1 },
      ]),
      { magVar: 0 },
    );
    expect(g.paths).toHaveLength(1);
    expect(g.paths[0]!.approximate).toBe(false);
    expect(g.paths[0]!.points.map((p) => p.altFt)).toEqual([4000, 3000, 900]);
    expect(g.fixes.map((f) => `${f.name} ${f.limit} ${f.role}`)).toEqual(['AAA ≥4,000 I', 'BBB ≥3,000 F', 'RW09 900 M']);
    expect(g.end).toMatchObject({ lat: b[0], lon: b[1] });
  });

  it('flies an RF leg as an arc around its centre, the coded way round', () => {
    const centre: [number, number] = [45, -93];
    const start = destination(...centre, 0, 3);
    const end = destination(...centre, 90, 3);
    const legs: Leg[] = [
      { l: 'IF', f: 'AAA', p: start },
      { l: 'RF', f: 'BBB', p: end, cp: centre, rad: 3, t: 'R' },
    ];
    const pts = segmentGeometry(seg(legs), { magVar: 0 }).paths[0]!.points;
    expect(pts.length).toBeGreaterThan(10);
    for (const p of pts) expect(distanceNm(...centre, p.lat, p.lon)).toBeCloseTo(3, 2);
    // A right turn from north of the centre to east of it passes north-east.
    const mid = pts[Math.floor(pts.length / 2)]!;
    expect(bearing(...centre, mid.lat, mid.lon)).toBeGreaterThan(30);
    expect(bearing(...centre, mid.lat, mid.lon)).toBeLessThan(60);
    // The other way round is the long way: three quarters of the circle.
    legs[1]!.t = 'L';
    expect(segmentGeometry(seg(legs), { magVar: 0 }).paths[0]!.points.length).toBeGreaterThan(pts.length * 2);
  });

  it('flies an AF leg at the DME distance around the navaid', () => {
    const navaid: [number, number] = [45, -93];
    const g = segmentGeometry(
      seg([
        { l: 'IF', f: 'AAA', p: destination(...navaid, 200, 12) },
        { l: 'AF', f: 'BBB', p: destination(...navaid, 260, 12), np: navaid, rho: 12, t: 'R' },
      ]),
      { magVar: 0 },
    );
    for (const p of g.paths[0]!.points) expect(distanceNm(...navaid, p.lat, p.lon)).toBeCloseTo(12, 2);
  });

  it('turns magnetic courses true with the variation, and leaves true ones alone', () => {
    const climb = (leg: Leg, magVar: number) => {
      const g = segmentGeometry(seg([{ l: 'IF', f: 'RW', p: HERE, a1: 800 }, leg]), { magVar });
      const stub = g.paths[g.paths.length - 1]!;
      return bearing(...HERE, stub.points[1]!.lat, stub.points[1]!.lon);
    };
    expect(climb({ l: 'CA', c: 100, a1: 1500 }, 6)).toBeCloseTo(106, 0);
    expect(climb({ l: 'CA', c: 100, ct: 1, a1: 1500 }, 6)).toBeCloseTo(100, 0);
  });

  it('draws a climb to altitude as a stub about as long as the climb, marked approximate', () => {
    const g = segmentGeometry(seg([{ l: 'IF', f: 'RW', p: HERE, a1: 800 }, { l: 'CA', c: 120, ad: '+', a1: 2200 }]), { magVar: 0 });
    const stub = g.paths[g.paths.length - 1]!;
    expect(stub.approximate).toBe(true);
    // 1,400 ft at 350 ft per NM.
    expect(distanceNm(...HERE, stub.points[1]!.lat, stub.points[1]!.lon)).toBeCloseTo(4, 1);
    expect(stub.points[1]!.altFt).toBe(2200);
  });

  it('starts a departure from the point it is given when its first leg has no fix', () => {
    const start = { lat: 45, lon: -93, altFt: 840 };
    const g = segmentGeometry(seg([{ l: 'VA', c: 300, ad: '+', a1: 1540 }, { l: 'DF', f: 'AAA', p: destination(45, -93, 300, 12) }]), {
      magVar: 0,
      start,
    });
    expect(g.paths[0]!.approximate).toBe(true);
    expect(g.paths[0]!.points[0]).toMatchObject(start);
    expect(g.paths.some((p) => !p.approximate)).toBe(true);
    // And draws nothing rather than guess when it is not told where to start.
    expect(segmentGeometry(seg([{ l: 'VA', c: 300, a1: 1540 }]), { magVar: 0 }).paths).toEqual([]);
  });

  it('ends a heading-to-intercept where it meets the next leg', () => {
    const fix = destination(...HERE, 45, 10);
    const g = segmentGeometry(seg([{ l: 'IF', f: 'AAA', p: HERE }, { l: 'VI', c: 90 }, { l: 'CF', f: 'BBB', p: fix, c: 360 }]), { magVar: 0 });
    const stub = g.paths.find((p) => p.approximate)!;
    const end = stub.points[1]!;
    // East from the start until due south of the fix.
    expect(end.lon).toBeCloseTo(fix[1], 2);
    expect(end.lat).toBeCloseTo(45, 2);
  });

  it('draws vectors as a short stub and stops there', () => {
    const g = segmentGeometry(seg([{ l: 'IF', f: 'AAA', p: HERE, a1: 5000 }, { l: 'FM', f: 'AAA', p: HERE, c: 180 }]), { magVar: 0 });
    const stub = g.paths[g.paths.length - 1]!;
    expect(stub.approximate).toBe(true);
    expect(distanceNm(...HERE, stub.points[1]!.lat, stub.points[1]!.lon)).toBeCloseTo(5, 2);
  });

  it('draws a hold as a racetrack that comes back to its fix', () => {
    const g = segmentGeometry(seg([{ l: 'IF', f: 'AAA', p: HERE, a1: 3000 }, { l: 'HM', f: 'AAA', p: HERE, c: 360, t: 'R', tm: 1 }]), { magVar: 0 });
    const loop = g.paths.find((p) => p.approximate)!.points;
    expect(loop[0]).toMatchObject({ lat: 45, lon: -93 });
    expect(loop[loop.length - 1]!.lat).toBeCloseTo(45, 9);
    expect(loop[loop.length - 1]!.lon).toBeCloseTo(-93, 9);
    // Inbound north with right turns: the racetrack lies south and east of the fix.
    expect(Math.min(...loop.map((p) => p.lat))).toBeLessThan(45 - 3 / 60);
    expect(Math.max(...loop.map((p) => p.lon))).toBeGreaterThan(-93 + 0.02);
    expect(Math.min(...loop.map((p) => p.lon))).toBeGreaterThan(-93 - 0.001);
  });

  it('survives a segment of nothing it understands', () => {
    expect(segmentGeometry(seg([{ l: 'ZZ' }, { l: 'CA' }]), { magVar: 0 })).toEqual({ paths: [], fixes: [], end: null });
  });
});

describe('holdPattern', () => {
  it('mirrors for left turns', () => {
    const right = holdPattern(45, -93, 360, true, 4);
    const left = holdPattern(45, -93, 360, false, 4);
    expect(Math.max(...right.map((p) => p[1]))).toBeGreaterThan(-93);
    expect(Math.min(...left.map((p) => p[1]))).toBeLessThan(-93);
  });
});

describe('interceptNm', () => {
  it('is null for parallel lines and for a crossing behind', () => {
    expect(interceptNm(45, -93, 90, 45.1, -93, 90)).toBeNull();
    expect(interceptNm(45, -93, 90, 45.1, -93.5, 360)).toBeNull();
  });
});

describe('finalPath', () => {
  it('fills a step-down fix that has no altitude of its own', () => {
    const pts = finalPath([
      ['FAF', 45, -93.2, 3000, 'F', '+'],
      ['STEP', 45, -93.1, null, '', ''],
      ['RW09', 45, -93, 900, 'M', ''],
    ]);
    expect(pts[1]!.altFt).toBeGreaterThan(1900);
    expect(pts[1]!.altFt).toBeLessThan(2000);
  });
});
