import { Group, Vector3 } from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { registerLineMaterial } from '../aircraft/reconciler';
import { RANGE_NM, subscribeHome } from '../core/config';
import { distanceFromHomeNm } from '../core/coords';
import { subscribeSettings } from '../core/settings';
import { runwaysOf, type Runway } from './airports';
import { DIORAMA_PLANES } from './diorama-clip';
import { yieldToAircraft } from './label-yield';
import {
  distanceNm,
  segmentGeometry,
  type PathPoint,
  type ProcedureFix,
  type ProcedurePath,
  type Segment,
} from './procedure-geometry';
import { getProcedureIndex, loadAirportDetail, type ProcedureKind } from './procedures';
import { toSceneSeated } from './tiles';

// The one procedure the user picked in the airport card, drawn in full:
// an approach with its transitions and missed approach, an arrival or a
// departure with every transition. Solid where the path runs fix to fix,
// dashed where it is an approximation (vectors, climbs, holds; see
// procedure-geometry.ts), with the fixes named and their altitude limits
// beside them.
//
// One procedure at a time. It is fetched on demand (world/procedures.ts)
// and cleared when the card closes, the feed changes, or another is picked.

const COLOR = 0xffd166;
/** Brightness of the main route against its transitions. */
const MAIN = 1;
const SIDE = 0.5;
/** Longest piece of a leg, NM: the altitude curve bends long straight lines. */
const MAX_PIECE_NM = 3;
const MAX_FIX_LABELS = 36;
/** Used where a procedure says nothing about altitude at all. */
const DEFAULT_ABOVE_FIELD_FT = 4000;

export interface ProcedureFrame {
  center: Vector3;
  radius: number;
  yLo: number;
  yHi: number;
}

/** One classed polyline of a procedure, ready to draw. */
export interface ProcedurePart {
  points: PathPoint[];
  approximate: boolean;
  /** Part of the procedure's main route, as opposed to one of its transitions. */
  main: boolean;
}

/** Departure end of a runway named like a CIFP transition: 'RW12R', 'RW12B' (both sides), 'RW04'. */
export function departureStarts(transition: string, runways: readonly Runway[]): PathPoint[] {
  const m = /^RW(\d{2})([LRCB]?)$/.exec(transition);
  if (!m) return [];
  const out: PathPoint[] = [];
  for (const r of runways) {
    for (const [ident, lat, lon, elev] of [
      // Taking off on the low-numbered end, the aircraft leaves the ground toward the high end.
      [r.lowIdent, r.highLat, r.highLon, r.highElevFt],
      [r.highIdent, r.lowLat, r.lowLon, r.lowElevFt],
    ] as const) {
      const matches = m[2] === 'B' ? ident.slice(0, 2) === m[1] : ident === `${m[1]}${m[2]}`;
      if (matches) out.push({ lat, lon, altFt: elev });
    }
  }
  return out;
}

/**
 * Pure: every polyline and fix of a procedure. An approach's final route is
 * its main part up to the missed approach point; what follows is the missed
 * approach, drawn as approximate. A STAR's or SID's common route (types 2,
 * 5, 8) is the main part and the rest are transitions.
 */
