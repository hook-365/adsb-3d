import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShapeUtils,
  Vector2,
  Vector3,
} from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import indexUrl from './airport-ground-index.json?url';
import packUrl from './airport-ground.pack?url';
import { subscribeHome } from '../core/config';
import { enuToLatLon } from '../core/coords';
import { t } from '../core/i18n';
import { setLoading } from '../core/loading';
import { getSettings, subscribeSettings } from '../core/settings';
import { getAirports, loadAirports } from '../feed/explore-airports';
import { nearestAirport } from './activity';
import type { DetailFocus } from './detail-tiles';
import { DIORAMA_PLANES } from './diorama-clip';
import { yieldToAircraft } from './label-yield';
import { terrainSurface } from './tiles';

// Airport ground detail: taxiways, aprons, terminal buildings and gate
// numbers, drawn under the runways for the airport the camera is close to.
//
// Data is OpenStreetMap's (ODbL; credited in the map attribution while the
// layer is on), pre-built for the larger airports by
// scripts/build-airport-ground.py into two files:
//
//   airport-ground-index.json  which airports there is detail for, and
//                              where each one's chunk sits in the pack
//   airport-ground.pack        one gzipped JSON chunk per airport
//
// Like the procedures, only the chunk for the airport in view is fetched
// (an HTTP range request). Nothing is asked of OpenStreetMap at runtime.
//
// Everything above the loader is pure.

/** The layer is built when the camera is this close to what it looks at, NM. */
const SHOW_WITHIN_NM = 14;
/** ...and looks at a point this near an airport that has detail, NM. */
const AIRPORT_WITHIN_NM = 6;
/** Gate numbers only from close in, and no more than this many. */
const GATES_WITHIN_NM = 1.6;
const MAX_GATE_LABELS = 160;
const CHECK_MS = 500;
/** Airports kept built at once: panning between neighbours does not rebuild. */
const KEEP = 3;
/** Drawn widths, NM. A taxiway is about 75 ft; a little wider reads better from a mile up. */
const TAXIWAY_NM = 0.016;
const TAXILANE_NM = 0.01;
/** Just under the runways (world/airports.ts lifts those 0.004). */
const LIFT = 0.003;
const APRON_COLOR = 0x3d4652;
const TAXI_COLOR = 0x66717f;
const TERMINAL_COLOR = 0x4d6f96;

export interface GroundChunk {
  /** Taxiways and taxilanes as [lat, lon] polylines. */
  taxi: { main: boolean; line: [number, number][] }[];
  aprons: [number, number][][];
  terminals: [number, number][][];
  gates: { ref: string; lat: number; lon: number }[];
}

/** Flat [lat, lon, dlat, dlon, ...] integers back to [lat, lon] degrees. */
export function decodeLine(flat: readonly number[], scale: number): [number, number][] {
  const out: [number, number][] = [];
  let lat = 0;
  let lon = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    lat += flat[i]!;
    lon += flat[i + 1]!;
    out.push([lat / scale, lon / scale]);
  }
  return out;
}

/** Parse one airport's chunk; anything malformed is left out. */
export function decodeChunk(raw: unknown, scale: number): GroundChunk {
  const doc = (raw ?? {}) as { t?: unknown; a?: unknown; b?: unknown; g?: unknown };
  const numbers = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number');
  const rings = (v: unknown): [number, number][][] =>
    (Array.isArray(v) ? v : [])
      .filter(numbers)
      .map((flat) => decodeLine(flat, scale))
      .filter((ring) => ring.length >= 3);
  const taxi: GroundChunk['taxi'] = [];
  for (const item of Array.isArray(doc.t) ? (doc.t as unknown[]) : []) {
    if (!Array.isArray(item) || !numbers(item[1])) continue;
    const line = decodeLine(item[1], scale);
    if (line.length >= 2) taxi.push({ main: item[0] === 1, line });
  }
  const gates: GroundChunk['gates'] = [];
  for (const item of Array.isArray(doc.g) ? (doc.g as unknown[]) : []) {
    if (!Array.isArray(item)) continue;
    const [ref, lat, lon] = item as unknown[];
    if (typeof ref === 'string' && typeof lat === 'number' && typeof lon === 'number') {
      gates.push({ ref, lat: lat / scale, lon: lon / scale });
    }
  }
  return { taxi, aprons: rings(doc.a), terminals: rings(doc.b), gates };
}

