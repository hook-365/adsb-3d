// Geometry of published instrument procedures.
//
// A procedure in the FAA's CIFP is a list of legs, each an ARINC 424 "path
// and terminator": fly this kind of path until that happens. This module
// turns one segment of a procedure (a transition, or the final route) into
// polylines of (lat, lon, altitude) and a list of the fixes along it. Pure;
// no scene, no DOM, no network.
//
// Legs that end at a fix are exact: straight legs (IF, TF, CF, DF), arcs
// around a published centre (RF) and DME arcs around a navaid (AF).
//
// Legs that end on a condition are not a line on the ground; where they go
// depends on the aircraft and the controller. They are drawn as honest
// approximations and flagged `approximate` so the layer can dash them:
//   CA, VA, FA   climb on a course to an altitude: a stub as long as that
//                climb plausibly takes
//   VI, CI       a heading to intercept the next leg: a stub to where the
//                two lines cross
//   VM, FM       a heading "until told otherwise" (vectors): a short stub
//   CD, VD, FD   a course to a DME distance: a stub to that distance
//   CR, VR       a course to a radial: a short stub
//   HM, HF, HA   a hold: one racetrack at the fix
//   PI           a procedure turn: the outbound leg and its 45 degree barb
//
// Courses in the file are magnetic unless marked true; `magVar` (east
// positive) turns them.

export interface Leg {
  /** Path and terminator: 'TF', 'RF', 'CA', ... */
  l: string;
  /** Fix identifier and position, when the leg has one. */
  f?: string;
  p?: [number, number];
  /** Role of the fix: F final approach fix, M missed approach point, A / B / I initial, intermediate, final course fix. */
  r?: string;
  /** The fix is a runway threshold. */
  rw?: 1;
  fo?: 1;
  /** Turn direction. */
  t?: string;
  /** Altitude description ('+' at or above, '-' at or below, 'B' between, ...) and the altitudes, feet. */
  ad?: string;
  a1?: number;
  a2?: number;
  /** Course, degrees; magnetic unless `ct`. */
  c?: number;
  ct?: 1;
  /** Leg distance NM, or hold time in minutes. */
  d?: number;
  tm?: number;
  /** Vertical angle, degrees (negative descending). */
  va?: number;
  s?: number;
  /** RF: arc centre and radius NM. */
  cp?: [number, number];
  rad?: number;
  /** AF and the DME / radial legs: navaid, boundary radial, DME distance NM. */
  np?: [number, number];
  th?: number;
  rho?: number;
}

export interface Segment {
  /** Route type and transition identifier as coded. */
  r: string;
  t: string;
  legs: Leg[];
}

export interface PathPoint {
  lat: number;
  lon: number;
  /** Feet MSL, or null where nothing in the procedure says. */
  altFt: number | null;
}

export interface ProcedurePath {
  points: PathPoint[];
  /** Drawn from a condition, not between fixes: see the header. */
  approximate: boolean;
}

export interface ProcedureFix {
  name: string;
  lat: number;
  lon: number;
  altFt: number | null;
  /** "≥3000", "≤5000", "3000–5000", "3000", or ''. */
  limit: string;
  role: string;
}

const NM_PER_DEG = 60;
const RAD = Math.PI / 180;
/** Feet gained per NM in a typical departure or missed approach climb. */
const CLIMB_FT_PER_NM = 350;
const HOLD_NM_PER_MIN = 3.5;
const HOLD_TURN_RADIUS_NM = 1.1;
const VECTORS_STUB_NM = 5;
const SHORT_STUB_NM = 3;
const ARC_STEP_DEG = 6;

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Initial true bearing from a to b, degrees. */
export function bearing(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const y = Math.sin((bLon - aLon) * RAD) * Math.cos(bLat * RAD);
  const x =
    Math.cos(aLat * RAD) * Math.sin(bLat * RAD) -
    Math.sin(aLat * RAD) * Math.cos(bLat * RAD) * Math.cos((bLon - aLon) * RAD);
  return norm360(Math.atan2(y, x) / RAD);
}

/** Great-circle distance, NM. */
export function distanceNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h))) / RAD) * NM_PER_DEG;
}

/** The point `nm` from (lat, lon) along a true bearing. */
export function destination(lat: number, lon: number, bearingDeg: number, nm: number): [number, number] {
  const d = (nm / NM_PER_DEG) * RAD;
  const b = bearingDeg * RAD;
  const la1 = lat * RAD;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lon * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [la2 / RAD, lo2 / RAD];
}

