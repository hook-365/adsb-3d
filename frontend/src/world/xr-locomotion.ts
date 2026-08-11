// In-VR locomotion: thumbstick + button driven world transform, shaped by
// two orthogonal comfort settings (issue #6):
//
//   xrMoveMode 'scope' (default) — the world moves around a stationary
//     observer. Left stick Y scales the airspace (tabletop ↔ room);
//     that's the whole left hand.
//   xrMoveMode 'freefly' — the user moves through the airspace. Left
//     stick strafes (X) and flies along gaze (Y); right stick Y changes
//     the user's height; grip + left Y takes over scaling (the held-
//     modifier pattern common on Quest).
//
//   xrTurnStyle 'snap' (default) — right stick X turns in 30° steps.
//   xrTurnStyle 'smooth' — right stick X rotates continuously. The
//     single biggest motion-comfort lever, so it's its own setting
//     rather than being bundled into the movement model.
//
//   Right A/X recenters the world in front of the headset. B/Y cycles
//   the selection through nearby aircraft (wired via onCycleAircraft).
//
// Turning pivots: scope orbits the selected aircraft (or scope center),
// matching the desktop OrbitControls; free-fly turns about the user,
// like every first-person VR app.
//
// Input is read from XRInputSource.gamepad on the active XRSession
// directly; three.js doesn't surface gamepad axes/buttons.

import { Vector3, type Group, type PerspectiveCamera, type WebGLRenderer } from 'three';
import { getSettings, updateSettings } from '../core/settings';
import { getXrState } from '../core/xr';
import { dioramaActive } from './diorama-clip';

// ── Tunables (real-world units / radians / seconds) ────────────────────

/** Min/max for vrScale/arScale. 0.0002 shrinks the scope to roughly a
 *  foot across — hardware feedback (issue #6) asked for room below the
 *  AR default (0.001, which was also the old floor and therefore
 *  unshrinkable). 1.0 is "stand inside the radar volume at 1:1
 *  metre-to-NM". */
const SCALE_MIN = 0.0002;
const SCALE_MAX = 1.0;

/** Thumbstick deadzone: ignore noise inside this radius. */
const DEADZONE = 0.2;

/** Per-second rate at which the thumbstick changes scale (exponent). */
const SCALE_RATE_PER_S = 1.0;

/** Free-fly translation speed at full stick, in real metres/second.
 *  Real-space speed reads the same at any world scale. Deliberately
 *  modest for the first hardware round. */
const MOVE_SPEED_M_PER_S = 2.0;
/** Vertical (right stick Y) speed in free-fly. Slower than horizontal —
 *  hardware feedback (issue #6): fast height changes read as accidents. */
const VERT_SPEED_M_PER_S = 1.0;
/** Free-fly right stick Y needs a much deeper deadzone than X: turning
 *  sweeps the stick through diagonals, and any vertical response there
 *  reads as unintended height drift (issue #6). Combined with the
 *  dominant-axis check below, height only engages on a deliberate
 *  mostly-vertical push. */
const VERT_DEADZONE = 0.5;

/** Snap-turn step (30°) — the standard comfort value. */
const SNAP_TURN_STEP = (Math.PI * 30) / 180;
/** Threshold the stick must cross before a snap fires. */
const SNAP_TURN_TRIGGER = 0.7;
/** Smooth-turn rate at full deflection. 90°/s is the common default. */
const SMOOTH_TURN_RAD_PER_S = Math.PI / 2;

/** Recenter placement relative to the headset (A/X button). */
const RECENTER_FORWARD_M = 1.5;
const RECENTER_DOWN_M = 0.5;

// WebXR standard gamepad layout.
const BUTTON_SQUEEZE = 1;
const BUTTON_A_OR_X = 4;
const BUTTON_B_OR_Y = 5;

export interface XrLocomotion {
  /** Per-frame tick. dtMs is the frame delta from main.ts's render loop. */
  tick(dtMs: number): void;
}

