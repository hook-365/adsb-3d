import type { TrailPoint } from '../aircraft/store';
import type { Aircraft } from '../core/types';
import { getAirports, loadAirports, type Airport } from '../feed/explore-airports';
import type { RouteInfo } from '../feed/routes';
import { approachPath, loadRunways, runwaysOf, subscribeRunways, type Runway } from './airports';
import { bearing, distanceNm, type PathPoint, type ProcedureFix } from './procedure-geometry';
import { procedureParts } from './procedure-layer';
import {
  approachRunway,
  bestFinals,
  finalFit,
  getProcedureIndex,
  loadAirportDetail,
  loadProcedureIndex,
  subscribeProcedures,
  type ProcedureIndex,
} from './procedures';
import { finalPath } from './procedure-geometry';
import { getRefuelTracks, loadRefuelTracks, subscribeRefuelTracks, type RefuelTrack } from './refueling';

// What is this aircraft doing? Worked out for the selected aircraft from
// what the app already knows: its position, track and vertical rate, its
// trail, its scheduled route, the runways, and (US) the published
// procedures and air refueling tracks. The answer is an inference from traffic data, never a
// clearance: "final for runway 12R" means it is lined up and descending
// there, and "BAINY4 arrival" that its track lies along that procedure.
//
// Everything above the loader is pure.

export type Activity =
  | { kind: 'parked' | 'taxi'; icao: string | null }
  | { kind: 'runway'; icao: string; runway: string }
  | { kind: 'landing'; icao: string }
  | { kind: 'final'; icao: string; runway: string; nm: number }
  | { kind: 'star' | 'sid'; icao: string; id: string; next: string | null }
  | { kind: 'refuel'; track: string; with: string | null }
  | { kind: 'holding' }
  | { kind: 'departing'; icao: string }
  | { kind: 'arriving'; icao: string; nm: number }
  | { kind: 'cruise' | 'climb' | 'descent' | 'level' };

/** One arrival or departure, as polylines to match a track against. */
export interface ProcedureCandidate {
  kind: 'star' | 'sid';
  icao: string;
  id: string;
  paths: PathPoint[][];
  fixes: ProcedureFix[];
}

const GROUND_AIRPORT_NM = 4;
const ROLL_KT = 40;
const TAXI_KT = 3;
/** Half width of the strip a rolling aircraft must be inside, NM (a little wider than any runway). */
const RUNWAY_HALF_NM = 0.04;
const FINAL_SEARCH_DEG = 0.25;
const HOLD_WINDOW_MS = 8 * 60_000;
const HOLD_TURN_DEG = 300;
/** Trail points closer together than this say nothing reliable about direction, NM. */
const HOLD_MIN_STEP_NM = 0.15;
const PROCEDURE_CROSS_NM = 1.5;
const PROCEDURE_TRACK_DEG = 25;
/** Trail points sampled to tell apart procedures that share a leg. */
const PROCEDURE_HISTORY = 8;
const PROCEDURE_HISTORY_MS = 12 * 60_000;
const STAR_RANGE_NM = 250;
const SID_RANGE_NM = 100;
/** Half width of the corridor along a refueling track's centreline, NM. */
const REFUEL_CROSS_NM = 4;
const REFUEL_TRACK_DEG = 30;
const REFUEL_WINDOW_MS = 6 * 60_000;
/** Ground covered inside the corridor before it counts: more than any crossing of it. */
const REFUEL_MIN_RUN_NM = 20;
const REFUEL_HISTORY = 8;
/** Two aircraft this close, level with each other and going the same way are flying together. */
const FORMATION_NM = 1.5;
const FORMATION_ALT_FT = 1000;
const FORMATION_TRACK_DEG = 20;
const FORMATION_SPEED_KT = 50;
const VERTICAL_FPM = 300;
/** Airborne this low and this close to a field, and not climbing, is the last seconds of a landing. */
const LANDING_ABOVE_FT = 600;
const LANDING_NM = 2.5;
/** A trail that begins this near a field and this low began with a take-off there. */
const DEPARTED_NM = 3;
const DEPARTED_ABOVE_FT = 1500;
const DEPARTING_RANGE_NM = 40;
const ARRIVING_RANGE_NM = 150;
const ARRIVING_LEVEL_NM = 40;
const CRUISE_FT = 18_000;

