import { getSettings, getDefaultSettings, updateSettings, type Settings } from '../core/settings';
import { THEME_OPTIONS } from '../core/theme';
import { enterVR, exitVR, getXrState, subscribeXr } from '../core/xr';

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
}
interface RangeRow {
  kind: 'range';
  key: keyof Settings;
  label: string;
  description?: string;
  min: number;
  max: number;
  step: number;
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

interface SettingsSection {
  heading: string;
  rows: SettingsRow[];
}

const SETTINGS_SCHEMA: SettingsSection[] = [
  {
    heading: 'Theme',
    rows: [
      {
        kind: 'choice',
        key: 'theme',
        label: 'Color theme',
        description: 'Palette for panels, accents, and the scene background. Auto follows your system light/dark preference.',
        options: THEME_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      },
    ],
  },
  {
    heading: 'Display',
    rows: [
      {
        kind: 'toggle',
        key: 'groundSprites',
        label: 'Ground aircraft icons',
        description: 'Show the tar1090 silhouette under each aircraft.',
      },
      {
        kind: 'toggle',
        key: 'altitudeLines',
        label: 'Altitude lines',
        description: 'Vertical line dropping each aircraft to its ground position.',
      },
      {
        kind: 'toggle',
        key: 'aircraftLabels',
        label: 'Aircraft labels',
        description: 'Callsign / registration / hex above each aircraft.',
      },
      {
        kind: 'toggle',
        key: 'acarsMessages',
        label: 'ACARS messages',
        description: 'Show ACARS datalink messages and the receiver status chip.',
      },
      {
        kind: 'range',
        key: 'labelDensity',
        label: 'Label density',
        description: 'Higher values hide farther-away labels when zoomed in. 0 keeps every label visible.',
        min: 0,
        max: 100,
        step: 1,
        format: (v) => (v === 0 ? 'all' : `${v}`),
      },
      {
        kind: 'toggle',
        key: 'rangeRings',
        label: 'Range rings',
        description: 'Concentric distance rings every 50 NM.',
      },
      {
        kind: 'choice',
        key: 'basemap',
        label: 'Basemap',
        description: 'Map tile provider drawn beneath the scene.',
        options: [
          { value: 'dark', label: 'Carto Dark' },
          { value: 'carto_voyager', label: 'Carto Voyager (light)' },
          { value: 'osm', label: 'OpenStreetMap' },
          { value: 'topo', label: 'OpenTopoMap' },
          { value: 'hillshade', label: 'ESRI Hillshade' },
          { value: 'satellite', label: 'ESRI Satellite' },
          // US-only aeronautical charts (FAA, via vfrmap.com). Coverage
          // outside CONUS/AK/HI will be blank.
          { value: 'sectional', label: 'FAA Sectional (US)' },
          { value: 'sectional_hybrid', label: 'FAA Sectional + Roads (US)' },
          { value: 'helicopter', label: 'FAA Helicopter (US)' },
          { value: 'ifr_low', label: 'FAA IFR Low (US)' },
          { value: 'ifr_high', label: 'FAA IFR High (US)' },
        ],
      },
    ],
  },
  {
    heading: 'Stereo / VR',
    rows: [
      {
        kind: 'button',
        id: 'enter-vr',
        label: 'Enter VR',
        description: 'Open an immersive WebXR session in a connected headset (Meta Quest, Vision Pro, etc.).',
        onClick: async () => {
          const s = getXrState();
          if (s.presenting) await exitVR();
          else await enterVR();
        },
        subscribe: (update) =>
          subscribeXr((s) => {
            if (s.presenting) {
              update({ label: 'Exit VR', description: 'End the active immersive session.', disabled: false });
            } else if (s.vrSupported) {
              update({
                label: 'Enter VR',
                description: 'Open an immersive WebXR session in a connected headset (Meta Quest, Vision Pro, etc.).',
                disabled: false,
              });
            } else {
              update({
                label: 'VR unavailable',
                description: s.unavailableReason ?? 'WebXR is not available in this browser.',
                disabled: true,
              });
            }
          }),
      },
      {
        kind: 'toggle',
        key: 'stereo',
        label: 'Side-by-side stereo',
        description: 'Split the view into left/right eye halves for Google Cardboard or a phone VR headset. Ignored while an immersive WebXR session is active.',
      },
      {
        kind: 'range',
        key: 'stereoStrength',
        label: 'Stereo strength',
        description: 'Eye separation when stereo is on. Higher gives deeper 3D but more eye strain.',
        min: 1,
        max: 100,
        step: 1,
      },
    ],
  },
  {
    heading: 'Units',
    rows: [
      {
        kind: 'choice',
        key: 'altitudeUnit',
        label: 'Altitude',
        options: [
          { value: 'ft', label: 'Feet (ft)' },
          { value: 'm', label: 'Meters (m)' },
        ],
      },
      {
        kind: 'choice',
        key: 'speedUnit',
        label: 'Speed',
        options: [
          { value: 'kt', label: 'Knots (kt)' },
          { value: 'mph', label: 'Miles/hour (mph)' },
          { value: 'kmh', label: 'Kilometers/hour (km/h)' },
        ],
      },
      {
        kind: 'choice',
        key: 'distanceUnit',
        label: 'Distance',
        options: [
          { value: 'nm', label: 'Nautical miles (NM)' },
          { value: 'km', label: 'Kilometers (km)' },
        ],
      },
    ],
  },
];

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
  button.setAttribute('aria-label', 'Settings');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  slot.replaceChildren(button);

