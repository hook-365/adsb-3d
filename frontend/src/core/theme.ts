// Theme tokens + registry. One module-level singleton that owns the active
// theme, writes every token to :root as a CSS custom property, and notifies
// subscribers (Three.js modules in particular — see world/scene, world/heatmap,
// aircraft/reconciler). The CSS in style.css reads tokens via var(--token).
//
// Pattern matches core/settings.ts: load from localStorage, persist on change,
// fan out via a Set<listener>.
//
// ── Opacity tints ────────────────────────────────────────────────────────
// Tokens are *base hex colors only*. Translucent variants (e.g. the cyan
// hover wash that was rgba(76,200,255,.18)) are produced at use-site in CSS:
//   background: color-mix(in srgb, var(--accent) 18%, transparent);
// That keeps the token surface small and means a new theme only has to pick
// hues — every tint, border, and glow re-derives automatically.
//
// To add a theme:
//   1. Add an entry to THEMES with a full ThemeTokens object (every key).
//      Copy `midnightGlassTokens` as a starting point.
//   2. List it in THEME_OPTIONS so the settings picker shows it.
//   3. Author the Three.js side under `three:` (sky bg, range rings, heatmap
//      LUT). The altitude color ramp is NOT themed — it's a data convention
//      in core/altitude-color.ts and stays constant across all themes.
//
// 'auto' resolves to a concrete theme via prefers-color-scheme. Right now
// only Midnight Glass exists, so 'auto' always lands on it. Once a light
// theme ships, the resolver below will branch on the media query.

/** Every CSS custom property a theme must define. */
export interface ThemeTokens {
  // ── Base text + page ─────────────────────────────────────────────────
  bg: string;             // page background, body
  fg: string;             // primary text
  fgBright: string;       // emphasised text (HUD wordmark, label text)
  fgSoft: string;         // secondary bright text (loc name, aircraft labels)
  muted: string;          // de-emphasised text

  // ── Panel base hex (alpha applied at use-site via color-mix) ─────────
  // The dark blue cards floating over the scene. Two hues because a couple
  // of surfaces (voice body, HUD gradient top) want a slightly different
  // tint that's perceptibly distinct, not just a different opacity.
  panelBase: string;      // #080e1a — the dominant panel hue
  panelBaseAlt: string;   // #050810 — voice body (deeper) and HUD bottom-grad
  panelBaseHi: string;    // #0a1222 — HUD top-grad (lifted blue)

  // ── Surface details that aren't a simple tint of a base color ────────
  optionBg: string;       // native <option> dropdown bg (must be opaque)
  thumbBorder: string;    // tc-scrubber thumb border (sits over scene)
  badgeTextOnAccent: string; // text color when bg = solid --accent

  // ── Effects ──────────────────────────────────────────────────────────
  panelBlur: string;      // backdrop-filter blur radius (default)
  panelBlurSm: string;    // backdrop-filter blur (smaller surfaces)

  // ── Accent (the cyan that defines the brand) ─────────────────────────
  accent: string;         // single hex; tints derive via color-mix

  // ── Status ───────────────────────────────────────────────────────────
  good: string;
  warn: string;
  bad: string;

  // ── Aircraft / tag semantic colors ───────────────────────────────────
  military: string;
  special: string;
  emergency: string;
  emergencyText: string;  // text color used over solid emergency bg (white)
  acars: string;

  // ── Misc ─────────────────────────────────────────────────────────────
  coffee: string;
  phaseTaxiOut: string;
  phaseAirborne: string;
  // Axis labels read against the open scene rather than a panel — they want
  // their own tints rather than fg/muted, which would either glow against
  // dark sky or vanish over a basemap.
  axisLabel: string;      // 3D range labels (rgba already)
  axisCardinal: string;   // N/E/S/W cardinals (rgba already)
  // The drop-shadow under text that floats over the world, for legibility
  // against varied basemap colors.
  textShadowStrong: string;
  // The dark backdrop color for backdrop-filter scrim modals (ACARS browser).
  scrim: string;

  // ── Three.js side (read directly by world/scene, world/heatmap, etc.) ─
  // These are NOT written to :root; they're consumed in TS. Listed here so
  // every theme is forced to define them.
  three: {
    /** Scene clear/background color (also used for fog). */
    skyBg: string;
    /** Outermost range ring (RANGE_NM). */
    rangeRingMajor: string;
    /** Intermediate range rings. */
    rangeRingMinor: string;
    /** Home marker (the dot at the feeder location). */
    homeMarker: string;
    /** Cyan ring around the currently selected aircraft. */
    selectionRing: string;
    /** Default trail line material color (vertex altitude colors override
     *  this in practice; kept so a theme can tint trails as a fallback). */
    trailDefault: string;
    /** Red halo around aircraft broadcasting an emergency state. */
    emergencyRing: string;
    /** Purple ring that pings outward when an aircraft receives ACARS. */
    acarsPing: string;
  };
  // Heatmap is deliberately NOT themed: its vertex colors come from the
  // altitude palette (core/altitude-color.ts), which is a data convention
  // shared with the aircraft trails and stays constant across themes.
}

