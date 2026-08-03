import { Vector3 } from 'three';
import { ALT_EXAGGERATION, HOME, TERRAIN_ENABLED, subscribeHome } from './config';
import { getSettings, subscribeSettings } from './settings';
import { CURVE_CEILING_FT, biasToExponent, warpAltitudeFraction } from './altitude-curve';

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

// Altitude → scene-height mapping. The curve exponent is read once at boot;
// changing the setting reloads the page (mirrors the language setting)
// because trail and heatmap geometry bake the mapping in and would
// otherwise go stale.
const curveExponent = biasToExponent(getSettings().altitudeCurveBias);
// Scene height of CURVE_CEILING_FT — identical for every bias, so the
// slider redistributes space below the ceiling without rescaling the scene.
const CEILING_UP = (CURVE_CEILING_FT / FT_PER_NM) * ALT_EXAGGERATION;

// Flat-mode ground reference: without 3D terrain the basemap plane stands
// for the ground at the home field, not sea level — a jet rolling out at
// KSLC (4,227 ft MSL) should sit on the map, not float 4,200 ft above it.
// Altitudes render relative to HOME.altFt (feet MSL), clamped at the
// plane, since a flat map cannot depict ground lower than the home field
// anyway. With terrain on, geometry stays true MSL (the terrain toggle
// reloads the page, so a boot-time constant is safe). HOME mutates on
// feed switch, hence the subscription.
const terrainOn = TERRAIN_ENABLED && getSettings().terrain3d;
let flatGroundRefFt = terrainOn ? 0 : HOME.altFt;
subscribeHome(() => {
  flatGroundRefFt = terrainOn ? 0 : HOME.altFt;
});

// The settings slider fires on every input tick of a drag; reload once the
// value has settled rather than per tick.
let lastBias = getSettings().altitudeCurveBias;
let curveReloadTimer: ReturnType<typeof setTimeout> | undefined;
subscribeSettings((s) => {
  if (s.altitudeCurveBias !== lastBias) {
    lastBias = s.altitudeCurveBias;
    if (typeof location === 'undefined') return;
    clearTimeout(curveReloadTimer);
    curveReloadTimer = setTimeout(() => location.reload(), 700);
  }
});

/** Returns scene-units position for (lat, lon, altFt). 1 unit = 1 NM east/north. */
export function toScene(lat: number, lon: number, altFt: number, out: Vector3): Vector3 {
  const east = (lon - HOME.lon) * NM_PER_DEG_LAT * cosHomeLat;
  const north = (lat - HOME.lat) * NM_PER_DEG_LAT;
  const relAltFt = terrainOn ? altFt : Math.max(altFt - flatGroundRefFt, 0);
  const up = warpAltitudeFraction(relAltFt / CURVE_CEILING_FT, curveExponent) * CEILING_UP;
  // three.js: x = east, y = up, z = -north (right-handed, looking south = +z)
  return out.set(east, up, -north);
}

/** Inverse of toScene's horizontal projection: ENU offsets in NM → lat/lon. */
export function enuToLatLon(eastNm: number, northNm: number): { lat: number; lon: number } {
  return {
    lat: HOME.lat + northNm / NM_PER_DEG_LAT,
    lon: HOME.lon + eastNm / (NM_PER_DEG_LAT * cosHomeLat),
  };
}

/** Distance from home in NM (great-circle approximated as flat for small angles). */
export function distanceFromHomeNm(lat: number, lon: number): number {
  const east = (lon - HOME.lon) * NM_PER_DEG_LAT * cosHomeLat;
  const north = (lat - HOME.lat) * NM_PER_DEG_LAT;
  return Math.sqrt(east * east + north * north);
}
