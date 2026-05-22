import {
  AmbientLight,
  CircleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  Texture,
  WebGLRenderer
} from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RANGE_NM } from '../core/config';
import { getSettings, subscribeSettings } from '../core/settings';
import { createTileLayer } from './tiles';

export interface World {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  aircraftRoot: Mesh; // a Group would be fine; using Mesh-friendly Object3D anyway
  /**
   * Rebuild the basemap tile layer around the current HOME. Range rings
   * and the home marker live at the scene origin (which is HOME by
   * construction) so they don't need to move; only the basemap, whose
   * tile mesh world positions were baked at construction time via
   * toScene(), gets disposed and recreated.
   */
  recenter(): void;
}

export function createWorld(canvas: HTMLCanvasElement): World {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new Scene();
  scene.background = new Color(0x050810);
  scene.fog = new FogExp2(0x050810, 0.0015);

  scene.add(new AmbientLight(0x6680aa, 0.5));
  const key = new DirectionalLight(0x9fd2ff, 1.1);
  key.position.set(120, 220, 80);
  scene.add(key);

  // Slippy-map basemap underneath everything. The tile layer attaches its
  // meshes at y = -0.4 with renderOrder = -10 so the range rings and
  // trails draw cleanly on top. Stored so recenter() can swap it on
  // feed switch or when the user picks a different basemap provider.
  let tileLayer: Group = createTileLayer({ provider: getSettings().basemap });
  scene.add(tileLayer);

  function disposeTileLayer(layer: Group): void {
    for (const child of layer.children) {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        const mat = child.material as MeshBasicMaterial;
        const map = mat.map as Texture | null;
        if (map) map.dispose();
        mat.dispose();
      }
    }
  }

  function recenter(): void {
    scene.remove(tileLayer);
    disposeTileLayer(tileLayer);
    tileLayer = createTileLayer({ provider: getSettings().basemap });
    scene.add(tileLayer);
  }

  // Range rings every 50 NM as a quick distance reference on top of the basemap.
  // Stashed in a Group so a single .visible toggle handles the whole set.
  const ringsGroup = new Group();
  ringsGroup.name = 'range-rings';
  for (let r = 50; r <= RANGE_NM; r += 50) {
    const ring = new Mesh(
      new RingGeometry(r - 0.5, r + 0.5, 128),
      new MeshBasicMaterial({
        color: r === RANGE_NM ? 0x4cc8ff : 0x66aaff,
        transparent: true,
        opacity: r === RANGE_NM ? 0.65 : 0.25,
        depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ringsGroup.add(ring);
  }
  // Range-distance labels along the N axis — "50", "100", … "250 NM".
  // Children of the rings group so they share the same toggle.
  for (let r = 50; r <= RANGE_NM; r += 50) {
    const el = document.createElement('div');
    el.className = 'axis-label range';
    el.textContent = r === RANGE_NM ? `${r} NM` : `${r}`;
    const label = new CSS2DObject(el);
    label.position.set(0, 0.05, -r);
    ringsGroup.add(label);
  }
  ringsGroup.visible = getSettings().rangeRings;
  scene.add(ringsGroup);

  // Cardinal direction labels at the outer ring. Always visible —
  // they remain a useful orientation cue even with rings off.
  const cardinalsGroup = new Group();
  cardinalsGroup.name = 'cardinals';
  const CARDINAL_OFFSET = RANGE_NM + 8;
  for (const [text, x, z] of [
    ['N', 0, -CARDINAL_OFFSET],
    ['S', 0, CARDINAL_OFFSET],
    ['E', CARDINAL_OFFSET, 0],
    ['W', -CARDINAL_OFFSET, 0],
  ] as const) {
    const el = document.createElement('div');
    el.className = 'axis-label cardinal';
    el.textContent = text;
    const label = new CSS2DObject(el);
    label.position.set(x, 0.05, z);
    cardinalsGroup.add(label);
  }
  scene.add(cardinalsGroup);

  // Home antenna marker — a small dot on the ground at the receiver's
  // location, like tar1090. No tower, no toggle: it's a quiet anchor for
  // the scene origin and shouldn't compete visually with aircraft.
  const home = new Mesh(
    new CircleGeometry(1.2, 24),
    new MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  home.rotation.x = -Math.PI / 2;
  home.position.y = 0.07;
  home.renderOrder = 2; // draw above range rings + tile layer
  home.name = 'home-marker';
  scene.add(home);

  // Apply settings changes live. Visibility-only flags toggle directly;
  // a basemap change requires rebuilding the tile layer (textures and
  // mesh sources are baked at construction time).
  // Unsubscribe handle intentionally discarded — page-lifetime singleton.
  let lastBasemap = getSettings().basemap;
  subscribeSettings((s) => {
    ringsGroup.visible = s.rangeRings;
    if (s.basemap !== lastBasemap) {
      lastBasemap = s.basemap;
      recenter();
    }
  });

  // The aircraft reconciler attaches its meshes under here. Using an
  // Object3D would be cleaner but Mesh's prototype is fine and keeps
  // import surface small.
  const aircraftRoot = new Mesh();
  aircraftRoot.name = 'aircraft-root';
  scene.add(aircraftRoot);

  const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 4000);
  camera.position.set(0, 220, 280);
  camera.lookAt(0, 0, 0);

  return { scene, camera, renderer, aircraftRoot, recenter };
}
