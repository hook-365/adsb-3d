// Immersive-session interaction runtime: controllers, wrist menu,
// thumbstick locomotion, and AR place mode. Lazy-loaded by main.ts as
// soon as core/xr reports VR or AR support, so desktop browsers never
// download it; on headsets the probe resolves long before the user can
// press Enter VR, so controller 'connected' events are never missed.
//
// What stays in main.ts: session-edge scene setup (scale, near plane,
// passthrough), diorama state, follow-anchor state, and the billboard /
// stereo panel (desktop stereo uses those too). This module reaches
// back into that state only through the callbacks in XrRuntimeDeps.

import type { Vector3 } from 'three';
import type { AircraftReconciler } from '../aircraft/reconciler';
import type { AircraftStore } from '../aircraft/store';
import { distanceFromHomeNm } from '../core/coords';
import { getSettings, updateSettings } from '../core/settings';
import { getXrState } from '../core/xr';
import type { World } from '../world/scene';
import { XrArPlace } from '../world/xr-ar-place';
import { setupXrControllers } from '../world/xr-controllers';
import { faceWorldPoint, setupXrLocomotion } from '../world/xr-locomotion';
import { setWristMenuActions, XrWristMenu } from '../world/xr-wrist-menu';

export interface XrRuntimeDeps {
  world: World;
  store: AircraftStore;
  reconciler: AircraftReconciler;
  applySelection: (hex: string | null) => void;
  getSelectedHex: () => string | null;
  /** AR placement dropped the scope at `origin` (metre space). */
  onArPlaced: (origin: Vector3) => void;
  /** Scale tick while following; see the comment at the call site in main.ts. */
  onFollowScale: (rootOrigin: Vector3, r: number) => void;
}

export interface XrRuntime {
  /** Per-frame work while presenting. */
  tick(dt: number, xrFrame?: XRFrame): void;
  /** Session-end cleanup. */
  onSessionEnd(): void;
}

