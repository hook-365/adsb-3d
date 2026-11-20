import {
  BackSide,
  BoxGeometry,
  Color,
  DataTexture,
  Data3DTexture,
  FloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  NearestFilter,
  NoBlending,
  NormalBlending,
  PerspectiveCamera,
  RedFormat,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLMultipleRenderTargets,
  GLSL3,
  type ArrayCamera,
  type Camera,
  type Group,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { HOME, WEATHER3D_ENABLED, subscribeHome } from '../core/config';
import { toScene } from '../core/coords';
import { t } from '../core/i18n';
import { setLoading } from '../core/loading';
import { getSettings, subscribeSettings } from '../core/settings';
import { getXrState, subscribeXr } from '../core/xr';
import { DIORAMA_PLANES } from './diorama-clip';
import { subscribeField, type FieldGrid } from './weather-fields';

// 3D storms: NOAA MRMS merged reflectivity as a raymarched volume.
//
// weather-service (ENABLE_WEATHER3D) crops the 33 constant-altitude MRMS
// slices to a box around the home receiver and serves them as one uint8
// dBZ volume. This module hangs that volume in the sky at true altitude:
// a unit box scaled to the manifest bounds, drawn back-face-only so the
// fragment shader can march from the camera (even when it is inside the
// box) to the far wall, sampling a Data3DTexture and compositing the NWS
// reflectivity ramp front to back. One draw call; nothing is meshed.
//
// Altitude is not linear in scene y (core/altitude-curve.ts), so the shader
// looks the texture depth up through a 1-D LUT built from toScene() of
// each layer height. That is what puts an aircraft at FL300 inside the
// echo at FL300 instead of above or below it.
//
// Depth: the box is only the march's canvas, so its own depth means
// nothing. Its floor is the lowest MRMS level, 0.5 km MSL, and 3D terrain
// higher than that used to win the depth test and erase every storm over
// high ground (issue #19). The march instead reports where its echo is,
// the opacity-weighted distance along the ray, as the fragment's depth:
// a storm is hidden by what stands in front of it and covers what is
// behind it, terrain and aircraft alike. The volume still does not read
// the scene depth buffer, so a ray is never cut short at a mountain.
//
// In a headset the march is the most expensive thing on screen: it runs
// for every pixel of both eyes at the panel's resolution, and halved a
// busy scene's frame rate (issue #19). There it is rendered into a target
// a fraction of the eye's size (XR_SCALE) and the box then draws that
// picture, stretched back up. A storm is soft, so the loss is hard to
// see; the pixel count, which is the cost, falls with the square of the
// scale. `?stormScale=0.5` forces the same path on a monitor.
//
// That pass runs before the frame's own drawing starts (the scene's
// onBeforeRender), both eyes into one target laid out like the headset's
// framebuffer. Run from the box's own draw it switched render targets in
// the middle of each eye, and a headset's tiled GPU pays for every such
// switch by storing the half-drawn eye and loading it back.
//
// One sidecar serves every feed: the manifest request carries the active
// feed's home position and weather-service crops its shared MRMS download
// around it, so switching feeds just asks for a different crop. Feeds
// outside CONUS get coverage:false and draw nothing. The flat RainViewer
// overlay (world/radar.ts) steps aside while this is on so the two never
// double-draw.

const MANIFEST_URL = '/weather-api/volume';
const POLL_MS = 60 * 1000;
/** weather-service answers 503 building for a few seconds after a new home. */
const RETRY_MS = 5 * 1000;
const FT_PER_KM = 3280.84;
// Height LUTs are 32-bit float textures. WebGL2 only filters those where
// OES_texture_float_linear exists, and many phone GPUs lack it: a LINEAR
// float texture there is "incomplete" and samples as 0, which read every
// march step from the lowest layer and drew the storms as flat curtains.
// Nearest filtering is always legal, so the LUTs are sampled NEAREST and
// made fine enough (1/2048 of the height span) that the steps don't show.
const LUT_SIZE = 2048;
const RAMP_SIZE = 64;
/** dBZ spanned by the ramp texture: index = dBZ / RAMP_MAX_DBZ. */
const RAMP_MAX_DBZ = 80;
/** Below this the ramp is fully transparent (its first stop is 18 dBZ, and
 * the ramp texture's linear filter starts fading in just under it). */
const CLEAR_AIR_DBZ = 16;
// The march is two-level. A coarse pass strides across the box reading
// only the occupancy map (which columns hold any echo); wherever that says
// "storm here" each coarse stride is walked again in FINE sub-steps that
// read the real volume. Clear air costs one lookup per stride, and the
// samples are spent inside the storm, where a single-level march was so
// sparse (a step every 8 cells in a headset) that its per-pixel jitter
// showed as a fixed grain over the cloud (issue #18).
/** Coarse strides across the box; never fewer than MIN_COARSE (see buildOccupancy). */
const COARSE_DESKTOP = 24;
const COARSE_XR = 16;
/** Fine sub-steps per occupied stride. */
const FINE_DESKTOP = 3;
const FINE_XR = 3;
/** While the camera is moving: the eye forgives a coarser march in motion,
 * and this is when a dropped frame shows. Full quality returns at rest. */
const FINE_MOVING = 2;
/** In a headset: the march's render size as a fraction of the eye's, each way. */
const XR_SCALE = 0.5;
/** Occupancy cell size in volume cells, and how many cells it is grown by. */
const OCC_POOL = 8;
const OCC_DILATE = 2;
/**
 * Fewest coarse strides that cannot step over an occupied cell: a stride
 * is probed at its midpoint, the map is grown by OCC_DILATE cells each
 * way, so a stride may span 2 * OCC_DILATE cells, and the longest ray is
 * the box diagonal.
 */
export function minCoarseSteps(nx: number, ny: number, pool = OCC_POOL, dilate = OCC_DILATE): number {
  return Math.ceil(Math.hypot(nx, ny) / (2 * dilate * pool));
}

export interface VolumeManifest {
  time: number;
  bounds: { west: number; east: number; south: number; north: number };
  nx: number;
  ny: number;
  nz: number;
  heightsKm: number[];
  url: string;
}

/** Deploy flag AND user toggle: the one predicate radar.ts and the
 * attribution bar share, so all three agree on who is drawing. */
export function stormsActive(): boolean {
  return WEATHER3D_ENABLED && getSettings().weatherStorms3d;
}

/** Manifest URL for the active home; the service crops around it. */
export function manifestUrl(lat: number, lon: number): string {
  return `${MANIFEST_URL}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
}

/** Pure: a well-formed manifest from weather-service, or null (incl. coverage:false). */
export function parseVolumeManifest(json: unknown): VolumeManifest | null {
  const m = json as Partial<VolumeManifest> & { coverage?: unknown } | null;
  if (!m || m.coverage !== true) return null;
  const b = m.bounds;
  if (
    typeof m.time !== 'number' ||
    typeof m.nx !== 'number' || typeof m.ny !== 'number' || typeof m.nz !== 'number' ||
    m.nx < 1 || m.ny < 1 || m.nz < 2 ||
    !Array.isArray(m.heightsKm) || m.heightsKm.length !== m.nz ||
    !m.heightsKm.every((h) => typeof h === 'number' && Number.isFinite(h)) ||
    typeof m.url !== 'string' ||
    !b || typeof b.west !== 'number' || typeof b.east !== 'number' ||
    typeof b.south !== 'number' || typeof b.north !== 'number' ||
    !(b.east > b.west) || !(b.north > b.south)
  ) {
    return null;
  }
  return { time: m.time, bounds: { ...b }, nx: m.nx, ny: m.ny, nz: m.nz, heightsKm: [...m.heightsKm], url: m.url };
}

/**
 * Pure: normalized scene height (0 at layer 0, 1 at the top layer) → texture
 * depth coordinate, as a LUT of `size` floats. `layerY` is the scene y of
 * each layer, non-decreasing (flat mode clamps underground layers to one
 * y, which this tolerates). Layer k's centre sits at (k + 0.5) / nz so the
 * sampler's linear filter interpolates between adjacent layers.
 */
/** Pure: box y (0..1) → height in km, piecewise-linear between the MRMS
 * layer heights at their scene y. Pairs with buildHeightLut for the
 * echo-top test in the shader. */
export function buildKmLut(layerY: readonly number[], heightsKm: readonly number[], size = LUT_SIZE): Float32Array<ArrayBuffer> {
  const out = new Float32Array(size);
  const y0 = layerY[0]!;
  const y1 = layerY[layerY.length - 1]!;
  for (let i = 0; i < size; i++) {
    const y = y0 + ((y1 - y0) * i) / (size - 1);
    let j = 0;
    while (j < layerY.length - 2 && layerY[j + 1]! < y) j++;
    const a = layerY[j]!;
    const b = layerY[j + 1]!;
    const f = b > a ? Math.min(1, Math.max(0, (y - a) / (b - a))) : 0;
    out[i] = heightsKm[j]! + (heightsKm[j + 1]! - heightsKm[j]!) * f;
  }
  return out;
}

export function buildHeightLut(layerY: readonly number[], size = LUT_SIZE): Float32Array<ArrayBuffer> {
  const nz = layerY.length;
  const lut = new Float32Array(size);
  const y0 = layerY[0]!;
  const y1 = layerY[nz - 1]!;
  const span = y1 - y0;
  for (let i = 0; i < size; i++) {
    const y = y0 + (span * i) / (size - 1);
    // Last layer whose y is <= target (skipping zero-length runs).
    let k = 0;
    while (k + 1 < nz && layerY[k + 1]! <= y) k++;
    let w: number;
    if (k >= nz - 1) {
      w = nz - 1;
    } else {
      const a = layerY[k]!;
      const b = layerY[k + 1]!;
      w = k + (b > a ? (y - a) / (b - a) : 0);
    }
    lut[i] = (w + 0.5) / nz;
  }
  return lut;
}

/** [dBZ, r, g, b, alpha 0..255]: the familiar NWS reflectivity ramp, with
 * alpha kept gentle so stacked echoes read as cloud, not paint. */
const RAMP: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [18, 4, 233, 231, 40],
  [25, 1, 159, 244, 60],
  [30, 2, 253, 2, 85],
  [35, 1, 197, 1, 105],
  [40, 253, 248, 2, 135],
  [45, 229, 188, 0, 160],
  [50, 253, 149, 0, 190],
  [55, 253, 0, 0, 215],
  [60, 212, 0, 0, 235],
  [65, 248, 0, 253, 250],
];

/** Pure: the ramp stop (r, g, b, alpha 0..255) for a reflectivity, or null below the first stop. */
export function rampColor(dbz: number): readonly [number, number, number, number] | null {
  let pick: (typeof RAMP)[number] | null = null;
  for (const stop of RAMP) if (dbz >= stop[0]) pick = stop;
  return pick ? [pick[1], pick[2], pick[3], pick[4]] : null;
}

/** Pure: RGBA bytes for the ramp texture, RAMP_SIZE entries over 0..RAMP_MAX_DBZ. */
export function rampTable(size = RAMP_SIZE): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const dbz = (i / (size - 1)) * RAMP_MAX_DBZ;
    let pick: (typeof RAMP)[number] | null = null;
    for (const stop of RAMP) if (dbz >= stop[0]) pick = stop;
    if (pick) out.set([pick[1], pick[2], pick[3], pick[4]], i * 4);
  }
  return out;
}

// A 0..1 depth through an RGBA8 target and back. Kept under 1 so fract()
// cannot wrap it to 0.
const PACK_GLSL = /* glsl */ `
vec4 packDepth(float v) {
  vec4 r = fract(v * vec4(1.0, 255.0, 65025.0, 16581375.0));
  return r - r.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
}
float unpackDepth(vec4 r) {
  return dot(r, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
}
`;

const VERT = /* glsl */ `
#include <clipping_planes_pars_vertex>
out vec3 vPosObj;
out vec3 vCamObj;
out vec2 vClipZW;
flat out vec2 vCamZW;
void main() {
  vPosObj = position;
  // Camera in the box's own frame, so the march is a unit-cube problem.
  vCamObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // Clip z and w are linear along the ray from the camera (the view origin,
  // so the projection's last column) to this point of the box wall; the
  // fragment shader mixes the two to get the depth of a point in between.
  vClipZW = gl_Position.zw;
  vCamZW = projectionMatrix[3].zw;
  #include <clipping_planes_vertex>
}
`;

const FRAG = /* glsl */ `
precision highp sampler3D;
#include <clipping_planes_pars_fragment>
// GLSL3 ShaderMaterial: three leaves the output declaration to us.
// The second output is the echo's depth for the reduced pass, whose target
// has no depth buffer; drawn straight to the screen it goes nowhere.
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragEchoDepth;
uniform sampler3D uVolume;
uniform sampler2D uHeightLut;
uniform sampler2D uRamp;
uniform int uSteps;      // coarse strides
uniform int uFine;       // sub-steps per occupied stride
uniform sampler2D uOcc;  // per column block: 0 = no echo, else box height of its top
uniform float uDensity;
// Echo tops (MRMS EchoTop_18, km, code/10): the march ignores samples above
// a column's top so cells end at their real height instead of smearing
// up to the volume ceiling. uTopUv maps box xz to the field's grid.
uniform sampler2D uTop;
uniform float uHasTop;
uniform vec4 uTopUv;        // xy scale, zw offset
uniform sampler2D uKmLut;   // box y -> km MSL
in vec3 vPosObj;
in vec3 vCamObj;
in vec2 vClipZW;
flat in vec2 vCamZW;

${PACK_GLSL}
// Interleaved gradient noise: an ordered, evenly spread dither. White noise
// clumps, and the clumps are what read as grain when the pattern is fixed
// to the screen while a headset turns.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  #include <clipping_planes_fragment>
  vec3 dir = normalize(vPosObj - vCamObj);
  vec3 inv = 1.0 / dir;
  vec3 t0 = (vec3(-0.5) - vCamObj) * inv;
  vec3 t1 = (vec3(0.5) - vCamObj) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float tEnter = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  float tExit = min(min(tmax.x, tmax.y), tmax.z);
  if (tExit <= tEnter) discard;
  float coarse = (tExit - tEnter) / float(uSteps);
  float stepLen = coarse / float(uFine);
  // Jitter by a fraction of one fine step: enough to hide slab banding,
  // far too little to show.
  float tStart = tEnter + stepLen * ign(gl_FragCoord.xy);
  vec3 rgb = vec3(0.0);
  float acc = 0.0;
  float tSum = 0.0; // opacity-weighted distance, for the depth
  for (int i = 0; i < 64; i++) {
    float tc = tStart + coarse * float(i);
    if (i >= uSteps || tc >= tExit || acc > 0.95) break;
    // Clear column all the way along this stride: skip it for one lookup.
    vec3 mid = vCamObj + dir * (tc + 0.5 * coarse);
    float top = textureLod(uOcc, mid.xz + 0.5, 0.0).r;
    if (top <= 0.0) continue;
    // Nor is there anything above the storm's top: a ray from a camera
    // looking down spends much of its length up there. The stride's lower
    // end decides, since the ray may be descending into the storm.
    float yLow = min(dir.y * tc, dir.y * (tc + coarse)) + vCamObj.y + 0.5;
    if (yLow > top) continue;
    for (int j = 0; j < 8; j++) {
      float t = tc + stepLen * float(j);
      if (j >= uFine || t >= tExit) break;
      vec3 p = vCamObj + dir * t;
      // x: west→east. z: -north, so the north edge (z = -0.5) is row 0.
      // y: scene height → texture layer via the altitude-curve LUT.
      float w = textureLod(uHeightLut, vec2(p.y + 0.5, 0.5), 0.0).r;
      float dbz = textureLod(uVolume, vec3(p.x + 0.5, p.z + 0.5, w), 0.0).r * 255.0;
      // Clear air inside an occupied column: nothing to add.
      if (dbz < ${CLEAR_AIR_DBZ.toFixed(1)}) continue;
      if (uHasTop > 0.5) {
        vec2 tuv = (p.xz + 0.5) * uTopUv.xy + uTopUv.zw;
        float topKm = textureLod(uTop, tuv, 0.0).r * 25.5;
        float km = textureLod(uKmLut, vec2(p.y + 0.5, 0.5), 0.0).r;
        // Half a kilometre of grace: EchoTop is itself a 0.5 km stepped product.
        if (topKm > 0.0 && km > topKm + 0.5) continue;
      }
      vec4 c = textureLod(uRamp, vec2(dbz / ${RAMP_MAX_DBZ.toFixed(1)}, 0.5), 0.0);
      float a = 1.0 - exp(-c.a * uDensity * stepLen);
      rgb += (1.0 - acc) * a * c.rgb;
      tSum += (1.0 - acc) * a * t;
      acc += (1.0 - acc) * a;
      if (acc > 0.95) break;
    }
  }
  if (acc <= 0.002) discard;
  fragColor = vec4(rgb, acc);
  // Where the echo is, not where the box wall is (see the header).
  vec2 zw = mix(vCamZW, vClipZW, (tSum / acc) / length(vPosObj - vCamObj));
  float depth = clamp(zw.x / zw.y * 0.5 + 0.5, 0.0, 0.999999);
  gl_FragDepth = depth;
  fragEchoDepth = packDepth(depth);
}
`;

/** The reduced pass, drawn back onto the box: two lookups per pixel. */
const COMPOSITE_VERT = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
out vec4 fragColor;
uniform sampler2D uMap;
uniform sampler2D uDepth; // the echo's depth, packed, nearest-sampled
${PACK_GLSL}
uniform vec4 uRect;   // this eye's viewport, framebuffer pixels
uniform vec2 uFull;   // the framebuffer the target mirrors, pixels
uniform float uInset; // half a target texel, in framebuffer pixels
void main() {
  // Stay inside this eye's part of the target: the other eye is next door.
  vec2 p = clamp(gl_FragCoord.xy, uRect.xy + uInset, uRect.xy + uRect.zw - uInset);
  vec4 c = texture(uMap, p / uFull);
  if (c.a <= 0.002) discard;
  fragColor = c;
  gl_FragDepth = unpackDepth(texture(uDepth, p / uFull));
}
`;

/** Pure: `?stormScale=` as a usable fraction, or null (absent, junk, or 1 and over). */
export function parseStormScale(search: string): number | null {
  const raw = new URLSearchParams(search).get('stormScale');
  if (raw === null) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0.1 && v < 1 ? v : null;
}

export interface PassRect { x: number; y: number; w: number; h: number }

/**
 * Pure: the reduced target for a set of eye viewports (framebuffer pixels).
 * The target is the framebuffer those viewports sit in, scaled; each eye
 * keeps its place in it, on whole pixels, edges shared where the eyes touch.
 */
export function passLayout(
  views: readonly PassRect[],
  scale: number,
): { fullW: number; fullH: number; w: number; h: number; rects: PassRect[] } {
  let fullW = 1;
  let fullH = 1;
  for (const v of views) {
    fullW = Math.max(fullW, v.x + v.w);
    fullH = Math.max(fullH, v.y + v.h);
  }
  const rects = views.map((v) => {
    const x = Math.round(v.x * scale);
    const y = Math.round(v.y * scale);
    return {
      x,
      y,
      w: Math.max(1, Math.round((v.x + v.w) * scale) - x),
      h: Math.max(1, Math.round((v.y + v.h) * scale) - y),
    };
  });
  return { fullW, fullH, w: Math.max(1, Math.round(fullW * scale)), h: Math.max(1, Math.round(fullH * scale)), rects };
}

/**
 * Pure: the occupancy map the coarse march reads. One byte per
 * `pool` x `pool` block of columns: 0 where no cell of any layer in the
 * block, or in a block within `dilate` of it, reaches the ramp; otherwise
 * one more than the highest layer that does, across that neighbourhood.
 * Same x / y layout as the volume. `any` is false for a clear-sky volume, which is
 * then not drawn at all: marching it would cost a full-screen shader pass
 * (twice over in a headset) to draw nothing.
 */
export function buildOccupancy(
  dbz: Uint8Array,
  nx: number,
  ny: number,
  nz: number,
  pool = OCC_POOL,
  dilate = OCC_DILATE,
  minDbz = CLEAR_AIR_DBZ,
): { data: Uint8Array<ArrayBuffer>; w: number; h: number; any: boolean } {
  const w = Math.ceil(nx / pool);
  const h = Math.ceil(ny / pool);
  const raw = new Uint8Array(w * h);
  let any = false;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      const row = nx * (y + ny * z);
      const oy = Math.floor(y / pool) * w;
      for (let x = 0; x < nx; x++) {
        if (dbz[row + x]! >= minDbz) {
          // Layers are visited bottom up, so the last write is the top.
          raw[oy + Math.floor(x / pool)] = z + 1;
          any = true;
        }
      }
    }
  }
  const data = new Uint8Array(w * h);
  if (!any) return { data, w, h, any };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!raw[y * w + x]) continue;
      for (let dy = -dilate; dy <= dilate; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -dilate; dx <= dilate; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && raw[y * w + x]! > data[yy * w + xx]!) data[yy * w + xx] = raw[y * w + x]!;
        }
      }
    }
  }
  return { data, w, h, any };
}

