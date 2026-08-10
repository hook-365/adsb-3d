import { InstancedInterleavedBuffer, InterleavedBufferAttribute } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

// Fleet-wide altitude-line arena (issue #6). Every aircraft's altitude
// line is one fat-line segment sharing one material (LINE_MAT_DEFAULT) and
// frustumCulled = false — there was never anything per-aircraft about it
// except the draw call. This arena collapses the fleet to a single
// LineSegments2 with one instanced segment per visible aircraft: 200 draw
// calls per eye become 1.
//
// Same per-frame rebuild contract as IconInstancePool: the reconciler
// calls begin() / push() per visible aircraft / commit() every syncFrame.
// The buffer layout and growth strategy mirror the reconciler's proven
// trail-buffer pattern (bindTrailAttributes / growTrailBuffer): one
// interleaved 6-float instance (start xyz, end xyz), re-bound via
// setAttribute on growth. Zero-instance frames cost no draw call
// (renderInstances early-returns on primcount 0).

const DYNAMIC_DRAW_USAGE = 35048;
const NOOP_RAYCAST = (): void => {};

function bindArenaBuffer(
  geom: LineSegmentsGeometry,
  segments: number,
): { arr: Float32Array; buf: InstancedInterleavedBuffer } {
  const arr = new Float32Array(segments * 6);
  const buf = new InstancedInterleavedBuffer(arr, 6, 1);
  buf.setUsage(DYNAMIC_DRAW_USAGE);
  geom.setAttribute('instanceStart', new InterleavedBufferAttribute(buf, 3, 0));
  geom.setAttribute('instanceEnd', new InterleavedBufferAttribute(buf, 3, 3));
  return { arr, buf };
}

export class AltLineArena {
  readonly line: LineSegments2;
  private arr: Float32Array;
  private buf: InstancedInterleavedBuffer;
  private capacity: number;
  private cursor = 0;

  constructor(material: LineMaterial, initialSegments = 256) {
    const geom = new LineSegmentsGeometry();
    const bound = bindArenaBuffer(geom, initialSegments);
    this.arr = bound.arr;
    this.buf = bound.buf;
    this.capacity = initialSegments;
    geom.instanceCount = 0;
    this.line = new LineSegments2(geom, material);
    // Fat-line raycast needs raycaster.camera and picking never targets
    // altitude lines — hard no-op, same as the per-aircraft lines had.
    this.line.raycast = NOOP_RAYCAST;
    this.line.frustumCulled = false;
    this.line.userData = { kind: 'altitude-line-arena' };
  }

  /** Start a frame: reset the write cursor. */
  begin(): void {
    this.cursor = 0;
  }

  /** Append one aircraft's segment (aircraft position → ground anchor). */
  push(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    if (this.cursor === this.capacity) this.grow();
    const o = this.cursor * 6;
    const arr = this.arr;
    arr[o] = x0;
    arr[o + 1] = y0;
    arr[o + 2] = z0;
    arr[o + 3] = x1;
    arr[o + 4] = y1;
    arr[o + 5] = z1;
    this.cursor++;
  }

  /** End a frame: publish the instanced draw count and upload. */
  commit(): void {
    (this.line.geometry as LineSegmentsGeometry).instanceCount = this.cursor;
    if (this.cursor > 0) this.buf.needsUpdate = true;
  }

  /** Segments written this frame (draw-range / tests). */
  get count(): number {
    return this.cursor;
  }

  // Interleaved buffers have no native resize: allocate double, copy this
  // frame's writes, re-bind (new attribute objects → new GPU buffers).
  private grow(): void {
    const newCapacity = this.capacity * 2;
    const bound = bindArenaBuffer(this.line.geometry as LineSegmentsGeometry, newCapacity);
    bound.arr.set(this.arr.subarray(0, this.cursor * 6));
    this.arr = bound.arr;
    this.buf = bound.buf;
    this.capacity = newCapacity;
  }
}
