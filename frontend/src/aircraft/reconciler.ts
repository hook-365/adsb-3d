import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
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
import { resolveShape, getShapeTexture, shapeRotates } from './shapes';
import { getSettings, subscribeSettings } from '../core/settings';
import { passesFilter } from '../core/filter';

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

const LINE_MAT_DEFAULT = new LineBasicMaterial({ color: 0x4cc8ff, transparent: true, opacity: 0.35 });

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
const TRAIL_SEG_VERT_CAPACITY = (TRAIL_CAPACITY - 1) * 2;
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

// tar1090's `ColorByAlt` scheme (config.js in the tar1090 / readsb-protobuf
// repo). Piecewise-linear hue interpolation in HSL; saturation/lightness
// fixed for airborne aircraft, separate dimmer color for ground.
//   2000 ft  → hue 20  (orange)
//   10000 ft → hue 140 (light green)
//   40000 ft → hue 300 (magenta)
const TAR1090_HUE_STOPS: ReadonlyArray<{ alt: number; hue: number }> = [
  { alt: 2000, hue: 20 },
  { alt: 10000, hue: 140 },
  { alt: 40000, hue: 300 },
];
const TAR1090_AIR_S = 0.85;
const TAR1090_AIR_L = 0.5;
const TAR1090_GROUND_HSL = { h: 230 / 360, s: 0.4, l: 0.3 };
const TAR1090_MILITARY_HEX = 0xff6b81;

function altitudeHue(altFt: number): number {
  const stops = TAR1090_HUE_STOPS;
  if (altFt <= stops[0]!.alt) return stops[0]!.hue;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (altFt <= b.alt) {
      const t = (altFt - a.alt) / (b.alt - a.alt);
      return a.hue + (b.hue - a.hue) * t;
    }
  }
  return stops[stops.length - 1]!.hue;
}

function altitudeColor(altFt: number, military: boolean, onGround = false): Color {
  if (military) return new Color(TAR1090_MILITARY_HEX);
  if (onGround) {
    return new Color().setHSL(TAR1090_GROUND_HSL.h, TAR1090_GROUND_HSL.s, TAR1090_GROUND_HSL.l);
  }
  return new Color().setHSL(altitudeHue(altFt) / 360, TAR1090_AIR_S, TAR1090_AIR_L);
}

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
const PING_COLOR = 0xb284ff; // matches ACARS purple in the panel
// Slightly larger so it haloes around the cyan selection ring when both apply.
const EMERGENCY_RING_GEOMETRY = new RingGeometry(2.9, 3.6, 64);
EMERGENCY_RING_GEOMETRY.rotateX(-Math.PI / 2);
const EMERGENCY_RING_MATERIAL = new MeshBasicMaterial({
  color: 0xff3344,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  side: DoubleSide,
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
const tmpColor = new Color();

function buildTrailLine(material: LineBasicMaterial | LineDashedMaterial): {
  line: LineSegments;
  pos: BufferAttribute;
  col: BufferAttribute;
} {
  const geom = new BufferGeometry();
  const pos = new BufferAttribute(new Float32Array(TRAIL_SEG_VERT_CAPACITY * 3), 3);
  pos.setUsage(35048 /* DynamicDrawUsage */);
  const col = new BufferAttribute(new Float32Array(TRAIL_SEG_VERT_CAPACITY * 3), 3);
  col.setUsage(35048 /* DynamicDrawUsage */);
  geom.setAttribute('position', pos);
  geom.setAttribute('color', col);
  geom.setDrawRange(0, 0);
  const line = new LineSegments(geom, material);
  line.frustumCulled = false;
  return { line, pos, col };
}

function buildEntry(a: Aircraft): RenderEntry {
  // Cone, ground icon, and trail use the plain altitude palette regardless
  // of military status — military traffic now reads via the label color
  // (red) rather than recoloring the whole aircraft. Keeps altitude as the
  // primary visual hue cue everywhere.
  const headColor = altitudeColor(a.altFt, false, a.onGround);

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

  const selectionRing = new Mesh(
    SELECTION_RING_GEOMETRY,
    new MeshBasicMaterial({
      color: 0x4cc8ff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: DoubleSide
    })
  );
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
    color: PING_COLOR,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: DoubleSide,
  });
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
    isSelected: false
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
  // icon, and trail use. Cached so we only touch the inline style when
  // it actually changes (most labels read steady at cruise altitude).
  const colorStr = altitudeColor(a.altFt, a.military, a.onGround).getStyle();
  if (colorStr !== entry.lastLabelColor) {
    entry.labelEl.style.color = colorStr;
    entry.lastLabelColor = colorStr;
  }
  entry.isMilitary = a.military;
}

