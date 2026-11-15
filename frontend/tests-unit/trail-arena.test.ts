import { describe, expect, it } from 'vitest';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { InterleavedBufferAttribute } from 'three';
import { TrailArena } from '../src/aircraft/trail-arena';

// The fleet-wide trail arena replaces one fat-line object per aircraft
// with one for all of them (issue #18 draw-call work). These pin what the
// reconciler relies on: trails packed end to end in add() order, copies
// limited to what changed while the layout holds, a rewrite from the first
// trail that moved, hidden head segments parked off scene, and growth.

const CLEAN = Number.POSITIVE_INFINITY;

/** A trail of `n` segments whose every float is `tag + segment index`. */
function trail(n: number, tag: number): { pos: Float32Array; col: Float32Array; dist: Float32Array } {
  const pos = new Float32Array(n * 6);
  const col = new Float32Array(n * 6);
  const dist = new Float32Array(n * 2);
  for (let s = 0; s < n; s++) {
    pos.fill(tag + s, s * 6, s * 6 + 6);
    col.fill(tag + s, s * 6, s * 6 + 6);
    dist.fill(tag + s, s * 2, s * 2 + 2);
  }
  return { pos, col, dist };
}

function arena(dashed = false, initial = 8): TrailArena {
  return new TrailArena(new LineMaterial(), dashed, initial);
}

function geometry(a: TrailArena): LineSegmentsGeometry {
  return a.line.geometry as LineSegmentsGeometry;
}

function buffer(a: TrailArena, name: string): { array: Float32Array; updateRanges: { start: number; count: number }[]; version: number } {
  return (geometry(a).getAttribute(name) as InterleavedBufferAttribute).data as never;
}

/** x of each segment's start vertex, for the first `n` segments. */
function starts(a: TrailArena, n: number): number[] {
  const arr = buffer(a, 'instanceStart').array;
  return Array.from({ length: n }, (_, s) => arr[s * 6]!);
}

