// Phase 3 in-VR wrist menu. A canvas-backed plane that attaches to the
// LEFT controller and floats just above the user's hand, tilted toward
// the face so a quick glance at the wrist reveals a settings panel
// without leaving the headset.
//
// The right controller's laser hovers and the trigger activates rows.
// Rows are generated from the declarative PAGES spec below — each is a
// toggle (flip a boolean setting), a cycler (step through a choice
// setting's options), or a stepper (quantized range setting). The last
// slot on every page is a pager that advances to the next page.
//
// Settings parity (issue #6): every key in core/settings.ts must appear
// in PAGES or carry a reason in WRIST_MENU_EXCLUDED — the drift-guard
// test (tests-unit/xr-wrist-menu.test.ts) fails otherwise, so a new
// setting can't silently miss the in-headset UI.
//
// The menu redraws on hover state change and on every settings/theme
// change so it always shows the current value.
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
  BASEMAP_VALUES,
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
// Aliased: `t` is the conventional local name for theme tokens in the draw
// code below.
import { t as tr } from '../core/i18n';
import { getXrState } from '../core/xr';

// Plane dimensions in real metres. Sized to feel like a credit card on
// the inside of the wrist — readable at arm's length but not absurdly
// large in peripheral vision when the hand is down.
const MENU_W_M = 0.20;
const MENU_H_M = 0.15;
// Canvas resolution — 512×384 keeps the 4:3 aspect of the plane and
// gives crisp text in VR. Redraws are cheap (event-driven, not per-frame).
const CANVAS_W = 512;
const CANVAS_H = 384;

// Fixed layout: 6 content slots + the pager in the bottom slot. Pages
// must not exceed CONTENT_SLOTS rows (asserted by the drift-guard test).
const ROW_COUNT = 7;
const CONTENT_SLOTS = ROW_COUNT - 1;
const PAGER_SLOT = ROW_COUNT - 1;
const HEADER_PX = 28;
const ROW_HEIGHT_PX = (CANVAS_H - HEADER_PX) / ROW_COUNT;

interface MenuRow {
  /**
   * The Settings key this row drives (doubles as the parity-test id).
   * `__`-prefixed ids are action rows, not settings — the parity test
   * skips them.
   */
  id: keyof Settings | `__${string}`;
  label: () => string;
  value: () => string;
  activate: () => void;
  /** Omitted = always shown. Action rows use this to gate by session mode. */
  visible?: () => boolean;
}

/**
 * Actions main.ts wires in (they need the renderer / scene, which this
 * module deliberately doesn't import). Rows referencing an action hide
 * themselves until it's wired.
 */
export interface WristMenuActions {
  /** Arm/disarm AR place mode (world/xr-ar-place.ts). */
  toggleArPlace: () => void;
  arPlaceActive: () => boolean;
}
let menuActions: WristMenuActions | null = null;
export function setWristMenuActions(a: WristMenuActions): void {
  menuActions = a;
}

// ── row factories ─────────────────────────────────────────────────────
// All labels are lazy thunks: the module must stay import-safe in the
// node test environment, and tr() at module scope would also freeze the
// locale before boot resolves it.

type BooleanSettingKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

function toggleRow(key: BooleanSettingKey, label: () => string): MenuRow {
  return {
    id: key,
    label,
    value: () => (getSettings()[key] ? tr('misc.xr_on') : tr('misc.xr_off')),
    activate: () => updateSettings({ [key]: !getSettings()[key] } as Partial<Settings>),
  };
}

function cycleRow<K extends keyof Settings>(
  key: K,
  label: () => string,
  options: ReadonlyArray<{ value: Settings[K]; label: () => string }>,
): MenuRow {
  return {
    id: key,
    label,
    value: () => {
      const cur = getSettings()[key];
      const opt = options.find((o) => o.value === cur);
      return opt ? opt.label() : String(cur);
    },
    activate: () => {
      const cur = getSettings()[key];
      const idx = options.findIndex((o) => o.value === cur);
      const next = options[(idx + 1) % options.length];
      if (next) updateSettings({ [key]: next.value } as Partial<Settings>);
    },
  };
}

/** Quantized range: each press jumps to the next step above the current
 *  value, wrapping to the first — a slider is unusable on a laser menu. */
function stepRow(
  key: 'labelDensity',
  label: () => string,
  steps: readonly number[],
  format: (v: number) => string,
): MenuRow {
  return {
    id: key,
    label,
    value: () => format(getSettings()[key]),
    activate: () => {
      const cur = getSettings()[key];
      const next = steps.find((s) => s > cur) ?? steps[0] ?? 0;
      updateSettings({ [key]: next });
    },
  };
}

