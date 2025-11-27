// ============================================================================
// URL STATE MANAGER MODULE
// ============================================================================
// Manages browser URL state for shareable links and browser navigation
// Handles URL parameter parsing, state updates, and browser history management

// Import dependencies
import { API, TIMING } from './constants.js';

// ============================================================================
// URL STATE OBJECT
// ============================================================================
// Provides methods for getting/setting URL parameters and applying state

export const URLState = {
    /**
     * Get URL parameters from current URL
     * @returns {Object} Parsed URL parameters
     */
    getParams() {
        const params = new URLSearchParams(window.location.search);
        const result = {
            // Mode
            mode: params.get('mode'), // 'live' or 'historical'

            // Historical time range
            start: params.get('start'), // ISO 8601 datetime
            end: params.get('end'), // ISO 8601 datetime
            preset: params.get('preset'), // Time preset (1, 4, 8, 12, 24, or 'custom')

            // Display settings
            tron: params.get('tron'), // Tron mode ('1' or null)
            display: params.get('display'), // Display mode ('all' or 'playback')
            vizmode: params.get('vizmode'), // Visualization mode ('tracks', 'heatmap', or 'both')
            theme: params.get('theme'), // Theme name

            // Live mode toggles
            trails: params.get('trails'), // Show trails
            labels: params.get('labels'), // Show labels
            airports: params.get('airports'), // Show airports
            runways: params.get('runways'), // Show runways
            altlines: params.get('altlines'), // Show altitude lines
            radar: params.get('radar'), // Show mini radar
            compass: params.get('compass'), // Show compass
            fade: params.get('fade'), // Auto-fade trails
            fadetime: params.get('fadetime'), // Fade time in seconds

            // Historical filters
            military: params.get('military'), // Military only
            altmin: params.get('altmin'), // Min altitude
            altmax: params.get('altmax'), // Max altitude
            minpos: params.get('minpos'), // Min positions
            spdmin: params.get('spdmin'), // Min speed
            spdmax: params.get('spdmax'), // Max speed

            // Selected aircraft
            icao: params.get('icao') // ICAO hex code
        };

        // Debug logging
        if (result.start || result.end || result.preset) {
            console.log('[URL State] Extracted parameters:', {
                start: result.start,
                end: result.end,
                preset: result.preset,
                mode: result.mode,
                altmax: result.altmax,
                minpos: result.minpos
            });
        }

        return result;
    },

    /**
     * Update URL without page reload (using History API)
     * @param {Object} state - State object with any combination of parameters
     */
    updateURL(state) {
        const params = new URLSearchParams();

        // Only add parameters that have values (skip null/undefined)
        if (state.mode) params.set('mode', state.mode);
        if (state.start) params.set('start', state.start);
        if (state.end) params.set('end', state.end);
        if (state.preset) params.set('preset', state.preset);
        if (state.tron) params.set('tron', state.tron);
        if (state.display) params.set('display', state.display);
        if (state.theme) params.set('theme', state.theme);
        if (state.trails !== undefined && state.trails !== null) params.set('trails', state.trails);
        if (state.labels !== undefined && state.labels !== null) params.set('labels', state.labels);
        if (state.airports !== undefined && state.airports !== null) params.set('airports', state.airports);
        if (state.runways !== undefined && state.runways !== null) params.set('runways', state.runways);
        if (state.altlines !== undefined && state.altlines !== null) params.set('altlines', state.altlines);
        if (state.radar !== undefined && state.radar !== null) params.set('radar', state.radar);
        if (state.compass !== undefined && state.compass !== null) params.set('compass', state.compass);
        if (state.fade) params.set('fade', state.fade);
        if (state.fadetime) params.set('fadetime', state.fadetime);
        if (state.military) params.set('military', state.military);
        if (state.altmin) params.set('altmin', state.altmin);
        if (state.altmax) params.set('altmax', state.altmax);
        if (state.minpos) params.set('minpos', state.minpos);
        if (state.spdmin) params.set('spdmin', state.spdmin);
        if (state.spdmax) params.set('spdmax', state.spdmax);
        if (state.icao) params.set('icao', state.icao);

        const newURL = params.toString()
            ? `${window.location.pathname}?${params.toString()}`
            : window.location.pathname;

        // Update URL without reloading page
        window.history.pushState(state, '', newURL);
        console.log('[URL State] Updated:', newURL);
    },

    /**
     * Apply URL parameters to app state (called on page load)
     * Requires references to app state and functions
     * @param {Object} deps - Dependencies { AppFeatures, switchToLiveMode, switchToHistoricalMode, HistoricalState, showTronMode, etc. }
     * @returns {Promise<boolean>} True if URL state was applied
     */
    async applyFromURL(deps) {
        const {
            AppFeatures,
            switchToLiveMode,
            switchToHistoricalMode,
            HistoricalState,
            showTronMode,
            clearAllHistoricalTracks,
            generateFlightCorridors,
            clearFlightCorridors,
            formatForDatetimeInput
        } = deps;

        try {
            const urlParams = this.getParams();

            // No URL parameters = nothing to apply
            if (!urlParams.mode && !urlParams.start && !urlParams.end && !urlParams.preset) {
                console.log('[URL State] No URL parameters found - using defaults');
                return false;
            }

            console.log('[URL State] Found parameters:', urlParams);

            // If mode is historical and we have start/end times
            if (urlParams.mode === 'historical' && urlParams.start && urlParams.end) {
                // Check if Track API is available
                if (!AppFeatures.historical) {
                    console.warn('[URL State] Historical mode requested but Track API not available - falling back to live mode');
                    await switchToLiveMode(true); // Skip URL update when loading from URL
                    return false;
                }

                // Parse ISO 8601 dates with validation
                const startDate = new Date(urlParams.start);
                const endDate = new Date(urlParams.end);

                // Validate dates
                if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                    console.error('[URL State] Invalid date format in URL - falling back to live mode');
                    console.error('[URL State] Start:', urlParams.start, '→', startDate);
                    console.error('[URL State] End:', urlParams.end, '→', endDate);
                    await switchToLiveMode(true); // Skip URL update when loading from URL
                    return false;
                }

                // Validate date range is reasonable (not in future, not too far in past)
                const now = new Date();
                const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

                if (startDate > now) {
                    console.warn('[URL State] Start time is in the future - falling back to live mode');
                    await switchToLiveMode(true); // Skip URL update when loading from URL
                    return false;
                }

                if (endDate > now) {
                    console.warn('[URL State] End time is in the future - adjusting to now');
                    urlParams.end = now.toISOString();
                }

                if (startDate < oneYearAgo) {
                    console.warn('[URL State] Start time is more than 1 year ago - may have no data');
                }

                if (endDate <= startDate) {
                    console.error('[URL State] End time is before or equal to start time - falling back to live mode');
                    await switchToLiveMode(true); // Skip URL update when loading from URL
                    return false;
                }

                // Switch to historical mode first (skip URL update - we'll do it after loading data)
                await switchToHistoricalMode(true);

                // Helper to format date for calendar picker display (e.g., "Nov 27, 2025 10:39")
                const formatCalendarDisplay = (date) => {
                    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const day = String(date.getDate()).padStart(2, '0');
                    const hours = String(date.getHours()).padStart(2, '0');
                    const minutes = String(date.getMinutes()).padStart(2, '0');
                    return `${monthNames[date.getMonth()]} ${day}, ${date.getFullYear()} ${hours}:${minutes}`;
                };

                // New sidebar elements
                const timeModePresetBtn = document.getElementById('time-mode-preset');
                const timeModeCustomBtn = document.getElementById('time-mode-custom');
                const timePresetSection = document.getElementById('time-preset-section');
                const timeCustomSection = document.getElementById('time-custom-section');
                const sidebarTimePreset = document.getElementById('sidebar-time-preset');

                // Set preset or custom mode with validation
                // IMPORTANT: If explicit start/end times are provided, use custom mode (they take priority)
                if (urlParams.start && urlParams.end) {
                    // Explicit times provided - use custom mode
                    if (timeModePresetBtn && timeModeCustomBtn && timePresetSection && timeCustomSection) {
                        timeModePresetBtn.classList.remove('sidebar-button-active');
                        timeModeCustomBtn.classList.add('sidebar-button-active');
                        timePresetSection.style.display = 'none';
                        timeCustomSection.style.display = 'block';
                    }
                    console.log('[URL State] Using custom time mode due to explicit start/end in URL');

                    // Populate custom time fields (new IDs: custom-start-time and custom-end-time)
                    const startTimeInput = document.getElementById('custom-start-time');
                    const endTimeInput = document.getElementById('custom-end-time');

                    const startDate = new Date(urlParams.start);
                    const endDate = new Date(urlParams.end);

                    if (startTimeInput && !isNaN(startDate.getTime())) {
                        // Store ISO format in data attribute (used by load button)
                        startTimeInput.dataset.datetime = formatForDatetimeInput(urlParams.start);
                        // Display human-readable format
                        startTimeInput.value = formatCalendarDisplay(startDate);
                        console.log('[URL State] Set start time input:', startTimeInput.value, 'data:', startTimeInput.dataset.datetime);
                    }
                    if (endTimeInput && !isNaN(endDate.getTime())) {
                        // Store ISO format in data attribute (used by load button)
                        endTimeInput.dataset.datetime = formatForDatetimeInput(urlParams.end);
                        // Display human-readable format
                        endTimeInput.value = formatCalendarDisplay(endDate);
                        console.log('[URL State] Set end time input:', endTimeInput.value, 'data:', endTimeInput.dataset.datetime);
                    }

                    // Update HistoricalState
                    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
                        HistoricalState.settings.startTime = startDate;
                        HistoricalState.settings.endTime = endDate;
                        console.log('[URL State] ✓ Set HistoricalState times from URL:', { start: startDate.toISOString(), end: endDate.toISOString() });
                    }
                } else if (urlParams.preset && urlParams.preset !== 'custom') {
                    // No explicit times, but preset is provided - use quick preset mode
                    const validPresets = ['1', '4', '8', '12', '24'];
                    if (validPresets.includes(urlParams.preset)) {
                        // Ensure preset mode is selected
                        if (timeModePresetBtn && timeModeCustomBtn && timePresetSection && timeCustomSection) {
                            timeModePresetBtn.classList.add('sidebar-button-active');
                            timeModeCustomBtn.classList.remove('sidebar-button-active');
                            timePresetSection.style.display = 'block';
                            timeCustomSection.style.display = 'none';
                        }

                        // Set the dropdown value
                        if (sidebarTimePreset) {
                            sidebarTimePreset.value = urlParams.preset;
                            console.log(`[URL State] Selected preset: Last ${urlParams.preset} hour(s)`);
                        }

                        // Calculate the time range for HistoricalState
                        const end = new Date();
                        const start = new Date(end.getTime() - (parseInt(urlParams.preset) * 60 * 60 * 1000));
                        HistoricalState.settings.startTime = start;
                        HistoricalState.settings.endTime = end;
                    } else {
                        console.warn('[URL State] Invalid preset value:', urlParams.preset);
                    }
                } else {
                    // Default to preset mode with 1 hour
                    console.log('[URL State] No explicit times or preset, using default 1 hour preset');
                }

                // Apply tron mode if specified
                if (urlParams.tron === '1' || urlParams.tron === 'true') {
                    deps.setShowTronMode(true);
                    const tronToggle = document.getElementById('toggle-tron-mode-container');
                    if (tronToggle) tronToggle.classList.add('active');
                }

                // Apply filters with validation
                if (urlParams.military === '1') {
                    const militaryCheckbox = document.getElementById('filter-military-only');
                    if (militaryCheckbox) militaryCheckbox.checked = true;
                }

                if (urlParams.altmin) {
                    const altMin = parseInt(urlParams.altmin);
                    if (!isNaN(altMin) && altMin >= 0 && altMin <= 60000) {
                        const input = document.getElementById('filter-altitude-min');
                        if (input) input.value = altMin;
                    } else {
                        console.warn('[URL State] Invalid altmin value:', urlParams.altmin);
                    }
                }

                if (urlParams.altmax) {
                    const altMax = parseInt(urlParams.altmax);
                    if (!isNaN(altMax) && altMax >= 0 && altMax <= 60000) {
                        const input = document.getElementById('filter-altitude-max');
                        if (input) {
                            input.value = altMax;
                            console.log('[URL State] Set altmax filter to:', altMax, '(input element exists:', !!input, ')');
                        } else {
                            console.warn('[URL State] Could not find filter-altitude-max input element');
                        }
                    } else {
                        console.warn('[URL State] Invalid altmax value:', urlParams.altmax);
                    }
                }

                if (urlParams.minpos) {
                    const minPos = parseInt(urlParams.minpos);
                    if (!isNaN(minPos) && minPos >= 2 && minPos <= 10000) {
                        const input = document.getElementById('filter-min-positions');
                        if (input) {
                            input.value = minPos;
                            console.log('[URL State] Set minpos filter to:', minPos);
                        } else {
                            console.warn('[URL State] Could not find filter-min-positions input element');
                        }
                    } else {
                        console.warn('[URL State] Invalid minpos value:', urlParams.minpos);
                    }
                }

                if (urlParams.spdmin) {
                    const spdMin = parseInt(urlParams.spdmin);
                    if (!isNaN(spdMin) && spdMin >= 0 && spdMin <= 1000) {
                        const input = document.getElementById('filter-speed-min');
                        if (input) input.value = spdMin;
                    } else {
                        console.warn('[URL State] Invalid spdmin value:', urlParams.spdmin);
                    }
                }

                if (urlParams.spdmax) {
                    const spdMax = parseInt(urlParams.spdmax);
                    if (!isNaN(spdMax) && spdMax >= 0 && spdMax <= 1000) {
                        const input = document.getElementById('filter-speed-max');
                        if (input) input.value = spdMax;
                    } else {
                        console.warn('[URL State] Invalid spdmax value:', urlParams.spdmax);
                    }
                }

                // Automatically load the data
                console.log('[URL State] Auto-loading historical data from URL parameters');
                const loadButton = document.getElementById('sidebar-load-tracks');
                if (loadButton) {
                    // Trigger the load button click after a short delay to ensure UI is ready
                    setTimeout(() => {
                        console.log('[URL State] Clicking sidebar-load-tracks button');
                        loadButton.click();

                        // Apply display mode after data loads (wait for load to complete)
                        setTimeout(() => {
                            if (urlParams.display === 'playback') {
                                // New sidebar uses radio buttons for display mode
                                const playbackRadio = document.querySelector('input[name="sidebar-display-mode"][value="playback"]');
                                if (playbackRadio) {
                                    playbackRadio.checked = true;
                                    playbackRadio.dispatchEvent(new Event('change'));
                                }
                            }

                            // Apply visualization mode (tracks/heatmap/both)
                            if (urlParams.vizmode) {
                                const vizModeRadio = document.querySelector(`input[name="sidebar-viz-mode"][value="${urlParams.vizmode}"]`);
                                if (vizModeRadio) {
                                    vizModeRadio.checked = true;
                                    HistoricalState.heatmapMode = urlParams.vizmode;
                                    console.log(`[URL State] Applied visualization mode: ${urlParams.vizmode}`);

                                    // Trigger mode change to show/hide heatmap
                                    if (urlParams.vizmode === 'heatmap') {
                                        clearAllHistoricalTracks();
                                        generateFlightCorridors();
                                    } else if (urlParams.vizmode === 'both') {
                                        generateFlightCorridors();
                                    } else if (urlParams.vizmode === 'tracks') {
                                        clearFlightCorridors();
                                    }
                                }
                            }
                        }, 2000);
                    }, 500);
                } else {
                    console.warn('[URL State] Could not find sidebar-load-tracks button');
                }

                console.log('[URL State] Applied historical mode from URL');
                return true;
            }

            // Mode is explicitly 'live' or unrecognized
            if (urlParams.mode === 'live') {
                await switchToLiveMode(true); // Skip URL update when loading from URL
                console.log('[URL State] Applied live mode from URL');
                return true;
            }

            // No valid mode found - default to live mode
            console.warn('[URL State] No valid mode found in URL - defaulting to live mode');
            return false;

        } catch (error) {
            console.error('[URL State] Error applying URL parameters:', error);
            console.error('[URL State] Falling back to live mode with default settings');

            // Try to recover by switching to live mode
            try {
                await deps.switchToLiveMode(true); // Skip URL update when recovering from error
            } catch (recoveryError) {
                console.error('[URL State] Failed to recover to live mode:', recoveryError);
            }

            return false;
        }
    },

    /**
     * Capture current app state and update URL
     * Call this after any user action that changes settings
     * @param {Object} deps - Dependencies { currentMode, HistoricalState, showTronMode, SafeStorage, selectedAircraft }
     */
    updateFromCurrentState(deps) {
        const {
            currentMode,
            HistoricalState,
            showTronMode,
            SafeStorage,
            selectedAircraft
        } = deps;

        const state = {
            mode: currentMode
        };

        // Add historical mode parameters
        if (currentMode === 'historical' && HistoricalState.settings.startTime && HistoricalState.settings.endTime) {
            state.start = HistoricalState.settings.startTime.toISOString();
            state.end = HistoricalState.settings.endTime.toISOString();

            // Check if custom mode is active (new sidebar uses buttons not radio)
            const timeCustomSection = document.getElementById('time-custom-section');
            const isCustomMode = timeCustomSection && timeCustomSection.style.display !== 'none';

            if (isCustomMode) {
                state.preset = 'custom';
            } else {
                // Get preset from dropdown
                const sidebarTimePreset = document.getElementById('sidebar-time-preset');
                if (sidebarTimePreset) state.preset = sidebarTimePreset.value;
            }

            state.display = HistoricalState.displayMode === 'playback' ? 'playback' : 'all';

            // Add visualization mode (tracks/heatmap/both)
            if (HistoricalState.heatmapMode && HistoricalState.heatmapMode !== 'tracks') {
                state.vizmode = HistoricalState.heatmapMode;
            }

            if (showTronMode) state.tron = '1';

            // Add filters if set
            const militaryOnly = document.getElementById('filter-military-only');
            if (militaryOnly && militaryOnly.checked) state.military = '1';

            const altMin = document.getElementById('filter-altitude-min');
            if (altMin && altMin.value) state.altmin = altMin.value;

            const altMax = document.getElementById('filter-altitude-max');
            if (altMax && altMax.value) state.altmax = altMax.value;

            const minPos = document.getElementById('filter-min-positions');
            if (minPos && minPos.value) state.minpos = minPos.value;

            const spdMin = document.getElementById('filter-speed-min');
            if (spdMin && spdMin.value) state.spdmin = spdMin.value;

            const spdMax = document.getElementById('filter-speed-max');
            if (spdMax && spdMax.value) state.spdmax = spdMax.value;
        }

        // Add live mode tron setting
        if (showTronMode) state.tron = '1';

        // Add current theme
        const currentTheme = SafeStorage.getItem('selectedTheme');
        if (currentTheme && currentTheme !== 'modern') state.theme = currentTheme;

        // Add selected aircraft
        if (selectedAircraft) state.icao = selectedAircraft;

        this.updateURL(state);
    }
};

