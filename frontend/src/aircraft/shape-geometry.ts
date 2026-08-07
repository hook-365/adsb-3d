import { BufferGeometry, ExtrudeGeometry, Shape } from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { getShapeDef } from './shapes';

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
  const shapes: Shape[] = [];
  for (const p of new SVGLoader().parse(svgText).paths) {
    shapes.push(...SVGLoader.createShapes(p));
  }
  if (shapes.length === 0) return null;

  const depth = vbH * THICKNESS_RATIO;
  const geom = new ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: false,
    curveSegments: CURVE_SEGMENTS,
  });

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
