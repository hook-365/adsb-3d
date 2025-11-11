# Statistics Dashboard Enhancement Ideas

## Current Issues

### 1. Sighting Definition Problem
**Current behavior**: Every 5-second position report counts as a "sighting"
- Aircraft flying overhead for 30 minutes = 360 "sightings"
- Not meaningful for understanding how many times you've actually seen an aircraft

**What we really want**: Count distinct flight sessions/passages
- One continuous overhead pass = 1 sighting
- If plane comes back tomorrow = 2nd sighting

### 2. Interactivity Gaps
- Clicking on "Extremely Rare (1 aircraft)" doesn't show that aircraft
- Clicking on "Very Rare (314 aircraft)" doesn't show the list
- Stats are displayed but not explorable

---

## Proposed Solutions

### Option A: Flight Session Detection (Recommended)

**Concept**: Group consecutive positions into "sessions" with time-based gap detection

**Logic**:
```
A "session" or "sighting" is a continuous series of position reports where:
- Gap between consecutive positions < 30 minutes (configurable)
- Once gap exceeds threshold, that's the end of the session
- Next position starts a new session
```

**Example**:
```
Aircraft N12345 on Nov 4, 2025:
08:00 - 08:25  → Session 1 (25 minutes, 300 positions)
[2 hour gap]
10:30 - 10:45  → Session 2 (15 minutes, 180 positions)
14:00 - 14:35  → Session 3 (35 minutes, 420 positions)

Result: 3 sightings on Nov 4
```

**Implementation Approaches**:

#### A1. SQL Window Function (Query-time calculation)
**Pros**: No schema changes, accurate in real-time
**Cons**: Slower for large datasets, complex query

```sql
WITH session_gaps AS (
    SELECT
        icao,
        time,
        LAG(time) OVER (PARTITION BY icao ORDER BY time) as prev_time,
        CASE
            WHEN time - LAG(time) OVER (PARTITION BY icao ORDER BY time) > INTERVAL '30 minutes'
            THEN 1
            ELSE 0
        END as new_session
    FROM aircraft_positions
),
session_ids AS (
    SELECT
        icao,
        time,
        SUM(new_session) OVER (PARTITION BY icao ORDER BY time) as session_id
    FROM session_gaps
)
SELECT
    icao,
    COUNT(DISTINCT session_id) as true_sightings
FROM session_ids
GROUP BY icao;
```

#### A2. Materialized Aggregation (Background job)
**Pros**: Fast queries, pre-calculated
**Cons**: Requires periodic updates, eventual consistency

Create new table:
```sql
CREATE TABLE aircraft_sessions (
    id SERIAL PRIMARY KEY,
    icao TEXT NOT NULL,
    session_start TIMESTAMPTZ NOT NULL,
    session_end TIMESTAMPTZ NOT NULL,
    position_count INTEGER,
    avg_altitude INTEGER,
    max_altitude INTEGER,
    flight_number TEXT
);
```

Background job runs hourly to detect and insert new sessions.

#### A3. Hybrid Approach (Recommended)
- Store last 7 days in `aircraft_sessions` table (fast queries)
- Older data calculated via SQL window function (acceptable performance for historical queries)
- Best of both worlds

---

### Option B: Simple Day-Based Counting

**Concept**: Count distinct days aircraft was seen
- Already partially implemented with `COUNT(DISTINCT DATE(time))`
- Simpler but less granular

**Example**:
```
Aircraft seen on:
- Nov 1: 3 flights → Counts as 1
- Nov 2: 1 flight → Counts as 1
- Nov 5: 2 flights → Counts as 1
Result: 3 sightings
```

**Pros**: Simple, already in codebase
**Cons**: Less precise - multiple flights per day count as one

---

## UI/UX Enhancement Ideas

### 1. Clickable Stat Cards

**Current**: Stat cards are passive displays
**Proposed**: Make them interactive filters/drilldowns

```
┌─────────────────────────────┐
│ Extremely Rare              │  ← Click to see list
│        2                    │
│ ≤10 sightings              │
└─────────────────────────────┘
```

Clicking opens:
- Filtered list of aircraft matching that criteria
- Or: Navigate to a dedicated page with that filter applied

### 2. Sighting Timeline Visualization

Show when aircraft was seen over time:

```
N12345 - Last 30 days:
Nov 1  ████░░░░░░  (Morning flight)
Nov 2  ░░░░░░████  (Evening flight)
Nov 3  -
Nov 4  ████░░████  (Two flights)
...
```

### 3. "First Timers" View

Special section for aircraft seen for the first time:
- Last 24 hours: 5 new aircraft
- Last 7 days: 23 new aircraft
- Clickable to see the list

### 4. Frequency Heatmap

Calendar-style view showing activity levels:
```
        Mon  Tue  Wed  Thu  Fri  Sat  Sun
Week 1   23   45   34   56   67   89   12
Week 2   34   23   45   67   54   90   15
...
```
Color intensity = number of unique aircraft seen

### 5. Search & Filter Panel

Add sidebar/top bar with:
- Search by registration, ICAO, or type
- Filter by: Military/Civilian, Sighting count range, Last seen date
- Sort options: Most seen, Rarest, Recently added, Alphabetical

### 6. Aircraft Comparison

Select multiple aircraft and compare:
```
┌──────────────┬──────────────┬──────────────┐
│   N12345     │   N67890     │   N11111     │
├──────────────┼──────────────┼──────────────┤
│ 45 sightings │ 12 sightings │ 3 sightings  │
│ B738         │ A320         │ C172         │
│ 32,450 ft    │ 36,000 ft    │ 8,500 ft     │
│ avg altitude │ avg altitude │ avg altitude │
└──────────────┴──────────────┴──────────────┘
```

