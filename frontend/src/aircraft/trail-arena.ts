import { InstancedInterleavedBuffer, InterleavedBufferAttribute } from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

// Fleet-wide trail arena (issue #18). Every aircraft's trail used to be its
// own fat-line object: a draw call (two with a dashed gap) per aircraft per
// eye, the last per-aircraft draw left after bodies, ground icons and
// altitude lines were batched. This packs every trail into one
// LineSegments2 sharing one material. The reconciler runs one arena for
// the solid segments and one for the dashed gap segments.
//
// The reconciler keeps building each aircraft's trail into that aircraft's
// own arrays exactly as before (append fast path, windowing, XR decimation,
// head clip); the arena is only where those arrays are drawn from. Each
// frame the reconciler calls begin(), add() per aircraft in a stable order,
// then commit(). Unlike the icon and altitude-line pools this is not
// rewritten every frame: trails are thousands of segments, so add() copies
// only what changed.
//
//   - While the sequence of (owner, segment count) matches the previous
//     frame's, every trail still sits at the offset it had, and add()
//     copies just the tail of a trail its owner reports dirty.
//   - From the first trail whose owner or length differs, the rest are
//     rewritten at their new offsets. New aircraft join at the end of the
//     reconciler's map, so the common changes rewrite little.
//
// Smooth motion hides the newest segments of a trail (they are ahead of
// the delayed marker). A shared draw has one instance count, so a trail
// keeps its full length here and its hidden segments are parked: moved far
// below the scene, where they are clipped away. Collapsing them to a point
// would hand the fat-line shader a zero-length segment to normalise.

const DYNAMIC_DRAW_USAGE = 35048;
const NOOP_RAYCAST = (): void => {};
/** Where hidden segments go: far under the scene, with a real length. */
const PARK_Y = -1e5;

interface Buffers {
  pos: Float32Array;
  col: Float32Array;
  dist: Float32Array;
  posBuf: InstancedInterleavedBuffer;
  colBuf: InstancedInterleavedBuffer;
  distBuf: InstancedInterleavedBuffer;
}

function bind(geom: LineSegmentsGeometry, segments: number): Buffers {
  const pos = new Float32Array(segments * 6);
  const col = new Float32Array(segments * 6);
  const dist = new Float32Array(segments * 2);
  const posBuf = new InstancedInterleavedBuffer(pos, 6, 1);
  const colBuf = new InstancedInterleavedBuffer(col, 6, 1);
  const distBuf = new InstancedInterleavedBuffer(dist, 2, 1);
  for (const b of [posBuf, colBuf, distBuf]) b.setUsage(DYNAMIC_DRAW_USAGE);
  geom.setAttribute('instanceStart', new InterleavedBufferAttribute(posBuf, 3, 0));
  geom.setAttribute('instanceEnd', new InterleavedBufferAttribute(posBuf, 3, 3));
  geom.setAttribute('instanceColorStart', new InterleavedBufferAttribute(colBuf, 3, 0));
  geom.setAttribute('instanceColorEnd', new InterleavedBufferAttribute(colBuf, 3, 3));
  geom.setAttribute('instanceDistanceStart', new InterleavedBufferAttribute(distBuf, 1, 0));
  geom.setAttribute('instanceDistanceEnd', new InterleavedBufferAttribute(distBuf, 1, 1));
  return { pos, col, dist, posBuf, colBuf, distBuf };
}

export class TrailArena {
  readonly line: LineSegments2;
  private buf: Buffers;
  private capacity: number;
  /** Segments written so far this frame. */
  private cursor = 0;
  /** Index of the trail being added this frame. */
  private slot = 0;
  /** Still matching last frame's layout, trail for trail. */
  private stable = true;
  /** Everything from this segment on must be uploaded; Infinity = nothing. */
  private rewriteFrom = Number.POSITIVE_INFINITY;
  /** A grow or invalidate() replaced or voided the GPU copy. */
  private uploadAll = true;
  private owners: unknown[] = [];
  private counts: number[] = [];
  private total = 0;

  constructor(
    material: LineMaterial,
    /** Dashed trails carry per-segment line distances; solid ones do not. */
    private readonly withDistance: boolean,
    initialSegments = 4096,
  ) {
    const geom = new LineSegmentsGeometry();
    this.buf = bind(geom, initialSegments);
    this.capacity = initialSegments;
    geom.instanceCount = 0;
    this.line = new LineSegments2(geom, material);
    this.line.raycast = NOOP_RAYCAST;
    // Trails span the scope; one bounding volume for all of them would
    // never cull anything.
    this.line.frustumCulled = false;
    this.line.userData = { kind: 'trail-arena', dashed: withDistance };
  }

