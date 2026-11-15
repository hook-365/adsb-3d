import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  ShapeUtils,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { HOME, RANGE_NM, subscribeHome } from '../core/config';
import { toScene } from '../core/coords';
import { t } from '../core/i18n';
import { getSettings, subscribeSettings } from '../core/settings';
import { fmtAltitude } from '../core/units';
import {
  ALL_KINDS,
  CONTROLLED_KINDS,
  SPECIAL_KINDS,
  airspaceTitle,
  distanceToVolumeNm,
  getAirspace,
  limitsMsl,
  loadAirspace,
  subscribeAirspace,
  volumesAt,
  volumesNear,
  type AirspaceKind,
  type AirspaceVolume,
} from './airspace-volumes';
import { DIORAMA_PLANES } from './diorama-clip';
import { elevationFtAt, subscribeElevation } from './elevation';
import { terrainActive } from './tiles';
import { getTfrs, setTfrsWanted, subscribeTfrs } from './tfr';
import { scheduleFor, scheduleState, type ScheduleState } from './airspace-schedule';

// 3D airspace: US Class B, C and D and special use airspace drawn as the
// volumes they are. Each published piece is a ground outline with a floor
// and a ceiling, so it is extruded between the two through toScene(): a
// Class B shows as its stacked shelves, and everything follows the
// altitude curve and exaggeration like the aircraft do.
//
// Overlapping translucent solids turn to mud, so a volume is mostly
// outline: bright floor and ceiling rings, a very faint wall between them
// and a faint floor on raised shelves. The volumes holding the selected
// aircraft are redrawn brighter (airspaceFor, called by the detail card),
// which is also what fills the card's "Airspace" row.
//
// Colours follow chart convention where there is one (blue Class B,
// magenta Class C, dashed blue Class D) and are a data convention like
// the altitude ramp, so they are not themed.

export const AIRSPACE_COLORS: Readonly<Record<AirspaceKind, number>> = {
  B: 0x4a90ff,
  C: 0xd657c8,
  D: 0x5cc8ff,
  MOA: 0xa98bff,
  R: 0xff6b4a,
  P: 0xff3b3b,
  W: 0xffa040,
  A: 0xe8d44a,
  // Not a chart colour (a TFR is drawn in red there too): it has to stand
  // apart from the red of prohibited and restricted areas next to it.
  TFR: 0xff2f6d,
};

const WALL_OPACITY = 0.07;
const LINE_OPACITY = 0.6;
const FOCUS_WALL_OPACITY = 0.2;
/** Special use airspace outside its published hours is drawn this much fainter. */
const INACTIVE_FADE = 0.3;
/** How often the published hours are checked against the clock. */
const SCHEDULE_CHECK_MS = 60_000;

export interface AirspaceStatus {
  /** Inside, outside, or not settled by the published times of use. */
  state: ScheduleState;
  /** Outside its hours it can still be activated by NOTAM. */
  otherTimesByNotam: boolean;
  intermittent: boolean;
}

/**
 * Where a volume stands against its published times of use right now.
 * Only special use airspace publishes any; everything else, and anything
 * the schedule does not settle, is 'unknown' and drawn as it always was.
 */
export function airspaceStatus(v: AirspaceVolume, now = Date.now()): AirspaceStatus {
  if (!v.times || !SPECIAL_KINDS.includes(v.kind)) {
    return { state: 'unknown', otherTimesByNotam: false, intermittent: false };
  }
  const schedule = scheduleFor(v.times);
  return {
    state: scheduleState(schedule, now, (v.bbox[1] + v.bbox[3]) / 2, (v.bbox[0] + v.bbox[2]) / 2),
    otherTimesByNotam: schedule.otherTimesByNotam,
    intermittent: schedule.intermittent,
  };
}
/** Name labels only this close to the feed's home, nearest first. */
const LABEL_RADIUS_NM = 90;
const MAX_LABELS = 28;
/** Class D fields this close to a labelled Class B or C go unlabelled. */
const D_LABEL_CLEARANCE_NM = 15;
const ELEVATION_SETTLE_MS = 1500;

