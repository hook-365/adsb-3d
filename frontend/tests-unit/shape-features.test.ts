// @vitest-environment jsdom
// jsdom (not node like the other suites): building the real silhouette
// geometry runs SVGLoader.parse, which needs DOMParser.
import { describe, it, expect } from 'vitest';
import type { BufferGeometry } from 'three';
import {
  SHAPE_FEATURES,
  type EngineFeature,
  type ShapeFeatures,
} from '../src/aircraft/shape-features';
import { getShapeDef } from '../src/aircraft/shapes';
import { buildFeatureParts, getSilhouetteGeometry } from '../src/aircraft/shape-geometry';
import fuselageProfiles from '../src/aircraft/fuselage-profiles.json';

// Drift guard for the 3D feature annotations: every entry must reference a
// real catalog shape, carry sane fractions, and produce a merged geometry
// within the triangle budget. Mirrors the theme/i18n drift-guard style.

// Per-part triangle counts are deterministic: a trapezoid extrusion is
// 2 caps x 2 + 4 walls x 2 = 12 tris, a box is 12.
const FIN_TRIS = 12;
// Swept/tapered tailplane: extruded 6-vertex planform = 4 tris per cap
// (n - 2) x 2 caps + 6 side edges x 2 = 20.
const TAILPLANE_TRIS = 20;
// Capped 8-seg barrel (32) plus the open 8-seg intake lip (16).
const ENGINE_TRIS = 48;
// Fallback tube (no profile): nose cone + open cylinder + tail cone,
// 8 segments each; three emits 2 tris per segment even on cones, so 48.
const FUSELAGE_FALLBACK_TRIS = 48;
// Lofted tube: (stations - 1) x 8 segments x 2 tris + two 8-tri end fans.
const loftTris = (stations: number) => (stations - 1) * 16 + 16;
// Rotor: one blade box per angle (12 tris each) + a capped 6-seg mast (24).
const rotorTris = (r: { angles?: number[] }) => (r.angles?.length ?? 2) * 12 + 24;
// Tail rotor: two crossed boxes.
const TAIL_ROTOR_TRIS = 24;
// Budget ceiling: worst case is a four-engine heavy with lofted fuselage,
// fin and T-tail (192 + 12 + 12 + 4x48 = 408) plus a little headroom.
const MAX_FEATURE_TRIS = 420;

function triangleCount(g: BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}

function expectedTris(name: string, f: ShapeFeatures): number {
  const profile = (fuselageProfiles as Record<string, number[]>)[name];
  return (
    (f.fin ? FIN_TRIS : 0) +
    (f.fins?.length ?? 0) * FIN_TRIS +
    (f.tailplane ? TAILPLANE_TRIS : 0) +
    (f.engines?.length ?? 0) * ENGINE_TRIS +
    (f.fuselage ? (profile ? loftTris(profile.length) : FUSELAGE_FALLBACK_TRIS) : 0) +
    (f.rotors ?? []).reduce((sum, r) => sum + rotorTris(r), 0) +
    (f.tailRotor ? TAIL_ROTOR_TRIS : 0)
  );
}

