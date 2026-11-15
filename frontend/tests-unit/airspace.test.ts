// @vitest-environment jsdom
// 3D airspace: the volume data model (world/airspace-volumes.ts), the
// extrusion (world/airspace.ts) and the committed FAA-derived data file.
import dataText from '../src/world/airspace-data.json?raw';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  airspaceTitle,
  decodeVolumes,
  distanceToVolumeNm,
  limitsMsl,
  overVolume,
  pointInRing,
  volumesAt,
  volumesNear,
  type AirspaceKind,
} from '../src/world/airspace-volumes';
import { AIRSPACE_COLORS, airspaceLimits, airspaceSummary, buildVolumeMesh, countInside, frameOf } from '../src/world/airspace';
import { mountAirspacePanel, shelfRows } from '../src/ui/airspace-panel';

// A 1 x 1 degree square shelf with a quarter-degree hole in the middle,
// and a surface cylinder (drawn as a square) inside that hole.
const SQUARE = [0, 0, 1, 0, 1, 1, 0, 1];
const HOLE = [0.4, 0.4, 0.6, 0.4, 0.6, 0.6, 0.4, 0.6];
const RAW = {
  volumes: [
    { n: 'TEST CITY CLASS B', k: 'B', s: 'AREA B', lo: 3000, hi: 10000, g: [[SQUARE, HOLE]] },
    { n: 'TEST CITY CLASS B', k: 'B', s: 'AREA A', lo: 0, la: 1, hi: 10000, g: [[HOLE]] },
    { n: 'R-1234A', k: 'R', lo: 500, la: 1, hi: 60000, u: 1, t: 'BY NOTAM', g: [[[5, 5, 6, 5, 6, 6, 5, 6]]] },
    { n: 'bogus', k: 'E', lo: 0, hi: 1, g: [[SQUARE]] },
    { n: 'no geometry', k: 'C', lo: 0, hi: 1, g: [] },
  ],
};
const VOLUMES = decodeVolumes(RAW);
const [shelf, core, restricted] = VOLUMES as [(typeof VOLUMES)[0], (typeof VOLUMES)[0], (typeof VOLUMES)[0]];

describe('decodeVolumes', () => {
  it('keeps known kinds with geometry and derives a bounding box', () => {
    expect(VOLUMES).toHaveLength(3);
    expect(shelf.bbox).toEqual([0, 0, 1, 1]);
    expect(shelf.sector).toBe('AREA B');
    expect(core.loAgl).toBe(true);
    expect(restricted.unlimited).toBe(true);
    expect(restricted.times).toBe('BY NOTAM');
  });

  it('returns nothing for a malformed document', () => {
    expect(decodeVolumes(null)).toEqual([]);
    expect(decodeVolumes({ volumes: 'x' })).toEqual([]);
  });
});

describe('point in volume', () => {
  it('tests rings by even-odd crossing', () => {
    expect(pointInRing(SQUARE, 0.5, 0.5)).toBe(true);
    expect(pointInRing(SQUARE, 1.5, 0.5)).toBe(false);
  });

  it('treats holes as outside the footprint', () => {
    expect(overVolume(shelf, 0.1, 0.1)).toBe(true);
    expect(overVolume(shelf, 0.5, 0.5)).toBe(false);
    expect(overVolume(core, 0.5, 0.5)).toBe(true);
  });

  it('measures above-ground limits from the ground under the volume', () => {
    expect(limitsMsl(restricted, 1200)).toEqual({ lo: 1700, hi: 60000 });
    expect(limitsMsl(shelf, 1200)).toEqual({ lo: 3000, hi: 10000 });
  });

  it('finds the containing volumes, ceiling inclusive', () => {
    const at = (lat: number, lon: number, alt: number, ground = 800, onGround = false): string[] =>
      volumesAt(VOLUMES, lat, lon, alt, ground, onGround).map((v) => v.sector ?? v.name);
    expect(at(0.1, 0.1, 2500)).toEqual([]);
    expect(at(0.1, 0.1, 3000)).toEqual(['AREA B']);
    expect(at(0.1, 0.1, 10000)).toEqual(['AREA B']);
    expect(at(0.1, 0.1, 10100)).toEqual([]);
    expect(at(0.5, 0.5, 900)).toEqual(['AREA A']);
    // On the ground: only volumes that start at the surface.
    expect(at(0.5, 0.5, 0, 800, true)).toEqual(['AREA A']);
    expect(at(0.1, 0.1, 0, 800, true)).toEqual([]);
    // 500 ft AGL floor over 1,200 ft ground starts at 1,700 ft MSL.
    expect(at(5.5, 5.5, 1600, 1200)).toEqual([]);
    expect(at(5.5, 5.5, 1700, 1200)).toEqual(['R-1234A']);
  });

  it('filters by distance to the bounding box and by kind', () => {
    expect(distanceToVolumeNm(shelf, 0.5, 0.5)).toBe(0);
    expect(distanceToVolumeNm(shelf, 2, 0.5)).toBeCloseTo(60, 5);
    const kinds = (list: AirspaceKind[]): Set<AirspaceKind> => new Set(list);
    expect(volumesNear(VOLUMES, 0.5, 0.5, 50, kinds(['B', 'R']))).toHaveLength(2);
    expect(volumesNear(VOLUMES, 0.5, 0.5, 500, kinds(['B', 'R']))).toHaveLength(3);
    expect(volumesNear(VOLUMES, 0.5, 0.5, 500, kinds(['R']))).toEqual([restricted]);
  });
});

