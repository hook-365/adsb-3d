/**
 * Configuration and Constants for ADSB 3D Visualization
 * Centralized configuration for easy customization and maintenance
 *
 * @version 1.0.0
 * @license MIT
 */

// ============================================================================
// API ENDPOINTS
// ============================================================================

export const API = {
    // Local data endpoints (served by readsb/ultrafeeder)
    AIRCRAFT_DATA: '/data/aircraft.json',

    // Backend track service endpoints
    HEALTH: '/api/health',
    TRACKS_BULK: '/api/tracks/bulk/timelapse',
    TRACKS_BY_ICAO: '/api/tracks',  // Append /{icao} for specific aircraft

    // External data sources
    MILITARY_DATABASE: 'https://raw.githubusercontent.com/Mictronics/readsb-protobuf/dev/webapp/src/db/aircrafts.json',
    AIRPORTS_CSV: 'https://davidmegginson.github.io/ourairports-data/airports.csv',
    RUNWAYS_CSV: 'https://davidmegginson.github.io/ourairports-data/runways.csv',
    ROUTE_API: 'https://www.adsbdb.com/api/v0/callsign/',  // Append callsign for route data
};

// ============================================================================
// TIMING & INTERVALS
// ============================================================================

export const TIMING = {
    // Update intervals
    LIVE_UPDATE_INTERVAL: 1000,         // 1 second - aircraft data polling
    STATS_UPDATE_INTERVAL: 60000,       // 1 minute - stats reset check
    TRAIL_CLEANUP_INTERVAL: 60000,      // 1 minute - cleanup old trail positions

    // Timeouts
    API_TIMEOUT: 2000,                  // 2 seconds - API health check timeout
    NOTIFICATION_DURATION: 3000,        // 3 seconds - notification display time
    NOTIFICATION_FADE: 300,             // 300ms - notification fade animation
    RECENT_TRAILS_DELAY: 2000,          // 2 seconds - delay before loading recent trails
    PANEL_ANIMATION_DELAY: 150,         // 150ms - panel animation duration

    // Debounce/throttle
    RESIZE_DEBOUNCE: 100,               // 100ms - window resize debounce (will be set in code)
    LONG_PRESS_DURATION: 500,           // 500ms - long press detection (will be set in code)
    FOLLOW_CLICK_TIMEOUT: 300,          // 300ms - follow mode click timeout (will be set in code)
};

// ============================================================================
// CACHE DURATIONS
// ============================================================================

export const CACHE = {
    MILITARY_DATABASE: 24 * 60 * 60 * 1000,    // 24 hours
    ROUTE_DATA: 7 * 24 * 60 * 60 * 1000,       // 7 days
    ROUTE_CACHE_VERSION: 1,                     // Increment to invalidate old caches
};

// ============================================================================
// STORAGE KEYS
// ============================================================================

export const STORAGE_KEYS = {
    THEME: 'selectedTheme',
    MILITARY_DB: 'militaryAircraftDatabase',
    MILITARY_DB_VERSION: 'militaryAircraftDatabaseVersion',
    ROUTE_CACHE: 'adsbdb_route_cache',
    SIDEBAR_LOCKED: 'sidebarLocked',
    STATS_DATE: 'statsDate',
    STATS_DATA: 'stats',
};

// ============================================================================
// SCENE CONFIGURATION
// ============================================================================

export const SCENE = {
    // Scale and exaggeration
    SCALE: 0.001,                       // Scale for converting meters to scene units
    ALTITUDE_EXAGGERATION: 4.5,         // Multiply altitude by this factor for visibility

    // Camera
    CAMERA_FOV: 60,                     // Field of view in degrees
    CAMERA_NEAR: 0.1,                   // Near clipping plane
    CAMERA_FAR: 1000000,                // Far clipping plane
    INITIAL_CAMERA_HEIGHT: 30000,       // Initial camera height in meters (will be calculated)

    // Rendering
    TARGET_FPS: 30,                     // Target frame rate (can be adjusted)
    MAX_RENDER_DISTANCE: 500000,        // Maximum render distance in meters (500km)

    // Fog and atmosphere
    FOG_NEAR: 0.1,                      // Fog near distance (relative)
    FOG_FAR: 1000000,                   // Fog far distance
};

