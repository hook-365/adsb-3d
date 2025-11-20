# ADSB 3D Visualization - Test Suite

This directory contains automated and manual tests for validating the refactoring process.

## Quick Start

### Running Smoke Tests
1. Ensure the app is running (via docker-compose or local server)
2. Open `smoke-test.html` in your browser
3. Click "Run All Tests"
4. Review results

**Example**: `http://localhost:8080/tests/smoke-test.html`

### Running Manual Tests
1. Open `../MANUAL_TESTS.md`
2. Follow the comprehensive checklist
3. Test each feature manually
4. Document results

## Test Files

### `smoke-test.html`
- **Purpose**: Automated browser-based validation
- **When to run**: After every phase, before committing
- **What it tests**:
  - Page loads without errors
  - Required DOM elements exist
  - Global objects are defined
  - 3D scene initializes
  - Modules load correctly (if added)
  - Basic performance check

### `../MANUAL_TESTS.md`
- **Purpose**: Comprehensive feature validation
- **When to run**:
  - Before refactoring (baseline)
  - After each phase
  - Before merging to main
- **What it tests**:
  - All live mode features
  - All historical mode features
  - UI interactions
  - Theme system
  - Mobile/touch support
  - Performance metrics
  - Browser compatibility

## Adding Phase-Specific Tests

As you complete each phase, add dedicated test files:

### Phase 1: Config Tests
**File**: `config-test.html`

```html
<!-- Example structure -->
- CONFIG object exists
- All keys are defined
- No undefined values
- Numeric values in valid ranges
```

### Phase 2: Theme Manager Tests
**File**: `theme-manager-test.html`

```html
- ThemeManager loads
- Can switch themes
- CSS variables update
- localStorage persistence
- Callbacks fire
```

### Phase 3: URL State Tests
**File**: `url-state-test.html`

```html
- URL parsing works
- State updates URL
- Back/forward buttons work
- Invalid params handled
```

### Phase 4: Aircraft Database Tests
**File**: `aircraft-database-test.html`

```html
- Database loads
- Cache works
- Military detection works
- Network errors handled
```

### Phase 5: Data Service Tests
**File**: `data-service-test.html`

```html
- Live data fetching works
- Historical data loading works
- Polling interval correct
- Error handling works
```

### Phase 6: Historical Mode Tests
**File**: `historical-mode-test.html`

```html
- Module initializes
- Playback works
- Heat map generates
- Corridors display
- Memory cleanup works
```

## Test Strategy

### 1. Smoke Tests (Automated)
- **Frequency**: After every change
- **Duration**: ~30 seconds
- **Purpose**: Catch obvious breaks

### 2. Manual Tests (Comprehensive)
- **Frequency**: After each phase
- **Duration**: ~30-45 minutes
- **Purpose**: Validate all functionality

### 3. Performance Tests
- **Frequency**: After phases that touch core rendering/data
- **Duration**: ~10 minutes
- **Purpose**: Prevent performance regressions

## Performance Baselines

Track these metrics before and after refactoring:

### Page Load
- Target: < 3 seconds
- Measure: `performance.timing.loadEventEnd - performance.timing.navigationStart`

### Time to First Aircraft
- Target: < 5 seconds
- Measure: Time from page load to first aircraft appearing

### Frame Rate
- Target: > 30 FPS with 100 aircraft
- Measure: Browser DevTools Performance tab

### Memory Usage
- Target: < 500 MB after 15 minutes
- Measure: Browser Task Manager (Chrome: Shift+Esc)

## Browser Testing Matrix

Test on these browsers before marking a phase complete:

| Browser | Version | Priority | Notes |
|---------|---------|----------|-------|
| Chrome | Latest | High | Primary dev browser |
| Firefox | Latest | High | WebGL compatibility |
| Safari | Latest | Medium | macOS/iOS users |
| Mobile Safari | Latest iOS | Medium | Touch controls |
| Chrome Mobile | Latest Android | Medium | Touch controls |

## Continuous Integration (Future)

When setting up CI/CD, consider:
- Automated smoke tests on every commit
- Full test suite on PR
- Performance regression detection
- Browser compatibility matrix

## Tips for Effective Testing

1. **Test Incrementally**: Don't wait until the end of a phase
2. **Document Failures**: Note what broke and how you fixed it
3. **Compare to Baseline**: Always have a reference point
4. **Test Edge Cases**: Empty data, network errors, mobile
5. **Check Console**: Errors and warnings matter

## Reporting Issues

If you find a bug during testing:

1. Note which phase you're in
2. Document steps to reproduce
3. Check console for errors
4. Note browser/version
5. Add to `REFACTORING_LOG.md` under "Issues Found"
6. Fix before proceeding to next phase

## Rollback Testing

If you need to rollback:

1. Run smoke test on rolled-back commit
2. Verify all tests pass
3. Document what went wrong
4. Fix issue
5. Re-test before proceeding

## Questions?

Refer to:
- `../REFACTORING_PLAN.md` - Overall strategy
- `../REFACTORING_LOG.md` - Progress tracking
- `../MANUAL_TESTS.md` - Comprehensive checklist