describe('names and limits', () => {
  it('title-cases names but leaves designators and acronyms alone', () => {
    expect(airspaceTitle('MINNEAPOLIS CLASS B')).toBe('Minneapolis Class B');
    expect(airspaceTitle('VOLK FALLS MOA')).toBe('Volk Falls MOA');
    expect(airspaceTitle('R-6904A')).toBe('R-6904A');
    expect(airspaceTitle('WINSTON-SALEM CLASS D')).toBe('Winston-Salem Class D');
    expect(airspaceTitle('AREA A')).toBe('Area A');
  });

  it('formats limits with SFC, AGL and UNL', () => {
    expect(airspaceLimits(core)).toBe('SFC to 10,000 ft');
    expect(airspaceLimits(shelf)).toBe('3,000 ft to 10,000 ft');
    expect(airspaceLimits(restricted)).toBe('500 ft AGL to UNL');
    expect(airspaceSummary(shelf)).toBe('Test City Class B, Area B: 3,000 ft to 10,000 ft');
  });
});

describe('buildVolumeMesh', () => {
  const project = (lat: number, lon: number, alt: number, out: Vector3): Vector3 => out.set(lon, alt, -lat);

  it('extrudes walls for every ring and floors only raised shelves', () => {
    const one = buildVolumeMesh([core], project, () => 0);
    // 4 wall quads, no floor: the volume starts at the surface.
    expect(one.positions.length).toBe(8 * 3);
    expect(one.indices.length).toBe(4 * 6);
    expect(one.lines.length).toBe(4 * 2 * 2 * 3);

    const two = buildVolumeMesh([shelf], project, () => 0);
    // Outline + hole walls (8 quads) plus a floor: a square with a square
    // hole triangulates into 8 triangles.
    expect(two.positions.length).toBe(16 * 3);
    expect(two.indices.length).toBe(8 * 6 + 8 * 3);
    // Every index points at an emitted vertex, floor faces at floor vertices.
    expect(Math.max(...two.indices)).toBeLessThan(16);
    const floorFaces = Array.from(two.indices.slice(8 * 6));
    for (const i of floorFaces) expect(two.positions[i * 3 + 1]).toBe(3000);
  });

  it('places above-ground limits on the supplied ground and skips empty volumes', () => {
    const m = buildVolumeMesh([restricted], project, () => 1200);
    expect(Math.min(...Array.from(m.positions).filter((_, i) => i % 3 === 1))).toBe(1700);
    const flat = decodeVolumes({ volumes: [{ n: 'X', k: 'D', lo: 2000, hi: 500, ha: 1, g: [[SQUARE]] }] });
    expect(buildVolumeMesh(flat, project, () => 0).indices.length).toBe(0);
  });
});

