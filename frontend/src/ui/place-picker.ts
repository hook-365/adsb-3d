import { EXPLORE_PLACES, EXPLORE_REGIONS, LIBRARY_PLACES, findPlace, foldSearch, type ExplorePlace } from '../feed/explore-places';
import { loadAirports, searchAirports, shortAirportName, type Airport } from '../feed/explore-airports';
import { EXPLORE_COLOR, exploreFeedId, isExploreFeedId, placeIdFromFeedId } from '../feed/explore';
import type { Feed } from '../feed/feeds';
import { getLocale, t } from '../core/i18n';

// The one control for "where am I looking": a trigger in the status bar
// showing the active feed, opening a popover that lists the deployment's
// receivers first and then every Explore city grouped by region. A
// receiver and a city are the same kind of pick (both are feed ids, a
// city's being `explore:<place>`), so getting anywhere is one open and
// one click instead of choosing "Explore" and then a city.
//
// Typing filters by receiver name, city, state or province, country code,
// the localized country name or a place alias ("ital" finds Rome, Milan,
// Naples; "michigan" finds Detroit; "msp" finds Minneapolis). Arrow keys
// move the highlight, Enter picks, Escape closes.
//
// Behind the curated cities sits a library of every US city over 15,000
// people (LIBRARY_PLACES). It is far too long to list, so it only shows
// as search results: two or more typed characters add a "More US cities"
// group with the most populous matches ("wausau", "duluth mn").
//
// Airports work the same way, from a list fetched the first time the
// picker opens: an ICAO or IATA code or a name ("kmsp", "atw",
// "heathrow") adds an "Airports" group, and picking one centres the scope
// on the airport itself.

export interface PlacePickerOptions {
  /** Configured receivers, listed above the cities. */
  receivers?: readonly Feed[];
  /** List the Explore cities. Off when the deploy has no Explore provider. */
  places?: boolean;
  /** Called with a feed id: a receiver's, or `explore:<place>` for a city. */
  onPick: (feedId: string) => void;
  /** Airport list source; the on-demand loader unless a test supplies one. */
  airports?: () => Promise<readonly Airport[]>;
}

export interface PlacePicker {
  readonly el: HTMLElement;
  setActive(feedId: string | null): void;
}

interface Entry {
  /** Feed id. */
  id: string;
  label: string;
  /** Trigger tooltip while this entry is active. */
  title: string;
  color: string;
  /** Lowercased, diacritics stripped: what the query is matched against. */
  haystack: string;
  button: HTMLButtonElement;
  group: HTMLElement;
}

/** Library matches shown per query; the list is population-sorted, so these are the biggest. */
const LIBRARY_MATCH_LIMIT = 40;
const LIBRARY_MIN_QUERY = 2;
const AIRPORT_MATCH_LIMIT = 12;

