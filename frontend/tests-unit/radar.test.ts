// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { latestRadarFrame } from '../src/world/radar';

describe('latestRadarFrame', () => {
  it('picks the newest past frame and its opaque path id', () => {
    const json = {
      host: 'https://tilecache.rainviewer.com',
      radar: {
        past: [
          { time: 1700000000, path: '/v2/radar/04a2c647e007' },
          { time: 1700000600, path: '/v2/radar/575d4af3e455' },
        ],
        nowcast: [{ time: 1700001200, path: '/v2/radar/nowcast_abc' }],
      },
    };
    expect(latestRadarFrame(json)).toEqual({ time: 1700000600, id: '575d4af3e455' });
  });
  it('still accepts the old numeric paths and rejects junk', () => {
    expect(latestRadarFrame({ radar: { past: [{ time: 1700000300, path: '/v2/radar/1700000300' }] } })).toEqual({ time: 1700000300, id: '1700000300' });
    expect(latestRadarFrame({ radar: { past: [] } })).toBeNull();
    expect(latestRadarFrame(null)).toBeNull();
    expect(latestRadarFrame({ radar: { past: [{ time: 'x', path: 3 }] } })).toBeNull();
  });
});
