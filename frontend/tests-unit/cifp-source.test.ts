import { describe, expect, it } from 'vitest';
import { refreshedSource } from '../src/world/cifp-source';

const manifest = { cycle: '2612', effective: '2026-11-26', expires: '2026-12-24' };

describe('refreshedSource', () => {
  it('uses a newer edition, with the cycle in every URL', () => {
    const s = refreshedSource(manifest, '2026-10-29')!;
    expect(s.refreshed).toBe(true);
    expect(s.indexUrl).toBe('/cifp/procedures-index.json?c=2612');
    expect(s.packUrl).toBe('/cifp/procedures.pack?c=2612');
    expect(s.navdataUrl).toBe('/cifp/navdata.json?c=2612');
  });
  it('keeps the bundled copy when the fetched edition is the same or older', () => {
    expect(refreshedSource(manifest, '2026-11-26')).toBeNull();
    expect(refreshedSource(manifest, '2026-12-24')).toBeNull();
  });
  it('ignores anything malformed', () => {
    expect(refreshedSource({ ...manifest, cycle: '26/12' }, '2026-10-29')).toBeNull();
    expect(refreshedSource({ ...manifest, effective: 'soon' }, '2026-10-29')).toBeNull();
    expect(refreshedSource(null, '2026-10-29')).toBeNull();
    expect(refreshedSource('<!doctype html>', '2026-10-29')).toBeNull();
  });
});
