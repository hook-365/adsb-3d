// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlacePicker } from '../src/ui/place-picker';
import { EXPLORE_PLACES } from '../src/feed/explore-places';

function visibleItems(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('.place-item'))
    .filter((b) => !b.hidden)
    .map((b) => b.dataset.id!);
}

describe('place picker', () => {
  let onPick: ReturnType<typeof vi.fn>;
  let picker: ReturnType<typeof createPlacePicker>;

  beforeEach(() => {
    document.body.innerHTML = '';
    onPick = vi.fn();
    picker = createPlacePicker(onPick);
    document.body.appendChild(picker.el);
    picker.setActive('rome');
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
    expect(onPick).toHaveBeenCalledWith('tokyo');
    expect(pop.hidden).toBe(true);
    trigger.click();
    picker.el.querySelector<HTMLButtonElement>('.place-item[data-id="rome"]')!.click();
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('arrow keys move the highlight and Escape closes', () => {
    const trigger = picker.el.querySelector<HTMLButtonElement>('.place-trigger')!;
    trigger.click();
    const pop = picker.el.querySelector<HTMLElement>('.place-pop')!;
    pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const highlighted = picker.el.querySelector<HTMLButtonElement>('.place-item.highlight');
    expect(highlighted?.dataset.id).toBe('milan'); // next after the active Rome
    pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(pop.hidden).toBe(true);
  });
});