// ============================================================================
// MAP & TILES
// ============================================================================

export const MAP = {
    // Tile configuration
    ZOOM_LEVEL: 8,                      // OSM zoom level (7-12, lower = wider area)
    TILE_GRID_SIZE: 21,                 // NxN grid of tiles (21x21 = ~1000km+ coverage)
    TILE_SIZE: 256,                     // Standard tile size in pixels

    // Tile providers
    PROVIDERS: {
        CARTO_DARK: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        CARTO_LIGHT: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        OSM: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        ESRI_SATELLITE: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        STAMEN_TERRAIN: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png',
    },

    // Default provider
    DEFAULT_PROVIDER: 'dark',           // 'dark', 'osm', 'satellite', 'terrain'
};

// ============================================================================
// DISTANCE RINGS
// ============================================================================

export const DISTANCE_RINGS = {
    ENABLED: true,
    INTERVALS_KM: [92.6, 185.2, 277.8], // 50, 100, 150 nautical miles in km
    LABELS: ['50 nmi', '100 nmi', '150 nmi'],
    LINE_WIDTH: 2,
    OPACITY: 0.5,
};

// ============================================================================
// AIRPORTS & RUNWAYS
// ============================================================================

export const AIRPORTS = {
    ENABLED: true,
    SHOW_RUNWAYS: true,
    MAX_DISTANCE_KM: 200,               // Load airports within this radius
    MIN_TYPE: 'medium_airport',         // 'large_airport', 'medium_airport', 'small_airport', or 'all'
    MARKER_SIZE: 5,                     // Airport marker size
    LABEL_OFFSET: 10,                   // Label offset from marker
};

// ============================================================================
// AIRCRAFT DISPLAY
// ============================================================================

export const AIRCRAFT = {
    // Display settings
    HIGHLIGHT_MILITARY: true,
    MIN_ALTITUDE_DISPLAY: -1000,        // Show aircraft on ground
    MAX_ALTITUDE_DISPLAY: 50000,        // Maximum altitude to display (~FL500)

    // Sprite/model settings
    SPRITE_SIZE: 32,                    // Aircraft sprite size in pixels
    MODEL_SCALE: 1.0,                   // 3D model scale factor

    // Label settings
    LABEL_UPDATE_THROTTLE: 100,         // Milliseconds between label updates
    LABEL_MAX_DISTANCE: 500,            // Maximum distance to show labels (km)

    // Selection
    SELECTION_HIGHLIGHT_COLOR: 0xffff00, // Yellow highlight for selected aircraft
    SELECTION_SCALE: 1.5,               // Scale multiplier for selected aircraft
};

// ============================================================================
// TRAILS
// ============================================================================

export const TRAILS = {
    // Trail geometry
    MAX_POINTS: 1000,                   // Maximum points per trail
    MIN_DISTANCE_BETWEEN_POINTS: 50,    // Meters - minimum distance to add new point
    TUBE_RADIUS: 50,                    // Trail tube radius in meters
    TUBE_SEGMENTS: 8,                   // Number of segments in tube cross-section

    // Trail appearance
    GRADIENT_STEPS: 10,                 // Number of color gradient steps
    OPACITY: 0.8,                       // Trail opacity

    // Tron mode (vertical curtains)
    TRON_HEIGHT: 3000,                  // Height of tron curtains in meters
    TRON_OPACITY: 0.3,                  // Tron curtain opacity

    // Trail management
    DEFAULT_FADE_TIME: 300,             // Default fade time in seconds (5 minutes)
    AUTO_FADE: true,                    // Enable auto-fading by default
    CLEANUP_AGE: 3600,                  // Remove trail positions older than 1 hour

    // Stale aircraft
    STALE_TIMEOUT: 60000,               // 1 minute - consider aircraft stale after this time
};

// ============================================================================
// HISTORICAL MODE
// ============================================================================

