import type { Aircraft } from '../core/types';
import type { AircraftStore } from '../aircraft/store';
import { distanceFromHomeNm } from '../core/coords';
import { fmtAltitude, fmtDistanceCompact, fmtSpeedCompact } from '../core/units';
import { getFilter, setFilter, subscribeFilter, passesFilter, type FilterKey } from '../core/filter';
import { hasAcars, subscribeAcars } from '../aircraft/acars-store';
import { getSettings } from '../core/settings';

// tar1090-style aircraft list panel. Subscribes to the store and rebuilds
// rows whenever the snapshot changes (~1 Hz). Search + column sorting are
// local UI state; the only outward signal is which hex is "selected".

type SortKey = 'flight' | 'alt' | 'spd' | 'dist';

interface SortState {
  key: SortKey;
  asc: boolean;
}

export interface AircraftListHandle {
  setSelected(hex: string | null): void;
  onSelect(fn: (hex: string | null) => void): void;
}

function rowText(a: Aircraft): { primary: string; secondary: string } {
  const primary = a.callsign ?? a.registration ?? a.hex.toUpperCase();
  // The secondary line is the "everything else" identifier: registration if
  // we promoted callsign to primary, otherwise the hex; always followed by
  // the ICAO type code when we have one so the user sees the airframe at a
  // glance without opening the detail card.
  const ident = a.callsign && a.registration ? a.registration : a.hex.toUpperCase();
  const secondary = a.typeCode ? `${ident} · ${a.typeCode}` : ident;
  return { primary, secondary };
}

// Single-character row badges for special-status aircraft. The detail
// panel spells these out; here in the list we just need a visible glyph
// so users can spot them at a glance without widening the row.
function renderRowTags(el: HTMLElement, a: Aircraft): void {
  const tags: Array<{ glyph: string; cls: string; title: string }> = [];
  if (a.emergency) tags.push({ glyph: '!', cls: 'emergency', title: a.emergency });
  if (a.military) tags.push({ glyph: 'M', cls: 'military', title: 'Military' });
  if (a.specialInterest) tags.push({ glyph: '★', cls: 'special', title: 'Special interest' });
  if (getSettings().acarsMessages && hasAcars(a.hex)) {
    tags.push({ glyph: 'A', cls: 'acars', title: 'Recent ACARS messages' });
  }
  if (a.privacyIcao) tags.push({ glyph: 'P', cls: '', title: 'Privacy ICAO' });
  if (a.ladd) tags.push({ glyph: 'L', cls: '', title: 'LADD' });
  if (tags.length === 0) {
    el.textContent = '';
    return;
  }
  el.innerHTML = tags
    .map((t) => `<span class="tag${t.cls ? ` ${t.cls}` : ''}" title="${t.title}">${t.glyph}</span>`)
    .join('');
}

function fmtAlt(a: Aircraft): string {
  if (a.onGround) return 'GND';
  return fmtAltitude(a.altFt, { compact: true });
}

// Arrow glyph reflecting climb / descent at-a-glance. The detail panel uses
// the same 100 fpm threshold to suppress noise from level-flight jitter.
function vrArrow(a: Aircraft): string {
  if (a.verticalRateFpm === null) return '';
  if (a.verticalRateFpm >= 100) return '<span class="vr climb">↑</span>';
  if (a.verticalRateFpm <= -100) return '<span class="vr descend">↓</span>';
  return '';
}