/**
 * Points along an arc around a centre from one bearing to another, ends
 * included. `right` is a right-hand (clockwise) turn.
 */
export function arcPoints(
  cLat: number,
  cLon: number,
  radiusNm: number,
  fromDeg: number,
  toDeg: number,
  right: boolean,
): [number, number][] {
  let sweep = right ? norm360(toDeg - fromDeg) : -norm360(fromDeg - toDeg);
  // The same bearing twice is a full circle only for a hold; for a leg it is no arc at all.
  if (Math.abs(sweep) < 1e-6) sweep = 0;
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ARC_STEP_DEG));
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) out.push(destination(cLat, cLon, fromDeg + (sweep * i) / steps, radiusNm));
  return out;
}

/** The published altitude a leg puts on its fix: the lower bound of a window. */
export function legAltitude(leg: Leg): number | null {
  if (leg.ad === 'B' && leg.a2 !== undefined) return leg.a2;
  return leg.a1 ?? null;
}

/** "≥3000", "≤5000", "3000–5000", "3000"; '' when the leg has no altitude. */
export function altitudeLimit(leg: Leg): string {
  if (leg.a1 === undefined) return '';
  const a1 = leg.a1.toLocaleString('en-US');
  switch (leg.ad) {
    case '+':
    case 'J':
    case 'V':
      return `≥${a1}`;
    case '-':
      return `≤${a1}`;
    case 'B':
      return leg.a2 !== undefined ? `${leg.a2.toLocaleString('en-US')}–${a1}` : a1;
    default:
      return a1;
  }
}

/** One racetrack at a holding fix: inbound course to the fix, turns to `right`. */
export function holdPattern(lat: number, lon: number, inboundDeg: number, right: boolean, legNm: number): [number, number][] {
  const side = right ? 90 : -90;
  const r = HOLD_TURN_RADIUS_NM;
  const outbound = inboundDeg + 180;
  // Turn away from the fix onto the outbound leg...
  const c1 = destination(lat, lon, inboundDeg + side, r);
  const turn1 = arcPoints(c1[0], c1[1], r, inboundDeg - side, inboundDeg + side, right);
  // ...fly it, then turn back onto the inbound course.
  const c2 = destination(c1[0], c1[1], outbound, legNm);
  const turn2 = arcPoints(c2[0], c2[1], r, inboundDeg + side, inboundDeg - side, right);
  return [...turn1, ...turn2, [lat, lon]];
}

/**
 * Where a ray from a point along a bearing meets the line through `fix` on
 * course `courseDeg`, as NM along the ray; null when they do not meet ahead
 * within `maxNm`. Flat geometry: these are a few miles.
 */
export function interceptNm(
  lat: number,
  lon: number,
  headingDeg: number,
  fixLat: number,
  fixLon: number,
  courseDeg: number,
  maxNm = 20,
): number | null {
  const cos = Math.cos(lat * RAD);
  const fx = (fixLon - lon) * NM_PER_DEG * cos;
  const fy = (fixLat - lat) * NM_PER_DEG;
  const hx = Math.sin(headingDeg * RAD);
  const hy = Math.cos(headingDeg * RAD);
  const cx = Math.sin(courseDeg * RAD);
  const cy = Math.cos(courseDeg * RAD);
  const det = hx * -cy - hy * -cx;
  if (Math.abs(det) < 1e-6) return null;
  const s = (fx * -cy - fy * -cx) / det;
  return s > 0 && s <= maxNm ? s : null;
}

/** Fill in null altitudes by distance between the known ones; ends copy their neighbour. */
export function interpolateAltitudes(points: PathPoint[]): void {
  const known = points.map((p, i) => (p.altFt === null ? -1 : i)).filter((i) => i >= 0);
  if (known.length === 0) return;
  for (let i = 0; i < known[0]!; i++) points[i]!.altFt = points[known[0]!]!.altFt;
  for (let i = known[known.length - 1]! + 1; i < points.length; i++) points[i]!.altFt = points[known[known.length - 1]!]!.altFt;
  for (let k = 0; k + 1 < known.length; k++) {
    const a = known[k]!;
    const b = known[k + 1]!;
    if (b - a < 2) continue;
    const dist: number[] = [0];
    for (let i = a + 1; i <= b; i++) {
      dist.push(dist[dist.length - 1]! + distanceNm(points[i - 1]!.lat, points[i - 1]!.lon, points[i]!.lat, points[i]!.lon));
    }
    const total = dist[dist.length - 1]! || 1;
    const from = points[a]!.altFt!;
    const to = points[b]!.altFt!;
    for (let i = a + 1; i < b; i++) points[i]!.altFt = from + ((to - from) * dist[i - a]!) / total;
  }
}

