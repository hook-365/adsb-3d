# ADS-B 3D Viewer

Real-time and historical 3D visualization of ADS-B aircraft data with 7 visual themes and interactive controls.

## Features

- **Real-time 3D visualization** with altitude-based color coding
- **7 visual themes**: Modern, Digital/CRT, Dark, Arctic, Sunset, Neon, Vintage
- **Optional historical mode** with track playback and filtering
- **Mini radar** always showing live aircraft
- **Mobile responsive** with touch controls
- **Military aircraft detection** and Tron mode with vertical curtains
- **Shareable URLs** with persistent filters and view state

## Quick Start

### Option 1: Live-Only Mode (Simple)

Real-time aircraft visualization with no database.

**docker-compose.yml:**
```yaml
services:
  adsb-3d:
    image: ghcr.io/hook-365/adsb-3d:latest
    container_name: adsb-3d
    restart: unless-stopped
    environment:
      - LATITUDE=45.0000
      - LONGITUDE=-90.0000
      - ALTITUDE=1000
      - LOCATION_NAME=My Station
      - FEEDER_URL=http://ultrafeeder
      - ENABLE_HISTORICAL=false
    ports:
      - "8086:80"
```

Deploy:
```bash
docker compose up -d
```

Access at: `http://your-server:8086`

### Option 2: Full Historical Stack

Real-time + historical track playback and analysis.

**.env:**
```bash
LATITUDE=45.0000
LONGITUDE=-90.0000
ALTITUDE=1000
LOCATION_NAME=My Station
FEEDER_URL=http://ultrafeeder
TIMESCALEDB_PASSWORD=your_secure_password_here
```

**docker-compose.yml:**
```yaml
services:
  adsb-3d:
    image: ghcr.io/hook-365/adsb-3d:latest
    container_name: adsb-3d
    restart: unless-stopped
    environment:
      - LATITUDE=${LATITUDE}
      - LONGITUDE=${LONGITUDE}
      - ALTITUDE=${ALTITUDE}
      - LOCATION_NAME=${LOCATION_NAME}
      - FEEDER_URL=${FEEDER_URL}
      - ENABLE_HISTORICAL=true
    ports:
      - "8086:80"
    depends_on:
      - track-service

  track-service:
    image: ghcr.io/hook-365/adsb-track-service:latest
    container_name: track-service
    restart: unless-stopped
    environment:
      - FEEDER_URL=${FEEDER_URL}
      - DB_HOST=timescaledb-adsb
      - DB_PORT=5432
      - DB_NAME=adsb_tracks
      - DB_USER=adsb
      - DB_PASSWORD=${TIMESCALEDB_PASSWORD}
      - COLLECTION_INTERVAL=5
    ports:
      - "8087:8000"
    depends_on:
      - timescaledb-adsb

  timescaledb-adsb:
    image: timescale/timescaledb:latest-pg16
    container_name: timescaledb-adsb
    restart: unless-stopped
    environment:
      - POSTGRES_DB=adsb_tracks
      - POSTGRES_USER=adsb
      - POSTGRES_PASSWORD=${TIMESCALEDB_PASSWORD}
    volumes:
      # Option A: Named volume (Docker-managed)
      - timescaledb-data:/var/lib/postgresql/data
      # Option B: Bind mount (choose your path)
      # - ./timescaledb/data:/var/lib/postgresql/data
      # - /path/to/data:/var/lib/postgresql/data
    ports:
      - "5433:5432"

# Define named volume (if using Option A)
volumes:
  timescaledb-data:
```

Deploy:
```bash
docker compose up -d
```

**Data Storage:**
- **Named volume**: `docker volume inspect timescaledb-data` to find location
- **Bind mount**: `./timescaledb/data/` or your custom path
- **Backup**: `docker run --rm -v timescaledb-data:/data -v $(pwd):/backup alpine tar czf /backup/backup.tar.gz /data`

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `LATITUDE` | Yes | Your station latitude | `45` |
| `LONGITUDE` | Yes | Your station longitude | `-90` |
| `ALTITUDE` | Yes | Your station altitude (feet MSL) | `1000` |
| `LOCATION_NAME` | No | Display name for your station | `My Station` |
| `FEEDER_URL` | Yes | ADS-B feeder URL (ultrafeeder, tar1090, readsb, dump1090) | `http://ultrafeeder` |
| `ENABLE_HISTORICAL` | No | Enable historical mode (true/false) | `true` |
| `TZ` | No | Timezone | `America/Chicago` |

**FEEDER_URL** must expose `/data/aircraft.json` endpoint. Formats:
- `http://ultrafeeder` (Docker service name)
- `http://192.168.1.50:8080` (External IP:port)
- `https://adsb.example.com` (Public instance)

## How It Works

