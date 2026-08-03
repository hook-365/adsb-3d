import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Frustum,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  SphereGeometry,
  Vector3
} from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Aircraft } from '../core/types';
import { AircraftStore, TRAIL_CAPACITY } from './store';
import { toScene } from '../core/coords';
import { elevationFtAt } from '../world/elevation';
import { resolveShape, getShapeTexture, shapeRotates } from './shapes';
import { getSettings, subscribeSettings } from '../core/settings';
import { getTheme, subscribeTheme } from '../core/theme';
import { passesFilter } from '../core/filter';
import { altitudeColorCached, altitudeColorStyleCached } from '../core/altitude-color';

// Each aircraft is a Group: a cone pointing along its heading + a vertical
// altitude line dropping to the ground plane + a positional trail. The
// reconciler is the only place that touches scene mutation for aircraft,
// so there can be no orphans by construction — drop a hex from the store
// and it disappears from the scene on the next syncFrame() call.

// Cone tip at -z (= north in our scene). yaw=-track rotates the nose to
// face the heading direction.
const CONE_GEOMETRY = new ConeGeometry(0.6, 2.4, 6);
CONE_GEOMETRY.rotateX(-Math.PI / 2);
const CONE_GEOMETRY_GROUND = new ConeGeometry(0.4, 1.4, 6);
CONE_GEOMETRY_GROUND.rotateX(-Math.PI / 2);

// Trail / ring colors come from the active theme. The shared materials
// below are mutated in place by the module-level theme subscriber further
// down so a theme change recolors every aircraft on the next paint.
const themeThree = () => getTheme().tokens.three;
const LINE_MAT_DEFAULT = new LineBasicMaterial({
  color: new Color(themeThree().trailDefault),
  transparent: true,
  opacity: 0.35,
});

// Stale-data dimming: aircraft we haven't heard from recently fade toward
// transparent so it's obvious which contacts are still actively reporting.
// readsb keeps publishing the last position for a while after the messages
// stop, then eventually drops the aircraft from the snapshot entirely.
const STALE_FRESH_MS = 15_000;  // < 15s old → full opacity
const STALE_FADED_MS = 60_000;  // ≥ 60s old → minimum opacity
const STALE_MIN_OPACITY = 0.4;

function staleness(ageMs: number): number {
  if (ageMs <= STALE_FRESH_MS) return 1;
  if (ageMs >= STALE_FADED_MS) return STALE_MIN_OPACITY;
  const t = (ageMs - STALE_FRESH_MS) / (STALE_FADED_MS - STALE_FRESH_MS);
  return 1 - t * (1 - STALE_MIN_OPACITY);
}

// tar1090-style trails: each segment colored by the altitude at that
// segment (no fade-to-background), and segments that bridge a > 30s feed
// gap are rendered dashed instead of solid. Both lines share materials
// across all aircraft because the per-aircraft / per-altitude color is
// supplied via vertex attributes.
const TRAIL_GAP_THRESHOLD_MS = 30_000;
// Initial per-side vertex capacity for each aircraft's trail buffer. Sized
// to comfortably hold the default 600-point cap; aircraft whose feed
// allows longer trails (e.g. the local feed at unlimited) grow past this
// via growTrailBuffer when refreshTrail needs more room. Bounded-cap feeds
// saturate at this size and never grow.
const INITIAL_TRAIL_CAPACITY_VERTS = (TRAIL_CAPACITY - 1) * 2;
const DYNAMIC_DRAW_USAGE = 35048;
const TRAIL_MAT_SOLID = new LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.55,
});
const TRAIL_MAT_DASHED = new LineDashedMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.45,
  dashSize: 0.6,
  gapSize: 0.4,
});
// Brighter / fully-opaque variants used for the currently selected aircraft.
// Same materials shared across all aircraft (only one is "selected" at a time
// — the reconciler swaps the material reference on the LineSegments object).
const TRAIL_MAT_SOLID_SELECTED = new LineBasicMaterial({
  vertexColors: true,
  transparent: false,
  opacity: 1.0,
  linewidth: 2,
});
const TRAIL_MAT_DASHED_SELECTED = new LineDashedMaterial({
  vertexColors: true,
  transparent: false,
  opacity: 1.0,
  dashSize: 0.6,
  gapSize: 0.4,
  linewidth: 2,
});

// Aircraft colors (cone / trail / icon) come from the tar1090 ColorByAlt
// palette in core/altitude-color.ts — shared so the footer legend matches.

interface RenderEntry {
  group: Group;
  cone: Mesh;
  altLine: Line;
  trailSolid: LineSegments;
  trailDashed: LineSegments;
  solidPos: BufferAttribute;
  solidCol: BufferAttribute;
  dashedPos: BufferAttribute;
  dashedCol: BufferAttribute;
  material: MeshStandardMaterial;
  iconMesh: Mesh;
  iconMaterial: MeshBasicMaterial;
  iconRotates: boolean;
  emergencyRing: Mesh;
  pingRing: Mesh;
  pingMaterial: MeshBasicMaterial;
  pingStartMs: number | null;
  label: CSS2DObject;
  labelEl: HTMLElement;
  selectionRing: Mesh;
  pickMaterial: MeshBasicMaterial;
  lastTrailLength: number;
  lastLabelText: string;
  lastLabelClass: string;
  lastLabelColor: string;
  lastLabelOpacity: number;
  isMilitary: boolean;
  isSelected: boolean;
  // Per-frame skip gates. lastRev tracks the store's record rev for this
  // hex; when it matches the current rev, refreshColor/applyTransform/
  // refreshLabel and emergency/selection ring placement are all skipped
  // because nothing visible has changed. lastTrailRev gates refreshTrail
  // similarly. lastStaleness caches the most recently assigned opacity so
  // we skip material mutations when the wall-clock fade hasn't drifted.
  lastRev: number;
  lastTrailRev: number;
  lastStaleness: number;
  // Yaw cache: skip rebuilding the cone + icon quaternions when trackDeg
  // matches the last value applied. NaN sentinel forces a write on the
  // first applyTransform (no real trackDeg ever equals NaN).
  lastTrackDeg: number;
  // Current per-side trail buffer capacity in vertices. growTrailBuffer
  // bumps these when an unlimited-cap feed (or a per-aircraft extended
  // selection) outgrows the initial allocation.
  solidCapacityVerts: number;
  dashedCapacityVerts: number;
  // State for refreshTrail's incremental tail-append fast path. When the
  // trail's first sample is unchanged since last refresh and only new
  // points were added at the tail, we resume writing from these saved
  // indices instead of rewalking all N points. NaN sentinels and 0
  // indices force a full rebuild on first refresh / after mergeHistory.
  lastTrailFirstMs: number;
  lastTrailLastMs: number;
  lastTrailLastX: number;
  lastTrailLastY: number;
  lastTrailLastZ: number;
  lastTrailLastR: number;
  lastTrailLastG: number;
  lastTrailLastB: number;
  lastSolidIdx: number;
  lastDashedIdx: number;
}

