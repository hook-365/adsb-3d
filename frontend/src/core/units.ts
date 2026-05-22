import { getSettings } from './settings';

// Unit-aware formatters. All consumers re-render every store snapshot
// (~1 Hz) so we read the active unit choice live via getSettings() at
// each call rather than wiring up a subscription. Toggling units in the
// settings panel updates the next render frame automatically.

const FT_PER_M = 3.28084;
const NM_PER_KM = 0.539957;

function fmtNumber(n: number): string {
  return Math.round(n).toLocaleString();
}

/**
 * Aircraft altitude. `compact` returns the list-style "12.5k" form;
 * default returns the detail-card "12,500 ft" form.
 */
export function fmtAltitude(altFt: number, opts: { compact?: boolean } = {}): string {
  const unit = getSettings().altitudeUnit;
  const value = unit === 'm' ? altFt / FT_PER_M : altFt;
  const suffix = unit === 'm' ? 'm' : 'ft';
  if (opts.compact) {
    if (Math.abs(value) < 1000) return `${Math.round(value)}`;
    return `${(value / 1000).toFixed(1)}k`;
  }
  return `${fmtNumber(value)} ${suffix}`;
}

/** Ground speed. */
export function fmtSpeed(kt: number | null): string {
  if (kt === null) return '—';
  const unit = getSettings().speedUnit;
  let value = kt;
  let suffix = 'kt';
  if (unit === 'mph') {
    value = kt * 1.15078;
    suffix = 'mph';
  } else if (unit === 'kmh') {
    value = kt * 1.852;
    suffix = 'km/h';
  }
  return `${fmtNumber(value)} ${suffix}`;
}

/** Same shape as fmtSpeed but without the trailing unit (for list rows). */
export function fmtSpeedCompact(kt: number | null): string {
  if (kt === null) return '—';
  const unit = getSettings().speedUnit;
  let value = kt;
  if (unit === 'mph') value = kt * 1.15078;
  else if (unit === 'kmh') value = kt * 1.852;
  return `${Math.round(value)}`;
}

/** Distance from home, in user units. */
export function fmtDistance(nm: number): string {
  const unit = getSettings().distanceUnit;
  if (unit === 'km') {
    const km = nm / NM_PER_KM;
    return `${km.toFixed(km < 10 ? 1 : 0)} km`;
  }
  return `${nm.toFixed(nm < 10 ? 1 : 0)} NM`;
}

/** List-row distance: same units, no suffix. */
export function fmtDistanceCompact(nm: number): string {
  const unit = getSettings().distanceUnit;
  const value = unit === 'km' ? nm / NM_PER_KM : nm;
  if (value < 10) return value.toFixed(1);
  return `${Math.round(value)}`;
}

/** Vertical rate. fpm is fairly aviation-specific; switch to m/s when in metric altitude. */
export function fmtVerticalRate(fpm: number): string {
  const unit = getSettings().altitudeUnit;
  if (unit === 'm') {
    const mps = (fpm / 60) / FT_PER_M;
    return `${mps.toFixed(1)} m/s`;
  }
  return `${fmtNumber(Math.abs(fpm))} fpm`;
}
