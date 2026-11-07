import { Euler, Vector3, type PerspectiveCamera } from 'three';

// Free camera: an alternative to OrbitControls where the eye itself moves.
// Drag to look around (yaw/pitch, no roll), WASD or the arrow keys to fly
// relative to the view heading, R/F (or PageUp/PageDown) for straight up
// and down, Shift for a burst of speed, and the wheel to push along the
// line of sight. Speed scales with height so a sweep over a city at
// 200 NM up and a taxi past a terminal both feel deliberate.
//
// main.ts owns the mode switch: while free, OrbitControls is disabled and
// this class's update() runs once per frame instead of controls.update();
// switching back re-seats the orbit target ahead of the camera. The
// terrain floor and XR hand-off stay in main.ts, as for orbit.

const LOOK_RAD_PER_PX = 0.0035;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
const BASE_SPEED = 12; // scene units (NM) per second at ground level
const SPEED_PER_UNIT_HEIGHT = 0.45; // added per unit of camera height
const SPRINT = 3;
const WHEEL_UNITS_PER_PX = 0.08;
const MAX_RANGE = 1500; // keep the eye within the scope's basemap/terrain

const KEY_FORWARD = new Set(['w', 'W', 'ArrowUp']);
const KEY_BACK = new Set(['s', 'S', 'ArrowDown']);
const KEY_LEFT = new Set(['a', 'A', 'ArrowLeft']);
const KEY_RIGHT = new Set(['d', 'D', 'ArrowRight']);
const KEY_UP = new Set(['r', 'R', 'PageUp']);
const KEY_DOWN = new Set(['f', 'F', 'PageDown']);
export const FREE_CAMERA_KEYS: ReadonlySet<string> = new Set([
  ...KEY_FORWARD, ...KEY_BACK, ...KEY_LEFT, ...KEY_RIGHT, ...KEY_UP, ...KEY_DOWN,
]);

/** Smallest signed rotation from `from` to `to`, in (-π, π]. */
export function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Yaw/pitch (YXZ Euler, camera looks down -Z at 0/0) that faces `to` from `from`. */
export function yawPitchToward(from: Vector3, to: Vector3): { yaw: number; pitch: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const horiz = Math.hypot(dx, dz);
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, horiz) };
}

/** Horizontal flight vector for the pressed keys, in the yaw's frame; unit length or zero. */
export function moveVector(keys: ReadonlySet<string>, yaw: number, out = new Vector3()): Vector3 {
  const has = (set: Set<string>): boolean => {
    for (const k of set) if (keys.has(k)) return true;
    return false;
  };
  const fwd = (has(KEY_FORWARD) ? 1 : 0) - (has(KEY_BACK) ? 1 : 0);
  const right = (has(KEY_RIGHT) ? 1 : 0) - (has(KEY_LEFT) ? 1 : 0);
  const up = (has(KEY_UP) ? 1 : 0) - (has(KEY_DOWN) ? 1 : 0);
  // Camera forward at yaw=0 is -Z; right is +X.
  out.set(
    -Math.sin(yaw) * fwd + Math.cos(yaw) * right,
    up,
    -Math.cos(yaw) * fwd - Math.sin(yaw) * right,
  );
  return out.lengthSq() > 0 ? out.normalize() : out;
}

export class FreeCamera {
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private sprint = false;
  private _enabled = false;
  private detach: (() => void) | null = null;
  private readonly tmp = new Vector3();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
  ) {}

  get enabled(): boolean {
    return this._enabled;
  }

  /** True while the pointer is dragging the view: follow-look pauses, like a pan in orbit. */
  get interacting(): boolean {
    return this.dragging;
  }

  /** Turn on: take the camera's current heading as the starting yaw/pitch. */
  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this.syncFromCamera();
    this.detach = this.listen();
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this.keys.clear();
    this.dragging = false;
    this.detach?.();
    this.detach = null;
  }

  /** Re-read yaw/pitch from wherever the camera is pointing now. */
  syncFromCamera(): void {
    this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.euler.x));
    this.yaw = this.euler.y;
    this.applyRotation();
  }

  /** Ease the view toward `point` without moving the eye (follow in free mode). */
  lookToward(point: Vector3, lerp: number): void {
    const want = yawPitchToward(this.camera.position, point);
    this.yaw += shortestAngle(this.yaw, want.yaw) * lerp;
    this.pitch += (Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, want.pitch)) - this.pitch) * lerp;
    this.applyRotation();
  }

  /** Per-frame: fly for the held keys. dtMs is the frame interval. */
  update(dtMs: number): void {
    if (!this._enabled) return;
    const dir = moveVector(this.keys, this.yaw, this.tmp);
    if (dir.lengthSq() > 0) {
      const speed =
        (BASE_SPEED + Math.max(0, this.camera.position.y) * SPEED_PER_UNIT_HEIGHT) *
        (this.sprint ? SPRINT : 1);
      this.camera.position.addScaledVector(dir, (speed * Math.min(dtMs, 100)) / 1000);
      this.clampRange();
    }
    this.applyRotation();
  }

  private applyRotation(): void {
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);
  }

  private clampRange(): void {
    const p = this.camera.position;
    const horiz = Math.hypot(p.x, p.z);
    if (horiz > MAX_RANGE) {
      p.x *= MAX_RANGE / horiz;
      p.z *= MAX_RANGE / horiz;
    }
    if (p.y > MAX_RANGE) p.y = MAX_RANGE;
  }

  private listen(): () => void {
    const dom = this.dom;
    const isTyping = (e: Event): boolean => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      dom.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw -= dx * LOOK_RAD_PER_PX;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - dy * LOOK_RAD_PER_PX));
      this.applyRotation();
    };
    const onPointerUp = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragging = false;
      if (dom.hasPointerCapture?.(e.pointerId)) dom.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      // Push along the line of sight; wheel-down backs away, like orbit zoom.
      const step = -e.deltaY * WHEEL_UNITS_PER_PX * (1 + Math.max(0, this.camera.position.y) / 200);
      this.camera.getWorldDirection(this.tmp);
      this.camera.position.addScaledVector(this.tmp, step);
      this.clampRange();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTyping(e)) return;
      if (e.key === 'Shift') this.sprint = true;
      if (FREE_CAMERA_KEYS.has(e.key)) {
        this.keys.add(e.key);
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Shift') this.sprint = false;
      this.keys.delete(e.key);
    };
    const onBlur = (): void => {
      this.keys.clear();
      this.sprint = false;
      this.dragging = false;
    };
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('pointercancel', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }
}