export function airspaceKindsOn(): Set<AirspaceKind> {
  const s = getSettings();
  return new Set<AirspaceKind>([
    ...(s.airspaceControlled ? CONTROLLED_KINDS : []),
    ...(s.airspaceSpecial ? SPECIAL_KINDS : []),
    ...(s.airspaceTfr ? (['TFR'] as const) : []),
  ]);
}

export function airspaceActive(): boolean {
  return airspaceKindsOn().size > 0;
}

/** Ground elevation used to place "above ground" limits, feet MSL. */
function groundFtAt(lat: number, lon: number): number {
  return terrainActive() ? elevationFtAt(lat, lon) : HOME.altFt;
}

function volumeGroundFt(v: AirspaceVolume): number {
  return groundFtAt((v.bbox[1] + v.bbox[3]) / 2, (v.bbox[0] + v.bbox[2]) / 2);
}

export interface VolumeMesh {
  /** Wall and raised-floor triangles. */
  positions: Float32Array;
  indices: Uint32Array;
  /** Floor and ceiling rings as line segments (x, y, z pairs). */
  lines: Float32Array;
}

/**
 * Pure apart from the projection: extrude volumes between floor and
 * ceiling. `project` maps (lat, lon, feet MSL) to scene space; `groundFt`
 * gives the elevation an "above ground" limit is measured from.
 */
export function buildVolumeMesh(
  volumes: readonly AirspaceVolume[],
  project: (lat: number, lon: number, altFt: number, out: Vector3) => Vector3,
  groundFt: (v: AirspaceVolume) => number,
): VolumeMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const lines: number[] = [];
  const tmp = new Vector3();
  for (const v of volumes) {
    const { lo, hi } = limitsMsl(v, groundFt(v));
    if (!(hi > lo)) continue;
    const raisedFloor = !(v.loAgl && v.loFt === 0);
    for (const poly of v.polygons) {
      const ringBase: number[] = [];
      for (const ring of poly) {
        const n = ring.length / 2;
        const base = positions.length / 3;
        ringBase.push(base);
        // Floor vertices first, then ceiling: vertex i's ceiling twin is base + n + i.
        for (const alt of [lo, hi]) {
          for (let i = 0; i < n; i++) {
            project(ring[i * 2 + 1]!, ring[i * 2]!, alt, tmp);
            positions.push(tmp.x, tmp.y, tmp.z);
          }
        }
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const a = base + i;
          const b = base + j;
          indices.push(a, b, b + n, a, b + n, a + n);
          for (const [p, q] of [[a, b], [a + n, b + n]] as const) {
            lines.push(
              positions[p * 3]!, positions[p * 3 + 1]!, positions[p * 3 + 2]!,
              positions[q * 3]!, positions[q * 3 + 1]!, positions[q * 3 + 2]!,
            );
          }
        }
      }
      if (!raisedFloor || !poly[0]) continue;
      // Floor of a raised shelf: triangulate outline + holes and point the
      // faces at the floor vertices already emitted for the walls.
      const toPoints = (ring: readonly number[]): Vector2[] => {
        const pts: Vector2[] = [];
        for (let i = 0; i + 1 < ring.length; i += 2) pts.push(new Vector2(ring[i]!, ring[i + 1]!));
        return pts;
      };
      const lookup: number[] = [];
      poly.forEach((ring, r) => {
        for (let i = 0; i < ring.length / 2; i++) lookup.push(ringBase[r]! + i);
      });
      for (const face of ShapeUtils.triangulateShape(toPoints(poly[0]), poly.slice(1).map(toPoints))) {
        indices.push(lookup[face[0]!]!, lookup[face[1]!]!, lookup[face[2]!]!);
      }
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), lines: new Float32Array(lines) };
}

function limitText(ft: number, agl: boolean): string {
  if (agl && ft === 0) return 'SFC';
  return agl ? `${fmtAltitude(ft)} AGL` : fmtAltitude(ft);
}

