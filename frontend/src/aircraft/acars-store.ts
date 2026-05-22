import type { AcarsMessage } from '../feed/acars';
import type { Aircraft } from '../core/types';

// Per-aircraft ACARS message buffer. Keys are lowercase ICAO hex.
//
// The acarshub feed often emits messages with only `flight` / `reg`
// populated and no `icao` (≈100% of messages in the wild for some
// stations). We resolve those against the live aircraft store: any
// aircraft whose callsign matches `flight` (or registration matches
// `reg`) inherits the message. Messages whose aircraft hasn't appeared
// yet are parked in pending buffers and reattach the moment the plane
// shows up in the feed (resolveAcarsPending, called per store snapshot).

const MAX_PER_AIRCRAFT = 12;
// Keep the pending buffers from growing unbounded if the receiver hears
// flights it never sees on ADS-B (e.g. high-altitude jets out of range).
const MAX_PER_PENDING_KEY = 8;
// Global recent-messages cap — sized for the ACARS browser modal.
const MAX_RECENT = 500;

const messages = new Map<string, AcarsMessage[]>();
const pendingByFlight = new Map<string, AcarsMessage[]>();
const pendingByReg = new Map<string, AcarsMessage[]>();
const recent: AcarsMessage[] = [];
const listeners = new Set<(hex: string) => void>();
const recentListeners = new Set<() => void>();

function isDup(list: readonly AcarsMessage[], msg: AcarsMessage): boolean {
  return list.some((m) => m.time === msg.time && m.label === msg.label && m.text === msg.text);
}

function addToRecent(msg: AcarsMessage): void {
  if (isDup(recent.slice(0, 16), msg)) return; // cheap recent-dup check
  recent.unshift(msg);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  for (const fn of recentListeners) fn();
}

function addToHex(hex: string, msg: AcarsMessage): void {
  const existing = messages.get(hex) ?? [];
  if (isDup(existing, msg)) return;
  // Newest-first.
  const next = [msg, ...existing];
  if (next.length > MAX_PER_AIRCRAFT) next.length = MAX_PER_AIRCRAFT;
  messages.set(hex, next);
  for (const fn of listeners) fn(hex);
}

function pushPending(map: Map<string, AcarsMessage[]>, key: string, msg: AcarsMessage): void {
  const list = map.get(key) ?? [];
  if (isDup(list, msg)) return;
  list.unshift(msg);
  if (list.length > MAX_PER_PENDING_KEY) list.length = MAX_PER_PENDING_KEY;
  map.set(key, list);
}

export function getAcarsMessages(hex: string): readonly AcarsMessage[] {
  return messages.get(hex.toLowerCase()) ?? [];
}

export function hasAcars(hex: string): boolean {
  const list = messages.get(hex.toLowerCase());
  return !!list && list.length > 0;
}

export function addAcarsMessage(msg: AcarsMessage): void {
  // Always feed the global recent buffer — the browser modal renders
  // every message regardless of whether we can bind it to an aircraft.
  addToRecent(msg);
  if (msg.icao) {
    addToHex(msg.icao, msg);
    return;
  }
  // No hex on the message itself — park it under flight/reg until an
  // aircraft we know about claims it. Both keys are written so the
  // resolver finds a match either way.
  if (msg.flight) pushPending(pendingByFlight, msg.flight, msg);
  if (msg.reg) pushPending(pendingByReg, msg.reg, msg);
}

/**
 * Walk the live aircraft snapshot and reattach any pending messages
 * whose flight/reg now matches a known aircraft. Cheap to call every
 * 1 Hz store update because pending maps are usually empty after a
 * few ticks; aircraft set is bounded.
 */
