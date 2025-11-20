# Manual Test Checklist - ADSB 3D Visualization

**Purpose**: Comprehensive manual testing checklist to validate functionality before and after refactoring.

**Instructions**:
- Run this full checklist before starting refactoring (baseline)
- Run after each refactoring phase
- Mark each item ✅ when tested and working
- Mark ❌ if broken, with notes
- Note any warnings or issues even if feature works

**Test Environment**:
- Date: _______________
- Browser: _______________
- Phase: _______________ (Baseline / Phase 1 / Phase 2 / etc.)

---

## 1. Initial Load & Setup

### Page Load
- [ ] Page loads without errors (check console)
- [ ] 3D scene renders (black canvas with map tiles)
- [ ] Sidebar appears on left
- [ ] Theme is applied correctly
- [ ] No JavaScript errors in console
- [ ] No failed network requests (except expected live data)

**Notes**: _______________

### Performance
- [ ] Page loads in < 3 seconds
- [ ] 3D scene initializes in < 2 seconds
- [ ] FPS counter shows (if enabled in settings)

**Notes**: _______________

---

## 2. Live Mode - Basic Aircraft Display

### Aircraft Appearance
- [ ] Aircraft appear on the map within 5 seconds
- [ ] Aircraft icons are visible (sprites or shapes)
- [ ] Aircraft are positioned at correct altitude (visual check)
- [ ] Multiple aircraft visible (check count in stats)
- [ ] Aircraft move/update in real-time

**Aircraft Count**: _______________
**Notes**: _______________

### Aircraft Labels
- [ ] Labels appear above selected aircraft
- [ ] Labels show ICAO, callsign, altitude, speed
- [ ] Labels are readable (not overlapping excessively)
- [ ] Labels update in real-time

**Notes**: _______________

### Aircraft Selection
- [ ] Click on aircraft to select
- [ ] Selected aircraft is highlighted (different color/outline)
- [ ] Detail panel opens in sidebar
- [ ] Detail panel shows:
  - [ ] ICAO code
  - [ ] Callsign
  - [ ] Aircraft type (if available)
  - [ ] Altitude (feet)
  - [ ] Speed (knots)
  - [ ] Heading (degrees)
  - [ ] Vertical rate (if available)
  - [ ] Route (origin → destination, if available)
  - [ ] Registration (if available)
  - [ ] Military badge (if military aircraft)
- [ ] Can deselect by clicking elsewhere

**Notes**: _______________

### URL State
- [ ] Selecting aircraft adds `?aircraft=ICAO` to URL
- [ ] Copying URL and opening in new tab selects same aircraft
- [ ] Browser back button deselects aircraft
- [ ] Browser forward button re-selects aircraft

**Notes**: _______________

---

## 3. Live Mode - Trails

### Trail Display
- [ ] Enable trails in settings
- [ ] Trails appear behind aircraft
- [ ] Trails show path history
- [ ] Trails are colored (check which color mode):
  - [ ] Altitude-based gradient
  - [ ] Speed-based colors
  - [ ] Single color
  - [ ] Rainbow mode (if enabled)
- [ ] Trails update smoothly (no jerky lines)

**Trail Color Mode**: _______________
**Notes**: _______________

### Trail Fading
- [ ] Enable auto-fade trails in settings
- [ ] Old trail points fade/disappear after configured time
- [ ] Set trail fade time to 1 minute
- [ ] Verify old trails disappear after 1 minute
- [ ] Disable auto-fade
- [ ] Verify trails persist indefinitely

**Notes**: _______________

### Trail Modes
- [ ] Normal trails (lines)
- [ ] Tron mode (vertical curtains):
  - [ ] Enable Tron mode
  - [ ] Trails have vertical walls extending to ground
  - [ ] Walls are semi-transparent
- [ ] Altitude lines:
  - [ ] Enable altitude lines
  - [ ] Vertical lines connect aircraft to ground
  - [ ] Lines are visible and colored

