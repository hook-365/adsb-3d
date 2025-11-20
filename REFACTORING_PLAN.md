# ADSB 3D Visualization - Refactoring Plan

**Goal**: Break the 12,428-line monolithic `app.js` into focused, testable modules while maintaining 100% functionality.

**Strategy**: Incremental extraction with continuous testing - nothing ships broken.

---

## Phase Overview

| Phase | Module | Lines Extracted | Risk Level | Duration | Dependencies |
|-------|--------|-----------------|------------|----------|--------------|
| 0 | Setup & Baseline | 0 | None | 2 days | None |
| 1 | Config & Constants | ~300 | Very Low | 2 days | None |
| 2 | Theme Manager | ~755 | Low | 3 days | Phase 1 |
| 3 | URL State Manager | ~485 | Low | 3 days | Phase 1 |
| 4 | Aircraft Database | ~400 | Low | 3 days | Phase 1 |
| 5 | Data Services | ~800 | Medium | 5 days | Phase 1 |
| 6 | Historical Module | ~1,900 | Medium | 5 days | Phase 5 |
| 7 | Testing & Polish | 0 | Low | 3 days | All |

**Total Duration**: ~4 weeks (with buffer)
**Total Lines Extracted**: ~4,640 lines (app.js reduced to ~7,800 lines)

---

## Phase 0: Setup & Baseline Testing

**Duration**: 2 days

### Goals
1. Establish baseline functionality tests
2. Create smoke test suite
3. Document current functionality
4. Set up progress tracking

### Deliverables

#### 1. Manual Test Checklist (`MANUAL_TESTS.md`)
Comprehensive checklist covering:
- ✅ Live mode: Aircraft display, trails, labels, selection
- ✅ Historical mode: Track loading, playback, heat maps, corridors
- ✅ UI: Sidebar, search, settings, theme switching
- ✅ Mobile: Touch controls, gestures, responsive layout
- ✅ Features: Tron mode, altitude lines, distance rings, airports

#### 2. Automated Smoke Tests (`tests/smoke-test.html`)
Browser-based tests that verify:
- App initializes without errors
- Required DOM elements exist
- Global objects are defined
- Theme system loads
- 3D scene renders

#### 3. Baseline Metrics
Capture before refactoring:
- Page load time
- Time to first aircraft render
- Memory usage with 100/500/1000 aircraft
- Frame rate (FPS) under load

### Tasks
- [ ] Create `tests/` directory
- [ ] Write `MANUAL_TESTS.md` comprehensive checklist
- [ ] Create `tests/smoke-test.html` automated checks
- [ ] Run full manual test and document results
- [ ] Capture performance baseline
- [ ] Create `REFACTORING_LOG.md` to track each change

---

## Phase 1: Config & Constants

**Duration**: 2 days
**Risk**: Very Low
**Lines Extracted**: ~300

### Overview
Extract all magic numbers, configuration defaults, and API endpoints into a centralized config module.

### What Gets Extracted