describe('annotation table validity', () => {
  for (const [name, f] of Object.entries(SHAPE_FEATURES)) {
    it(`${name} references a catalog shape`, () => {
      expect(getShapeDef(name), name).not.toBeNull();
    });

    it(`${name} has sane fractions`, () => {
      for (const fin of [...(f.fin ? [f.fin] : []), ...(f.fins ?? [])]) {
        const { y, rootChord, tipChord, height, sweep, x } = fin;
        for (const v of [y, rootChord, tipChord, height, sweep]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
        expect(rootChord).toBeGreaterThan(0);
        expect(rootChord).toBeLessThanOrEqual(0.5);
        expect(tipChord).toBeGreaterThan(0);
        expect(tipChord, `${name} fin tip wider than root`).toBeLessThanOrEqual(rootChord);
        expect(height).toBeGreaterThan(0);
        expect(height).toBeLessThanOrEqual(0.5);
        expect(sweep).toBeGreaterThanOrEqual(0);
        expect(sweep).toBeLessThanOrEqual(0.5);
        // Fin must not overhang the tail.
        expect(y + Math.max(rootChord, sweep + tipChord)).toBeLessThanOrEqual(1.05);
        if (x !== undefined) {
          expect(x).toBeGreaterThan(0);
          expect(x).toBeLessThan(1);
        }
      }
      if (f.tailplane) {
        const { y, span, chord, height } = f.tailplane;
        for (const v of [y, span, chord, height]) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThan(0);
        }
        expect(y).toBeLessThanOrEqual(1);
        expect(span).toBeLessThanOrEqual(1);
      }
      if (f.fuselage) {
        const { nose, tail, radius } = f.fuselage;
        for (const v of [nose, tail, radius]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(nose).toBeGreaterThanOrEqual(0);
        expect(tail, `${name} fuselage tail before nose`).toBeGreaterThan(nose);
        expect(tail).toBeLessThanOrEqual(1);
        expect(radius).toBeGreaterThan(0);
        expect(radius).toBeLessThanOrEqual(0.15);
      }
      if (f.planformClip) {
        expect(f.planformClip.y0).toBeGreaterThanOrEqual(0);
        expect(f.planformClip.y1).toBeGreaterThan(f.planformClip.y0);
        expect(f.planformClip.y1).toBeLessThanOrEqual(1);
        // A clip must be replacing something raised (T-tail box or rotor
        // blades), else it just amputates part of the silhouette.
        expect(
          f.tailplane ?? f.rotors,
          'planformClip requires tailplane or rotors'
        ).toBeDefined();
      }
      for (const ro of f.rotors ?? []) {
        expect(ro.y).toBeGreaterThanOrEqual(0);
        expect(ro.y).toBeLessThanOrEqual(1);
        expect(ro.radius).toBeGreaterThan(0);
        expect(ro.radius).toBeLessThanOrEqual(0.5);
        for (const deg of ro.angles ?? []) {
          expect(deg).toBeGreaterThanOrEqual(0);
          expect(deg).toBeLessThan(180);
        }
      }
      for (const e of f.engines ?? []) {
        expect(e.x).toBeGreaterThan(0);
        expect(e.x).toBeLessThan(1);
        expect(e.y).toBeGreaterThanOrEqual(0);
        expect(e.y).toBeLessThanOrEqual(1);
        expect(e.length).toBeGreaterThan(0);
        expect(e.length).toBeLessThanOrEqual(0.3);
        expect(e.radius).toBeGreaterThan(0);
        expect(e.radius).toBeLessThanOrEqual(0.1);
        if (e.drop !== undefined) {
          expect(Math.abs(e.drop)).toBeLessThanOrEqual(0.5);
        }
      }
    });

    it(`${name} engines are symmetric about the centerline`, () => {
      const engines = f.engines ?? [];
      for (const e of engines) {
        if (Math.abs(e.x - 0.5) < 1e-6) continue;
        const mate = engines.find((m) => Math.abs(m.x - (1 - e.x)) < 1e-6);
        expect(mate, `${name} engine at x=${e.x} has no mirror mate`).toBeDefined();
      }
    });

    it(`${name} twin fins are symmetric about the centerline`, () => {
      const fins = f.fins ?? [];
      for (const fin of fins) {
        const x = fin.x ?? 0.5;
        expect(x, `${name} twin fin must be off centerline`).not.toBeCloseTo(0.5, 5);
        const mate = fins.find((m) => Math.abs((m.x ?? 0.5) - (1 - x)) < 1e-6);
        expect(mate, `${name} fin at x=${x} has no mirror mate`).toBeDefined();
      }
    });
  }
});

describe('feature part construction', () => {
  for (const [name, f] of Object.entries(SHAPE_FEATURES)) {
    it(`${name} parts have the expected triangle counts`, () => {
      const def = getShapeDef(name)!;
      const [minX = 0, minY = 0, vbW = 0, vbH = 0] = def.viewBox.split(/[\s,]+/).map(Number);
      const parts = buildFeatureParts(name, f, minX, minY, vbW, vbH, vbH * 0.1);
      const tris = parts.reduce((sum, p) => sum + triangleCount(p), 0);
      expect(tris).toBe(expectedTris(name, f));
      expect(tris).toBeLessThanOrEqual(MAX_FEATURE_TRIS);
    });
  }
});

describe('merged geometry', () => {
  for (const name of Object.keys(SHAPE_FEATURES)) {
    it(`${name} builds a merged silhouette`, () => {
      const geom = getSilhouetteGeometry(name);
      expect(geom, name).not.toBeNull();
      // Merge output must stay non-indexed (ExtrudeGeometry convention).
      expect(geom!.index).toBeNull();
      expect(geom!.boundingSphere).not.toBeNull();
      expect(geom!.boundingSphere!.radius).toBeGreaterThan(0);
    });
  }

  it('a malformed annotation degrades to the bare silhouette, not the cone', () => {
    // Inject a broken entry for a shape no other test has built (the
    // geometry cache is per name, so it must be untouched so far), then
    // make sure the shape still gets a geometry — the inner try/catch in
    // build() must keep feature errors away from the negative cache.
    const victim = 'glider';
    expect(SHAPE_FEATURES[victim]).toBeUndefined();
    SHAPE_FEATURES[victim] = { engines: [null] as unknown as EngineFeature[] };
    try {
      const geom = getSilhouetteGeometry(victim);
      expect(geom).not.toBeNull();
      expect(geom!.boundingSphere!.radius).toBeGreaterThan(0);
    } finally {
      delete SHAPE_FEATURES[victim];
    }
  });
});
