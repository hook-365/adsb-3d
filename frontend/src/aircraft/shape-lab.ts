// Dev-only tuning harness for the 3D silhouette features. Mounted from
// main.ts behind `import.meta.env.DEV && ?shapeLab=1` via dynamic import,
// so none of this reaches the production bundle. It overlays the running
// app with its own renderer showing every annotated shape's merged
// geometry hovering above a plane textured with that shape's own ground
// sprite — the 2D sprite is ground truth for the planform, so from
// top-down the nacelles must sit exactly on the drawn engines, and an
// oblique orbit judges fin shape and winding (dark faces = flipped caps).
//
// Tune loop: edit fractions in shape-features.ts → Vite reloads (module
// reload resets the geometry cache) → recheck.

import {
  AmbientLight,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getSilhouetteGeometry } from './shape-geometry';
import { getShapeTexture } from './shapes';
import { SHAPE_FEATURES } from './shape-features';

const CELL = 14; // scene units per grid cell; silhouettes have a 5.5-unit footprint
const HOVER = 2.5; // body height above its sprite plane

export function mountShapeLab(): void {
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#10141c;';
  document.body.appendChild(root);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  root.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.add(new AmbientLight(0x6680aa, 0.5));
  const key = new DirectionalLight(0x9fd2ff, 1.1);
  key.position.set(30, 60, 20);
  scene.add(key);

  const names = Object.keys(SHAPE_FEATURES).sort();
  const cols = Math.ceil(Math.sqrt(names.length));
  const grid = new Group();
  scene.add(grid);

  const bodyMat = new MeshStandardMaterial({ color: 0xd8b24a, metalness: 0.4, roughness: 0.3 });

  names.forEach((name, i) => {
    const cell = new Group();
    cell.position.set((i % cols) * CELL, 0, Math.floor(i / cols) * CELL);

    const geom = getSilhouetteGeometry(name);
    if (geom) {
      const body = new Mesh(geom, bodyMat);
      body.position.y = HOVER;
      cell.add(body);
    }

    const tex = getShapeTexture(name);
    if (tex) {
      const plane = new Mesh(
        new PlaneGeometry(5.5 * Math.max(1, tex.aspect), 5.5 / Math.min(1, tex.aspect)),
        new MeshBasicMaterial({ map: tex.texture, transparent: true, side: DoubleSide })
      );
      plane.rotation.x = -Math.PI / 2;
      cell.add(plane);
    }

    const label = document.createElement('div');
    label.textContent = name;
    label.style.cssText =
      'position:absolute;color:#9fd2ff;font:12px monospace;pointer-events:none;transform:translate(-50%,0);';
    root.appendChild(label);
    cell.userData.label = label;

    grid.add(cell);
  });

  const extent = cols * CELL;
  const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(extent / 2, extent * 0.9, extent * 1.1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(extent / 2 - CELL / 2, 0, extent / 2 - CELL / 2);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    controls.update();
    // Project each cell's origin to screen space for its name label.
    for (const cell of grid.children) {
      const label = cell.userData.label as HTMLDivElement;
      const p = cell.position.clone().project(camera);
      label.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
      label.style.top = `${((1 - p.y) / 2) * window.innerHeight + 14}px`;
      label.style.display = p.z < 1 ? 'block' : 'none';
    }
    renderer.render(scene, camera);
  });
}
