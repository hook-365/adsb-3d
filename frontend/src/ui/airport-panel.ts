import { t } from '../core/i18n';
import { subscribeHome } from '../core/config';
import { getSettings, subscribeSettings } from '../core/settings';
import type { Aircraft } from '../core/types';
import { fmtAltitude } from '../core/units';
import { getExploreFeed, selectExplorePlace } from '../feed/feeds';
import {
  fetchTaf,
  formatTaf,
  getMetar,
  subscribeAirportWeather,
  type Metar,
} from '../world/airport-weather';
import { airportsActive, runwayLengthFt, type AirportSite, type Runway } from '../world/airports';

// Airport card: opened by clicking an airport's label (the same click
// flies the camera there). Says what the field is, what the weather is
// doing (decoded METAR, the raw report, the forecast), which runways it
// has, how much of the traffic on screen is at it right now, and offers
// to move the Explore scope there. It sits in the aircraft detail card's
// slot and borrows the airspace card's surface; main.ts keeps the three
// from being up together.

export interface AirportPanel {
  show(site: AirportSite): void;
  hide(): void;
}

const NEARBY_NM = 5;
const COUNT_INTERVAL_MS = 2000;
const HPA_PER_INHG = 33.8639;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** "180° at 12 kt, gusting 20 kt" / "Calm" / "Variable at 4 kt". */
export function windText(m: Pick<Metar, 'windDir' | 'windKt' | 'gustKt'>): string {
  if (m.windKt === null) return '';
  if (m.windKt === 0 || m.windDir === null) return t('misc.airport_wind_calm');
  const base =
    m.windDir === 'VRB'
      ? t('misc.airport_wind_variable', { kt: m.windKt })
      : t('misc.airport_wind_value', { dir: String(m.windDir).padStart(3, '0'), kt: m.windKt });
  return m.gustKt !== null && m.gustKt > m.windKt ? base + t('misc.airport_wind_gust', { kt: m.gustKt }) : base;
}

/** "12L/30R  10,000 × 150 ft, lit" */
export function runwayText(r: Runway): string {
  const len = Math.round(runwayLengthFt(r) / 100) * 100;
  const size = t('misc.airport_runway_size', { len: len.toLocaleString('en-US'), width: r.widthFt });
  return r.lighted ? `${size}, ${t('misc.airport_runway_lit')}` : size;
}

/** Aircraft within `nm` of a point and how many of them are on the ground. */
export function countNear(
  aircraft: Iterable<Pick<Aircraft, 'lat' | 'lon' | 'onGround'>>,
  lat: number,
  lon: number,
  nm = NEARBY_NM,
): { near: number; ground: number } {
  const cos = Math.cos((lat * Math.PI) / 180);
  let near = 0;
  let ground = 0;
  for (const a of aircraft) {
    const d = Math.hypot((a.lat - lat) * 60, (a.lon - lon) * 60 * cos);
    if (d > nm) continue;
    near++;
    if (a.onGround) ground++;
  }
  return { near, ground };
}