function applyTransform(entry: RenderEntry, a: Aircraft): void {
  toScene(a.lat, a.lon, a.altFt, tmpPos);
  toScene(a.lat, a.lon, 0, tmpGround);

  entry.cone.position.copy(tmpPos);

  if (a.trackDeg !== null) {
    const yaw = -((a.trackDeg * Math.PI) / 180);
    const half = yaw / 2;
    entry.cone.quaternion.set(0, Math.sin(half), 0, Math.cos(half));
  }

  const altPos = entry.altLine.geometry.getAttribute('position') as BufferAttribute;
  altPos.setXYZ(0, tmpPos.x, tmpPos.y, tmpPos.z);
  altPos.setXYZ(1, tmpGround.x, 0, tmpGround.z);
  altPos.needsUpdate = true;

  const s = a.onGround ? 0.6 : 0.7 + Math.min(1, a.altFt / 35000) * 0.5;
  entry.cone.scale.setScalar(s);

  // Place the ground icon at the foot of the altitude line and yaw it to
  // match the aircraft's heading. Non-rotating shapes (balloon, tower)
  // stay axis-aligned regardless of track.
  entry.iconMesh.position.set(tmpGround.x, ICON_GROUND_Y, tmpGround.z);
  if (entry.iconRotates && a.trackDeg !== null) {
    const yaw = -((a.trackDeg * Math.PI) / 180);
    const half = yaw / 2;
    entry.iconMesh.quaternion.set(0, Math.sin(half), 0, Math.cos(half));
  }
}

function refreshColor(entry: RenderEntry, a: Aircraft): void {
  // Cone + icon track altitude only; military distinction lives on the
  // label color so altitude hue stays consistent across the fleet.
  const c = altitudeColor(a.altFt, false, a.onGround);
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
    return;
  }

  // Walk consecutive pairs; classify each as a solid or dashed line segment
  // based on the time gap between samples. Each vertex is colored by the
  // tar1090 altitude palette for that point's own altitude (no fade).
  const n = points.length;
  let solidIdx = 0;
  let dashedIdx = 0;

  let prevX = 0, prevY = 0, prevZ = 0, prevR = 0, prevG = 0, prevB = 0, prevMs = 0;
  {
    const p0 = points[0]!;
    toScene(p0.lat, p0.lon, p0.altFt, tmpTrail);
    tmpColor.copy(altitudeColor(p0.altFt, false));
    prevX = tmpTrail.x; prevY = tmpTrail.y; prevZ = tmpTrail.z;
    prevR = tmpColor.r; prevG = tmpColor.g; prevB = tmpColor.b;
    prevMs = p0.ms;
  }

  for (let i = 1; i < n; i++) {
    const p = points[i]!;
    toScene(p.lat, p.lon, p.altFt, tmpTrail);
    tmpColor.copy(altitudeColor(p.altFt, false));
    const dt = p.ms - prevMs;
    const dashed = dt >= TRAIL_GAP_THRESHOLD_MS;

    const pos = dashed ? entry.dashedPos : entry.solidPos;
    const col = dashed ? entry.dashedCol : entry.solidCol;
    const idx = dashed ? dashedIdx : solidIdx;
    pos.setXYZ(idx, prevX, prevY, prevZ);
    col.setXYZ(idx, prevR, prevG, prevB);
    pos.setXYZ(idx + 1, tmpTrail.x, tmpTrail.y, tmpTrail.z);
    col.setXYZ(idx + 1, tmpColor.r, tmpColor.g, tmpColor.b);
    if (dashed) dashedIdx += 2; else solidIdx += 2;

    prevX = tmpTrail.x; prevY = tmpTrail.y; prevZ = tmpTrail.z;
    prevR = tmpColor.r; prevG = tmpColor.g; prevB = tmpColor.b;
    prevMs = p.ms;
  }

  // Only recompute bounding spheres when the trail point count changed;
  // they are otherwise unchanged each frame and the recompute is O(n).
  const trailDirty = n !== entry.lastTrailLength;
  entry.lastTrailLength = n;

  entry.solidPos.needsUpdate = true;
  entry.solidCol.needsUpdate = true;
  entry.trailSolid.geometry.setDrawRange(0, solidIdx);
  if (trailDirty) entry.trailSolid.geometry.computeBoundingSphere();

  entry.dashedPos.needsUpdate = true;
  entry.dashedCol.needsUpdate = true;
  entry.trailDashed.geometry.setDrawRange(0, dashedIdx);
  if (dashedIdx > 0) {
    entry.trailDashed.computeLineDistances();
  }
  if (trailDirty) entry.trailDashed.geometry.computeBoundingSphere();
}

export class AircraftReconciler {
  private readonly entries = new Map<string, RenderEntry>();
  private readonly camPos = new Vector3();
  private selectedHex: string | null = null;

