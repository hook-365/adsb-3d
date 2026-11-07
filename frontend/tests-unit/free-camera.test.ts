import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { moveVector, shortestAngle, yawPitchToward } from '../src/world/free-camera';

describe('shortestAngle', () => {
  it('takes the short way round', () => {
    expect(shortestAngle(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(shortestAngle(0, (3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2);
    expect(shortestAngle(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });
});

describe('yawPitchToward', () => {
  it('yaw 0 looks down -Z, positive yaw turns left, pitch rises with height', () => {
    const eye = new Vector3(0, 10, 0);
    expect(yawPitchToward(eye, new Vector3(0, 10, -100)).yaw).toBeCloseTo(0);
    expect(yawPitchToward(eye, new Vector3(-100, 10, 0)).yaw).toBeCloseTo(Math.PI / 2);
    expect(yawPitchToward(eye, new Vector3(0, 110, -100)).pitch).toBeCloseTo(Math.PI / 4);
    expect(yawPitchToward(eye, new Vector3(0, 0, -100)).pitch).toBeLessThan(0);
  });
});

describe('moveVector', () => {
  it('flies forward along the view heading and strafes to its right', () => {
    const fwd = moveVector(new Set(['w']), 0);
    expect(fwd.x).toBeCloseTo(0);
    expect(fwd.z).toBeCloseTo(-1);
    const right = moveVector(new Set(['ArrowRight']), 0);
    expect(right.x).toBeCloseTo(1);
    expect(right.z).toBeCloseTo(0);
    const v = moveVector(new Set(['w']), Math.PI / 2);
    expect(v.x).toBeCloseTo(-1);
    expect(v.z).toBeCloseTo(0);
  });

  it('normalises diagonals, cancels opposites, and R/F go straight up and down', () => {
    const diag = moveVector(new Set(['w', 'd']), 0);
    expect(diag.length()).toBeCloseTo(1);
    expect(moveVector(new Set(['w', 's']), 0).lengthSq()).toBe(0);
    const up = moveVector(new Set(['r']), 1.3);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBe(1);
    expect(up.z).toBeCloseTo(0);
    expect(moveVector(new Set(['PageDown']), 1.3).y).toBe(-1);
  });
});
