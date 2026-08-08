// Hand-authored 3D feature annotations for the extruded silhouette markers.
// The planform extrusion in shape-geometry.ts already carries wings, fuselage
// and (conventional) tailplanes — what it can't express is anything vertical:
// tail fins and the round of engine nacelles. Each entry here describes those
// features for one tar1090 shape so shape-geometry.ts can build them
// procedurally and merge them into the shared per-shape geometry.
//
// Coordinate convention: every field is a fraction of the shape's own
// viewBox. x-fields are fractions of the viewBox width (0.5 = centerline);
// y/length/height/chord/radius fields are fractions of the viewBox height
// (0 = nose, 1 = tail). Fractions were read off the actual silhouettes, so
// nacelles land on the engines drawn in the planform. Because thickness and
// height ride the same length scale as the body extrusion, features stay
// proportional under the non-uniform wingspan-vs-length marker scaling.
//
// Shapes without an entry keep the plain extrusion — this table is additive
// and deliberately covers only the shapes that show up on a typical feed.

/** Vertical stabilizer: a swept trapezoid standing on the fuselage spine. */
export interface FinFeature {
  /** Root leading edge, fraction of length from the nose. */
  y: number;
  /** Root chord length. */
  rootChord: number;
  /** Tip chord length; must not exceed rootChord. */
  tipChord: number;
  /** Height above the fuselage top. */
  height: number;
  /** Aft shift of the tip relative to the root leading edge. */
  sweep: number;
  /** Lateral position; defaults to the centerline (0.5). */
  x?: number;
}

/** Raised horizontal stabilizer (T-tails only — conventional tailplanes
 *  are already part of the extruded planform). */
export interface TailplaneFeature {
  /** Leading edge, fraction of length from the nose. */
  y: number;
  /** Total span, fraction of viewBox width. */
  span: number;
  /** Chord length. */
  chord: number;
  /** Mounting height above the fuselage top. */
  height: number;
}

/** Engine nacelle: a stubby cylinder slung on the wing (or tail). */
export interface EngineFeature {
  /** Lateral position, fraction of viewBox width. */
  x: number;
  /** Nacelle center, fraction of length from the nose. */
  y: number;
  /** Nacelle length. */
  length: number;
  /** Nacelle radius. */
  radius: number;
  /** Vertical offset of the nacelle center from the body's underside;
   *  positive hangs lower, negative lifts it (MD-11 tail engine). */
  drop?: number;
}

/** Fuselage tube: a tapered low-poly body along the centerline. Shapes
 *  with one get a thinner planform slab, so wings read as surfaces while
 *  the fuselage reads as a volume — without this the whole aircraft is
 *  one uniform plank. */
export interface FuselageFeature {
  /** Nose tip, fraction of length from the top of the drawing. */
  nose: number;
  /** Tail end; must be greater than nose. */
  tail: number;
  /** Half-width of the drawn fuselage, fraction of viewBox WIDTH (unlike
   *  every other radius here) so it can be read straight off the planform. */
  radius: number;
}

/** Rotor: thin crossed blade boxes on a short mast above the cabin.
 *  Static — at marker scale a rotor is caught mid-turn, and the blades sit
 *  directly over the ones in the drawing so the two read as one rotor. */
export interface RotorFeature {
  /** Hub center along the length, fraction of viewBox height. */
  y: number;
  /** Blade radius, fraction of viewBox WIDTH (like fuselage.radius, it is
   *  read straight off the drawn blade span). */
  radius: number;
  /** Lateral position; defaults to the centerline (0.5). */
  x?: number;
  /** Blade-line orientations in degrees (0 = spanwise, 90 = along the
   *  fuselage), matching the shape's drawn blades. Default is a 45/135 X. */
  angles?: number[];
}

export interface ShapeFeatures {
  fin?: FinFeature;
  tailplane?: TailplaneFeature;
  engines?: EngineFeature[];
  fuselage?: FuselageFeature;
  rotors?: RotorFeature[];
  /** Remove a horizontal band of the planform slab before extrusion
   *  (fractions of length). Used with `tailplane` on T-tails: the drawing
   *  always includes a body-level stabilizer, and without cutting it out a
   *  raised one would double it. The fuselage strip removed with it is
   *  hidden inside the tube. */
  planformClip?: { y0: number; y1: number };
}