export function setupXrLocomotion(opts: {
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  xrRoot: Group;
  /**
   * World-space point scope-mode turning should orbit. Return the
   * selected aircraft's world position when one is selected, or null to
   * orbit the scope center.
   */
  getOrbitPivot?: () => Vector3 | null;
  /** B/Y rising edge — main.ts advances the selection to the next aircraft. */
  onCycleAircraft?: () => void;
  /**
   * Gate for free-fly. Hardware feedback (issue #6): free-fly
   * translation moves xrRoot, which slides an AR-placed scope off its
   * real-world surface. main.ts returns false in AR sessions where
   * hit-test placement exists; AR devices without hit-test keep
   * free-fly as their only way to position the map manually.
   */
  freeflyAllowed?: () => boolean;
}): XrLocomotion {
  const { renderer, xrRoot, getOrbitPivot, onCycleAircraft, freeflyAllowed } = opts;

  // Edge-trigger state: snap-turn, A and B fire once per press.
  let snapTurnArmed = true;
  let aButtonWasPressed = false;
  let bButtonWasPressed = false;

  function applyScale(stickY: number, dtS: number, fixedPoint: Vector3 | null): void {
    // VR and AR keep independent scales (an AR diorama shares the room
    // with real furniture); the gesture writes whichever is active.
    const key = getXrState().presentingMode === 'ar' ? 'arScale' : 'vrScale';
    const cur = getSettings()[key];
    // Push UP (negative axis) → grow scale; exponential keeps it symmetric.
    const next = clamp(cur * Math.exp(-stickY * SCALE_RATE_PER_S * dtS), SCALE_MIN, SCALE_MAX);
    if (next === cur) return;
    // main.ts applies the new xrRoot.scale synchronously inside this call.
    updateSettings({ [key]: next });
    // Scaling xrRoot alone expands about the ROOT origin, which drags
    // everything else across the room — "zoom while orbiting translates
    // you and you lose your place" (issue #6). Compensate position so
    // `fixedPoint` (selected aircraft, or the headset in free-fly) keeps
    // its world position: w' = k·q + pos', want w' = w ⇒
    // pos' = w − r·(w − pos), r = next/cur. Null = scope center (the
    // root origin), where the correction is a no-op by construction.
    if (fixedPoint) {
      const r = next / cur;
      xrRoot.position.x = fixedPoint.x - r * (fixedPoint.x - xrRoot.position.x);
      // With the diorama box active, never move the world vertically:
      // scaling about an elevated aircraft would sink the ground through
      // the box floor (tyzbit's issue #6 video — "zooming clips the map
      // out"). The desk height is part of the diorama illusion.
      if (!dioramaActive()) {
        xrRoot.position.y = fixedPoint.y - r * (fixedPoint.y - xrRoot.position.y);
      }
      xrRoot.position.z = fixedPoint.z - r * (fixedPoint.z - xrRoot.position.z);
    }
  }

  function tick(_dtMs: number): void {
    const session = renderer.xr.getSession();
    if (!session) return;
    const dtS = Math.min(_dtMs, 100) / 1000; // clamp huge frame stalls
    const s = getSettings();
    const freefly = s.xrMoveMode === 'freefly' && (freeflyAllowed?.() ?? true);
    const xrCam = renderer.xr.getCamera();

    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;

      // ── Left controller ──────────────────────────────────────────────
      if (src.handedness === 'left') {
        const x = gp.axes[2] ?? 0;
        const y = gp.axes[3] ?? 0;
        const gripHeld = gp.buttons[BUTTON_SQUEEZE]?.pressed ?? false;

        if (!freefly || gripHeld) {
          // Scope: stick Y is scale. Free-fly: grip is the scale modifier.
          // Anchored on the selection (else the scope center) in BOTH
          // modes — a headset anchor scales the world around your eyes,
          // which reads as "changing 3D strength" instead of resizing
          // the map (issue #6: scaling should apply to the rendered
          // area, not the view).
          if (Math.abs(y) > DEADZONE) applyScale(y, dtS, getOrbitPivot?.() ?? null);
        } else {
          // Free-fly translation. Forward follows the full gaze (fly
          // where you look); strafe is the horizontal right vector.
          headsetBasis(xrCam);
          if (Math.abs(y) > DEADZONE) {
            moveUser(xrRoot, tmpFwd, -y * MOVE_SPEED_M_PER_S * dtS);
          }
          if (Math.abs(x) > DEADZONE) {
            moveUser(xrRoot, tmpRight, x * MOVE_SPEED_M_PER_S * dtS);
          }
        }
      }

      // ── Right controller ─────────────────────────────────────────────
      if (src.handedness === 'right') {
        const x = gp.axes[2] ?? 0;
        const y = gp.axes[3] ?? 0;

        // Turn pivot: scope orbits the selection/center; free-fly turns
        // about the user like a first-person app.
        const pivot = freefly
          ? tmpPivot.setFromMatrixPosition(xrCam.matrixWorld)
          : (getOrbitPivot?.() ?? tmpPivot.setFromMatrixPosition(xrRoot.matrixWorld));

        // Turn sense differs by model (issue #6 hardware feedback):
        // scope is an orbit, push right → scene orbits left past you;
        // free-fly is first-person, push right → YOU yaw right, which
        // is the world rotating the other way.
        const turnSign = (x > 0 ? -1 : 1) * (freefly ? -1 : 1);
        if (s.xrTurnStyle === 'smooth') {
          if (Math.abs(x) > DEADZONE) {
            snapTurnWorld(xrRoot, pivot, SMOOTH_TURN_RAD_PER_S * Math.abs(x) * dtS * turnSign);
          }
        } else {
          if (Math.abs(x) < DEADZONE) {
            snapTurnArmed = true;
          } else if (snapTurnArmed && Math.abs(x) > SNAP_TURN_TRIGGER) {
            snapTurnWorld(xrRoot, pivot, SNAP_TURN_STEP * turnSign);
            snapTurnArmed = false;
          }
        }

        // Free-fly vertical: push up (negative axis) → user rises →
        // world sinks. Deep deadzone + dominant-axis gate so sweeping
        // through a diagonal mid-turn doesn't drift height (issue #6).
        if (freefly && Math.abs(y) > VERT_DEADZONE && Math.abs(y) > Math.abs(x)) {
          xrRoot.position.y += y * VERT_SPEED_M_PER_S * dtS;
        }

        const aPressed = gp.buttons[BUTTON_A_OR_X]?.pressed ?? false;
        if (aPressed && !aButtonWasPressed) {
          // XR camera, not the desktop reference camera — OrbitControls
          // rewrites the latter every tick (the A-button blackout bug).
          recenterWorld(xrRoot, xrCam);
        }
        aButtonWasPressed = aPressed;

        const bPressed = gp.buttons[BUTTON_B_OR_Y]?.pressed ?? false;
        if (bPressed && !bButtonWasPressed) onCycleAircraft?.();
        bButtonWasPressed = bPressed;
      }
    }
  }

  return { tick };
}

