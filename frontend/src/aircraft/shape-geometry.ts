import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Matrix4,
  Shape,
  Vector3,
} from 'three';
import { Float32BufferAttribute, Vector2 } from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getShapeDef } from './shapes';
import { getShapeFeatures, type FuselageFeature, type ShapeFeatures } from './shape-features';
import fuselageProfilesJson from './fuselage-profiles.json';

// Per-shape fuselage width profiles, generated offline by rasterizing each
// silhouette and scanning the centerline fill at 12 stations (wing spikes
// removed with a slope-limited envelope; ends seeded to taper). A lofted
// tube following the drawn width hides the flat slab everywhere a constant
// cylinder could not — nose taper, belly fairing, tail cone.
const FUSELAGE_PROFILES = fuselageProfilesJson as Record<string, number[]>;

// 3D "silhouette" aircraft markers: the tar1090 SVG outline for a type,
// extruded into a flat solid so each aircraft in the sky is a 3D version
// of its own ground sprite. Geometry is built lazily on first request and
// cached per shape name — every aircraft of the same type shares one
// BufferGeometry, mirroring the texture cache in shapes.ts.
//
// Output orientation matches the cone convention in reconciler.ts: nose
// at -z (north), wings along x, thickness centered on y. yaw=-track then
// rotates the nose to the heading, same quaternion as the cone.

// Base footprint in scene units, shared with the ground sprite (the
// reconciler derives ICON_BASE_SIZE from this) so a silhouette lines up
// 1:1 with the tar1090 icon underneath it — the sprite reads as the
// aircraft's shadow instead of dwarfing a half-size marker. The
// resolver's per-type scaling factor is applied by the reconciler via
// mesh scale, not baked in here.
export const MARKER_FOOTPRINT_UNITS = 5.5;
// Extrusion depth as a fraction of the silhouette's length — thick enough
// to read as a solid from oblique angles, thin enough to stay a plan-view
// silhouette rather than a slab.
const THICKNESS_RATIO = 0.1;
// Shapes with an annotated fuselage tube get a thinner planform slab:
// the tube carries the body's volume, so the slab only has to sell the
// wings — at full thickness wings and fuselage read as one uniform plank.
// Real wing-root thickness runs ~1.5-2% of fuselage length; 0.02 sits at
// the top of that band so the slab stays visible from a distance without
// reading as a plank next to the lofted fuselage tube.
const WING_THICKNESS_RATIO = 0.02;
// SVG curve tessellation. The default (12) is authoring-tool fidelity;
// at marker sizes 4 keeps the outline smooth while cutting triangle
// count several-fold — the headset renders every aircraft twice.
const CURVE_SEGMENTS = 4;

// null entries are negative-cache hits: a shape that failed to parse or
// extrude once will fail every time, so remember the failure and let the
// caller fall back to the cone without re-throwing per aircraft.
const geometryCache = new Map<string, BufferGeometry | null>();

/**
 * Extruded 3D geometry for a tar1090 shape name, shared across aircraft.
 * Returns null (and warns once) if the shape is unknown or its path
 * doesn't survive parsing/triangulation — callers fall back to the cone.
 */
export function getSilhouetteGeometry(shapeName: string): BufferGeometry | null {
  const cached = geometryCache.get(shapeName);
  if (cached !== undefined) return cached;
  let geom: BufferGeometry | null = null;
  try {
    geom = build(shapeName);
  } catch (e) {
    console.warn(`[shape-geometry] extrusion failed for "${shapeName}", using fallback marker:`, e);
  }
  geometryCache.set(shapeName, geom);
  return geom;
}

