import { Color } from 'three';

// tar1090's `ColorByAlt` scheme, transcribed from tar1090's html/defaults.js
// (the palette globe.adsb.fi runs). Piecewise-linear hue interpolation in
// HSL over altitude, fixed saturation, and a per-hue lightness table that
// keeps the yellows/greens from washing out and the blues from going muddy.
// The ramp tops out at 51000 ft → hue 360 (red), so very high traffic
// (U-2s, balloons, GPS glitches) reads red like it does on tar1090.
//
// Shared by the aircraft reconciler (cone / trail / icon colors), the
// footer altitude legend, and the heatmap (which lifts lightness slightly
// for additive blending), so they always agree on hue.
export const ALT_HUE_STOPS: ReadonlyArray<{ alt: number; hue: number }> = [
  { alt: 0, hue: 20 }, // orange
  { alt: 2000, hue: 32.5 }, // yellow
  { alt: 4000, hue: 43 },
  { alt: 6000, hue: 54 },
  { alt: 8000, hue: 72 },
  { alt: 9000, hue: 85 }, // green-yellow
  { alt: 11000, hue: 140 }, // light green
  { alt: 40000, hue: 300 }, // magenta
  { alt: 51000, hue: 360 }, // red
];
export const ALT_AIR_S = 0.88;
// tar1090's ColorByAlt.air.l table: lightness as a function of hue, so
// perceived brightness stays roughly even across the ramp.
export const ALT_LIGHT_STOPS: ReadonlyArray<{ hue: number; l: number }> = [
  { hue: 0, l: 0.53 },
  { hue: 20, l: 0.5 },
  { hue: 32, l: 0.54 },
  { hue: 40, l: 0.52 },
  { hue: 46, l: 0.51 },
  { hue: 50, l: 0.46 },
  { hue: 60, l: 0.43 },
  { hue: 80, l: 0.41 },
  { hue: 100, l: 0.41 },
  { hue: 120, l: 0.41 },
  { hue: 140, l: 0.41 },
  { hue: 160, l: 0.4 },
  { hue: 180, l: 0.4 },
  { hue: 190, l: 0.44 },
  { hue: 198, l: 0.5 },
  { hue: 200, l: 0.58 },
  { hue: 220, l: 0.58 },
  { hue: 240, l: 0.58 },
  { hue: 255, l: 0.55 },
  { hue: 266, l: 0.55 },
  { hue: 270, l: 0.58 },
  { hue: 280, l: 0.58 },
  { hue: 290, l: 0.47 },
  { hue: 300, l: 0.43 },
  { hue: 310, l: 0.48 },
  { hue: 320, l: 0.48 },
  { hue: 340, l: 0.52 },
  { hue: 360, l: 0.53 },
];
// tar1090 ColorByAlt.ground: desaturated dark gray for on-ground traffic.
export const ALT_GROUND_HSL = { h: 220 / 360, s: 0, l: 0.3 };
export const ALT_MILITARY_HEX = 0xff6b81;

/** Hue (degrees) for an altitude, clamped to the end stops outside the range. */
export function altitudeHue(altFt: number): number {
  const stops = ALT_HUE_STOPS;
  if (altFt <= stops[0]!.alt) return stops[0]!.hue;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (altFt <= b.alt) {
      const t = (altFt - a.alt) / (b.alt - a.alt);
      return a.hue + (b.hue - a.hue) * t;
    }
  }
  return stops[stops.length - 1]!.hue;
}

/** Lightness (0..1) for a ramp hue, from tar1090's per-hue lightness table. */
export function altitudeLightness(hueDeg: number): number {
  const stops = ALT_LIGHT_STOPS;
  if (hueDeg <= stops[0]!.hue) return stops[0]!.l;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (hueDeg <= b.hue) {
      const t = (hueDeg - a.hue) / (b.hue - a.hue);
      return a.l + (b.l - a.l) * t;
    }
  }
  return stops[stops.length - 1]!.l;
}

/** Color for an aircraft: military override, ground tone, or altitude hue. */
export function altitudeColor(altFt: number, military: boolean, onGround = false): Color {
  if (military) return new Color(ALT_MILITARY_HEX);
  if (onGround) {
    return new Color().setHSL(ALT_GROUND_HSL.h, ALT_GROUND_HSL.s, ALT_GROUND_HSL.l);
  }
  const hue = altitudeHue(altFt);
  return new Color().setHSL((hue % 360) / 360, ALT_AIR_S, altitudeLightness(hue));
}

// Allocation-free color lookup for the reconciler's hot paths. The trail
// refresh in particular calls this once per trail point per aircraft per
// refresh; pre-bucketing avoids ~hundreds of thousands of Color allocations
// per second on busy feeds. Callers MUST treat the returned Color as
// read-only — mutating it would corrupt every other aircraft sharing the
// bucket. The standard pattern is `target.copy(altitudeColorCached(...))`.
const CACHE_BUCKET_FT = 250;
const CACHE_MIN_FT = -1000;
const CACHE_MAX_FT = 80000;
const CACHE_SIZE = Math.ceil((CACHE_MAX_FT - CACHE_MIN_FT) / CACHE_BUCKET_FT) + 1;
const AIR_COLOR_CACHE: Color[] = new Array(CACHE_SIZE);
for (let i = 0; i < CACHE_SIZE; i++) {
  const altFt = CACHE_MIN_FT + i * CACHE_BUCKET_FT;
  const hue = altitudeHue(altFt);
  AIR_COLOR_CACHE[i] = new Color().setHSL((hue % 360) / 360, ALT_AIR_S, altitudeLightness(hue));
}
const GROUND_COLOR = new Color().setHSL(ALT_GROUND_HSL.h, ALT_GROUND_HSL.s, ALT_GROUND_HSL.l);
const MILITARY_COLOR = new Color(ALT_MILITARY_HEX);

function airBucketIndex(altFt: number): number {
  const raw = Math.floor((altFt - CACHE_MIN_FT) / CACHE_BUCKET_FT);
  if (raw < 0) return 0;
  if (raw >= CACHE_SIZE) return CACHE_SIZE - 1;
  return raw;
}

/**
 * Allocation-free shared Color for an aircraft's altitude. Returns the same
 * instance for any altitude that quantizes to the same 250 ft bucket. Do
 * NOT mutate the returned Color — copy from it instead.
 */
export function altitudeColorCached(altFt: number, military: boolean, onGround = false): Color {
  if (military) return MILITARY_COLOR;
  if (onGround) return GROUND_COLOR;
  return AIR_COLOR_CACHE[airBucketIndex(altFt)]!;
}

// Lazy-populated CSS color strings keyed by the same buckets. Labels read
// these on rev-gated refreshes (so once per aircraft per ~1Hz) — small but
// free win, and avoids per-refresh string allocations.
const AIR_STYLE_CACHE: (string | undefined)[] = new Array(CACHE_SIZE);
let GROUND_STYLE: string | null = null;
let MILITARY_STYLE: string | null = null;

/** Allocation-free CSS color string matching altitudeColorCached. */
export function altitudeColorStyleCached(altFt: number, military: boolean, onGround = false): string {
  if (military) return (MILITARY_STYLE ??= MILITARY_COLOR.getStyle());
  if (onGround) return (GROUND_STYLE ??= GROUND_COLOR.getStyle());
  const idx = airBucketIndex(altFt);
  return (AIR_STYLE_CACHE[idx] ??= AIR_COLOR_CACHE[idx]!.getStyle());
}
