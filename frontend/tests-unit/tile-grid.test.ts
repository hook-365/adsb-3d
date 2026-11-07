import { describe, it, expect } from 'vitest';
import { edgeBracket, rectDistanceToOrigin, terrainSegmentsFor } from '../src/world/tile-grid';

describe('rectDistanceToOrigin', () => {
  it('is zero when the rectangle contains the origin', () => {
    expect(rectDistanceToOrigin(-10, 10, -5, 5)).toBe(0);
  });

  it('measures to the nearest edge or corner', () => {
    expect(rectDistanceToOrigin(30, 60, -5, 5)).toBe(30);
    expect(rectDistanceToOrigin(-60, -40, -5, 5)).toBe(40);
    expect(rectDistanceToOrigin(3, 10, 4, 10)).toBe(5);
    expect(rectDistanceToOrigin(-10, -3, -10, -4)).toBe(5);
  });
});

describe('terrainSegmentsFor', () => {
  it('halves resolution beyond the far threshold only', () => {
    expect(terrainSegmentsFor(48, 50, 120)).toBe(48);
    expect(terrainSegmentsFor(48, 120, 120)).toBe(48);
    expect(terrainSegmentsFor(48, 121, 120)).toBe(24);
  });
});

describe('edgeBracket', () => {
  it('passes through when the neighbour is not coarser', () => {
    expect(edgeBracket(7, 24, 24)).toEqual({ i0: 7, i1: 7, t: 0 });
    expect(edgeBracket(7, 24, 48)).toEqual({ i0: 7, i1: 7, t: 0 });
  });

  it('keeps shared vertices exact', () => {
    expect(edgeBracket(0, 48, 24)).toEqual({ i0: 0, i1: 0, t: 0 });
    expect(edgeBracket(10, 48, 24)).toEqual({ i0: 10, i1: 10, t: 0 });
    expect(edgeBracket(48, 48, 24)).toEqual({ i0: 48, i1: 48, t: 0 });
  });

  it('interpolates fine-only vertices between coarse neighbours', () => {
    expect(edgeBracket(11, 48, 24)).toEqual({ i0: 10, i1: 12, t: 0.5 });
    expect(edgeBracket(5, 48, 12)).toEqual({ i0: 4, i1: 8, t: 0.25 });
  });
});

describe('quadSurfaceY', () => {
  it('matches the NE-SW diagonal split of buildTerrainPiece', async () => {
    const { quadSurfaceY } = await import('../src/world/tile-grid');
    // Corners reproduce exactly.
    expect(quadSurfaceY(1, 2, 3, 4, 0, 0)).toBe(1);
    expect(quadSurfaceY(1, 2, 3, 4, 1, 0)).toBe(2);
    expect(quadSurfaceY(1, 2, 3, 4, 0, 1)).toBe(3);
    expect(quadSurfaceY(1, 2, 3, 4, 1, 1)).toBe(4);
    // On the shared diagonal both triangles agree.
    expect(quadSurfaceY(1, 2, 3, 4, 0.5, 0.5)).toBeCloseTo(2.5);
    // A peak sampled only at the centre is NOT seen: the surface is planar
    // within each triangle, so the mid-quad height is the diagonal's.
    expect(quadSurfaceY(0, 0, 0, 0, 0.25, 0.25)).toBe(0);
    // Second triangle interpolates from SE.
    expect(quadSurfaceY(0, 0, 0, 8, 0.75, 0.75)).toBeCloseTo(4);
  });
});
