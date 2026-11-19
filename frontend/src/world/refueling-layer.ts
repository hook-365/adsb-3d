import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Vector3 } from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RANGE_NM, subscribeHome } from '../core/config';
import { distanceFromHomeNm } from '../core/coords';
import { t } from '../core/i18n';
import { getSettings, subscribeSettings } from '../core/settings';
import { DIORAMA_PLANES } from './diorama-clip';
import { subscribeElevation } from './elevation';
import { yieldToAircraft } from './label-yield';
import { getRefuelTracks, loadRefuelTracks, refuelDrawing, subscribeRefuelTracks } from './refueling';
import { terrainActive, terrainSurface } from './tiles';

// US air refueling tracks as a map layer (`refuelTracks`): the published
// centrelines, drawn on the ground and named where they come near the
// middle of the scope. On the ground because the data carries no heights,
// and a line at a guessed flight level would claim one.
//
// Cost while on: one draw call (every track in range is one merged
// LineSegments), a capped handful of labels, and nothing per frame. While
// off: nothing is fetched, built or attached.

const COLOR = 0x8fa3ff;
/** Short enough to follow terrain; only legs inside the scope are cut up. */
const MAX_PIECE_NM = 6;
const LABEL_NM = 160;
const MAX_LABELS = 24;
/** Elevation tiles stream in after boot and after a feed switch: rebuild once they settle. */
const ELEVATION_SETTLE_MS = 1500;

export function mountRefuelTracks(parent: Group): void {
  const group = new Group();
  group.name = 'refuel-tracks';
  const labelGroup = new Group();
  group.add(labelGroup);
  yieldToAircraft(labelGroup);
  const material = new LineBasicMaterial({
    color: COLOR,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    clippingPlanes: DIORAMA_PLANES,
  });
  let lines: LineSegments | null = null;
  let attached = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const tmp = new Vector3();

  const dispose = (): void => {
    if (lines) {
      lines.removeFromParent();
      lines.geometry.dispose();
      lines = null;
    }
    for (const child of Array.from(labelGroup.children)) {
      labelGroup.remove(child);
      if (child instanceof CSS2DObject) child.element.remove();
    }
  };

  const rebuild = (): void => {
    clearTimeout(settleTimer);
    dispose();
    const tracks = getRefuelTracks();
    if (!attached || !tracks) return;
    const { pieces, labels } = refuelDrawing(tracks, distanceFromHomeNm, RANGE_NM * 1.05, MAX_PIECE_NM, LABEL_NM, MAX_LABELS);
    if (pieces.length === 0) return;
    const positions = new Float32Array((pieces.length / 2) * 3);
    for (let i = 0, o = 0; i < pieces.length; i += 2, o += 3) {
      terrainSurface(pieces[i]!, pieces[i + 1]!, tmp);
      positions[o] = tmp.x;
      positions[o + 1] = tmp.y + 0.05;
      positions[o + 2] = tmp.z;
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    lines = new LineSegments(geom, material);
    lines.frustumCulled = false;
    lines.renderOrder = 5;
    lines.raycast = () => {};
    lines.userData = { kind: 'refuel' };
    group.add(lines);
    for (const l of labels) {
      const el = document.createElement('div');
      el.className = 'aircraft-label refuel-label';
      el.textContent = l.id;
      const label = new CSS2DObject(el);
      terrainSurface(l.lat, l.lon, tmp);
      label.position.set(tmp.x, tmp.y + 0.3, tmp.z);
      labelGroup.add(label);
    }
  };

  const sync = (): void => {
    const on = getSettings().refuelTracks;
    if (on) loadRefuelTracks(t('settings.refuel_tracks'));
    if (on === attached) return;
    attached = on;
    if (on) parent.add(group);
    else group.removeFromParent();
    rebuild();
  };

  subscribeRefuelTracks(rebuild);
  subscribeHome(rebuild);
  subscribeSettings(sync);
  subscribeElevation(() => {
    if (!attached || !terrainActive()) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(rebuild, ELEVATION_SETTLE_MS);
  });
  sync();
}
