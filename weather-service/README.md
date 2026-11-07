# Weather Service

Builds small 3D radar reflectivity volumes from NOAA MRMS data, one per feed
location, and serves them to adsb-3d, which raymarches them as "3D storms".

## Overview

This service:
1. Downloads the 33 constant-altitude MRMS merged-reflectivity slices from
   `mrms.ncep.noaa.gov/3DRefl` every 5 minutes (no API key)
2. Crops them to a box around each location the viewer asks for (the active
   feed's home position) and downsamples to at most 256 cells per side
3. Serves each result as one gzip-compressed uint8 dBZ volume plus a JSON
   manifest

No database. Nothing is persisted between restarts.

## Multi-feed

One service covers every feed of a multi-feed viewer. The frontend sends the
active feed's position with `GET /volume?lat=&lon=`; the service registers
that location and crops the shared download around it. The NOAA download
happens once per refresh however many feeds ask; each extra location costs a
few hundred ms of CPU and about 1 MB of RAM. A location nobody has asked
about for `WEATHER3D_LOCATION_TTL_S` is dropped; at most 16 are kept, the
stalest evicted first. Set `LATITUDE` / `LONGITUDE` to pre-warm one pinned
location at startup so the local feed has a volume on first load; without
them the first viewer of a location waits a few seconds while the service
answers 503 and the frontend retries every 5 s.

## Data source and licence

[NOAA MRMS](https://mrms.ncep.noaa.gov/) is a US government product and
public domain. Coverage is CONUS only: a feed outside the US gets
`{"coverage": false}` from `/volume` and the viewer's toggle draws nothing
for that feed. The viewer shows a
NOAA MRMS credit in the attribution while storms are on; keep it there.

## Bandwidth

Each refresh pulls roughly 15 to 20 MB from NOAA per deployment, regardless
of how many feeds ask. Browsers receive the cropped volume only, tens of KB to a few hundred KB depending on
`WEATHER3D_RADIUS_NM` and how much weather is in the box. Set
`ROUTE_API_CONTACT` so NOAA can reach you if they need to.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LATITUDE` | (none) | Optional. With `LONGITUDE`, pre-warms a pinned location at startup (the local feed's position, same value as the adsb-3d service) |
| `LONGITUDE` | (none) | Optional, decimal degrees |
| `WEATHER3D_RADIUS_NM` | `250` | Half-width of each location's crop box in nautical miles |
| `WEATHER3D_REFRESH_S` | `300` | Seconds between NOAA downloads |
| `WEATHER3D_LOCATION_TTL_S` | `1800` | Drop a location nobody asked about for this long; the pinned pre-warm never expires |
| `ROUTE_API_CONTACT` | (none) | Contact (email or site) sent in the outbound User-Agent, same as the other services |

### Enabling 3D storms

1. **Uncomment the `weather-service` block** in `docker-compose.example.yml`:
   ```yaml
   image: ghcr.io/hook-365/adsb-weather-service:latest
   ```
   Optionally give it the same `LATITUDE` / `LONGITUDE` as the viewer so
   the local feed's volume is ready at first load.

2. **Enable the feature in the `adsb-3d` service**:
   ```yaml
   environment:
     - ENABLE_WEATHER3D=true
   ```
   nginx proxies the service at `/weather-api/` (`WEATHER_API_HOST`, default
   `weather-service:8000`).

3. **Start the services**: `docker compose up -d`. The `3D storms` toggle
   appears in the viewer's settings panel.

## API Endpoints

### Health Check
```
GET /health
```
Returns `status`, `version`, `lastDownload`, `lastError` and a `locations`
list with `key`, `pinned`, `volumeTime`, `levelsMissing` and `error` per
registered location. 503 only if no download has succeeded for two refresh
periods.

### Volume manifest
```
GET /volume?lat=<deg>&lon=<deg>
```
Registers the location (if new) and returns its manifest: `coverage`, `time`
(MRMS valid time, unix s), `builtAt`, `bounds{west,east,south,north}`, `nx`,
`ny`, `nz`, `heightsKm[33]`, `levelsMissing[]` and `url`, which is
`/volume.bin?loc=<key>&t=<time>`. Outside CONUS the body is
`{"coverage": false}`. While a new location is still building the service
answers 503 and the viewer retries every 5 s.

### Volume data
```
GET /volume.bin?loc=<key>&t=<time>
```
The gzip-compressed uint8 dBZ volume the manifest's `url` points at. The
viewer refetches whenever the manifest `time` changes or the active feed
switches.

## Development

```bash
cd weather-service
pip install -r requirements.txt -r requirements-dev.txt
pytest -q
```

`ruff check weather-service` from the repo root. The image runs as uid
`10001` and declares a `HEALTHCHECK` on `/health`, like the other services.

## Troubleshooting

### Toggle does nothing
- `curl 'http://<host>/weather-api/volume?lat=<lat>&lon=<lon>'` with the
  active feed's position must not return `coverage: false`; if it does the
  feed is outside CONUS and MRMS has no data for it.
- `curl http://<host>/weather-api/health` lists each registered location
  with its `volumeTime` and any `error`.
- Check `docker compose logs -f weather-service` for download errors;
  NOAA occasionally lags a refresh and the service keeps the last volume.
