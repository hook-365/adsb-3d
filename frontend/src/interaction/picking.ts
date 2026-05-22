import { PerspectiveCamera, Raycaster, Vector2 } from 'three';
import type { AircraftReconciler } from '../aircraft/reconciler';

// Click/tap-to-select on the 3D scene, mouse + touch + pen.
//
// We coexist with OrbitControls by distinguishing a click/tap from a drag:
// if the pointer moves more than a few pixels between down and up, it was a
// drag — leave the controls to handle it. Otherwise raycast a ray through
// the up point and ask the reconciler which aircraft (if any) it hit.
//
// Touch is finicky: fingers jitter much more than a mouse, and any
// multi-touch gesture (pinch/two-finger pan) should be left entirely to
// OrbitControls. We track every active pointer and bail out of tap
// detection the moment a second one shows up.

const CLICK_THRESHOLD_PX_MOUSE = 5;
const CLICK_THRESHOLD_PX_TOUCH = 14;

interface ActivePointer {
  startX: number;
  startY: number;
  pointerType: string;
}

export interface PickingOptions {
  canvas: HTMLCanvasElement;
  camera: PerspectiveCamera;
  reconciler: AircraftReconciler;
  onSelect: (hex: string | null) => void;
}

export function attachPicking(opts: PickingOptions): void {
  const { canvas, camera, reconciler, onSelect } = opts;

  // Stop the browser from interpreting touch drags as page scroll/zoom.
  // OrbitControls also sets this internally, but being explicit makes
  // the canvas's touch contract obvious.
  canvas.style.touchAction = 'none';

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const active = new Map<number, ActivePointer>();
  let aborted = false;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (active.size > 0) {
      // Multi-touch / multi-button — definitely a gesture, not a tap.
      aborted = true;
    }
    active.set(e.pointerId, {
      startX: e.clientX,
      startY: e.clientY,
      pointerType: e.pointerType
    });
  });

  function clearPointer(id: number): void {
    active.delete(id);
    if (active.size === 0) aborted = false;
  }

  canvas.addEventListener('pointercancel', (e) => clearPointer(e.pointerId));
  canvas.addEventListener('pointerleave', (e) => clearPointer(e.pointerId));

  canvas.addEventListener('pointerup', (e) => {
    const start = active.get(e.pointerId);
    clearPointer(e.pointerId);
    if (!start || aborted) return;

    const dx = e.clientX - start.startX;
    const dy = e.clientY - start.startY;
    const threshold =
      start.pointerType === 'mouse' ? CLICK_THRESHOLD_PX_MOUSE : CLICK_THRESHOLD_PX_TOUCH;
    if (dx * dx + dy * dy > threshold * threshold) return;

    const rect = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    const hex = reconciler.pick(raycaster);
    onSelect(hex);
  });
}
