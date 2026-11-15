// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseTfrCoord, parseTfrDetail, parseTfrList, tfrCurrent, tfrDetailUrl, tfrTime } from '../src/world/tfr';

const avx = (lat: string, lon: string): string =>
  `<Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>${lat}</geoLat><geoLong>${lon}</geoLong></Avx>`;

const area = (name: string, upper: string, lower: string): string => `
  <TFRAreaGroup>
    <aseTFRArea>
      <txtName>${name}</txtName>
      ${upper}
      ${lower}
      <ScheduleGroup><dateEffective>2030-01-01T00:00:00</dateEffective><dateExpire>2030-01-02T00:00:00</dateExpire></ScheduleGroup>
    </aseTFRArea>
    <abdMergedArea>
      ${avx('30.00000000N', '090.10000000W')}${avx('30.00000000N', '090.00000000W')}
      ${avx('30.10000000N', '090.00000000W')}${avx('30.10000000N', '090.10000000W')}
      ${avx('30.00000000N', '090.10000000W')}
    </abdMergedArea>
    <aseShapes><Abd><Avx><codeType>CIR</codeType><geoLat>31.0N</geoLat><geoLong>091.0W</geoLong></Avx></Abd></aseShapes>
  </TFRAreaGroup>`;

const XML = `<XNOTAM-Update><Group><Add><Not>
  <NotUid><txtLocalName>6/7567</txtLocalName></NotUid>
  <dateEffective>2026-11-14T18:29:00</dateEffective>
  <dateExpire>2026-11-16T14:00:00</dateExpire>
  <codeTimeZone>UTC</codeTimeZone>
  <txtDescrPurpose>TO PROVIDE SAFE OPERATIONS FOR SAR ACFT &amp; CREWS</txtDescrPurpose>
  <AffLocGroup><txtNameCity>NEW ORLEANS</txtNameCity><txtNameUSState>LOUISIANA</txtNameUSState></AffLocGroup>
  <TfrNot><codeType>91.137(a)(2)</codeType>
  ${area(
    'Hazard Area1',
    '<codeDistVerUpper>HEI</codeDistVerUpper><valDistVerUpper>1000</valDistVerUpper><uomDistVerUpper>FT</uomDistVerUpper>',
    '<codeDistVerLower>HEI</codeDistVerLower><valDistVerLower>0</valDistVerLower><uomDistVerLower>FT</uomDistVerLower>',
  )}
  ${area(
    'Area2',
    '<codeDistVerUpper>STD</codeDistVerUpper><valDistVerUpper>180</valDistVerUpper><uomDistVerUpper>FL</uomDistVerUpper>',
    '<codeDistVerLower>ALT</codeDistVerLower><valDistVerLower>4000</valDistVerLower><uomDistVerLower>FT</uomDistVerLower>',
  )}
  </TfrNot>
  <txtDescrTraditional>!FDC 6/7567 ZHU LA..AIRSPACE NEW ORLEANS, LA..TEMPORARY FLIGHT RESTRICTIONS</txtDescrTraditional>
</Not></Add></Group></XNOTAM-Update>`;

describe('parseTfrCoord', () => {
  it('reads hemisphere-suffixed decimal degrees', () => {
    expect(parseTfrCoord('29.95375907N')).toBeCloseTo(29.95375907);
    expect(parseTfrCoord('090.06775836W')).toBeCloseTo(-90.06775836);
    expect(parseTfrCoord('nonsense')).toBeNaN();
  });
});

