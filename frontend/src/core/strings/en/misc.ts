// 'misc.*' UI strings. Populated by the i18n extraction; keys are flat and
// must carry the 'misc.' prefix (enforced by tests-unit/i18n.test.ts).
export const miscStrings = {
  'misc.legend_tooltip':
    'Aircraft are coloured by altitude (tar1090 scheme): low = orange, ' +
    'mid = green, high = magenta. Aircraft on the ground are dim blue-grey.\n\n' +
    'Note: the 3D view exaggerates altitude {factor}× relative to ' +
    'horizontal distance so traffic stays readable — the height you see is ' +
    'NOT to scale against the ground.',
  'misc.legend_alt_caption': 'alt',
  'misc.legend_scale_note': '↕ height ×{factor} — not to scale',
  // VR wrist menu (world/xr-wrist-menu.ts). Deliberately short — drawn on a
  // 512px canvas; translations must stay terse or they clip.
  'misc.xr_theme': 'Theme',
  'misc.xr_basemap': 'Basemap',
  'misc.xr_range_rings': 'Range rings',
  'misc.xr_labels': 'Labels',
  'misc.xr_alt_lines': 'Alt lines',
  'misc.xr_on': 'on',
  'misc.xr_off': 'off',
  'misc.xr_hint': 'point + trigger',
  'misc.xr_basemap_dark': 'Dark',
  'misc.xr_basemap_voyager': 'Voyager',
  'misc.xr_basemap_hillshade': 'Hillshade',
  'misc.xr_basemap_topo': 'Topo',
  'misc.xr_basemap_satellite': 'Satellite',
  'misc.xr_basemap_osm': 'OSM',
  'misc.xr_basemap_sectional': 'FAA Sectional',
  'misc.xr_basemap_sectional_hybrid': 'Sectional + Roads',
  'misc.xr_basemap_helicopter': 'FAA Helicopter',
  'misc.xr_basemap_ifr_low': 'IFR Low',
  'misc.xr_basemap_ifr_high': 'IFR High',
} as const;
