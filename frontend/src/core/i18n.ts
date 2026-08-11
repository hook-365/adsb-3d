// UI string localization. One module-level singleton in the style of
// core/settings.ts: the active locale is resolved once at boot from the
// `language` setting ('auto' follows navigator.language), and changing the
// setting reloads the page — panels bake strings into the DOM once at build
// time, so an in-place switch would leave stale text behind.
//
// Keys are flat and dot-prefixed by owning namespace ('detail.route',
// 'voice.mute'); English (core/strings/en/) is the source of truth and the
// compile-time key registry. Aviation data (callsigns, airport names, ACARS
// payloads, aircraft type strings) is deliberately not translated.
//
// Adding a locale:
//   1. Create src/core/strings/<code>/ mirroring the en/ namespace modules.
//   2. Register it in LOCALES below, add it to LanguageSelection in
//      core/settings.ts, and add a picker option in ui/settings-panel.ts.
//   3. tests-unit/i18n.test.ts fails if any key is missing, extra, or has
//      mismatched {placeholders}.

import { getSettings, subscribeSettings } from './settings';
import { en } from './strings/en';
import { de } from './strings/de';
import { es } from './strings/es';

export type StringKey = keyof typeof en;
export type StringTable = Readonly<Record<StringKey, string>>;

/** Locale registry. New locales are added here (see header recipe). */
export const LOCALES: Record<string, StringTable> = { en, de, es };

function resolveLocale(pref: string): string {
  if (pref !== 'auto' && pref in LOCALES) return pref;
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  const short = (nav || 'en').toLowerCase().slice(0, 2);
  return short in LOCALES ? short : 'en';
}

const activeLocale = resolveLocale(getSettings().language);

/** BCP 47-ish code of the active UI locale ('en', 'de'). Feed to Intl.* APIs. */
export function getLocale(): string {
  return activeLocale;
}

/**
 * Look up a UI string in the active locale, falling back to English for
 * keys a locale hasn't translated yet. `{name}` placeholders are replaced
 * from `params` — locales may reorder them freely.
 */
export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s: string = (LOCALES[activeLocale] ?? en)[key] ?? en[key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      s = s.replaceAll(`{${name}}`, String(value));
    }
  }
  return s;
}

const I18N_ATTRS = ['title', 'aria-label', 'placeholder'] as const;

/**
 * Translate static markup in place. Elements opt in via
 * `data-i18n="key"` (textContent) and `data-i18n-title` /
 * `data-i18n-aria-label` / `data-i18n-placeholder` (attributes).
 * Called once from main.ts at boot, after which dynamic panels own
 * their own strings via t().
 */
export function applyDomStrings(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n') as StringKey);
  });
  for (const attr of I18N_ATTRS) {
    root.querySelectorAll<HTMLElement>(`[data-i18n-${attr}]`).forEach((el) => {
      el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`) as StringKey));
    });
  }
}

// Language changes reload rather than re-render: every panel writes its
// strings into the DOM at build time, and chasing each stale node is not
// worth the complexity for a setting toggled approximately once ever.
let lastLanguagePref = getSettings().language;
subscribeSettings((s) => {
  if (s.language !== lastLanguagePref) {
    lastLanguagePref = s.language;
    if (typeof location !== 'undefined') location.reload();
  }
});
