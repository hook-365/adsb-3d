// ============================================================================
// HISTORICAL DATA SERVICE MODULE
// ============================================================================
// Manages historical aircraft data loading from Track API

// Import dependencies
import { API } from './constants.js';

// ============================================================================
// HISTORICAL DATA LOADING
// ============================================================================

/**
 * Load historical tracks for specified hours ago
 * @param {number} hoursAgo - Number of hours to look back
 * @param {Object} deps - Dependencies from app.js
 * @returns {Promise<Array>} Array of tracks
 */
export async function loadHistoricalTracks(hoursAgo = 1, deps) {
    const {
        HistoricalState,
        historicalTracks,
        playbackStartTime,
        playbackEndTime,
        playbackCurrentTime,
        renderHistoricalTracks,
        clearHistoricalTracks
    } = deps;

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (hoursAgo * 60 * 60 * 1000));
    const maxTracks = HistoricalState.settings.maxTracks;

    // Update HistoricalState settings for URL persistence
    HistoricalState.settings.startTime = startTime;
    HistoricalState.settings.endTime = endTime;

    console.log('[Historical] Loading tracks for last', hoursAgo, 'hours');

    // Clear existing tracks first to prevent stacking
    clearHistoricalTracks();

    try {
        let apiUrl = `${API.TRACKS_BULK}?start=${startTime.toISOString()}&end=${endTime.toISOString()}&max_tracks=${maxTracks}&resolution=full`;

        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log(`[Historical] Loaded ${data.tracks?.length || 0} tracks`);

        // Store tracks in both global variable (for backwards compat) and HistoricalState
        Object.keys(historicalTracks).forEach(key => delete historicalTracks[key]);
        HistoricalState.tracks = [];
        deps.playbackStartTime = null;
        deps.playbackEndTime = null;

        if (data.tracks) {
            data.tracks.forEach(track => {
                const icao = track.hex || track.icao;
                if (icao) {
                    historicalTracks[icao] = track;
                }
                HistoricalState.tracks.push(track);

                // Update time bounds
                track.positions.forEach(pos => {
                    const timestamp = new Date(pos.timestamp || pos.time).getTime() / 1000;
                    if (!deps.playbackStartTime || timestamp < deps.playbackStartTime) {
                        deps.playbackStartTime = timestamp;
                    }
                    if (!deps.playbackEndTime || timestamp > deps.playbackEndTime) {
                        deps.playbackEndTime = timestamp;
                    }
                });
            });

            // Render the tracks visually
            renderHistoricalTracks();
        }

        // Set current time to start
        deps.playbackCurrentTime = deps.playbackStartTime;

        return data.tracks || [];
    } catch (error) {
        console.error('[Historical] Error loading tracks:', error);
        throw error;
    }
}

/**
 * Load historical tracks from Track API with current settings
 * @param {Object} deps - Dependencies from app.js
 * @returns {Promise<Object>} Stats object
 */
export async function loadHistoricalData(deps) {
    const {
        HistoricalState,
        renderHistoricalTracks,
        applyHistoricalFilters,
        generateFlightCorridors,
        showHistoricalTracks,
        setHeatMapVisibility,
        updateURLFromCurrentState
    } = deps;

    const startTime = HistoricalState.settings.startTime;
    const endTime = HistoricalState.settings.endTime;
    const maxTracks = HistoricalState.settings.maxTracks;

    if (!startTime || !endTime) {
        console.error('[Historical] No time range selected');
        return;
    }

    console.log('[Historical] Loading tracks...', {startTime, endTime, maxTracks});

    try {
        // Build API URL (NO filtering - filters applied after load)
        // Use resolution=full to query raw positions table (aggregated tables don't exist yet)
        let apiUrl = `${API.TRACKS_BULK}?start=${startTime.toISOString()}&end=${endTime.toISOString()}&max_tracks=${maxTracks}&resolution=full`;

        console.log('[Historical] Fetching from:', apiUrl);
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('[Historical] API Response:', data);
        console.log(`[Historical] Loaded ${data.tracks?.length || 0} tracks`);

        HistoricalState.tracks = data.tracks || [];
        HistoricalState.loadedRange = { start: startTime, end: endTime };

        // Store stats for display
        HistoricalState.stats = data.stats || { unique_aircraft: 0, total_positions: 0 };

        // Always render BOTH tracks and heat map, then show/hide based on mode
        console.log('[Historical] Rendering tracks...');
        renderHistoricalTracks();
        applyHistoricalFilters();
        console.log('[Historical] Tracks rendered and filtered');

        console.log('[Historical] Generating heat map...');
        generateFlightCorridors();
        console.log('[Historical] Heat map generated');

        // Now apply visibility based on current mode
        const vizMode = HistoricalState.heatmapMode || 'tracks';
        console.log(`[Historical] Applying visualization mode: ${vizMode}`);

        if (vizMode === 'tracks') {
            showHistoricalTracks(true);
            setHeatMapVisibility(false);
        } else if (vizMode === 'heatmap') {
            showHistoricalTracks(false);
            setHeatMapVisibility(true);
        } else if (vizMode === 'both') {
            showHistoricalTracks(true);
            setHeatMapVisibility(true);
        }

        // Update URL with current app state for shareable links
        updateURLFromCurrentState();

        // Return stats for caller
        return data.stats;

    } catch (error) {
        console.error('[Historical] Error loading data:', error);

        // Show error in status UI instead of blocking alert
        const statusEl = document.getElementById('historical-status');
        if (statusEl) {
            statusEl.className = 'historical-status error';
            statusEl.textContent = `Failed to load data: ${error.message}`;
        }

        throw error; // Re-throw so caller can handle if needed
    }
}