**Notes**: _______________

### Trail Controls
- [ ] "Clear All Trails" button clears all trails
- [ ] Trails regenerate for active aircraft
- [ ] Full trail loading: select aircraft → "Show Full Trail"
- [ ] Full trail loads from recent history
- [ ] Full trail displays correctly

**Notes**: _______________

---

## 4. Live Mode - Camera & Controls

### Mouse Controls
- [ ] Left-click drag rotates camera around scene
- [ ] Right-click drag pans camera
- [ ] Mouse wheel zooms in/out
- [ ] Camera controls are smooth (no lag)
- [ ] Camera doesn't go underground (unless intended)

**Notes**: _______________

### Keyboard Controls
- [ ] Arrow keys move camera (if enabled)
- [ ] +/- keys zoom in/out (if enabled)
- [ ] Keyboard shortcuts work as expected

**Notes**: _______________

### Follow Mode
- [ ] Select an aircraft
- [ ] Enable "Follow" mode
- [ ] Camera follows aircraft smoothly
- [ ] Camera maintains relative position
- [ ] Disable follow mode
- [ ] Camera becomes free again

**Notes**: _______________

### View Presets
- [ ] "Reset Camera" button returns to initial view
- [ ] Camera reset works correctly (centered, default altitude)

**Notes**: _______________

---

## 5. Live Mode - UI & Search

### Sidebar
- [ ] Sidebar is visible on left
- [ ] Sidebar can be pinned/unpinned
- [ ] Sidebar can be collapsed/expanded
- [ ] Sidebar shows "Live" tab active
- [ ] Aircraft list populates with live aircraft

**Notes**: _______________

### Aircraft List
- [ ] List shows all visible aircraft
- [ ] List updates in real-time (new aircraft appear)
- [ ] List removes stale aircraft (not seen recently)
- [ ] List shows:
  - [ ] ICAO
  - [ ] Callsign (if available)
  - [ ] Altitude
  - [ ] Distance (if receiver location known)
- [ ] List can be sorted (by altitude, distance, callsign)
- [ ] Clicking list item selects aircraft in 3D view

**Notes**: _______________

### Search
- [ ] Search box is visible
- [ ] Type ICAO code → filters list
- [ ] Type callsign → filters list
- [ ] Search is case-insensitive
- [ ] Clear search → shows all aircraft again
- [ ] Search works with partial matches

**Search Tests**:
- Search "AA" → shows American Airlines flights: _______________
- Search known ICAO → finds aircraft: _______________

**Notes**: _______________

---

## 6. Live Mode - Settings

### Settings Modal
- [ ] Click settings icon/button
- [ ] Settings modal opens
- [ ] Modal shows all settings sections:
  - [ ] Display settings
  - [ ] Trail settings
  - [ ] Performance settings
  - [ ] Map settings

**Notes**: _______________

### Display Settings
- [ ] Toggle "Show Labels" on/off → labels appear/disappear
- [ ] Toggle "Show Trails" on/off → trails appear/disappear
- [ ] Toggle "Show Altitude Lines" on/off → lines appear/disappear
- [ ] Toggle "Show Distance Rings" on/off → rings appear/disappear
- [ ] Toggle "Show Airports" on/off → airports appear/disappear (if available)

**Notes**: _______________

### Trail Settings
- [ ] Trail color mode dropdown works:
  - [ ] Altitude gradient
  - [ ] Speed colors
  - [ ] Single color
  - [ ] Rainbow
- [ ] Trail fade time slider works (1 min - 30 min)
- [ ] Auto-fade toggle works
- [ ] Tron mode toggle works

**Notes**: _______________

### Performance Settings
- [ ] FPS limiter works (30, 60, unlimited)
- [ ] Update interval works (1s, 2s, 5s)
- [ ] Show FPS counter toggle works

**Notes**: _______________

### Map Settings
- [ ] Map provider dropdown works:
  - [ ] CartoDB Dark
  - [ ] CartoDB Light
  - [ ] OpenStreetMap
  - [ ] Esri Satellite
