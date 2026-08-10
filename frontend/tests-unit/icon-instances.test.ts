// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { IconInstancePool, defaultIconState } from '../src/aircraft/icon-instances';

// The instanced ground-icon pool replaces one Mesh-per-aircraft with one
// InstancedMesh per shape (issue #6 VR draw-call work). These tests pin the
// contract the reconciler and three's renderer rely on: per-instance RGBA
// through the stock USE_COLOR_ALPHA path, matrix composition, per-frame
// rebuild semantics, capacity growth, and instanceId → hex pick resolution.
//
// jsdom needed: bucket construction rasterizes the shape texture via
// getShapeTexture (canvas + Image). The texture itself never resolves in
// tests (no real image decode) — the pool only needs the call not to throw.

// jsdom has no object-URL implementation; the texture rasterizer only needs
// the call to succeed (the async Image decode never completes in tests,
// which the shapes module already tolerates — the texture stays blank).
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:vitest-stub';
  URL.revokeObjectURL = () => {};
}

function state(over: Partial<ReturnType<typeof defaultIconState>> = {}) {
  return { ...defaultIconState(), ...over };
}

function poolMesh(root: Group, shapeName: string): InstancedMesh {
  const found = root.children.find(
    (c) => (c.userData as { shapeName?: string }).shapeName === shapeName,
  );
  expect(found).toBeDefined();
  return found as InstancedMesh;
}

describe('IconInstancePool', () => {
  it('buckets by shape and publishes counts on commit', () => {
    const root = new Group();
    const pool = new IconInstancePool(root, true);
    pool.begin();
    pool.push('airliner', 'aaa111', state());
    pool.push('airliner', 'bbb222', state());
    pool.push('helicopter', 'ccc333', state());
    pool.commit();
    expect(poolMesh(root, 'airliner').count).toBe(2);
    expect(poolMesh(root, 'helicopter').count).toBe(1);
    expect(pool.activeBuckets).toBe(2);
  });

  it('carries per-instance RGBA in an itemSize-4 "color" attribute (USE_COLOR_ALPHA precondition)', () => {
    const root = new Group();
    const pool = new IconInstancePool(root, true);
    pool.begin();
    pool.push('airliner', 'aaa111', state({ r: 0.25, g: 0.5, b: 0.75, a: 0.4 }));
    pool.commit();
    const mesh = poolMesh(root, 'airliner');
    const attr = mesh.geometry.getAttribute('color');
    // three enables per-instance alpha only when vertexColors is true AND
    // the geometry's color attribute has itemSize 4 (WebGLPrograms
    // `vertexAlphas`). If either half regresses, stale-fade breaks silently.
    expect(attr.itemSize).toBe(4);
    expect((mesh.material as { vertexColors?: boolean }).vertexColors).toBe(true);
    const arr = attr.array as Float32Array;
    const rgba = [0.25, 0.5, 0.75, 0.4];
    for (let i = 0; i < 4; i++) expect(arr[i]).toBeCloseTo(rgba[i]!, 6);
  });

  it('composes position / yaw / footprint scale into the instance matrix', () => {
    const root = new Group();
    const pool = new IconInstancePool(root, true);
    pool.begin();
    pool.push('airliner', 'aaa111', state({ x: 10, y: 0.05, z: -4, yaw: Math.PI / 2, w: 6, h: 4 }));
    pool.commit();
    const m = new Matrix4();
    poolMesh(root, 'airliner').getMatrixAt(0, m);
    const pos = new Vector3();
    const quat = new Quaternion();
    const scale = new Vector3();
    m.decompose(pos, quat, scale);
    expect(pos.x).toBeCloseTo(10);
    expect(pos.y).toBeCloseTo(0.05);
    expect(pos.z).toBeCloseTo(-4);
    expect(scale.x).toBeCloseTo(6);
    expect(scale.z).toBeCloseTo(4);
    // yaw about +Y by π/2
    const expected = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    expect(Math.abs(quat.dot(expected))).toBeCloseTo(1);
  });

  it('tilts the quad onto a terrain normal', () => {
    const root = new Group();
    const pool = new IconInstancePool(root, true);
    pool.begin();
    // 45° east-facing slope: normal leans toward -x.
    pool.push('airliner', 'aaa111', state({ nx: -1, ny: 1, nz: 0 }));
    pool.commit();
    const m = new Matrix4();
    poolMesh(root, 'airliner').getMatrixAt(0, m);
    const quat = new Quaternion();
    m.decompose(new Vector3(), quat, new Vector3());
    const up = new Vector3(0, 1, 0).applyQuaternion(quat);
    const expected = new Vector3(-1, 1, 0).normalize();
    expect(up.dot(expected)).toBeCloseTo(1);
  });

  it('rebuild with fewer aircraft shrinks counts and hides empty buckets', () => {
    const root = new Group();
    const pool = new IconInstancePool(root, true);
    pool.begin();
    pool.push('airliner', 'aaa111', state());
    pool.push('helicopter', 'ccc333', state());
    pool.commit();
    pool.begin();
    pool.push('airliner', 'aaa111', state());
    pool.commit();
    expect(poolMesh(root, 'airliner').count).toBe(1);
    expect(poolMesh(root, 'helicopter').count).toBe(0);
    expect(poolMesh(root, 'helicopter').visible).toBe(false);
    expect(pool.activeBuckets).toBe(1);
  });

  it('grows past capacity mid-frame without losing earlier instances', () => {
    const root = new Group();
    const pool = new IconInstancePool(root, true);
    pool.begin();
    for (let i = 0; i < 70; i++) {
      pool.push('airliner', `hex${i}`, state({ x: i, r: i / 100 }));
    }
    pool.commit();
    const mesh = poolMesh(root, 'airliner');
    expect(mesh.count).toBe(70);
    // Only one airliner mesh under the root (the pre-grow one was removed).
    const airliners = root.children.filter(
      (c) => (c.userData as { shapeName?: string }).shapeName === 'airliner',
    );
    expect(airliners.length).toBe(1);
    const m = new Matrix4();
    const pos = new Vector3();
    mesh.getMatrixAt(0, m);
    m.decompose(pos, new Quaternion(), new Vector3());
    expect(pos.x).toBeCloseTo(0);
    mesh.getMatrixAt(69, m);
    m.decompose(pos, new Quaternion(), new Vector3());
    expect(pos.x).toBeCloseTo(69);
    expect(pool.hexAt(mesh, 69)).toBe('hex69');
  });

  it('resolves instanceIds to hexes and rejects out-of-range ids', () => {
    const root = new Group();
    const pool = new IconInstancePool(root, true);
    pool.begin();
    pool.push('airliner', 'aaa111', state());
    pool.push('airliner', 'bbb222', state());
    pool.commit();
    const mesh = poolMesh(root, 'airliner');
    expect(pool.hexAt(mesh, 0)).toBe('aaa111');
    expect(pool.hexAt(mesh, 1)).toBe('bbb222');
    // Stale id from a previous, fuller frame must not leak an old hex.
    expect(pool.hexAt(mesh, 2)).toBeNull();
    expect(pool.hexAt(new Group(), 0)).toBeNull();
  });

  it('setVisible(false) hides buckets; re-enable restores only live ones', () => {
    const root = new Group();
    const pool = new IconInstancePool(root, true);
    pool.begin();
    pool.push('airliner', 'aaa111', state());
    pool.commit();
    pool.setVisible(false);
    expect(poolMesh(root, 'airliner').visible).toBe(false);
    pool.setVisible(true);
    expect(poolMesh(root, 'airliner').visible).toBe(true);
  });
});
