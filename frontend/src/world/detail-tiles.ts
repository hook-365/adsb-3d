import type { Group } from 'three';
import { subscribeHome } from '../core/config';
import { enuToLatLon } from '../core/coords';
import { getSettings, subscribeSettings } from '../core/settings';
import { effectiveBasemap } from '../core/basemaps';
import { createTileLayer, currentTileZoom, disposeTileLayer, providerMaxZoom } from './tiles';

// Detail patch: sharper ground under the camera.
//
// The basemap is one zoom level for the whole 500 NM scope, which is right
// from far away and a blur from a few miles up, where the close-up camera,
// the runways and the airspace shelves now live. When the camera is near
// the ground this lays a few tiles three zoom levels finer over the basemap
// around the point it is looking at, and moves them as the view moves.
//
// The patch is small on purpose: about fifty tiles, through the same nginx
// tile proxy and cache as the basemap. It is not built in a headset, where
// the scope is a model on a desk and nobody is a few miles up.

/** Zoom levels finer than the basemap. */
const EXTRA_ZOOM = 3;
/** The patch is built when the camera is this close to what it looks at, NM. */
const SHOW_WITHIN_NM = 45;
/** Tiles the patch spans from its centre to its edge, before the builder's own padding. */
const HALF_TILES = 2;
const CHECK_MS = 400;

export interface DetailFocus {
  /** Scene position the camera is looking at. */
  x: number;
  z: number;
  /** Camera distance from it, scene units (NM). */
  distance: number;
}

/** Longitude span of one tile at a zoom, in NM at a latitude. */
export function tileSpanNm(zoom: number, lat: number): number {
  return (360 / Math.pow(2, zoom)) * 60 * Math.cos((lat * Math.PI) / 180);
}

/**
 * Pure: should the patch be rebuilt for a new focus? Yes when there is
 * none, or the focus has moved more than a tile and a half from where the
 * patch was centred.
 */
export function patchStale(
  centre: { lat: number; lon: number } | null,
  focus: { lat: number; lon: number },
  tileNm: number,
): boolean {
  if (!centre) return true;
  const north = (focus.lat - centre.lat) * 60;
  const east = (focus.lon - centre.lon) * 60 * Math.cos((centre.lat * Math.PI) / 180);
  return Math.hypot(north, east) > tileNm * 1.5;
}

export interface DetailTiles {
  /** Call every frame; it looks at the camera a few times a second. */
  update(now: number, focus: DetailFocus | null): void;
}

export function mountDetailTiles(parent: Group): DetailTiles {
  let layer: Group | null = null;
  let centre: { lat: number; lon: number } | null = null;
  let builtFor = '';
  let lastCheck = 0;

  const drop = (): void => {
    if (!layer) return;
    parent.remove(layer);
    disposeTileLayer(layer);
    layer = null;
    centre = null;
    builtFor = '';
  };

  const update = (now: number, focus: DetailFocus | null): void => {
    if (now - lastCheck < CHECK_MS) return;
    lastCheck = now;
    const s = getSettings();
    if (!s.detailTiles || !focus || focus.distance > SHOW_WITHIN_NM) {
      drop();
      return;
    }
    const provider = effectiveBasemap(s.basemap);
    const zoom = Math.min(currentTileZoom() + EXTRA_ZOOM, providerMaxZoom(provider));
    // A provider with nothing finer to give: the basemap is as good as it gets.
    if (zoom <= currentTileZoom()) {
      drop();
      return;
    }
    const at = enuToLatLon(focus.x, -focus.z);
    const tileNm = tileSpanNm(zoom, at.lat);
    const key = `${provider}|${zoom}|${s.terrain3d}`;
    if (layer && key === builtFor && !patchStale(centre, at, tileNm)) return;
    drop();
    layer = createTileLayer({ provider, zoom, center: at, rangeNm: tileNm * HALF_TILES });
    layer.name = 'detail-tiles';
    parent.add(layer);
    centre = at;
    builtFor = key;
  };

  subscribeHome(drop);
  subscribeSettings(() => {
    if (!getSettings().detailTiles) drop();
  });
  return { update };
}