export function procedureParts(
  kind: ProcedureKind,
  segments: readonly Segment[],
  magVar: number,
  runways: readonly Runway[],
): { parts: ProcedurePart[]; fixes: ProcedureFix[] } {
  const parts: ProcedurePart[] = [];
  const fixes = new Map<string, ProcedureFix>();
  const add = (paths: ProcedurePath[], main: boolean, forceApproximate = false): void => {
    for (const p of paths) parts.push({ points: p.points, approximate: p.approximate || forceApproximate, main });
  };
  const note = (list: ProcedureFix[]): void => {
    for (const f of list) {
      const have = fixes.get(f.name);
      // The same fix on two segments: keep the one that says more.
      if (!have || (have.limit === '' && f.limit !== '') || (have.role === '' && f.role !== '')) fixes.set(f.name, f);
    }
  };

  for (const segment of segments) {
    if (kind === 'approach' && segment.r !== 'A') {
      const mapAt = segment.legs.findIndex((leg) => leg.r === 'M');
      const final = segmentGeometry({ ...segment, legs: mapAt < 0 ? segment.legs : segment.legs.slice(0, mapAt + 1) }, { magVar });
      add(final.paths, true);
      note(final.fixes);
      if (mapAt >= 0 && mapAt + 1 < segment.legs.length) {
        const missed = segmentGeometry({ ...segment, legs: segment.legs.slice(mapAt + 1) }, { magVar, start: final.end });
        add(missed.paths, false, true);
        note(missed.fixes);
      }
      continue;
    }
    const main = kind !== 'approach' && '258'.includes(segment.r);
    const starts = segment.legs[0]?.p ? [null] : departureStarts(segment.t, runways);
    for (const start of starts.length > 0 ? starts : [null]) {
      const g = segmentGeometry(segment, { magVar, start });
      add(g.paths, main);
      note(g.fixes);
    }
  }
  return { parts, fixes: Array.from(fixes.values()) };
}

export interface ProcedureLayer {
  /** Draw one procedure; resolves to where it is, or null if there was nothing to draw. */
  show(icao: string, kind: ProcedureKind, id: string, fieldElevFt: number): Promise<ProcedureFrame | null>;
  clear(): void;
}