describe('TrailArena', () => {
  it('packs trails end to end in add order and publishes the total', () => {
    const a = arena();
    const A = trail(2, 100);
    const B = trail(3, 200);
    a.begin();
    a.add('a', A.pos, A.col, null, 2, 2, 0);
    a.add('b', B.pos, B.col, null, 3, 3, 0);
    a.commit();
    expect(geometry(a).instanceCount).toBe(5);
    expect(a.count).toBe(5);
    expect(starts(a, 5)).toEqual([100, 101, 200, 201, 202]);
  });

  it('skips an empty trail without disturbing the layout', () => {
    const a = arena();
    const A = trail(2, 100);
    a.begin();
    a.add('empty', A.pos, A.col, null, 0, 0, 0);
    a.add('a', A.pos, A.col, null, 2, 2, 0);
    a.commit();
    expect(starts(a, 2)).toEqual([100, 101]);
  });

  it('copies nothing for clean trails and only the dirty tail of a changed one', () => {
    const a = arena();
    const A = trail(3, 100);
    const B = trail(3, 200);
    const frame = (dirtyB: number): void => {
      a.begin();
      a.add('a', A.pos, A.col, null, 3, 3, CLEAN);
      a.add('b', B.pos, B.col, null, 3, 3, dirtyB);
      a.commit();
    };
    a.begin();
    a.add('a', A.pos, A.col, null, 3, 3, 0);
    a.add('b', B.pos, B.col, null, 3, 3, 0);
    a.commit();
    const posBuf = buffer(a, 'instanceStart');
    posBuf.updateRanges.length = 0; // as the renderer does after an upload

    // Source arrays change, but the owners say clean: the arena must not look.
    A.pos.fill(-1);
    frame(CLEAN);
    expect(starts(a, 6)).toEqual([100, 101, 102, 200, 201, 202]);
    expect(posBuf.updateRanges).toEqual([]);

    // b's last segment moved.
    B.pos.fill(999, 12, 18);
    frame(2);
    expect(starts(a, 6)).toEqual([100, 101, 102, 200, 201, 999]);
    expect(posBuf.updateRanges).toEqual([{ start: 5 * 6, count: 6 }]);
  });

  it('rewrites from the first trail whose owner or length changed', () => {
    const a = arena();
    const A = trail(2, 100);
    const B = trail(2, 200);
    const C = trail(2, 300);
    a.begin();
    a.add('a', A.pos, A.col, null, 2, 2, 0);
    a.add('b', B.pos, B.col, null, 2, 2, 0);
    a.add('c', C.pos, C.col, null, 2, 2, 0);
    a.commit();
    const posBuf = buffer(a, 'instanceStart');
    posBuf.updateRanges.length = 0;

    // b is gone (filtered out, or left the scope): c moves up.
    a.begin();
    a.add('a', A.pos, A.col, null, 2, 2, CLEAN);
    a.add('c', C.pos, C.col, null, 2, 2, CLEAN);
    a.commit();
    expect(geometry(a).instanceCount).toBe(4);
    expect(starts(a, 4)).toEqual([100, 101, 300, 301]);
    expect(posBuf.updateRanges).toEqual([{ start: 2 * 6, count: 2 * 6 }]);

    // a grew by a segment: everything after it shifts.
    const A3 = trail(3, 100);
    posBuf.updateRanges.length = 0;
    a.begin();
    a.add('a', A3.pos, A3.col, null, 3, 3, CLEAN);
    a.add('c', C.pos, C.col, null, 2, 2, CLEAN);
    a.commit();
    expect(starts(a, 5)).toEqual([100, 101, 102, 300, 301]);
    expect(posBuf.updateRanges).toEqual([{ start: 0, count: 5 * 6 }]);
  });

  it('parks the segments beyond the visible count below the scene, with a real length', () => {
    const a = arena();
    const A = trail(4, 100);
    a.begin();
    a.add('a', A.pos, A.col, null, 4, 2, 0);
    a.commit();
    const arr = buffer(a, 'instanceStart').array;
    expect(starts(a, 2)).toEqual([100, 101]);
    for (const s of [2, 3]) {
      const seg = Array.from(arr.subarray(s * 6, s * 6 + 6));
      expect(seg[1]).toBeLessThan(-1e4);
      expect(seg[4]).toBeLessThan(-1e4);
      expect(seg.slice(0, 3)).not.toEqual(seg.slice(3, 6));
    }
    // Draw count is the full length: a shared draw cannot stop early per trail.
    expect(geometry(a).instanceCount).toBe(4);

    // The clip lifts: the owner reports the segments dirty and they return.
    a.begin();
    a.add('a', A.pos, A.col, null, 4, 4, 2);
    a.commit();
    expect(starts(a, 4)).toEqual([100, 101, 102, 103]);
  });

  it('carries line distances only when dashed', () => {
    const A = trail(2, 100);
    const solid = arena(false);
    solid.begin();
    solid.add('a', A.pos, A.col, null, 2, 2, 0);
    solid.commit();
    expect(Array.from(buffer(solid, 'instanceDistanceStart').array.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    const dashed = arena(true);
    dashed.begin();
    dashed.add('a', A.pos, A.col, A.dist, 2, 2, 0);
    dashed.commit();
    expect(Array.from(buffer(dashed, 'instanceDistanceStart').array.subarray(0, 4))).toEqual([100, 100, 101, 101]);
  });

  it('grows mid-frame, keeping earlier trails, and uploads the new buffers whole', () => {
    const a = arena(false, 4);
    const A = trail(3, 100);
    const B = trail(6, 200);
    a.begin();
    a.add('a', A.pos, A.col, null, 3, 3, 0);
    a.commit();
    const before = geometry(a);

    a.begin();
    a.add('a', A.pos, A.col, null, 3, 3, CLEAN);
    a.add('b', B.pos, B.col, null, 6, 6, 0);
    a.commit();
    expect(geometry(a)).not.toBe(before);
    expect(geometry(a).instanceCount).toBe(9);
    expect(starts(a, 9)).toEqual([100, 101, 102, 200, 201, 202, 203, 204, 205]);
    expect(buffer(a, 'instanceStart').updateRanges).toEqual([]);
  });

  it('rewrites everything after invalidate()', () => {
    const a = arena();
    const A = trail(2, 100);
    a.begin();
    a.add('a', A.pos, A.col, null, 2, 2, 0);
    a.commit();
    A.pos.fill(7);
    a.invalidate();
    a.begin();
    a.add('a', A.pos, A.col, null, 2, 2, CLEAN);
    a.commit();
    expect(starts(a, 2)).toEqual([7, 7]);
  });

  it('never answers a raycast', () => {
    const a = arena();
    const hits: unknown[] = [];
    a.line.raycast({} as never, hits as never);
    expect(hits).toHaveLength(0);
  });
});
