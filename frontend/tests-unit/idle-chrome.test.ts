// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('idle chrome while spinning', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.className = '';
  });

  it('fades only while the spin runs, wakes on activity, clears when the spin stops', async () => {
    vi.resetModules();
    window.sessionStorage.clear();
    window.localStorage.clear();
    const settings = await import('../src/core/settings');
    settings.updateSettings({ autoOrbit: 0 });
    const { mountIdleChrome, CHROME_IDLE_MS } = await import('../src/ui/idle-chrome');
    mountIdleChrome();
    vi.advanceTimersByTime(CHROME_IDLE_MS * 2);
    expect(document.body.classList.contains('chrome-idle')).toBe(false); // not spinning: never fades

    settings.updateSettings({ autoOrbit: 3 });
    vi.advanceTimersByTime(CHROME_IDLE_MS + 10);
    expect(document.body.classList.contains('chrome-idle')).toBe(true);
    document.dispatchEvent(new Event('pointermove'));
    expect(document.body.classList.contains('chrome-idle')).toBe(false);
    vi.advanceTimersByTime(CHROME_IDLE_MS + 10);
    expect(document.body.classList.contains('chrome-idle')).toBe(true);

    settings.updateSettings({ autoOrbit: 0 });
    expect(document.body.classList.contains('chrome-idle')).toBe(false);
    vi.advanceTimersByTime(CHROME_IDLE_MS * 2);
    expect(document.body.classList.contains('chrome-idle')).toBe(false);
  });
});