// Midnight Glass — the current look. Hex values are exactly today's literals
// so this pass produces zero visual change.
const midnightGlassTokens: ThemeTokens = {
  bg: '#050810',
  fg: '#d6e4ff',
  fgBright: '#e8f3ff',
  fgSoft: '#cfe5ff',
  muted: '#6f7a90',

  // Panel hues. These are the underlying *opaque* colors; alpha is applied
  // at use-site. Source literals: rgba(8,14,26,X) → panelBase #080e1a,
  // rgba(5,8,16,X) → panelBaseAlt #050810, rgba(10,18,34,X) → panelBaseHi.
  panelBase: '#080e1a',
  panelBaseAlt: '#050810',
  panelBaseHi: '#0a1222',

  optionBg: '#0b1424',
  thumbBorder: '#0a0f1a',
  badgeTextOnAccent: '#050810',

  panelBlur: '10px',
  panelBlurSm: '6px',

  accent: '#4cc8ff',

  good: '#5fe39a',
  warn: '#ffb86c',
  bad: '#ff6b81',

  military: '#ff6b81',
  special: '#ffd166',
  emergency: '#ff3344',
  emergencyText: '#ffffff',
  acars: '#d4b8ff',

  coffee: '#ffb84c',
  phaseTaxiOut: '#f5c451',
  phaseAirborne: '#6fd97a',
  axisLabel: 'rgba(180, 210, 240, 0.55)',
  axisCardinal: 'rgba(200, 230, 255, 0.75)',
  textShadowStrong: 'rgba(0, 0, 0, 0.8)',
  scrim: 'rgba(4, 8, 16, 0.65)',

  three: {
    skyBg: '#050810',
    rangeRingMajor: '#4cc8ff',
    rangeRingMinor: '#66aaff',
    homeMarker: '#ffd66b',
    selectionRing: '#4cc8ff',
    trailDefault: '#4cc8ff',
    emergencyRing: '#ff3344',
    acarsPing: '#b284ff',
  },
};

// ─── Daylight ───────────────────────────────────────────────────────────
// Light mode, projector-friendly. Inverts text/panel polarity. Neutral
// overlays in style.css use color-mix(var(--fg), N%) so the "white-on-dark"
// hairlines become "dark-on-light" automatically.
const daylightTokens: ThemeTokens = {
  bg: '#eef2f8',
  fg: '#1a2030',
  fgBright: '#0a1020',
  fgSoft: '#34425a',
  muted: '#6b7585',

  panelBase: '#ffffff',
  panelBaseAlt: '#f5f8fc',
  panelBaseHi: '#fafcfe',

  optionBg: '#ffffff',
  thumbBorder: '#cfd8e3',
  badgeTextOnAccent: '#ffffff',

  panelBlur: '10px',
  panelBlurSm: '6px',

  accent: '#0a8fc7',

  good: '#16a25a',
  warn: '#c87a00',
  bad: '#c92a3d',

  military: '#c92a3d',
  special: '#b07a00',
  emergency: '#e02020',
  emergencyText: '#ffffff',
  acars: '#7a4dd9',

  coffee: '#c87a00',
  phaseTaxiOut: '#b07a00',
  phaseAirborne: '#2a9d44',
  axisLabel: 'rgba(50, 70, 100, 0.55)',
  axisCardinal: 'rgba(20, 35, 60, 0.8)',
  // White text-halo so labels stay legible over a pale basemap.
  textShadowStrong: 'rgba(255, 255, 255, 0.85)',
  scrim: 'rgba(20, 30, 50, 0.45)',

  three: {
    skyBg: '#d8e4f0',
    rangeRingMajor: '#0a8fc7',
    rangeRingMinor: '#5fa8d5',
    homeMarker: '#c87a00',
    selectionRing: '#0a8fc7',
    trailDefault: '#0a8fc7',
    emergencyRing: '#e02020',
    acarsPing: '#7a4dd9',
  },
};