export const HISTORICAL = {
    // Data loading
    DEFAULT_HOURS_AGO: 24,              // Default time range to load
    MAX_TRACKS: 200,                    // Maximum number of tracks to load
    RESOLUTION: 'full',                 // 'full' or 'simplified'

    // Heat map
    HEATMAP_GRID_SIZE: 100,             // Grid size for heat map cells
    HEATMAP_MIN_DENSITY: 1,             // Minimum density to show cell
    HEATMAP_OPACITY: 0.6,               // Heat map opacity
    HEATMAP_HEIGHT: 100,                // Height of heat map cells

    // Corridors
    CORRIDOR_TUBE_RADIUS: 200,          // Corridor tube radius in meters
    CORRIDOR_OPACITY: 0.4,              // Corridor opacity
    CORRIDOR_MIN_DENSITY: 5,            // Minimum flights to create corridor

    // Playback
    DEFAULT_PLAYBACK_SPEED: 1,          // 1x real-time
    PLAYBACK_SPEEDS: [1, 2, 5, 10, 50], // Available playback speeds
    ANIMATION_FPS: 30,                  // Target FPS for playback animation
};

// ============================================================================
// ALTITUDE SMOOTHING
// ============================================================================

export const ALTITUDE_SMOOTHING = {
    ENABLED: true,
    MIN_ALTITUDE_FILTER: 500,           // Filter altitudes below this (feet)
    HIGH_ALTITUDE_THRESHOLD: 10000,     // Consider "high altitude" above this (feet)
    MIN_GOOD_ALTITUDE: 1000,            // Minimum good altitude reading (feet)
    OUTLIER_THRESHOLD: 2000,            // Altitude change threshold for outlier detection (feet)
};

// ============================================================================
// SIGNAL QUALITY
// ============================================================================

export const SIGNAL_QUALITY = {
    MIN_RSSI: -50,                      // Minimum expected RSSI (dBm)
    MAX_RSSI: 0,                        // Maximum expected RSSI (dBm)
    MIN_OPACITY: 0.3,                   // Minimum aircraft opacity (poor signal)
    MAX_OPACITY: 1.0,                   // Maximum aircraft opacity (excellent signal)
};

// ============================================================================
// RATE LIMITING
// ============================================================================

export const RATE_LIMIT = {
    API_MIN_INTERVAL: 1000,             // Minimum 1 second between API calls
    ROUTE_API_MIN_INTERVAL: 1000,       // Minimum 1 second between route API calls
};

// ============================================================================
// PERFORMANCE
// ============================================================================

export const PERFORMANCE = {
    // Memory management
    MAX_CACHED_ROUTES: 1000,            // Maximum routes to keep in cache
    MAX_TRAIL_HISTORY: 10000,           // Maximum trail position history per aircraft
    GEOMETRY_DISPOSAL_BATCH: 100,       // Dispose geometries in batches

    // Rendering optimization
    FRUSTUM_CULLING: true,              // Enable frustum culling
    LOD_ENABLED: false,                 // Level of detail (not yet implemented)
    SHADOWS_ENABLED: false,             // Disable shadows for performance
};

// ============================================================================
// CONVERSION FACTORS
// ============================================================================

export const CONVERSIONS = {
    FEET_TO_METERS: 0.3048,
    METERS_TO_FEET: 3.28084,
    NM_TO_KM: 1.852,
    KM_TO_NM: 0.539957,
    KNOTS_TO_KMH: 1.852,
    KMH_TO_KNOTS: 0.539957,
};

// ============================================================================
// MAIN CONFIG (Combines above with runtime values)
// ============================================================================

/**
 * Main configuration object (kept for backward compatibility)
 * This will be populated from environment variables and the above constants
 */