- [ ] Map tiles update when changed
- [ ] Map opacity slider works

**Notes**: _______________

### Settings Persistence
- [ ] Change several settings
- [ ] Refresh page
- [ ] Verify settings are preserved

**Notes**: _______________

---

## 7. Live Mode - Theme System

### Theme Modal
- [ ] Click theme icon/button
- [ ] Theme modal opens
- [ ] All themes are listed:
  - [ ] Dark
  - [ ] Light
  - [ ] Neon
  - [ ] Ocean
  - [ ] Sunset
  - [ ] Forest
  - [ ] (others if available)

**Notes**: _______________

### Theme Switching
For each theme:
- [ ] Select theme
- [ ] UI colors update immediately
- [ ] 3D scene colors update (sky, ground, trails)
- [ ] Theme looks good (no contrast issues)
- [ ] No visual glitches

**Test Each Theme**:
- [ ] Dark theme
- [ ] Light theme
- [ ] Neon theme
- [ ] Ocean theme
- [ ] Sunset theme
- [ ] Forest theme

**Notes**: _______________

### Theme Persistence
- [ ] Select a theme
- [ ] Refresh page
- [ ] Verify theme is still applied

**Notes**: _______________

---

## 8. Live Mode - Statistics

### Stats Display
- [ ] Stats panel shows (if available):
  - [ ] Total aircraft count
  - [ ] Military aircraft count
  - [ ] Highest altitude
  - [ ] Lowest altitude
  - [ ] Average altitude
- [ ] Stats update in real-time

**Notes**: _______________

---

## 9. Historical Mode - Setup

### Mode Switching
- [ ] Click "Historical" tab in sidebar
- [ ] Sidebar switches to historical mode
- [ ] Live aircraft disappear (or fade out)
- [ ] Historical controls appear:
  - [ ] Date range picker
  - [ ] Load Tracks button
  - [ ] Display mode selector
  - [ ] Playback controls

**Notes**: _______________

### Date Range Selection
- [ ] Start date picker works
- [ ] End date picker works
- [ ] Can select date range (e.g., last 24 hours)
- [ ] Cannot select future dates
- [ ] Validation works (end must be after start)

**Notes**: _______________

---

## 10. Historical Mode - Track Loading

### Load Tracks
- [ ] Select date range (e.g., today 00:00 to now)
- [ ] Click "Load Tracks"
- [ ] Loading indicator appears
- [ ] Tracks load from backend
- [ ] Tracks appear on map
- [ ] Loading indicator disappears when done

**Track Count Loaded**: _______________
**Notes**: _______________

### Track Display
- [ ] Tracks are visible as colored lines
- [ ] Each track represents one flight path
- [ ] Tracks have different colors (or same color family)
- [ ] Tracks are smooth (not jagged)
- [ ] Can zoom in to see detail
- [ ] Can see airport connections

**Notes**: _______________

---

## 11. Historical Mode - Display Modes

### Show All Tracks (Static)
- [ ] Select "Show All Tracks" display mode
- [ ] All loaded tracks display simultaneously
- [ ] Tracks are static (not animating)
- [ ] Can rotate/zoom around scene
- [ ] Performance is acceptable (FPS > 20)

**FPS with All Tracks**: _______________
**Notes**: _______________

### Playback Animation
- [ ] Select "Playback Animation" display mode
- [ ] Timeline scrubber appears
- [ ] All tracks disappear (waiting for playback)
- [ ] Click play button
- [ ] Aircraft appear and move along their paths
- [ ] Timeline advances
- [ ] Can see multiple aircraft moving at once

**Notes**: _______________

### Playback Controls
- [ ] Play button starts animation
- [ ] Pause button pauses animation
- [ ] Resume works after pause
- [ ] Stop button resets to beginning
- [ ] Timeline scrubber can be dragged to seek
- [ ] Clicking timeline jumps to that time
- [ ] Current time display updates (HH:MM:SS)

