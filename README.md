# ADS-B 3D Viewer

Real-time and historical 3D visualization of ADS-B aircraft data with 7 visual themes and interactive controls.

## Features

- **Real-time 3D visualization** with altitude-based color coding
- **7 visual themes**: Modern, Digital/CRT, Dark, Arctic, Sunset, Neon, Vintage
- **Optional historical mode** with track playback and filtering
- **Mini radar** always showing live aircraft
- **Mobile responsive** with touch controls
- **Trail auto-fade** with configurable time windows
- **Military aircraft detection** with highlighting
- **Tron mode** with vertical curtain effects
- **Keyboard shortcuts** with searchable help menu
- **Mobile touch gestures**: Long-press for context menu, double-tap to reset camera

## Quick Start

### Using Published Image (Recommended)

The easiest way to run the container using the pre-built image from GitHub Container Registry:

```yaml
services:
  adsb-3d:
    image: ghcr.io/hook-365/adsb-3d:latest
    container_name: adsb-3d
    restart: unless-stopped
    environment:
      # Your station location (required)
      - LATITUDE=45.0000
      - LONGITUDE=-90.0000
      - ALTITUDE=1000
      - LOCATION_NAME=My Station

      # Your ADS-B feeder (required)
      - FEEDER_URL=http://ultrafeeder
      # Or: http://192.168.1.50:8080 or https://adsb.example.com

      # Optional: Enable historical mode (default: true)
      # - ENABLE_HISTORICAL=false   # Set to false for live-only mode
    ports:
      - "8086:80"
    networks:
      - default
```

Access at: `http://your-server:8086`

### Building Locally

If you prefer to build the image yourself:

```yaml
services:
  adsb-3d:
    build: .
    container_name: adsb-3d
    restart: unless-stopped
    environment:
      - LATITUDE=45.0000
      - LONGITUDE=-90.0000
      - ALTITUDE=1000
      - LOCATION_NAME=My Station
      - FEEDER_URL=http://ultrafeeder
    ports:
      - "8086:80"
```

Then build and run:
```bash
docker compose build
docker compose up -d
```

### Quick Docker Run

If you just want to test it quickly without docker-compose:

```bash
docker run -d \
  --name adsb-3d \
  -e LATITUDE=45.0000 \
  -e LONGITUDE=-90.0000 \
  -e ALTITUDE=1000 \
  -e LOCATION_NAME="My Station" \
  -e FEEDER_URL=http://ultrafeeder \
  -p 8086:80 \
  ghcr.io/hook-365/adsb-3d:latest
```

Then access at `http://your-server:8086`

### Deployment Modes

**Live-Only Mode** (fast, no database needed):
```bash
ENABLE_HISTORICAL=false docker compose up -d adsb-3d
```

**Live + Optional Historical** (default, auto-detects Track API if available):
```bash
docker compose up -d adsb-3d
```

**Full Historical Stack** (includes TimescaleDB, Track Collector, Track API):

For historical track storage, uncomment the TimescaleDB service in `docker-compose.example.yml`. Historical data is stored in `./timescaledb/data/` - backup this directory regularly!

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `LATITUDE` | Yes | Your station latitude | `45` |
| `LONGITUDE` | Yes | Your station longitude | `-90` |
| `ALTITUDE` | Yes | Your station altitude (feet MSL) | `1000` |
| `LOCATION_NAME` | No | Display name for your station | `My Station` |
| `FEEDER_URL` | Yes | ADS-B feeder URL | `http://ultrafeeder` |
| `ENABLE_HISTORICAL` | No | Enable historical mode (true/false) | `true` |
| `TZ` | No | Timezone | `America/Chicago` |

### FEEDER_URL Formats

Works with any standard ADS-B feeder (ultrafeeder, tar1090, readsb, dump1090, etc.):

```
http://ultrafeeder              # Docker service name
http://192.168.1.50:8080        # External device IP:port
https://adsb.example.com        # Public instance
http://localhost:8080           # Local instance
```

The feeder must expose the standard `/data/aircraft.json` endpoint.

## How It Works

### Live Mode (Always)

- Browser requests real-time data from `/data/aircraft.json`
- nginx proxies requests to your `FEEDER_URL` (feeder service)
- 3D scene updates every 1 second with current aircraft
- No database required

### Historical Mode (Optional)

To enable historical track playback and analysis, you need the Track API service:

**What is the Track API?**
- REST API built with FastAPI that queries historical aircraft tracks
- Stores all aircraft positions in a TimescaleDB time-series database
- Continuously collects position data from your ADS-B feeder
- Provides APIs for time-range queries, filtering, and analytics

**How to enable it:**
1. Set `ENABLE_HISTORICAL=true` (default) in your environment
2. Deploy the Track API service with `docker compose --profile historical up -d`
3. The 3D viewer auto-detects the API at `/api/health` and enables historical features
4. If the API is unavailable, the viewer gracefully falls back to live-only mode
5. To disable: Set `ENABLE_HISTORICAL=false` to hide historical UI (services can still run)

