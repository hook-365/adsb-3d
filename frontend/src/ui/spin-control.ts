import { getSettings, subscribeSettings, updateSettings } from '../core/settings';
import { t } from '../core/i18n';

// Footer "spin" control: the auto-orbit behaviour (Settings.autoOrbit,
// deg/s) with its direction (Settings.autoOrbitDirection) and speed in
// one thumb-sized popover. Tap "spin" to start at the last speed and open
// the popover; tap again to stop. The popover holds a left/right pair and
// a native range slider (touch-friendly, no custom drag code) and closes
// on an outside tap or Escape while the spin keeps going. Every change
// goes through the settings singleton, so the settings panel and the XR
// wrist menu stay in step and the desktop/XR orbit code just reads it.

/** Popover fades after this long without pointer or key activity; any activity restores it. */
export const SPIN_IDLE_FADE_MS = 2000;
export const SPIN_MIN = 1;
export const SPIN_MAX = 12;
export const SPIN_DEFAULT = 3;

export function mountSpinControl(): void {
  const foundRoot = document.getElementById('spin-control');
  const foundBtn = document.getElementById('spin-btn') as HTMLButtonElement | null;
  if (!foundRoot || !foundBtn) return;
  const root = foundRoot;
  const btn = foundBtn;

  const pop = document.createElement('div');
  pop.className = 'spin-pop';
  pop.hidden = true;

  const left = dirButton('left', '◀', t('static.spin_left'));
  const right = dirButton('right', '▶', t('static.spin_right'));

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'spin-speed';
  slider.min = String(SPIN_MIN);
  slider.max = String(SPIN_MAX);
  slider.step = '1';
  slider.setAttribute('aria-label', t('static.spin_speed'));

  const value = document.createElement('span');
  value.className = 'spin-speed-value';

  pop.append(left, slider, value, right);
  root.appendChild(pop);

  // Off → the last non-zero speed seen this session (3°/s before any);
  // the slider and the settings panel both move this.
  let lastSpeed = getSettings().autoOrbit || SPIN_DEFAULT;

  function dirButton(dir: 'left' | 'right', glyph: string, label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'spin-dir';
    b.textContent = glyph;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => {
      updateSettings({ autoOrbitDirection: dir });
      // Picking a direction while stopped is a clear "go that way".
      if (getSettings().autoOrbit === 0) updateSettings({ autoOrbit: lastSpeed });
    });
    return b;
  }

  // Idle fade: the popover is a tool, not a status display, so once the
  // spin is running and the hand is still it gets out of the way. Any
  // pointer motion, tap or key wakes it; it never closes on its own.
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  function armIdle(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      pop.classList.add('idle');
    }, SPIN_IDLE_FADE_MS);
  }
  function wake(): void {
    pop.classList.remove('idle');
    armIdle();
  }

  function open(): void {
    if (!pop.hidden) return;
    pop.hidden = false;
    pop.classList.remove('idle');
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointermove', wake, { passive: true });
    document.addEventListener('pointerdown', wake, { passive: true });
    document.addEventListener('keydown', wake);
    armIdle();
  }
  function close(): void {
    if (pop.hidden) return;
    pop.hidden = true;
    pop.classList.remove('idle');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointermove', wake);
    document.removeEventListener('pointerdown', wake);
    document.removeEventListener('keydown', wake);
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }
  function onOutside(e: PointerEvent): void {
    if (!root.contains(e.target as Node)) close();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }

  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => {
    if (getSettings().autoOrbit > 0) {
      updateSettings({ autoOrbit: 0 });
      close();
    } else {
      updateSettings({ autoOrbit: lastSpeed });
      open();
    }
  });
  slider.addEventListener('input', () => {
    updateSettings({ autoOrbit: Number(slider.value) });
  });

  const sync = (): void => {
    const s = getSettings();
    if (s.autoOrbit > 0) lastSpeed = s.autoOrbit;
    const on = s.autoOrbit > 0;
    btn.classList.toggle('active', on);
    slider.value = String(Math.min(SPIN_MAX, Math.max(SPIN_MIN, Math.round(s.autoOrbit || lastSpeed))));
    value.textContent = `${slider.value}°/s`;
    left.classList.toggle('active', s.autoOrbitDirection === 'left');
    right.classList.toggle('active', s.autoOrbitDirection !== 'left');
    // Stopped from elsewhere (settings panel, deselect): fold the popover.
    if (!on) close();
  };
  subscribeSettings(sync);
  sync();
}