export function createAircraftList(store: AircraftStore): AircraftListHandle {
  const list = document.getElementById('panel-list') as HTMLUListElement;
  const count = document.getElementById('panel-count') as HTMLElement;
  const search = document.getElementById('panel-search') as HTMLInputElement;
  const colButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.panel-cols .col'));

  const filterButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#panel-filters .filter')
  );

  let sort: SortState = { key: 'dist', asc: true };
  let query = '';
  let selectedHex: string | null = null;
  const selectListeners = new Set<(hex: string | null) => void>();

  function applyColumnIndicator(): void {
    for (const btn of colButtons) {
      const key = btn.dataset.sort as SortKey | undefined;
      btn.classList.toggle('active', key === sort.key);
      btn.classList.toggle('asc', key === sort.key && sort.asc);
    }
  }

  function compare(a: Aircraft, b: Aircraft): number {
    // Emergency aircraft pin to the top regardless of the user's chosen sort.
    // Within the emergency cohort and within the normal cohort, fall through
    // to the normal comparator.
    if (!!a.emergency !== !!b.emergency) return a.emergency ? -1 : 1;
    const dir = sort.asc ? 1 : -1;
    switch (sort.key) {
      case 'flight':
        return dir * rowText(a).primary.localeCompare(rowText(b).primary);
      case 'alt':
        return dir * (a.altFt - b.altFt);
      case 'spd':
        return dir * ((a.groundSpeedKt ?? -1) - (b.groundSpeedKt ?? -1));
      case 'dist':
      default:
        return dir * (distanceFromHomeNm(a.lat, a.lon) - distanceFromHomeNm(b.lat, b.lon));
    }
  }

  function matches(a: Aircraft): boolean {
    if (!passesFilter(a)) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      (a.callsign?.toLowerCase().includes(q) ?? false) ||
      (a.registration?.toLowerCase().includes(q) ?? false) ||
      a.hex.includes(q)
    );
  }

  function render(snapshot: ReadonlyMap<string, Aircraft>): void {
    const rows = Array.from(snapshot.values()).filter(matches).sort(compare);
    // Headline count + a compact breakdown of in-air / on-ground / emergency.
    // Computed across the *visible* row set, so toggling a filter shows the
    // breakdown for what's actually rendered (a sanity check for the user).
    let air = 0;
    let ground = 0;
    let emerg = 0;
    for (const a of rows) {
      if (a.emergency) emerg++;
      if (a.onGround) ground++;
      else air++;
    }
    const breakdown: string[] = [];
    if (air > 0) breakdown.push(`✈ ${air}`);
    if (ground > 0) breakdown.push(`▮ ${ground}`);
    if (emerg > 0) breakdown.push(`! ${emerg}`);
    count.innerHTML = breakdown.length > 0
      ? `<span class="total">${rows.length}</span> <span class="breakdown">${breakdown.join(' · ')}</span>`
      : `${rows.length}`;

    const existing = new Map<string, HTMLLIElement>();
    for (const li of list.children) {
      const hex = (li as HTMLLIElement).dataset.hex;
      if (hex) existing.set(hex, li as HTMLLIElement);
    }

    const fragment = document.createDocumentFragment();
    for (const a of rows) {
      const dist = distanceFromHomeNm(a.lat, a.lon);
      let li = existing.get(a.hex);
      if (!li) {
        li = document.createElement('li');
        li.dataset.hex = a.hex;
        li.innerHTML =
          '<div class="flight">' +
            '<div class="line"><span class="callsign"></span><span class="tags"></span></div>' +
            '<span class="reg"></span>' +
          '</div>' +
          '<span class="num alt"></span>' +
          '<span class="num spd"></span>' +
          '<span class="num dist"></span>';
        li.addEventListener('click', () => {
          selectedHex = selectedHex === a.hex ? null : a.hex;
          notifySelection();
          render(store.snapshot);
        });
      }
      existing.delete(a.hex);

      const text = rowText(a);
      const callsignEl = li.querySelector<HTMLElement>('.callsign')!;
      const tagsEl = li.querySelector<HTMLElement>('.tags')!;
      const regEl = li.querySelector<HTMLElement>('.reg')!;
      renderRowTags(tagsEl, a);
      const altEl = li.querySelector<HTMLElement>('.alt')!;
      const spdEl = li.querySelector<HTMLElement>('.spd')!;
      const distEl = li.querySelector<HTMLElement>('.dist')!;
      callsignEl.textContent = text.primary;
      regEl.textContent = text.secondary;
      altEl.innerHTML = `${vrArrow(a)}${fmtAlt(a)}`;
      altEl.classList.toggle('dim', a.onGround);
      spdEl.textContent = fmtSpeedCompact(a.groundSpeedKt);
      spdEl.classList.toggle('dim', a.groundSpeedKt === null);
      distEl.textContent = fmtDistanceCompact(dist);

      let cls = '';
      if (a.emergency) cls += ' emergency';
      if (a.military) cls += ' military';
      if (a.onGround) cls += ' ground';
      if (a.hex === selectedHex) cls += ' selected';
      li.className = cls.trim();

      fragment.appendChild(li);
    }

    // Anything still in `existing` was filtered out / dropped — drop the DOM node.
    for (const stale of existing.values()) stale.remove();
    list.replaceChildren(fragment);
  }

  function notifySelection(): void {
    for (const fn of selectListeners) fn(selectedHex);
  }

  store.subscribe(render);

  search.addEventListener('input', () => {
    query = search.value.trim();
    render(store.snapshot);
  });

  for (const btn of colButtons) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort as SortKey | undefined;
      if (!key) return;
      if (sort.key === key) sort = { key, asc: !sort.asc };
      else sort = { key, asc: key !== 'alt' && key !== 'spd' }; // numeric defaults: descending
      applyColumnIndicator();
      render(store.snapshot);
    });
  }

  function applyFilterIndicator(active: FilterKey): void {
    for (const b of filterButtons) {
      b.classList.toggle('active', (b.dataset.filter as FilterKey) === active);
    }
  }

  for (const btn of filterButtons) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.filter as FilterKey | undefined;
      if (!key) return;
      setFilter(key);
    });
  }

  // Filter changes — whether triggered by these buttons or anywhere else
  // — re-render the list and update the active indicator.
  // Unsubscribe handles intentionally discarded — page-lifetime singleton.
  subscribeFilter((f) => {
    applyFilterIndicator(f);
    render(store.snapshot);
  });
  applyFilterIndicator(getFilter());

  // Re-render when an ACARS message arrives so the new "A" chip on the
  // affected aircraft appears immediately. Cheap: render() is the same
  // 1Hz path the store subscriber uses.
  subscribeAcars(() => render(store.snapshot));

  applyColumnIndicator();
  render(store.snapshot);

  return {
    setSelected(hex) {
      selectedHex = hex;
      render(store.snapshot);
    },
    onSelect(fn) {
      selectListeners.add(fn);
    }
  };
}