describe('frameOf', () => {
  const project = (lat: number, lon: number, alt: number, out: Vector3): Vector3 => out.set(lon, alt, -lat);

  it('bounds every shelf of an airspace in scene space', () => {
    const box = frameOf([shelf, core], project, () => 800)!;
    expect(box.center.x).toBeCloseTo(0.5);
    expect(box.center.z).toBeCloseTo(-0.5);
    expect(box.radius).toBeCloseTo(Math.SQRT2 / 2);
    // Surface core over 800 ft ground up to the shared 10,000 ft ceiling.
    expect(box.yLo).toBe(800);
    expect(box.yHi).toBe(10000);
    expect(frameOf([], project, () => 0)).toBeNull();
  });
});

describe('airspace info panel', () => {
  const selection = {
    core,
    volumes: [shelf, core],
    floor: core,
    ceiling: shelf,
    frame: { center: new Vector3(), radius: 1, yLo: 0, yHi: 1 },
  };

  it('lists shelves lowest floor first and collapses repeats', () => {
    expect(shelfRows([shelf, core, shelf])).toEqual([
      { label: 'Area A', limits: 'SFC to 10,000 ft' },
      { label: 'Area B', limits: '3,000 ft to 10,000 ft' },
    ]);
  });

  it('counts the aircraft inside any of the volumes', () => {
    const at = (lat: number, lon: number, altFt: number) => ({ lat, lon, altFt, onGround: false });
    expect(countInside([shelf, core], [at(0.1, 0.1, 5000), at(0.5, 0.5, 900), at(0.1, 0.1, 500), at(9, 9, 5000)])).toBe(2);
  });

  it('describes the airspace, then hides on close', () => {
    const panel = mountAirspacePanel(() => []);
    const root = document.querySelector<HTMLElement>('.airspace-panel')!;
    expect(root.hidden).toBe(true);
    panel.show(selection);
    expect(root.hidden).toBe(false);
    expect(root.querySelector('.airspace-title')!.textContent).toBe('Test City Class B');
    expect(root.querySelector('.airspace-kind')!.textContent).toBe('Class B airspace');
    expect(root.querySelector('.airspace-about')!.textContent).toContain('ATC clearance');
    expect(root.querySelectorAll('.airspace-shelves dt')).toHaveLength(2);
    // No published times for controlled airspace: the row stays out.
    expect(root.querySelector<HTMLElement>('.airspace-times')!.hidden).toBe(true);
    panel.show({ ...selection, core: restricted, volumes: [restricted], floor: restricted, ceiling: restricted });
    expect(root.querySelector('.airspace-kind')!.textContent).toBe('Restricted area');
    expect(root.querySelector<HTMLElement>('.airspace-times')!.textContent).toBe('BY NOTAM');
    expect(root.querySelector<HTMLElement>('.airspace-shelves')!.hidden).toBe(true);
    root.querySelector<HTMLButtonElement>('.close')!.click();
    expect(root.hidden).toBe(true);
  });
});

describe('committed FAA data file', () => {
  const raw = JSON.parse(dataText) as { volumes: unknown[] };
  const volumes = decodeVolumes(raw);

  it('decodes completely and covers every kind the layer draws', () => {
    expect(volumes.length).toBe(raw.volumes.length);
    expect(volumes.length).toBeGreaterThan(2000);
    // TFRs are the one live kind (world/tfr.ts); everything else is in the file.
    expect(new Set(volumes.map((v) => v.kind))).toEqual(new Set(Object.keys(AIRSPACE_COLORS).filter((k) => k !== 'TFR')));
    for (const v of volumes) {
      expect(v.polygons.length).toBeGreaterThan(0);
      for (const poly of v.polygons) for (const ring of poly) expect(ring.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('has the Minneapolis Class B stack, surface core included', () => {
    const msp = volumes.filter((v) => v.name === 'MINNEAPOLIS CLASS B');
    expect(msp.length).toBeGreaterThanOrEqual(5);
    const coreShelf = msp.find((v) => v.sector === 'AREA A')!;
    expect(coreShelf.loAgl && coreShelf.loFt === 0).toBe(true);
    // Over the airport at 5,000 ft: inside the core.
    expect(volumesAt(msp, 44.8848, -93.2223, 5000, 840)).toContain(coreShelf);
  });
});
