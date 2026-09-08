import { getSettings, subscribeSettings } from '../core/settings';
import { basemapAttribution, effectiveBasemap } from '../core/basemaps';

// Basemap attribution line (bottom-right). Tracks the active basemap so
// the credit always matches what's on screen. CARTO's basemap terms make
// this a licence condition (OpenStreetMap + CARTO, prominent and
// conspicuous, on every CARTO basemap); the other providers get their
// customary credit through the same element.

export function mountMapAttribution(): void {
  const el = document.getElementById('map-attribution');
  if (!el) return;
  let last = '';
  const apply = (): void => {
    const html = basemapAttribution(effectiveBasemap(getSettings().basemap));
    if (html === last) return;
    last = html;
    el.innerHTML = html;
  };
  apply();
  subscribeSettings(apply);
}
