import { EXPLORE_PLACES, EXPLORE_REGIONS, type ExplorePlace } from '../feed/explore-places';
import { getLocale, t } from '../core/i18n';

// Explore city picker: a trigger in the status bar that opens a popover
// with a search box and the preset places grouped by region, each with
// its country spelled out. Typing filters by city, state or province,
// country code or the localized country name ("ital" finds Rome, Milan,
// Naples; "michigan" finds Detroit; "hawaii" finds Honolulu). Arrow keys
// move the highlight, Enter picks, Escape closes. Replaces a 85-entry
// native <select>, which scrolled forever and could not be searched.

export interface PlacePicker {
  readonly el: HTMLElement;
  setActive(placeId: string | null): void;
  setHidden(hidden: boolean): void;
}

interface Entry {
  place: ExplorePlace;
  country: string;
  /** Lowercased, diacritics stripped: what the query is matched against. */
  haystack: string;
  button: HTMLButtonElement;
  group: HTMLElement;
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([getLocale()], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function createPlacePicker(onPick: (placeId: string) => void): PlacePicker {
  const root = document.createElement('span');
  root.className = 'place-picker';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'feed-select place-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', t('feeds.select_place'));

  const pop = document.createElement('div');
  pop.className = 'place-pop';
  pop.hidden = true;

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'place-search';
  search.placeholder = t('feeds.search_place');
  search.setAttribute('aria-label', t('feeds.search_place'));
  search.autocomplete = 'off';
  search.spellcheck = false;

  const list = document.createElement('div');
  list.className = 'place-list';
  list.setAttribute('role', 'listbox');

  const empty = document.createElement('div');
  empty.className = 'place-empty';
  empty.textContent = t('feeds.no_match');
  empty.hidden = true;

  const entries: Entry[] = [];
  for (const region of EXPLORE_REGIONS) {
    const group = document.createElement('div');
    group.className = 'place-group';
    const title = document.createElement('div');
    title.className = 'place-group-title';
    title.textContent = t(`feeds.region.${region}`);
    group.appendChild(title);
    for (const place of EXPLORE_PLACES) {
      if (place.region !== region) continue;
      const country = countryName(place.country);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'place-item';
      button.setAttribute('role', 'option');
      button.dataset.id = place.id;
      const name = document.createElement('span');
      name.textContent = place.name;
      const where = document.createElement('span');
      where.className = 'place-country';
      where.textContent = place.admin ? `${place.admin}, ${country}` : country;
      button.append(name, where);
      button.addEventListener('click', () => pick(place.id));
      group.appendChild(button);
      entries.push({
        place,
        country,
        haystack: fold(`${place.name} ${place.admin ?? ''} ${place.country} ${country}`),
        button,
        group,
      });
    }
    list.appendChild(group);
  }
  list.appendChild(empty);
  pop.append(search, list);
  root.append(trigger, pop);

  let activeId: string | null = null;
  let visible: Entry[] = entries;
  let highlight = -1;

  function applyFilter(): void {
    const q = fold(search.value.trim());
    visible = [];
    const liveGroups = new Set<HTMLElement>();
    for (const e of entries) {
      const show = q === '' || e.haystack.includes(q);
      e.button.hidden = !show;
      if (show) {
        visible.push(e);
        liveGroups.add(e.group);
      }
    }
    for (const e of entries) e.group.hidden = !liveGroups.has(e.group);
    empty.hidden = visible.length > 0;
    // With a query, the first hit is pre-highlighted so Enter picks it.
    setHighlight(q === '' ? visible.findIndex((e) => e.place.id === activeId) : visible.length ? 0 : -1);
  }

  function setHighlight(index: number): void {
    if (highlight >= 0 && highlight < visible.length) {
      visible[highlight]!.button.classList.remove('highlight');
    }
    highlight = index;
    if (highlight >= 0 && highlight < visible.length) {
      const b = visible[highlight]!.button;
      b.classList.add('highlight');
      b.scrollIntoView({ block: 'nearest' });
    }
  }

  function open(): void {
    if (!pop.hidden) return;
    pop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    search.value = '';
    applyFilter();
    search.focus();
    document.addEventListener('pointerdown', onOutside, true);
  }

  function close(): void {
    if (pop.hidden) return;
    pop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
  }

  function onOutside(e: PointerEvent): void {
    if (!root.contains(e.target as Node)) close();
  }

  function pick(id: string): void {
    close();
    if (id !== activeId) onPick(id);
    trigger.focus();
  }

  trigger.addEventListener('click', () => (pop.hidden ? open() : close()));
  search.addEventListener('input', applyFilter);
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
      trigger.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      if (visible.length) setHighlight((highlight + 1) % visible.length);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      if (visible.length) setHighlight((highlight - 1 + visible.length) % visible.length);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (highlight >= 0 && highlight < visible.length) pick(visible[highlight]!.place.id);
      e.preventDefault();
    }
    // Everything else (letters, Backspace) belongs to the search box; the
    // free camera's WASD listener skips inputs, so typing never flies.
    e.stopPropagation();
  });

  return {
    el: root,
    setActive(placeId) {
      activeId = placeId;
      const hit = entries.find((e) => e.place.id === placeId);
      trigger.textContent = hit ? hit.place.name : t('feeds.select_place');
      trigger.title = hit ? `${hit.place.name}, ${hit.country}` : '';
      for (const e of entries) e.button.classList.toggle('active', e.place.id === placeId);
    },
    setHidden(hidden) {
      if (hidden) close();
      root.hidden = hidden;
    },
  };
}
