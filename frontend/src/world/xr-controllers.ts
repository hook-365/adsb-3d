import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Raycaster,
  Vector3,
  WebGLRenderer,
} from 'three';
import { getTheme, subscribeTheme } from '../core/theme';
import { insideDiorama } from './diorama-clip';

// XR controller wiring for Phase 2. Each controller gets a small cone
// visualizer (so the user can see where the device is in space — no
// XRControllerModelFactory dep here, which would pull in a CDN profile
// fetch and a non-trivial bundle) plus a laser pointer line.
//
// On trigger press (the 'selectstart' XR input event), we raycast from
// the controller's pose down its -Z axis into the pickRoot's descendants
// and find the first hit whose userData.kind === 'aircraft-pick'. Those
// pick proxies are attached by aircraft/reconciler.ts to every aircraft
// Group, so they cover live + historical aircraft alike.
//
// Pressing the trigger in empty space deselects (passes null to onPick).
// This matches the existing 2D click-to-deselect behaviour in main.ts.

export type Handedness = 'left' | 'right' | 'none';

export interface XrControllersOptions {
  renderer: WebGLRenderer;
  /** Where to attach the controller groups (typically the Scene). */
  scene: Object3D;
  /** Root whose descendants are eligible pick targets (aircraft pick proxies). */
  pickRoot: Object3D;
  /** Called with the picked aircraft's hex, or null on empty-space click. */
  onPick: (hex: string | null) => void;
  /**
   * Optional first-pass select intercept. Called with the pressing
   * controller before the aircraft raycast; if it returns true the
   * press is considered handled and aircraft picking is skipped.
   * Phase 3's wrist menu uses this so right-hand trigger-on-menu
   * doesn't also deselect the current aircraft.
   */
  onSelectIntercept?: (controller: Group) => boolean;
  /**
   * Called when a controller's handedness is reported by the runtime.
   * Phase 3 uses it to attach the wrist menu to whichever physical
   * controller turns out to be the user's left hand. Fires once per
   * controller connect (and again if a controller reconnects with
   * different handedness).
   */
  onHandednessKnown?: (controller: Group, handedness: Handedness) => void;
}

export interface XrControllersHandle {
  /** Tear everything down (for HMR; not used in prod). */
  dispose(): void;
  /** Return the controller for a given handedness, or null if not yet connected. */
  getControllerByHandedness(handedness: Handedness): Group | null;
  /** Return all controllers (connection order, may be empty if no session). */
  getControllers(): Group[];
}

// Laser length in *world* (post-xrRoot-scale) space: the controllers
// themselves live in the scene's meter-coordinate space (outside xrRoot)
// so the ray length is in real metres. 10 m is long enough to comfortably
// reach the tabletop disc that xrRoot positions in front of the player.
const RAY_LENGTH = 10;

// Controller cone size (real metres). Small enough not to obscure the
// pointing direction, large enough to read as "you're holding something".
const CONE_HEIGHT = 0.08;
const CONE_RADIUS = 0.012;