function build(shapeName: string): BufferGeometry | null {
  const def = getShapeDef(shapeName);
  if (!def) return null;
  const [minX = 0, minY = 0, vbW = 0, vbH = 0] = def.viewBox.split(/[\s,]+/).map(Number);
  if (!(vbW > 0) || !(vbH > 0)) return null;

  // Reuse SVGLoader's path-data parser by wrapping the raw `d` strings in
  // a minimal document. Accent paths (door/window detail) are skipped —
  // they're overlay decoration in 2D and would punch odd solids in 3D.
  const paths = Array.isArray(def.path) ? def.path : [def.path];
  const svgText = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${def.viewBox}">`,
    ...paths.map((d) => `<path d="${d}"/>`),
    `</svg>`,
  ].join('');
  let shapes: Shape[] = [];
  for (const p of new SVGLoader().parse(svgText).paths) {
    shapes.push(...SVGLoader.createShapes(p));
  }
  if (shapes.length === 0) return null;

  const features = getShapeFeatures(shapeName);
  if (features?.planformClip) {
    try {
      // An empty result is legitimate: a shape whose slab is entirely
      // drawn rotor/stabilizer (the Chinook) keeps only its procedural
      // parts. Only a thrown error falls back to the full slab.
      shapes = clipPlanformBand(shapes, minY, vbH, features.planformClip);
    } catch (e) {
      console.warn(`[shape-geometry] planform clip failed for "${shapeName}", using full slab:`, e);
    }
  }
  const depth = vbH * (features?.fuselage ? WING_THICKNESS_RATIO : THICKNESS_RATIO);
  let geom: BufferGeometry | null =
    shapes.length > 0
      ? new ExtrudeGeometry(shapes, {
          depth,
          bevelEnabled: false,
          curveSegments: CURVE_SEGMENTS,
        })
      : null;

  // Merge in the annotated 3D features (fin, nacelles) while still in raw
  // viewBox space, so the shared centering/rotation/scaling below applies
  // to them identically and planform alignment is by construction. A bad
  // annotation must not cost the shape its silhouette: on any failure we
  // keep the bare extrusion instead of letting the error reach the
  // negative cache (which would demote the shape to the cone fallback).
  if (features) {
    try {
      const parts = buildFeatureParts(shapeName, features, minX, minY, vbW, vbH, depth);
      // ExtrudeGeometry is non-indexed while the primitive parts are
      // indexed; mergeGeometries refuses mixed input, so unindex first.
      const merged = mergeGeometries(
        [...(geom ? [geom] : []), ...parts.map((p) => (p.index ? p.toNonIndexed() : p))],
        false
      );
      if (merged) {
        geom?.dispose();
        parts.forEach((p) => p.dispose());
        geom = merged;
      }
    } catch (e) {
      console.warn(`[shape-geometry] 3D features failed for "${shapeName}", using bare silhouette:`, e);
    }
  }
  // A fully clipped slab with no buildable features has nothing to show —
  // let the caller fall back to the cone.
  if (!geom) return null;

  // SVG space → scene space: center on the viewBox (the sprite's rotation
  // anchor), then rotate the SVG plane flat. rotateX(+π/2) maps SVG +y
  // (down, toward the tail) to scene +z (south) and the extrusion axis to
  // vertical, so the nose ends up at -z with no mirroring — matching both
  // the cone convention and the ground sprite underneath.
  geom.translate(-(minX + vbW / 2), -(minY + vbH / 2), -depth / 2);
  geom.rotateX(Math.PI / 2);
  // Match the ground sprite's sizing exactly, including its (possibly
  // non-uniform) stretch of the viewBox onto a w/h-aspect rectangle —
  // see the iconW/iconH derivation in reconciler.ts. Thickness rides the
  // length scale so it stays THICKNESS_RATIO of nose-to-tail.
  const aspect = def.w / def.h;
  const wUnits = MARKER_FOOTPRINT_UNITS * (aspect >= 1 ? aspect : 1);
  const hUnits = MARKER_FOOTPRINT_UNITS * (aspect >= 1 ? 1 : 1 / aspect);
  const sz = hUnits / vbH;
  geom.scale(wUnits / vbW, sz, sz);
  geom.computeBoundingSphere();
  return geom;
}

// Feature builders. All parts are authored in the same frame the body
// extrusion occupies before the shared transforms: x/y are absolute viewBox
// coordinates, z is the extrusion axis with the body solid spanning
// [0, depth] and z=0 the face that ends up on top — so "up" is -z here.