**Notes**: _______________

### Playback Speed
- [ ] Speed selector shows: 1x, 2x, 5x, 10x, 50x
- [ ] Select 2x → animation speeds up
- [ ] Select 10x → animation is much faster
- [ ] Select 1x → returns to normal speed

**Notes**: _______________

---

## 12. Historical Mode - Heat Map

### Heat Map Generation
- [ ] Load tracks for busy time period
- [ ] Select "Heat Map" visualization mode
- [ ] Click "Generate Heat Map"
- [ ] Heat map generates (may take time)
- [ ] Heat map appears as colored grid on map
- [ ] Hot spots (high traffic) are red/orange
- [ ] Cool spots (low traffic) are blue/green

**Notes**: _______________

### Heat Map Display
- [ ] Heat map is semi-transparent (can see map below)
- [ ] Heat map updates when zooming (if dynamic)
- [ ] Heat map colors are clear
- [ ] Can toggle heat map on/off

**Notes**: _______________

---

## 13. Historical Mode - Flight Corridors

### Corridor Generation
- [ ] Load tracks
- [ ] Select "Flight Corridors" visualization
- [ ] Corridors appear as colored "tubes" in sky
- [ ] Corridors show common flight paths
- [ ] Corridors have volume (3D tubes)
- [ ] Corridor color indicates traffic density

**Notes**: _______________

### Corridor Display
- [ ] Corridors are semi-transparent
- [ ] Can see multiple layers of corridors (different altitudes)
- [ ] Corridors look good from different angles
- [ ] Performance is acceptable

**Notes**: _______________

---

## 14. Mobile & Touch - Responsive Design

### Mobile Layout (Test on phone or resize browser to ~375px width)
- [ ] Sidebar adapts to mobile width
- [ ] Sidebar can be collapsed to give more screen space
- [ ] 3D canvas fills available space
- [ ] Controls are large enough to tap (min 44x44px)
- [ ] Text is readable (not too small)
- [ ] No horizontal scrolling

**Notes**: _______________

---

## 15. Mobile & Touch - Gestures

### Touch Controls (Test on touchscreen device)
- [ ] Single finger drag rotates camera
- [ ] Two finger pinch zooms in/out
- [ ] Two finger drag pans camera
- [ ] Touch controls are smooth (no lag)

**Notes**: _______________

### Aircraft Selection
- [ ] Tap aircraft to select
- [ ] Detail panel opens
- [ ] Can close detail panel
- [ ] Long-press aircraft opens context menu (if implemented)

**Notes**: _______________

### Sidebar Touch
- [ ] Sidebar can be swiped open/closed
- [ ] List items can be tapped
- [ ] Scrolling list works smoothly
- [ ] Search box works with on-screen keyboard

**Notes**: _______________

---

## 16. Advanced Features

### Airports (if implemented)
- [ ] Enable "Show Airports" in settings
- [ ] Airport markers appear on map
- [ ] Clicking airport shows information
- [ ] Runways are visible (if zoomed in)
- [ ] Runway orientations are correct

**Notes**: _______________

### Distance Rings
- [ ] Enable "Show Distance Rings"
- [ ] Rings appear centered on receiver location
- [ ] Rings show distance labels (km or miles)
- [ ] Rings scale correctly when zooming

**Notes**: _______________

### Military Aircraft
- [ ] Military aircraft show badge/indicator
- [ ] Military aircraft have different color (if configured)
- [ ] Military database loads correctly
- [ ] Can filter for military only (if feature exists)

**Notes**: _______________

---

## 17. Error Handling & Edge Cases

### Network Errors
- [ ] Disconnect network while in live mode
- [ ] App shows error message or offline indicator
- [ ] Reconnect network
- [ ] App resumes fetching data
- [ ] No crash or broken state

**Notes**: _______________

### No Data
- [ ] Test when no aircraft are in range
- [ ] App handles gracefully (no errors)
- [ ] Message indicates "No aircraft" or "Waiting for data"

