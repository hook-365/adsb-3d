// Global time context — Live vs Historical, plus playback cursor + rate.
// Singleton subscribe-store mirroring core/settings.ts. Anything that
// needs to behave differently in historical mode (feeds, ACARS UI)
// reads + subscribes here.
//
// In live mode `window` and `cursor` are null; only `mode` matters.
// In historical mode `window` defines the available range and `cursor`
// is the current playback position. `playing` advances `cursor` at
// `playbackRate` × wall-clock time.

export type TimeMode = 'live' | 'historical';
export type PlaybackRate = 1 | 4 | 16 | 60;

export interface HistoricalWindow {
  startMs: number;
  endMs: number;
}

export interface TimeContext {
  mode: TimeMode;
  window: HistoricalWindow | null;
  cursorMs: number | null;
  playing: boolean;
  rate: PlaybackRate;
  /** Heatmap overlay shown beneath aircraft in historical mode. */
  heatmap: boolean;
}

const DEFAULTS: TimeContext = {
  mode: 'live',
  window: null,
  cursorMs: null,
  playing: false,
  rate: 1,
  heatmap: false,
};

let current: TimeContext = { ...DEFAULTS };
const listeners = new Set<(ctx: Readonly<TimeContext>) => void>();

export function getTimeContext(): Readonly<TimeContext> {
  return current;
}

export function subscribeTime(fn: (ctx: Readonly<TimeContext>) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(): void {
  for (const fn of listeners) fn(current);
}

/** Switch to live mode and clear all historical state. */
export function setLive(): void {
  if (current.mode === 'live') return;
  current = { ...DEFAULTS };
  emit();
}

/**
 * Enter historical mode for the given window. Cursor starts at the end
 * of the window (= "now of the past"), playback paused. Caller is free
 * to immediately call setCursor / setPlaying afterward.
 */
export function setHistorical(window: HistoricalWindow, cursorMs?: number): void {
  const safeCursor = cursorMs ?? window.endMs;
  current = {
    mode: 'historical',
    window,
    cursorMs: clampToWindow(safeCursor, window),
    playing: false,
    rate: current.rate,
    heatmap: current.heatmap,
  };
  emit();
}

export function setCursor(ms: number): void {
  if (current.mode !== 'historical' || !current.window) return;
  const next = clampToWindow(ms, current.window);
  if (next === current.cursorMs) return;
  current = { ...current, cursorMs: next };
  emit();
}

export function setPlaying(playing: boolean): void {
  if (current.mode !== 'historical') return;
  if (current.playing === playing) return;
  // If we hit the end of the window, pressing play wraps to the start.
  if (playing && current.cursorMs !== null && current.window && current.cursorMs >= current.window.endMs) {
    current = { ...current, playing: true, cursorMs: current.window.startMs };
  } else {
    current = { ...current, playing };
  }
  emit();
}

export function setHeatmap(on: boolean): void {
  if (current.heatmap === on) return;
  current = { ...current, heatmap: on };
  emit();
}

export function setRate(rate: PlaybackRate): void {
  if (current.rate === rate) return;
  current = { ...current, rate };
  emit();
}

/**
 * Advance the cursor by wall-clock dt (ms) × current rate. No-op if
 * paused, in live mode, or already at the end. Stops playback at the
 * end of the window so the user gets a definite "stop" instead of a
 * silent loop. Returns true if the cursor changed.
 */
export function tickPlayback(dtWallMs: number): boolean {
  if (!current.playing || !current.window || current.cursorMs === null) return false;
  const next = current.cursorMs + dtWallMs * current.rate;
  if (next >= current.window.endMs) {
    current = { ...current, cursorMs: current.window.endMs, playing: false };
    emit();
    return true;
  }
  current = { ...current, cursorMs: next };
  emit();
  return true;
}

function clampToWindow(ms: number, w: HistoricalWindow): number {
  if (ms < w.startMs) return w.startMs;
  if (ms > w.endMs) return w.endMs;
  return ms;
}

/** Convenience: build a window of N hours ending now. */
export function windowEndingNow(hours: number): HistoricalWindow {
  const endMs = Date.now();
  return { startMs: endMs - hours * 3600_000, endMs };
}
