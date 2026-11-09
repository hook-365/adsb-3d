import { HOME, WEATHER3D_ENABLED, subscribeHome } from '../core/config';

// 2-D MRMS fields from weather-service (echo tops, freezing level,
// precipitation rate and type, hail, lightning): one manifest
// per home location listing every enabled product on a shared grid, and
// one uint8 grid per product. This module is the single poller; features
// subscribe to the field ids they draw and get a decoded grid with a
// bilinear sampler whenever a newer valid time lands.
//
// Packing (from the manifest): value = log ? 2^(code/scale) - 1
//                                        : code/scale + offset
// and code 0 always means "no data" (NaN from the sampler).
//
// Polling only runs while something is subscribed and the deploy has the
// sidecar (WEATHER3D_ENABLED); outside MRMS coverage the manifest says
// coverage:false and subscribers simply never hear anything.

const MANIFEST_URL = '/weather-api/fields';
const POLL_MS = 60 * 1000;
const RETRY_MS = 5 * 1000;

export interface FieldInfo {
  time: number;
  unit: string;
  scale: number;
  offset: number;
  log: boolean;
  url: string;
}

export interface FieldManifest {
  builtAt: number;
  bounds: { west: number; east: number; south: number; north: number };
  nx: number;
  ny: number;
  fields: Record<string, FieldInfo>;
}

export interface FieldGrid {
  id: string;
  time: number;
  unit: string;
  nx: number;
  ny: number;
  bounds: FieldManifest['bounds'];
  codes: Uint8Array<ArrayBuffer>;
  /** Physical value of a packed code; NaN for 0 (no data). */
  unpack(code: number): number;
  /** Nearest-cell value at a coordinate; NaN outside the grid or where empty. */
  valueAt(lat: number, lon: number): number;
  /** Nearest-cell code (0..255). -1 outside the grid. */
  codeAt(lat: number, lon: number): number;
  /** Largest value within `radiusCells` of a coordinate; NaN if none. */
  maxNear(lat: number, lon: number, radiusCells: number): number;
}

export function parseFieldManifest(json: unknown): FieldManifest | null {
  const m = json as Partial<FieldManifest> & { coverage?: unknown } | null;
  if (!m || m.coverage !== true) return null;
  const b = m.bounds;
  if (
    typeof m.nx !== 'number' || typeof m.ny !== 'number' || m.nx < 1 || m.ny < 1 ||
    !b || [b.west, b.east, b.south, b.north].some((v) => typeof v !== 'number' || !Number.isFinite(v)) ||
    !m.fields || typeof m.fields !== 'object'
  ) return null;
  const fields: Record<string, FieldInfo> = {};
  for (const [id, f] of Object.entries(m.fields)) {
    if (
      !f || typeof f.time !== 'number' || typeof f.scale !== 'number' || f.scale <= 0 ||
      typeof f.url !== 'string'
    ) continue;
    fields[id] = {
      time: f.time,
      unit: typeof f.unit === 'string' ? f.unit : '',
      scale: f.scale,
      offset: typeof f.offset === 'number' ? f.offset : 0,
      log: f.log === true,
      url: f.url,
    };
  }
  return { builtAt: typeof m.builtAt === 'number' ? m.builtAt : 0, bounds: { ...b }, nx: m.nx, ny: m.ny, fields };
}

export function makeFieldGrid(id: string, info: FieldInfo, m: FieldManifest, codes: Uint8Array<ArrayBuffer>): FieldGrid {
  const { nx, ny, bounds } = m;
  const dLon = (bounds.east - bounds.west) / nx;
  const dLat = (bounds.north - bounds.south) / ny;
  const unpack = (code: number): number => {
    if (code <= 0) return Number.NaN;
    return info.log ? Math.pow(2, code / info.scale) - 1 : code / info.scale + info.offset;
  };
  const cell = (lat: number, lon: number): number => {
    const col = Math.floor((lon - bounds.west) / dLon);
    const row = Math.floor((bounds.north - lat) / dLat);
    if (col < 0 || col >= nx || row < 0 || row >= ny) return -1;
    return row * nx + col;
  };
  return {
    id, time: info.time, unit: info.unit, nx, ny, bounds, codes, unpack,
    codeAt(lat, lon) {
      const i = cell(lat, lon);
      return i < 0 ? -1 : codes[i]!;
    },
    valueAt(lat, lon) {
      const i = cell(lat, lon);
      return i < 0 ? Number.NaN : unpack(codes[i]!);
    },
    maxNear(lat, lon, radiusCells) {
      const i = cell(lat, lon);
      if (i < 0) return Number.NaN;
      const row0 = Math.floor(i / nx);
      const col0 = i % nx;
      let best = 0;
      for (let r = Math.max(0, row0 - radiusCells); r <= Math.min(ny - 1, row0 + radiusCells); r++) {
        for (let c = Math.max(0, col0 - radiusCells); c <= Math.min(nx - 1, col0 + radiusCells); c++) {
          const v = codes[r * nx + c]!;
          if (v > best) best = v;
        }
      }
      return unpack(best);
    },
  };
}

