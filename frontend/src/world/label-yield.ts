import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// Labels of things fixed in the world (airports, navaids, fixes, airspace)
// are HTML laid over the canvas, so the depth buffer cannot hide them: an
// aircraft flying between the camera and an airport would be drawn under
// that airport's name. This pass fades such a label while an aircraft that
// is clearly nearer the camera overlaps it on screen.
//
// A layer opts its label group in once with yieldToAircraft(); main.ts
// runs updateLabelYield() a few times a second with the aircraft bodies
// in view.

/** Class the pass toggles; style.css fades it and lets clicks through. */
export const YIELD_CLASS = 'yielding';
/**
 * How much nearer the aircraft must be, as a fraction of the label's own
 * distance. Keeps traffic on and just over a field from blinking that
 * field's label: it yields to what is plainly in front of it.
 */
export const YIELD_NEARER = 0.9;
/** Extra room around the label, px, so it fades just before the overlap. */
const MARGIN_PX = 4;

export interface ScreenBody {
  x: number;
  y: number;
  /** Drawn radius, px. */
  r: number;
  /** Distance from the camera, scene units. */
  d: number;
}

/** Pure: does any body nearer than the label overlap its rectangle (centre cx, cy)? */
export function labelYields(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  labelDist: number,
  bodies: readonly ScreenBody[],
): boolean {
  const limit = labelDist * YIELD_NEARER;
  for (const b of bodies) {
    if (b.d >= limit) continue;
    const dx = Math.max(Math.abs(b.x - cx) - halfW - MARGIN_PX, 0);
    const dy = Math.max(Math.abs(b.y - cy) - halfH - MARGIN_PX, 0);
    if (dx * dx + dy * dy <= b.r * b.r) return true;
  }
  return false;
}

const groups = new Set<Object3D>();
const sizes = new WeakMap<HTMLElement, { w: number; h: number }>();
const bodies: ScreenBody[] = [];
let bodyCount = 0;
const tmp = new Vector3();
const camPos = new Vector3();

/** Opt every CSS label under this group into yielding to aircraft. */
export function yieldToAircraft(group: Object3D): void {
  groups.add(group);
}

export type BodyVisitor = (fn: (position: Vector3, radius: number) => void) => void;

export function updateLabelYield(camera: PerspectiveCamera, width: number, height: number, forEachBody: BodyVisitor): void {
  camera.getWorldPosition(camPos);
  // Pixels per scene unit at distance 1.
  const focal = (height / 2) * camera.projectionMatrix.elements[5]!;
  bodyCount = 0;
  forEachBody((position, radius) => {
    const d = position.distanceTo(camPos);
    tmp.copy(position).project(camera);
    if (tmp.z > 1 || d <= 0) return;
    const body = bodies[bodyCount] ?? (bodies[bodyCount] = { x: 0, y: 0, r: 0, d: 0 });
    body.x = (tmp.x * 0.5 + 0.5) * width;
    body.y = (-tmp.y * 0.5 + 0.5) * height;
    // The cull radius is generous; the silhouette fills about half of it.
    body.r = ((radius * 0.5) / d) * focal;
    body.d = d;
    bodyCount++;
  });
  bodies.length = bodyCount;

  for (const group of groups) {
    for (const child of group.children) {
      if (!(child instanceof CSS2DObject)) continue;
      const el = child.element;
      let yields = false;
      if (bodyCount > 0 && group.visible && child.visible && el.style.display !== 'none') {
        let size = sizes.get(el);
        if (!size || size.w === 0) {
          size = { w: el.offsetWidth, h: el.offsetHeight };
          sizes.set(el, size);
        }
        child.getWorldPosition(tmp);
        const d = tmp.distanceTo(camPos);
        tmp.project(camera);
        if (tmp.z <= 1) {
          const cx = (tmp.x * 0.5 + 0.5) * width + (0.5 - child.center.x) * size.w;
          const cy = (-tmp.y * 0.5 + 0.5) * height + (0.5 - child.center.y) * size.h;
          yields = labelYields(cx, cy, size.w / 2, size.h / 2, d, bodies);
        }
      }
      el.classList.toggle(YIELD_CLASS, yields);
    }
  }
}
