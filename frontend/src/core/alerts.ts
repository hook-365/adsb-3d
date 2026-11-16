import type { Aircraft } from './types';

// Alerts: things on the scope worth a tap on the shoulder. An aircraft
// declaring an emergency (squawk 7500 / 7600 / 7700 or the transponder's
// emergency field), two other squawks with a fixed meaning (7400, 7777),
// anything on the user's watchlist, and, if asked for, military aircraft.
//
// This module is the pure part and the log. ui/alerts.ts scans the store
// with it, shows the toasts and draws the log.

export type AlertKind = 'emergency' | 'squawk' | 'watch' | 'military';

/** Most urgent first. An aircraft alerts once, as the most urgent thing it is. */
const RANK: Record<AlertKind, number> = { emergency: 0, squawk: 1, watch: 2, military: 3 };

/** Squawks that are not an emergency but mean one specific thing. */
const NOTABLE_SQUAWKS: Record<string, string> = {
  '7400': 'unmanned, lost link (7400)',
  '7777': 'military intercept (7777)',
};

export interface AlertRules {
  military: boolean;
  /** From parseWatchlist(). */
  watch: readonly string[];
}

export interface AlertHit {
  kind: AlertKind;
  /** Aviation wording, shown as is. Empty for watch and military: the UI names those. */
  detail: string;
}

/**
 * Pure: watchlist text to match tokens. Callsigns, registrations or hex
 * codes separated by commas or spaces; case and dashes are ignored, and a
 * trailing * matches any ending ("RCH*").
 */
export function parseWatchlist(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/[\s,;]+/)) {
    const star = raw.endsWith('*');
    const token = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (token.length >= 2) out.add(star ? `${token}*` : token);
  }
  return [...out];
}

function tidy(s: string | null | undefined): string {
  return s ? s.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

export function matchesWatch(a: Aircraft, watch: readonly string[]): boolean {
  if (watch.length === 0) return false;
  const ids = [tidy(a.callsign), tidy(a.registration), tidy(a.hex)].filter((s) => s.length > 0);
  for (const token of watch) {
    if (token.endsWith('*')) {
      const stem = token.slice(0, -1);
      if (ids.some((id) => id.startsWith(stem))) return true;
    } else if (ids.includes(token)) {
      return true;
    }
  }
  return false;
}

/** Pure: what, if anything, this aircraft alerts as. */
export function alertFor(a: Aircraft, rules: AlertRules): AlertHit | null {
  if (a.emergency !== null) return { kind: 'emergency', detail: a.emergency };
  const notable = a.squawk ? NOTABLE_SQUAWKS[a.squawk] : undefined;
  if (notable) return { kind: 'squawk', detail: notable };
  if (matchesWatch(a, rules.watch)) return { kind: 'watch', detail: '' };
  if (rules.military && a.military) return { kind: 'military', detail: '' };
  return null;
}

export interface AlertFire extends AlertHit {
  aircraft: Aircraft;
}

/**
 * Pure: one pass over the scope. An aircraft fires when it starts
 * alerting, or when it becomes something more urgent than it was; it does
 * not fire again while that lasts, and can fire again once it has cleared.
 *
 * `quiet` is for the first look at a scope (page load, feed switch, the
 * feed coming back): everything on it is "new" then, and a toast for each
 * of forty military aircraft is noise. Watchlist and military hits are
 * recorded without firing; emergencies and notable squawks still fire.
 */
export function scanAlerts(
  snapshot: ReadonlyMap<string, Aircraft>,
  prev: ReadonlyMap<string, AlertKind>,
  rules: AlertRules,
  quiet: boolean,
): { fired: AlertFire[]; active: Map<string, AlertKind> } {
  const active = new Map<string, AlertKind>();
  const fired: AlertFire[] = [];
  for (const a of snapshot.values()) {
    const hit = alertFor(a, rules);
    if (!hit) continue;
    active.set(a.hex, hit.kind);
    const was = prev.get(a.hex);
    if (was !== undefined && RANK[was] <= RANK[hit.kind]) continue;
    if (quiet && RANK[hit.kind] >= RANK.watch) continue;
    fired.push({ aircraft: a, ...hit });
  }
  return { fired, active };
}

export function flightName(a: Aircraft): string {
  return a.callsign ?? a.registration ?? a.hex.toUpperCase();
}

// ── The log ─────────────────────────────────────────────────────────

export interface AlertEntry {
  id: number;
  kind: AlertKind;
  hex: string;
  flight: string;
  detail: string;
  atMs: number;
  /** Name of the scope it was seen on. */
  scope: string;
  /** Still alerting on the scope being watched. */
  active: boolean;
}

const MAX_LOG = 50;
let log: AlertEntry[] = [];
let unread = 0;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** Newest first. */
export function getAlertLog(): readonly AlertEntry[] {
  return log;
}

export function getUnreadAlerts(): number {
  return unread;
}

export function subscribeAlerts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function recordAlert(fire: AlertFire, scope: string, atMs: number): AlertEntry {
  const entry: AlertEntry = {
    id: nextId++,
    kind: fire.kind,
    hex: fire.aircraft.hex,
    flight: flightName(fire.aircraft),
    detail: fire.detail,
    atMs,
    scope,
    active: true,
  };
  log = [entry, ...log].slice(0, MAX_LOG);
  unread++;
  emit();
  return entry;
}

/** Refresh each entry's "still alerting" mark against the current scope. */
export function syncAlertActivity(active: ReadonlyMap<string, AlertKind>, scope: string): void {
  let changed = false;
  const seen = new Set<string>();
  log = log.map((e) => {
    // Only the newest entry for an aircraft can be the live one.
    const live = !seen.has(e.hex) && e.scope === scope && active.get(e.hex) === e.kind;
    seen.add(e.hex);
    if (live === e.active) return e;
    changed = true;
    return { ...e, active: live };
  });
  if (changed) emit();
}

export function markAlertsRead(): void {
  if (unread === 0) return;
  unread = 0;
  emit();
}

export function clearAlerts(): void {
  if (log.length === 0 && unread === 0) return;
  log = [];
  unread = 0;
  emit();
}
