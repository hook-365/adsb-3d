import {
  getExploreFeed,
  getFeeds,
  selectExplorePlace,
  selectFeed,
  type Feed,
  type FeedMode,
} from '../feed/feeds';
import { isExploreFeedId, placeIdFromFeedId } from '../feed/explore';
import { t } from '../core/i18n';
import { createPlacePicker } from './place-picker';

// Top-bar feed switcher. Only mounted when running in multi-feed mode
// with more than one feed configured. Selecting an option calls
// selectFeed(), which writes URL + storage and hands off to the in-place
// switch handler registered by app/session.ts.
//
// The Explore feed (feed/explore.ts) adds a searchable city picker
// (ui/place-picker.ts), shown only while Explore is the active feed.
// Picking a city is itself a feed switch (the slot's id carries the
// place), so the feed <select> is re-labelled from the slot after each pick.

export interface FeedSelectorOptions {
  feeds: readonly Feed[];
  active: Feed;
  mode: FeedMode;
}

function feedLabel(feed: Feed): string {
  return isExploreFeedId(feed.id) ? `${t('feeds.explore')}: ${feed.name}` : feed.name;
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
    opt.textContent = feedLabel(feed);
    if (feed.id === options.active.id) opt.selected = true;
    // The explore slot's id/name follow the chosen place; tag its option
    // so sync() can re-label it without matching on a stale value.
    if (isExploreFeedId(feed.id)) opt.dataset.explore = '1';
    select.appendChild(opt);
  }

  const picker = getExploreFeed()
    ? createPlacePicker((placeId) => {
        selectExplorePlace(placeId);
        sync(getExploreFeed()?.id ?? select.value);
      })
    : null;

  // Re-read the slot each time: selectExplorePlace swaps the object.
  const sync = (activeId: string): void => {
    const explore = getExploreFeed();
    for (const opt of Array.from(select.options)) {
      if (opt.dataset.explore && explore) {
        opt.value = explore.id;
        opt.textContent = feedLabel(explore);
      }
    }
    select.value = activeId;
    const feed = getFeeds().find((f) => f.id === activeId);
    if (feed) dot.style.background = feed.color;
    if (picker) {
      const placeId = placeIdFromFeedId(activeId);
      picker.setHidden(placeId === null);
      picker.setActive(placeId);
    }
  };

  select.addEventListener('change', () => {
    selectFeed(select.value);
    sync(select.value);
  });

  slot.replaceChildren(dot, select, ...(picker ? [picker.el] : []));
  sync(options.active.id);
  slot.hidden = false;
}
