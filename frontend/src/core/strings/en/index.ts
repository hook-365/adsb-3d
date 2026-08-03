// Merged English string table — the source of truth for StringKey and the
// fallback for locales with missing keys. One namespace module per owning
// UI module; a key lives in exactly one namespace (collisions between
// namespaces would silently override in the spread below, so the drift
// test counts keys per module against the merged total).
import { staticStrings } from './static';
import { mainStrings } from './main';
import { listStrings } from './list';
import { detailStrings } from './detail';
import { settingsStrings } from './settings';
import { voiceStrings } from './voice';
import { acarsStrings } from './acars';
import { timeStrings } from './time';
import { feedsStrings } from './feeds';
import { miscStrings } from './misc';

export const EN_NAMESPACES = {
  static: staticStrings,
  main: mainStrings,
  list: listStrings,
  detail: detailStrings,
  settings: settingsStrings,
  voice: voiceStrings,
  acars: acarsStrings,
  time: timeStrings,
  feeds: feedsStrings,
  misc: miscStrings,
} as const;

export const en = {
  ...staticStrings,
  ...mainStrings,
  ...listStrings,
  ...detailStrings,
  ...settingsStrings,
  ...voiceStrings,
  ...acarsStrings,
  ...timeStrings,
  ...feedsStrings,
  ...miscStrings,
} as const;
