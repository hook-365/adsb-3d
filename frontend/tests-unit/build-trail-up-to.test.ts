import { describe, expect, it } from 'vitest';
import { buildTrailUpTo, type HistoricalSample } from '../src/feed/historical';
import { MAX_TRAIL_POINTS } from '../src/aircraft/store';

const sample = (ms: number): HistoricalSample => ({
  ms,
  lat: ms * 0.001,
  lon: ms * 0.002,
  altFt: ms * 0.1,
  flight: null,
  gsKt: null,
  trackDeg: null,
  category: null,
});

describe('buildTrailUpTo', () => {
  it('empty input returns empty', () => {
    expect(buildTrailUpTo([], 0)).toEqual([]);
  });

  it('cursor before all samples returns empty', () => {
    expect(buildTrailUpTo([sample(100), sample(200)], 50)).toEqual([]);
  });

  it('cursor exactly at first sample ms returns one point', () => {
    const r = buildTrailUpTo([sample(100), sample(200)], 100);
    expect(r).toHaveLength(1);
    expect(r[0]!.ms).toBe(100);
  });

  it('cursor exactly at last sample ms returns all points', () => {
    expect(buildTrailUpTo([sample(100), sample(200), sample(300)], 300)).toHaveLength(3);
  });

  it('cursor between samples returns only points with ms <= cursor', () => {
    const r = buildTrailUpTo([sample(100), sample(200), sample(300)], 250);
    expect(r.map((p) => p.ms)).toEqual([100, 200]);
  });

  it('cursor after all samples returns all points', () => {
    expect(buildTrailUpTo([sample(100), sample(200), sample(300)], 9999)).toHaveLength(3);
  });

  it('caps result at MAX_TRAIL_POINTS, keeping the most recent N', () => {
    const n = MAX_TRAIL_POINTS + 50;
    const samples: HistoricalSample[] = [];
    for (let i = 0; i < n; i++) samples.push(sample(i * 1000));
    const r = buildTrailUpTo(samples, n * 1000);
    expect(r).toHaveLength(MAX_TRAIL_POINTS);
    expect(r[0]!.ms).toBe((n - MAX_TRAIL_POINTS) * 1000);
    expect(r[r.length - 1]!.ms).toBe((n - 1) * 1000);
  });

  it('returns TrailPoint shape (lat/lon/altFt/ms only — no flight, gsKt, etc.)', () => {
    const r = buildTrailUpTo([sample(100)], 100);
    expect(r[0]).toEqual({ lat: 0.1, lon: 0.2, altFt: 10, ms: 100 });
    expect(Object.keys(r[0]!).sort()).toEqual(['altFt', 'lat', 'lon', 'ms']);
  });
});
