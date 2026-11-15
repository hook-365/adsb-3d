import { describe, expect, it } from 'vitest';
import { BoxGeometry, Color, ConeGeometry, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { BodyInstancePool } from '../src/aircraft/body-instances';

// The instanced body pool replaces one Mesh + material per aircraft with
// one InstancedMesh per geometry (issue #18 draw-call work). These pin the
// contract the reconciler and three's renderer rely on: bucketing by
// geometry and by opaque / fading, per-instance RGBA through the stock
// USE_COLOR_ALPHA path, per-frame rebuild semantics and capacity growth.

const ONE = new Vector3(1, 1, 1);
const NO_TURN = new Quaternion();
const RED = new Color(1, 0, 0);

function meshes(root: Group): InstancedMesh[] {
  return root.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh);
}

describe('BodyInstancePool', () => {
  it('draws every aircraft of one geometry in one bucket', () => {
    const root = new Group();
    const pool = new BodyInstancePool(root);
    const jet = new BoxGeometry();
    const heli = new ConeGeometry();
    pool.begin();
    for (let i = 0; i < 5; i++) pool.push(jet, new Vector3(i, 0, 0), NO_TURN, ONE, RED, 1);
    pool.push(heli, new Vector3(), NO_TURN, ONE, RED, 1);
    pool.commit();
    expect(pool.activeBuckets).toBe(2);
    expect(pool.count).toBe(6);
    expect(meshes(root).map((m) => m.count).sort()).toEqual([1, 5]);
  });

  it('keeps a fading aircraft out of the opaque bucket', () => {
    const root = new Group();
    const pool = new BodyInstancePool(root);
    const jet = new BoxGeometry();
    pool.begin();
    pool.push(jet, new Vector3(), NO_TURN, ONE, RED, 1);
    pool.push(jet, new Vector3(), NO_TURN, ONE, RED, 0.4);
    pool.commit();
    const [opaque, fading] = meshes(root).sort(
      (a, b) => Number((b.userData as { opaque: boolean }).opaque) - Number((a.userData as { opaque: boolean }).opaque),
    );
    expect((opaque!.material as { transparent: boolean }).transparent).toBe(false);
    expect((fading!.material as { transparent: boolean }).transparent).toBe(true);
    expect(fading!.geometry.getAttribute('color').getW(0)).toBeCloseTo(0.4);
    expect(opaque!.geometry.getAttribute('color').getW(0)).toBe(1);
  });

  it('carries the tint as an instanced itemSize-4 "color" attribute and shares the vertex data', () => {
    const root = new Group();
    const pool = new BodyInstancePool(root);
    const jet = new BoxGeometry();
    pool.begin();
    pool.push(jet, new Vector3(), NO_TURN, ONE, new Color(0.25, 0.5, 0.75), 1);
    pool.commit();
    const mesh = meshes(root)[0]!;
    const attr = mesh.geometry.getAttribute('color');
    expect(attr.itemSize).toBe(4);
    expect((mesh.material as { vertexColors: boolean }).vertexColors).toBe(true);
    expect([attr.getX(0), attr.getY(0), attr.getZ(0)]).toEqual([0.25, 0.5, 0.75]);
    // Same attribute objects as the source: one copy of the mesh on the GPU.
    expect(mesh.geometry.getAttribute('position')).toBe(jet.getAttribute('position'));
    expect(mesh.geometry.index).toBe(jet.index);
    // And the source is left without the instanced attribute.
    expect(jet.getAttribute('color')).toBeUndefined();
  });

  it('composes position, rotation and scale into the instance matrix', () => {
    const root = new Group();
    const pool = new BodyInstancePool(root);
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    pool.begin();
    pool.push(new BoxGeometry(), new Vector3(10, 20, 30), turn, new Vector3(2, 2, 2), RED, 1);
    pool.commit();
    const m = new Matrix4();
    meshes(root)[0]!.getMatrixAt(0, m);
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    m.decompose(p, q, s);
    expect(p.toArray()).toEqual([10, 20, 30]);
    expect(s.x).toBeCloseTo(2);
    expect(q.angleTo(turn)).toBeCloseTo(0);
  });

  it('is rebuilt each frame: a bucket nobody pushed to draws nothing', () => {
    const root = new Group();
    const pool = new BodyInstancePool(root);
    const jet = new BoxGeometry();
    pool.begin();
    pool.push(jet, new Vector3(), NO_TURN, ONE, RED, 1);
    pool.commit();
    pool.begin();
    pool.commit();
    expect(pool.activeBuckets).toBe(0);
    expect(meshes(root)[0]!.visible).toBe(false);
    expect(meshes(root)[0]!.count).toBe(0);
  });

  it('grows mid-frame without losing the instances already written', () => {
    const root = new Group();
    const pool = new BodyInstancePool(root);
    const jet = new BoxGeometry();
    pool.begin();
    for (let i = 0; i < 200; i++) pool.push(jet, new Vector3(i, 0, 0), NO_TURN, ONE, RED, 1);
    pool.commit();
    const all = meshes(root);
    expect(all).toHaveLength(1);
    expect(all[0]!.count).toBe(200);
    const m = new Matrix4();
    all[0]!.getMatrixAt(3, m);
    expect(new Vector3().setFromMatrixPosition(m).x).toBe(3);
    all[0]!.getMatrixAt(199, m);
    expect(new Vector3().setFromMatrixPosition(m).x).toBe(199);
  });

  it('never answers a raycast: picking goes through the pick proxies', () => {
    const root = new Group();
    const pool = new BodyInstancePool(root);
    pool.begin();
    pool.push(new BoxGeometry(), new Vector3(), NO_TURN, ONE, RED, 1);
    pool.commit();
    const hits: unknown[] = [];
    meshes(root)[0]!.raycast({} as never, hits as never);
    expect(hits).toHaveLength(0);
  });
});
