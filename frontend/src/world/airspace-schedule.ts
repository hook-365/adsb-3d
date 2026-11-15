// Times of use for special use airspace.
//
// The FAA publishes when a MOA or a restricted area is in use as a line of
// text: "0700 - 2200, MON - FRI; OTHER TIMES BY NOTAM". This module reads
// that text and answers, for an instant, whether the area is inside its
// published hours. Pure; no scene, no DOM.
//
// Three answers, and the third one matters most:
//   active    inside the published hours
//   inactive  outside them (it may still be activated by NOTAM, which the
//             schedule carries as `otherTimesByNotam`)
//   unknown   the text does not settle it: activation by NOTAM only, a
//             clause this parser does not understand, a clock time that
//             falls differently in the two time zones the area might be in
//
// It never guesses. Anything outside the grammar below makes the whole
// schedule unknown, and unknown is drawn exactly as airspace always was.
// Published hours are the plan, not the fact: an "active" area can be
// cold, and the app has no NOTAM feed for special use airspace.
//
// Grammar, after upper-casing and splitting on ";" and the FAA's "%"
// line-break mark:
//   CONTINUOUS
//   [INTERMITTENT,] <range>[, <range>...] [, <days>]
//   OTHER TIMES BY NOTAM ... / O/T BY NOTAM ...
// where <range> is "<time> - <time>", <time> is HHMM, SUNRISE, SUNSET or
// "<n> HR|HOUR|MINUTES BEFORE|AFTER SUNRISE|SUNSET", optionally followed by
// a time zone ("MOUNTAIN TIME", "MST"), and <days> is DAILY, a day, a
// "MON - FRI" range or a list of days. Holidays are not known here, so
// "EXCLUDING HOLIDAYS" is accepted and ignored.
//
// Clock times are local. A zone named in the text wins; otherwise the
// zone comes from where the area is, and near a zone boundary both
// neighbours are tried and must agree.

export type ScheduleState = 'active' | 'inactive' | 'unknown';

/** A clock time, or an offset from sunrise or sunset, in minutes. */
type TimeSpec = { kind: 'clock'; minutes: number } | { kind: 'sunrise' | 'sunset'; offset: number };

interface Clause {
  ranges: { from: TimeSpec; to: TimeSpec }[];
  /** Days of the week, Sunday = 0. */
  days: boolean[];
}

export interface Schedule {
  kind: 'continuous' | 'timed' | 'unknown';
  clauses: Clause[];
  /** "Other times by NOTAM": outside its hours it can still be activated. */
  otherTimesByNotam: boolean;
  /** Published as intermittent within its hours. */
  intermittent: boolean;
  /** IANA zone named in the text, when one is. */
  zone: string | null;
}

const UNKNOWN: Schedule = { kind: 'unknown', clauses: [], otherTimesByNotam: false, intermittent: false, zone: null };

const DAY_INDEX: Readonly<Record<string, number>> = {
  SUN: 0, SUNDAY: 0,
  MON: 1, MONDAY: 1,
  TUE: 2, TUES: 2, TUESDAY: 2,
  WED: 3, WEDNESDAY: 3,
  THU: 4, THUR: 4, THURS: 4, THURSDAY: 4,
  FRI: 5, FRIDAY: 5,
  SAT: 6, SATURDAY: 6,
};

const ZONES: readonly (readonly [RegExp, string])[] = [
  [/\b(EASTERN|EST|EDT)\b/, 'America/New_York'],
  [/\b(CENTRAL|CST|CDT)\b/, 'America/Chicago'],
  [/\b(MOUNTAIN|MST|MDT)\b/, 'America/Denver'],
  [/\b(PACIFIC|PST|PDT)\b/, 'America/Los_Angeles'],
  [/\b(ALASKA|AKST|AKDT)\b/, 'America/Anchorage'],
  [/\b(HAWAII|HAWAIIAN|HST)\b/, 'Pacific/Honolulu'],
];
/** Zone words to drop from a time once the zone has been noted. */
const ZONE_WORDS =
  /\b(EASTERN|CENTRAL|MOUNTAIN|PACIFIC|ALASKA|HAWAII|HAWAIIAN|EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|AKDT|HST|LOCAL|STANDARD|DAYLIGHT|TIME)\b/g;

function parseTime(text: string): TimeSpec | null {
  const t = text.replace(ZONE_WORDS, ' ').replace(/\s+/g, ' ').trim();
  const clock = /^(\d{2})(\d{2})$/.exec(t);
  if (clock) {
    const h = Number(clock[1]);
    const m = Number(clock[2]);
    if (h > 24 || m > 59 || (h === 24 && m !== 0)) return null;
    return { kind: 'clock', minutes: h * 60 + m };
  }
  const sun = /^(?:(\d+)\s*(HR|HRS|HOUR|HOURS|MIN|MINS|MINUTE|MINUTES)\s+(BEFORE|AFTER)\s+)?(SUNRISE|SUNSET|SR|SS)$/.exec(t);
  if (sun) {
    const amount = sun[1] ? Number(sun[1]) * (sun[2]!.startsWith('H') ? 60 : 1) : 0;
    const kind = sun[4] === 'SUNRISE' || sun[4] === 'SR' ? 'sunrise' : 'sunset';
    return { kind, offset: sun[3] === 'BEFORE' ? -amount : amount };
  }
  return null;
}

