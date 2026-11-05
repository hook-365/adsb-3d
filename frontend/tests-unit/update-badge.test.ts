// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountSettingsPanel } from '../src/ui/settings-panel';
import { startUpdateCheck } from '../src/core/update-check';

// End-to-end in jsdom: /update.json (as written by entrypoint.sh) ->
// core/update-check -> settings-panel badge + gear dot. Guards the only
// user-visible outcome of the daily check.

function mockUpdateJson(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => body })),
  );
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('update badge', () => {
  // The update-check singleton is page-lifetime, so the disabled case runs
  // first, before anything has populated it.
  it('skips the fetch entirely when the deployment disabled the check', async () => {
    document.body.innerHTML = '<div id="settings-slot"></div>';
    window.UPDATE_CHECK_CONFIG = { enabled: false };
    mockUpdateJson({ latest: '9.9.9' });
    mountSettingsPanel();
    startUpdateCheck();
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>('.settings-update')!.hidden).toBe(true);
    delete window.UPDATE_CHECK_CONFIG;
  });

  it('shows the badge and gear dot when a newer release exists', async () => {
    document.body.innerHTML = '<div id="settings-slot"></div>';
    window.APP_VERSION = '0.12.1+local';
    mockUpdateJson({
      current: '0.12.1+local',
      latest: '0.13.0',
      url: 'https://github.com/hook-365/adsb-3d/releases/tag/v0.13.0',
      checkedAt: '2026-11-05T00:00:00Z',
    });
    mountSettingsPanel();
    startUpdateCheck();
    await settle();

    const badge = document.querySelector<HTMLAnchorElement>('.settings-update')!;
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('Update available: v0.13.0');
    expect(badge.href).toBe('https://github.com/hook-365/adsb-3d/releases/tag/v0.13.0');
    expect(badge.target).toBe('_blank');
    expect(document.querySelector('.settings-button')!.classList.contains('has-update')).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/update.json', { cache: 'no-store' });
  });
});
