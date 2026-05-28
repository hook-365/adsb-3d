import { describe, it, expect } from 'vitest';
import { THEMES, THEME_OPTIONS, type ThemeTokens } from '../src/core/theme';

// Drift guard: a new theme must define every token the reference theme
// defines (top-level + nested `three.*`). Catches forgotten keys before
// they fall through to undefined at runtime, which would write the literal
// string "undefined" to a CSS custom property and visibly break a panel.

const REFERENCE = THEMES['midnight-glass'];
const ROOT_KEYS = Object.keys(REFERENCE) as Array<keyof ThemeTokens>;
const THREE_KEYS = Object.keys(REFERENCE.three) as Array<keyof ThemeTokens['three']>;

describe('theme token coverage', () => {
  for (const [name, tokens] of Object.entries(THEMES)) {
    it(`${name} defines every root token`, () => {
      for (const key of ROOT_KEYS) {
        expect(tokens[key], `${name}.${key}`).toBeDefined();
      }
    });

    it(`${name} defines every three.* token`, () => {
      for (const key of THREE_KEYS) {
        expect(tokens.three[key], `${name}.three.${key}`).toBeDefined();
      }
    });

    it(`${name} has no extra root keys`, () => {
      // Symmetric: extra keys are usually a sign someone added to one theme
      // but forgot to extend ThemeTokens (TS would catch it) or renamed a
      // token and missed a theme.
      const extra = Object.keys(tokens).filter((k) => !ROOT_KEYS.includes(k as keyof ThemeTokens));
      expect(extra, `${name} has unexpected keys: ${extra.join(', ')}`).toHaveLength(0);
    });
  }
});

describe('THEME_OPTIONS', () => {
  it("includes 'auto' and every registered theme", () => {
    const optionValues = THEME_OPTIONS.map((o) => o.value).sort();
    const expected = ['auto', ...Object.keys(THEMES)].sort();
    expect(optionValues).toEqual(expected);
  });

  it('every named option points at a real theme', () => {
    for (const opt of THEME_OPTIONS) {
      if (opt.value === 'auto') continue;
      expect(THEMES, `option ${opt.value}`).toHaveProperty(opt.value);
    }
  });
});