  /** Start a frame. */
  begin(): void {
    this.cursor = 0;
    this.slot = 0;
    this.stable = !this.uploadAll;
    this.rewriteFrom = Number.POSITIVE_INFINITY;
  }

  /**
   * One aircraft's trail for this frame.
   *
   * @param owner identity of the aircraft, compared by reference
   * @param count segments the trail holds
   * @param visible leading segments to draw; the rest are parked
   * @param dirtyFrom first segment changed since the owner's last add, or
   *   Infinity when nothing has
   */
  add(
    owner: unknown,
    pos: Float32Array,
    col: Float32Array,
    dist: Float32Array | null,
    count: number,
    visible: number,
    dirtyFrom: number,
  ): void {
    if (count === 0) return;
    const i = this.slot++;
    if (this.stable && (this.owners[i] !== owner || this.counts[i] !== count)) {
      this.stable = false;
      this.rewriteFrom = this.cursor;
    }
    this.owners[i] = owner;
    this.counts[i] = count;
    if (this.cursor + count > this.capacity) this.grow(this.cursor + count);
    const from = this.stable ? Math.min(dirtyFrom, count) : 0;
    if (from < count) {
      this.write(pos, col, dist, this.cursor, from, count, visible);
      if (this.stable) this.range(this.cursor + from, count - from);
    }
    this.cursor += count;
  }

  /** End a frame: publish the draw count and what has to be uploaded. */
  commit(): void {
    const b = this.buf;
    if (this.stable && this.slot !== this.owners.length) {
      // Same prefix, but trails dropped off the end.
      this.stable = false;
    }
    this.owners.length = this.slot;
    this.counts.length = this.slot;
    if (this.uploadAll) {
      for (const x of [b.posBuf, b.colBuf, b.distBuf]) {
        x.clearUpdateRanges();
        x.needsUpdate = true;
      }
      this.uploadAll = false;
    } else if (this.rewriteFrom < this.cursor) {
      this.range(this.rewriteFrom, this.cursor - this.rewriteFrom);
    }
    this.total = this.cursor;
    (this.line.geometry as LineSegmentsGeometry).instanceCount = this.cursor;
  }

  /** Segments in the arena after the last commit. */
  get count(): number {
    return this.total;
  }

  /**
   * Forget the layout so the next frame rewrites and uploads everything.
   * Needed after the arena has been hidden: a hidden object's buffers are
   * not uploaded, so partial updates queued meanwhile would be stale.
   */
  invalidate(): void {
    this.uploadAll = true;
    this.owners.length = 0;
    this.counts.length = 0;
  }

  private write(
    pos: Float32Array,
    col: Float32Array,
    dist: Float32Array | null,
    at: number,
    from: number,
    count: number,
    visible: number,
  ): void {
    const b = this.buf;
    const shown = Math.max(from, Math.min(visible, count));
    if (shown > from) {
      b.pos.set(pos.subarray(from * 6, shown * 6), (at + from) * 6);
      b.col.set(col.subarray(from * 6, shown * 6), (at + from) * 6);
      if (this.withDistance && dist) b.dist.set(dist.subarray(from * 2, shown * 2), (at + from) * 2);
    }
    for (let s = shown; s < count; s++) {
      const o = (at + s) * 6;
      b.pos[o] = 0;
      b.pos[o + 1] = PARK_Y;
      b.pos[o + 2] = 0;
      b.pos[o + 3] = 1;
      b.pos[o + 4] = PARK_Y;
      b.pos[o + 5] = 0;
    }
  }

  /** Queue a partial upload of `count` segments starting at `start`. */
  private range(start: number, count: number): void {
    if (this.uploadAll || count <= 0) return;
    const b = this.buf;
    b.posBuf.addUpdateRange(start * 6, count * 6);
    b.posBuf.needsUpdate = true;
    b.colBuf.addUpdateRange(start * 6, count * 6);
    b.colBuf.needsUpdate = true;
    if (this.withDistance) {
      b.distBuf.addUpdateRange(start * 2, count * 2);
      b.distBuf.needsUpdate = true;
    }
  }

  // Interleaved buffers cannot be resized: allocate a larger set on a new
  // geometry, carry over what this frame has written and what earlier
  // trails still hold, and dispose the old geometry so its GPU buffers go.
  private grow(required: number): void {
    const capacity = Math.max(this.capacity * 2, required);
    const geom = new LineSegmentsGeometry();
    const next = bind(geom, capacity);
    next.pos.set(this.buf.pos);
    next.col.set(this.buf.col);
    next.dist.set(this.buf.dist);
    const old = this.line.geometry as LineSegmentsGeometry;
    geom.instanceCount = old.instanceCount;
    this.line.geometry = geom;
    old.dispose();
    this.buf = next;
    this.capacity = capacity;
    this.uploadAll = true;
  }
}