export const CONFIG = {
    // Home location loaded from environment variables
    homeLocation: window.ENV_CONFIG?.homeLocation || { lat: 45.0000, lon: -90.0000, alt: 1234 },

    // Copy values from above constants for easy access
    updateInterval: TIMING.LIVE_UPDATE_INTERVAL,
    viewDistance: 200, // km
    scale: SCENE.SCALE,
    altitudeExaggeration: SCENE.ALTITUDE_EXAGGERATION,
    mapTileProvider: MAP.DEFAULT_PROVIDER,
    showDistanceRings: DISTANCE_RINGS.ENABLED,
    distanceRingIntervals: DISTANCE_RINGS.INTERVALS_KM,
    distanceRingLabels: DISTANCE_RINGS.LABELS,
    mapZoomLevel: MAP.ZOOM_LEVEL,
    mapTileGridSize: MAP.TILE_GRID_SIZE,
    showAirports: AIRPORTS.ENABLED,
    showRunways: AIRPORTS.SHOW_RUNWAYS,
    airportMaxDistance: AIRPORTS.MAX_DISTANCE_KM,
    airportMinType: AIRPORTS.MIN_TYPE,
    highlightMilitary: AIRCRAFT.HIGHLIGHT_MILITARY,

    // Theme colors - these will be loaded from CSS variables at runtime
    // (defined as getters in original code)
    militaryColor: null,
    compassNorth: null,
    sceneFog: null,
    sceneAmbient: null,
    sceneSun: null,
    sceneGround: null,
    runwayColor: null,
    towerBase: null,
    towerLight: null,
    homeMarker: null,
    trailGround: null,
    trailSelected: null,
    distanceRing1: null,
    distanceRing2: null,
    gridCenter: null,
    gridLines: null,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get CSS variable value from :root
 * @param {string} varName - CSS variable name (with or without --)
 * @returns {string} The CSS variable value
 */
export function getCSSVar(varName) {
    const name = varName.startsWith('--') ? varName : `--${varName}`;
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Convert CSS hex color to Three.js hex number
 * @param {string} cssColor - CSS color (hex format like #4a9eff)
 * @returns {number} Three.js color number (like 0x4a9eff)
 */
export function cssToThreeColor(cssColor) {
    return parseInt(cssColor.replace('#', ''), 16);
}

/**
 * Get theme color for Three.js from CSS variable
 * @param {string} varName - CSS variable name (e.g., 'military-color' or '--military-color')
 * @returns {number} Three.js hex color
 */
export function getThemeColor(varName) {
    const cssValue = getCSSVar(varName);
    return cssToThreeColor(cssValue);
}

/**
 * Initialize CONFIG theme colors from CSS variables
 * Call this after the page loads and CSS is applied
 */
export function initializeThemeColors() {
    CONFIG.militaryColor = getThemeColor('military-color');
    CONFIG.compassNorth = getThemeColor('compass-north');
    CONFIG.sceneFog = getThemeColor('scene-fog');
    CONFIG.sceneAmbient = getThemeColor('scene-ambient');
    CONFIG.sceneSun = getThemeColor('scene-sun');
    CONFIG.sceneGround = getThemeColor('scene-ground');
    CONFIG.runwayColor = getThemeColor('runway-color');
    CONFIG.towerBase = getThemeColor('tower-base');
    CONFIG.towerLight = getThemeColor('tower-light');
    CONFIG.homeMarker = getThemeColor('home-marker');
    CONFIG.trailGround = getThemeColor('trail-ground');
    CONFIG.trailSelected = getThemeColor('trail-selected');
    CONFIG.distanceRing1 = getThemeColor('distance-ring-1');
    CONFIG.distanceRing2 = getThemeColor('distance-ring-2');
    CONFIG.gridCenter = getThemeColor('grid-center');
    CONFIG.gridLines = getThemeColor('grid-lines');
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    API,
    TIMING,
    CACHE,
    STORAGE_KEYS,
    SCENE,
    MAP,
    DISTANCE_RINGS,
    AIRPORTS,
    AIRCRAFT,
    TRAILS,
    HISTORICAL,
    ALTITUDE_SMOOTHING,
    SIGNAL_QUALITY,
    RATE_LIMIT,
    PERFORMANCE,
    CONVERSIONS,
    CONFIG,
    getCSSVar,
    cssToThreeColor,
    getThemeColor,
    initializeThemeColors,
};