**Live Mode** (always available):
- Browser polls feeder's `/data/aircraft.json` every 1 second
- nginx proxies to your `FEEDER_URL`
- 3D scene updates in real-time, no database required

**Historical Mode** (optional):
- Requires Track Service + TimescaleDB stack (3 containers total)
- Track Service combines collector and API in one container:
  - **Background collector**: Polls feeder every 5 seconds, writes positions to DB
  - **REST API**: FastAPI endpoints for historical queries
- Browser requests historical data and renders playback
- Features: altitude/speed filtering, military aircraft detection, animated playback

**Data retention**: Configurable (typically 7-30 days depending on disk space)

## Usage

### Controls

**Desktop**: Click+drag (rotate), scroll (zoom), right-click+drag (pan), Q/E (roll), arrow keys (pan)

**Mobile**: Tap+drag (rotate), pinch (zoom), long-press aircraft (context menu), double-tap (reset camera)

### Settings Panel (⚙️)

- **Themes**: 7 visual themes with dynamic scene updates
- **Display Toggles**: Trails, labels, airports, runways, altitude lines, mini radar, compass
- **Trail Auto-fade**: Configurable fade time (30min, 1hr, 2hr, or never)
- **Tron Mode**: Vertical altitude curtains for dramatic visualization

### Historical Mode

- **Time Presets**: 1h, 4h, 8h, 12h, 24h or custom range
- **Filters**: Altitude (min/max), speed (min/max), military only, minimum positions
- **Display Modes**: Show all tracks at once, or animated playback
- **Shareable URLs**: All settings persist in URL for bookmarking/sharing

### Keyboard Shortcuts

Click **?** icon for full shortcut guide organized by category.

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

## Browser Compatibility

| Browser | Desktop | Mobile |
|---------|---------|--------|
| Chrome/Chromium | ✓ | ✓ |
| Firefox | ✓ | ✓ |
| Safari | ✓ | ✓ (iOS 13+) |
| Edge | ✓ | ✓ |

Requires WebGL 1.0+. Modern browsers recommended for best performance.

## Performance

**System Requirements:**
- CPU: 2+ cores (handles 100+ aircraft)
- RAM: 256MB for container, 100MB for browser
- Network: Stable connection to feeder

**Optimization:**
- Trail auto-fade enabled by default (reduces memory usage)
- Trails auto-clean every 60 seconds
- Stable memory over 24+ hour sessions
- Disable Tron mode if experiencing lag

**Limits:**
- Browser: ~500 aircraft max before performance degrades
- Historical queries: Up to 10,000 aircraft per query (configurable)
- Track API: 30 requests/min per IP, burst of 10

## Architecture

```
Browser 3D Viewer
    │
    ├─► LIVE DATA → nginx (8086) → FEEDER_URL
    │
    └─► HISTORICAL DATA → Track Service (8087) → TimescaleDB
                          ├─ Background Collector (polls feeder)
                          └─ REST API (FastAPI)
```

**Tech Stack:**
- **Frontend**: Three.js r128, nginx:alpine, vanilla JavaScript, CSS Variables
- **Backend**: Python FastAPI, asyncpg, aiohttp
- **Database**: TimescaleDB (PostgreSQL time-series)

**Track Service Features:**
- **Collector**: Polls feeder every 5 seconds, stores positions, updates metadata
- **API**: Time-range queries, filtering, analytics, military aircraft detection
- **Shared pool**: Single asyncpg connection pool (2-20 connections)
- **Resolution options**: Full detail, 1-min intervals, 5-min intervals
- **Rate limiting**: 30 requests/min per IP, burst of 10

## Development

**Source Code:**
- `public/index.html` - ~2650 lines (HTML, CSS, 7 themes)
- `public/app.js` - ~6100 lines (Three.js, rendering, interactions)

**Making Changes:**
```bash
# Edit files
vim public/app.js

# Rebuild and deploy
docker compose build adsb-3d
docker compose up -d adsb-3d
```

**Common Customizations:**
- Default theme: `app.js` line ~100
- New color scheme: `index.html` CSS variables
- Camera defaults: `app.js` initialization
- Update frequency: `CONFIG.updateInterval` in `app.js`

## Known Limitations

- Browser rendering is single-threaded (max ~500 live aircraft)
- Historical mode requires Track Service + TimescaleDB (3 containers total)
- Track Service combines collector+API - if one fails, both stop (acceptable for homelab)
- External images (airport-data.com) proxied through nginx for CORS
- Storage retention limited by available disk space
- No authentication (assumes private/trusted network)

## License

MIT License

## Credits

- **Three.js**: 3D rendering engine
- **tar1090**: ADS-B altitude color scheme
- **Mictronics readsb-protobuf**: Military aircraft database (GPL-3.0)
- **sdr-enthusiasts**: Ultrafeeder Docker image
- **airport-data.com**: Aircraft images
