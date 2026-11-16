import { Group, Vector3 } from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { HOME, RANGE_NM, subscribeHome } from '../core/config';
import { distanceFromHomeNm, toScene } from '../core/coords';
import { t } from '../core/i18n';
import { setLoading } from '../core/loading';
import { getSettings, subscribeSettings } from '../core/settings';
import { loadAirports } from '../feed/explore-airports';
import { nearestAirport } from './activity';
import { yieldToAircraft } from './label-yield';

// Pilot reports (PIREPs): what crews told controllers about the air they
// were flying through in the last two hours: turbulence, icing, cloud
// tops. Each is a marker where and how high the aircraft was, coloured by
// how bad it was; clicking one shows the report as filed.
//
// Source: aviationweather.gov's Data API through the nginx /wx/pirep
// proxy (five-minute cache), asked for by the airport nearest the feed's
// home. Mostly a US product: elsewhere there are few or none.
//
// Everything above the loader is pure.

const PIREP_URL = '/wx/pirep';
const POLL_MS = 5 * 60 * 1000;
const MAX_AGE_S = 2 * 3600;
const MAX_SHOWN = 80;
/** How far to look for an airport to ask by, NM. */
const STATION_SEARCH_NM = 120;

/** 0 none reported or smooth, 1 light, 2 moderate, 3 severe or extreme. */
export type Severity = 0 | 1 | 2 | 3;

export interface Pirep {
  lat: number;
  lon: number;
  /** Feet MSL; 0 when the report gave no usable level. */
  altFt: number;
  /** Epoch seconds. */
  observed: number;
  aircraft: string;
  turbulence: string;
  icing: string;
  severity: Severity;
  urgent: boolean;
  raw: string;
}

/** "LGT-MOD" → 2: the worse end of what was reported. */
export function severityOf(intensity: string): Severity {
  const text = intensity.toUpperCase();
  if (/SEV|EXTRM|EXTREME|HVY/.test(text)) return 3;
  if (/MOD/.test(text)) return 2;
  if (/LGT|LIGHT|TRACE|TRC/.test(text)) return 1;
  return 0;
}

/** Parse the API's answer; entries without a position are dropped. */
export function parsePireps(json: unknown, nowS: number): Pirep[] {
  if (!Array.isArray(json)) return [];
  const out: Pirep[] = [];
  for (const item of json as Record<string, unknown>[]) {
    const lat = item?.lat;
    const lon = item?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const observed = typeof item.obsTime === 'number' ? item.obsTime : 0;
    if (observed > 0 && nowS - observed > MAX_AGE_S) continue;
    const text = (key: string): string => (typeof item[key] === 'string' ? (item[key] as string).trim() : '');
    const turbulence = text('tbInt1');
    const icing = text('icgInt1');
    const level = typeof item.fltLvl === 'number' && Number.isFinite(item.fltLvl) ? item.fltLvl : 0;
    out.push({
      lat,
      lon,
      altFt: Math.max(0, level * 100),
      observed,
      aircraft: text('acType'),
      turbulence,
      icing,
      severity: Math.max(severityOf(turbulence), severityOf(icing)) as Severity,
      urgent: /UUA|URGENT/i.test(`${text('pirepType')} ${text('rawOb').slice(0, 12)}`),
      // The bulletin header before the station is routing, not report.
      raw: text('rawOb').replace(/^.*?\b([A-Z0-9]{3,4} UU?A )/, '$1'),
    });
  }
  // Worst first, then newest: what survives the cap is what matters.
  return out.sort((a, b) => b.severity - a.severity || b.observed - a.observed);
}

/** The marker's short text: what was reported, and the flight level. */
export function pirepSummary(p: Pick<Pirep, 'turbulence' | 'icing' | 'altFt'>): string {
  const parts: string[] = [];
  if (p.turbulence) parts.push(t('misc.pirep_turbulence', { level: p.turbulence }));
  if (p.icing) parts.push(t('misc.pirep_icing', { level: p.icing }));
  if (parts.length === 0) parts.push(t('misc.pirep_report'));
  if (p.altFt > 0) parts.push(`FL${String(Math.round(p.altFt / 100)).padStart(3, '0')}`);
  return parts.join(' · ');
}

export function pirepsActive(): boolean {
  return getSettings().pireps;
}

export function mountPireps(parent: Group): void {
  const group = new Group();
  group.name = 'pireps';
  parent.add(group);
  yieldToAircraft(group);
  let reports: Pirep[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  let loadedOnce = false;
  const tmp = new Vector3();

  const clear = (): void => {
    for (const child of Array.from(group.children)) {
      group.remove(child);
      if (child instanceof CSS2DObject) child.element.remove();
    }
  };

  const rebuild = (): void => {
    clear();
    if (!pirepsActive()) return;
    let shown = 0;
    for (const p of reports) {
      if (shown >= MAX_SHOWN) break;
      if (distanceFromHomeNm(p.lat, p.lon) > RANGE_NM) continue;
      shown++;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'aircraft-label pirep-label clickable';
      el.dataset.severity = String(p.severity);
      if (p.urgent) el.dataset.urgent = '1';
      const summary = document.createElement('span');
      summary.textContent = pirepSummary(p);
      const raw = document.createElement('span');
      raw.className = 'pirep-raw';
      raw.textContent = p.aircraft && !p.raw.includes(p.aircraft) ? `${p.aircraft} · ${p.raw}` : p.raw;
      el.append(summary, raw);
      el.title = p.raw;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        el.classList.toggle('open');
      });
      const label = new CSS2DObject(el);
      toScene(p.lat, p.lon, p.altFt, tmp);
      label.position.copy(tmp);
      group.add(label);
    }
  };

  const poll = async (): Promise<void> => {
    const mine = ++generation;
    const first = !loadedOnce;
    if (first) setLoading('pireps', t('settings.pireps'));
    try {
      const airports = await loadAirports();
      const station = nearestAirport(HOME.lat, HOME.lon, airports, STATION_SEARCH_NM)?.airport.icao;
      if (!station || !/^[A-Z0-9]{4}$/.test(station)) return;
      const res = await fetch(`${PIREP_URL}?id=${station}`);
      // 204: nothing reported near there.
      const next = res.status === 200 ? parsePireps(await res.json(), Date.now() / 1000) : res.status === 204 ? [] : null;
      if (mine !== generation || !pirepsActive() || !next) return;
      reports = next;
      loadedOnce = true;
      rebuild();
    } catch (err) {
      console.warn('[pireps] could not load', err);
    } finally {
      if (first) setLoading('pireps', null);
    }
  };

  const sync = (): void => {
    const on = pirepsActive();
    if (on && timer === undefined) {
      timer = setInterval(() => void poll(), POLL_MS);
      void poll();
    } else if (!on && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
      generation++;
      reports = [];
      loadedOnce = false;
      clear();
    }
  };

  let lastKey = '';
  subscribeSettings(() => {
    sync();
    const s = getSettings();
    const key = `${s.altitudeExaggeration}|${s.altitudeCurveBias}`;
    if (key === lastKey) return;
    lastKey = key;
    rebuild();
  });
  subscribeHome(() => {
    if (!pirepsActive()) return;
    reports = [];
    clear();
    void poll();
  });
  sync();
}
