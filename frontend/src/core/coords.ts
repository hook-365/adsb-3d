import { Vector3 } from 'three';
import { ALT_EXAGGERATION, HOME, subscribeHome } from './config';
import { getSettings, subscribeSettings } from './settings';
import { CURVE_CEILING_FT, warpAltitudeFraction } from './altitude-curve';

// Local east-north-up tangent-plane projection centered on HOME. Plenty
// accurate within a few hundred nautical miles, which is the ADS-B
// receiver horizon anyway. Aircraft near the antipode would distort but
// they're not visible from a single feeder.

const NM_PER_DEG_LAT = 60;
const FT_PER_NM = 6076.12;

let cosHomeLat = Math.cos((HOME.lat * Math.PI) / 180);

// Recompute the latitude scale factor whenever HOME changes (Phase 2b
// in-place feed switching). All call sites read `cosHomeLat` live so
// the next projection picks up the new value automatically.
subscribeHome(() => {
  cosHomeLat = Math.cos((HOME.lat * Math.PI) / 180);
});

// Altitude → scene-height mapping. The curve is read once at boot; changing
// the setting reloads the page (mirrors the language setting) because trail
// and heatmap geometry bake the mapping in and would otherwise go stale.
const altitudeCurve = getSettings().altitudeCurve;
// Scene height of CURVE_CEILING_FT — identical for every curve, so curve
// choice redistributes space below the ceiling without rescaling the scene.
const CEILING_UP = (CURVE_CEILING_FT / FT_PER_NM) * ALT_EXAGGERATION;

let lastCurve = altitudeCurve;
subscribeSettings((s) => {
  if (s.altitudeCurve !== lastCurve) {
    lastCurve = s.altitudeCurve;
    if (typeof location !== 'undefined') location.reload();
  }
});

/** Returns scene-units position for (lat, lon, altFt). 1 unit = 1 NM east/north. */
export function toScene(lat: number, lon: number, altFt: number, out: Vector3): Vector3 {
  const east = (lon - HOME.lon) * NM_PER_DEG_LAT * cosHomeLat;
  const north = (lat - HOME.lat) * NM_PER_DEG_LAT;
  const up = warpAltitudeFraction(altFt / CURVE_CEILING_FT, altitudeCurve) * CEILING_UP;
  // three.js: x = east, y = up, z = -north (right-handed, looking south = +z)
  return out.set(east, up, -north);
}

/** Distance from home in NM (great-circle approximated as flat for small angles). */
export function distanceFromHomeNm(lat: number, lon: number): number {
  const east = (lon - HOME.lon) * NM_PER_DEG_LAT * cosHomeLat;
  const north = (lat - HOME.lat) * NM_PER_DEG_LAT;
  return Math.sqrt(east * east + north * north);
}
