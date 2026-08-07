import { getSettings, subscribeSettings, updateSettings, type AircraftShapeStyle } from '../core/settings';
import { t, type StringKey } from '../core/i18n';

// Top-right quick cycler for the aircraftShape setting — the discoverable
// face of a control that otherwise lives three clicks deep in the settings
// panel. Clicking steps cone → sphere → silhouette; the glyph always shows
// the current mode. State flows one way: the chip writes via
// updateSettings and re-renders from subscribeSettings, so changes from
// the settings panel or the VR wrist menu update it for free.

const CYCLE: readonly AircraftShapeStyle[] = ['cone', 'sphere', 'silhouette'];

const GLYPHS: Record<AircraftShapeStyle, string> = {
  cone: '▲',
  sphere: '●',
  silhouette: '✈',
};

const LABEL_KEYS: Record<AircraftShapeStyle, StringKey> = {
  cone: 'settings.shape_cone',
  sphere: 'settings.shape_sphere',
  silhouette: 'settings.shape_silhouette',
};

export function mountShapeChip(): void {
  const chip = document.getElementById('shape-chip') as HTMLButtonElement | null;
  if (!chip) return;

  function render(shape: AircraftShapeStyle): void {
    chip!.textContent = GLYPHS[shape];
    // Tooltip names the current mode; the aria-label from index.html
    // stays the stable control name.
    chip!.title = `${t('static.shape_chip_aria')}: ${t(LABEL_KEYS[shape])}`;
  }

  chip.addEventListener('click', () => {
    const cur = getSettings().aircraftShape;
    const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length]!;
    updateSettings({ aircraftShape: next });
  });

  // Unsubscribe handle intentionally discarded — page-lifetime singleton.
  subscribeSettings((s) => render(s.aircraftShape));
  render(getSettings().aircraftShape);
}
