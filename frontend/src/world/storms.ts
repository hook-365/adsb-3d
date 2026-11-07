import {
  BackSide,
  BoxGeometry,
  DataTexture,
  Data3DTexture,
  FloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  Vector4,
  GLSL3,
  type Group,
  type WebGLRenderer,
} from 'three';
import { HOME, WEATHER3D_ENABLED, subscribeHome } from '../core/config';
import { toScene } from '../core/coords';
import { getSettings, subscribeSettings } from '../core/settings';
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
// Known v1 limit: the volume does not read the scene depth buffer, so an
// aircraft inside a storm is drawn fully in front of it (the box's back
// face is behind the aircraft, so the aircraft wins the depth test).
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
const STEPS_DESKTOP = 64;
const STEPS_XR = 32;

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

const VERT = /* glsl */ `
#include <clipping_planes_pars_vertex>
out vec3 vPosObj;
out vec3 vCamObj;
void main() {
  vPosObj = position;
  // Camera in the box's own frame, so the march is a unit-cube problem.
  vCamObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}
`;

const FRAG = /* glsl */ `
precision highp sampler3D;
#include <clipping_planes_pars_fragment>
// GLSL3 ShaderMaterial: three leaves the output declaration to us.
out vec4 fragColor;
uniform sampler3D uVolume;
uniform sampler2D uHeightLut;
uniform sampler2D uRamp;
uniform int uSteps;
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

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
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
  float stepLen = (tExit - tEnter) / float(uSteps);
  // Per-pixel jitter hides the slab banding a fixed step would show.
  float t = tEnter + stepLen * hash12(gl_FragCoord.xy);
  vec3 rgb = vec3(0.0);
  float acc = 0.0;
  for (int i = 0; i < 128; i++) {
    if (i >= uSteps || t >= tExit) break;
    vec3 p = vCamObj + dir * t;
    // x: west→east. z: -north, so the north edge (z = -0.5) is row 0.
    // y: scene height → texture layer via the altitude-curve LUT.
    float w = texture(uHeightLut, vec2(p.y + 0.5, 0.5)).r;
    float dbz = texture(uVolume, vec3(p.x + 0.5, p.z + 0.5, w)).r * 255.0;
    if (uHasTop > 0.5) {
      vec2 tuv = (p.xz + 0.5) * uTopUv.xy + uTopUv.zw;
      float topKm = texture(uTop, tuv).r * 25.5;
      float km = texture(uKmLut, vec2(p.y + 0.5, 0.5)).r;
      // Half a kilometre of grace: EchoTop is itself a 0.5 km stepped product.
      if (topKm > 0.0 && km > topKm + 0.5) dbz = 0.0;
    }
    vec4 c = texture(uRamp, vec2(dbz / ${RAMP_MAX_DBZ.toFixed(1)}, 0.5));
    float a = 1.0 - exp(-c.a * uDensity * stepLen);
    rgb += (1.0 - acc) * a * c.rgb;
    acc += (1.0 - acc) * a;
    if (acc > 0.95) break;
    t += stepLen;
  }
  if (acc <= 0.002) discard;
  fragColor = vec4(rgb, acc);
}
`;

export function mountStorms(parent: Group): void {
  let manifest: VolumeManifest | null = null;
  let mesh: Mesh | null = null;
  let material: ShaderMaterial | null = null;
  let volumeTex: Data3DTexture | null = null;
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
    manifest = null;
  };

  /** Box transform + height LUT from the manifest bounds; HOME-relative. */
  const place = (): void => {
    dispose();
    if (!stormsActive() || !manifest || !volumeTex) return;
    const { bounds, heightsKm, nz } = manifest;
    const layerY = heightsKm.map((km) => toScene(HOME.lat, HOME.lon, km * FT_PER_KM, tmp).y);
    const yBottom = layerY[0]!;
    const yTop = layerY[nz - 1]!;
    if (!(yTop > yBottom)) return;
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
        uSteps: { value: STEPS_DESKTOP },
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
    mesh.onBeforeRender = (renderer: WebGLRenderer): void => {
      if (material) material.uniforms.uSteps!.value = renderer.xr.isPresenting ? STEPS_XR : STEPS_DESKTOP;
    };
    parent.add(mesh);
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
      manifest = next;
      place();
    } catch {
      // Offline or upstream down: keep the last volume we drew.
    } finally {
      if (loadingTime === next.time) loadingTime = -1;
    }
  };

  const poll = async (): Promise<void> => {
    if (!stormsActive()) return;
    try {
      const res = await fetch(manifestUrl(HOME.lat, HOME.lon), { cache: 'no-store' });
      if (res.status === 503) {
        // New location: the service is cropping it now. Ask again shortly
        // instead of waiting a whole poll interval.
        if (retry === null) retry = window.setTimeout(() => { retry = null; void poll(); }, RETRY_MS);
        return;
      }
      if (!res.ok) return;
      const json: unknown = await res.json();
      const next = parseVolumeManifest(json);
      if (next === null) {
        if ((json as { coverage?: unknown } | null)?.coverage === false && !warnedCoverage) {
          warnedCoverage = true;
          console.info('[storms] this feed is outside MRMS coverage; 3D storms stay empty');
        }
        return;
      }
      if (manifest === null || next.time !== manifest.time) void load(next);
    } catch {
      // Keep whatever is drawn.
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