/**
 * The quads of a ribbon `widthNm` wide along a polyline: for each segment
 * its four corners as [lat, lon], in order around the rectangle.
 */
export function ribbonQuads(line: readonly [number, number][], widthNm: number): [number, number][][] {
  const quads: [number, number][][] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const [aLat, aLon] = line[i]!;
    const [bLat, bLon] = line[i + 1]!;
    const cos = Math.cos((aLat * Math.PI) / 180);
    const north = (bLat - aLat) * 60;
    const east = (bLon - aLon) * 60 * cos;
    const len = Math.hypot(north, east);
    if (len === 0) continue;
    // Half the width, across the segment, back in degrees.
    const dLat = ((-east / len) * widthNm) / 2 / 60;
    const dLon = ((north / len) * widthNm) / 2 / (60 * cos);
    quads.push([
      [aLat + dLat, aLon + dLon],
      [bLat + dLat, bLon + dLon],
      [bLat - dLat, bLon - dLon],
      [aLat - dLat, aLon - dLon],
    ]);
  }
  return quads;
}

export function airportGroundActive(): boolean {
  return getSettings().airportGround;
}

// ── Loader ──────────────────────────────────────────────────────────

interface GroundIndex {
  scale: number;
  airports: Record<string, [number, number]>;
}

let index: GroundIndex | null = null;
let indexLoading: Promise<void> | null = null;
const chunks = new Map<string, Promise<GroundChunk | null>>();

