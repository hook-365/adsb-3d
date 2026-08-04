import { describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { faceWorldPoint } from '../src/world/xr-locomotion';

// Regression coverage for issue #6 VR#8: turning about a pivot must be a
// rigid rotation of the world around that pivot. The original code rotated
// xrRoot's position by -angle while yawing it by +angle, which composes
// into a rotation about the pivot's mirror image through the root origin —
// exactly the "orbits the opposite side of the scope" report from hardware
// testing. faceWorldPoint exercises the same helper with the pivot at the
// eye, so these invariants fail against the mirrored math.

/** World position of an xrRoot-attached child after the root transform. */
function worldPos(root: Group, local: Vector3): Vector3 {
  root.updateMatrixWorld(true);
  return local.clone().applyMatrix4(root.matrixWorld);
}

function makeCamera(eye: Vector3, yaw: number): PerspectiveCamera {
  const cam = new PerspectiveCamera();
  cam.position.copy(eye);
  cam.rotation.set(0, yaw, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

describe('faceWorldPoint', () => {
  it('turns the world so the target lands on the gaze bearing', () => {
    const eye = new Vector3(0, 1.6, 0);
    const cam = makeCamera(eye, 0); // gaze along -Z
    const root = new Group();
    root.position.set(3, 0, 2); // deliberately away from the eye
    const local = new Vector3(4, 5, -1);
    const before = worldPos(root, local);

    faceWorldPoint(root, cam, before.clone());

    const after = worldPos(root, local);
    // Same horizontal distance from the eye (rigid rotation about it)…
    const dBefore = Math.hypot(before.x - eye.x, before.z - eye.z);
    const dAfter = Math.hypot(after.x - eye.x, after.z - eye.z);
    expect(dAfter).toBeCloseTo(dBefore, 10);
    // …height untouched…
    expect(after.y).toBeCloseTo(before.y, 10);
    // …and now dead ahead: on the -Z gaze ray, centered in X.
    expect(after.x - eye.x).toBeCloseTo(0, 10);
    expect(after.z - eye.z).toBeCloseTo(-dBefore, 10);
  });

  it('is exact for an arbitrary gaze yaw', () => {
    const eye = new Vector3(-2, 1.2, 5);
    const yaw = Math.PI / 3;
    const cam = makeCamera(eye, yaw);
    const root = new Group();
    root.position.set(-1, 0, -4);
    root.rotation.y = 0.7;
    const local = new Vector3(-6, 2, 3);
    const before = worldPos(root, local);

    faceWorldPoint(root, cam, before.clone());

    const after = worldPos(root, local);
    // Gaze bearing for a yawed camera: -Z rotated by yaw.
    const gaze = new Vector3(0, 0, -1).applyEuler(cam.rotation);
    const bearingGaze = Math.atan2(gaze.z, gaze.x);
    const bearingAfter = Math.atan2(after.z - eye.z, after.x - eye.x);
    let diff = bearingAfter - bearingGaze;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    expect(diff).toBeCloseTo(0, 10);
  });
});
