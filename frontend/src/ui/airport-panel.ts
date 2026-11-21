import { formatMhz, frequenciesOf } from '../world/frequencies';
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
import {
  approachRunway,
  daysLeft,
  getProcedureIndex,
  loadProcedureIndex,
  procedureName,
  subscribeProcedures,
  type ProcedureKind,
} from '../world/procedures';

// Airport card: opened by clicking an airport's label (the same click
// flies the camera there). Says what the field is, what the weather is
// doing (decoded METAR, the raw report, the forecast), which runways it
// has, how much of the traffic on screen is at it right now, and offers
// to move the Explore scope there. Where the FAA publishes procedures it
// also lists the airport's approaches, arrivals and departures; clicking
// one draws it (world/procedure-layer.ts). It sits in the aircraft detail card's
// slot and borrows the airspace card's surface; main.ts keeps the three
// from being up together.

export interface AirportPanel {
  /**
   * Something else wants the card's slot (an aircraft was selected, an
   * airspace card opened). With a procedure drawn the card steps aside to
   * its pill and the procedure stays; otherwise it closes.
   */
  yieldSlot(): void;
  show(site: AirportSite): void;
  hide(): void;
}

export interface AirportPanelOptions {
  /** A procedure was picked in the card, or (null) the pick was cleared. */
  onProcedure?: (site: AirportSite, pick: { kind: ProcedureKind; id: string } | null) => void;
  /** The card is coming back from its pill and needs its slot again. */
  onRestore?: () => void;
}

/** Approach identifiers in runway order, then by name: every approach to 12L, then 12R, ... */
export function sortApproaches(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => {
    const ra = approachRunway(a);
    const rb = approachRunway(b);
    // Circling approaches name no runway: they go last.
    if ((ra === '') !== (rb === '')) return ra === '' ? 1 : -1;
    return ra.localeCompare(rb) || procedureName('approach', a).localeCompare(procedureName('approach', b));
  });
}

const NEARBY_NM = 5;
const COUNT_INTERVAL_MS = 2000;
const HPA_PER_INHG = 33.8639;

const CATEGORY_KEY = [
  ['VFR', 'misc.airport_cat_vfr'],
  ['MVFR', 'misc.airport_cat_mvfr'],
  ['IFR', 'misc.airport_cat_ifr'],
  ['LIFR', 'misc.airport_cat_lifr'],
] as const;

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

/**
 * What a wind does to a runway: the end it favours (the one with the
 * headwind) and the head and cross components there, knots. `fromLeft` is
 * as seen landing on that end.
 */