function loadIndex(): Promise<void> {
  if (index) return Promise.resolve();
  indexLoading ??= fetch(indexUrl)
    .then((res) => (res.ok ? (res.json() as Promise<GroundIndex>) : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((doc) => {
      if (typeof doc?.scale !== 'number' || !doc.airports) throw new Error('unexpected shape');
      index = doc;
    })
    .catch((err: unknown) => {
      console.warn('[airport-ground] could not load the index', err);
      indexLoading = null;
    });
  return indexLoading;
}

function loadChunk(icao: string): Promise<GroundChunk | null> {
  const entry = index?.airports[icao];
  if (!index || !entry) return Promise.resolve(null);
  const scale = index.scale;
  let pending = chunks.get(icao);
  if (!pending) {
    setLoading('airport-ground', t('settings.airport_ground'));
    pending = (async (): Promise<GroundChunk | null> => {
      const [offset, length] = entry;
      const res = await fetch(packUrl, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
      // 206 is the slice asked for; a server that ignores ranges sends it all.
      if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`);
      let bytes = new Uint8Array(await res.arrayBuffer());
      if (res.status === 200) bytes = bytes.subarray(offset, offset + length);
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return decodeChunk(JSON.parse(await new Response(stream).text()), scale);
    })()
      .catch((err: unknown) => {
        console.warn('[airport-ground] could not load', icao, err);
        chunks.delete(icao);
        return null;
      })
      .finally(() => setLoading('airport-ground', null));
    chunks.set(icao, pending);
  }
  return pending;
}

export interface AirportGround {
  /** Call every frame; it looks at the camera a couple of times a second. */
  update(now: number, focus: DetailFocus | null): void;
}

export function mountAirportGround(parent: Group): AirportGround {
  const root = new Group();
  root.name = 'airport-ground';
  parent.add(root);
  const flat = { side: DoubleSide, depthWrite: false, clippingPlanes: DIORAMA_PLANES, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -5 };
  const apronMat = new MeshBasicMaterial({ ...flat, color: APRON_COLOR });
  const taxiMat = new MeshBasicMaterial({ ...flat, color: TAXI_COLOR });
  const terminalMat = new MeshBasicMaterial({ ...flat, color: TERMINAL_COLOR });

  /** Built airports, oldest first. */
  const built = new Map<string, { group: Group; gates: Group; chunk: GroundChunk }>();
  let lastCheck = 0;
  let wanted: string | null = null;
  const tmp = new Vector3();

  const mesh = (triangles: [number, number][], material: MeshBasicMaterial, order: number): Mesh | null => {
    if (triangles.length === 0) return null;
    const positions = new Float32Array(triangles.length * 3);
    triangles.forEach(([lat, lon], i) => {
      terrainSurface(lat, lon, tmp);
      positions.set([tmp.x, tmp.y + LIFT, tmp.z], i * 3);
    });
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    const m = new Mesh(geom, material);
    m.renderOrder = order;
    m.frustumCulled = false;
    m.raycast = () => {};
    m.userData = { kind: 'airport-ground' };
    return m;
  };

  const fill = (rings: readonly [number, number][][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const ring of rings) {
      // Triangulated on a local flat map: an airport is a few miles across.
      const cos = Math.cos((ring[0]![0] * Math.PI) / 180);
      const contour = ring.map(([lat, lon]) => new Vector2(lon * cos, lat));
      for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) out.push(ring[a!]!, ring[b!]!, ring[c!]!);
    }
    return out;
  };

  const build = (icao: string, chunk: GroundChunk): void => {
    const group = new Group();
    group.name = `airport-ground-${icao}`;
    const ribbons: [number, number][] = [];
    for (const { main, line } of chunk.taxi) {
      for (const [a, b, c, d] of ribbonQuads(line, main ? TAXIWAY_NM : TAXILANE_NM)) ribbons.push(a!, b!, c!, a!, c!, d!);
    }
    // Between the detail tiles (-9.5) and the runways (-9), aprons lowest.
    for (const m of [mesh(fill(chunk.aprons), apronMat, -9.4), mesh(ribbons, taxiMat, -9.3), mesh(fill(chunk.terminals), terminalMat, -9.2)]) {
      if (m) group.add(m);
    }
    const gates = new Group();
    gates.visible = false;
    yieldToAircraft(gates);
    for (const gate of chunk.gates.slice(0, MAX_GATE_LABELS)) {
      const el = document.createElement('div');
      el.className = 'aircraft-label gate-label';
      el.textContent = gate.ref;
      const label = new CSS2DObject(el);
      terrainSurface(gate.lat, gate.lon, tmp);
      label.position.set(tmp.x, tmp.y + 0.01, tmp.z);
      gates.add(label);
    }
    group.add(gates);
    root.add(group);
    built.set(icao, { group, gates, chunk });
  };

  const drop = (icao: string): void => {
    const entry = built.get(icao);
    if (!entry) return;
    built.delete(icao);
    entry.group.removeFromParent();
    entry.group.traverse((obj) => {
      if (obj instanceof Mesh) (obj.geometry as BufferGeometry).dispose();
      if (obj instanceof CSS2DObject) obj.element.remove();
    });
  };

  const dropAll = (): void => {
    for (const icao of Array.from(built.keys())) drop(icao);
    wanted = null;
  };

  const update = (now: number, focus: DetailFocus | null): void => {
    if (now - lastCheck < CHECK_MS) return;
    lastCheck = now;
    if (!airportGroundActive() || !focus || focus.distance > SHOW_WITHIN_NM) {
      root.visible = false;
      // CSS labels do not follow their parent's visibility by themselves.
      for (const entry of built.values()) entry.gates.visible = false;
      wanted = null;
      return;
    }
    root.visible = true;
    const airports = getAirports();
    if (!index || !airports) {
      void loadIndex();
      void loadAirports();
      return;
    }
    const at = enuToLatLon(focus.x, -focus.z);
    const near = nearestAirport(
      at.lat,
      at.lon,
      airports.filter((a) => index!.airports[a.icao] !== undefined),
      AIRPORT_WITHIN_NM,
    )?.airport.icao;
    for (const [icao, entry] of built) entry.gates.visible = icao === near && focus.distance <= GATES_WITHIN_NM;
    if (!near || near === wanted) return;
    wanted = near;
    if (built.has(near)) return;
    void loadChunk(near).then((chunk) => {
      if (!chunk || wanted !== near || built.has(near)) return;
      build(near, chunk);
      while (built.size > KEEP) drop(built.keys().next().value as string);
    });
  };

  subscribeHome(dropAll);
  let lastKey = '';
  subscribeSettings(() => {
    const s = getSettings();
    if (!s.airportGround) dropAll();
    // Everything lies on the terrain, which these move.
    const key = `${s.altitudeExaggeration}|${s.altitudeCurveBias}|${s.terrain3d}`;
    if (key === lastKey) return;
    lastKey = key;
    for (const [icao, entry] of Array.from(built)) {
      drop(icao);
      build(icao, entry.chunk);
    }
  });
  return { update };
}