export function mountXrRuntime(deps: XrRuntimeDeps): XrRuntime {
  const { world, store, reconciler, applySelection, getSelectedHex } = deps;

  const xrWristMenu = new XrWristMenu();
  // AR place mode (issue #6): armed from the wrist menu, a gaze reticle
  // tracks real surfaces via hit-test and the next trigger drops the
  // scope there. The menu row displays state it can't observe through
  // settings, hence the explicit refresh after toggling.
  const xrArPlace = new XrArPlace({
    renderer: world.renderer,
    scene: world.scene,
    xrRoot: world.xrRoot,
  });
  xrArPlace.onPlaced(deps.onArPlaced);

  setWristMenuActions({
    toggleArPlace: () => {
      xrArPlace.toggle();
      // Arming placement force-disables follow (issue #6 round 4 — tyzbit:
      // "Follow mode should be force disabled before activating the scope
      // placement ... because after being placed, the map immediately moves
      // away as it re-centers the aircraft"). Left off after placing — the
      // follow row is on the same wrist page when the user wants it back.
      if (xrArPlace.isActive() && getSettings().xrFollow) {
        updateSettings({ xrFollow: false });
      }
      xrWristMenu.refresh();
    },
    arPlaceActive: () => xrArPlace.isActive(),
  });

  // Controllers attach to the scene (meter-space, outside xrRoot — they
  // track the user's hands at real-world scale).
  const xrControllers = setupXrControllers({
    renderer: world.renderer,
    scene: world.scene,
    // Pick proxies are attached under aircraftRoot by reconciler.ts; the
    // raycast walks descendants so historical entries are pickable too.
    pickRoot: world.aircraftRoot,
    onPick: applySelection,
    // Right-hand trigger on the wrist menu must NOT also deselect — let
    // the menu absorb the press before aircraft picking runs. We only
    // arm the intercept for the non-left controller so the user can't
    // accidentally activate menu rows with the hand the menu is on.
    // (Handedness is unknown until 'connected' fires; before that we
    // let both controllers try — better to risk a stray menu hit than
    // to drop the very first press on a slow-reporting runtime.)
    onSelectIntercept: (controller) => {
      // Menu first — while place mode is armed, its own wrist-menu row must
      // stay reachable so the user can disarm without placing.
      if (xrControllers.getControllerByHandedness('left') !== controller) {
        if (xrWristMenu.trySelect(controller)) return true;
      }
      // Place mode swallows every other trigger: places when the reticle
      // has a surface, otherwise just guards against a stray deselect.
      if (xrArPlace.handleSelect()) {
        xrWristMenu.refresh();
        return true;
      }
      return false;
    },
    // Attach the menu to whichever physical controller turns out to be
    // the left hand. If handedness is 'none' (some 3DOF controllers
    // never report) the menu just won't attach — acceptable for v1.
    onHandednessKnown: (controller, h) => {
      if (h === 'left') xrWristMenu.attachTo(controller);
    },
  });

  const xrLocomotion = setupXrLocomotion({
    renderer: world.renderer,
    camera: world.camera,
    xrRoot: world.xrRoot,
    // In AR with hit-test, free-fly translation would slide a placed
    // scope off its real surface (issue #6) — force scope-style movement
    // there. AR devices without hit-test keep free-fly (their only way
    // to position the map manually). VR is unaffected. With the diorama
    // box active the world slides UNDER a fixed frame, so free-fly is the
    // whole point — the placed illusion survives it (tyzbit's issue #6
    // note that free-fly seemed intended to work).
    freeflyAllowed: () =>
      getXrState().presentingMode !== 'ar' ||
      !xrArPlace.isSupported() ||
      getSettings().dioramaClip,
    // Orbit the selected aircraft when one is picked (matches the desktop
    // follow-cam), else fall back to the scope center. positionOf returns a
    // fresh Vector3 in xrRoot-local space; localToWorld maps it into the
    // world space the snap-turn maths runs in.
    // B/Y: advance the selection through aircraft ordered by distance from
    // home, wrapping, then swing the world so the new target sits in front
    // of the headset (issue #6 control-scheme feedback).
    onCycleAircraft: () => {
      const ordered = [...store.snapshot.values()]
        .map((a) => ({ hex: a.hex, d: distanceFromHomeNm(a.lat, a.lon) }))
        .sort((p, q) => p.d - q.d)
        .map((p) => p.hex);
      if (ordered.length === 0) return;
      const selected = getSelectedHex();
      const idx = selected ? ordered.indexOf(selected) : -1;
      const nextHex = ordered[(idx + 1) % ordered.length]!;
      applySelection(nextHex);
      const local = reconciler.positionOf(nextHex);
      if (local) {
        faceWorldPoint(world.xrRoot, world.renderer.xr.getCamera(), world.xrRoot.localToWorld(local));
      }
    },
    getOrbitPivot: () => {
      const selected = getSelectedHex();
      if (!selected) return null;
      const local = reconciler.positionOf(selected);
      return local ? world.xrRoot.localToWorld(local) : null;
    },
    onFollowScale: deps.onFollowScale,
  });

  return {
    tick(dt, xrFrame) {
      // Wrist-menu hover: raycast the right controller's forward axis
      // against the menu and update its highlighted row. Cheap (one
      // intersectObject call against a single Plane).
      xrWristMenu.updateHover(xrControllers.getControllerByHandedness('right'));
      // Thumbstick + button input (scale / snap-turn / recenter).
      xrLocomotion.tick(dt);
      // AR place-mode reticle follows the gaze hit point.
      if (xrFrame) xrArPlace.tick(xrFrame);
    },
    onSessionEnd() {
      // The wrist menu lives under the left controller; the controller
      // Group itself is recycled when the next session starts, but the
      // menu Mesh holds a stale parent ref. Detach explicitly so the
      // next 'connected' / onHandednessKnown re-attaches cleanly.
      xrWristMenu.detach();
      // A hit-test source doesn't survive its session; disarm place mode.
      xrArPlace.stop();
    },
  };
}
