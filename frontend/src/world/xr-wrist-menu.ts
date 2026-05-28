// Phase 3 in-VR wrist menu. A canvas-backed plane that attaches to the
// LEFT controller and floats just above the user's hand, tilted toward
// the face so a quick glance at the wrist reveals a settings panel
// without leaving the headset.
//
// The right controller's laser hovers and the trigger activates rows.
// Each row is either a cycler (theme, basemap) or a toggle (range
// rings, labels, altitude lines). The menu redraws on hover state
// change and on every settings/theme change so it always shows the
// current value.
//
// Lives in *real metres* (outside xrRoot scaling) because it's anchored
// to the controller, which itself tracks the headset's room frame.

import {
  CanvasTexture,
  DoubleSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Raycaster,
  Vector3,
} from 'three';
import {
  getSettings,
  subscribeSettings,
  updateSettings,
  type Basemap,
  type Settings,
} from '../core/settings';
import {
  getTheme,
  setTheme,
  subscribeTheme,
  THEME_OPTIONS,
} from '../core/theme';

// Plane dimensions in real metres. Sized to feel like a credit card on
// the inside of the wrist — readable at arm's length but not absurdly
// large in peripheral vision when the hand is down.
const MENU_W_M = 0.20;
const MENU_H_M = 0.15;
// Canvas resolution — 512×384 keeps the 4:3 aspect of the plane and
// gives crisp text in VR. Redraws are cheap (event-driven, not per-frame).
const CANVAS_W = 512;
const CANVAS_H = 384;

const ROW_COUNT = 5;
const HEADER_PX = 28;
const ROW_HEIGHT_PX = (CANVAS_H - HEADER_PX) / ROW_COUNT;

const BASEMAP_OPTIONS: ReadonlyArray<{ value: Basemap; label: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'carto_voyager', label: 'Voyager' },
  { value: 'hillshade', label: 'Hillshade' },
  { value: 'topo', label: 'Topo' },
  { value: 'satellite', label: 'Satellite' },
  { value: 'osm', label: 'OSM' },
  { value: 'sectional', label: 'FAA Sectional' },
  { value: 'sectional_hybrid', label: 'Sectional + Roads' },
  { value: 'helicopter', label: 'FAA Helicopter' },
  { value: 'ifr_low', label: 'IFR Low' },
  { value: 'ifr_high', label: 'IFR High' },
];

interface MenuRow {
  id: string;
  label: () => string;
  value: () => string;
  activate: () => void;
}

const ROWS: MenuRow[] = [
  {
    id: 'theme',
    label: () => 'Theme',
    value: () => {
      const sel = getTheme().selection;
      const opt = THEME_OPTIONS.find((o) => o.value === sel);
      return opt ? opt.label : String(sel);
    },
    activate: () => {
      const sel = getTheme().selection;
      const idx = THEME_OPTIONS.findIndex((o) => o.value === sel);
      const next = THEME_OPTIONS[(idx + 1) % THEME_OPTIONS.length];
      if (!next) return;
      setTheme(next.value);
      // Persist through Settings (theme module doesn't own storage).
      updateSettings({ theme: next.value });
    },
  },
  {
    id: 'basemap',
    label: () => 'Basemap',
    value: () => {
      const cur = getSettings().basemap;
      const opt = BASEMAP_OPTIONS.find((o) => o.value === cur);
      return opt ? opt.label : cur;
    },
    activate: () => {
      const cur = getSettings().basemap;
      const idx = BASEMAP_OPTIONS.findIndex((o) => o.value === cur);
      const next = BASEMAP_OPTIONS[(idx + 1) % BASEMAP_OPTIONS.length];
      if (!next) return;
      updateSettings({ basemap: next.value });
    },
  },
  {
    id: 'rangeRings',
    label: () => 'Range rings',
    value: () => (getSettings().rangeRings ? 'on' : 'off'),
    activate: () => updateSettings({ rangeRings: !getSettings().rangeRings }),
  },
  {
    id: 'aircraftLabels',
    label: () => 'Labels',
    value: () => (getSettings().aircraftLabels ? 'on' : 'off'),
    activate: () => updateSettings({ aircraftLabels: !getSettings().aircraftLabels }),
  },
  {
    id: 'altitudeLines',
    label: () => 'Alt lines',
    value: () => (getSettings().altitudeLines ? 'on' : 'off'),
    activate: () => updateSettings({ altitudeLines: !getSettings().altitudeLines }),
  },
];