export function resolveAcarsPending(snapshot: ReadonlyMap<string, Aircraft>): void {
  if (pendingByFlight.size === 0 && pendingByReg.size === 0) return;
  for (const a of snapshot.values()) {
    const fromFlight = a.callsign ? pendingByFlight.get(a.callsign) : null;
    const fromReg = a.registration ? pendingByReg.get(a.registration) : null;
    if (!fromFlight && !fromReg) continue;
    const merged: AcarsMessage[] = [];
    if (fromFlight) merged.push(...fromFlight);
    if (fromReg) {
      for (const m of fromReg) if (!isDup(merged, m)) merged.push(m);
    }
    for (const m of merged) {
      addToHex(a.hex, { ...m, icao: a.hex });
    }
    if (a.callsign) pendingByFlight.delete(a.callsign);
    if (a.registration) pendingByReg.delete(a.registration);
  }
}

/** Drop everything. Used on feed switch. */
export function clearAcars(): void {
  messages.clear();
  pendingByFlight.clear();
  pendingByReg.clear();
  recent.length = 0;
  for (const fn of listeners) fn('');
  for (const fn of recentListeners) fn();
}

/** Subscribe to per-hex change notifications. The argument is the hex that changed (or '' on clear). */
export function subscribeAcars(fn: (hex: string) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Most recent ACARS messages across all aircraft, newest-first, capped at 500. */
export function getRecentAcars(): readonly AcarsMessage[] {
  return recent;
}

export function subscribeRecentAcars(fn: () => void): () => void {
  recentListeners.add(fn);
  return () => {
    recentListeners.delete(fn);
  };
}

// ────────────────────────────────────────────────────────────────────
// Derived per-aircraft summary: latest known destination/ETA + flight
// phase from OOOI timestamps. Computed on demand from the buffered
// messages so it stays consistent with whatever's currently in the
// store. Cheap because MAX_PER_AIRCRAFT is small.

export type AcarsPhase = 'at-gate' | 'taxi-out' | 'airborne' | 'taxi-in' | 'at-gate-dest';

export interface AcarsSummary {
  /** Latest non-null destination from any message. */
  destination: string | null;
  /** Latest non-null ETA. Raw acarshub string (e.g. "1842"). */
  eta: string | null;
  /** Inferred current flight phase from OOOI events, newest event wins. */
  phase: AcarsPhase | null;
  /** Time of the OOOI event that decided `phase`, ISO from the message. */
  phaseAt: string | null;
}

// 6h freshness window — drops stale OOOI from a previous leg of the
// same aircraft so a turnaround flight doesn't show "at arrival gate"
// once it's airborne again.
const PHASE_STALE_MS = 6 * 60 * 60 * 1000;

export function getAcarsSummary(hex: string): AcarsSummary | null {
  const list = messages.get(hex.toLowerCase());
  if (!list || list.length === 0) return null;

  let destination: string | null = null;
  let eta: string | null = null;
  // Pick the newest message that carries each kind of OOOI event.
  // List is newest-first so first hit wins.
  let phase: AcarsPhase | null = null;
  let phaseAt: string | null = null;
  let phaseRank = -1; // higher rank = later in the OOOI sequence
  const now = Date.now();
  const rankFor: Record<AcarsPhase, number> = {
    'taxi-out': 0,
    'airborne': 1,
    'taxi-in': 2,
    'at-gate-dest': 3,
    'at-gate': -1, // unused — no OOOI maps to plain at-gate
  };

  for (const m of list) {
    if (!destination && m.destination) destination = m.destination;
    if (!eta && m.eta) eta = m.eta;

    const t = Date.parse(m.time);
    if (Number.isNaN(t) || now - t > PHASE_STALE_MS) continue;

    let candidate: AcarsPhase | null = null;
    if (m.gtin) candidate = 'at-gate-dest';
    else if (m.wlin) candidate = 'taxi-in';
    else if (m.wloff) candidate = 'airborne';
    else if (m.gtout) candidate = 'taxi-out';
    if (!candidate) continue;

    const r = rankFor[candidate];
    if (r > phaseRank) {
      phaseRank = r;
      phase = candidate;
      phaseAt = m.time;
    }
  }

  if (!destination && !eta && !phase) return null;
  return { destination, eta, phase, phaseAt };
}
