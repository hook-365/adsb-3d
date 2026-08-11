import { Plane, Vector3 } from 'three';

// "Desk ornament" diorama clipping (issue #6): clip the whole airspace to
// an open-top box around the placed scope so, in AR passthrough, the world
// reads as a bounded ornament sitting on real furniture — aircraft fly in
// through the walls and terrain ends cleanly at the edges.
//
// Mechanics: three's per-material clipping (renderer.localClippingEnabled)
// with ONE shared plane array. Every material that lives under xrRoot is
// created with `clippingPlanes: DIORAMA_PLANES`; metre-space objects
// (controllers, wrist menu, AR reticle, the XR billboard) simply never get
// the assignment. Global renderer.clippingPlanes is NOT used because it
// cannot exempt those.
//
// The array is mutated in place so material references never go stale:
// empty = clipping off (three skips the clipping chunks entirely),
// five planes = active box. Toggling the count re-links shader programs
// once — an acceptable hitch on an explicit user action.
//
// The box lives in METRE space (the XR rig's frame), not scene units:
// the walls stay glued to the desk while locomotion slides and scales the
// world (xrRoot) beneath them — exactly the snow-globe illusion.

export const DIORAMA_PLANES: Plane[] = [];

// Planes point INWARD (three keeps fragments on the positive side).
// Rebuilt in place by setDioramaBox so the shared array reference held by
// every material stays valid.
const SIDE_NORMALS: ReadonlyArray<Vector3> = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];
const UP = new Vector3(0, 1, 0);

// The bottom plane sits slightly under the box center so the basemap tile
// (at the placement height) survives float jitter instead of shimmering.
const BOTTOM_EPSILON_M = 0.02;

/**
 * Activate (or move/resize) the diorama box. `center` is the box center in
 * metre space — the placed scope origin; `size` is the full wall-to-wall
 * width in metres. Open-topped: traffic above the walls stays visible,
 * which reads charmingly rather than wrong.
 */
export function setDioramaBox(center: Vector3, size: number): void {
  const half = size / 2;
  DIORAMA_PLANES.length = 0;
  for (const n of SIDE_NORMALS) {
    // Plane: n·p + constant >= 0 kept. For an inward normal the wall sits
    // at distance `half` along -n from the center.
    const wallPoint = center.clone().addScaledVector(n, -half);
    DIORAMA_PLANES.push(new Plane(n.clone(), -n.dot(wallPoint)));
  }
  const bottomPoint = center.clone();
  bottomPoint.y -= BOTTOM_EPSILON_M;
  DIORAMA_PLANES.push(new Plane(UP.clone(), -UP.dot(bottomPoint)));
}

/** Deactivate clipping. Mutates the shared array in place. */
export function clearDiorama(): void {
  DIORAMA_PLANES.length = 0;
}

/** Whether the box is currently active. */
export function dioramaActive(): boolean {
  return DIORAMA_PLANES.length > 0;
}

/**
 * Whether a metre-space point lies inside the active box (always true when
 * inactive). Used to reject picks on aircraft the walls have clipped away
 * — invisible targets shouldn't be selectable.
 */
export function insideDiorama(point: Vector3): boolean {
  for (const plane of DIORAMA_PLANES) {
    if (plane.distanceToPoint(point) < 0) return false;
  }
  return true;
}

/**
 * Center of the active box (for the follow-mode target), or null.
 * Derived from the bottom plane + side planes rather than stored, so
 * there is exactly one source of truth.
 */
export function dioramaCenter(out: Vector3): Vector3 | null {
  if (DIORAMA_PLANES.length !== 5) return null;
  // Side planes come in +x/-x/+z/-z order; each wall sits at
  // constant = -n·(center - half·n) → n·center = half - constant... solve
  // from the opposing pair instead: x walls give center.x.
  const px = DIORAMA_PLANES[0]!;
  const nx = DIORAMA_PLANES[1]!;
  const pz = DIORAMA_PLANES[2]!;
  const nz = DIORAMA_PLANES[3]!;
  const bottom = DIORAMA_PLANES[4]!;
  out.set(
    (-px.constant - -nx.constant) / 2,
    -bottom.constant + BOTTOM_EPSILON_M,
    (-pz.constant - -nz.constant) / 2,
  );
  return out;
}
