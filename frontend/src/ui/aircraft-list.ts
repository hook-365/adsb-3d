import type { Aircraft } from '../core/types';
import type { AircraftStore } from '../aircraft/store';
import { distanceFromHomeNm } from '../core/coords';
import { fmtAltitude, fmtDistanceCompact, fmtSpeedCompact } from '../core/units';
import { getFilter, setFilter, subscribeFilter, passesFilter, getSearchQuery, setSearchQuery, subscribeSearchQuery, type FilterKey } from '../core/filter';
import { hasAcars, subscribeAcars } from '../aircraft/acars-store';
import { getSettings } from '../core/settings';
import { t } from '../core/i18n';
import { escapeHtml } from './html';

// tar1090-style aircraft list panel. Subscribes to the store and re-renders
// at ~1Hz. To stay flat on big feeds (Europe regularly hits 1500+ contacts),
// the list is *virtualized*: only rows inside the scroll viewport (+overscan)
// have real DOM, with two spacer <li>s padding the top/bottom of the list to
// preserve scrollable height. Per-row mutation is gated on the store's per-
// hex rev counter so steady-state ticks touch only the cells that changed.

type SortKey = 'flight' | 'alt' | 'spd' | 'dist';

interface SortState {
  key: SortKey;
  asc: boolean;
}

export interface AircraftListHandle {
  setSelected(hex: string | null): void;
  onSelect(fn: (hex: string | null) => void): void;
  /** Empty the search box and the filter singleton's query (main.ts uses
   *  this to dissolve a share-link's solo view on deselect). */
  clearSearch(): void;
}

// Compact bitmask for the per-row status chips (emergency/military/special/
// acars/privacy/ladd). Skipping renderRowTags when the mask is unchanged
// avoids re-emitting innerHTML across hundreds of rows.
const TAG_EMERGENCY = 1 << 0;
const TAG_MILITARY = 1 << 1;
const TAG_SPECIAL = 1 << 2;
const TAG_ACARS = 1 << 3;
const TAG_PRIVACY = 1 << 4;
const TAG_LADD = 1 << 5;

