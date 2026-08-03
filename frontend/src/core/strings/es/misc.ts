// Spanish draft mirroring en/misc.ts, pending native-speaker review.
export const miscStrings = {
  'misc.legend_tooltip':
    'Las aeronaves se colorean según la altitud (esquema tar1090): baja = naranja, ' +
    'media = verde, alta = magenta. Las aeronaves en tierra se muestran en gris ' +
    'azulado tenue.\n\n' +
    'Nota: la vista 3D exagera la altitud {factor}× respecto a la distancia ' +
    'horizontal para que el tráfico sea legible; la altura que se ve NO está ' +
    'a escala con el suelo.',
  'misc.legend_alt_caption': 'alt',
  'misc.legend_scale_note': '↕ altura ×{factor}, no a escala',
  // Menú de muñeca VR, deliberadamente corto: se dibuja en un canvas de 512px.
  'misc.xr_theme': 'Tema',
  'misc.xr_basemap': 'Mapa',
  'misc.xr_range_rings': 'Anillos',
  'misc.xr_labels': 'Etiquetas',
  'misc.xr_alt_lines': 'Líneas alt.',
  'misc.xr_on': 'sí',
  'misc.xr_off': 'no',
  'misc.xr_hint': 'apuntar + gatillo',
  'misc.xr_basemap_dark': 'Oscuro',
  'misc.xr_basemap_voyager': 'Voyager',
  'misc.xr_basemap_hillshade': 'Relieve',
  'misc.xr_basemap_topo': 'Topo',
  'misc.xr_basemap_satellite': 'Satélite',
  'misc.xr_basemap_osm': 'OSM',
  'misc.xr_basemap_sectional': 'FAA Seccional',
  'misc.xr_basemap_sectional_hybrid': 'Seccional + Vías',
  'misc.xr_basemap_helicopter': 'FAA Helicóptero',
  'misc.xr_basemap_ifr_low': 'IFR bajo',
  'misc.xr_basemap_ifr_high': 'IFR alto',
} as const;
