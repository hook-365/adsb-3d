import { describe, it, expect } from 'vitest';
import { en, EN_NAMESPACES } from '../src/core/strings/en';
import { LOCALES } from '../src/core/i18n';

// Drift guard in the spirit of theme.test.ts: every locale must define
// exactly the key set English defines, with matching {placeholders}, and
// namespaces must not collide (a duplicate key across two namespace
// modules would silently override in the merged spread).

const EN_KEYS = Object.keys(en).sort();

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1] ?? '').sort();
}

describe('en namespace modules', () => {
  it('have no duplicate keys across namespaces', () => {
    const perModule = Object.values(EN_NAMESPACES).reduce<number>(
      (n, mod) => n + Object.keys(mod).length,
      0,
    );
    expect(EN_KEYS.length).toBe(perModule);
  });

  for (const [ns, mod] of Object.entries(EN_NAMESPACES)) {
    it(`'${ns}' keys carry the '${ns}.' prefix and are non-empty`, () => {
      for (const [key, value] of Object.entries(mod)) {
        expect(key.startsWith(`${ns}.`), `${key} must start with '${ns}.'`).toBe(true);
        expect(value, key).toBeTruthy();
      }
    });
  }
});

describe('locale coverage', () => {
  it('registers en as the reference locale', () => {
    expect(LOCALES.en).toBe(en);
  });

  for (const [code, table] of Object.entries(LOCALES)) {
    if (code === 'en') continue;

    it(`'${code}' defines exactly the English key set`, () => {
      expect(Object.keys(table).sort()).toEqual(EN_KEYS);
    });

    it(`'${code}' preserves {placeholders} per key`, () => {
      for (const key of EN_KEYS) {
        const enValue = (en as Record<string, string>)[key];
        const value = (table as Record<string, string>)[key];
        expect(placeholders(value ?? ''), key).toEqual(placeholders(enValue ?? ''));
      }
    });

    it(`'${code}' has no empty translations`, () => {
      for (const [key, value] of Object.entries(table)) {
        expect(value, key).toBeTruthy();
      }
    });
  }
});