export function mountAirportPanel(getAircraft: () => Iterable<Aircraft>): AirportPanel {
  const root = el('section', 'airspace-panel airport-panel');
  root.hidden = true;
  root.setAttribute('aria-live', 'polite');

  const header = el('header');
  const ident = el('div', 'airspace-ident');
  const dot = el('span', 'airspace-dot');
  const title = el('span', 'airspace-title');
  ident.append(dot, title);
  const close = el('button', 'close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', t('misc.airport_close'));
  header.append(ident, close);

  const name = el('div', 'airspace-kind');
  const grid = el('dl', 'grid');
  const row = (key: Parameters<typeof t>[0]): [HTMLElement, HTMLElement] => {
    const label = el('dt', undefined, t(key));
    const value = el('dd');
    grid.append(label, value);
    return [label, value];
  };
  const [, elevation] = row('misc.airport_elevation');
  const [, nearby] = row('misc.airport_nearby');
  const [categoryLabel, category] = row('misc.airport_category');
  const [windLabel, wind] = row('misc.airport_wind');
  const [visLabel, visibility] = row('misc.airport_visibility');
  const [ceilingLabel, ceiling] = row('misc.airport_ceiling');
  const [tempLabel, temp] = row('misc.airport_temp');
  const [altimLabel, altimeter] = row('misc.airport_altimeter');
  const weatherRows = [categoryLabel, category, windLabel, wind, visLabel, visibility, ceilingLabel, ceiling, tempLabel, temp, altimLabel, altimeter];

  const metarHeading = el('h3', undefined, t('misc.airport_metar'));
  const metar = el('pre', 'airspace-notam');
  const tafHeading = el('h3', undefined, t('misc.airport_taf'));
  const taf = el('pre', 'airspace-notam');
  const runwaysHeading = el('h3', undefined, t('misc.airport_runways'));
  const runways = el('dl', 'grid airspace-shelves');
  const explore = el('button', 'airport-explore', t('misc.airport_explore'));
  explore.type = 'button';
  const note = el('p', 'airspace-note', t('misc.airport_note'));
  root.append(header, name, grid, metarHeading, metar, tafHeading, taf, runwaysHeading, runways, explore, note);
  document.body.appendChild(root);

  let current: AirportSite | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const refreshCount = (): void => {
    if (!current) return;
    const { lat, lon } = current.airport.place;
    const { near, ground } = countNear(getAircraft(), lat, lon);
    nearby.textContent = t('misc.airport_nearby_value', { n: near, g: ground });
  };

  const refreshWeather = (): void => {
    if (!current) return;
    const on = getSettings().airportWeather;
    const m = on ? getMetar(current.airport.icao) : null;
    for (const node of weatherRows) node.hidden = !m;
    metarHeading.hidden = metar.hidden = !on;
    tafHeading.hidden = taf.hidden = !on;
    if (m?.category) root.dataset.category = m.category;
    else delete root.dataset.category;
    if (!m) {
      metar.textContent = t('misc.airport_no_weather');
      return;
    }
    category.textContent = m.category ?? '';
    categoryLabel.hidden = category.hidden = m.category === null;
    wind.textContent = windText(m);
    windLabel.hidden = wind.hidden = wind.textContent === '';
    visibility.textContent = m.visibility === null ? '' : t('misc.airport_visibility_value', { sm: m.visibility });
    visLabel.hidden = visibility.hidden = m.visibility === null;
    ceiling.textContent = m.ceilingFt === null ? t('misc.airport_ceiling_none') : `${fmtAltitude(m.ceilingFt)} AGL`;
    temp.textContent =
      m.tempC === null
        ? ''
        : m.dewpointC === null
          ? `${Math.round(m.tempC)} °C`
          : t('misc.airport_temp_value', { t: Math.round(m.tempC), d: Math.round(m.dewpointC) });
    tempLabel.hidden = temp.hidden = m.tempC === null;
    altimeter.textContent =
      m.altimeterHpa === null
        ? ''
        : t('misc.airport_altimeter_value', {
            inhg: (m.altimeterHpa / HPA_PER_INHG).toFixed(2),
            hpa: Math.round(m.altimeterHpa),
          });
    altimLabel.hidden = altimeter.hidden = m.altimeterHpa === null;
    metar.textContent = m.raw;
  };

  const hide = (): void => {
    if (!current) return;
    current = null;
    root.hidden = true;
    clearInterval(timer);
  };

  const show = (site: AirportSite): void => {
    current = site;
    const { airport } = site;
    title.textContent = airport.iata ? `${airport.icao} · ${airport.iata}` : airport.icao;
    name.textContent = airport.city ? `${airport.name}, ${airport.city}` : airport.name;
    elevation.textContent = fmtAltitude(airport.place.altFt);

    runways.replaceChildren();
    for (const r of site.runways) {
      runways.append(el('dt', undefined, `${r.lowIdent}/${r.highIdent}`), el('dd', undefined, runwayText(r)));
    }
    // Only where the deployment has an Explore feed, and not for the place
    // the scope is already on.
    explore.hidden = getExploreFeed() === null;

    refreshWeather();
    taf.textContent = t('misc.airport_taf_loading');
    if (getSettings().airportWeather) {
      const asked = airport.icao;
      void fetchTaf(asked).then((text) => {
        if (current?.airport.icao !== asked) return;
        taf.textContent = text ? formatTaf(text) : t('misc.airport_taf_none');
      });
    }

    root.hidden = false;
    root.scrollTop = 0;
    refreshCount();
    clearInterval(timer);
    timer = setInterval(refreshCount, COUNT_INTERVAL_MS);
  };

  close.addEventListener('click', hide);
  explore.addEventListener('click', () => {
    const place = current?.airport.place;
    if (!place) return;
    hide();
    selectExplorePlace(place.id);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  subscribeAirportWeather(refreshWeather);
  // The airport belongs to the feed and the layer it was clicked in.
  subscribeHome(hide);
  subscribeSettings(() => {
    if (!airportsActive()) hide();
    else refreshWeather();
  });

  return { show, hide };
}
