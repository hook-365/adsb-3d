// Pure geometry for the XR aircraft billboard (aircraft/xr-billboard.ts),
// split out so it can be unit-tested without the canvas / DOM imports the
// billboard itself drags in. All inputs are in xrRoot-local units (NM).

// Card size in NM units (xrRoot scales these). 6 NM wide × 3 NM tall
// works out to roughly the size of a credit card at the tabletop scale.
export const BILLBOARD_W_NM = 6;
export const BILLBOARD_H_NM = 3;

// Gap between the aircraft position and the card's bottom edge (NM), at
// the card's base size. Markers span MARKER_FOOTPRINT_UNITS (5.5 NM) at
// up to 1.2× cone scale, so their half-extent tops out around 3.3 NM;
// 4.5 NM keeps the photo card clear of the silhouette with a visible
// air gap (issue #6 round 5 — tyzbit: "offset label upwards ... so as
// not to obscure the model of the selected airplane").
export const BILLBOARD_CLEARANCE_NM = 4.5;

// Readability floor (issue #6, AR#3): the card may never render narrower
// than this fraction of its distance to the headset — 0.3 m per metre of
// distance ≈ 17° of visual field. Far or small-scaled cards grow to stay
// legible; near ones keep their airspace-tied size.
export const MIN_WIDTH_PER_METER = 0.3;

/**
 * Card width in local units for an eye at `distLocal` local units away.
 * The metre-based floor cancels the parent scale: distM = distLocal × s
 * and minLocalW = MIN × distM / s, so no world-space conversion is needed.
 */
export function readableWidth(distLocal: number): number {
  return Math.max(BILLBOARD_W_NM, MIN_WIDTH_PER_METER * distLocal);
}

/**
 * Vertical clearance for a card of width `w` — grows with the same factor
 * the readability floor applied, so a far card that doubled in size also
 * doubles its air gap instead of swallowing the marker.
 */
export function clearanceFor(w: number): number {
  return BILLBOARD_CLEARANCE_NM * (w / BILLBOARD_W_NM);
}

/**
 * Yaw (radians about +Y) that turns a +Z-facing plane at `card` toward
 * `eye`, both in the same local frame. Yaw only: the card stays
 * perpendicular to the ground no matter how the head pitches or rolls
 * (issue #6 round 5 — tyzbit: labels "shouldn't rotate with the headset").
 * Degenerate (eye directly above the card) returns 0.
 */
export function billboardYaw(
  eye: { x: number; z: number },
  card: { x: number; z: number },
): number {
  const dx = eye.x - card.x;
  const dz = eye.z - card.z;
  if (dx === 0 && dz === 0) return 0;
  return Math.atan2(dx, dz);
}
