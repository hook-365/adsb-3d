# Module API Documentation

**Project**: ADSB 3D Visualization
**Version**: Post-Refactoring (Phase 7 Complete)
**Last Updated**: 2025-11-25

This document describes the public API for each extracted module.

---

## Table of Contents

1. [constants.js](#constantsjs)
2. [theme-manager.js](#theme-managerjs)
3. [url-state-manager.js](#url-state-managerjs)
4. [aircraft-database.js](#aircraft-databasejs)
5. [data-service-live.js](#data-service-livejs)
6. [data-service-historical.js](#data-service-historicaljs)
7. [historical-mode.js](#historical-modejs)
8. [camera-rendering.js](#camera-renderingjs)
9. [aircraft-svg-system.js](#aircraft-svg-systemjs)

---

## constants.js

**Purpose**: Centralized configuration constants for the application.

### Exported Constants

| Export | Type | Description |
|--------|------|-------------|
| `API` | Object | API endpoint URLs |
| `TIMING` | Object | Update intervals and timeouts |
| `CACHE` | Object | Cache duration settings |
| `STORAGE_KEYS` | Object | localStorage key names |
| `SCENE` | Object | 3D scene configuration (camera, rendering) |
| `MAP` | Object | Map tile providers and settings |
| `DISTANCE_RINGS` | Object | Distance ring display settings |
| `AIRPORTS` | Object | Airport display configuration |
| `AIRCRAFT` | Object | Aircraft display settings |
| `TRAILS` | Object | Trail rendering configuration |
| `HISTORICAL` | Object | Historical mode settings |
| `ALTITUDE_SMOOTHING` | Object | Altitude smoothing parameters |
| `SIGNAL_QUALITY` | Object | Signal quality thresholds |
| `RATE_LIMIT` | Object | API rate limiting settings |
| `PERFORMANCE` | Object | Performance tuning parameters |
| `CONVERSIONS` | Object | Unit conversion factors |
| `CONFIG` | Object | Combined legacy config object |

### Exported Functions

```javascript
getCSSVar(varName)
// Returns the computed value of a CSS variable
// @param {string} varName - CSS variable name (with or without --)
// @returns {string} The computed CSS value

cssToThreeColor(cssColor)
// Converts CSS color to THREE.Color
// @param {string} cssColor - CSS color value
// @returns {THREE.Color}

getThemeColor(varName)
// Gets theme color as THREE.Color
// @param {string} varName - CSS variable name
// @returns {THREE.Color}

initializeThemeColors()
// Initializes theme colors from CSS variables
// Call after theme changes
```

### Usage Example

```javascript
import { API, TIMING, SCENE, getThemeColor } from './constants.js';

// Access API endpoints
fetch(API.AIRCRAFT_DATA);

// Use timing constants
setInterval(update, TIMING.LIVE_UPDATE_INTERVAL);

// Get theme colors for Three.js
const skyColor = getThemeColor('--sky-top');
```

---

## theme-manager.js

**Purpose**: Manages application themes and color schemes.

### Exported Functions

```javascript
applyTheme(themeName, sceneRef = null, configRef = null)
// Applies a theme to the application
// @param {string} themeName - Name of theme to apply
// @param {THREE.Scene} sceneRef - Optional scene reference for 3D updates
// @param {Object} configRef - Optional config reference
// Side effects: Updates CSS variables, localStorage, scene colors

updateSceneColors(scene, CONFIG)
// Updates 3D scene colors to match current theme
// @param {THREE.Scene} scene - The Three.js scene
// @param {Object} CONFIG - Configuration object

getCurrentTheme()
// Returns the name of the currently active theme
// @returns {string} Theme name

initializeTheme(sceneRef = null, configRef = null)
// Initializes theme system on page load
// Reads from localStorage or applies default
// @param {THREE.Scene} sceneRef - Optional scene reference
// @param {Object} configRef - Optional config reference

getThemes()
// Returns array of all available theme objects
// @returns {Array<Object>} Theme definitions

getTheme(themeName)
// Returns a specific theme by name
// @param {string} themeName - Theme name
// @returns {Object|undefined} Theme definition or undefined
```

### Available Themes

- `midnight-blue` (default)
- `classic-dark`
- `ocean-deep`
- `forest-night`
- `sunset-ember`
- `arctic-dawn`
- `cyberpunk`
- `monochrome`
- `military-green`
- `high-contrast`

### Usage Example

```javascript
import { applyTheme, getCurrentTheme, getThemes } from './theme-manager.js';

// Apply a theme
applyTheme('cyberpunk', scene, CONFIG);

// Get current theme
const current = getCurrentTheme(); // 'cyberpunk'

// List all themes
const themes = getThemes();
themes.forEach(t => console.log(t.name));
```

---

## url-state-manager.js

**Purpose**: Manages URL state, feature detection, and browser navigation.

### Exported Objects

```javascript
URLState
// Manages URL parameter state
// Properties:
//   - isHistorical: boolean
//   - dateRange: { startTime, endTime } | null
// Methods:
//   - updateURL(params): Update URL with new parameters
//   - getParam(name): Get URL parameter value
//   - parseHistoricalURL(): Parse historical mode params

FeatureDetector
// Detects available API features
// Methods:
//   - detectFeatures(): Async - detects all features
//   - hasHistorical(): boolean
//   - hasHealth(): boolean

AppFeatures
// Stores detected feature flags
// Properties:
//   - historical: boolean - Track API available
//   - health: boolean - Health endpoint available
//   - initialized: boolean
```

### Exported Functions

```javascript
initializeBrowserNavigation(applyCallback)
// Sets up browser back/forward navigation handling
// @param {Function} applyCallback - Called when URL changes
```

### Usage Example

```javascript
import { URLState, FeatureDetector, AppFeatures } from './url-state-manager.js';

// Check if historical mode requested via URL
if (URLState.isHistorical) {
    const range = URLState.dateRange;
    loadHistoricalData(range.startTime, range.endTime);
}

// Detect API features
await FeatureDetector.detectFeatures();
if (AppFeatures.historical) {
    showHistoricalModeUI();
}
```

---

## aircraft-database.js

**Purpose**: Military aircraft database and aircraft specifications.

### Exported Functions

```javascript
loadMilitaryDatabase(SafeStorage)
// Loads military aircraft database from GitHub
// @param {Object} SafeStorage - Safe localStorage wrapper
// @returns {Promise<void>}
// Side effects: Populates internal database, caches in localStorage

isMilitaryAircraft(hex)
// Checks if an aircraft is military
// @param {string} hex - Aircraft ICAO hex code
// @returns {boolean}

getMilitaryInfo(hex)
// Gets military aircraft information
// @param {string} hex - Aircraft ICAO hex code
// @returns {Object|null} { type, country, ... } or null

getAircraftSpecs(typeCode)
// Gets aircraft specifications by type code
// @param {string} typeCode - ICAO type code (e.g., 'B738')
// @returns {Object|null} Aircraft specs or null
```

### Exported Constants

```javascript
AIRCRAFT_TYPE_SPECS
// Object mapping type codes to specifications
// Example: { 'B738': { wingspan: 35.8, length: 39.5, ... } }
```

### Usage Example

```javascript
import { loadMilitaryDatabase, isMilitaryAircraft, getMilitaryInfo } from './aircraft-database.js';

// Initialize
await loadMilitaryDatabase(SafeStorage);

// Check aircraft
if (isMilitaryAircraft('AE1234')) {
    const info = getMilitaryInfo('AE1234');
    console.log(`Military: ${info.type} (${info.country})`);
}
```

---

## data-service-live.js

**Purpose**: Handles live aircraft data fetching and updates.

### Exported Functions

```javascript
fetchAircraftData(deps)
// Fetches current aircraft data from API
// @param {Object} deps - Dependencies { updateAircraft, updateStats, ... }
// @returns {Promise<Object>} Aircraft data response

startLiveUpdates(deps)
// Starts periodic live data updates
// @param {Object} deps - Dependencies
// Side effects: Sets up interval timer

stopLiveUpdates()
// Stops live data updates
// Side effects: Clears interval timer

getLiveRadarData()
// Returns the most recent radar data
// @returns {Object|null} Last fetched data

resetFetchErrors()
// Resets the fetch error counter
// Call after successful recovery

getFetchErrorCount()
// Returns current error count
// @returns {number}
```

### Usage Example

```javascript
import { startLiveUpdates, stopLiveUpdates } from './data-service-live.js';

// Start live updates
startLiveUpdates({
    updateAircraft: (data) => { /* update aircraft meshes */ },
    updateStats: (stats) => { /* update UI stats */ }
});

// Stop when switching modes
stopLiveUpdates();
```

---

## data-service-historical.js

**Purpose**: Handles historical track data loading.

### Exported Functions

```javascript
loadHistoricalTracks(hoursAgo = 1, deps)
// Loads tracks from the last N hours
// @param {number} hoursAgo - Hours of history to load
// @param {Object} deps - Dependencies
// @returns {Promise<Object>} Track data

loadHistoricalData(deps)
// Loads historical data based on URL parameters
// @param {Object} deps - Dependencies
// @returns {Promise<Object>}

loadHistoricalTracksCustom(startTime, endTime, deps)
// Loads tracks for a custom time range
// @param {Date|number} startTime - Start of range
// @param {Date|number} endTime - End of range
// @param {Object} deps - Dependencies
// @returns {Promise<Object>}

loadFullTrailForAircraft(icao, deps)
// Loads complete trail history for one aircraft
// @param {string} icao - Aircraft ICAO hex
// @param {Object} deps - Dependencies
// @returns {Promise<Object>}

loadRecentTrails(deps)
// Loads recent trail data (last 5 minutes)
// @param {Object} deps - Dependencies
// @returns {Promise<Object>}
```

### Usage Example

```javascript
import { loadHistoricalTracksCustom } from './data-service-historical.js';

// Load 2 hours of historical data
const startTime = Date.now() - (2 * 60 * 60 * 1000);
const endTime = Date.now();

const tracks = await loadHistoricalTracksCustom(startTime, endTime, {
    createHistoricalTrail: (hex, points) => { /* create trail */ },
    showNotification: (msg) => { /* show UI notification */ }
});
```

---

## historical-mode.js

**Purpose**: Historical mode UI, playback, heatmaps, and corridors.

### Exported Functions

```javascript
initHistoricalMode(deps)
// Initializes the historical mode module
// @param {Object} deps - Dependencies (scene, camera, etc.)
// @returns {Object} HistoricalMode API object

// Returned API object includes:
{
    enterHistoricalMode(),      // Switch to historical mode
    exitHistoricalMode(),       // Return to live mode
    loadCustomRange(start, end), // Load specific time range
    startPlayback(),            // Start playback animation
    pausePlayback(),            // Pause playback
    setPlaybackSpeed(speed),    // Set playback speed multiplier
    generateHeatmap(),          // Generate activity heatmap
    showCorridors(),            // Show flight corridors
    getState(),                 // Get current state
    // ... and more
}
```

### State Object

```javascript
HistoricalState = {
    active: boolean,           // Historical mode active
    displayMode: 'showall' | 'playback',
    tracks: Map,               // Loaded track data
    playbackTime: number,      // Current playback timestamp
    playbackSpeed: number,     // Speed multiplier
    isPlaying: boolean,        // Playback active
    heatmapVisible: boolean,   // Heatmap displayed
    corridorsVisible: boolean  // Corridors displayed
}
```

### Usage Example

```javascript
import { initHistoricalMode } from './historical-mode.js';

const HistoricalMode = initHistoricalMode({
    scene, camera, renderer,
    createTrail: (hex, points) => { /* ... */ }
});

// Enter historical mode
HistoricalMode.enterHistoricalMode();

// Load 4 hours of data
const start = Date.now() - (4 * 60 * 60 * 1000);
await HistoricalMode.loadCustomRange(start, Date.now());

// Start playback at 10x speed
HistoricalMode.setPlaybackSpeed(10);
HistoricalMode.startPlayback();
```

---

## camera-rendering.js

**Purpose**: Camera controls, rendering loop, and 3D scene management.

### Exported Functions

```javascript
initCameraRendering(deps)
// Initializes camera and rendering system
// @param {Object} deps - Dependencies
// @returns {Object} CameraRendering API

// Returned API includes:
{
    // Camera state
    CameraState,               // Camera position/angle state
    FollowState,               // Aircraft follow state
    TrailConfig,               // Trail configuration

    // Camera controls
    resetCamera(),             // Reset to default position
    focusOnAircraft(hex),      // Focus camera on aircraft
    focusOnTrack(hex),         // Focus on historical track
    animateCameraToPosition(pos, lookAt, duration, callback),
    syncCameraAnglesFromPosition(),
    updateCameraPosition(centerPoint),

    // Rendering
    animate(),                 // Main render loop
    updateRendererSize(),      // Handle window resize

    // Setup
    setupMouseControls(),
    setupTouchControls(),
    setupKeyboardControls(),

    // Utilities
    updateFollowButtonText(),
    showUnfollowButton(),
    hideUnfollowButton()
}
```

### Camera State

```javascript
CameraState = {
    angleX: number,      // Horizontal rotation (radians)
    angleY: number,      // Vertical rotation (radians)
    distance: number,    // Distance from center point
    isDragging: boolean,
    wasDragging: boolean,
    lastFrameTime: number
}
```

### Usage Example

```javascript
import { initCameraRendering } from './camera-rendering.js';

const CameraRendering = initCameraRendering({
    camera, scene, renderer, aircraftMeshes,
    setSelectedAircraft, updateFollowButtonText
});

// Focus on an aircraft
CameraRendering.focusOnAircraft('ABC123');

// Reset camera
CameraRendering.resetCamera();

// Access state
console.log(CameraRendering.CameraState.distance);
```

---

## aircraft-svg-system.js

**Purpose**: SVG-based aircraft shape rendering system.

### Global Object

```javascript
window.AircraftSVGSystem = {
    // Shape creation
    createAircraftShape(type, color),

    // Shape lookup
    getShapeForType(typeCode),
    getShapeCategory(typeCode),

    // Available shapes
    shapes: { /* shape definitions */ },

    // Utilities
    getSVGPath(shapeName),
    getDefaultShape()
}
```

### Shape Categories

- `jet_swept` - Swept-wing jets (airliners)
- `jet_nonswept` - Straight-wing jets
- `turboprop` - Turboprop aircraft
- `prop` - Piston propeller aircraft
- `helicopter` - Rotorcraft
- `military` - Military aircraft
- `glider` - Gliders and sailplanes
- `balloon` - Balloons and airships
- `drone` - UAVs and drones
- `ground` - Ground vehicles
- `unknown` - Fallback shape

### Usage Example

```javascript
// Get shape for aircraft type
const shape = AircraftSVGSystem.getShapeForType('B738');

// Create colored aircraft mesh
const mesh = AircraftSVGSystem.createAircraftShape('jet_swept', 0x00ff00);
scene.add(mesh);
```

---

## Module Dependency Graph

```
app.js (main orchestrator)
  ├── constants.js
  ├── theme-manager.js
  ├── url-state-manager.js
  ├── aircraft-database.js
  ├── data-service-live.js
  ├── data-service-historical.js
  ├── historical-mode.js
  ├── camera-rendering.js
  └── aircraft-svg-system.js (global)
```

---

## Migration Notes

When migrating code to use these modules:

1. **Import statements**: Add at top of consuming file
2. **Dependencies**: Pass required dependencies via `deps` object
3. **State access**: Use getter/setter functions, not direct variable access
4. **Initialization order**:
   - constants.js first
   - theme-manager.js
   - url-state-manager.js
   - aircraft-database.js
   - data-service-*.js
   - historical-mode.js
   - camera-rendering.js (requires scene/camera)

---

## Versioning

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-25 | Initial documentation post-refactoring |
