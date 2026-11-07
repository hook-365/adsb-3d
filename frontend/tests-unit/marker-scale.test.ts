import { describe, expect, it } from 'vitest';
import {
  MARKER_MAX_SCALE,
  MARKER_MIN_SCALE,
  MARKER_REF_DISTANCE,
  markerViewScale,
  groundIconFade,
  GROUND_ICON_FADE_END,
  GROUND_ICON_FADE_START,
} from '../src/aircraft/marker-scale';

describe('markerViewScale', () => {
  it('is 1 at the reference distance and stays 1 out to the boot camera', () => {
    expect(markerViewScale(MARKER_REF_DISTANCE)).toBeCloseTo(1, 9);
    expect(markerViewScale(356)).toBe(1);
  });
  it('shrinks gently as the camera approaches, down to the floor', () => {
    expect(markerViewScale(MARKER_REF_DISTANCE / 2)).toBeCloseTo(0.5 ** 0.6, 9);
    expect(markerViewScale(MARKER_REF_DISTANCE / 2)).toBeGreaterThan(0.5);
    expect(markerViewScale(MARKER_REF_DISTANCE / 10)).toBeCloseTo(0.1 ** 0.6, 9);
    expect(markerViewScale(1)).toBe(MARKER_MIN_SCALE);
    expect(markerViewScale(0)).toBe(MARKER_MIN_SCALE);
    expect(markerViewScale(Number.NaN)).toBe(MARKER_MIN_SCALE);
  });
  it('never grows past the designed size when zooming out', () => {
    expect(MARKER_MAX_SCALE).toBe(1);
    expect(markerViewScale(MARKER_REF_DISTANCE * 1.2)).toBe(1);
    expect(markerViewScale(5000)).toBe(1);
  });
  it('is monotonic', () => {
    let last = 0;
    for (let d = 0; d <= 2000; d += 25) {
      const s = markerViewScale(d);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });
});

describe('groundIconFade', () => {
  it('is fully visible far away and gone close in', () => {
    expect(groundIconFade(1)).toBe(1);
    expect(groundIconFade(GROUND_ICON_FADE_START)).toBe(1);
    expect(groundIconFade(GROUND_ICON_FADE_END)).toBe(0);
    expect(groundIconFade(0.08)).toBe(0);
    const mid = (GROUND_ICON_FADE_START + GROUND_ICON_FADE_END) / 2;
    expect(groundIconFade(mid)).toBeCloseTo(0.5, 9);
  });
});
