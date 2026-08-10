// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getDefaultSettings } from '../src/core/settings';
import {
  PANEL_EXCLUDED_KEYS,
  SETTINGS_SCHEMA,
} from '../src/ui/settings-panel';

// Drift guard for the settings panel, mirroring the wrist menu's parity
// test: every Settings key must either have a panel row or a documented
// exclusion. Without this, a new setting can silently ship with no UI —
// exactly how history trails went unexposed for seven minor versions.
//
// jsdom: settings-panel builds its schema at module scope via t(), which
// touches navigator/localStorage on i18n init.

const schemaKeys = SETTINGS_SCHEMA.flatMap((section) =>
  section.rows.flatMap((row) => ('key' in row ? [row.key as string] : [])),
);

describe('settings panel schema parity', () => {
  it('covers every Settings key or documents its exclusion', () => {
    const allKeys = Object.keys(getDefaultSettings());
    const covered = new Set([...schemaKeys, ...Object.keys(PANEL_EXCLUDED_KEYS)]);
    const missing = allKeys.filter((k) => !covered.has(k));
    expect(missing).toEqual([]);
  });

  it('has no key both in the schema and the exclusion list', () => {
    const excluded = new Set(Object.keys(PANEL_EXCLUDED_KEYS));
    expect(schemaKeys.filter((k) => excluded.has(k))).toEqual([]);
  });

  it('has no duplicate keys across rows', () => {
    expect(new Set(schemaKeys).size).toBe(schemaKeys.length);
  });

  it('exclusion reasons are real sentences, not placeholders', () => {
    for (const reason of Object.values(PANEL_EXCLUDED_KEYS)) {
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it('section ids are unique and stable', () => {
    const ids = SETTINGS_SCHEMA.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The persisted collapse state keys off these ids — renaming one
    // silently resets users' open/closed memory, so change deliberately.
    expect(ids).toEqual(['appearance', 'aircraft', 'map', 'xr', 'units']);
  });

  it('exposes the trail controls in the aircraft section', () => {
    const aircraft = SETTINGS_SCHEMA.find((s) => s.id === 'aircraft')!;
    const keys = aircraft.rows.flatMap((r) => ('key' in r ? [r.key] : []));
    expect(keys).toContain('historyTrails');
    expect(keys).toContain('trailLength');
  });
});
