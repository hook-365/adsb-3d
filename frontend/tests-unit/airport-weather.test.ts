// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { formatTaf, metarBox, parseMetars, parseTaf } from '../src/world/airport-weather';
import { countNear, windText } from '../src/ui/airport-panel';

// Shapes copied from aviationweather.gov's Data API (2026-11-15).
const KSGS = {
  icaoId: 'KSGS', obsTime: 1794774900, temp: 10.4, dewp: -3.9, wdir: 180, wspd: 3, visib: '10+', altim: 1028.5,
  rawOb: 'METAR KSGS 152035Z AUTO 18003KT 10SM CLR 10/M04 A3037 RMK AO2 T01041039', clouds: [], fltCat: 'VFR',
};
const LOW = {
  icaoId: 'kxyz', obsTime: 1794774900, temp: 2, dewp: 1, wdir: 'VRB', wspd: 4, wgst: 18, visib: 0.5, altim: 1002,
  rawOb: 'METAR KXYZ ...', clouds: [{ cover: 'SCT', base: 300 }, { cover: 'OVC', base: 800 }, { cover: 'BKN', base: 500 }], fltCat: 'LIFR',
};

describe('parseMetars', () => {
  const m = parseMetars([KSGS, LOW, { icaoId: 'bad id' }, null, { nothing: true }]);

  it('keeps well-formed stations and skips junk', () => {
    expect(Array.from(m.keys())).toEqual(['KSGS', 'KXYZ']);
  });

  it('reads a clear day', () => {
    expect(m.get('KSGS')).toMatchObject({
      category: 'VFR', tempC: 10.4, dewpointC: -3.9, windDir: 180, windKt: 3, gustKt: null,
      visibility: '10+', altimeterHpa: 1028.5, ceilingFt: null, observed: 1794774900,
    });
  });

  it('takes the lowest broken or overcast layer as the ceiling, ignoring scattered cloud', () => {
    expect(m.get('KXYZ')).toMatchObject({ category: 'LIFR', windDir: 'VRB', gustKt: 18, visibility: '0.5', ceilingFt: 500 });
  });

  it('survives an answer that is not a list', () => {
    expect(parseMetars(null).size).toBe(0);
    expect(parseMetars({ error: 'x' }).size).toBe(0);
  });

  it('does not invent a category', () => {
    expect(parseMetars([{ ...KSGS, fltCat: 'UNKNOWN' }]).get('KSGS')!.category).toBeNull();
  });
});

describe('TAF', () => {
  it('takes the text and breaks it at each change group', () => {
    const raw = 'TAF KMSP 151720Z 1518/1624 16004KT P6SM FEW250 FM152100 18007KT P6SM FEW250 TEMPO 1600/1604 3SM BR';
    expect(parseTaf([{ rawTAF: raw }])).toBe(raw);
    expect(formatTaf(raw).split('\n')).toEqual([
      'TAF KMSP 151720Z 1518/1624 16004KT P6SM FEW250',
      '  FM152100 18007KT P6SM FEW250',
      '  TEMPO 1600/1604 3SM BR',
    ]);
  });

  it('is null when there is none', () => {
    expect(parseTaf([])).toBeNull();
    expect(parseTaf('nope')).toBeNull();
  });
});

describe('metarBox', () => {
  it('is a box around the point, widened east-west for latitude, to a tenth of a degree', () => {
    // 150 NM is 2.5 degrees of latitude; at 60 N a degree of longitude is half as long.
    expect(metarBox(60, 10, 150)).toBe('57.5,5.0,62.5,15.0');
    // The proxy only accepts this shape.
    expect(metarBox(44.88, -93.22)).toMatch(/^-?\d{1,3}\.\d,-?\d{1,3}\.\d,-?\d{1,3}\.\d,-?\d{1,3}\.\d$/);
  });
});

describe('airport card helpers', () => {
  it('describes the wind', () => {
    expect(windText({ windDir: 180, windKt: 12, gustKt: 20 })).toBe('180° at 12 kt, gusting 20 kt');
    expect(windText({ windDir: 40, windKt: 5, gustKt: null })).toBe('040° at 5 kt');
    expect(windText({ windDir: 'VRB', windKt: 4, gustKt: null })).toBe('Variable at 4 kt');
    expect(windText({ windDir: null, windKt: 0, gustKt: null })).toBe('Calm');
    expect(windText({ windDir: null, windKt: null, gustKt: null })).toBe('');
  });

  it('counts the traffic at the field', () => {
    const at = (dLatNm: number, onGround: boolean) => ({ lat: 45 + dLatNm / 60, lon: -93, onGround });
    expect(countNear([at(0, true), at(2, false), at(4.9, false), at(6, false)], 45, -93)).toEqual({ near: 3, ground: 1 });
  });
});
