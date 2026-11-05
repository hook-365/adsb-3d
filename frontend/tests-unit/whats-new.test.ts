// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { notesForVersion, renderNotes, whatsNewDecision } from '../src/ui/whats-new';

const MD = `# Changelog

## [Unreleased]

---

## [0.13.0] - 2026-11-20

### Added

- **Panel style.** Glass or Docked, see
  Settings → Appearance ([#18](https://github.com/hook-365/adsb-3d/issues/18)).
- Weather radar with \`weatherRadar\`.

### Fixed

- Footer no longer covers the credit.

---

## [0.12.2] - 2026-11-05

- Update check.
`;

describe('notesForVersion', () => {
  it('extracts exactly one version section', () => {
    const n = notesForVersion(MD, '0.13.0')!;
    expect(n.startsWith('### Added')).toBe(true);
    expect(n).toContain('Footer no longer');
    expect(n).not.toContain('Update check');
    expect(n).not.toContain('---');
  });
  it('returns null for unknown or empty sections', () => {
    expect(notesForVersion(MD, '9.9.9')).toBeNull();
    expect(notesForVersion('## [1.0.0]\n\n---\n', '1.0.0')).toBeNull();
  });
});

describe('renderNotes', () => {
  it('renders headings, joined bullets, bold, code and links without HTML injection', () => {
    const el = renderNotes(notesForVersion(MD, '0.13.0')! + '\n- <img src=x onerror=alert(1)>');
    expect(el.querySelectorAll('h4').length).toBe(2);
    const items = [...el.querySelectorAll('li')].map((li) => li.textContent);
    expect(items[0]).toBe('Panel style. Glass or Docked, see Settings → Appearance (#18).');
    expect(el.querySelector('li strong')!.textContent).toBe('Panel style.');
    expect(el.querySelector('li a')!.getAttribute('href')).toBe('https://github.com/hook-365/adsb-3d/issues/18');
    expect(el.querySelector('code')!.textContent).toBe('weatherRadar');
    expect(el.querySelector('img')).toBeNull();
    expect(items.at(-1)).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('whatsNewDecision', () => {
  it('records silently on first visit, shows on upgrade, idles when current', () => {
    expect(whatsNewDecision('0.13.0', null)).toEqual({ show: false, record: '0.13.0' });
    expect(whatsNewDecision('0.13.0+abc', '0.12.2')).toEqual({ show: true, record: '0.13.0' });
    expect(whatsNewDecision('0.13.0', '0.13.0')).toEqual({ show: false, record: null });
    expect(whatsNewDecision(undefined, '0.12.2')).toEqual({ show: false, record: null });
    expect(whatsNewDecision('dev', '0.12.2')).toEqual({ show: false, record: null });
  });
});
