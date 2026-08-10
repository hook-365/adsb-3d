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
  /** Twin (or more) vertical stabilizers — twin-boom warbirds (A-10),
   *  twin-tail fighters (F/A-18, F-15, F-35) and twin-finned transports
   *  (An-225). Coexists with `fin` only in principle; every current entry
   *  uses one or the other. Each entry's `x` is required (no centerline
   *  default makes sense for a twin), so author one side and mirror it
   *  with `mirrorFins()` rather than hand-duplicating the pair. */
  fins?: FinFeature[];
  tailplane?: TailplaneFeature;
  engines?: EngineFeature[];
  fuselage?: FuselageFeature;
  rotors?: RotorFeature[];
  /** Small crossed rotor pair standing vertically beside the tail boom.
   *  Fractions: y of viewBox height, radius and x-offset of viewBox width. */
  tailRotor?: { y: number; radius: number; x?: number };
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

/** Mirror twin-tail fins across the centerline: author one side (x < 0.5
 *  or > 0.5) and get its mate at 1 - x for free, same convention as
 *  `mirror()` for engines. A fin authored on the centerline (x = 0.5)
 *  would collapse onto its own mate, so that's a caller error. */
function mirrorFins(fins: FinFeature[]): FinFeature[] {
  const out: FinFeature[] = [];
  for (const f of fins) {
    const x = f.x ?? 0.5;
    if (Math.abs(x - 0.5) < 1e-6) throw new Error('mirrorFins: fin x must be off centerline');
    out.push(f, { ...f, x: 1 - x });
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
  // Fin pass for the rest of the fixed-wing catalog. Fuselage dimensions
  // were auto-measured (see below); fin placement is hand-judged from
  // fraction-grid renders of each planform plus type knowledge, since the
  // fin itself is vertical and never shows in the drawing — only its
  // footprint (a T-tail's tailplane, a twin-boom's horizontal stab) does.
  // Engines are left as the drawn flat planform (optional polish, not
  // required for tail coverage).
  //
  // Twin fins (a10, f18, md_f15, lancaster, f35, a225): root x read off
  // the tips of the drawn horizontal stabilizer/boom structure, mirrored
  // with mirrorFins().
  a10: {
    // Twin-boom Warthog: horizontal stabilizer box measured at x
    // [0.335, 0.665], y [0.855, 0.905] — fins sit at the boom tips.
    fuselage: { nose: 0.06, tail: 0.94, radius: 0.041 },
    fins: mirrorFins([{ x: 0.335, y: 0.83, rootChord: 0.1, tipChord: 0.06, height: 0.12, sweep: 0.02 }]),
  },
  // An-225: twin fins added (over the An-124 baseline) for stability with
  // the Buran orbiter on the spine — tip nubs visible on the drawn
  // tailplane at x ~ [0.24, 0.76].
  a225: {
    fuselage: { nose: 0.06, tail: 0.89, radius: 0.045 },
    fins: mirrorFins([{ x: 0.24, y: 0.76, rootChord: 0.1, tipChord: 0.05, height: 0.12, sweep: 0.04 }]),
  },
  // A400M is a real T-tail, but only c5/il_62 get the planformClip
  // treatment here — a tall single fin rising from the drawn tailplane is
  // close enough at marker scale.
  a400: {
    fuselage: { nose: 0.05, tail: 0.91, radius: 0.058 },
    fin: { y: 0.75, rootChord: 0.13, tipChord: 0.06, height: 0.15, sweep: 0.06 },
  },
  alpha_jet: {
    fuselage: { nose: 0.14, tail: 0.84, radius: 0.037 },
    fin: { y: 0.68, rootChord: 0.11, tipChord: 0.05, height: 0.11, sweep: 0.05 },
  },
  b1b_lancer: {
    fuselage: { nose: 0.04, tail: 0.89, radius: 0.037 },
    fin: { y: 0.72, rootChord: 0.12, tipChord: 0.05, height: 0.13, sweep: 0.06 },
  },
  b52: {
    fuselage: { nose: 0.18, tail: 0.82, radius: 0.024 },
    fin: { y: 0.68, rootChord: 0.11, tipChord: 0.05, height: 0.14, sweep: 0.06 },
  },
  bae_hawk: {
    fuselage: { nose: 0.17, tail: 0.72, radius: 0.026 },
    fin: { y: 0.58, rootChord: 0.1, tipChord: 0.05, height: 0.09, sweep: 0.04 },
  },
  // C-130 Hercules: full treatment — tall fin and four turboprops.
  c130: {
    fuselage: { nose: 0.27, tail: 0.79, radius: 0.054 },
    fin: { y: 0.66, rootChord: 0.13, tipChord: 0.06, height: 0.13, sweep: 0.05 },
    engines: mirror([
      { x: 0.39, y: 0.42, length: 0.11, radius: 0.024 },
      { x: 0.27, y: 0.43, length: 0.1, radius: 0.022 },
    ]),
  },
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
  // C-5 Galaxy: real T-tail, same pattern as c17 — clip the drawn
  // body-level stabilizer out of the slab and raise it, overlapping the
  // fin tip. Band measured off the drawing: swept tailplane sits at
  // y [0.885, 0.965], x [0.2, 0.8].
  c5: {
    fuselage: { nose: 0.05, tail: 0.97, radius: 0.05 },
    fin: { y: 0.83, rootChord: 0.14, tipChord: 0.06, height: 0.16, sweep: 0.07 },
    planformClip: { y0: 0.885, y1: 0.965 },
    tailplane: { y: 0.895, span: 0.6, chord: 0.06, height: 0.157 },
  },
  e390: {
    fuselage: { nose: 0.03, tail: 0.96, radius: 0.067 },
    fin: { y: 0.85, rootChord: 0.13, tipChord: 0.06, height: 0.12, sweep: 0.06 },
  },
  e3awacs: {
    fuselage: { nose: 0.08, tail: 0.92, radius: 0.045 },
    fin: { y: 0.76, rootChord: 0.13, tipChord: 0.05, height: 0.12, sweep: 0.07 },
  },
  e737: {
    fuselage: { nose: 0.03, tail: 0.95, radius: 0.058 },
    fin: { y: 0.82, rootChord: 0.14, tipChord: 0.06, height: 0.12, sweep: 0.06 },
  },
  // F/A-18: canted twin tails mounted over the LEX/wing junction, well
  // forward of the tail tip — x tips read off the drawn stabilator waist.
  f18: {
    fuselage: { nose: 0.06, tail: 0.91, radius: 0.08 },
    fins: mirrorFins([{ x: 0.37, y: 0.6, rootChord: 0.13, tipChord: 0.05, height: 0.11, sweep: 0.09 }]),
  },
  // F-35: twin tails too, but closely spaced compared to F/A-18 — real
  // Lightning II tails sit close together over the boat-tail.
  f35: {
    fuselage: { nose: 0.05, tail: 0.68, radius: 0.088 },
    fins: mirrorFins([{ x: 0.38, y: 0.55, rootChord: 0.11, tipChord: 0.05, height: 0.1, sweep: 0.06 }]),
  },
  f5_tiger: {
    fuselage: { nose: 0.13, tail: 0.91, radius: 0.032 },
    fin: { y: 0.62, rootChord: 0.13, tipChord: 0.06, height: 0.12, sweep: 0.06 },
  },
  hunter: {
    fuselage: { nose: 0.1, tail: 0.92, radius: 0.045 },
    fin: { y: 0.68, rootChord: 0.13, tipChord: 0.06, height: 0.11, sweep: 0.05 },
  },
  // Il-62: real T-tail, same treatment as c5/c17. Rear-mounted engine pods
  // (drawn separately, untouched) end around y 0.84; the swept tailplane
  // band runs y [0.875, 0.965], x [0.22, 0.78].
  il_62: {
    fuselage: { nose: 0.07, tail: 0.95, radius: 0.037 },
    fin: { y: 0.78, rootChord: 0.14, tipChord: 0.06, height: 0.17, sweep: 0.08 },
    planformClip: { y0: 0.875, y1: 0.965 },
    tailplane: { y: 0.885, span: 0.56, chord: 0.07, height: 0.167 },
  },
  l159: {
    fuselage: { nose: 0.04, tail: 0.79, radius: 0.041 },
    fin: { y: 0.62, rootChord: 0.11, tipChord: 0.05, height: 0.1, sweep: 0.04 },
  },
  // Lancaster: twin oval fins at the tailplane tips, x read off the drawn
  // horizontal-stab bar at x [0.3, 0.7].
  lancaster: {
    fuselage: { nose: 0.28, tail: 0.88, radius: 0.028 },
    fins: mirrorFins([{ x: 0.3, y: 0.78, rootChord: 0.09, tipChord: 0.07, height: 0.09, sweep: 0.02 }]),
  },
  m326: {
    fuselage: { nose: 0.08, tail: 0.92, radius: 0.045 },
    fin: { y: 0.72, rootChord: 0.11, tipChord: 0.05, height: 0.09, sweep: 0.03 },
  },
  md_a4: {
    fuselage: { nose: 0.04, tail: 0.87, radius: 0.041 },
    fin: { y: 0.68, rootChord: 0.12, tipChord: 0.06, height: 0.1, sweep: 0.05 },
  },
  // F-15: twin fins on outward booms above the engine nacelles.
  md_f15: {
    fuselage: { nose: 0.07, tail: 0.82, radius: 0.026 },
    fins: mirrorFins([{ x: 0.27, y: 0.64, rootChord: 0.13, tipChord: 0.06, height: 0.13, sweep: 0.06 }]),
  },
  // Deltas (mirage, rafale): modest fin at the tail — the real aircraft's
  // fin is short relative to a swept-wing jet's.
  mirage: {
    fuselage: { nose: 0.07, tail: 0.83, radius: 0.028 },
    fin: { y: 0.68, rootChord: 0.09, tipChord: 0.05, height: 0.09, sweep: 0.04 },
  },
  miragef1: {
    fuselage: { nose: 0.06, tail: 0.92, radius: 0.025 },
    fin: { y: 0.75, rootChord: 0.11, tipChord: 0.05, height: 0.11, sweep: 0.05 },
  },
  p3_orion: {
    fuselage: { nose: 0.03, tail: 0.97, radius: 0.062 },
    fin: { y: 0.85, rootChord: 0.13, tipChord: 0.06, height: 0.13, sweep: 0.05 },
  },
  p8: {
    fuselage: { nose: 0.02, tail: 0.95, radius: 0.054 },
    fin: { y: 0.85, rootChord: 0.13, tipChord: 0.06, height: 0.12, sweep: 0.06 },
  },
  // Blended delta: the auto-measure mode lands on the refueling probe, so
  // the body radius is hand-set to match the mirage-class deltas.
  rafale: {
    fuselage: { nose: 0.13, tail: 0.9, radius: 0.03 },
    fin: { y: 0.72, rootChord: 0.09, tipChord: 0.05, height: 0.09, sweep: 0.04 },
  },
  beluga: {
    fuselage: { nose: 0.05, tail: 0.95, radius: 0.067 },
    fin: { y: 0.77, rootChord: 0.13, tipChord: 0.06, height: 0.15, sweep: 0.06 },
  },
  // VariEze canard: main wing (with tip fins) is aft, near the pusher
  // prop — small twin winglet fins at the wingtips, well forward of the
  // tail. Kept deliberately small: real VariEze wingtip fins are winglets,
  // not a dominant tail surface.
  rutan_veze: {
    fuselage: { nose: 0.23, tail: 0.62, radius: 0.032 },
    fins: mirrorFins([{ x: 0.15, y: 0.4, rootChord: 0.045, tipChord: 0.03, height: 0.055, sweep: 0.015 }]),
  },
  sb39: {
    fuselage: { nose: 0.05, tail: 0.86, radius: 0.029 },
    fin: { y: 0.66, rootChord: 0.1, tipChord: 0.05, height: 0.1, sweep: 0.05 },
  },
  super_guppy: {
    fuselage: { nose: 0.12, tail: 0.92, radius: 0.088 },
    fin: { y: 0.8, rootChord: 0.13, tipChord: 0.06, height: 0.14, sweep: 0.05 },
  },
  t38: {
    fuselage: { nose: 0.09, tail: 0.92, radius: 0.037 },
    fin: { y: 0.72, rootChord: 0.11, tipChord: 0.05, height: 0.1, sweep: 0.05 },
  },
  tornado: {
    fuselage: { nose: 0.1, tail: 0.93, radius: 0.09 },
    fin: { y: 0.72, rootChord: 0.12, tipChord: 0.05, height: 0.11, sweep: 0.06 },
  },
  typhoon: {
    fuselage: { nose: 0.06, tail: 0.88, radius: 0.058 },
    fin: { y: 0.68, rootChord: 0.12, tipChord: 0.06, height: 0.12, sweep: 0.07 },
  },
  u2: {
    fuselage: { nose: 0.23, tail: 0.8, radius: 0.02 },
    fin: { y: 0.68, rootChord: 0.09, tipChord: 0.04, height: 0.12, sweep: 0.04 },
  },
  wb57: {
    fuselage: { nose: 0.27, tail: 0.79, radius: 0.024 },
    fin: { y: 0.64, rootChord: 0.1, tipChord: 0.05, height: 0.11, sweep: 0.04 },
  },

  // ---------------------------------------------------------------------
  // Rotorcraft: lofted cabin-and-boom fuselage plus a raised four-blade
  // rotor (two for the tandem Chinook). The drawn blades are clipped out
  // of the slab entirely (the tube carries the cabin through the band), so
  // the raised X is the only rotor — stacking both read as an eight-blade
  // mess. Bodies and rotor spans were auto-measured from the drawings.
  apache: {
    fuselage: { nose: 0.25, tail: 0.84, radius: 0.075 },
    planformClip: { y0: 0.17, y1: 0.68 },
    rotors: [{ y: 0.43, radius: 0.211 }],
    tailRotor: { y: 0.8, radius: 0.06 },
  },
  blackhawk: {
    fuselage: { nose: 0.12, tail: 0.94, radius: 0.068 },
    planformClip: { y0: 0.02, y1: 0.71 },
    rotors: [{ y: 0.36, radius: 0.228 }],
    tailRotor: { y: 0.9, radius: 0.065 },
  },
  chinook: {
    fuselage: { nose: 0.24, tail: 0.74, radius: 0.065 },
    planformClip: { y0: 0.02, y1: 0.95 },
    rotors: [{ y: 0.3, radius: 0.168 }, { y: 0.68, radius: 0.168 }],
  },
  dauphin: {
    fuselage: { nose: 0.09, tail: 0.94, radius: 0.075 },
    planformClip: { y0: 0.07, y1: 0.7 },
    rotors: [{ y: 0.39, radius: 0.29 }],
    tailRotor: { y: 0.9, radius: 0.08 },
  },
  gazelle: {
    fuselage: { nose: 0.21, tail: 0.91, radius: 0.074 },
    planformClip: { y0: 0.06, y1: 0.79 },
    rotors: [{ y: 0.41, radius: 0.231 }],
    tailRotor: { y: 0.87, radius: 0.065 },
  },
  helicopter: {
    fuselage: { nose: 0.3, tail: 0.94, radius: 0.059 },
    planformClip: { y0: 0.25, y1: 0.74 },
    rotors: [{ y: 0.5, radius: 0.222 }],
    tailRotor: { y: 0.88, radius: 0.065 },
  },
  mil24: {
    fuselage: { nose: 0.13, tail: 0.93, radius: 0.046 },
    planformClip: { y0: 0.07, y1: 0.65 },
    rotors: [{ y: 0.4, radius: 0.253 }],
    tailRotor: { y: 0.89, radius: 0.07 },
  },
  puma: {
    fuselage: { nose: 0.13, tail: 0.89, radius: 0.058 },
    planformClip: { y0: 0.06, y1: 0.65 },
    rotors: [{ y: 0.35, radius: 0.266 }],
    tailRotor: { y: 0.85, radius: 0.075 },
  },
  s61: {
    fuselage: { nose: 0.22, tail: 0.83, radius: 0.056 },
    planformClip: { y0: 0.02, y1: 0.66 },
    rotors: [{ y: 0.38, radius: 0.279 }],
    tailRotor: { y: 0.79, radius: 0.078 },
  },
  // Eurocopter Tiger (TIGR): attack helicopter with stub-wing weapon
  // pylons, otherwise the same cabin/rotor/tail-rotor treatment as the
  // rest of the block. Was previously mis-bucketed as a fuselage-only
  // fixed-wing entry — its drawing is a rotor cross, not a planform.
  tiger: {
    fuselage: { nose: 0.08, tail: 0.88, radius: 0.065 },
    planformClip: { y0: 0.03, y1: 0.78 },
    rotors: [{ y: 0.3, radius: 0.26 }],
    tailRotor: { y: 0.88, radius: 0.06 },
  },
};

/** Feature annotations for a shape, or null if the shape is unannotated
 *  (it keeps the plain extrusion). */
export function getShapeFeatures(shapeName: string): ShapeFeatures | null {
  return SHAPE_FEATURES[shapeName] ?? null;
}
