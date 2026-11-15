import indexUrl from './procedures-index.json?url';
import packUrl from './procedures.pack?url';
import { t } from '../core/i18n';
import { setLoading } from '../core/loading';
import {
  bearing,
  distanceNm,
  finalPath,
  type FinalLeg,
  type PathPoint,
  type Segment,
} from './procedure-geometry';

// Published instrument procedures (US): the data side.
//
// Two generated files, both written by scripts/build-procedures.py from the
// FAA's CIFP (do not hand-edit; regenerate each 28-day cycle):
//
//   procedures-index.json  fetched once, when approaches are first shown.
//       Per airport: the final segment of each runway approach, the names
//       of all its procedures, its magnetic variation, and where its full
//       detail sits in the pack. Also the edition's cycle and dates.
//   procedures.pack        every airport's complete procedures, one gzipped
//       JSON chunk each, end to end. Only the clicked airport's bytes are
//       fetched (an HTTP range request) and unpacked in the browser.
//
// The FAA does not copyright the CIFP and provides it as is. Nothing here
// is for navigation, and the data goes out of date every 28 days: the
// edition's dates travel with it so the UI can say so.
//
// Everything above the loader is pure.

export type ProcedureKind = 'approach' | 'star' | 'sid';

export interface FinalApproach {
  /** Procedure identifier as coded: 'I12R', 'R30LZ', 'H35-Y'. */
  id: string;
  /** Runway end it serves, 'RW12R', or '' for a circling approach. */
  rw: string;
  /** Published vertical angle, degrees (negative), when coded. */
  va: number | null;
  legs: FinalLeg[];
}

export interface AirportProcedures {
  /** Magnetic variation, east positive. */
  v: number;
  /** Offset and length of the airport's chunk in the pack. */
  o: number;
  n: number;
  /** Approach, STAR and SID identifiers. */
  a: string[];
  s: string[];
  d: string[];
  f: FinalApproach[];
}

export interface ProcedureIndex {
  cycle: string;
  /** ISO dates: first day of the edition and the first day it is superseded. */
  effective: string;
  expires: string;
  airports: Record<string, AirportProcedures>;
}

/** An airport's full procedures, as unpacked from the pack. */
export type AirportDetail = Partial<Record<ProcedureKind, Record<string, Segment[]>>>;

const APPROACH_TYPES: Readonly<Record<string, string>> = {
  B: 'LOC BC',
  D: 'VOR/DME',
  F: 'FMS',
  G: 'IGS',
  H: 'RNAV (RNP)',
  I: 'ILS',
  J: 'GLS',
  L: 'LOC',
  M: 'MLS',
  N: 'NDB',
  P: 'GPS',
  Q: 'NDB/DME',
  R: 'RNAV (GPS)',
  S: 'VOR',
  T: 'TACAN',
  U: 'SDF',
  V: 'VOR',
  X: 'LDA',
};
/** Which approach to draw on a runway end when it has several: best guidance first. */
const PREFERENCE = 'IHRJLXBSVDNQPTUFGM';

/**
 * "ILS 12R", "RNAV (GPS) Z 30L", "RNAV (RNP) Y 35", "VOR-A". Aviation
 * shorthand, not translated.
 */
export function approachName(id: string): string {
  const type = APPROACH_TYPES[id[0] ?? ''] ?? id[0] ?? '';
  const rest = id.slice(1);
  const runway = /^(\d{2}[LRC]?)(?:-?([A-Z]))?$/.exec(rest);
  if (runway) return runway[2] ? `${type} ${runway[2]} ${runway[1]}` : `${type} ${runway[1]}`;
  // Circling approaches are coded like 'VDM-A': type, a navaid, a letter.
  const circling = /-([A-Z])$/.exec(rest);
  return circling ? `${type}-${circling[1]}` : `${type} ${rest}`.trim();
}

/** Runway an approach identifier names ('12R'), or '' for a circling one. */
export function approachRunway(id: string): string {
  return /^.(\d{2}[LRC]?)(?:-?[A-Z])?$/.exec(id)?.[1] ?? '';
}

/** "BAINY4" → "BAINY FOUR" is how it is spoken; the chart prints "BAINY4": keep that. */
export function procedureName(kind: ProcedureKind, id: string): string {
  return kind === 'approach' ? approachName(id) : id;
}

/** One final per runway end: the approach with the best guidance. */
export function bestFinals(finals: readonly FinalApproach[]): FinalApproach[] {
  const best = new Map<string, FinalApproach>();
  const rank = (f: FinalApproach): number => {
    const i = PREFERENCE.indexOf(f.id[0] ?? '');
    return i < 0 ? PREFERENCE.length : i;
  };
  for (const f of finals) {
    if (!f.rw) continue;
    const have = best.get(f.rw);
    // Among equals ('R30LZ' and 'R30LY'), the later letter is the primary one.
    if (!have || rank(f) < rank(have) || (rank(f) === rank(have) && f.id > have.id)) best.set(f.rw, f);
  }
  return Array.from(best.values());
}

export interface TrafficSample {
  lat: number;
  lon: number;
  altFt: number;
  onGround: boolean;
  trackDeg: number | null;
  verticalRateFpm: number | null;
}