// Terse per-value labels. Record<Basemap, …> so adding a basemap without
// a wrist label is a compile error, mirroring the settings panel's map.
const XR_BASEMAP_LABELS: Record<Basemap, () => string> = {
  dark: () => tr('misc.xr_basemap_dark'),
  carto_voyager: () => tr('misc.xr_basemap_voyager'),
  osm: () => tr('misc.xr_basemap_osm'),
  topo: () => tr('misc.xr_basemap_topo'),
  hillshade: () => tr('misc.xr_basemap_hillshade'),
  satellite: () => tr('misc.xr_basemap_satellite'),
  sectional: () => tr('misc.xr_basemap_sectional'),
  sectional_hybrid: () => tr('misc.xr_basemap_sectional_hybrid'),
  helicopter: () => tr('misc.xr_basemap_helicopter'),
  ifr_low: () => tr('misc.xr_basemap_ifr_low'),
  ifr_high: () => tr('misc.xr_basemap_ifr_high'),
};

// Theme needs custom activation (setTheme applies, Settings persists),
// so it can't come out of cycleRow.
const themeRow: MenuRow = {
  id: 'theme',
  label: () => tr('misc.xr_theme'),
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
};

// ── pages ─────────────────────────────────────────────────────────────
// Grouped deliberately: what you see / how VR behaves / units. Unit
// values are aviation abbreviations and deliberately untranslated.

const PAGES: MenuRow[][] = [
  [
    themeRow,
    cycleRow(
      'basemap',
      () => tr('misc.xr_basemap'),
      BASEMAP_VALUES.map((v) => ({ value: v, label: XR_BASEMAP_LABELS[v] })),
    ),
    toggleRow('rangeRings', () => tr('misc.xr_range_rings')),
    toggleRow('aircraftLabels', () => tr('misc.xr_labels')),
    toggleRow('altitudeLines', () => tr('misc.xr_alt_lines')),
    toggleRow('groundSprites', () => tr('misc.xr_ground_icons')),
  ],
  [
    cycleRow('xrMoveMode', () => tr('misc.xr_movement'), [
      { value: 'scope', label: () => tr('misc.xr_move_scope') },
      { value: 'freefly', label: () => tr('misc.xr_move_freefly') },
    ]),
    cycleRow('xrTurnStyle', () => tr('misc.xr_turning'), [
      { value: 'snap', label: () => tr('misc.xr_turn_snap') },
      { value: 'smooth', label: () => tr('misc.xr_turn_smooth') },
    ]),
    cycleRow('vrQuality', () => tr('misc.xr_quality'), [
      { value: 'low', label: () => tr('misc.xr_q_low') },
      { value: 'balanced', label: () => tr('misc.xr_q_balanced') },
      { value: 'high', label: () => tr('misc.xr_q_high') },
      { value: 'ultra', label: () => tr('misc.xr_q_ultra') },
    ]),
    stepRow(
      'labelDensity',
      () => tr('misc.xr_label_density'),
      [0, 25, 50, 75, 100],
      (v) => (v === 0 ? tr('misc.xr_density_all') : String(v)),
    ),
    toggleRow('acarsMessages', () => tr('misc.xr_acars')),
    {
      // AR-only action row: arm hit-test placement, then any trigger
      // drops the scope on the reticle (issue #6 "place it on a table").
      id: '__arPlace',
      label: () => tr('misc.xr_place'),
      value: () => (menuActions?.arPlaceActive() ? tr('misc.xr_hint') : tr('misc.xr_off')),
      activate: () => menuActions?.toggleArPlace(),
      visible: () => menuActions !== null && getXrState().presentingMode === 'ar',
    },
  ],
  [
    cycleRow('altitudeUnit', () => tr('misc.xr_alt_unit'), [
      { value: 'ft', label: () => 'ft' },
      { value: 'm', label: () => 'm' },
    ]),
    cycleRow('speedUnit', () => tr('misc.xr_speed_unit'), [
      { value: 'kt', label: () => 'kt' },
      { value: 'mph', label: () => 'mph' },
      { value: 'kmh', label: () => 'km/h' },
    ]),
    cycleRow('distanceUnit', () => tr('misc.xr_dist_unit'), [
      { value: 'nm', label: () => 'NM' },
      { value: 'km', label: () => 'km' },
    ]),
  ],
];

/** Settings keys the wrist menu drives — action rows (`__` ids) excluded. */
export const WRIST_MENU_KEYS: readonly (keyof Settings)[] = PAGES.flat()
  .map((r) => r.id)
  .filter((id): id is keyof Settings => !id.startsWith('__'));

/**
 * Settings keys the wrist menu deliberately omits, with the reason.
 * The parity drift-guard test requires every Settings key to be in
 * WRIST_MENU_KEYS or here — add a reason, don't just drop a key.
 */
export const WRIST_MENU_EXCLUDED: Readonly<Partial<Record<keyof Settings, string>>> = {
  language: 'changing it reloads the page, which would kill the XR session',
  stereo: 'desktop side-by-side mode — meaningless inside a headset',
  stereoStrength: 'desktop side-by-side mode — meaningless inside a headset',
  vrScale: 'live-driven by the left thumbstick; a menu row would fight it',
  terrain3d: 'changing it reloads the page, which would kill the XR session',
  altitudeCurveBias: 'changing it reloads the page, which would kill the XR session',
};

