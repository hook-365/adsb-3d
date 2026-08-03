// Phase 4 in-VR locomotion: thumbstick + button driven world transform.
//
//   Left thumbstick Y   — scale xrRoot up/down (tabletop ↔ room scale)
//   Right thumbstick X  — snap-turn the world in 30° steps, orbiting the
//                         scope center (or the selected aircraft) like the
//                         desktop OrbitControls do
//   Right A button      — recenter the world in front of the headset
//
// All three only mutate the xrRoot transform (scale, rotation around Y,
// position). The user stays where they physically are; the world moves
// around them. This is the comfort-first locomotion model — no smooth
// motion that doesn't match the inner ear (the leading nausea trigger
// in headsets), no teleport markers (overkill for an air-traffic scope
// the user mostly observes from one spot).
//
// Input is read from XRInputSource.gamepad on the active XRSession
// directly. Three.js's WebXRManager exposes controllers as Groups but
// doesn't surface the gamepad axes/buttons, so we go to the session
// each frame. The session's inputSources list is stable across the
// session lifetime, so iteration is cheap.

import { Vector3, type Group, type PerspectiveCamera, type WebGLRenderer } from 'three';
import { getSettings, updateSettings } from '../core/settings';

// ── Tunables (real-world units / radians / seconds) ────────────────────

/** Min/max for vrScale. 0.001 fits the continental US on a desk;
 *  1.0 is "stand inside the radar volume at 1:1 metre-to-NM". */
const SCALE_MIN = 0.001;
const SCALE_MAX = 1.0;

/** Thumbstick deadzone: ignore noise inside this radius. */
const DEADZONE = 0.2;

/** Per-second rate at which the left thumbstick changes scale. Acts
 *  as a multiplier exponent so the rate feels symmetric — pushing all
 *  the way up doubles scale every ~1 / RATE seconds. */
const SCALE_RATE_PER_S = 1.0;

/** Snap-turn step in radians (30°). The standard comfort value in most
 *  consumer VR apps; small enough to track, large enough to never feel
 *  like smooth motion. */
const SNAP_TURN_STEP = (Math.PI * 30) / 180;

/** Threshold the right thumbstick X axis must cross before a snap fires.
 *  Higher than DEADZONE to prevent accidental triggers; the user has to
 *  actually push, not just tilt. */
const SNAP_TURN_TRIGGER = 0.7;

/** Where the world recenters to, relative to the headset, when the
 *  user hits the A button. Matches the Phase 2 defaults — chest height,
 *  1.5 m in front. */
const RECENTER_FORWARD_M = 1.5;
const RECENTER_DOWN_M = 0.5; // 50 cm below the camera (≈ chest)

// Oculus Touch / WebXR standard gamepad layout button indices.
const BUTTON_A_OR_X = 4;

export interface XrLocomotion {
  /** Per-frame tick. dtMs is the frame delta from main.ts's render loop. */
  tick(dtMs: number): void;
}

