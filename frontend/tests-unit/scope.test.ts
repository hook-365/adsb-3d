import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScope } from '../src/core/scope';

describe('createScope', () => {
  it('runs disposers in reverse registration order', () => {
    const scope = createScope();
    const order: number[] = [];
    scope.own(() => order.push(1));
    scope.own(() => order.push(2));
    scope.own(() => order.push(3));
    scope.dispose();
    expect(order).toEqual([3, 2, 1]);
  });

  it('is idempotent', () => {
    const scope = createScope();
    const dispose = vi.fn();
    scope.own(dispose);
    scope.dispose();
    scope.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(scope.disposed).toBe(true);
  });

  it('immediately releases resources registered after disposal', () => {
    const scope = createScope();
    scope.dispose();
    const dispose = vi.fn();
    scope.own(dispose);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('removes listeners registered via listen()', () => {
    const scope = createScope();
    const target = new EventTarget();
    const handler = vi.fn();
    scope.listen(target, 'ping', handler);
    target.dispatchEvent(new Event('ping'));
    expect(handler).toHaveBeenCalledTimes(1);
    scope.dispose();
    target.dispatchEvent(new Event('ping'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  describe('every()', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('clears intervals on dispose', () => {
      const scope = createScope();
      const fn = vi.fn();
      scope.every(1000, fn);
      vi.advanceTimersByTime(2500);
      expect(fn).toHaveBeenCalledTimes(2);
      scope.dispose();
      vi.advanceTimersByTime(2500);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
