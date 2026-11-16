// @vitest-environment jsdom
import dataText from '../src/world/artcc-data.json?raw';
import { describe, expect, it } from 'vitest';
import { centreAt, decodeCentres } from '../src/world/artcc';

const centres = decodeCentres(JSON.parse(dataText));

describe('centre boundaries', () => {
  it('has the contiguous centres and Anchorage', () => {
    expect(centres.length).toBeGreaterThanOrEqual(20);
    expect(centres.map((c) => c.id)).toEqual(expect.arrayContaining(['ZMP', 'ZAU', 'ZNY', 'ZLA', 'ZAN']));
  });
  it('puts cities in the centre that works them', () => {
    expect(centreAt(centres, 44.88, -93.22)?.id).toBe('ZMP'); // Minneapolis
    expect(centreAt(centres, 41.98, -87.9)?.id).toBe('ZAU'); // Chicago O'Hare
    expect(centreAt(centres, 33.94, -118.41)?.id).toBe('ZLA'); // Los Angeles
    expect(centreAt(centres, 39.86, -104.67)?.id).toBe('ZDV'); // Denver
  });
  it('answers null away from the US', () => {
    expect(centreAt(centres, 51.47, -0.45)).toBeNull();
  });
  it('drops malformed entries', () => {
    expect(decodeCentres({ centres: [{ id: 'X' }, { id: 'ZZZ', name: 'Z', rings: [[[1, 2]]] }] })).toEqual([]);
    expect(decodeCentres(null)).toEqual([]);
  });
});