function turnBetween(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

/** Nearest airport within `maxNm`, with its distance. */
export function nearestAirport(
  lat: number,
  lon: number,
  airports: readonly Airport[],
  maxNm: number,
): { airport: Airport; nm: number } | null {
  const box = maxNm / 60;
  let best: { airport: Airport; nm: number } | null = null;
  for (const airport of airports) {
    const p = airport.place;
    if (Math.abs(p.lat - lat) > box || Math.abs(p.lon - lon) > box * 3) continue;
    const nm = distanceNm(lat, lon, p.lat, p.lon);
    if (nm <= maxNm && (!best || nm < best.nm)) best = { airport, nm };
  }
  return best;
}

/** Distance from a point to a segment and the segment's bearing, on a local flat map (fine for a few miles). */
function segmentFit(lat: number, lon: number, a: PathPoint, b: PathPoint): { crossNm: number; courseDeg: number } {
  const k = Math.cos((lat * Math.PI) / 180) * 60;
  const ax = (a.lon - lon) * k;
  const ay = (a.lat - lat) * 60;
  const bx = (b.lon - lon) * k;
  const by = (b.lat - lat) * 60;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const f = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
  return {
    crossNm: Math.hypot(ax + dx * f, ay + dy * f),
    courseDeg: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360,
  };
}

/** The runway end an aircraft is rolling along ('30L'), or null. */
export function runwayUnder(lat: number, lon: number, trackDeg: number | null, runways: readonly Runway[]): string | null {
  for (const r of runways) {
    const low: PathPoint = { lat: r.lowLat, lon: r.lowLon, altFt: null };
    const high: PathPoint = { lat: r.highLat, lon: r.highLon, altFt: null };
    const fit = segmentFit(lat, lon, low, high);
    if (fit.crossNm > RUNWAY_HALF_NM) continue;
    // Rolling toward the high-numbered end means using the low-numbered one.
    if (trackDeg === null) return r.lowIdent;
    return Math.abs(turnBetween(trackDeg, fit.courseDeg)) <= 90 ? r.lowIdent : r.highIdent;
  }
  return null;
}

/** Degrees turned, signed, over the trail's last `windowMs`. A hold or an orbit adds up; a route does not. */
export function trailTurnDeg(trail: readonly TrailPoint[], nowMs: number, windowMs = HOLD_WINDOW_MS): number {
  let total = 0;
  let last: TrailPoint | null = null;
  let lastCourse: number | null = null;
  for (const p of trail) {
    if (nowMs - p.ms > windowMs) continue;
    if (!last) {
      last = p;
      continue;
    }
    if (distanceNm(last.lat, last.lon, p.lat, p.lon) < HOLD_MIN_STEP_NM) continue;
    const course = bearing(last.lat, last.lon, p.lat, p.lon);
    if (lastCourse !== null) total += turnBetween(lastCourse, course);
    lastCourse = course;
    last = p;
  }
  return total;
}

function crossToPaths(lat: number, lon: number, paths: readonly PathPoint[][]): number {
  let best = Infinity;
  for (const path of paths) {
    for (let i = 0; i + 1 < path.length; i++) {
      const c = segmentFit(lat, lon, path[i]!, path[i + 1]!).crossNm;
      if (c < best) best = c;
    }
  }
  return best;
}

/**
 * The arrival or departure an aircraft is flying: its position must lie on
 * one of the procedure's legs, headed along it. Procedures that share that
 * leg are told apart by how much of the recent trail they also explain.
 */
export function matchProcedure(
  a: Pick<Aircraft, 'lat' | 'lon' | 'trackDeg'>,
  trail: readonly TrailPoint[],
  nowMs: number,
  candidates: readonly ProcedureCandidate[],
): { candidate: ProcedureCandidate; next: string | null } | null {
  if (a.trackDeg === null) return null;
  const recent = trail.filter((p) => nowMs - p.ms <= PROCEDURE_HISTORY_MS);
  const step = Math.max(1, Math.floor(recent.length / PROCEDURE_HISTORY));
  const history = recent.filter((_, i) => i % step === 0);
  let best: { candidate: ProcedureCandidate; next: string | null; score: number; cross: number } | null = null;
  for (const candidate of candidates) {
    let hit: { cross: number; path: PathPoint[]; at: number } | null = null;
    for (const path of candidate.paths) {
      for (let i = 0; i + 1 < path.length; i++) {
        const fit = segmentFit(a.lat, a.lon, path[i]!, path[i + 1]!);
        if (fit.crossNm > PROCEDURE_CROSS_NM) continue;
        if (Math.abs(turnBetween(a.trackDeg, fit.courseDeg)) > PROCEDURE_TRACK_DEG) continue;
        if (!hit || fit.crossNm < hit.cross) hit = { cross: fit.crossNm, path, at: i };
      }
    }
    if (!hit) continue;
    let score = 0;
    for (const p of history) {
      if (crossToPaths(p.lat, p.lon, candidate.paths) <= PROCEDURE_CROSS_NM) score++;
    }
    if (best && (score < best.score || (score === best.score && hit.cross >= best.cross))) continue;
    // The next named fix: the first one at or after the end of the leg being flown.
    let next: string | null = null;
    for (let i = hit.at + 1; i < hit.path.length && !next; i++) {
      const p = hit.path[i]!;
      next = candidate.fixes.find((f) => Math.abs(f.lat - p.lat) < 0.001 && Math.abs(f.lon - p.lon) < 0.001)?.name ?? null;
    }
    best = { candidate, next, score, cross: hit.cross };
  }
  return best ? { candidate: best.candidate, next: best.next } : null;
}

function trackFit(lat: number, lon: number, track: RefuelTrack): { crossNm: number; courseDeg: number } | null {
  const box = REFUEL_CROSS_NM / 60;
  const [minLat, minLon, maxLat, maxLon] = track.bbox;
  if (lat < minLat - box || lat > maxLat + box || lon < minLon - box * 3 || lon > maxLon + box * 3) return null;
  let best: { crossNm: number; courseDeg: number } | null = null;
  for (let i = 0; i + 1 < track.pts.length; i++) {
    const [aLat, aLon] = track.pts[i]!;
    const [bLat, bLon] = track.pts[i + 1]!;
    const fit = segmentFit(lat, lon, { lat: aLat, lon: aLon, altFt: null }, { lat: bLat, lon: bLon, altFt: null });
    if (!best || fit.crossNm < best.crossNm) best = fit;
  }
  return best && best.crossNm <= REFUEL_CROSS_NM ? best : null;
}

/**
 * The air refueling track an aircraft is flying: it is inside the track's
 * corridor, headed along it either way, and its recent trail has run along
 * the same corridor for longer than a crossing would. Says where it is
 * flying, not that fuel is moving.
 */
export function matchRefuelTrack(
  a: Pick<Aircraft, 'lat' | 'lon' | 'trackDeg'>,
  trail: readonly TrailPoint[],
  nowMs: number,
  tracks: readonly RefuelTrack[],
): RefuelTrack | null {
  if (a.trackDeg === null) return null;
  const recent = trail.filter((p) => nowMs - p.ms <= REFUEL_WINDOW_MS);
  const oldest = recent[0];
  if (!oldest || distanceNm(oldest.lat, oldest.lon, a.lat, a.lon) < REFUEL_MIN_RUN_NM) return null;
  const step = Math.max(1, Math.floor(recent.length / REFUEL_HISTORY));
  const history = recent.filter((_, i) => i % step === 0);
  let best: { track: RefuelTrack; along: boolean; crossNm: number } | null = null;
  for (const track of tracks) {
    const fit = trackFit(a.lat, a.lon, track);
    if (!fit) continue;
    const off = Math.abs(turnBetween(a.trackDeg, fit.courseDeg));
    if (off > REFUEL_TRACK_DEG && off < 180 - REFUEL_TRACK_DEG) continue;
    if (!history.every((p) => trackFit(p.lat, p.lon, track))) continue;
    // Tracks that share a line ("AR-7A South", "AR-7B North") are drawn in the direction they are flown.
    const along = off <= REFUEL_TRACK_DEG;
    if (best && (best.along !== along ? best.along : best.crossNm <= fit.crossNm)) continue;
    best = { track, along, crossNm: fit.crossNm };
  }
  return best?.track ?? null;
}

/** The nearest aircraft flying in formation with this one: close, level with it, same way, same speed. */
export function formationPartner(a: Aircraft, others: Iterable<Aircraft>): Aircraft | null {
  let best: { aircraft: Aircraft; nm: number } | null = null;
  for (const o of others) {
    if (o.hex === a.hex || o.onGround || Math.abs(o.altFt - a.altFt) > FORMATION_ALT_FT) continue;
    if (Math.abs(o.lat - a.lat) > 0.05 || Math.abs(o.lon - a.lon) > 0.15) continue;
    if (a.trackDeg !== null && o.trackDeg !== null && Math.abs(turnBetween(a.trackDeg, o.trackDeg)) > FORMATION_TRACK_DEG) continue;
    if (a.groundSpeedKt !== null && o.groundSpeedKt !== null && Math.abs(a.groundSpeedKt - o.groundSpeedKt) > FORMATION_SPEED_KT) continue;
    const nm = distanceNm(a.lat, a.lon, o.lat, o.lon);
    if (nm <= FORMATION_NM && (!best || nm < best.nm)) best = { aircraft: o, nm };
  }
  return best?.aircraft ?? null;
}

/** The runway end an aircraft is on final for, from the published finals near it. */
export function matchFinal(
  a: Aircraft,
  index: ProcedureIndex,
): { icao: string; runway: string; nm: number } | null {
  let best: { icao: string; runway: string; nm: number; offNm: number } | null = null;
  for (const icao in index.airports) {
    const entry = index.airports[icao]!;
    const first = entry.f[0]?.legs.at(-1);
    if (!first) continue;
    if (Math.abs(first[1] - a.lat) > FINAL_SEARCH_DEG || Math.abs(first[2] - a.lon) > FINAL_SEARCH_DEG * 2) continue;
    for (const final of bestFinals(entry.f)) {
      const fit = finalFit(finalPath(final.legs), a);
      if (!fit || (best && fit.offNm >= best.offNm)) continue;
      best = { icao, runway: approachRunway(final.id) || final.rw.replace(/^RW/, ''), nm: fit.nm, offNm: fit.offNm };
    }
  }
  return best ? { icao: best.icao, runway: best.runway, nm: best.nm } : null;
}

/**
 * The same for airports with no published approach (everywhere outside the
 * US): lined up and descending on the extended centreline of a lit paved
 * runway. `skip` says which airports the published finals already cover.
 */
export function matchRunwayFinal(
  a: Aircraft,
  airports: readonly Airport[],
  runwaysOf: (icao: string) => readonly Runway[],
  skip: (icao: string) => boolean,
): { icao: string; runway: string; nm: number } | null {
  let best: { icao: string; runway: string; nm: number; offNm: number } | null = null;
  for (const airport of airports) {
    const p = airport.place;
    if (Math.abs(p.lat - a.lat) > FINAL_SEARCH_DEG || Math.abs(p.lon - a.lon) > FINAL_SEARCH_DEG * 2) continue;
    if (skip(airport.icao)) continue;
    for (const r of runwaysOf(airport.icao)) {
      if (!r.lighted || !r.hard) continue;
      for (const [ident, path] of [
        [r.lowIdent, approachPath(r.lowLat, r.lowLon, r.lowElevFt, r.highLat, r.highLon, 10, 1)],
        [r.highIdent, approachPath(r.highLat, r.highLon, r.highElevFt, r.lowLat, r.lowLon, 10, 1)],
      ] as const) {
        const fit = finalFit(path.map(([lat, lon, altFt]) => ({ lat, lon, altFt })), a);
        if (!fit || (best && fit.offNm >= best.offNm)) continue;
        best = { icao: airport.icao, runway: ident, nm: fit.nm, offNm: fit.offNm };
      }
    }
  }
  return best ? { icao: best.icao, runway: best.runway, nm: best.nm } : null;
}

export interface ActivityContext {
  nowMs: number;
  trail: readonly TrailPoint[];
  route: RouteInfo | null;
  airports: readonly Airport[] | null;
  runwaysOf: (icao: string) => readonly Runway[];
  index: ProcedureIndex | null;
  candidates: readonly ProcedureCandidate[];
  /** Air refueling tracks, once loaded. */
  refuelTracks?: readonly RefuelTrack[] | null;
  /** Everything on the scope, to find who it is flying with. */
  others?: Iterable<Aircraft>;
}

/** Pure: the most specific thing that can be said about what the aircraft is doing. */
export function inferActivity(a: Aircraft, ctx: ActivityContext): Activity {
  const speed = a.groundSpeedKt ?? 0;
  if (a.onGround) {
    const near = ctx.airports ? nearestAirport(a.lat, a.lon, ctx.airports, GROUND_AIRPORT_NM) : null;
    const icao = near?.airport.icao ?? null;
    if (icao && speed >= ROLL_KT) {
      const runway = runwayUnder(a.lat, a.lon, a.trackDeg, ctx.runwaysOf(icao));
      if (runway) return { kind: 'runway', icao, runway };
    }
    return { kind: speed >= TAXI_KT ? 'taxi' : 'parked', icao };
  }

  const index = ctx.index;
  const final =
    (index ? matchFinal(a, index) : null) ??
    (ctx.airports ? matchRunwayFinal(a, ctx.airports, ctx.runwaysOf, (icao) => index?.airports[icao] !== undefined) : null);
  if (final) return { kind: 'final', ...final };

  const vs = a.verticalRateFpm ?? 0;
  const procedure = matchProcedure(
    a,
    ctx.trail,
    ctx.nowMs,
    ctx.candidates.filter((c) => (c.kind === 'sid' ? vs >= -200 : vs <= 500)),
  );
  if (procedure) {
    return { kind: procedure.candidate.kind, icao: procedure.candidate.icao, id: procedure.candidate.id, next: procedure.next };
  }

  // Military only: an airliner whose route happens to lie along a track is not using it.
  if (a.military && ctx.refuelTracks) {
    const track = matchRefuelTrack(a, ctx.trail, ctx.nowMs, ctx.refuelTracks);
    if (track) {
      const partner = ctx.others ? formationPartner(a, ctx.others) : null;
      return { kind: 'refuel', track: track.id, with: partner ? (partner.callsign ?? partner.registration ?? partner.hex.toUpperCase()) : null };
    }
  }

  if (Math.abs(trailTurnDeg(ctx.trail, ctx.nowMs)) >= HOLD_TURN_DEG) return { kind: 'holding' };

  const route = ctx.route?.plausible ? ctx.route : null;
  if (ctx.airports && vs < VERTICAL_FPM && speed >= ROLL_KT) {
    const near = nearestAirport(a.lat, a.lon, ctx.airports, LANDING_NM);
    if (near && a.altFt - near.airport.place.altFt <= LANDING_ABOVE_FT) return { kind: 'landing', icao: near.airport.icao };
  }
  if (vs >= VERTICAL_FPM) {
    // Seen taking off: the trail's first point is low over a field.
    const first = ctx.trail[0];
    const from = first && ctx.airports ? nearestAirport(first.lat, first.lon, ctx.airports, DEPARTED_NM) : null;
    if (
      from &&
      first!.altFt - from.airport.place.altFt <= DEPARTED_ABOVE_FT &&
      distanceNm(a.lat, a.lon, from.airport.place.lat, from.airport.place.lon) <= DEPARTING_RANGE_NM
    ) {
      return { kind: 'departing', icao: from.airport.icao };
    }
    if (route?.origin_pos && distanceNm(a.lat, a.lon, route.origin_pos.lat, route.origin_pos.lon) <= DEPARTING_RANGE_NM) {
      return { kind: 'departing', icao: route.origin_icao ?? route.origin };
    }
  }
  if (vs < VERTICAL_FPM && route?.destination_pos) {
    const nm = distanceNm(a.lat, a.lon, route.destination_pos.lat, route.destination_pos.lon);
    // Descending toward it, or level and low near it (a downwind, a vector to final).
    if (vs <= -VERTICAL_FPM ? nm <= ARRIVING_RANGE_NM : nm <= ARRIVING_LEVEL_NM && a.altFt < CRUISE_FT) {
      return { kind: 'arriving', icao: route.destination_icao ?? route.destination, nm };
    }
  }
  if (vs >= VERTICAL_FPM) return { kind: 'climb' };
  if (vs <= -VERTICAL_FPM) return { kind: 'descent' };
  return { kind: a.altFt >= CRUISE_FT ? 'cruise' : 'level' };
}

// ── Loader ──────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
const candidatesByAirport = new Map<string, ProcedureCandidate[] | null>();
let wired = false;

function notify(): void {
  for (const fn of listeners) fn();
}

/** Fires when data the inference uses has arrived, so the caller can ask again. */
export function subscribeActivity(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The FAA publishes procedures for the US only: do not fetch them for a scope elsewhere. */
export function inProcedureCoverage(lat: number, lon: number): boolean {
  if (lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66) return true; // contiguous states
  if (lat >= 51 && lat <= 72 && lon >= -170 && lon <= -129) return true; // Alaska
  if (lat >= 18 && lat <= 23 && lon >= -161 && lon <= -154) return true; // Hawaii
  return lat >= 17 && lat <= 19 && lon >= -68 && lon <= -64; // Puerto Rico, USVI
}

const STARS: ReadonlySet<'star' | 'sid'> = new Set(['star']);
const SIDS: ReadonlySet<'star' | 'sid'> = new Set(['sid']);

function loadCandidates(icao: string, wanted: ReadonlySet<'star' | 'sid'>): ProcedureCandidate[] {
  const index = getProcedureIndex();
  const entry = index?.airports[icao];
  if (!entry) return [];
  const have = candidatesByAirport.get(icao);
  if (have === undefined) {
    candidatesByAirport.set(icao, null);
    void loadAirportDetail(icao).then((detail) => {
      const out: ProcedureCandidate[] = [];
      for (const kind of ['star', 'sid'] as const) {
        for (const [id, segments] of Object.entries(detail?.[kind] ?? {})) {
          const { parts, fixes } = procedureParts(kind, segments, entry.v, runwaysOf(icao));
          // Legs drawn from a condition (vectors, climbs) are guesses: do not match a track against them.
          const paths = parts.filter((p) => !p.approximate).map((p) => p.points);
          if (paths.length > 0) out.push({ kind, icao, id, paths, fixes });
        }
      }
      candidatesByAirport.set(icao, out);
      notify();
    });
  }
  return (have ?? []).filter((c) => wanted.has(c.kind));
}

/**
 * What the aircraft is doing, from whatever has loaded so far. Starts any
 * fetch the answer could use (airports, runways, the procedure index, the
 * route airports' procedures, refueling tracks); subscribeActivity fires as they land.
 */
export function activityOf(
  a: Aircraft,
  trail: readonly TrailPoint[],
  route: RouteInfo | null,
  others?: Iterable<Aircraft>,
): Activity {
  if (!wired) {
    wired = true;
    subscribeProcedures(notify);
    subscribeRunways(notify);
    subscribeRefuelTracks(notify);
    void loadAirports().then(notify);
    loadRunways();
  }
  const covered = inProcedureCoverage(a.lat, a.lon);
  if (covered && !a.onGround) void loadProcedureIndex();
  if (covered && !a.onGround && a.military) loadRefuelTracks();
  const candidates: ProcedureCandidate[] = [];
  const plausible = route?.plausible ? route : null;
  if (covered && !a.onGround && plausible) {
    const { origin_pos: from, destination_pos: to } = plausible;
    if (to && plausible.destination_icao && distanceNm(a.lat, a.lon, to.lat, to.lon) <= STAR_RANGE_NM) {
      candidates.push(...loadCandidates(plausible.destination_icao, STARS));
    }
    if (from && plausible.origin_icao && distanceNm(a.lat, a.lon, from.lat, from.lon) <= SID_RANGE_NM) {
      candidates.push(...loadCandidates(plausible.origin_icao, SIDS));
    }
  }
  return inferActivity(a, {
    nowMs: Date.now(),
    trail,
    route,
    airports: getAirports(),
    runwaysOf,
    index: getProcedureIndex(),
    candidates,
    refuelTracks: getRefuelTracks(),
    others: others ?? [],
  });
}
