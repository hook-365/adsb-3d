import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  DIORAMA_PLANES,
  clearDiorama,
  dioramaActive,
  dioramaCenter,
  setDioramaBox,
} from '../src/world/diorama-clip';

// The diorama clip box is five inward-facing planes shared BY REFERENCE
// with every xrRoot material. These tests pin the plane math (a fragment
// inside the box must be on the positive side of all five planes), the
// in-place mutation contract, and the center round-trip the follow mode
// depends on.

function distances(p: Vector3): number[] {
  return DIORAMA_PLANES.map((plane) => plane.distanceToPoint(p));
}

describe('diorama clip box', () => {
  it('keeps inside points and rejects outside points on the correct sides', () => {
    setDioramaBox(new Vector3(1, 0.8, -2), 1.0);
    expect(DIORAMA_PLANES.length).toBe(5);
    // Center is comfortably inside all five half-spaces.
    expect(distances(new Vector3(1, 0.9, -2)).every((d) => d > 0)).toBe(true);
    // Just past the +x wall: exactly one plane rejects it.
    expect(distances(new Vector3(1.6, 0.9, -2)).filter((d) => d < 0).length).toBe(1);
    // Below the bottom: rejected.
    expect(distances(new Vector3(1, 0.7, -2)).some((d) => d < 0)).toBe(true);
    // Above the (open) top: still accepted — traffic over the walls shows.
    expect(distances(new Vector3(1, 5, -2)).every((d) => d > 0)).toBe(true);
    clearDiorama();
  });

  it('walls sit at half the size from the center', () => {
    setDioramaBox(new Vector3(0, 0, 0), 2.0);
    // A point 0.99 out is in; 1.01 out is clipped.
    expect(distances(new Vector3(0.99, 0.5, 0)).every((d) => d > 0)).toBe(true);
    expect(distances(new Vector3(1.01, 0.5, 0)).some((d) => d < 0)).toBe(true);
    clearDiorama();
  });

  it('mutates the shared array in place (material references stay valid)', () => {
    const ref = DIORAMA_PLANES;
    setDioramaBox(new Vector3(0, 0, 0), 1);
    expect(DIORAMA_PLANES).toBe(ref);
    expect(dioramaActive()).toBe(true);
    clearDiorama();
    expect(DIORAMA_PLANES).toBe(ref);
    expect(ref.length).toBe(0);
    expect(dioramaActive()).toBe(false);
  });

  it('round-trips the center for the follow-mode target', () => {
    const center = new Vector3(-3.25, 1.1, 4.5);
    setDioramaBox(center, 0.9);
    const out = new Vector3();
    expect(dioramaCenter(out)).not.toBeNull();
    expect(out.x).toBeCloseTo(center.x, 6);
    expect(out.y).toBeCloseTo(center.y, 6);
    expect(out.z).toBeCloseTo(center.z, 6);
    clearDiorama();
    expect(dioramaCenter(out)).toBeNull();
  });
});