/** Mirror wing-mounted engines across the centerline: entries left of
 *  center (x < 0.5) get a mate at 1 - x, so a twin is authored as one
 *  engine and symmetry is guaranteed by construction. Centerline engines
 *  (x = 0.5) stay single. */
function mirror(engines: EngineFeature[]): EngineFeature[] {
  const out: EngineFeature[] = [];
  for (const e of engines) {
    out.push(e);
    if (Math.abs(e.x - 0.5) > 1e-6) out.push({ ...e, x: 1 - e.x });
  }
  return out;
}

// Family bases. Fractions are of each variant's own viewBox, and stretched
// variants change the viewBox height (a320 415 vs a321 485), so variants
// override the length-fraction fields where the drawing differs.
const A32X: ShapeFeatures = {
  fuselage: { nose: 0.02, tail: 0.99, radius: 0.062 },
  fin: { y: 0.79, rootChord: 0.14, tipChord: 0.06, height: 0.12, sweep: 0.06 },
  engines: mirror([{ x: 0.35, y: 0.37, length: 0.13, radius: 0.032 }]),
};
const B73X: ShapeFeatures = {
  fuselage: { nose: 0.02, tail: 0.99, radius: 0.058 },
  fin: { y: 0.8, rootChord: 0.14, tipChord: 0.06, height: 0.12, sweep: 0.06 },
  engines: mirror([{ x: 0.36, y: 0.36, length: 0.12, radius: 0.032 }]),
};

