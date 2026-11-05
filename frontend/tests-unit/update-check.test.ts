import { describe, expect, it } from 'vitest';
import { baseVersion, isNewerVersion, parseUpdateJson } from '../src/core/update-check';

describe('update-check version comparison', () => {
  it('strips v prefix and build metadata', () => {
    expect(baseVersion('v0.12.1')).toBe('0.12.1');
    expect(baseVersion('0.12.1+a1b2c3d')).toBe('0.12.1');
    expect(baseVersion('0.12.1+local')).toBe('0.12.1');
    expect(baseVersion('0.0.0+unknown')).toBe('0.0.0');
    expect(baseVersion('dev')).toBeNull();
    expect(baseVersion('')).toBeNull();
  });

  it('compares numerically, not lexically', () => {
    expect(isNewerVersion('0.13.0', '0.12.1')).toBe(true);
    expect(isNewerVersion('0.12.10', '0.12.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('0.12.1', '0.12.1')).toBe(false);
    expect(isNewerVersion('0.12.0', '0.12.1')).toBe(false);
  });

  it('treats a dev build of a release as that release', () => {
    expect(isNewerVersion('0.12.1', '0.12.1+a1b2c3d')).toBe(false);
    expect(isNewerVersion('0.12.2', '0.12.1+a1b2c3d')).toBe(true);
  });

  it('never flags when either side is not a version', () => {
    expect(isNewerVersion('0.13.0', 'dev')).toBe(false);
    expect(isNewerVersion('garbage', '0.12.1')).toBe(false);
  });
});

describe('parseUpdateJson', () => {
  const ok = {
    current: '0.12.1',
    latest: '0.13.0',
    url: 'https://github.com/hook-365/adsb-3d/releases/tag/v0.13.0',
    checkedAt: '2026-11-05T00:00:00Z',
  };

  it('accepts the entrypoint payload and compares against the page version', () => {
    expect(parseUpdateJson(ok, '0.12.1')).toEqual({
      current: '0.12.1',
      latest: '0.13.0',
      url: ok.url,
      newer: true,
    });
    expect(parseUpdateJson(ok, '0.13.0')?.newer).toBe(false);
  });

  it('falls back to the payload current when the page has no version', () => {
    expect(parseUpdateJson(ok, undefined)?.newer).toBe(true);
  });

  it('rejects malformed or foreign payloads', () => {
    expect(parseUpdateJson(null, '0.12.1')).toBeNull();
    expect(parseUpdateJson({ latest: 'x' }, '0.12.1')).toBeNull();
    expect(parseUpdateJson({ latest: '0.13.0' }, 'dev')).toBeNull();
    // A non-GitHub url is replaced by the releases index, never followed blindly.
    expect(parseUpdateJson({ ...ok, url: 'https://evil.example/' }, '0.12.1')?.url).toBe(
      'https://github.com/hook-365/adsb-3d/releases',
    );
  });
});