type Listener = (grid: FieldGrid | null) => void;

const listeners = new Map<string, Set<Listener>>();
const grids = new Map<string, FieldGrid>();
let manifest: FieldManifest | null = null;
let timer: number | null = null;
let retry: number | null = null;
const loading = new Set<string>();

function emit(id: string): void {
  const grid = grids.get(id) ?? null;
  for (const fn of listeners.get(id) ?? []) fn(grid);
}

async function loadField(id: string, info: FieldInfo, m: FieldManifest): Promise<void> {
  const key = `${id}@${info.time}`;
  if (loading.has(key)) return;
  loading.add(key);
  try {
    const res = await fetch(`/weather-api${info.url}`, { cache: 'no-store' });
    if (!res.ok) return;
    const buf = new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    if (buf.length !== m.nx * m.ny) {
      console.warn('[weather-fields] size mismatch for', id, buf.length, m.nx * m.ny);
      return;
    }
    grids.set(id, makeFieldGrid(id, info, m, buf));
    emit(id);
  } catch {
    // Offline or upstream down: keep the last grid.
  } finally {
    loading.delete(key);
  }
}

async function poll(): Promise<void> {
  if (listeners.size === 0) return;
  try {
    const res = await fetch(`${MANIFEST_URL}?lat=${HOME.lat.toFixed(4)}&lon=${HOME.lon.toFixed(4)}`, { cache: 'no-store' });
    if (res.status === 503) {
      if (retry === null) retry = window.setTimeout(() => { retry = null; void poll(); }, RETRY_MS);
      return;
    }
    if (!res.ok) return;
    const next = parseFieldManifest(await res.json());
    if (!next) return;
    manifest = next;
    for (const id of listeners.keys()) {
      const info = next.fields[id];
      if (!info) continue;
      const have = grids.get(id);
      if (!have || have.time !== info.time) void loadField(id, info, next);
    }
  } catch {
    // Keep whatever we have.
  }
}

function syncPolling(): void {
  const want = WEATHER3D_ENABLED && listeners.size > 0 && typeof window !== 'undefined';
  if (want && timer === null) {
    timer = window.setInterval(() => void poll(), POLL_MS);
    void poll();
  } else if (!want && timer !== null) {
    window.clearInterval(timer);
    timer = null;
    if (retry !== null) {
      window.clearTimeout(retry);
      retry = null;
    }
  }
}

/**
 * Receive `id`'s grid now (if loaded) and whenever a newer one lands;
 * null after a feed switch drops the old crop. Returns an unsubscribe.
 */
export function subscribeField(id: string, fn: Listener): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
    // A new id while already polling: fetch it without waiting a minute.
    if (timer !== null) void poll();
  }
  set.add(fn);
  const have = grids.get(id);
  if (have) fn(have);
  syncPolling();
  return () => {
    const s = listeners.get(id);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) listeners.delete(id);
    syncPolling();
  };
}

/** The latest grid for `id`, or null. */
export function getField(id: string): FieldGrid | null {
  return grids.get(id) ?? null;
}

/** The current manifest (shared bounds/grid), or null. */
export function getFieldManifest(): FieldManifest | null {
  return manifest;
}

// Feed switch moves HOME: the old crop is the wrong patch of ground.
if (typeof window !== 'undefined') {
  subscribeHome(() => {
    manifest = null;
    const ids = Array.from(grids.keys());
    grids.clear();
    for (const id of ids) emit(id);
    if (timer !== null) void poll();
  });
}