export const SHAPE_FEATURES: Record<string, ShapeFeatures> = {
  // The resolver fallback — anything without a type match renders this.
  airliner: {
    fuselage: { nose: 0.08, tail: 0.97, radius: 0.054 },
    fin: { y: 0.8, rootChord: 0.14, tipChord: 0.06, height: 0.12, sweep: 0.06 },
    engines: mirror([{ x: 0.36, y: 0.38, length: 0.12, radius: 0.03 }]),
  },

  a319: A32X,
  a320: {
    ...A32X,
    fin: { ...A32X.fin!, y: 0.81 },
    engines: mirror([{ x: 0.35, y: 0.36, length: 0.13, radius: 0.032 }]),
  },
  a321: {
    ...A32X,
    fin: { ...A32X.fin!, y: 0.83 },
    engines: mirror([{ x: 0.33, y: 0.4, length: 0.12, radius: 0.03 }]),
  },

  a332: {
    fuselage: { nose: 0.03, tail: 0.99, radius: 0.05 },
    fin: { y: 0.79, rootChord: 0.15, tipChord: 0.06, height: 0.13, sweep: 0.07 },
    engines: mirror([{ x: 0.36, y: 0.35, length: 0.14, radius: 0.04 }]),
  },
  a359: {
    fuselage: { nose: 0.03, tail: 0.98, radius: 0.05 },
    fin: { y: 0.81, rootChord: 0.14, tipChord: 0.06, height: 0.13, sweep: 0.07 },
    engines: mirror([{ x: 0.35, y: 0.39, length: 0.13, radius: 0.04 }]),
  },
  a380: {
    fuselage: { nose: 0.13, tail: 0.84, radius: 0.06 },
    fin: { y: 0.69, rootChord: 0.14, tipChord: 0.06, height: 0.14, sweep: 0.06 },
    engines: mirror([
      { x: 0.36, y: 0.36, length: 0.12, radius: 0.035 },
      { x: 0.22, y: 0.46, length: 0.11, radius: 0.033 },
    ]),
  },

  b737: B73X,
  b738: {
    ...B73X,
    fin: { ...B73X.fin!, y: 0.82 },
    engines: mirror([{ x: 0.36, y: 0.37, length: 0.12, radius: 0.032 }]),
  },
  b739: {
    ...B73X,
    fin: { ...B73X.fin!, y: 0.83 },
    engines: mirror([{ x: 0.37, y: 0.37, length: 0.11, radius: 0.03 }]),
  },

  b707: {
    fuselage: { nose: 0.1, tail: 0.91, radius: 0.045 },
    fin: { y: 0.76, rootChord: 0.13, tipChord: 0.05, height: 0.12, sweep: 0.07 },
    engines: mirror([
      { x: 0.33, y: 0.38, length: 0.11, radius: 0.028 },
      { x: 0.2, y: 0.45, length: 0.1, radius: 0.026 },
    ]),
  },
  heavy_2e: {
    fuselage: { nose: 0.09, tail: 0.95, radius: 0.044 },
    fin: { y: 0.78, rootChord: 0.14, tipChord: 0.06, height: 0.12, sweep: 0.06 },
    engines: mirror([{ x: 0.37, y: 0.4, length: 0.12, radius: 0.035 }]),
  },
  heavy_4e: {
    fuselage: { nose: 0.1, tail: 0.93, radius: 0.046 },
    fin: { y: 0.78, rootChord: 0.14, tipChord: 0.06, height: 0.12, sweep: 0.07 },
    engines: mirror([
      { x: 0.35, y: 0.41, length: 0.12, radius: 0.032 },
      { x: 0.2, y: 0.5, length: 0.11, radius: 0.03 },
    ]),
  },
  md11: {
    fuselage: { nose: 0.08, tail: 0.97, radius: 0.05 },
    fin: { y: 0.76, rootChord: 0.13, tipChord: 0.06, height: 0.12, sweep: 0.06 },
    engines: mirror([
      { x: 0.36, y: 0.43, length: 0.11, radius: 0.034 },
      // #2 engine at the fin root, lifted onto the fuselage tube's spine.
      { x: 0.5, y: 0.87, length: 0.1, radius: 0.03, drop: -0.09 },
    ]),
  },

  // Bizjets / regional jets: tail-mounted pods drawn in the planform get
  // real cylinders lifted to fuselage-flank height (negative drop), else
  // they read as flat slabs from behind.
  jet_swept: {
    fuselage: { nose: 0.06, tail: 0.97, radius: 0.071 },
    fin: { y: 0.84, rootChord: 0.13, tipChord: 0.06, height: 0.11, sweep: 0.06 },
    engines: mirror([{ x: 0.41, y: 0.71, length: 0.16, radius: 0.028, drop: -0.03 }]),
  },
  jet_nonswept: {
    fuselage: { nose: 0.1, tail: 0.93, radius: 0.058 },
    fin: { y: 0.76, rootChord: 0.14, tipChord: 0.07, height: 0.1, sweep: 0.03 },
    engines: mirror([{ x: 0.43, y: 0.66, length: 0.12, radius: 0.026, drop: -0.03 }]),
  },
  // Fighter: engines buried in the fuselage, fin only.
  hi_perf: { fuselage: { nose: 0.1, tail: 0.78, radius: 0.05 }, fin: { y: 0.6, rootChord: 0.14, tipChord: 0.05, height: 0.13, sweep: 0.07 } },

  // GA singles: nose engine is part of the planform, fin only.
  cessna: { fuselage: { nose: 0.28, tail: 0.85, radius: 0.046 }, fin: { y: 0.7, rootChord: 0.13, tipChord: 0.07, height: 0.09, sweep: 0.03 } },
  cirrus_sr22: { fuselage: { nose: 0.17, tail: 0.83, radius: 0.054 }, fin: { y: 0.7, rootChord: 0.11, tipChord: 0.05, height: 0.09, sweep: 0.04 } },
  pa24: { fuselage: { nose: 0.28, tail: 0.8, radius: 0.046 }, fin: { y: 0.68, rootChord: 0.1, tipChord: 0.05, height: 0.09, sweep: 0.04 } },
  single_turbo: { fuselage: { nose: 0.08, tail: 0.92, radius: 0.054 }, fin: { y: 0.78, rootChord: 0.12, tipChord: 0.06, height: 0.1, sweep: 0.05 } },

  // Piston/turboprop twins: the planform draws flat nacelles, the cylinders
  // give them their round.
  twin_small: {
    fuselage: { nose: 0.18, tail: 0.92, radius: 0.05 },
    fin: { y: 0.76, rootChord: 0.13, tipChord: 0.06, height: 0.09, sweep: 0.04 },
    engines: mirror([{ x: 0.34, y: 0.33, length: 0.14, radius: 0.035 }]),
  },
  twin_large: {
    fuselage: { nose: 0.1, tail: 0.93, radius: 0.054 },
    fin: { y: 0.74, rootChord: 0.14, tipChord: 0.06, height: 0.1, sweep: 0.05 },
    engines: mirror([{ x: 0.36, y: 0.42, length: 0.16, radius: 0.035 }]),
  },

  // ---------------------------------------------------------------------
  // Fuselage-only entries for the rest of the fixed-wing catalog, so every
  // aircraft body reads as a tube rather than a plank. Dimensions were
  // auto-measured by rasterizing each silhouette and scanning the
  // centerline fill (nose/tail = first/last filled row, radius = 25th
  // percentile run width, which excludes wing rows). No fins or engines:
  // placement on deltas, twin tails and prop types needs human judgement.
  // Deliberately absent: strato and verhees (twin-fuselage / flying wing —
  // a centerline tube is wrong for both), c2 (its drawing has no fill on
  // the centerline to measure), lighter-than-air, ground icons and novelty
  // shapes. Rotorcraft have their own block below.
  a10: { fuselage: { nose: 0.06, tail: 0.94, radius: 0.041 } },
  a225: { fuselage: { nose: 0.06, tail: 0.89, radius: 0.045 } },
  a400: { fuselage: { nose: 0.05, tail: 0.91, radius: 0.058 } },
  alpha_jet: { fuselage: { nose: 0.14, tail: 0.84, radius: 0.037 } },
  b1b_lancer: { fuselage: { nose: 0.04, tail: 0.89, radius: 0.037 } },
  b52: { fuselage: { nose: 0.18, tail: 0.82, radius: 0.024 } },
  bae_hawk: { fuselage: { nose: 0.17, tail: 0.72, radius: 0.026 } },
  c130: { fuselage: { nose: 0.27, tail: 0.79, radius: 0.054 } },
  // C-17 Globemaster: full treatment.
  c17: {
    fuselage: { nose: 0.17, tail: 0.87, radius: 0.054 },
    fin: { y: 0.63, rootChord: 0.16, tipChord: 0.08, height: 0.15, sweep: 0.08 },
    // Real T-tail: the drawn body-level stabilizer is clipped out of the
    // slab and replaced by the raised box, overlapping the fin tip so the
    // joint reads solid.
    planformClip: { y0: 0.77, y1: 0.91 },
    tailplane: { y: 0.755, span: 0.38, chord: 0.12, height: 0.147 },
    engines: mirror([
      { x: 0.4, y: 0.335, length: 0.1, radius: 0.028 },
      { x: 0.295, y: 0.4, length: 0.1, radius: 0.028 },
    ]),
  },
  c5: { fuselage: { nose: 0.05, tail: 0.97, radius: 0.05 } },
  e390: { fuselage: { nose: 0.03, tail: 0.96, radius: 0.067 } },
  e3awacs: { fuselage: { nose: 0.08, tail: 0.92, radius: 0.045 } },
  e737: { fuselage: { nose: 0.03, tail: 0.95, radius: 0.058 } },
  f18: { fuselage: { nose: 0.06, tail: 0.91, radius: 0.08 } },
  f35: { fuselage: { nose: 0.05, tail: 0.68, radius: 0.088 } },
  f5_tiger: { fuselage: { nose: 0.13, tail: 0.91, radius: 0.032 } },
  hunter: { fuselage: { nose: 0.1, tail: 0.92, radius: 0.045 } },
  il_62: { fuselage: { nose: 0.07, tail: 0.95, radius: 0.037 } },
  l159: { fuselage: { nose: 0.04, tail: 0.79, radius: 0.041 } },
  lancaster: { fuselage: { nose: 0.28, tail: 0.88, radius: 0.028 } },
  m326: { fuselage: { nose: 0.08, tail: 0.92, radius: 0.045 } },
  md_a4: { fuselage: { nose: 0.04, tail: 0.87, radius: 0.041 } },
  md_f15: { fuselage: { nose: 0.07, tail: 0.82, radius: 0.026 } },
  mirage: { fuselage: { nose: 0.07, tail: 0.83, radius: 0.028 } },
  miragef1: { fuselage: { nose: 0.06, tail: 0.92, radius: 0.025 } },
  p3_orion: { fuselage: { nose: 0.03, tail: 0.97, radius: 0.062 } },
  p8: { fuselage: { nose: 0.02, tail: 0.95, radius: 0.054 } },
  // Blended delta: the auto-measure mode lands on the refueling probe, so
  // the body radius is hand-set to match the mirage-class deltas.
  rafale: { fuselage: { nose: 0.13, tail: 0.9, radius: 0.03 } },
  beluga: { fuselage: { nose: 0.05, tail: 0.95, radius: 0.067 } },
  rutan_veze: { fuselage: { nose: 0.23, tail: 0.62, radius: 0.032 } },
  sb39: { fuselage: { nose: 0.05, tail: 0.86, radius: 0.029 } },
  super_guppy: { fuselage: { nose: 0.12, tail: 0.92, radius: 0.088 } },
  t38: { fuselage: { nose: 0.09, tail: 0.92, radius: 0.037 } },
  tiger: { fuselage: { nose: 0.09, tail: 0.93, radius: 0.041 } },
  tornado: { fuselage: { nose: 0.1, tail: 0.93, radius: 0.09 } },
  typhoon: { fuselage: { nose: 0.06, tail: 0.88, radius: 0.058 } },
  u2: { fuselage: { nose: 0.23, tail: 0.8, radius: 0.02 } },
  wb57: { fuselage: { nose: 0.27, tail: 0.79, radius: 0.024 } },

  // ---------------------------------------------------------------------
  // Rotorcraft: lofted cabin-and-boom fuselage plus a thin rotor disc
  // hovering above the cabin (two for the tandem Chinook). Bodies and
  // rotor spans were auto-measured from the drawings like the fixed-wing
  // sweep; the drawn blades stay in the thin slab beneath the disc.
  apache: {
    fuselage: { nose: 0.25, tail: 0.84, radius: 0.075 },
    rotors: [{ y: 0.43, radius: 0.211, angles: [80, 130] }],
  },
  blackhawk: {
    fuselage: { nose: 0.12, tail: 0.94, radius: 0.068 },
    rotors: [{ y: 0.36, radius: 0.228, angles: [60, 150] }],
  },
  chinook: {
    fuselage: { nose: 0.24, tail: 0.74, radius: 0.065 },
    rotors: [{ y: 0.3, radius: 0.168, angles: [70, 110, 170] }, { y: 0.68, radius: 0.168, angles: [50, 70, 110] }],
  },
  dauphin: {
    fuselage: { nose: 0.09, tail: 0.94, radius: 0.075 },
    rotors: [{ y: 0.39, radius: 0.29, angles: [45, 135] }],
  },
  gazelle: {
    fuselage: { nose: 0.21, tail: 0.91, radius: 0.074 },
    rotors: [{ y: 0.41, radius: 0.231, angles: [0, 60, 120] }],
  },
  helicopter: {
    fuselage: { nose: 0.3, tail: 0.94, radius: 0.059 },
    rotors: [{ y: 0.5, radius: 0.222, angles: [40, 130] }],
  },
  mil24: {
    fuselage: { nose: 0.13, tail: 0.93, radius: 0.046 },
    rotors: [{ y: 0.4, radius: 0.253, angles: [60, 145] }],
  },
  puma: {
    fuselage: { nose: 0.13, tail: 0.89, radius: 0.058 },
    rotors: [{ y: 0.35, radius: 0.266, angles: [45, 135] }],
  },
  s61: {
    fuselage: { nose: 0.22, tail: 0.83, radius: 0.056 },
    rotors: [{ y: 0.38, radius: 0.279, angles: [65, 150] }],
  },
};

/** Feature annotations for a shape, or null if the shape is unannotated
 *  (it keeps the plain extrusion). */
export function getShapeFeatures(shapeName: string): ShapeFeatures | null {
  return SHAPE_FEATURES[shapeName] ?? null;
}
