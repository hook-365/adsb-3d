import {
  BASEMAP_VALUES,
  getSettings,
  getDefaultSettings,
  subscribeSettings,
  updateSettings,
  type Basemap,
  type Settings,
} from '../core/settings';
import { t } from '../core/i18n';
import { THEME_OPTIONS } from '../core/theme';
import { enterAR, enterVR, exitVR, getXrState, subscribeXr } from '../core/xr';
import { DIORAMA_SIZE_MAX_M, DIORAMA_SIZE_MIN_M } from '../world/diorama-clip';

// Gear button + popover panel. Mounted into a slot the host page provides
// in the header (#settings-slot) and a panel container appended to <body>
// (so it can overlay everything, including the aircraft list panel).
//
// Adding a setting: extend SETTINGS_SCHEMA. The panel renders directly
// from this list, so a new entry shows up automatically.

interface ToggleRow {
  kind: 'toggle';
  key: keyof Settings;
  label: string;
  description?: string;
}
interface ChoiceRow {
  kind: 'choice';
  key: keyof Settings;
  label: string;
  description?: string;
  options: { value: string; label: string }[];
  /**
   * Optional, mirrors ButtonRow.subscribe: lets the description react to
   * external state (e.g. VR quality showing the measured resolution of
   * the last headset session).
   */
  subscribe?: (update: (s: { description?: string }) => void) => () => void;
}
interface RangeRow {
  kind: 'range';
  key: keyof Settings;
  label: string;
  description?: string;
  min: number;
  max: number;
  step: number;
  /**
   * Nonlinear stop list. When present the slider moves through these
   * values left-to-right (min/max/step are ignored) — used where the
   * useful scale isn't linear, e.g. trail length's minutes-to-infinity.
   */
  values?: readonly number[];
  /** Render the numeric value beside the slider. Defaults to a plain integer. */
  format?: (value: number) => string;
}
/**
 * Action row. Renders the button on the right with the same row chrome as
 * the other inputs. `subscribe` is optional — supply it if the button's
 * label/description/disabled state needs to change with external state
 * (e.g. Enter VR reacts to whether a session is presenting).
 */
interface ButtonRow {
  kind: 'button';
  /** Stable id, used as a React-style key-ish hint. Not a Settings key. */
  id: string;
  label: string;
  description?: string;
  onClick: () => void | Promise<void>;
  subscribe?: (
    update: (s: { label?: string; description?: string; disabled?: boolean }) => void,
  ) => () => void;
}
type SettingsRow = ToggleRow | ChoiceRow | RangeRow | ButtonRow;

// Full display labels per basemap. Record<Basemap, …> so extending
// BASEMAP_VALUES without labelling the new entry here fails to compile
// (the wrist menu keeps its own terse map the same way).

const BASEMAP_LABELS: Record<Basemap, string> = {
  dark: t('settings.basemap_carto_dark'),
  carto_voyager: t('settings.basemap_carto_voyager'),
  osm: t('settings.basemap_osm'),
  topo: t('settings.basemap_topo'),
  hillshade: t('settings.basemap_hillshade'),
  satellite: t('settings.basemap_satellite'),
  sectional: t('settings.basemap_sectional'),
  sectional_hybrid: t('settings.basemap_sectional_hybrid'),
  helicopter: t('settings.basemap_helicopter'),
  ifr_low: t('settings.basemap_ifr_low'),
  ifr_high: t('settings.basemap_ifr_high'),
};

export interface SettingsSection {
  /** Stable id — keys the persisted collapse state, never user-visible. */
  id: string;
  heading: string;
  rows: SettingsRow[];
}

// Settings keys that intentionally have no panel row. Mirrors the wrist
// menu's WRIST_MENU_EXCLUDED convention; the drift-guard test
// (tests-unit/settings-panel.test.ts) fails if a Settings key is neither
// in the schema nor documented here.
export const PANEL_EXCLUDED_KEYS: Record<string, string> = {
  vrScale: 'written by VR thumbstick locomotion every frame; not a form control',
  arScale: 'written by AR thumbstick locomotion every frame; not a form control',
};