/** "SFC to 10,000 ft"; SFC, AGL and UNL are aviation shorthand and stay untranslated. */
export function airspaceLimits(v: Pick<AirspaceVolume, 'loFt' | 'hiFt' | 'loAgl' | 'hiAgl' | 'unlimited'>): string {
  return t('misc.airspace_limits', {
    lo: limitText(v.loFt, v.loAgl),
    hi: v.unlimited ? 'UNL' : limitText(v.hiFt, v.hiAgl),
  });
}

/** One line for the detail card: "Minneapolis Class B, Area C: 3,000 ft to 10,000 ft". */
export function airspaceSummary(v: AirspaceVolume): string {
  const sector = v.sector ? `, ${airspaceTitle(v.sector)}` : '';
  return `${airspaceTitle(v.name)}${sector}: ${airspaceLimits(v)}`;
}

// ── Layer state shared with the detail card and the info panel ─────
let nearby: AirspaceVolume[] = [];
let drawFocus: (volumes: AirspaceVolume[]) => void = () => {};
// The highlight is the union of two sources: the volumes holding the
// selected aircraft and the airspace pinned by the info panel.
let aircraftFocus: AirspaceVolume[] = [];
let pinnedFocus: readonly AirspaceVolume[] = [];

function setFocus(volumes: AirspaceVolume[]): void {
  aircraftFocus = volumes;
  drawFocus(Array.from(new Set([...pinnedFocus, ...aircraftFocus])));
}

/** Keep these volumes highlighted (the info panel is showing them); empty clears. */
export function pinAirspace(volumes: readonly AirspaceVolume[]): void {
  pinnedFocus = volumes;
  setFocus(aircraftFocus);
}

/** How many of the aircraft are inside any of the volumes right now. */
export function countInside(
  volumes: readonly AirspaceVolume[],
  aircraft: Iterable<{ lat: number; lon: number; altFt: number; onGround: boolean }>,
): number {
  let n = 0;
  for (const a of aircraft) {
    if (volumesAt(volumes, a.lat, a.lon, a.altFt, groundFtAt(a.lat, a.lon), a.onGround).length > 0) n++;
  }
  return n;
}

/** One named airspace as clicked: every shelf, and which bound the whole. */
export interface AirspaceSelection {
  /** The lowest shelf; names and colours the airspace. */
  core: AirspaceVolume;
  volumes: AirspaceVolume[];
  /** Shelves with the lowest floor and the highest ceiling. */
  floor: AirspaceVolume;
  ceiling: AirspaceVolume;
  /** Scene-space bounds, for framing the camera. */
  frame: AirspaceFrame;
}

/**
 * Volumes the aircraft is inside, for the detail card; null clears. Also
 * moves the 3D highlight onto those volumes. Empty while the layer is off.
 */
export function airspaceFor(
  aircraft: { lat: number; lon: number; altFt: number; onGround: boolean } | null,
): AirspaceVolume[] {
  if (!aircraft || nearby.length === 0) {
    setFocus([]);
    return [];
  }
  const inside = volumesAt(nearby, aircraft.lat, aircraft.lon, aircraft.altFt, groundFtAt(aircraft.lat, aircraft.lon), aircraft.onGround);
  setFocus(inside);
  return inside;
}

interface KindLayer {
  walls: Mesh;
  rings: LineSegments;
}

export interface AirspaceFrame {
  /** Centre of the airspace on the ground plane, scene space. */
  center: Vector3;
  /** Horizontal radius of its footprint, scene units. */
  radius: number;
  yLo: number;
  yHi: number;
}

