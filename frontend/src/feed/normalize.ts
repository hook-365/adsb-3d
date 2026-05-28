import type { Aircraft, RawAircraft } from '../core/types';
import { RANGE_NM } from '../core/config';
import { distanceFromHomeNm } from '../core/coords';

// Shared between the HTTP poll path (live.ts) and the WS diff path: turn
// readsb's RawAircraft shape into the canonical Aircraft used by the rest
// of the app. Returns null for records we want to drop (no position, NaN,
// or outside our home range).

const FLAG_MILITARY = 0x01;
const FLAG_INTERESTING = 0x02;
const FLAG_PIA = 0x04;
const FLAG_LADD = 0x08;

// Squawk codes that imply an emergency regardless of the `emergency`
// field. 7500 = unlawful interference / hijack; 7600 = lost comms;
// 7700 = general emergency.
const SQUAWK_EMERGENCIES: Record<string, string> = {
  '7500': 'hijack (7500)',
  '7600': 'no radio (7600)',
  '7700': 'emergency (7700)',
};

function deriveEmergency(squawk: string | null, raw: string | undefined): string | null {
  if (squawk && SQUAWK_EMERGENCIES[squawk]) return SQUAWK_EMERGENCIES[squawk]!;
  if (raw && raw !== 'none' && raw.length > 0) return raw;
  return null;
}

function trim(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

export function normalizeRawAircraft(raw: RawAircraft, nowMs: number): Aircraft | null {
  if (typeof raw.lat !== 'number' || typeof raw.lon !== 'number') return null;
  if (Number.isNaN(raw.lat) || Number.isNaN(raw.lon)) return null;
  if (distanceFromHomeNm(raw.lat, raw.lon) > RANGE_NM) return null;

  const onGround = raw.alt_baro === 'ground';
  // Distinguish "really at altitude X" from "no altitude field in this
  // frame". readsb occasionally publishes position updates with both
  // alt_baro and alt_geom missing — the store substitutes the previous
  // known altitude for those frames so the trail doesn't dip to ground.
  let altFt = 0;
  let altFtKnown = false;
  if (onGround) {
    altFt = 0;
    altFtKnown = true;
  } else if (typeof raw.alt_baro === 'number') {
    altFt = raw.alt_baro;
    altFtKnown = true;
  } else if (typeof raw.alt_geom === 'number') {
    altFt = raw.alt_geom;
    altFtKnown = true;
  }

  // Prefer seen_pos (seconds since last position update) for the staleness/
  // fade logic so ground-speed-only messages don't reset the freshness timer.
  const seenSec = typeof raw.seen_pos === 'number' ? raw.seen_pos
    : typeof raw.seen === 'number' ? raw.seen : 0;
  const dbFlags = typeof raw.dbFlags === 'number' ? raw.dbFlags : 0;
  return {
    hex: raw.hex.toLowerCase(),
    callsign: trim(raw.flight),
    registration: trim(raw.r),
    typeCode: trim(raw.t),
    description: trim(raw.desc),
    category: trim(raw.category),
    operator: trim(raw.ownOp),
    lat: raw.lat,
    lon: raw.lon,
    altFt,
    altFtKnown,
    onGround,
    groundSpeedKt: typeof raw.gs === 'number' ? raw.gs : null,
    trackDeg: typeof raw.track === 'number' ? raw.track : null,
    verticalRateFpm: typeof raw.baro_rate === 'number' ? raw.baro_rate : null,
    military: (dbFlags & FLAG_MILITARY) !== 0,
    specialInterest: (dbFlags & FLAG_INTERESTING) !== 0,
    privacyIcao: (dbFlags & FLAG_PIA) !== 0,
    ladd: (dbFlags & FLAG_LADD) !== 0,
    squawk: trim(raw.squawk),
    emergency: deriveEmergency(trim(raw.squawk), raw.emergency),
    apAltMcpFt: typeof raw.nav_altitude_mcp === 'number' ? raw.nav_altitude_mcp : null,
    apAltFmsFt: typeof raw.nav_altitude_fms === 'number' ? raw.nav_altitude_fms : null,
    apHeadingDeg: typeof raw.nav_heading === 'number' ? raw.nav_heading : null,
    apQnhHpa: typeof raw.nav_qnh === 'number' ? raw.nav_qnh : null,
    apModes: Array.isArray(raw.nav_modes) && raw.nav_modes.length > 0 ? raw.nav_modes : null,
    lastSeenMs: nowMs - Math.round(seenSec * 1000),
    lastUpdateMs: nowMs
  };
}