export const SETTINGS_SCHEMA: SettingsSection[] = [
  {
    id: 'appearance',
    heading: t('settings.section_appearance'),
    rows: [
      {
        kind: 'choice',
        key: 'theme',
        label: t('settings.color_theme'),
        description: t('settings.color_theme_desc'),
        options: THEME_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      },
      {
        kind: 'choice',
        key: 'language',
        label: t('settings.language'),
        description: t('settings.language_desc'),
        options: [
          { value: 'auto', label: t('settings.language_auto') },
          { value: 'en', label: 'English' },
          // Native names on purpose: a user stuck in the wrong language
          // must be able to find their own.
          { value: 'de', label: 'Deutsch' },
          { value: 'es', label: 'Español' },
        ],
      },
    ],
  },
  {
    id: 'aircraft',
    heading: t('settings.section_aircraft'),
    rows: [
      {
        kind: 'choice',
        key: 'aircraftShape',
        label: t('settings.aircraft_shape'),
        description: t('settings.aircraft_shape_desc'),
        options: [
          { value: 'cone', label: t('settings.shape_cone') },
          { value: 'sphere', label: t('settings.shape_sphere') },
          { value: 'silhouette', label: t('settings.shape_silhouette') },
        ],
      },
      {
        kind: 'toggle',
        key: 'historyTrails',
        label: t('settings.history_trails'),
        description: t('settings.history_trails_desc'),
      },
      {
        kind: 'range',
        key: 'trailLength',
        label: t('settings.trail_length'),
        description: t('settings.trail_length_desc'),
        min: 0,
        max: 8,
        step: 1,
        // Approximate minutes of history; -1 = everything collected.
        values: [0, 1, 2, 5, 10, 15, 30, 60, -1],
        format: (v) =>
          v < 0
            ? t('settings.trail_length_full')
            : v === 0
              ? '0'
              : t('settings.trail_length_min', { n: v }),
      },
      {
        kind: 'toggle',
        key: 'groundSprites',
        label: t('settings.ground_sprites'),
        description: t('settings.ground_sprites_desc'),
      },
      {
        kind: 'toggle',
        key: 'altitudeLines',
        label: t('settings.altitude_lines'),
        description: t('settings.altitude_lines_desc'),
      },
      {
        kind: 'toggle',
        key: 'aircraftLabels',
        label: t('settings.aircraft_labels'),
        description: t('settings.aircraft_labels_desc'),
      },
      {
        kind: 'range',
        key: 'labelDensity',
        label: t('settings.label_density'),
        description: t('settings.label_density_desc'),
        min: 0,
        max: 100,
        step: 1,
        format: (v) => (v === 0 ? t('settings.label_density_all') : `${v}`),
      },
      {
        kind: 'toggle',
        key: 'acarsMessages',
        label: t('settings.acars_messages'),
        description: t('settings.acars_messages_desc'),
      },
    ],
  },
  {
    id: 'map',
    heading: t('settings.section_map'),
    rows: [
      {
        kind: 'choice',
        key: 'basemap',
        label: t('settings.basemap'),
        description: t('settings.basemap_desc'),
        // Canonical order from BASEMAP_VALUES. The FAA charts at the tail
        // (sectional onward) are US-only; coverage outside CONUS/AK/HI is
        // blank.
        options: BASEMAP_VALUES.map((v) => ({ value: v, label: BASEMAP_LABELS[v] })),
      },
      {
        kind: 'toggle',
        key: 'terrain3d',
        label: t('settings.terrain_3d'),
        description: t('settings.terrain_3d_desc'),
      },
      {
        kind: 'toggle',
        key: 'rangeRings',
        label: t('settings.range_rings'),
        description: t('settings.range_rings_desc'),
      },
      {
        kind: 'range',
        key: 'altitudeCurveBias',
        label: t('settings.altitude_curve'),
        description: t('settings.altitude_curve_desc'),
        min: -100,
        max: 100,
        step: 5,
        format: (v) =>
          v === 0
            ? t('settings.altitude_curve_fmt_linear')
            : v < 0
              ? t('settings.altitude_curve_fmt_low', { n: -v })
              : t('settings.altitude_curve_fmt_high', { n: v }),
      },
    ],
  },
  {
    id: 'xr',
    heading: t('settings.section_stereo_vr'),
    rows: [
      {
        kind: 'button',
        id: 'enter-vr',
        label: t('settings.enter_vr'),
        description: t('settings.enter_vr_desc'),
        onClick: async () => {
          const s = getXrState();
          if (s.presenting) await exitVR();
          else await enterVR();
        },
        subscribe: (update) =>
          subscribeXr((s) => {
            if (s.presenting && s.presentingMode === 'vr') {
              update({ label: t('settings.exit_vr'), description: t('settings.exit_vr_desc'), disabled: false });
            } else if (s.presenting) {
              // An AR session is active — VR button is disabled until it ends.
              update({
                label: t('settings.enter_vr'),
                description: t('settings.exit_ar_first'),
                disabled: true,
              });
            } else if (s.vrSupported) {
              update({
                label: t('settings.enter_vr'),
                description: s.lastError ?? t('settings.enter_vr_desc'),
                disabled: false,
              });
            } else {
              update({
                label: t('settings.vr_unavailable'),
                description: s.unavailableReason ?? t('settings.webxr_unavailable'),
                disabled: true,
              });
            }
          }),
      },
      {
        kind: 'button',
        id: 'enter-ar',
        label: t('settings.enter_ar'),
        description: t('settings.enter_ar_desc'),
        onClick: async () => {
          const s = getXrState();
          if (s.presenting) await exitVR();
          else await enterAR();
        },
        subscribe: (update) =>
          subscribeXr((s) => {
            if (s.presenting && s.presentingMode === 'ar') {
              update({ label: t('settings.exit_ar'), description: t('settings.exit_ar_desc'), disabled: false });
            } else if (s.presenting) {
              update({
                label: t('settings.enter_ar'),
                description: t('settings.exit_vr_first'),
                disabled: true,
              });
            } else if (s.arSupported) {
              update({
                label: t('settings.enter_ar'),
                description: s.lastError ?? t('settings.enter_ar_desc'),
                disabled: false,
              });
            } else {
              update({
                label: t('settings.ar_unavailable'),
                description: t('settings.ar_unsupported'),
                disabled: true,
              });
            }
          }),
      },
      {
        kind: 'choice',
        key: 'vrQuality',
        label: t('settings.vr_quality'),
        description: t('settings.vr_quality_desc'),
        options: [
          { value: 'low', label: t('settings.vr_quality_low') },
          { value: 'balanced', label: t('settings.vr_quality_balanced') },
          { value: 'high', label: t('settings.vr_quality_high') },
          { value: 'ultra', label: t('settings.vr_quality_ultra') },
        ],
        // Append the measured per-eye resolution once a session has run —
        // the runtime may clamp the scale we ask for, so this is the only
        // way to see whether a higher preset actually changes anything.
        subscribe: (update) =>
          subscribeXr((s) => {
            update({
              description: s.layerResolution
                ? `${t('settings.vr_quality_desc')} ${t('settings.vr_quality_measured', {
                    w: s.layerResolution.perEyeWidth,
                    h: s.layerResolution.height,
                  })}`
                : t('settings.vr_quality_desc'),
            });
          }),
      },
      {
        kind: 'choice',
        key: 'xrMoveMode',
        label: t('settings.xr_move_mode'),
        description: t('settings.xr_move_mode_desc'),
        options: [
          { value: 'scope', label: t('settings.xr_move_scope') },
          { value: 'freefly', label: t('settings.xr_move_freefly') },
        ],
      },
      {
        kind: 'choice',
        key: 'xrTurnStyle',
        label: t('settings.xr_turn_style'),
        description: t('settings.xr_turn_style_desc'),
        options: [
          { value: 'snap', label: t('settings.xr_turn_snap') },
          { value: 'smooth', label: t('settings.xr_turn_smooth') },
        ],
      },
      {
        kind: 'toggle',
        key: 'dioramaClip',
        label: t('settings.diorama_clip'),
        description: t('settings.diorama_clip_desc'),
      },
      {
        kind: 'range',
        key: 'dioramaSize',
        label: t('settings.diorama_size'),
        description: t('settings.diorama_size_desc'),
        min: DIORAMA_SIZE_MIN_M,
        max: DIORAMA_SIZE_MAX_M,
        step: 0.1,
        format: (v) => `${v.toFixed(1)} m`,
      },
      {
        kind: 'toggle',
        key: 'xrFollow',
        label: t('settings.xr_follow'),
        description: t('settings.xr_follow_desc'),
      },
      {
        kind: 'toggle',
        key: 'stereo',
        label: t('settings.stereo'),
        description: t('settings.stereo_desc'),
      },
      {
        kind: 'range',
        key: 'stereoStrength',
        label: t('settings.stereo_strength'),
        description: t('settings.stereo_strength_desc'),
        min: 1,
        max: 100,
        step: 1,
      },
    ],
  },
  {
    id: 'units',
    heading: t('settings.section_units'),
    rows: [
      {
        kind: 'choice',
        key: 'altitudeUnit',
        label: t('settings.altitude_unit'),
        options: [
          { value: 'ft', label: t('settings.unit_feet') },
          { value: 'm', label: t('settings.unit_meters') },
        ],
      },
      {
        kind: 'choice',
        key: 'speedUnit',
        label: t('settings.speed_unit'),
        options: [
          { value: 'kt', label: t('settings.unit_knots') },
          { value: 'mph', label: t('settings.unit_mph') },
          { value: 'kmh', label: t('settings.unit_kmh') },
        ],
      },
      {
        kind: 'choice',
        key: 'distanceUnit',
        label: t('settings.distance_unit'),
        options: [
          { value: 'nm', label: t('settings.unit_nm') },
          { value: 'km', label: t('settings.unit_km') },
        ],
      },
    ],
  },
];

