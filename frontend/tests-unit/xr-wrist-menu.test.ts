import { describe, expect, it } from 'vitest';
import { getDefaultSettings } from '../src/core/settings';
import {
  WRIST_MENU_EXCLUDED,
  WRIST_MENU_KEYS,
  WRIST_MENU_MAX_PAGE_SIZE,
  WRIST_MENU_PAGE_SIZES,
} from '../src/world/xr-wrist-menu';

// Settings-parity drift guard (issue #6): every key in core/settings.ts
// must be reachable from the VR wrist menu or carry an explicit reason
// for its absence. Without this, new settings silently never make it
// into the in-headset UI — the exact drift the schema-driven menu was
// built to stop.

describe('wrist menu settings parity', () => {
  const allKeys = Object.keys(getDefaultSettings()).sort();
  const menuKeys = [...WRIST_MENU_KEYS];
  const excludedKeys = Object.keys(WRIST_MENU_EXCLUDED);

  it('covers every Settings key (menu ∪ documented exclusions)', () => {
    const covered = [...new Set([...menuKeys, ...excludedKeys])].sort();
    expect(covered).toEqual(allKeys);
  });

  it('has no key both on the menu and excluded', () => {
    const overlap = menuKeys.filter((k) => excludedKeys.includes(k));
    expect(overlap).toEqual([]);
  });

  it('has no duplicate menu rows', () => {
    expect(new Set(menuKeys).size).toBe(menuKeys.length);
  });

  it('every excluded key documents a reason', () => {
    for (const reason of Object.values(WRIST_MENU_EXCLUDED)) {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it('no page overflows its content slots', () => {
    for (const size of WRIST_MENU_PAGE_SIZES) {
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThanOrEqual(WRIST_MENU_MAX_PAGE_SIZE);
    }
  });
});
