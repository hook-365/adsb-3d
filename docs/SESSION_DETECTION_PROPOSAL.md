# Flight Session Detection - Technical Proposal

## The Problem

Currently, `total_sightings` in the database counts every 5-second position report:

```
Timeline for N12345 on Nov 4, 2025:

08:00:00 ━━━━━━━━━━━━━━━ 08:25:00
    300 position reports
    Currently counted as: 300 sightings ❌
    Should be counted as: 1 flight ✅

[2 hour gap - aircraft out of range]

10:30:00 ━━━━━━━━ 10:45:00
    180 position reports
    Currently counted as: 180 sightings ❌
    Should be counted as: 1 flight ✅

Total: 480 "sightings" ❌
Should be: 2 flights ✅
```

## Proposed Solution: Session Detection Algorithm

### Algorithm Logic

```python
def detect_sessions(positions, gap_threshold=30*60):  # 30 minutes
    """
    Group consecutive positions into flight sessions
    """
    sessions = []
    current_session = []

    for pos in sorted(positions, key=lambda x: x.time):
        if not current_session:
            # Start first session
            current_session.append(pos)
        else:
            # Check time gap from last position
            time_gap = pos.time - current_session[-1].time

            if time_gap <= gap_threshold:
                # Same session
                current_session.append(pos)
            else:
                # Gap too large - save current session, start new one
                sessions.append(current_session)
                current_session = [pos]

    # Don't forget last session
    if current_session:
        sessions.append(current_session)

    return sessions
```

### SQL Implementation (PostgreSQL Window Functions)

```sql
WITH position_gaps AS (
    SELECT
        icao,
        time,
        lat,
        lon,
        alt_baro,
        gs,
        flight,
        -- Calculate time since previous position for same aircraft
        EXTRACT(EPOCH FROM (
            time - LAG(time) OVER (PARTITION BY icao ORDER BY time)
        )) AS seconds_since_last
    FROM aircraft_positions
    WHERE time >= NOW() - INTERVAL '30 days'
),
session_markers AS (
    SELECT
        *,
        -- Mark start of new session if gap > 30 minutes (1800 seconds)
        CASE
            WHEN seconds_since_last IS NULL THEN 1  -- First position ever
            WHEN seconds_since_last > 1800 THEN 1   -- Gap > 30 min
            ELSE 0
        END AS is_session_start
    FROM position_gaps
),
session_ids AS (
    SELECT
        *,
        -- Cumulative sum creates unique session ID per continuous segment
        SUM(is_session_start) OVER (
            PARTITION BY icao
            ORDER BY time
        ) AS session_id
    FROM session_markers
)
SELECT
    icao,
    session_id,
    MIN(time) AS session_start,
    MAX(time) AS session_end,
    COUNT(*) AS position_count,
    AVG(alt_baro) AS avg_altitude,
    MAX(alt_baro) AS max_altitude,
    FIRST_VALUE(flight) OVER (
        PARTITION BY icao, session_id
        ORDER BY time
    ) AS flight_number,
    -- Session duration in minutes
    EXTRACT(EPOCH FROM (MAX(time) - MIN(time))) / 60 AS duration_minutes
FROM session_ids
GROUP BY icao, session_id
ORDER BY icao, session_start;
```

### Example Output

```
icao    | session_id | session_start       | session_end         | duration_min | positions | avg_alt
--------|------------|---------------------|---------------------|--------------|-----------|--------
a90aa2  | 1          | 2025-11-04 08:00:00 | 2025-11-04 08:25:00 | 25           | 300       | 32450
a90aa2  | 2          | 2025-11-04 10:30:00 | 2025-11-04 10:45:00 | 15           | 180       | 28750
a90aa2  | 3          | 2025-11-04 14:00:00 | 2025-11-04 14:35:00 | 35           | 420       | 31200
```

Result: **3 sessions** instead of **900 position reports**

## Implementation Options

### Option 1: Real-time Calculation (View)

