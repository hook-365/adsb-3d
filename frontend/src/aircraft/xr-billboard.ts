import {
  CanvasTexture,
  DoubleSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three';
import type { Aircraft } from '../core/types';
import { toScene } from '../core/coords';
import { getTheme, subscribeTheme, type ThemeTokens } from '../core/theme';
import { drawCoverPhoto, roundRect, withAlpha } from '../world/canvas-ui';
// ui/ import from aircraft/ is unusual but deliberate: the photo cache +
// same-origin proxy rewrite live with the DOM detail panel that grew
// them, and the billboard is presentation code either way.
import { CanvasPhoto } from '../ui/aircraft-photo';
import { acarsSummary } from '../ui/stereo-panel';
import { getAcarsMessages } from './acars-store';
import { getSettings } from '../core/settings';
import {
  BILLBOARD_H_NM,
  BILLBOARD_W_NM,
  billboardYaw,
  clearanceFor,
  readableWidth,
} from './xr-billboard-math';

// Phase 2 world-space replacement for the DOM detail panel — a canvas-
// textured card that hovers above the currently selected aircraft while
// the user is in VR. The reconciler's selection ring still highlights
// the cone; this just gives readable text without needing the page DOM
// to composite over the XR canvas.
//
// Lives inside xrRoot so the card scales with the airspace (at the
// Phase 2 tabletop default scale of 0.01, a 6×3 NM card renders as
// roughly 6×3 cm in front of the user — comfortable reading size).
//
// Geometry (issue #6 round 5): the card is an upright plane, not a
// Sprite. A Sprite is view-plane aligned, so it rolled and pitched with
// the headset; tyzbit asked for labels that don't rotate with the head.
// The plane is yawed toward the eye each frame and otherwise stays
// perpendicular to the ground. Its geometry is anchored at the bottom
// edge, so the readability floor grows it upward only, and it sits a
// clearance above the aircraft that scales with that growth — the
// earlier centre-anchored sprite with a fixed offset ended up parked on
// top of the silhouette (his video). Sizes and the yaw/clearance math
// live in xr-billboard-math.ts so they can be unit-tested.
//
// Text is redrawn whenever the underlying Aircraft fields change.
// Position is updated each frame from main.ts (where the reconciler
// already calls positionOf).

// Canvas resolution. Bigger = sharper text in VR; cheap because we
// only redraw on data change, not per frame.
const CANVAS_W = 512;
const CANVAS_H = 256;

// Photo box (issue #6 round 4 — tyzbit: "Maybe more info on the label,
// like the aircraft picture"): top-right corner, clear of the headline
// (max 8 monospace chars ends ≈ x339) and the telemetry row (y144+).
// 3:2 landscape, matching the planespotters thumbnail shape closely
// enough that cover-cropping loses only slivers.
const PHOTO_X = 344;
const PHOTO_Y = 24;
const PHOTO_W = 152;
const PHOTO_H = 102;

const tmpEyeLocal = new Vector3();
const tmpEyeWorld = new Vector3();

export class XrBillboard {
  private readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly unsubscribeTheme: () => void;
  private lastAcarsKey = '';
  private current: Aircraft | null = null;
  // Photo for the current hex, loaded async through the same-origin
  // /photos/ proxy (a cross-origin image would taint the canvas and the
  // WebGL texture upload would throw). Loader shared with the desktop
  // HUD card — ui/aircraft-photo.ts CanvasPhoto.
  private readonly photo = new CanvasPhoto(() => {
    if (this.current) this.draw(this.current, getTheme().tokens);
  });

  constructor(parent: Object3D) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('XrBillboard: 2d context unavailable');
    this.ctx = ctx;

    this.texture = new CanvasTexture(this.canvas);
    // Canvas text benefits from linear minification in VR; default
    // mipmap filter is fine but the card is also small in screen
    // space so a slightly cheaper LinearFilter keeps text crisp.
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;

    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // Yaw-only facing means a user walking around the diorama can end
      // up behind the card for a frame or two; render the back rather
      // than blink it out.
      side: DoubleSide,
    });
    // Unit plane shifted so the mesh origin is the bottom-centre of the
    // card: scale grows it upward, away from the aircraft underneath.
    const geometry = new PlaneGeometry(1, 1);
    geometry.translate(0, 0.5, 0);
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.scale.set(BILLBOARD_W_NM, BILLBOARD_H_NM, 1);
    this.mesh.renderOrder = 7; // above selection / emergency rings
    this.mesh.visible = false;
    this.mesh.name = 'xr-billboard';
    parent.add(this.mesh);

    this.unsubscribeTheme = subscribeTheme((tokens) => {
      if (this.current) this.draw(this.current, tokens);
    });
  }

  /**
   * Refresh the billboard for the given aircraft. Pass null to hide it
   * (e.g. on deselect or session end). Position is the aircraft's scene
   * position from reconciler.positionOf(); the card sits above it, sized
   * against and turned toward `eye` (renderer.xr.getCamera() in a
   * session, the desktop camera in side-by-side stereo). `upright` keeps
   * the card perpendicular to the ground (yaw only) — right for a headset
   * looking across a diorama, wrong for the desktop stereo camera, which
   * can pitch nearly top-down and would see the card edge-on; that path
   * lets the card pitch toward the eye too (still no roll). Per frame,
   * but cheap — a handful of vector ops, no canvas work unless data changed.
   */
  update(
    aircraft: Aircraft | null,
    scenePos: Vector3 | null,
    eye: Object3D,
    upright: boolean,
  ): void {
    if (!aircraft || !scenePos || !this.mesh.parent) {
      this.mesh.visible = false;
      this.current = null;
      return;
    }
    // Only repaint the canvas when the user-visible fields actually
    // change (avoids a per-frame allocation churn while the aircraft is
    // just moving across the sky).
    const acars = getSettings().acarsMessages ? getAcarsMessages(aircraft.hex) : [];
    const acarsKey = acars.length ? `${acars.length}@${acars[0]!.time}` : '';
    const needsRedraw =
      !this.current ||
      this.current.hex !== aircraft.hex ||
      this.current.callsign !== aircraft.callsign ||
      this.current.altFt !== aircraft.altFt ||
      this.current.groundSpeedKt !== aircraft.groundSpeedKt ||
      this.current.trackDeg !== aircraft.trackDeg ||
      this.lastAcarsKey !== acarsKey;
    this.photo.track(aircraft.hex, aircraft.registration);
    if (needsRedraw) {
      this.lastAcarsKey = acarsKey;
      this.draw(aircraft, getTheme().tokens);
      this.current = aircraft;
    }

    // Everything below is in xrRoot-local units: bring the eye into that
    // frame once (the root may be scaled, yawed by scope placement or
    // auto-orbit, and translated by locomotion — a world-axis yaw would
    // be wrong whenever the root is turned).
    const parent = this.mesh.parent;
    parent.updateWorldMatrix(true, false);
    tmpEyeLocal.setFromMatrixPosition(eye.matrixWorld);
    parent.worldToLocal(tmpEyeLocal);

    const w = readableWidth(tmpEyeLocal.distanceTo(scenePos));
    this.mesh.scale.set(w, w * (BILLBOARD_H_NM / BILLBOARD_W_NM), 1);
    this.mesh.position.copy(scenePos);
    this.mesh.position.y += clearanceFor(w);
    if (upright) {
      this.mesh.rotation.set(0, billboardYaw(tmpEyeLocal, this.mesh.position), 0);
    } else {
      // Object3D.lookAt points +Z at the target with world-up as up, so
      // the card pitches toward the camera without rolling.
      this.mesh.lookAt(tmpEyeWorld.setFromMatrixPosition(eye.matrixWorld));
    }
    this.mesh.visible = true;
  }

  /** Hide the billboard without changing the cached aircraft. */
  hide(): void {
    this.mesh.visible = false;
  }

  private draw(a: Aircraft, theme: ThemeTokens): void {
    const ctx = this.ctx;
    const t = theme;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Background — themed panel with a thin accent border.
    ctx.fillStyle = withAlpha(t.panelBase, 0.92);
    roundRect(ctx, 8, 8, CANVAS_W - 16, CANVAS_H - 16, 16);
    ctx.fill();
    ctx.strokeStyle = withAlpha(t.accent, 0.6);
    ctx.lineWidth = 3;
    roundRect(ctx, 8, 8, CANVAS_W - 16, CANVAS_H - 16, 16);
    ctx.stroke();

    // Callsign (or hex fallback) — large.
    ctx.fillStyle = t.accent;
    ctx.font = 'bold 64px ui-monospace, "JetBrains Mono", Menlo, monospace';
    ctx.textBaseline = 'top';
    const headline = a.callsign?.trim() || a.registration || a.hex.toUpperCase();
    ctx.fillText(headline, 32, 24);

    // Sub-line under headline: type code / registration / military badge.
    const subParts: string[] = [];
    if (a.callsign && a.registration) subParts.push(a.registration);
    if (a.typeCode) subParts.push(a.typeCode);
    if (a.military) subParts.push('MIL');
    if (subParts.length) {
      ctx.fillStyle = t.fgSoft;
      ctx.font = '24px ui-monospace, "JetBrains Mono", Menlo, monospace';
      ctx.fillText(subParts.join(' · '), 32, 96);
    }

    // Telemetry row — altitude, speed, heading.
    ctx.font = '32px ui-monospace, "JetBrains Mono", Menlo, monospace';
    ctx.fillStyle = t.fg;
    const altStr = a.onGround ? 'GND' : `${a.altFt.toLocaleString()} ft`;
    const spdStr = a.groundSpeedKt !== null ? `${Math.round(a.groundSpeedKt)} kt` : '—';
    const hdgStr = a.trackDeg !== null ? `${Math.round(a.trackDeg)}°` : '—';
    ctx.fillText(`${altStr}   ${spdStr}   ${hdgStr}`, 32, 144);

    // Emergency badge — visually distinct.
    if (a.emergency) {
      ctx.fillStyle = t.emergency;
      ctx.font = 'bold 24px ui-monospace, monospace';
      ctx.fillText(`! ${a.emergency.toUpperCase()}`, 32, 200);
    }

    // ACARS summary — shares the badge row, right of the emergency slot.
    if (getSettings().acarsMessages) {
      const acars = getAcarsMessages(a.hex);
      if (acars.length) {
        ctx.fillStyle = t.three.acarsPing;
        ctx.font = 'bold 22px ui-monospace, "JetBrains Mono", Menlo, monospace';
        ctx.fillText(acarsSummary(acars), a.emergency ? 360 : 32, 200);
      }
    }

    // Photo box, top-right (issue #6 round 4). The credit rides a shaded
    // strip inside the photo so it never collides with the telemetry row
    // below the box.
    if (this.photo.image) {
      drawCoverPhoto(
        ctx, this.photo.image,
        PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, 10,
        this.photo.credit, t.accent,
      );
    }

    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.unsubscribeTheme();
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

// ── small drawing helpers ──────────────────────────────────────────────



// Re-exported here so main.ts can compute the billboard's sceneRoot
// position from the aircraft store without importing coords directly
// (one less import line at the call site).
export { toScene };