const fold = foldSearch;

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([getLocale()], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function makeDot(color: string): HTMLSpanElement {
  const dot = document.createElement('span');
  dot.className = 'feed-dot';
  dot.style.background = color;
  dot.style.color = color;
  return dot;
}

export function createPlacePicker(options: PlacePickerOptions): PlacePicker {
  const receivers = options.receivers ?? [];
  const showPlaces = options.places ?? true;

  const root = document.createElement('span');
  root.className = 'place-picker';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'feed-select place-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', t('feeds.select_feed'));
  const triggerDot = makeDot('transparent');
  const triggerLabel = document.createElement('span');
  trigger.append(triggerDot, triggerLabel);

  const pop = document.createElement('div');
  pop.className = 'place-pop';
  pop.tabIndex = -1;
  pop.hidden = true;

  // A handful of receivers needs no search box; the city list does.
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'place-search';
  search.placeholder = t('feeds.search_place');
  search.setAttribute('aria-label', t('feeds.search_place'));
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.hidden = !showPlaces;

  const list = document.createElement('div');
  list.className = 'place-list';
  list.setAttribute('role', 'listbox');

  const empty = document.createElement('div');
  empty.className = 'place-empty';
  empty.textContent = t('feeds.no_match');
  empty.hidden = true;

  const entries: Entry[] = [];

  function addGroup(titleText: string): HTMLElement {
    const group = document.createElement('div');
    group.className = 'place-group';
    const title = document.createElement('div');
    title.className = 'place-group-title';
    title.textContent = titleText;
    group.appendChild(title);
    list.appendChild(group);
    return group;
  }

  function addItem(group: HTMLElement, id: string, nameEl: HTMLElement, detail: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'place-item';
    button.setAttribute('role', 'option');
    button.dataset.id = id;
    button.appendChild(nameEl);
    if (detail) {
      const where = document.createElement('span');
      where.className = 'place-country';
      where.textContent = detail;
      button.appendChild(where);
    }
    button.addEventListener('click', () => pick(id));
    group.appendChild(button);
    return button;
  }

  if (receivers.length > 0) {
    const group = addGroup(t('feeds.receivers'));
    for (const feed of receivers) {
      if (isExploreFeedId(feed.id)) continue;
      const name = document.createElement('span');
      name.className = 'place-name';
      name.append(makeDot(feed.color), feed.name);
      entries.push({
        id: feed.id,
        label: feed.name,
        title: feed.name,
        color: feed.color,
        haystack: fold(feed.name),
        button: addItem(group, feed.id, name, ''),
        group,
      });
    }
  }

  if (showPlaces) {
    for (const region of EXPLORE_REGIONS) {
      const group = addGroup(t(`feeds.region.${region}`));
      for (const place of EXPLORE_PLACES) {
        if (place.region !== region) continue;
        const country = countryName(place.country);
        const id = exploreFeedId(place.id);
        const name = document.createElement('span');
        name.className = 'place-name';
        name.textContent = place.name;
        entries.push({
          id,
          label: place.name,
          title: `${t('feeds.explore')}: ${place.name}, ${country}`,
          color: EXPLORE_COLOR,
          haystack: fold(`${place.name} ${place.admin ?? ''} ${place.country} ${country} ${place.alias ?? ''}`),
          button: addItem(group, id, name, place.admin ? `${place.admin}, ${country}` : country),
          group,
        });
      }
    }
  }

  // Search-only group for airports, filled once the list has loaded.
  const airportGroup = showPlaces ? addGroup(t('feeds.airports')) : null;
  if (airportGroup) airportGroup.hidden = true;
  let airportList: readonly Airport[] = [];
  let airportEntries: Entry[] = [];

  function searchAirportGroup(q: string): void {
    if (!airportGroup) return;
    for (const e of airportEntries) e.button.remove();
    airportEntries = searchAirports(airportList, q, AIRPORT_MATCH_LIMIT).map((a) => {
      const id = exploreFeedId(a.place.id);
      const name = document.createElement('span');
      name.className = 'place-name';
      const code = document.createElement('span');
      code.className = 'place-code';
      code.textContent = a.icao;
      name.append(code, shortAirportName(a.name));
      const country = countryName(a.place.country);
      const button = addItem(airportGroup, id, name, a.city ? `${a.city}, ${country}` : country);
      button.classList.add('library', 'airport');
      button.classList.toggle('active', id === activeId);
      return {
        id,
        label: a.place.name,
        title: `${t('feeds.explore')}: ${a.icao} ${a.name}`,
        color: EXPLORE_COLOR,
        haystack: '',
        button,
        group: airportGroup,
      };
    });
    airportGroup.hidden = airportEntries.length === 0;
  }

  // Search-only group for the US city library; its buttons are rebuilt
  // per query. Haystacks are folded on first use, not at page load.
  const libraryGroup = showPlaces ? addGroup(t('feeds.more_cities')) : null;
  if (libraryGroup) libraryGroup.hidden = true;
  let libraryHay: string[] | null = null;
  let libraryEntries: Entry[] = [];
  const usName = countryName('US');

  function placeEntry(place: ExplorePlace, group: HTMLElement): Entry {
    const id = exploreFeedId(place.id);
    const name = document.createElement('span');
    name.className = 'place-name';
    name.textContent = place.name;
    const button = addItem(group, id, name, place.admin ? `${place.admin}, ${usName}` : usName);
    button.classList.add('library');
    button.classList.toggle('active', id === activeId);
    return {
      id,
      label: place.name,
      title: `${t('feeds.explore')}: ${place.name}, ${place.admin ?? usName}`,
      color: EXPLORE_COLOR,
      haystack: '',
      button,
      group,
    };
  }

  function searchLibrary(q: string): void {
    if (!libraryGroup) return;
    for (const e of libraryEntries) e.button.remove();
    libraryEntries = [];
    if (q.length >= LIBRARY_MIN_QUERY) {
      libraryHay ??= LIBRARY_PLACES.map((p) => fold(`${p.name} ${p.alias ?? ''} ${p.admin ?? ''}`));
      for (let i = 0; i < LIBRARY_PLACES.length && libraryEntries.length < LIBRARY_MATCH_LIMIT; i++) {
        if (libraryHay[i]!.includes(q)) libraryEntries.push(placeEntry(LIBRARY_PLACES[i]!, libraryGroup));
      }
    }
    libraryGroup.hidden = libraryEntries.length === 0;
  }

  list.appendChild(empty);
  pop.append(search, list);
  root.append(trigger, pop);

  let activeId: string | null = null;
  let visible: Entry[] = entries;
  let highlight = -1;

  function applyFilter(): void {
    // "Wausau, WI" and "wausau wi" are the same question.
    const q = fold(search.value).replace(/[,\s]+/g, ' ').trim();
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
    searchAirportGroup(q);
    visible.push(...airportEntries);
    searchLibrary(q);
    visible.push(...libraryEntries);
    empty.hidden = visible.length > 0;
    // With a query, the first hit is pre-highlighted so Enter picks it.
    setHighlight(q === '' ? visible.findIndex((e) => e.id === activeId) : visible.length ? 0 : -1);
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
    (search.hidden ? pop : search).focus();
    if (showPlaces && airportList.length === 0) {
      void (options.airports ?? loadAirports)().then((list) => {
        airportList = list;
        // Typing may have got ahead of the download.
        if (!pop.hidden && list.length > 0) applyFilter();
      });
    }
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
    if (id !== activeId) options.onPick(id);
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
      if (highlight >= 0 && highlight < visible.length) pick(visible[highlight]!.id);
      e.preventDefault();
    }
    // Everything else (letters, Backspace) belongs to the search box; the
    // free camera's WASD listener skips inputs, so typing never flies.
    e.stopPropagation();
  });

  return {
    el: root,
    setActive(feedId) {
      activeId = feedId;
      // A library city has no standing entry; describe it from the catalog.
      const libraryPlace = findPlace(feedId ? placeIdFromFeedId(feedId) : null);
      const hit =
        entries.find((e) => e.id === feedId) ??
        (libraryPlace
          ? { label: libraryPlace.name, title: `${t('feeds.explore')}: ${libraryPlace.name}, ${libraryPlace.admin ?? usName}`, color: EXPLORE_COLOR }
          : null);
      triggerLabel.textContent = hit ? hit.label : t('feeds.select_feed');
      trigger.title = hit ? hit.title : '';
      const color = hit ? hit.color : 'transparent';
      triggerDot.style.background = color;
      triggerDot.style.color = color;
      for (const e of entries) e.button.classList.toggle('active', e.id === feedId);
    },
  };
}