#### `config.js` (~300 lines)
```javascript
export const CONFIG = {
  // API Endpoints
  API: {
    AIRCRAFT_DATA: '/data/aircraft.json',
    HEALTH: '/api/health',
    TRACKS: '/api/tracks',
    RECENT_TRAILS: '/api/recent',
    MILITARY_DB: 'https://raw.githubusercontent.com/...',
    ROUTE_API: 'https://www.adsbdb.com/api/v0/callsign/',
  },

  // Update Intervals
  TIMING: {
    LIVE_UPDATE_INTERVAL: 1000,        // 1 second
    STATS_UPDATE_INTERVAL: 5000,       // 5 seconds
    TRAIL_FADE_DEFAULT: 300000,        // 5 minutes
    STALE_AIRCRAFT_TIMEOUT: 60000,     // 1 minute
  },

  // 3D Scene
  SCENE: {
    CAMERA_FOV: 60,
    CAMERA_NEAR: 0.1,
    CAMERA_FAR: 1000000,
    INITIAL_CAMERA_HEIGHT: 30000,
    MAX_RENDER_DISTANCE: 500000,       // 500km
    TARGET_FPS: 30,
  },

  // Trails
  TRAILS: {
    MAX_POINTS: 1000,
    MIN_DISTANCE_BETWEEN_POINTS: 50,   // meters
    GRADIENT_STEPS: 10,
    TUBE_RADIUS: 50,
    TRON_HEIGHT: 3000,                 // meters
  },

  // Map Tiles
  MAP: {
    PROVIDERS: {
      CARTO_DARK: 'https://cartodb-basemaps...',
      OSM: 'https://tile.openstreetmap.org...',
      // etc.
    },
    TILE_SIZE: 256,
    ZOOM_LEVEL: 8,
  },

  // Aircraft Display
  AIRCRAFT: {
    MIN_ALTITUDE_DISPLAY: -1000,       // Show on ground
    MAX_ALTITUDE_DISPLAY: 50000,       // ~FL500
    LABEL_UPDATE_THROTTLE: 100,        // ms
    SPRITE_SIZE: 32,
  },

  // Military Database
  MILITARY: {
    CACHE_KEY: 'militaryAircraftDatabase',
    CACHE_DURATION: 86400000,          // 24 hours
    CACHE_VERSION: 1,
  },

  // Storage Keys
  STORAGE: {
    THEME: 'selectedTheme',
    SETTINGS: 'userSettings',
    RECENT_TRAILS: 'recentTrailsCache',
    STATS: 'aircraftStats',
  },
};

// Feature Flags
export const FEATURES = {
  ENABLE_TRON_MODE: true,
  ENABLE_HEAT_MAP: true,
  ENABLE_CORRIDORS: true,
  ENABLE_SPRITES: true,
  ENABLE_ALTITUDE_SMOOTHING: true,
};

// Validation
export function validateConfig() {
  // Runtime checks for required config
}
```

### Files Changed
- **New**: `public/config.js`
- **Modified**: `public/app.js` (remove constants, import config)
- **Modified**: `public/index.html` (add script tag)

### Testing Strategy

#### Automated Tests
```javascript
// tests/config-test.html
- CONFIG object exists
- All expected keys are present
- No undefined values
- Numeric values are valid ranges
```

#### Manual Tests
- [ ] App loads without errors
- [ ] Live mode works (uses correct update interval)
- [ ] Theme switching works (uses correct storage keys)
- [ ] Trails fade at correct rate

### Success Criteria
- ✅ All CONFIG references use import
- ✅ No magic numbers in app.js (except 0, 1, -1, null)
- ✅ Smoke tests pass
- ✅ Full manual test checklist passes

### Rollback Plan
- Git revert to previous commit
- 1-file change, easy to undo

---

## Phase 2: Theme Manager

**Duration**: 3 days
**Risk**: Low
**Lines Extracted**: ~755 (lines 32-786)

### Overview
Extract the complete theme system into a standalone module with clear API.

### What Gets Extracted

#### `theme-manager.js` (~755 lines)
```javascript
/**
 * Theme Manager - Handles all theming functionality
 * Self-contained module with no external dependencies
 */

// Theme definitions (all existing themes)
const THEMES = {
  dark: { /* ... */ },
  light: { /* ... */ },
  neon: { /* ... */ },
  // ... all existing themes
};

export class ThemeManager {
  constructor() {
    this.currentTheme = null;
    this.callbacks = [];
  }

  // Public API
  init() { /* Load saved theme, apply defaults */ }
  setTheme(themeName) { /* Switch to theme */ }
  getTheme() { /* Return current theme */ }
  getAvailableThemes() { /* Return list */ }
  onThemeChange(callback) { /* Register listener */ }

  // Internal methods
  _applyTheme(theme) { /* Update CSS variables */ }
  _saveTheme(themeName) { /* localStorage */ }
  _loadTheme() { /* From localStorage */ }
  _notifyListeners() { /* Call callbacks */ }
}

// Singleton instance
export const themeManager = new ThemeManager();
```

### Integration Points

#### In `app.js`
```javascript
import { themeManager } from './theme-manager.js';

// Replace global theme functions with:
themeManager.init();

// Listen for theme changes to update 3D scene colors
themeManager.onThemeChange((theme) => {
  updateSceneColors(theme);
  updateSkyColors(theme);
  updateTrailColors(theme);
});
```

### Files Changed
- **New**: `public/theme-manager.js`
- **Modified**: `public/app.js` (remove lines 32-786, add import)
- **Modified**: `public/index.html` (add module script tag)

### Testing Strategy

#### Automated Tests
```javascript
// tests/theme-manager-test.html
- ThemeManager loads without errors
- Can initialize with default theme
- Can switch between all themes
- CSS variables are updated correctly
- localStorage persistence works
- Callbacks are invoked on change
- Invalid theme names are rejected
```

