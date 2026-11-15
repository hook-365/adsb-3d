import { t } from '../core/i18n';
import { subscribeHome } from '../core/config';
import { subscribeSettings } from '../core/settings';
import {
  AIRSPACE_COLORS,
  airspaceActive,
  airspaceLimits,
  countInside,
  pinAirspace,
  type AirspaceSelection,
} from '../world/airspace';
import { airspaceTitle, limitsMsl, type AirspaceKind, type AirspaceVolume } from '../world/airspace-volumes';
import type { Aircraft } from '../core/types';

// Airspace info card: opened by clicking an airspace's name label (the
// same click frames it in 3D). Says what the airspace is and what entering
// it takes, its overall limits, each shelf's floor and ceiling, published
// times of use for special use airspace, and how many of the aircraft on
// screen are inside it right now. It sits in the aircraft detail card's
// slot; selecting an aircraft closes it and opening it clears a selection
// (main.ts), so only one of the two is ever up.
//
// While open, its volumes stay highlighted in the scene (pinAirspace).

export interface AirspacePanel {
  show(selection: AirspaceSelection): void;
  hide(): void;
}

const KIND_KEY = { B: 'b', C: 'c', D: 'd', MOA: 'moa', R: 'r', P: 'p', W: 'w', A: 'a' } as const satisfies Record<AirspaceKind, string>;
const COUNT_INTERVAL_MS = 2000;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Shelves lowest floor first; identical rows (the FAA repeats some) collapse. */
export function shelfRows(volumes: readonly AirspaceVolume[]): { label: string; limits: string }[] {
  const seen = new Set<string>();
  const rows: { label: string; limits: string; lo: number }[] = [];
  for (const v of volumes) {
    const limits = airspaceLimits(v);
    const label = v.sector ? airspaceTitle(v.sector) : '';
    const key = `${label}|${limits}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ label, limits, lo: limitsMsl(v, 0).lo });
  }
  rows.sort((a, b) => a.lo - b.lo || a.label.localeCompare(b.label));
  return rows.map(({ label, limits }) => ({ label, limits }));
}

export function mountAirspacePanel(getAircraft: () => Iterable<Aircraft>): AirspacePanel {
  const root = el('section', 'airspace-panel');
  root.hidden = true;
  root.setAttribute('aria-live', 'polite');

  const header = el('header');
  const ident = el('div', 'airspace-ident');
  const dot = el('span', 'airspace-dot');
  const title = el('span', 'airspace-title');
  ident.append(dot, title);
  const close = el('button', 'close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', t('misc.airspace_close'));
  header.append(ident, close);

  const kind = el('div', 'airspace-kind');
  const about = el('p', 'airspace-about');
  const grid = el('dl', 'grid');
  const limitsLabel = el('dt', undefined, t('misc.airspace_limits_label'));
  const limitsValue = el('dd');
  const insideLabel = el('dt', undefined, t('misc.airspace_inside'));
  const insideValue = el('dd');
  const timesLabel = el('dt', undefined, t('misc.airspace_times'));
  const timesValue = el('dd', 'airspace-times');
  grid.append(limitsLabel, limitsValue, insideLabel, insideValue, timesLabel, timesValue);
  const shelvesHeading = el('h3', undefined, t('misc.airspace_shelves'));
  const shelves = el('dl', 'grid airspace-shelves');
  const note = el('p', 'airspace-note', t('misc.airspace_note'));
  root.append(header, kind, about, grid, shelvesHeading, shelves, note);
  document.body.appendChild(root);

  let current: AirspaceSelection | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const refreshCount = (): void => {
    if (current) insideValue.textContent = String(countInside(current.volumes, getAircraft()));
  };

  const hide = (): void => {
    if (!current) return;
    current = null;
    root.hidden = true;
    clearInterval(timer);
    pinAirspace([]);
  };

  const show = (selection: AirspaceSelection): void => {
    current = selection;
    const { core, volumes, floor, ceiling } = selection;
    const key = KIND_KEY[core.kind];
    root.style.setProperty('--airspace', `#${AIRSPACE_COLORS[core.kind].toString(16).padStart(6, '0')}`);
    title.textContent = airspaceTitle(core.name);
    kind.textContent = t(`misc.airspace_kind_${key}`);
    about.textContent = t(`misc.airspace_about_${key}`);
    limitsValue.textContent = airspaceLimits({
      loFt: floor.loFt,
      loAgl: floor.loAgl,
      hiFt: ceiling.hiFt,
      hiAgl: ceiling.hiAgl,
      unlimited: ceiling.unlimited,
    });

    // Times of use are published per volume; show each distinct one.
    const times = Array.from(new Set(volumes.map((v) => v.times).filter((x): x is string => Boolean(x))));
    timesLabel.hidden = timesValue.hidden = times.length === 0;
    timesValue.textContent = times.join('\n');

    const rows = shelfRows(volumes);
    const showShelves = rows.length > 1;
    shelvesHeading.hidden = shelves.hidden = !showShelves;
    shelves.replaceChildren();
    if (showShelves) {
      rows.forEach((row, i) => {
        shelves.append(el('dt', undefined, row.label || String(i + 1)), el('dd', undefined, row.limits));
      });
    }

    root.hidden = false;
    root.scrollTop = 0;
    pinAirspace(volumes);
    refreshCount();
    clearInterval(timer);
    timer = setInterval(refreshCount, COUNT_INTERVAL_MS);
  };

  close.addEventListener('click', hide);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  // The volumes belong to the feed and the layer they were clicked in.
  subscribeHome(hide);
  subscribeSettings(() => {
    if (!airspaceActive()) hide();
  });

  return { show, hide };
}
