import { describe, expect, it } from 'vitest';
import { firstRunDefaults, getDefaultSettings } from '../src/core/settings';

describe('firstRunDefaults', () => {
  it('matches the defaults unless the OS asks for reduced motion', () => {
    expect(firstRunDefaults(false)).toEqual(getDefaultSettings());
    const reduced = firstRunDefaults(true);
    expect(reduced.smoothMotion).toBe(false);
    expect(reduced.autoOrbit).toBe(0);
    expect({ ...reduced, smoothMotion: true, autoOrbit: getDefaultSettings().autoOrbit }).toEqual(getDefaultSettings());
  });
});