#### Manual Tests
- [ ] Default theme loads on first visit
- [ ] Each theme can be selected from modal
- [ ] Theme persists across page refresh
- [ ] 3D scene colors update immediately
- [ ] Sky gradient updates
- [ ] Trail colors update
- [ ] All UI elements respect theme
- [ ] Theme modal shows correct active theme

### Success Criteria
- ✅ All automated tests pass
- ✅ All manual tests pass
- ✅ No theme-related code in app.js
- ✅ Console shows no errors
- ✅ Performance unchanged (measure FPS)

### Rollback Plan
- Git revert
- Low risk: Theme system is well-isolated

---

## Phase 3: URL State Manager

**Duration**: 3 days
**Risk**: Low
**Lines Extracted**: ~485 (lines 788-1272)

### Overview
Extract URL state management for shareable links and browser history.

### What Gets Extracted

#### `url-state-manager.js` (~485 lines)
```javascript
/**
 * URL State Manager - Browser URL and history management
 * Handles shareable links for aircraft selection, camera position, etc.
 */

export class URLStateManager {
  constructor() {
    this.state = {};
    this.listeners = new Map();
  }

  // Public API
  init() { /* Parse initial URL */ }
  updateURL(params) { /* Update browser URL */ }
  getState() { /* Return current state */ }
  onStateChange(key, callback) { /* Listen for specific param */ }

  // State parameters
  setSelectedAircraft(icao) { /* Update ?aircraft=... */ }
  setCameraPosition(lat, lon, alt) { /* Update ?cam=... */ }
  setMode(mode) { /* Update ?mode=live|historical */ }
  setDate(date) { /* For historical mode */ }

  // Internal
  _parseURL() { /* Parse query params */ }
  _updateBrowserURL() { /* pushState */ }
  _notifyListeners(key, value) { /* Callbacks */ }
}

export const urlState = new URLStateManager();
```

### Integration Points

#### In `app.js`
```javascript
import { urlState } from './url-state-manager.js';

urlState.init();

// When aircraft is selected
urlState.setSelectedAircraft(icao);

// Listen for URL changes (browser back/forward)
urlState.onStateChange('aircraft', (icao) => {
  selectAircraftByIcao(icao);
});

urlState.onStateChange('mode', (mode) => {
  switchMode(mode);
});
```

### Files Changed
- **New**: `public/url-state-manager.js`
- **Modified**: `public/app.js` (remove lines 788-1272, add import)

### Testing Strategy

#### Automated Tests
```javascript
// tests/url-state-test.html
- URL parsing works correctly
- State updates modify browser URL
- Query parameters are encoded properly
- Browser back/forward triggers callbacks
- Multiple state changes are batched
- Invalid parameters are handled gracefully
```

#### Manual Tests
- [ ] Selecting aircraft updates URL with ?aircraft=ICAO
- [ ] Sharing URL loads correct aircraft
- [ ] Browser back button restores previous state
- [ ] Browser forward button works
- [ ] Switching to historical mode updates URL
- [ ] Date selection updates URL
- [ ] Camera position can be shared (if implemented)

### Success Criteria
- ✅ All automated tests pass
- ✅ URL sharing works as before
- ✅ Browser history navigation works
- ✅ No URL-related code in app.js

### Rollback Plan
- Git revert
- URL system is isolated, low risk

---

## Phase 4: Aircraft Database

**Duration**: 3 days
**Risk**: Low
**Lines Extracted**: ~400

### Overview
Extract military aircraft database loading, caching, and lookup into dedicated module.

### What Gets Extracted

#### `aircraft-database.js` (~400 lines)
```javascript
/**
 * Aircraft Database - Military aircraft identification
 * Loads and caches military aircraft database from GitHub
 */

export class AircraftDatabase {
  constructor(config) {
    this.config = config;
    this.database = null;
    this.loading = false;
    this.loadPromise = null;
  }

  // Public API
  async load() { /* Fetch from GitHub, use cache */ }
  isMilitary(icao) { /* Check if ICAO is military */ }
  getAircraftInfo(icao) { /* Get details */ }
  isLoaded() { /* Check if ready */ }
  clearCache() { /* Force reload */ }

  // Internal
  _loadFromCache() { /* localStorage */ }
  _saveToCache(data) { /* localStorage */ }
  _fetchFromGitHub() { /* Fetch CSV */ }
  _parseCSV(csv) { /* Parse military DB */ }
  _isCacheValid() { /* Check expiry */ }
}

export const aircraftDatabase = new AircraftDatabase(CONFIG.MILITARY);
```

