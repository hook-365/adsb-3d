import { CanvasTexture, LinearFilter } from 'three';
import shapesDataJson from './shapes-data.json';

// Aircraft shape catalog vendored from tar1090 (GPL v2+).
// Source: https://github.com/wiedehopf/tar1090, html/markers.js
// We use four data blocks: the SVG shape table, the ICAO type → shape
// mapping, the type-description (e.g. "L2J-M") → shape mapping, and the
// ADS-B emitter category → shape mapping. The resolver below mirrors a
// trimmed version of tar1090's getBaseMarker() — no halloween, no AIS,
// no ATC mode, no square mania.

export interface ShapeDef {
  w: number;
  h: number;
  viewBox: string;
  strokeScale?: number;
  // Most shapes have a single `d` path string; a few (gyrocopter, etc.)
  // are multi-path arrays that draw multiple subpaths with the same fill.
  path: string | string[];
  accent?: string | string[];
  accentMult?: number;
  noRotate?: boolean;
}
type IconRef = readonly [shape: string, scaling: number];

const data = shapesDataJson as unknown as {
  shapes: Record<string, ShapeDef>;
  TypeDesignatorIcons: Record<string, IconRef>;
  TypeDescriptionIcons: Record<string, IconRef>;
  CategoryIcons: Record<string, IconRef>;
};

const FALLBACK: IconRef = ['airliner', 1];

/**
 * Resolve an aircraft to a (shape name, scaling) pair following tar1090's
 * lookup order: explicit type designator → type description (+wtc) → emitter
 * category → fallback airliner.
 */
export function resolveShape(
  category: string | null | undefined,
  typeDesignator: string | null | undefined,
  typeDescription: string | null | undefined
): IconRef {
  if (typeDesignator && typeDesignator in data.TypeDesignatorIcons) {
    return data.TypeDesignatorIcons[typeDesignator]!;
  }
  if (typeDescription && typeDescription.length === 3) {
    // tar1090 also keys by `${desc}-${wtc}` but we don't have wtc
    // in our normalized aircraft. The plain 3-letter form covers the
    // common cases; airliner fallback handles the rest.
    if (typeDescription in data.TypeDescriptionIcons) {
      return data.TypeDescriptionIcons[typeDescription]!;
    }
  }
  if (category && category in data.CategoryIcons) {
    return data.CategoryIcons[category]!;
  }
  return FALLBACK;
}

// Per-shape texture cache. Each shape rasterizes once at white fill +
// black stroke; per-aircraft tinting happens via material.color multiply.
interface CachedTexture {
  texture: CanvasTexture;
  // Aspect ratio of the rasterized icon — used to size the plane mesh
  // so the SVG isn't squashed. 1 = square, >1 = wider than tall.
  aspect: number;
}

const textureCache = new Map<string, CachedTexture>();

const RASTER_PX = 128;

function buildSvg(def: ShapeDef): string {
  // Render with white fill + black stroke. The stroke width is given in
  // the source viewBox's units (strokeScale is what tar1090 uses); we
  // apply it directly so outlines stay visible after the canvas resamples
  // the bitmap down to texture size.
  const stroke = def.strokeScale ?? 1;
  const mainPaths = Array.isArray(def.path) ? def.path : [def.path];
  const mainPathTags = mainPaths.map(
    (d) => `<path d="${d}" fill="#fff" stroke="#000" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>`
  );
  const accentPaths: string[] = [];
  if (def.accent) {
    const acc = Array.isArray(def.accent) ? def.accent : [def.accent];
    for (const a of acc) {
      accentPaths.push(`<path d="${a}" fill="#000" stroke="none"/>`);
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${def.viewBox}">`,
    ...mainPathTags,
    ...accentPaths,
    `</svg>`,
  ].join('');
}

/**
 * Rasterize an SVG shape into a CanvasTexture, caching the result. The
 * texture is rendered with white fill + black stroke so a Three material's
 * `color` can tint it via RGB multiply (black stroke stays black, white
 * interior takes the tint).
 *
 * Returns `null` synchronously if the shape isn't in the catalog.
 */
export function getShapeTexture(shapeName: string): CachedTexture | null {
  const cached = textureCache.get(shapeName);
  if (cached) return cached;

  const def = data.shapes[shapeName];
  if (!def) return null;

  const aspect = def.w / def.h;
  // Keep the longer side at RASTER_PX so wide/tall shapes both rasterize
  // at full resolution. The plane mesh in reconciler.ts is sized using
  // `aspect` so the icon isn't squashed.
  const cw = aspect >= 1 ? RASTER_PX : Math.round(RASTER_PX * aspect);
  const ch = aspect >= 1 ? Math.round(RASTER_PX / aspect) : RASTER_PX;

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;

  const svgText = buildSvg(def);
  const blob = new Blob([svgText], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  // Stop the texture from interpolating beyond the canvas edges, which
  // would smear black stroke into transparent space.
  texture.generateMipmaps = false;

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    URL.revokeObjectURL(url);
    texture.needsUpdate = true;
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
  };
  img.src = url;

  const entry = { texture, aspect };
  textureCache.set(shapeName, entry);
  return entry;
}

/** True if tar1090 marks this shape as non-rotatable (e.g. balloon, tower). */
export function shapeRotates(shapeName: string): boolean {
  return !data.shapes[shapeName]?.noRotate;
}

/** Raw catalog entry for a shape, or null if unknown. Consumed by
 *  shape-geometry.ts to extrude the SVG outline into a 3D marker. */
export function getShapeDef(shapeName: string): ShapeDef | null {
  return data.shapes[shapeName] ?? null;
}
