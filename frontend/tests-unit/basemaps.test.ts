import { describe, expect, it } from 'vitest';
import {
  CARTO_API_KEY,
  basemapAttribution,
  effectiveBasemap,
  isBasemapAvailable,
} from '../src/core/basemaps';
import { BASEMAP_VALUES } from '../src/core/settings';

// Runs under plain node: no window → no MAP_CONFIG → no CARTO key. That is
// the "self-hoster without a key" deployment.
describe('basemaps without a CARTO key', () => {
  it('has no key when window.MAP_CONFIG is absent', () => {
    expect(CARTO_API_KEY).toBe('');
  });

  it('hides only the CARTO basemaps', () => {
    expect(isBasemapAvailable('dark')).toBe(false);
    expect(isBasemapAvailable('carto_voyager')).toBe(false);
    for (const b of BASEMAP_VALUES) {
      if (b === 'dark' || b === 'carto_voyager') continue;
      expect(isBasemapAvailable(b)).toBe(true);
    }
  });

  it('falls back to OpenStreetMap for a persisted CARTO choice', () => {
    expect(effectiveBasemap('carto_voyager')).toBe('osm');
    expect(effectiveBasemap('dark')).toBe('osm');
    expect(effectiveBasemap('topo')).toBe('topo');
  });
});

describe('basemap attribution', () => {
  it('credits both OpenStreetMap and CARTO on CARTO basemaps (licence condition)', () => {
    for (const b of ['dark', 'carto_voyager'] as const) {
      const html = basemapAttribution(b);
      expect(html).toContain('openstreetmap.org/copyright');
      expect(html).toContain('carto.com/attributions');
    }
  });

  it('every basemap has a non-empty attribution', () => {
    for (const b of BASEMAP_VALUES) expect(basemapAttribution(b).length).toBeGreaterThan(0);
  });

  it('OSM-derived layers credit OpenStreetMap', () => {
    expect(basemapAttribution('osm')).toContain('OpenStreetMap');
    expect(basemapAttribution('topo')).toContain('OpenStreetMap');
    expect(basemapAttribution('sectional_hybrid')).toContain('OpenStreetMap');
  });
});
