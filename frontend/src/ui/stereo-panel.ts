import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Camera,
} from 'three';
import type { Aircraft } from '../core/types';
import { distanceFromHomeNm } from '../core/coords';
import { fmtAltitude, fmtDistanceCompact, fmtSpeedCompact, fmtVerticalRate } from '../core/units';
import { getTheme, subscribeTheme } from '../core/theme';
import { getRoute } from '../feed/routes';
import { drawCoverPhoto, roundRect, withAlpha } from '../world/canvas-ui';
import { CanvasPhoto } from './aircraft-photo';

// Selected-aircraft info panel for desktop side-by-side stereo (issue #6:
// "panels rendered in both eyes"). DOM panels overlay the whole window and
// straddle the two stereo halves; this is a canvas plane parented to the
// scene camera, so StereoEffect renders one correctly-placed copy per eye
// for free — the same trick the XR billboard uses, but screen-anchored and
// carrying the detail-card essentials (photo included, via the same-origin
// /photos/ proxy — a cross-origin image would taint the canvas).
//
// Stereo only, on purpose: a round-4 trial as a plain-desktop bottom card
// was retired — it duplicated the CSS2D label + detail panel, a camera
// plane sized for one eye-half renders huge across a full monitor, and
// DOM labels always paint on top of WebGL, so they sat on the card.
//
// Deliberately not interactive. The wrist menu + billboard continue to
// serve real headset sessions — this panel hides while presenting.

const CANVAS_W = 640;
const CANVAS_H = 300;
// Plane size in camera-local units at z = -2: chosen so the panel fills
// roughly the lower quarter of a 60° FOV without occluding the scope.
const PANEL_W = 1.15;
const PANEL_H = PANEL_W * (CANVAS_H / CANVAS_W);
const PANEL_Z = -2;
const PANEL_Y = -0.62;

// Photo box, top-right. 3:2 landscape — the planespotters thumbnail
// shape — so the cover-crop loses only slivers. Text rows that share its
// y-range (headline, identity) clamp their maxWidth against PHOTO_X.
const PHOTO_W = 160;
const PHOTO_H = 107;
const PHOTO_X = CANVAS_W - 28 - PHOTO_W;
const PHOTO_Y = 24;

