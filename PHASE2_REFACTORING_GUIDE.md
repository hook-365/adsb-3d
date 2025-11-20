# Phase 2 Refactoring Quick Start Guide

## Current State
- **app.js**: 12,382 lines (monolithic)
- **Recent work**: Sidebar redesign, bug fixes
- **Previous attempt**: Phase 0/1 refactoring branch (not merged)
- **Status**: Ready for modularization

## What to Extract First (Easy Wins)

### 1. constants.js (~500 lines) ⭐⭐⭐ EASIEST
```javascript
// Extract:
const CONFIG = { ... }              // 35 lines
const THEMES = { modern, digital, dark, arctic, sunset, neon, vintage }  // 600 lines
const AIRCRAFT_TYPE_SPECS = { ... } // 100 lines
const ROUTE_CACHE_KEY = '...'
const ROUTE_CACHE_DURATION = ...
const API_RATE_LIMIT_MS = ...
// Other constants
```
**Why first?** No other code depends on these. Pure data.

### 2. theme-manager.js (~150 lines) ⭐⭐⭐
Extract functions:
- applyTheme()
- updateSceneColors()
- getCurrentTheme()
- initializeTheme()
- Plus: getCSSVar(), cssToThreeColor(), getThemeColor()

**Why?** Self-contained theme logic. Will be cleaner once constants.js extracted.

### 3. url-state.js (~250 lines) ⭐⭐
Extract entire URLState object and all its methods:
- URLState.updateFromURL()
- URLState.updateFromCurrentState()
- URLState.buildURL()
- etc.

**Why?** Clear boundary, handles bookmarking feature.

## What Comes Next (Medium Complexity)

### 4. aircraft-database.js (~300 lines) ⭐⭐
- getAircraftSpecs()
- getAircraftCategory()
- isMilitaryAircraft()
- getMilitaryInfo()
- getSignalQuality()
- militaryDatabase and loading logic

### 5. ui-controls.js (~600 lines) ⭐⭐
- setupUIControls()
- setupKeyboardShortcuts()
- setupAircraftSearch()
- filterAircraftList()
- setupCollapseablePanels()

### 6. sidebar-ui.js (~700 lines) ⭐⭐
- updateSidebarLiveStats()
- updateSidebarTrackList()
- updateSidebarMiniRadar()
- updateSidebarHeading()
- filterSidebarTracks()

## What's Complex (Plan Carefully)

### 7. 3d-rendering.js (~1,200 lines) ⭐
- init()
- createSky()
- createGroundPlane()
- createAircraft()
- createAircraftModel()
- updateAircraft()

**Challenge**: Heavy Three.js coupling, global state (aircraftMeshes, trails, etc.)

### 8. historical-mode.js (~900 lines) ⭐
- renderHistoricalTracks()
- createHistoricalTrack()
- generateFlightCorridors()
- setPlaybackEnabled()
- setupHistoricalControls()
- All playback functions

**Challenge**: Parallel to live mode, 2 state managers (HistoricalState, PlaybackState)

### 9. trail-manager.js (~400 lines) ⭐
- updateTrail()
- rebuildTrailGeometry()
- clearAllTrails()
- cleanupOldTrailPositions()
- updateTronCurtain()

**Challenge**: Memory management (geometry disposal)

## Key Dependencies to Watch

```
theme-manager.js
    ↑
    └── constants.js

url-state.js
    ↑
    └── constants.js (for defaults)

aircraft-database.js
    ↑
    └── constants.js (for AIRCRAFT_TYPE_SPECS)

3d-rendering.js
    ↑
    ├── constants.js
    ├── theme-manager.js
    └── aircraft-database.js

ui-controls.js
    ↑
    ├── constants.js
    └── aircraft-database.js

sidebar-ui.js
    ↑
    ├── ui-controls.js
    └── 3d-rendering.js (for camera, scene state)
```

## Implementation Sequence

**Phase 2a** (Week 1):
1. Extract constants.js
2. Update imports in app.js
3. Test - all functionality should work

**Phase 2b** (Week 2):
4. Extract theme-manager.js
5. Extract url-state.js
6. Test - theme switching, URL bookmarking

**Phase 2c** (Week 3):
7. Extract aircraft-database.js
8. Extract ui-controls.js
9. Test - search, keyboard shortcuts

**Phase 2d** (Week 4):
10. Extract sidebar-ui.js
11. Test - sidebar updates, live stats

**Phase 2e** (Week 5+):
12. Extract 3d-rendering.js (or break into smaller pieces)
13. Extract historical-mode.js
14. Extract trail-manager.js

## Testing Strategy

Use existing tests/smoke-test.html and add:
1. Before each extraction: baseline snapshot
2. After each extraction: verify no functionality changed
3. Keep browser DevTools open for runtime errors
4. Test all modes: live, historical, playback, all 7 themes

## File Size Tracking

```
Before:
  app.js: 12,382 lines

After Phase 2a:
  app.js: ~11,900 lines
  constants.js: ~500 lines

After Phase 2b:
  app.js: ~11,600 lines
  theme-manager.js: ~150 lines
  url-state.js: ~250 lines

After Phase 2c-e:
  app.js: ~7,800-8,500 lines (target)
  [All extracted modules]: ~4,000 lines
```

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Breaking global state refs | Keep same variable names in modules, export from each |
| Circular dependencies | Build dependency graph first, plan imports |
| Missed interdependencies | Use search/grep to find all callers before moving |
| Browser compatibility | Test in Firefox/Safari after each module |
| Performance regression | Profile with DevTools before/after |

## Success Criteria

✅ All functionality works exactly as before
✅ No console errors or warnings (except expected ones)
✅ Module extraction reduces coupling
✅ Can run existing test suite without modification
✅ Code is more testable in isolation
