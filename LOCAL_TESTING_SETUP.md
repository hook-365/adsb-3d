# Local Testing Setup - ADS-B 3D Refactor

**Date Created:** 2025-11-20
**Testing Environment:** apollo (192.168.1.200)
**Role:** Production testing arm for refactor development

## Our Mission

We are the **testing and validation arm** for the ADS-B 3D refactoring project:
- **Claude Code Web** is doing the refactoring work on the branch
- **We (Claude Code CLI on apollo)** are testing the changes in production-like environment
- **Goal:** Validate that refactored code works identically to production

## Two-Branch Strategy

### Production Branch (master)
- **Location:** `/storage/docker/rf-services/adsb-3d/`
- **URL:** http://192.168.1.200:8086
- **Container:** `adsb-3d`
- **Status:** Live production, serving real users at https://adsb3d.hook.technology
- **DO NOT TOUCH:** Keep this stable and running

### Refactor Branch (test)
- **Branch:** `origin/claude/refactor-app-structure-01KEBDze3qHgPehGyTCP7Jcu`
- **Location:** `/storage/docker/rf-services/adsb-3d-refactor/`
- **URL:** http://192.168.1.200:8090
- **Container:** `adsb-3d-refactor`
- **Status:** Testing Phase 1 refactor
- **Purpose:** Side-by-side comparison with production

## Git Worktree Setup

We're using **git worktree** for efficient side-by-side testing:

```bash
# Created worktree from main repo
cd /storage/docker/rf-services/adsb-3d
git worktree add ../adsb-3d-refactor origin/claude/refactor-app-structure-01KEBDze3qHgPehGyTCP7Jcu

# Custom docker-compose.yml created for testing
# - Changed port to 8090
# - Changed container name to adsb-3d-refactor
# - Connected to same seg_monitoring network
```

**Benefits:**
- Same repo, shared .git directory (~50MB overhead only)
- Easy to pull updates from Claude Code web
- Clean separation of environments
- Simple cleanup when testing is complete

## Current Refactor Status

**Phase 1: Extract Constants (COMPLETE)**
- ✅ Created `public/constants.js` with all configuration
- ✅ Modified `public/app.js` to import from constants
- ✅ Updated `public/index.html` with script tag
- ✅ Added comprehensive testing infrastructure

**What We're Testing:**
- Functional equivalence to production
- No JavaScript errors or regressions
- Performance (FPS, memory, load times)
- All features work identically (themes, radar, camera controls, etc.)

## Testing Workflow

1. **Pull Latest Changes:**
   ```bash
   cd /storage/docker/rf-services/adsb-3d-refactor
   git pull origin claude/refactor-app-structure-01KEBDze3qHgPehGyTCP7Jcu
   ```

2. **Rebuild and Deploy:**
   ```bash
   docker compose build adsb-3d-refactor && docker compose up -d adsb-3d-refactor
   ```

3. **Test Side-by-Side:**
   - Production: http://192.168.1.200:8086
   - Refactor: http://192.168.1.200:8090

4. **Report Findings:**
   - Document any differences
   - Check browser console for errors
   - Validate performance metrics
   - Test all features from `4-MANUAL_TESTS.md`

## Key Responsibilities

### ✅ We Do:
- Test refactored code in production-like environment
- Validate functional equivalence
- Monitor performance and stability
- Provide feedback on real-world behavior
- Keep production stable and untouched

### ❌ We Don't Do:
- Refactor the code (that's Claude Code web's job)
- Make changes to the refactor branch
- Merge or commit to the branch
- Touch production unless there's an emergency

## Cleanup (When Testing Complete)

```bash
# Stop test container
cd /storage/docker/rf-services/adsb-3d-refactor
docker compose down

# Remove worktree
cd /storage/docker/rf-services/adsb-3d
git worktree remove ../adsb-3d-refactor
```

## Communication with Claude Code Web

- They push commits to `claude/refactor-app-structure-01KEBDze3qHgPehGyTCP7Jcu`
- We pull and test those commits
- We report findings (differences, bugs, performance issues)
- They iterate based on our feedback

## Important Files to Monitor

In the refactor branch:
- `2-REFACTORING_PLAN.md` - Full roadmap (11 phases)
- `4-MANUAL_TESTS.md` - Testing procedures
- `5-REFACTORING_LOG.md` - Progress tracking
- `public/constants.js` - New constants module (Phase 1)
- `tests/smoke-test.html` - Automated smoke tests

## Production Safety

**Critical:** Never deploy refactor code to production `:8086` until:
1. All testing phases complete
2. Side-by-side comparison shows identical behavior
3. Performance metrics are equal or better
4. All manual tests pass
5. Explicit approval to merge

## Testing Log

### 2025-11-20 10:20 - Fix Branch Applied
**Branch:** `claude/fix-getaltitude-syntax-01RYFB1KMAreMu7say2zH7Kw`
**Fix:** Removed duplicate `getAltitudeColor` function declaration

**Testing Results:**
- ✅ Page loads successfully (HTTP 200, ~0.4ms response)
- ✅ No syntax errors in browser console
- ✅ Single `getAltitudeColor` function definition at app.js:9065
- ✅ Function called correctly throughout codebase (18+ references)
- ✅ Container running stable on port 8090

**Status:** Fix verified and working. Ready for side-by-side testing with production.

### 2025-11-20 10:23 - Real Location Data Applied
**Change:** Updated docker-compose.yml to use real location secrets from parent .env file

**Configuration:**
- Now using `env_file: ../.env` to inherit real location data
- Location: Weston, WI (44.9104°N, 89.5551°W, 1234ft)
- Timezone: America/Chicago (correct -0600 offset in logs)
- Location Name: weston-wi (from MLAT_USER)

**Testing Results:**
- ✅ Environment variables verified in container
- ✅ Timezone correct (log timestamps show -0600)
- ✅ Aircraft data fetching successfully
- ✅ Already in use by browser (192.168.1.161)

**Status:** Test environment now matches production configuration.

### 2025-11-20 10:25 - Phase 1 Browser Validation Complete ✅
**Tester:** User (browser testing)
**Test URL:** http://192.168.1.200:8090

**Browser Validation Results:**
- ✅ No JavaScript errors in console
- ✅ 3D scene renders correctly
- ✅ Aircraft appear and render properly
- ✅ Mini radar functioning (bottom-right)
- ✅ Theme switching works
- ✅ All features operational
- ✅ Visual comparison with production: identical behavior

**Phase 1 Status:** COMPLETE AND VALIDATED ✅

**What Was Refactored:**
- Extracted 418 lines of constants into `public/constants.js`
- Modified `app.js` to import from constants module
- Updated `index.html` with script tag
- Fixed duplicate function declaration bug
- Added comprehensive testing infrastructure

**Outcome:** Zero regressions detected. Refactored code performs identically to production.

**Next Steps:** Ready for Phase 2 when Claude Code web continues refactoring.

---

## Notes for Future Sessions

Remember:
- Port 8090 is our test port
- Port 8086 is sacred production
- We're validators, not refactors
- Claude Code web trusts us to catch regressions
- This is real production hardware with real users
