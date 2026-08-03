// Merged Spanish string table. Machine-drafted mirror of en/ pending
// native-speaker review; the drift test enforces key and {placeholder}
// parity with English.
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

export const es = {
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
