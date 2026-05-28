import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  Texture,
  TextureLoader,
  Vector3
} from 'three';
import { HOME, RANGE_NM } from '../core/config';
import { toScene } from '../core/coords';

// Web Mercator basemap. nginx proxies /tiles/{provider}/{z}/{y}/{x} with a
// local on-disk cache pre-warmed by entrypoint.sh at zoom 8. Other zooms
// fall back through to upstream (Carto/ESRI/OSM) but pay a network round
// trip the first time.
//
// We compute each tile's geographic corners and project them through the
// same ENU helper the aircraft use, which gives a tile mesh that matches
// the rest of the scene's coordinate frame exactly.

export type TileProvider =
  | 'dark'
  | 'carto_voyager'
  | 'hillshade'
  | 'topo'
  | 'satellite'
  | 'osm'
  // US aeronautical charts via VFRMap (FAA-published, 56-day cycle).
  // The nginx upstream re-renders the URL at container start once it
  // discovers the current cycle date. US-only coverage.
  | 'sectional'         // pure VFR sectional
  | 'sectional_hybrid'  // VFR sectional overlaid with OSM roads
  | 'helicopter'        // helicopter route chart
  | 'ifr_low'           // IFR low-altitude enroute
  | 'ifr_high';         // IFR high-altitude enroute

// Per-provider metadata. `tms: true` means the upstream uses the TMS
// y-axis convention (origin at south) instead of standard XYZ — the
// URL builder flips y for those before going to nginx.
const PROVIDER_META: Record<TileProvider, { tms: boolean }> = {
  dark: { tms: false },
  carto_voyager: { tms: false },
  hillshade: { tms: false },
  topo: { tms: false },
  satellite: { tms: false },
  osm: { tms: false },
  sectional: { tms: true },
  sectional_hybrid: { tms: true },
  helicopter: { tms: true },
  ifr_low: { tms: true },
  ifr_high: { tms: true },
};

const DEFAULT_ZOOM = 8;

function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
}
function tileXToLon(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}
function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

const TILE_NM_AT_HOME = (() => {
  // Approximate tile span at home latitude in NM. At z=8 lat=45° this is ~60 NM.
  const lat = HOME.lat;
  const tileLonDeg = 360 / Math.pow(2, DEFAULT_ZOOM);
  const nmPerLonDeg = 60 * Math.cos((lat * Math.PI) / 180);
  return tileLonDeg * nmPerLonDeg;
})();

const tmpV = new Vector3();
function projectCorner(lat: number, lon: number, target: Float32Array, offset: number, dropY: number): void {
  toScene(lat, lon, 0, tmpV);
  target[offset] = tmpV.x;
  target[offset + 1] = dropY;
  target[offset + 2] = tmpV.z;
}

function buildTileMesh(z: number, x: number, y: number, texture: Texture, dropY: number): Mesh {
  const west = tileXToLon(x, z);
  const east = tileXToLon(x + 1, z);
  const north = tileYToLat(y, z);
  const south = tileYToLat(y + 1, z);

  // Two triangles, NW-NE-SW + NE-SE-SW. UVs map north→v=1, south→v=0
  // (slippy-tile origin is top-left, but flipY=true on the texture
  // already accounts for that, so v increases northward here).
  const positions = new Float32Array(18);
  projectCorner(north, west, positions, 0, dropY);
  projectCorner(north, east, positions, 3, dropY);
  projectCorner(south, west, positions, 6, dropY);
  projectCorner(north, east, positions, 9, dropY);
  projectCorner(south, east, positions, 12, dropY);
  projectCorner(south, west, positions, 15, dropY);

  const uvs = new Float32Array([
    0, 1,
    1, 1,
    0, 0,
    1, 1,
    1, 0,
    0, 0
  ]);

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('uv', new BufferAttribute(uvs, 2));

  // DoubleSide because our triangle winding produces a -y face normal;
  // the camera looks down at +y so without DoubleSide the tile is culled.
  const material = new MeshBasicMaterial({ map: texture, depthWrite: false, side: DoubleSide });
  const mesh = new Mesh(geom, material);
  mesh.renderOrder = -10; // draw before transparent overlays (rings, trails, altitude lines)
  mesh.userData = { kind: 'tile', z, x, y };
  return mesh;
}

export interface TileLayerOptions {
  provider?: TileProvider;
  zoom?: number;
  basePath?: string;
  /** Drop tiles slightly below y=0 so range rings/grids stay crisply on top. */
  dropY?: number;
}

export function createTileLayer(options: TileLayerOptions = {}): Group {
  const provider = options.provider ?? 'dark';
  const zoom = options.zoom ?? DEFAULT_ZOOM;
  const basePath = options.basePath ?? '';
  const dropY = options.dropY ?? -0.4;

  const group = new Group();
  group.name = `tiles-${provider}-z${zoom}`;

  const cx = lonToTileX(HOME.lon, zoom);
  const cy = latToTileY(HOME.lat, zoom);
  const cxFloor = Math.floor(cx);
  const cyFloor = Math.floor(cy);

  // Cover RANGE_NM in each direction, +1 tile padding so the range ring is
  // never at a tile boundary.
  const half = Math.ceil(RANGE_NM / TILE_NM_AT_HOME) + 1;

  const loader = new TextureLoader();
  loader.crossOrigin = 'anonymous';

  let queued = 0;
  let loaded = 0;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const x = cxFloor + dx;
      const y = cyFloor + dy;
      // Skip out-of-range tiles at world poles/wraps (z=8 has 256 tiles per side).
      const nMax = Math.pow(2, zoom);
      if (x < 0 || y < 0 || x >= nMax || y >= nMax) continue;

      queued++;
      // TMS providers number y from the south, XYZ from the north. nginx
      // proxies what we send straight through to the upstream, so flip
      // here before constructing the URL.
      const yForUrl = PROVIDER_META[provider].tms ? nMax - 1 - y : y;
      const url = `${basePath}/tiles/${provider}/${zoom}/${yForUrl}/${x}`;
      loader.load(
        url,
        (texture) => {
          texture.colorSpace = 'srgb';
          texture.wrapS = RepeatWrapping;
          texture.wrapT = RepeatWrapping;
          texture.anisotropy = 4;
          const mesh = buildTileMesh(zoom, x, y, texture, dropY);
          group.add(mesh);
          loaded++;
        },
        undefined,
        () => {
          // 404 / network failure: silently skip. The disc/grid still
          // give spatial reference, and tiles will retry on reload.
          loaded++;
        }
      );
    }
  }
  group.userData = { provider, zoom, queued, get loaded() { return loaded; } };

  return group;
}
