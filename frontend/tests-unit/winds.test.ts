// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { GRID, LEVELS, gridAxes, parseWinds, windAt, windComponents } from '../src/world/winds';

/** An Open-Meteo answer where every point has the same wind at every level. */
function uniform(lats: number[], lons: number[], speed: number, dir: number, over: Record<number, [number, number]> = {}) {
  return lats.flatMap(() =>
    lons.map(() => ({
      hourly: Object.fromEntries(
        LEVELS.flatMap(({ hPa }) => {
          const [s, d] = over[hPa] ?? [speed, dir];
          return [
            [`wind_speed_${hPa}hPa`, [s]],
            [`wind_direction_${hPa}hPa`, [d]],
          ];
        }),
      ),
    })),
  );
}

describe('gridAxes', () => {
  const { lats, lons } = gridAxes(44.88, -93.22);
  it('is a 7 by 7 grid centred on the place, 70 NM apart', () => {
    expect(lats).toHaveLength(GRID);
    expect(lons).toHaveLength(GRID);
    expect(lats[1]! - lats[0]!).toBeCloseTo(70 / 60, 1);
    expect((lats[0]! + lats[GRID - 1]!) / 2).toBeCloseTo(44.88, 0);
    expect((lons[0]! + lons[GRID - 1]!) / 2).toBeCloseTo(-93.22, 0);
  });
  it('asks for the same grid from anywhere nearby, so the proxy cache is shared', () => {
    expect(gridAxes(44.9, -93.2)).toEqual(gridAxes(44.88, -93.22));
  });
  it('fits what the proxy accepts: two decimals at most', () => {
    for (const v of [...lats, ...lons]) expect(String(v)).toMatch(/^-?\d{1,3}(\.\d{1,2})?$/);
  });
});

describe('parseWinds and windAt', () => {
  const { lats, lons } = gridAxes(45, -93);

  it('gives back the wind it was given, anywhere inside the grid', () => {
    const grid = parseWinds(uniform(lats, lons, 60, 270), lats, lons)!;
    const w = windAt(grid, 45, -93, 30000)!;
    expect(w.speedKt).toBeCloseTo(60, 3);
    expect(w.dirDeg).toBeCloseTo(270, 3);
  });

  it('interpolates between levels and holds the outermost level beyond them', () => {
    const grid = parseWinds(uniform(lats, lons, 0, 0, { 850: [20, 180], 700: [40, 180], 250: [100, 180] }), lats, lons)!;
    expect(windAt(grid, 45, -93, 7500)!.speedKt).toBeCloseTo(30, 3); // halfway from 5,000 to 10,000 ft
    expect(windAt(grid, 45, -93, 1000)!.speedKt).toBeCloseTo(20, 3);
    expect(windAt(grid, 45, -93, 41000)!.speedKt).toBeCloseTo(100, 3);
  });

  it('averages directions through north, not through south', () => {
    const json = uniform(lats, lons, 50, 350);
    // East half of the grid blows from 010.
    json.forEach((p, i) => {
      if (i % GRID >= 3) for (const { hPa } of LEVELS) (p.hourly as Record<string, number[]>)[`wind_direction_${hPa}hPa`] = [10];
    });
    const grid = parseWinds(json, lats, lons)!;
    const mid = windAt(grid, 45, (lons[2]! + lons[3]!) / 2, 30000)!;
    expect(Math.min(mid.dirDeg, 360 - mid.dirDeg)).toBeLessThan(1);
  });

  it('is null outside the grid and for an answer of the wrong shape', () => {
    const grid = parseWinds(uniform(lats, lons, 60, 270), lats, lons)!;
    expect(windAt(grid, 60, -93, 30000)).toBeNull();
    expect(parseWinds([], lats, lons)).toBeNull();
    expect(parseWinds({ error: true }, lats, lons)).toBeNull();
  });

  it('leaves a missing point missing instead of calling it calm', () => {
    const json = uniform(lats, lons, 60, 270);
    (json[0]!.hourly as Record<string, unknown>).wind_speed_300hPa = [null];
    const grid = parseWinds(json, lats, lons)!;
    expect(windAt(grid, lats[0]! + 0.1, lons[0]! + 0.1, 30000)).toBeNull();
  });
});

describe('windComponents', () => {
  it('splits the wind into head or tail and cross', () => {
    const west = { dirDeg: 270, speedKt: 80 };
    expect(windComponents(west, 270).headKt).toBeCloseTo(80, 6); // flying into it
    expect(windComponents(west, 90).headKt).toBeCloseTo(-80, 6); // riding it
    const north = windComponents(west, 360);
    expect(north.headKt).toBeCloseTo(0, 6);
    expect(north.crossKt).toBeCloseTo(-80, 6); // from the left
  });
});
