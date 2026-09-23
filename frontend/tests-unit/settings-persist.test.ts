// @vitest-environment jsdom
// core/settings.ts reads localStorage at module load, so each scenario
// resets the module registry and re-imports after seeding storage.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'adsb3d_settings_v1';

async function freshSettings() {
  vi.resetModules();
  return import('../src/core/settings');
}

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
}

describe('settings persistence across tabs', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('adsb3d_acars_reset_v1', '1');
  });

  it('a stale tab going hidden does not revert keys it never changed', async () => {
    // Tab A booted with terrain off...
    localStorage.setItem(KEY, JSON.stringify({ terrain3d: false }));
    const tabA = await freshSettings();
    expect(tabA.getSettings().terrain3d).toBe(false);
    // ...then another tab switched it on and persisted.
    localStorage.setItem(KEY, JSON.stringify({ ...stored(), terrain3d: true }));
    // Tab A changes something unrelated and is hidden.
    tabA.updateSettings({ stereo: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    expect(stored().terrain3d).toBe(true);
    expect(stored().stereo).toBe(true);
  });

  it('a tab with no changes writes nothing on hide', async () => {
    localStorage.setItem(KEY, JSON.stringify({ terrain3d: false }));
    await freshSettings();
    localStorage.setItem(KEY, JSON.stringify({ terrain3d: true }));
    window.dispatchEvent(new Event('pagehide'));
    expect(stored().terrain3d).toBe(true);
  });

  it('persists the keys this tab changed', async () => {
    const s = await freshSettings();
    s.updateSettings({ terrain3d: true });
    window.dispatchEvent(new Event('pagehide'));
    expect(stored().terrain3d).toBe(true);
  });
});
