import {
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { toScene } from '../core/coords';
import { getSettings } from '../core/settings';
import { getTheme, subscribeTheme } from '../core/theme';
import { elevationFtAt } from './elevation';
import { DIORAMA_PLANES } from './diorama-clip';
import { subscribeAcarsPositions, type AcarsPositionPing } from '../aircraft/acars-store';

// Transient ground pings at the coordinates carried by ACARS messages.
//
// The per-aircraft ACARS ring (aircraft/reconciler.ts) flags a message for a
// plane that's on scope. This layer is complementary and independent: it
// plots the *geographic* position a position-report message reports, whether
// or not that aircraft is being tracked on ADS-B — so datalink activity
// lights up across the whole map, well beyond receiver range. Each ping is an
// expanding, fading ring recycled from a small pool.

const POOL_SIZE = 32;
const DURATION_MS = 4200;
const R_START = 0.6; // NM
const R_END = 7.0; // NM
const OPACITY_START = 0.85;

// Shared unit ring in the horizontal plane (like the selection/emergency
// rings); per-slot scale animates the radius.
const RING = new RingGeometry(1.0, 1.16, 48);
RING.rotateX(-Math.PI / 2);

// Scratch vector; toScene writes into it.
const TMP = new Vector3();

interface Slot {
  mesh: Mesh;
  material: MeshBasicMaterial;
  startMs: number; // -1 = free
}

export interface AcarsPingsHandle {
  /** Advance the animation. Call once per frame with the frame timestamp. */
  update(nowMs: number): void;
  dispose(): void;
}

export function mountAcarsPings(root: Object3D): AcarsPingsHandle {
  const group = new Group();
  group.name = 'acars-position-pings';
  group.renderOrder = 6;
  root.add(group);

  const slots: Slot[] = [];
  const color = new Color(getTheme().tokens.three.acarsPing);
  for (let i = 0; i < POOL_SIZE; i++) {
    const material = new MeshBasicMaterial({
      color: color.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
      clippingPlanes: DIORAMA_PLANES,
    });
    const mesh = new Mesh(RING, material);
    mesh.visible = false;
    mesh.renderOrder = 6;
    group.add(mesh);
    slots.push({ mesh, material, startMs: -1 });
  }

  let active = 0;
  let cursor = 0;

  const unsubTheme = subscribeTheme((tokens) => {
    color.set(tokens.three.acarsPing);
    for (const s of slots) s.material.color.copy(color);
  });

  function spawn(p: AcarsPositionPing): void {
    if (!getSettings().acarsMessages || !getSettings().acarsPings) return;
    // Claim a free slot, else steal the oldest (round-robin cursor is a good
    // proxy — slots are claimed in order and expire in roughly that order).
    let slot = slots.find((s) => s.startMs < 0);
    if (!slot) {
      slot = slots[cursor % POOL_SIZE]!;
      cursor++;
    } else {
      active++;
    }
    // Ground-anchor the ring on the terrain surface (0 everywhere when 3D
    // terrain is off), ignoring the message's own altitude so the ring reads
    // as a spot on the map rather than floating at flight level.
    const ground = elevationFtAt(p.lat, p.lon);
    toScene(p.lat, p.lon, ground, TMP);
    slot.mesh.position.set(TMP.x, TMP.y + 0.15, TMP.z);
    slot.startMs = performance.now();
    slot.mesh.visible = true;
    slot.material.opacity = OPACITY_START;
    slot.mesh.scale.setScalar(R_START);
  }

  const unsubPos = subscribeAcarsPositions(spawn);

  function update(nowMs: number): void {
    if (active === 0) return;
    for (const s of slots) {
      if (s.startMs < 0) continue;
      const t = (nowMs - s.startMs) / DURATION_MS;
      if (t >= 1) {
        s.startMs = -1;
        s.mesh.visible = false;
        s.material.opacity = 0;
        active--;
        continue;
      }
      const r = R_START + (R_END - R_START) * t;
      s.mesh.scale.setScalar(r);
      s.material.opacity = OPACITY_START * (1 - t);
    }
  }

  function dispose(): void {
    unsubTheme();
    unsubPos();
    for (const s of slots) s.material.dispose();
    root.remove(group);
  }

  return { update, dispose };
}