describe('parseTfrDetail', () => {
  const volumes = parseTfrDetail(XML, 'HAZARDS');

  it('makes one volume per restricted area', () => {
    expect(volumes).toHaveLength(2);
    expect(volumes.every((v) => v.kind === 'TFR' && v.name === 'TFR 6/7567')).toBe(true);
    expect(volumes.map((v) => v.sector)).toEqual(['Hazard Area1', 'Area2']);
  });

  it('reads height above ground, MSL altitude and flight levels', () => {
    const [sfc, high] = volumes;
    expect(sfc).toMatchObject({ loFt: 0, loAgl: true, hiFt: 1000, hiAgl: true, unlimited: false });
    expect(high).toMatchObject({ loFt: 4000, loAgl: false, hiFt: 18000, hiAgl: false });
  });

  it('takes the merged outline only, opened, as lon/lat pairs', () => {
    const ring = volumes[0]!.polygons[0]![0]!;
    expect(ring).toHaveLength(8);
    expect(ring.slice(0, 2)).toEqual([-90.1, 30]);
    expect(volumes[0]!.bbox).toEqual([-90.1, 30, -90, 30.1]);
  });

  it('carries the NOTAM for the info card, with its own dates rather than an area schedule', () => {
    const tfr = volumes[0]!.tfr!;
    expect(tfr).toMatchObject({
      notam: '6/7567',
      type: 'HAZARDS',
      rule: '91.137(a)(2)',
      place: 'NEW ORLEANS, LOUISIANA',
      purpose: 'TO PROVIDE SAFE OPERATIONS FOR SAR ACFT & CREWS',
    });
    expect(tfr.text).toContain('TEMPORARY FLIGHT RESTRICTIONS');
    expect(tfr.effective).toBe(Date.UTC(2026, 10, 14, 18, 29));
    expect(tfr.expire).toBe(Date.UTC(2026, 10, 16, 14, 0));
    expect(volumes[0]!.times).toBe('2026-11-14 18:29Z to 2026-11-16 14:00Z');
  });

  it('treats a missing ceiling as unlimited and a missing expiry as open-ended', () => {
    const open = parseTfrDetail(
      XML.replace('<dateExpire>2026-11-16T14:00:00</dateExpire>', '').replace(
        '<codeDistVerUpper>HEI</codeDistVerUpper><valDistVerUpper>1000</valDistVerUpper>',
        '<codeDistVerUpper>UNL</codeDistVerUpper>',
      ),
    );
    expect(open[0]!.unlimited).toBe(true);
    expect(open[0]!.tfr!.expire).toBeNull();
    expect(tfrCurrent(open[0]!, Date.UTC(2040, 0, 1))).toBe(true);
  });

  it('returns nothing for a document that is not a NOTAM', () => {
    expect(parseTfrDetail('<html>not found</html>')).toEqual([]);
  });
});

describe('tfrCurrent', () => {
  it('drops a restriction once it has expired', () => {
    const [v] = parseTfrDetail(XML);
    expect(tfrCurrent(v!, Date.UTC(2026, 10, 15))).toBe(true);
    expect(tfrCurrent(v!, Date.UTC(2026, 10, 17))).toBe(false);
  });
});

describe('parseTfrList', () => {
  it('merges the areas of one NOTAM into one entry with a combined box', () => {
    const list = parseTfrList({
      features: [
        { properties: { NOTAM_KEY: '6/7554-1-FDC-F', LEGAL: 'SECURITY' }, geometry: { coordinates: [[[-78, 39], [-77, 39], [-77, 40]]] } },
        { properties: { NOTAM_KEY: '6/7554-2-FDC-F', LEGAL: 'SECURITY' }, geometry: { coordinates: [[[-80, 38], [-79, 38], [-79, 38.5]]] } },
        { properties: { NOTAM_KEY: 'garbage' }, geometry: { coordinates: [[[0, 0]]] } },
      ],
    });
    expect(list).toEqual([{ notam: '6/7554', type: 'SECURITY', bbox: [-80, 38, -77, 40] }]);
  });

  it('survives junk', () => {
    expect(parseTfrList(null)).toEqual([]);
    expect(parseTfrList({ features: 'no' })).toEqual([]);
  });
});

describe('helpers', () => {
  it('builds the proxied detail path and prints UTC times', () => {
    expect(tfrDetailUrl('6/7567')).toBe('/tfr/detail/6_7567.xml');
    expect(tfrTime(Date.UTC(2026, 10, 14, 18, 29))).toBe('2026-11-14 18:29Z');
  });
});