### 7. Rarity Trend

Show how rarity changes over time:
```
Your collection growth:
Jan: 450 aircraft
Feb: 523 aircraft (+73)
Mar: 601 aircraft (+78)
...

New rare aircraft this month: 5
```

### 8. Session Details in Modal

When viewing aircraft details, show session breakdown:
```
N12345 - Boeing 737-800

Session History (Last 30 days):
┌─────────────────────────────────────────┐
│ Nov 4, 08:00-08:25  [AAL123]           │
│ 25 min, 32,000 ft avg, 485 kts         │
├─────────────────────────────────────────┤
│ Nov 2, 14:30-15:05  [AAL456]           │
│ 35 min, 34,500 ft avg, 478 kts         │
└─────────────────────────────────────────┘
```

### 9. "Achievements" / Milestones

Gamification elements:
- 🏆 Tracked 5,000th unique aircraft
- ⭐ Saw military aircraft from 10 different countries
- 📊 Logged 1 million positions
- 🦅 Highest altitude record: 49,025 ft

### 10. Export & Sharing

- Export aircraft list to CSV
- Share interesting finds (link to specific aircraft)
- Generate reports: "Your month in aviation"

---

## Recommended Implementation Priority

### Phase 1: Core Sighting Logic (High Priority)
1. Implement session detection (Hybrid Approach A3)
2. Update metadata table with `session_count` column
3. Migrate existing data to calculate historical sessions

### Phase 2: Enhanced Interactivity (High Priority)
4. Make rarity cards clickable → show filtered lists
5. Add search/filter panel
6. Show session breakdown in aircraft detail modal

### Phase 3: Visualizations (Medium Priority)
7. Add sighting timeline to aircraft details
8. Create "First Timers" section
9. Add frequency heatmap

### Phase 4: Advanced Features (Low Priority)
10. Aircraft comparison tool
11. Achievements/milestones
12. Export functionality

---

## Technical Considerations

### Database Impact
- Session calculation is computationally expensive on 2M+ positions
- Options:
  - Run as background job during low-traffic hours
  - Use PostgreSQL's `pg_cron` for scheduled updates
  - Create indexes on (icao, time) for performance

### API Design
New endpoints needed:
- `GET /stats/sessions-summary` - Overall session statistics
- `GET /aircraft/{icao}/sessions` - List all sessions for an aircraft
- `GET /stats/rarity?session_based=true` - Rarity using session counts
- `GET /stats/first-timers?days=7` - New aircraft in timeframe

### Storage
Session table estimated size (for 5000 aircraft, avg 50 sessions each):
- 250,000 sessions × ~100 bytes = 25 MB
- Minimal storage impact

### Performance
- Session calculation for 2.1M positions: ~30-60 seconds (one-time)
- Incremental updates (last 24h): <1 second
- Query performance: <100ms with proper indexes

---

## Questions to Discuss

1. **Session Gap Threshold**: 30 minutes? 1 hour? 2 hours?
   - Commercial flights are typically >30 min apart
   - GA aircraft might do touch-and-goes (need to detect these?)

2. **What counts as "in range"?**
   - Any position received = in range?
   - Or: Must be within certain distance from home?
   - If plane circles for 2 hours, is that 1 sighting or multiple?

3. **Historical data migration**:
   - Recalculate all 2.1M positions (slow but accurate)?
   - Or just start fresh from today (fast but loses history)?

4. **Display preference**:
   - Show session count by default?
   - Show both? ("45 sessions / 12,966 positions")
   - Toggle between views?

5. **Session granularity**:
   - Just count them?
   - Or store full session details (start/end time, flight path, etc.)?

---

## Mock-ups to Consider

### Rarity Card - Current vs. Proposed

**Current**:
```
┌─────────────────────┐
│ Extremely Rare      │
│        2            │
│ ≤10 sightings      │
└─────────────────────┘
```

**Proposed**:
```
┌─────────────────────┐
│ Extremely Rare  👁️  │  ← Clickable
│        2            │
│ ≤10 flights seen   │
│ View aircraft →     │
└─────────────────────┘
```

### Aircraft Detail - Session View

```
═══════════════════════════════════════════
N12345 - Boeing 737-800

📊 Sighting Summary
Total flights: 45 sessions
Total positions: 12,345
First seen: Oct 1, 2025
Last seen: Nov 4, 2025

📅 Recent Flights (Sessions)
┌─────────────────────────────────────────┐
│ Nov 4, 08:23 - 08:48  ✈️ [AAL123]      │
│ ├─ Duration: 25 minutes                 │
│ ├─ Avg Alt: 32,450 ft                   │
│ ├─ Max Alt: 35,000 ft                   │
│ └─ Avg Speed: 485 knots                 │
│                                         │
│ Nov 2, 14:30 - 15:05  ✈️ [AAL456]      │
│ ├─ Duration: 35 minutes                 │
│ ├─ Avg Alt: 34,500 ft                   │
│ └─ Max Speed: 492 knots                 │
└─────────────────────────────────────────┘

[View All 45 Sessions] [View in 3D] [Export]
═══════════════════════════════════════════
```

---

## Next Steps

1. Discuss and decide on:
   - Session detection logic & gap threshold
   - Implementation approach (A1, A2, or A3)
   - UI priorities

2. Create implementation plan with milestones

3. Start with Phase 1 (session detection backend)

4. Iterate on UI based on feedback
