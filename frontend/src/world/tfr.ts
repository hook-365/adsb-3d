import { HOME, RANGE_NM, subscribeHome } from '../core/config';
import { t } from '../core/i18n';
import { setLoading } from '../core/loading';
import { distanceToVolumeNm, type AirspaceVolume } from './airspace-volumes';

// Temporary flight restrictions (US): the one live part of the airspace
// layer. A TFR is a NOTAM that closes or restricts a patch of sky for a
// while (a wildfire, a stadium, a launch, a VIP), so unlike the charted
// airspace in airspace-data.json it cannot be baked into the image.
//
// Source: the FAA's own TFR site, through two nginx proxies so the browser
// never talks to the FAA and one deployment makes one cached request:
//   /tfr/list            every listed TFR with its outline (GeoJSON), but
//                        no altitudes or times
//   /tfr/detail/<id>.xml one NOTAM: floors, ceilings, times, the outline
//                        again and the NOTAM text
// The list is filtered to the scope first, so only the handful of TFRs
// near the feed's home cost a detail request. Nothing is fetched until the
// toggle is on.
//
// Each restricted area becomes an AirspaceVolume of kind 'TFR' carrying a
// `tfr` record, so world/airspace.ts draws, labels and highlights it like
// any other volume and the info card can describe it.
//
// The parsers are pure (and regex-based rather than DOMParser: the XML is
// machine-written and regular, and this keeps them testable under node).

const LIST_URL = '/tfr/list';
const POLL_MS = 10 * 60 * 1000;
/** Drawing cap for a ceiling published as unlimited, feet. */
const UNLIMITED_FT = 60000;

export interface TfrInfo {
  /** NOTAM number, "6/7567". */
  notam: string;
  /** FAA list category: "HAZARDS", "VIP", "SECURITY", "SPACE OPERATIONS"... */
  type: string;
  /** Regulation the restriction is issued under, "91.137(a)(2)". */
  rule: string;
  place: string;
  purpose: string;
  /** The NOTAM as published. */
  text: string;
  /** Epoch ms; expire is null for "until further notice". */
  effective: number | null;
  expire: number | null;
}

export interface TfrListEntry {
  notam: string;
  type: string;
  /** [west, south, east, north] over every area of the NOTAM. */
  bbox: [number, number, number, number];
}

/** Pure: the WFS feature list reduced to one entry per NOTAM. */
export function parseTfrList(json: unknown): TfrListEntry[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const byNotam = new Map<string, TfrListEntry>();
  for (const f of features as { geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> }[]) {
    const key = f?.properties?.NOTAM_KEY;
    if (typeof key !== 'string') continue;
    const notam = key.split('-')[0]!;
    if (!/^\d+\/\d+$/.test(notam)) continue;
    const entry = byNotam.get(notam) ?? {
      notam,
      type: typeof f.properties?.LEGAL === 'string' ? f.properties.LEGAL : '',
      bbox: [Infinity, Infinity, -Infinity, -Infinity],
    };
    // Polygon or MultiPolygon: walk every number pair, whatever the depth.
    const walk = (node: unknown): void => {
      if (!Array.isArray(node)) return;
      if (typeof node[0] === 'number' && typeof node[1] === 'number') {
        const [lon, lat] = node as number[];
        if (lon! < entry.bbox[0]) entry.bbox[0] = lon!;
        if (lat! < entry.bbox[1]) entry.bbox[1] = lat!;
        if (lon! > entry.bbox[2]) entry.bbox[2] = lon!;
        if (lat! > entry.bbox[3]) entry.bbox[3] = lat!;
        return;
      }
      for (const child of node) walk(child);
    };
    walk(f.geometry?.coordinates);
    if (Number.isFinite(entry.bbox[0])) byNotam.set(notam, entry);
  }
  return Array.from(byNotam.values());
}

function blocks(xml: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g');
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1]!);
  return out;
}

function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  if (!m) return '';
  return m[1]!
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/** "29.95375907N" / "090.06775836W" → signed degrees. */
export function parseTfrCoord(text: string): number {
  const m = /^\s*([\d.]+)\s*([NSEW])\s*$/.exec(text);
  if (!m) return Number.NaN;
  const v = Number.parseFloat(m[1]!);
  return m[2] === 'S' || m[2] === 'W' ? -v : v;
}

/** One vertical limit: HEI is height above ground, ALT is MSL, STD a flight level. */
function limit(code: string, val: string, uom: string): { ft: number; agl: boolean; unlimited: boolean } {
  const n = Number.parseFloat(val);
  if (!Number.isFinite(n) || code === 'UNL') return { ft: UNLIMITED_FT, agl: false, unlimited: true };
  const ft = uom === 'FL' || code === 'STD' ? n * 100 : n;
  return { ft, agl: code === 'HEI', unlimited: false };
}

function when(text: string, zone: string): number | null {
  if (!text) return null;
  const ms = Date.parse(zone === 'UTC' || zone === '' ? `${text}Z` : text);
  return Number.isFinite(ms) ? ms : null;
}