export interface SegmentOptions {
  /** Magnetic variation at the airport, east positive. */
  magVar: number;
  /** Where the segment starts when its first leg has no fix (a departure off a runway). */
  start?: PathPoint | null;
}

export interface SegmentGeometry {
  paths: ProcedurePath[];
  fixes: ProcedureFix[];
  /** Where the segment leaves off, for the one that follows it. */
  end: PathPoint | null;
}

/** Geometry of one segment of a procedure. */
export function segmentGeometry(segment: Segment, options: SegmentOptions): SegmentGeometry {
  const paths: ProcedurePath[] = [];
  const fixes: ProcedureFix[] = [];
  let cur: PathPoint | null = options.start ?? null;
  let run: PathPoint[] = cur ? [{ ...cur }] : [];
  const seen = new Set<string>();

  const trueCourse = (leg: Leg): number | null => (leg.c === undefined ? null : norm360(leg.c + (leg.ct ? 0 : options.magVar)));
  const flush = (): void => {
    if (run.length > 1) paths.push({ points: run, approximate: false });
    run = cur ? [{ ...cur }] : [];
  };
  const moveTo = (lat: number, lon: number, altFt: number | null): void => {
    cur = { lat, lon, altFt };
    run.push({ lat, lon, altFt });
  };
  const noteFix = (leg: Leg): void => {
    if (!leg.f || !leg.p || seen.has(leg.f)) return;
    seen.add(leg.f);
    fixes.push({ name: leg.f, lat: leg.p[0], lon: leg.p[1], altFt: legAltitude(leg), limit: altitudeLimit(leg), role: leg.r ?? '' });
  };
  const stub = (from: PathPoint, courseDeg: number, nm: number, altFt: number | null): void => {
    flush();
    const [lat, lon] = destination(from.lat, from.lon, courseDeg, nm);
    paths.push({ points: [{ ...from }, { lat, lon, altFt }], approximate: true });
    cur = { lat, lon, altFt };
    run = [{ lat, lon, altFt }];
  };

  segment.legs.forEach((leg, index) => {
    const alt = legAltitude(leg);
    const course = trueCourse(leg);
    const fix: PathPoint | null = leg.p ? { lat: leg.p[0], lon: leg.p[1], altFt: alt } : null;
    switch (leg.l) {
      case 'IF':
        if (!fix) break;
        flush();
        cur = fix;
        run = [{ ...fix }];
        noteFix(leg);
        break;
      case 'RF': {
        if (!fix || !leg.cp || leg.rad === undefined || !cur) {
          if (fix) moveTo(fix.lat, fix.lon, alt);
          noteFix(leg);
          break;
        }
        const from = bearing(leg.cp[0], leg.cp[1], cur.lat, cur.lon);
        const to = bearing(leg.cp[0], leg.cp[1], fix.lat, fix.lon);
        for (const [lat, lon] of arcPoints(leg.cp[0], leg.cp[1], leg.rad, from, to, leg.t !== 'L').slice(1, -1)) {
          run.push({ lat, lon, altFt: null });
        }
        moveTo(fix.lat, fix.lon, alt);
        noteFix(leg);
        break;
      }
      case 'AF': {
        if (!fix || !leg.np || !cur) {
          if (fix) moveTo(fix.lat, fix.lon, alt);
          noteFix(leg);
          break;
        }
        const radius = leg.rho ?? distanceNm(leg.np[0], leg.np[1], fix.lat, fix.lon);
        const from = bearing(leg.np[0], leg.np[1], cur.lat, cur.lon);
        const to = bearing(leg.np[0], leg.np[1], fix.lat, fix.lon);
        // Without a coded direction, an arc takes the short way round.
        const right = leg.t ? leg.t !== 'L' : norm360(to - from) <= 180;
        for (const [lat, lon] of arcPoints(leg.np[0], leg.np[1], radius, from, to, right).slice(1, -1)) {
          run.push({ lat, lon, altFt: null });
        }
        moveTo(fix.lat, fix.lon, alt);
        noteFix(leg);
        break;
      }
      case 'CA':
      case 'VA':
      case 'FA': {
        const from = leg.l === 'FA' && fix ? fix : cur;
        if (!from || course === null) break;
        const climb = alt !== null && from.altFt !== null ? (alt - from.altFt) / CLIMB_FT_PER_NM : SHORT_STUB_NM;
        stub(from, course, Math.max(1.5, Math.min(8, climb)), alt);
        break;
      }
      case 'VI':
      case 'CI': {
        if (!cur || course === null) break;
        const next = segment.legs[index + 1];
        const nextCourse = next ? trueCourse(next) : null;
        const hit = next?.p && nextCourse !== null ? interceptNm(cur.lat, cur.lon, course, next.p[0], next.p[1], nextCourse) : null;
        stub(cur, course, hit ?? SHORT_STUB_NM, null);
        break;
      }
      case 'VM':
      case 'FM': {
        const from = leg.l === 'FM' && fix ? fix : cur;
        if (leg.l === 'FM' && fix && cur) {
          moveTo(fix.lat, fix.lon, alt);
          noteFix(leg);
        }
        if (!from || course === null) break;
        stub(from, course, VECTORS_STUB_NM, from.altFt);
        break;
      }
      case 'FC': {
        if (!fix || course === null) break;
        noteFix(leg);
        stub(fix, course, leg.d ?? SHORT_STUB_NM, alt);
        break;
      }
      case 'CD':
      case 'VD':
      case 'FD': {
        const from = leg.l === 'FD' && fix ? fix : cur;
        if (!from || course === null) break;
        let nm = SHORT_STUB_NM;
        if (leg.np && leg.rho !== undefined) {
          // March out the course until the DME reads the coded distance.
          for (let d = 0.25; d <= 30; d += 0.25) {
            const [lat, lon] = destination(from.lat, from.lon, course, d);
            if (distanceNm(leg.np[0], leg.np[1], lat, lon) >= leg.rho) {
              nm = d;
              break;
            }
          }
        }
        stub(from, course, nm, alt);
        break;
      }
      case 'CR':
      case 'VR':
        if (cur && course !== null) stub(cur, course, SHORT_STUB_NM, alt);
        break;
      case 'HM':
      case 'HF':
      case 'HA': {
        if (!fix || course === null) break;
        if (cur && (cur.lat !== fix.lat || cur.lon !== fix.lon)) moveTo(fix.lat, fix.lon, alt);
        noteFix(leg);
        flush();
        const legNm = leg.d ?? (leg.tm ?? 1) * HOLD_NM_PER_MIN;
        const loop = holdPattern(fix.lat, fix.lon, course, leg.t !== 'L', legNm).map(([lat, lon]) => ({ lat, lon, altFt: alt }));
        paths.push({ points: [{ ...fix }, ...loop], approximate: true });
        cur = fix;
        run = [{ ...fix }];
        break;
      }
      case 'PI': {
        if (!fix || course === null) break;
        if (cur && (cur.lat !== fix.lat || cur.lon !== fix.lon)) moveTo(fix.lat, fix.lon, alt);
        noteFix(leg);
        flush();
        const out = destination(fix.lat, fix.lon, course, Math.min(leg.d ?? 7, 10));
        const barb = destination(out[0], out[1], course + (leg.t === 'L' ? -45 : 45), 2);
        paths.push({
          points: [{ ...fix }, { lat: out[0], lon: out[1], altFt: alt }, { lat: barb[0], lon: barb[1], altFt: alt }],
          approximate: true,
        });
        cur = fix;
        run = [{ ...fix }];
        break;
      }
      default:
        // TF, CF, DF and anything else that ends at a fix: a straight leg.
        if (!fix) break;
        if (!cur) {
          cur = fix;
          run = [{ ...fix }];
        } else {
          moveTo(fix.lat, fix.lon, alt);
        }
        noteFix(leg);
    }
  });
  flush();
  for (const path of paths) interpolateAltitudes(path.points);
  return { paths, fixes, end: cur };
}

/** A final segment from the index: [fix, lat, lon, altitude or null, role, altitude description]. */
export type FinalLeg = [string, number, number, number | null, string, string];

/** The final's points, altitudes filled in between the published ones. */
export function finalPath(legs: readonly FinalLeg[]): PathPoint[] {
  const points = legs.map(([, lat, lon, altFt]) => ({ lat, lon, altFt }));
  interpolateAltitudes(points);
  return points;
}
