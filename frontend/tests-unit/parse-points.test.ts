import { describe, expect, it } from 'vitest';
import { parsePoints } from '../src/feed/history';

// parsePoints walks raw history samples in time order and forward-inherits
// the last known altitude through frames that lack alt_baro / alt_geom.
// This guard prevents the backfilled historical trail from dipping to
// ground every time the upstream feed missed an altitude in a sample.

interface RawTrackPoint {
  time?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string | null;
  alt_geom?: number | null;
}

const pt = (over: RawTrackPoint): RawTrackPoint => ({
  time: '2026-05-28T12:00:00Z',
  lat: 47.0,
  lon: 8.5,
  ...over,
});

describe('parsePoints altitude handling', () => {
  it('returns empty for undefined or empty input', () => {
    expect(parsePoints(undefined)).toEqual([]);
    expect(parsePoints([])).toEqual([]);
  });

  it('uses alt_baro when present', () => {
    const out = parsePoints([pt({ alt_baro: 31000 })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.altFt).toBe(31000);
  });

  it('falls back to alt_geom when alt_baro missing', () => {
    const out = parsePoints([pt({ alt_baro: null, alt_geom: 30500 })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.altFt).toBe(30500);
  });

  it('treats alt_baro="ground" as a real zero, not as missing data', () => {
    const out = parsePoints([
      pt({ time: '2026-05-28T12:00:00Z', alt_baro: 'ground' }),
      pt({ time: '2026-05-28T12:00:01Z', alt_baro: null }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.altFt).toBe(0);
    // Second point inherits ground=0, not a fictional cruise altitude.
    expect(out[1]!.altFt).toBe(0);
  });

  it('forward-inherits altitude through a no-altitude frame', () => {
    const out = parsePoints([
      pt({ time: '2026-05-28T12:00:00Z', alt_baro: 35000 }),
      pt({ time: '2026-05-28T12:00:01Z', alt_baro: null, alt_geom: null }),
      pt({ time: '2026-05-28T12:00:02Z', alt_baro: 35000 }),
    ]);
    expect(out).toHaveLength(3);
    expect(out.map((p) => p.altFt)).toEqual([35000, 35000, 35000]);
  });

  it('inheritance picks the most recent good altitude, not the first', () => {
    const out = parsePoints([
      pt({ time: '2026-05-28T12:00:00Z', alt_baro: 10000 }),
      pt({ time: '2026-05-28T12:00:01Z', alt_baro: 22000 }),
      pt({ time: '2026-05-28T12:00:02Z', alt_baro: null }),
    ]);
    expect(out[2]!.altFt).toBe(22000);
  });

  it('drops leading no-altitude frames (no prior good fix)', () => {
    const out = parsePoints([
      pt({ time: '2026-05-28T12:00:00Z', alt_baro: null }),
      pt({ time: '2026-05-28T12:00:01Z', alt_baro: null }),
      pt({ time: '2026-05-28T12:00:02Z', alt_baro: 30000 }),
    ]);
    // First two dropped; only the point with real altitude survives.
    expect(out).toHaveLength(1);
    expect(out[0]!.altFt).toBe(30000);
  });

  it('sorts unsorted input before walking, so inheritance follows time order', () => {
    const out = parsePoints([
      pt({ time: '2026-05-28T12:00:02Z', alt_baro: null }),
      pt({ time: '2026-05-28T12:00:00Z', alt_baro: 35000 }),
      pt({ time: '2026-05-28T12:00:01Z', alt_baro: null }),
    ]);
    expect(out.map((p) => p.altFt)).toEqual([35000, 35000, 35000]);
  });

  it('drops samples missing lat/lon entirely', () => {
    // Cast through unknown so we can construct a malformed RawTrackPoint
    // (lat omitted) to exercise the parser's guard.
    const malformed = { time: '2026-05-28T12:00:00Z', lon: 8.5, alt_baro: 30000 } as unknown as RawTrackPoint;
    const out = parsePoints([
      malformed,
      pt({ lat: 47.0, lon: 8.5, alt_baro: 30000 }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('drops samples with unparseable time', () => {
    const out = parsePoints([
      pt({ time: 'not-a-date', alt_baro: 30000 }),
      pt({ time: '2026-05-28T12:00:00Z', alt_baro: 30000 }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('alt_baro=0 numeric is honored as real, not treated as missing', () => {
    const out = parsePoints([pt({ alt_baro: 0 })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.altFt).toBe(0);
  });
});
