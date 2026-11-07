import { getSettings, subscribeSettings } from '../core/settings';
import { subscribeHome } from '../core/config';
import { basemapAttribution, effectiveBasemap } from '../core/basemaps';
import { stormsActive } from '../world/storms';
import { precipLayerActive, subscribePrecipLayer } from '../world/precip-layer';
import { freezingLevelActive } from '../world/freezing-level';
import { severeActive } from '../world/severe-cells';
import { lightningActive } from '../world/lightning';
import { getActiveFeed } from '../feed/feeds';
import { exploreAttribution, isExploreFeedId } from '../feed/explore';

// Basemap attribution line (bottom-right). Tracks the active basemap so
// the credit always matches what's on screen. CARTO's basemap terms make
// this a licence condition (OpenStreetMap + CARTO, prominent and
// conspicuous, on every CARTO basemap); the other providers get their
// customary credit through the same element.

const RAINVIEWER_LINK =
  'radar <a href="https://www.rainviewer.com/api.html" target="_blank" rel="noopener">© RainViewer</a>';
const NLDN_SUFFIX = ' (lightning: NLDN)';
const MRMS_WEATHER_LINK =
  'weather <a href="https://www.nssl.noaa.gov/projects/mrms/" target="_blank" rel="noopener">NOAA MRMS</a>';
const MRMS_LINK =
  'storms <a href="https://www.nssl.noaa.gov/projects/mrms/" target="_blank" rel="noopener">NOAA MRMS</a>';

export function mountMapAttribution(): void {
  const el = document.getElementById('map-attribution');
  if (!el) return;
  let last = '';
  const apply = (): void => {
    const s = getSettings();
    let html = basemapAttribution(effectiveBasemap(s.basemap));
    // The flat radar steps aside while the 3D volume is on (world/radar.ts).
    if (stormsActive()) html += `, ${MRMS_LINK}`;
    else if (precipLayerActive() || freezingLevelActive() || severeActive() || lightningActive()) html += `, ${MRMS_WEATHER_LINK}`;
    else if (s.weatherRadar) html += `, ${RAINVIEWER_LINK}`;
    // NLDN is Vaisala's detection network, redistributed inside MRMS; name it.
    if (lightningActive()) html += NLDN_SUFFIX;
    // Explore feed data is CC BY-SA: the credit is a licence condition,
    // same as CARTO's. subscribeHome fires on every feed switch.
    if (isExploreFeedId(getActiveFeed().id)) html += `, ${exploreAttribution()}`;
    if (html === last) return;
    last = html;
    el.innerHTML = html;
  };
  apply();
  subscribeSettings(apply);
  subscribeHome(apply);
  subscribePrecipLayer(apply);
}
