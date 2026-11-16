// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parsePireps, pirepSummary, severityOf } from '../src/world/pireps';

const now = 1_794_800_000;
const report = (over: Record<string, unknown>): Record<string, unknown> => ({
  lat: 44.9,
  lon: -93.2,
  fltLvl: 350,
  obsTime: now - 600,
  acType: 'B738',
  tbInt1: '',
  icgInt1: '',
  pirepType: 'PIREP',
  rawOb: 'MSP UA /OV MSP/TM 0206/FL350/TP B738/TB MOD',
  ...over,
});

describe('pilot reports', () => {
  it('reads the worse end of an intensity', () => {
    expect(severityOf('LGT-MOD')).toBe(2);
    expect(severityOf('SEV')).toBe(3);
    expect(severityOf('LGT')).toBe(1);
    expect(severityOf('NEG')).toBe(0);
    expect(severityOf('')).toBe(0);
  });
  it('parses position, level and what was reported', () => {
    const [p] = parsePireps([report({ tbInt1: 'MOD' })], now);
    expect(p).toMatchObject({ lat: 44.9, lon: -93.2, altFt: 35000, turbulence: 'MOD', severity: 2, urgent: false });
    expect(pirepSummary(p!)).toBe('TURB MOD · FL350');
  });
  it('puts the worst first and drops old or placeless reports', () => {
    const list = parsePireps(
      [report({}), report({ icgInt1: 'SEV' }), report({ obsTime: now - 3 * 3600 }), report({ lat: null })],
      now,
    );
    expect(list.map((p) => p.severity)).toEqual([3, 0]);
  });
  it('strips the bulletin header and flags an urgent report', () => {
    const [p] = parsePireps([report({ pirepType: 'Urgent PIREP', rawOb: '000 UBND90 KWBC 160055 ND 160055 FAR UUA /OV KFAR/TB SEV' })], now);
    expect(p!.raw).toBe('FAR UUA /OV KFAR/TB SEV');
    expect(p!.urgent).toBe(true);
  });
  it('says something for a report with no turbulence or icing', () => {
    expect(pirepSummary({ turbulence: '', icing: '', altFt: 2700 })).toBe('PIREP · FL027');
    expect(parsePireps('nope', now)).toEqual([]);
  });
});
