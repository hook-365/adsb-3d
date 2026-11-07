import { getSettings, subscribeSettings } from '../core/settings';

// "Beautiful orbit": while the auto-orbit spins and the hand is still for
// two seconds,
// the chrome steps aside: HUD, status bar, the list and ACARS toggles and
// the settings gear fade out (style.css `body.chrome-idle`). Any pointer
// motion, tap or key brings everything back; stopping the spin ends it.
// The map attribution is deliberately NOT faded: keeping the basemap
// credit visible is a licence condition.

export const CHROME_IDLE_MS = 2000;
const CLASS = 'chrome-idle';

export function mountIdleChrome(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let armed = false;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const arm = (): void => {
    clear();
    timer = setTimeout(() => {
      timer = null;
      document.body.classList.add(CLASS);
    }, CHROME_IDLE_MS);
  };
  const wake = (): void => {
    document.body.classList.remove(CLASS);
    if (armed) arm();
  };

  const sync = (): void => {
    const spinning = getSettings().autoOrbit > 0;
    if (spinning && !armed) {
      armed = true;
      document.addEventListener('pointermove', wake, { passive: true });
      document.addEventListener('pointerdown', wake, { passive: true });
      document.addEventListener('keydown', wake);
      arm();
    } else if (!spinning && armed) {
      armed = false;
      document.removeEventListener('pointermove', wake);
      document.removeEventListener('pointerdown', wake);
      document.removeEventListener('keydown', wake);
      clear();
      document.body.classList.remove(CLASS);
    }
  };
  subscribeSettings(sync);
  sync();
}
