// HUD status chrome — the single place that turns health facts into DOM.
// Session code reports raw status into core/health; this module owns the
// wording (i18n), the CSS state classes, and every status element:
// the live pulse pill, the bottom feed-status pill, the ACARS chip, the
// location subtitle + tab title, the clocks, and the footer-height CSS var.
//
// Nothing here mutates health — strictly a consumer.

import { subscribeHealth, type AcarsHealth, type FeedHealth, type FeedIdentity } from '../core/health';
import { HOME } from '../core/config';
import { t } from '../core/i18n';
import { createScope } from '../core/scope';

function statusPrefix(identity: FeedIdentity): string {
  return identity.multi ? `${identity.name} · ` : '';
}

function paintLive(el: HTMLElement, feed: FeedHealth): void {
  if (feed.mode === 'historical') {
    el.dataset.state = 'stale';
    el.textContent = t('main.status_historical');
    return;
  }
  switch (feed.state) {
    case 'connecting':
      el.dataset.state = 'stale';
      el.textContent = t('main.status_connecting');
      break;
    case 'down':
      el.dataset.state = 'down';
      el.textContent = t('main.status_down');
      break;
    case 'stale':
      el.dataset.state = 'stale';
      el.textContent = t('main.status_stale');
      break;
    case 'ok':
      el.dataset.state = 'ok';
      el.textContent = t('main.status_live');
      break;
  }
}

function paintFeedStatus(el: HTMLElement, identity: FeedIdentity, feed: FeedHealth): void {
  const prefix = statusPrefix(identity);
  if (feed.mode === 'historical') {
    if (feed.state === 'loading') {
      el.textContent = `${prefix}${t('main.historical_loading')}`;
      el.className = 'warn';
    } else if (feed.state === 'error') {
      el.textContent = `${prefix}${t('main.historical_error')}`;
      el.className = 'err';
    } else {
      el.textContent = `${prefix}${t('main.historical_counts', {
        visible: feed.visibleCount,
        total: feed.aircraftCount,
      })}`;
      el.className = 'ok';
    }
    return;
  }
  // Bottom pill is just feed identity + a short status word. Transport
  // (ws/http) is an implementation detail; the HUD pulse already conveys
  // liveness; the aircraft-count chip beside it shows the number.
  switch (feed.state) {
    case 'connecting':
      el.textContent = `${prefix}${t('main.feed_connecting')}`;
      el.className = 'warn';
      break;
    case 'down':
      el.textContent = t('main.feed_status_down', { feed: identity.name });
      el.className = 'err';
      break;
    case 'stale':
      el.textContent =
        typeof feed.feederAgeS === 'number'
          ? t('main.feed_status_stale_age', {
              feed: identity.name,
              age: Math.round(feed.feederAgeS),
            })
          : t('main.feed_status_stale', { feed: identity.name });
      el.className = 'warn';
      break;
    case 'ok':
      el.textContent = identity.name;
      el.className = 'ok';
      break;
  }
}

function paintAcars(chip: HTMLElement, label: HTMLElement, acars: AcarsHealth | null): void {
  if (!acars) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  chip.dataset.state = acars.state;
  if (acars.state === 'ok' && acars.hubAgeS !== null) {
    const ageS = Math.round(acars.hubAgeS);
    label.textContent =
      ageS < 60
        ? t('main.acars_age_seconds', { n: ageS })
        : t('main.acars_age_minutes', { n: Math.round(ageS / 60) });
  } else if (acars.state === 'stale') {
    label.textContent = t('main.acars_silent');
  } else if (acars.state === 'down') {
    label.textContent = t('main.acars_down');
  } else {
    label.textContent = t('main.acars_label');
  }
}

/**
 * Location subtitle + browser tab title, from the (mutable-in-place) HOME.
 * Called once at mount and again by the feed-switch hook after setHome().
 * Static across the session otherwise (no live count or selected aircraft)
 * so the tab doesn't flicker every render.
 */
export function refreshSubtitle(): void {
  const hudLocName = document.getElementById('hud-loc-name')!;
  const hudLocCoords = document.getElementById('hud-loc-coords')!;
  // Privacy flag from entrypoint.sh (HIDE_TOWER). When set, the HUD omits
  // the precise receiver coordinates — the map still centres on HOME, but
  // the exact lat/lon isn't spelled out on screen.
  const hideCoords = Boolean(
    (window as { TOWER_CONFIG?: { hidden?: boolean } }).TOWER_CONFIG?.hidden,
  );
  hudLocName.textContent = HOME.name;
  document.title = HOME.name ? `ADS-B 3D · ${HOME.name}` : 'ADS-B 3D';
  if (hideCoords) {
    hudLocCoords.hidden = true;
    return;
  }
  // Hemisphere-suffixed coords read more like an aviation chart and avoid
  // the awkward leading minus on western longitudes.
  const ns = HOME.lat >= 0 ? 'N' : 'S';
  const ew = HOME.lon >= 0 ? 'E' : 'W';
  hudLocCoords.textContent =
    `${Math.abs(HOME.lat).toFixed(3)}°${ns}  ${Math.abs(HOME.lon).toFixed(3)}°${ew}  ·  ${HOME.altFt.toLocaleString()} ft`;
}

function fmtHHMM(d: Date, utc: boolean): string {
  const h = utc ? d.getUTCHours() : d.getHours();
  const m = utc ? d.getUTCMinutes() : d.getMinutes();
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export function mountHud(): void {
  const scope = createScope();
  const hudLive = document.querySelector<HTMLElement>('.hud-live')!;
  const feedStatus = document.getElementById('feed-status')!;
  const hudAcars = document.getElementById('hud-acars') as HTMLElement;
  const hudAcarsLabel = document.getElementById('hud-acars-label')!;

  scope.own(
    subscribeHealth((h) => {
      paintLive(hudLive, h.feed);
      paintFeedStatus(feedStatus, h.identity, h.feed);
      paintAcars(hudAcars, hudAcarsLabel, h.acars);
    }),
  );

  refreshSubtitle();

  // Live clocks: local + UTC. Once a second is plenty for HH:MM display,
  // and pinning the update to the start of each minute would cost more
  // scheduling complexity than it saves at 1 Hz.
  const clocksEl = document.getElementById('clocks')!;
  const tickClocks = (): void => {
    const now = new Date();
    clocksEl.textContent = `${fmtHHMM(now, false)} · ${fmtHHMM(now, true)}Z`;
  };
  tickClocks();
  scope.every(1000, tickClocks);

  // Publish the actual height of the status footer as `--footer-h` on
  // :root so the sidebar + detail card can sit just above it. The footer
  // gets significantly taller in historical mode (time-controls expand
  // to a full row) and even taller on mobile when its flex-wrap kicks
  // in, so a static CSS bottom would either over- or under-shoot.
  const statusEl = document.getElementById('status') as HTMLElement;
  const publishFooterHeight = (): void => {
    // Round up so we never undershoot by a fractional pixel.
    const h = Math.ceil(statusEl.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--footer-h', `${h}px`);
  };
  publishFooterHeight();
  const ro = new ResizeObserver(publishFooterHeight);
  ro.observe(statusEl);
  scope.own(() => ro.disconnect());
}
