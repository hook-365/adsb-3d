// Shared canvas-drawing helpers for the in-world UI surfaces (XR
// billboard, wrist menu, stereo panel). These lived as private copies in
// xr-billboard.ts and xr-wrist-menu.ts, each carrying a comment that the
// third consumer should extract them — the stereo panel is that third
// consumer.

/** Convert a hex color (#rrggbb) to rgba(..., alpha). Tolerates any
 *  prefix on the input — used because theme tokens are already a mix of
 *  hex and rgba strings and we just need a translucent backdrop. */
export function withAlpha(color: string, alpha: number): string {
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

/** Rounded-rectangle path (caller fills/strokes). */
export function roundRect(
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

/**
 * Cover-crop `img` into a rounded box with an optional attribution strip
 * along the bottom edge and an accent border. Shared by the XR billboard
 * and the desktop HUD card so the photo treatment can't drift between
 * the two surfaces.
 */
export function drawCoverPhoto(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  credit: string,
  accent: string,
): void {
  const boxAspect = w / h;
  const imgAspect = img.naturalWidth / img.naturalHeight;
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (imgAspect > boxAspect) {
    sw = img.naturalHeight * boxAspect;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / boxAspect;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  if (credit) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x, y + h - 20, w, 20);
    ctx.fillStyle = '#fff';
    ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(credit, x + 6, y + h - 10, w - 12);
  }
  ctx.restore();
  ctx.strokeStyle = withAlpha(accent, 0.4);
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, radius);
  ctx.stroke();
}