// Ground-projected aircraft shape icon. Sized in scene units; per-aircraft
// scaling stretches/shrinks based on the resolver's per-type scaling factor.
// Y offset lifts it just above the world plane so it doesn't z-fight terrain.
const ICON_BASE_SIZE = 5.5;
const ICON_GROUND_Y = 0.05;

const SELECTION_RING_GEOMETRY = new RingGeometry(2.0, 2.6, 64);
SELECTION_RING_GEOMETRY.rotateX(-Math.PI / 2);
// ACARS ping: thin ring that expands outward and fades when an ACARS
// message arrives for an aircraft on scope. Lives in the horizontal
// plane like the selection / emergency rings.
const PING_RING_GEOMETRY = new RingGeometry(1.0, 1.2, 48);
PING_RING_GEOMETRY.rotateX(-Math.PI / 2);
const PING_DURATION_MS = 1800;
const PING_MAX_SCALE = 4.5;
// Slightly larger so it haloes around the cyan selection ring when both apply.
const EMERGENCY_RING_GEOMETRY = new RingGeometry(2.9, 3.6, 64);
EMERGENCY_RING_GEOMETRY.rotateX(-Math.PI / 2);
const EMERGENCY_RING_MATERIAL = new MeshBasicMaterial({
  color: new Color(themeThree().emergencyRing),
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  side: DoubleSide,
});

// Per-entry materials (selection ring + ping ring) — tracked in Sets so the
// theme subscriber can recolor every live aircraft when the user switches
// themes. Sets are kept tight by removing entries on aircraft cleanup
// (see `entries.delete` below).
const SELECTION_MATERIALS = new Set<MeshBasicMaterial>();
const PING_MATERIALS = new Set<MeshBasicMaterial>();

subscribeTheme((tokens) => {
  const t = tokens.three;
  LINE_MAT_DEFAULT.color.set(t.trailDefault);
  EMERGENCY_RING_MATERIAL.color.set(t.emergencyRing);
  for (const m of SELECTION_MATERIALS) m.color.set(t.selectionRing);
  for (const m of PING_MATERIALS) m.color.set(t.acarsPing);
});

// Invisible bounding sphere centered on each cone, used as a forgiving
// raycast target so the user doesn't have to pixel-hunt the small cones —
// especially important for touch where the "pixel" is a fingertip.
const PICK_GEOMETRY = new SphereGeometry(4.5, 12, 8);

function aircraftLabelText(a: Aircraft): string {
  if (a.callsign) return a.callsign;
  if (a.registration) return a.registration;
  return a.hex.toUpperCase();
}

function aircraftLabelClass(a: Aircraft): string {
  // Color is driven by the altitude palette (set inline in refreshLabel),
  // so the class only carries one optional modifier — `ground`, which
  // dims and de-emphasizes labels for surface traffic. Military and
  // high-altitude already differentiate via the inline altitude color.
  let cls = 'aircraft-label';
  if (a.onGround) cls += ' ground';
  return cls;
}

const tmpPos = new Vector3();
const tmpGround = new Vector3();
const tmpTrail = new Vector3();

function buildTrailLine(material: LineBasicMaterial | LineDashedMaterial): {
  line: LineSegments;
  pos: BufferAttribute;
  col: BufferAttribute;
} {
  const geom = new BufferGeometry();
  const pos = new BufferAttribute(new Float32Array(INITIAL_TRAIL_CAPACITY_VERTS * 3), 3);
  pos.setUsage(DYNAMIC_DRAW_USAGE);
  const col = new BufferAttribute(new Float32Array(INITIAL_TRAIL_CAPACITY_VERTS * 3), 3);
  col.setUsage(DYNAMIC_DRAW_USAGE);
  geom.setAttribute('position', pos);
  geom.setAttribute('color', col);
  geom.setDrawRange(0, 0);
  const line = new LineSegments(geom, material);
  // frustumCulled=false skips three.js's per-frame frustum test against the
  // bounding sphere — trails span large bounding volumes anyway and the
  // alternative (computing the sphere over a growable buffer with unused
  // tail) is both wrong and expensive.
  line.frustumCulled = false;
  return { line, pos, col };
}

// Replace one side's (pos, col) BufferAttributes on the trail geometry
// with larger allocations when `requiredVerts` exceeds current capacity.
// Doubles the buffer size to amortize the cost of subsequent growths.
// Three.js doesn't have a native resize for BufferAttribute, so we
// allocate fresh Float32Arrays and re-bind via setAttribute. refreshTrail
// rewrites the entire trail after a grow, so we don't bother copying old
// vertex data — it would only be partially valid anyway with the dashed/
// solid side split potentially shifting.
function growTrailBuffer(
  line: LineSegments,
  currentVerts: number,
  requiredVerts: number,
): { pos: BufferAttribute; col: BufferAttribute; verts: number } | null {
  if (requiredVerts <= currentVerts) return null;
  const newVerts = Math.max(currentVerts * 2, requiredVerts);
  const pos = new BufferAttribute(new Float32Array(newVerts * 3), 3);
  pos.setUsage(DYNAMIC_DRAW_USAGE);
  const col = new BufferAttribute(new Float32Array(newVerts * 3), 3);
  col.setUsage(DYNAMIC_DRAW_USAGE);
  line.geometry.setAttribute('position', pos);
  line.geometry.setAttribute('color', col);
  return { pos, col, verts: newVerts };
}

