import { describe, expect, it, vi } from 'vitest';
import { AircraftStore, MAX_TRAIL_POINTS, type TrailPoint } from '../src/aircraft/store';

const pt = (ms: number, lat = 0, lon = 0, altFt = 0): TrailPoint => ({ ms, lat, lon, altFt });

describe('AircraftStore.setTrail', () => {
  it('empty array deletes the existing entry', () => {
    const s = new AircraftStore();
    s.setTrail('abc', [pt(1), pt(2)]);
    expect(s.trails('abc')).toHaveLength(2);
    s.setTrail('abc', []);
    expect(s.trails('abc')).toBeUndefined();
  });

  it('stores under-cap input at the given length', () => {
    const s = new AircraftStore();
    s.setTrail('abc', [pt(1), pt(2), pt(3)]);
    expect(s.trails('abc')).toHaveLength(3);
  });

  it('trims over-cap input to the last MAX_TRAIL_POINTS points', () => {
    const s = new AircraftStore();
    const n = MAX_TRAIL_POINTS + 100;
    const input: TrailPoint[] = [];
    for (let i = 0; i < n; i++) input.push(pt(i));
    s.setTrail('abc', input);
    const stored = s.trails('abc')!;
    expect(stored).toHaveLength(MAX_TRAIL_POINTS);
    expect(stored[0]!.ms).toBe(n - MAX_TRAIL_POINTS);
    expect(stored[stored.length - 1]!.ms).toBe(n - 1);
  });

  it('array-copies its input: pushing onto the source after the call does not lengthen the stored trail', () => {
    // setTrail spreads `[...trimmed]` so callers can mutate the array
    // shape (push/splice/length=). It does NOT deep-copy individual
    // TrailPoint fields — callers in practice always pass freshly
    // built TrailPoints, so the cheaper shallow copy is enough.
    const s = new AircraftStore();
    const input = [pt(1, 10), pt(2, 20)];
    s.setTrail('abc', input);
    input.push(pt(3, 30));
    input.length = 0;
    expect(s.trails('abc')).toHaveLength(2);
  });
});

describe('AircraftStore.mergeHistory', () => {
  it('empty history is a no-op (does not fire listener)', () => {
    const s = new AircraftStore();
    const spy = vi.fn();
    s.subscribe(spy);
    s.mergeHistory('abc', []);
    expect(spy).not.toHaveBeenCalled();
  });

  it('merges into empty existing → history becomes the full trail', () => {
    const s = new AircraftStore();
    s.mergeHistory('abc', [pt(1), pt(2), pt(3)]);
    expect(s.trails('abc')!.map((p) => p.ms)).toEqual([1, 2, 3]);
  });

  it('prepends strictly-older history ahead of the existing trail', () => {
    const s = new AircraftStore();
    s.setTrail('abc', [pt(100), pt(200)]);
    s.mergeHistory('abc', [pt(10), pt(50)]);
    expect(s.trails('abc')!.map((p) => p.ms)).toEqual([10, 50, 100, 200]);
  });

  it('drops history at the first overlap with existing oldest (ascending early-break)', () => {
    const s = new AircraftStore();
    s.setTrail('abc', [pt(100), pt(200)]);
    s.mergeHistory('abc', [pt(50), pt(99), pt(100), pt(150)]);
    expect(s.trails('abc')!.map((p) => p.ms)).toEqual([50, 99, 100, 200]);
  });

  it('fully-overlapping history is a no-op (no listener fire, trail unchanged)', () => {
    const s = new AircraftStore();
    s.setTrail('abc', [pt(100), pt(200)]);
    const spy = vi.fn();
    s.subscribe(spy);
    s.mergeHistory('abc', [pt(100), pt(150), pt(200)]);
    expect(spy).not.toHaveBeenCalled();
    expect(s.trails('abc')!.map((p) => p.ms)).toEqual([100, 200]);
  });

  it('caps total length at MAX_TRAIL_POINTS, trimming the oldest points', () => {
    const s = new AircraftStore();
    const existing: TrailPoint[] = [];
    for (let i = 0; i < 500; i++) existing.push(pt(1000 + i));
    s.setTrail('abc', existing);
    const history: TrailPoint[] = [];
    for (let i = 0; i < 200; i++) history.push(pt(i));
    s.mergeHistory('abc', history);
    const stored = s.trails('abc')!;
    expect(stored).toHaveLength(MAX_TRAIL_POINTS);
    // Concatenated would be [0..199, 1000..1499] = 700; trim first 100.
    expect(stored[0]!.ms).toBe(100);
    expect(stored[stored.length - 1]!.ms).toBe(1499);
  });

  it('listener fires exactly once on a successful merge', () => {
    const s = new AircraftStore();
    const spy = vi.fn();
    s.subscribe(spy);
    s.mergeHistory('abc', [pt(1)]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
