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