// Fin (and tailplane) thickness relative to the body slab. Thinner than the
// fuselage so vertical surfaces read as surfaces, not blocks.
const SURFACE_THICKNESS_RATIO = 0.4;

/**
 * Build the annotated feature geometries for one shape, in raw viewBox
 * space, ready to merge with the body extrusion. Exported for the
 * drift-guard test's vertex accounting.
 */
export function buildFeatureParts(
  shapeName: string,
  features: ShapeFeatures,
  minX: number,
  minY: number,
  vbW: number,
  vbH: number,
  depth: number
): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  if (features.fuselage) {
    const fu = features.fuselage;
    const cx = minX + vbW / 2;
    const profile = FUSELAGE_PROFILES[shapeName];
    if (profile && profile.length >= 2) {
      parts.push(buildLoftedFuselage(profile, fu, cx, minY, vbW, vbH, depth));
    } else {
      // Fallback for shapes without a generated profile: nose cone + open
      // cylinder + longer tail cone, all 8-segment. Cap lengths are
      // proportional to the radius but clamped so a short fuselage still
      // keeps a cylindrical mid-section.
      const r = fu.radius * vbW;
      const len = (fu.tail - fu.nose) * vbH;
      const noseLen = Math.min(r * 2.5, len / 3);
      const tailLen = Math.min(r * 5, len / 3);
      const zc = depth / 2; // tube centered on the slab's mid-plane
      const yNose = minY + fu.nose * vbH;
      const yTail = minY + fu.tail * vbH;
      const noseCone = new ConeGeometry(r, noseLen, 8, 1, true);
      noseCone.rotateZ(Math.PI); // apex forward (toward -y)
      noseCone.translate(cx, yNose + noseLen / 2, zc);
      const mid = new CylinderGeometry(r, r, len - noseLen - tailLen, 8, 1, true);
      mid.translate(cx, yNose + noseLen + (len - noseLen - tailLen) / 2, zc);
      const tailCone = new ConeGeometry(r, tailLen, 8, 1, true); // apex aft (+y)
      tailCone.translate(cx, yTail - tailLen / 2, zc);
      parts.push(noseCone, mid, tailCone);
    }
  }
  const fins = [...(features.fin ? [features.fin] : []), ...(features.fins ?? [])];
  for (const f of fins) {
    const x = minX + (f.x ?? 0.5) * vbW;
    const yRoot = minY + f.y * vbH;
    const t = depth * SURFACE_THICKNESS_RATIO;
    // Trapezoid in a 2D shape space: shape-x runs along the fuselage
    // (viewBox y), shape-y is height above the body top. The root starts
    // half a slab below the top so its cap is buried inside the body —
    // a cap coplanar with the body's top face would shimmer.
    const base = -depth / 2;
    const s = new Shape();
    s.moveTo(yRoot, base);
    s.lineTo(yRoot + f.rootChord * vbH, base);
    s.lineTo(yRoot + (f.sweep + f.tipChord) * vbH, f.height * vbH);
    s.lineTo(yRoot + f.sweep * vbH, f.height * vbH);
    s.closePath();
    const g = new ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -t / 2);
    // Stand the trapezoid up: chord → viewBox y, height → -z (up),
    // thickness → viewBox x. A proper rotation (det +1), so winding and
    // normals survive.
    g.applyMatrix4(
      new Matrix4().makeBasis(new Vector3(0, 1, 0), new Vector3(0, 0, -1), new Vector3(-1, 0, 0))
    );
    g.translate(x, 0, 0);
    parts.push(g);
  }
  if (features.tailplane) {
    // Swept, tapered planform: a symmetric hexagon (root chord at the
    // centerline, tips swept aft and tapered) extruded to plate thickness.
    // With tipChord = chord and sweep = 0 it degenerates to the old
    // rectangle. The surface already lies in the viewBox x/y plane, so
    // unlike the fin no basis change is needed — just raise it on -z.
    const tp = features.tailplane;
    const halfSpan = (tp.span / 2) * vbW;
    const rootChord = tp.chord * vbH;
    const tipChord = (tp.tipChord ?? tp.chord) * vbH;
    const sweep = (tp.sweep ?? 0) * vbH;
    const t = depth * SURFACE_THICKNESS_RATIO;
    const s = new Shape();
    s.moveTo(0, 0);
    s.lineTo(halfSpan, sweep);
    s.lineTo(halfSpan, sweep + tipChord);
    s.lineTo(0, rootChord);
    s.lineTo(-halfSpan, sweep + tipChord);
    s.lineTo(-halfSpan, sweep);
    s.closePath();
    const g = new ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 1 });
    g.translate(minX + vbW / 2, minY + tp.y * vbH, -tp.height * vbH - t / 2);
    parts.push(g);
  }
  for (const e of features.engines ?? []) {
    const r = e.radius * vbH;
    const len = e.length * vbH;
    const x = minX + e.x * vbW;
    const yC = minY + e.y * vbH;
    const zc = depth + (e.drop ?? 0) * vbH;
    const g = new CylinderGeometry(r, r, len, 8, 1);
    // The cylinder's native +y axis already runs nose-to-tail in this
    // frame — translate only. Default hang centers the nacelle on the
    // body's underside so half the barrel shows below the wing.
    g.translate(x, yC, zc);
    parts.push(g);
    // Intake lip: a slightly wider open ring at the front of the barrel.
    // The step in silhouette is what makes a cylinder read as an engine
    // rather than a fuel tank.
    const lipLen = len * 0.22;
    const lip = new CylinderGeometry(r * 1.25, r * 1.25, lipLen, 8, 1, true);
    lip.translate(x, yC - len / 2 + lipLen / 2, zc);
    parts.push(lip);
  }
  for (const ro of features.rotors ?? []) {
    // Four-blade rotor caught mid-frame: two crossed boxes on a mast. A
    // solid disc reads as a turtle shell from above and hides the cabin;
    // open blades keep the helicopter recognizable at every angle. Blades
    // are deliberately chunky and the mast tall — at marker scale a thin
    // low rotor disappears and the body reads as an airship.
    const x = minX + (ro.x ?? 0.5) * vbW;
    const y = minY + ro.y * vbH;
    const zBlades = -vbH * 0.068; // blade plane well above the cabin (-z is up)
    const span = 2 * ro.radius * vbW;
    const bladeW = Math.max(vbW * 0.03, ro.radius * vbW * 0.14);
    for (const deg of ro.angles ?? [45, 135]) {
      const blade = new BoxGeometry(span, bladeW, vbH * 0.016);
      blade.rotateZ((deg * Math.PI) / 180);
      blade.translate(x, y, zBlades);
      parts.push(blade);
    }
    const mast = new CylinderGeometry(vbW * 0.018, vbW * 0.018, -zBlades, 6, 1);
    mast.rotateX(Math.PI / 2); // axis vertical
    mast.translate(x, y, zBlades / 2);
    parts.push(mast);
  }
  if (features.tailRotor) {
    // Small crossed pair standing in the vertical plane beside the boom
    // tip — the side-profile cue that says helicopter more than anything
    // else on the airframe.
    const tr = features.tailRotor;
    const x = minX + vbW / 2 + (tr.x ?? 0.035) * vbW;
    const y = minY + tr.y * vbH;
    const zc = depth / 2;
    const R = tr.radius * vbW;
    const w = Math.max(vbW * 0.018, R * 0.22);
    const t = vbW * 0.012;
    const vertical = new BoxGeometry(t, w, 2 * R);
    vertical.translate(x, y, zc);
    const horizontal = new BoxGeometry(t, 2 * R, w);
    horizontal.translate(x, y, zc);
    parts.push(vertical, horizontal);
  }
  return parts;
}

