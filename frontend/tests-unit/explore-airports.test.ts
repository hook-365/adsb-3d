// @vitest-environment jsdom
// Airport search behind the Explore picker (feed/explore-airports.ts) and
// the committed OurAirports-derived data file.
import dataText from '../src/feed/explore-airports.json?raw';
import { describe, expect, it } from 'vitest';
import {
  airportPlaceId,
  decodeAirports,
  searchAirports,
  shortAirportName,
} from '../src/feed/explore-airports';
import { findPlace, foldSearch, registerPlaces } from '../src/feed/explore-places';

const AIRPORTS = decodeAirports(JSON.parse(dataText));
const codes = (q: string, limit = 12): string[] => searchAirports(AIRPORTS, foldSearch(q), limit).map((a) => a.icao);

describe('airport data file', () => {
  it('decodes thousands of airports with unique ICAO codes', () => {
    expect(AIRPORTS.length).toBeGreaterThan(4000);
    expect(new Set(AIRPORTS.map((a) => a.icao)).size).toBe(AIRPORTS.length);
    for (const a of AIRPORTS) {
      expect(a.icao).toMatch(/^[A-Z0-9]{4}$/);
      expect(a.place.id).toBe(airportPlaceId(a.icao));
      expect(Math.abs(a.place.lat)).toBeLessThanOrEqual(90);
    }
  });

  it('returns nothing for a malformed document', () => {
    expect(decodeAirports(null)).toEqual([]);
    expect(decodeAirports({ airports: [['KXXX']] })).toEqual([]);
  });
});

describe('searchAirports', () => {
  it('finds an airport by ICAO or IATA code, exact match first', () => {
    expect(codes('kmsp')[0]).toBe('KMSP');
    expect(codes('KMSP')).toEqual(['KMSP']);
    expect(codes('msp')[0]).toBe('KMSP');
    expect(codes('egll')).toEqual(['EGLL']);
    expect(codes('atw')[0]).toBe('KATW');
    expect(codes('kcwa')).toEqual(['KCWA']);
  });

  it('completes a partial code and matches names from three characters', () => {
    expect(codes('kms', 50)).toContain('KMSP');
    expect(codes('heathrow')).toEqual(['EGLL']);
    expect(codes('central wisconsin')).toEqual(['KCWA']);
    expect(codes('k')).toEqual([]);
    expect(codes('zzzzzz')).toEqual([]);
    expect(codes('ka', 5)).toHaveLength(5);
  });

  it('names the place by code and city and shortens airport names', () => {
    const msp = AIRPORTS.find((a) => a.icao === 'KMSP')!;
    expect(msp.place.name).toBe('KMSP · Minneapolis');
    expect(msp.place.id).toBe('apt_kmsp');
    expect(shortAirportName(msp.name)).toBe('Minneapolis–Saint Paul Intl');
    expect(shortAirportName('Appleton International Airport')).toBe('Appleton Intl');
    expect(shortAirportName('Stevens Point Municipal Airport')).toBe('Stevens Point Muni');
  });

  it('becomes findable once registered, without displacing built-in places', () => {
    expect(findPlace('apt_kmsp')).toBeNull();
    registerPlaces(AIRPORTS.slice(0, 50).map((a) => a.place));
    registerPlaces([AIRPORTS.find((a) => a.icao === 'KMSP')!.place]);
    expect(findPlace('apt_kmsp')?.name).toBe('KMSP · Minneapolis');
    registerPlaces([{ ...findPlace('apt_kmsp')!, id: 'rome', name: 'Not Rome' }]);
    expect(findPlace('rome')?.name).toBe('Rome');
  });
});
