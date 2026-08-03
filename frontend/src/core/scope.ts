// Disposal scope — a bag of teardown callbacks with helpers for the
// three lifetime-bound resources this app leaks when torn down by hand:
// subscribe-singleton subscriptions, DOM event listeners, and intervals.
//
// Anything with a bounded lifetime (a mounted panel, a feed session
// bundle) creates a scope at construction, registers every resource it
// acquires, and tears the whole thing down with one dispose() call.
// Disposal runs in reverse registration order so later resources that
// depend on earlier ones (e.g. a subscription reading a DOM node) come
// down before their dependencies.

export interface Scope {
  /** Register a disposer — e.g. the unsubscribe returned by a subscribeX(). */
  own(dispose: () => void): void;
  /** addEventListener whose removal is owned by this scope. */
  listen(
    target: EventTarget,
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ): void;
  /** setInterval cleared automatically on dispose. */
  every(ms: number, fn: () => void): void;
  /** True once dispose() has run. */
  readonly disposed: boolean;
  /** Run all disposers in reverse registration order. Idempotent. */
  dispose(): void;
}

export function createScope(): Scope {
  const disposers: Array<() => void> = [];
  let disposed = false;

  return {
    own(dispose: () => void): void {
      // Registering into a dead scope means the resource was acquired by
      // an async continuation that lost the race against teardown —
      // release it immediately rather than leaking it.
      if (disposed) {
        dispose();
        return;
      }
      disposers.push(dispose);
    },
    listen(target, type, handler, options): void {
      target.addEventListener(type, handler, options);
      this.own(() => target.removeEventListener(type, handler, options));
    },
    every(ms: number, fn: () => void): void {
      const id = setInterval(fn, ms);
      this.own(() => clearInterval(id));
    },
    get disposed(): boolean {
      return disposed;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (let i = disposers.length - 1; i >= 0; i--) {
        disposers[i]!();
      }
      disposers.length = 0;
    },
  };
}