/**
 * Load historical tracks with custom date/time range
 * @param {Date} startTime - Start time
 * @param {Date} endTime - End time
 * @param {Object} deps - Dependencies from app.js
 * @returns {Promise<Array>} Array of tracks
 */
export async function loadHistoricalTracksCustom(startTime, endTime, deps) {
    const {
        HistoricalState,
        historicalTracks,
        playbackStartTime,
        playbackEndTime,
        playbackCurrentTime,
        renderHistoricalTracks,
        clearHistoricalTracks
    } = deps;

    const maxTracks = HistoricalState.settings.maxTracks;

    // Update HistoricalState settings for URL persistence
    HistoricalState.settings.startTime = startTime;
    HistoricalState.settings.endTime = endTime;

    console.log('[Historical] Loading tracks for custom range:', {
        start: startTime.toISOString(),
        end: endTime.toISOString()
    });

    // Clear existing tracks first to prevent stacking
    clearHistoricalTracks();

    try {
        let apiUrl = `${API.TRACKS_BULK}?start=${startTime.toISOString()}&end=${endTime.toISOString()}&max_tracks=${maxTracks}&resolution=full`;

        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log(`[Historical] Loaded ${data.tracks?.length || 0} tracks from custom range`);

        // Store tracks in both global variable (for backwards compat) and HistoricalState
        Object.keys(historicalTracks).forEach(key => delete historicalTracks[key]);
        HistoricalState.tracks = [];
        deps.playbackStartTime = null;
        deps.playbackEndTime = null;

        if (data.tracks) {
            data.tracks.forEach(track => {
                const icao = track.hex || track.icao;
                if (icao) {
                    historicalTracks[icao] = track;
                }
                HistoricalState.tracks.push(track);

                // Update time bounds
                track.positions.forEach(pos => {
                    const timestamp = new Date(pos.timestamp || pos.time).getTime() / 1000;
                    if (!deps.playbackStartTime || timestamp < deps.playbackStartTime) {
                        deps.playbackStartTime = timestamp;
                    }
                    if (!deps.playbackEndTime || timestamp > deps.playbackEndTime) {
                        deps.playbackEndTime = timestamp;
                    }
                });
            });

            // Render the tracks visually
            renderHistoricalTracks();
        }

        // Set current time to start
        deps.playbackCurrentTime = deps.playbackStartTime;

        return data.tracks || [];
    } catch (error) {
        console.error('[Historical] Error loading tracks:', error);
        throw error;
    }
}

/**
 * Load full historical trail for a specific aircraft (on-demand)
 * @param {string} icao - ICAO hex code
 * @param {Object} deps - Dependencies from app.js
 * @returns {Promise<boolean>} Success status
 */
