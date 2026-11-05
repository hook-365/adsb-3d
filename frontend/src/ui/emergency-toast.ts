import type { Aircraft } from '../core/types';
import type { AircraftStore } from '../aircraft/store';
import { getTimeContext } from '../core/time-context';
import { t } from '../core/i18n';

// Emergency toasts. When an aircraft starts squawking 7500 / 7600 / 7700
// (or readsb's `emergency` field goes non-"none"), a toast slides in at
// the top centre naming the flight and the condition; clicking it selects
// the aircraft. One toast per aircraft per emergency episode: it does not
// re-fire while the state persists, and it can fire again only after the
// state has cleared. Live mode only — historical scrubbing would replay
// every emergency in the window. No sound, by design.

const TOAST_MS = 15_000;
const MAX_VISIBLE = 3;

/** Pure: which hexes just entered an emergency state since `prev`. */
export function newEmergencies(
  snapshot: ReadonlyMap<string, Aircraft>,
  prev: ReadonlySet<string>,
): { fired: Aircraft[]; active: Set<string> } {
  const active = new Set<string>();
  const fired: Aircraft[] = [];
  for (const a of snapshot.values()) {
    if (a.emergency === null) continue;
    active.add(a.hex);
    if (!prev.has(a.hex)) fired.push(a);
  }
  return { fired, active };
}

export function flightName(a: Aircraft): string {
  return a.callsign ?? a.registration ?? a.hex.toUpperCase();
}

export function mountEmergencyToasts(store: AircraftStore, onPick: (hex: string) => void): void {
  const host = document.createElement('div');
  host.className = 'toasts';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  document.body.appendChild(host);

  let known = new Set<string>();
  const show = (a: Aircraft): void => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'toast toast-emergency';
    const detail = a.emergency ?? '';
    el.textContent = t('misc.emergency_toast', { flight: flightName(a), detail });
    el.title = t('misc.emergency_toast_hint');
    const dismiss = (): void => {
      el.classList.add('leaving');
      window.setTimeout(() => el.remove(), 250);
    };
    el.addEventListener('click', () => {
      onPick(a.hex);
      dismiss();
    });
    host.prepend(el);
    while (host.children.length > MAX_VISIBLE) host.lastElementChild?.remove();
    window.setTimeout(dismiss, TOAST_MS);
  };

  store.subscribe((snapshot) => {
    const { fired, active } = newEmergencies(snapshot, known);
    known = active;
    if (getTimeContext().mode !== 'live') return;
    for (const a of fired) show(a);
  });
}
