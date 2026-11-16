// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { runwayWind } from '../src/ui/airport-panel';
import type { Runway } from '../src/world/airports';

// Runway 09/27: landing 09 heads east.
const runway = { lowIdent: '09', highIdent: '27', lowLat: 45, lowLon: -93.02, highLat: 45, highLon: -92.98 } as Runway;

describe('runwayWind', () => {
  it('favours the end with the headwind', () => {
    expect(runwayWind(runway, 90, 12)).toMatchObject({ end: '09', fromLeft: false });
    expect(runwayWind(runway, 90, 12).headKt).toBeCloseTo(12);
    expect(runwayWind(runway, 270, 12).end).toBe('27');
  });
  it('splits a quartering wind and says which side it is on', () => {
    // From the north-east, landing east: on the nose and from the left.
    const w = runwayWind(runway, 45, 20);
    expect(w.end).toBe('09');
    expect(w.headKt).toBeCloseTo(14.1, 1);
    expect(w.crossKt).toBeCloseTo(14.1, 1);
    expect(w.fromLeft).toBe(true);
    // From the north-west the other end is favoured; landing west, north is on the right.
    const v = runwayWind(runway, 315, 20);
    expect(v.end).toBe('27');
    expect(v.fromLeft).toBe(false);
  });
});
