# Feeds: your receivers and Explore

## Multi-feed

Define each feed with flat `FEEDN_*` env vars and the entrypoint
synthesises the rest:

```env
FEED1_NAME=Home Station
FEED1_LAT=45.0000
FEED1_LON=-90.0000
FEED1_ALT=1000                # feet MSL, like all altitudes here
FEED1_ACARS=true              # optional

FEED2_NAME=Remote Site
FEED2_URL=192.0.2.10:8086     # host:port of another adsb-3d instance
FEED2_LAT=43.0000
FEED2_LON=-89.0000
FEED2_COLOR=#ff8c4c           # optional
```

Slot 1 is always local: `FEED1_URL` is ignored. Slots 2+ point at other
adsb-3d instances and the entrypoint wires up the nginx proxy blocks.
Parsing stops at the first missing `FEEDN_NAME`.

## Explore: any city

Set `EXPLORE_PROVIDER` and the feed picker lists Explore places under your
receivers. The scene recentres on the chosen place and shows that area's
traffic from the aggregator's worldwide feed, with terrain and basemaps as
usual. Live only: no history, ACARS or voice for that feed, and routes are
looked up only for the aircraft you select.

One search box covers three sources:

| Source | What you can type | Notes |
|---|---|---|
| Curated cities (about 85 worldwide, grouped by region) | City, state or province, country, or an airport code serving it (`msp`, `lhr`) | Always listed |
| US cities (about 3,100, every city over 15,000 people) | City, `City, ST`, or a state name | Shown as you type, largest first. From [GeoNames](https://www.geonames.org) |
| Airports (about 6,000: large and medium worldwide, plus US small fields with an ICAO code) | ICAO or IATA code, airport name or city (`KMSP`, `ATW`, `heathrow`) | Centres on the airport itself; fetched the first time the picker opens. From [OurAirports](https://ourairports.com/data/) |

Every place has a shareable link (`?place=minneapolis`, `?place=us_wi_wausau`,
`?place=apt_kmsp`).

| `EXPLORE_PROVIDER` | Key | Notes |
|---|---|---|
| `flyitalyadsb` | `EXPLORE_API_KEY`, free and self-serve at [flyitalyadsb.com](https://flyitalyadsb.com/en/data/api/) | 30 requests/min on the free plan; feeders get Pro limits on the same key. Data is CC BY-SA 4.0 |
| `adsb.lol` | none | No published limit ("dynamic"); data is ODbL 1.0; feeding them is encouraged |
| `adsb.fi` | none | 1 request/s per IP; personal, non-commercial use only; cite with a link |
| `airplanes.live` | none | No published limit; site terms are non-commercial |

Set `EXPLORE_FALLBACK_PROVIDER` to a second provider from the table and
nginx switches to it by itself whenever the first one fails: a connection
error or timeout, a 5xx, a rate limit (429) or a rejected key. It goes
back to the first as soon as that answers again, and both are credited in
the attribution line, since either may be supplying the data.

Any key stays in nginx. nginx rewrites the browser's `?lat=&lon=` into the
provider's radius query, adds the key and User-Agent, and caches each
city for the poll interval, so any number of viewers of one city cost one
upstream request per interval. The default `EXPLORE_POLL_S=10` keeps even
the FlyItalyADSB free plan well inside its limit with several cities
open; smooth motion fills the gaps. Each city costs at most six upstream
requests a minute however many people are watching it, and nothing from
the aggregators is stored: routes are looked up on selection only and the
history collector never sees Explore traffic. The attribution line credits
the provider while the feed is active; keep it visible, it is a licence
condition for some of them.

---

Back to the [README](../README.md) or the [documentation index](README.md).