export function mountProcedureLayer(parent: Group): ProcedureLayer {
  const group = new Group();
  group.name = 'procedure';
  const labelGroup = new Group();
  group.add(labelGroup);
  yieldToAircraft(labelGroup);
  parent.add(group);

  const solidMat = new LineMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const dashedMat = new LineMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    dashed: true,
    dashSize: 0.5,
    gapSize: 0.35,
  });
  for (const m of [solidMat, dashedMat]) {
    m.clippingPlanes = DIORAMA_PLANES;
    registerLineMaterial(m, 1.1);
  }

  let lines: LineSegments2[] = [];
  let token = 0;
  let shown: { icao: string; kind: ProcedureKind; id: string; fieldElevFt: number } | null = null;
  const tmp = new Vector3();

  const dispose = (): void => {
    for (const line of lines) {
      line.removeFromParent();
      line.geometry.dispose();
    }
    lines = [];
    for (const child of Array.from(labelGroup.children)) {
      labelGroup.remove(child);
      if (child instanceof CSS2DObject) child.element.remove();
    }
  };

  const clear = (): void => {
    token++;
    shown = null;
    dispose();
  };

  const draw = (parts: ProcedurePart[], fixes: ProcedureFix[], fieldElevFt: number): ProcedureFrame | null => {
    dispose();
    const fallback = fieldElevFt + DEFAULT_ABOVE_FIELD_FT;
    const r = ((COLOR >> 16) & 255) / 255;
    const g = ((COLOR >> 8) & 255) / 255;
    const b = (COLOR & 255) / 255;
    const buckets = { solid: { pos: [] as number[], col: [] as number[] }, dashed: { pos: [] as number[], col: [] as number[] } };
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let yLo = Infinity;
    let yHi = -Infinity;
    const vertex = (bucket: { pos: number[]; col: number[] }, p: PathPoint, shade: number): void => {
      toSceneSeated(p.lat, p.lon, p.altFt ?? fallback, tmp);
      bucket.pos.push(tmp.x, tmp.y, tmp.z);
      bucket.col.push(r * shade, g * shade, b * shade);
      if (tmp.x < minX) minX = tmp.x;
      if (tmp.x > maxX) maxX = tmp.x;
      if (tmp.z < minZ) minZ = tmp.z;
      if (tmp.z > maxZ) maxZ = tmp.z;
      if (tmp.y < yLo) yLo = tmp.y;
      if (tmp.y > yHi) yHi = tmp.y;
    };
    for (const part of parts) {
      const bucket = part.approximate ? buckets.dashed : buckets.solid;
      const shade = part.main ? MAIN : SIDE;
      for (let i = 0; i + 1 < part.points.length; i++) {
        const a = part.points[i]!;
        const c = part.points[i + 1]!;
        // The scene is one scope: a leg wholly outside it is not drawn.
        if (distanceFromHomeNm(a.lat, a.lon) > RANGE_NM * 1.1 && distanceFromHomeNm(c.lat, c.lon) > RANGE_NM * 1.1) continue;
        const pieces = Math.max(1, Math.ceil(distanceNm(a.lat, a.lon, c.lat, c.lon) / MAX_PIECE_NM));
        const at = (f: number): PathPoint => ({
          lat: a.lat + (c.lat - a.lat) * f,
          lon: a.lon + (c.lon - a.lon) * f,
          altFt: (a.altFt ?? fallback) + ((c.altFt ?? fallback) - (a.altFt ?? fallback)) * f,
        });
        for (let k = 0; k < pieces; k++) {
          vertex(bucket, at(k / pieces), shade);
          vertex(bucket, at((k + 1) / pieces), shade);
        }
      }
    }
    for (const [bucket, material] of [
      [buckets.solid, solidMat],
      [buckets.dashed, dashedMat],
    ] as const) {
      if (bucket.pos.length === 0) continue;
      const geom = new LineSegmentsGeometry();
      geom.setPositions(bucket.pos);
      geom.setColors(bucket.col);
      const line = new LineSegments2(geom, material);
      if (material.dashed) line.computeLineDistances();
      line.raycast = () => {};
      line.frustumCulled = false;
      line.renderOrder = 8;
      line.userData = { kind: 'procedure' };
      group.add(line);
      lines.push(line);
    }
    if (lines.length === 0) return null;

    // Fixes that carry a role or an altitude first; the rest as room allows.
    const ranked = fixes
      .filter((f) => distanceFromHomeNm(f.lat, f.lon) <= RANGE_NM)
      .sort((x, y) => Number(y.role !== '' || y.limit !== '') - Number(x.role !== '' || x.limit !== ''))
      .slice(0, MAX_FIX_LABELS);
    for (const fix of ranked) {
      const el = document.createElement('div');
      el.className = 'aircraft-label procedure-fix';
      const name = document.createElement('span');
      name.textContent = fix.name;
      el.append(name);
      if (fix.limit) {
        const limit = document.createElement('span');
        limit.className = 'procedure-limit';
        limit.textContent = fix.limit;
        el.append(limit);
      }
      const label = new CSS2DObject(el);
      toSceneSeated(fix.lat, fix.lon, fix.altFt ?? fallback, tmp);
      label.position.copy(tmp);
      labelGroup.add(label);
    }

    return {
      center: new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2),
      radius: Math.max(2, Math.hypot(maxX - minX, maxZ - minZ) / 2),
      yLo,
      yHi,
    };
  };

  const show = async (icao: string, kind: ProcedureKind, id: string, fieldElevFt: number): Promise<ProcedureFrame | null> => {
    const mine = ++token;
    const detail = await loadAirportDetail(icao);
    if (mine !== token) return null;
    const segments = detail?.[kind]?.[id];
    const entry = getProcedureIndex()?.airports[icao];
    if (!segments || !entry) {
      clear();
      return null;
    }
    shown = { icao, kind, id, fieldElevFt };
    const { parts, fixes } = procedureParts(kind, segments, entry.v, runwaysOf(icao));
    return draw(parts, fixes, fieldElevFt);
  };

  // The procedure belongs to the feed it was picked in.
  subscribeHome(clear);
  // The altitude curve moves everything; draw it again where it now belongs.
  subscribeSettings(() => {
    if (shown) void show(shown.icao, shown.kind, shown.id, shown.fieldElevFt);
  });

  return { show, clear };
}
