// Phase 4 in-VR locomotion: thumbstick + button driven world transform.
//
//   Left thumbstick Y   — scale xrRoot up/down (tabletop ↔ room scale)
//   Right thumbstick X  — snap-turn the world around the user in 30° steps
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
}): XrLocomotion {
  const { renderer, camera, xrRoot } = opts;

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
          const dir = x > 0 ? -1 : 1; // push right → world rotates left around user
          snapTurnWorld(xrRoot, camera, SNAP_TURN_STEP * dir);
          snapTurnArmed = false;
        }

        const aPressed = gp.buttons[BUTTON_A_OR_X]?.pressed ?? false;
        if (aPressed && !aButtonWasPressed) {
          recenterWorld(xrRoot, camera);
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

/** Rotate xrRoot around a vertical axis through the camera's XZ
 *  position. Rotating about the user's head (rather than the scene
 *  origin) makes the snap feel like *you* turned, not like the world
 *  drifted sideways — the same image stays roughly in front of you. */
function snapTurnWorld(xrRoot: Group, camera: PerspectiveCamera, angle: number): void {
  const cx = camera.position.x;
  const cz = camera.position.z;
  // Translate so the camera XZ becomes the pivot, rotate, translate back.
  // xrRoot's position is in world space, so this maths works regardless
  // of the current scale.
  const px = xrRoot.position.x - cx;
  const pz = xrRoot.position.z - cz;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  xrRoot.position.x = cx + px * cos - pz * sin;
  xrRoot.position.z = cz + px * sin + pz * cos;
  xrRoot.rotation.y += angle;
}

const tmpFwd = new Vector3();

/** Place xrRoot's local origin RECENTER_FORWARD_M in front of the
 *  camera at RECENTER_DOWN_M below eye height, on the horizontal plane
 *  the camera is looking along. Preserves the current vrScale. The
 *  rotation is reset so the basemap N axis points away from the user. */
function recenterWorld(xrRoot: Group, camera: PerspectiveCamera): void {
  // Forward direction projected onto the horizontal plane. If the user
  // is looking straight up or down (rare during normal use) fall back
  // to scene -Z so the recentre is at least deterministic.
  camera.getWorldDirection(tmpFwd);
  tmpFwd.y = 0;
  if (tmpFwd.lengthSq() < 1e-6) {
    tmpFwd.set(0, 0, -1);
  } else {
    tmpFwd.normalize();
  }
  xrRoot.position.set(
    camera.position.x + tmpFwd.x * RECENTER_FORWARD_M,
    camera.position.y - RECENTER_DOWN_M,
    camera.position.z + tmpFwd.z * RECENTER_FORWARD_M,
  );
  xrRoot.rotation.set(0, 0, 0);
}
