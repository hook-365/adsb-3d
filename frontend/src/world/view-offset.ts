import type { PerspectiveCamera } from 'three';

// Docked panel style only: the sidebar and the left column permanently
// cover strips of the canvas, so the scene's centre (HOME, the orbit
// target) would sit off-centre in what the user can actually see.
// Rather than move the camera, shift the projection with
// PerspectiveCamera.setViewOffset: we pretend the frame is wider by the
// covered strips and render the visible window of it, which puts the
// projection centre in the middle of the uncovered area. Object scale is
// unchanged (it depends on the vertical FOV only) and picking + CSS labels
// keep working because both go through the camera's projection matrix.
//
// Glass style floats its cards, so there the centre stays put. Stereo
// (StereoCamera derives its eyes from the projection matrix) and XR
// (renderer-owned cameras) both clear the offset.

const SIDEBAR_W = 320;
const LEFT_COLUMN_W = 340;
/** Below this much uncovered width the shift costs more than it helps. */
const MIN_VISIBLE_W = 480;

export interface ViewInsets {
  left: number;
  right: number;
}

/** Pure: what the docked chrome covers, given the DOM's current state. */
export function computeViewInsets(doc: Document, viewportW: number): ViewInsets {
  const none = { left: 0, right: 0 };
  if (doc.documentElement.dataset.panelStyle !== 'docked') return none;
  const body = doc.body.classList;
  if (body.contains('stereo-on') || body.contains('xr-on')) return none;
  const sidebar = doc.getElementById('aircraft-panel');
  const detail = doc.getElementById('panel-detail');
  const acars = doc.getElementById('acars-panel');
  const right = sidebar && !sidebar.classList.contains('collapsed') ? SIDEBAR_W : 0;
  const leftOpen = (detail && !detail.hidden) || (acars && !acars.hidden);
  const left = leftOpen ? LEFT_COLUMN_W : 0;
  if (viewportW - left - right < MIN_VISIBLE_W) return none;
  return { left, right };
}

/** Pure: the setViewOffset arguments for a viewport and its insets. */
export function viewOffsetFor(
  w: number,
  h: number,
  insets: ViewInsets,
): [fullW: number, fullH: number, x: number, y: number, w: number, h: number] | null {
  if (insets.left === 0 && insets.right === 0) return null;
  // Full frame = viewport + both strips; show the window that starts
  // `right` px in, so the frame's centre lands at w/2 + (left - right)/2.
  return [w + insets.left + insets.right, h, insets.right, 0, w, h];
}

/** Boot hook: keeps the camera's view offset in step with the chrome. */
export function mountViewOffset(camera: PerspectiveCamera): () => void {
  let last: ViewInsets = { left: 0, right: 0 };
  const apply = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const insets = computeViewInsets(document, w);
    const args = viewOffsetFor(w, h, insets);
    if (args) camera.setViewOffset(...args);
    else if (camera.view?.enabled) camera.clearViewOffset();
    else if (last.left === insets.left && last.right === insets.right) return;
    last = insets;
    camera.updateProjectionMatrix();
  };
  const mo = new MutationObserver(apply);
  const watch = (el: Element | null, attrs: string[]): void => {
    if (el) mo.observe(el, { attributes: true, attributeFilter: attrs });
  };
  watch(document.documentElement, ['data-panel-style']);
  watch(document.body, ['class']);
  watch(document.getElementById('aircraft-panel'), ['class']);
  watch(document.getElementById('panel-detail'), ['hidden']);
  watch(document.getElementById('acars-panel'), ['hidden']);
  // After main.ts's own resize handler (registered earlier) has reset
  // the aspect; setViewOffset's full-frame width must track the viewport.
  window.addEventListener('resize', apply);
  apply();
  return () => {
    mo.disconnect();
    window.removeEventListener('resize', apply);
    if (camera.view?.enabled) {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }
  };
}
