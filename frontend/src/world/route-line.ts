import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Vector3,
} from 'three';
import { RANGE_NM } from '../core/config';
import { distanceFromHomeNm, toScene } from '../core/coords';
import { getSettings, subscribeSettings } from '../core/settings';
import { getRoute, type RoutePoint } from '../feed/routes';
import { DIORAMA_PLANES } from './diorama-clip';

// Route line for the selected aircraft: where it came from and where it is
// going, as the great circle between the two airports of its current leg.
// The part already flown is a faint solid line, the part ahead a dashed
// one. It is the scheduled route for that flight number (feed/routes.ts),
// not a prediction and not a filed flight plan, so it is drawn only when
// the route service judged it plausible for where the aircraft is.
//
// Both halves leave the aircraft level at its altitude and come down to
// the ground over the last stretch before the airport: a rough shape, but
// it keeps the line attached to the aircraft and shows which end is which.
// The scene is a flat map of one scope, so the line stops at its edge.

const SEGMENTS = 64;
/** Fraction of each half spent level before the line heads for the ground. */
const LEVEL_FRACTION = 0.55;
const COLOR = 0xffffff;

export interface RouteLineAircraft {
  callsign: string | null;
  lat: number;
  lon: number;
  altFt: number;
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Pure: `n + 1` points along the great circle from a to b, ends included.
 * Longitudes come back continuous with a's (no wrap at the antimeridian).
 */
export function greatCircle(a: RoutePoint, b: RoutePoint, n: number): RoutePoint[] {
  const la1 = rad(a.lat);
  const lo1 = rad(a.lon);
  const la2 = rad(b.lat);
  const lo2 = rad(b.lon);
  const ax = Math.cos(la1) * Math.cos(lo1);
  const ay = Math.cos(la1) * Math.sin(lo1);
  const az = Math.sin(la1);
  const bx = Math.cos(la2) * Math.cos(lo2);
  const by = Math.cos(la2) * Math.sin(lo2);
  const bz = Math.sin(la2);
  const omega = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz)));
  const out: RoutePoint[] = [];
  let prevLon = a.lon;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    let x: number;
    let y: number;
    let z: number;
    if (omega < 1e-9) {
      x = ax;
      y = ay;
      z = az;
    } else {
      const s = Math.sin(omega);
      const wa = Math.sin((1 - f) * omega) / s;
      const wb = Math.sin(f * omega) / s;
      x = wa * ax + wb * bx;
      y = wa * ay + wb * by;
      z = wa * az + wb * bz;
    }
    let lon = (Math.atan2(y, x) * 180) / Math.PI;
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    prevLon = lon;
    out.push({ lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI, lon });
  }
  return out;
}

/** Pure: height of the line as a fraction of cruise, `f` = 0 at the aircraft, 1 at the airport. */
export function routeProfile(f: number): number {
  if (f <= LEVEL_FRACTION) return 1;
  const t = Math.min(1, (f - LEVEL_FRACTION) / (1 - LEVEL_FRACTION));
  // Smoothstep down: no kink where the descent starts or where it lands.
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Pure apart from the projection: scene positions from the aircraft out
 * toward an airport, stopping where the path leaves the scope.
 */
export function routeHalf(
  aircraft: RouteLineAircraft,
  airport: RoutePoint,
  rangeNm: number,
  distanceNm: (lat: number, lon: number) => number,
  project: (lat: number, lon: number, altFt: number, out: Vector3) => Vector3,
): number[] {
  const out: number[] = [];
  const tmp = new Vector3();
  const path = greatCircle(aircraft, airport, SEGMENTS);
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (distanceNm(p.lat, p.lon) > rangeNm) break;
    project(p.lat, p.lon, aircraft.altFt * routeProfile(i / SEGMENTS), tmp);
    out.push(tmp.x, tmp.y, tmp.z);
  }
  return out;
}

export interface RouteLine {
  /** The aircraft to draw the route for, or null for none. */
  update(aircraft: RouteLineAircraft | null): void;
}

export function mountRouteLine(parent: Group): RouteLine {
  const group = new Group();
  group.name = 'route-line';
  const base = { color: COLOR, transparent: true, depthWrite: false, clippingPlanes: DIORAMA_PLANES };
  const behind = new Line(new BufferGeometry(), new LineBasicMaterial({ ...base, opacity: 0.28 }));
  const ahead = new Line(
    new BufferGeometry(),
    new LineDashedMaterial({ ...base, opacity: 0.75, dashSize: 1.6, gapSize: 1.1 }),
  );
  for (const line of [behind, ahead]) {
    line.frustumCulled = false;
    line.renderOrder = 7;
    line.visible = false;
    line.userData = { kind: 'route-line' };
    group.add(line);
  }
  parent.add(group);

  const set = (line: Line, points: number[]): void => {
    if (points.length < 6) {
      line.visible = false;
      return;
    }
    line.geometry.dispose();
    line.geometry = new BufferGeometry();
    line.geometry.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
    line.computeLineDistances();
    line.visible = true;
  };

  let lastKey = '';
  const update = (aircraft: RouteLineAircraft | null): void => {
    const route = aircraft?.callsign && getSettings().routeLine ? getRoute(aircraft.callsign) : null;
    if (!aircraft || !route || !route.plausible) {
      if (lastKey !== '') {
        behind.visible = ahead.visible = false;
        lastKey = '';
      }
      return;
    }
    // Rebuilt when the aircraft has moved a little, not every frame.
    const key = `${aircraft.callsign}|${aircraft.lat.toFixed(3)}|${aircraft.lon.toFixed(3)}|${Math.round(aircraft.altFt / 100)}`;
    if (key === lastKey) return;
    lastKey = key;
    set(behind, route.origin_pos ? routeHalf(aircraft, route.origin_pos, RANGE_NM, distanceFromHomeNm, toScene) : []);
    set(ahead, route.destination_pos ? routeHalf(aircraft, route.destination_pos, RANGE_NM, distanceFromHomeNm, toScene) : []);
  };

  // The altitude curve and the toggle both change what the line should be.
  subscribeSettings(() => {
    lastKey = '';
  });
  return { update };
}