**Notes**: _______________

### Invalid URL Parameters
- [ ] Load URL with invalid aircraft ICAO: `?aircraft=INVALID`
- [ ] App handles gracefully (no crash)
- [ ] May show "Aircraft not found" message

**Notes**: _______________

### Browser Back/Forward Spam
- [ ] Rapidly click browser back and forward buttons
- [ ] App handles gracefully (no crashes)
- [ ] State updates correctly

**Notes**: _______________

---

## 18. Performance Testing

### Load Performance
**Measure with browser DevTools Performance tab**

- [ ] Page load time: _______________ seconds (target: < 3s)
- [ ] Time to first aircraft: _______________ seconds (target: < 5s)
- [ ] Time to first interaction: _______________ seconds (target: < 2s)

**Notes**: _______________

### Runtime Performance
- [ ] FPS with 100 aircraft: _______________ (target: > 30)
- [ ] FPS with 500 aircraft: _______________ (target: > 20)
- [ ] FPS with 1000 aircraft: _______________ (target: > 15)
- [ ] FPS with trails enabled: _______________ (target: > 20)
- [ ] FPS with Tron mode: _______________ (target: > 15)

**Notes**: _______________

### Memory Usage
**Check browser Task Manager (Chrome: Shift+Esc)**

- [ ] Initial memory: _______________ MB
- [ ] After 5 min: _______________ MB
- [ ] After 15 min: _______________ MB
- [ ] Memory leak? (constant growth) Yes / No

**Notes**: _______________

---

## 19. Browser Compatibility

**Test on each browser:**

### Chrome (Latest)
- [ ] All features work
- [ ] Performance is good
- [ ] No console errors

**Version**: _______________
**Notes**: _______________

### Firefox (Latest)
- [ ] All features work
- [ ] Performance is good
- [ ] No console errors

**Version**: _______________
**Notes**: _______________

### Safari (Latest)
- [ ] All features work
- [ ] Performance is good
- [ ] No console errors

**Version**: _______________
**Notes**: _______________

### Mobile Safari (iOS)
- [ ] All features work
- [ ] Touch controls work
- [ ] Performance is acceptable

**iOS Version**: _______________
**Notes**: _______________

### Chrome Mobile (Android)
- [ ] All features work
- [ ] Touch controls work
- [ ] Performance is acceptable

**Android Version**: _______________
**Notes**: _______________

---

## 20. Regression Checks (After Refactoring)

**Run this section after each refactoring phase:**

### What Changed This Phase?
**Phase**: _______________
**Modules Changed**: _______________

### Specific Tests for This Phase
- [ ] Feature X still works
- [ ] Feature Y still works
- [ ] Integration point Z works

**Notes**: _______________

### No New Console Errors
- [ ] Check console: no new errors
- [ ] Check console: no new warnings (or acceptable warnings noted)

**Console Output**: _______________

### Performance Comparison
- [ ] Load time: _______________ (vs baseline: _______________)
- [ ] FPS: _______________ (vs baseline: _______________)
- [ ] Memory: _______________ (vs baseline: _______________)

**Regression?** Yes / No
**Notes**: _______________

---

## Final Sign-Off

**Tester**: _______________
**Date**: _______________
**Phase**: _______________

**Overall Status**: ✅ PASS / ❌ FAIL

**Critical Issues Found**: _______________

**Minor Issues Found**: _______________

**Approved to Proceed**: YES / NO

**Notes**: _______________

---

## Quick Smoke Test (Fast Version)

**Use this abbreviated checklist for quick validation between small changes:**

- [ ] Page loads without errors
- [ ] Aircraft appear and update
- [ ] Can select aircraft
- [ ] Trails work
- [ ] Theme switching works
- [ ] Settings persist
- [ ] Historical mode loads tracks
- [ ] No console errors
- [ ] Performance OK (FPS > 30)

**Time to Complete**: ~5 minutes
