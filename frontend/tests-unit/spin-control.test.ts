// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function mount() {
  document.body.innerHTML = '<span id="spin-control"><button id="spin-btn">spin</button></span>';
  vi.resetModules();
  window.sessionStorage.clear();
  window.localStorage.clear();
  const settings = await import('../src/core/settings');
  settings.updateSettings({ autoOrbit: 0, autoOrbitDirection: 'right' });
  const mod = await import('../src/ui/spin-control');
  mod.mountSpinControl();
  return { settings, mod };
}

describe('spin control', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('tap starts the spin at the last speed and opens the popover; tap again stops', async () => {
    const { settings } = await mount();
    const btn = document.getElementById('spin-btn')!;
    const pop = document.querySelector<HTMLElement>('.spin-pop')!;
    expect(pop.hidden).toBe(true);
    btn.click();
    expect(settings.getSettings().autoOrbit).toBe(3);
    expect(pop.hidden).toBe(false);
    btn.click();
    expect(settings.getSettings().autoOrbit).toBe(0);
    expect(pop.hidden).toBe(true);
  });

  it('slider and arrows write the settings; left arrow while stopped also starts it', async () => {
    const { settings } = await mount();
    const [left] = Array.from(document.querySelectorAll<HTMLButtonElement>('.spin-dir'));
    left!.click();
    expect(settings.getSettings().autoOrbitDirection).toBe('left');
    expect(settings.getSettings().autoOrbit).toBe(3);
    const slider = document.querySelector<HTMLInputElement>('.spin-speed')!;
    slider.value = '9';
    slider.dispatchEvent(new Event('input'));
    expect(settings.getSettings().autoOrbit).toBe(9);
    expect(document.querySelector('.spin-speed-value')!.textContent).toBe('9°/s');
  });

  it('fades after idle time and wakes on pointer movement', async () => {
    const { mod } = await mount();
    document.getElementById('spin-btn')!.click();
    const pop = document.querySelector<HTMLElement>('.spin-pop')!;
    expect(pop.classList.contains('idle')).toBe(false);
    vi.advanceTimersByTime(mod.SPIN_IDLE_FADE_MS + 10);
    expect(pop.classList.contains('idle')).toBe(true);
    document.dispatchEvent(new Event('pointermove'));
    expect(pop.classList.contains('idle')).toBe(false);
    vi.advanceTimersByTime(mod.SPIN_IDLE_FADE_MS + 10);
    expect(pop.classList.contains('idle')).toBe(true);
    // Stopping the spin closes it, idle or not.
    document.getElementById('spin-btn')!.click();
    expect(pop.hidden).toBe(true);
  });
});
