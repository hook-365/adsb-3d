import {
  BufferGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  type Color,
  type Object3D,
  type Quaternion,
  type Vector3,
} from 'three';
import { DIORAMA_PLANES } from '../world/diorama-clip';

// Instanced aircraft bodies (issue #18). Every aircraft's 3D marker used to
// be its own Mesh with its own material: one draw call per aircraft per
// eye, and after the ground icons and altitude lines were batched (issue
// #6) it was the largest per-aircraft cost left on a busy scope. This pool
// collapses the fleet to one InstancedMesh per *geometry* in use (a live
// scope draws 10 to 30 of the catalog's silhouettes, or one cone): shared
// geometry, per-instance transform, per-instance RGBA for the altitude
// tint and the stale fade.
//
// Same contract as IconInstancePool: no persistent per-aircraft identity,
// rebuilt every frame (begin, push per visible aircraft, commit).
//
// Each geometry has up to two buckets. Fully opaque aircraft, which is
// nearly all of them, go in an opaque one; an aircraft part-way through
// its stale fade goes in a transparent one. Instances inside one draw
// cannot be depth-sorted against each other, so keeping the blended ones
// apart (and few) is what keeps the fade looking right, and the opaque
// majority leaves the transparent pass altogether.
//
// The selected aircraft is not in here: the reconciler draws it as a real
// mesh with its own material, for the brighter emissive it gets.
//
// Ownership: constructed and driven only by the reconciler, which hands it
// the aircraft root; the reconciler still owns the aircraft scene graph.

const INITIAL_CAPACITY = 64;
const POOL_KIND = 'aircraft-body-pool';
/** At or above this an aircraft counts as opaque. */
export const BODY_OPAQUE_ALPHA = 0.99;
/** Emissive as a fraction of the body colour, as the per-aircraft material had. */
const EMISSIVE_FRACTION = 0.35;

interface BodyBucket {
  mesh: InstancedMesh;
  colorAttr: InstancedBufferAttribute;
  cursor: number;
  capacity: number;
}

const tmpMat = new Matrix4();

/** The source geometry's vertex data without its identity: the instanced
 *  colour attribute must live on a geometry of the bucket's own, and the
 *  attribute objects (and so their GPU buffers) stay shared. */
function shareGeometry(source: BufferGeometry): BufferGeometry {
  const geom = new BufferGeometry();
  for (const name of Object.keys(source.attributes)) {
    if (name !== 'color') geom.setAttribute(name, source.attributes[name]!);
  }
  geom.setIndex(source.index);
  for (const g of source.groups) geom.addGroup(g.start, g.count, g.materialIndex);
  return geom;
}

function buildMaterial(opaque: boolean): MeshLambertMaterial {
  const material = new MeshLambertMaterial({
    transparent: !opaque,
    vertexColors: true,
    clippingPlanes: DIORAMA_PLANES,
  });
  // Emissive follows the instance colour, as it followed the material
  // colour when each aircraft had a material of its own. vColor is the
  // instance colour once USE_COLOR / USE_COLOR_ALPHA is on.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 totalEmissiveRadiance = emissive;',
      `vec3 totalEmissiveRadiance = vColor.rgb * ${EMISSIVE_FRACTION.toFixed(2)};`,
    );
  };
  material.customProgramCacheKey = () => 'aircraft-body-pool';
  return material;
}

function buildBucket(source: BufferGeometry, opaque: boolean, capacity: number): BodyBucket {
  const geometry = shareGeometry(source);
  const colorAttr = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  colorAttr.setUsage(DynamicDrawUsage);
  // Named 'color' + itemSize 4 + vertexColors: three's stock per-instance
  // RGBA path (see icon-instances.ts). Do not switch to setColorAt.
  geometry.setAttribute('color', colorAttr);
  const mesh = new InstancedMesh(geometry, buildMaterial(opaque), capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  // One bounding volume for a fleet spread over the whole scope would
  // always intersect the view; the reconciler culls per aircraft instead.
  mesh.frustumCulled = false;
  // Picking goes through the per-aircraft pick proxies, never the bodies.
  mesh.raycast = () => {};
  mesh.count = 0;
  mesh.visible = false;
  mesh.userData = { kind: POOL_KIND, opaque };
  return { mesh, colorAttr, cursor: 0, capacity };
}

export class BodyInstancePool {
  private readonly buckets = new Map<string, BodyBucket>();

  constructor(private readonly root: Object3D) {}

  /** Start a frame: reset every bucket's write cursor. */
  begin(): void {
    for (const bucket of this.buckets.values()) bucket.cursor = 0;
  }

  /** Append one aircraft's body for this frame. */
  push(
    geometry: BufferGeometry,
    position: Vector3,
    quaternion: Quaternion,
    scale: Vector3,
    color: Color,
    opacity: number,
  ): void {
    const opaque = opacity >= BODY_OPAQUE_ALPHA;
    const key = `${geometry.uuid}|${opaque ? 'o' : 't'}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = buildBucket(geometry, opaque, INITIAL_CAPACITY);
      this.buckets.set(key, bucket);
      this.root.add(bucket.mesh);
    }
    if (bucket.cursor === bucket.capacity) bucket = this.grow(key, geometry, opaque, bucket);

    const i = bucket.cursor++;
    tmpMat.compose(position, quaternion, scale);
    bucket.mesh.setMatrixAt(i, tmpMat);
    const o = i * 4;
    const col = bucket.colorAttr.array as Float32Array;
    col[o] = color.r;
    col[o + 1] = color.g;
    col[o + 2] = color.b;
    col[o + 3] = opaque ? 1 : opacity;
  }

  /** End a frame: publish counts and mark GPU uploads. */
  commit(): void {
    for (const bucket of this.buckets.values()) {
      bucket.mesh.count = bucket.cursor;
      bucket.mesh.visible = bucket.cursor > 0;
      if (bucket.cursor > 0) {
        bucket.mesh.instanceMatrix.needsUpdate = true;
        bucket.colorAttr.needsUpdate = true;
      }
    }
  }

  /** Buckets with live instances this frame: the draw-call cost. */
  get activeBuckets(): number {
    let n = 0;
    for (const bucket of this.buckets.values()) if (bucket.cursor > 0) n++;
    return n;
  }

  /** Bodies written this frame, across every bucket. */
  get count(): number {
    let n = 0;
    for (const bucket of this.buckets.values()) n += bucket.cursor;
    return n;
  }

  // InstancedMesh capacity is fixed at construction: allocate double and
  // copy the instances already written this frame.
  private grow(key: string, source: BufferGeometry, opaque: boolean, old: BodyBucket): BodyBucket {
    const grown = buildBucket(source, opaque, old.capacity * 2);
    (grown.mesh.instanceMatrix.array as Float32Array).set(
      (old.mesh.instanceMatrix.array as Float32Array).subarray(0, old.cursor * 16),
    );
    (grown.colorAttr.array as Float32Array).set((old.colorAttr.array as Float32Array).subarray(0, old.cursor * 4));
    grown.cursor = old.cursor;
    this.root.remove(old.mesh);
    // Not geometry.dispose(): its vertex attributes belong to the shared
    // source geometry. The instanced attributes go with the mesh.
    (old.mesh.material as MeshLambertMaterial).dispose();
    old.mesh.dispose();
    this.root.add(grown.mesh);
    this.buckets.set(key, grown);
    return grown;
  }
}
