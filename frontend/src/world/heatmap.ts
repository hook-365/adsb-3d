import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  Object3D,
  Vector3,
} from 'three';
import { toScene } from '../core/coords';
import type { HistoricalSample } from '../feed/historical';

// 3D airway-density visualization. Renders every aircraft's path as
// line segments in 3D space at the actual altitudes they flew. Uses
// additive blending so heavily-trafficked corridors (jet airways,
// approach paths, ground taxi tracks) glow brighter as overlapping
// segments stack up — natural "heatmap in the sky".
//
// Color per vertex follows the tar1090 altitude palette so altitude
// reads at a glance: orange-ish low, green mid-altitude, magenta high.
//
// Geometry is a single LineSegments mesh, rebuilt whenever the loaded
// historical window changes. Each pair of adjacent samples for the
// same aircraft becomes one segment; samples > GAP_MS apart are
// skipped to avoid drawing teleport lines across feed dropouts.

const GAP_MS = 60_000;
// Per-segment opacity. Low so individual flights are subtle but heavy
// bundles light up via additive blending.
const SEGMENT_OPACITY = 0.18;

// Reuse the tar1090 stops from the reconciler, inlined to avoid a
// cross-module dep. 2k orange → 10k light green → 40k magenta.
const HUE_STOPS: ReadonlyArray<{ alt: number; hue: number }> = [
  { alt: 2000, hue: 20 },
  { alt: 10000, hue: 140 },
  { alt: 40000, hue: 300 },
];
const AIR_S = 0.85;
const AIR_L = 0.55;
const GROUND_HSL = { h: 230 / 360, s: 0.4, l: 0.3 };

function altitudeHue(altFt: number): number {
  const stops = HUE_STOPS;
  if (altFt <= stops[0]!.alt) return stops[0]!.hue;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (altFt <= b.alt) {
      const t = (altFt - a.alt) / (b.alt - a.alt);
      return a.hue + (b.hue - a.hue) * t;
    }
  }
  return stops[stops.length - 1]!.hue;
}

function altitudeColor(altFt: number, out: Color): void {
  if (altFt <= 0) {
    out.setHSL(GROUND_HSL.h, GROUND_HSL.s, GROUND_HSL.l);
    return;
  }
  out.setHSL(altitudeHue(altFt) / 360, AIR_S, AIR_L);
}

export interface HeatmapStatus {
  loading: boolean;
  segmentCount: number;
  errored: string | null;
}

export type HeatmapStatusListener = (status: HeatmapStatus) => void;

export class HeatmapLayer {
  private readonly mesh: LineSegments;
  private readonly material: LineBasicMaterial;
  private readonly statusListeners = new Set<HeatmapStatusListener>();
  private status: HeatmapStatus = { loading: false, segmentCount: 0, errored: null };
  private isVisible = false;

  constructor(root: Object3D) {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
    geom.setAttribute('color', new BufferAttribute(new Float32Array(0), 3));
    this.material = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: SEGMENT_OPACITY,
      // Additive blending is the secret sauce: overlapping segments add
      // their RGB so heavy traffic glows. Pair with depthWrite=false so
      // a segment behind another doesn't punch a hole in the bundle.
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new LineSegments(geom, this.material);
    this.mesh.renderOrder = -3;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.userData = { kind: 'airway-density' };
    root.add(this.mesh);
  }

  subscribeStatus(fn: HeatmapStatusListener): () => void {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.mesh.visible = visible && this.status.segmentCount > 0;
  }

  /**
   * Rebuild the line mesh from the per-aircraft sample arrays the
   * playback feed already loaded. Cheap to call — we walk samples
   * once and write directly into a pre-sized Float32Array.
   */
  rebuildFromTracks(tracks: ReadonlyMap<string, readonly HistoricalSample[]>): void {
    // First pass: count segments so we can allocate exactly once.
    let segCount = 0;
    for (const samples of tracks.values()) {
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i]!;
        const b = samples[i + 1]!;
        if (b.ms - a.ms > GAP_MS) continue;
        segCount++;
      }
    }

    const oldGeom = this.mesh.geometry;
    if (segCount === 0) {
      const empty = new BufferGeometry();
      empty.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
      empty.setAttribute('color', new BufferAttribute(new Float32Array(0), 3));
      this.mesh.geometry = empty;
      oldGeom.dispose();
      this.setStatus({ ...this.status, segmentCount: 0 });
      this.mesh.visible = false;
      return;
    }

    // 2 vertices per segment, 3 floats each.
    const positions = new Float32Array(segCount * 2 * 3);
    const colors = new Float32Array(segCount * 2 * 3);

    const tmpA = new Vector3();
    const tmpB = new Vector3();
    const tmpColor = new Color();
    let off = 0;

    for (const samples of tracks.values()) {
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i]!;
        const b = samples[i + 1]!;
        if (b.ms - a.ms > GAP_MS) continue;

        toScene(a.lat, a.lon, a.altFt, tmpA);
        toScene(b.lat, b.lon, b.altFt, tmpB);

        altitudeColor(a.altFt, tmpColor);
        positions[off + 0] = tmpA.x;
        positions[off + 1] = tmpA.y;
        positions[off + 2] = tmpA.z;
        colors[off + 0] = tmpColor.r;
        colors[off + 1] = tmpColor.g;
        colors[off + 2] = tmpColor.b;

        altitudeColor(b.altFt, tmpColor);
        positions[off + 3] = tmpB.x;
        positions[off + 4] = tmpB.y;
        positions[off + 5] = tmpB.z;
        colors[off + 3] = tmpColor.r;
        colors[off + 4] = tmpColor.g;
        colors[off + 5] = tmpColor.b;

        off += 6;
      }
    }

    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setAttribute('color', new BufferAttribute(colors, 3));
    geom.computeBoundingSphere();
    this.mesh.geometry = geom;
    oldGeom.dispose();

    this.setStatus({ loading: false, segmentCount: segCount, errored: null });
    this.mesh.visible = this.isVisible && segCount > 0;
  }

  clear(): void {
    const oldGeom = this.mesh.geometry;
    const empty = new BufferGeometry();
    empty.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
    empty.setAttribute('color', new BufferAttribute(new Float32Array(0), 3));
    this.mesh.geometry = empty;
    oldGeom.dispose();
    this.setStatus({ loading: false, segmentCount: 0, errored: null });
    this.mesh.visible = false;
  }

  private setStatus(next: HeatmapStatus): void {
    this.status = next;
    for (const fn of this.statusListeners) fn(next);
  }
}