function tagMask(a: Aircraft): number {
  let m = 0;
  if (a.emergency) m |= TAG_EMERGENCY;
  if (a.military) m |= TAG_MILITARY;
  if (a.specialInterest) m |= TAG_SPECIAL;
  if (getSettings().acarsMessages && hasAcars(a.hex)) m |= TAG_ACARS;
  if (a.privacyIcao) m |= TAG_PRIVACY;
  if (a.ladd) m |= TAG_LADD;
  return m;
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
function renderRowTags(el: HTMLElement, mask: number, emergencyTitle: string | null): void {
  if (mask === 0) {
    el.textContent = '';
    return;
  }
  const tags: Array<{ glyph: string; cls: string; title: string }> = [];
  if (mask & TAG_EMERGENCY) tags.push({ glyph: '!', cls: 'emergency', title: emergencyTitle ?? t('list.tag_emergency') });
  if (mask & TAG_MILITARY) tags.push({ glyph: 'M', cls: 'military', title: t('list.tag_military') });
  if (mask & TAG_SPECIAL) tags.push({ glyph: '★', cls: 'special', title: t('list.tag_special_interest') });
  if (mask & TAG_ACARS) tags.push({ glyph: 'A', cls: 'acars', title: t('list.tag_acars') });
  if (mask & TAG_PRIVACY) tags.push({ glyph: 'P', cls: '', title: t('list.tag_privacy_icao') });
  if (mask & TAG_LADD) tags.push({ glyph: 'L', cls: '', title: t('list.tag_ladd') });
  el.innerHTML = tags
    .map((tag) => `<span class="tag${tag.cls ? ` ${tag.cls}` : ''}" title="${escapeHtml(tag.title)}">${tag.glyph}</span>`)
    .join('');
}

function fmtAlt(a: Aircraft): string {
  if (a.onGround) return t('list.altitude_ground');
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

interface RowRefs {
  callsign: HTMLElement;
  tags: HTMLElement;
  reg: HTMLElement;
  alt: HTMLElement;
  spd: HTMLElement;
  dist: HTMLElement;
  // Skip-gates. lastRev matches store.getRev(hex) when we last drew this row;
  // lastTagMask is the bitmask we last emitted into .tags. lastSelected /
  // lastClass let us avoid touching className when nothing visible changed.
  lastRev: number;
  lastTagMask: number;
  lastSelected: boolean;
  lastClass: string;
}

interface RowEl extends HTMLLIElement {
  __refs?: RowRefs;
}

// Initial guess so the first paint is in the right ballpark; the renderer
// remeasures from a real row on the next frame and adjusts.
const DEFAULT_ROW_HEIGHT = 34;
// Render this many rows beyond the viewport in each direction so a fast
// scroll doesn't reveal blank space before the next frame paints.
const OVERSCAN_ROWS = 6;

export function createAircraftList(store: AircraftStore): AircraftListHandle {
  const list = document.getElementById('panel-list') as HTMLUListElement;
  const count = document.getElementById('panel-count') as HTMLElement;
  const search = document.getElementById('panel-search') as HTMLInputElement;
  const searchClear = document.getElementById('panel-search-clear') as HTMLButtonElement;
  const colButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.panel-cols .col'));

  const filterButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#panel-filters .filter')
  );

  let sort: SortState = { key: 'dist', asc: true };
  let selectedHex: string | null = null;
  const selectListeners = new Set<(hex: string | null) => void>();

  // The active sorted+filtered hex list, recomputed on each render().
  let sortedHexes: string[] = [];
  // Live <li>s currently mounted in the DOM, keyed by hex. Rows that scroll
  // out of the visible window are detached and dropped from this map.
  const liByHex = new Map<string, RowEl>();
  let rowHeight = DEFAULT_ROW_HEIGHT;
  let rowHeightMeasured = false;

  // Spacer <li>s pad the scroll height above + below the rendered window so
  // the scrollbar reflects total list size. CSS rule for `.spacer` suppresses
  // grid, padding, and pointer affordances so they're pure height fillers.
  const topSpacer = document.createElement('li');
  topSpacer.className = 'spacer';
  topSpacer.setAttribute('aria-hidden', 'true');
  topSpacer.setAttribute('role', 'presentation');
  const bottomSpacer = document.createElement('li');
  bottomSpacer.className = 'spacer';
  bottomSpacer.setAttribute('aria-hidden', 'true');
  bottomSpacer.setAttribute('role', 'presentation');
  list.replaceChildren(topSpacer, bottomSpacer);

  function applyColumnIndicator(): void {
    for (const btn of colButtons) {
      const key = btn.dataset.sort as SortKey | undefined;
      btn.classList.toggle('active', key === sort.key);
      btn.classList.toggle('asc', key === sort.key && sort.asc);
    }
  }

  // Precomputed-key row: `key` is whatever compareRows needs for the active
  // sort column, computed once per row up front instead of re-derived (trig
  // for distance, string concat for flight) on every pairwise comparison
  // inside the O(n log n) sort.
  interface SortRow {
    a: Aircraft;
    emerg: boolean;
    key: string | number;
  }

  function sortKeyFor(a: Aircraft): string | number {
    switch (sort.key) {
      case 'flight':
        return rowText(a).primary;
      case 'alt':
        return a.altFt;
      case 'spd':
        return a.groundSpeedKt ?? -1;
      case 'dist':
      default:
        return distanceFromHomeNm(a.lat, a.lon);
    }
  }

  function compareRows(x: SortRow, y: SortRow): number {
    // Emergency aircraft pin to the top regardless of the user's chosen sort.
    // Within the emergency cohort and within the normal cohort, fall through
    // to the normal comparator.
    if (x.emerg !== y.emerg) return x.emerg ? -1 : 1;
    const dir = sort.asc ? 1 : -1;
    if (typeof x.key === 'string') return dir * x.key.localeCompare(y.key as string);
    return dir * (x.key - (y.key as number));
  }

  function recomputeSorted(snapshot: ReadonlyMap<string, Aircraft>): Aircraft[] {
    // passesFilter folds in both the status filter (filter buttons) and the
    // free-text search query, so the panel and the 3D scene stay in lockstep.
    const rows: SortRow[] = [];
    for (const a of snapshot.values()) {
      if (passesFilter(a)) rows.push({ a, emerg: !!a.emergency, key: sortKeyFor(a) });
    }
    rows.sort(compareRows);
    sortedHexes = new Array<string>(rows.length);
    const arr: Aircraft[] = new Array<Aircraft>(rows.length);
    for (let i = 0; i < rows.length; i++) {
      sortedHexes[i] = rows[i]!.a.hex;
      arr[i] = rows[i]!.a;
    }
    return arr;
  }

  function updateCount(rows: Aircraft[]): void {
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
  }

  function createRow(): RowEl {
    const li = document.createElement('li') as RowEl;
    li.innerHTML =
      '<div class="flight">' +
        '<div class="line"><span class="callsign"></span><span class="tags"></span></div>' +
        '<span class="reg"></span>' +
      '</div>' +
      '<span class="num alt"></span>' +
      '<span class="num spd"></span>' +
      '<span class="num dist"></span>';
    const refs: RowRefs = {
      callsign: li.querySelector<HTMLElement>('.callsign')!,
      tags: li.querySelector<HTMLElement>('.tags')!,
      reg: li.querySelector<HTMLElement>('.reg')!,
      alt: li.querySelector<HTMLElement>('.alt')!,
      spd: li.querySelector<HTMLElement>('.spd')!,
      dist: li.querySelector<HTMLElement>('.dist')!,
      lastRev: -1,
      lastTagMask: -1,
      lastSelected: false,
      lastClass: ''
    };
    li.__refs = refs;
    return li;
  }

  function updateRowContents(a: Aircraft, refs: RowRefs): void {
    const text = rowText(a);
    refs.callsign.textContent = text.primary;
    refs.reg.textContent = text.secondary;
    const mask = tagMask(a);
    if (mask !== refs.lastTagMask) {
      renderRowTags(refs.tags, mask, a.emergency);
      refs.lastTagMask = mask;
    }
    refs.alt.innerHTML = `${vrArrow(a)}${fmtAlt(a)}`;
    refs.alt.classList.toggle('dim', a.onGround);
    refs.spd.textContent = fmtSpeedCompact(a.groundSpeedKt);
    refs.spd.classList.toggle('dim', a.groundSpeedKt === null);
    refs.dist.textContent = fmtDistanceCompact(distanceFromHomeNm(a.lat, a.lon));
  }

  function updateRowClass(li: RowEl, a: Aircraft, refs: RowRefs, isSelected: boolean): void {
    let cls = '';
    if (a.emergency) cls += ' emergency';
    if (a.military) cls += ' military';
    if (a.onGround) cls += ' ground';
    if (isSelected) cls += ' selected';
    const trimmed = cls.trim();
    if (trimmed !== refs.lastClass) {
      li.className = trimmed;
      refs.lastClass = trimmed;
    }
    if (isSelected !== refs.lastSelected) {
      li.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    }
    refs.lastSelected = isSelected;
  }

  // Compute [first, last) row range visible in the scroll viewport, expanded
  // by OVERSCAN_ROWS in each direction. Clamped to [0, sortedHexes.length].
  function computeVisibleRange(): { first: number; last: number } {
    const total = sortedHexes.length;
    if (total === 0) return { first: 0, last: 0 };
    const scrollTop = list.scrollTop;
    const viewport = list.clientHeight;
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS);
    const last = Math.min(total, Math.ceil((scrollTop + viewport) / rowHeight) + OVERSCAN_ROWS);
    return { first, last };
  }

  function renderVisible(snapshot: ReadonlyMap<string, Aircraft>): void {
    const range = computeVisibleRange();
    const total = sortedHexes.length;
    topSpacer.style.height = `${range.first * rowHeight}px`;
    bottomSpacer.style.height = `${Math.max(0, total - range.last) * rowHeight}px`;

    // Detach rows that are no longer in the visible window. Map deletion is
    // safe inside the loop because we collect victims first.
    const wanted = new Set<string>();
    for (let i = range.first; i < range.last; i++) wanted.add(sortedHexes[i]!);
    const drop: string[] = [];
    for (const hex of liByHex.keys()) {
      if (!wanted.has(hex)) drop.push(hex);
    }
    for (const hex of drop) {
      const li = liByHex.get(hex)!;
      li.remove();
      liByHex.delete(hex);
    }

    // Walk the visible window in order, attaching missing rows and ensuring
    // existing rows sit at the right DOM position. The cursor advances row by
    // row from topSpacer; insertBefore(li, cursor.nextSibling) places each
    // row in the correct sorted slot and is a no-op when it's already there.
    let cursor: Node = topSpacer;
    for (let i = range.first; i < range.last; i++) {
      const hex = sortedHexes[i]!;
      const a = snapshot.get(hex);
      if (!a) continue;
      let li = liByHex.get(hex);
      let isNew = false;
      if (!li) {
        li = createRow();
        li.dataset.hex = hex;
        li.id = `ac-row-${hex}`;
        li.setAttribute('role', 'option');
        liByHex.set(hex, li);
        isNew = true;
      }
      if (cursor.nextSibling !== li) {
        list.insertBefore(li, cursor.nextSibling);
      }
      const refs = li.__refs!;
      const rev = store.getRev(hex);
      const contentsChanged = isNew || rev !== refs.lastRev;
      if (contentsChanged) {
        updateRowContents(a, refs);
        refs.lastRev = rev;
      }
      // Selection toggles outside the rev path (the click handler doesn't
      // mutate the snapshot), so check it independently every render. Also
      // re-apply the class when row contents changed, since military /
      // emergency / ground state are reflected in className.
      const isSel = hex === selectedHex;
      if (contentsChanged || isSel !== refs.lastSelected) {
        updateRowClass(li, a, refs, isSel);
      }
      cursor = li;
    }

    // First-paint row-height calibration. Measure offsetHeight of any real
    // row once we have one, swap rowHeight, and re-render so the spacers
    // and visible window agree with reality. Cap to a single recalc per
    // session by setting rowHeightMeasured = true.
    if (!rowHeightMeasured && liByHex.size > 0) {
      const sample = liByHex.values().next().value as RowEl;
      const h = sample.offsetHeight;
      if (h > 0) {
        rowHeightMeasured = true;
        if (Math.abs(h - rowHeight) > 0.5) {
          rowHeight = h;
          renderVisible(snapshot);
        }
      }
    }
  }

  // Full pipeline: recompute the sorted hex list from current filter+sort+
  // query, refresh the count badge, then reconcile the visible DOM window.
  function render(snapshot: ReadonlyMap<string, Aircraft>): void {
    const rows = recomputeSorted(snapshot);
    updateCount(rows);
    renderVisible(snapshot);
  }

  // After filter/sort/query changes, the indices in sortedHexes are entirely
  // different. Center the selected hex in the viewport if it still passes;
  // otherwise scroll to the top.
  function reindexAndPreserveScroll(): void {
    const snapshot = store.snapshot;
    const rows = recomputeSorted(snapshot);
    updateCount(rows);
    let target = 0;
    if (selectedHex) {
      const idx = sortedHexes.indexOf(selectedHex);
      if (idx >= 0) {
        target = Math.max(0, idx * rowHeight - list.clientHeight / 2 + rowHeight / 2);
      }
    }
    list.scrollTop = target;
    renderVisible(snapshot);
  }

  function notifySelection(): void {
    for (const fn of selectListeners) fn(selectedHex);
  }

  // Shared by the click handler and the Enter/Space keyboard path below.
  // Flips .selected class on whichever currently-mounted rows are affected
  // — the store hasn't changed so this doesn't trigger a full re-render.
  function toggleSelect(hex: string): void {
    selectedHex = selectedHex === hex ? null : hex;
    notifySelection();
    const snap = store.snapshot;
    for (const [h, row] of liByHex) {
      const refs = row.__refs!;
      const isSel = h === selectedHex;
      if (isSel !== refs.lastSelected) {
        const a = snap.get(h);
        if (a) updateRowClass(row, a, refs, isSel);
      }
    }
  }

  // Event delegation: a single click listener on the <ul> derives the row
  // from event.target. Cheaper than wiring per-row listeners and survives
  // virtualization (rows are recycled across hexes).
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement | null)?.closest('li');
    if (!li || li.classList.contains('spacer')) return;
    const hex = (li as HTMLLIElement).dataset.hex;
    if (!hex) return;
    toggleSelect(hex);
  });

  // Keyboard nav (role="listbox" on the <ul>, tabindex="0"): ArrowUp/Down
  // move a virtual "active" row via aria-activedescendant rather than real
  // roving tabindex — virtualized rows get detached from the DOM as they
  // scroll out, so they can't reliably hold browser focus. Enter/Space
  // select the active row through the same path as a click.
  let activeIndex = -1;
  function setActiveIndex(idx: number): void {
    const total = sortedHexes.length;
    if (total === 0) {
      activeIndex = -1;
      list.removeAttribute('aria-activedescendant');
      return;
    }
    activeIndex = Math.max(0, Math.min(total - 1, idx));
    const hex = sortedHexes[activeIndex]!;
    // Same scroll-into-view math as setSelected below — materializes the
    // row so aria-activedescendant always points at something actually
    // mounted in the DOM, not a virtualized row that doesn't exist yet.
    const top = activeIndex * rowHeight;
    const bot = top + rowHeight;
    if (top < list.scrollTop || bot > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2 + rowHeight / 2);
      renderVisible(store.snapshot);
    }
    list.setAttribute('aria-activedescendant', `ac-row-${hex}`);
  }
  list.addEventListener('keydown', (e) => {
    if (sortedHexes.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(activeIndex < 0 ? 0 : activeIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(activeIndex < 0 ? 0 : activeIndex - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (activeIndex < 0) return;
      e.preventDefault();
      toggleSelect(sortedHexes[activeIndex]!);
    }
  });

  // Recompute the visible window on scroll, coalesced to one update per
  // animation frame so a single fling doesn't queue hundreds of renders.
  let scrollPending = false;
  list.addEventListener('scroll', () => {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => {
      scrollPending = false;
      renderVisible(store.snapshot);
    });
  }, { passive: true });

  // Window resize changes viewport height → visible row count changes.
  window.addEventListener('resize', () => {
    renderVisible(store.snapshot);
  });

  store.subscribe(render);

  // "Filtered" chip beside the aircraft count: visible whenever search text
  // or a non-All status pill is hiding traffic, so the under-reported count
  // explains itself. Clicking it resets both gates at once.
  const filteredChip = document.createElement('button');
  filteredChip.type = 'button';
  filteredChip.id = 'panel-filtered-chip';
  filteredChip.hidden = true;
  filteredChip.textContent = `${t('list.filtered_chip')} ×`;
  filteredChip.setAttribute('aria-label', t('list.filtered_chip_aria'));
  filteredChip.title = t('list.filtered_chip_aria');
  count.insertAdjacentElement('beforebegin', filteredChip);
  filteredChip.addEventListener('click', () => {
    clearSearch();
    setFilter('all');
  });

  // Sync the two clear affordances (input ×, filtered chip) with the
  // current filter state. Driven from the subscribe hooks below so state
  // changes from anywhere — typing, share-link seeding in main.ts, pill
  // clicks — update them without extra wiring.
  function syncClearAffordances(): void {
    const query = getSearchQuery();
    searchClear.hidden = query === '';
    filteredChip.hidden = query === '' && getFilter() === 'all';
  }

  function clearSearch(): void {
    search.value = '';
    setSearchQuery('');
  }

  search.addEventListener('input', () => {
    setSearchQuery(search.value);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value !== '') {
      // Consume the key so document-level Escape handlers (settings panel,
      // ACARS browser) don't also fire off a half-typed search clear.
      e.stopPropagation();
      clearSearch();
    }
  });
  searchClear.addEventListener('click', () => {
    clearSearch();
    search.focus();
  });

  // setSearchQuery fans out to all listeners — the reconciler picks up the
  // new query on its next frame (it just reads passesFilter), and we
  // reindex+rescroll the list panel here.
  subscribeSearchQuery(() => {
    syncClearAffordances();
    reindexAndPreserveScroll();
  });

  for (const btn of colButtons) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort as SortKey | undefined;
      if (!key) return;
      if (sort.key === key) sort = { key, asc: !sort.asc };
      else sort = { key, asc: key !== 'alt' && key !== 'spd' }; // numeric defaults: descending
      applyColumnIndicator();
      reindexAndPreserveScroll();
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
    syncClearAffordances();
    reindexAndPreserveScroll();
  });
  applyFilterIndicator(getFilter());
  syncClearAffordances();

  // Surface a new ACARS message's "A" chip immediately. We can't piggyback
  // on the store's rev (ACARS state lives in a separate store) — but a full
  // render() here was also a full re-sort + re-render of the whole visible
  // window for a change that only ever affects one row's tag chips.
  //
  // hex === '' is acars-store's clear-all signal (feed switch): fall back
  // to a full render since every row's ACARS chip may need to disappear.
  // Otherwise: if the affected row happens to be mounted, recompute its
  // tag mask against the current snapshot and paint the chips directly —
  // no re-sort, no full-render. An unmounted row needs nothing; createRow
  // seeds lastTagMask at -1, so it renders correctly the moment it scrolls
  // into view. This also fixes the chip otherwise appearing one data-tick
  // late: updateRowContents (and its tagMask recompute) only runs on a
  // store rev bump, and ACARS arrivals don't bump the store rev.
  subscribeAcars((hex) => {
    if (hex === '') {
      render(store.snapshot);
      return;
    }
    const li = liByHex.get(hex.toLowerCase());
    if (!li) return;
    const a = store.snapshot.get(hex.toLowerCase());
    if (!a) return;
    const refs = li.__refs!;
    const mask = tagMask(a);
    if (mask !== refs.lastTagMask) {
      renderRowTags(refs.tags, mask, a.emergency);
      refs.lastTagMask = mask;
    }
  });

  applyColumnIndicator();
  render(store.snapshot);

  return {
    setSelected(hex) {
      selectedHex = hex;
      // Mirror the click-path logic: flip classes on mounted rows without
      // forcing a full re-render. If the newly-selected row is outside the
      // visible window, scroll it into view so the user can see what they
      // just selected.
      const snap = store.snapshot;
      for (const [h, row] of liByHex) {
        const refs = row.__refs!;
        const isSel = h === selectedHex;
        if (isSel !== refs.lastSelected) {
          const a = snap.get(h);
          if (a) updateRowClass(row, a, refs, isSel);
        }
      }
      if (selectedHex) {
        const idx = sortedHexes.indexOf(selectedHex);
        if (idx >= 0) {
          const top = idx * rowHeight;
          const bot = top + rowHeight;
          if (top < list.scrollTop || bot > list.scrollTop + list.clientHeight) {
            list.scrollTop = Math.max(0, top - list.clientHeight / 2 + rowHeight / 2);
            renderVisible(snap);
          }
        }
      }
    },
    onSelect(fn) {
      selectListeners.add(fn);
    },
    clearSearch,
  };
}
