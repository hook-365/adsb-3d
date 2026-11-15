import {
  getActiveFeed,
  getExploreFeed,
  selectExplorePlace,
  selectFeed,
  type Feed,
  type FeedMode,
} from '../feed/feeds';
import { isExploreFeedId, placeIdFromFeedId, requestedPlaceId } from '../feed/explore';
import { AIRPORT_PLACE_PREFIX, loadAirports } from '../feed/explore-airports';
import { findPlace } from '../feed/explore-places';
import { createPlacePicker } from './place-picker';

// Top-bar feed switcher. Only mounted when running in multi-feed mode
// with more than one feed configured. It is a single picker
// (ui/place-picker.ts) listing the receivers and, when the deploy has an
// Explore provider, every preset city. A pick calls selectFeed() or
// selectExplorePlace(), which write URL + storage and hand off to the
// in-place switch handler registered by app/session.ts.

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

  const picker = createPlacePicker({
    receivers: options.feeds.filter((f) => !isExploreFeedId(f.id)),
    places: getExploreFeed() !== null,
    onPick: (feedId) => {
      const placeId = placeIdFromFeedId(feedId);
      if (placeId) selectExplorePlace(placeId);
      else selectFeed(feedId);
      picker.setActive(getActiveFeed().id);
    },
  });

  picker.setActive(options.active.id);

  // A shared link to an airport: the place is unknown until the airport
  // list arrives, so the page boots on the remembered place and hops over
  // once the link can be resolved.
  const wanted = requestedPlaceId();
  if (getExploreFeed() && wanted?.startsWith(AIRPORT_PLACE_PREFIX) && !findPlace(wanted)) {
    void loadAirports().then(() => {
      if (!findPlace(wanted)) return;
      selectExplorePlace(wanted);
      picker.setActive(getActiveFeed().id);
    });
  }
  slot.replaceChildren(picker.el);
  slot.hidden = false;
}