// ─── Sectional Chart ────────────────────────────────────────────────────
// FAA sectional aesthetic: parchment, magenta for Class B, blue for terminal
// areas, forest green for low altitude. Less blur — the "paper" doesn't
// want a glass effect.
const sectionalChartTokens: ThemeTokens = {
  bg: '#f4eedd',
  fg: '#2c1e0a',
  fgBright: '#1a1006',
  fgSoft: '#5a4628',
  muted: '#8a7a5a',

  panelBase: '#faf4e3',
  panelBaseAlt: '#f0e8d0',
  panelBaseHi: '#fdf8eb',

  optionBg: '#fdf8eb',
  thumbBorder: '#d8caa8',
  badgeTextOnAccent: '#fdf8eb',

  panelBlur: '4px',
  panelBlurSm: '2px',

  accent: '#a64dd9',     // Class B magenta

  good: '#2d7a2a',
  warn: '#c87b00',
  bad: '#b03520',

  military: '#b03520',
  special: '#c87b00',
  emergency: '#d62874',
  emergencyText: '#ffffff',
  acars: '#8e2d8e',

  coffee: '#c87b00',
  phaseTaxiOut: '#c87b00',
  phaseAirborne: '#2d7a2a',
  axisLabel: 'rgba(80, 60, 30, 0.6)',
  axisCardinal: 'rgba(50, 35, 15, 0.85)',
  textShadowStrong: 'rgba(244, 238, 221, 0.9)',
  scrim: 'rgba(60, 45, 20, 0.5)',

  three: {
    skyBg: '#e8dcc0',
    rangeRingMajor: '#a64dd9',     // Class B magenta on outer ring
    rangeRingMinor: '#4a6fb8',     // Class C/D blue on inner rings
    homeMarker: '#c87b00',
    selectionRing: '#a64dd9',
    trailDefault: '#4a6fb8',
    emergencyRing: '#d62874',
    acarsPing: '#8e2d8e',
  },
};

// ─── Phosphor CRT ───────────────────────────────────────────────────────
// Green-on-black scope. Pure phosphor look — bright green primary with
// amber for warnings and cyan for ACARS. The CSS-only glow comes from
// var(--text-shadow-strong) which we tint green here.
const phosphorCrtTokens: ThemeTokens = {
  bg: '#000800',
  fg: '#7eff7e',
  fgBright: '#b8ffb8',
  fgSoft: '#58dd58',
  muted: '#2e8e2e',

  panelBase: '#001a00',
  panelBaseAlt: '#000500',
  panelBaseHi: '#002600',

  optionBg: '#001a00',
  thumbBorder: '#003a00',
  badgeTextOnAccent: '#000000',

  panelBlur: '3px',
  panelBlurSm: '2px',

  accent: '#00ff66',

  good: '#00ff66',
  warn: '#ffaa00',
  bad: '#ff5050',

  military: '#ffaa00',           // amber, since green is "good"
  special: '#ffee00',
  emergency: '#ff3333',
  emergencyText: '#fff8e0',
  acars: '#00eeee',

  coffee: '#ffaa00',
  phaseTaxiOut: '#ffaa00',
  phaseAirborne: '#00ff66',
  axisLabel: 'rgba(126, 255, 126, 0.5)',
  axisCardinal: 'rgba(184, 255, 184, 0.85)',
  // Phosphor glow halo — replaces the usual black drop-shadow with a
  // green bloom so text reads like CRT phosphor.
  textShadowStrong: 'rgba(0, 255, 102, 0.55)',
  scrim: 'rgba(0, 8, 0, 0.7)',

  three: {
    skyBg: '#000800',
    rangeRingMajor: '#00ff66',
    rangeRingMinor: '#00aa44',
    homeMarker: '#ffee00',
    selectionRing: '#ffee00',     // yellow lock-on
    trailDefault: '#00cc55',
    emergencyRing: '#ff3333',
    acarsPing: '#00eeee',
  },
};

// ─── High Contrast ──────────────────────────────────────────────────────
// WCAG-AA palette. Solid black panels (panel-base is true black, so the
// at-use-site color-mix translucency lands on a black scene → effectively
// opaque). Zero blur. Pure-saturation accents for unambiguous reading.
const highContrastTokens: ThemeTokens = {
  bg: '#000000',
  fg: '#ffffff',
  fgBright: '#ffffff',
  fgSoft: '#e8e8e8',
  muted: '#b8b8b8',                // AA-passing against pure black

  panelBase: '#000000',
  panelBaseAlt: '#000000',
  panelBaseHi: '#000000',

  optionBg: '#000000',
  thumbBorder: '#ffffff',
  badgeTextOnAccent: '#000000',

  panelBlur: '0px',
  panelBlurSm: '0px',

  accent: '#ffff00',               // pure yellow on black — maximum contrast

  good: '#00ff00',
  warn: '#ff8800',
  bad: '#ff3030',

  military: '#ff3030',
  special: '#ffff00',
  emergency: '#ff0000',
  emergencyText: '#ffffff',
  acars: '#00ffff',

  coffee: '#ff8800',
  phaseTaxiOut: '#ff8800',
  phaseAirborne: '#00ff00',
  axisLabel: 'rgba(255, 255, 255, 0.7)',
  axisCardinal: 'rgba(255, 255, 255, 0.95)',
  textShadowStrong: 'rgba(0, 0, 0, 1)',
  scrim: 'rgba(0, 0, 0, 0.8)',

  three: {
    skyBg: '#000000',
    rangeRingMajor: '#ffff00',
    rangeRingMinor: '#888888',
    homeMarker: '#ffff00',
    selectionRing: '#00ffff',     // cyan to differentiate from accent yellow
    trailDefault: '#ffffff',
    emergencyRing: '#ff0000',
    acarsPing: '#00ffff',
  },
};