export function setupXrLocomotion(opts: {
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  xrRoot: Group;
  /**
   * World-space point the snap-turn should orbit around. Return the
   * selected aircraft's world position when one is selected (so turning
   * orbits it, matching the desktop follow-cam), or null to orbit the
   * scope center. Called once per snap, never per-frame.
   */
  getOrbitPivot?: () => Vector3 | null;
}): XrLocomotion {
  const { renderer, xrRoot, getOrbitPivot } = opts;

  // Edge-trigger state. Snap-turn and A-button fire once per press, not
  // continuously while held. We remember whether the relevant input was
  // already over the threshold last frame so we only react on the
  // rising edge (in → out for thumbstick, false → true for buttons).
  let snapTurnArmed = true; // whether the next strong push will fire a snap
  let aButtonWasPressed = false;

  function tick(_dtMs: number): void {
    const session = renderer.xr.getSession();
    if (!session) return;
    const dtS = Math.min(_dtMs, 100) / 1000; // clamp huge frame stalls

    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;

      // ── Left controller: continuous scale via Y axis ─────────────────
      if (src.handedness === 'left') {
        const y = gp.axes[3] ?? 0; // standard XR mapping: thumbstick = axes[2,3]
        if (Math.abs(y) > DEADZONE) {
          // Push UP (negative axis on XR convention) → grow scale.
          // Exponential rate keeps the feel symmetric: pushing all the
          // way doubles per (1 / SCALE_RATE_PER_S) seconds either way.
          const cur = getSettings().vrScale;
          const factor = Math.exp(-y * SCALE_RATE_PER_S * dtS);
          const next = clamp(cur * factor, SCALE_MIN, SCALE_MAX);
          if (next !== cur) {
            updateSettings({ vrScale: next });
            // The Settings subscriber in main.ts applies xrRoot.scale.
            // We could mutate it here directly for one less frame of
            // lag, but going through Settings keeps the wrist-menu
            // display and persistence honest.
          }
        }
      }

      // ── Right controller: snap-turn (axes[2]) + recenter (A button) ──
      if (src.handedness === 'right') {
        const x = gp.axes[2] ?? 0;
        if (Math.abs(x) < DEADZONE) {
          // Stick recentred → arm the next snap.
          snapTurnArmed = true;
        } else if (snapTurnArmed && Math.abs(x) > SNAP_TURN_TRIGGER) {
          const dir = x > 0 ? -1 : 1; // push right → scene orbits left
          // Orbit the selected aircraft when one is selected, else the
          // scope center. The center pivot is xrRoot's own world-space
          // origin, so passing it leaves position untouched and only
          // spins the airspace in place.
          const pivot = getOrbitPivot?.() ?? tmpPivot.setFromMatrixPosition(xrRoot.matrixWorld);
          snapTurnWorld(xrRoot, pivot, SNAP_TURN_STEP * dir);
          snapTurnArmed = false;
        }

        const aPressed = gp.buttons[BUTTON_A_OR_X]?.pressed ?? false;
        if (aPressed && !aButtonWasPressed) {
          // Use the XR camera, not the desktop reference camera:
          // OrbitControls resets the reference camera's position every
          // tick, so reading it here teleported the world hundreds of
          // scene units away (issue #6 — "pressing A makes the screen
          // go all black").
          recenterWorld(xrRoot, renderer.xr.getCamera());
        }
        aButtonWasPressed = aPressed;
      }
    }
  }

  return { tick };
}

// ── World-mutation helpers ───────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Rotate xrRoot around a vertical axis through a world-space pivot.
 *  This matches the desktop OrbitControls feel: the pivot (scope center,
 *  or the selected aircraft) stays put while the rest of the airspace
 *  swings around it. When the pivot is xrRoot's own origin, px/pz are
 *  zero so position is untouched and only rotation.y changes — the
 *  scene spins in place. */
function snapTurnWorld(xrRoot: Group, pivot: Vector3, angle: number): void {
  // Translate so the pivot XZ becomes the rotation center, rotate, then
  // translate back. xrRoot's position is in world space, so this maths
  // works regardless of the current scale.
  const px = xrRoot.position.x - pivot.x;
  const pz = xrRoot.position.z - pivot.z;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  xrRoot.position.x = pivot.x + px * cos - pz * sin;
  xrRoot.position.z = pivot.z + px * sin + pz * cos;
  xrRoot.rotation.y += angle;
}

const tmpPivot = new Vector3();
const tmpFwd = new Vector3();
const tmpEye = new Vector3();

/** Place xrRoot's local origin RECENTER_FORWARD_M in front of the
 *  headset at RECENTER_DOWN_M below eye height, on the horizontal plane
 *  the headset is looking along. Preserves the current vrScale. The
 *  rotation is reset so the basemap N axis points away from the user.
 *  Pose is read from matrixWorld — the XR array camera's position/
 *  quaternion properties aren't reliably synced. */
function recenterWorld(xrRoot: Group, camera: PerspectiveCamera): void {
  const e = camera.matrixWorld.elements;
  tmpEye.setFromMatrixPosition(camera.matrixWorld);
  // Forward = -Z basis column, projected onto the horizontal plane. If
  // the user is looking straight up or down (rare during normal use)
  // fall back to scene -Z so the recentre is at least deterministic.
  tmpFwd.set(-(e[8] ?? 0), 0, -(e[10] ?? 0));
  if (tmpFwd.lengthSq() < 1e-6) {
    tmpFwd.set(0, 0, -1);
  } else {
    tmpFwd.normalize();
  }
  xrRoot.position.set(
    tmpEye.x + tmpFwd.x * RECENTER_FORWARD_M,
    tmpEye.y - RECENTER_DOWN_M,
    tmpEye.z + tmpFwd.z * RECENTER_FORWARD_M,
  );
  xrRoot.rotation.set(0, 0, 0);
}