/** Scene-space bounds of a set of volumes (all shelves of one airspace). */
export function frameOf(
  volumes: readonly AirspaceVolume[],
  project: (lat: number, lon: number, altFt: number, out: Vector3) => Vector3,
  groundFt: (v: AirspaceVolume) => number,
): AirspaceFrame | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let yLo = Infinity;
  let yHi = -Infinity;
  const tmp = new Vector3();
  for (const v of volumes) {
    const { lo, hi } = limitsMsl(v, groundFt(v));
    for (const poly of v.polygons) {
      const ring = poly[0];
      if (!ring) continue;
      for (let i = 0; i + 1 < ring.length; i += 2) {
        for (const alt of [lo, hi]) {
          project(ring[i + 1]!, ring[i]!, alt, tmp);
          if (tmp.x < minX) minX = tmp.x;
          if (tmp.x > maxX) maxX = tmp.x;
          if (tmp.z < minZ) minZ = tmp.z;
          if (tmp.z > maxZ) maxZ = tmp.z;
          if (tmp.y < yLo) yLo = tmp.y;
          if (tmp.y > yHi) yHi = tmp.y;
        }
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  return {
    center: new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2),
    radius: Math.hypot(maxX - minX, maxZ - minZ) / 2,
    yLo,
    yHi,
  };
}

export interface AirspaceOptions {
  /** A name label was clicked: bring that airspace into view and describe it. */
  onSelect?: (selection: AirspaceSelection) => void;
}

export function mountAirspace(parent: Group, options: AirspaceOptions = {}): void {
  const group = new Group();
  group.name = 'airspace';
  const focusGroup = new Group();
  focusGroup.name = 'airspace-focus';
  const labelGroup = new Group();
  group.add(focusGroup, labelGroup);

  const wallMats = new Map<AirspaceKind, MeshBasicMaterial>();
  const lineMats = new Map<AirspaceKind, Material>();
  const idleWallMats = new Map<AirspaceKind, MeshBasicMaterial>();
  const idleLineMats = new Map<AirspaceKind, LineBasicMaterial>();
  const focusWallMats = new Map<AirspaceKind, MeshBasicMaterial>();
  const focusLineMats = new Map<AirspaceKind, LineBasicMaterial>();
  for (const kind of ALL_KINDS) {
    const color = AIRSPACE_COLORS[kind];
    const wall = { color, transparent: true, side: DoubleSide, depthWrite: false, clippingPlanes: DIORAMA_PLANES };
    const line = { color, transparent: true, depthWrite: false, clippingPlanes: DIORAMA_PLANES };
    wallMats.set(kind, new MeshBasicMaterial({ ...wall, opacity: WALL_OPACITY }));
    idleWallMats.set(kind, new MeshBasicMaterial({ ...wall, opacity: WALL_OPACITY * INACTIVE_FADE }));
    idleLineMats.set(kind, new LineBasicMaterial({ ...line, opacity: LINE_OPACITY * INACTIVE_FADE }));
    focusWallMats.set(kind, new MeshBasicMaterial({ ...wall, opacity: FOCUS_WALL_OPACITY }));
    // Class D is the dashed blue line on a chart; dash lengths are in NM.
    lineMats.set(
      kind,
      kind === 'D'
        ? new LineDashedMaterial({ ...line, opacity: LINE_OPACITY, dashSize: 0.45, gapSize: 0.3 })
        : new LineBasicMaterial({ ...line, opacity: LINE_OPACITY }),
    );
    focusLineMats.set(kind, new LineBasicMaterial({ ...line, opacity: 1 }));
  }

  const layers: KindLayer[] = [];
  const focusLayers: KindLayer[] = [];
  let focusKey = '';
  let attached = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const makeLayer = (
    volumes: AirspaceVolume[],
    wallMat: Material,
    lineMat: Material,
    order: number,
    target: Group,
  ): KindLayer | null => {
    const mesh = buildVolumeMesh(volumes, toScene, volumeGroundFt);
    if (mesh.indices.length === 0) return null;
    const wallGeo = new BufferGeometry();
    wallGeo.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    wallGeo.setIndex(new BufferAttribute(mesh.indices, 1));
    const walls = new Mesh(wallGeo, wallMat);
    const ringGeo = new BufferGeometry();
    ringGeo.setAttribute('position', new BufferAttribute(mesh.lines, 3));
    const rings = new LineSegments(ringGeo, lineMat);
    if (lineMat instanceof LineDashedMaterial) rings.computeLineDistances();
    for (const obj of [walls, rings]) {
      obj.renderOrder = order;
      obj.frustumCulled = false;
      obj.userData = { kind: 'airspace' };
      target.add(obj);
    }
    return { walls, rings };
  };

  const disposeLayers = (list: KindLayer[]): void => {
    for (const { walls, rings } of list) {
      walls.removeFromParent();
      rings.removeFromParent();
      walls.geometry.dispose();
      rings.geometry.dispose();
    }
    list.length = 0;
  };

  const clearLabels = (): void => {
    for (const child of Array.from(labelGroup.children)) {
      labelGroup.remove(child);
      if (child instanceof CSS2DObject) child.element.remove();
    }
  };

  // One label per named airspace (a Class B's shelves share a name), over
  // its lowest shelf at that shelf's ceiling, with the overall limits.
  const placeLabels = (): void => {
    clearLabels();
    if (!getSettings().airspaceLabels) return;
    const byName = new Map<string, AirspaceVolume[]>();
    for (const v of nearby) {
      if (distanceToVolumeNm(v, HOME.lat, HOME.lon) > LABEL_RADIUS_NM) continue;
      const list = byName.get(v.name);
      if (list) list.push(v);
      else byName.set(v.name, [v]);
    }
    const lowest = (list: AirspaceVolume[]): AirspaceVolume =>
      list.reduce((a, b) => (limitsMsl(b, volumeGroundFt(b)).lo < limitsMsl(a, volumeGroundFt(a)).lo ? b : a));
    const ranked = Array.from(byName.values())
      .map((list) => ({ list, core: lowest(list), dist: Math.min(...list.map((v) => distanceToVolumeNm(v, HOME.lat, HOME.lon))) }))
      // A TFR is the news on the map: it is labelled before anything charted.
      .sort((a, b) => Number(b.core.kind === 'TFR') - Number(a.core.kind === 'TFR') || a.dist - b.dist);
    // A Class B or C sits among satellite Class D fields whose labels
    // would stack on top of it; the big one keeps the label and the
    // satellites stay as their dashed outlines.
    const majors = ranked.filter((g) => g.core.kind === 'B' || g.core.kind === 'C');
    const groups = ranked
      .filter((g) => g.core.kind !== 'D' || !majors.some((m) => distanceToVolumeNm(m.core, (g.core.bbox[1] + g.core.bbox[3]) / 2, (g.core.bbox[0] + g.core.bbox[2]) / 2) <= D_LABEL_CLEARANCE_NM))
      .slice(0, MAX_LABELS);
    const pos = new Vector3();
    for (const { list, core } of groups) {
      const ceiling = list.reduce((a, b) => (limitsMsl(b, volumeGroundFt(b)).hi > limitsMsl(a, volumeGroundFt(a)).hi ? b : a));
      const el = document.createElement('div');
      el.className = 'aircraft-label airspace-label';
      el.style.setProperty('--airspace', `#${AIRSPACE_COLORS[core.kind].toString(16).padStart(6, '0')}`);
      const name = document.createElement('span');
      name.textContent = airspaceTitle(core.name);
      const limits = document.createElement('span');
      limits.className = 'airspace-limits';
      limits.textContent = airspaceLimits({
        loFt: core.loFt,
        loAgl: core.loAgl,
        hiFt: ceiling.hiFt,
        hiAgl: ceiling.hiAgl,
        unlimited: ceiling.unlimited,
      });
      el.append(name, limits);
      if (options.onSelect) {
        // The label is the handle for the whole airspace: click (or Enter)
        // to fly the camera to it and open its info panel.
        const frame = (): void => {
          const box = frameOf(list, toScene, volumeGroundFt);
          if (box) options.onSelect?.({ core, volumes: list, floor: core, ceiling, frame: box });
        };
        el.classList.add('clickable');
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.title = t('misc.airspace_frame');
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          frame();
        });
        el.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          frame();
        });
      }
      const label = new CSS2DObject(el);
      toScene((core.bbox[1] + core.bbox[3]) / 2, (core.bbox[0] + core.bbox[2]) / 2, limitsMsl(core, volumeGroundFt(core)).hi, pos);
      label.position.copy(pos);
      labelGroup.add(label);
    }
  };

  // Which nearby volumes are outside their hours, as one comparable string:
  // the layer is only rebuilt when the clock actually moves one across.
  let idleKey = '';
  const idleSignature = (now: number): string =>
    nearby.map((v) => (airspaceStatus(v, now).state === 'inactive' ? '1' : '0')).join('');

  const rebuild = (): void => {
    disposeLayers(layers);
    disposeLayers(focusLayers);
    focusKey = '';
    clearLabels();
    const all = getAirspace();
    const kinds = airspaceKindsOn();
    nearby = [
      ...(all && kinds.size > 0 ? volumesNear(all, HOME.lat, HOME.lon, RANGE_NM, kinds) : []),
      ...(kinds.has('TFR') ? getTfrs() : []),
    ];
    const now = Date.now();
    const idle = new Set(nearby.filter((v) => airspaceStatus(v, now).state === 'inactive'));
    idleKey = idleSignature(now);
    for (const kind of kinds) {
      const ofKind = nearby.filter((v) => v.kind === kind);
      const layer = makeLayer(ofKind.filter((v) => !idle.has(v)), wallMats.get(kind)!, lineMats.get(kind)!, 8, group);
      if (layer) layers.push(layer);
      // Outside its published hours: still there, much fainter.
      const idleLayer = makeLayer(ofKind.filter((v) => idle.has(v)), idleWallMats.get(kind)!, idleLineMats.get(kind)!, 8, group);
      if (idleLayer) layers.push(idleLayer);
    }
    placeLabels();
    // The highlight was disposed with the layers above; draw it again.
    drawFocus(Array.from(new Set([...pinnedFocus, ...aircraftFocus])));
  };

  drawFocus = (volumes) => {
    const key = volumes.map((v) => `${v.name}|${v.sector ?? ''}|${v.loFt}|${v.hiFt}`).join(';');
    if (key === focusKey) return;
    focusKey = key;
    disposeLayers(focusLayers);
    for (const kind of new Set(volumes.map((v) => v.kind))) {
      const layer = makeLayer(volumes.filter((v) => v.kind === kind), focusWallMats.get(kind)!, focusLineMats.get(kind)!, 9, focusGroup);
      if (layer) focusLayers.push(layer);
    }
  };

  const sync = (): void => {
    const on = airspaceActive();
    if (on && !attached) {
      parent.add(group);
      attached = true;
    } else if (!on && attached) {
      parent.remove(group);
      attached = false;
    }
    // The generated file is only needed for the charted kinds.
    const s = getSettings();
    if ((s.airspaceControlled || s.airspaceSpecial) && !getAirspace()) void loadAirspace();
    setTfrsWanted(s.airspaceTfr);
    rebuild();
  };

  // Everything a rebuild depends on: which kinds are drawn, and labels on or off.
  const layerKey = (): string => `${Array.from(airspaceKindsOn()).join(',')}|${getSettings().airspaceLabels}`;
  let lastKinds = '';
  subscribeSettings(() => {
    const key = layerKey();
    if (key === lastKinds) return;
    lastKinds = key;
    sync();
  });
  setInterval(() => {
    if (attached && idleSignature(Date.now()) !== idleKey) rebuild();
  }, SCHEDULE_CHECK_MS);
  subscribeAirspace(rebuild);
  subscribeTfrs(rebuild);
  subscribeHome(rebuild);
  // "Above ground" limits need the terrain under them, which streams in
  // after boot and after a feed switch: rebuild once it has settled.
  subscribeElevation(() => {
    if (!attached || !terrainActive()) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(rebuild, ELEVATION_SETTLE_MS);
  });
  lastKinds = layerKey();
  sync();
}