export async function loadFullTrailForAircraft(icao, deps) {
    const {
        AppFeatures,
        FullTrailsState,
        API,
        smoothAltitudes,
        trails,
        latLonToXZ,
        CONFIG,
        scene,
        THREE,
        showTrails,
        trailColorMode,
        getSpeedColor,
        getAltitudeColor
    } = deps;

    // Check if Track API is available
    if (!AppFeatures.historical) {
        console.log('[FullTrail] Track API not available');
        return false;
    }

    // Check if already loaded
    if (FullTrailsState.icaos.has(icao)) {
        return true;
    }

    // Check if already loading
    if (FullTrailsState.loading.has(icao)) {
        return false;
    }

    // Mark as loading
    FullTrailsState.loading.add(icao);

    try {
        // Show loading indicator in detail panel
        const detailPanel = document.getElementById('aircraft-detail');
        if (detailPanel) {
            const loadingDiv = document.createElement('div');
            loadingDiv.id = `trail-loading-${icao}`;
            loadingDiv.style.cssText = 'padding: 5px; background: rgba(0,255,0,0.1); border: 1px solid rgba(0,255,0,0.3); border-radius: 4px; margin: 5px 0; font-size: 11px;';
            loadingDiv.innerHTML = '<div class="spinner" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; margin-right: 5px;"></div><span>Loading full trail history...</span>';
            detailPanel.insertBefore(loadingDiv, detailPanel.firstChild);
        }

        // Build API URL - get last 24 hours of data
        const apiUrl = `${deps.API.TRACKS_BY_ICAO}/${icao}?resolution=full`;

        const response = await fetch(apiUrl);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Check if we got valid data
        if (!data.positions || data.positions.length === 0) {
            throw new Error('No historical data available');
        }

        // Smooth altitudes
        const smoothedPositions = smoothAltitudes(data.positions);

        // Get or create trail for this aircraft
        let trail = trails.get(icao);
        if (!trail) {
            trail = {
                positions: [],
                line: null,
                material: null,
                lastUpdate: Date.now()
            };
            trails.set(icao, trail);
        }

        // Clear existing positions and add historical data
        trail.positions = [];

        smoothedPositions.forEach(pos => {
            // Validate position data (Track API can return lat/lon or latitude/longitude)
            const lat = pos.lat || pos.latitude;
            const lon = pos.lon || pos.longitude;
            // Single aircraft endpoint returns 'alt_baro', bulk returns 'alt'
            const alt = pos.alt_baro || pos.alt || pos.altitude || 0;

            // Skip invalid positions
            if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
                return;
            }

            // Use the same coordinate conversion as live mode (latLonToXZ function)
            const posXZ = latLonToXZ(lat, lon);

            // Use the same altitude calculation as live mode
            const altitude = (alt - CONFIG.homeLocation.alt) * 0.3048 * CONFIG.scale * CONFIG.altitudeExaggeration;

            // Validate coordinates aren't NaN
            if (isNaN(posXZ.x) || isNaN(altitude) || isNaN(posXZ.z)) {
                return;
            }

            // Add position to trail (with same minimum altitude as live mode)
            // Single aircraft endpoint returns 'time', bulk returns 'timestamp'
            const posTimestamp = pos.time ? new Date(pos.time).getTime() :
                                pos.timestamp ? new Date(pos.timestamp).getTime() :
                                Date.now();
            const groundSpeed = pos.gs || pos.speed || 0;
            trail.positions.push({
                x: posXZ.x,
                y: Math.max(1.0, altitude),
                z: posXZ.z,
                altFeet: alt,
                groundSpeed: groundSpeed,
                timestamp: posTimestamp
            });
        });

        // Only update if we have enough valid positions
        if (trail.positions.length < 2) {
            throw new Error(`Only ${trail.positions.length} valid positions found`);
        }

        // Create the trail line geometry if it doesn't exist
        if (!trail.line) {
            const trailGeometry = new THREE.BufferGeometry();
            const initialCapacity = Math.max(1000, trail.positions.length);
            const positions = new Float32Array(initialCapacity * 3);
            const colors = new Float32Array(initialCapacity * 3);

            // Fill in the positions and colors
            trail.positions.forEach((pos, i) => {
                positions[i * 3] = pos.x;
                positions[i * 3 + 1] = pos.y;
                positions[i * 3 + 2] = pos.z;

                // Get color based on current trail color mode
                let colorValue;
                if (trailColorMode === 'speed') {
                    colorValue = getSpeedColor(pos.groundSpeed || 0);
                } else {
                    colorValue = getAltitudeColor(pos.y);
                }
                const trailColor = new THREE.Color(colorValue);
                colors[i * 3] = trailColor.r;
                colors[i * 3 + 1] = trailColor.g;
                colors[i * 3 + 2] = trailColor.b;
            });

            trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            trailGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

            const trailMaterial = new THREE.LineBasicMaterial({
                vertexColors: true,
                transparent: true,
                opacity: 0.6
            });

            const line = new THREE.Line(trailGeometry, trailMaterial);
            line.visible = showTrails;
            line.geometry.setDrawRange(0, trail.positions.length);
            scene.add(line);

            // Update trail object
            trail.line = line;
            trail.material = trailMaterial;
            trail.maxCapacity = initialCapacity;
        }

        // Mark as loaded
        FullTrailsState.icaos.add(icao);
        FullTrailsState.loading.delete(icao);

        // Remove loading indicator
        const loadingDiv = document.getElementById(`trail-loading-${icao}`);
        if (loadingDiv) {
            loadingDiv.remove();
        }

        console.log(`[FullTrail] Loaded ${trail.positions.length} positions for ${icao}`);
        return true;

    } catch (error) {
        console.error(`[FullTrail] Error loading trail for ${icao}:`, error);
        FullTrailsState.loading.delete(icao);

        // Remove loading indicator and show error
        const loadingDiv = document.getElementById(`trail-loading-${icao}`);
        if (loadingDiv) {
            loadingDiv.innerHTML = `❌ ${error.message}`;
            loadingDiv.style.background = 'rgba(255,0,0,0.1)';
            loadingDiv.style.borderColor = 'rgba(255,0,0,0.3)';
            setTimeout(() => loadingDiv.remove(), 3000);
        }

        return false;
    }
}