/** "MON - FRI", "DAILY", "TUESDAY", "TUESDAY AND SATURDAY" → days, or null. */
function parseDays(text: string): boolean[] | null {
  const t = text.trim();
  if (t === 'DAILY') return new Array<boolean>(7).fill(true);
  const range = /^([A-Z]+)\s*-\s*([A-Z]+)$/.exec(t);
  if (range) {
    const a = DAY_INDEX[range[1]!];
    const b = DAY_INDEX[range[2]!];
    if (a === undefined || b === undefined) return null;
    const days = new Array<boolean>(7).fill(false);
    for (let d = a; ; d = (d + 1) % 7) {
      days[d] = true;
      if (d === b) break;
    }
    return days;
  }
  const names = t.split(/\s+AND\s+|\s*&\s*|\s+/).filter((w) => w !== '' && w !== 'AND');
  if (names.length === 0) return null;
  const days = new Array<boolean>(7).fill(false);
  for (const name of names) {
    const d = DAY_INDEX[name];
    if (d === undefined) return null;
    days[d] = true;
  }
  return days;
}

/** Read one line of published times of use. Never throws. */
export function parseSchedule(text: string | null | undefined): Schedule {
  if (!text) return UNKNOWN;
  const upper = text
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/%/g, ';');
  let zone: string | null = null;
  for (const [re, name] of ZONES) {
    if (re.test(upper)) {
      // Two different zones in one line: do not pick.
      if (zone !== null && zone !== name) return UNKNOWN;
      zone = name;
    }
  }
  const clauses: Clause[] = [];
  let otherTimesByNotam = false;
  let intermittent = false;
  let continuous = false;
  for (const rawClause of upper.split(';')) {
    let clause = rawClause.trim().replace(/[.,]+$/, '').trim();
    if (clause === '') continue;
    if (/^(OTHER TIMES|O\/T)\b/.test(clause)) {
      if (!/NOTAM/.test(clause)) return UNKNOWN;
      otherTimesByNotam = true;
      continue;
    }
    if (/^INTERMITTENT\b/.test(clause)) {
      intermittent = true;
      clause = clause.replace(/^INTERMITTENT\s*,?\s*/, '');
      if (clause === '') return UNKNOWN;
    }
    if (clause === 'CONTINUOUS' || clause === 'CONT') {
      continuous = true;
      continue;
    }
    // Hours that only apply when a NOTAM says so settle nothing.
    if (/NOTAM/.test(clause)) return UNKNOWN;
    const ranges: Clause['ranges'] = [];
    let days: boolean[] | null = null;
    for (const rawPart of clause.split(',')) {
      const part = rawPart.trim().replace(/^AND\s+/, '');
      if (part === '') continue;
      if (/^(EXCLUDING|EXCEPT|CLOSED)\s+(FEDERAL\s+)?HOLIDAYS$/.test(part)) continue;
      const dash = part.split(/\s+-\s+|(?<=\d)-(?=\d)/);
      if (dash.length === 2) {
        const from = parseTime(dash[0]!);
        const to = parseTime(dash[1]!);
        if (from && to) {
          ranges.push({ from, to });
          continue;
        }
      }
      const partDays = parseDays(part);
      if (!partDays) return UNKNOWN;
      days = days ? days.map((on, i) => on || partDays[i]!) : partDays;
    }
    if (ranges.length === 0) return UNKNOWN;
    clauses.push({ ranges, days: days ?? new Array<boolean>(7).fill(true) });
  }
  if (continuous) {
    // "CONTINUOUS" beside clock times contradicts itself.
    return clauses.length === 0
      ? { kind: 'continuous', clauses: [], otherTimesByNotam, intermittent, zone }
      : UNKNOWN;
  }
  if (clauses.length === 0) return UNKNOWN;
  return { kind: 'timed', clauses, otherTimesByNotam, intermittent, zone };
}

/**
 * The time zones an area at (lat, lon) may keep, most likely first. Near a
 * boundary both neighbours are returned; a schedule is only settled when
 * every candidate gives the same answer.
 */
export function candidateZones(lat: number, lon: number): string[] {
  if (lon > 100) return ['Pacific/Guam'];
  if (lat < 30 && lon < -150) return ['Pacific/Honolulu'];
  if (lat > 50 && lon < -128) return ['America/Anchorage'];
  if (lon > -68.5) return ['America/Puerto_Rico'];
  // Arizona keeps Mountain Standard Time all year (the Navajo Nation, in
  // its north-east corner, does not: that corner gets both).
  if (lat > 31.2 && lat < 37.1 && lon > -114.9 && lon < -109) {
    return lat > 35.5 && lon > -111.5 ? ['America/Phoenix', 'America/Denver'] : ['America/Phoenix'];
  }
  // Zone boundaries wander by state and county; these bands cover them.
  if (lon > -83) return ['America/New_York'];
  if (lon > -90.5) return ['America/New_York', 'America/Chicago'];
  if (lon > -97) return ['America/Chicago'];
  if (lon > -105) return ['America/Chicago', 'America/Denver'];
  if (lon > -113.5) return ['America/Denver'];
  if (lon > -118.5) return ['America/Denver', 'America/Los_Angeles'];
  return ['America/Los_Angeles'];
}