/**
 * Remove a horizontal band from the planform outline (SVG y grows toward
 * the tail): keep the piece forward of the band and any piece aft of it.
 * Sutherland-Hodgman against a single half-plane per piece — valid as long
 * as the outline crosses each cut line exactly twice (fuselage sides),
 * which holds for the tailplane cuts this exists for. Shape holes are not
 * carried through; no clipped shape uses them.
 */
function clipPlanformBand(
  shapes: Shape[],
  minY: number,
  vbH: number,
  band: { y0: number; y1: number }
): Shape[] {
  const yLo = minY + band.y0 * vbH;
  const yHi = minY + band.y1 * vbH;
  const clipHalf = (pts: Vector2[], keepBefore: boolean, yCut: number): Vector2[] => {
    const out: Vector2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const aIn = keepBefore ? a.y <= yCut : a.y >= yCut;
      const bIn = keepBefore ? b.y <= yCut : b.y >= yCut;
      if (aIn) out.push(a);
      if (aIn !== bIn) {
        const t = (yCut - a.y) / (b.y - a.y);
        out.push(new Vector2(a.x + (b.x - a.x) * t, yCut));
      }
    }
    return out;
  };
  const result: Shape[] = [];
  for (const s of shapes) {
    const pts = s.getPoints(CURVE_SEGMENTS);
    for (const piece of [clipHalf(pts, true, yLo), clipHalf(pts, false, yHi)]) {
      if (piece.length >= 3) result.push(new Shape(piece));
    }
  }
  return result;
}

