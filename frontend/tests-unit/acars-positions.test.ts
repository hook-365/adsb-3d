import { afterEach, describe, expect, it } from 'vitest';
import {
  addAcarsMessage,
  clearAcars,
  subscribeAcarsPositions,
  type AcarsPositionPing,
} from '../src/aircraft/acars-store';
import type { AcarsMessage } from '../src/feed/acars';

function msg(over: Partial<AcarsMessage> = {}): AcarsMessage {
  return {
    time: new Date().toISOString(),
    icao: 'abc123',
    flight: 'TEST1',
    reg: null,
    label: 'H1',
    blockId: null,
    msgNum: null,
    text: null,
    freq: null,
    level: null,
    error: null,
    mode: null,
    stationId: null,
    destination: null,
    eta: null,
    gtout: null,
    wloff: null,
    wlin: null,
    gtin: null,
    position: null,
    decoded: null,
    ...over,
  };
}

describe('ACARS position emission', () => {
  afterEach(() => clearAcars());

  it('emits the message position (with altitude) to subscribers', () => {
    const seen: AcarsPositionPing[] = [];
    const unsub = subscribeAcarsPositions((p) => seen.push(p));
    addAcarsMessage(msg({ position: { lat: 45, lon: -90, alt: 35000 } }));
    unsub();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ lat: 45, lon: -90, altFt: 35000, flight: 'TEST1' });
  });

  it('falls back to a decoded position when the message has no position field', () => {
    const seen: AcarsPositionPing[] = [];
    const unsub = subscribeAcarsPositions((p) => seen.push(p));
    addAcarsMessage(
      msg({ position: null, decoded: { kind: 'position', summary: 'x', position: { lat: 45.1, lon: -90.2 } } }),
    );
    unsub();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ lat: 45.1, lon: -90.2, altFt: null });
  });

  it('does not emit for messages without any coordinates', () => {
    const seen: AcarsPositionPing[] = [];
    const unsub = subscribeAcarsPositions((p) => seen.push(p));
    addAcarsMessage(msg({ text: 'OPS NORMAL' }));
    unsub();
    expect(seen).toHaveLength(0);
  });

  it('unsubscribe stops delivery', () => {
    const seen: AcarsPositionPing[] = [];
    const unsub = subscribeAcarsPositions((p) => seen.push(p));
    unsub();
    addAcarsMessage(msg({ position: { lat: 1, lon: 2, alt: null } }));
    expect(seen).toHaveLength(0);
  });
});
