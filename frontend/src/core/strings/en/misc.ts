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
  'misc.legend_scale_note_low': '↕ low altitudes emphasized — not to scale',
  'misc.legend_scale_note_high': '↕ high altitudes emphasized — not to scale',
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
  'misc.xr_page': 'Page',
  'misc.xr_place': 'Place scope',
  'misc.xr_ground_icons': 'Ground icons',
  'misc.xr_shape': 'Aircraft shape',
  'misc.xr_shape_cone': 'Cone',
  'misc.xr_shape_sphere': 'Sphere',
  'misc.xr_shape_silhouette': '3D silhouette',
  'misc.xr_acars': 'ACARS',
  'misc.xr_label_density': 'Label density',
  'misc.xr_density_all': 'all',
  'misc.xr_quality': 'Quality',
  'misc.xr_q_low': 'low',
  'misc.xr_q_balanced': 'balanced',
  'misc.xr_q_high': 'high',
  'misc.xr_q_ultra': 'ultra',
  'misc.xr_alt_unit': 'Altitude',
  'misc.xr_speed_unit': 'Speed',
  'misc.xr_dist_unit': 'Distance',
  // Side-by-side stereo exit button (main.ts), duplicated per eye half.
  'misc.exit_stereo': 'Exit stereo',
  'misc.xr_movement': 'Movement',
  'misc.xr_move_scope': 'scope',
  'misc.xr_move_freefly': 'free-fly',
  'misc.xr_turning': 'Turning',
  'misc.xr_turn_snap': 'snap',
  'misc.xr_turn_smooth': 'smooth',
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