export function setupXrControllers(opts: XrControllersOptions): XrControllersHandle {
  const { renderer, scene, pickRoot, onPick, onSelectIntercept, onHandednessKnown } = opts;
  const handedness = new Map<Group, Handedness>();

  // Shared geometry/materials across both controllers — colors track
  // the theme via the subscribe handler below so a daylight/phosphor
  // switch retints lasers and cones in place.
  const themeAccent = getTheme().tokens.three.selectionRing;
  const lineMaterial = new LineBasicMaterial({
    color: new Color(themeAccent),
    transparent: true,
    opacity: 0.7,
  });
  const coneMaterial = new MeshBasicMaterial({
    color: new Color(themeAccent),
    transparent: true,
    opacity: 0.85,
  });
  // Cone tip points along -Z (the standard XR "forward" direction).
  const coneGeometry = new ConeGeometry(CONE_RADIUS, CONE_HEIGHT, 12);
  coneGeometry.rotateX(-Math.PI / 2);
  coneGeometry.translate(0, 0, -CONE_HEIGHT / 2);

  // Laser line: origin at controller tip, end at -Z * RAY_LENGTH.
  const lineGeometry = new BufferGeometry();
  lineGeometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, -RAY_LENGTH]), 3),
  );

  const raycaster = new Raycaster();
  const tmpOrigin = new Vector3();
  const tmpDir = new Vector3();

  const groups: Group[] = [];
  const grips: Group[] = [];

  const handleSelectStart = (controller: Group): void => {
    // Give the UI layer first refusal — a press on the wrist menu must
    // not also deselect the current aircraft. The intercept is expected
    // to run its own raycast against the menu mesh.
    if (onSelectIntercept && onSelectIntercept(controller)) return;

    // Pose is up-to-date at event time; build the ray from its world matrix.
    tmpOrigin.setFromMatrixPosition(controller.matrixWorld);
    tmpDir.set(0, 0, -1).transformDirection(controller.matrixWorld);
    raycaster.set(tmpOrigin, tmpDir);
    const hits = raycaster.intersectObject(pickRoot, true);
    for (const hit of hits) {
      const ud = hit.object.userData as { kind?: string; hex?: string };
      if (ud.kind === 'aircraft-pick' && typeof ud.hex === 'string') {
        // Raycasting ignores clip planes, so aircraft the diorama walls
        // hide would still be selectable through them — reject hits whose
        // point lies outside the active box (no-op when clipping is off).
        if (!insideDiorama(hit.point)) continue;
        onPick(ud.hex);
        return;
      }
    }
    onPick(null);
  };

  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i) as Group;
    controller.name = `xr-controller-${i}`;

    // Cone, laser, and raycast ALL live on targetRaySpace so what you see
    // is exactly where you aim. The cone used to track gripSpace (the
    // physical device pose), but grip and target ray diverge by a couple
    // of degrees on Quest controllers, which read as the cone pointing
    // away from its own laser (tyzbit's issue #6 video).
    const grip = renderer.xr.getControllerGrip(i) as Group;
    grip.name = `xr-controller-grip-${i}`;
    const cone = new Mesh(coneGeometry, coneMaterial);
    cone.name = 'xr-controller-cone';
    controller.add(cone);

    const laser = new Line(lineGeometry, lineMaterial);
    laser.name = 'xr-controller-laser';
    controller.add(laser);

    controller.addEventListener('selectstart', () => handleSelectStart(controller));

    // 'connected' fires once the runtime hands us an XRInputSource. Its
    // .handedness ('left' | 'right' | 'none') is the only way to tell
    // which physical hand a controller belongs to — the index passed to
    // getController() is just the order WebXR reports them in.
    controller.addEventListener('connected', (event) => {
      const src = (event as { data?: { handedness?: Handedness } }).data;
      const h: Handedness = src?.handedness ?? 'none';
      handedness.set(controller, h);
      onHandednessKnown?.(controller, h);
    });
    controller.addEventListener('disconnected', () => {
      handedness.delete(controller);
    });

    scene.add(controller);
    scene.add(grip);
    groups.push(controller);
    grips.push(grip);
  }

  const unsubscribeTheme = subscribeTheme((tokens) => {
    const c = tokens.three.selectionRing;
    lineMaterial.color.set(c);
    coneMaterial.color.set(c);
  });

  return {
    dispose(): void {
      unsubscribeTheme();
      for (const g of [...groups, ...grips]) {
        // removeEventListener: Three.js EventDispatcher needs the same
        // function reference. We didn't keep refs, so just remove the
        // group from the scene — the GC takes care of the listeners.
        scene.remove(g);
        for (const child of g.children) {
          if (child instanceof Mesh || child instanceof Line) {
            // Materials/geometries are shared; don't dispose here.
          }
        }
      }
      coneGeometry.dispose();
      lineGeometry.dispose();
      coneMaterial.dispose();
      lineMaterial.dispose();
    },
    getControllerByHandedness(want: Handedness): Group | null {
      for (const [g, h] of handedness) {
        if (h === want) return g;
      }
      return null;
    },
    getControllers(): Group[] {
      return groups.slice();
    },
  };
}
