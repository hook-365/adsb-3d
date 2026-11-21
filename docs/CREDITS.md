# Credits

The data sources, services and projects this one is built on, with their licences and terms.

- **FAA Aeronautical Information Services** ([ADDS open data](https://adds-faa.opendata.arcgis.com), published for public use): Class Airspace and Special Use Airspace behind the 3D airspace (`frontend/src/world/airspace-data.json`). Simplified from the FAA originals, which the FAA does not warrant once modified; not for navigation.
- **FAA CIFP** ([Coded Instrument Flight Procedures](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/), not copyrighted): the instrument approaches, arrivals and departures, and the airways, navaids and fixes. Provided by the FAA as is, with no warranty; this project simplifies it and it must not be used for navigation.
- **[Open-Meteo](https://open-meteo.com)** (CC BY 4.0): forecast winds aloft, when `ENABLE_WINDS_ALOFT` is on; proxied and cached hourly by the container and credited on screen. Their free API is for non-commercial use.
- **[aviationweather.gov](https://aviationweather.gov/data/api/)** (US National Weather Service): METARs and TAFs for the airport card, and pilot reports, proxied and cached by the container (five and fifteen minutes); nothing stored.
- **FAA TFR site** ([tfr.faa.gov](https://tfr.faa.gov)): the live temporary flight restrictions, proxied and cached by the container (list ten minutes, each NOTAM thirty); nothing stored.
- **OurAirports** ([ourairports.com/data](https://ourairports.com/data/), public domain): the airport list behind the Explore picker's code search (`frontend/src/feed/explore-airports.json`) and the runways of the airports layer (`frontend/src/world/runways-data.json`).
- **OpenStreetMap contributors** ([openstreetmap.org/copyright](https://www.openstreetmap.org/copyright), ODbL 1.0): the taxiways, aprons, terminals and gates of the airport ground detail (`frontend/src/world/airport-ground.pack`), credited on screen while the layer is on.
- **GeoNames** ([geonames.org](https://www.geonames.org), CC BY 4.0): the US city list behind the Explore picker's search (`frontend/src/feed/explore-cities.json`).
- **tar1090** ([wiedehopf/tar1090](https://github.com/wiedehopf/tar1090),
  GPL v2+): SVG aircraft shape catalog, the altitude → color palette, and
  the US air refueling track centrelines (its "US A2A Refueling" overlay,
  `frontend/src/world/refueling-data.json`).
- **readsb / dump1090-fa**: upstream Mode S/ADS-B decoder.
- **planespotters.net**: aircraft photographs in the detail panel.
- **[adsb.im](https://adsb.im)**: callsign → route resolution, run by
  one person as a hobby service. Lookups are cached and batched to keep
  the load small; please keep it that way if you fork this.
- **[FlyItalyADSB](https://flyitalyadsb.com)** (CC BY-SA 4.0),
  **[adsb.lol](https://adsb.lol)** (ODbL 1.0), **[adsb.fi](https://adsb.fi)**
  (personal, non-commercial) and **[airplanes.live](https://airplanes.live)**
  are community-run aggregators whose radius APIs power the Explore feed,
  one at a time per deployment; credited on screen while active, polled
  at most six times a minute per city, nothing stored.
- **[NOAA MRMS](https://mrms.ncep.noaa.gov/)**: merged 3D reflectivity
  behind the 3D storms, US government public domain; credited on screen.
- **OpenStreetMap, ESRI, OpenTopoMap**: basemap tile providers, proxied
  and cached by the container; credited on screen.
- **[CARTO](https://carto.com/attributions)**: Dark / Voyager basemaps,
  fetched directly by the browser under your own free API key per
  [CARTO's basemap terms](https://carto.com/legal/basemap-terms/)
  (5M tiles/month fair-use, OpenStreetMap + CARTO attribution required,
  no server-side caching).
- **[VFRMap](https://vfrmap.com)**: hosting for FAA Sectional / Helicopter
  / IFR Low / IFR High chart tiles, kept in sync with the FAA 56-day cycle.
  Free non-commercial service; please don't abuse it.

## License

Source code is MIT (see `LICENSE`). Data taken from tar1090
(`frontend/src/aircraft/shapes-data.json` and
`frontend/src/world/refueling-data.json`) is GPL v2+ per upstream. If
you redistribute the built app, GPL governs those components.

---

Back to the [README](../README.md) or the [documentation index](README.md).
