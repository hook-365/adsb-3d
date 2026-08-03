import { selectFeed, type Feed, type FeedMode } from '../feed/feeds';
import { t } from '../core/i18n';

// Top-bar feed switcher. Only mounted when running in multi-feed mode
// with more than one feed configured. Selecting an option calls
// selectFeed() which writes URL+localStorage and reloads — Phase 1 uses
// a hard reload so we don't have to teach HOME and the world/scene to
// re-init in place. Phase 2 swaps that for an in-place switch.

export interface FeedSelectorOptions {
  feeds: readonly Feed[];
  active: Feed;
  mode: FeedMode;
}

export function mountFeedSelector(options: FeedSelectorOptions): void {
  const slot = document.getElementById('feed-selector');
  if (!slot) return;
  if (options.mode !== 'multi' || options.feeds.length < 2) {
    slot.hidden = true;
    return;
  }

  // Use a native <select> for two reasons: (a) mobile gets the OS sheet
  // for free, (b) it's keyboard-accessible without us writing focus
  // management. The color dot lives in a sibling span next to it.
  const dot = document.createElement('span');
  dot.className = 'feed-dot';
  dot.style.background = options.active.color;

  const select = document.createElement('select');
  select.className = 'feed-select';
  select.setAttribute('aria-label', t('feeds.select_feed'));
  for (const feed of options.feeds) {
    const opt = document.createElement('option');
    opt.value = feed.id;
    opt.textContent = feed.name;
    if (feed.id === options.active.id) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    selectFeed(select.value);
  });

  slot.replaceChildren(dot, select);
  slot.hidden = false;
}