/** "2026-11-14 18:29Z" */
export function tfrTime(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

/**
 * Pure: one NOTAM's detail XML → a volume per restricted area. `type` is
 * the list category, which the XML does not carry.
 */
export function parseTfrDetail(xml: string, type = ''): AirspaceVolume[] {
  const notam = tag(xml, 'txtLocalName');
  if (!notam) return [];
  // The NOTAM-level dates precede the per-area ScheduleGroup copies.
  const head = xml.split('<TfrNot>')[0]!;
  const effective = when(tag(head, 'dateEffective'), tag(head, 'codeTimeZone'));
  const expire = when(tag(head, 'dateExpire'), tag(head, 'codeExpirationTimeZone') || tag(head, 'codeTimeZone'));
  const city = tag(head, 'txtNameCity');
  const state = tag(head, 'txtNameUSState');
  const info: TfrInfo = {
    notam,
    type,
    rule: tag(blocks(xml, 'TfrNot')[0] ?? '', 'codeType'),
    place: [city, state].filter(Boolean).join(', '),
    purpose: tag(head, 'txtDescrPurpose'),
    text: tag(xml, 'txtDescrTraditional'),
    effective,
    expire,
  };
  const times = effective === null ? null : `${tfrTime(effective)} to ${expire === null ? 'further notice' : tfrTime(expire)}`;
  const out: AirspaceVolume[] = [];
  for (const group of blocks(xml, 'TFRAreaGroup')) {
    const area = blocks(group, 'aseTFRArea')[0] ?? '';
    const merged = blocks(group, 'abdMergedArea')[0] ?? '';
    const ring: number[] = [];
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const avx of blocks(merged, 'Avx')) {
      const lat = parseTfrCoord(tag(avx, 'geoLat'));
      const lon = parseTfrCoord(tag(avx, 'geoLong'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      ring.push(lon, lat);
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
    // The outline is published closed; the renderer wants it open.
    if (ring.length >= 4 && ring[0] === ring[ring.length - 2] && ring[1] === ring[ring.length - 1]) ring.length -= 2;
    if (ring.length < 6) continue;
    const lo = limit(tag(area, 'codeDistVerLower'), tag(area, 'valDistVerLower'), tag(area, 'uomDistVerLower'));
    const hi = limit(tag(area, 'codeDistVerUpper'), tag(area, 'valDistVerUpper'), tag(area, 'uomDistVerUpper'));
    out.push({
      name: `TFR ${notam}`,
      kind: 'TFR',
      sector: tag(area, 'txtName') || null,
      loFt: lo.unlimited ? 0 : lo.ft,
      hiFt: hi.ft,
      loAgl: lo.agl,
      hiAgl: hi.agl,
      unlimited: hi.unlimited,
      times,
      polygons: [[ring]],
      bbox: [west, south, east, north],
      tfr: info,
    });
  }
  return out;
}

/** "6/7567" → "/tfr/detail/6_7567.xml" */
export function tfrDetailUrl(notam: string): string {
  return `/tfr/detail/${notam.replace('/', '_')}.xml`;
}

/** Still in force or yet to start. */
export function tfrCurrent(v: AirspaceVolume, now: number): boolean {
  return !v.tfr || v.tfr.expire === null || v.tfr.expire > now;
}

// ── Loader ──────────────────────────────────────────────────────────
// Subscribe-pattern singleton, polled only while something wants it.

let volumes: AirspaceVolume[] = [];
let wanted = false;
let timer: ReturnType<typeof setInterval> | undefined;
let generation = 0;
let loadedOnce = false;
const details = new Map<string, AirspaceVolume[]>();
const listeners = new Set<() => void>();

/** TFR volumes near the feed's home; empty until loaded or while off. */
export function getTfrs(): readonly AirspaceVolume[] {
  return volumes;
}

export function subscribeTfrs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function publish(next: AirspaceVolume[]): void {
  if (next.length === 0 && volumes.length === 0) return;
  volumes = next;
  for (const fn of listeners) fn();
}

async function poll(): Promise<void> {
  const mine = ++generation;
  // Toast for the first fetch of a place only; refreshes are silent.
  const first = !loadedOnce;
  if (first) setLoading('tfr', t('settings.airspace_tfr'));
  try {
    const res = await fetch(LIST_URL);
    if (!res.ok) return;
    const list = parseTfrList(await res.json());
    const near = list.filter(
      (e) => distanceToVolumeNm(e, HOME.lat, HOME.lon) <= RANGE_NM,
    );
    const found = await Promise.all(
      near.map(async (entry) => {
        const cached = details.get(entry.notam);
        if (cached) return cached;
        try {
          const detail = await fetch(tfrDetailUrl(entry.notam));
          if (!detail.ok) return [];
          const parsed = parseTfrDetail(await detail.text(), entry.type);
          details.set(entry.notam, parsed);
          return parsed;
        } catch {
          return [];
        }
      }),
    );
    // A feed switch or the toggle going off while this was in flight.
    if (mine !== generation || !wanted) return;
    // A NOTAM that left the list is over; drop its cached detail too.
    const listed = new Set(list.map((e) => e.notam));
    for (const key of details.keys()) if (!listed.has(key)) details.delete(key);
    const now = Date.now();
    publish(found.flat().filter((v) => tfrCurrent(v, now)));
    loadedOnce = true;
  } catch {
    // Offline or the FAA site is down: keep what is drawn.
  } finally {
    if (first) setLoading('tfr', null);
  }
}

/** Start or stop fetching; called by the airspace layer with its toggle. */
export function setTfrsWanted(on: boolean): void {
  if (on === wanted) return;
  wanted = on;
  clearInterval(timer);
  timer = undefined;
  if (on) {
    timer = setInterval(() => void poll(), POLL_MS);
    void poll();
  } else {
    generation++;
    publish([]);
  }
}

subscribeHome(() => {
  if (!wanted) return;
  publish([]);
  loadedOnce = false;
  void poll();
});