Create a PostgreSQL VIEW:

```sql
CREATE VIEW aircraft_sessions_view AS
WITH ... (session detection query from above)
```

Create aggregation view:

```sql
CREATE VIEW aircraft_session_stats AS
SELECT
    icao,
    COUNT(DISTINCT session_id) AS total_sessions,
    MIN(session_start) AS first_flight,
    MAX(session_end) AS last_flight,
    AVG(duration_minutes) AS avg_flight_duration,
    SUM(position_count) AS total_positions
FROM aircraft_sessions_view
GROUP BY icao;
```

**Pros**: Always up-to-date, no storage overhead
**Cons**: Slower queries (must compute on every request)

### Option 2: Materialized Table (Recommended)

Create physical table:

```sql
CREATE TABLE aircraft_sessions (
    id SERIAL PRIMARY KEY,
    icao TEXT NOT NULL,
    session_number INTEGER NOT NULL,  -- 1st flight, 2nd flight, etc.
    session_start TIMESTAMPTZ NOT NULL,
    session_end TIMESTAMPTZ NOT NULL,
    duration_minutes NUMERIC,
    position_count INTEGER,
    avg_altitude INTEGER,
    max_altitude INTEGER,
    avg_speed NUMERIC,
    max_speed NUMERIC,
    flight_number TEXT,

    -- Spatial extent (for future map features)
    min_lat NUMERIC,
    max_lat NUMERIC,
    min_lon NUMERIC,
    max_lon NUMERIC,

    UNIQUE(icao, session_number)
);

CREATE INDEX idx_sessions_icao ON aircraft_sessions(icao);
CREATE INDEX idx_sessions_start ON aircraft_sessions(session_start);
CREATE INDEX idx_sessions_icao_start ON aircraft_sessions(icao, session_start);
```

Update `aircraft_metadata` to add session count:

```sql
ALTER TABLE aircraft_metadata
ADD COLUMN total_sessions INTEGER DEFAULT 0;

CREATE INDEX idx_metadata_sessions ON aircraft_metadata(total_sessions);
```

**Pros**: Fast queries, rich session data stored, can show session history
**Cons**: Requires background job to populate/update

### Option 3: Hybrid (Best of Both)

- Use materialized table for sessions older than 24 hours
- Use real-time calculation for recent data
- Union them in queries

```sql
CREATE VIEW aircraft_all_sessions AS
-- Historical sessions (pre-calculated)
SELECT * FROM aircraft_sessions
WHERE session_end < NOW() - INTERVAL '24 hours'
UNION ALL
-- Recent sessions (calculated on-the-fly)
SELECT ... (session detection query)
FROM aircraft_positions
WHERE time >= NOW() - INTERVAL '24 hours';
```

**Pros**: Fast queries, always accurate
**Cons**: More complex implementation

## Migration Strategy

### Step 1: Create New Schema
```bash
# Add new table and columns
psql -U adsb -d adsb_tracks < migrations/001_add_sessions.sql
```

### Step 2: Backfill Historical Data
```python
# One-time migration script
python scripts/calculate_historical_sessions.py --all

# This will:
# 1. Process all 2.1M positions
# 2. Detect sessions using 30-min gap
# 3. Insert into aircraft_sessions table
# 4. Update aircraft_metadata.total_sessions
# Estimated time: 5-10 minutes
```

### Step 3: Update Collector to Track Sessions
```python
# In track-service/main.py
# After inserting positions, check if we're in a new session

async def update_session_tracking(icao, current_time):
    # Check last session
    last_session = await get_last_session(icao)

    if not last_session:
        # First ever session
        await create_new_session(icao, current_time)
    else:
        gap = current_time - last_session.session_end
        if gap > timedelta(minutes=30):
            # Gap detected - start new session
            await create_new_session(icao, current_time)
        else:
            # Continue existing session
            await update_session_end(last_session.id, current_time)
```