export function runwayWind(
  r: Runway,
  windDirDeg: number,
  windKt: number,
): { end: string; headKt: number; crossKt: number; fromLeft: boolean } {
  const cos = Math.cos((((r.lowLat + r.highLat) / 2) * Math.PI) / 180);
  // True heading when landing on the low-numbered end: toward the high end.
  const lowHeading = (Math.atan2((r.highLon - r.lowLon) * cos, r.highLat - r.lowLat) * 180) / Math.PI;
  const angle = ((windDirDeg - lowHeading) * Math.PI) / 180;
  const head = windKt * Math.cos(angle);
  const cross = windKt * Math.sin(angle);
  // The other end sees the same wind turned around: head and cross both change sign.
  const low = head >= 0;
  return {
    end: low ? r.lowIdent : r.highIdent,
    headKt: Math.abs(head),
    crossKt: Math.abs(cross),
    // A positive cross on the low end is wind from the right of its heading.
    fromLeft: low ? cross < 0 : cross > 0,
  };
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

export function mountAirportPanel(getAircraft: () => Iterable<Aircraft>, options: AirportPanelOptions = {}): AirportPanel {
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
  const minimize = el('button', 'close', '–');
  minimize.type = 'button';
  minimize.title = t('static.detail_minimize_title');
  minimize.setAttribute('aria-label', t('misc.airport_minimize'));
  const buttons = el('div', 'airspace-buttons');
  buttons.append(minimize, close);
  header.append(ident, buttons);

  // Minimized: the card steps aside to a pill and whatever procedure is
  // drawn stays drawn. Closing (the card's X) is what clears it.
  const pill = el('button', 'detail-pill airport-pill');
  pill.type = 'button';
  pill.hidden = true;
  pill.setAttribute('aria-label', t('misc.airport_restore'));
  const pillIdent = el('span', 'pill-callsign');
  const pillProcedure = el('span', 'pill-stats');
  pill.append(pillIdent, pillProcedure);
  document.body.append(pill);

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

  // The key to the label dots: all four categories, the current one lit.
  const categoryKey = el('ul', 'category-key');
  categoryKey.setAttribute('aria-label', t('misc.airport_cat_key'));
  const keyItems = CATEGORY_KEY.map(([id, key]) => {
    const item = el('li', undefined, t(key));
    item.dataset.category = id;
    categoryKey.append(item);
    return item;
  });

  const metarHeading = el('h3', undefined, t('misc.airport_metar'));
  const metar = el('pre', 'airspace-notam');
  const tafHeading = el('h3', undefined, t('misc.airport_taf'));
  const taf = el('pre', 'airspace-notam');
  const runwaysHeading = el('h3', undefined, t('misc.airport_runways'));
  const runways = el('dl', 'grid airspace-shelves');
  const frequenciesHeading = el('h3', undefined, t('misc.airport_frequencies'));
  const frequencies = el('dl', 'grid airspace-shelves');
  frequenciesHeading.hidden = frequencies.hidden = true;
  const procedures = el('div', 'airport-procedures');
  const explore = el('button', 'airport-explore', t('misc.airport_explore'));
  explore.type = 'button';
  const note = el('p', 'airspace-note', t('misc.airport_note'));
  root.append(header, name, grid, categoryKey, metarHeading, metar, tafHeading, taf, runwaysHeading, runways, frequenciesHeading, frequencies, procedures, explore, note);
  document.body.appendChild(root);

  let current: AirportSite | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const refreshCount = (): void => {
    if (!current) return;
    const { lat, lon } = current.airport.place;
    const { near, ground } = countNear(getAircraft(), lat, lon);
    nearby.textContent = t('misc.airport_nearby_value', { n: near, g: ground });
  };

  // Each runway's size and, with a reported wind, what that wind does to it.
  const refreshRunways = (): void => {
    if (!current) return;
    const m = getSettings().airportWeather ? getMetar(current.airport.icao) : null;
    const blowing = m && typeof m.windDir === 'number' && m.windKt !== null && m.windKt >= 3 ? { dir: m.windDir, kt: m.windKt } : null;
    runways.replaceChildren();
    for (const r of current.runways) {
      const value = el('dd', undefined, runwayText(r));
      if (blowing) {
        const w = runwayWind(r, blowing.dir, blowing.kt);
        const cross = Math.round(w.crossKt);
        const parts = [t('misc.airport_runway_head', { end: w.end, kt: Math.round(w.headKt) })];
        if (cross >= 1) parts.push(t(w.fromLeft ? 'misc.airport_runway_cross_left' : 'misc.airport_runway_cross_right', { kt: cross }));
        value.append(el('div', 'runway-wind', parts.join(' · ')));
      }
      runways.append(el('dt', undefined, `${r.lowIdent}/${r.highIdent}`), value);
    }
  };

  const refreshWeather = (): void => {
    if (!current) return;
    refreshRunways();
    const on = getSettings().airportWeather;
    const m = on ? getMetar(current.airport.icao) : null;
    for (const node of weatherRows) node.hidden = !m;
    metarHeading.hidden = metar.hidden = !on;
    categoryKey.hidden = !m?.category;
    for (const item of keyItems) item.classList.toggle('is-current', item.dataset.category === m?.category);
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

  let picked: string | null = null;
  const pick = (kind: ProcedureKind, id: string): void => {
    if (!current) return;
    const key = `${kind}:${id}`;
    picked = picked === key ? null : key;
    for (const chip of procedures.querySelectorAll<HTMLElement>('button')) {
      chip.classList.toggle('active', chip.dataset.key === picked);
    }
    options.onProcedure?.(current, picked ? { kind, id } : null);
  };

  // Approaches, arrivals and departures as the FAA publishes them, when it
  // does for this airport. Rebuilt when the index arrives.
  const refreshProcedures = (): void => {
    procedures.replaceChildren();
    if (!current) return;
    const index = getProcedureIndex();
    const entry = index?.airports[current.airport.icao];
    procedures.hidden = !index || !entry;
    if (!index || !entry) return;
    const section = (kind: ProcedureKind, heading: Parameters<typeof t>[0], ids: readonly string[]): void => {
      if (ids.length === 0) return;
      procedures.append(el('h3', undefined, t(heading)));
      const list = el('div', 'airport-chips');
      for (const id of ids) {
        const chip = el('button', undefined, procedureName(kind, id));
        chip.type = 'button';
        chip.dataset.key = `${kind}:${id}`;
        chip.classList.toggle('active', chip.dataset.key === picked);
        chip.addEventListener('click', () => pick(kind, id));
        list.append(chip);
      }
      procedures.append(list);
    };
    section('approach', 'misc.airport_approaches', sortApproaches(entry.a));
    section('star', 'misc.airport_arrivals', entry.s);
    section('sid', 'misc.airport_departures', entry.d);
    const date = new Date(`${index.effective}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const edition = t('misc.airport_procedures_cycle', { cycle: index.cycle, date });
    const stale = daysLeft(index) < 0;
    const line = el('p', 'airspace-note', stale ? `${edition} ${t('misc.airport_procedures_stale')}` : edition);
    line.classList.toggle('stale', stale);
    procedures.append(line, el('p', 'airspace-note', t('misc.airport_procedures_note')));
  };

  const setMinimized = (on: boolean): void => {
    if (!current) return;
    root.hidden = on;
    pill.hidden = !on;
    if (!on) return;
    pillIdent.textContent = current.airport.icao;
    const [kind, id] = (picked ?? '').split(':') as [ProcedureKind, string | undefined];
    pillProcedure.textContent = id ? procedureName(kind, id) : '';
    pillProcedure.hidden = !id;
  };

  const hide = (): void => {
    if (!current) return;
    pill.hidden = true;
    if (picked) options.onProcedure?.(current, null);
    picked = null;
    current = null;
    root.hidden = true;
    clearInterval(timer);
  };

  const show = (site: AirportSite): void => {
    if (current && picked && current.airport.icao !== site.airport.icao) options.onProcedure?.(current, null);
    if (current?.airport.icao !== site.airport.icao) picked = null;
    current = site;
    pill.hidden = true;
    const { airport } = site;
    title.textContent = airport.iata ? `${airport.icao} · ${airport.iata}` : airport.icao;
    name.textContent = airport.city ? `${airport.name}, ${airport.city}` : airport.name;
    elevation.textContent = fmtAltitude(airport.place.altFt);

    refreshRunways();
    // Only where the deployment has an Explore feed, and not for the place
    // the scope is already on.
    explore.hidden = getExploreFeed() === null;

    refreshWeather();
    refreshProcedures();
    frequenciesHeading.hidden = frequencies.hidden = true;
    const wanted = airport.icao;
    void frequenciesOf(wanted).then((list) => {
      if (current?.airport.icao !== wanted || list.length === 0) return;
      frequencies.replaceChildren();
      for (const f of list) {
        frequencies.append(el('dt', undefined, f.kind), el('dd', undefined, f.name ? `${formatMhz(f.mhz)} · ${f.name}` : formatMhz(f.mhz)));
      }
      frequenciesHeading.hidden = frequencies.hidden = false;
    });
    // The card can list procedures whether or not approach paths are drawn.
    void loadProcedureIndex();
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
  minimize.addEventListener('click', () => setMinimized(true));
  pill.addEventListener('click', () => {
    options.onRestore?.();
    setMinimized(false);
  });
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
  subscribeProcedures(refreshProcedures);
  // The airport belongs to the feed and the layer it was clicked in.
  subscribeHome(hide);
  subscribeSettings(() => {
    if (!airportsActive()) hide();
    else refreshWeather();
  });

  const yieldSlot = (): void => {
    if (current && picked) setMinimized(true);
    else hide();
  };

  return { show, hide, yieldSlot };
}
