// Lingua-franca types. RawAircraft mirrors readsb's aircraft.json shape;
// Aircraft is the normalized form everything downstream consumes.

export interface RawAircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  ownOp?: string;
  category?: string;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  lat?: number;
  lon?: number;
  seen?: number;
  seen_pos?: number;
  r_dst?: number;
  r_dir?: number;
  dbFlags?: number;
  squawk?: string;
  // readsb's emergency field: "none" (or absent) for normal traffic;
  // "general" / "lifeguard" / "minfuel" / "nordo" / "unlawful" / "downed"
  // when the aircraft is broadcasting a Mode-A 7500/7600/7700 or
  // equivalent ADS-B emergency state.
  emergency?: string;
  // Autopilot / FMS data from BDS 4,0/5,0 Comm-B replies. Coverage is
  // patchy — many aircraft never publish these fields.
  nav_altitude_mcp?: number;
  nav_altitude_fms?: number;
  nav_heading?: number;
  nav_qnh?: number;
  nav_modes?: string[];
}

export interface AircraftJsonFeed {
  now: number;
  messages: number;
  aircraft: RawAircraft[];
}

export interface Aircraft {
  hex: string;
  callsign: string | null;
  registration: string | null;
  typeCode: string | null;
  description: string | null;
  category: string | null;
  operator: string | null;
  lat: number;
  lon: number;
  altFt: number;
  /**
   * True when the upstream frame actually reported altitude (either a
   * numeric `alt_baro`/`alt_geom`, or the explicit `'ground'` sentinel).
   * False when neither field was present — readsb occasionally emits
   * frames without altitude, and the store's last-known-altitude cache
   * substitutes a prior value to keep the cone from snapping to zero.
   */
  altFtKnown: boolean;
  onGround: boolean;
  groundSpeedKt: number | null;
  trackDeg: number | null;
  verticalRateFpm: number | null;
  military: boolean;
  // dbFlags bits beyond military, surfaced as chips in the detail panel.
  // interesting = wiedehopf's "special interest" list; pia = Privacy ICAO
  // Address (block reassigned daily); ladd = Limiting Aircraft Data Displayed.
  specialInterest: boolean;
  privacyIcao: boolean;
  ladd: boolean;
  /** Mode-A transponder code, or null when not broadcast. */
  squawk: string | null;
  /**
   * Emergency state. null when the aircraft is operating normally; otherwise
   * a short human-readable label ("squawk 7700", "general", "hijack", ...)
   * derived from readsb's `emergency` field and the squawk code.
   */
  emergency: string | null;
  // Autopilot / FMS state if the aircraft publishes BDS 4,0/5,0. Each
  // independently null when the aircraft hasn't broadcast that field.
  apAltMcpFt: number | null;
  apAltFmsFt: number | null;
  apHeadingDeg: number | null;
  apQnhHpa: number | null;
  apModes: readonly string[] | null;
  lastSeenMs: number;
  lastUpdateMs: number;
}

export interface HomeLocation {
  lat: number;
  lon: number;
  altFt: number;
  name: string;
}
