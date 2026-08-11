// 'settings.*' UI strings. Populated by the i18n extraction; keys are flat and
// must carry the 'settings.' prefix (enforced by tests-unit/i18n.test.ts).
export const settingsStrings = {
  // Panel chrome
  'settings.title': 'Settings',
  'settings.close': 'Close settings',

  // Appearance section
  'settings.section_appearance': 'Appearance',
  'settings.color_theme': 'Color theme',
  'settings.color_theme_desc': 'Palette for panels, accents, and the scene background. Auto follows your system light/dark preference.',
  'settings.language': 'Language',
  'settings.language_desc': "UI language. Auto follows your browser's locale. Changing this reloads the page.",
  'settings.language_auto': 'Auto',

  // Aircraft section
  'settings.section_aircraft': 'Aircraft',
  'settings.aircraft_shape': 'Aircraft shape',
  'settings.aircraft_shape_desc': 'How aircraft are drawn in the sky: a heading cone, a sphere, or a 3D version of the tar1090 type silhouette.',
  'settings.shape_cone': 'Cone',
  'settings.shape_sphere': 'Sphere',
  'settings.shape_silhouette': '3D silhouette',
  'settings.history_trails': 'History trails',
  'settings.history_trails_desc': 'Colored position-history line behind each aircraft.',
  'settings.trail_length': 'Trail length',
  'settings.trail_length_desc': 'Max points drawn per trail. Full renders everything collected; the selected aircraft always shows its full trail.',
  'settings.trail_length_full': 'full',
  'settings.ground_sprites': 'Ground aircraft icons',
  'settings.ground_sprites_desc': 'Show the tar1090 silhouette under each aircraft.',
  'settings.altitude_lines': 'Altitude lines',
  'settings.altitude_lines_desc': 'Vertical line dropping each aircraft to its ground position.',
  'settings.aircraft_labels': 'Aircraft labels',
  'settings.aircraft_labels_desc': 'Callsign / registration / hex above each aircraft.',
  'settings.acars_messages': 'ACARS messages',
  'settings.acars_messages_desc': 'Show ACARS datalink messages and the receiver status chip.',
  'settings.label_density': 'Label density',
  'settings.label_density_desc': 'Higher values hide farther-away labels when zoomed in. 0 keeps every label visible.',
  'settings.label_density_all': 'all',
  'settings.range_rings': 'Range rings',
  'settings.range_rings_desc': 'Concentric distance rings every 50 NM.',

  // Map section
  'settings.section_map': 'Map',
  'settings.basemap': 'Basemap',
  'settings.basemap_desc': 'Map tile provider drawn beneath the scene.',
  'settings.basemap_carto_dark': 'Carto Dark',
  'settings.basemap_carto_voyager': 'Carto Voyager (light)',
  'settings.basemap_osm': 'OpenStreetMap',
  'settings.basemap_topo': 'OpenTopoMap',
  'settings.basemap_hillshade': 'ESRI Hillshade',
  'settings.basemap_satellite': 'ESRI Satellite',
  'settings.basemap_sectional': 'FAA Sectional (US)',
  'settings.basemap_sectional_hybrid': 'FAA Sectional + Roads (US)',
  'settings.basemap_helicopter': 'FAA Helicopter (US)',
  'settings.basemap_ifr_low': 'FAA IFR Low (US)',
  'settings.basemap_ifr_high': 'FAA IFR High (US)',

  // Stereo / VR section
  'settings.section_stereo_vr': 'Stereo / VR',
  'settings.enter_vr': 'Enter VR',
  'settings.enter_vr_desc': 'Open an immersive WebXR session in a connected headset (Meta Quest, Vision Pro, etc.).',
  'settings.exit_vr': 'Exit VR',
  'settings.exit_vr_desc': 'End the active immersive session.',
  'settings.exit_ar_first': 'Exit the AR session first.',
  'settings.vr_unavailable': 'VR unavailable',
  'settings.webxr_unavailable': 'WebXR is not available in this browser.',
  'settings.enter_ar': 'Enter AR',
  'settings.enter_ar_desc': 'Passthrough mode — aircraft floating in your room. Quest 3, Vision Pro.',
  'settings.exit_ar': 'Exit AR',
  'settings.exit_ar_desc': 'End the active passthrough session.',
  'settings.exit_vr_first': 'Exit the VR session first.',
  'settings.ar_unavailable': 'AR unavailable',
  'settings.ar_unsupported': 'This device does not support immersive-ar passthrough.',
  'settings.vr_quality': 'VR render quality',
  'settings.vr_quality_desc': 'Supersampling for immersive VR. Higher keeps distant aircraft sharp at a GPU cost. Takes effect the next time you enter VR.',
  'settings.vr_quality_low': 'Low (faster)',
  'settings.vr_quality_balanced': 'Balanced',
  'settings.vr_quality_high': 'High',
  'settings.vr_quality_ultra': 'Ultra (sharpest)',
  'settings.vr_quality_measured': 'Last session rendered {w}×{h} px per eye.',
  'settings.stereo': 'Side-by-side stereo',
  'settings.stereo_desc': 'Split the view into left/right eye halves for Google Cardboard or a phone VR headset. Ignored while an immersive WebXR session is active.',
  'settings.stereo_strength': 'Stereo strength',
  'settings.stereo_strength_desc': 'Eye separation when stereo is on. Higher gives deeper 3D but more eye strain.',

  // Units section
  'settings.section_units': 'Units',
  'settings.altitude_unit': 'Altitude',
  'settings.unit_feet': 'Feet (ft)',
  'settings.unit_meters': 'Meters (m)',
  'settings.speed_unit': 'Speed',
  'settings.unit_knots': 'Knots (kt)',
  'settings.unit_mph': 'Miles/hour (mph)',
  'settings.unit_kmh': 'Kilometers/hour (km/h)',
  'settings.distance_unit': 'Distance',
  'settings.unit_nm': 'Nautical miles (NM)',
  'settings.unit_km': 'Kilometers (km)',

  // Range-row reset button
  'settings.reset_to_default': 'Reset to default ({value})',
  'settings.reset_row_to_default': 'Reset {label} to default',
  'settings.xr_move_mode': 'VR movement',
  'settings.xr_move_mode_desc':
    'Scope keeps you stationary while the world scales and orbits. ' +
    'Free-fly moves you through the airspace: left stick flies, ' +
    'right stick up/down changes height, grip + left stick scales.',
  'settings.xr_move_scope': 'Scope (world moves)',
  'settings.xr_move_freefly': 'Free-fly (you move)',
  'settings.xr_turn_style': 'VR turning',
  'settings.xr_turn_style_desc':
    'Snap turns in 30° steps — easiest on the stomach. Smooth rotates ' +
    'continuously.',
  'settings.xr_turn_snap': 'Snap (30°)',
  'settings.xr_turn_smooth': 'Smooth',
  'settings.diorama_clip': 'Diorama clipping',
  'settings.diorama_clip_desc': 'In VR/AR, clip the airspace to a box around the placed scope so it reads as a desk ornament.',
  'settings.diorama_size': 'Diorama size',
  'settings.diorama_size_desc': 'Width of the clipping box in metres.',
  'settings.xr_follow': 'Follow selected aircraft',
  'settings.xr_follow_desc': 'In VR/AR, the world slides so the selected aircraft stays put over the scope.',
  'settings.terrain_3d': '3D terrain',
  'settings.terrain_3d_desc':
    'Raise the basemap to real ground elevation. Rings and markers follow ' +
    'the ground. Changing it reloads the page.',
  'settings.altitude_curve': 'Altitude scale',
  'settings.altitude_curve_desc':
    'Lower = low-altitude focus, higher = high-altitude focus. ' +
    'Changing it reloads the page.',
  'settings.altitude_curve_fmt_linear': 'balanced',
  'settings.altitude_curve_fmt_low': 'low {n}%',
  'settings.altitude_curve_fmt_high': 'high {n}%',
} as const;
