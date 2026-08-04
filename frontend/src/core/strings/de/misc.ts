// German draft mirroring en/misc.ts — pending native-speaker review.
export const miscStrings = {
  'misc.legend_tooltip':
    'Flugzeuge sind nach Höhe eingefärbt (tar1090-Schema): niedrig = Orange, ' +
    'mittel = Grün, hoch = Magenta. Flugzeuge am Boden sind gedämpft blaugrau.\n\n' +
    'Hinweis: Die 3D-Ansicht überhöht die Höhe im Verhältnis zur horizontalen ' +
    'Entfernung um das {factor}-Fache, damit der Verkehr lesbar bleibt. ' +
    'Die dargestellte Höhe ist NICHT maßstabsgetreu zum Boden.',
  'misc.legend_alt_caption': 'Höhe',
  'misc.legend_scale_note': '↕ Höhe ×{factor}, nicht maßstabsgetreu',
  'misc.legend_scale_note_low': '↕ niedrige Höhen betont, nicht maßstabsgetreu',
  'misc.legend_scale_note_high': '↕ große Höhen betont, nicht maßstabsgetreu',
  // VR-Handgelenkmenü — bewusst kurz, wird auf eine 512px-Canvas gezeichnet.
  'misc.xr_theme': 'Design',
  'misc.xr_basemap': 'Karte',
  'misc.xr_range_rings': 'Ringe',
  'misc.xr_labels': 'Labels',
  'misc.xr_alt_lines': 'Höhenlinien',
  'misc.xr_on': 'an',
  'misc.xr_off': 'aus',
  'misc.xr_hint': 'Zeigen + Trigger',
  'misc.exit_stereo': 'Stereo beenden',
  'misc.xr_movement': 'Bewegung',
  'misc.xr_move_scope': 'Scope',
  'misc.xr_move_freefly': 'Freiflug',
  'misc.xr_turning': 'Drehung',
  'misc.xr_turn_snap': 'Schritte',
  'misc.xr_turn_smooth': 'fließend',
  'misc.xr_basemap_dark': 'Dunkel',
  'misc.xr_basemap_voyager': 'Voyager',
  'misc.xr_basemap_hillshade': 'Relief',
  'misc.xr_basemap_topo': 'Topo',
  'misc.xr_basemap_satellite': 'Satellit',
  'misc.xr_basemap_osm': 'OSM',
  'misc.xr_basemap_sectional': 'FAA Sectional',
  'misc.xr_basemap_sectional_hybrid': 'Sectional + Straßen',
  'misc.xr_basemap_helicopter': 'FAA Helikopter',
  'misc.xr_basemap_ifr_low': 'IFR Low',
  'misc.xr_basemap_ifr_high': 'IFR High',
} as const;
