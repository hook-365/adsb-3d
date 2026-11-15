// What is loading right now, for the toast at the top of the screen
// (ui/loading-toast.ts). Subscribe-pattern singleton.
//
// A layer that fetches after the user turns it on (weather, airspace, TFRs)
// calls setLoading(key, label) when it starts waiting and setLoading(key,
// null) when it has what it needs or has given up. Keys are private to the
// caller; labels are what the user reads, and equal labels collapse (the
// weather radar waits on two grids but is one thing to the user).
//
// Nothing here may stick: an entry also expires by itself, so a fetch that
// never settles cannot leave the toast up for good.

const EXPIRE_MS = 45_000;

interface Entry {
  label: string;
  timer: ReturnType<typeof setTimeout>;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

/** Mark `key` as loading under `label`, or as done with null. */
export function setLoading(key: string, label: string | null): void {
  const had = entries.get(key);
  if (label === null) {
    if (!had) return;
    clearTimeout(had.timer);
    entries.delete(key);
    notify();
    return;
  }
  // Already waiting under the same label: keep its original deadline.
  if (had?.label === label) return;
  if (had) clearTimeout(had.timer);
  entries.set(key, { label, timer: setTimeout(() => setLoading(key, null), EXPIRE_MS) });
  notify();
}

/** Distinct labels of everything loading, oldest first. */
export function getLoading(): string[] {
  return Array.from(new Set(Array.from(entries.values(), (e) => e.label)));
}

export function subscribeLoading(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
