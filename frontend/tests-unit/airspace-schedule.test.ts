import dataText from '../src/world/airspace-data.json?raw';
import { describe, expect, it } from 'vitest';
import {
  candidateZones,
  parseSchedule,
  scheduleState,
  sunEventUtcHours,
} from '../src/world/airspace-schedule';

// Minneapolis: Central time, well away from any zone boundary.
const LAT = 44.9;
const LON = -93.2;

/** An instant given as Central time on a date in November (CST, UTC-6). */
function central(day: number, hhmm: string): number {
  const h = Number(hhmm.slice(0, 2));
  const m = Number(hhmm.slice(2));
  return Date.UTC(2026, 10, day, h + 6, m);
}
// November 2026: the 16th is a Monday, the 21st a Saturday, the 22nd a Sunday.
const MON = 16;
const FRI = 20;
const SAT = 21;
const SUN = 22;

const state = (text: string, ms: number, lat = LAT, lon = LON) => scheduleState(parseSchedule(text), ms, lat, lon);

describe('parseSchedule', () => {
  it('reads the common shape and notes "other times by NOTAM"', () => {
    const s = parseSchedule('0600 - 2200, MON - FRI; OTHER TIMES BY NOTAM');
    expect(s.kind).toBe('timed');
    expect(s.otherTimesByNotam).toBe(true);
    expect(s.clauses).toHaveLength(1);
    expect(s.clauses[0]!.days).toEqual([false, true, true, true, true, true, false]);
  });

  it('treats NOTAM-only and unreadable text as unknown', () => {
    for (const text of [
      'BY NOTAM',
      'INTERMITTENT BY NOTAM 24 HOURS IN ADVANCE',
      '0630 - SUNSET, DAILY, BY NOTAM; OTHER TIMES BY NOTAM',
      'SEP 1 - APR 30, 0800 - 2200, MON - FRI; OTHER TIMES BY NOTAM',
      'WHEN THE MOON IS FULL',
      '',
    ]) {
      expect(parseSchedule(text).kind).toBe('unknown');
    }
    expect(parseSchedule(null).kind).toBe('unknown');
  });

  it('knows continuous, intermittent and a named zone', () => {
    expect(parseSchedule('CONTINUOUS').kind).toBe('continuous');
    expect(parseSchedule('INTERMITTENT, 0800 - 2400, DAILY; O/T BY NOTAM 6 HOURS IN ADVANCE')).toMatchObject({
      kind: 'timed',
      intermittent: true,
      otherTimesByNotam: true,
    });
    expect(parseSchedule('0730 - 2200 MOUNTAIN TIME, MON - FRI; O/T BY NOTAM').zone).toBe('America/Denver');
  });

  it('accepts the FAA line-break mark and holiday notes', () => {
    const s = parseSchedule('0800 - 0100, MON - THU; 0800 - 2200, FRI; CLOSED HOLIDAYS; O/T BY NOTAM 6 HRS IN ADAVANCE');
    expect(s.kind).toBe('unknown'); // "CLOSED HOLIDAYS" alone is a clause with no hours
    const t = parseSchedule('0700 - 1600, MON - FRI, EXCLUDING HOLIDAYS; O/T BY NOTAM');
    expect(t.kind).toBe('timed');
    const u = parseSchedule('INTERMITTENT, 0600 - 2400, MON - FRI; 0800 - 1800, SAT - SUN; %OTHER TIMES BY NOTAM 6 HOURS IN ADVANCE');
    expect(u.kind).toBe('timed');
    expect(u.clauses).toHaveLength(2);
  });
});

