import { Color } from 'three';

// tar1090's `ColorByAlt` scheme (config.js in the tar1090 / readsb-protobuf
// repo). Piecewise-linear hue interpolation in HSL; saturation/lightness
// fixed for airborne aircraft, a separate dimmer color for ground.
//   2000 ft  → hue 20  (orange)
//   10000 ft → hue 140 (light green)
//   40000 ft → hue 300 (magenta)
//
// Shared by the aircraft reconciler (cone / trail / icon colors) and the
// footer altitude legend, so the legend always matches the cones on screen.
// The heatmap keeps its own near-copy on purpose — it brightens lightness
// for additive blending; see world/heatmap.ts.
export const ALT_HUE_STOPS: ReadonlyArray<{ alt: number; hue: number }> = [
  { alt: 2000, hue: 20 },
  { alt: 10000, hue: 140 },
  { alt: 40000, hue: 300 },
];
export const ALT_AIR_S = 0.85;
export const ALT_AIR_L = 0.5;
export const ALT_GROUND_HSL = { h: 230 / 360, s: 0.4, l: 0.3 };
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

/** Color for an aircraft: military override, ground tone, or altitude hue. */
export function altitudeColor(altFt: number, military: boolean, onGround = false): Color {
  if (military) return new Color(ALT_MILITARY_HEX);
  if (onGround) {
    return new Color().setHSL(ALT_GROUND_HSL.h, ALT_GROUND_HSL.s, ALT_GROUND_HSL.l);
  }
  return new Color().setHSL(altitudeHue(altFt) / 360, ALT_AIR_S, ALT_AIR_L);
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
  AIR_COLOR_CACHE[i] = new Color().setHSL(altitudeHue(altFt) / 360, ALT_AIR_S, ALT_AIR_L);
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
