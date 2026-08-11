import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setCursor,
  setHistorical,
  setLive,
  setPlaying,
  setRate,
  subscribeTime,
  tickPlayback,
  getTimeContext,
} from '../src/core/time-context';

// Reset the module-level singleton before each test so state doesn't leak
// across cases (mirrors store.test.ts's afterEach reset pattern).
beforeEach(() => {
  setHistorical({ startMs: 0, endMs: 1000 });
  setLive();
});

describe('setHistorical', () => {
  it('defaults cursor to endMs when omitted', () => {
    setHistorical({ startMs: 1000, endMs: 5000 });
    expect(getTimeContext().cursorMs).toBe(5000);
  });

  it('clamps an out-of-range cursor into the window', () => {
    setHistorical({ startMs: 1000, endMs: 5000 }, 9000);
    expect(getTimeContext().cursorMs).toBe(5000);
    setHistorical({ startMs: 1000, endMs: 5000 }, -1);
    expect(getTimeContext().cursorMs).toBe(1000);
  });

  it('always forces playing:false', () => {
    setHistorical({ startMs: 1000, endMs: 5000 });
    setPlaying(true);
    expect(getTimeContext().playing).toBe(true);
    setHistorical({ startMs: 1000, endMs: 6000 });
    expect(getTimeContext().playing).toBe(false);
  });
});

describe('setLive', () => {
  it('resets to defaults', () => {
    setHistorical({ startMs: 1000, endMs: 5000 }, 3000);
    setLive();
    const ctx = getTimeContext();
    expect(ctx.mode).toBe('live');
    expect(ctx.window).toBeNull();
    expect(ctx.cursorMs).toBeNull();
    expect(ctx.playing).toBe(false);
  });

  it('does not emit when already live', () => {
    setLive();
    const spy = vi.fn();
    subscribeTime(spy);
    setLive();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('setCursor', () => {
  it('clamps both ends of the window', () => {
    setHistorical({ startMs: 1000, endMs: 5000 });
    setCursor(9000);
    expect(getTimeContext().cursorMs).toBe(5000);
    setCursor(-100);
    expect(getTimeContext().cursorMs).toBe(1000);
  });

  it('is a no-op in live mode', () => {
    setLive();
    setCursor(500);
    expect(getTimeContext().cursorMs).toBeNull();
  });

  it('does not emit when the clamped value is unchanged', () => {
    setHistorical({ startMs: 1000, endMs: 5000 }, 5000);
    const spy = vi.fn();
    subscribeTime(spy);
    setCursor(9000); // clamps to 5000, same as current
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('setPlaying', () => {
  it('wraps to startMs when pressed at cursor >= endMs', () => {
    setHistorical({ startMs: 1000, endMs: 5000 }, 5000);
    setPlaying(true);
    const ctx = getTimeContext();
    expect(ctx.playing).toBe(true);
    expect(ctx.cursorMs).toBe(1000);
  });

  it('does not wrap when cursor is mid-window', () => {
    setHistorical({ startMs: 1000, endMs: 5000 }, 3000);
    setPlaying(true);
    expect(getTimeContext().cursorMs).toBe(3000);
  });
});

describe('tickPlayback', () => {
  it('returns false when paused', () => {
    setHistorical({ startMs: 1000, endMs: 5000 }, 2000);
    expect(tickPlayback(500)).toBe(false);
  });

  it('returns false in live mode', () => {
    setLive();
    expect(tickPlayback(500)).toBe(false);
  });

  it('advances dt*rate', () => {
    setHistorical({ startMs: 0, endMs: 10000 }, 1000);
    setRate(4);
    setPlaying(true);
    tickPlayback(500);
    expect(getTimeContext().cursorMs).toBe(1000 + 500 * 4);
  });

  it('clamps at endMs and flips playing false', () => {
    setHistorical({ startMs: 0, endMs: 10000 }, 9000);
    setPlaying(true);
    tickPlayback(5000);
    const ctx = getTimeContext();
    expect(ctx.cursorMs).toBe(10000);
    expect(ctx.playing).toBe(false);
  });

  it('emits once per change', () => {
    setHistorical({ startMs: 0, endMs: 10000 }, 1000);
    setPlaying(true);
    const spy = vi.fn();
    subscribeTime(spy);
    tickPlayback(500);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('unsubscribe', () => {
  it('stops callbacks after unsubscribing', () => {
    setHistorical({ startMs: 0, endMs: 10000 }, 1000);
    const spy = vi.fn();
    const unsub = subscribeTime(spy);
    setCursor(2000);
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
    setCursor(3000);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