// ============================================================================
// FEATURE DETECTION SYSTEM
// ============================================================================
// Determines at runtime which features are available (live vs historical mode)

export const FeatureDetector = {
    cache: {
        historySupport: null,
        lastCheck: null,
        checkDuration: null
    },

    /**
     * Detect if Track API is available for historical mode
     * @returns {Promise<boolean>}
     */
    async detectHistorySupport() {
        const startTime = performance.now();
        const historicalEnabled = window.HISTORICAL_CONFIG?.enabled;

        // Historical mode disabled via environment variable
        if (!historicalEnabled) {
            console.log('[Feature Detection] Historical mode disabled via ENABLE_HISTORICAL=false');
            this.cache.historySupport = false;
            this.cache.lastCheck = Date.now();
            this.cache.checkDuration = performance.now() - startTime;
            return false;
        }

        console.log('[Feature Detection] Checking Track API availability at /api/health...');

        try {
            // Create abort controller for timeout
            const controller = new AbortController();
            const timeoutMs = TIMING.API_TIMEOUT;
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            // Ping health endpoint (proxied through nginx /api/health)
            const response = await fetch(API.HEALTH, {
                method: 'GET',
                signal: controller.signal,
                cache: 'no-cache',
                headers: {
                    'Accept': 'application/json'
                }
            });

            clearTimeout(timeoutId);

            const isAvailable = response.ok;
            const duration = performance.now() - startTime;

            if (isAvailable) {
                console.log(`[Feature Detection] ✓ Track API available (${duration.toFixed(0)}ms)`);
                console.log('[Feature Detection] Historical mode enabled');
            } else {
                console.log(`[Feature Detection] ✗ Track API returned ${response.status} (${duration.toFixed(0)}ms)`);
                console.log('[Feature Detection] Historical mode disabled');
            }

            this.cache.historySupport = isAvailable;
            this.cache.lastCheck = Date.now();
            this.cache.checkDuration = duration;

            return isAvailable;

        } catch (error) {
            const duration = performance.now() - startTime;

            if (error.name === 'AbortError') {
                console.log(`[Feature Detection] ✗ Track API timeout after ${duration.toFixed(0)}ms`);
            } else {
                console.log(`[Feature Detection] ✗ Track API unreachable: ${error.message}`);
            }

            console.log('[Feature Detection] Historical mode disabled');

            this.cache.historySupport = false;
            this.cache.lastCheck = Date.now();
            this.cache.checkDuration = duration;

            return false;
        }
    },

    /**
     * Initialize feature detection on app startup
     * @returns {Promise<Object>}
     */
    async initialize() {
        console.log('[Feature Detection] Starting...');

        const features = {
            live: true,  // Always available
            historical: await this.detectHistorySupport()
        };

        console.log('[Feature Detection] Results:', features);
        return features;
    }
};

// ============================================================================
// APPLICATION FEATURE STATE
// ============================================================================
// Global feature state object

export const AppFeatures = {
    live: true,
    historical: false
};

// ============================================================================
// BROWSER NAVIGATION HANDLER
// ============================================================================
// Setup function to attach popstate listener

/**
 * Initialize browser navigation handler
 * @param {Function} applyCallback - Async function to call when browser navigation occurs
 */
export function initializeBrowserNavigation(applyCallback) {
    window.addEventListener('popstate', async (event) => {
        console.log('[URL State] Browser navigation detected');
        if (event.state) {
            await applyCallback();
        }
    });
}

// Expose URLStateManager globally for smoke tests
window.URLStateManager = {
    URLState,
    FeatureDetector,
    AppFeatures,
    initializeBrowserNavigation
};