### Integration Points

#### In `app.js`
```javascript
import { aircraftDatabase } from './aircraft-database.js';

// On init
await aircraftDatabase.load();

// When checking aircraft
if (aircraftDatabase.isMilitary(icao)) {
  // Show military badge
}

const info = aircraftDatabase.getAircraftInfo(icao);
```

### Files Changed
- **New**: `public/aircraft-database.js`
- **Modified**: `public/app.js` (remove database code, add import)

### Testing Strategy

#### Automated Tests
```javascript
// tests/aircraft-database-test.html
- Database loads successfully
- Cache is used if valid
- Cache expires after 24 hours
- Known military ICAO returns true
- Unknown ICAO returns false
- Handles network errors gracefully
- Can force refresh
```

#### Manual Tests
- [ ] Military aircraft show badges on first load
- [ ] Military badges appear after cache load
- [ ] Works offline with cached data
- [ ] New military aircraft detected after cache expiry
- [ ] Console shows appropriate loading messages

### Success Criteria
- ✅ All automated tests pass
- ✅ Military aircraft detection works as before
- ✅ Cache reduces network requests
- ✅ No database code in app.js

### Rollback Plan
- Git revert
- Isolated module, minimal risk

---

## Phase 5: Data Services

**Duration**: 5 days
**Risk**: Medium
**Lines Extracted**: ~800

### Overview
Extract data fetching logic into service modules. This is more complex due to tight coupling with rendering.

### Strategy
**Incremental extraction**: Don't extract everything at once. Move fetching logic but keep mesh updates in app.js initially.

### What Gets Extracted

#### `data-service-live.js` (~400 lines)
```javascript
/**
 * Live Data Service - Real-time aircraft data fetching
 */

export class LiveDataService {
  constructor(config) {
    this.config = config;
    this.updateInterval = null;
    this.callbacks = [];
    this.isRunning = false;
  }

  // Public API
  start() { /* Begin polling */ }
  stop() { /* Stop polling */ }
  onData(callback) { /* Register data handler */ }
  setUpdateInterval(ms) { /* Change poll rate */ }

  async fetchLatest() {
    const response = await fetch(this.config.API.AIRCRAFT_DATA);
    const data = await response.json();
    return this._processData(data);
  }

  _processData(raw) {
    // Data normalization, filtering
    return processedAircraft;
  }
}
```

#### `data-service-historical.js` (~400 lines)
```javascript
/**
 * Historical Data Service - Track loading and caching
 */

export class HistoricalDataService {
  constructor(config) {
    this.config = config;
    this.cache = new Map();
  }

  // Public API
  async loadTracks(startDate, endDate, filters) {
    /* Fetch tracks from API */
  }

  async loadTrackByIcao(icao, startDate, endDate) {
    /* Fetch single aircraft history */
  }

  async loadRecentTrails(minutes) {
    /* Fetch recent trails */
  }

  clearCache() { /* Clear cached tracks */ }
}
```

### Integration Points

#### In `app.js`
```javascript
import { LiveDataService } from './data-service-live.js';
import { HistoricalDataService } from './data-service-historical.js';

const liveData = new LiveDataService(CONFIG);
const historicalData = new HistoricalDataService(CONFIG);

// Start live updates
liveData.onData((aircraft) => {
  updateAircraftMeshes(aircraft); // Still in app.js
  updateTrails(aircraft);         // Still in app.js
  updateStats(aircraft);          // Still in app.js
});

liveData.start();
```

### Files Changed
- **New**: `public/data-service-live.js`
- **New**: `public/data-service-historical.js`
- **Modified**: `public/app.js` (refactor data fetching)

### Testing Strategy

#### Automated Tests
```javascript
// tests/data-service-test.html
- LiveDataService starts and stops correctly
- Data is fetched at correct interval
- Callbacks are invoked with processed data
- Handles fetch errors gracefully
- Can change update interval
- HistoricalDataService loads tracks
- Caching works correctly
- Date range filtering works
```