### Step 4: Update API Endpoints
```python
# Add session-based statistics
@app.get("/stats/rarity")
async def get_rarity_stats(session_based: bool = True):
    if session_based:
        # Use total_sessions instead of total_sightings
        query = """
            SELECT
                COUNT(*) FILTER (WHERE total_sessions <= 10) as extremely_rare,
                COUNT(*) FILTER (WHERE total_sessions > 10 AND total_sessions <= 50) as very_rare,
                ...
            FROM aircraft_metadata
        """
    else:
        # Legacy behavior (position count)
        query = """... (existing query) ..."""
```

## Gap Threshold Tuning

Different aircraft types may need different thresholds:

### Recommended Thresholds

| Aircraft Type | Gap Threshold | Reasoning |
|--------------|---------------|-----------|
| Commercial (jets) | 30 minutes | Typical time between flights |
| General Aviation | 1 hour | May do multiple short flights |
| Training Aircraft | 2 hours | Touch-and-goes, multiple lessons/day |
| Military | 30 minutes | Similar to commercial |

### Configurable Implementation

```sql
CREATE TABLE session_detection_config (
    aircraft_category TEXT PRIMARY KEY,
    gap_threshold_seconds INTEGER NOT NULL
);

INSERT INTO session_detection_config VALUES
    ('commercial', 1800),   -- 30 min
    ('general', 3600),      -- 1 hour
    ('training', 7200),     -- 2 hours
    ('military', 1800),     -- 30 min
    ('default', 1800);      -- 30 min fallback
```

## Performance Benchmarks (Estimated)

### Initial Backfill
- **Dataset**: 2.1M positions, 5,082 aircraft
- **Expected sessions**: ~15,000-25,000 (3-5 sessions per aircraft avg)
- **Processing time**: 5-10 minutes
- **Storage**: ~25 MB for session table

### Ongoing Updates
- **New positions/hour**: ~720 (12 per minute × 60)
- **Session updates/hour**: ~10-20
- **Processing time/update**: <10ms
- **Negligible overhead on collector**

### Query Performance
Current (position-based):
```
SELECT COUNT(*) FROM aircraft_metadata WHERE total_sightings <= 10;
→ 50ms
```

With sessions (indexed):
```
SELECT COUNT(*) FROM aircraft_metadata WHERE total_sessions <= 10;
→ 2ms (25x faster!)
```

## Rollout Plan

### Phase 1: Backend (Week 1)
- [ ] Create `aircraft_sessions` table
- [ ] Add `total_sessions` to `aircraft_metadata`
- [ ] Write backfill script
- [ ] Run migration on production

### Phase 2: API Updates (Week 1-2)
- [ ] Add session-based endpoints
- [ ] Keep legacy endpoints for compatibility
- [ ] Add session detail endpoints
- [ ] Test with real data

### Phase 3: UI Updates (Week 2-3)
- [ ] Update stats dashboard to use sessions
- [ ] Add toggle "Show as: Sessions | Positions"
- [ ] Add session timeline to aircraft details
- [ ] Show session list in modals

### Phase 4: Optimization (Week 3-4)
- [ ] Monitor query performance
- [ ] Adjust gap thresholds based on patterns
- [ ] Add session analytics (busiest times, etc.)

## Open Questions

1. **Gap threshold**: Start with 30 minutes for all, or differentiate by type immediately?

2. **Training aircraft**: Touch-and-goes may have <5 minute gaps. Do we count each pattern as separate session?

3. **Overnight aircraft**: Aircraft parked overnight at airport - is next morning takeoff part of same "visit" or new session?

4. **Display preference**:
   - "45 flights seen" (sessions only)
   - "45 flights / 12,345 positions" (both)
   - User toggle?

5. **What about aircraft that just pass through without landing**?
   - Single continuous overhead pass = 1 session ✅
   - But what if they circle overhead for 3 hours? Still 1 session?

6. **Historical recalculation**: Do once and forget, or periodically re-run to improve accuracy?
