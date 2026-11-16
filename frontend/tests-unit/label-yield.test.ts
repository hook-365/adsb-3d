import { describe, expect, it } from 'vitest';
import { labelYields, type ScreenBody } from '../src/world/label-yield';

const body = (x: number, y: number, d: number, r = 20): ScreenBody => ({ x, y, r, d });

describe('labelYields', () => {
  it('yields to a nearer aircraft over the label', () => {
    expect(labelYields(100, 100, 30, 8, 20, [body(110, 105, 6)])).toBe(true);
  });
  it('yields when the body only clips the edge', () => {
    expect(labelYields(100, 100, 30, 8, 20, [body(150, 100, 6)])).toBe(true);
  });
  it('ignores an aircraft elsewhere on screen', () => {
    expect(labelYields(100, 100, 30, 8, 20, [body(300, 100, 6)])).toBe(false);
  });
  it('ignores an aircraft behind the label', () => {
    expect(labelYields(100, 100, 30, 8, 20, [body(100, 100, 25)])).toBe(false);
  });
  it('ignores traffic at about the same distance, as on the field itself', () => {
    expect(labelYields(100, 100, 30, 8, 20, [body(100, 100, 19.5)])).toBe(false);
  });
});