/** Registry. Add new themes here. */
export const THEMES = {
  'midnight-glass': midnightGlassTokens,
  'daylight': daylightTokens,
  'sectional-chart': sectionalChartTokens,
  'phosphor-crt': phosphorCrtTokens,
  'high-contrast': highContrastTokens,
} as const;

export type ThemeName = keyof typeof THEMES;

/** Includes 'auto' (resolves via prefers-color-scheme). */
export type ThemeSelection = ThemeName | 'auto';

/** Picker options for the settings panel — label + value pairs. */
export const THEME_OPTIONS: ReadonlyArray<{ value: ThemeSelection; label: string }> = [
  { value: 'auto', label: 'Auto (system)' },
  { value: 'midnight-glass', label: 'Midnight Glass' },
  { value: 'daylight', label: 'Daylight' },
  { value: 'sectional-chart', label: 'Sectional Chart' },
  { value: 'phosphor-crt', label: 'Phosphor CRT' },
  { value: 'high-contrast', label: 'High Contrast' },
];

const DEFAULT_SELECTION: ThemeSelection = 'auto';

// CSS-writable token keys (everything except `three`, which lives in TS only).
const CSS_TOKEN_KEYS = Object.keys(midnightGlassTokens).filter(
  (k) => k !== 'three',
) as Array<Exclude<keyof ThemeTokens, 'three'>>;

// Persistence is owned by core/settings.ts (the `theme` key on Settings).
// main.ts bridges subscribeSettings → setTheme so this module stays free of
// localStorage I/O and there's a single source of truth. Until that bridge
// runs we boot with DEFAULT_SELECTION; the bridge overrides it within the
// same tick once Settings load.

/** camelCase → --kebab-case CSS variable name. */
function toCssVarName(key: string): string {
  return '--' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/** Resolves 'auto' → a concrete theme via prefers-color-scheme. Light system
 *  → Daylight; dark (or no media-query support) → Midnight Glass. */
function resolveSelection(sel: ThemeSelection): ThemeName {
  if (sel !== 'auto') return sel;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'daylight';
    }
  }
  return 'midnight-glass';
}

let currentSelection: ThemeSelection = DEFAULT_SELECTION;
let currentName: ThemeName = resolveSelection(currentSelection);
const listeners = new Set<(tokens: ThemeTokens, name: ThemeName) => void>();

function applyTokens(tokens: ThemeTokens): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  for (const key of CSS_TOKEN_KEYS) {
    root.setProperty(toCssVarName(key), tokens[key] as string);
  }
}

function reapply(): void {
  const tokens = THEMES[currentName];
  applyTokens(tokens);
  // Isolated like the settings fan-out: a throwing subscriber must not
  // starve later ones (issue #6 — the scene subscriber threw in AR and
  // silently killed the wrist menu's redraws).
  for (const fn of listeners) {
    try {
      fn(tokens, currentName);
    } catch (e) {
      console.error('[theme] subscriber failed:', e);
    }
  }
}

// Apply on module load so the first paint already carries the right palette
// (avoids a flash of the fallback values that live in :root in style.css).
applyTokens(THEMES[currentName]);

// Watch system color scheme so 'auto' tracks live. No-op in non-browser
// environments (e.g. node-only test runners).
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  mq.addEventListener('change', () => {
    if (currentSelection !== 'auto') return;
    const next = resolveSelection('auto');
    if (next !== currentName) {
      currentName = next;
      reapply();
    }
  });
}

export function getTheme(): { selection: ThemeSelection; name: ThemeName; tokens: ThemeTokens } {
  return { selection: currentSelection, name: currentName, tokens: THEMES[currentName] };
}

export function setTheme(sel: ThemeSelection): void {
  if (sel !== 'auto' && !(sel in THEMES)) return;
  if (sel === currentSelection) {
    // Same selection — but the resolved name could still change if e.g.
    // 'auto' is re-set and the system scheme has flipped. Fall through.
  }
  currentSelection = sel;
  const nextName = resolveSelection(sel);
  if (nextName !== currentName) {
    currentName = nextName;
  }
  reapply();
}

export function subscribeTheme(
  fn: (tokens: ThemeTokens, name: ThemeName) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
