import type { AircraftStore } from '../aircraft/store';
import {
  clearAlerts,
  flightName,
  getAlertLog,
  getUnreadAlerts,
  markAlertsRead,
  parseWatchlist,
  recordAlert,
  scanAlerts,
  subscribeAlerts,
  syncAlertActivity,
  type AlertEntry,
  type AlertFire,
  type AlertKind,
} from '../core/alerts';
import { getSettings, subscribeSettings } from '../core/settings';
import { getTimeContext } from '../core/time-context';
import { getActiveFeed } from '../feed/feeds';
import { t } from '../core/i18n';

// Alerts on screen. A toast slides in at the top centre when something on
// the scope starts alerting (core/alerts.ts says what counts); clicking it
// selects the aircraft. Toasts go away after a few seconds, so every alert
// is also kept in a log behind a small pill in the same place, which only
// exists once there is something in it. Live mode only: scrubbing history
// would replay every emergency in the window. Sound is opt-in.

const TOAST_MS = 15_000;
const MAX_VISIBLE = 3;

function isUrgent(kind: AlertKind): boolean {
  return kind === 'emergency' || kind === 'squawk';
}

function describe(kind: AlertKind, detail: string): string {
  if (kind === 'watch') return t('misc.alert_watch');
  if (kind === 'military') return t('misc.alert_military');
  return detail;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

let audio: AudioContext | null = null;

/** Two short tones. Browsers keep audio locked until the page has been clicked; then this is silent. */
function chime(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const ctx = audio;
    const beep = (at: number, hz: number): void => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.25);
    };
    beep(ctx.currentTime, 880);
    beep(ctx.currentTime + 0.28, 660);
  } catch {
    // No audio device or no permission: the toast is the alert.
  }
}

export function mountAlerts(store: AircraftStore, onPick: (hex: string) => void): void {
  const host = document.createElement('div');
  host.className = 'toasts';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  document.body.appendChild(host);

  // ── Log: a pill, and the list it opens ──
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'toast alert-pill';
  pill.hidden = true;
  pill.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.className = 'alert-log';
  panel.hidden = true;
  const list = document.createElement('ul');
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'alert-log-clear';
  clear.textContent = t('misc.alert_clear');
  panel.append(list, clear);
  const toasts = document.createElement('div');
  toasts.className = 'toast-stack';
  host.append(pill, panel, toasts);

  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    pill.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) markAlertsRead();
  };
  pill.addEventListener('click', () => setOpen(panel.hidden));
  clear.addEventListener('click', () => {
    clearAlerts();
    setOpen(false);
  });

  const row = (e: AlertEntry): HTMLLIElement => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `alert-row alert-${e.kind}${e.active ? ' active' : ''}`;
    const onScope = store.snapshot.has(e.hex) && e.scope === getActiveFeed().name;
    b.disabled = !onScope;
    b.title = onScope ? t('misc.emergency_toast_hint') : t('misc.alert_gone');
    const time = document.createElement('span');
    time.className = 'alert-time';
    time.textContent = clock(e.atMs);
    const what = document.createElement('span');
    what.className = 'alert-what';
    what.textContent = `${e.flight} · ${describe(e.kind, e.detail)}`;
    const where = document.createElement('span');
    where.className = 'alert-where';
    where.textContent = e.scope;
    b.append(time, what, where);
    b.addEventListener('click', () => onPick(e.hex));
    li.append(b);
    return li;
  };

  const paint = (): void => {
    const log = getAlertLog();
    pill.hidden = log.length === 0;
    if (log.length === 0) panel.hidden = true;
    const unread = getUnreadAlerts();
    pill.textContent = t(log.length === 1 ? 'misc.alert_pill_one' : 'misc.alert_pill', { n: log.length });
    pill.classList.toggle('unread', unread > 0);
    pill.classList.toggle('urgent', log.some((e) => e.active && isUrgent(e.kind)));
    if (!panel.hidden) list.replaceChildren(...log.map(row));
  };
  subscribeAlerts(paint);
  pill.addEventListener('click', paint);

  // ── Toasts ──
  const show = (fire: AlertFire): void => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `toast ${isUrgent(fire.kind) ? 'toast-emergency' : 'toast-notice'}`;
    el.textContent = t('misc.emergency_toast', {
      flight: flightName(fire.aircraft),
      detail: describe(fire.kind, fire.detail),
    });
    el.title = t('misc.emergency_toast_hint');
    const dismiss = (): void => {
      el.classList.add('leaving');
      window.setTimeout(() => el.remove(), 250);
    };
    el.addEventListener('click', () => {
      onPick(fire.aircraft.hex);
      dismiss();
    });
    toasts.prepend(el);
    while (toasts.children.length > MAX_VISIBLE) toasts.lastElementChild?.remove();
    window.setTimeout(dismiss, TOAST_MS);
  };

  // ── Scanning ──
  let known = new Map<string, AlertKind>();
  // The first look at a scope does not announce what was already there.
  let quiet = true;
  let scopeName = getActiveFeed().name;
  let watchText = getSettings().alertWatchlist;
  let watch = parseWatchlist(watchText);
  let military = getSettings().alertMilitary;
  subscribeSettings(() => {
    const s = getSettings();
    if (s.alertWatchlist !== watchText) {
      watchText = s.alertWatchlist;
      watch = parseWatchlist(watchText);
    }
    // Turning the military alert on is not news about the ones already here.
    if (s.alertMilitary !== military) {
      military = s.alertMilitary;
      if (military) quiet = true;
    }
  });

  store.subscribe((snapshot) => {
    if (snapshot.size === 0) {
      known = new Map();
      quiet = true;
      syncAlertActivity(known, getActiveFeed().name);
      return;
    }
    const scope = getActiveFeed().name;
    if (scope !== scopeName) {
      scopeName = scope;
      known = new Map();
      quiet = true;
    }
    const s = getSettings();
    const { fired, active } = scanAlerts(snapshot, known, { military, watch }, quiet);
    known = active;
    quiet = false;
    if (getTimeContext().mode === 'live') {
      for (const fire of fired) {
        recordAlert(fire, scope, Date.now());
        show(fire);
      }
      if (s.alertSound && fired.some((f) => isUrgent(f.kind))) chime();
    }
    syncAlertActivity(active, scope);
  });
}
