// Distance-based marker scale: aircraft markers keep a roughly constant
// on-screen size instead of a constant world size.
//
// Markers are drawn kilometres long so they read from the default camera
// 350 NM out. At true vertical scale (altitudeExaggeration 1) that makes a
// cruising jet about two marker-lengths above the ground, so altitude never
// registers. Scaling every marker by its distance from the camera, the way
// 2D maps size their icons, keeps the far view unchanged and lets a close
// camera see a small marker with real air underneath it.
//
// Pure math, no imports: consumed per frame by aircraft/reconciler.ts
// (marker body, selection + emergency rings, ground icon footprint) and
// unit-tested directly.

/** Camera distance at which markers reach their designed size. The boot
 * camera sits 356 NM out; full size well inside that so markers recover
 * quickly on the way back out from a close look. */
export const MARKER_REF_DISTANCE = 200;
/** Floor: a 2.4-unit cone never shrinks below ~0.2 NM, so it stays pickable. */
export const MARKER_MIN_SCALE = 0.08;
/** Ceiling: zooming out past the boot distance never grows a marker beyond
 * its designed size, so the far view looks exactly as it always did. */
export const MARKER_MAX_SCALE = 1;

/** Ground icons fade out between these view scales (camera ~27 NM to ~6 NM).
 * Close in, a flat icon several times wider than the aircraft is high
 * pokes above the marker from any low camera; the altitude line and the
 * body carry the ground reference there instead. */
export const GROUND_ICON_FADE_START = 0.3;
export const GROUND_ICON_FADE_END = 0.12;

/** Ground-icon opacity multiplier (1 far away, 0 close in) for a view scale. */
export function groundIconFade(viewScale: number): number {
  if (viewScale >= GROUND_ICON_FADE_START) return 1;
  if (viewScale <= GROUND_ICON_FADE_END) return 0;
  return (viewScale - GROUND_ICON_FADE_END) / (GROUND_ICON_FADE_START - GROUND_ICON_FADE_END);
}

/** Below 1 the shrink eases in: halving the distance leaves the marker at
 * about two thirds (0.5^0.6) instead of half, so markers hold their size
 * through a casual zoom and only get small once the camera is close. */
export const MARKER_SCALE_EXPONENT = 0.6;

/** Scale multiplier for a marker `distance` scene units from the camera. */
export function markerViewScale(distance: number): number {
  if (!(distance > 0)) return MARKER_MIN_SCALE;
  const s = (distance / MARKER_REF_DISTANCE) ** MARKER_SCALE_EXPONENT;
  return s < MARKER_MIN_SCALE ? MARKER_MIN_SCALE : s > MARKER_MAX_SCALE ? MARKER_MAX_SCALE : s;
}
