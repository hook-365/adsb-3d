import { Vector3 } from 'three';
import { ALT_EXAGGERATION, HOME, subscribeHome } from './config';

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

/** Returns scene-units position for (lat, lon, altFt). 1 unit = 1 NM east/north. */
export function toScene(lat: number, lon: number, altFt: number, out: Vector3): Vector3 {
  const east = (lon - HOME.lon) * NM_PER_DEG_LAT * cosHomeLat;
  const north = (lat - HOME.lat) * NM_PER_DEG_LAT;
  const up = (altFt / FT_PER_NM) * ALT_EXAGGERATION;
  // three.js: x = east, y = up, z = -north (right-handed, looking south = +z)
  return out.set(east, up, -north);
}

/** Distance from home in NM (great-circle approximated as flat for small angles). */
export function distanceFromHomeNm(lat: number, lon: number): number {
  const east = (lon - HOME.lon) * NM_PER_DEG_LAT * cosHomeLat;
  const north = (lat - HOME.lat) * NM_PER_DEG_LAT;
  return Math.sqrt(east * east + north * north);
}