function buildEntry(a: Aircraft): RenderEntry {
  // Cone, ground icon, and trail use the plain altitude palette regardless
  // of military status — military traffic now reads via the label color
  // (red) rather than recoloring the whole aircraft. Keeps altitude as the
  // primary visual hue cue everywhere. The cached lookup returns a shared
  // instance; the material constructors copy it into their own Color so
  // there's no aliasing back into the cache.
  const headColor = altitudeColorCached(a.altFt, false, a.onGround);

  const material = new MeshStandardMaterial({
    color: headColor,
    metalness: 0.4,
    roughness: 0.3,
    transparent: true,
  });
  material.emissive = headColor.clone().multiplyScalar(0.35);
  const cone = new Mesh(a.onGround ? CONE_GEOMETRY_GROUND : CONE_GEOMETRY, material);
  cone.userData = { kind: 'aircraft', hex: a.hex };

  // Resolve the tar1090 shape for this aircraft's type and stamp it onto a
  // ground-projected plane. Shape lookup uses ICAO type → description →
  // emitter category, falling back to the generic airliner. The texture is
  // rasterized once per shape (white fill, black stroke) and tinted at
  // render time via material.color.
  const [shapeName, scaling] = resolveShape(a.category, a.typeCode, a.description);
  const iconCache = getShapeTexture(shapeName);
  const aspect = iconCache?.aspect ?? 1;
  const iconW = ICON_BASE_SIZE * scaling * (aspect >= 1 ? aspect : 1);
  const iconH = ICON_BASE_SIZE * scaling * (aspect >= 1 ? 1 : 1 / aspect);
  const iconGeom = new PlaneGeometry(iconW, iconH);
  // Lay the plane flat on the ground. PlaneGeometry's UV(0,0) is at vertex
  // (-w/2, -h/2); after rotateX(-π/2) that maps to scene +Z, so the SVG
  // top (which is the aircraft's nose) ends up at scene -Z = north. With
  // track=0 meaning north, no extra yaw is needed at construction.
  iconGeom.rotateX(-Math.PI / 2);
  const iconMaterial = new MeshBasicMaterial({
    map: iconCache?.texture ?? null,
    color: headColor,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const iconMesh = new Mesh(iconGeom, iconMaterial);
  iconMesh.renderOrder = 1;
  iconMesh.userData = { kind: 'aircraft-icon', hex: a.hex };
  iconMesh.visible = getSettings().groundSprites;
  const iconRotates = shapeRotates(shapeName);

  const altGeom = new BufferGeometry();
  altGeom.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
  const altLine = new Line(altGeom, LINE_MAT_DEFAULT);
  altLine.userData = { kind: 'altitude-line', hex: a.hex };
  altLine.visible = getSettings().altitudeLines;

  const solid = buildTrailLine(TRAIL_MAT_SOLID);
  solid.line.userData = { kind: 'trail', hex: a.hex };
  const dashed = buildTrailLine(TRAIL_MAT_DASHED);
  dashed.line.userData = { kind: 'trail-dashed', hex: a.hex };

  const labelEl = document.createElement('div');
  const label = new CSS2DObject(labelEl);
  label.position.set(0, 3.2, 0);
  cone.add(label);

  const pickMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const pickProxy = new Mesh(PICK_GEOMETRY, pickMaterial);
  pickProxy.userData = { kind: 'aircraft-pick', hex: a.hex };
  cone.add(pickProxy);

  const selectionMaterial = new MeshBasicMaterial({
    color: new Color(themeThree().selectionRing),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: DoubleSide,
  });
  SELECTION_MATERIALS.add(selectionMaterial);
  const selectionRing = new Mesh(SELECTION_RING_GEOMETRY, selectionMaterial);
  selectionRing.visible = false;
  selectionRing.renderOrder = 5;
  selectionRing.userData = { kind: 'selection-ring', hex: a.hex };

  // Emergency ring (red): visible whenever the aircraft is broadcasting an
  // emergency state. Shared geometry+material across all aircraft — only
  // .visible and .position are mutated per-entry.
  const emergencyRing = new Mesh(EMERGENCY_RING_GEOMETRY, EMERGENCY_RING_MATERIAL);
  emergencyRing.visible = a.emergency !== null;
  emergencyRing.renderOrder = 4;
  emergencyRing.userData = { kind: 'emergency-ring', hex: a.hex };

  // Per-entry ping material so its opacity can be animated independently.
  // Geometry is shared via PING_RING_GEOMETRY.
  const pingMaterial = new MeshBasicMaterial({
    color: new Color(themeThree().acarsPing),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: DoubleSide,
  });
  PING_MATERIALS.add(pingMaterial);
  const pingRing = new Mesh(PING_RING_GEOMETRY, pingMaterial);
  pingRing.visible = false;
  pingRing.renderOrder = 6;
  pingRing.userData = { kind: 'acars-ping', hex: a.hex };

  const group = new Group();
  group.userData = { kind: 'aircraft-root', hex: a.hex };
  group.add(solid.line);
  group.add(dashed.line);
  group.add(altLine);
  group.add(emergencyRing);
  group.add(selectionRing);
  group.add(pingRing);
  group.add(iconMesh);
  group.add(cone);

  return {
    group,
    cone,
    altLine,
    trailSolid: solid.line,
    trailDashed: dashed.line,
    solidPos: solid.pos,
    solidCol: solid.col,
    dashedPos: dashed.pos,
    dashedCol: dashed.col,
    material,
    iconMesh,
    iconMaterial,
    iconRotates,
    emergencyRing,
    pingRing,
    pingMaterial,
    pingStartMs: null,
    label,
    labelEl,
    selectionRing,
    pickMaterial,
    lastTrailLength: 0,
    lastLabelText: '',
    lastLabelClass: '',
    lastLabelColor: '',
    lastLabelOpacity: -1,
    isMilitary: a.military,
    isSelected: false,
    lastRev: 0,
    lastTrailRev: 0,
    lastStaleness: -1,
    lastTrackDeg: Number.NaN,
    solidCapacityVerts: INITIAL_TRAIL_CAPACITY_VERTS,
    dashedCapacityVerts: INITIAL_TRAIL_CAPACITY_VERTS,
    lastTrailFirstMs: Number.NaN,
    lastTrailLastMs: 0,
    lastTrailLastX: 0,
    lastTrailLastY: 0,
    lastTrailLastZ: 0,
    lastTrailLastR: 0,
    lastTrailLastG: 0,
    lastTrailLastB: 0,
    lastSolidIdx: 0,
    lastDashedIdx: 0
  };
}

function refreshLabel(entry: RenderEntry, a: Aircraft): void {
  const text = aircraftLabelText(a);
  if (text !== entry.lastLabelText) {
    entry.labelEl.textContent = text;
    entry.lastLabelText = text;
  }
  const cls = aircraftLabelClass(a);
  if (cls !== entry.lastLabelClass) {
    entry.labelEl.className = cls;
    entry.lastLabelClass = cls;
  }
  // Tint the label text with the same altitude palette the cone, ground
  // icon, and trail use. The style cache returns interned CSS strings
  // bucketed by altitude, so most labels at cruise hit a per-aircraft
  // identity check rather than allocating a new string each refresh.
  const colorStr = altitudeColorStyleCached(a.altFt, a.military, a.onGround);
  if (colorStr !== entry.lastLabelColor) {
    entry.labelEl.style.color = colorStr;
    entry.lastLabelColor = colorStr;
  }
  entry.isMilitary = a.military;
}

function applyTransform(entry: RenderEntry, a: Aircraft): void {
  toScene(a.lat, a.lon, a.altFt, tmpPos);
  // Ground anchor (icon + altitude-line foot) sits on the terrain surface;
  // elevationFtAt() is 0 everywhere when 3D terrain is off. The clamp
  // keeps cones from sinking under the mesh on baro/ellipsoid quirks when
  // an aircraft is on or near the ground.
  toScene(a.lat, a.lon, elevationFtAt(a.lat, a.lon), tmpGround);
  if (tmpPos.y < tmpGround.y) tmpPos.y = tmpGround.y;

  entry.cone.position.copy(tmpPos);

  // Compute yaw once, share between cone + ground icon. Skip the whole
  // quaternion math when heading hasn't changed since the last refresh —
  // a cruising aircraft holds a steady track for many position updates,
  // and the previous quaternion is still correct in that case.
  if (a.trackDeg !== null && a.trackDeg !== entry.lastTrackDeg) {
    const yaw = -((a.trackDeg * Math.PI) / 180);
    const half = yaw / 2;
    const sinH = Math.sin(half);
    const cosH = Math.cos(half);
    entry.cone.quaternion.set(0, sinH, 0, cosH);
    if (entry.iconRotates) entry.iconMesh.quaternion.set(0, sinH, 0, cosH);
    entry.lastTrackDeg = a.trackDeg;
  }

  const altPos = entry.altLine.geometry.getAttribute('position') as BufferAttribute;
  altPos.setXYZ(0, tmpPos.x, tmpPos.y, tmpPos.z);
  altPos.setXYZ(1, tmpGround.x, 0, tmpGround.z);
  altPos.needsUpdate = true;

  const s = a.onGround ? 0.6 : 0.7 + Math.min(1, a.altFt / 35000) * 0.5;
  entry.cone.scale.setScalar(s);

  // Ground icon position follows the aircraft's lat/lon foot regardless of
  // whether heading changed — its quaternion was either updated above or
  // is already correct from a prior frame.
  entry.iconMesh.position.set(tmpGround.x, ICON_GROUND_Y, tmpGround.z);
}

function refreshColor(entry: RenderEntry, a: Aircraft): void {
  // Cone + icon track altitude only; military distinction lives on the
  // label color so altitude hue stays consistent across the fleet. The
  // cached lookup returns a shared Color instance — copy from it, never
  // mutate it.
  const c = altitudeColorCached(a.altFt, false, a.onGround);
  entry.material.color.copy(c);
  entry.material.emissive.copy(c).multiplyScalar(0.35);
  entry.iconMaterial.color.copy(c);
}

function refreshTrail(entry: RenderEntry, store: AircraftStore, a: Aircraft): void {
  const points = store.trails(a.hex);
  if (!points || points.length < 2) {
    entry.trailSolid.geometry.setDrawRange(0, 0);
    entry.trailDashed.geometry.setDrawRange(0, 0);
    entry.lastTrailLength = 0;
    entry.lastSolidIdx = 0;
    entry.lastDashedIdx = 0;
    entry.lastTrailFirstMs = Number.NaN;
    return;
  }

  const n = points.length;
  const firstMs = points[0]!.ms;

  // Fast path: trail grew only at the tail (firstMs unchanged, length up).
  // Skips the per-point walk over the old portion of the trail, writing
  // only the newly-arrived segments to the existing buffer slots. This is
  // the common case post-Phase-1 since refreshTrail only fires when the
  // store's trailRev advances and the typical mutation is appendTrail.
  if (
    entry.lastTrailLength >= 2 &&
    n > entry.lastTrailLength &&
    firstMs === entry.lastTrailFirstMs &&
    tryAppendTrailTail(entry, points, n)
  ) {
    return;
  }

  // Slow path: first refresh, mergeHistory prepended, setTrail replaced,
  // head was trimmed by a bounded cap, or the fast path bailed because
  // a buffer grow would lose the existing data.
  rebuildTrailFull(entry, points, n, firstMs);
}

// Returns true on a successful tail-append; false if the new segments
// would overflow the current buffer capacity (caller falls through to
// rebuildTrailFull which handles buffer growth + full rewrite).
function tryAppendTrailTail(entry: RenderEntry, points: readonly { lat: number; lon: number; altFt: number; ms: number }[], n: number): boolean {
  // Incremental pre-pass over only the new tail to size capacity needs.
  let extraSolid = 0;
  let extraDashed = 0;
  {
    let prevMs = entry.lastTrailLastMs;
    for (let i = entry.lastTrailLength; i < n; i++) {
      const curMs = points[i]!.ms;
      if (curMs - prevMs >= TRAIL_GAP_THRESHOLD_MS) extraDashed += 2;
      else extraSolid += 2;
      prevMs = curMs;
    }
  }
  // BufferAttribute swap-out doesn't copy old contents (the slow path
  // rewrites everything afterward, so it doesn't need to). For the fast
  // path, that means a grow event has to bail to the slow path or we'd
  // lose the existing portion of the trail.
  if (
    entry.lastSolidIdx + extraSolid > entry.solidCapacityVerts ||
    entry.lastDashedIdx + extraDashed > entry.dashedCapacityVerts
  ) {
    return false;
  }

  let solidIdx = entry.lastSolidIdx;
  let dashedIdx = entry.lastDashedIdx;
  let prevX = entry.lastTrailLastX;
  let prevY = entry.lastTrailLastY;
  let prevZ = entry.lastTrailLastZ;
  let prevR = entry.lastTrailLastR;
  let prevG = entry.lastTrailLastG;
  let prevB = entry.lastTrailLastB;
  let prevMs = entry.lastTrailLastMs;

  for (let i = entry.lastTrailLength; i < n; i++) {
    const p = points[i]!;
    toScene(p.lat, p.lon, p.altFt, tmpTrail);
    const cur = altitudeColorCached(p.altFt, false);
    const dt = p.ms - prevMs;
    const dashed = dt >= TRAIL_GAP_THRESHOLD_MS;
    const pos = dashed ? entry.dashedPos : entry.solidPos;
    const col = dashed ? entry.dashedCol : entry.solidCol;
    const idx = dashed ? dashedIdx : solidIdx;
    pos.setXYZ(idx, prevX, prevY, prevZ);
    col.setXYZ(idx, prevR, prevG, prevB);
    pos.setXYZ(idx + 1, tmpTrail.x, tmpTrail.y, tmpTrail.z);
    col.setXYZ(idx + 1, cur.r, cur.g, cur.b);
    if (dashed) dashedIdx += 2; else solidIdx += 2;
    prevX = tmpTrail.x; prevY = tmpTrail.y; prevZ = tmpTrail.z;
    prevR = cur.r; prevG = cur.g; prevB = cur.b;
    prevMs = p.ms;
  }

  entry.lastTrailLength = n;
  entry.lastSolidIdx = solidIdx;
  entry.lastDashedIdx = dashedIdx;
  entry.lastTrailLastX = prevX;
  entry.lastTrailLastY = prevY;
  entry.lastTrailLastZ = prevZ;
  entry.lastTrailLastR = prevR;
  entry.lastTrailLastG = prevG;
  entry.lastTrailLastB = prevB;
  entry.lastTrailLastMs = prevMs;

  entry.solidPos.needsUpdate = true;
  entry.solidCol.needsUpdate = true;
  entry.dashedPos.needsUpdate = true;
  entry.dashedCol.needsUpdate = true;
  entry.trailSolid.geometry.setDrawRange(0, solidIdx);
  entry.trailDashed.geometry.setDrawRange(0, dashedIdx);
  if (dashedIdx > 0) entry.trailDashed.computeLineDistances();
  return true;
}

function rebuildTrailFull(entry: RenderEntry, points: readonly { lat: number; lon: number; altFt: number; ms: number }[], n: number, firstMs: number): void {
  // Pre-pass: count how many vertices each side actually needs. The
  // solid/dashed split depends on the time gap between consecutive samples,
  // so we have to classify before writing. The pass is cheap (one
  // subtraction + compare per segment) and lets growTrailBuffer allocate
  // each side only as much as required — saves memory vs. the worst-case
  // "every segment could be either side" sizing.
  let neededSolidVerts = 0;
  let neededDashedVerts = 0;
  {
    let prevMs = points[0]!.ms;
    for (let i = 1; i < n; i++) {
      const curMs = points[i]!.ms;
      if (curMs - prevMs >= TRAIL_GAP_THRESHOLD_MS) neededDashedVerts += 2;
      else neededSolidVerts += 2;
      prevMs = curMs;
    }
  }
  const grownSolid = growTrailBuffer(entry.trailSolid, entry.solidCapacityVerts, neededSolidVerts);
  if (grownSolid) {
    entry.solidPos = grownSolid.pos;
    entry.solidCol = grownSolid.col;
    entry.solidCapacityVerts = grownSolid.verts;
  }
  const grownDashed = growTrailBuffer(entry.trailDashed, entry.dashedCapacityVerts, neededDashedVerts);
  if (grownDashed) {
    entry.dashedPos = grownDashed.pos;
    entry.dashedCol = grownDashed.col;
    entry.dashedCapacityVerts = grownDashed.verts;
  }

  // Walk consecutive pairs; classify each as a solid or dashed line segment
  // based on the time gap between samples. Each vertex is colored by the
  // tar1090 altitude palette for that point's own altitude (no fade).
  let solidIdx = 0;
  let dashedIdx = 0;

  let prevX = 0, prevY = 0, prevZ = 0, prevR = 0, prevG = 0, prevB = 0, prevMs = 0;
  {
    const p0 = points[0]!;
    toScene(p0.lat, p0.lon, p0.altFt, tmpTrail);
    // altitudeColorCached returns a shared Color instance bucketed by
    // altitude — read .r/.g/.b directly into locals so we never have to
    // copy through a tmp Color.
    const c0 = altitudeColorCached(p0.altFt, false);
    prevX = tmpTrail.x; prevY = tmpTrail.y; prevZ = tmpTrail.z;
    prevR = c0.r; prevG = c0.g; prevB = c0.b;
    prevMs = p0.ms;
  }

  for (let i = 1; i < n; i++) {
    const p = points[i]!;
    toScene(p.lat, p.lon, p.altFt, tmpTrail);
    const cur = altitudeColorCached(p.altFt, false);
    const dt = p.ms - prevMs;
    const dashed = dt >= TRAIL_GAP_THRESHOLD_MS;

    const pos = dashed ? entry.dashedPos : entry.solidPos;
    const col = dashed ? entry.dashedCol : entry.solidCol;
    const idx = dashed ? dashedIdx : solidIdx;
    pos.setXYZ(idx, prevX, prevY, prevZ);
    col.setXYZ(idx, prevR, prevG, prevB);
    pos.setXYZ(idx + 1, tmpTrail.x, tmpTrail.y, tmpTrail.z);
    col.setXYZ(idx + 1, cur.r, cur.g, cur.b);
    if (dashed) dashedIdx += 2; else solidIdx += 2;

    prevX = tmpTrail.x; prevY = tmpTrail.y; prevZ = tmpTrail.z;
    prevR = cur.r; prevG = cur.g; prevB = cur.b;
    prevMs = p.ms;
  }

  entry.lastTrailLength = n;
  entry.lastTrailFirstMs = firstMs;
  entry.lastSolidIdx = solidIdx;
  entry.lastDashedIdx = dashedIdx;
  entry.lastTrailLastX = prevX;
  entry.lastTrailLastY = prevY;
  entry.lastTrailLastZ = prevZ;
  entry.lastTrailLastR = prevR;
  entry.lastTrailLastG = prevG;
  entry.lastTrailLastB = prevB;
  entry.lastTrailLastMs = prevMs;

  entry.solidPos.needsUpdate = true;
  entry.solidCol.needsUpdate = true;
  entry.trailSolid.geometry.setDrawRange(0, solidIdx);

  entry.dashedPos.needsUpdate = true;
  entry.dashedCol.needsUpdate = true;
  entry.trailDashed.geometry.setDrawRange(0, dashedIdx);
  if (dashedIdx > 0) {
    entry.trailDashed.computeLineDistances();
  }
  // No computeBoundingSphere here: line.frustumCulled is false so the
  // sphere is never read, and our growable buffer has zeroed tail bytes
  // that would corrupt it anyway. setDrawRange is the only thing the
  // renderer needs to know about what to draw.
}

// Squared epsilon (scene units) — below this the camera is treated as
// stationary for the purposes of label LOD recompute. The label LOD pass
// reads aircraft positions, but with positions only changing at trailRev
// advance (~1Hz per aircraft) a stationary camera + stationary aircraft
// means the previous opacity values are still correct.
const CAMERA_IDLE_EPS_SQ = 0.05;

export class AircraftReconciler {
  private readonly entries = new Map<string, RenderEntry>();
  private readonly camPos = new Vector3();
  private selectedHex: string | null = null;
  // Last camera position seen by updateLabelLOD. NaN sentinel forces the
  // first call to run the full pass.
  private lastCamX = Number.NaN;
  private lastCamY = Number.NaN;
  private lastCamZ = Number.NaN;
  // Set by syncFrame whenever an entry is added or removed, so the next
  // updateLabelLOD bypasses the camera-idle skip and assigns opacities
  // for the new entry / drops them for the dropped one.
  private lodDirty = false;
  // Previous settings values; the subscriber below only touches per-entry
  // visibility for keys that actually changed, so a theme toggle doesn't
  // walk 1500 entries to apply the same groundSprites value as last frame.
  private prevGroundSprites: boolean;
  private prevAltitudeLines: boolean;
  private prevAircraftLabels: boolean;

  // Frustum + matrix scratch space for updateLabelLOD. Allocating once at
  // construction (not per-frame) keeps the LOD pass allocation-free.
  private readonly frustum = new Frustum();
  private readonly projScreenMatrix = new Matrix4();

  constructor(
    private readonly store: AircraftStore,
    private readonly root: Object3D,
    // Camera widened from `{ position }` to the matrices we need for
    // frustum culling in updateLabelLOD. PerspectiveCamera (the actual
    // type passed by main.ts) supplies all of these.
    private readonly camera: {
      position: Vector3;
      projectionMatrix: Matrix4;
      matrixWorld: Matrix4;
      matrixWorldInverse: Matrix4;
      updateMatrixWorld(): void;
    }
  ) {
    const s0 = getSettings();
    this.prevGroundSprites = s0.groundSprites;
    this.prevAltitudeLines = s0.altitudeLines;
    this.prevAircraftLabels = s0.aircraftLabels;
    // Settings can change for many reasons (theme, range rings, units...);
    // most of those are irrelevant to per-entry visibility. Walk the entry
    // map only when one of the three keys this loop actually cares about
    // has flipped since last time. Saves an N-entry sweep on every
    // unrelated settings toggle.
    // Unsubscribe handle intentionally discarded — the reconciler is a
    // page-lifetime singleton so there is no teardown path that calls it.
    subscribeSettings((s) => {
      const gsChanged = s.groundSprites !== this.prevGroundSprites;
      const alChanged = s.altitudeLines !== this.prevAltitudeLines;
      const labChanged = s.aircraftLabels !== this.prevAircraftLabels;
      if (!gsChanged && !alChanged && !labChanged) return;
      for (const entry of this.entries.values()) {
        if (gsChanged) entry.iconMesh.visible = s.groundSprites;
        if (alChanged) entry.altLine.visible = s.altitudeLines;
        if (labChanged && !s.aircraftLabels) entry.label.visible = false;
      }
      this.prevGroundSprites = s.groundSprites;
      this.prevAltitudeLines = s.altitudeLines;
      this.prevAircraftLabels = s.aircraftLabels;
    });
  }

  setSelected(hex: string | null): void {
    if (this.selectedHex === hex) return;
    if (this.selectedHex) {
      const prev = this.entries.get(this.selectedHex);
      if (prev) this.applySelection(prev, false);
    }
    this.selectedHex = hex;
    if (hex) {
      const next = this.entries.get(hex);
      if (next) this.applySelection(next, true);
    }
  }

  /**
   * Trigger an expanding ring animation on an aircraft to flag a freshly-
   * arrived ACARS message. No-op if the aircraft isn't on scope right now.
   * Re-arms the timer on each call so a burst of messages keeps the ping
   * visible rather than restarting partway through.
   */
  triggerAcarsPing(hex: string): void {
    const entry = this.entries.get(hex.toLowerCase());
    if (!entry) return;
    entry.pingStartMs = performance.now();
  }

  /** World-space position of an aircraft, or null if it isn't currently rendered. */
  positionOf(hex: string): Vector3 | null {
    const entry = this.entries.get(hex);
    return entry ? entry.cone.position.clone() : null;
  }

  /** Raycast hit-test against aircraft pick proxies. Returns the closest hex or null. */
  pick(raycaster: Raycaster): string | null {
    // intersectObject(root, true) walks the whole subtree which costs us
    // nothing extra for ~25 aircraft and is robust against group rearrangement.
    // We accept hits on either the cone's invisible pick proxy *or* the
    // ground silhouette icon, since users naturally aim for whichever is
    // larger on screen at their current zoom.
    const hits = raycaster.intersectObject(this.root, true);
    for (const hit of hits) {
      const ud = hit.object.userData as { kind?: string; hex?: string } | undefined;
      if (!ud?.hex) continue;
      if (ud.kind !== 'aircraft-pick' && ud.kind !== 'aircraft-icon') continue;
      // three.js's raycaster does not skip subtrees whose parent Group has
      // `visible = false`, so the invisible pick proxies inside filtered-out
      // aircraft still register hits. Verify the entry is actually rendered
      // before returning it; otherwise clicking on empty sky in MIL-filter
      // mode would still surface civilian aircraft hiding underneath.
      const entry = this.entries.get(ud.hex);
      if (!entry || !entry.group.visible) continue;
      return ud.hex;
    }
    return null;
  }

  private applySelection(entry: RenderEntry, selected: boolean): void {
    entry.isSelected = selected;
    entry.selectionRing.visible = selected;
    entry.material.emissiveIntensity = selected ? 1.6 : 1.0;
    entry.labelEl.classList.toggle('selected', selected);
    entry.trailSolid.material = selected ? TRAIL_MAT_SOLID_SELECTED : TRAIL_MAT_SOLID;
    entry.trailDashed.material = selected ? TRAIL_MAT_DASHED_SELECTED : TRAIL_MAT_DASHED;
    // Render selected trail on top so it doesn't z-fight with neighbors.
    entry.trailSolid.renderOrder = selected ? 4 : 0;
    entry.trailDashed.renderOrder = selected ? 4 : 0;
    // Position the selection ring at the cone's current ground projection.
    // syncFrame only updates ring position when the per-aircraft rev
    // advances, so selecting a static aircraft (rev unchanged for many
    // frames) needs this seed here or the ring would render at (0,0,0).
    if (selected) {
      entry.selectionRing.position.set(entry.cone.position.x, 0.15, entry.cone.position.z);
    }
  }

  /**
   * Label LOD pass: combines camera-frustum culling with distance-based
   * fade. Runs in one loop so each entry pays one in/out check before any
   * style writes. The frustum cull is the load-bearing optimization on
   * busy feeds — CSS2DRenderer would otherwise project + style-write
   * every visible CSS2DObject every frame regardless of whether it lands
   * on-screen, which adds up to tens of thousands of DOM mutations per
   * second at Europe-scale aircraft counts.
   */
  updateLabelLOD(): void {
    const settings = getSettings();
    if (!settings.aircraftLabels) {
      // Labels disabled globally — make sure none leak through and bail.
      // Per-entry .visible was already cleared by the settings subscriber.
      return;
    }
    this.camPos.copy(this.camera.position);
    // Camera-idle early-exit: if the camera hasn't moved meaningfully since
    // the last LOD pass, the per-entry opacity values we wrote last time
    // are still valid (the frustum hasn't moved, aircraft positions update
    // at ~1Hz so a 1-frame opacity lag on a just-moved aircraft is
    // invisible). Saves the full N-entry pass on every idle frame.
    const dx = this.camPos.x - this.lastCamX;
    const dy = this.camPos.y - this.lastCamY;
    const dz = this.camPos.z - this.lastCamZ;
    if (!this.lodDirty && dx * dx + dy * dy + dz * dz < CAMERA_IDLE_EPS_SQ) return;
    this.lastCamX = this.camPos.x;
    this.lastCamY = this.camPos.y;
    this.lastCamZ = this.camPos.z;
    this.lodDirty = false;

    // Compute the current camera frustum. We refresh the camera's
    // matrixWorld (in case OrbitControls just mutated position/quaternion
    // and the renderer hasn't reconciled yet) and invert it locally
    // rather than rely on the renderer's cached value.
    this.camera.updateMatrixWorld();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    this.projScreenMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    // Density-based fade (only when the user has dialed it up). At
    // labelDensity=0 (default), the cull pass is the only gate.
    const density = settings.labelDensity;
    const camDist = this.camPos.length();
    const factor = 1.5 - density / 100;
    const cutoff = Math.max(60, camDist * factor);
    const fadeStart = cutoff * 0.55;

    for (const entry of this.entries.values()) {
      // Filtered-out entries already have label.visible=false from
      // syncFrame; LOD shouldn't bring them back.
      if (!entry.group.visible) continue;

      // Frustum cull. CSS2DRenderer.render() checks each CSS2DObject's
      // .visible flag and skips invisible ones, so hiding off-screen
      // labels here removes them from the per-frame style-write loop.
      // Anchor point is the cone position (the label sits on a small
      // local offset above it — the frustum margin absorbs that error).
      if (!this.frustum.containsPoint(entry.cone.position)) {
        if (entry.label.visible) entry.label.visible = false;
        continue;
      }

      // In-frustum: density-based opacity. At density=0 every in-frustum
      // label is fully opaque (matches the legacy "show everyone" behavior
      // before LOD existed); higher density tightens a fade cone in front
      // of the camera.
      let opacity: number;
      if (density <= 0) {
        opacity = 1;
      } else {
        const d = entry.cone.position.distanceTo(this.camPos);
        if (d <= fadeStart) opacity = 1;
        else if (d >= cutoff) opacity = 0;
        else opacity = 1 - (d - fadeStart) / (cutoff - fadeStart);
      }

      const wantVisible = opacity > 0.02;
      if (entry.label.visible !== wantVisible) entry.label.visible = wantVisible;
      if (Math.abs(opacity - entry.lastLabelOpacity) > 0.02) {
        entry.labelEl.style.opacity = opacity >= 0.99 ? '' : opacity.toFixed(2);
        entry.lastLabelOpacity = opacity;
      }
    }
  }

  syncFrame(): void {
    const snapshot = this.store.snapshot;
    // Cache the labels-enabled flag so we don't override the global toggle
    // each frame from inside the per-entry filter visibility logic.
    const labelsAllowed = getSettings().aircraftLabels;
    const now = Date.now();
    const perfNow = performance.now();

    for (const a of snapshot.values()) {
      let entry = this.entries.get(a.hex);
      if (!entry) {
        entry = buildEntry(a);
        this.entries.set(a.hex, entry);
        this.root.add(entry.group);
        if (a.hex === this.selectedHex) this.applySelection(entry, true);
        this.lodDirty = true;
      }
      // Filter visibility: aircraft that fail the active list filter
      // disappear from the scene entirely (cone, icon, trail, alt-line,
      // label — the whole group). Selected aircraft are exempt so the
      // user can keep inspecting one even after switching filters.
      // Note: three.js CSS2DRenderer reads each label's own .visible
      // flag, NOT the parent group's, so we set both explicitly. We also
      // factor the global aircraft-labels setting in here so toggling
      // it off doesn't get overridden the next tick by this filter pass.
      // The LOD pass downstream skips filtered-out entries to keep the
      // label hidden through the next frame.
      const visible = entry.isSelected || passesFilter(a);
      const labelVisible = visible && labelsAllowed;
      if (entry.group.visible !== visible) entry.group.visible = visible;
      if (entry.label.visible !== labelVisible) entry.label.visible = labelVisible;
      if (!visible) continue;

      // Gated work: only run the expensive material/geometry/label
      // refreshes when the store says the aircraft has actually changed
      // since we last drew it. At 60fps with a 1Hz feed and a 500-aircraft
      // fleet, this is the difference between 30k pointless setXYZ calls
      // per second and ~500 — the bulk of frames find every aircraft at
      // the same rev as last frame and skip the entire block.
      const rev = this.store.getRev(a.hex);
      if (rev !== entry.lastRev) {
        refreshColor(entry, a);
        applyTransform(entry, a);
        refreshLabel(entry, a);
        // Emergency ring follows the aircraft's ground projection. Visibility
        // tracks the per-tick emergency state so a 7700-then-cleared sequence
        // surfaces and dismisses without lingering. emergency is in the rev
        // comparison set, so a state transition arrives via a rev advance.
        const inEmergency = a.emergency !== null;
        entry.emergencyRing.visible = inEmergency;
        if (inEmergency) {
          entry.emergencyRing.position.set(entry.cone.position.x, 0.12, entry.cone.position.z);
        }
        // Keep the selection ring pegged to the cone's current ground
        // projection while the aircraft moves. Selecting a previously-static
        // aircraft seeds the ring position via applySelection; this keeps
        // it in sync once the aircraft starts reporting new positions.
        if (entry.isSelected) {
          entry.selectionRing.position.set(entry.cone.position.x, 0.15, entry.cone.position.z);
        }
        entry.lastRev = rev;
      }
      const trailRev = this.store.getTrailRev(a.hex);
      if (trailRev !== entry.lastTrailRev) {
        refreshTrail(entry, this.store, a);
        entry.lastTrailRev = trailRev;
      }
      // Stale-data fade: cone + ground icon fade toward STALE_MIN_OPACITY
      // as lastSeenMs grows. The selected aircraft stays at full opacity
      // so the user can keep inspecting it even when the feed is choppy.
      // Recomputed every frame because it's a wall-clock function, but the
      // material mutation is gated on a meaningful delta to avoid
      // mass-touching opacity each frame for the (common) case where every
      // aircraft is either fully fresh (1.0) or fully stale.
      const opacity = entry.isSelected ? 1 : staleness(now - a.lastSeenMs);
      if (Math.abs(opacity - entry.lastStaleness) > 0.01) {
        entry.material.opacity = opacity;
        entry.iconMaterial.opacity = opacity;
        entry.lastStaleness = opacity;
      }

      // ACARS ping animation: ring expands from cone-radius outward and
      // fades over PING_DURATION_MS. pingStartMs is set by triggerAcarsPing
      // and is null on the common path, so the per-frame cost when no
      // aircraft are pinging is a single null check per entry.
      if (entry.pingStartMs !== null) {
        const elapsed = perfNow - entry.pingStartMs;
        if (elapsed >= PING_DURATION_MS) {
          entry.pingStartMs = null;
          entry.pingRing.visible = false;
          entry.pingMaterial.opacity = 0;
        } else {
          const t = elapsed / PING_DURATION_MS;
          const scale = 1 + (PING_MAX_SCALE - 1) * t;
          const pingOpacity = (1 - t) * 0.85;
          entry.pingRing.position.set(entry.cone.position.x, 0.18, entry.cone.position.z);
          entry.pingRing.scale.setScalar(scale);
          entry.pingMaterial.opacity = pingOpacity;
          entry.pingRing.visible = true;
        }
      }
    }

    for (const [hex, entry] of this.entries) {
      if (snapshot.has(hex)) continue;
      if (this.selectedHex === hex) this.selectedHex = null;
      this.root.remove(entry.group);
      entry.material.dispose();
      entry.altLine.geometry.dispose();
      entry.trailSolid.geometry.dispose();
      entry.trailDashed.geometry.dispose();
      // Trail materials (TRAIL_MAT_SOLID / TRAIL_MAT_DASHED) are shared
      // across all aircraft — do not dispose them here.
      const selMat = entry.selectionRing.material as MeshBasicMaterial;
      SELECTION_MATERIALS.delete(selMat);
      selMat.dispose();
      PING_MATERIALS.delete(entry.pingMaterial);
      entry.pingMaterial.dispose();
      entry.pickMaterial.dispose();
      entry.iconMesh.geometry.dispose();
      entry.iconMaterial.dispose();
      // Shape textures are shared across aircraft via the shapes-module
      // cache — do not dispose them here.
      entry.label.removeFromParent();
      entry.labelEl.remove();
      this.entries.delete(hex);
      this.lodDirty = true;
    }
  }

  get count(): number {
    return this.entries.size;
  }
}
