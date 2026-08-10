import { describe, expect, it } from 'vitest';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { AltLineArena } from '../src/aircraft/altline-arena';

// The fleet-wide altitude-line arena replaces one LineSegments2 per
// aircraft with a single instanced draw (issue #6). These tests pin the
// interleaved layout the fat-line shader reads, the per-frame rebuild
// semantics, and mid-frame growth.

function geometryOf(arena: AltLineArena): LineSegmentsGeometry {
  return arena.line.geometry as LineSegmentsGeometry;
}

describe('AltLineArena', () => {
  it('instanceCount tracks pushes and resets on begin', () => {
    const arena = new AltLineArena(new LineMaterial({}), 4);
    arena.begin();
    arena.push(0, 1, 2, 3, 4, 5);
    arena.push(6, 7, 8, 9, 10, 11);
    arena.commit();
    expect(geometryOf(arena).instanceCount).toBe(2);
    arena.begin();
    arena.push(0, 0, 0, 0, 0, 0);
    arena.commit();
    expect(geometryOf(arena).instanceCount).toBe(1);
    arena.begin();
    arena.commit();
    expect(geometryOf(arena).instanceCount).toBe(0);
  });

  it('writes endpoints at the interleaved offsets the fat-line shader reads', () => {
    const arena = new AltLineArena(new LineMaterial({}), 4);
    arena.begin();
    arena.push(1, 2, 3, 4, 5, 6);
    arena.push(7, 8, 9, 10, 11, 12);
    arena.commit();
    const geom = geometryOf(arena);
    const start = geom.getAttribute('instanceStart');
    const end = geom.getAttribute('instanceEnd');
    // Segment 0: start (1,2,3), end (4,5,6); segment 1 follows at the next
    // 6-float stride. getX/getY/getZ resolve interleaved offsets.
    expect([start.getX(0), start.getY(0), start.getZ(0)]).toEqual([1, 2, 3]);
    expect([end.getX(0), end.getY(0), end.getZ(0)]).toEqual([4, 5, 6]);
    expect([start.getX(1), start.getY(1), start.getZ(1)]).toEqual([7, 8, 9]);
    expect([end.getX(1), end.getY(1), end.getZ(1)]).toEqual([10, 11, 12]);
  });

  it('grows mid-frame without losing earlier segments and re-binds attributes', () => {
    const arena = new AltLineArena(new LineMaterial({}), 2);
    const geomBefore = geometryOf(arena);
    const attrBefore = geomBefore.getAttribute('instanceStart');
    arena.begin();
    for (let i = 0; i < 5; i++) arena.push(i, 0, 0, i, 1, 0);
    arena.commit();
    const geom = geometryOf(arena);
    expect(geom.instanceCount).toBe(5);
    // Growth re-binds new attribute objects (new GPU buffers).
    expect(geom.getAttribute('instanceStart')).not.toBe(attrBefore);
    const start = geom.getAttribute('instanceStart');
    for (let i = 0; i < 5; i++) expect(start.getX(i)).toBe(i);
  });

  it('never raycasts (picking must not hit altitude lines)', () => {
    const arena = new AltLineArena(new LineMaterial({}), 2);
    // The stock LineSegments2.raycast throws without raycaster.camera —
    // the no-op override is what keeps the XR controllers' bare raycaster
    // safe when it walks the aircraft root.
    expect(() =>
      arena.line.raycast(
        // Minimal stand-in; a real Raycaster isn't needed for a no-op.
        {} as never,
        [],
      ),
    ).not.toThrow();
  });
});