/** Exported for the drift-guard test: no page may overflow its slots. */
export const WRIST_MENU_PAGE_SIZES: readonly number[] = PAGES.map((p) => p.length);
export const WRIST_MENU_MAX_PAGE_SIZE = CONTENT_SLOTS;

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
  /** Hover position as a layout slot (0..ROW_COUNT-1), not a row index. */
  private hoveredSlot: number | null = null;
  private page = 0;
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
    // No Y flip: a previous +π around Y spun the plane to face
    // down-and-away, so the user saw the mirrored back face through
    // DoubleSide (issue #6: "flipped the wrong way"). The -60° X tilt
    // alone turns the +Z front face up and back toward the head, where
    // it reads correctly.
    this.mesh.rotation.set(-Math.PI / 3, 0, 0);
    this.mesh.visible = true;
  }

  /** Detach from any controller and hide. */
  detach(): void {
    if (this.attached) {
      this.attached.remove(this.mesh);
      this.attached = null;
    }
    this.mesh.visible = false;
    this.hoveredSlot = null;
  }

  /**
   * Per-frame hover update. Caller passes the pointing controller (the
   * RIGHT controller, typically): we raycast its forward axis against
   * the menu and update the hover highlight.
   */
  updateHover(pointer: Object3D | null): void {
    if (!pointer || !this.mesh.visible) {
      this.setHoveredSlot(null);
      return;
    }
    this.tmpOrigin.setFromMatrixPosition(pointer.matrixWorld);
    this.tmpDir.set(0, 0, -1).transformDirection(pointer.matrixWorld);
    this.raycaster.set(this.tmpOrigin, this.tmpDir);
    const hits = this.raycaster.intersectObject(this.mesh, false);
    const first = hits[0];
    if (!first || !first.uv) {
      this.setHoveredSlot(null);
      return;
    }
    this.setHoveredSlot(this.slotFromUV(first.uv.y));
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
    const slot = this.slotFromUV(first.uv.y);
    if (slot === null) return false;
    if (slot === PAGER_SLOT) {
      this.page = (this.page + 1) % PAGES.length;
      this.redraw();
      return true;
    }
    const row = this.contentRows()[slot];
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
   * Force a redraw. Needed after external state a row displays changes
   * without a settings/theme event — e.g. toggling AR place mode.
   */
  refresh(): void {
    this.redraw();
  }

  private contentRows(): MenuRow[] {
    return (PAGES[this.page] ?? []).filter((r) => r.visible?.() ?? true);
  }

  /**
   * uv.y is 0 at the bottom of the plane and 1 at the top. The header
   * occupies the top HEADER_PX strip; content rows fill slots from the
   * top and the pager is pinned to the bottom slot on every page (so
   * "next page" never moves under the laser between pages).
   */
  private slotFromUV(uvY: number): number | null {
    const pxFromTop = (1 - uvY) * CANVAS_H;
    if (pxFromTop < HEADER_PX) return null;
    const slot = Math.floor((pxFromTop - HEADER_PX) / ROW_HEIGHT_PX);
    if (slot < 0 || slot >= ROW_COUNT) return null;
    if (slot === PAGER_SLOT) return slot;
    return slot < this.contentRows().length ? slot : null;
  }

  private setHoveredSlot(slot: number | null): void {
    if (slot === this.hoveredSlot) return;
    this.hoveredSlot = slot;
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
    ctx.fillText(tr('misc.xr_hint'), CANVAS_W - 20, 8);
    // Header divider
    ctx.strokeStyle = withAlpha(t.accent, 0.25);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, HEADER_PX);
    ctx.lineTo(CANVAS_W - 16, HEADER_PX);
    ctx.stroke();

    // Content rows + the pager pinned to the bottom slot.
    const rows = this.contentRows();
    for (let slot = 0; slot < ROW_COUNT; slot++) {
      const isPager = slot === PAGER_SLOT;
      const row = isPager ? null : rows[slot];
      if (!isPager && !row) continue;
      const y = HEADER_PX + slot * ROW_HEIGHT_PX;
      const hovered = slot === this.hoveredSlot;

      if (hovered) {
        ctx.fillStyle = withAlpha(t.accent, 0.22);
        roundRect(ctx, 10, y + 2, CANVAS_W - 20, ROW_HEIGHT_PX - 4, 8);
        ctx.fill();
      }

      const label = isPager ? tr('misc.xr_page') : row!.label();
      const value = isPager ? `${this.page + 1}/${PAGES.length} ▸` : row!.value();

      // Label (left side)
      ctx.fillStyle = hovered ? t.accent : isPager ? t.fgSoft : t.fg;
      ctx.font = '22px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(label, 24, y + ROW_HEIGHT_PX / 2);

      // Value (right side)
      ctx.fillStyle = hovered ? t.accent : t.fgSoft;
      ctx.font = '20px ui-monospace, "JetBrains Mono", Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(value, CANVAS_W - 24, y + ROW_HEIGHT_PX / 2);
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
