import type { Aircraft } from '../core/types';
import type { AircraftStore } from '../aircraft/store';
import { distanceFromHomeNm } from '../core/coords';
import { HOME } from '../core/config';
import { fetchPhoto, type PhotoInfo } from './aircraft-photo';
import { ensureRoute, getRoute, type RouteInfo } from '../feed/routes';
import { fmtAltitude, fmtDistance, fmtSpeed, fmtVerticalRate } from '../core/units';
import { getAcarsMessages, getAcarsSummary, subscribeAcars, type AcarsPhase, type AcarsSummary } from '../aircraft/acars-store';
import { getSettings, subscribeSettings } from '../core/settings';
import { t, type StringKey } from '../core/i18n';
import { elevationFtAt } from '../world/elevation';
import type { AcarsMessage } from '../feed/acars';

// Detail card pinned under the aircraft list. Re-renders every store
// snapshot (~1 Hz) so the selected aircraft's altitude/speed/etc. stay
// live. Route data comes from the shared cache in feed/routes.ts, which
// is warmed by a batched prefetcher so by the time the user clicks an
// aircraft, the route is usually already resolved.

// ADS-B emitter category → human label. From DO-260B Table 2-69 / readsb's
// category field. Anything not on this list (or null) falls back to
// suppressing the row entirely.
const CATEGORY_LABELS: Record<string, StringKey> = {
  A1: 'detail.category_light',
  A2: 'detail.category_small',
  A3: 'detail.category_large',
  A4: 'detail.category_high_vortex',
  A5: 'detail.category_heavy',
  A6: 'detail.category_high_performance',
  A7: 'detail.category_rotorcraft',
  B1: 'detail.category_glider',
  B2: 'detail.category_lighter_than_air',
  B3: 'detail.category_parachutist',
  B4: 'detail.category_ultralight',
  B6: 'detail.category_uav',
  B7: 'detail.category_spacecraft',
  C0: 'detail.category_surface_unknown',
  C1: 'detail.category_surface_emergency',
  C2: 'detail.category_surface_service',
  C3: 'detail.category_surface_obstacle',
};
function categoryLabel(cat: string | null): string | null {
  if (!cat) return null;
  const key = CATEGORY_LABELS[cat];
  return key ? t(key) : null;
}

const COMPASS: readonly StringKey[] = [
  'detail.compass_n',
  'detail.compass_ne',
  'detail.compass_e',
  'detail.compass_se',
  'detail.compass_s',
  'detail.compass_sw',
  'detail.compass_w',
  'detail.compass_nw',
];
function compass(deg: number): string {
  const idx = Math.round(((deg % 360) + 360) / 45) % 8;
  return t(COMPASS[idx]!);
}