// Radial segments of the lofted fuselage tube.
const LOFT_RADIAL = 8;

/**
 * Fuselage tube lofted along the measured width profile: one elliptical
 * ring per station, quads between rings, small fan caps at the ends.
 * Horizontal radius follows the drawing (so the slab never pokes out
 * sideways); vertical radius is capped at the shape's base body radius so
 * belly fairings spread wide instead of tall, like the real thing.
 */
function buildLoftedFuselage(
  profile: number[],
  fu: FuselageFeature,
  cx: number,
  minY: number,
  vbW: number,
  vbH: number,
  depth: number
): BufferGeometry {
  const n = profile.length;
  const zc = depth / 2;
  const vCap = fu.radius * vbW;
  const ringY: number[] = [];
  const rings: Array<Array<[number, number, number]>> = [];
  for (let i = 0; i < n; i++) {
    const y = minY + (fu.nose + (fu.tail - fu.nose) * ((i + 0.5) / n)) * vbH;
    ringY.push(y);
    const xr = Math.max(profile[i]! * vbW, vbW * 0.002);
    const zr = Math.min(xr, vCap);
    const ring: Array<[number, number, number]> = [];
    for (let j = 0; j < LOFT_RADIAL; j++) {
      const t = (j / LOFT_RADIAL) * Math.PI * 2;
      ring.push([cx + xr * Math.cos(t), y, zc + zr * Math.sin(t)]);
    }
    rings.push(ring);
  }
  const pos: number[] = [];
  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    pos.push(...a, ...b, ...c);
  };
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < LOFT_RADIAL; j++) {
      const k = (j + 1) % LOFT_RADIAL;
      // CCW seen from outside (verified via face-normal orientation test).
      tri(rings[i]![j]!, rings[i + 1]![j]!, rings[i + 1]![k]!);
      tri(rings[i]![j]!, rings[i + 1]![k]!, rings[i]![k]!);
    }
  }
  // End caps: flat fans on the first/last ring planes. The generated
  // profiles taper toward the tips, so these disks stay small.
  const noseC: [number, number, number] = [cx, ringY[0]!, zc];
  const tailC: [number, number, number] = [cx, ringY[n - 1]!, zc];
  for (let j = 0; j < LOFT_RADIAL; j++) {
    const k = (j + 1) % LOFT_RADIAL;
    tri(noseC, rings[0]![j]!, rings[0]![k]!); // faces -y (forward)
    tri(tailC, rings[n - 1]![k]!, rings[n - 1]![j]!); // faces +y (aft)
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  // Merge partner attributes: the body extrusion carries uv, so this part
  // must too — mergeGeometries drops nothing silently, it just fails.
  g.setAttribute('uv', new Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.computeVertexNormals();
  return g;
}
