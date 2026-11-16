// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Stop the "terrain toggled, reload" handler from navigating jsdom.
vi.stubGlobal('location', { ...window.location, reload: () => {} });

const { updateSettings } = await import('../src/core/settings');
const { seatedY, terrainActive } = await import('../src/world/tiles');

describe('seatedY', () => {
  beforeAll(() => updateSettings({ terrain3d: true }));

  it('needs 3D terrain for the cases below', () => {
    expect(terrainActive()).toBe(true);
  });
  // Drawn ground at -0.3: the true surface is 0.4 above it, at 0.1.
  const ground = -0.3;
  it('puts anything at or under the true surface on the drawn ground', () => {
    expect(seatedY(0.1, ground)).toBeCloseTo(ground);
    expect(seatedY(0, ground)).toBeCloseTo(ground);
  });
  it('leaves an altitude well above the ground where it is', () => {
    expect(seatedY(0.1 + 0.5, ground)).toBeCloseTo(0.6);
    expect(seatedY(6, ground)).toBe(6);
  });
  it('eases between the two with no step and always rising', () => {
    let last = seatedY(0.1, ground);
    for (let above = 0.01; above <= 0.6; above += 0.01) {
      const y = seatedY(0.1 + above, ground);
      expect(y).toBeGreaterThan(last);
      expect(y - last).toBeLessThan(0.03);
      last = y;
    }
  });
});
