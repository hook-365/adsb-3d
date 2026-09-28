// Procedural balloon / blimp markers (issue #13) and the B2 airship split.
import { Box3, BufferGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getSilhouetteGeometry } from '../src/aircraft/shape-geometry';
import { resolveShape } from '../src/aircraft/shapes';

function size(g: BufferGeometry): Vector3 {
  return new Box3().setFromBufferAttribute(g.getAttribute('position') as never).getSize(new Vector3());
}

// Fraction of faces whose normal points away from the origin. Lathed
// hulls with inverted winding score near 0.
function outwardFraction(g: BufferGeometry): number {
  const pos = g.getAttribute('position');
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let out = 0;
  const faces = pos.count / 3;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    const centroid = a.clone().add(b).add(c).divideScalar(3);
    if (n.dot(centroid) > 0) out++;
  }
  return out / faces;
}

describe('lighter-than-air markers', () => {
  it('balloon stands upright', () => {
    const g = getSilhouetteGeometry('balloon')!;
    const s = size(g);
    expect(s.y).toBeGreaterThan(s.x * 1.2);
    expect(s.x).toBeCloseTo(s.z, 1);
    expect(outwardFraction(g)).toBeGreaterThan(0.9);
  });

  it('blimp lies along its heading axis', () => {
    const g = getSilhouetteGeometry('blimp')!;
    const s = size(g);
    expect(s.z).toBeGreaterThan(s.x * 2.5);
    expect(s.z).toBeGreaterThan(s.y * 2.5);
    expect(outwardFraction(g)).toBeGreaterThan(0.9);
  });
});

describe('B2 airship split', () => {
  it('untyped B2 stays a balloon', () => {
    expect(resolveShape('B2', null, null, null)[0]).toBe('balloon');
  });
  it('Goodyear registrations are blimps', () => {
    expect(resolveShape('B2', null, null, 'N2A')[0]).toBe('blimp');
  });
  it('an airship description is a blimp', () => {
    expect(resolveShape('B2', null, 'ZEPPELIN LZ N07-101', null)[0]).toBe('blimp');
  });
  it('a typed B2 that is not BALL is a blimp', () => {
    expect(resolveShape('B2', 'ZZZZ', null, null)[0]).toBe('blimp');
    expect(resolveShape('B2', 'BALL', null, null)[0]).toBe('balloon');
  });
});
