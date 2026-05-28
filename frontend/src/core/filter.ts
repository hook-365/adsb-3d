import type { Aircraft } from './types';

// Aircraft visibility filter, applied to the list panel and the 3D scene
// in lockstep. Exposed as a singleton so the list (which mutates) and
// the reconciler (which reads each frame) don't need to be wired
// directly to each other.

export type FilterKey = 'all' | 'air' | 'ground' | 'mil' | 'emerg';

let current: FilterKey = 'all';
const listeners = new Set<(f: FilterKey) => void>();

// Free-text query, applied on top of the status FilterKey. callsigns and
// registrations come out of the normalizer as natural-case ASCII (typically
// uppercase from ADS-B feeds); hex codes are normalized to lowercase. To
// keep the per-frame reconciler path allocation-free we cache the query in
// both forms at set-time and probe each haystack with both — no toLowerCase
// per aircraft per frame.
let searchQuery = '';
let searchQueryLower = '';
let searchQueryUpper = '';
const searchListeners = new Set<(q: string) => void>();

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

export function getSearchQuery(): string {
  return searchQuery;
}

export function setSearchQuery(next: string): void {
  const trimmed = next.trim();
  if (trimmed === searchQuery) return;
  searchQuery = trimmed;
  searchQueryLower = trimmed.toLowerCase();
  searchQueryUpper = trimmed.toUpperCase();
  for (const fn of searchListeners) fn(searchQuery);
}

export function subscribeSearchQuery(fn: (q: string) => void): () => void {
  searchListeners.add(fn);
  return () => {
    searchListeners.delete(fn);
  };
}

function matchesStatus(a: Aircraft, f: FilterKey): boolean {
  switch (f) {
    case 'all': return true;
    case 'air': return !a.onGround;
    case 'ground': return a.onGround;
    case 'mil': return a.military;
    case 'emerg': return a.emergency !== null;
  }
}

export function passesFilter(a: Aircraft, f: FilterKey = current): boolean {
  if (!matchesStatus(a, f)) return false;
  if (!searchQueryLower) return true;
  // Case-insensitive substring match. Each haystack is probed with both the
  // upper- and lower-cased query so mixed-case fields still hit. Callers
  // that promote a selected aircraft past the filter (the reconciler and
  // list panel both do this) keep that aircraft visible even when it
  // doesn't match the query.
  if (a.callsign && (a.callsign.includes(searchQueryUpper) || a.callsign.includes(searchQueryLower))) return true;
  if (a.registration && (a.registration.includes(searchQueryUpper) || a.registration.includes(searchQueryLower))) return true;
  if (a.hex.includes(searchQueryLower)) return true;
  return false;
}
