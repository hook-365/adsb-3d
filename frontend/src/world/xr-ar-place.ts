// AR "place the scope" mode (issue #6 wishlist: put the airspace on a
// real table). Uses WebXR hit-test: while armed, a reticle tracks the
// real-world surface at the center of the user's gaze; a trigger pull
// drops the scope origin there. Gaze-driven (viewer space) rather than
// controller-driven so it works one-handed and the reticle doesn't
// jitter with hand tremor.
//
// The hit-test feature is requested as optional at AR session start
// (core/xr.ts); on runtimes that don't grant it, arming the mode logs
// under [xr] and the reticle simply never appears — no hard failure.
//
// The reticle lives in the scene's meter space (outside xrRoot): hit
// poses come back in the renderer's reference space, which is metres.

import {
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  type Group,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import { getTheme, subscribeTheme } from '../core/theme';

// Reticle: a flat ring lying on the detected surface, ~16 cm across —
// reads as "the scope lands here" without hiding the surface itself.
const RETICLE_INNER_M = 0.06;
const RETICLE_OUTER_M = 0.08;

const TAG = '[xr]';

export class XrArPlace {
  private readonly renderer: WebGLRenderer;
  private readonly xrRoot: Group;
  private readonly reticle: Mesh;
  private readonly material: MeshBasicMaterial;
  private readonly unsubscribeTheme: () => void;
  private active = false;
  private hitSource: XRHitTestSource | null = null;

  constructor(opts: { renderer: WebGLRenderer; scene: Object3D; xrRoot: Group }) {
    this.renderer = opts.renderer;
    this.xrRoot = opts.xrRoot;

    this.material = new MeshBasicMaterial({
      color: getTheme().tokens.three.selectionRing,
      transparent: true,
      opacity: 0.9,
      // Always visible: in passthrough there's no real-world depth buffer,
      // and the reticle must not vanish behind the scope's own geometry.
      depthTest: false,
    });
    const geometry = new RingGeometry(RETICLE_INNER_M, RETICLE_OUTER_M, 32);
    geometry.rotateX(-Math.PI / 2); // lie flat on the surface
    this.reticle = new Mesh(geometry, this.material);
    this.reticle.name = 'xr-ar-place-reticle';
    this.reticle.renderOrder = 11;
    this.reticle.visible = false;
    opts.scene.add(this.reticle);

    this.unsubscribeTheme = subscribeTheme((tokens) => {
      this.material.color.set(tokens.three.selectionRing);
    });
  }

  isActive(): boolean {
    return this.active;
  }

  /**
   * True when the current session granted hit-test, i.e. place mode can
   * actually work. Used to decide whether AR may disable free-fly
   * translation (placement exists) or must keep it (manual positioning
   * is the only option).
   */
  isSupported(): boolean {
    const session = this.renderer.xr.getSession() as
      | (XRSession & { enabledFeatures?: readonly string[] })
      | null;
    if (!session) return false;
    if (session.enabledFeatures) return session.enabledFeatures.includes('hit-test');
    return typeof session.requestHitTestSource === 'function';
  }

  /** Arm or disarm place mode (wrist-menu row). */
  toggle(): void {
    if (this.active) this.stop();
    else this.start();
  }

  private start(): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;
    // requestHitTestSource is absent when the runtime didn't grant the
    // hit-test feature (or predates the module) — degrade to a no-op.
    const request = session.requestHitTestSource?.bind(session);
    if (!request) {
      console.warn(TAG, 'place mode unavailable — hit-test not granted by the runtime');
      return;
    }
    this.active = true;
    console.info(TAG, 'place mode armed — requesting viewer-space hit-test source');
    session
      .requestReferenceSpace('viewer')
      .then((viewerSpace) => request({ space: viewerSpace }))
      .then((source) => {
        // The user may have disarmed (or the session ended) mid-request.
        if (!this.active || !source) {
          source?.cancel();
          return;
        }
        this.hitSource = source;
        console.info(TAG, 'hit-test source ready');
      })
      .catch((err) => {
        console.warn(TAG, 'hit-test source request failed', err);
        this.active = false;
      });
  }

  /** Disarm and hide the reticle. Safe to call repeatedly / on session end. */
  stop(): void {
    this.active = false;
    this.reticle.visible = false;
    try {
      this.hitSource?.cancel();
    } catch {
      // Source may already be invalid after session end — cancel is best-effort.
    }
    this.hitSource = null;
  }

  /** Per-XR-frame: track the gaze hit point with the reticle. */
  tick(frame: XRFrame): void {
    if (!this.active || !this.hitSource) return;
    const refSpace = this.renderer.xr.getReferenceSpace();
    if (!refSpace) return;
    const hit = frame.getHitTestResults(this.hitSource)[0];
    const pose = hit?.getPose(refSpace);
    if (!pose) {
      this.reticle.visible = false;
      return;
    }
    const p = pose.transform.position;
    this.reticle.position.set(p.x, p.y, p.z);
    this.reticle.visible = true;
  }

  /**
   * Trigger-press hook (wired into the controllers' select intercept).
   * Returns true when the press belongs to place mode: either the scope
   * was just placed on the reticle, or the mode is armed with no surface
   * under the gaze yet (swallow the press rather than deselecting an
   * aircraft mid-placement).
   */
  handleSelect(): boolean {
    if (!this.active) return false;
    if (this.reticle.visible) {
      // Scope origin lands on the surface; scale and rotation persist.
      this.xrRoot.position.copy(this.reticle.position);
      console.info(TAG, 'scope placed', this.reticle.position);
      this.stop();
      // Notify after stop() so listeners see the disarmed state. The
      // diorama clip box re-centers on the placed origin from this.
      for (const cb of this.placedListeners) cb(this.xrRoot.position);
    }
    return true;
  }

  /** Subscribe to successful placements (metre-space scope origin). */
  onPlaced(cb: (origin: Vector3) => void): void {
    this.placedListeners.add(cb);
  }

  private readonly placedListeners = new Set<(origin: Vector3) => void>();

  dispose(): void {
    this.stop();
    this.unsubscribeTheme();
    this.reticle.parent?.remove(this.reticle);
    this.reticle.geometry.dispose();
    this.material.dispose();
  }
}