  const panel = document.createElement('div');
  panel.className = 'settings-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Settings');
  panel.hidden = true;

  // Dialog header: title + an explicit close button. The close button is
  // the only reliable dismiss affordance on phones — there the panel is a
  // full-width sheet that covers the gear button, and there is no Esc key.
  const header = document.createElement('div');
  header.className = 'settings-header';
  const title = document.createElement('h2');
  title.className = 'settings-title';
  title.textContent = 'Settings';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'settings-close';
  closeBtn.setAttribute('aria-label', 'Close settings');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => setOpen(false));
  header.append(title, closeBtn);
  panel.appendChild(header);

  // Build sections + rows once. Re-render only the input states on each
  // settings change, not the whole DOM.
  for (const section of SETTINGS_SCHEMA) {
    const sectionEl = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = section.heading;
    sectionEl.appendChild(heading);

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
        // Range slider with a live-updating numeric label beside it.
        const wrap = document.createElement('span');
        wrap.className = 'settings-range';
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(row.min);
        input.max = String(row.max);
        input.step = String(row.step);
        const initial = Number(getSettings()[row.key]);
        input.value = String(initial);
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
        resetBtn.title = `Reset to default (${fmt(defaultVal)})`;
        resetBtn.setAttribute('aria-label', `Reset ${row.label} to default`);
        const syncReset = (v: number): void => {
          resetBtn.disabled = v === defaultVal;
        };
        syncReset(initial);

        input.addEventListener('input', () => {
          const v = Number(input.value);
          valueEl.textContent = fmt(v);
          syncReset(v);
          updateSettings({ [row.key]: v } as Partial<Settings>);
        });
        // The reset button lives inside the same <label> as the slider, so
        // stop the click from also retargeting the label to the input.
        resetBtn.addEventListener('click', (e) => {
          e.preventDefault();
          input.value = String(defaultVal);
          valueEl.textContent = fmt(defaultVal);
          syncReset(defaultVal);
          updateSettings({ [row.key]: defaultVal } as Partial<Settings>);
        });
        wrap.append(input, valueEl, resetBtn);
        rowEl.appendChild(wrap);
      }

      sectionEl.appendChild(rowEl);
    }
    panel.appendChild(sectionEl);
  }

  document.body.appendChild(panel);

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