// Collapsed/expanded state per section, persisted so the panel reopens the
// way the user left it. Deliberately NOT part of Settings: it's panel
// chrome, not a preference the wrist menu or URL state should ever see.
const SECTIONS_KEY = 'adsb3d_settings_sections_v1';
const DEFAULT_OPEN_SECTIONS = ['aircraft'];
function loadOpenSections(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SECTIONS_KEY);
    if (!raw) return new Set(DEFAULT_OPEN_SECTIONS);
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set(DEFAULT_OPEN_SECTIONS);
  }
}
function saveOpenSections(open: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(SECTIONS_KEY, JSON.stringify([...open]));
  } catch {
    // Private-mode storage failures just lose the collapse memory.
  }
}

const GEAR_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path fill="currentColor" d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.488.488 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5z"/>
  </svg>
`;

export function mountSettingsPanel(): void {
  const slot = document.getElementById('settings-slot');
  if (!slot) return;

  const button = document.createElement('button');
  button.className = 'settings-button';
  button.type = 'button';
  button.innerHTML = GEAR_SVG;
  button.setAttribute('aria-label', t('settings.title'));
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  slot.replaceChildren(button);

  const panel = document.createElement('div');
  panel.className = 'settings-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('settings.title'));
  panel.hidden = true;

  // Dialog header: title + an explicit close button. The close button is
  // the only reliable dismiss affordance on phones — there the panel is a
  // full-width sheet that covers the gear button, and there is no Esc key.
  const header = document.createElement('div');
  header.className = 'settings-header';
  const title = document.createElement('h2');
  title.className = 'settings-title';
  title.textContent = t('settings.title');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'settings-close';
  closeBtn.setAttribute('aria-label', t('settings.close'));
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => setOpen(false));
  header.append(title, closeBtn);
  panel.appendChild(header);

  // Build sections + rows once. Re-render only the input states on each
  // settings change, not the whole DOM.
  //
  // Settings can change from outside this panel (shape chip, VR wrist
  // menu) — each input row registers a sync closure here, and one
  // subscriber below re-reads the store into the DOM so the panel never
  // shows stale values. Programmatic .value/.checked writes don't fire
  // change/input events, so this can't loop back into updateSettings.
  const inputSyncs: ((s: Readonly<Settings>) => void)[] = [];
  const openSections = loadOpenSections();
  for (const section of SETTINGS_SCHEMA) {
    const sectionEl = document.createElement('section');
    sectionEl.className = 'settings-section';

    // Collapsible header (voice-panel's aria-expanded convention). The
    // whole heading row is the toggle; body rows live in a wrapper whose
    // `hidden` mirrors the persisted open set.
    const sectionToggle = document.createElement('button');
    sectionToggle.type = 'button';
    sectionToggle.className = 'settings-section-toggle';
    const chevron = document.createElement('span');
    chevron.className = 'settings-section-chevron';
    chevron.textContent = '▸';
    const headingText = document.createElement('span');
    headingText.textContent = section.heading;
    sectionToggle.append(chevron, headingText);

    const body = document.createElement('div');
    body.className = 'settings-section-body';
    const initiallyOpen = openSections.has(section.id);
    sectionToggle.setAttribute('aria-expanded', String(initiallyOpen));
    body.hidden = !initiallyOpen;
    sectionToggle.addEventListener('click', () => {
      const nowOpen = body.hidden;
      body.hidden = !nowOpen;
      sectionToggle.setAttribute('aria-expanded', String(nowOpen));
      if (nowOpen) openSections.add(section.id);
      else openSections.delete(section.id);
      saveOpenSections(openSections);
    });
    sectionEl.append(sectionToggle, body);

    for (const row of section.rows) {
      const rowEl = document.createElement('label');
      rowEl.className = 'settings-row';

      const text = document.createElement('div');
      text.className = 'settings-row-text';
      const lab = document.createElement('div');
      lab.className = 'settings-row-label';
      lab.textContent = row.label;
      text.appendChild(lab);
      if (row.description) {
        const desc = document.createElement('div');
        desc.className = 'settings-row-desc';
        desc.textContent = row.description;
        text.appendChild(desc);
      }
      rowEl.appendChild(text);

      if (row.kind === 'toggle') {
        const switchWrap = document.createElement('span');
        switchWrap.className = 'settings-switch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(getSettings()[row.key]);
        input.addEventListener('change', () => {
          updateSettings({ [row.key]: input.checked } as Partial<Settings>);
        });
        const slider = document.createElement('span');
        slider.className = 'settings-switch-slider';
        switchWrap.append(input, slider);
        rowEl.appendChild(switchWrap);
        inputSyncs.push((s) => {
          input.checked = Boolean(s[row.key]);
        });
      } else if (row.kind === 'choice') {
        const select = document.createElement('select');
        select.className = 'settings-select';
        const current = String(getSettings()[row.key]);
        for (const opt of row.options) {
          const optEl = document.createElement('option');
          optEl.value = opt.value;
          optEl.textContent = opt.label;
          if (opt.value === current) optEl.selected = true;
          select.appendChild(optEl);
        }
        select.addEventListener('change', () => {
          updateSettings({ [row.key]: select.value } as Partial<Settings>);
        });
        rowEl.appendChild(select);
        inputSyncs.push((s) => {
          select.value = String(s[row.key]);
        });
        if (row.subscribe) {
          const descEl = text.querySelector('.settings-row-desc') as HTMLElement | null;
          row.subscribe((s) => {
            if (s.description !== undefined && descEl) descEl.textContent = s.description;
          });
        }
      } else if (row.kind === 'button') {
        // Action row — a button on the right, sized like the other inputs.
        // Initial state from the row config; subscribe() (if provided) can
        // mutate label/description/disabled live in response to outside
        // state. Used by Enter VR to react to WebXR availability + session
        // presenting state without re-rendering the panel.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'settings-action';
        btn.textContent = row.label;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          void row.onClick();
        });
        if (row.subscribe) {
          const labelEl = lab;
          const descEl = text.querySelector('.settings-row-desc') as HTMLElement | null;
          row.subscribe((s) => {
            if (s.label !== undefined) {
              btn.textContent = s.label;
              labelEl.textContent = s.label;
            }
            if (s.description !== undefined && descEl) descEl.textContent = s.description;
            if (s.disabled !== undefined) btn.disabled = s.disabled;
          });
        }
        rowEl.appendChild(btn);
      } else {
        // Range slider with a live-updating numeric label beside it. With
        // row.values the slider runs in index space over the stop list
        // (nonlinear scales); otherwise it's the plain min/max/step range.
        const wrap = document.createElement('span');
        wrap.className = 'settings-range';
        const input = document.createElement('input');
        input.type = 'range';
        const stops = row.values ?? null;
        const toSlider = (v: number): number => {
          if (!stops) return v;
          const exact = stops.indexOf(v);
          if (exact >= 0) return exact;
          // Migrated / out-of-list value: snap to the closest stop,
          // treating the -1 "full" sentinel as larger than everything.
          let best = 0;
          let bestDist = Number.POSITIVE_INFINITY;
          for (let i = 0; i < stops.length; i++) {
            const sv = stops[i]!;
            if (sv < 0 || v < 0) continue;
            const d = Math.abs(sv - v);
            if (d < bestDist) {
              bestDist = d;
              best = i;
            }
          }
          return v < 0 ? stops.indexOf(-1) : best;
        };
        const fromSlider = (s: number): number => (stops ? (stops[s] ?? stops[0]!) : s);
        if (stops) {
          input.min = '0';
          input.max = String(stops.length - 1);
          input.step = '1';
        } else {
          input.min = String(row.min);
          input.max = String(row.max);
          input.step = String(row.step);
        }
        const initial = Number(getSettings()[row.key]);
        input.value = String(toSlider(initial));
        const valueEl = document.createElement('span');
        valueEl.className = 'settings-range-value';
        const fmt = row.format ?? ((v: number) => String(v));
        valueEl.textContent = fmt(initial);

        // Reset-to-default button. Disabled (not hidden) while the slider
        // already sits at its factory value, so the row width never jumps.
        const defaultVal = Number(getDefaultSettings()[row.key]);
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'settings-range-reset';
        resetBtn.textContent = '↺';
        resetBtn.title = t('settings.reset_to_default', { value: fmt(defaultVal) });
        resetBtn.setAttribute('aria-label', t('settings.reset_row_to_default', { label: row.label }));
        const syncReset = (v: number): void => {
          resetBtn.disabled = v === defaultVal;
        };
        syncReset(initial);

        input.addEventListener('input', () => {
          const v = fromSlider(Number(input.value));
          valueEl.textContent = fmt(v);
          syncReset(v);
          updateSettings({ [row.key]: v } as Partial<Settings>);
        });
        // The reset button lives inside the same <label> as the slider, so
        // stop the click from also retargeting the label to the input.
        resetBtn.addEventListener('click', (e) => {
          e.preventDefault();
          input.value = String(toSlider(defaultVal));
          valueEl.textContent = fmt(defaultVal);
          syncReset(defaultVal);
          updateSettings({ [row.key]: defaultVal } as Partial<Settings>);
        });
        wrap.append(input, valueEl, resetBtn);
        rowEl.appendChild(wrap);
        inputSyncs.push((s) => {
          const v = Number(s[row.key]);
          input.value = String(toSlider(v));
          valueEl.textContent = fmt(v);
          syncReset(v);
        });
      }

      body.appendChild(rowEl);
    }
    panel.appendChild(sectionEl);
  }

  document.body.appendChild(panel);

  // Unsubscribe handle intentionally discarded — page-lifetime singleton.
  subscribeSettings((s) => {
    for (const fn of inputSyncs) fn(s);
  });

  function setOpen(open: boolean): void {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.classList.toggle('open', open);
  }

  // Clicks on the sidebar hamburger should NOT dismiss the settings — we
  // want the popover to slide left/right with the sidebar state, not close
  // when the user toggles it. Look up the toggle once at mount time.
  const sidebarToggle = document.getElementById('panel-toggle');

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(panel.hidden);
  });
  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    const target = e.target as Node;
    if (panel.contains(target)) return;
    if (button.contains(target)) return;
    if (sidebarToggle?.contains(target)) return;
    setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) setOpen(false);
  });
}