export class XrWristMenu {
  /** Mesh used both for rendering and as the raycast pick root. */
  readonly mesh: Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly raycaster = new Raycaster();
  private readonly tmpOrigin = new Vector3();
  private readonly tmpDir = new Vector3();
  private readonly unsubSettings: () => void;
  private readonly unsubTheme: () => void;
  private hoveredRow: number | null = null;
  private attached: Object3D | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('XrWristMenu: 2d context unavailable');
    this.ctx = ctx;

    this.texture = new CanvasTexture(this.canvas);
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    // Anisotropy improves readability at grazing angles, which is the
    // normal viewing angle for a wrist-mounted UI.
    this.texture.anisotropy = 4;

    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      // DoubleSide: if the user rotates their wrist past 90° the menu
      // stays visible from the back rather than disappearing into
      // invisible-back-face land.
      side: DoubleSide,
    });

    const geometry = new PlaneGeometry(MENU_W_M, MENU_H_M);
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = 'xr-wrist-menu';
    this.mesh.visible = false;
    this.mesh.renderOrder = 10;

    // Redraw on any state change so the displayed value tracks reality.
    this.unsubSettings = subscribeSettings(() => this.redraw());
    this.unsubTheme = subscribeTheme(() => this.redraw());
    this.redraw();
  }

  /**
   * Attach the menu to the left controller's Object3D. Called once
   * handedness is known (XR controllers fire 'connected' with an
   * `XRInputSource` whose `.handedness` distinguishes left/right).
   *
   * Position + rotation orient the plane just above the back of the
   * user's hand, angled to face the eye when the arm is in a natural
   * "check my watch" pose.
   */
  attachTo(controller: Object3D): void {
    if (this.attached === controller) return;
    if (this.attached) this.attached.remove(this.mesh);
    controller.add(this.mesh);
    this.attached = controller;
    // 4 cm above the hand, 6 cm back toward the body so the plane sits
    // over the wrist rather than out at the controller tip.
    this.mesh.position.set(0, 0.04, 0.06);
    // Tilt: -60° around X faces the menu up-and-forward, toward the
    // user's head when the arm is at a natural reading angle. +π around
    // Y so the canvas reads correctly (otherwise it's mirrored relative
    // to the controller's -Z forward axis).
    this.mesh.rotation.set(-Math.PI / 3, Math.PI, 0);
    this.mesh.visible = true;
  }

  /** Detach from any controller and hide. */
  detach(): void {
    if (this.attached) {
      this.attached.remove(this.mesh);
      this.attached = null;
    }
    this.mesh.visible = false;
    this.hoveredRow = null;
  }

  /**
   * Per-frame hover update. Caller passes the pointing controller (the
   * RIGHT controller, typically): we raycast its forward axis against
   * the menu and update the hover highlight.
   */
  updateHover(pointer: Object3D | null): void {
    if (!pointer || !this.mesh.visible) {
      this.setHoveredRow(null);
      return;
    }
    this.tmpOrigin.setFromMatrixPosition(pointer.matrixWorld);
    this.tmpDir.set(0, 0, -1).transformDirection(pointer.matrixWorld);
    this.raycaster.set(this.tmpOrigin, this.tmpDir);
    const hits = this.raycaster.intersectObject(this.mesh, false);
    const first = hits[0];
    if (!first || !first.uv) {
      this.setHoveredRow(null);
      return;
    }
    this.setHoveredRow(this.rowFromUV(first.uv.y));
  }

  /**
   * Try to handle a select-press from the given pointing controller.
   * Returns true if the press hit a menu row (caller should suppress
   * its own action, e.g. aircraft picking).
   */
  trySelect(pointer: Object3D): boolean {
    if (!this.mesh.visible) return false;
    this.tmpOrigin.setFromMatrixPosition(pointer.matrixWorld);
    this.tmpDir.set(0, 0, -1).transformDirection(pointer.matrixWorld);
    this.raycaster.set(this.tmpOrigin, this.tmpDir);
    const hits = this.raycaster.intersectObject(this.mesh, false);
    const first = hits[0];
    if (!first || !first.uv) return false;
    const rowIdx = this.rowFromUV(first.uv.y);
    if (rowIdx === null) return false;
    const row = ROWS[rowIdx];
    if (!row) return false;
    row.activate();
    // Activate triggers a settings/theme change → subscriber redraws.
    return true;
  }

  dispose(): void {
    this.unsubSettings();
    this.unsubTheme();
    if (this.attached) this.attached.remove(this.mesh);
    this.material.dispose();
    this.texture.dispose();
    this.mesh.geometry.dispose();
  }

  // ── internals ──────────────────────────────────────────────────────

  /**
   * uv.y is 0 at the bottom of the plane and 1 at the top. The header
   * occupies the top HEADER_PX strip; rows fill the rest top-to-bottom.
   */
  private rowFromUV(uvY: number): number | null {
    const pxFromTop = (1 - uvY) * CANVAS_H;
    if (pxFromTop < HEADER_PX) return null;
    const row = Math.floor((pxFromTop - HEADER_PX) / ROW_HEIGHT_PX);
    if (row < 0 || row >= ROWS.length) return null;
    return row;
  }

  private setHoveredRow(row: number | null): void {
    if (row === this.hoveredRow) return;
    this.hoveredRow = row;
    this.redraw();
  }

  private redraw(): void {
    const ctx = this.ctx;
    const t = getTheme().tokens;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Panel background — slightly more opaque than the in-world
    // billboard since we want it legible against bright basemaps too.
    ctx.fillStyle = withAlpha(t.panelBase, 0.95);
    roundRect(ctx, 4, 4, CANVAS_W - 8, CANVAS_H - 8, 14);
    ctx.fill();
    ctx.strokeStyle = withAlpha(t.accent, 0.5);
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, CANVAS_W - 8, CANVAS_H - 8, 14);
    ctx.stroke();

    // Header
    ctx.fillStyle = t.accent;
    ctx.font = 'bold 18px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('ADS-B 3D', 20, 6);
    ctx.textAlign = 'right';
    ctx.fillStyle = t.fgSoft;
    ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('point + trigger', CANVAS_W - 20, 8);
    // Header divider
    ctx.strokeStyle = withAlpha(t.accent, 0.25);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, HEADER_PX);
    ctx.lineTo(CANVAS_W - 16, HEADER_PX);
    ctx.stroke();

    // Rows
    ctx.textAlign = 'left';
    for (let i = 0; i < ROWS.length; i++) {
      const row = ROWS[i];
      if (!row) continue;
      const y = HEADER_PX + i * ROW_HEIGHT_PX;
      const hovered = i === this.hoveredRow;

      if (hovered) {
        ctx.fillStyle = withAlpha(t.accent, 0.22);
        roundRect(ctx, 10, y + 2, CANVAS_W - 20, ROW_HEIGHT_PX - 4, 8);
        ctx.fill();
      }

      // Label (left side)
      ctx.fillStyle = hovered ? t.accent : t.fg;
      ctx.font = '22px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(row.label(), 24, y + ROW_HEIGHT_PX / 2);

      // Value (right side)
      ctx.fillStyle = hovered ? t.accent : t.fgSoft;
      ctx.font = '20px ui-monospace, "JetBrains Mono", Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(row.value(), CANVAS_W - 24, y + ROW_HEIGHT_PX / 2);
    }

    this.texture.needsUpdate = true;
  }
}

// ── drawing helpers (duplicated from xr-billboard to keep the modules
// independent — these would graduate to a shared file once we have a
// third VR canvas surface) ──────────────────────────────────────────

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
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

// Re-export Settings so consumers wiring this module don't also need
// to import core/settings just for the type.
export type { Settings };