#### Manual Tests
- [ ] Live aircraft appear and update
- [ ] Update rate can be changed in settings
- [ ] Pausing updates stops fetching
- [ ] Resuming updates restarts fetching
- [ ] Historical tracks load correctly
- [ ] Historical playback works
- [ ] Recent trails load
- [ ] No regression in any data display

### Success Criteria
- ✅ All automated tests pass
- ✅ Live mode works identically
- ✅ Historical mode works identically
- ✅ Data fetching logic is out of app.js
- ✅ No performance regression

### Risk Mitigation
- **Test extensively**: This touches core functionality
- **Keep callbacks simple**: Don't change update logic yet
- **Monitor performance**: Ensure no extra overhead

### Rollback Plan
- Git revert
- Higher risk due to core functionality
- Keep this phase in single atomic commit

---

## Phase 6: Historical Module

**Duration**: 5 days
**Risk**: Medium
**Lines Extracted**: ~1,900 (lines 2374-4271)

### Overview
Extract historical mode features: track display, heat maps, corridors, playback animation.

### What Gets Extracted

#### `historical-mode.js` (~1,900 lines)
```javascript
/**
 * Historical Mode - Track visualization and playback
 */

import { HistoricalDataService } from './data-service-historical.js';

export class HistoricalMode {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;
    this.state = {
      tracks: [],
      displayMode: 'show-all',
      heatMap: null,
      corridors: [],
      playback: {
        isPlaying: false,
        currentTime: null,
        speed: 1,
      }
    };
  }

  // Public API
  async loadTracks(startDate, endDate, filters) { }
  showAllTracks() { }
  generateHeatMap() { }
  generateCorridors() { }

  // Playback
  startPlayback() { }
  pausePlayback() { }
  seekTo(timestamp) { }
  setPlaybackSpeed(speed) { }

  // Cleanup
  clearAll() { }
  dispose() { }
}
```

### Files Changed
- **New**: `public/historical-mode.js`
- **Modified**: `public/app.js` (remove historical code, integrate module)

### Testing Strategy

#### Manual Tests (Primary for this phase)
- [ ] Load historical tracks for date range
- [ ] Display mode: Show All Tracks works
- [ ] Display mode: Playback Animation works
- [ ] Heat map generates correctly
- [ ] Flight corridors display correctly
- [ ] Playback controls: Play/Pause
- [ ] Playback controls: Seek
- [ ] Playback speed adjustment (1x, 2x, 5x, 10x)
- [ ] Switch between live and historical mode
- [ ] Memory cleanup when switching modes

#### Automated Tests
```javascript
// tests/historical-mode-test.html
- Module initializes without errors
- State management works correctly
- Playback timer functions properly
- Cleanup disposes resources
```

### Success Criteria
- ✅ All historical features work identically
- ✅ No memory leaks when switching modes
- ✅ Clean module boundaries
- ✅ app.js is significantly smaller

### Rollback Plan
- Git revert
- Complex feature, test thoroughly before committing

---

## Phase 7: Testing & Polish

**Duration**: 3 days
**Risk**: Low

### Goals
1. Comprehensive regression testing
2. Performance validation
3. Code cleanup
4. Documentation updates

### Tasks
- [ ] Run full manual test suite on all browsers
- [ ] Run performance benchmarks vs. baseline
- [ ] Test on mobile devices
- [ ] Check for console errors/warnings
- [ ] Update README with new architecture
- [ ] Document module APIs
- [ ] Clean up any TODO comments
- [ ] Remove any dead code
- [ ] Optimize imports

### Deliverables
- **Updated README**: Architecture section
- **API Documentation**: For each module
- **Performance Report**: Before/after metrics
- **Test Coverage Report**: What's tested, what's not

---

## Testing Strategy Overview

### 1. Smoke Tests (Automated)
**Location**: `tests/smoke-test.html`

Run after every phase to ensure basic functionality:
```javascript
✓ App loads without console errors
✓ Required global objects exist
✓ DOM elements are present
✓ 3D scene initializes
✓ Theme system loads
✓ Modules import correctly
```

### 2. Unit Tests (Automated where possible)
**Location**: `tests/{module}-test.html`

For each extracted module:
- Test public API methods
- Test error handling
- Test edge cases
- Test integration points

### 3. Manual Test Checklist
**Location**: `MANUAL_TESTS.md`

Comprehensive feature checklist covering:
- Live mode (aircraft, trails, selection, labels)
- Historical mode (tracks, heat map, corridors, playback)
- UI (sidebar, search, settings, theme)
- Mobile (touch, gestures, responsive)

