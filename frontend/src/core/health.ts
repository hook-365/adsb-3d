// Connection-health singleton. Feed sessions report *facts* here (raw
// transport status, feeder age, historical load progress); the HUD
// subscribes and owns all wording, CSS classes, and DOM. Classification
// thresholds live here so they are unit-testable instead of buried in
// subscribe closures.
//
// The status shapes are structural (not imported from feed/) so core/
// stays dependency-free of the feed layer.

export type LiveState = 'connecting' | 'ok' | 'stale' | 'down';
export type AcarsState = 'ok' | 'stale' | 'down';

/**
 * Feeder freshness beyond which a connected track-service is considered
 * stale — the WS is up but its upstream readsb hasn't answered for a
 * while. Heartbeats fire every 5s so 30s leaves margin for hiccups.
 */
export const FEEDER_STALE_THRESHOLD_S = 30;

/**
 * ACARS hub silence threshold. ACARS is bursty, so this is far more
 * lenient than the feeder threshold.
 */
export const ACARS_STALE_THRESHOLD_S = 600;

export function classifyLive(status: {
  ok: boolean;
  feederAgeS?: number | null;
}): LiveState {
  if (!status.ok) return 'down';
  if (
    typeof status.feederAgeS === 'number' &&
    status.feederAgeS > FEEDER_STALE_THRESHOLD_S
  ) {
    return 'stale';
  }
  // Server says it has never had a successful feeder fetch.
  if (status.feederAgeS === null) return 'stale';
  return 'ok';
}

export function classifyAcars(
  status: {
    transportOk: boolean;
    hubConnected: boolean;
    hubAgeS: number | null;
  } | null,
): AcarsState {
  if (!status || !status.transportOk) return 'down';
  if (!status.hubConnected) return 'stale';
  // Connected but no message has ever arrived — hub is silent.
  if (status.hubAgeS === null) return 'stale';
  if (status.hubAgeS > ACARS_STALE_THRESHOLD_S) return 'stale';
  return 'ok';
}

/** Which feed the health data describes, for HUD labeling. */
export interface FeedIdentity {
  name: string;
  /** Multi-feed deploys prefix status strings with the feed name. */
  multi: boolean;
}

export type FeedHealth =
  | { mode: 'live'; state: LiveState; feederAgeS: number | null }
  | {
      mode: 'historical';
      state: 'loading' | 'ok' | 'error';
      visibleCount: number;
      aircraftCount: number;
    };

/** null hubAgeS = no message seen yet on this connection. */
export interface AcarsHealth {
  state: AcarsState;
  hubAgeS: number | null;
}

export interface Health {
  identity: FeedIdentity;
  feed: FeedHealth;
  /** null = ACARS unavailable or disabled — the HUD chip stays hidden. */
  acars: AcarsHealth | null;
}

let health: Health = {
  identity: { name: '', multi: false },
  feed: { mode: 'live', state: 'connecting', feederAgeS: null },
  acars: null,
};

type Listener = (h: Readonly<Health>) => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const fn of listeners) fn(health);
}

export function getHealth(): Readonly<Health> {
  return health;
}

export function subscribeHealth(fn: Listener): () => void {
  listeners.add(fn);
  fn(health);
  return () => listeners.delete(fn);
}

export function setFeedIdentity(identity: FeedIdentity): void {
  health = { ...health, identity };
  emit();
}

export function setFeedHealth(feed: FeedHealth): void {
  health = { ...health, feed };
  emit();
}

export function setAcarsHealth(acars: AcarsHealth | null): void {
  // Dedupe the null → null case: callers re-assert "no ACARS" on every
  // settings emission, which fires per-frame during XR thumbstick
  // scaling — no reason to repaint the HUD for it.
  if (acars === null && health.acars === null) return;
  health = { ...health, acars };
  emit();
}
