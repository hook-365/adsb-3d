# ADS-B 3D Viewer & Stats Dashboard - Documentation

This directory contains design documents and proposals for the ADS-B tracking system.

## Documents

### [STATS_DASHBOARD_IDEAS.md](./STATS_DASHBOARD_IDEAS.md)
Comprehensive brainstorming document covering:
- Current issues with sighting definitions
- UI/UX enhancement ideas (10 major features)
- Implementation priorities (4 phases)
- Technical considerations
- Mock-ups and examples

**Read this first** for the big picture and all the ideas we're considering.

### [SESSION_DETECTION_PROPOSAL.md](./SESSION_DETECTION_PROPOSAL.md)
Technical deep-dive into flight session detection:
- Algorithm design and SQL implementation
- Three implementation options (View, Table, Hybrid)
- Migration strategy and rollout plan
- Performance benchmarks
- Gap threshold tuning

**Read this second** for the technical implementation details.

## Quick Summary: The Core Problem

### Current Behavior ❌
Every 5-second position report counts as a "sighting":
- Aircraft flying overhead for 30 minutes = **360 "sightings"**
- Not meaningful for understanding how many times you've seen an aircraft

### Desired Behavior ✅
Count distinct flight sessions/passages:
- One continuous overhead pass = **1 sighting**
- If the plane returns tomorrow = **2nd sighting**

## Key Questions to Answer

Before implementing, we need to decide:

1. **Gap Threshold**: How long between positions before it's a "new sighting"?
   - 30 minutes? (Recommended for commercial)
   - 1 hour? (For GA aircraft doing multiple flights)
   - Variable by aircraft type?

2. **Implementation Approach**:
   - Real-time calculation (slow but always accurate)?
   - Pre-calculated table (fast but needs updates)?
   - Hybrid (best of both)?

3. **UI Changes**:
   - Replace "sightings" with "flights"?
   - Show both: "45 flights / 12,345 positions"?
   - User toggle between views?

4. **What about edge cases**?
   - Touch-and-goes (training aircraft)
   - Aircraft circling for hours
   - Aircraft parked overnight

## Implementation Priority

### Phase 1: Session Detection Backend ⭐ HIGH
- Create `aircraft_sessions` table
- Backfill historical data (one-time migration)
- Update collector to track sessions in real-time

### Phase 2: Enhanced API ⭐ HIGH
- Add session-based statistics endpoints
- Keep legacy endpoints for compatibility
- Add session detail endpoints

### Phase 3: UI Improvements ⭐ MEDIUM
- Make rarity cards clickable
- Show session timeline in aircraft details
- Add search/filter panel
- Session-based statistics display

### Phase 4: Advanced Features ⭐ LOW
- Frequency heatmap
- Aircraft comparison
- First-timers view
- Achievements/milestones

## Current Status

### ✅ Implemented
- Statistics dashboard with 7 tabs
- Aircraft detail modals with recent track data
- Clickable aircraft in rarity, military, and type lists
- Links to 3D viewer and ADS-B Exchange
- Custom SQL query interface

### 🔨 In Discussion
- Session detection algorithm
- Gap threshold values
- Display preferences

### 📋 Planned
- Session-based counting
- Enhanced interactivity (clickable stat cards)
- Timeline visualizations
- Search and filter capabilities

## Examples

### Session Detection Example

```
N12345 on November 4, 2025:

08:00 ━━━━━━━━━━━━━━ 08:25  Session 1 (25 min, 300 positions)
         [2 hour gap]
10:30 ━━━━━━━━ 10:45         Session 2 (15 min, 180 positions)
         [3 hour gap]
14:00 ━━━━━━━━━━━━━━━ 14:35  Session 3 (35 min, 420 positions)

Result:
- Old way: 900 "sightings" ❌
- New way: 3 flights ✅
```

### UI Enhancement Example

**Before**:
```
┌─────────────────────┐
│ Extremely Rare      │  (passive display)
│        2            │
│ ≤10 sightings      │
└─────────────────────┘
```

**After**:
```
┌─────────────────────┐
│ Extremely Rare  👁️  │  ← Click to see list
│        2            │
│ ≤10 flights seen   │
│ [View Aircraft] →   │
└─────────────────────┘
```

## Contributing

When adding new ideas or modifications:

1. Update the relevant document (IDEAS or PROPOSAL)
2. Add your thoughts to the "Questions to Discuss" section
3. Create examples/mock-ups if helpful
4. Consider technical implications and performance

## Related Files

- `/storage/docker/rf-services/adsb-stats/` - Statistics dashboard UI
- `/storage/docker/rf-services/adsb-3d/track-service/main.py` - Track API backend
- `/storage/docker/rf-services/timescaledb/init/` - Database schema

## Contact

For questions or discussions about these proposals, see the main repo README.