// ── World-mutation helpers ───────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const tmpPivot = new Vector3();
const tmpFwd = new Vector3();
const tmpRight = new Vector3();
const tmpEye = new Vector3();
const tmpToPoint = new Vector3();

/** Fill tmpFwd (full gaze, normalized) and tmpRight (horizontal right)
 *  from the headset's matrixWorld. */
function headsetBasis(camera: PerspectiveCamera): void {
  const e = camera.matrixWorld.elements;
  tmpFwd.set(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 0)).normalize();
  tmpRight.set(e[0] ?? 1, 0, e[2] ?? 0).normalize();
}

/** Move the user by `meters` along `dir` — i.e. move the world the
 *  opposite way. */
function moveUser(xrRoot: Group, dir: Vector3, meters: number): void {
  xrRoot.position.addScaledVector(dir, -meters);
}

/** Rigidly rotate the world (xrRoot) by +angle about the vertical axis
 *  through a world-space pivot; the pivot's world position stays fixed. */
function snapTurnWorld(xrRoot: Group, pivot: Vector3, angle: number): void {
  const px = xrRoot.position.x - pivot.x;
  const pz = xrRoot.position.z - pivot.z;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  xrRoot.position.x = pivot.x + px * cos + pz * sin;
  xrRoot.position.z = pivot.z - px * sin + pz * cos;
  xrRoot.rotation.y += angle;
}

/**
 * Rotate the world about the user so `worldPoint` lands in front of the
 * headset (B-button aircraft cycling). Horizontal bearing only — height
 * is left alone.
 */
export function faceWorldPoint(
  xrRoot: Group,
  xrCamera: PerspectiveCamera,
  worldPoint: Vector3,
): void {
  const e = xrCamera.matrixWorld.elements;
  tmpEye.setFromMatrixPosition(xrCamera.matrixWorld);
  tmpToPoint.copy(worldPoint).sub(tmpEye);
  const gazeBearing = Math.atan2(-(e[10] ?? 0), -(e[8] ?? 0));
  const pointBearing = Math.atan2(tmpToPoint.z, tmpToPoint.x);
  let angle = pointBearing - gazeBearing;
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  snapTurnWorld(xrRoot, tmpEye, angle);
}

/** Place xrRoot's origin in front of the headset at chest height,
 *  preserving scale, resetting rotation. Pose from matrixWorld — the XR
 *  array camera's position property isn't reliably synced. */
function recenterWorld(xrRoot: Group, camera: PerspectiveCamera): void {
  const e = camera.matrixWorld.elements;
  tmpEye.setFromMatrixPosition(camera.matrixWorld);
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
