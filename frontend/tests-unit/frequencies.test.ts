import dataText from '../src/world/frequencies-data.json?raw';
import { describe, expect, it } from 'vitest';
import { decodeFrequencies, formatMhz } from '../src/world/frequencies';

const table = decodeFrequencies(JSON.parse(dataText));

describe('airport frequencies', () => {
  it('covers thousands of airports, civil VHF only', () => {
    expect(table.size).toBeGreaterThan(3000);
    for (const list of table.values()) {
      for (const f of list) expect(f.mhz >= 118 && f.mhz <= 137).toBe(true);
    }
  });
  it('lists Minneapolis in the order a flight meets them', () => {
    const kinds = table.get('KMSP')!.map((f) => f.kind);
    expect(kinds.indexOf('ATIS')).toBeLessThan(kinds.indexOf('GND'));
    expect(kinds.indexOf('GND')).toBeLessThan(kinds.indexOf('TWR'));
    expect(table.get('KMSP')!.find((f) => f.kind === 'TWR')?.mhz).toBeGreaterThan(118);
  });
  it('prints a channel with the decimals it needs', () => {
    expect(formatMhz(123.675)).toBe('123.675');
    expect(formatMhz(121.8)).toBe('121.8');
    expect(formatMhz(122)).toBe('122.0');
  });
  it('drops malformed rows', () => {
    expect(decodeFrequencies({ frequencies: { KXXX: [['TWR', '', 'x'], 'nope'] } }).size).toBe(0);
  });
});
