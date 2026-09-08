import type { Basemap } from './settings';

// Basemap provider availability + attribution. Deliberately dependency-light
// (no core/config import — that module reads window.FEEDS_CONFIG at load and
// the XR wrist menu test runs under plain node) so any UI can ask "is this
// basemap usable here?" without dragging the scene graph in.
//
// CARTO's basemap terms forbid server-side proxying or caching of their
// tiles and require each deployment to use its own key, so the browser
// fetches CARTO tiles straight from their CDN with CARTO_API_KEY in the
// query string (world/tiles.ts). Empty key = the CARTO basemaps are hidden
// from the pickers and effectiveBasemap() substitutes OpenStreetMap.

/** CARTO_API_KEY → window.MAP_CONFIG.cartoApiKey, rendered by entrypoint.sh. */
export const CARTO_API_KEY: string =
  (typeof window !== 'undefined' &&
    (window as { MAP_CONFIG?: { cartoApiKey?: string } }).MAP_CONFIG?.cartoApiKey) || '';

const CARTO_PROVIDERS: ReadonlySet<Basemap> = new Set<Basemap>(['dark', 'carto_voyager']);
export const CARTO_PATHS: Partial<Record<Basemap, string>> = {
  dark: 'dark_all',
  carto_voyager: 'rastertiles/voyager',
};
export const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'] as const;

/** False for the CARTO basemaps when no API key is configured. */
export function isBasemapAvailable(b: Basemap): boolean {
  return !CARTO_PROVIDERS.has(b) || CARTO_API_KEY.length > 0;
}

/**
 * The basemap actually rendered for a Settings.basemap value. A persisted
 * CARTO choice on a deployment without a key (or one whose key was
 * removed) degrades to OSM instead of a wall of placeholder tiles.
 */
export function effectiveBasemap(b: Basemap): Basemap {
  return isBasemapAvailable(b) ? b : 'osm';
}

const OSM_LINK = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';
const CARTO_LINK = '<a href="https://carto.com/attributions" target="_blank" rel="noopener">© CARTO</a>';
const ESRI_LINK = '<a href="https://www.esri.com/" target="_blank" rel="noopener">© Esri</a>';
const OPENTOPO_LINK = '<a href="https://opentopomap.org/" target="_blank" rel="noopener">© OpenTopoMap</a> (CC-BY-SA)';
const VFRMAP_LINK = 'FAA charts via <a href="https://vfrmap.com" target="_blank" rel="noopener">VFRMap</a>';

/**
 * Attribution HTML for a provider (links only, no user content). CARTO's
 * terms require both OpenStreetMap and CARTO to be credited prominently
 * wherever their basemap is visible; the others are ODbL / provider
 * courtesy credits.
 */
export function basemapAttribution(b: Basemap): string {
  switch (b) {
    case 'dark':
    case 'carto_voyager':
      return `${OSM_LINK}, ${CARTO_LINK}`;
    case 'osm':
      return OSM_LINK;
    case 'topo':
      return `${OSM_LINK}, ${OPENTOPO_LINK}`;
    case 'hillshade':
    case 'satellite':
      return ESRI_LINK;
    case 'sectional_hybrid':
      return `${VFRMAP_LINK}, ${OSM_LINK}`;
    default:
      return VFRMAP_LINK;
  }
}

