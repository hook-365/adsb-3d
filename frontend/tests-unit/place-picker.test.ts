// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlacePicker } from '../src/ui/place-picker';
import { EXPLORE_PLACES } from '../src/feed/explore-places';
import type { Feed } from '../src/feed/feeds';
import { decodeAirports } from '../src/feed/explore-airports';

function visibleItems(root: HTMLElement): string[] {
  // Curated places only; US library matches are checked on their own.
  return Array.from(root.querySelectorAll<HTMLButtonElement>('.place-item:not(.library)'))
    .filter((b) => !b.hidden)
    .map((b) => b.dataset.id!.replace(/^explore:/, ''));
}

describe('place picker', () => {
  let onPick: ReturnType<typeof vi.fn>;
  let picker: ReturnType<typeof createPlacePicker>;

  beforeEach(() => {
    // jsdom has no layout, so it does not implement scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
    document.body.innerHTML = '';
    onPick = vi.fn();
    picker = createPlacePicker({ onPick, airports: () => Promise.resolve([]) });
    document.body.appendChild(picker.el);
    picker.setActive('explore:rome');
  });

  it('shows the active city on the trigger and lists every place grouped by region', () => {
    const trigger = picker.el.querySelector('.place-trigger')!;
    expect(trigger.textContent).toBe('Rome');
    expect(picker.el.querySelectorAll('.place-item')).toHaveLength(EXPLORE_PLACES.length);
    expect(picker.el.querySelectorAll('.place-group').length).toBeGreaterThan(3);
  });

  it('filters by city, country code or country name, ignoring accents', () => {
    (picker.el.querySelector('.place-trigger') as HTMLButtonElement).click();
    const search = picker.el.querySelector<HTMLInputElement>('.place-search')!;
    search.value = 'ital';
    search.dispatchEvent(new Event('input'));
    expect(visibleItems(picker.el)).toEqual(['rome', 'milan', 'naples']);
    search.value = 'JP';
    search.dispatchEvent(new Event('input'));
    expect(visibleItems(picker.el)).toEqual(['tokyo', 'osaka']);
    search.value = 'sao';
    search.dispatchEvent(new Event('input'));
    expect(visibleItems(picker.el)).toEqual(['sao_paulo']);
    search.value = 'michigan';
    search.dispatchEvent(new Event('input'));
    expect(visibleItems(picker.el)).toEqual(['detroit']);
    search.value = 'Hawaii';
    search.dispatchEvent(new Event('input'));
    expect(visibleItems(picker.el)).toEqual(['honolulu']);
    search.value = 'texas';
    search.dispatchEvent(new Event('input'));
    expect(visibleItems(picker.el)).toEqual(['dallas', 'houston']);
    search.value = 'msp';
    search.dispatchEvent(new Event('input'));
    expect(visibleItems(picker.el)).toEqual(['minneapolis']);
    search.value = 'lhr';
    search.dispatchEvent(new Event('input'));
    expect(visibleItems(picker.el)).toEqual(['london']);
    search.value = 'zzzz';
    search.dispatchEvent(new Event('input'));
    expect(visibleItems(picker.el)).toEqual([]);
    expect(picker.el.querySelector<HTMLElement>('.place-empty')!.hidden).toBe(false);
  });

  it('Enter picks the first match and closes; picking the active city is a no-op', () => {
    const trigger = picker.el.querySelector<HTMLButtonElement>('.place-trigger')!;
    trigger.click();
    const pop = picker.el.querySelector<HTMLElement>('.place-pop')!;
    expect(pop.hidden).toBe(false);
    const search = picker.el.querySelector<HTMLInputElement>('.place-search')!;
    search.value = 'tok';
    search.dispatchEvent(new Event('input'));
    pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onPick).toHaveBeenCalledWith('explore:tokyo');
    expect(pop.hidden).toBe(true);
    trigger.click();
    picker.el.querySelector<HTMLButtonElement>('.place-item[data-id="explore:rome"]')!.click();
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('arrow keys move the highlight and Escape closes', () => {
    const trigger = picker.el.querySelector<HTMLButtonElement>('.place-trigger')!;
    trigger.click();
    const pop = picker.el.querySelector<HTMLElement>('.place-pop')!;
    pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const highlighted = picker.el.querySelector<HTMLButtonElement>('.place-item.highlight');
    expect(highlighted?.dataset.id).toBe('explore:milan'); // next after the active Rome
    pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(pop.hidden).toBe(true);
  });

  it('lists receivers above the cities and picks them by feed id', () => {
    document.body.innerHTML = '';
    const receivers = [
      { id: 'local', name: 'Home', color: '#4a9eff' },
      { id: 'feed2', name: 'Appleton, WI', color: '#00cc88' },
    ] as unknown as Feed[];
    picker = createPlacePicker({ receivers, onPick, airports: () => Promise.resolve([]) });
    document.body.appendChild(picker.el);
    picker.setActive('local');
    const trigger = picker.el.querySelector<HTMLButtonElement>('.place-trigger')!;
    expect(trigger.textContent).toBe('Home');
    const ids = Array.from(picker.el.querySelectorAll<HTMLButtonElement>('.place-item')).map((b) => b.dataset.id);
    expect(ids.slice(0, 3)).toEqual(['local', 'feed2', 'explore:rome']);
    trigger.click();
    const search = picker.el.querySelector<HTMLInputElement>('.place-search')!;
    search.value = 'apple';
    search.dispatchEvent(new Event('input'));
    picker.el
      .querySelector<HTMLElement>('.place-pop')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onPick).toHaveBeenCalledWith('feed2');
  });

  it('is a plain receiver list without a search box when Explore is off', () => {
    document.body.innerHTML = '';
    const receivers = [
      { id: 'local', name: 'Home', color: '#4a9eff' },
      { id: 'feed2', name: 'Appleton, WI', color: '#00cc88' },
    ] as unknown as Feed[];
    picker = createPlacePicker({ receivers, places: false, onPick });
    expect(picker.el.querySelectorAll('.place-item')).toHaveLength(2);
    expect(picker.el.querySelector<HTMLInputElement>('.place-search')!.hidden).toBe(true);
  });

  it('searches the US city library as you type, biggest match first', () => {
    const trigger = picker.el.querySelector<HTMLButtonElement>('.place-trigger')!;
    trigger.click();
    const search = picker.el.querySelector<HTMLInputElement>('.place-search')!;
    const library = (): string[] =>
      Array.from(picker.el.querySelectorAll<HTMLButtonElement>('.place-item.library')).map((b) => b.dataset.id!);
    // Nothing from the library until there is a query.
    expect(library()).toEqual([]);
    search.value = 'wausau';
    search.dispatchEvent(new Event('input'));
    expect(library()).toEqual(['explore:us_wi_wausau']);
    search.value = 'Duluth, MN';
    search.dispatchEvent(new Event('input'));
    expect(library()).toEqual(['explore:us_mn_duluth']);
    // A state name lists its cities, capped, most populous first.
    search.value = 'wisconsin';
    search.dispatchEvent(new Event('input'));
    expect(library()[0]).toBe('explore:us_wi_milwaukee');
    expect(library().length).toBeLessThanOrEqual(40);
    // Enter picks a library city like any other place.
    search.value = 'wausau';
    search.dispatchEvent(new Event('input'));
    picker.el.querySelector<HTMLElement>('.place-pop')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onPick).toHaveBeenCalledWith('explore:us_wi_wausau');
    picker.setActive('explore:us_wi_wausau');
    expect(trigger.textContent).toBe('Wausau');
  });

  it('adds an Airports group once the airport list has loaded', async () => {
    document.body.innerHTML = '';
    const airports = decodeAirports({
      airports: [
        ['KMSP', 'MSP', 'Minneapolis–Saint Paul International Airport / Wold–Chamberlain Field', 'Minneapolis', 'US', 44.88, -93.22, 840],
        ['KCWA', 'CWA', 'Central Wisconsin Airport', 'Mosinee', 'US', 44.78, -89.67, 1280],
      ],
    });
    picker = createPlacePicker({ onPick, airports: () => Promise.resolve(airports) });
    document.body.appendChild(picker.el);
    picker.el.querySelector<HTMLButtonElement>('.place-trigger')!.click();
    await Promise.resolve();
    const search = picker.el.querySelector<HTMLInputElement>('.place-search')!;
    search.value = 'kcwa';
    search.dispatchEvent(new Event('input'));
    const items = Array.from(picker.el.querySelectorAll<HTMLButtonElement>('.place-item.airport'));
    expect(items.map((b) => b.dataset.id)).toEqual(['explore:apt_kcwa']);
    expect(items[0]!.textContent).toContain('KCWA');
    expect(items[0]!.textContent).toContain('Central Wisconsin');
    picker.el.querySelector<HTMLElement>('.place-pop')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onPick).toHaveBeenCalledWith('explore:apt_kcwa');
  });
});