const IN_USE_RANGE_NM = 12;
const IN_USE_TRACK_DEG = 15;
const IN_USE_OFFSET_NM = 1;
/** Above the threshold by more than this, an aircraft is passing over, not landing. */
const IN_USE_MAX_ABOVE_FT = 5000;

/**
 * Is anyone flying this final right now? True when an aircraft is on the
 * approach side of the threshold within 12 NM, within a mile of the final
 * course, tracking within 15 degrees of it, not climbing, and low enough to
 * be landing.
 */
export function finalInUse(final: readonly PathPoint[], traffic: Iterable<TrafficSample>): boolean {
  if (final.length < 2) return false;
  const end = final[final.length - 1]!;
  const before = final[final.length - 2]!;
  const course = bearing(before.lat, before.lon, end.lat, end.lon);
  const floor = end.altFt ?? 0;
  for (const a of traffic) {
    if (a.onGround || a.trackDeg === null) continue;
    if (a.altFt - floor > IN_USE_MAX_ABOVE_FT) continue;
    if (a.verticalRateFpm !== null && a.verticalRateFpm > 300) continue;
    const d = distanceNm(a.lat, a.lon, end.lat, end.lon);
    if (d > IN_USE_RANGE_NM) continue;
    const turn = Math.abs(((a.trackDeg - course + 540) % 360) - 180);
    if (turn > IN_USE_TRACK_DEG) continue;
    // Bearing from the aircraft to the threshold against the final course
    // gives how far off the centreline it is, and that it is still inbound.
    const off = (((bearing(a.lat, a.lon, end.lat, end.lon) - course + 540) % 360) - 180) * (Math.PI / 180);
    if (Math.cos(off) <= 0) continue;
    if (Math.abs(Math.sin(off)) * d <= IN_USE_OFFSET_NM) return true;
  }
  return false;
}

/** Days until the edition is superseded; negative once it is out of date. */
export function daysLeft(index: Pick<ProcedureIndex, 'expires'>, now = Date.now()): number {
  return Math.floor((Date.parse(`${index.expires}T00:00:00Z`) - now) / 86_400_000);
}

/** Parse the index; null when it does not look like one. */
export function decodeIndex(raw: unknown): ProcedureIndex | null {
  const doc = raw as Partial<ProcedureIndex> | null;
  if (!doc || typeof doc.cycle !== 'string' || typeof doc.expires !== 'string' || !doc.airports || typeof doc.airports !== 'object') {
    return null;
  }
  return doc as ProcedureIndex;
}

// ── Loader ──────────────────────────────────────────────────────────

let index: ProcedureIndex | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const details = new Map<string, Promise<AirportDetail | null>>();

export function getProcedureIndex(): ProcedureIndex | null {
  return index;
}

export function subscribeProcedures(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Fetch the index once; a failure leaves it null and is retried on the next call. */
export function loadProcedureIndex(): Promise<void> {
  if (index) return Promise.resolve();
  if (!loading) {
    setLoading('procedures', t('settings.airport_approaches'));
    loading = fetch(indexUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`procedure index: HTTP ${res.status}`);
        return res.json() as Promise<unknown>;
      })
      .then((raw) => {
        index = decodeIndex(raw);
        if (!index) throw new Error('procedure index: unexpected shape');
        for (const fn of listeners) fn();
      })
      .catch((err: unknown) => {
        console.warn('[procedures] could not load the index', err);
        loading = null;
      })
      .finally(() => setLoading('procedures', null));
  }
  return loading;
}

/**
 * One airport's complete procedures: a range request for its chunk of the
 * pack, unpacked here. Null when the airport has none or the fetch fails.
 */
export function loadAirportDetail(icao: string): Promise<AirportDetail | null> {
  const entry = index?.airports[icao];
  if (!entry) return Promise.resolve(null);
  let pending = details.get(icao);
  if (!pending) {
    pending = (async (): Promise<AirportDetail | null> => {
      const res = await fetch(packUrl, { headers: { Range: `bytes=${entry.o}-${entry.o + entry.n - 1}` } });
      // 206 is the slice asked for. A server that ignores ranges answers 200
      // with the whole pack: still usable, just the long way round.
      if (res.status !== 206 && res.status !== 200) throw new Error(`procedure pack: HTTP ${res.status}`);
      let bytes = new Uint8Array(await res.arrayBuffer());
      if (res.status === 200) bytes = bytes.subarray(entry.o, entry.o + entry.n);
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return JSON.parse(await new Response(stream).text()) as AirportDetail;
    })().catch((err: unknown) => {
      console.warn('[procedures] could not load', icao, err);
      details.delete(icao);
      return null;
    });
    details.set(icao, pending);
  }
  return pending;
}

/** The finals to draw at an airport, with their points. Empty when it has no published approaches. */
export function finalsAt(icao: string): { final: FinalApproach; points: PathPoint[] }[] {
  const entry = index?.airports[icao];
  if (!entry) return [];
  return bestFinals(entry.f).map((final) => ({ final, points: finalPath(final.legs) }));
}

/** Whether the FAA publishes anything for this airport (so the generic approach line should stand down). */
export function hasProcedures(icao: string): boolean {
  return index?.airports[icao] !== undefined;
}