export class StereoPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  readonly mesh: Mesh;
  private lastKey = '';
  // Clearing lastKey on photo arrival forces a repaint on the next
  // per-frame update() tick — cheaper than threading route state into a
  // direct draw call from the async callback.
  private readonly photo = new CanvasPhoto(() => {
    this.lastKey = '';
  });

  constructor(camera: Camera) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.anisotropy = 4;
    const material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(PANEL_W, PANEL_H), material);
    this.mesh.position.set(0, PANEL_Y, PANEL_Z);
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    this.mesh.userData = { kind: 'stereo-panel' };
    camera.add(this.mesh);
    subscribeTheme(() => {
      // Force repaint with the new palette on next update.
      this.lastKey = '';
    });
  }

  /** Show/refresh for an aircraft, or hide with null. Cheap to call per
   *  frame: repaints only when the visible fields change. */
  update(a: Aircraft | null): void {
    if (!a) {
      if (this.mesh.visible) this.mesh.visible = false;
      this.lastKey = '';
      return;
    }
    this.mesh.visible = true;
    this.photo.track(a.hex, a.registration);
    const route = a.callsign ? getRoute(a.callsign) : null;
    const key = [
      a.hex, a.callsign, a.altFt, a.groundSpeedKt, a.trackDeg, a.verticalRateFpm,
      a.squawk, a.emergency, route?.origin, route?.destination,
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.draw(a, route ?? null);
  }

  private draw(a: Aircraft, route: { origin?: string | null; destination?: string | null } | null): void {
    const t = getTheme().tokens;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = withAlpha(t.panelBase, 0.92);
    roundRect(ctx, 4, 4, CANVAS_W - 8, CANVAS_H - 8, 18);
    ctx.fill();
    ctx.strokeStyle = withAlpha(t.accent, 0.55);
    ctx.lineWidth = 3;
    roundRect(ctx, 4, 4, CANVAS_W - 8, CANVAS_H - 8, 18);
    ctx.stroke();

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    // Rows sharing the photo box's y-range stop short of it; without a
    // photo (still loading, none found) they get the full width back.
    // Ellipsis truncation, not fillText's maxWidth — maxWidth squishes
    // glyphs horizontally, which reads as broken on long operator names.
    const topRowMax = this.photo.image ? PHOTO_X - 40 : CANVAS_W - 56;

    // Headline: callsign / registration / hex.
    const headline = a.callsign || a.registration || a.hex.toUpperCase();
    ctx.fillStyle = t.fgBright;
    ctx.font = 'bold 52px ui-monospace, "JetBrains Mono", Menlo, monospace';
    ctx.fillText(truncateToWidth(ctx, headline, topRowMax), 28, 66);

    // Identity line: registration · type · operator (what fits).
    const identity = [
      a.registration && a.registration !== headline ? a.registration : null,
      a.typeCode,
      a.operator,
    ]
      .filter(Boolean)
      .join(' · ');
    ctx.fillStyle = t.fgSoft;
    ctx.font = '26px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(truncateToWidth(ctx, identity, topRowMax), 28, 104);

    // Route, when the cache has it.
    if (route?.origin || route?.destination) {
      ctx.fillStyle = t.fg;
      ctx.font = '30px ui-monospace, "JetBrains Mono", Menlo, monospace';
      ctx.fillText(`${route.origin ?? '????'} → ${route.destination ?? '????'}`, 28, 148);
    }

    // Telemetry row: alt (+VS), speed, heading, squawk, range from home.
    const vs = a.verticalRateFpm;
    const vsArrow = vs === null || Math.abs(vs) < 100 ? '' : vs > 0 ? ' ↑' : ' ↓';
    const parts = [
      a.onGround ? 'GND' : `${fmtAltitude(a.altFt, { compact: true })}${vsArrow}`,
      a.groundSpeedKt !== null ? fmtSpeedCompact(a.groundSpeedKt) : null,
      a.trackDeg !== null ? `${Math.round(a.trackDeg)}°` : null,
      a.squawk ? `sq ${a.squawk}` : null,
      `${fmtDistanceCompact(distanceFromHomeNm(a.lat, a.lon))} home`,
    ].filter(Boolean);
    ctx.fillStyle = t.fg;
    ctx.font = '30px ui-monospace, "JetBrains Mono", Menlo, monospace';
    ctx.fillText(truncateToWidth(ctx, parts.join('   '), CANVAS_W - 56), 28, 206);

    // Vertical rate detail on its own line when meaningful.
    if (vs !== null && Math.abs(vs) >= 100) {
      ctx.fillStyle = t.fgSoft;
      ctx.font = '24px ui-monospace, "JetBrains Mono", Menlo, monospace';
      ctx.fillText(fmtVerticalRate(vs), 28, 244);
    }

    // Emergency banner — steps left of the photo box when one is shown.
    if (a.emergency) {
      ctx.fillStyle = t.emergency;
      ctx.font = 'bold 26px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(a.emergency.toUpperCase(), this.photo.image ? PHOTO_X - 16 : CANVAS_W - 28, 66);
      ctx.textAlign = 'left';
    }

    // Photo box, top-right (issue #6 round 4 — same treatment as the XR
    // billboard, via the shared helper).
    if (this.photo.image) {
      drawCoverPhoto(
        ctx, this.photo.image,
        PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, 10,
        this.photo.credit, t.accent,
      );
    }

    this.texture.needsUpdate = true;
  }
}

/** Trim `text` with a trailing ellipsis until it fits `maxW` in the
 *  ctx's current font. */
function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) {
    t = t.slice(0, -1);
  }
  return `${t.trimEnd()}…`;
}
