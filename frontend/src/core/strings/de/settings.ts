// German draft mirroring en/settings.ts — pending native-speaker review.
export const settingsStrings = {
  // Panel chrome
  'settings.title': 'Einstellungen',
  'settings.close': 'Einstellungen schließen',

  // Theme section
  'settings.section_appearance': 'Erscheinungsbild',
  'settings.color_theme': 'Farbschema',
  'settings.color_theme_desc': 'Palette für Panels, Akzente und den Szenenhintergrund. Auto folgt der Hell/Dunkel-Einstellung des Systems.',
  'settings.language': 'Sprache',
  'settings.language_desc': 'Sprache der Oberfläche. Auto folgt der Spracheinstellung des Browsers. Eine Änderung lädt die Seite neu.',
  'settings.language_auto': 'Auto',

  // Display section
  'settings.section_aircraft': 'Flugzeuge',
  'settings.aircraft_shape': 'Flugzeugform',
  'settings.aircraft_shape_desc': 'Darstellung der Flugzeuge am Himmel: Kegel in Flugrichtung, Kugel oder eine 3D-Version der tar1090-Typsilhouette.',
  'settings.shape_cone': 'Kegel',
  'settings.shape_sphere': 'Kugel',
  'settings.shape_silhouette': '3D-Silhouette',
  'settings.history_trails': 'Flugspuren',
  'settings.history_trails_desc': 'Farbige Positionsverlaufslinie hinter jedem Flugzeug.',
  'settings.trail_length': 'Spurlänge',
  'settings.trail_length_desc': 'Ungefähre Minuten Verlauf pro Spur. „Voll“ zeichnet alles Gesammelte; das ausgewählte Flugzeug zeigt immer die volle Spur.',
  'settings.trail_length_full': 'voll',
  'settings.trail_length_min': '{n} Min.',
  'settings.ground_sprites': 'Flugzeugsymbole am Boden',
  'settings.ground_sprites_desc': 'Zeigt die tar1090-Silhouette unter jedem Flugzeug.',
  'settings.altitude_lines': 'Höhenlinien',
  'settings.altitude_lines_desc': 'Vertikale Linie von jedem Flugzeug zu seiner Bodenposition.',
  'settings.aircraft_labels': 'Flugzeug-Beschriftungen',
  'settings.aircraft_labels_desc': 'Callsign / Registrierung / Hex über jedem Flugzeug.',
  'settings.acars_messages': 'ACARS-Meldungen',
  'settings.acars_messages_desc': 'Zeigt ACARS-Datalink-Meldungen und den Empfängerstatus-Chip.',
  'settings.label_density': 'Beschriftungsdichte',
  'settings.label_density_desc': 'Höhere Werte blenden beim Hineinzoomen weiter entfernte Beschriftungen aus. 0 hält alle Beschriftungen sichtbar.',
  'settings.label_density_all': 'alle',
  'settings.range_rings': 'Entfernungsringe',
  'settings.range_rings_desc': 'Konzentrische Entfernungsringe alle 50 NM.',
  'settings.section_map': 'Karte',
  'settings.basemap': 'Basiskarte',
  'settings.basemap_desc': 'Kartenkachel-Anbieter unterhalb der Szene.',
  'settings.basemap_carto_dark': 'Carto Dark',
  'settings.basemap_carto_voyager': 'Carto Voyager (hell)',
  'settings.basemap_osm': 'OpenStreetMap',
  'settings.basemap_topo': 'OpenTopoMap',
  'settings.basemap_hillshade': 'ESRI Hillshade',
  'settings.basemap_satellite': 'ESRI Satellit',
  'settings.basemap_sectional': 'FAA Sectional (US)',
  'settings.basemap_sectional_hybrid': 'FAA Sectional + Straßen (US)',
  'settings.basemap_helicopter': 'FAA Helicopter (US)',
  'settings.basemap_ifr_low': 'FAA IFR Low (US)',
  'settings.basemap_ifr_high': 'FAA IFR High (US)',

  // Stereo / VR section
  'settings.section_stereo_vr': 'Stereo / VR',
  'settings.enter_vr': 'VR starten',
  'settings.enter_vr_desc': 'Startet eine immersive WebXR-Sitzung auf einem verbundenen Headset (Meta Quest, Vision Pro usw.).',
  'settings.exit_vr': 'VR beenden',
  'settings.exit_vr_desc': 'Beendet die aktive immersive Sitzung.',
  'settings.exit_ar_first': 'Zuerst die AR-Sitzung beenden.',
  'settings.vr_unavailable': 'VR nicht verfügbar',
  'settings.webxr_unavailable': 'WebXR ist in diesem Browser nicht verfügbar.',
  'settings.enter_ar': 'AR starten',
  'settings.enter_ar_desc': 'Passthrough-Modus: Flugzeuge schweben im eigenen Raum. Quest 3, Vision Pro.',
  'settings.exit_ar': 'AR beenden',
  'settings.exit_ar_desc': 'Beendet die aktive Passthrough-Sitzung.',
  'settings.exit_vr_first': 'Zuerst die VR-Sitzung beenden.',
  'settings.ar_unavailable': 'AR nicht verfügbar',
  'settings.ar_unsupported': 'Dieses Gerät unterstützt kein Immersive-AR-Passthrough.',
  'settings.vr_quality': 'VR-Renderqualität',
  'settings.vr_quality_desc': 'Supersampling für immersives VR. Höhere Werte halten entfernte Flugzeuge scharf, kosten aber GPU-Leistung. Wirkt beim nächsten VR-Start.',
  'settings.vr_quality_low': 'Niedrig (schneller)',
  'settings.vr_quality_balanced': 'Ausgewogen',
  'settings.vr_quality_high': 'Hoch',
  'settings.vr_quality_ultra': 'Ultra (am schärfsten)',
  'settings.vr_quality_measured': 'Letzte Sitzung renderte {w}×{h} px pro Auge.',
  'settings.stereo': 'Side-by-Side-Stereo',
  'settings.stereo_desc': 'Teilt die Ansicht in linke und rechte Augenhälfte für Google Cardboard oder ein Smartphone-VR-Headset. Wird während einer aktiven immersiven WebXR-Sitzung ignoriert.',
  'settings.stereo_strength': 'Stereo-Stärke',
  'settings.stereo_strength_desc': 'Augenabstand bei aktivem Stereo. Höhere Werte erzeugen mehr Tiefe, aber stärkere Augenbelastung.',

  // Units section
  'settings.section_units': 'Einheiten',
  'settings.altitude_unit': 'Höhe',
  'settings.unit_feet': 'Fuß (ft)',
  'settings.unit_meters': 'Meter (m)',
  'settings.speed_unit': 'Geschwindigkeit',
  'settings.unit_knots': 'Knoten (kt)',
  'settings.unit_mph': 'Meilen/Stunde (mph)',
  'settings.unit_kmh': 'Kilometer/Stunde (km/h)',
  'settings.distance_unit': 'Entfernung',
  'settings.unit_nm': 'Nautische Meilen (NM)',
  'settings.unit_km': 'Kilometer (km)',

  // Range-row reset button
  'settings.reset_to_default': 'Auf Standard zurücksetzen ({value})',
  'settings.reset_row_to_default': '{label} auf Standard zurücksetzen',
  'settings.xr_move_mode': 'VR-Bewegung',
  'settings.xr_move_mode_desc':
    'Scope: Sie bleiben stehen, die Welt skaliert und dreht sich. ' +
    'Freiflug: Sie fliegen durch den Luftraum — linker Stick fliegt, ' +
    'rechter Stick hoch/runter ändert die Höhe, Grip + linker Stick skaliert.',
  'settings.xr_move_scope': 'Scope (Welt bewegt sich)',
  'settings.xr_move_freefly': 'Freiflug (Sie bewegen sich)',
  'settings.xr_turn_style': 'VR-Drehung',
  'settings.xr_turn_style_desc':
    'Schrittweise in 30°-Stufen, am magenfreundlichsten. Fließend dreht ' +
    'kontinuierlich.',
  'settings.xr_turn_snap': 'Schrittweise (30°)',
  'settings.xr_turn_smooth': 'Fließend',
  'settings.diorama_clip': 'Diorama-Beschnitt',
  'settings.diorama_clip_desc': 'Beschneidet in AR den Luftraum auf eine Box um das platzierte Radar, wie ein Schreibtisch-Diorama.',
  'settings.diorama_size': 'Diorama-Größe',
  'settings.diorama_size_desc': 'Breite der Beschnittbox in Metern.',
  'settings.xr_follow': 'Ausgewähltem Flugzeug folgen',
  'settings.xr_follow_desc': 'In VR/AR verschiebt sich die Welt, sodass das ausgewählte Flugzeug an Ort und Stelle bleibt.',
  'settings.follow_random': 'Zufälligem Flugzeug folgen',
  'settings.follow_random_desc':
    'Bei aktiviertem „Folgen“: Verschwindet das gefolgte Flugzeug aus dem ' +
    'Feed, automatisch ein anderes sichtbares auswählen statt an der alten Auswahl festzuhalten.',
  'settings.auto_orbit': 'Automatische Umkreisung',
  'settings.auto_orbit_desc':
    'Langsam um das gefolgte Flugzeug (oder die Radarmitte) kreisen. ' +
    'Jede Bewegungseingabe pausiert dies.',
  'settings.auto_orbit_off': 'Aus',
  'settings.terrain_3d': '3D-Gelände',
  'settings.terrain_3d_desc':
    'Hebt die Karte auf echte Geländehöhe. Ringe und Marker folgen dem ' +
    'Gelände. Änderung lädt die Seite neu.',
  'settings.hi_res_tiles': 'Kacheln in hoher Auflösung',
  'settings.hi_res_tiles_desc':
    'Kartenkacheln eine Zoomstufe schärfer laden (4x so viele Kacheln bei ' +
    'gleicher Abdeckung). Kostet Bandbreite und Speicher; gilt auch am Desktop.',
  'settings.altitude_curve': 'Höhenskala',
  'settings.altitude_curve_desc':
    'Niedriger = Fokus auf niedrige Höhen, höher = Fokus auf große Höhen. ' +
    'Änderung lädt die Seite neu.',
  'settings.altitude_curve_fmt_linear': 'ausgewogen',
  'settings.altitude_curve_fmt_low': 'niedrig {n}%',
  'settings.altitude_curve_fmt_high': 'hoch {n}%',
} as const;
