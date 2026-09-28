// @vitest-environment jsdom
// core/settings.ts reads storage at module load, so each scenario resets the
// module registry and re-imports after seeding storage. A new tab is
// simulated by clearing sessionStorage (localStorage is browser-wide).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'adsb3d_settings_v1';

async function freshSettings({ newTab = true } = {}) {
  if (newTab) sessionStorage.clear();
  vi.resetModules();
  return import('../src/core/settings');
}

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
}

describe('settings persistence across tabs', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
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

describe('tab-scoped settings (issue #12)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('adsb3d_acars_reset_v1', '1');
  });

  it('a new tab starts from the most recent change in any tab', async () => {
    const tabA = await freshSettings();
    tabA.updateSettings({ basemap: 'satellite' });
    window.dispatchEvent(new Event('pagehide'));
    const tabB = await freshSettings();
    expect(tabB.getSettings().basemap).toBe('satellite');
  });

  it('a reload keeps this tab\'s settings even after another tab changed them', async () => {
    const tabA = await freshSettings();
    tabA.updateSettings({ terrain3d: true, basemap: 'topo' });
    window.dispatchEvent(new Event('pagehide'));
    // Another tab later switches terrain off and persists.
    localStorage.setItem(KEY, JSON.stringify({ ...stored(), terrain3d: false, basemap: 'osm' }));
    // Tab A reloads (terrain toggles reload the page).
    const reloadedA = await freshSettings({ newTab: false });
    expect(reloadedA.getSettings().terrain3d).toBe(true);
    expect(reloadedA.getSettings().basemap).toBe('topo');
  });

  it('a reload of an untouched tab ignores later changes from other tabs', async () => {
    await freshSettings();
    localStorage.setItem(KEY, JSON.stringify({ basemap: 'osm' }));
    const reloaded = await freshSettings({ newTab: false });
    expect(reloaded.getSettings().basemap).toBe('carto_voyager');
  });
});
