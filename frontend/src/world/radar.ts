import type { Group } from 'three';
import { getSettings, subscribeSettings } from '../core/settings';
import { subscribeHome } from '../core/config';
import { createTileLayer, currentTileZoom, disposeTileLayer } from './tiles';
import { stormsActive } from './storms';
import { precipLayerActive, subscribePrecipLayer } from './precip-layer';

// Weather radar overlay (RainViewer). A second, translucent tile layer a
// hair above the basemap, rebuilt whenever RainViewer publishes a newer
// frame (every ~10 min), the home moves (feed switch), the tile zoom
// changes, or the setting flips. Frames and tiles both go through nginx
// (/weather/radar-frames, /tiles/radar/<frame>/…) so browsers never talk
// to RainViewer and the tile cache absorbs repeat viewers.

const FRAMES_URL = '/weather/radar-frames';
const POLL_MS = 5 * 60 * 1000;
/** RainViewer serves real radar tiles up to z7; deeper zooms return a placeholder. */
export const RADAR_MAX_ZOOM = 7;

interface RainViewerFrames {
  radar?: { past?: { time?: unknown; path?: unknown }[] };
}

export interface RadarFrame {
  /** Unix seconds the frame was observed. */
  time: number;
  /** Opaque id, the last segment of RainViewer's `path` (`/v2/radar/<id>`). */
  id: string;
}

/** Pure: newest past frame from RainViewer's weather-maps JSON, or null. */
export function latestRadarFrame(json: unknown): RadarFrame | null {
  const past = (json as RainViewerFrames | null)?.radar?.past;
  if (!Array.isArray(past) || past.length === 0) return null;
  let best: RadarFrame | null = null;
  for (const f of past) {
    if (typeof f.time !== 'number' || typeof f.path !== 'string') continue;
    const id = /\/([A-Za-z0-9]+)\/?$/.exec(f.path)?.[1];
    if (!id) continue;
    if (best === null || f.time > best.time) best = { time: f.time, id };
  }
  return best;
}

/** The flat overlay yields to the 3D storm volume while that is drawing. */
function flatRadarOn(): boolean {
  // RainViewer is the fallback: the 3D volume or the MRMS surface layer
  // (precip-layer.ts, inside its coverage) each take over when they draw.
  return getSettings().weatherRadar && !stormsActive() && !precipLayerActive();
}

export function mountWeatherRadar(parent: Group): void {
  let layer: Group | null = null;
  let frame: RadarFrame | null = null;
  let zoom = Math.min(currentTileZoom(), RADAR_MAX_ZOOM);
  let timer: number | null = null;

  const rebuild = (): void => {
    if (layer) {
      parent.remove(layer);
      disposeTileLayer(layer);
      layer = null;
    }
    if (!flatRadarOn() || frame === null) return;
    layer = createTileLayer({ provider: 'radar', zoom, frame: frame.id, overlay: true, dropY: -0.3 });
    parent.add(layer);
  };

  const poll = async (): Promise<void> => {
    if (!flatRadarOn()) return;
    try {
      const res = await fetch(FRAMES_URL, { cache: 'no-store' });
      if (!res.ok) return;
      const next = latestRadarFrame(await res.json());
      if (next !== null && next.id !== frame?.id) {
        frame = next;
        rebuild();
      }
    } catch {
      // Offline or upstream down: keep the last frame we drew.
    }
  };

  const sync = (): void => {
    const on = flatRadarOn();
    const z = Math.min(currentTileZoom(), RADAR_MAX_ZOOM);
    if (on && timer === null) {
      timer = window.setInterval(() => void poll(), POLL_MS);
      void poll();
    } else if (!on && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    if (z !== zoom) {
      zoom = z;
      rebuild();
    } else if (on !== (layer !== null)) {
      rebuild();
    }
  };

  subscribeSettings(sync);
  subscribePrecipLayer(sync);
  // A feed switch moves HOME and can hand the view to or from the 3D
  // storms (local feed only), so re-evaluate rather than just redraw.
  subscribeHome(() => {
    sync();
    if (layer) rebuild();
  });
  sync();
}
