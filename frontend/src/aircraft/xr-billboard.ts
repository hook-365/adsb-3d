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

/** Convert a hex color (#rrggbb) to rgba(..., alpha). Tolerates any
 *  prefix on the input — used because theme tokens are already a mix of
 *  hex and rgba strings and we just need a translucent backdrop. */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // rgba(...) / rgb(...) already — drop into a fresh rgba() with the
  // requested alpha. Cheap parse: just numbers.
  const nums = color.match(/[\d.]+/g);
  if (nums && nums.length >= 3) {
    return `rgba(${nums[0]}, ${nums[1]}, ${nums[2]}, ${alpha})`;
  }
  return color;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Re-exported here so main.ts can compute the billboard's sceneRoot
// position from the aircraft store without importing coords directly
// (one less import line at the call site).
export { toScene };