**In Historical Mode you can:**
- Select a date/time range and load all recorded aircraft tracks
- Play back recorded flights chronologically with animated trails
- Filter tracks by altitude, speed, military status, and more
- Analyze aircraft behavior patterns over time
- Export track data for further analysis

**Data retention:**
- All aircraft positions automatically stored in TimescaleDB
- Configurable retention period (typically 7-30 days depending on disk space)
- Supports querying ranges from minutes to months of history

## Usage

### View Controls

**Desktop/Laptop**:
- **Click + Drag**: Rotate camera
- **Scroll**: Zoom in/out
- **Right-click + Drag**: Pan camera
- **Q/E keys**: Roll camera
- **Arrow keys**: Pan camera
- **+/-**: Zoom in/out

**Mobile/Tablet**:
- **Tap + Drag**: Rotate camera
- **Pinch**: Zoom in/out
- **Long-press aircraft**: Show context menu (select, follow, info)
- **Double-tap**: Reset camera to home position

### Settings Panel

Access via the gear icon (⚙️):

**Actions:**
- **Reset Camera**: Return to home position
- **Themes**: Switch between 7 visual themes
- **Keyboard Shortcuts**: View organized keyboard help

**Display Toggles:**
- **Trails**: Show/hide aircraft flight paths
- **Labels**: Show/hide aircraft callsigns and altitudes
- **Airports**: Show/hide airport markers
- **Runways**: Show/hide runway outlines
- **Alt Lines**: Show/hide altitude grid lines
- **Mini Radar**: Always-live radar display (bottom-right)
- **Compass**: Cardinal direction indicator
- **Auto-fade Trails**: Fade old trails over time (30min, 1hr, 2hr, or never)

### Keyboard Help

Click the **?** icon for an organized shortcut guide with categories:
- Camera controls
- Display toggles
- Effects and visuals
- Navigation and filtering
- Mobile gestures

### Aircraft Selection & Filtering

**Search & Select:**
- **Click aircraft**: Select and show aircraft details
- **Follow mode**: Camera follows selected aircraft
- **Aircraft list**: Search and filter aircraft by callsign or ICAO
- **Mobile**: Long-press aircraft to select and show context menu

**Historical Mode Filtering:**
When in historical mode, filter tracks before loading:
- **Altitude**: Minimum and maximum altitude in feet
- **Speed**: Minimum and maximum speed in knots
- **Military Only**: Show only military aircraft
- **Filters persist** across sessions via URL state

### Shareable Links

The app encodes your current view state in the URL, allowing you to:
- **Share views**: Send a link with specific mode, time range, filters, theme
- **Bookmark configurations**: Save your favorite view setups
- **Browser back/forward**: Navigate through different views
- **Deep linking**: Link directly to aircraft, date ranges, or filter sets

Example URL components:
```
?mode=historical&start=2024-01-15T00:00Z&end=2024-01-15T23:59Z
&altitude_min=5000&altitude_max=35000&military=false&theme=arctic
```

## Browser Compatibility

| Browser | Desktop | Mobile |
|---------|---------|--------|
| Chrome/Chromium | ✓ | ✓ |
| Firefox | ✓ | ✓ |
| Safari | ✓ | ✓ (iOS 13+) |
| Edge | ✓ | ✓ |

Requires WebGL 1.0+ support. Modern browsers recommended for best performance.

## Visual Features

### Tron Mode

Enables a dramatic vertical curtain effect:
- **What it does**: Draws altitude-based vertical "curtains" through the scene
- **Visual effect**: Creates immersive sci-fi aesthetic with layered altitude visualization
- **Performance impact**: Slightly heavier rendering (disable if experiencing lag)
- **Toggle**: Available in Settings panel

### Military Aircraft Detection

Aircraft are automatically identified as military or civilian:
- **Military aircraft**: Highlighted with distinctive color (red by default, theme-dependent)
- **Detection**: Based on aircraft ICAO codes and known military registries
- **Filter**: Can filter to show only military aircraft in historical mode
- **Visual**: Badge appears in aircraft info panel

## Themes

| Theme | Style | Best For |
|-------|-------|----------|
| **Modern** | Clean, minimal | General use |
| **Digital/CRT** | Terminal aesthetic, monospace | Retro look |
| **Dark** | OLED-optimized blacks | Night viewing |
| **Arctic** | Frosted glass effect | Modern, cool look |
| **Sunset** | Warm orange/coral | Comfortable viewing |
| **Neon** | Glowing cyberpunk | Fun, distinctive |
| **Vintage** | Military radar style | Authentic ADS-B feel |

Theme selection persists in browser storage. Dynamic scene updates (lights, fog, distance rings) change to match theme.

## Performance

### Optimization Tips

- **Trail Auto-fade**: Enabled by default (Settings → Trail Settings)
  - Reduces memory usage over long sessions
  - Configure fade time and highlight duration
- **Tron Mode**: Disable if experiencing lag
- **Mini Radar**: Toggle in Settings if needed

### System Requirements

