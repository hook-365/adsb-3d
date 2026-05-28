import type { Aircraft } from '../core/types';
import type { HistoricalWindow } from '../core/time-context';
import { MAX_TRAIL_POINTS, type TrailPoint } from '../aircraft/store';

// Historical playback feed.
//
// Fetches every aircraft position within a time window once, then emits
// synthetic Aircraft snapshots whenever the playback cursor moves. The
// store + reconciler downstream are unchanged from live mode — they
// just see Aircraft[] arriving on each tick instead of a WebSocket diff.
//
// Per-aircraft positions are kept sorted ascending by time so cursor
// lookups can binary-search for the bracketing pair and linearly
// interpolate lat/lon/alt. Aircraft whose nearest sample is more than
// MAX_GAP_MS away from the cursor are considered offscreen.

export interface HistoricalFeedConfig {
  apiBase: string;
  /** Optional bbox to scope the bulk fetch (lat0,lon0,lat1,lon1). */
  bbox?: string | null;
  /**
   * Resolution for the bulk query. 'auto' (default) picks a bucket size
   * client-side based on the window length so the response stays a
   * few thousand rows. Pass 'full' or '<seconds>s' (e.g. '15s') to
   * override.
   */
  resolution?: string;
  /** Hard cap on aircraft loaded. Server caps at 10000. */
  maxTracks?: number;
}

export interface HistoricalFeedStatus {
  loading: boolean;
  loaded: boolean;
  errored: string | null;
  aircraftCount: number;
  cursorMs: number | null;
  visibleCount: number;
}

export type HistoricalListener = (records: Aircraft[], status: HistoricalFeedStatus) => void;
export type HistoricalStatusListener = (status: HistoricalFeedStatus) => void;

interface RawPosition {
  time?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | null;
  alt_geom?: number | null;
  flight?: string | null;
  gs?: number | null;
  track?: number | null;
  category?: string | null;
}

interface RawTrack {
  icao?: string;
  positions?: RawPosition[];
}

interface RawBulkResponse {
  tracks?: RawTrack[];
}

interface MetadataBulkResponse {
  results?: Record<string, {
    registration?: string | null;
    aircraft_type?: string | null;
    type_description?: string | null;
    owner_operator?: string | null;
    is_military?: boolean | null;
  }>;
}

/**
 * One historical position sample. Public so other layers (airway
 * density viz) can consume the same data the playback feed loads
 * instead of re-querying the backend.
 */
export interface HistoricalSample {
  ms: number;
  lat: number;
  lon: number;
  altFt: number;
  flight: string | null;
  gsKt: number | null;
  trackDeg: number | null;
  category: string | null;
}

type Sample = HistoricalSample;

interface AircraftMeta {
  registration: string | null;
  typeCode: string | null;
  description: string | null;
  operator: string | null;
  military: boolean;
}

// Aircraft is considered offscreen if the cursor is more than this far
// from its nearest position sample. Matches readsb's "stale = 60s" rule.
const MAX_GAP_MS = 60_000;

export class HistoricalFeed {
  private readonly listeners = new Set<HistoricalListener>();
  private readonly statusListeners = new Set<HistoricalStatusListener>();
  private readonly tracks = new Map<string, Sample[]>();
  private readonly metadata = new Map<string, AircraftMeta>();
  private readonly config: Required<Pick<HistoricalFeedConfig, 'apiBase' | 'resolution' | 'maxTracks'>> & { bbox: string | null };
  private window: HistoricalWindow | null = null;
  private status: HistoricalFeedStatus = {
    loading: false,
    loaded: false,
    errored: null,
    aircraftCount: 0,
    cursorMs: null,
    visibleCount: 0,
  };
  private aborter: AbortController | null = null;

  constructor(config: HistoricalFeedConfig) {
    this.config = {
      apiBase: config.apiBase,
      resolution: config.resolution ?? 'auto',
      maxTracks: config.maxTracks ?? 2000,
      bbox: config.bbox ?? null,
    };
  }

