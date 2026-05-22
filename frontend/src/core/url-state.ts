// URL deep-linking. Two channels:
//
//   #abc123    → selected aircraft (hash, replaceState'd on change)
//   ?mode=historical&from=…&to=…&t=…&rate=4
//              → time context (search params, replaceState'd)
//
// Read once on boot via the read* functions; write whenever state changes
// via replaceState so the back-button stack stays clean.

import type { HistoricalWindow, PlaybackRate, TimeContext, TimeMode } from './time-context';

const HEX_RE = /^[0-9a-f]{6}$/;
const RATES: ReadonlyArray<PlaybackRate> = [1, 4, 16, 60];

export function readSelectedHex(): string | null {
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  return HEX_RE.test(raw) ? raw : null;
}

export function writeSelectedHex(hex: string | null): void {
  const next = hex ? `#${hex}` : '';
  if (window.location.hash === next) return;
  // Use the full URL form so an empty hash actually clears the `#` rather
  // than leaving a dangling `#` that some browsers preserve.
  const base = window.location.pathname + window.location.search;
  window.history.replaceState(null, '', next ? base + next : base);
}

export interface UrlTimeState {
  mode: TimeMode;
  window: HistoricalWindow | null;
  cursorMs: number | null;
  rate: PlaybackRate;
}

export function readTimeState(): UrlTimeState | null {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  if (mode !== 'historical') return null;
  const fromMs = parseMs(params.get('from'));
  const toMs = parseMs(params.get('to'));
  if (fromMs === null || toMs === null || toMs <= fromMs) return null;
  const cursorMs = parseMs(params.get('t'));
  const rateRaw = Number(params.get('rate'));
  const rate = (RATES.includes(rateRaw as PlaybackRate) ? rateRaw : 1) as PlaybackRate;
  return {
    mode: 'historical',
    window: { startMs: fromMs, endMs: toMs },
    cursorMs: cursorMs !== null && cursorMs >= fromMs && cursorMs <= toMs ? cursorMs : null,
    rate,
  };
}

export function writeTimeState(ctx: Readonly<TimeContext>): void {
  const params = new URLSearchParams(window.location.search);
  if (ctx.mode === 'live' || !ctx.window) {
    params.delete('mode');
    params.delete('from');
    params.delete('to');
    params.delete('t');
    params.delete('rate');
  } else {
    params.set('mode', 'historical');
    params.set('from', new Date(ctx.window.startMs).toISOString());
    params.set('to', new Date(ctx.window.endMs).toISOString());
    if (ctx.cursorMs !== null) {
      params.set('t', new Date(ctx.cursorMs).toISOString());
    } else {
      params.delete('t');
    }
    if (ctx.rate !== 1) params.set('rate', String(ctx.rate));
    else params.delete('rate');
  }
  const qs = params.toString();
  const next = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
  if (window.location.pathname + window.location.search + window.location.hash === next) return;
  window.history.replaceState(null, '', next);
}

function parseMs(raw: string | null): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}
