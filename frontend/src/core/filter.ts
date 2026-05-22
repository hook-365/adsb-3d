import type { Aircraft } from './types';

// Aircraft visibility filter, applied to the list panel and the 3D scene
// in lockstep. Exposed as a singleton so the list (which mutates) and
// the reconciler (which reads each frame) don't need to be wired
// directly to each other.

export type FilterKey = 'all' | 'air' | 'ground' | 'mil' | 'emerg';

let current: FilterKey = 'all';
const listeners = new Set<(f: FilterKey) => void>();

export function getFilter(): FilterKey {
  return current;
}

export function setFilter(next: FilterKey): void {
  if (next === current) return;
  current = next;
  for (const fn of listeners) fn(current);
}

export function subscribeFilter(fn: (f: FilterKey) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function passesFilter(a: Aircraft, f: FilterKey = current): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'air':
      return !a.onGround;
    case 'ground':
      return a.onGround;
    case 'mil':
      return a.military;
    case 'emerg':
      return a.emergency !== null;
  }
}