function bearingFromHomeDeg(lat: number, lon: number): number {
  const dLon = ((lon - HOME.lon) * Math.PI) / 180;
  const lat1 = (HOME.lat * Math.PI) / 180;
  const lat2 = (lat * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function fmtAge(ms: number): string {
  const s = Math.max(0, ms / 1000);
  if (s < 60) return t('detail.seconds_ago', { n: s.toFixed(1) });
  return t('detail.minutes_ago', { n: Math.round(s / 60) });
}

export interface AircraftDetailHandle {
  setSelected(hex: string | null): void;
}

export interface AircraftDetailOptions {
  onClear: () => void;
}

export function createAircraftDetail(
  store: AircraftStore,
  options: AircraftDetailOptions
): AircraftDetailHandle {
  const root = document.getElementById('panel-detail') as HTMLElement;
  const callsignEl = document.getElementById('detail-callsign')!;
  const hexEl = document.getElementById('detail-hex')!;
  const closeBtn = document.getElementById('detail-close') as HTMLButtonElement;
  const shareBtn = document.getElementById('detail-share') as HTMLButtonElement;
  const photoLink = document.getElementById('detail-photo') as HTMLAnchorElement;
  const photoImg = document.getElementById('detail-photo-img') as HTMLImageElement;
  const photoCredit = document.getElementById('detail-photo-credit')!;
  const routeEl = document.getElementById('detail-route') as HTMLElement;
  const routeNamesEl = document.getElementById('detail-route-names') as HTMLElement;
  const routeSourceEl = document.getElementById('detail-route-source') as HTMLElement;
  const routeEtaEl = document.getElementById('detail-route-eta') as HTMLElement;
  const originEl = document.getElementById('detail-origin')!;
  const destEl = document.getElementById('detail-destination')!;
  const phaseRowEl = document.getElementById('detail-phase-row') as HTMLElement;
  const phaseEl = document.getElementById('detail-phase')!;
  const phaseAtEl = document.getElementById('detail-phase-at')!;
  const typeEl = document.getElementById('detail-type')!;
  const icaoEl = document.getElementById('detail-icao')!;
  const icaoLabelEl = document.getElementById('detail-icao-label')!;
  const regEl = document.getElementById('detail-reg')!;
  const operatorEl = document.getElementById('detail-operator')!;
  const operatorLabelEl = document.getElementById('detail-operator-label')!;
  const classEl = document.getElementById('detail-class')!;
  const classLabelEl = document.getElementById('detail-class-label')!;
  const chipsEl = document.getElementById('detail-chips') as HTMLElement;
  const altEl = document.getElementById('detail-alt')!;
  const vrateEl = document.getElementById('detail-vrate')!;
  const spdEl = document.getElementById('detail-spd')!;
  const hdgEl = document.getElementById('detail-hdg')!;
  const squawkEl = document.getElementById('detail-squawk')!;
  const posEl = document.getElementById('detail-pos')!;
  const rangeEl = document.getElementById('detail-range')!;
  const seenEl = document.getElementById('detail-seen')!;
  const apEl = document.getElementById('detail-autopilot') as HTMLElement;
  const apAltEl = document.getElementById('detail-ap-alt')!;
  const apAltLabelEl = document.getElementById('detail-ap-alt-label')!;
  const apHdgEl = document.getElementById('detail-ap-hdg')!;
  const apHdgRowDt = document.getElementById('detail-ap-hdg-label')!;
  const apQnhEl = document.getElementById('detail-ap-qnh')!;
  const apQnhRowDt = document.getElementById('detail-ap-qnh-label')!;
  const apModesEl = document.getElementById('detail-ap-modes')!;
  const apModesRowDt = document.getElementById('detail-ap-modes-label')!;
  const acarsSection = document.getElementById('detail-acars') as HTMLElement;
  const acarsCountEl = document.getElementById('detail-acars-count')!;
  const acarsListEl = document.getElementById('detail-acars-list')!;

  let selectedHex: string | null = null;
  let pendingRoute: string | null = null;
  let pendingPhotoHex: string | null = null;

  closeBtn.addEventListener('click', () => options.onClear());

  // Click-to-copy on the callsign and hex header. Useful for pasting into
  // Flightradar/Flightaware/etc. Brief "copied" flash provides feedback.
  function attachCopy(el: HTMLElement, getText: () => string | null): void {
    el.classList.add('copyable');
    el.title = t('detail.click_to_copy');
    el.addEventListener('click', () => {
      const text = getText();
      if (!text) return;
      void navigator.clipboard?.writeText(text).then(() => {
        el.classList.add('copied');
        setTimeout(() => el.classList.remove('copied'), 800);
      });
    });
  }
  attachCopy(callsignEl, () => callsignEl.textContent);
  attachCopy(hexEl, () => hexEl.textContent);

  // Share button — copy a deep link to the selected aircraft. The link
  // carries the active feed (?feed=) and the aircraft hash (#hex) so it
  // reopens on the same plane.
  shareBtn.addEventListener('click', () => {
    if (!selectedHex) return;
    const url =
      window.location.origin +
      window.location.pathname +
      window.location.search +
      '#' +
      selectedHex;
    void navigator.clipboard?.writeText(url).then(() => {
      shareBtn.classList.add('copied');
      setTimeout(() => shareBtn.classList.remove('copied'), 800);
    });
  });

  function showPhoto(info: PhotoInfo | null): void {
    if (!info) {
      photoLink.hidden = true;
      photoImg.src = '';
      return;
    }
    photoImg.src = info.thumbUrl;
    photoLink.href = info.link || '#';
    photoCredit.textContent = info.photographer ? `© ${info.photographer} · planespotters.net` : 'planespotters.net';
    photoLink.hidden = false;
  }

  function updatePhoto(a: Aircraft): void {
    if (pendingPhotoHex === a.hex) return;
    pendingPhotoHex = a.hex;
    photoLink.hidden = true; // hide while loading; pops in when resolved
    const targetHex = a.hex;
    void fetchPhoto(a.hex, a.registration).then((info) => {
      if (selectedHex === targetHex) showPhoto(info);
    });
  }

  function updateRoute(a: Aircraft): void {
    const acars = getAcarsSummary(a.hex);
    if (!a.callsign) {
      // No callsign means no adsb.im lookup is possible. ACARS may still
      // have given us a destination via flight/reg pending resolution.
      applyCombinedRoute(null, acars);
      pendingRoute = null;
      return;
    }
    const cached = getRoute(a.callsign);
    if (cached === undefined) {
      if (pendingRoute !== a.callsign) {
        pendingRoute = a.callsign;
        const target = a.callsign;
        void ensureRoute(target).then(() => {
          if (selectedHex && store.snapshot.get(selectedHex)?.callsign === target) {
            const sa = store.snapshot.get(selectedHex);
            if (sa) updateRoute(sa);
          }
        });
      }
      // Even before adsb.im responds, render what ACARS tells us so the
      // user gets the destination without waiting on the slow path.
      applyCombinedRoute(null, acars);
      return;
    }
    applyCombinedRoute(cached, acars);
  }

  function applyCombinedRoute(http: RouteInfo | null, acars: AcarsSummary | null): void {
    // Precedence: ACARS destination wins over adsb.im. Origin from
    // adsb.im (ACARS rarely carries it). ETA only from ACARS.
    const destination = acars?.destination ?? http?.destination ?? null;
    const origin = http?.origin ?? null;
    const acarsDestActive = !!(acars?.destination);

    if (!destination && !origin) {
      routeEl.hidden = true;
      routeNamesEl.hidden = true;
      routeEtaEl.hidden = true;
      return;
    }

    originEl.textContent = origin ?? '?';
    destEl.textContent = destination ?? '?';
    routeEl.hidden = false;

    if (acarsDestActive) {
      routeSourceEl.textContent = t('detail.route_source_acars');
      routeSourceEl.hidden = false;
      routeSourceEl.title = t('detail.route_source_acars_tooltip');
    } else {
      routeSourceEl.hidden = true;
    }

    // Names line — only meaningful when adsb.im supplied them and its
    // destination isn't being overridden by ACARS (otherwise the names
    // wouldn't match the ACARS code).
    if (http && !acarsDestActive && (http.origin_name || http.destination_name)) {
      routeNamesEl.innerHTML = `<span>${http.origin_name ?? ''}</span><span>${http.destination_name ?? ''}</span>`;
      routeNamesEl.hidden = false;
    } else if (http && acarsDestActive && http.origin_name) {
      // Origin from adsb.im is still trustworthy; show it alone.
      routeNamesEl.innerHTML = `<span>${http.origin_name}</span><span></span>`;
      routeNamesEl.hidden = false;
    } else {
      routeNamesEl.hidden = true;
    }

    if (acars?.eta) {
      routeEtaEl.textContent = t('detail.eta', { time: formatAcarsTime(acars.eta) });
      routeEtaEl.hidden = false;
    } else {
      routeEtaEl.hidden = true;
    }
  }

  function formatAcarsTime(raw: string): string {
    // acarshub OOOI/ETA timestamps are typically HHMM or HHMMSS UTC.
    // Show "1842Z"; fall back to the raw string if it doesn't parse.
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits.length >= 4) {
      return `${digits.slice(0, 2)}${digits.slice(2, 4)}Z`;
    }
    return raw;
  }

  const PHASE_LABELS: Record<AcarsPhase, StringKey> = {
    'at-gate': 'detail.phase_at_gate',
    'taxi-out': 'detail.phase_taxi_out',
    'airborne': 'detail.phase_airborne',
    'taxi-in': 'detail.phase_taxi_in',
    'at-gate-dest': 'detail.phase_arrival_gate',
  };

  function updatePhase(a: Aircraft): void {
    const summary = getAcarsSummary(a.hex);
    if (!summary || !summary.phase) {
      phaseRowEl.hidden = true;
      return;
    }
    phaseRowEl.hidden = false;
    phaseEl.textContent = t(PHASE_LABELS[summary.phase]);
    phaseEl.dataset.phase = summary.phase;
    if (summary.phaseAt) {
      const ageMs = Date.now() - Date.parse(summary.phaseAt);
      phaseAtEl.textContent = Number.isFinite(ageMs) ? fmtAge(ageMs) : '';
      phaseAtEl.hidden = !phaseAtEl.textContent;
    } else {
      phaseAtEl.hidden = true;
    }
  }

  function render(): void {
    if (!selectedHex) {
      root.hidden = true;
      return;
    }
    const a = store.snapshot.get(selectedHex);
    if (!a) {
      // Aircraft fell out of the feed. Keep the card visible briefly with stale data
      // so the user knows what happened — easier than blanking the panel.
      root.hidden = false;
      return;
    }
    root.hidden = false;

    callsignEl.textContent = a.callsign ?? a.registration ?? a.hex.toUpperCase();
    hexEl.textContent = a.hex.toUpperCase();

    // Type: prefer the human description ("Boeing 737-800") and tuck the
    // ICAO designator on its own row when both are present. If we only have
    // the designator, show it as the primary type and skip the second row.
    if (a.description && a.typeCode) {
      typeEl.textContent = a.description;
      icaoEl.textContent = a.typeCode;
      icaoEl.hidden = false;
      icaoLabelEl.hidden = false;
    } else {
      typeEl.textContent = a.description ?? a.typeCode ?? '—';
      icaoEl.hidden = true;
      icaoLabelEl.hidden = true;
    }
    regEl.textContent = a.registration ?? '—';
    setRow(operatorLabelEl, operatorEl, t('detail.operator'), a.operator);
    setRow(classLabelEl, classEl, t('detail.class'), categoryLabel(a.category));
    renderChips(a);

    // With 3D terrain data present, append height above ground — only when
    // the ground is meaningfully elevated (≥100 ft) so sea-level
    // deployments don't show a redundant near-identical AGL.
    const groundFt = elevationFtAt(a.lat, a.lon);
    altEl.textContent = a.onGround
      ? t('detail.on_ground')
      : groundFt >= 100
        ? `${fmtAltitude(a.altFt)} · ${t('detail.agl', { agl: fmtAltitude(Math.max(0, a.altFt - groundFt)) })}`
        : fmtAltitude(a.altFt);

    if (a.verticalRateFpm === null) {
      vrateEl.innerHTML = '<span class="level">—</span>';
    } else if (Math.abs(a.verticalRateFpm) < 100) {
      vrateEl.innerHTML = `<span class="level">${t('detail.vertical_level')}</span>`;
    } else if (a.verticalRateFpm > 0) {
      vrateEl.innerHTML = `<span class="climb">↑ ${fmtVerticalRate(a.verticalRateFpm)}</span>`;
    } else {
      vrateEl.innerHTML = `<span class="descend">↓ ${fmtVerticalRate(a.verticalRateFpm)}</span>`;
    }

    spdEl.textContent = fmtSpeed(a.groundSpeedKt);

    if (a.trackDeg === null) {
      hdgEl.textContent = '—';
    } else {
      hdgEl.textContent = `${Math.round(a.trackDeg)}° ${compass(a.trackDeg)}`;
    }

    squawkEl.textContent = a.squawk ?? '—';

    posEl.textContent = `${a.lat.toFixed(3)}, ${a.lon.toFixed(3)}`;

    const dist = distanceFromHomeNm(a.lat, a.lon);
    const bearing = bearingFromHomeDeg(a.lat, a.lon);
    rangeEl.textContent = `${fmtDistance(dist)} · ${Math.round(bearing)}° ${compass(bearing)}`;

    seenEl.textContent = fmtAge(Date.now() - a.lastSeenMs);

    updateAutopilot(a);
    updateAcars(a);
    updatePhase(a);
    updateRoute(a);
    updatePhoto(a);
  }

  function fmtAcarsAge(timeIso: string): string {
    const ms = Date.now() - Date.parse(timeIso);
    if (Number.isNaN(ms) || ms < 0) return '';
    const s = Math.max(0, ms / 1000);
    if (s < 60) return t('detail.seconds_ago', { n: Math.round(s) });
    if (s < 3600) return t('detail.minutes_ago', { n: Math.round(s / 60) });
    return t('detail.hours_ago', { n: Math.round(s / 3600) });
  }

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => {
      switch (c) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return '&#39;';
      }
    });
  }

  function renderAcarsRow(m: AcarsMessage): string {
    const label = m.label ? `<span class="acars-label">${escapeHtml(m.label)}</span>` : '';
    const age = `<span class="acars-age">${fmtAcarsAge(m.time)}</span>`;
    // Compact ident line: msg sequence (with block id), freq, signal,
    // decode error count if non-zero. Only render parts we have.
    const idParts: string[] = [];
    if (m.msgNum) {
      idParts.push(m.blockId ? `${escapeHtml(m.blockId)}/${escapeHtml(m.msgNum)}` : escapeHtml(m.msgNum));
    } else if (m.blockId) {
      idParts.push(escapeHtml(m.blockId));
    }
    if (m.freq) idParts.push(`${escapeHtml(m.freq)} MHz`);
    if (typeof m.level === 'number') idParts.push(`${m.level} dB`);
    if (typeof m.error === 'number' && m.error > 0) idParts.push(t('detail.acars_err', { n: m.error }));
    const meta = idParts.length ? `<div class="acars-meta">${idParts.join(' · ')}</div>` : '';
    // OOOI / route bits carried by THIS message — useful for debugging
    // and surfacing the timestamp when an event landed.
    const facts: string[] = [];
    if (m.destination) facts.push(`→ ${escapeHtml(m.destination)}`);
    if (m.eta) facts.push(t('detail.eta', { time: escapeHtml(m.eta) }));
    if (m.gtout) facts.push(t('detail.acars_out', { time: escapeHtml(m.gtout) }));
    if (m.wloff) facts.push(t('detail.acars_off', { time: escapeHtml(m.wloff) }));
    if (m.wlin) facts.push(t('detail.acars_on', { time: escapeHtml(m.wlin) }));
    if (m.gtin) facts.push(t('detail.acars_in', { time: escapeHtml(m.gtin) }));
    if (m.position) {
      facts.push(t('detail.acars_pos', { coords: `${m.position.lat.toFixed(2)},${m.position.lon.toFixed(2)}` }));
    }
    const factsHtml = facts.length ? `<div class="acars-facts">${facts.join(' · ')}</div>` : '';
    const text = m.text ? escapeHtml(m.text).replace(/\n/g, '<br>') : `<span class="acars-empty">${t('detail.acars_no_text')}</span>`;
    return `<li class="acars-msg">${label}${age}${meta}${factsHtml}<div class="acars-text">${text}</div></li>`;
  }

  function updateAcars(a: Aircraft): void {
    if (!getSettings().acarsMessages) {
      acarsSection.hidden = true;
      return;
    }
    const messages = getAcarsMessages(a.hex);
    if (messages.length === 0) {
      acarsSection.hidden = true;
      return;
    }
    acarsSection.hidden = false;
    acarsCountEl.textContent = String(messages.length);
    acarsListEl.innerHTML = messages.map(renderAcarsRow).join('');
  }

  function renderChips(a: Aircraft): void {
    const chips: Array<{ label: string; cls: string }> = [];
    if (a.emergency) chips.push({ label: a.emergency.toUpperCase(), cls: 'emergency' });
    if (a.military) chips.push({ label: t('detail.chip_military'), cls: 'military' });
    if (a.specialInterest) chips.push({ label: t('detail.chip_special_interest'), cls: 'special' });
    if (a.privacyIcao) chips.push({ label: t('detail.chip_pia'), cls: '' });
    if (a.ladd) chips.push({ label: t('detail.chip_ladd'), cls: '' });
    if (chips.length === 0) {
      chipsEl.hidden = true;
      chipsEl.textContent = '';
      return;
    }
    chipsEl.hidden = false;
    chipsEl.innerHTML = chips
      .map((c) => `<span class="chip${c.cls ? ` ${c.cls}` : ''}">${c.label}</span>`)
      .join('');
  }

  function setRow(dt: HTMLElement, dd: HTMLElement, label: string, value: string | null): boolean {
    if (value === null) {
      dt.hidden = true;
      dd.hidden = true;
      return false;
    }
    dt.hidden = false;
    dd.hidden = false;
    dt.textContent = label;
    dd.textContent = value;
    return true;
  }

  function updateAutopilot(a: Aircraft): void {
    let any = false;

    // Prefer MCP altitude (panel selector); fall back to FMS if that's all
    // we have. Label tracks which one we're showing.
    const hasMcp = a.apAltMcpFt !== null;
    const hasFms = a.apAltFmsFt !== null;
    if (hasMcp || hasFms) {
      const altFt = (hasMcp ? a.apAltMcpFt : a.apAltFmsFt) as number;
      apAltLabelEl.textContent = hasMcp ? t('detail.selected_altitude') : t('detail.fms_altitude');
      apAltEl.textContent = fmtAltitude(altFt);
      apAltLabelEl.hidden = false;
      apAltEl.hidden = false;
      any = true;
    } else {
      apAltLabelEl.hidden = true;
      apAltEl.hidden = true;
    }

    if (setRow(apHdgRowDt, apHdgEl, t('detail.selected_heading'),
               a.apHeadingDeg === null ? null : `${Math.round(a.apHeadingDeg)}° ${compass(a.apHeadingDeg)}`)) {
      any = true;
    }
    if (setRow(apQnhRowDt, apQnhEl, t('detail.qnh'),
               a.apQnhHpa === null ? null : `${a.apQnhHpa.toFixed(0)} hPa`)) {
      any = true;
    }
    if (setRow(apModesRowDt, apModesEl, t('detail.autopilot_modes'),
               a.apModes === null ? null : a.apModes.join(', '))) {
      any = true;
    }

    apEl.hidden = !any;
  }

  store.subscribe(render);

  // ACARS messages arrive out-of-band from the store, but the panel only
  // re-renders on store snapshots. Hook the acars store + the settings
  // toggle so a new message for the selected aircraft repaints the panel
  // immediately, and so toggling the setting hides/shows the section.
  // Unsubscribe handles intentionally discarded — page-lifetime singleton.
  subscribeAcars((hex) => {
    if (!selectedHex) return;
    if (hex === '' || hex === selectedHex) render();
  });
  subscribeSettings(() => {
    if (selectedHex) render();
  });

  return {
    setSelected(hex) {
      selectedHex = hex;
      pendingRoute = null;
      pendingPhotoHex = null;
      photoLink.hidden = true;
      photoImg.src = '';
      render();
    }
  };
}
