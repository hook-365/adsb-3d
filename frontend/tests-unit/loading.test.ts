import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLoading, setLoading, subscribeLoading } from '../src/core/loading';

afterEach(() => {
  for (const key of ['a', 'b', 'c']) setLoading(key, null);
  vi.useRealTimers();
});

describe('loading registry', () => {
  it('lists what is loading and forgets it when done', () => {
    setLoading('a', '3D storms');
    setLoading('b', 'Lightning');
    expect(getLoading()).toEqual(['3D storms', 'Lightning']);
    setLoading('a', null);
    expect(getLoading()).toEqual(['Lightning']);
  });

  it('shows one label for several things the user sees as one', () => {
    setLoading('a', 'Weather radar');
    setLoading('b', 'Weather radar');
    expect(getLoading()).toEqual(['Weather radar']);
    setLoading('a', null);
    expect(getLoading()).toEqual(['Weather radar']);
    setLoading('b', null);
    expect(getLoading()).toEqual([]);
  });

  it('notifies on change only', () => {
    const fn = vi.fn();
    const off = subscribeLoading(fn);
    setLoading('a', 'Airspace');
    setLoading('a', 'Airspace');
    setLoading('c', null);
    expect(fn).toHaveBeenCalledTimes(1);
    setLoading('a', null);
    expect(fn).toHaveBeenCalledTimes(2);
    off();
  });

  it('lets nothing stick: an entry expires by itself', () => {
    vi.useFakeTimers();
    setLoading('a', '3D storms');
    vi.advanceTimersByTime(44_000);
    // Re-marking the same wait must not push the deadline out.
    setLoading('a', '3D storms');
    vi.advanceTimersByTime(2_000);
    expect(getLoading()).toEqual([]);
  });
});