- **CPU**: 2+ cores (handles 100+ aircraft)
- **RAM**: 256MB for container, 100MB for browser
- **Network**: Stable connection to feeder

### Memory Behavior

- Trails auto-clean every 60 seconds
- Memory usage stable over 24+ hour sessions
- No memory leaks in Three.js scene

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Browser 3D Viewer                        │
└──────────────────┬───────────────────────────────────────────┘
                   │
        ┌──────────┴────────────┐
        ▼                       ▼
   LIVE DATA             HISTORICAL DATA
   (always)             (if available)
        │                       │
        ▼                       ▼
   nginx (port 8086)    Track API (port 8087)
        │                       │
        ▼                       ▼
  FEEDER_URL              TimescaleDB
(ultrafeeder,            (aircraft
tar1090, etc)            position
                         history)
```

### Data Flow

**Live Mode:**
1. Browser polls `FEEDER_URL/data/aircraft.json` every 1 second
2. nginx proxies to your configured feeder
3. 3D scene renders current aircraft in real-time

**Historical Mode:**
1. Browser requests Track API for date/time range
2. Track API queries TimescaleDB for stored positions
3. Returns track data with filtering/analytics applied
4. Browser renders playback with animated trails

### Track API Details

The Track API is a REST service that provides:
- **Time-range queries**: Fetch all tracks between two timestamps
- **Filtering**: By altitude range, speed, military status, track length
- **Analytics**: Aircraft frequency, popular routes, behavior patterns
- **Limits**: Configurable max aircraft per query (up to 10,000)
- **Resolution**: Full detail, 1-minute intervals, or 5-minute intervals

### Rate Limiting & Limits

To prevent database overload:
- **30 requests/min** per IP (normal)
- **Burst of 10** requests allowed
- **max_tracks**: Up to 10,000 aircraft per query (configurable, default 500)
- **Time limit**: 60-second query timeout for expensive operations

### Caching

- **HTML/JS**: No cache (always fresh)
- **Aircraft images**: 24 hours
- **Compression**: Gzip enabled

## File Structure

```
adsb-3d/
├── public/
│   ├── index.html              # UI, CSS, themes
│   ├── app.js                  # Three.js logic, 6100+ lines
│   └── config.js               # Auto-generated from env vars
├── nginx/
│   ├── nginx.conf              # Main server config
│   └── http.conf               # Rate limiting
├── Dockerfile                  # nginx:alpine
├── entrypoint.sh               # Config generation
├── docker-compose.example.yml  # Deployment template
└── README.md                   # This file
```

## Deployment in Docker Compose Stack

In your main `docker-compose.yml`:

```yaml
services:
  ultrafeeder:
    image: ghcr.io/sdr-enthusiasts/docker-adsb-ultrafeeder:latest
    ports:
      - "8085:80"
    # ... rest of config

  adsb-3d:
    build: ./adsb-3d
    restart: unless-stopped
    environment:
      - LATITUDE=${LATITUDE}
      - LONGITUDE=${LONGITUDE}
      - ALTITUDE=${ALTITUDE}
      - FEEDER_URL=http://ultrafeeder
    ports:
      - "8086:80"
    depends_on:
      - ultrafeeder
```

Then deploy:

```bash
docker compose build adsb-3d
docker compose up -d adsb-3d
```

## Development

### Source Code

- `public/index.html`: ~2650 lines (HTML, CSS, 7 themes, panels)
- `public/app.js`: ~6100 lines (Three.js, rendering, interactions, modes)

### Tech Stack

- **Three.js r128**: 3D graphics
- **nginx:alpine**: Web server + reverse proxy
- **Vanilla JavaScript**: No build tools or frameworks
- **CSS Variables**: Theme engine

### Making Changes

1. Edit `public/index.html` or `public/app.js`
2. Rebuild container:
   ```bash
   docker compose build adsb-3d
   ```
3. Restart service:
   ```bash
   docker compose up -d adsb-3d
   ```

### Common Customizations

- **Change default theme**: Edit `app.js` line ~100 (setTheme default)
- **Add new color scheme**: Add CSS variables in `index.html` (lines ~100-650)
- **Adjust camera defaults**: Edit `app.js` initialization
- **Change update frequency**: Modify `fetchInterval` in `app.js`

## Known Limitations

- **Browser rendering**: Single-threaded, max ~500 aircraft live before performance degrades
- **Historical queries**: Track API supports up to 10,000 aircraft per query (configurable)
- **Historical mode**: Requires separate Track API and TimescaleDB services
- **CORS proxying**: External image sources (airport-data.com) proxied through nginx
- **Storage**: Historical data retention limited by available disk space

## Security Notes

- Rate limiting prevents query abuse
- Query parameter validation blocks excessive dataset requests
- No authentication required (assumes private/trusted network)
- Static content cache busting via nginx

## License

MIT License

## Credits

- **Three.js**: 3D rendering engine
- **tar1090**: ADS-B altitude color scheme
- **sdr-enthusiasts**: Ultrafeeder Docker image
- **airport-data.com**: Aircraft images
