import { altitudeColor } from '../core/altitude-color';
import { ALT_EXAGGERATION } from '../core/config';
import { getSettings } from '../core/settings';
import { t } from '../core/i18n';

// Footer legend: the altitude → color ramp the aircraft cones use, plus a
// note that the 3D view's vertical scale is exaggerated. Static content —
// mounted once at boot into the #altitude-legend footer slot.

const MAX_ALT_FT = 40000;   // top of the ramp; hue clamps above this
const GRADIENT_STOPS = 20;  // CSS-gradient sampling resolution

/** A CSS linear-gradient sampling the real altitude palette, low → high. */
function buildGradient(): string {
  const parts: string[] = [];
  for (let i = 0; i <= GRADIENT_STOPS; i++) {
    const altFt = (i / GRADIENT_STOPS) * MAX_ALT_FT;
    const pct = (i / GRADIENT_STOPS) * 100;
    parts.push(`${altitudeColor(altFt, false).getStyle()} ${pct.toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

export function mountAltitudeLegend(): void {
  const host = document.getElementById('altitude-legend');
  if (!host) return;

  host.title = t('misc.legend_tooltip', { factor: ALT_EXAGGERATION });

  const cap = document.createElement('span');
  cap.className = 'al-cap';
  cap.textContent = t('misc.legend_alt_caption');

  // Ramp = gradient bar with altitude ticks beneath it. Five evenly-spaced
  // ticks (0–40k) align with the bar because the gradient is linear in ft.
  const ramp = document.createElement('span');
  ramp.className = 'al-ramp';

  const bar = document.createElement('span');
  bar.className = 'al-bar';
  bar.style.background = buildGradient();

  const ticks = document.createElement('span');
  ticks.className = 'al-ticks';
  for (const label of ['0', '10k', '20k', '30k', '40k+ ft']) {
    const t = document.createElement('span');
    t.textContent = label;
    ticks.appendChild(t);
  }
  ramp.append(bar, ticks);

  // Vertical-scale caveat — muted so it sits quietly beside the ramp. The
  // ×N claim only holds for the linear curve; the nonlinear curves get
  // their own wording (core/altitude-curve.ts).
  const note = document.createElement('span');
  note.className = 'al-note';
  const curve = getSettings().altitudeCurve;
  note.textContent =
    curve === 'spread_low'
      ? t('misc.legend_scale_note_low')
      : curve === 'spread_high'
        ? t('misc.legend_scale_note_high')
        : t('misc.legend_scale_note', { factor: ALT_EXAGGERATION });

  host.append(cap, ramp, note);
}
