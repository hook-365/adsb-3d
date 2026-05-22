import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// CSS2DRenderer overlays a transparent DOM layer on top of the WebGL
// canvas and positions child elements via CSS transforms each frame.
// Cheap, crisp text at any zoom — no per-aircraft canvas/texture churn.

export function createLabelRenderer(): CSS2DRenderer {
  const renderer = new CSS2DRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const el = renderer.domElement;
  el.style.position = 'fixed';
  el.style.inset = '0';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '5';
  document.body.appendChild(el);
  return renderer;
}
