// @vitest-environment jsdom
import dataText from '../src/world/navdata.json?raw';
import { describe, expect, it } from 'vitest';
import { airwaySegments, decodeNavData, navaidFrequency } from '../src/world/navdata';

const data = decodeNavData(JSON.parse(dataText));

describe('committed navigation data', () => {
  it('has the airways, navaids and fixes of the country', () => {
    expect(data.airways.length).toBeGreaterThan(1000);
    expect(data.navaids.length).toBeGreaterThan(800);
    expect(data.points.length).toBeGreaterThan(5000);
    for (const a of data.airways) expect(a.points.length).toBeGreaterThanOrEqual(2);
  });

  it('knows the Gopher VORTAC north of Minneapolis', () => {
    const gep = data.navaids.find((n) => n.ident === 'GEP')!;
    expect(gep).toMatchObject({ kind: 'T', name: 'Gopher' });
    expect(gep.lat).toBeCloseTo(45.146, 2);
    expect(navaidFrequency(gep)).toBe('117.30');
  });

  it('has both low and high routes', () => {
    expect(data.airways.some((a) => a.level === 'L' && a.ident.startsWith('V'))).toBe(true);
    expect(data.airways.some((a) => a.level === 'H' && a.ident.startsWith('J'))).toBe(true);
  });
});

describe('decodeNavData', () => {
  it('drops what does not fit', () => {
    const d = decodeNavData({
      points: [['AAA', 1, 2], ['BBB', 3, 4]],
      navaids: [['XYZ', 'N', 5, 6, 353, 'Somewhere'], ['BAD', 'V', 'x', 6, 0, '']],
      airways: [['V1', 'L', [0, 1]], ['V2', 'L', [0]], ['V3', 'H', [0, 9]]],
    });
    expect(d.navaids.map((n) => n.ident)).toEqual(['XYZ']);
    expect(navaidFrequency(d.navaids[0]!)).toBe('353');
    expect(d.airways.map((a) => a.ident)).toEqual(['V1']);
    expect(decodeNavData(null)).toEqual({ navaids: [], points: [], airways: [] });
  });
});

describe('airwaySegments', () => {
  const d = decodeNavData({
    points: [['A', 0, 0], ['B', 0, 1], ['C', 0, 2], ['D', 0, 50]],
    navaids: [],
    airways: [['V1', 'L', [0, 1, 2]], ['V9', 'L', [1, 2, 3]], ['J1', 'H', [0, 2]], ['Q1', 'B', [2, 3]]],
  });
  const near = (_lat: number, lon: number): boolean => lon < 10;

  it('draws a stretch shared by two airways once, and keeps a segment with one end in range', () => {
    const low = airwaySegments(d, 'L', near).map(([a, b]) => `${a.ident}-${b.ident}`);
    expect(low).toEqual(['A-B', 'B-C', 'C-D']);
  });
  it('draws a both-levels route at each level', () => {
    expect(airwaySegments(d, 'H', near).map(([a, b]) => `${a.ident}-${b.ident}`)).toEqual(['A-C', 'C-D']);
  });
  it('draws nothing wholly outside the scope', () => {
    expect(airwaySegments(d, 'L', () => false)).toEqual([]);
  });
});