### 4. Performance Tests
**Location**: `tests/performance-test.html`

Measure and compare:
- Page load time
- Time to first aircraft
- Frame rate (FPS) with 100/500/1000 aircraft
- Memory usage over time
- Trail rendering performance

### 5. Browser Compatibility
Test on:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Mobile Safari (iOS)
- Chrome Mobile (Android)

---

## Progress Tracking

### 1. Git Strategy

#### Branch Naming
- Feature branch: `claude/refactor-app-structure-01KEBDze3qHgPehGyTCP7Jcu` (current)

#### Commit Strategy
Each phase = 1-3 commits:
1. **Extract module**: "Extract {module-name} into separate file"
2. **Update app.js**: "Integrate {module-name} module"
3. **Add tests**: "Add tests for {module-name}"

Atomic commits for easy rollback.

### 2. Refactoring Log
**Location**: `REFACTORING_LOG.md`

Track each change:
```markdown
## 2025-11-20 - Phase 1: Config & Constants

### Changes Made
- Created `config.js` with all configuration constants
- Updated `app.js` to import config
- Replaced 47 magic numbers with named constants

### Tests Run
- ✅ Smoke test passed
- ✅ Manual test: Live mode works
- ✅ Manual test: Theme switching works

### Performance
- Load time: 1.2s (baseline: 1.2s) ✅
- FPS: 60 (baseline: 60) ✅

### Issues Found
- None

### Next Steps
- Proceed to Phase 2: Theme Manager
```

### 3. Checklist Tracking
**Location**: This document (update checkboxes as you go)

Mark tasks complete with commit hash:
- [x] Phase 0: Setup Complete (commit: abc123)
- [ ] Phase 1: Config Complete
- [ ] Phase 2: Theme Manager Complete
- ...

---

## Risk Management

### Low Risk Phases (1, 2, 3, 4)
- Self-contained modules
- Minimal integration changes
- Easy to rollback
- **Strategy**: Extract boldly, test thoroughly

### Medium Risk Phases (5, 6)
- Touch core functionality
- More integration points
- **Strategy**: Extract incrementally, test extensively, keep commits atomic

### Rollback Procedure
For any phase:
1. `git log` to find last good commit
2. `git revert <commit>` or `git reset --hard <commit>`
3. Test baseline functionality
4. Analyze what went wrong
5. Fix and retry

---

## Success Metrics

### Code Quality
- ✅ app.js reduced from 12,428 to ~7,800 lines
- ✅ 6 new focused modules created
- ✅ No code duplication
- ✅ Clear module boundaries

### Functionality
- ✅ All features work identically
- ✅ No new bugs introduced
- ✅ No console errors

### Performance
- ✅ Load time: within 10% of baseline
- ✅ FPS: within 5% of baseline
- ✅ Memory: within 10% of baseline

### Maintainability
- ✅ Each module can be tested independently
- ✅ Clear public APIs documented
- ✅ Easy to locate features (no more scrolling 12k lines)
- ✅ Future features easier to add

---

## Module Dependency Graph (Final State)

```
index.html
│
├── config.js (no dependencies)
│
├── theme-manager.js
│   └── imports: config.js
│
├── url-state-manager.js
│   └── imports: config.js
│
├── aircraft-database.js
│   └── imports: config.js
│
├── aircraft-svg-system.js (already separate)
│
├── data-service-live.js
│   └── imports: config.js
│
├── data-service-historical.js
│   └── imports: config.js
│
├── historical-mode.js
│   └── imports: config.js, data-service-historical.js
│
└── app.js (main orchestrator, ~7,800 lines)
    └── imports: ALL of the above
```

**Clear hierarchy, minimal coupling, easy to understand.**

---

## Next Steps

1. **Review this plan** with the team
2. **Get approval** to proceed
3. **Start Phase 0**: Set up testing infrastructure
4. **Execute phases sequentially**: Don't skip ahead
5. **Track progress**: Update logs and checklists
6. **Celebrate wins**: Each phase is a victory!

---

## Questions to Answer Before Starting

- [ ] Do we have a staging environment for testing?
- [ ] Who will do the manual testing?
- [ ] What's our rollback tolerance (how quickly can we revert)?
- [ ] Are there any upcoming features that conflict with this timeline?
- [ ] Should we bundle modules or keep separate? (build process)

---

**Ready to start Phase 0?**
