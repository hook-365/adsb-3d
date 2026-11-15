import { HOME, subscribeHome } from '../core/config';
import { t } from '../core/i18n';
import { setLoading } from '../core/loading';

// Airport weather: the current METAR of every reporting station around
// the feed's home, and an airport's TAF on request. Subscribe-pattern
// singleton; the airports layer tints its labels by flight category from
// it and the airport card prints the rest.
//
// Source: aviationweather.gov (US National Weather Service, keyless,
// worldwide stations) through the nginx /wx/ proxies, which cache it:
// their API may not be called from a browser. Nothing is fetched until
// the airports layer is on.
//
// The parsers are pure.

const METAR_URL = '/wx/metar';
const TAF_URL = '/wx/taf';
const POLL_MS = 5 * 60 * 1000;
/** Half-size of the box asked for, NM. The API returns at most 400 stations. */
const BOX_NM = 150;

export type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR';

export interface Metar {
  icao: string;
  /** Null when the station does not report enough to say. */
  category: FlightCategory | null;
  tempC: number | null;
  dewpointC: number | null;
  /** Degrees true, or 'VRB'; null when calm or missing. */
  windDir: number | 'VRB' | null;
  windKt: number | null;
  gustKt: number | null;
  /** Statute miles as published ("10+", "3", "1 1/2"). */
  visibility: string | null;
  altimeterHpa: number | null;
  /** Base of the lowest broken or overcast layer, feet AGL; null when none. */
  ceilingFt: number | null;
  /** Epoch seconds of the observation. */
  observed: number | null;
  raw: string;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const CATEGORIES = new Set<string>(['VFR', 'MVFR', 'IFR', 'LIFR']);

/** Pure: the API's METAR array → station id → observation. Junk rows are skipped. */
export function parseMetars(json: unknown): Map<string, Metar> {
  const out = new Map<string, Metar>();
  if (!Array.isArray(json)) return out;
  for (const row of json as Record<string, unknown>[]) {
    const icao = typeof row?.icaoId === 'string' ? row.icaoId.toUpperCase() : '';
    if (!/^[A-Z0-9]{4}$/.test(icao)) continue;
    let ceiling: number | null = null;
    if (Array.isArray(row.clouds)) {
      for (const layer of row.clouds as { cover?: unknown; base?: unknown }[]) {
        const base = num(layer?.base);
        if ((layer?.cover === 'BKN' || layer?.cover === 'OVC' || layer?.cover === 'OVX') && base !== null) {
          if (ceiling === null || base < ceiling) ceiling = base;
        }
      }
    }
    const dir = row.wdir === 'VRB' ? 'VRB' : num(row.wdir);
    const speed = num(row.wspd);
    out.set(icao, {
      icao,
      category: typeof row.fltCat === 'string' && CATEGORIES.has(row.fltCat) ? (row.fltCat as FlightCategory) : null,
      tempC: num(row.temp),
      dewpointC: num(row.dewp),
      windDir: speed === 0 ? null : dir,
      windKt: speed,
      gustKt: num(row.wgst),
      visibility: typeof row.visib === 'string' ? row.visib : num(row.visib) !== null ? String(row.visib) : null,
      altimeterHpa: num(row.altim),
      ceilingFt: ceiling,
      observed: num(row.obsTime),
      raw: typeof row.rawOb === 'string' ? row.rawOb : '',
    });
  }
  return out;
}

/** Pure: the newest TAF's text from the API's answer, or null. */
export function parseTaf(json: unknown): string | null {
  if (!Array.isArray(json)) return null;
  for (const row of json as Record<string, unknown>[]) {
    if (typeof row?.rawTAF === 'string' && row.rawTAF.trim() !== '') return row.rawTAF.trim();
  }
  return null;
}

/** Pure: a raw TAF with each change group on its own line, as a pilot reads it. */
export function formatTaf(raw: string): string {
  return raw.replace(/\s+(FM\d{6}|TEMPO|BECMG|PROB\d{2})\b/g, '\n  $1');
}

/** Pure: "bbox" argument for a box of half-size `nm` around a point, to 0.1 degree. */
export function metarBox(lat: number, lon: number, nm = BOX_NM): string {
  const dLat = nm / 60;
  const dLon = nm / (60 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const r = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);
  return [r(Math.max(-90, lat - dLat)), r(lon - dLon), r(Math.min(90, lat + dLat)), r(lon + dLon)].join(',');
}

// ── Loader ──────────────────────────────────────────────────────────

let metars = new Map<string, Metar>();
let wanted = false;
let timer: ReturnType<typeof setInterval> | undefined;
let generation = 0;
let loadedOnce = false;
const listeners = new Set<() => void>();

export function getMetar(icao: string): Metar | null {
  return metars.get(icao) ?? null;
}

export function subscribeAirportWeather(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function publish(next: Map<string, Metar>): void {
  if (next.size === 0 && metars.size === 0) return;
  metars = next;
  for (const fn of listeners) fn();
}

async function poll(): Promise<void> {
  const mine = ++generation;
  const first = !loadedOnce;
  if (first) setLoading('airport-weather', t('settings.airport_weather'));
  try {
    const res = await fetch(`${METAR_URL}?bbox=${metarBox(HOME.lat, HOME.lon)}`);
    // 204: no stations in the box.
    const next = res.status === 200 ? parseMetars(await res.json()) : null;
    if (mine !== generation || !wanted) return;
    if (next) publish(next);
    loadedOnce = true;
  } catch {
    // Offline or the service is down: keep what is shown.
  } finally {
    if (first) setLoading('airport-weather', null);
  }
}

/** Start or stop fetching; called by the airports layer with its toggle. */
export function setAirportWeatherWanted(on: boolean): void {
  if (on === wanted) return;
  wanted = on;
  clearInterval(timer);
  timer = undefined;
  if (on) {
    timer = setInterval(() => void poll(), POLL_MS);
    void poll();
  } else {
    generation++;
    publish(new Map());
  }
}

subscribeHome(() => {
  if (!wanted) return;
  publish(new Map());
  loadedOnce = false;
  void poll();
});

/** One airport's forecast as text, or null when it has none. */
export async function fetchTaf(icao: string): Promise<string | null> {
  try {
    const res = await fetch(`${TAF_URL}?ids=${encodeURIComponent(icao)}`);
    return res.status === 200 ? parseTaf(await res.json()) : null;
  } catch {
    return null;
  }
}