describe('scheduleState', () => {
  const weekdays = '0600 - 2200, MON - FRI; OTHER TIMES BY NOTAM';

  it('is active inside the hours on a listed day, and not otherwise', () => {
    expect(state(weekdays, central(MON, '0700'))).toBe('active');
    expect(state(weekdays, central(MON, '0559'))).toBe('inactive');
    expect(state(weekdays, central(MON, '2200'))).toBe('inactive');
    expect(state(weekdays, central(SAT, '1200'))).toBe('inactive');
  });

  it('is always active when continuous and never settled when unknown', () => {
    expect(state('CONTINUOUS', central(SUN, '0300'))).toBe('active');
    expect(state('BY NOTAM', central(MON, '1200'))).toBe('unknown');
  });

  it('carries a range past midnight into the next morning, on the day it began', () => {
    const late = '0800 - 0100, MON - THU';
    expect(state(late, central(MON, '2330'))).toBe('active');
    expect(state(late, central(MON + 1, '0030'))).toBe('active'); // Tuesday, from Monday
    expect(state(late, central(FRI, '0030'))).toBe('active'); // Friday, from Thursday
    expect(state(late, central(SAT, '0030'))).toBe('inactive'); // nothing began on Friday
    expect(state(late, central(MON, '0030'))).toBe('inactive'); // nothing began on Sunday
    expect(state('0700 - 0000, MON - FRI', central(MON, '2359'))).toBe('active');
    expect(state('0600 - 2400, DAILY', central(SUN, '2359'))).toBe('active');
  });

  it('handles several ranges and several clauses', () => {
    const text = '0730 - 1200, 1800 - 2330, MON - THU; 0730 - 1200, FRI';
    expect(state(text, central(MON, '1500'))).toBe('inactive');
    expect(state(text, central(MON, '1900'))).toBe('active');
    expect(state(text, central(FRI, '1900'))).toBe('inactive');
    expect(state(text, central(FRI, '0800'))).toBe('active');
  });

  it('reads day lists', () => {
    const text = '0200 - 0400, TUESDAY, THURSDAY, AND SATURDAY; OTHER TIMES BY NOTAM';
    expect(state(text, central(SAT, '0300'))).toBe('active');
    expect(state(text, central(FRI, '0300'))).toBe('inactive');
  });

  it('works out sunrise and sunset where the area is', () => {
    // Minneapolis, 16 November: sunrise about 07:12, sunset about 16:44 CST.
    const text = 'SUNRISE - SUNSET, MON - FRI; OTHER TIMES BY NOTAM';
    expect(state(text, central(MON, '0630'))).toBe('inactive');
    expect(state(text, central(MON, '0800'))).toBe('active');
    expect(state(text, central(MON, '1600'))).toBe('active');
    expect(state(text, central(MON, '1730'))).toBe('inactive');
    const padded = '1 HR BEFORE SUNRISE - 1 HR AFTER SUNSET, MON - FRI; O/T BY NOTAM';
    expect(state(padded, central(MON, '0630'))).toBe('active');
    expect(state(padded, central(MON, '1730'))).toBe('active');
    expect(state(padded, central(MON, '1830'))).toBe('inactive');
  });

  it('uses a zone named in the text over where the area is', () => {
    // 08:00 Central is 07:00 Mountain: before a 0730 Mountain start.
    expect(state('0730 - 2200 MOUNTAIN TIME, MON - FRI', central(MON, '0800'))).toBe('inactive');
    expect(state('0730 - 2200 MOUNTAIN TIME, MON - FRI', central(MON, '0900'))).toBe('active');
  });

  it('declines to answer near a zone boundary when the two zones disagree', () => {
    // Western Kansas could be Central or Mountain: 06:30 Central is 05:30 Mountain.
    const boundary = { lat: 38.5, lon: -101.5 };
    expect(candidateZones(boundary.lat, boundary.lon)).toEqual(['America/Chicago', 'America/Denver']);
    expect(state(weekdays, central(MON, '0630'), boundary.lat, boundary.lon)).toBe('unknown');
    // By mid-morning both agree.
    expect(state(weekdays, central(MON, '1000'), boundary.lat, boundary.lon)).toBe('active');
  });

  it('follows daylight saving through the zone database', () => {
    // 1 July 2026 is a Wednesday; Central is UTC-5 then. 06:30 CDT = 11:30 UTC.
    expect(state(weekdays, Date.UTC(2026, 6, 1, 11, 30))).toBe('active');
    expect(state(weekdays, Date.UTC(2026, 6, 1, 10, 30))).toBe('inactive');
  });
});

describe('candidateZones', () => {
  it('places the obvious cases', () => {
    expect(candidateZones(40.7, -74)).toEqual(['America/New_York']);
    expect(candidateZones(44.9, -93.2)).toEqual(['America/Chicago']);
    expect(candidateZones(39.7, -108)).toEqual(['America/Denver']);
    expect(candidateZones(34, -120)).toEqual(['America/Los_Angeles']);
    expect(candidateZones(33.4, -112)).toEqual(['America/Phoenix']);
    expect(candidateZones(61.2, -150)).toEqual(['America/Anchorage']);
    expect(candidateZones(21.3, -157.9)).toEqual(['Pacific/Honolulu']);
    expect(candidateZones(13.5, 144.8)).toEqual(['Pacific/Guam']);
  });
});

describe('sunEventUtcHours', () => {
  it('matches an almanac to within a few minutes', () => {
    // Minneapolis, 16 November 2026: sunrise 13:12 UTC, sunset 22:44 UTC.
    const rise = sunEventUtcHours(2026, 11, 16, LAT, LON, true)!;
    const set = sunEventUtcHours(2026, 11, 16, LAT, LON, false)!;
    expect(Math.abs(rise - 13.2)).toBeLessThan(0.1);
    expect(Math.abs(set - 22.73)).toBeLessThan(0.1);
  });

  it('reports no event in the polar night', () => {
    expect(sunEventUtcHours(2026, 12, 21, 71.3, -156.8, true)).toBeNull();
  });
});

describe('the published FAA strings', () => {
  const volumes = (JSON.parse(dataText) as { volumes: { t?: string; g: number[][][] }[] }).volumes;
  const texts = Array.from(new Set(volumes.map((v) => v.t).filter((t): t is string => Boolean(t))));

  it('all parse without throwing, and evaluate to one of the three states', () => {
    expect(texts.length).toBeGreaterThan(300);
    const now = central(MON, '1200');
    for (const text of texts) {
      const s = parseSchedule(text);
      expect(['continuous', 'timed', 'unknown']).toContain(s.kind);
      expect(['active', 'inactive', 'unknown']).toContain(scheduleState(s, now, LAT, LON));
    }
  });

  it('settles a useful share of them', () => {
    const settled = volumes.filter((v) => v.t && parseSchedule(v.t).kind !== 'unknown').length;
    const withText = volumes.filter((v) => v.t).length;
    // Printed so a data refresh shows how coverage moved.
    console.info(`[airspace-schedule] ${settled} of ${withText} volumes with published times are settled`);
    expect(settled / withText).toBeGreaterThan(0.45);
  });

  it('never calls a NOTAM-only area active or inactive', () => {
    const now = central(MON, '1200');
    for (const text of texts) {
      if (/^(INTERMITTENT )?BY NOTAM/.test(text)) expect(scheduleState(parseSchedule(text), now, LAT, LON)).toBe('unknown');
    }
  });
});