/**
 * Load recent trails for live mode (last X minutes)
 * @param {Object} deps - Dependencies from app.js
 * @returns {Promise<void>}
 */
export async function loadRecentTrails(deps) {
    const {
        RecentTrailsState,
        currentMode,
        clearAllTrails,
        addRecentTrailsToLiveMode
    } = deps;

    if (!RecentTrailsState.enabled) {
        console.log('[RecentTrails] Feature not enabled');
        return;
    }

    // Skip if preload time is set to 0 (off)
    if (RecentTrailsState.minutes === 0) {
        console.log('[RecentTrails] Preload disabled (set to 0 minutes)');
        return;
    }

    // Race condition guard: prevent concurrent loads
    if (RecentTrailsState.loading) {
        console.log('[RecentTrails] Load already in progress, skipping duplicate request');
        return;
    }

    // Don't load recent trails when in historical mode with active filters
    // This prevents mixing live current data with historical filtered data
    const altMaxInput = document.getElementById('filter-altitude-max');
    const altMinInput = document.getElementById('filter-altitude-min');
    const minPosInput = document.getElementById('filter-min-positions');
    const spdMinInput = document.getElementById('filter-speed-min');
    const spdMaxInput = document.getElementById('filter-speed-max');
    const militaryInput = document.getElementById('filter-military-only');

    const hasActiveFilters = (altMaxInput?.value && parseInt(altMaxInput.value) < 999999) ||
                            (altMinInput?.value && parseInt(altMinInput.value) > 0) ||
                            (minPosInput?.value && parseInt(minPosInput.value) > 0) ||
                            (spdMinInput?.value && parseInt(spdMinInput.value) > 0) ||
                            (spdMaxInput?.value && parseInt(spdMaxInput.value) < 999999) ||
                            (militaryInput?.checked);

    if (currentMode === 'historical' && hasActiveFilters) {
        console.log('[RecentTrails] Skipping - historical mode with active filters detected');
        return;
    }

    // Set loading flag
    RecentTrailsState.loading = true;

    const minutes = RecentTrailsState.minutes;
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (minutes * 60 * 1000));

    console.log(`[RecentTrails] Loading last ${minutes} minutes of trails...`, {startTime, endTime});

    try {
        // Update status in sidebar (prefer sidebar-preload-status, fallback to recent-trails-status)
        const statusDiv = document.getElementById('sidebar-preload-status') || document.getElementById('recent-trails-status');
        if (statusDiv) {
            statusDiv.innerHTML = '<div class="spinner"></div><span>Loading recent trails...</span>';
            statusDiv.className = 'historical-status loading';
        }

        // CRITICAL: Clear all existing trails before loading historical data
        // This prevents mixing old live data with historical data which causes rendering artifacts
        console.log('[RecentTrails] Clearing existing trails before loading historical data');
        clearAllTrails();

        // Build API URL - load all tracks from recent time period
        let apiUrl = `/api/tracks/bulk/timelapse?start=${startTime.toISOString()}&end=${endTime.toISOString()}&max_tracks=200&resolution=full`;

        console.log('[RecentTrails] Fetching from:', apiUrl);
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('[RecentTrails] API Response:', data);
        console.log(`[RecentTrails] Loaded ${data.tracks?.length || 0} tracks`);

        // Add these positions to existing live mode trails
        if (data.tracks && data.tracks.length > 0) {
            addRecentTrailsToLiveMode(data.tracks);
            RecentTrailsState.loaded = true;

            // Update status
            if (statusDiv) {
                statusDiv.innerHTML = `✓ Loaded ${data.tracks.length} recent trails (${data.stats?.total_positions || 0} positions)`;
                statusDiv.className = 'historical-status success';
            }
        } else {
            if (statusDiv) {
                statusDiv.innerHTML = `No recent activity in the last ${minutes} minute${minutes > 1 ? 's' : ''}`;
                statusDiv.className = 'historical-status warning';
            }
        }

    } catch (error) {
        console.error('[RecentTrails] Error loading data:', error);
        const statusDiv = document.getElementById('sidebar-preload-status') || document.getElementById('recent-trails-status');
        if (statusDiv) {
            statusDiv.innerHTML = `❌ Failed to load recent trails: ${error.message}`;
            statusDiv.className = 'historical-status error';
        }
    } finally {
        // Always clear loading flag, even on error
        RecentTrailsState.loading = false;
    }
}