  subscribe(fn: HistoricalListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  subscribeStatus(fn: HistoricalStatusListener): () => void {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  /**
   * Load the window's data. Cursor defaults to the end of the window.
   * Caller should drive subsequent cursor changes via setCursor().
   */
  async start(window: HistoricalWindow, cursorMs?: number): Promise<void> {
    this.window = window;
    this.tracks.clear();
    this.metadata.clear();
    this.setStatus({
      loading: true,
      loaded: false,
      errored: null,
      aircraftCount: 0,
      cursorMs: cursorMs ?? window.endMs,
      visibleCount: 0,
    });

    this.aborter?.abort();
    this.aborter = new AbortController();

    try {
      const url = this.buildBulkUrl(window);
      const res = await fetch(url, { signal: this.aborter.signal, cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`bulk timelapse: HTTP ${res.status}`);
      }
      const body = (await res.json()) as RawBulkResponse;
      const tracks = body.tracks ?? [];
      for (const t of tracks) {
        const hex = t.icao?.toLowerCase();
        if (!hex || !t.positions || t.positions.length === 0) continue;
        const samples: Sample[] = [];
        for (const p of t.positions) {
          const s = parseSample(p);
          if (s) samples.push(s);
        }
        if (samples.length > 0) {
          samples.sort((a, b) => a.ms - b.ms);
          this.tracks.set(hex, samples);
        }
      }

      // Metadata: best-effort. If it fails, we still emit positional
      // aircraft with hex-only identity.
      const hexes = Array.from(this.tracks.keys());
      if (hexes.length > 0) {
        try {
          const metaRes = await fetch(`${this.config.apiBase}/aircraft/metadata/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hexes }),
            signal: this.aborter.signal,
          });
          if (metaRes.ok) {
            const metaBody = (await metaRes.json()) as MetadataBulkResponse;
            for (const [hex, m] of Object.entries(metaBody.results ?? {})) {
              this.metadata.set(hex, {
                registration: m.registration ?? null,
                typeCode: m.aircraft_type ?? null,
                description: m.type_description ?? null,
                operator: m.owner_operator ?? null,
                military: !!m.is_military,
              });
            }
          }
        } catch {
          // Metadata is non-fatal.
        }
      }

      this.setStatus({
        loading: false,
        loaded: true,
        errored: null,
        aircraftCount: this.tracks.size,
        cursorMs: this.status.cursorMs,
        visibleCount: 0,
      });
      // Emit the first frame at the requested cursor.
      this.emit(this.status.cursorMs ?? window.endMs);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      this.setStatus({
        ...this.status,
        loading: false,
        loaded: false,
        errored: (err as Error).message,
      });
    }
  }

  /**
   * Per-aircraft sample arrays for the currently-loaded window. Other
   * layers (e.g. the airway-density viz) consume this so we don't have
   * to fetch the same window twice.
   */
  getTracks(): ReadonlyMap<string, readonly HistoricalSample[]> {
    return this.tracks;
  }

  getWindow(): HistoricalWindow | null {
    return this.window;
  }

  setCursor(ms: number): void {
    if (!this.window) return;
    if (!this.status.loaded) {
      // Still loading — record the cursor; emit will fire on load.
      this.setStatus({ ...this.status, cursorMs: ms });
      return;
    }
    this.emit(ms);
  }

  stop(): void {
    this.aborter?.abort();
    this.aborter = null;
    this.tracks.clear();
    this.metadata.clear();
    this.window = null;
    this.setStatus({
      loading: false,
      loaded: false,
      errored: null,
      aircraftCount: 0,
      cursorMs: null,
      visibleCount: 0,
    });
    // Clear listener sets after the final status notification so callers
    // can react to the stopped state before being detached.
    this.listeners.clear();
    this.statusListeners.clear();
  }

  private buildBulkUrl(window: HistoricalWindow): string {
    const resolution = this.config.resolution === 'auto'
      ? autoResolution(window.endMs - window.startMs)
      : this.config.resolution;
    const params = new URLSearchParams({
      start: new Date(window.startMs).toISOString(),
      end: new Date(window.endMs).toISOString(),
      resolution,
      max_tracks: String(this.config.maxTracks),
    });
    if (this.config.bbox) params.set('bbox', this.config.bbox);
    return `${this.config.apiBase}/tracks/bulk/timelapse?${params.toString()}`;
  }

  private emit(cursorMs: number): void {
    const records: Aircraft[] = [];
    for (const [hex, samples] of this.tracks) {
      const a = this.synthAt(hex, samples, cursorMs);
      if (a) records.push(a);
    }
    this.setStatus({ ...this.status, cursorMs, visibleCount: records.length });
    for (const fn of this.listeners) fn(records, this.status);
  }

  private synthAt(hex: string, samples: Sample[], cursorMs: number): Aircraft | null {
    const result = synthSampleAt(samples, cursorMs);
    if (!result) return null;
    const { sample: chosen, interpolated } = result;
    const meta = this.metadata.get(hex);
    return {
      hex,
      callsign: chosen.flight ?? null,
      registration: meta?.registration ?? null,
      typeCode: meta?.typeCode ?? null,
      description: meta?.description ?? null,
      category: chosen.category ?? null,
      operator: meta?.operator ?? null,
      lat: chosen.lat,
      lon: chosen.lon,
      altFt: chosen.altFt,
      // Historical playback's samples have already passed through parsePoints'
      // forward-inheritance, so we know altitude here is a real value.
      altFtKnown: true,
      onGround: chosen.altFt <= 0,
      groundSpeedKt: chosen.gsKt,
      trackDeg: chosen.trackDeg,
      verticalRateFpm: null,
      military: meta?.military ?? false,
      specialInterest: false,
      privacyIcao: false,
      ladd: false,
      squawk: null,
      emergency: null,
      apAltMcpFt: null,
      apAltFmsFt: null,
      apHeadingDeg: null,
      apQnhHpa: null,
      apModes: null,
      lastSeenMs: chosen.ms,
      lastUpdateMs: interpolated ? cursorMs : chosen.ms,
    };
  }

  private setStatus(next: HistoricalFeedStatus): void {
    this.status = next;
    for (const fn of this.statusListeners) fn(next);
  }
}

/**
 * Result of locating a position at a given cursor time within a sorted
 * sample array. `interpolated` distinguishes "linearly synthesized
 * between two real samples" from "picked one of the real samples
 * verbatim" — the caller uses it to drive `lastUpdateMs` (real sample
 * time vs. cursor time).
 */
export interface SynthResult {
  sample: HistoricalSample;
  interpolated: boolean;
}

/**
 * Pure version of the playback feed's per-aircraft "where is this hex
 * at cursorMs" logic, factored out of `HistoricalFeed.synthAt` so it's
 * testable without instantiating the class or stubbing fetch. Returns
 * null when the cursor is too far from any real sample (per the
 * MAX_GAP_MS rule). Samples must be sorted ascending by ms.
 */
export function synthSampleAt(
  samples: readonly HistoricalSample[],
  cursorMs: number,
): SynthResult | null {
  if (samples.length === 0) return null;
  // Binary search for the first sample with ms >= cursor.
  let lo = 0, hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid]!.ms < cursorMs) lo = mid + 1;
    else hi = mid;
  }
  const after = lo < samples.length ? samples[lo]! : null;
  const before = lo > 0 ? samples[lo - 1]! : null;

  if (before && after && after.ms !== before.ms) {
    const span = after.ms - before.ms;
    if (span > MAX_GAP_MS * 2) {
      // Too big a gap — pick the nearer sample if it's within MAX_GAP_MS.
      const dBefore = cursorMs - before.ms;
      const dAfter = after.ms - cursorMs;
      if (dBefore <= dAfter && dBefore <= MAX_GAP_MS) return { sample: before, interpolated: false };
      if (dAfter < dBefore && dAfter <= MAX_GAP_MS) return { sample: after, interpolated: false };
      return null;
    }
    const t = (cursorMs - before.ms) / span;
    return {
      sample: {
        ms: cursorMs,
        lat: before.lat + (after.lat - before.lat) * t,
        lon: before.lon + (after.lon - before.lon) * t,
        altFt: before.altFt + (after.altFt - before.altFt) * t,
        flight: after.flight ?? before.flight,
        gsKt: pickNumeric(before.gsKt, after.gsKt, t),
        trackDeg: pickAngle(before.trackDeg, after.trackDeg, t),
        category: after.category ?? before.category,
      },
      interpolated: true,
    };
  }
  if (before) {
    if (cursorMs - before.ms > MAX_GAP_MS) return null;
    return { sample: before, interpolated: false };
  }
  if (after) {
    if (after.ms - cursorMs > MAX_GAP_MS) return null;
    return { sample: after, interpolated: false };
  }
  return null;
}

/**
 * Slice a sorted-by-ms HistoricalSample[] down to the trail points
 * with ms <= cursor. Caps the returned length at MAX_TRAIL_POINTS via
 * a pre-slice so we don't allocate multi-thousand-element arrays per
 * aircraft per cursor tick on long-window raw-resolution scrubs.
 */
export function buildTrailUpTo(
  samples: readonly HistoricalSample[],
  cursorMs: number,
): TrailPoint[] {
  if (samples.length === 0) return [];
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid]!.ms <= cursorMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return [];
  const start = Math.max(0, lo - MAX_TRAIL_POINTS);
  const out: TrailPoint[] = [];
  for (let i = start; i < lo; i++) {
    const s = samples[i]!;
    out.push({ lat: s.lat, lon: s.lon, altFt: s.altFt, ms: s.ms });
  }
  return out;
}

/**
 * Pick a server-side bucket size that keeps the response sane on long
 * windows. The track-service caps `seconds` at 3600 and accepts 'full'
 * (raw) or `<n>s`. Targets roughly 200–1500 samples per aircraft.
 */
export function autoResolution(spanMs: number): string {
  const hours = spanMs / 3_600_000;
  if (hours <= 1) return 'full';
  if (hours <= 6) return '5s';
  if (hours <= 24) return '15s';
  if (hours <= 72) return '30s';
  // 7 days at 60s → ~10k buckets max per aircraft, but realistic
  // flights produce ~200 samples each. Total response stays under
  // ~10 MB, the airway-density viz gets enough segments to glow.
  return '60s';
}

function parseSample(p: RawPosition): Sample | null {
  if (typeof p.lat !== 'number' || typeof p.lon !== 'number' || !p.time) return null;
  const ms = Date.parse(p.time);
  if (Number.isNaN(ms)) return null;
  let altFt = 0;
  if (typeof p.alt_baro === 'number') altFt = p.alt_baro;
  else if (typeof p.alt_geom === 'number') altFt = p.alt_geom;
  return {
    ms,
    lat: p.lat,
    lon: p.lon,
    altFt,
    flight: typeof p.flight === 'string' && p.flight.trim() ? p.flight.trim() : null,
    gsKt: typeof p.gs === 'number' ? p.gs : null,
    trackDeg: typeof p.track === 'number' ? p.track : null,
    category: typeof p.category === 'string' && p.category ? p.category : null,
  };
}

export function pickNumeric(a: number | null, b: number | null, t: number): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return a + (b - a) * t;
}

export function pickAngle(a: number | null, b: number | null, t: number): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  // Shortest-path interpolation across the 0/360 wrap.
  let diff = ((b - a + 540) % 360) - 180;
  return ((a + diff * t) + 360) % 360;
}