  constructor(
    private readonly store: AircraftStore,
    private readonly root: Object3D,
    private readonly camera: { position: Vector3 }
  ) {
    // Ground icon visibility + aircraft label visibility are both
    // session-global settings; re-apply across all entries on change.
    // updateLabelLOD reads the labels flag live (via getSettings()) so
    // distance-based fading still runs when labels are on.
    // Unsubscribe handle intentionally discarded — the reconciler is a
    // page-lifetime singleton so there is no teardown path that calls it.
    subscribeSettings((s) => {
      for (const entry of this.entries.values()) {
        entry.iconMesh.visible = s.groundSprites;
        entry.altLine.visible = s.altitudeLines;
        if (!s.aircraftLabels) entry.label.visible = false;
      }
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
      if (ud.kind === 'aircraft-pick' || ud.kind === 'aircraft-icon') return ud.hex;
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
  }

  /**
   * Distance-based label LOD. Threshold scales with how far the camera is
   * from the origin (a stand-in for zoom level), and labels fade out over
   * the last 20% of that range. Military aircraft always show.
   */
  updateLabelLOD(): void {
    const settings = getSettings();
    if (!settings.aircraftLabels) {
      // Labels disabled globally — make sure none leak through and bail.
      // Per-entry .visible was already cleared by the settings subscriber.
      return;
    }
    // labelDensity = 0 means "show everyone" — bypass distance culling
    // entirely. This is the default and matches what the app did before
    // we introduced LOD; users who want a quieter close-zoom dial it up.
    const density = settings.labelDensity;
    if (density <= 0) {
      for (const entry of this.entries.values()) {
        // Filtered-out entries already have group + label .visible=false
        // from syncFrame; don't fight that here.
        if (!entry.group.visible) continue;
        if (!entry.label.visible) entry.label.visible = true;
        if (entry.lastLabelOpacity !== 1) {
          entry.labelEl.style.opacity = '';
          entry.lastLabelOpacity = 1;
        }
      }
      return;
    }
    this.camPos.copy(this.camera.position);
    const camDist = this.camPos.length();
    // Cutoff radius shrinks as density rises. At density=1 the radius is
    // ~1.49 × camDist (almost the same as the default-on behavior we used
    // to ship). At density=100 it's 0.5 × camDist — labels only show for
    // the visible cone in front of the camera. The 60 unit floor avoids
    // cutoff collapsing to nothing at the closest zooms.
    const factor = 1.5 - density / 100;
    const cutoff = Math.max(60, camDist * factor);
    const fadeStart = cutoff * 0.55;

    for (const entry of this.entries.values()) {
      // Filtered-out entries already have label.visible=false from
      // syncFrame; LOD's distance check shouldn't bring them back.
      if (!entry.group.visible) continue;
      const d = entry.cone.position.distanceTo(this.camPos);
      let opacity: number;
      if (d <= fadeStart) opacity = 1;
      else if (d >= cutoff) opacity = 0;
      else opacity = 1 - (d - fadeStart) / (cutoff - fadeStart);

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

    for (const a of snapshot.values()) {
      let entry = this.entries.get(a.hex);
      if (!entry) {
        entry = buildEntry(a);
        this.entries.set(a.hex, entry);
        this.root.add(entry.group);
        if (a.hex === this.selectedHex) this.applySelection(entry, true);
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

      refreshColor(entry, a);
      applyTransform(entry, a);
      refreshTrail(entry, this.store, a);
      refreshLabel(entry, a);
      // Stale-data fade: cone + ground icon fade toward STALE_MIN_OPACITY
      // as lastSeenMs grows. The selected aircraft stays at full opacity
      // so the user can keep inspecting it even when the feed is choppy.
      const opacity = entry.isSelected ? 1 : staleness(Date.now() - a.lastSeenMs);
      entry.material.opacity = opacity;
      entry.iconMaterial.opacity = opacity;
      // Keep the selection ring's altitude pegged to the aircraft's ground projection.
      if (entry.isSelected) {
        entry.selectionRing.position.set(entry.cone.position.x, 0.15, entry.cone.position.z);
      }
      // Emergency ring follows the aircraft's ground projection too. Visibility
      // tracks the per-tick emergency state so a 7700-then-cleared sequence
      // surfaces and dismisses without lingering.
      const inEmergency = a.emergency !== null;
      entry.emergencyRing.visible = inEmergency;
      if (inEmergency) {
        entry.emergencyRing.position.set(entry.cone.position.x, 0.12, entry.cone.position.z);
      }

      // ACARS ping animation: ring expands from cone-radius outward and
      // fades over PING_DURATION_MS. pingStartMs is set by triggerAcarsPing.
      if (entry.pingStartMs !== null) {
        const elapsed = performance.now() - entry.pingStartMs;
        if (elapsed >= PING_DURATION_MS) {
          entry.pingStartMs = null;
          entry.pingRing.visible = false;
          entry.pingMaterial.opacity = 0;
        } else {
          const t = elapsed / PING_DURATION_MS;
          const scale = 1 + (PING_MAX_SCALE - 1) * t;
          const opacity = (1 - t) * 0.85;
          entry.pingRing.position.set(entry.cone.position.x, 0.18, entry.cone.position.z);
          entry.pingRing.scale.setScalar(scale);
          entry.pingMaterial.opacity = opacity;
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
      (entry.selectionRing.material as MeshBasicMaterial).dispose();
      entry.pingMaterial.dispose();
      entry.pickMaterial.dispose();
      entry.iconMesh.geometry.dispose();
      entry.iconMaterial.dispose();
      // Shape textures are shared across aircraft via the shapes-module
      // cache — do not dispose them here.
      entry.label.removeFromParent();
      entry.labelEl.remove();
      this.entries.delete(hex);
    }
  }

  get count(): number {
    return this.entries.size;
  }
}
