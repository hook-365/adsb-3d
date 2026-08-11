import {
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { getShapeTexture } from './shapes';
import { DIORAMA_PLANES } from '../world/diorama-clip';

// Instanced ground-icon pool (issue #6). The per-aircraft ground silhouette
// used to be its own Mesh + Material + 6x6 draped PlaneGeometry — one draw
// call per aircraft per eye, which tyzbit's Quest profiling measured as the
// single biggest frame cost on busy scopes. This pool collapses the fleet
// to one InstancedMesh per *shape* (a live scope uses ~10-30 of the 92
// catalog shapes): shared unit-quad geometry, per-instance transform, and a
// per-instance RGBA attribute for the altitude tint + stale fade.
//
// The RGBA attribute rides three's stock USE_COLOR_ALPHA path: a
// `vertexColors: true` material plus a geometry attribute named 'color'
// with itemSize 4 makes the shader multiply diffuse by per-instance RGBA —
// no onBeforeCompile, no custom shader. (Do not switch to
// InstancedMesh.setColorAt: instanceColor is RGB-only.)
//
// The pool has no persistent per-aircraft identity: the reconciler rebuilds
// it every frame (begin → push per visible aircraft → commit). Add/remove,
// filter toggles, and shape re-resolution all fall out for free, and ~200
// matrix composes per frame is noise next to the draw calls it removes.
//
// Ownership: constructed and driven only by the reconciler, which hands it
// the aircraft root — the reconciler still owns the aircraft scene graph.

/** Per-aircraft icon state, cached on the reconciler's RenderEntry and
 *  pushed into the pool each frame. */
export interface IconInstanceState {
  /** Ground anchor (terrain-lifted when 3D terrain is active). */
  x: number;
  y: number;
  z: number;
  /** Yaw in radians (0 for noRotate shapes / unknown track). */
  yaw: number;
  /** Footprint in scene units. */
  w: number;
  h: number;
  /** Terrain surface normal; (0,1,0) on a flat world. */
  nx: number;
  ny: number;
  nz: number;
  /** Altitude tint + stale-fade alpha. */
  r: number;
  g: number;
  b: number;
  a: number;
}

export function defaultIconState(): IconInstanceState {
  return {
    x: 0, y: 0, z: 0,
    yaw: 0,
    w: 1, h: 1,
    nx: 0, ny: 1, nz: 0,
    r: 1, g: 1, b: 1, a: 1,
  };
}

interface ShapeBucket {
  mesh: InstancedMesh;
  colorAttr: InstancedBufferAttribute;
  /** instanceId → hex for this frame, for raycast pick resolution. */
  hexes: string[];
  cursor: number;
  capacity: number;
}

const INITIAL_CAPACITY = 64;
const POOL_KIND = 'aircraft-icon-pool';

const UP = new Vector3(0, 1, 0);
const tmpNormal = new Vector3();
const tmpTilt = new Quaternion();
const tmpYaw = new Quaternion();
const tmpPos = new Vector3();
const tmpScale = new Vector3();
const tmpMat = new Matrix4();

/** Unit quad lying flat on the ground, same orientation/UV mapping as the
 *  old per-aircraft plane: SVG top (nose) at scene -Z = north. Shared by
 *  every bucket — the per-bucket instanced attributes live on a clone. */
function unitQuad(): PlaneGeometry {
  const geom = new PlaneGeometry(1, 1);
  geom.rotateX(-Math.PI / 2);
  return geom;
}

function buildBucket(shapeName: string, capacity: number): ShapeBucket {
  const geometry = unitQuad();
  const colorArr = new Float32Array(capacity * 4);
  const colorAttr = new InstancedBufferAttribute(colorArr, 4);
  colorAttr.setUsage(DynamicDrawUsage);
  // Named 'color' + itemSize 4 + vertexColors:true = three's stock
  // USE_COLOR_ALPHA per-instance RGBA path (WebGLPrograms `vertexAlphas`).
  geometry.setAttribute('color', colorAttr);
  const cache = getShapeTexture(shapeName);
  const material = new MeshBasicMaterial({
    map: cache?.texture ?? null,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    vertexColors: true,
    clippingPlanes: DIORAMA_PLANES,
  });
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  // Same transparent-pass placement the per-aircraft icons had.
  mesh.renderOrder = 1;
  // Per-instance culling is gone anyway (one sphere for the whole bucket
  // would need a per-frame recompute over dynamic matrices); off-screen
  // instances cost 4 vertex-shader runs each — cheaper than the test.
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.userData = { kind: POOL_KIND, shapeName };
  return { mesh, colorAttr, hexes: [], cursor: 0, capacity };
}

export class IconInstancePool {
  private readonly buckets = new Map<string, ShapeBucket>();
  private visible: boolean;

  constructor(
    private readonly root: Object3D,
    visible: boolean,
  ) {
    this.visible = visible;
  }

  /** Start a frame: reset every bucket's write cursor. */
  begin(): void {
    for (const bucket of this.buckets.values()) bucket.cursor = 0;
  }

  /** Append one aircraft's icon for this frame. */
  push(shapeName: string, hex: string, s: IconInstanceState): void {
    let bucket = this.buckets.get(shapeName);
    if (!bucket) {
      bucket = buildBucket(shapeName, INITIAL_CAPACITY);
      this.buckets.set(shapeName, bucket);
      this.root.add(bucket.mesh);
    }
    if (bucket.cursor === bucket.capacity) bucket = this.grow(shapeName, bucket);

    const i = bucket.cursor++;
    bucket.hexes[i] = hex;

    // Orientation: yaw about +Y first, then tilt +Y onto the terrain
    // normal, so the icon spins in its own plane and then lies on the
    // slope. On a flat world the tilt is identity.
    tmpYaw.setFromAxisAngle(UP, s.yaw);
    if (s.nx === 0 && s.nz === 0) {
      tmpTilt.identity();
    } else {
      tmpNormal.set(s.nx, s.ny, s.nz).normalize();
      tmpTilt.setFromUnitVectors(UP, tmpNormal);
    }
    tmpTilt.multiply(tmpYaw);
    tmpPos.set(s.x, s.y, s.z);
    tmpScale.set(s.w, 1, s.h);
    tmpMat.compose(tmpPos, tmpTilt, tmpScale);
    bucket.mesh.setMatrixAt(i, tmpMat);

    const o = i * 4;
    const col = bucket.colorAttr.array as Float32Array;
    col[o] = s.r;
    col[o + 1] = s.g;
    col[o + 2] = s.b;
    col[o + 3] = s.a;
  }

  /** End a frame: publish counts and mark GPU uploads. */
  commit(): void {
    for (const bucket of this.buckets.values()) {
      bucket.mesh.count = bucket.cursor;
      bucket.mesh.visible = this.visible && bucket.cursor > 0;
      if (bucket.cursor > 0) {
        bucket.mesh.instanceMatrix.needsUpdate = true;
        bucket.colorAttr.needsUpdate = true;
        // Recomputed lazily by InstancedMesh.raycast on the next pick;
        // never per frame (the meshes don't frustum-cull).
        bucket.mesh.boundingSphere = null;
      }
    }
  }

  /** groundSprites setting: hides every bucket without touching per-frame
   *  bookkeeping (the reconciler also stops pushing while disabled). */
  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const bucket of this.buckets.values()) {
      bucket.mesh.visible = visible && bucket.cursor > 0;
    }
  }

  /** Resolve a raycast hit on a pool mesh to the aircraft hex it carried
   *  this frame, or null if the object isn't one of ours. */
  hexAt(obj: Object3D, instanceId: number): string | null {
    const ud = obj.userData as { kind?: string; shapeName?: string };
    if (ud.kind !== POOL_KIND || ud.shapeName === undefined) return null;
    const bucket = this.buckets.get(ud.shapeName);
    if (!bucket || instanceId >= bucket.cursor) return null;
    return bucket.hexes[instanceId] ?? null;
  }

  /** Bucket count with live instances this frame (draw-call cost / tests). */
  get activeBuckets(): number {
    let n = 0;
    for (const bucket of this.buckets.values()) if (bucket.cursor > 0) n++;
    return n;
  }

  // InstancedMesh capacity is fixed at construction; growing allocates a
  // double-capacity replacement and copies the instances already written
  // this frame (matrix + color arrays are plain Float32Arrays).
  private grow(shapeName: string, old: ShapeBucket): ShapeBucket {
    const grown = buildBucket(shapeName, old.capacity * 2);
    (grown.mesh.instanceMatrix.array as Float32Array).set(
      (old.mesh.instanceMatrix.array as Float32Array).subarray(0, old.cursor * 16),
    );
    (grown.colorAttr.array as Float32Array).set(
      (old.colorAttr.array as Float32Array).subarray(0, old.cursor * 4),
    );
    grown.cursor = old.cursor;
    grown.hexes = old.hexes;
    this.root.remove(old.mesh);
    old.mesh.geometry.dispose();
    (old.mesh.material as MeshBasicMaterial).dispose();
    old.mesh.dispose();
    this.root.add(grown.mesh);
    this.buckets.set(shapeName, grown);
    return grown;
  }
}