interface LocalTime {
  /** Day of the week, Sunday = 0. */
  day: number;
  /** Minutes since local midnight. */
  minutes: number;
  year: number;
  month: number;
  date: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function localTime(ms: number, zone: string): LocalTime {
  let fmt = formatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formatters.set(zone, fmt);
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(ms)) parts[p.type] = p.value;
  return {
    day: WEEKDAYS.indexOf(parts.weekday!),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    year: Number(parts.year),
    month: Number(parts.month),
    date: Number(parts.day),
  };
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function deg(r: number): number {
  return (r * 180) / Math.PI;
}

/**
 * Sunrise or sunset on a calendar date at a place, as hours UTC measured
 * from 00:00 UTC of that date (so a US sunset is past 24), or null where
 * the sun does not rise or set that day. The almanac approximation, good
 * to a minute or two.
 */
export function sunEventUtcHours(
  year: number,
  month: number,
  date: number,
  lat: number,
  lon: number,
  rising: boolean,
): number | null {
  const dayOfYear = Math.round((Date.UTC(year, month - 1, date) - Date.UTC(year, 0, 0)) / 86_400_000);
  const lngHour = lon / 15;
  const t = dayOfYear + ((rising ? 6 : 18) - lngHour) / 24;
  const m = 0.9856 * t - 3.289;
  let l = m + 1.916 * Math.sin(rad(m)) + 0.02 * Math.sin(rad(2 * m)) + 282.634;
  l = ((l % 360) + 360) % 360;
  let ra = deg(Math.atan(0.91764 * Math.tan(rad(l))));
  ra = ((ra % 360) + 360) % 360;
  ra += Math.floor(l / 90) * 90 - Math.floor(ra / 90) * 90;
  ra /= 15;
  const sinDec = 0.39782 * Math.sin(rad(l));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(rad(90.833)) - sinDec * Math.sin(rad(lat))) / (cosDec * Math.cos(rad(lat)));
  if (cosH > 1 || cosH < -1) return null;
  const h = (rising ? 360 - deg(Math.acos(cosH)) : deg(Math.acos(cosH))) / 15;
  const local = h + ra - 0.06571 * t - 6.622;
  // Local mean time of the event, then to UTC without wrapping to 0..24:
  // the caller wants the instant on this local date.
  const localMean = ((local % 24) + 24) % 24;
  return localMean - lngHour;
}

/** Minutes since local midnight for a time spec on the given local date, or null. */
function resolve(spec: TimeSpec, at: LocalTime, zone: string, lat: number, lon: number): number | null {
  if (spec.kind === 'clock') return spec.minutes;
  const utcHours = sunEventUtcHours(at.year, at.month, at.date, lat, lon, spec.kind === 'sunrise');
  if (utcHours === null) return null;
  const instant = Date.UTC(at.year, at.month - 1, at.date) + utcHours * 3_600_000;
  return localTime(instant, zone).minutes + spec.offset;
}

function stateInZone(schedule: Schedule, ms: number, zone: string, lat: number, lon: number): ScheduleState {
  const now = localTime(ms, zone);
  const yesterday = (now.day + 6) % 7;
  for (const clause of schedule.clauses) {
    for (const range of clause.ranges) {
      const from = resolve(range.from, now, zone, lat, lon);
      let to = resolve(range.to, now, zone, lat, lon);
      if (from === null || to === null) return 'unknown';
      // "0700 - 0000" and "0800 - 0100" run into the next day.
      const overnight = to <= from;
      if (overnight) to += 1440;
      if (clause.days[now.day] && now.minutes >= from && now.minutes < to) return 'active';
      // The tail of a range that began yesterday.
      if (overnight && clause.days[yesterday] && now.minutes + 1440 < to) return 'active';
    }
  }
  return 'inactive';
}

/** Whether a parsed schedule has the area inside its published hours at `ms`. */
export function scheduleState(schedule: Schedule, ms: number, lat: number, lon: number): ScheduleState {
  if (schedule.kind === 'unknown') return 'unknown';
  if (schedule.kind === 'continuous') return 'active';
  const zones = schedule.zone ? [schedule.zone] : candidateZones(lat, lon);
  let agreed: ScheduleState | null = null;
  for (const zone of zones) {
    const state = stateInZone(schedule, ms, zone, lat, lon);
    if (state === 'unknown') return 'unknown';
    if (agreed !== null && agreed !== state) return 'unknown';
    agreed = state;
  }
  return agreed ?? 'unknown';
}

const parsed = new Map<string, Schedule>();

/** parseSchedule with a cache: the same few hundred strings recur across volumes. */
export function scheduleFor(text: string | null | undefined): Schedule {
  if (!text) return UNKNOWN;
  let s = parsed.get(text);
  if (!s) {
    s = parseSchedule(text);
    parsed.set(text, s);
  }
  return s;
}