export function mountStorms(parent: Group): void {
  let manifest: VolumeManifest | null = null;
  let mesh: Mesh | null = null;
  let material: ShaderMaterial | null = null;
  let volumeTex: Data3DTexture | null = null;
  /** Storm-top layers per column block, from the loaded volume. */
  let occ: { data: Uint8Array; w: number; h: number } | null = null;
  let occTex: DataTexture | null = null;
  let coarseMin = 1;
  let lutTex: DataTexture | null = null;
  let kmLutTex: DataTexture | null = null;
  let topTex: DataTexture | null = null;
  let topGrid: FieldGrid | null = null;
  let unsubTop: (() => void) | null = null;
  let timer: number | null = null;
  let retry: number | null = null;
  let loadingTime = -1;
  let warnedCoverage = false;
  const geometry = new BoxGeometry(1, 1, 1);
  const rampTex = new DataTexture(rampTable(), RAMP_SIZE, 1, RGBAFormat, UnsignedByteType);
  rampTex.minFilter = LinearFilter;
  rampTex.magFilter = LinearFilter;
  rampTex.needsUpdate = true;
  const tmp = new Vector3();
  const lastView = new Matrix4();

  // The reduced pass (see the header). Its own scene, mesh and camera, all
  // with hand-set matrices: the pass must see exactly what the eye sees,
  // and three would otherwise rebuild a headset eye's matrix without its rig.
  const forcedScale = parseStormScale(window.location.search);
  let reduced = forcedScale !== null || getXrState().presenting;
  /** Two textures: the picture, and the echo's depth (see the header). */
  let target: WebGLMultipleRenderTargets | null = null;
  const passScene = new Scene();
  passScene.matrixWorldAutoUpdate = false;
  const passMesh = new Mesh(geometry);
  passMesh.matrixAutoUpdate = false;
  passMesh.frustumCulled = false;
  passScene.add(passMesh);
  const passCam = new PerspectiveCamera();
  passCam.matrixAutoUpdate = false;
  passCam.matrixWorldAutoUpdate = false;
  const viewport = new Vector4();
  const clearColor = new Color();
  const composite = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: COMPOSITE_VERT,
    fragmentShader: COMPOSITE_FRAG,
    uniforms: {
      uMap: { value: null },
      uDepth: { value: null },
      uRect: { value: new Vector4(0, 0, 1, 1) },
      uFull: { value: new Vector2(1, 1) },
      uInset: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    side: BackSide,
    fog: false,
  });

  /** Coarser in a headset, and while a desktop camera moves. */
  const tune = (renderer: WebGLRenderer, camera: Camera): void => {
    if (!material) return;
    const moving = !camera.matrixWorld.equals(lastView);
    lastView.copy(camera.matrixWorld);
    const xr = renderer.xr.isPresenting;
    material.uniforms.uSteps!.value = Math.max(xr ? COARSE_XR : COARSE_DESKTOP, coarseMin);
    material.uniforms.uFine!.value = xr ? FINE_XR : moving ? FINE_MOVING : FINE_DESKTOP;
  };

  const shown = (o: Object3D | null): boolean => {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  };

  /**
   * March every eye into the small target, before the frame draws anything;
   * the box then draws the result. `camera` is what the frame renders with:
   * a headset's ArrayCamera (one camera and viewport per eye) or the
   * desktop camera.
   */
  const renderPass = (renderer: WebGLRenderer, camera: Camera): void => {
    if (!mesh || !material || mesh.material !== composite || !shown(mesh)) return;
    const scale = forcedScale ?? XR_SCALE;
    const array = (camera as ArrayCamera).isArrayCamera ? (camera as ArrayCamera) : null;
    const eyes: Camera[] = array ? array.cameras : [camera];
    if (eyes.length === 0) return;
    renderer.getCurrentViewport(viewport);
    const layout = passLayout(
      eyes.map((eye) => {
        // A headset eye carries its own viewport; a monitor has the one.
        const v = (array && (eye as Camera & { viewport?: Vector4 }).viewport) || viewport;
        return { x: v.x, y: v.y, w: v.z, h: v.w };
      }),
      scale,
    );
    if (!target) {
      target = new WebGLMultipleRenderTargets(layout.w, layout.h, 2, { depthBuffer: false, generateMipmaps: false });
      target.texture[0]!.minFilter = LinearFilter;
      target.texture[0]!.magFilter = LinearFilter;
      // Packed bytes: a blend of two depths is neither.
      target.texture[1]!.minFilter = NearestFilter;
      target.texture[1]!.magFilter = NearestFilter;
    } else if (target.width !== layout.w || target.height !== layout.h) {
      target.setSize(layout.w, layout.h);
    }
    tune(renderer, camera);
    passMesh.material = material;
    passMesh.matrixWorld.copy(mesh.matrixWorld);

    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevAutoClear = renderer.autoClear;
    const prevInfoReset = renderer.info.autoReset;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColor);
    // xr off: this render is ours, not the headset's. info: the frame's
    // counters (the ?perf=1 log) are the frame's to reset.
    renderer.xr.enabled = false;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.setClearColor(0x000000, 0);
    eyes.forEach((eye, i) => {
      const r = layout.rects[i]!;
      // setRenderTarget is what applies the target's viewport.
      target!.viewport.set(r.x, r.y, r.w, r.h);
      renderer.setRenderTarget(target);
      if (i === 0) renderer.clear();
      passCam.matrixWorld.copy(eye.matrixWorld);
      passCam.matrixWorldInverse.copy(eye.matrixWorldInverse);
      passCam.projectionMatrix.copy(eye.projectionMatrix);
      passCam.projectionMatrixInverse.copy(eye.projectionMatrixInverse);
      renderer.render(passScene, passCam);
    });
    renderer.setClearColor(clearColor, prevAlpha);
    renderer.info.autoReset = prevInfoReset;
    renderer.autoClear = prevAutoClear;
    renderer.xr.enabled = prevXr;
    renderer.setRenderTarget(prevTarget);
    composite.uniforms.uMap!.value = target.texture[0]!;
    composite.uniforms.uDepth!.value = target.texture[1]!;
    composite.uniforms.uFull!.value.set(layout.fullW, layout.fullH);
    composite.uniforms.uInset!.value = 0.5 / scale;
  };

  // Hooked onto whichever scene the box ends up in, once; whatever hook
  // that scene already had still runs.
  let hooked: Scene | null = null;
  const hookScene = (): void => {
    let root: Object3D = parent;
    while (root.parent) root = root.parent;
    if (hooked === root || !(root as Scene).isScene) return;
    hooked = root as Scene;
    // three calls a scene's hook with (renderer, scene, camera, target),
    // not the per-object arguments its types describe.
    type SceneHook = (this: Scene, renderer: WebGLRenderer, scene: Scene, camera: Camera, renderTarget: unknown) => void;
    const scene = hooked;
    const before = scene.onBeforeRender as unknown as SceneHook;
    const hook: SceneHook = function (renderer, s, camera, renderTarget) {
      before.call(this, renderer, s, camera, renderTarget);
      renderPass(renderer, camera);
    };
    scene.onBeforeRender = hook as unknown as Scene['onBeforeRender'];
  };

  /** Point the box at the march itself or at the reduced pass's picture. */
  const applyMode = (): void => {
    if (mesh && material) {
      mesh.material = reduced ? composite : material;
      // Into the target the march writes its colour and coverage as they
      // are; the box blends them, once, when it draws the picture.
      material.blending = reduced ? NoBlending : NormalBlending;
    }
    if (!reduced && target) {
      target.dispose();
      target = null;
    }
  };
  subscribeXr((s) => {
    const next = forcedScale !== null || s.presenting;
    if (next === reduced) return;
    reduced = next;
    applyMode();
  });

  const dispose = (): void => {
    if (mesh) {
      parent.remove(mesh);
      mesh = null;
    }
    material?.dispose();
    material = null;
    lutTex?.dispose();
    lutTex = null;
    kmLutTex?.dispose();
    kmLutTex = null;
    occTex?.dispose();
    occTex = null;
  };

  /** Upload (or clear) the echo-top texture and its uv mapping into the live material. */
  const applyTop = (): void => {
    if (!material || !manifest) return;
    const u = material.uniforms;
    if (!topGrid) {
      u.uHasTop!.value = 0;
      return;
    }
    const vb = manifest.bounds;
    const fb = topGrid.bounds;
    const sx = (vb.east - vb.west) / (fb.east - fb.west);
    const sz = (vb.north - vb.south) / (fb.north - fb.south);
    const ox = (vb.west - fb.west) / (fb.east - fb.west);
    // Box z = -north → field row 0 is north, so v runs from the north edge.
    const oz = (fb.north - vb.north) / (fb.north - fb.south);
    topTex?.dispose();
    topTex = new DataTexture(topGrid.codes, topGrid.nx, topGrid.ny, RedFormat, UnsignedByteType);
    topTex.minFilter = LinearFilter;
    topTex.magFilter = LinearFilter;
    topTex.unpackAlignment = 1;
    topTex.needsUpdate = true;
    u.uTop!.value = topTex;
    u.uTopUv!.value.set(sx, sz, ox, oz);
    u.uHasTop!.value = 1;
  };

  const dropVolume = (): void => {
    dispose();
    volumeTex?.dispose();
    volumeTex = null;
    occ = null;
    manifest = null;
  };

  /** Box transform + height LUT from the manifest bounds; HOME-relative. */
  const place = (): void => {
    dispose();
    // Clear skies: keep the volume but draw nothing, so it costs nothing.
    if (!stormsActive() || !manifest || !volumeTex || !occ) return;
    const { bounds, heightsKm, nz } = manifest;
    const layerY = heightsKm.map((km) => toScene(HOME.lat, HOME.lon, km * FT_PER_KM, tmp).y);
    const yBottom = layerY[0]!;
    const yTop = layerY[nz - 1]!;
    if (!(yTop > yBottom)) return;
    // The occupancy map holds layer numbers; the shader wants box heights,
    // which follow the altitude curve like everything else here. One layer
    // of headroom, since the volume is interpolated between layers.
    const tops = new Uint8Array(occ.data.length);
    for (let i = 0; i < tops.length; i++) {
      const v = occ.data[i]!;
      if (v === 0) continue;
      const y = (layerY[Math.min(v, nz - 1)]! - yBottom) / (yTop - yBottom);
      tops[i] = Math.min(255, Math.max(1, Math.ceil(y * 255)));
    }
    occTex = new DataTexture(tops, occ.w, occ.h, RedFormat, UnsignedByteType);
    occTex.minFilter = NearestFilter;
    occTex.magFilter = NearestFilter;
    occTex.unpackAlignment = 1;
    occTex.needsUpdate = true;
    // The tangent plane is linear in lat/lon, so two corners fix the box.
    const nw = toScene(bounds.north, bounds.west, 0, new Vector3());
    const se = toScene(bounds.south, bounds.east, 0, new Vector3());
    lutTex = new DataTexture(buildHeightLut(layerY), LUT_SIZE, 1, RedFormat, FloatType);
    lutTex.minFilter = NearestFilter;
    lutTex.magFilter = NearestFilter;
    lutTex.needsUpdate = true;
    kmLutTex = new DataTexture(buildKmLut(layerY, heightsKm), LUT_SIZE, 1, RedFormat, FloatType);
    kmLutTex.minFilter = NearestFilter;
    kmLutTex.magFilter = NearestFilter;
    kmLutTex.needsUpdate = true;
    material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uVolume: { value: volumeTex },
        uHeightLut: { value: lutTex },
        uRamp: { value: rampTex },
        uSteps: { value: Math.max(COARSE_DESKTOP, coarseMin) },
        uFine: { value: FINE_DESKTOP },
        uOcc: { value: occTex },
        uDensity: { value: 48 },
        uTop: { value: rampTex },   // placeholder until a field lands
        uHasTop: { value: 0 },
        uTopUv: { value: new Vector4(1, 1, 0, 0) },
        uKmLut: { value: kmLutTex },
      },
      transparent: true,
      depthWrite: false,
      side: BackSide,
      fog: false,
      clipping: true,
      clippingPlanes: DIORAMA_PLANES,
    });
    mesh = new Mesh(geometry, material);
    mesh.position.set((nw.x + se.x) / 2, (yBottom + yTop) / 2, (nw.z + se.z) / 2);
    mesh.scale.set(se.x - nw.x, yTop - yBottom, se.z - nw.z);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    mesh.userData = { kind: 'storms' };
    applyTop();
    applyMode();
    mesh.onBeforeRender = (renderer: WebGLRenderer, _scene, camera): void => {
      if (!mesh) return;
      // Reduced: the march already ran (renderPass); say which eye this is.
      if (mesh.material === composite) composite.uniforms.uRect!.value.copy(renderer.getCurrentViewport(viewport));
      else tune(renderer, camera);
    };
    parent.add(mesh);
    hookScene();
  };

  const load = async (next: VolumeManifest): Promise<void> => {
    if (loadingTime === next.time) return;
    loadingTime = next.time;
    try {
      const res = await fetch(`/weather-api${next.url}`, { cache: 'no-store' });
      if (!res.ok) return;
      const buf = new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>;
      if (buf.length !== next.nx * next.ny * next.nz) {
        console.warn('[storms] volume size mismatch', buf.length, next);
        return;
      }
      if (!stormsActive()) return;
      const tex = new Data3DTexture(buf, next.nx, next.ny, next.nz);
      tex.format = RedFormat;
      tex.type = UnsignedByteType;
      tex.minFilter = LinearFilter;
      tex.magFilter = LinearFilter;
      tex.unpackAlignment = 1;
      tex.needsUpdate = true;
      volumeTex?.dispose();
      volumeTex = tex;
      const built = buildOccupancy(buf, next.nx, next.ny, next.nz);
      occ = built.any ? built : null;
      coarseMin = minCoarseSteps(next.nx, next.ny);
      manifest = next;
      place();
    } catch {
      // Offline or upstream down: keep the last volume we drew.
    } finally {
      waiting(false);
      if (loadingTime === next.time) loadingTime = -1;
    }
  };

  /** The loading toast: up from the first request until a volume (or a
   *  definite "nothing here") comes back. Refreshes of a volume already
   *  on screen are silent. */
  const waiting = (on: boolean): void => setLoading('storms', on ? t('settings.weather_storms_3d') : null);

  const poll = async (): Promise<void> => {
    if (!stormsActive()) return;
    if (manifest === null) waiting(true);
    try {
      const res = await fetch(manifestUrl(HOME.lat, HOME.lon), { cache: 'no-store' });
      if (res.status === 503) {
        // New location: the service is cropping it now. Ask again shortly
        // instead of waiting a whole poll interval.
        if (retry === null) retry = window.setTimeout(() => { retry = null; void poll(); }, RETRY_MS);
        return;
      }
      if (!res.ok) {
        waiting(false);
        return;
      }
      const json: unknown = await res.json();
      const next = parseVolumeManifest(json);
      if (next === null) {
        waiting(false);
        if ((json as { coverage?: unknown } | null)?.coverage === false && !warnedCoverage) {
          warnedCoverage = true;
          console.info('[storms] this feed is outside MRMS coverage; 3D storms stay empty');
        }
        return;
      }
      if (manifest === null || next.time !== manifest.time) void load(next);
      else waiting(false);
    } catch {
      // Keep whatever is drawn.
      waiting(false);
    }
  };

  const sync = (): void => {
    const on = stormsActive();
    if (on && !unsubTop) {
      unsubTop = subscribeField('echotop18', (grid) => {
        topGrid = grid;
        applyTop();
      });
    } else if (!on && unsubTop) {
      unsubTop();
      unsubTop = null;
      topGrid = null;
    }
    if (on && timer === null) {
      timer = window.setInterval(() => void poll(), POLL_MS);
      void poll();
    } else if (!on && timer !== null) {
      window.clearInterval(timer);
      timer = null;
      if (retry !== null) {
        window.clearTimeout(retry);
        retry = null;
      }
    }
    if (!on) waiting(false);
    if (!on && mesh) dispose();
    else if (on && !mesh && manifest && volumeTex) place();
  };

  subscribeSettings(sync);
  // Feed switch moves HOME: the old crop is the wrong patch of sky, so drop
  // it and ask the service for one around the new home.
  subscribeHome(() => {
    dropVolume();
    warnedCoverage = false;
    sync();
    if (stormsActive()) void poll();
  });
  sync();
}
