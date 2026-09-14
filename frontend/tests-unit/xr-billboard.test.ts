import { describe, expect, it } from 'vitest';
import { Mesh, PlaneGeometry, Vector3 } from 'three';
import {
  BILLBOARD_CLEARANCE_NM,
  BILLBOARD_W_NM,
  billboardYaw,
  clearanceFor,
  readableWidth,
} from '../src/aircraft/xr-billboard-math';

// Issue #6 round 5: the XR info card must (a) stay upright — yaw toward the
// headset only, never pitch or roll with it — and (b) keep an air gap
// above the aircraft marker that grows with the readability floor.

/** Unit normal of a +Z-facing plane after the given yaw. */
function facing(yaw: number): Vector3 {
  const m = new Mesh(new PlaneGeometry(1, 1));
  m.rotation.set(0, yaw, 0);
  m.updateMatrixWorld(true);
  return new Vector3(0, 0, 1).applyQuaternion(m.quaternion);
}

describe('billboardYaw', () => {
  it('turns the card normal toward the eye in the ground plane', () => {
    const card = { x: 2, z: -3 };
    for (const eye of [
      { x: 2, z: 5 },
      { x: 9, z: -3 },
      { x: -4, z: -3 },
      { x: 2, z: -9 },
      { x: 7.5, z: 1.25 },
    ]) {
      const n = facing(billboardYaw(eye, card));
      const toEye = new Vector3(eye.x - card.x, 0, eye.z - card.z).normalize();
      expect(n.dot(toEye)).toBeCloseTo(1, 6);
    }
  });

  it('ignores eye height (no pitch, no roll)', () => {
    const card = { x: 0, z: 0 };
    const low = billboardYaw({ x: 3, z: 4 }, card);
    // Same XZ, "different Y" is simply not an input — the normal has no Y.
    expect(facing(low).y).toBeCloseTo(0, 12);
    expect(billboardYaw({ x: 3, z: 4 }, card)).toBe(low);
  });

  it('is finite with the eye directly overhead', () => {
    expect(billboardYaw({ x: 1, z: 1 }, { x: 1, z: 1 })).toBe(0);
  });
});

describe('readableWidth / clearanceFor', () => {
  it('keeps the base size when the eye is close', () => {
    expect(readableWidth(1)).toBe(BILLBOARD_W_NM);
    expect(clearanceFor(readableWidth(1))).toBe(BILLBOARD_CLEARANCE_NM);
  });

  it('grows width and clearance by the same factor when far away', () => {
    const w = readableWidth(100);
    expect(w).toBeGreaterThan(BILLBOARD_W_NM);
    expect(clearanceFor(w) / BILLBOARD_CLEARANCE_NM).toBeCloseTo(w / BILLBOARD_W_NM, 12);
  });
});
