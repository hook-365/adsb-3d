import {
  CanvasTexture,
  LinearFilter,
  Object3D,
  Sprite,
  SpriteMaterial,
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

// Phase 2 world-space replacement for the DOM detail panel — a Sprite
// with a canvas-backed texture that hovers above the currently selected
// aircraft while the user is in VR. The reconciler's selection ring
// still highlights the cone; this just gives readable text without
// needing the page DOM to composite over the XR canvas.
//
// Lives inside xrRoot so the billboard scales with the airspace (at the
// Phase 2 tabletop default scale of 0.01, a 6×3 NM sprite renders as
// roughly 6×3 cm in front of the user — comfortable reading size).
//
// Text is redrawn whenever the underlying Aircraft fields change.
// Position is updated each frame from main.ts (where the reconciler
// already calls positionOf).

// Sprite size in NM units (xrRoot scales these). 6 NM wide × 3 NM tall
// works out to roughly the size of a credit card at the tabletop scale.
const BILLBOARD_W_NM = 6;
const BILLBOARD_H_NM = 3;
// Float the billboard this far above the aircraft cone (NM). At
// tabletop scale = ~2.5 cm clearance — visually distinct from the cone.
const BILLBOARD_HEIGHT_OFFSET_NM = 2.5;

// Canvas resolution. Bigger = sharper text in VR; cheap because we
// only redraw on data change, not per frame.
const CANVAS_W = 512;
const CANVAS_H = 256;

// Readability floor (issue #6, AR#3): the sprite may never render
// narrower than this fraction of its distance to the headset —
// 0.3 m per metre of distance ≈ 17° of visual field. Far or
// small-scaled billboards grow to stay legible; near ones keep their
// airspace-tied size.
const MIN_WIDTH_PER_METER = 0.3;

// Photo box (issue #6 round 4 — tyzbit: "Maybe more info on the label,
// like the aircraft picture"): top-right corner, clear of the headline
// (max 8 monospace chars ends ≈ x339) and the telemetry row (y144+).
// 3:2 landscape, matching the planespotters thumbnail shape closely
// enough that cover-cropping loses only slivers.
const PHOTO_X = 344;
const PHOTO_Y = 24;
const PHOTO_W = 152;
const PHOTO_H = 102;

const tmpWorldPos = new Vector3();
const tmpEyePos = new Vector3();
const tmpParentScale = new Vector3();

export class XrBillboard {
  private readonly sprite: Sprite;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly material: SpriteMaterial;
  private readonly unsubscribeTheme: () => void;
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
    // Sprite textures benefit from linear minification in VR; default
    // mipmap filter is fine but the sprite is also small in screen
    // space so a slightly cheaper LinearFilter keeps text crisp.
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;

    this.material = new SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.sprite = new Sprite(this.material);
    this.sprite.scale.set(BILLBOARD_W_NM, BILLBOARD_H_NM, 1);
    this.sprite.renderOrder = 7; // above selection / emergency rings
    this.sprite.visible = false;
    this.sprite.name = 'xr-billboard';
    parent.add(this.sprite);

    this.unsubscribeTheme = subscribeTheme((tokens) => {
      if (this.current) this.draw(this.current, tokens);
    });
  }

  /**
   * Refresh the billboard for the given aircraft. Pass null to hide it
   * (e.g. on deselect or session end). Position is the aircraft's scene
   * position from reconciler.positionOf(); the billboard sits above it.
   */
  update(aircraft: Aircraft | null, scenePos: Vector3 | null): void {
    if (!aircraft || !scenePos) {
      this.sprite.visible = false;
      this.current = null;
      return;
    }
    // Only repaint the canvas when the user-visible fields actually
    // change (avoids a per-frame allocation churn while the aircraft is
    // just moving across the sky).
    const needsRedraw =
      !this.current ||
      this.current.hex !== aircraft.hex ||
      this.current.callsign !== aircraft.callsign ||
      this.current.altFt !== aircraft.altFt ||
      this.current.groundSpeedKt !== aircraft.groundSpeedKt ||
      this.current.trackDeg !== aircraft.trackDeg;
    this.photo.track(aircraft.hex, aircraft.registration);
    if (needsRedraw) {
      this.draw(aircraft, getTheme().tokens);
      this.current = aircraft;
    }

    this.sprite.position.copy(scenePos);
    this.sprite.position.y += BILLBOARD_HEIGHT_OFFSET_NM;
    this.sprite.visible = true;
  }

  /**
   * Enforce the minimum angular size against the current headset pose
   * (pass renderer.xr.getCamera()). Called per frame after update();
   * cheap — two vector ops, no canvas work.
   */
  keepReadable(xrCamera: Object3D): void {
    if (!this.sprite.visible || !this.sprite.parent) return;
    this.sprite.getWorldPosition(tmpWorldPos);
    tmpEyePos.setFromMatrixPosition(xrCamera.matrixWorld);
    const distM = tmpWorldPos.distanceTo(tmpEyePos);
    const parentScale = this.sprite.parent.getWorldScale(tmpParentScale).x || 1;
    const minLocalW = (MIN_WIDTH_PER_METER * distM) / parentScale;
    const w = Math.max(BILLBOARD_W_NM, minLocalW);
    this.sprite.scale.set(w, w * (BILLBOARD_H_NM / BILLBOARD_W_NM), 1);
  }

  /** Hide the billboard without changing the cached aircraft. */
  hide(): void {
    this.sprite.visible = false;
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
    this.sprite.parent?.remove(this.sprite);
    this.material.dispose();
    this.texture.dispose();
  }
}

// ── small drawing helpers ──────────────────────────────────────────────



// Re-exported here so main.ts can compute the billboard's sceneRoot
// position from the aircraft store without importing coords directly
// (one less import line at the call site).
export { toScene };
