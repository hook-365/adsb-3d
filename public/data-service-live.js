// ============================================================================
// LIVE DATA SERVICE MODULE
// ============================================================================
// Manages live aircraft data fetching from ADS-B feeder

// Import dependencies
import { API, TIMING } from './constants.js';

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let liveUpdateInterval = null;
let fetchErrorCount = 0;
const MAX_FETCH_ERRORS = 5;

// Live radar data (always stores latest data even in historical mode)
let liveRadarData = [];

// ============================================================================
// LIVE DATA FETCHING
// ============================================================================

/**
 * Fetch aircraft data from Ultrafeeder
 * @param {Object} deps - Dependencies from app.js
 * @param {string} deps.currentMode - Current mode ('live' or 'historical')
 * @param {Function} deps.updateAircraft - Function to update aircraft in 3D scene
 * @param {Function} deps.updateUI - Function to update UI with stats
 * @returns {Promise<void>}
 */
export async function fetchAircraftData(deps) {
    const { currentMode, updateAircraft, updateUI } = deps;

    try {
        // Use BASE_PATH from config.js, default to '' if not defined
        const basePath = window.ADSB_CONFIG?.BASE_PATH || '';
        const response = await fetch(`${basePath}${API.AIRCRAFT_DATA}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Validate data structure
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid data format received');
        }

        // Reset error count on successful fetch
        fetchErrorCount = 0;

        // Always store live data for radar (even in historical mode)
        liveRadarData = data.aircraft || [];

        // Only update 3D scene if in live mode
        if (currentMode === 'live') {
            updateAircraft(data.aircraft || []);
            updateUI(data);
        }
    } catch (error) {
        fetchErrorCount++;
        console.error(`Error fetching aircraft data (${fetchErrorCount}/${MAX_FETCH_ERRORS}):`, error);

        // Show error in UI if repeated failures
        if (fetchErrorCount >= MAX_FETCH_ERRORS) {
            const infoDiv = document.getElementById('aircraft-count');
            const headerDiv = document.getElementById('aircraft-count-header');
            if (infoDiv) {
                infoDiv.textContent = 'Connection Error';
                infoDiv.style.color = '#ff4444';
            }
            if (headerDiv) {
                headerDiv.textContent = '(Error)';
                headerDiv.style.color = '#ff4444';
            }
        }
    }
}

/**
 * Start live updates
 * @param {Object} deps - Dependencies from app.js
 * @returns {void}
 */
export function startLiveUpdates(deps) {
    if (!liveUpdateInterval) {
        fetchAircraftData(deps);
        liveUpdateInterval = setInterval(() => fetchAircraftData(deps), TIMING.LIVE_UPDATE_INTERVAL);
        console.log('[LiveData] Started polling', TIMING.LIVE_UPDATE_INTERVAL, 'ms');
    }
}

/**
 * Stop live updates
 * @returns {void}
 */
export function stopLiveUpdates() {
    if (liveUpdateInterval) {
        clearInterval(liveUpdateInterval);
        liveUpdateInterval = null;
        console.log('[LiveData] Stopped polling');
    }
}

/**
 * Get current live radar data
 * @returns {Array<Object>} Array of aircraft objects
 */
export function getLiveRadarData() {
    return liveRadarData;
}

/**
 * Reset fetch error counter
 * @returns {void}
 */
export function resetFetchErrors() {
    fetchErrorCount = 0;
}

/**
 * Get current fetch error count
 * @returns {number} Error count
 */
export function getFetchErrorCount() {
    return fetchErrorCount;
}
