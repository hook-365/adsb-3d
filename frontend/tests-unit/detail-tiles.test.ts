// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { patchStale, tileSpanNm } from '../src/world/detail-tiles';
import { providerMaxZoom } from '../src/world/tiles';

describe('detail tiles', () => {
  it('knows how big a tile is', () => {
    // 360 degrees over 2^11 tiles, 60 NM a degree at the equator, halved at 60 N.
    expect(tileSpanNm(11, 0)).toBeCloseTo(10.55, 1);
    expect(tileSpanNm(11, 60)).toBeCloseTo(5.27, 1);
  });

  it('rebuilds the patch only once the view has moved well off it', () => {
    const centre = { lat: 45, lon: -93 };
    expect(patchStale(null, centre, 7)).toBe(true);
    expect(patchStale(centre, { lat: 45.05, lon: -93 }, 7)).toBe(false); // 3 NM
    expect(patchStale(centre, { lat: 45.2, lon: -93 }, 7)).toBe(true); // 12 NM
    expect(patchStale(centre, { lat: 45, lon: -92.7 }, 7)).toBe(true); // about 12.7 NM east
  });

  it('does not ask the chart scans for zoom levels they do not have', () => {
    expect(providerMaxZoom('sectional')).toBe(11);
    expect(providerMaxZoom('dark')).toBeGreaterThanOrEqual(12);
  });
});
