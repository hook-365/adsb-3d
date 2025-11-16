/**
 * adsb-3d
 * Real-time 3D visualization of ADS-B aircraft data using Three.js
 *
 * @version 1.1.0
 * @author hook-365
 * @license MIT
 *
 * Features:
 * - Real-time aircraft tracking with altitude-based color coding
 * - Flight path trails with gradient colors
 * - Military aircraft detection (16,896+ verified aircraft from tar1090-db)
 * - Airport and runway overlays from OurAirports data
 * - Interactive aircraft selection and detail views
 * - Day/night sky cycle based on local time
 * - Mobile-responsive with collapseable panels
 * - Touch controls (pinch to zoom, drag to rotate)
 * - Keyboard shortcuts for common actions
 *
 * Data Sources:
 * - Aircraft data: Ultrafeeder (readsb) via /data/aircraft.json
 * - Airport/runway data: OurAirports.com open dataset
 * - Flight routes: adsbdb.com public API (typical routes, not real-time)
 * - Map tiles: CartoDB Dark Matter (default), OSM, Esri, Stamen
 *
 * Configuration:
 * - Home location set via environment variables (see entrypoint.sh)
 * - All visual/display settings configurable via CONFIG object below
 * - BASE_PATH auto-detected from URL for subdirectory deployment
 */

// ============================================================================
// THEME SYSTEM - CSS Variable Bridge
// ============================================================================
// Converts CSS custom properties to Three.js-compatible hex colors

/**
 * Get CSS variable value from :root
 * @param {string} varName - CSS variable name (with or without --)
 * @returns {string} The CSS variable value
 */
function getCSSVar(varName) {
    const name = varName.startsWith('--') ? varName : `--${varName}`;
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Convert CSS hex color to Three.js hex number
 * @param {string} cssColor - CSS color (hex format like #4a9eff)
 * @returns {number} Three.js color number (like 0x4a9eff)
 */
function cssToThreeColor(cssColor) {
    // Remove # and convert to hex number
    return parseInt(cssColor.replace('#', ''), 16);
}

/**
 * Get theme color for Three.js from CSS variable
 * @param {string} varName - CSS variable name (e.g., 'military-color' or '--military-color')
 * @returns {number} Three.js hex color
 */
function getThemeColor(varName) {
    const cssValue = getCSSVar(varName);
    return cssToThreeColor(cssValue);
}

// Configuration
const CONFIG = {
    // Home location loaded from environment variables (see config.js generated at container startup)
    homeLocation: window.ENV_CONFIG?.homeLocation || { lat: 45.0000, lon: -90.0000, alt: 1234 },
    updateInterval: 1000, // Update every 1 second
    viewDistance: 200, // km
    scale: 0.001, // Scale for converting meters to scene units
    altitudeExaggeration: 4.5, // Multiply altitude by this factor for visibility (4.5x real scale)
    mapTileProvider: 'dark', // 'dark' (CartoDB Dark), 'osm' (OpenStreetMap), 'satellite' (Esri), or 'terrain' (Stamen)
    showDistanceRings: true,
    distanceRingIntervals: [92.6, 185.2, 277.8], // 50, 100, 150 nautical miles in km
    distanceRingLabels: ['50 nmi', '100 nmi', '150 nmi'], // Labels for distance rings
    mapZoomLevel: 8, // OSM zoom level for ground texture (7-12, lower = wider area)
    mapTileGridSize: 13, // Load NxN grid of tiles (13x13 = ~600km for large-area feeders)
    showAirports: true, // Show airport markers
    showRunways: true, // Show runway overlays
    airportMaxDistance: 200, // km - load airports within this radius
    airportMinType: 'medium_airport', // 'large_airport', 'medium_airport', 'small_airport', or 'all'
    highlightMilitary: true, // Highlight military aircraft with different color

    // Theme colors - loaded from CSS variables
    get militaryColor() { return getThemeColor('military-color'); },
    get compassNorth() { return getThemeColor('compass-north'); },
    get sceneFog() { return getThemeColor('scene-fog'); },
    get sceneAmbient() { return getThemeColor('scene-ambient'); },
    get sceneSun() { return getThemeColor('scene-sun'); },
    get sceneGround() { return getThemeColor('scene-ground'); },
    get runwayColor() { return getThemeColor('runway-color'); },
    get towerBase() { return getThemeColor('tower-base'); },
    get towerLight() { return getThemeColor('tower-light'); },
    get homeMarker() { return getThemeColor('home-marker'); },
    get trailGround() { return getThemeColor('trail-ground'); },
    get trailSelected() { return getThemeColor('trail-selected'); },
    get distanceRing1() { return getThemeColor('distance-ring-1'); },
    get distanceRing2() { return getThemeColor('distance-ring-2'); },
    get gridCenter() { return getThemeColor('grid-center'); },
    get gridLines() { return getThemeColor('grid-lines'); }
};

// ============================================================================
// THEME ENGINE
// ============================================================================
// Manages theme presets and dynamic theme switching

const THEMES = {
    modern: {
        name: 'Modern',
        description: 'Clean blue interface with smooth gradients',
        colors: {
            // Accent colors
            'accent-primary': '#4a9eff',
            'accent-primary-dim': 'rgba(74, 158, 255, 0.3)',
            'accent-primary-hover': 'rgba(74, 158, 255, 0.5)',
            'accent-primary-active': 'rgba(74, 158, 255, 0.7)',

            // Panel colors
            'panel-bg': 'rgba(0, 0, 0, 0.85)',
            'panel-bg-solid': 'rgba(0, 0, 0, 0.95)',
            'panel-border': 'rgba(255, 255, 255, 0.1)',

            // Text colors
            'text-primary': '#ffffff',
            'text-secondary': '#aaaaaa',
            'text-accent': '#4a9eff',

            // Status colors (keep standard)
            'status-success': '#4eff9e',
            'status-success-bg': 'rgba(78, 255, 158, 0.1)',
            'status-success-glow': 'rgba(78, 255, 158, 0.6)',
            'status-error': '#ff4a4a',
            'status-error-bg': 'rgba(255, 74, 74, 0.1)',
            'status-warning': '#ffaa4a',
            'status-warning-bg': 'rgba(255, 170, 74, 0.1)',
            'status-offline': '#888888',
            'mode-active': '#00c853',
            'mode-active-border': '#00e676',
            'mode-active-glow': 'rgba(0, 230, 118, 0.5)',
            'mode-inactive-bg': 'rgba(0, 0, 0, 0.7)',
            'mode-inactive-border': 'rgba(74, 158, 255, 0.6)',
            'mode-inactive-hover-bg': 'rgba(0, 0, 0, 0.85)',
            'mode-inactive-hover-border': 'rgba(74, 158, 255, 0.9)',

            // Badges
            'badge-military': '#cc0000',
            'badge-military-text': '#ffffff',
            'badge-mlat': '#d97634',
            'badge-mlat-text': '#ffffff',
            'badge-stat': '#1e5a8e',
            'badge-stat-text': '#ffffff',

            // Buttons
            'button-text': '#ffffff',

            // 3D Scene
            'military-color': '#ff0000',
            'compass-north': '#ff4444',
            'airport-label-bg': 'rgba(100, 100, 100, 0.7)',
            'airport-label-text': '#ffffff',
            'distance-ring-1': '#888888',
            'distance-ring-2': '#aaaaaa',
            'grid-center': '#444444',
            'grid-lines': '#2a2a2a',
            'scene-fog': '#87CEEB',
            'scene-ambient': '#87CEEB',
            'scene-sun': '#ffffee',
            'scene-ground': '#5c7a3c',
            'runway-color': '#ffffff',
            'tower-base': '#eeeeee',
            'tower-light': '#ff0000',
            'home-marker': '#ffffff',
            'trail-ground': '#333333',
            'trail-selected': '#ffffff',

            // Modal
            'modal-text-muted': '#666666',
            'modal-text-strong': '#cccccc',
            'modal-text-note': '#888888',
            'bg-canvas': '#000000'
        },
        styles: {
            'font-family': "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
            'panel-radius': '8px',
            'panel-blur': 'blur(10px)',
            'panel-shadow': '0 4px 16px rgba(0, 0, 0, 0.3)',
            'panel-border-width': '1px',
            'panel-border-style': 'solid',
            'button-radius': '6px',
            'button-shadow': 'none',
            'input-radius': '4px',
            'badge-radius': '4px',
            'font-weight-headers': '600'
        }
    },

    digital: {
        name: 'Digital/CRT',
        description: 'Green terminal aesthetic with sharp edges',
        colors: {
            'accent-primary': '#00bb00',
            'accent-primary-dim': 'rgba(0, 187, 0, 0.2)',
            'accent-primary-hover': 'rgba(0, 187, 0, 0.4)',
            'accent-primary-active': 'rgba(0, 187, 0, 0.6)',

            'panel-bg': 'rgba(0, 20, 0, 0.9)',
            'panel-bg-solid': 'rgba(0, 15, 0, 0.95)',
            'panel-border': 'rgba(0, 187, 0, 0.3)',

            'text-primary': '#00bb00',
            'text-secondary': '#008800',
            'text-accent': '#00bb00',

            'status-success': '#00bb00',
            'status-success-bg': 'rgba(0, 187, 0, 0.1)',
            'status-success-glow': 'rgba(0, 187, 0, 0.5)',
            'status-error': '#dd0000',
            'status-error-bg': 'rgba(221, 0, 0, 0.1)',
            'status-warning': '#dddd00',
            'status-warning-bg': 'rgba(221, 221, 0, 0.1)',
            'status-offline': '#005500',
            'mode-active': '#009900',
            'mode-active-border': '#00bb00',
            'mode-active-glow': 'rgba(0, 187, 0, 0.4)',
            'mode-inactive-bg': 'rgba(0, 40, 0, 0.8)',
            'mode-inactive-border': 'rgba(0, 136, 0, 0.4)',
            'mode-inactive-hover-bg': 'rgba(0, 60, 0, 0.9)',
            'mode-inactive-hover-border': 'rgba(0, 136, 0, 0.6)',

            'badge-military': '#dd0000',
            'badge-military-text': '#000000',
            'badge-mlat': '#dddd00',
            'badge-mlat-text': '#000000',
            'badge-stat': '#00bb00',
            'badge-stat-text': '#000000',

            // Buttons
            'button-text': '#000000',

            'military-color': '#dd0000',
            'compass-north': '#00bb00',
            'airport-label-bg': 'rgba(0, 40, 0, 0.8)',
            'airport-label-text': '#00bb00',
            'distance-ring-1': '#008800',
            'distance-ring-2': '#00bb00',
            'grid-center': '#00bb00',
            'grid-lines': '#003300',
            'scene-fog': '#001100',
            'scene-ambient': '#00bb00',
            'scene-sun': '#00bb00',
            'scene-ground': '#002200',
            'runway-color': '#00bb00',
            'tower-base': '#00bb00',
            'tower-light': '#dd0000',
            'home-marker': '#00bb00',
            'trail-ground': '#004400',
            'trail-selected': '#00ff00',

            'modal-text-muted': '#006600',
            'modal-text-strong': '#00ff00',
            'modal-text-note': '#00aa00',
            'bg-canvas': '#000000'
        },
        styles: {
            'font-family': "'Courier New', 'Consolas', monospace",
            'panel-radius': '0px',
            'panel-blur': 'blur(0px)',
            'panel-shadow': '0 0 20px rgba(0, 187, 0, 0.4)',
            'panel-border-width': '2px',
            'panel-border-style': 'solid',
            'button-radius': '0px',
            'button-shadow': '0 0 10px rgba(0, 187, 0, 0.5)',
            'input-radius': '0px',
            'badge-radius': '0px',
            'font-weight-headers': '700'
        }
    },

    dark: {
        name: 'Dark Mode',
        description: 'Pure black OLED-friendly design',
        colors: {
            'accent-primary': '#ffffff',
            'accent-primary-dim': 'rgba(255, 255, 255, 0.2)',
            'accent-primary-hover': 'rgba(255, 255, 255, 0.4)',
            'accent-primary-active': 'rgba(255, 255, 255, 0.6)',

            'panel-bg': 'rgba(0, 0, 0, 0.95)',
            'panel-bg-solid': '#000000',
            'panel-border': 'rgba(255, 255, 255, 0.1)',

            'text-primary': '#ffffff',
            'text-secondary': '#888888',
            'text-accent': '#ffffff',

            'status-success': '#4eff9e',
            'status-success-bg': 'rgba(78, 255, 158, 0.1)',
            'status-success-glow': 'rgba(78, 255, 158, 0.6)',
            'status-error': '#ff4a4a',
            'status-error-bg': 'rgba(255, 74, 74, 0.1)',
            'status-warning': '#ffaa4a',
            'status-warning-bg': 'rgba(255, 170, 74, 0.1)',
            'status-offline': '#666666',
            'mode-active': '#ffffff',
            'mode-active-border': '#ffffff',
            'mode-active-glow': 'rgba(255, 255, 255, 0.5)',
            'mode-inactive-bg': 'rgba(30, 30, 30, 0.9)',
            'mode-inactive-border': 'rgba(255, 255, 255, 0.3)',
            'mode-inactive-hover-bg': 'rgba(50, 50, 50, 0.95)',
            'mode-inactive-hover-border': 'rgba(255, 255, 255, 0.5)',

            'badge-military': '#ff0000',
            'badge-military-text': '#ffffff',
            'badge-mlat': '#ffaa00',
            'badge-mlat-text': '#000000',
            'badge-stat': '#666666',
            'badge-stat-text': '#ffffff',

            // Buttons
            'button-text': '#ffffff',

            'military-color': '#ff0000',
            'compass-north': '#ffffff',
            'airport-label-bg': 'rgba(30, 30, 30, 0.9)',
            'airport-label-text': '#ffffff',
            'distance-ring-1': '#444444',
            'distance-ring-2': '#666666',
            'grid-center': '#333333',
            'grid-lines': '#1a1a1a',
            'scene-fog': '#000000',
            'scene-ambient': '#666666',
            'scene-sun': '#ffffff',
            'scene-ground': '#1a1a1a',
            'runway-color': '#ffffff',
            'tower-base': '#cccccc',
            'tower-light': '#ff0000',
            'home-marker': '#ffffff',
            'trail-ground': '#222222',
            'trail-selected': '#ffffff',

            'modal-text-muted': '#666666',
            'modal-text-strong': '#cccccc',
            'modal-text-note': '#888888',
            'bg-canvas': '#000000'
        },
        styles: {
            'font-family': "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
            'panel-radius': '4px',
            'panel-blur': 'blur(0px)',
            'panel-shadow': '0 8px 24px rgba(0, 0, 0, 0.8)',
            'panel-border-width': '1px',
            'panel-border-style': 'solid',
            'button-radius': '4px',
            'button-shadow': 'none',
            'input-radius': '2px',
            'badge-radius': '2px',
            'font-weight-headers': '500'
        }
    },

    arctic: {
        name: 'Arctic',
        description: 'Cool crisp blues and icy whites',
        colors: {
            'accent-primary': '#00d4ff',
            'accent-primary-dim': 'rgba(0, 212, 255, 0.3)',
            'accent-primary-hover': 'rgba(0, 212, 255, 0.5)',
            'accent-primary-active': 'rgba(0, 212, 255, 0.7)',

            'panel-bg': 'rgba(10, 20, 30, 0.85)',
            'panel-bg-solid': 'rgba(5, 15, 25, 0.95)',
            'panel-border': 'rgba(0, 212, 255, 0.3)',

            'text-primary': '#e0f7ff',
            'text-secondary': '#88c9e0',
            'text-accent': '#00d4ff',

            'status-success': '#00ff88',
            'status-success-bg': 'rgba(0, 255, 136, 0.1)',
            'status-success-glow': 'rgba(0, 255, 136, 0.6)',
            'status-error': '#ff4466',
            'status-error-bg': 'rgba(255, 68, 102, 0.1)',
            'status-warning': '#ffcc00',
            'status-warning-bg': 'rgba(255, 204, 0, 0.1)',
            'status-offline': '#5588aa',
            'mode-active': '#00d4ff',
            'mode-active-border': '#00ffff',
            'mode-active-glow': 'rgba(0, 212, 255, 0.5)',
            'mode-inactive-bg': 'rgba(10, 30, 50, 0.8)',
            'mode-inactive-border': 'rgba(100, 180, 220, 0.5)',
            'mode-inactive-hover-bg': 'rgba(20, 40, 60, 0.9)',
            'mode-inactive-hover-border': 'rgba(120, 200, 240, 0.7)',

            'badge-military': '#ff4466',
            'badge-military-text': '#ffffff',
            'badge-mlat': '#ffcc00',
            'badge-mlat-text': '#000000',
            'badge-stat': '#0088bb',
            'badge-stat-text': '#ffffff',

            // Buttons
            'button-text': '#ffffff',

            'military-color': '#ff4466',
            'compass-north': '#00ffff',
            'airport-label-bg': 'rgba(10, 30, 50, 0.8)',
            'airport-label-text': '#e0f7ff',
            'distance-ring-1': '#4488bb',
            'distance-ring-2': '#6699cc',
            'grid-center': '#3377aa',
            'grid-lines': '#1a3344',
            'scene-fog': '#b0e0ff',
            'scene-ambient': '#87ceeb',
            'scene-sun': '#ffffee',
            'scene-ground': '#2a3f4f',
            'runway-color': '#e0f7ff',
            'tower-base': '#aaddff',
            'tower-light': '#ff4466',
            'home-marker': '#00d4ff',
            'trail-ground': '#2a4f5f',
            'trail-selected': '#00ffff',

            'modal-text-muted': '#5588aa',
            'modal-text-strong': '#e0f7ff',
            'modal-text-note': '#88c9e0',
            'bg-canvas': '#000000'
        },
        styles: {
            'font-family': "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
            'panel-radius': '12px',
            'panel-blur': 'blur(15px)',
            'panel-shadow': '0 4px 20px rgba(100, 200, 255, 0.3)',
            'panel-border-width': '1px',
            'panel-border-style': 'solid',
            'button-radius': '10px',
            'button-shadow': '0 2px 8px rgba(0, 212, 255, 0.3)',
            'input-radius': '8px',
            'badge-radius': '12px',
            'font-weight-headers': '500'
        }
    },

    sunset: {
        name: 'Sunset',
        description: 'Warm oranges and purples of golden hour',
        colors: {
            'accent-primary': '#ff6b35',
            'accent-primary-dim': 'rgba(255, 107, 53, 0.3)',
            'accent-primary-hover': 'rgba(255, 107, 53, 0.5)',
            'accent-primary-active': 'rgba(255, 107, 53, 0.7)',

            'panel-bg': 'rgba(30, 15, 25, 0.85)',
            'panel-bg-solid': 'rgba(20, 10, 20, 0.95)',
            'panel-border': 'rgba(255, 107, 53, 0.3)',

            'text-primary': '#ffe8dd',
            'text-secondary': '#cc9988',
            'text-accent': '#ff6b35',

            'status-success': '#88ff66',
            'status-success-bg': 'rgba(136, 255, 102, 0.1)',
            'status-success-glow': 'rgba(136, 255, 102, 0.6)',
            'status-error': '#ff3366',
            'status-error-bg': 'rgba(255, 51, 102, 0.1)',
            'status-warning': '#ffaa00',
            'status-warning-bg': 'rgba(255, 170, 0, 0.1)',
            'status-offline': '#886655',
            'mode-active': '#ff6b35',
            'mode-active-border': '#ff8844',
            'mode-active-glow': 'rgba(255, 107, 53, 0.5)',
            'mode-inactive-bg': 'rgba(40, 20, 30, 0.8)',
            'mode-inactive-border': 'rgba(255, 140, 100, 0.4)',
            'mode-inactive-hover-bg': 'rgba(60, 30, 40, 0.9)',
            'mode-inactive-hover-border': 'rgba(255, 160, 120, 0.6)',

            'badge-military': '#ff3366',
            'badge-military-text': '#ffffff',
            'badge-mlat': '#ffaa00',
            'badge-mlat-text': '#000000',
            'badge-stat': '#8844aa',
            'badge-stat-text': '#ffffff',

            // Buttons
            'button-text': '#ffffff',

            'military-color': '#ff3366',
            'compass-north': '#ff6b35',
            'airport-label-bg': 'rgba(40, 20, 30, 0.8)',
            'airport-label-text': '#ffe8dd',
            'distance-ring-1': '#aa5577',
            'distance-ring-2': '#cc7788',
            'grid-center': '#884466',
            'grid-lines': '#442233',
            'scene-fog': '#ff9966',
            'scene-ambient': '#ff8844',
            'scene-sun': '#ffcc66',
            'scene-ground': '#4a2f3f',
            'runway-color': '#ffccaa',
            'tower-base': '#ddaa99',
            'tower-light': '#ff3366',
            'home-marker': '#ff6b35',
            'trail-ground': '#5a3f4f',
            'trail-selected': '#ff8844',

            'modal-text-muted': '#886655',
            'modal-text-strong': '#ffe8dd',
            'modal-text-note': '#cc9988',
            'bg-canvas': '#000000'
        },
        styles: {
            'font-family': "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
            'panel-radius': '10px',
            'panel-blur': 'blur(10px)',
            'panel-shadow': '0 6px 20px rgba(255, 140, 0, 0.25)',
            'panel-border-width': '1px',
            'panel-border-style': 'solid',
            'button-radius': '8px',
            'button-shadow': '0 4px 12px rgba(255, 107, 53, 0.3)',
            'input-radius': '6px',
            'badge-radius': '6px',
            'font-weight-headers': '600'
        }
    },

    neon: {
        name: 'Neon',
        description: 'Vibrant synthwave pink and purple',
        colors: {
            'accent-primary': '#ff1493',
            'accent-primary-dim': 'rgba(255, 20, 147, 0.3)',
            'accent-primary-hover': 'rgba(255, 20, 147, 0.5)',
            'accent-primary-active': 'rgba(255, 20, 147, 0.7)',

            'panel-bg': 'rgba(20, 0, 30, 0.85)',
            'panel-bg-solid': 'rgba(15, 0, 25, 0.95)',
            'panel-border': 'rgba(255, 20, 147, 0.4)',

            'text-primary': '#ff69f5',
            'text-secondary': '#cc66dd',
            'text-accent': '#ff1493',

            'status-success': '#00ffaa',
            'status-success-bg': 'rgba(0, 255, 170, 0.1)',
            'status-success-glow': 'rgba(0, 255, 170, 0.6)',
            'status-error': '#ff0066',
            'status-error-bg': 'rgba(255, 0, 102, 0.1)',
            'status-warning': '#ffff00',
            'status-warning-bg': 'rgba(255, 255, 0, 0.1)',
            'status-offline': '#884488',
            'mode-active': '#ff1493',
            'mode-active-border': '#ff00ff',
            'mode-active-glow': 'rgba(255, 20, 147, 0.5)',
            'mode-inactive-bg': 'rgba(40, 0, 60, 0.8)',
            'mode-inactive-border': 'rgba(170, 68, 204, 0.5)',
            'mode-inactive-hover-bg': 'rgba(60, 0, 80, 0.9)',
            'mode-inactive-hover-border': 'rgba(200, 85, 221, 0.7)',

            'badge-military': '#ff0066',
            'badge-military-text': '#ffffff',
            'badge-mlat': '#ffff00',
            'badge-mlat-text': '#000000',
            'badge-stat': '#8800ff',
            'badge-stat-text': '#ffffff',

            // Buttons
            'button-text': '#ffffff',

            'military-color': '#ff0066',
            'compass-north': '#ff00ff',
            'airport-label-bg': 'rgba(40, 0, 60, 0.8)',
            'airport-label-text': '#ff69f5',
            'distance-ring-1': '#aa44cc',
            'distance-ring-2': '#cc55dd',
            'grid-center': '#8800cc',
            'grid-lines': '#440066',
            'scene-fog': '#330044',
            'scene-ambient': '#aa00ff',
            'scene-sun': '#ff00ff',
            'scene-ground': '#220033',
            'runway-color': '#ff69f5',
            'tower-base': '#cc66dd',
            'tower-light': '#ff0066',
            'home-marker': '#ff1493',
            'trail-ground': '#440055',
            'trail-selected': '#ff00ff',

            'modal-text-muted': '#884488',
            'modal-text-strong': '#ff69f5',
            'modal-text-note': '#cc66dd',
            'bg-canvas': '#000000'
        },
        styles: {
            'font-family': "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
            'panel-radius': '2px',
            'panel-blur': 'blur(6px)',
            'panel-shadow': '0 0 20px rgba(255, 20, 147, 0.6), 0 0 40px rgba(0, 255, 255, 0.4)',
            'panel-border-width': '2px',
            'panel-border-style': 'solid',
            'button-radius': '2px',
            'button-shadow': '0 0 15px rgba(255, 20, 147, 0.8)',
            'input-radius': '2px',
            'badge-radius': '2px',
            'font-weight-headers': '700'
        }
    },

    vintage: {
        name: 'Vintage',
        description: 'Warm amber retro radar display',
        colors: {
            'accent-primary': '#ffb000',
            'accent-primary-dim': 'rgba(255, 176, 0, 0.3)',
            'accent-primary-hover': 'rgba(255, 176, 0, 0.5)',
            'accent-primary-active': 'rgba(255, 176, 0, 0.7)',

            'panel-bg': 'rgba(40, 30, 20, 0.85)',
            'panel-bg-solid': 'rgba(30, 22, 15, 0.95)',
            'panel-border': 'rgba(255, 176, 0, 0.4)',

            'text-primary': '#ffb000',
            'text-secondary': '#cc8800',
            'text-accent': '#ffb000',

            'status-success': '#90ee90',
            'status-success-bg': 'rgba(144, 238, 144, 0.1)',
            'status-success-glow': 'rgba(144, 238, 144, 0.6)',
            'status-error': '#ff6347',
            'status-error-bg': 'rgba(255, 99, 71, 0.1)',
            'status-warning': '#ffd700',
            'status-warning-bg': 'rgba(255, 215, 0, 0.1)',
            'status-offline': '#8b7355',
            'mode-active': '#cc8800',
            'mode-active-border': '#ddaa00',
            'mode-active-glow': 'rgba(204, 136, 0, 0.4)',
            'mode-inactive-bg': 'rgba(50, 40, 30, 0.8)',
            'mode-inactive-border': 'rgba(139, 115, 85, 0.5)',
            'mode-inactive-hover-bg': 'rgba(70, 55, 40, 0.9)',
            'mode-inactive-hover-border': 'rgba(160, 130, 95, 0.7)',

            'badge-military': '#cd853f',
            'badge-military-text': '#000000',
            'badge-mlat': '#daa520',
            'badge-mlat-text': '#000000',
            'badge-stat': '#8b7355',
            'badge-stat-text': '#ffb000',

            // Buttons
            'button-text': '#000000',

            'military-color': '#cd853f',
            'compass-north': '#ffb000',
            'airport-label-bg': 'rgba(50, 40, 30, 0.8)',
            'airport-label-text': '#ffb000',
            'distance-ring-1': '#8b7355',
            'distance-ring-2': '#a0826d',
            'grid-center': '#8b7355',
            'grid-lines': '#4a3f35',
            'scene-fog': '#3a2f25',
            'scene-ambient': '#d2691e',
            'scene-sun': '#ffd700',
            'scene-ground': '#4a3f2f',
            'runway-color': '#ffb000',
            'tower-base': '#cc8800',
            'tower-light': '#ff6347',
            'home-marker': '#ffb000',
            'trail-ground': '#5a4f3f',
            'trail-selected': '#ffb000',

            'modal-text-muted': '#8b7355',
            'modal-text-strong': '#ffb000',
            'modal-text-note': '#cc8800',
            'bg-canvas': '#000000'
        },
        styles: {
            'font-family': "'Courier New', monospace",
            'panel-radius': '6px',
            'panel-blur': 'blur(2px)',
            'panel-shadow': 'inset 0 2px 4px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.6)',
            'panel-border-width': '3px',
            'panel-border-style': 'ridge',
            'button-radius': '4px',
            'button-shadow': 'inset 0 1px 2px rgba(255, 176, 0, 0.3)',
            'input-radius': '3px',
            'badge-radius': '3px',
            'font-weight-headers': '700'
        }
    }
};

// ============================================================================
// UNIFIED SIDEBAR SYSTEM
// ============================================================================

/**
 * Sidebar state management
 */
const SidebarState = {
    isCollapsed: false,
    width: 320,
    currentMode: 'live', // 'live' or 'historical'
    footerVisible: true,

    // Load from localStorage
    load() {
        const saved = localStorage.getItem('sidebarState');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.isCollapsed = data.isCollapsed || false;
                this.width = data.width || 320;
                this.footerVisible = data.footerVisible !== undefined ? data.footerVisible : true;
            } catch (e) {
                console.error('Failed to load sidebar state:', e);
            }
        }
    },

    // Save to localStorage
    save() {
        localStorage.setItem('sidebarState', JSON.stringify({
            isCollapsed: this.isCollapsed,
            width: this.width,
            footerVisible: this.footerVisible
        }));
    }
};

/**
 * Initialize sidebar functionality
 */
function initSidebar() {
    console.log('[Sidebar] Initializing unified sidebar');

    // Load saved state
    SidebarState.load();

    const sidebar = document.getElementById('unified-sidebar');
    if (!sidebar) {
        console.error('[Sidebar] Sidebar element not found');
        return;
    }

    // Apply saved width
    sidebar.style.width = `${SidebarState.width}px`;

    // Apply saved collapsed state
    if (SidebarState.isCollapsed) {
        sidebar.classList.add('collapsed');
    }

    // Apply saved footer state
    const footerContent = document.getElementById('sidebar-footer-content');
    if (footerContent && !SidebarState.footerVisible) {
        footerContent.classList.add('collapsed');
    }

    // Setup event listeners
    setupSidebarToggle();
    setupSidebarResize();
    setupModeToggle();
    setupFooterToggle();
    setupSearchBar();

    console.log('[Sidebar] Initialization complete');
}

/**
 * Setup sidebar collapse/expand toggle
 */
function setupSidebarToggle() {
    const toggleBtn = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('unified-sidebar');

    if (!toggleBtn || !sidebar) return;

    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        SidebarState.isCollapsed = sidebar.classList.contains('collapsed');
        SidebarState.save();
    });
}

/**
 * Setup sidebar resize functionality
 */
function setupSidebarResize() {
    const resizeHandle = document.querySelector('.sidebar-resize-handle');
    const sidebar = document.getElementById('unified-sidebar');

    if (!resizeHandle || !sidebar) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const delta = startX - e.clientX;
        const newWidth = Math.max(200, Math.min(600, startWidth + delta));
        sidebar.style.width = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            SidebarState.width = sidebar.offsetWidth;
            SidebarState.save();
        }
    });
}

/**
 * Setup mode toggle (Live <-> Historical)
 */
function setupModeToggle() {
    const modeHeader = document.getElementById('sidebar-mode-header');
    const modeIndicator = document.getElementById('sidebar-mode-indicator');
    const liveContent = document.getElementById('sidebar-live-content');
    const historicalContent = document.getElementById('sidebar-historical-content');

    if (!modeHeader || !modeIndicator || !liveContent || !historicalContent) return;

    modeHeader.addEventListener('click', async () => {
        if (SidebarState.currentMode === 'live') {
            // Switch to historical mode (call existing function)
            await switchToHistoricalMode();

            // Update sidebar UI
            SidebarState.currentMode = 'historical';
            modeIndicator.textContent = '🕐 HISTORICAL MODE';
            modeHeader.classList.add('historical');
            liveContent.style.display = 'none';
            historicalContent.style.display = 'flex';
        } else {
            // Switch to live mode (call existing function)
            await switchToLiveMode();

            // Update sidebar UI
            SidebarState.currentMode = 'live';
            modeIndicator.textContent = '🔴 LIVE MODE';
            modeHeader.classList.remove('historical');
            liveContent.style.display = 'flex';
            historicalContent.style.display = 'none';
        }
    });
}

/**
 * Setup footer toggle (mini radar/compass)
 */
function setupFooterToggle() {
    const toggleBtn = document.getElementById('sidebar-footer-toggle');
    const footerContent = document.getElementById('sidebar-footer-content');

    if (!toggleBtn || !footerContent) return;

    toggleBtn.addEventListener('click', () => {
        footerContent.classList.toggle('collapsed');
        SidebarState.footerVisible = !footerContent.classList.contains('collapsed');
        SidebarState.save();

        // Update button icon
        toggleBtn.querySelector('span').textContent =
            footerContent.classList.contains('collapsed') ? '⬇' : '⬆';
    });
}

/**
 * Setup search bar functionality
 */
function setupSearchBar() {
    const searchInput = document.getElementById('sidebar-aircraft-search');
    const clearBtn = document.getElementById('sidebar-search-clear');

    if (!searchInput || !clearBtn) return;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        updateAircraftListFilter(query);
    });

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        updateAircraftListFilter('');
    });
}

/**
 * Update aircraft list in sidebar
 */
function updateSidebarAircraftList(data) {
    const listContainer = document.getElementById('sidebar-aircraft-list');
    const countElem = document.getElementById('sidebar-aircraft-count');
    const positionedElem = document.getElementById('sidebar-aircraft-positioned');
    const updateElem = document.getElementById('sidebar-last-update');

    if (!listContainer) return;
    if (!data || !data.aircraft) return;

    // Update stats using raw aircraft data
    const totalAircraft = data.aircraft.length;
    const validAircraft = data.aircraft.filter(ac => ac.lat && ac.lon && ac.alt_baro);
    const positionedAircraft = validAircraft.length;

    if (countElem) countElem.textContent = totalAircraft;
    if (positionedElem) positionedElem.textContent = positionedAircraft;
    if (updateElem) updateElem.textContent = new Date().toLocaleTimeString();

    // Find highest/fastest/closest aircraft for badges
    let highestHex = null, fastestHex = null, closestHex = null;

    if (validAircraft.length > 0) {
        // Find highest
        const highest = validAircraft.reduce((max, ac) => (ac.alt_baro > max.alt_baro) ? ac : max);
        highestHex = highest.hex;

        // Find fastest
        const withSpeed = validAircraft.filter(ac => ac.gs);
        if (withSpeed.length > 0) {
            const fastest = withSpeed.reduce((max, ac) => (ac.gs > max.gs) ? ac : max);
            fastestHex = fastest.hex;
        }

        // Find closest
        const withDistance = validAircraft.filter(ac => ac.r_dst || ac.distance);
        if (withDistance.length > 0) {
            const closest = withDistance.reduce((min, ac) => {
                const dist = ac.r_dst || ac.distance || 999;
                const minDist = min.r_dst || min.distance || 999;
                return dist < minDist ? ac : min;
            });
            closestHex = closest.hex;
        }
    }

    // Build aircraft list sorted by distance
    const sortedAircraft = validAircraft
        .sort((a, b) => (a.distance || 0) - (b.distance || 0));

    // Clear existing list
    listContainer.innerHTML = '';

    // Add aircraft items
    sortedAircraft.forEach(ac => {
        const item = document.createElement('div');
        item.className = 'sidebar-aircraft-item';
        item.dataset.hex = ac.hex;

        if (selectedAircraft === ac.hex) {
            item.classList.add('selected');
        }

        const callsign = ac.flight ? ac.flight.trim() : ac.hex.toUpperCase();
        const altitude = ac.alt_baro ? `${Math.round(ac.alt_baro)}ft` : 'N/A';
        const speed = ac.gs ? `${Math.round(ac.gs)}kts` : 'N/A';
        const distance = ac.distance ? `${ac.distance.toFixed(1)}km` : '';

        // Add vertical rate indicator
        let verticalIndicator = '';
        const verticalRate = ac.baro_rate ?? ac.geom_rate;
        if (verticalRate) {
            if (verticalRate > 64) {
                verticalIndicator = ' ▲';
            } else if (verticalRate < -64) {
                verticalIndicator = ' ▼';
            }
        }

        // Build badges
        let badges = '';
        const isMilitary = isMilitaryAircraft(ac.hex);
        const isMLAT = ac.mlat && ac.mlat.length > 0;

        // Military badge (red) - highest priority
        if (isMilitary) {
            badges += '<span class="badge badge-military">🛡️ MIL</span>';
        }

        // MLAT badge (orange) - if not military
        if (!isMilitary && isMLAT) {
            badges += '<span class="badge badge-mlat">MLAT</span>';
        }

        // Stats badges (blue)
        if (ac.hex === highestHex) {
            badges += '<span class="badge badge-stat">HIGHEST</span>';
        }
        if (ac.hex === fastestHex) {
            badges += '<span class="badge badge-stat">FASTEST</span>';
        }
        if (ac.hex === closestHex) {
            badges += '<span class="badge badge-stat">CLOSEST</span>';
        }

        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                <strong style="color: var(--text-accent); font-size: 13px;">${callsign}${verticalIndicator}</strong>
                <span style="color: var(--text-secondary); font-size: 10px;">${distance}</span>
            </div>
            <div style="margin-bottom: 3px;">${badges}</div>
            <div style="display: flex; gap: 12px; font-size: 10px; color: var(--text-secondary);">
                <span>Alt: ${altitude}</span>
                <span>Spd: ${speed}</span>
            </div>
        `;

        // Click to select/follow aircraft
        item.addEventListener('click', () => {
            selectAircraft(ac.hex);
        });

        listContainer.appendChild(item);
    });
}

/**
 * Filter aircraft list by search query
 */
function updateAircraftListFilter(query) {
    const items = document.querySelectorAll('.sidebar-aircraft-item');

    items.forEach(item => {
        const hex = item.dataset.hex;
        const mesh = aircraftMeshes.get(hex);
        const aircraft = mesh ? mesh.userData : null;

        if (!aircraft) {
            item.style.display = 'none';
            return;
        }

        const callsign = aircraft.flight ? aircraft.flight.trim().toLowerCase() : '';
        const tail = aircraft.r ? aircraft.r.toLowerCase() : '';
        const type = aircraft.t ? aircraft.t.toLowerCase() : '';

        const matches =
            hex.toLowerCase().includes(query) ||
            callsign.includes(query) ||
            tail.includes(query) ||
            type.includes(query);

        item.style.display = matches ? 'block' : 'none';
    });
}

/**
 * Apply a theme to the application
 * @param {string} themeName - Name of theme from THEMES object
 */
function applyTheme(themeName) {
    const theme = THEMES[themeName];
    if (!theme) {
        console.error(`[Theme] Unknown theme: ${themeName}`);
        return;
    }

    console.log(`[Theme] Applying theme: ${theme.name}`);
    const root = document.documentElement;

    // Apply all color variables
    Object.entries(theme.colors).forEach(([key, value]) => {
        root.style.setProperty(`--${key}`, value);
    });

    // Apply style variables
    Object.entries(theme.styles).forEach(([key, value]) => {
        root.style.setProperty(`--${key}`, value);
    });

    // Save preference to localStorage
    if (SafeStorage.setItem('adsb3d-theme', themeName)) {
        console.log(`[Theme] Saved preference: ${themeName}`);
    }

    // Trigger scene updates if scene exists (for dynamic theme switching)
    if (typeof scene !== 'undefined' && scene) {
        updateSceneColors();
    }
}

/**
 * Update Three.js scene colors after theme change
 * This forces re-evaluation of CONFIG getters
 */
function updateSceneColors() {
    console.log('[Theme] Updating Three.js scene colors...');

    // Update fog
    if (scene.fog) {
        scene.fog.color.setHex(CONFIG.sceneFog);
    }

    // Update lights and distance rings
    scene.traverse((object) => {
        // Update lights
        if (object.isLight) {
            if (object.isAmbientLight || object.isHemisphereLight) {
                object.color.setHex(CONFIG.sceneAmbient);
            } else if (object.isDirectionalLight) {
                object.color.setHex(CONFIG.sceneSun);
            }
        }

        // Update distance rings
        if (object.userData && object.userData.isDistanceRing) {
            const index = object.userData.ringIndex;
            const color = index % 2 === 0 ? CONFIG.distanceRing1 : CONFIG.distanceRing2;
            if (object.material) {
                object.material.color.setHex(color);
            }
        }
    });

    console.log('[Theme] Scene colors updated');
}

/**
 * Get current theme name from localStorage or default
 * @returns {string} Theme name
 */
function getCurrentTheme() {
    const saved = SafeStorage.getItem('adsb3d-theme');
    if (saved && THEMES[saved]) {
        return saved;
    }
    return 'modern'; // Default theme
}

/**
 * Initialize theme system on page load
 */
function initializeTheme() {
    const currentTheme = getCurrentTheme();
    console.log(`[Theme] Initializing with theme: ${currentTheme}`);
    applyTheme(currentTheme);
}

// ============================================================================
// URL STATE MANAGEMENT
// ============================================================================
// Manages browser URL state for shareable links and browser navigation

const URLState = {
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
     * @returns {boolean} True if URL state was applied
     */
    async applyFromURL() {
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

                // Set preset or custom mode with validation
                // IMPORTANT: If explicit start/end times are provided, use custom mode (they take priority)
                if (urlParams.start && urlParams.end) {
                    // Explicit times provided - use custom mode
                    const customRadio = document.querySelector('input[name="time-preset"][value="custom"]');
                    if (customRadio) {
                        customRadio.checked = true;
                        const customRange = document.getElementById('custom-time-range');
                        if (customRange) customRange.style.display = 'block';
                    }
                    console.log('[URL State] Using custom time mode due to explicit start/end in URL');
                } else if (urlParams.preset && urlParams.preset !== 'custom') {
                    // No explicit times, but preset is provided
                    const validPresets = ['1', '4', '8', '12', '24'];
                    if (validPresets.includes(urlParams.preset)) {
                        const presetRadio = document.querySelector(`input[name="time-preset"][value="${urlParams.preset}"]`);
                        if (presetRadio) {
                            presetRadio.checked = true;
                            const customRange = document.getElementById('custom-time-range');
                            if (customRange) customRange.style.display = 'none';
                            console.log(`[URL State] Selected preset: Last ${urlParams.preset} hour(s)`);

                            // Also populate the date/time inputs with the calculated range
                            const calculateTimeRange = (hours) => {
                                const end = new Date();
                                const start = new Date(end.getTime() - (hours * 60 * 60 * 1000));
                                return { startTime: start, endTime: end };
                            };

                            const range = calculateTimeRange(parseInt(urlParams.preset));
                            const startTimeInput = document.getElementById('start-time');
                            const endTimeInput = document.getElementById('end-time');
                            if (startTimeInput) {
                                startTimeInput.value = formatForDatetimeInput(range.startTime.toISOString());
                            }
                            if (endTimeInput) {
                                endTimeInput.value = formatForDatetimeInput(range.endTime.toISOString());
                            }

                            // Update HistoricalState with the calculated times
                            HistoricalState.settings.startTime = range.startTime;
                            HistoricalState.settings.endTime = range.endTime;
                        }
                    } else {
                        console.warn('[URL State] Invalid preset value:', urlParams.preset, '- using custom');
                    }
                } else {
                    // Default to custom mode
                    const customRadio = document.querySelector('input[name="time-preset"][value="custom"]');
                    if (customRadio) {
                        customRadio.checked = true;
                        const customRange = document.getElementById('custom-time-range');
                        if (customRange) customRange.style.display = 'block';
                    }
                }

                // Populate custom time fields (correct IDs: start-time and end-time)
                // Need to format dates properly for datetime-local inputs
                const startTimeInput = document.getElementById('start-time');
                const endTimeInput = document.getElementById('end-time');

                // Helper to format date for datetime-local input (YYYY-MM-DDTHH:mm)
                const formatForDatetimeInput = (dateStr) => {
                    if (!dateStr) return '';
                    const date = new Date(dateStr);
                    if (isNaN(date.getTime())) return '';

                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    const hours = String(date.getHours()).padStart(2, '0');
                    const minutes = String(date.getMinutes()).padStart(2, '0');
                    return `${year}-${month}-${day}T${hours}:${minutes}`;
                };

                if (startTimeInput && urlParams.start) {
                    const formattedStart = formatForDatetimeInput(urlParams.start);
                    startTimeInput.value = formattedStart;
                    console.log('[URL State] Set start time input to:', formattedStart, 'from URL:', urlParams.start);
                }
                if (endTimeInput && urlParams.end) {
                    const formattedEnd = formatForDatetimeInput(urlParams.end);
                    endTimeInput.value = formattedEnd;
                    console.log('[URL State] Set end time input to:', formattedEnd, 'from URL:', urlParams.end);
                }

                // CRITICAL: Also update HistoricalState directly since setting the preset radio
                // may have triggered the change event which calculates times from NOW
                // We need to override those with the explicit URL times
                if (urlParams.start && urlParams.end) {
                    console.log('[URL State] Attempting to set times from URL:', { urlStart: urlParams.start, urlEnd: urlParams.end });
                    const startDate = new Date(urlParams.start);
                    const endDate = new Date(urlParams.end);
                    console.log('[URL State] Parsed dates:', { startDate, endDate, startValid: !isNaN(startDate.getTime()), endValid: !isNaN(endDate.getTime()) });
                    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
                        HistoricalState.settings.startTime = startDate;
                        HistoricalState.settings.endTime = endDate;
                        console.log('[URL State] ✓ Set HistoricalState times from URL:', { start: startDate.toISOString(), end: endDate.toISOString() });
                    } else {
                        console.warn('[URL State] ✗ Failed to parse dates from URL');
                    }
                } else {
                    console.log('[URL State] No explicit start/end in URL (start=' + urlParams.start + ', end=' + urlParams.end + ')');
                }

                // Apply tron mode if specified
                if (urlParams.tron === '1' || urlParams.tron === 'true') {
                    showTronMode = true;
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
                const loadButton = document.getElementById('load-historical-data');
                if (loadButton) {
                    // Trigger the load button click after a short delay to ensure UI is ready
                    setTimeout(() => {
                        loadButton.click();

                        // Apply display mode after data loads (wait for load to complete)
                        setTimeout(() => {
                            if (urlParams.display === 'playback') {
                                const playbackBtn = document.getElementById('display-mode-playback');
                                if (playbackBtn) playbackBtn.click();
                            }

                            // Apply visualization mode (tracks/heatmap/both)
                            if (urlParams.vizmode) {
                                const vizModeRadio = document.querySelector(`input[name="display-mode"][value="${urlParams.vizmode}"]`);
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
                        }, 1000);
                    }, 500);
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
                await switchToLiveMode(true); // Skip URL update when recovering from error
            } catch (recoveryError) {
                console.error('[URL State] Failed to recover to live mode:', recoveryError);
            }

            return false;
        }
    },

    /**
     * Capture current app state and update URL
     * Call this after any user action that changes settings
     */
    updateFromCurrentState() {
        const state = {
            mode: currentMode
        };

        // Add historical mode parameters
        if (currentMode === 'historical' && HistoricalState.settings.startTime && HistoricalState.settings.endTime) {
            state.start = HistoricalState.settings.startTime.toISOString();
            state.end = HistoricalState.settings.endTime.toISOString();

            const selectedPreset = document.querySelector('input[name="time-preset"]:checked');
            if (selectedPreset) state.preset = selectedPreset.value;

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

// Handle browser back/forward navigation
window.addEventListener('popstate', async (event) => {
    console.log('[URL State] Browser navigation detected');
    if (event.state) {
        await URLState.applyFromURL();
    }
});

// ============================================================================
// FEATURE DETECTION SYSTEM
// ============================================================================
// Determines at runtime which features are available (live vs historical mode)

const FeatureDetector = {
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
            const timeoutMs = 2000;
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            // Ping health endpoint (proxied through nginx /api/health)
            const response = await fetch('/api/health', {
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

// Application feature state
const AppFeatures = {
    live: true,
    historical: false
};

// ============================================================================
// HISTORICAL MODE DATA STRUCTURES
// ============================================================================

// Current active mode
let currentMode = 'live';  // 'live' or 'historical'

// Live mode update interval
let liveUpdateInterval = null;

// Historical data state
const HistoricalState = {
    tracks: [],              // Loaded historical tracks
    trackMeshes: new Map(),  // Map of ICAO -> {line, points, track, instanceIndices: [start, end]}
    loadedRange: null,       // {start: Date, end: Date}
    stats: null,             // {unique_aircraft, total_positions, time_span_hours}
    endpointMeshes: [],      // Array of individual endpoint sphere meshes
    displayMode: 'show-all', // 'show-all' or 'playback'
    heatmapMode: 'tracks',   // 'tracks', 'heatmap', or 'both'
    heatmapMeshes: [],       // Array of THREE.Mesh for heat map cells
    heatmapGridSize: 20,     // Grid resolution (20x20 cells = 400 total, better aggregation)
    settings: {
        startTime: null,
        endTime: null,
        maxTracks: 10000,  // Fixed at 10k - UI option removed
        militaryOnly: false
    }
};

// Playback state for historical animation
const PlaybackState = {
    isPlaying: false,
    speed: 10,               // Playback speed multiplier
    currentTime: 0,          // Current playback time (seconds from start)
    duration: 0,             // Total duration (seconds)
    animationFrameId: null,  // requestAnimationFrame ID
    lastFrameTime: 0,        // For calculating delta time
    startTimestamp: null,    // Earliest timestamp in loaded data
    endTimestamp: null,      // Latest timestamp in loaded data
    fadeAfter: 0             // Seconds to keep tracks visible after their end time (0 = immediate, 'never' = accumulate)
};

// Recent trails state (for live mode enhancement)
const RecentTrailsState = {
    enabled: false,
    minutes: 5,              // Default to 5 minutes
    loaded: false,
    loading: false,          // Prevent concurrent load operations (race condition guard)
    icaos: new Set()         // Track which aircraft have recent trails loaded
};

// Trail color mode: 'altitude' or 'speed'
let trailColorMode = 'altitude';

// ============================================================================
// LIVE STATISTICS STATE
// ============================================================================

/**
 * @typedef {Object} AircraftStats
 * @property {string} hex - Aircraft hex code
 * @property {string} tail - Tail number or callsign
 * @property {number} altitude - Altitude in feet
 */

const StatsState = {
    // Real-time stats (reset every frame)
    currentCount: 0,
    militaryCount: 0,
    highestAircraft: null,  // { hex, tail, altitude }
    lowestAircraft: null,   // { hex, tail, altitude }
    totalAltitude: 0,       // For average calculation

    // Daily stats (persistent)
    uniqueToday: new Set(), // Set of hex codes seen today
    lastResetDate: null,    // UTC date string for midnight check

    // Panel state
    isVisible: true
};

/**
 * Get current UTC date as YYYY-MM-DD string
 * @returns {string} UTC date string
 */
function getCurrentUTCDate() {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

/**
 * Check if we need to reset daily stats (new UTC day)
 * @returns {void}
 */
function checkDailyReset() {
    const currentDate = getCurrentUTCDate();

    if (StatsState.lastResetDate !== currentDate) {
        console.log(`[Stats] New day detected (${currentDate}), resetting daily stats`);
        StatsState.uniqueToday.clear();
        StatsState.lastResetDate = currentDate;
        SafeStorage.setItem('statsResetDate', currentDate);
        SafeStorage.setItem('statsUniqueToday', JSON.stringify([]));
    }
}

/**
 * Save unique today set to localStorage
 * @returns {void}
 */
function saveUniqueToday() {
    const hexArray = Array.from(StatsState.uniqueToday);
    SafeStorage.setItem('statsUniqueToday', JSON.stringify(hexArray));
}

/**
 * Load daily stats from localStorage
 * @returns {void}
 */
function loadDailyStats() {
    const savedDate = SafeStorage.getItem('statsResetDate');
    const savedUnique = SafeStorage.getItem('statsUniqueToday');

    if (savedDate && savedUnique) {
        StatsState.lastResetDate = savedDate;
        try {
            const hexArray = JSON.parse(savedUnique);
            StatsState.uniqueToday = new Set(hexArray);
        } catch (e) {
            console.error('[Stats] Failed to parse saved unique aircraft', e);
            StatsState.uniqueToday = new Set();
        }
    }

    // Check if reset needed
    checkDailyReset();
}

// ============================================================================
// END LIVE STATISTICS STATE
// ============================================================================

// ============================================================================
// END HISTORICAL MODE DATA STRUCTURES
// ============================================================================

// ============================================================================
// END FEATURE DETECTION SYSTEM
// ============================================================================

// ============================================================================
// ALTITUDE SMOOTHING FOR HISTORICAL DATA
// ============================================================================
// Handles MLAT data quality issues (trailing/leading/middle zeros, outliers)

function smoothAltitudes(positions) {
    if (!positions || positions.length < 2) return positions;

    // Create a copy to avoid modifying original data
    const smoothed = positions.map(p => ({ ...p }));

    // Step 1: Calculate reference altitudes for the entire track
    // NOTE: Track API returns 'alt' field, not 'altitude'
    const allAltitudes = smoothed.map(p => p.alt || p.altitude).filter(alt => alt && alt > 500);

    if (allAltitudes.length === 0) {
        console.warn('[Smoothing] Track has no valid altitudes');
        return smoothed;
    }

    const sortedAlts = [...allAltitudes].sort((a, b) => a - b);
    const medianAlt = sortedAlts[Math.floor(sortedAlts.length / 2)];
    const maxAlt = Math.max(...allAltitudes);
    const minGoodAlt = Math.min(...allAltitudes.filter(a => a > 1000));

    // Enhanced: Determine if this is a high-altitude track (likely MLAT military aircraft)
    const isHighAltitudeTrack = maxAlt > 10000;

    // For high-altitude tracks, use max altitude to set aggressive threshold
    // Any altitude below 30% of max is suspicious (e.g., if max=25000, anything <7500 is suspect)
    const goodAltitudeThreshold = isHighAltitudeTrack
        ? Math.max(2000, maxAlt * 0.3)  // Much more aggressive for MLAT
        : 1000;

    console.log(`[Smoothing] Track stats - Median: ${medianAlt} ft, Max: ${maxAlt} ft, High-alt: ${isHighAltitudeTrack}, Threshold: ${Math.round(goodAltitudeThreshold)} ft`);

    let badPointCount = 0;

    // Helper function to check if altitude is valid (detects MLAT zero glitches)
    const isValidAltitude = (alt) => {
        if (!alt || alt === 0) return false;  // Exact zero always invalid (MLAT glitch)
        if (alt < 500) return false;  // Very low altitudes are MLAT errors
        if (isHighAltitudeTrack && alt < goodAltitudeThreshold) return false;  // Below threshold for high-alt tracks
        return true;
    };

    // Helper to get altitude from position (handles both 'alt' and 'altitude' fields)
    const getAlt = (pos) => pos.alt !== undefined ? pos.alt : pos.altitude;
    const setAlt = (pos, value) => {
        if (pos.alt !== undefined) pos.alt = value;
        if (pos.altitude !== undefined) pos.altitude = value;
    };

    // Step 2: Handle trailing zeros (plane drops off at zero)
    let lastGoodAlt = null;
    let lastGoodIdx = -1;
    for (let i = smoothed.length - 1; i >= 0; i--) {
        if (isValidAltitude(getAlt(smoothed[i]))) {
            lastGoodAlt = getAlt(smoothed[i]);
            lastGoodIdx = i;
            break;
        }
    }

    if (lastGoodIdx !== -1 && lastGoodIdx < smoothed.length - 1) {
        for (let i = lastGoodIdx + 1; i < smoothed.length; i++) {
            if (!isValidAltitude(getAlt(smoothed[i]))) {
                setAlt(smoothed[i], lastGoodAlt);
            }
        }
    }

    // Step 3: Handle leading zeros (plane appears with zero altitude)
    let firstGoodAlt = null;
    let firstGoodIdx = -1;
    for (let i = 0; i < smoothed.length; i++) {
        if (isValidAltitude(getAlt(smoothed[i]))) {
            firstGoodAlt = getAlt(smoothed[i]);
            firstGoodIdx = i;
            break;
        }
    }

    if (firstGoodIdx > 0) {
        for (let i = 0; i < firstGoodIdx; i++) {
            if (!isValidAltitude(getAlt(smoothed[i]))) {
                setAlt(smoothed[i], firstGoodAlt);
            }
        }
    }

    // Step 4: Handle middle sequences using aggressive interpolation (MLAT zero fixes)
    for (let i = 0; i < smoothed.length; i++) {
        const curr = smoothed[i];
        const originalAlt = getAlt(curr);

        if (!isValidAltitude(getAlt(curr))) {
            badPointCount++;

            // Find previous good altitude (extended search window for MLAT)
            let prevGoodAlt = null;
            let prevGoodIdx = -1;
            const lookBackWindow = isHighAltitudeTrack ? 30 : 20;
            for (let j = i - 1; j >= Math.max(0, i - lookBackWindow); j--) {
                if (isValidAltitude(getAlt(smoothed[j]))) {
                    prevGoodAlt = getAlt(smoothed[j]);
                    prevGoodIdx = j;
                    break;
                }
            }

            // Find next good altitude (extended search window for MLAT)
            let nextGoodAlt = null;
            let nextGoodIdx = -1;
            const lookAheadWindow = isHighAltitudeTrack ? 30 : 20;
            for (let j = i + 1; j < Math.min(smoothed.length, i + lookAheadWindow); j++) {
                if (isValidAltitude(getAlt(smoothed[j]))) {
                    nextGoodAlt = getAlt(smoothed[j]);
                    nextGoodIdx = j;
                    break;
                }
            }

            // Interpolate if we have both neighbors
            if (prevGoodAlt !== null && nextGoodAlt !== null) {
                const totalSteps = nextGoodIdx - prevGoodIdx;
                const steps = i - prevGoodIdx;
                const interpolated = prevGoodAlt + ((nextGoodAlt - prevGoodAlt) * steps / totalSteps);
                setAlt(smoothed[i], Math.round(interpolated));
            } else if (prevGoodAlt !== null) {
                setAlt(smoothed[i], prevGoodAlt);
            } else if (nextGoodAlt !== null) {
                setAlt(smoothed[i], nextGoodAlt);
            } else if (medianAlt > 0) {
                setAlt(smoothed[i], medianAlt);
            }
        }
    }

    // Step 5: Smooth outliers - detect single-point spikes/drops
    let outlierCount = 0;
    for (let i = 1; i < smoothed.length - 1; i++) {
        const prev = smoothed[i - 1];
        const curr = smoothed[i];
        const next = smoothed[i + 1];

        const prevAlt = getAlt(prev);
        const currAlt = getAlt(curr);
        const nextAlt = getAlt(next);

        if (prevAlt && currAlt && nextAlt) {
            const avgNeighbor = (prevAlt + nextAlt) / 2;
            const deviation = Math.abs(currAlt - avgNeighbor);

            // Enhanced: More aggressive smoothing for high-altitude tracks (MLAT)
            const deviationThreshold = isHighAltitudeTrack ? 0.25 : 0.4;
            if (deviation > avgNeighbor * deviationThreshold) {
                setAlt(smoothed[i], Math.round(avgNeighbor));
                outlierCount++;
            }
        }
    }

    // Step 6: Second pass - catch any remaining suspicious points
    if (isHighAltitudeTrack && badPointCount > 0) {
        let secondPassFixes = 0;
        for (let i = 1; i < smoothed.length - 1; i++) {
            const prev = smoothed[i - 1];
            const curr = smoothed[i];
            const next = smoothed[i + 1];

            const prevAlt = getAlt(prev);
            const currAlt = getAlt(curr);
            const nextAlt = getAlt(next);

            // If current point is still suspiciously different from neighbors
            if (prevAlt && currAlt && nextAlt) {
                const avgNeighbor = (prevAlt + nextAlt) / 2;
                const deviation = Math.abs(currAlt - avgNeighbor);

                // Very aggressive second pass: 20% deviation
                if (deviation > avgNeighbor * 0.2) {
                    setAlt(smoothed[i], Math.round(avgNeighbor));
                    secondPassFixes++;
                }
            }
        }

        if (secondPassFixes > 0) {
            console.log(`[Smoothing] Second pass fixed ${secondPassFixes} additional points`);
        }
    }

    if (badPointCount > 0 || outlierCount > 0) {
        console.log(`[Smoothing] Fixed ${badPointCount} bad points, ${outlierCount} outliers out of ${positions.length} total positions`);
    }

    return smoothed;
}

// ============================================================================
// END ALTITUDE SMOOTHING
// ============================================================================

// Military aircraft database (loaded from tar1090-db)
// Structure: { "ICAO_HEX": { tail, type, flag, description }, ... }
let militaryDatabase = {};
let militaryDatabaseLoaded = false;

// Load military aircraft database from tar1090-db (Mictronics/readsb-protobuf)
async function loadMilitaryDatabase() {
    const CACHE_KEY = 'military_aircraft_db';
    const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

    try {
        // Check localStorage cache first
        const cached = SafeStorage.getItem(CACHE_KEY);
        if (cached) {
            try {
                const { data, timestamp } = JSON.parse(cached);
                const age = Date.now() - timestamp;

                if (age < CACHE_DURATION) {
                    // Use cached data
                    militaryDatabase = data;
                    militaryDatabaseLoaded = true;
                    console.log(`Military database loaded from cache: ${Object.keys(data).length} aircraft (${(age / 3600000).toFixed(1)}h old)`);

                    // Update in background (non-blocking)
                    fetchAndCacheMilitaryDatabase();
                    return;
                }
            } catch (e) {
                console.warn('Failed to parse cached military database:', e);
            }
        }

        // No cache or expired - fetch now
        await fetchAndCacheMilitaryDatabase();

    } catch (error) {
        console.error('Error loading military database:', error);
    }
}

async function fetchAndCacheMilitaryDatabase() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/Mictronics/readsb-protobuf/dev/webapp/src/db/aircrafts.json');

        if (!response.ok) {
            console.error('Failed to fetch military database:', response.status);
            return;
        }

        const dbData = await response.json();

        // Extract only military aircraft (flag "10")
        const newMilitaryDb = {};
        let militaryCount = 0;
        for (const [icaoHex, aircraftInfo] of Object.entries(dbData)) {
            // aircraftInfo = [tail, type, flag, description]
            if (aircraftInfo.length >= 3 && aircraftInfo[2] === "10") {
                newMilitaryDb[icaoHex.toUpperCase()] = {
                    tail: aircraftInfo[0],
                    type: aircraftInfo[1],
                    flag: aircraftInfo[2],
                    description: aircraftInfo.length > 3 ? aircraftInfo[3] : ""
                };
                militaryCount++;
            }
        }

        militaryDatabase = newMilitaryDb;
        militaryDatabaseLoaded = true;
        console.log(`Military database fetched: ${militaryCount} verified military aircraft`);

        // Cache for 24 hours
        try {
            SafeStorage.setItem('military_aircraft_db', JSON.stringify({
                data: newMilitaryDb,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.warn('Failed to cache military database:', e);
        }

    } catch (error) {
        console.error('Error fetching military database:', error);
    }
}

/**
 * Calculate signal quality and data completeness for an aircraft
 * Returns opacity value (0.3-1.0) and quality assessment
 * @param {Object} ac - Aircraft data object
 * @returns {Object} {opacity: number, quality: string, issues: string[]}
 */
function getSignalQuality(ac) {
    const issues = [];
    let qualityScore = 100; // Start at 100%

    // Check RSSI signal strength (typical range: -20 to -40 dBm)
    if (ac.rssi !== undefined) {
        if (ac.rssi < -38) {
            qualityScore -= 15; // Very weak signal
            issues.push('Weak signal');
        } else if (ac.rssi < -35) {
            qualityScore -= 5; // Moderately weak
        }
    } else {
        qualityScore -= 10; // No RSSI data
        issues.push('No signal data');
    }

    // Check data freshness - seen (seconds since last message)
    if (ac.seen > 30) {
        qualityScore -= 30; // Very stale
        issues.push('Stale data (>30s)');
    } else if (ac.seen > 10) {
        qualityScore -= 15; // Getting stale
        issues.push('Old data (>10s)');
    } else if (ac.seen > 5) {
        qualityScore -= 5; // Slightly stale
    }

    // Check position freshness - seen_pos
    if (ac.seen_pos !== undefined && ac.seen_pos > 30) {
        qualityScore -= 20; // Very old position
        issues.push('Old position (>30s)');
    } else if (ac.seen_pos !== undefined && ac.seen_pos > 10) {
        qualityScore -= 10; // Old position
    }

    // Check if using MLAT (multilateration) - less accurate
    if (ac.mlat && ac.mlat.length > 0) {
        qualityScore -= 10;
        issues.push('MLAT position');
    }

    // Check if using TIS-B (rebroadcast) - indirect data
    if (ac.tisb && ac.tisb.length > 0) {
        qualityScore -= 15;
        issues.push('TIS-B data');
    }

    // Check message count - low count means poor reception
    if (ac.messages !== undefined && ac.messages < 100) {
        qualityScore -= 10;
        issues.push('Low message count');
    }

    // Check for missing critical data
    if (!ac.alt_baro && ac.alt_baro !== 0) {
        qualityScore -= 15;
        issues.push('No altitude');
    }
    if (!ac.gs && ac.gs !== 0) {
        qualityScore -= 10;
        issues.push('No ground speed');
    }
    if (!ac.track && ac.track !== 0) {
        qualityScore -= 5;
        issues.push('No heading');
    }

    // Navigation Integrity Category (NIC) - 0-11, higher is better
    if (ac.nic !== undefined && ac.nic < 6) {
        qualityScore -= 10;
        issues.push('Low accuracy');
    }

    // Calculate opacity based on quality score
    qualityScore = Math.max(0, Math.min(100, qualityScore));
    const opacity = 0.3 + (qualityScore / 100) * 0.7; // Range: 0.3 to 1.0

    // Determine quality label
    let quality = 'Good';
    if (qualityScore < 40) quality = 'Poor';
    else if (qualityScore < 60) quality = 'Fair';
    else if (qualityScore < 80) quality = 'Moderate';

    return {
        opacity: opacity,
        quality: quality,
        score: qualityScore,
        issues: issues,
        rssi: ac.rssi,
        seen: ac.seen,
        seen_pos: ac.seen_pos
    };
}

// Check if aircraft is military using tar1090-db database
function isMilitaryAircraft(hex) {
    if (!hex || !militaryDatabaseLoaded) return false;
    return militaryDatabase.hasOwnProperty(hex.toUpperCase());
}

// Get military aircraft info from database
function getMilitaryInfo(hex) {
    if (!hex || !militaryDatabaseLoaded) return null;
    return militaryDatabase[hex.toUpperCase()] || null;
}

/**
 * @typedef {Object} AircraftSpec
 * @property {number} cruise - Cruise speed in knots
 * @property {number} maxAlt - Maximum altitude in feet
 * @property {number} range - Range in nautical miles
 */

/**
 * Aircraft type specifications database
 * Data source: Various aviation references, manufacturer specs
 * @type {Object.<string, {cruise: number, maxAlt: number, range: number}>}
 */
const AIRCRAFT_TYPE_SPECS = {
    // === Commercial Jets (Airbus) ===
    'A319': { cruise: 447, maxAlt: 39000, range: 3700 },
    'A320': { cruise: 450, maxAlt: 39000, range: 3300 },
    'A321': { cruise: 450, maxAlt: 39000, range: 3200 },
    'A20N': { cruise: 450, maxAlt: 39800, range: 3500 },  // A320neo
    'A21N': { cruise: 450, maxAlt: 39800, range: 4000 },  // A321neo
    'A332': { cruise: 470, maxAlt: 42650, range: 7200 },  // A330-200
    'A333': { cruise: 470, maxAlt: 41450, range: 6350 },  // A330-300
    'A339': { cruise: 470, maxAlt: 41100, range: 7200 },  // A330-900neo
    'A359': { cruise: 488, maxAlt: 43100, range: 8100 },  // A350-900
    'A35K': { cruise: 488, maxAlt: 43100, range: 9700 },  // A350-1000
    'A388': { cruise: 490, maxAlt: 43000, range: 8000 },  // A380

    // === Commercial Jets (Boeing) ===
    'B737': { cruise: 450, maxAlt: 41000, range: 3000 },  // Generic 737
    'B738': { cruise: 453, maxAlt: 41000, range: 3115 },  // 737-800
    'B739': { cruise: 453, maxAlt: 41000, range: 3235 },  // 737-900
    'B37M': { cruise: 453, maxAlt: 41000, range: 3550 },  // 737 MAX 7
    'B38M': { cruise: 453, maxAlt: 41000, range: 3550 },  // 737 MAX 8
    'B39M': { cruise: 453, maxAlt: 41000, range: 3550 },  // 737 MAX 9
    'B3JM': { cruise: 453, maxAlt: 41000, range: 3700 },  // 737 MAX 10
    'B752': { cruise: 459, maxAlt: 42000, range: 3900 },  // 757-200
    'B753': { cruise: 459, maxAlt: 42000, range: 3395 },  // 757-300
    'B762': { cruise: 470, maxAlt: 43100, range: 6385 },  // 767-200
    'B763': { cruise: 470, maxAlt: 43100, range: 5990 },  // 767-300
    'B764': { cruise: 470, maxAlt: 43100, range: 5625 },  // 767-400
    'B772': { cruise: 490, maxAlt: 43100, range: 7730 },  // 777-200
    'B773': { cruise: 490, maxAlt: 43100, range: 7370 },  // 777-300
    'B77W': { cruise: 490, maxAlt: 43100, range: 8555 },  // 777-300ER
    'B77L': { cruise: 490, maxAlt: 43100, range: 8700 },  // 777-200LR
    'B788': { cruise: 488, maxAlt: 43000, range: 7355 },  // 787-8
    'B789': { cruise: 488, maxAlt: 43000, range: 7635 },  // 787-9
    'B78J': { cruise: 488, maxAlt: 43000, range: 6430 },  // 787-10
    'B748': { cruise: 493, maxAlt: 43100, range: 8000 },  // 747-8

    // === Regional Jets (Bombardier/Airbus Canada) ===
    'CRJ2': { cruise: 450, maxAlt: 41000, range: 1700 },  // CRJ-200
    'CRJ7': { cruise: 447, maxAlt: 41000, range: 1650 },  // CRJ-700
    'CRJ9': { cruise: 447, maxAlt: 41000, range: 1650 },  // CRJ-900
    'CRJX': { cruise: 447, maxAlt: 41000, range: 1650 },  // CRJ-1000
    'BCS1': { cruise: 447, maxAlt: 41000, range: 3400 },  // A220-100 (CS100)
    'BCS3': { cruise: 447, maxAlt: 41000, range: 3350 },  // A220-300 (CS300)

    // === Regional Jets (Embraer) ===
    'E170': { cruise: 447, maxAlt: 41000, range: 2150 },  // E170
    'E175': { cruise: 447, maxAlt: 41000, range: 2200 },  // E175
    'E75L': { cruise: 447, maxAlt: 41000, range: 2200 },  // E175 (long wing)
    'E75S': { cruise: 447, maxAlt: 41000, range: 2200 },  // E175 (short wing)
    'E190': { cruise: 470, maxAlt: 41000, range: 2400 },  // E190
    'E195': { cruise: 470, maxAlt: 41000, range: 2300 },  // E195
    'E290': { cruise: 470, maxAlt: 41000, range: 2600 },  // E190-E2
    'E295': { cruise: 470, maxAlt: 41000, range: 2600 },  // E195-E2

    // === Turboprops ===
    'AT72': { cruise: 276, maxAlt: 25000, range: 900 },   // ATR 72
    'AT75': { cruise: 276, maxAlt: 25000, range: 950 },   // ATR 72-600
    'AT76': { cruise: 276, maxAlt: 25000, range: 950 },   // ATR 72-600
    'DH8D': { cruise: 360, maxAlt: 25000, range: 1200 },  // Dash 8 Q400

    // === Business Jets ===
    'C25C': { cruise: 460, maxAlt: 51000, range: 2000 },  // Citation CJ4
    'C56X': { cruise: 528, maxAlt: 51000, range: 3450 },  // Citation Excel
    'C680': { cruise: 538, maxAlt: 51000, range: 3400 },  // Citation Sovereign
    'CL60': { cruise: 459, maxAlt: 51000, range: 3200 },  // Challenger 600
    'GLF4': { cruise: 488, maxAlt: 51000, range: 4220 },  // Gulfstream IV
    'GLF5': { cruise: 516, maxAlt: 51000, range: 6500 },  // Gulfstream V
    'GLF6': { cruise: 516, maxAlt: 51000, range: 6500 },  // Gulfstream 650
    'GLEX': { cruise: 488, maxAlt: 51000, range: 4000 },  // Bombardier Global Express
    'FA7X': { cruise: 488, maxAlt: 51000, range: 5950 },  // Dassault Falcon 7X
    'FA50': { cruise: 540, maxAlt: 51000, range: 3350 },  // Dassault Falcon 50

    // === General Aviation ===
    'C152': { cruise: 107, maxAlt: 14700, range: 415 },   // Cessna 152
    'C172': { cruise: 122, maxAlt: 14000, range: 640 },   // Cessna 172
    'C182': { cruise: 145, maxAlt: 18100, range: 915 },   // Cessna 182
    'C206': { cruise: 151, maxAlt: 16500, range: 840 },   // Cessna 206
    'C208': { cruise: 186, maxAlt: 25000, range: 1070 },  // Cessna Caravan
    'P28A': { cruise: 113, maxAlt: 11000, range: 460 },   // Piper PA-28 Cherokee
    'PA46': { cruise: 225, maxAlt: 25000, range: 1300 },  // Piper Malibu
    'SR22': { cruise: 183, maxAlt: 17500, range: 1200 },  // Cirrus SR22

    // === Military (Common Types) ===
    'F16': { cruise: 570, maxAlt: 50000, range: 2280 },   // F-16 Fighting Falcon
    'F18': { cruise: 570, maxAlt: 50000, range: 1250 },   // F/A-18 Hornet
    'F35': { cruise: 570, maxAlt: 50000, range: 1200 },   // F-35 Lightning II
    'A10': { cruise: 340, maxAlt: 45000, range: 800 },    // A-10 Thunderbolt II
    'C130': { cruise: 336, maxAlt: 33000, range: 2360 },  // C-130 Hercules
    'C17': { cruise: 450, maxAlt: 45000, range: 2400 },   // C-17 Globemaster III
    'C5': { cruise: 518, maxAlt: 42000, range: 5200 },    // C-5 Galaxy
    'KC135': { cruise: 530, maxAlt: 50000, range: 1500 }, // KC-135 Stratotanker
    'KC10': { cruise: 493, maxAlt: 42000, range: 4400 },  // KC-10 Extender
    'P8': { cruise: 490, maxAlt: 41000, range: 1200 },    // P-8 Poseidon

    // === Cargo ===
    'MD11': { cruise: 482, maxAlt: 42000, range: 6800 },  // MD-11
    'B744': { cruise: 493, maxAlt: 45000, range: 7670 },  // 747-400
    'B74S': { cruise: 493, maxAlt: 43100, range: 4400 },  // 747-400SF (cargo)
};

/**
 * Get aircraft performance specifications
 * @param {string} typeCode - ICAO type designator (e.g., 'B738', 'A320')
 * @returns {{cruise: number, maxAlt: number, range: number} | null} Specs or null if unknown
 */
function getAircraftSpecs(typeCode) {
    if (!typeCode || typeof typeCode !== 'string') {
        return null;
    }

    // Convert to uppercase for case-insensitive lookup
    const normalizedType = typeCode.trim().toUpperCase();

    return AIRCRAFT_TYPE_SPECS[normalizedType] || null;
}

// Set page title dynamically based on location name (if provided)
if (window.ENV_CONFIG?.locationName) {
    document.title = `adsb-3d - ${window.ENV_CONFIG.locationName}`;
}

// Global state
let scene, camera, renderer, controls;
let sky; // Reference to sky mesh for day/night updates
let aircraftMeshes = new Map();
let aircraftLabels = new Map();
let militaryIndicators = new Map(); // Military indicator icons for verified military aircraft
let trails = new Map();
let staleTrails = new Map(); // Trails from aircraft that have disappeared
let altitudeLines = new Map(); // Vertical lines from ground to aircraft
let selectedAircraft = null;
let showTrails = true;
let showLabels = true;
let showAltitudeLines = true;
let showMiniRadar = true; // Mini radar view (on by default)
let showCompass = true; // Compass rose (on by default)
let showHomeTower = true; // Home tower marker (on by default)
let showTronMode = true; // Tron mode: vertical altitude curtains beneath trails (on by default)
let followMode = false;
let followedAircraftHex = null;
let autoFadeTrails = false; // Auto-fade old trail positions
let trailFadeTime = 3600; // Fade time in seconds (default: 1 hour)
let liveRadarData = []; // Always store live aircraft for mini radar (even in historical mode)
let urlParamsChecked = false; // Track if we've checked URL parameters on load
let followLocked = true; // When true, camera locked behind aircraft; when false, free orbit
let cameraReturnInProgress = false;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let currentlyHoveredListItem = null; // Track which aircraft is hovered in the list
let homeMarkerGroup = null; // Reference to the home tower marker group
let currentlyHoveredCanvasAircraft = null; // Track which aircraft is hovered on canvas

// Route API cache and rate limiting
const ROUTE_CACHE_KEY = 'adsbdb_route_cache';
const ROUTE_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const API_RATE_LIMIT_MS = 1000; // Minimum 1 second between API calls
let lastAPICall = 0;
let pendingRouteRequests = new Map(); // Track in-flight requests to avoid duplicates

// Camera control state (for manual orbit during follow mode)
let cameraAngleX = 0; // Start facing north (camera south of origin)
let cameraAngleY = Math.PI / 6;
let cameraDistance = 100;
let isDragging = false;
let wasDragging = false;

// Airport/Runway data
let airports = [];
let runways = [];
let airportMeshes = [];
let runwayMeshes = [];
let showAirportsEnabled = true; // On by default
let showRunwaysEnabled = true;

// ============================================================================
// AIRCRAFT SHAPE SYSTEM - SVG-based rendering (like tar1090)
// ============================================================================
// Use Shift+S to toggle between sphere and aircraft shape rendering
// Aircraft shapes provide accurate representations using tar1090's SVG system

let useSpriteMode = true; // Toggle with Shift+S (SVG shapes enabled by default)
let spriteTexture = null; // Legacy sprite sheet (no longer used)

// SVG Aircraft Shape System is loaded from aircraft-svg-system.js
// Old sprite sheet code has been removed in favor of accurate SVG-based rendering

// SVG Aircraft Shape System is loaded from aircraft-svg-system.js
// Old sprite sheet code has been removed in favor of accurate SVG-based rendering

// Load sprite texture
function loadSpriteTexture() {
    const loader = new THREE.TextureLoader();
    // Set crossOrigin to allow loading from same origin
    loader.crossOrigin = 'anonymous';

    // Use absolute path to avoid relative path issues
    loader.load(
        '/images/sprites.png',
        (texture) => {
            // Configure texture for sprite sheet usage
            // Use NearestFilter to prevent bleeding between sprites
            texture.minFilter = THREE.NearestFilter;
            texture.magFilter = THREE.NearestFilter;
            texture.colorSpace = THREE.SRGBColorSpace;

            // CRITICAL: Set wrapping to ClampToEdge to prevent texture bleeding
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;

            // Don't generate mipmaps for sprite sheets
            texture.generateMipmaps = false;

            spriteTexture = texture;

            // DIAGNOSTIC: Log actual texture dimensions
            console.log('[Sprites] Loaded sprite sheet:');
            console.log(`  - Image dimensions: ${texture.image.width}x${texture.image.height}`);
            console.log(`  - Expected: 1376x516`);
            console.log(`  - Match: ${texture.image.width === 1376 && texture.image.height === 516 ? 'YES' : 'NO'}`);
            console.log(`  - Texture ready: ${texture.image.complete}`);
            console.log(`  - Sprite size: ${SPRITE_CONFIG.spriteWidth}x${SPRITE_CONFIG.spriteHeight}`);
            console.log(`  - Grid: ${SPRITE_CONFIG.columns}x${SPRITE_CONFIG.rows}`);

            // Sprite mode is now loaded during init, no need to reload here
        },
        (progress) => {
            // Optional: log loading progress
            if (progress.lengthComputable) {
                const percent = (progress.loaded / progress.total * 100).toFixed(0);
                console.log(`[Sprites] Loading: ${percent}%`);
            }
        },
        (error) => {
            console.error('[Sprites] Failed to load sprite sheet:', error);
            console.error('[Sprites] Sprites unavailable, using spheres only');
            console.error('[Sprites] URL attempted:', '/images/sprites.png');
        }
    );
}

// Get sprite position based on aircraft category
// Returns {row, col} - heading rotation is done via mesh rotation, not sprite selection
function getSpritePosition(category = 'default') {
    const position = SPRITE_POSITIONS[category] || SPRITE_POSITIONS.default;
    return { row: position.row, col: position.col };
}

// Create shader material for sprite rendering
// This avoids texture cloning issues by selecting sprite regions in the shader
function createSpriteMaterial(row, column, color) {
    const spriteWidth = SPRITE_CONFIG.spriteWidth;
    const spriteHeight = SPRITE_CONFIG.spriteHeight;
    const texWidth = SPRITE_CONFIG.textureWidth;
    const texHeight = SPRITE_CONFIG.textureHeight;

    // Calculate UV offset and size for this sprite
    // Keep it simple - no half-pixel adjustments yet
    const uOffset = column * spriteWidth / texWidth;
    const uSize = spriteWidth / texWidth;

    // Flip V coordinate: WebGL (0,0) is bottom-left, but image row 0 is at top
    // Row 0 is at top of image (V near 1.0), row 5 is at bottom (V near 0.0)
    const vOffset = 1.0 - ((row + 1) * spriteHeight / texHeight);
    const vSize = spriteHeight / texHeight;

    console.log(`[Sprites] Shader material for [${row},${column}]: uOffset=${uOffset.toFixed(4)}, vOffset=${vOffset.toFixed(4)}, uSize=${uSize.toFixed(4)}, vSize=${vSize.toFixed(4)}`);

    // Custom shader that samples only the specified sprite region
    const vertexShader = `
        varying vec2 vUv;

        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;

    const fragmentShader = `
        uniform sampler2D spriteSheet;
        uniform vec2 uvOffset;
        uniform vec2 uvSize;
        uniform vec3 tintColor;
        varying vec2 vUv;

        void main() {
            // Map UV coordinates to sprite region
            vec2 spriteUV = uvOffset + (vUv * uvSize);

            // Sample the sprite sheet
            vec4 texColor = texture2D(spriteSheet, spriteUV);

            // Apply color tint to non-transparent pixels
            vec3 finalColor = texColor.rgb * tintColor;

            gl_FragColor = vec4(finalColor, texColor.a);
        }
    `;

    const material = new THREE.ShaderMaterial({
        uniforms: {
            spriteSheet: { value: spriteTexture },
            uvOffset: { value: new THREE.Vector2(uOffset, vOffset) },
            uvSize: { value: new THREE.Vector2(uSize, vSize) },
            tintColor: { value: new THREE.Color(color) }
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    return material;
}

// Determine aircraft category from type/size data
// Returns category name that maps to SPRITE_POSITIONS
function getAircraftCategory(aircraftData) {
    if (!aircraftData) {
        return 'default';
    }

    // First check the 't' field (ICAO type designator) from registration data
    const typeCode = (aircraftData.t || '').toUpperCase();

    // Check if we have a direct type mapping
    if (typeCode && TYPE_TO_SPRITE[typeCode]) {
        const spriteKey = TYPE_TO_SPRITE[typeCode];
        // Make sure this sprite position exists
        if (SPRITE_POSITIONS[spriteKey]) {
            // console.log(`[Sprites] Type ${typeCode} -> ${spriteKey}`);
            return spriteKey;
        }
    }

    // Check ADS-B category field (some aircraft transmit this)
    // Following tar1090's CategoryIcons mapping exactly
    const category = aircraftData.category;
    if (category) {
        // Categories from ADS-B specification (matching tar1090)
        // A-series: Fixed-wing aircraft
        if (category === 'A1') return 'cessna';       // Light (< 7 tons) - Cessna-type GA
        if (category === 'A2') return 'jet_swept';    // Small (< 34 tons) - Regional jets
        if (category === 'A3') return 'airliner';     // Large (< 136 tons) - Airliners
        if (category === 'A4') return 'airliner';     // High vortex (< 136 tons)
        if (category === 'A5') return 'heavy_2e';     // Heavy (> 136 tons)
        if (category === 'A6') return 'hi_perf';      // High performance
        if (category === 'A7') return 'helicopter';   // Rotorcraft

        // B-series: Gliders/Balloons
        if (category === 'B1') return 'glider';
        if (category === 'B2') return 'balloon';
        if (category === 'B4') return 'light';        // Ultralight
        if (category === 'B6') return 'light';        // UAV/drone

        // C-series: Ground vehicles
        if (category === 'C0') return 'ground_vehicle';
        if (category === 'C1') return 'ground_vehicle';  // Emergency
        if (category === 'C2') return 'ground_vehicle';  // Service
        if (category === 'C3') return 'tower';           // Tower
    }

    // Additional type detection patterns
    if (typeCode) {
        // Helicopters
        if (typeCode.startsWith('H') || typeCode.includes('HELI') ||
            typeCode.startsWith('R22') || typeCode.startsWith('R44') ||
            typeCode.startsWith('EC1') || typeCode.startsWith('AS3')) {
            return 'helicopter';
        }

        // Light aircraft patterns
        if (typeCode.startsWith('C1') || typeCode.startsWith('PA') ||
            typeCode.startsWith('BE') || typeCode.startsWith('SR2') ||
            typeCode.startsWith('DA4') || typeCode.startsWith('RV') ||
            typeCode.includes('VANS') || typeCode.startsWith('LONG') ||
            typeCode.startsWith('GLASAIR') || typeCode.startsWith('LANCAIR')) {
            return 'light';
        }

        // Turboprops
        if (typeCode.startsWith('AT') || typeCode.startsWith('DH8') ||
            typeCode.includes('TURBO')) {
            return 'turboprop';
        }

        // Military fighters
        if (typeCode.startsWith('F') && typeCode.length <= 4 &&
            /^F\d/.test(typeCode)) {
            return 'fighter';
        }

        // Wide-body detection
        if (typeCode.startsWith('A33') || typeCode.startsWith('A34') ||
            typeCode.startsWith('A35') || typeCode.startsWith('B77') ||
            typeCode.startsWith('B78')) {
            return 'heavy_2e';
        }

        // Four-engine detection
        if (typeCode.startsWith('A38') || typeCode.startsWith('B74')) {
            return 'heavy_4e';
        }
    }

    // Default to generic airliner for unknown types
    return 'airliner';
}

// ============================================================================
// HISTORICAL MODE FUNCTIONS
// ============================================================================

// Load historical tracks from Track API
async function loadHistoricalData() {
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
        let apiUrl = `/api/tracks/bulk/timelapse?start=${startTime.toISOString()}&end=${endTime.toISOString()}&max_tracks=${maxTracks}&resolution=full`;

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
        URLState.updateFromCurrentState();

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
 * Properly dispose of a Three.js geometry with GPU resource cleanup
 * Prevents memory leaks by clearing attribute arrays before disposal
 * @param {THREE.BufferGeometry} geometry - The geometry to dispose
 */
function disposeGeometry(geometry) {
    if (!geometry) return;

    // Clear buffer attribute arrays to free GPU memory
    if (geometry.attributes) {
        Object.keys(geometry.attributes).forEach(key => {
            const attr = geometry.attributes[key];
            if (attr && attr.array) {
                attr.array = null;
            }
        });
    }

    // Dispose the geometry itself
    geometry.dispose();
}

/**
 * Properly dispose of a Three.js material
 * @param {THREE.Material} material - The material to dispose
 */
function disposeMaterial(material) {
    if (!material) return;

    // Dispose any textures
    if (material.map) material.map.dispose();
    if (material.lightMap) material.lightMap.dispose();
    if (material.bumpMap) material.bumpMap.dispose();
    if (material.normalMap) material.normalMap.dispose();
    if (material.specularMap) material.specularMap.dispose();
    if (material.envMap) material.envMap.dispose();

    // Dispose the material itself
    material.dispose();
}

// Clear all trails from the scene (used when loading recent trails)
function clearAllTrails() {
    trails.forEach((trail, icao) => {
        // Remove trail line
        if (trail.line) {
            scene.remove(trail.line);
            disposeGeometry(trail.line.geometry);
            disposeMaterial(trail.line.material);
        }
        // Remove Tron curtain if present
        if (trail.tronCurtain) {
            scene.remove(trail.tronCurtain);
            disposeGeometry(trail.tronCurtain.geometry);
            disposeMaterial(trail.tronCurtain.material);
        }
    });
    trails.clear();

    // AGGRESSIVE CLEANUP: Find and remove any orphaned Tron curtains in the scene
    // This catches curtains that may have lost their trail reference
    const orphanedCurtains = [];
    scene.traverse((child) => {
        if (child.userData && child.userData.isTronCurtain) {
            orphanedCurtains.push(child);
        }
    });

    if (orphanedCurtains.length > 0) {
        // console.log(`[RecentTrails] Found ${orphanedCurtains.length} orphaned Tron curtains, removing...`);
        orphanedCurtains.forEach(curtain => {
            scene.remove(curtain);
            disposeGeometry(curtain.geometry);
            disposeMaterial(curtain.material);
        });
    }

    // console.log('[RecentTrails] All trails cleared (including Tron curtains)');
}

// Clean up old trail positions based on auto-fade settings
function cleanupOldTrailPositions() {
    if (!autoFadeTrails || trailFadeTime === 0) {
        return; // Auto-fade disabled or set to "Never"
    }

    const now = Date.now();
    const fadeStartTime = trailFadeTime * 1000; // Convert seconds to milliseconds
    const fadeWindow = fadeStartTime * 0.2; // 20% of fade time for gradual fade
    const removeThreshold = now - fadeStartTime - fadeWindow;
    const fadeThreshold = now - fadeStartTime;

    let totalRemoved = 0;
    let trailsModified = 0;

    // Clean up active trails
    trails.forEach((trail, hex) => {
        if (!trail.positions || trail.positions.length === 0) return;

        const originalLength = trail.positions.length;

        // Filter out positions older than remove threshold
        trail.positions = trail.positions.filter(pos => {
            return pos.timestamp && pos.timestamp > removeThreshold;
        });

        const removedCount = originalLength - trail.positions.length;
        if (removedCount > 0) {
            totalRemoved += removedCount;
            trailsModified++;

            // Rebuild trail geometry if positions were removed
            if (trail.positions.length > 0) {
                rebuildTrailGeometry(hex, trail);
            } else {
                // All positions removed - remove trail entirely
                if (trail.line) {
                    scene.remove(trail.line);
                    disposeGeometry(trail.line.geometry);
                    disposeMaterial(trail.line.material);
                }
                if (trail.tronCurtain) {
                    scene.remove(trail.tronCurtain);
                    disposeGeometry(trail.tronCurtain.geometry);
                    disposeMaterial(trail.tronCurtain.material);
                }
                trails.delete(hex);
            }
        }
    });

    // Clean up stale trails
    staleTrails.forEach((trail, hex) => {
        if (!trail.positions || trail.positions.length === 0) return;

        const originalLength = trail.positions.length;

        trail.positions = trail.positions.filter(pos => {
            return pos.timestamp && pos.timestamp > removeThreshold;
        });

        const removedCount = originalLength - trail.positions.length;
        if (removedCount > 0) {
            totalRemoved += removedCount;
            trailsModified++;

            if (trail.positions.length === 0) {
                // Remove stale trail entirely
                if (trail.line) {
                    scene.remove(trail.line);
                    disposeGeometry(trail.line.geometry);
                    disposeMaterial(trail.line.material);
                }
                if (trail.gapLine) {
                    scene.remove(trail.gapLine);
                    disposeGeometry(trail.gapLine.geometry);
                    disposeMaterial(trail.gapLine.material);
                }
                if (trail.tronCurtain) {
                    scene.remove(trail.tronCurtain);
                    disposeGeometry(trail.tronCurtain.geometry);
                    disposeMaterial(trail.tronCurtain.material);
                }
                staleTrails.delete(hex);
            }
        }
    });

    if (totalRemoved > 0) {
        console.log(`[TrailFade] Cleaned up ${totalRemoved} old positions from ${trailsModified} trails`);
    }
}

// Rebuild trail line geometry after removing old positions
function rebuildTrailGeometry(hex, trail) {
    if (!trail.line || trail.positions.length === 0) return;

    // Create new geometry with remaining positions
    const positions = [];
    const colors = [];

    trail.positions.forEach(pos => {
        positions.push(pos.x, pos.y, pos.z);

        // Use color based on current trail color mode
        let colorValue;
        if (trailColorMode === 'speed') {
            colorValue = getSpeedColor(pos.groundSpeed || 0);
        } else {
            colorValue = getAltitudeColor(pos.y);
        }
        const rgb = new THREE.Color(colorValue);
        colors.push(rgb.r, rgb.g, rgb.b);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Dispose old geometry and update
    disposeGeometry(trail.line.geometry);
    trail.line.geometry = geometry;

    // Rebuild Tron curtain if it exists
    if (showTronMode && trail.tronCurtain) {
        // Remove old curtain
        scene.remove(trail.tronCurtain);
        disposeGeometry(trail.tronCurtain.geometry);
        disposeMaterial(trail.tronCurtain.material);
        trail.tronCurtain = null;

        // Rebuild curtain with remaining positions
        updateTronCurtain(trail);
    }
}

// Validate fade time vs preload time and show warning if needed
function validateFadePreloadConflict() {
    // Only validate if both features are enabled
    if (!autoFadeTrails || trailFadeTime === 0 || !RecentTrailsState.enabled) {
        return;
    }

    const fadeMinutes = trailFadeTime / 60;
    const preloadMinutes = RecentTrailsState.minutes;

    if (fadeMinutes < preloadMinutes) {
        const message = `⚠️ Trail fade time (${fadeMinutes}min) is less than preload duration (${preloadMinutes}min). Older trails will disappear before the full preload period.`;
        showNotification(message, 'warning', 8000);
        console.warn(`[TrailFade] Conflict detected: fade=${fadeMinutes}min, preload=${preloadMinutes}min`);
    }
}

// Show notification message to user
function showNotification(message, type = 'info', duration = 5000) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: ${type === 'warning' ? 'rgba(255, 193, 7, 0.95)' : 'rgba(68, 138, 255, 0.95)'};
        color: ${type === 'warning' ? '#000' : '#fff'};
        padding: 15px 25px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        font-size: 13px;
        z-index: 10000;
        max-width: 500px;
        text-align: center;
        animation: slideDown 0.3s ease-out;
    `;
    notification.innerHTML = message;

    document.body.appendChild(notification);

    // Auto-remove after duration
    setTimeout(() => {
        notification.style.animation = 'slideUp 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, duration);
}

// Load recent trails for live mode (last X minutes)
async function loadRecentTrails() {
    if (!RecentTrailsState.enabled) {
        console.log('[RecentTrails] Feature not enabled');
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
        // Update status
        const statusDiv = document.getElementById('recent-trails-status');
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
        const statusDiv = document.getElementById('recent-trails-status');
        if (statusDiv) {
            statusDiv.innerHTML = `❌ Failed to load recent trails: ${error.message}`;
            statusDiv.className = 'historical-status error';
        }
    } finally {
        // Always clear loading flag, even on error
        RecentTrailsState.loading = false;
    }
}

// Add recent historical trails to live mode
function addRecentTrailsToLiveMode(tracks) {
    console.log(`[RecentTrails] Adding ${tracks.length} tracks to live mode`);

    tracks.forEach(track => {
        const icao = track.hex || track.icao;
        if (!icao) return;

        // Skip tracks with too few positions
        if (!track.positions || track.positions.length < 2) {
            console.log(`[RecentTrails] Skipping ${icao} - insufficient positions (${track.positions?.length || 0})`);
            return;
        }

        // Smooth altitudes
        const smoothedPositions = smoothAltitudes(track.positions);

        // Create NEW trail for this aircraft (trails were cleared before calling this function)
        const trail = {
            positions: [],
            line: null,
            material: null,
            lastUpdate: Date.now()
        };

        // Convert positions to 3D coordinates using SAME functions as live updates
        smoothedPositions.forEach(pos => {
            // Validate position data
            const lat = pos.lat || pos.latitude;
            const lon = pos.lon || pos.longitude;
            const alt = pos.alt || pos.altitude || 0;

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
            const posTimestamp = pos.timestamp ? new Date(pos.timestamp).getTime() : Date.now();
            const groundSpeed = pos.speed || pos.gs || 0;
            trail.positions.push({
                x: posXZ.x,
                y: Math.max(1.0, altitude),
                z: posXZ.z,
                altFeet: alt,
                groundSpeed: groundSpeed,
                timestamp: posTimestamp
            });
        });

        // Only save trail if we have enough valid positions
        if (trail.positions.length >= 2) {
            trails.set(icao, trail);
            RecentTrailsState.icaos.add(icao);

            // DEBUG: Log timestamp range for verification
            if (trail.positions.length > 0) {
                const firstTs = trail.positions[0].timestamp;
                const lastTs = trail.positions[trail.positions.length - 1].timestamp;
                const ageMinutes = ((Date.now() - firstTs) / 1000 / 60).toFixed(1);
                console.log(`[RecentTrails] ${icao}: ${trail.positions.length} positions, oldest=${ageMinutes}min ago`);
            }
        } else {
            console.log(`[RecentTrails] Skipping ${icao} - only ${trail.positions.length} valid positions`);
        }
    });

    // Render trails for all aircraft with new data
    trails.forEach((trail, icao) => {
        if (trail.positions.length > 1 && !trail.line) {
            // Create the trail line geometry if it doesn't exist
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

            // Update trail object with line and capacity
            trail.line = line;
            trail.capacity = initialCapacity;

            // Create Tron curtain if Tron mode is enabled
            if (showTronMode && trail.positions.length >= 2) {
                updateTronCurtain(trail);
            }
        }
    });

    console.log(`[RecentTrails] Added trails for ${tracks.length} aircraft`);
}

// Render historical tracks in 3D scene
function renderHistoricalTracks() {
    console.log(`[Historical] Rendering ${HistoricalState.tracks.length} tracks`);

    // Create InstancedMesh for endpoints (1 per track at the end only)
    const maxInstances = HistoricalState.tracks.length;

    // Instead of using InstancedMesh (which has color issues), create individual sphere meshes
    // This is more reliable and still performant for a few hundred endpoints
    HistoricalState.endpointMeshes = [];  // Store individual meshes instead

    console.log(`[Historical] Will create ${maxInstances} individual endpoint spheres`);

    // Render each track
    HistoricalState.tracks.forEach(track => {
        createHistoricalTrack(track);
    });

    console.log(`[Historical] Rendered ${HistoricalState.tracks.length} tracks with ${HistoricalState.endpointMeshes.length} endpoint spheres`);
    console.log(`[Historical] Scene now has ${scene.children.length} children`);
}

// Create a single historical track
function createHistoricalTrack(track) {
    if (!track.positions || track.positions.length === 0) {
        console.log('[Historical] Skipping track (no positions):', track.hex || track.icao);
        return;
    }

    const isMilitary = track.is_military || false;
    console.log(`[Historical] Creating track for ${track.hex || track.icao} (${track.positions.length} positions, military: ${isMilitary})`);

    // Smooth altitude anomalies
    const smoothedPositions = smoothAltitudes(track.positions);

    // Create trail line with gradient colors
    const points = [];
    const colors = [];

    smoothedPositions.forEach(pos => {
        // Convert lat/lon to scene coordinates using SAME functions as live mode
        const lat = pos.lat || pos.latitude;
        const lon = pos.lon || pos.longitude;
        const alt = pos.alt || pos.altitude || 0;
        const speed = pos.speed || pos.gs || 0;

        // Use the same coordinate conversion as live mode (latLonToXZ function)
        const posXZ = latLonToXZ(lat, lon);

        // Use the same altitude calculation as live mode
        const altitude = (alt - CONFIG.homeLocation.alt) * 0.3048 * CONFIG.scale * CONFIG.altitudeExaggeration;
        const y = Math.max(1.0, altitude);  // Same minimum as live mode

        points.push(new THREE.Vector3(posXZ.x, y, posXZ.z));

        // Get color based on current mode (altitude or speed)
        let colorValue;
        if (isMilitary) {
            colorValue = CONFIG.militaryColor;
        } else if (trailColorMode === 'speed') {
            colorValue = getSpeedColor(speed);
        } else {
            colorValue = getAltitudeColor(y);
        }
        const color = new THREE.Color(colorValue);
        colors.push(color.r, color.g, color.b);
    });

    if (points.length > 1) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            opacity: 0.9,
            transparent: true,
            linewidth: 3  // Note: linewidth > 1 only works in WebGL with special rendering
        });

        const line = new THREE.Line(geometry, material);
        line.visible = true;  // Make tracks visible by default

        // Add userData for click detection and info display
        line.userData = {
            isHistoricalTrack: true,
            icao: track.hex || track.icao,
            track: track,  // Store full track data
            isMilitary: isMilitary,
            originalColors: new Float32Array(colors)  // Store original colors for hover restore
        };

        scene.add(line);

        // Debug: Log first point position to verify coordinates
        if (points.length > 0) {
            console.log(`[Historical] Track ${track.hex || track.icao} first point:`, {
                x: points[0].x.toFixed(2),
                y: points[0].y.toFixed(2),
                z: points[0].z.toFixed(2),
                pointCount: points.length
            });
        }

        // Add endpoint marker at the END of the track only
        const instanceIndices = [];

        // End point - create individual sphere mesh
        const endPoint = points[points.length - 1];
        const endColorIndex = (points.length - 1) * 3;
        const endColor = new THREE.Color(colors[endColorIndex], colors[endColorIndex + 1], colors[endColorIndex + 2]);

        // Create individual sphere mesh with altitude-based color
        const endpointGeometry = new THREE.SphereGeometry(1.0, 8, 6); // Slightly larger to fully cover line endpoint
        const endpointMaterial = new THREE.MeshBasicMaterial({
            color: endColor,
            transparent: true,
            opacity: 0.9
        });
        const endpointMesh = new THREE.Mesh(endpointGeometry, endpointMaterial);
        endpointMesh.position.set(endPoint.x, endPoint.y, endPoint.z);

        // Store reference to track line and original color for hover effects
        const lastPos = smoothedPositions[smoothedPositions.length - 1];
        const lastAltFeet = lastPos.alt || lastPos.altitude || 0;
        endpointMesh.userData = {
            isHistoricalEndpoint: true,
            trackLine: line,
            originalColor: endColor.clone(),
            icao: track.hex || track.icao,
            track: track,
            altFeet: lastAltFeet  // Store altitude for rescaling
        };

        // Add to scene and store reference
        scene.add(endpointMesh);
        HistoricalState.endpointMeshes.push(endpointMesh);

        // Store reference for this track
        instanceIndices.push(HistoricalState.endpointMeshes.length - 1);

        // DON'T update here - wait until all tracks are added

        console.log(`[Historical] Added track line to scene for ${track.hex || track.icao} (${points.length} points, 1 endpoint)`);

        // Create trail object for Tron curtains (if enabled)
        const trail = {
            positions: points.map((p, i) => ({
                x: p.x,
                y: p.y,
                z: p.z,
                altFeet: smoothedPositions[i].alt || smoothedPositions[i].altitude || 0,
                groundSpeed: smoothedPositions[i].speed || smoothedPositions[i].gs || 0,
                timestamp: smoothedPositions[i].time ? new Date(smoothedPositions[i].time).getTime() : null
            })),
            tronCurtain: null  // Will be populated by updateTronCurtain
        };

        // Create Tron curtain if enabled
        if (showTronMode) {
            updateTronCurtain(trail);
        }

        // Store track mesh with endpoint mesh reference and trail object
        HistoricalState.trackMeshes.set(track.hex || track.icao, {
            line,
            points,
            track,
            instanceIndices,  // Store endpoint mesh indices
            endpointMesh,     // Store reference to the endpoint sphere mesh
            trail             // Store trail object for Tron curtains
        });
    } else {
        console.log(`[Historical] Not enough points to create line (${points.length})`);
    }
}

/**
 * Generate flight corridor visualization from historical tracks
 * Creates glowing tubes along actual flight paths showing traffic density
 * @returns {void}
 */
function generateFlightCorridors() {
    console.log('[HeatMap] Generating grid-based heat map with absolute thresholds');

    // Show funny loading message
    const statusDiv = document.getElementById('historical-status');
    if (statusDiv) {
        const funnyMessages = [
            '🔥 Calculating airplane spaghetti density...',
            '🌡️ Measuring sky congestion temperature...',
            '✈️ Counting how many planes tried to occupy the same spot...',
            '🧮 Computing flight path chaos coefficient...',
            '🎨 Mixing flight path colors in 3D blender...',
            '📐 Triangulating aerial traffic jams...',
            '🌈 Generating pretty colored clouds from boring data...',
            '🔬 Analyzing airspace overcrowding syndrome...',
            '🎯 Finding the busiest spot in the sky...',
            '🌀 Swirling flight paths into volumetric fog...'
        ];
        const randomMessage = funnyMessages[Math.floor(Math.random() * funnyMessages.length)];
        statusDiv.innerHTML = `<div class="spinner"></div><span>${randomMessage}</span>`;
        statusDiv.className = 'historical-status loading';
    }

    clearFlightCorridors();

    if (!HistoricalState.tracks || HistoricalState.tracks.length === 0) {
        console.log('[HeatMap] No tracks available');
        return;
    }

    const startTime = performance.now();

    // Step 1: Build spatial density map (count UNIQUE aircraft per cell, not positions)
    const gridSize = 8;  // 8 scene units (~8km) for density sampling
    const densityMap = new Map();  // Map of gridKey -> Set<hex>

    HistoricalState.tracks.forEach(track => {
        if (!track.positions || track.positions.length === 0) return;

        const aircraftHex = track.hex || track.icao || 'unknown';  // Unique aircraft ID

        track.positions.forEach(pos => {
            const lat = pos.lat || pos.latitude;
            const lon = pos.lon || pos.longitude;
            const alt = pos.alt || pos.altitude;

            if (lat == null || lon == null || alt == null) return;

            const scenePos = latLonToXZ(lat, lon);
            const altitude = (alt - CONFIG.homeLocation.alt) * 0.3048 * CONFIG.scale * CONFIG.altitudeExaggeration;
            const y = Math.max(1.0, altitude);

            // Snap to grid for density counting
            const gridX = Math.floor(scenePos.x / gridSize);
            const gridY = Math.floor(y / gridSize);
            const gridZ = Math.floor(scenePos.z / gridSize);
            const gridKey = `${gridX},${gridY},${gridZ}`;

            // Add unique aircraft to this cell's set
            if (!densityMap.has(gridKey)) {
                densityMap.set(gridKey, new Set());
            }
            densityMap.get(gridKey).add(aircraftHex);
        });
    });

    console.log(`[HeatMap] Density map: ${densityMap.size} cells with unique aircraft counts`);

    // Step 2: Create particles along actual flight paths
    const positions = [];
    const colors = [];
    const sizes = [];
    let particleCount = 0;

    HistoricalState.tracks.forEach(track => {
        if (!track.positions || track.positions.length === 0) return;

        // Sample every Nth position along path
        const sampleInterval = Math.max(3, Math.floor(track.positions.length / 50));

        track.positions.forEach((pos, index) => {
            if (index % sampleInterval !== 0) return;

            const lat = pos.lat || pos.latitude;
            const lon = pos.lon || pos.longitude;
            const alt = pos.alt || pos.altitude;

            if (lat == null || lon == null || alt == null) return;

            const scenePos = latLonToXZ(lat, lon);
            const altitude = (alt - CONFIG.homeLocation.alt) * 0.3048 * CONFIG.scale * CONFIG.altitudeExaggeration;
            const y = Math.max(1.0, altitude);

            // Look up UNIQUE AIRCRAFT count at this position
            const gridX = Math.floor(scenePos.x / gridSize);
            const gridY = Math.floor(y / gridSize);
            const gridZ = Math.floor(scenePos.z / gridSize);
            const gridKey = `${gridX},${gridY},${gridZ}`;
            const aircraftSet = densityMap.get(gridKey);
            const uniqueAircraft = aircraftSet ? aircraftSet.size : 1;

            // ABSOLUTE THRESHOLDS based on unique aircraft count
            // This prevents single flights from appearing "hot"
            let normalizedDensity;
            let color;

            if (uniqueAircraft === 1) {
                // Single aircraft: invisible
                return;  // Skip rendering - too isolated
            } else if (uniqueAircraft < 4) {
                // 2-3 aircraft: Light traffic, blue
                normalizedDensity = 0.2 + ((uniqueAircraft - 2) / 2) * 0.2;  // 0.2-0.4
                const t = (normalizedDensity - 0.2) / 0.2;
                color = new THREE.Color().lerpColors(
                    new THREE.Color(0x004488),  // Dark blue
                    new THREE.Color(0x0088ff),  // Blue
                    t
                );
            } else if (uniqueAircraft < 8) {
                // 4-7 aircraft: Moderate traffic, cyan-green
                normalizedDensity = 0.4 + ((uniqueAircraft - 4) / 4) * 0.25;  // 0.4-0.65
                const t = (normalizedDensity - 0.4) / 0.25;
                color = new THREE.Color().lerpColors(
                    new THREE.Color(0x0088ff),  // Blue
                    new THREE.Color(0x00ff88),  // Cyan-green
                    t
                );
            } else if (uniqueAircraft < 15) {
                // 8-14 aircraft: High traffic, yellow
                normalizedDensity = 0.65 + ((uniqueAircraft - 8) / 7) * 0.2;  // 0.65-0.85
                const t = (normalizedDensity - 0.65) / 0.2;
                color = new THREE.Color().lerpColors(
                    new THREE.Color(0x00ff88),  // Cyan-green
                    new THREE.Color(0xffff00),  // Yellow
                    t
                );
            } else {
                // 15+ aircraft: Very high traffic, red
                normalizedDensity = 0.85 + Math.min(0.15, (uniqueAircraft - 15) / 30);  // 0.85-1.0
                const t = (normalizedDensity - 0.85) / 0.15;
                color = new THREE.Color().lerpColors(
                    new THREE.Color(0xffff00),  // Yellow
                    new THREE.Color(0xff0000),  // Red
                    t
                );
            }

            // Add small random offset
            const offsetX = (Math.random() - 0.5) * 2.0;
            const offsetY = (Math.random() - 0.5) * 1.0;
            const offsetZ = (Math.random() - 0.5) * 2.0;

            positions.push(scenePos.x + offsetX, y + offsetY, scenePos.z + offsetZ);
            colors.push(color.r, color.g, color.b);

            // Particle size based on density
            const baseSize = 20.0 + normalizedDensity * 80.0;  // 20-100 scene units
            const sizeVariation = (Math.random() - 0.5) * 20.0;
            sizes.push(baseSize + sizeVariation);

            particleCount++;
        });
    });

    // Create BufferGeometry with attributes
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

    // Custom shader material for soft glowing particles
    // TODO: Improve blending to prevent see-through effect (red shows blue behind it)
    // Attempted solutions that didn't work:
    // - depthWrite: true -> Creates shiny bubble appearance
    // - AdditiveBlending -> Colors wash to white in dense areas
    // - MaxEquation -> Looks strange/unnatural
    // Current compromise: Normal blending with see-through (best visual, but not perfect depth)
    const material = new THREE.ShaderMaterial({
        uniforms: {
            baseOpacity: { value: 0.6 }  // Moderate opacity for fog-like appearance
        },
        vertexShader: `
            attribute float size;
            varying vec3 vColor;

            void main() {
                vColor = color;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * (300.0 / -mvPosition.z);  // Size attenuation
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform float baseOpacity;
            varying vec3 vColor;

            void main() {
                // Calculate distance from center of point
                vec2 center = gl_PointCoord - vec2(0.5);
                float dist = length(center);

                // Soft circular gradient for fog-like blending
                float alpha = 1.0 - smoothstep(0.0, 0.5, dist);

                // Gentle power curve for soft fog appearance
                alpha = pow(alpha, 2.2);

                // Multiply by base opacity
                alpha *= baseOpacity;

                // Discard very transparent pixels to reduce overdraw
                if (alpha < 0.02) discard;

                // Output color with radial alpha falloff
                gl_FragColor = vec4(vColor, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,  // Disable to allow soft blending (but causes see-through)
        depthTest: true,    // Keep particles behind aircraft
        blending: THREE.NormalBlending,
        vertexColors: true
    });

    const particles = new THREE.Points(geometry, material);
    particles.renderOrder = 50;  // Render before aircraft
    particles.userData = { isHeatMapParticles: true };

    scene.add(particles);
    HistoricalState.heatmapMeshes.push(particles);

    const elapsed = (performance.now() - startTime).toFixed(2);
    console.log(`[HeatMap] ========================================`);
    console.log(`[HeatMap] Unique aircraft heat map: ${particleCount} particles in ${elapsed}ms`);
    console.log(`[HeatMap] Grid size: ${gridSize} scene units (~${gridSize}km)`);
    console.log(`[HeatMap] Color based on UNIQUE AIRCRAFT per cell:`);
    console.log(`[HeatMap]   Invisible      = 1 aircraft (single flight)`);
    console.log(`[HeatMap]   🔵 BLUE        = 2-3 aircraft (light traffic)`);
    console.log(`[HeatMap]   🟢 GREEN       = 4-7 aircraft (moderate traffic)`);
    console.log(`[HeatMap]   🟡 YELLOW      = 8-14 aircraft (high traffic)`);
    console.log(`[HeatMap]   🔴 RED         = 15+ aircraft (very high traffic)`);
    console.log(`[HeatMap] Particle size: 20-100 units (scales with density)`);
    console.log(`[HeatMap] ========================================`);

    // Update status with completion message
    if (statusDiv) {
        statusDiv.innerHTML = `✓ Heat map ready! ${particleCount.toLocaleString()} particles generated in ${elapsed}ms`;
        statusDiv.className = 'historical-status success';
    }
}

/**
 * Simplify corridor path by averaging nearby points
 * @param {THREE.Vector3[]} points - Array of 3D points
 * @param {number} groupDistance - Distance threshold for grouping points (in scene units)
 * @returns {THREE.Vector3[]} Simplified array of points
 */
function simplifyCorridorPath(points, groupDistance) {
    if (points.length === 0) return [];

    const simplified = [];
    const used = new Set();

    for (let i = 0; i < points.length; i++) {
        if (used.has(i)) continue;

        const group = [points[i]];
        used.add(i);

        // Find all nearby points
        for (let j = i + 1; j < points.length; j++) {
            if (used.has(j)) continue;

            const dist = points[i].distanceTo(points[j]);
            if (dist < groupDistance) {
                group.push(points[j]);
                used.add(j);
            }
        }

        // Average the group to create a single point
        const avgPoint = new THREE.Vector3();
        group.forEach(p => avgPoint.add(p));
        avgPoint.divideScalar(group.length);
        simplified.push(avgPoint);
    }

    return simplified;
}

/**
 * Get color for heat map based on density
 * Blue (low) → Green → Yellow → Red (high)
 * @param {number} normalizedDensity - Value from 0 to 1 (0 = low, 1 = high)
 * @returns {number} Three.js hex color
 */
function getDensityColor(normalizedDensity) {
    // Simplified color scale with MAXIMUM contrast for visibility
    // Blue (low) → Green (medium) → Yellow → Orange → Red (high)
    // Using pure, vibrant colors that are easy to distinguish

    if (normalizedDensity <= 0.2) {
        // Deep Blue (very low density)
        return 0x0000FF;  // Pure blue
    } else if (normalizedDensity <= 0.4) {
        // Cyan to Green (low-medium density)
        return 0x00FFFF;  // Pure cyan
    } else if (normalizedDensity <= 0.6) {
        // Green (medium density)
        return 0x00FF00;  // Pure green
    } else if (normalizedDensity <= 0.8) {
        // Yellow to Orange (medium-high density)
        return 0xFFFF00;  // Pure yellow
    } else {
        // Red (high density)
        return 0xFF0000;  // Pure red
    }
}

/**
 * Clear all flight corridor meshes from scene
 * @returns {void}
 */
function clearFlightCorridors() {
    HistoricalState.heatmapMeshes.forEach(mesh => {
        scene.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
    });
    HistoricalState.heatmapMeshes = [];
    console.log('[Corridors] Cleared flight corridors');
}

// Alias for backward compatibility
function clearHeatMap() {
    clearFlightCorridors();
}

/**
 * Show or hide all historical track lines
 * @param {boolean} visible - Whether tracks should be visible
 * @returns {void}
 */
function showHistoricalTracks(visible) {
    HistoricalState.trackMeshes.forEach(({line}) => {
        if (line) line.visible = visible;
    });

    // Also handle endpoint spheres
    if (HistoricalState.endpointMeshes) {
        HistoricalState.endpointMeshes.forEach(mesh => {
            mesh.visible = visible;
        });
    }

    console.log(`[HeatMap] Historical tracks visible: ${visible}`);
}

/**
 * Show or hide heat map visualization
 * @param {boolean} visible - Whether heat map should be visible
 * @returns {void}
 */
function setHeatMapVisibility(visible) {
    HistoricalState.heatmapMeshes.forEach(mesh => {
        mesh.visible = visible;
    });
    console.log(`[HeatMap] Heat map visible: ${visible}`);
}

// Clear all historical tracks from scene
function clearHistoricalTracks() {
    console.log('[Historical] Clearing tracks');

    // Remove all track lines and Tron curtains
    let linesRemoved = 0;
    let curtainsRemoved = 0;
    HistoricalState.trackMeshes.forEach(({line, trail}) => {
        if (line) {
            scene.remove(line);
            if (line.geometry) line.geometry.dispose();
            if (line.material) line.material.dispose();
            linesRemoved++;
        }
        // Remove Tron curtain if present
        if (trail && trail.tronCurtain) {
            scene.remove(trail.tronCurtain);
            if (trail.tronCurtain.geometry) trail.tronCurtain.geometry.dispose();
            if (trail.tronCurtain.material) trail.tronCurtain.material.dispose();
            trail.tronCurtain = null;
            curtainsRemoved++;
        }
    });
    console.log(`[Historical] Removed ${linesRemoved} track lines and ${curtainsRemoved} Tron curtains from scene`);

    // Remove individual endpoint spheres
    if (HistoricalState.endpointMeshes) {
        HistoricalState.endpointMeshes.forEach(mesh => {
            scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        });
        console.log(`[Historical] Removed ${HistoricalState.endpointMeshes.length} endpoint spheres`);
        HistoricalState.endpointMeshes = [];
    }

    HistoricalState.trackMeshes.clear();
    HistoricalState.tracks = [];

    // Clear heat map
    clearHeatMap();

    console.log('[Historical] Cleanup complete');
}

// Apply filters to loaded historical tracks
function applyHistoricalFilters() {
    console.log('[Historical] Applying filters');

    // Get filter values
    const militaryOnly = document.getElementById('filter-military-only').checked;
    const altMinInput = document.getElementById('filter-altitude-min');
    const altMaxInput = document.getElementById('filter-altitude-max');
    const minPosInput = document.getElementById('filter-min-positions');
    const spdMinInput = document.getElementById('filter-speed-min');
    const spdMaxInput = document.getElementById('filter-speed-max');

    const minAlt = parseInt(altMinInput?.value) || 0;
    const maxAlt = parseInt(altMaxInput?.value) || 999999;
    const minPositions = parseInt(minPosInput?.value) || 0;
    const minSpeed = parseInt(spdMinInput?.value) || 0;
    const maxSpeed = parseInt(spdMaxInput?.value) || 999999;

    // Debug: Log raw input values to help troubleshoot
    console.log('[Historical] DOM input values:', {
        'filter-altitude-min': altMinInput?.value,
        'filter-altitude-max': altMaxInput?.value,
        'filter-min-positions': minPosInput?.value,
        'filter-speed-min': spdMinInput?.value,
        'filter-speed-max': spdMaxInput?.value
    });

    console.log('[Historical] Parsed filter settings:', { militaryOnly, minAlt, maxAlt, minPositions, minSpeed, maxSpeed });

    let visibleCount = 0;
    let hiddenCount = 0;
    let filterBreakdown = {
        military: 0,
        minPositions: 0,
        altitude: 0,
        speed: 0
    };

    // Apply filters to each track mesh
    HistoricalState.trackMeshes.forEach(({ line, points, track, instanceIndices, endpointMesh, trail }, icao) => {
        let visible = true;

        // Military filter
        if (militaryOnly && !track.is_military) {
            visible = false;
            filterBreakdown.military++;
        }

        // Minimum positions filter
        if (track.positions && track.positions.length < minPositions) {
            visible = false;
            filterBreakdown.minPositions++;
        }

        // Altitude filter (exclude if ANY position is outside range)
        if (track.positions && track.positions.length > 0) {
            const altitudeList = track.positions.map(p => p.alt || p.altitude || 0);
            const altMin = Math.min(...altitudeList);
            const altMax = Math.max(...altitudeList);
            const allAltitudesInRange = track.positions.every(pos => {
                const alt = pos.alt || pos.altitude || 0;
                return alt >= minAlt && alt <= maxAlt;
            });
            if (!allAltitudesInRange) {
                visible = false;
                filterBreakdown.altitude++;
                // Log first few failures for debugging
                if (filterBreakdown.altitude <= 3) {
                    console.log(`[Historical] Altitude filter rejected track: alt range ${altMin}-${altMax} not in ${minAlt}-${maxAlt}`);
                }
            }
        }

        // Speed filter (check if ALL positions have speed in range)
        if (track.positions && track.positions.length > 0) {
            const allSpeedsInRange = track.positions.every(pos => {
                const speed = pos.gs || pos.speed || 0;
                return speed >= minSpeed && speed <= maxSpeed;
            });
            if (!allSpeedsInRange) {
                visible = false;
                filterBreakdown.speed++;
            }
        }

        // Remove from scene or add to scene based on visibility
        // This frees GPU memory and reduces scene graph traversal overhead
        if (visible) {
            // Add to scene if not already present
            if (!line.parent) {
                scene.add(line);
            }
            if (endpointMesh && !endpointMesh.parent) {
                scene.add(endpointMesh);
            }
            // Add or create Tron curtain if enabled
            if (showTronMode && trail) {
                // Create curtain if it doesn't exist
                if (!trail.tronCurtain && trail.positions.length > 1) {
                    updateTronCurtain(trail);
                }
                // Add to scene if it exists but isn't in scene
                if (trail.tronCurtain && !trail.tronCurtain.parent) {
                    scene.add(trail.tronCurtain);
                }
            }
            visibleCount++;
        } else {
            // Remove from scene to free GPU memory
            if (line.parent) {
                scene.remove(line);
            }
            if (endpointMesh && endpointMesh.parent) {
                scene.remove(endpointMesh);
            }
            // Remove Tron curtain from scene but keep the reference
            // We keep the curtain object so it can be re-added if filters change
            if (trail && trail.tronCurtain && trail.tronCurtain.parent) {
                scene.remove(trail.tronCurtain);
            }
            hiddenCount++;
        }
    });

    console.log(`[Historical] Filters applied: ${visibleCount} visible, ${hiddenCount} hidden`);
    console.log('[Historical] Filter breakdown:', filterBreakdown);

    // Update status
    const statusDiv = document.getElementById('historical-status');
    const totalCount = visibleCount + hiddenCount;
    if (visibleCount === 0) {
        statusDiv.innerHTML = `⚠️ No tracks match filters (${totalCount} total loaded)`;
        statusDiv.className = 'historical-status warning';
    } else if (hiddenCount > 0) {
        statusDiv.innerHTML = `✓ Showing ${visibleCount}/${totalCount} tracks`;
        statusDiv.className = 'historical-status success';
    } else {
        statusDiv.innerHTML = `✓ Showing all ${totalCount} tracks`;
        statusDiv.className = 'historical-status success';
    }
}

// ============================================================================
// ============================================================================
// PLAYBACK ANIMATION FUNCTIONS
// ============================================================================

// Initialize playback after tracks are loaded
function initializePlayback() {
    console.log('[Playback] Initializing playback system');

    // Calculate time range from loaded tracks
    let earliestTime = Infinity;
    let latestTime = -Infinity;

    HistoricalState.tracks.forEach(track => {
        track.positions.forEach(pos => {
            const timestamp = new Date(pos.time).getTime();
            if (timestamp < earliestTime) earliestTime = timestamp;
            if (timestamp > latestTime) latestTime = timestamp;
        });
    });

    if (!isFinite(earliestTime) || !isFinite(latestTime)) {
        console.warn('[Playback] No valid timestamps found in tracks');
        return;
    }

    PlaybackState.startTimestamp = earliestTime;
    PlaybackState.endTimestamp = latestTime;
    PlaybackState.duration = (latestTime - earliestTime) / 1000; // Convert to seconds
    PlaybackState.currentTime = 0;

    console.log(`[Playback] Duration: ${PlaybackState.duration.toFixed(1)}s (${(PlaybackState.duration / 60).toFixed(1)} minutes)`);

    // Update UI
    document.getElementById('total-time-display').textContent = formatPlaybackTime(PlaybackState.duration);
    document.getElementById('timeline-scrubber').max = PlaybackState.duration;
    document.getElementById('playback-controls').style.display = 'block';

    // Initially hide all tracks and endpoints (they'll appear during playback)
    HistoricalState.trackMeshes.forEach(({ line, endpointMesh, trail }) => {
        line.visible = false;

        // Hide endpoint sphere
        if (endpointMesh) {
            endpointMesh.visible = false;
        }

        // Hide Tron curtain
        if (trail && trail.tronCurtain) {
            trail.tronCurtain.visible = false;
        }
    });
}

// Format time in HH:MM:SS
function formatPlaybackTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Start/stop playback
function togglePlayback() {
    if (PlaybackState.isPlaying) {
        pausePlayback();
    } else {
        startPlayback();
    }
}

function startPlayback() {
    PlaybackState.isPlaying = true;
    PlaybackState.lastFrameTime = performance.now();
    document.getElementById('play-pause-btn').textContent = 'Pause';
    document.getElementById('playback-status').textContent = 'Playing...';

    // Hide all tracks when entering playback mode - they'll animate based on timestamps
    HistoricalState.trackMeshes.forEach(({ line }) => {
        line.visible = false;
    });

    animatePlayback();
    console.log('[Playback] Started');
}

function pausePlayback() {
    PlaybackState.isPlaying = false;
    if (PlaybackState.animationFrameId) {
        cancelAnimationFrame(PlaybackState.animationFrameId);
        PlaybackState.animationFrameId = null;
    }
    document.getElementById('play-pause-btn').textContent = 'Play';
    document.getElementById('playback-status').textContent = 'Paused';
    console.log('[Playback] Paused');
}

function restartPlayback() {
    pausePlayback();
    PlaybackState.currentTime = 0;
    updatePlaybackPosition(0);
    console.log('[Playback] Restarted');
}

// Main animation loop
function animatePlayback() {
    if (!PlaybackState.isPlaying) return;

    const now = performance.now();
    const deltaTime = (now - PlaybackState.lastFrameTime) / 1000; // Convert to seconds
    PlaybackState.lastFrameTime = now;

    // Advance time by delta * speed
    PlaybackState.currentTime += deltaTime * PlaybackState.speed;

    // Loop back to start if we reach the end
    if (PlaybackState.currentTime >= PlaybackState.duration) {
        PlaybackState.currentTime = 0;
    }

    // Update visuals
    updatePlaybackPosition(PlaybackState.currentTime);

    // Continue animation
    PlaybackState.animationFrameId = requestAnimationFrame(animatePlayback);
}

// Update track visibility based on current playback time
function updatePlaybackPosition(currentTime) {
    const currentTimestamp = PlaybackState.startTimestamp + (currentTime * 1000);

    // Update UI
    document.getElementById('current-time-display').textContent = formatPlaybackTime(currentTime);
    document.getElementById('timeline-scrubber').value = currentTime;

    let visibleTracks = 0;

    // Show/hide tracks based on time
    HistoricalState.trackMeshes.forEach(({ line, points, track, endpointMesh, trail }, icao) => {
        if (!track.positions || track.positions.length === 0) return;

        // Find first and last positions within time window
        const firstPosTime = new Date(track.positions[0].time).getTime();
        const lastPosTime = new Date(track.positions[track.positions.length - 1].time).getTime();

        let isVisible = false;

        // Determine visibility based on fade setting
        if (PlaybackState.fadeAfter === 'never') {
            // Never fade: show track once current time passes its start time
            isVisible = currentTimestamp >= firstPosTime;
        } else {
            // Calculate fade window
            const fadeWindowMs = PlaybackState.fadeAfter * 1000;
            const fadeEndTime = lastPosTime + fadeWindowMs;

            // Track is visible if current time is within [start, end + fadeAfter]
            isVisible = currentTimestamp >= firstPosTime && currentTimestamp <= fadeEndTime;
        }

        if (isVisible) {
            line.visible = true;
            visibleTracks++;

            // Show endpoint sphere
            if (endpointMesh) {
                endpointMesh.visible = true;
            }

            // Show Tron curtain if enabled
            if (trail && trail.tronCurtain) {
                trail.tronCurtain.visible = true;
            }
        } else {
            line.visible = false;

            // Hide endpoint sphere
            if (endpointMesh) {
                endpointMesh.visible = false;
            }

            // Hide Tron curtain
            if (trail && trail.tronCurtain) {
                trail.tronCurtain.visible = false;
            }
        }
    });

    document.getElementById('playback-status').textContent = `${visibleTracks} aircraft visible`;
}

// Seek to specific time
function seekToTime(seconds) {
    PlaybackState.currentTime = Math.max(0, Math.min(seconds, PlaybackState.duration));
    updatePlaybackPosition(PlaybackState.currentTime);
}

// Setup playback control listeners
function setupPlaybackControls() {
    const playPauseBtn = document.getElementById('play-pause-btn');
    const restartBtn = document.getElementById('restart-btn');
    const speedSelect = document.getElementById('playback-speed');
    const scrubber = document.getElementById('timeline-scrubber');

    if (!playPauseBtn) {
        console.warn('[Playback] Playback controls not found');
        return;
    }

    // Load saved playback speed from localStorage
    const savedSpeed = SafeStorage.getItem('playbackSpeed');
    if (savedSpeed !== null) {
        PlaybackState.speed = parseFloat(savedSpeed);
        speedSelect.value = savedSpeed;
        console.log(`[Playback] Loaded saved speed: ${PlaybackState.speed}x`);
    }

    // Play/Pause
    playPauseBtn.addEventListener('click', togglePlayback);

    // Restart
    restartBtn.addEventListener('click', restartPlayback);

    // Speed change
    speedSelect.addEventListener('change', (e) => {
        PlaybackState.speed = parseFloat(e.target.value);
        console.log(`[Playback] Speed changed to ${PlaybackState.speed}x`);
        // Save to localStorage
        SafeStorage.setItem('playbackSpeed', PlaybackState.speed);
    });

    // Skip buttons
    const skipBack10m = document.getElementById('skip-back-10m');
    const skipBack1m = document.getElementById('skip-back-1m');
    const skipForward1m = document.getElementById('skip-forward-1m');
    const skipForward10m = document.getElementById('skip-forward-10m');

    if (skipBack10m) {
        skipBack10m.addEventListener('click', () => {
            const newTime = Math.max(0, PlaybackState.currentTime - 600); // 10 minutes = 600 seconds
            seekToTime(newTime);
            console.log(`[Playback] Skipped back 10m to ${formatPlaybackTime(newTime)}`);
        });
    }

    if (skipBack1m) {
        skipBack1m.addEventListener('click', () => {
            const newTime = Math.max(0, PlaybackState.currentTime - 60); // 1 minute = 60 seconds
            seekToTime(newTime);
            console.log(`[Playback] Skipped back 1m to ${formatPlaybackTime(newTime)}`);
        });
    }

    if (skipForward1m) {
        skipForward1m.addEventListener('click', () => {
            const newTime = Math.min(PlaybackState.duration, PlaybackState.currentTime + 60); // 1 minute = 60 seconds
            seekToTime(newTime);
            console.log(`[Playback] Skipped forward 1m to ${formatPlaybackTime(newTime)}`);
        });
    }

    if (skipForward10m) {
        skipForward10m.addEventListener('click', () => {
            const newTime = Math.min(PlaybackState.duration, PlaybackState.currentTime + 600); // 10 minutes = 600 seconds
            seekToTime(newTime);
            console.log(`[Playback] Skipped forward 10m to ${formatPlaybackTime(newTime)}`);
        });
    }

    // Timeline scrubber
    let isScrubbing = false;

    scrubber.addEventListener('mousedown', () => {
        isScrubbing = true;
        if (PlaybackState.isPlaying) {
            pausePlayback();
        }
    });

    scrubber.addEventListener('input', (e) => {
        if (isScrubbing) {
            seekToTime(parseFloat(e.target.value));
        }
    });

    scrubber.addEventListener('mouseup', () => {
        isScrubbing = false;
    });

    scrubber.addEventListener('change', (e) => {
        seekToTime(parseFloat(e.target.value));
    });

    // Fade tracks option
    const fadeTracksSelect = document.getElementById('fade-tracks');
    if (fadeTracksSelect) {
        fadeTracksSelect.addEventListener('change', (e) => {
            const value = e.target.value;
            if (value === 'never') {
                PlaybackState.fadeAfter = 'never';
                console.log('[Playback] Fade mode: Never (accumulate all tracks)');
            } else {
                PlaybackState.fadeAfter = parseInt(value, 10);
                console.log(`[Playback] Fade mode: ${PlaybackState.fadeAfter}s after track ends`);
            }

            // Update current display immediately
            updatePlaybackPosition(PlaybackState.currentTime);
        });
    }

    console.log('[Playback] Controls initialized');
}

// END PLAYBACK ANIMATION FUNCTIONS
// ============================================================================

// END HISTORICAL MODE FUNCTIONS
// ============================================================================

// Setup historical controls event handlers
function setupHistoricalControls() {
    const startTimeInput = document.getElementById('start-time');
    const endTimeInput = document.getElementById('end-time');
    const loadButton = document.getElementById('load-historical-data');
    const statusDiv = document.getElementById('historical-status');
    const customTimeRange = document.getElementById('custom-time-range');
    const timePresets = document.getElementsByName('time-preset');
    const filtersPanel = document.getElementById('historical-filters');
    const applyFiltersButton = document.getElementById('apply-filters');

    // Format dates for datetime-local input (YYYY-MM-DDTHH:MM)
    const formatDatetimeLocal = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    // Calculate time range based on preset selection
    const calculateTimeRange = (preset) => {
        const now = new Date();
        let hoursAgo;

        if (preset === 'custom') {
            return null; // User will set manually
        }

        hoursAgo = parseInt(preset, 10);
        const startTime = new Date(now.getTime() - (hoursAgo * 60 * 60 * 1000));
        return { startTime, endTime: now };
    };

    // Handle time preset changes
    timePresets.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const value = e.target.value;

            if (value === 'custom') {
                // Show custom time inputs
                customTimeRange.style.display = 'block';

                // Initialize with current values or last 1 hour
                if (!startTimeInput.value || !endTimeInput.value) {
                    const range = calculateTimeRange('1');
                    startTimeInput.value = formatDatetimeLocal(range.startTime);
                    endTimeInput.value = formatDatetimeLocal(range.endTime);
                }
            } else {
                // Hide custom inputs and calculate from preset
                customTimeRange.style.display = 'none';
                const range = calculateTimeRange(value);
                startTimeInput.value = formatDatetimeLocal(range.startTime);
                endTimeInput.value = formatDatetimeLocal(range.endTime);

                // Update state
                HistoricalState.settings.startTime = range.startTime;
                HistoricalState.settings.endTime = range.endTime;
                console.log(`[Historical] Time preset: Last ${value} hour(s)`);
            }
        });
    });

    // Initialize with "Last 1 hour" preset selected
    const defaultRange = calculateTimeRange('1');
    startTimeInput.value = formatDatetimeLocal(defaultRange.startTime);
    endTimeInput.value = formatDatetimeLocal(defaultRange.endTime);
    HistoricalState.settings.startTime = defaultRange.startTime;
    HistoricalState.settings.endTime = defaultRange.endTime;

    // Custom time input change handlers
    startTimeInput.addEventListener('change', (e) => {
        HistoricalState.settings.startTime = new Date(e.target.value);
        console.log('[Historical] Start time set to:', HistoricalState.settings.startTime);
    });

    endTimeInput.addEventListener('change', (e) => {
        HistoricalState.settings.endTime = new Date(e.target.value);
        console.log('[Historical] End time set to:', HistoricalState.settings.endTime);
    });

    // Max tracks is now hardcoded at 10,000 (no UI input)
    console.log('[Historical] Max tracks fixed at:', HistoricalState.settings.maxTracks);

    // Load Data button click handler
    loadButton.addEventListener('click', async () => {
        // Read current time inputs (in case they were set by URL state without triggering change events)
        if (startTimeInput.value) {
            HistoricalState.settings.startTime = new Date(startTimeInput.value);
            console.log('[Historical] Synced startTime from input:', HistoricalState.settings.startTime);
        }
        if (endTimeInput.value) {
            HistoricalState.settings.endTime = new Date(endTimeInput.value);
            console.log('[Historical] Synced endTime from input:', HistoricalState.settings.endTime);
        }

        // Validate time range
        if (!HistoricalState.settings.startTime || !HistoricalState.settings.endTime) {
            statusDiv.innerHTML = '⚠️ Please select both start and end times';
            statusDiv.className = 'historical-status error';
            return;
        }

        if (HistoricalState.settings.startTime >= HistoricalState.settings.endTime) {
            statusDiv.innerHTML = '⚠️ Start time must be before end time';
            statusDiv.className = 'historical-status error';
            return;
        }

        // Show loading status with spinner
        statusDiv.innerHTML = '<div class="spinner"></div><span>Loading tracks...</span>';
        statusDiv.className = 'historical-status loading';
        loadButton.disabled = true;

        // Hide filters panel during load
        filtersPanel.style.display = 'none';

        try {
            // Clear existing tracks first
            clearHistoricalTracks();

            // Load new data (NO filtering during load - filters applied after)
            const stats = await loadHistoricalData();

            // Show success with loaded/total count
            const trackCount = HistoricalState.tracks.length;
            const totalAvailable = stats?.unique_aircraft || trackCount;

            if (trackCount === 0) {
                // No data found
                statusDiv.innerHTML = '⚠️ No flights found for this time range. Try extending the period.';
                statusDiv.className = 'historical-status warning';
            } else if (trackCount < totalAvailable) {
                // Partial data (hit max_tracks limit)
                statusDiv.innerHTML = `✓ Loaded ${trackCount}/${totalAvailable} tracks (${stats.total_positions.toLocaleString()} positions)`;
                statusDiv.className = 'historical-status success';

                // Show filters panel
                filtersPanel.style.display = 'block';

                // Automatically switch to historical mode to display tracks
                if (currentMode !== 'historical') {
                    await switchToHistoricalMode();
                }
            } else {
                // All data loaded
                statusDiv.innerHTML = `✓ Loaded all ${trackCount} tracks (${stats.total_positions.toLocaleString()} positions)`;
                statusDiv.className = 'historical-status success';

                // Show display mode selector and filters panel
                document.getElementById('display-mode-selector').style.display = 'block';
                filtersPanel.style.display = 'block';

                // Automatically switch to historical mode to display tracks
                if (currentMode !== 'historical') {
                    await switchToHistoricalMode();
                }
            }
        } catch (error) {
            // Better error messages based on error type
            let errorMessage = '❌ ';
            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                errorMessage += 'Cannot reach Track Service. Check if track-service container is running.';
            } else if (error.message.includes('404')) {
                errorMessage += 'Track Service endpoint not found. Check API version.';
            } else if (error.message.includes('500')) {
                errorMessage += 'Track Service error. Check track-service logs for details.';
            } else if (error.message.includes('timeout')) {
                errorMessage += 'Request timed out. Try a smaller time range.';
            } else {
                errorMessage += error.message;
            }
            statusDiv.innerHTML = errorMessage;
            statusDiv.className = 'historical-status error';
        } finally {
            loadButton.disabled = false;
        }
    });

    // Apply Filters button handler
    applyFiltersButton.addEventListener('click', () => {
        applyHistoricalFilters();
        // Update URL with new filter settings
        URLState.updateFromCurrentState();
    });

    // Display Mode button handlers
    const displayModeAllBtn = document.getElementById('display-mode-all');
    const displayModePlaybackBtn = document.getElementById('display-mode-playback');
    const displayModeDescription = document.getElementById('display-mode-description');
    const playbackControlsDiv = document.getElementById('playback-controls');

    displayModeAllBtn.addEventListener('click', () => {
        console.log('[Display Mode] Switching to Show All mode');

        // Update state
        HistoricalState.displayMode = 'show-all';

        // Update button appearance
        displayModeAllBtn.classList.add('active');
        displayModeAllBtn.style.background = 'var(--accent-primary-dim)';
        displayModeAllBtn.style.border = '1px solid var(--accent-primary-hover)';
        displayModePlaybackBtn.classList.remove('active');
        displayModePlaybackBtn.style.background = '';
        displayModePlaybackBtn.style.border = '';

        // Update description
        displayModeDescription.textContent = 'Showing all tracks at once. Click Playback Mode to animate tracks over time.';

        // Show visualization mode selector (heat map options)
        const visualizationModeSelector = document.getElementById('visualization-mode-selector');
        if (visualizationModeSelector) {
            visualizationModeSelector.style.display = 'block';
        }

        // Hide playback controls
        playbackControlsDiv.style.display = 'none';

        // Stop any active playback
        if (PlaybackState.isPlaying) {
            pausePlayback();
        }

        // Show all tracks and endpoints immediately
        HistoricalState.trackMeshes.forEach(({ line, endpointMesh, trail }) => {
            line.visible = true;

            // Show endpoint sphere
            if (endpointMesh) {
                endpointMesh.visible = true;
            }

            // Show Tron curtain if enabled
            if (trail && trail.tronCurtain) {
                trail.tronCurtain.visible = true;
            }
        });

        // Re-apply filters to respect current filter settings
        applyHistoricalFilters();

        console.log('[Display Mode] Switched to Show All mode');

        // Update URL with current app state
        URLState.updateFromCurrentState();
    });

    displayModePlaybackBtn.addEventListener('click', () => {
        console.log('[Display Mode] Switching to Playback mode');

        // Update state
        HistoricalState.displayMode = 'playback';

        // Update button appearance
        displayModePlaybackBtn.classList.add('active');
        displayModePlaybackBtn.style.background = 'var(--accent-primary-dim)';
        displayModePlaybackBtn.style.border = '1px solid var(--accent-primary-hover)';
        displayModeAllBtn.classList.remove('active');
        displayModeAllBtn.style.background = '';
        displayModeAllBtn.style.border = '';

        // Update description
        displayModeDescription.textContent = 'Playback mode: tracks will animate based on their timestamps. Use controls below to play/pause.';

        // Hide visualization mode selector (heat map not available in playback mode)
        const visualizationModeSelector = document.getElementById('visualization-mode-selector');
        if (visualizationModeSelector) {
            visualizationModeSelector.style.display = 'none';
        }

        // Clear heat map if it exists
        clearHeatMap();

        // Initialize playback system
        initializePlayback();

        console.log('[Display Mode] Switched to Playback mode');

        // Update URL with current app state
        URLState.updateFromCurrentState();
    });

    // Heat map visualization mode toggle (radio buttons)
    document.querySelectorAll('input[name="display-mode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const newMode = e.target.value;
            HistoricalState.heatmapMode = newMode;
            console.log(`[HeatMap] Visualization mode changed to ${newMode}`);

            // Apply visibility changes based on mode
            switch (newMode) {
                case 'tracks':
                    // Show tracks, hide heat map
                    showHistoricalTracks(true);
                    setHeatMapVisibility(false);
                    break;

                case 'heatmap':
                    // Hide tracks, show flight corridors
                    showHistoricalTracks(false);
                    setHeatMapVisibility(true);

                    // Generate flight corridors if not already created
                    if (HistoricalState.heatmapMeshes.length === 0) {
                        generateFlightCorridors();
                    }
                    break;

                case 'both':
                    // Show both
                    showHistoricalTracks(true);
                    setHeatMapVisibility(true);

                    // Generate flight corridors if not already created
                    if (HistoricalState.heatmapMeshes.length === 0) {
                        generateFlightCorridors();
                    }
                    break;
            }

            // Update URL with visualization mode
            URLState.updateFromCurrentState();
        });
    });

    // Tron mode is now handled by the unified toggle in Settings panel
}

// Clear all live aircraft from scene
function clearLiveAircraft() {
    console.log('[Mode] Clearing live aircraft');

    // Stop live updates
    if (liveUpdateInterval) {
        clearInterval(liveUpdateInterval);
        liveUpdateInterval = null;
    }

    // Remove aircraft meshes (using Map methods)
    aircraftMeshes.forEach(mesh => {
        scene.remove(mesh);
        disposeGeometry(mesh.geometry);
        disposeMaterial(mesh.material);
    });
    aircraftMeshes.clear();

    // Remove aircraft labels
    aircraftLabels.forEach(label => {
        scene.remove(label);
        disposeMaterial(label.material);
        disposeGeometry(label.geometry);
    });
    aircraftLabels.clear();

    // Remove military indicators
    militaryIndicators.forEach(icon => {
        scene.remove(icon);
        disposeMaterial(icon.material);
        disposeGeometry(icon.geometry);
    });
    militaryIndicators.clear();

    // Remove altitude lines
    altitudeLines.forEach(line => {
        scene.remove(line);
        disposeGeometry(line.geometry);
        disposeMaterial(line.material);
    });
    altitudeLines.clear();

    // Remove trails (using Map methods)
    let trailsRemoved = 0;
    trails.forEach(trail => {
        if (trail.line) {
            scene.remove(trail.line);
            disposeGeometry(trail.line.geometry);
            disposeMaterial(trail.line.material);
            trailsRemoved++;
        }
        // Remove Tron curtain if it exists
        if (trail.tronCurtain) {
            scene.remove(trail.tronCurtain);
            disposeGeometry(trail.tronCurtain.geometry);
            disposeMaterial(trail.tronCurtain.material);
        }
    });
    trails.clear();

    // Remove stale trails (aircraft that disappeared but trails remain visible)
    let staleTrailsRemoved = 0;
    staleTrails.forEach(trail => {
        if (trail.line) {
            scene.remove(trail.line);
            disposeGeometry(trail.line.geometry);
            disposeMaterial(trail.line.material);
            staleTrailsRemoved++;
        }
        // Also remove gap line if it exists
        if (trail.gapLine) {
            scene.remove(trail.gapLine);
            disposeGeometry(trail.gapLine.geometry);
            disposeMaterial(trail.gapLine.material);
        }
        // Remove Tron curtain if it exists
        if (trail.tronCurtain) {
            scene.remove(trail.tronCurtain);
            disposeGeometry(trail.tronCurtain.geometry);
            disposeMaterial(trail.tronCurtain.material);
        }
    });
    staleTrails.clear();

    console.log(`[Mode] Removed ${trailsRemoved} active trails + ${staleTrailsRemoved} stale trails from scene`);

    // Reset recent trails state
    RecentTrailsState.loaded = false;
    RecentTrailsState.icaos.clear();

    // Clear aircraft list
    const list = document.getElementById('aircraft-items');
    if (list) list.innerHTML = '';
}

// Switch to live mode
async function switchToLiveMode(skipURLUpdate = false) {
    if (currentMode === 'live') return;

    console.log('[Mode] Switching to Live mode');

    // Add fade transition
    renderer.domElement.classList.add('mode-transition', 'fading');

    // Wait for fade
    await new Promise(resolve => setTimeout(resolve, 150));

    currentMode = 'live';

    // Clear historical tracks
    clearHistoricalTracks();

    // Hide historical controls
    const historicalControls = document.getElementById('historical-controls');
    if (historicalControls) historicalControls.style.display = 'none';

    // Show nearby aircraft list (back in live mode)
    const aircraftList = document.getElementById('aircraft-list');
    if (aircraftList) {
        aircraftList.style.display = 'block';
    }

    // Show info panel (adsb-3d stats) in live mode
    const infoPanel = document.getElementById('info');
    if (infoPanel) {
        infoPanel.style.display = 'block';
    }

    // Show live mode options section (if Track API available)
    const liveOptionsSection = document.getElementById('live-mode-options-section');
    if (liveOptionsSection && AppFeatures.historical) {
        liveOptionsSection.style.display = 'block';
    }

    // Update mode button active states
    const liveModeBtn = document.getElementById('live-mode-btn');
    const historicalModeBtn = document.getElementById('historical-mode-btn');
    if (liveModeBtn) liveModeBtn.classList.add('active');
    if (historicalModeBtn) historicalModeBtn.classList.remove('active');

    // Start live updates
    if (!liveUpdateInterval) {
        fetchAircraftData();
        liveUpdateInterval = setInterval(fetchAircraftData, CONFIG.updateInterval);
    }

    // Load recent trails if enabled
    if (RecentTrailsState.enabled) {
        await loadRecentTrails();
    }

    // Fade back in
    await new Promise(resolve => setTimeout(resolve, 150));
    renderer.domElement.classList.remove('fading');

    // Update URL to reflect live mode (unless loading from URL)
    if (!skipURLUpdate) {
        URLState.updateFromCurrentState();
    }
}

// Switch to historical mode
async function switchToHistoricalMode(skipURLUpdate = false) {
    if (currentMode === 'historical') return;

    console.log('[Mode] Switching to Historical mode');

    // CRITICAL: Stop live updates FIRST to prevent race conditions
    if (liveUpdateInterval) {
        clearInterval(liveUpdateInterval);
        liveUpdateInterval = null;
        console.log('[Mode] Stopped live update interval');
    }

    // Set mode before fade to prevent any updates during transition
    currentMode = 'historical';

    // Add fade transition
    renderer.domElement.classList.add('mode-transition', 'fading');

    // Wait for fade
    await new Promise(resolve => setTimeout(resolve, 150));

    // Clear live aircraft (meshes, labels, trails)
    clearLiveAircraft();

    // Force a render to ensure removal takes effect
    if (typeof renderer !== 'undefined' && renderer.render) {
        renderer.render(scene, camera);
        console.log('[Mode] Forced render after clearing live aircraft');
    }

    // Hide live mode options section
    const liveOptionsSection = document.getElementById('live-mode-options-section');
    if (liveOptionsSection) {
        liveOptionsSection.style.display = 'none';
    }

    // Hide nearby aircraft list (not relevant in historical mode)
    const aircraftList = document.getElementById('aircraft-list');
    if (aircraftList) {
        aircraftList.style.display = 'none';
    }

    // Hide info panel (adsb-3d stats) in historical mode
    const infoPanel = document.getElementById('info');
    if (infoPanel) {
        infoPanel.style.display = 'none';
    }

    // Update mode button active states
    const liveModeBtn = document.getElementById('live-mode-btn');
    const historicalModeBtn = document.getElementById('historical-mode-btn');
    if (historicalModeBtn) historicalModeBtn.classList.add('active');
    if (liveModeBtn) liveModeBtn.classList.remove('active');

    // Show historical controls panel
    const historicalControls = document.getElementById('historical-controls');
    if (historicalControls) {
        historicalControls.style.display = 'block';
        // Ensure it's not collapsed
        historicalControls.classList.remove('collapsed');
        // Update collapse button text
        const collapseBtn = historicalControls.querySelector('.collapse-btn');
        if (collapseBtn) {
            collapseBtn.textContent = '−';
        }
        console.log('[Mode] Historical controls panel shown');

        // Re-run collapse setup to attach event listeners to newly shown panel
        setupCollapseablePanels();
    } else {
        console.error('[Mode] Could not find historical-controls element');
    }

    // Fade back in
    await new Promise(resolve => setTimeout(resolve, 150));
    renderer.domElement.classList.remove('fading');

    // Update URL to reflect historical mode (unless loading from URL)
    if (!skipURLUpdate) {
        URLState.updateFromCurrentState();
    }
}

// Setup mode button event listeners
function setupModeButtonListeners() {
    const liveModeBtn = document.getElementById('live-mode-btn');
    const historicalModeBtn = document.getElementById('historical-mode-btn');

    if (liveModeBtn) {
        liveModeBtn.addEventListener('click', () => {
            switchToLiveMode();
            liveModeBtn.classList.add('active');
            if (historicalModeBtn) historicalModeBtn.classList.remove('active');
        });
    }

    if (historicalModeBtn && AppFeatures.historical) {
        historicalModeBtn.addEventListener('click', () => {
            switchToHistoricalMode();
            historicalModeBtn.classList.add('active');
            if (liveModeBtn) liveModeBtn.classList.remove('active');
        });
    }
}

// Setup event listeners for recent trails feature
function setupRecentTrailsListeners() {
    const checkbox = document.getElementById('enable-recent-trails');
    const timeDropdown = document.getElementById('recent-trails-time');

    if (!checkbox) {
        console.log('[RecentTrails] UI elements not found, skipping listener setup');
        return;
    }

    // Set default 5 minute duration
    RecentTrailsState.minutes = 5;

    // Enable by default (checkbox is checked in HTML)
    RecentTrailsState.enabled = true;

    // Checkbox: Enable/disable recent trails
    checkbox.addEventListener('change', async (e) => {
        RecentTrailsState.enabled = e.target.checked;
        console.log(`[RecentTrails] Feature ${RecentTrailsState.enabled ? 'enabled' : 'disabled'}`);

        // If enabled and in live mode, load trails
        if (RecentTrailsState.enabled && currentMode === 'live') {
            await loadRecentTrails();
            // Check for conflict with fade time
            validateFadePreloadConflict();
        } else if (!RecentTrailsState.enabled) {
            // Clear status
            const statusDiv = document.getElementById('recent-trails-status');
            if (statusDiv) {
                statusDiv.innerHTML = '';
                statusDiv.className = 'historical-status';
            }
            RecentTrailsState.loaded = false;
            RecentTrailsState.icaos.clear();
        }
    });

    // Time dropdown: Change duration and reload if enabled
    if (timeDropdown) {
        timeDropdown.addEventListener('change', async (e) => {
            RecentTrailsState.minutes = parseInt(e.target.value);
            console.log(`[RecentTrails] Duration changed to ${RecentTrailsState.minutes} minutes`);

            // If enabled and in live mode, reload trails with new duration
            if (RecentTrailsState.enabled && currentMode === 'live') {
                await loadRecentTrails();
            }

            // Check for conflict with fade time
            validateFadePreloadConflict();
        });
    }
}

// Setup event listener for Tron mode toggle
function setupTronModeListener() {
    // Tron mode is now handled via the unified toggle in Settings panel
    // This function is kept for compatibility but no longer used
    return;

    // Checkbox: Enable/disable Tron mode curtains
    checkbox.addEventListener('change', (e) => {
        showTronMode = e.target.checked;
        // console.log(`[TronMode] ${showTronMode ? 'Enabled' : 'Disabled'}`);

        // Update URL to reflect Tron mode state
        URLState.updateFromCurrentState();

        if (showTronMode) {
            // Create curtains for all existing trails
            trails.forEach(trail => {
                if (trail.positions.length >= 2) {
                    updateTronCurtain(trail);
                }
            });
            staleTrails.forEach(trail => {
                if (trail.positions.length >= 2) {
                    updateTronCurtain(trail);
                }
            });
        } else {
            // Remove all Tron curtains from trails
            trails.forEach(trail => {
                if (trail.tronCurtain) {
                    scene.remove(trail.tronCurtain);
                    trail.tronCurtain.geometry.dispose();
                    trail.tronCurtain.material.dispose();
                    trail.tronCurtain = null;
                }
            });
            staleTrails.forEach(trail => {
                if (trail.tronCurtain) {
                    scene.remove(trail.tronCurtain);
                    trail.tronCurtain.geometry.dispose();
                    trail.tronCurtain.material.dispose();
                    trail.tronCurtain = null;
                }
            });

            // AGGRESSIVE CLEANUP: Find and remove any orphaned Tron curtains in the scene
            // This catches curtains that were added but lost their trail reference
            const orphanedCurtains = [];
            scene.traverse((child) => {
                if (child.userData && child.userData.isTronCurtain) {
                    orphanedCurtains.push(child);
                }
            });

            if (orphanedCurtains.length > 0) {
                // console.log(`[TronMode] Found ${orphanedCurtains.length} orphaned curtains, removing...`);
                orphanedCurtains.forEach(curtain => {
                    scene.remove(curtain);
                    if (curtain.geometry) curtain.geometry.dispose();
                    if (curtain.material) curtain.material.dispose();
                });
            }
        }
    });
}

// Initialize UI based on detected features
function initializeUIForFeatures() {
    const historicalBtn = document.getElementById('historical-mode-btn');
    const apiStatusStat = document.getElementById('api-status-stat');
    const apiStatusDot = document.getElementById('api-status-dot-inline');
    const apiStatusText = document.getElementById('api-status-text-inline');
    const liveOptionsSection = document.getElementById('live-mode-options-section');

    if (AppFeatures.historical) {
        console.log('[UI] Showing historical mode controls');
        if (historicalBtn) {
            historicalBtn.style.display = 'inline-block';
            historicalBtn.disabled = false;
        }

        // Show live mode options section (recent trails feature)
        if (liveOptionsSection) {
            liveOptionsSection.style.display = 'block';
            console.log('[UI] Showing live mode options section');
        }

        // Show API status as connected in info panel (if element exists)
        if (apiStatusStat && apiStatusDot && apiStatusText) {
            console.log('[UI] Showing API status in info panel (connected)');
            apiStatusStat.style.display = 'block';
            apiStatusDot.classList.remove('offline');
            apiStatusText.textContent = 'Connected';
        }
    } else {
        console.log('[UI] Hiding historical mode controls (Track API not available)');
        if (historicalBtn) {
            historicalBtn.style.display = 'none';
            historicalBtn.disabled = true;
        }

        // Hide live mode options panel
        if (liveOptionsSection) {
            liveOptionsSection.style.display = 'none';
        }

        // Show API status as offline (only if historical mode is enabled)
        if (apiStatusStat && window.HISTORICAL_CONFIG?.enabled) {
            console.log('[UI] Showing API status in info panel (offline)');
            apiStatusStat.style.display = 'block';
            apiStatusDot.classList.add('offline');
            apiStatusText.textContent = 'Offline';
        }
    }

    // Setup event listeners
    setupModeButtonListeners();
    setupRecentTrailsListeners();
    setupTronModeListener();
}

// Async wrapper to handle feature detection before Three.js init
async function initializeApp() {
    console.log('=== ADS-B 3D Initializing ===');

    // Step 1: Feature Detection
    const features = await FeatureDetector.initialize();
    AppFeatures.live = features.live;
    AppFeatures.historical = features.historical;

    // Step 2: Initialize UI based on features
    initializeUIForFeatures();

    // Step 3: Initialize Three.js (includes animation loop and data fetching)
    init();

    // Step 4: Setup theme UI event listeners (after DOM is ready)
    setupThemeUI();

    // Step 5: Load saved preferences
    const savedRadar = SafeStorage.getItem('showMiniRadar');
    if (savedRadar !== null) {
        showMiniRadar = savedRadar === 'true';
        const toggleContainer = document.getElementById('toggle-mini-radar-container');
        const miniRadar = document.getElementById('mini-radar');
        if (!showMiniRadar) {
            toggleContainer.classList.remove('active');
            if (miniRadar) miniRadar.style.display = 'none';
        }
    }

    // Load sprite mode preference
    const savedSpriteMode = SafeStorage.getItem('useSpriteMode');
    if (savedSpriteMode !== null) {
        useSpriteMode = savedSpriteMode === 'true';
        if (useSpriteMode) {
            console.log('[Sprites] Sprite mode enabled from preferences');
        }
    }
    // Always sync toggle state with the actual value
    const spriteModeToggle = document.getElementById('toggle-sprite-mode-container');
    if (spriteModeToggle) {
        if (useSpriteMode) {
            spriteModeToggle.classList.add('active');
        } else {
            spriteModeToggle.classList.remove('active');
        }
    }

    // Load home tower preference
    const savedHomeTower = SafeStorage.getItem('showHomeTower');
    if (savedHomeTower !== null) {
        showHomeTower = savedHomeTower === 'true';
    }
    // Always sync toggle state with the actual value
    const homeTowerToggle = document.getElementById('toggle-home-tower-container');
    if (homeTowerToggle) {
        if (showHomeTower) {
            homeTowerToggle.classList.add('active');
        } else {
            homeTowerToggle.classList.remove('active');
        }
    }
    // CRITICAL: Update homeMarkerGroup visibility after loading preference
    // (homeMarkerGroup was created in init() before preference was loaded)
    if (homeMarkerGroup) {
        homeMarkerGroup.visible = showHomeTower;
    }
    console.log(`[HomeTower] Initialized: ${showHomeTower ? 'Visible' : 'Hidden'}, Saved preference: ${savedHomeTower}, Visibility updated: ${homeMarkerGroup?.visible}`)

    // Load Tron mode preference
    const savedTronMode = SafeStorage.getItem('showTronMode');
    if (savedTronMode !== null) {
        showTronMode = savedTronMode === 'true';
    }
    // Always sync toggle state with the actual value
    const tronModeToggle = document.getElementById('toggle-tron-mode-container');
    if (tronModeToggle) {
        if (showTronMode) {
            tronModeToggle.classList.add('active');
        } else {
            tronModeToggle.classList.remove('active');
        }
    }
    console.log(`[TronMode] Initialized: ${showTronMode ? 'Enabled' : 'Disabled'}, Saved preference: ${savedTronMode}`)

    // Load trail fade preferences
    const savedAutoFade = SafeStorage.getItem('autoFadeTrails');
    if (savedAutoFade !== null) {
        autoFadeTrails = savedAutoFade === 'true';
        const toggleContainer = document.getElementById('toggle-trail-fade-container');
        const fadeSelector = document.getElementById('trail-fade-time-selector');
        if (autoFadeTrails) {
            toggleContainer.classList.add('active');
            if (fadeSelector) fadeSelector.style.display = 'block';
        }
    }

    const savedFadeTime = SafeStorage.getItem('trailFadeTime');
    if (savedFadeTime !== null) {
        trailFadeTime = parseInt(savedFadeTime);
        const fadeTimeSelect = document.getElementById('trail-fade-time');
        if (fadeTimeSelect) fadeTimeSelect.value = trailFadeTime.toString();
    }

    // Load altitude scale preference
    const savedAltScale = SafeStorage.getItem('altitudeScale');
    if (savedAltScale !== null) {
        CONFIG.altitudeExaggeration = parseFloat(savedAltScale);
        const altScaleSelect = document.getElementById('altitude-scale');
        if (altScaleSelect) altScaleSelect.value = savedAltScale;
    }

    // Load trail color mode preference
    const savedColorMode = SafeStorage.getItem('trailColorMode');
    if (savedColorMode !== null) {
        trailColorMode = savedColorMode;
        const colorModeRadio = document.querySelector(`input[name="trail-color-mode"][value="${savedColorMode}"]`);
        if (colorModeRadio) colorModeRadio.checked = true;
    }

    // Load compass preference
    const savedCompass = SafeStorage.getItem('showCompass');
    if (savedCompass !== null) {
        showCompass = savedCompass === 'true';
        const toggleContainer = document.getElementById('toggle-compass-container');
        const compass = document.getElementById('compass-rose');
        if (!showCompass) {
            toggleContainer.classList.remove('active');
            if (compass) compass.style.display = 'none';
        }
    }

    // Step 6: Apply URL state if present (shareable links)
    await URLState.applyFromURL();

    // Step 7: Setup mobile touch UX enhancements
    if (window.innerWidth <= 768) {
        setupMobileTouchUX();
    }

    console.log('=== ADS-B 3D Ready ===');
    console.log(`Features: Live=${AppFeatures.live}, Historical=${AppFeatures.historical}`);
}

// Initialize Three.js scene
// Initialize compass tick marks
function initializeCompassTicks() {
    const compassRose = document.getElementById('compass-rose');
    if (!compassRose) return;

    const compassRadius = 50; // 100px diameter / 2
    const centerX = compassRadius;
    const centerY = compassRadius;

    // Define tick marks with angles (0° = North)
    const ticks = [
        // Long ticks for intercardinals
        { angle: 45, type: 'long' },   // NE
        { angle: 135, type: 'long' },  // SE
        { angle: 225, type: 'long' },  // SW
        { angle: 315, type: 'long' },  // NW
        // Medium ticks for secondary intercardinals
        { angle: 22.5, type: 'medium' },   // NNE
        { angle: 67.5, type: 'medium' },   // ENE
        { angle: 112.5, type: 'medium' },  // ESE
        { angle: 157.5, type: 'medium' },  // SSE
        { angle: 202.5, type: 'medium' },  // SSW
        { angle: 247.5, type: 'medium' },  // WSW
        { angle: 292.5, type: 'medium' },  // WNW
        { angle: 337.5, type: 'medium' },  // NNW
    ];

    // Create tick marks
    ticks.forEach(tick => {
        const tickDiv = document.createElement('div');
        tickDiv.className = `tick ${tick.type}`;

        // Calculate position on the edge of the compass
        const angleRad = (tick.angle - 90) * Math.PI / 180; // -90 to start from top
        const radius = compassRadius - (tick.type === 'long' ? 6 : 4); // Position near edge
        const x = centerX + radius * Math.cos(angleRad);
        const y = centerY + radius * Math.sin(angleRad);

        // Position and rotate the tick
        tickDiv.style.left = `${x}px`;
        tickDiv.style.top = `${y}px`;
        tickDiv.style.transform = `translate(-50%, -50%) rotate(${tick.angle}deg)`;

        compassRose.appendChild(tickDiv);
    });
}

function init() {
    const canvas = document.getElementById('canvas');

    // Scene
    scene = new THREE.Scene();

    // Create sky with gradient
    createSky();

    // Minimal fog for depth perception - very light to support 600km+ visibility
    scene.fog = new THREE.FogExp2(CONFIG.sceneFog, 0.0003);

    // Camera
    camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        10000  // Far plane - support large-area feeders (600km+ coverage)
    );
    // Start facing north (-Z direction) at an angle
    // Camera south of origin (positive Z) looking toward north (negative Z)
    camera.position.set(0, 50, 100);
    camera.lookAt(0, 0, 0);

    // Renderer with performance optimizations
    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: 'high-performance',  // Prefer dedicated GPU over integrated
        stencil: false,  // Disable stencil buffer (not used)
        depth: true,     // Keep depth buffer (needed for proper rendering)
        alpha: false     // Opaque canvas saves GPU cycles
    });
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Limit pixel ratio to 2 max (4K/5K displays don't need >2x)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Lights - Daylight simulation
    const ambientLight = new THREE.AmbientLight(CONFIG.sceneAmbient, 0.6);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(CONFIG.sceneSun, 1.2);
    sunLight.position.set(100, 200, 50);
    sunLight.castShadow = false;
    scene.add(sunLight);

    // Add hemisphere light for better atmosphere
    const hemiLight = new THREE.HemisphereLight(CONFIG.sceneAmbient, CONFIG.sceneGround, 0.4);
    scene.add(hemiLight);

    // Add ground with map texture
    createGroundPlane();

    // Add large grid overlay for extended view
    createExtendedGrid();

    // Add distance rings for scale
    if (CONFIG.showDistanceRings) {
        addDistanceRings();
    }

    // Load and render airports/runways
    if (CONFIG.showAirports || CONFIG.showRunways) {
        loadAirportsAndRunways();
    }

    // Add home location marker - radio tower with beacon
    homeMarkerGroup = new THREE.Group();

    // Tower base (theme color)
    const baseMaterial = new THREE.MeshPhongMaterial({ color: CONFIG.towerBase });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 0.5, 8), baseMaterial);
    base.position.y = 0.25;
    homeMarkerGroup.add(base);

    // Tower mast (theme color)
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4, 8), baseMaterial);
    mast.position.y = 2.5;
    homeMarkerGroup.add(mast);

    // Antenna top
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 1, 8), baseMaterial);
    antenna.position.y = 5;
    homeMarkerGroup.add(antenna);

    // Pulsing beacon light on top (theme color)
    const beaconMaterial = new THREE.MeshPhongMaterial({
        color: CONFIG.towerLight,
        emissive: CONFIG.towerLight,
        emissiveIntensity: 1
    });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16), beaconMaterial);
    beacon.position.y = 5.8;
    beacon.userData.isBeacon = true;
    homeMarkerGroup.add(beacon);

    // Set visibility based on setting
    homeMarkerGroup.visible = showHomeTower;
    scene.add(homeMarkerGroup);

    // Store beacon reference for pulsing animation
    window.homeBeacon = beacon;

    // Mouse controls
    setupMouseControls();

    // Window resize
    window.addEventListener('resize', onWindowResize);

    // Setup UI controls
    setupUIControls();

    // Load daily statistics
    loadDailyStats();

    // Check for daily reset every minute
    setInterval(checkDailyReset, 60000);

    // Initialize compass tick marks
    initializeCompassTicks();

    // Setup aircraft click interaction
    setupAircraftClick();

    // Hide loading
    document.getElementById('loading').style.display = 'none';

    // SVG aircraft system loaded via aircraft-svg-system.js

    // Start animation loop
    animate();

    // Start fetching aircraft data (live mode by default)
    fetchAircraftData();
    liveUpdateInterval = setInterval(fetchAircraftData, CONFIG.updateInterval);

    // Start trail cleanup timer (runs every 60 seconds)
    setInterval(cleanupOldTrailPositions, 60000);
    console.log('[TrailFade] Cleanup timer started (60s interval)');

    // Load recent trails on startup if enabled and Track API available
    if (RecentTrailsState.enabled && AppFeatures.historical && currentMode === 'live') {
        console.log('[RecentTrails] Auto-loading trails on startup');
        setTimeout(() => loadRecentTrails(), 2000); // Wait 2s for initial aircraft data
    }

    // Initialize unified sidebar
    initSidebar();
}

// Create realistic sky with gradient
function createSky() {
    // Sky dome must be larger than max camera distance (1200) to prevent breaking through
    const skyGeometry = new THREE.SphereGeometry(2000, 32, 15);

    // Create gradient from horizon to zenith
    const skyMaterial = new THREE.ShaderMaterial({
        uniforms: {
            topColor: { value: new THREE.Color(0x0077ff) },
            bottomColor: { value: new THREE.Color(0x87CEEB) },
            offset: { value: 33 },
            exponent: { value: 0.6 }
        },
        vertexShader: `
            varying vec3 vWorldPosition;
            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 topColor;
            uniform vec3 bottomColor;
            uniform float offset;
            uniform float exponent;
            varying vec3 vWorldPosition;
            void main() {
                float h = normalize(vWorldPosition + offset).y;
                gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
            }
        `,
        side: THREE.BackSide
    });

    sky = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(sky);

    // Initialize sky colors based on current time
    updateSkyColors();
}

// Calculate sky colors based on time of day
function getSkyColors() {
    const now = new Date();
    const hours = now.getHours() + now.getMinutes() / 60;

    // Define sky colors for different times
    const times = [
        { hour: 0, top: 0x000033, bottom: 0x000055 },      // Midnight - deep blue
        { hour: 5, top: 0x000033, bottom: 0x000055 },      // Pre-dawn - deep blue
        { hour: 6, top: 0x4a5a8a, bottom: 0xff6b35 },      // Dawn - orange/purple
        { hour: 7, top: 0x87CEEB, bottom: 0xffb366 },      // Sunrise - light blue/orange
        { hour: 8, top: 0x0077ff, bottom: 0x87CEEB },      // Morning - blue
        { hour: 12, top: 0x0055dd, bottom: 0x87CEEB },     // Noon - bright blue
        { hour: 17, top: 0x0077ff, bottom: 0x87CEEB },     // Afternoon - blue
        { hour: 19, top: 0xff7733, bottom: 0xff9955 },     // Sunset - orange/red
        { hour: 20, top: 0x2a3a6a, bottom: 0x4a2a5a },     // Dusk - purple
        { hour: 21, top: 0x000033, bottom: 0x000055 },     // Night - deep blue
        { hour: 24, top: 0x000033, bottom: 0x000055 }      // Midnight - deep blue
    ];

    // Find the two time periods we're between
    let before = times[0];
    let after = times[1];

    for (let i = 0; i < times.length - 1; i++) {
        if (hours >= times[i].hour && hours < times[i + 1].hour) {
            before = times[i];
            after = times[i + 1];
            break;
        }
    }

    // Interpolate between the two periods
    const range = after.hour - before.hour;
    const position = (hours - before.hour) / range;

    // Smooth interpolation
    const t = position * position * (3 - 2 * position); // Smoothstep

    // Interpolate colors
    const topColor = new THREE.Color(before.top).lerp(new THREE.Color(after.top), t);
    const bottomColor = new THREE.Color(before.bottom).lerp(new THREE.Color(after.bottom), t);

    return { topColor, bottomColor };
}

// Update sky colors based on time of day
function updateSkyColors() {
    if (!sky || !sky.material || !sky.material.uniforms) return;

    const colors = getSkyColors();
    sky.material.uniforms.topColor.value.copy(colors.topColor);
    sky.material.uniforms.bottomColor.value.copy(colors.bottomColor);
}

// Create ground plane with map texture
function createGroundPlane() {
    const zoom = CONFIG.mapZoomLevel;
    const centerTile = latLonToTile(CONFIG.homeLocation.lat, CONFIG.homeLocation.lon, zoom);

    // Calculate the actual km size of tiles at this zoom level and latitude
    const degreesPerTile = 360 / Math.pow(2, zoom);
    const latRad = CONFIG.homeLocation.lat * Math.PI / 180;

    // Width of tile in km (varies by latitude)
    const tileWidthKm = degreesPerTile * Math.cos(latRad) * 111.32;
    // Height of tile in km (constant)
    const tileHeightKm = degreesPerTile * 111.32;

    // Load NxN grid of tiles centered on home
    const tilesWide = CONFIG.mapTileGridSize;
    const tilesHigh = CONFIG.mapTileGridSize;
    const totalWidth = tileWidthKm * tilesWide;
    const totalHeight = tileHeightKm * tilesHigh;

    // Create ground plane geometry
    const geometry = new THREE.PlaneGeometry(totalWidth, totalHeight, 64, 64);
    geometry.rotateX(-Math.PI / 2); // Make horizontal

    // Create canvas to composite NxN tiles
    const tileSize = 256;
    const canvas = document.createElement('canvas');
    canvas.width = tileSize * tilesWide;
    canvas.height = tileSize * tilesHigh;
    const ctx = canvas.getContext('2d');

    const material = new THREE.MeshStandardMaterial({
        color: 0xcccccc, // Light gray - minimal tint on map tiles
        roughness: 0.8,
        metalness: 0.2
    });

    // Load all tiles
    let tilesLoaded = 0;
    const totalTiles = tilesWide * tilesHigh;
    const halfGrid = Math.floor(tilesWide / 2);

    for (let dy = -halfGrid; dy <= halfGrid; dy++) {
        for (let dx = -halfGrid; dx <= halfGrid; dx++) {
            const tileX = centerTile.x + dx;
            const tileY = centerTile.y + dy;

            let tileUrl;
            switch (CONFIG.mapTileProvider) {
                case 'dark':
                    // CartoDB Dark Matter - free, no API key required
                    tileUrl = `https://a.basemaps.cartocdn.com/dark_all/${zoom}/${tileX}/${tileY}.png`;
                    break;
                case 'satellite':
                    // Esri World Imagery - free, no API key required
                    tileUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tileY}/${tileX}`;
                    break;
                case 'terrain':
                    // Stamen Terrain - requires Stadia Maps API key (https://stadiamaps.com/stamen/)
                    // Free tier: 200k tiles/month for non-commercial use
                    tileUrl = `https://tiles.stadiamaps.com/tiles/stamen_terrain/${zoom}/${tileX}/${tileY}.png`;
                    break;
                case 'osm':
                default:
                    // OpenStreetMap - free, no API key required
                    // Note: OSM requests user-agent for high-volume usage
                    tileUrl = `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`;
                    break;
            }

            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function() {
                // Draw tile at correct position
                const canvasX = (dx + halfGrid) * tileSize;
                const canvasY = (dy + halfGrid) * tileSize;
                ctx.drawImage(img, canvasX, canvasY, tileSize, tileSize);

                tilesLoaded++;
                if (tilesLoaded === totalTiles) {
                    // All tiles loaded, create texture from canvas
                    const texture = new THREE.CanvasTexture(canvas);
                    // Reduce artifacts with better filtering
                    texture.minFilter = THREE.LinearMipMapLinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    texture.anisotropy = renderer.capabilities.getMaxAnisotropy(); // Max quality
                    texture.generateMipmaps = true;
                    texture.needsUpdate = true;
                    material.map = texture;
                    material.needsUpdate = true;
                    console.log(`Ground plane: ${totalWidth.toFixed(1)}km x ${totalHeight.toFixed(1)}km (${tilesWide}x${tilesHigh} tiles at zoom ${zoom})`);
                }
            };
            img.onerror = function() {
                console.warn(`Failed to load tile ${tileX},${tileY}`);
                // Draw dark gray fallback
                ctx.fillStyle = '#1a1a1a';
                const canvasX = (dx + halfGrid) * tileSize;
                const canvasY = (dy + halfGrid) * tileSize;
                ctx.fillRect(canvasX, canvasY, tileSize, tileSize);

                tilesLoaded++;
                if (tilesLoaded === totalTiles) {
                    const texture = new THREE.CanvasTexture(canvas);
                    // Same filtering as success path
                    texture.minFilter = THREE.LinearMipMapLinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
                    texture.generateMipmaps = true;
                    material.map = texture;
                    material.needsUpdate = true;
                }
            };
            img.src = tileUrl;
        }
    }

    const ground = new THREE.Mesh(geometry, material);
    ground.position.y = -0.1;

    // Calculate offset to align home location with scene center (0,0,0)
    // Get the exact position of home within the center tile
    const n = Math.pow(2, zoom);
    const homeLon = CONFIG.homeLocation.lon;
    const homeLat = CONFIG.homeLocation.lat;
    const homeLatRad = homeLat * Math.PI / 180;

    // Exact tile coordinates (with fractional part)
    const exactTileX = (homeLon + 180) / 360 * n;
    const exactTileY = (1 - Math.log(Math.tan(homeLatRad) + 1 / Math.cos(homeLatRad)) / Math.PI) / 2 * n;

    // Integer tile coordinates (what we use for loading)
    const intTileX = Math.floor(exactTileX);
    const intTileY = Math.floor(exactTileY);

    // Fractional position within the tile (0 to 1)
    const fracX = exactTileX - intTileX;
    const fracY = exactTileY - intTileY;

    // Offset in km: how far from the tile corner is the home location
    // (0.5, 0.5) would be the center of the tile
    const offsetX = (fracX - 0.5) * tileWidthKm;
    const offsetZ = (fracY - 0.5) * tileHeightKm;

    // Position the ground plane so home location is at (0, 0, 0)
    ground.position.x = -offsetX;
    ground.position.z = -offsetZ;

    scene.add(ground);

    // Add a large black background plane to fill edges beyond map tiles
    const bgSize = 5000; // 5000km x 5000km black background
    const bgGeometry = new THREE.PlaneGeometry(bgSize, bgSize);
    bgGeometry.rotateX(-Math.PI / 2);
    const bgMaterial = new THREE.MeshStandardMaterial({
        color: 0x000000,
        roughness: 0.9,
        metalness: 0.1
    });
    const bgPlane = new THREE.Mesh(bgGeometry, bgMaterial);
    bgPlane.position.y = -0.5; // Below the map tiles
    scene.add(bgPlane);
}

// Convert lat/lon to tile coordinates
function latLonToTile(lat, lon, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lon + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y };
}

// Create extended grid overlay for better spatial reference when zoomed out
function createExtendedGrid() {
    // Create a very large grid that extends far beyond the map tiles
    const gridSize = 2000; // 2000km x 2000km grid
    const divisions = 100; // 20km per division (denser grid)

    const gridHelper = new THREE.GridHelper(
        gridSize,
        divisions,
        CONFIG.gridCenter, // Center line color (theme)
        CONFIG.gridLines  // Grid line color (theme)
    );

    // Rotate to be horizontal and position slightly below ground
    gridHelper.rotation.x = 0;
    gridHelper.position.y = -0.2; // Below the map tiles

    // Make it semi-transparent
    gridHelper.material.opacity = 0.4; // Slightly more visible
    gridHelper.material.transparent = true;

    scene.add(gridHelper);

    console.log(`Extended grid: ${gridSize}km x ${gridSize}km with ${divisions} divisions (${gridSize/divisions}km per division)`);
}

// ========== AIRPORT/RUNWAY FUNCTIONS ==========

// Parse CSV data
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.replace(/"/g, ''));
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index];
        });
        rows.push(row);
    }

    return rows;
}

// Calculate distance between two lat/lon points (Haversine formula)
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Fetch and parse airports from OurAirports
async function fetchAirports() {
    try {
        console.log('Fetching airports data...');
        const response = await fetch('https://davidmegginson.github.io/ourairports-data/airports.csv');
        const csvText = await response.text();
        const allAirports = parseCSV(csvText);

        // Filter by distance and type
        const homeLat = CONFIG.homeLocation.lat;
        const homeLon = CONFIG.homeLocation.lon;
        const maxDist = CONFIG.airportMaxDistance;

        airports = allAirports.filter(airport => {
            const lat = parseFloat(airport.latitude_deg);
            const lon = parseFloat(airport.longitude_deg);

            if (isNaN(lat) || isNaN(lon)) return false;

            const distance = haversineDistance(homeLat, homeLon, lat, lon);
            if (distance > maxDist) return false;

            // Filter by type
            if (CONFIG.airportMinType !== 'all') {
                if (CONFIG.airportMinType === 'large_airport') {
                    return airport.type === 'large_airport';
                } else if (CONFIG.airportMinType === 'medium_airport') {
                    return airport.type === 'large_airport' || airport.type === 'medium_airport';
                }
            }

            return true;
        });

        console.log(`Found ${airports.length} airports within ${maxDist}km`);
        return airports;
    } catch (error) {
        console.error('Error fetching airports:', error);
        return [];
    }
}

// Fetch and parse runways from OurAirports
async function fetchRunways() {
    try {
        console.log('Fetching runways data...');
        const response = await fetch('https://davidmegginson.github.io/ourairports-data/runways.csv');
        const csvText = await response.text();
        const allRunways = parseCSV(csvText);

        // Filter runways for airports we've loaded
        const airportIds = new Set(airports.map(a => a.id));
        runways = allRunways.filter(runway => airportIds.has(runway.airport_ref));

        console.log(`Found ${runways.length} runways`);
        return runways;
    } catch (error) {
        console.error('Error fetching runways:', error);
        return [];
    }
}

// Render airports in the scene
function renderAirports() {
    // Clear existing airport meshes
    airportMeshes.forEach(mesh => scene.remove(mesh));
    airportMeshes = [];

    airports.forEach(airport => {
        const lat = parseFloat(airport.latitude_deg);
        const lon = parseFloat(airport.longitude_deg);
        const elevation = parseFloat(airport.elevation_ft) || 0;

        if (isNaN(lat) || isNaN(lon)) return;

        const { x, z } = latLonToXZ(lat, lon);
        // Calculate elevation relative to home, same as aircraft altitude
        const y = ((elevation - CONFIG.homeLocation.alt) * 0.3048 / 1000) * CONFIG.altitudeExaggeration;

        // Create small airport identifier label (just callsign like "KAUW")
        const labelText = airport.ident || airport.icao_code || 'APT';

        // Create label canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        // Draw background - subtle gray instead of bright orange
        context.fillStyle = 'rgba(100, 100, 100, 0.7)';
        context.fillRect(0, 0, canvas.width, canvas.height);

        // Draw text
        context.font = 'Bold 28px Arial';
        context.fillStyle = 'white';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(labelText, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(8, 2, 1); // Much smaller label
        sprite.position.set(x, y + 1, z); // Float just above ground
        sprite.visible = showAirportsEnabled;
        sprite.userData.airport = airport;
        sprite.userData.isAirportLabel = true; // Mark for click detection

        scene.add(sprite);
        airportMeshes.push(sprite);
    });

    console.log(`Rendered ${airportMeshes.length} airport labels`);
}

// Render runways in the scene
function renderRunways() {
    // Clear existing runway meshes
    runwayMeshes.forEach(mesh => scene.remove(mesh));
    runwayMeshes = [];

    runways.forEach(runway => {
        const airport = airports.find(a => a.id === runway.airport_ref);
        if (!airport) return;

        // Get runway endpoint coordinates
        const leLat = parseFloat(runway.le_latitude_deg);
        const leLon = parseFloat(runway.le_longitude_deg);
        const heLat = parseFloat(runway.he_latitude_deg);
        const heLon = parseFloat(runway.he_longitude_deg);

        const elevation = parseFloat(airport.elevation_ft) || 0;

        // Get runway dimensions
        const lengthFt = parseFloat(runway.length_ft);
        const widthFt = parseFloat(runway.width_ft);
        const heading = parseFloat(runway.le_heading_degT); // Low end heading

        if (isNaN(lengthFt) || isNaN(widthFt) || isNaN(heading)) return;

        // Determine runway center position
        let runwayLat, runwayLon;

        // Check if we have valid endpoint coordinates
        if (!isNaN(leLat) && !isNaN(leLon) && !isNaN(heLat) && !isNaN(heLon)) {
            // Use midpoint between low end and high end as runway center
            runwayLat = (leLat + heLat) / 2;
            runwayLon = (leLon + heLon) / 2;
        } else {
            // Fallback to airport center if endpoint coordinates are missing
            runwayLat = parseFloat(airport.latitude_deg);
            runwayLon = parseFloat(airport.longitude_deg);

            if (isNaN(runwayLat) || isNaN(runwayLon)) return;
        }

        // Convert to scene units (ft -> meters -> km -> scene units)
        const length = (lengthFt * 0.3048 / 1000); // Convert ft to km
        const width = (widthFt * 0.3048 / 1000) * 3; // Exaggerate width 3x for visibility

        const { x, z } = latLonToXZ(runwayLat, runwayLon);
        // Calculate elevation relative to home, same as aircraft altitude, plus small offset to be visible
        const y = ((elevation - CONFIG.homeLocation.alt) * 0.3048 / 1000) * CONFIG.altitudeExaggeration + 0.05;

        // Create runway geometry
        const geometry = new THREE.PlaneGeometry(width, length);
        geometry.rotateX(-Math.PI / 2); // Make horizontal

        // Runway material (theme color for visibility)
        const material = new THREE.MeshBasicMaterial({
            color: CONFIG.runwayColor,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });

        const runwayMesh = new THREE.Mesh(geometry, material);
        runwayMesh.position.set(x, y, z);

        // Rotate runway to match heading
        // Heading 0° = North (-Z), 90° = East (+X), 180° = South (+Z), 270° = West (-X)
        runwayMesh.rotation.y = -(heading * Math.PI / 180);

        runwayMesh.visible = showRunwaysEnabled;
        runwayMesh.userData.runway = runway;
        runwayMesh.userData.airport = airport;

        scene.add(runwayMesh);
        runwayMeshes.push(runwayMesh);
    });

    console.log(`Rendered ${runwayMeshes.length} runways`);
}

// Load all airport/runway data
async function loadAirportsAndRunways() {
    await fetchAirports();
    await fetchRunways();
    renderAirports();
    renderRunways();
}

// ========== END AIRPORT/RUNWAY FUNCTIONS ==========

// Add distance rings for scale reference
function addDistanceRings() {
    CONFIG.distanceRingIntervals.forEach((distance, index) => {
        const radius = distance; // distance in km = radius in scene units
        const segments = 128;

        // Create ring - brighter for dark background
        const geometry = new THREE.RingGeometry(radius - 0.5, radius + 0.5, segments);
        geometry.rotateX(-Math.PI / 2); // Make horizontal

        // Alternating colors from theme (theme-aware)
        const color = index % 2 === 0 ? CONFIG.distanceRing1 : CONFIG.distanceRing2;
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide
        });

        const ring = new THREE.Mesh(geometry, material);
        ring.position.y = 0.1; // Slightly above ground to be visible
        ring.userData.isDistanceRing = true;
        ring.userData.ringIndex = index;
        scene.add(ring);

        // Add distance label at north position of ring
        const label = CONFIG.distanceRingLabels[index] || `${distance.toFixed(0)} km`;
        const distanceLabel = createDistanceRingLabel(label);
        distanceLabel.position.set(0, 0.5, -radius); // North side of ring, slightly elevated
        scene.add(distanceLabel);
    });
}

// Create distance ring label sprite
function createDistanceRingLabel(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Semi-transparent background with slight border
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Border for visibility
    ctx.strokeStyle = 'rgba(136, 136, 136, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    // Gray text to match ring color - larger and bolder
    ctx.font = 'Bold 48px Arial';
    ctx.fillStyle = '#bbbbbb'; // Brighter gray for better visibility
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(20, 5, 1); // Much larger - similar to aircraft labels

    return sprite;
}

// Sync camera angles from current position (for smooth transition to free orbit)
function syncCameraAnglesFromPosition() {
    const centerPoint = followMode && followedAircraftHex ?
        aircraftMeshes.get(followedAircraftHex)?.position : new THREE.Vector3(0, 0, 0);

    if (!centerPoint) return;

    // Calculate relative position
    const relativePos = camera.position.clone().sub(centerPoint);

    // Calculate distance
    cameraDistance = relativePos.length();

    // Calculate angles
    const horizontalDist = Math.sqrt(relativePos.x * relativePos.x + relativePos.z * relativePos.z);
    cameraAngleY = Math.atan2(horizontalDist, relativePos.y);
    cameraAngleX = Math.atan2(relativePos.z, relativePos.x);
}

// Update camera position based on angles and distance
function updateCameraPosition(centerPoint = new THREE.Vector3(0, 0, 0)) {
    if (!followMode || !followLocked) {
        const x = cameraDistance * Math.sin(cameraAngleY) * Math.cos(cameraAngleX);
        const y = cameraDistance * Math.cos(cameraAngleY);
        const z = cameraDistance * Math.sin(cameraAngleY) * Math.sin(cameraAngleX);

        camera.position.set(
            centerPoint.x + x,
            centerPoint.y + y,
            centerPoint.z + z
        );
        camera.lookAt(centerPoint);
    }
}

function setupMouseControls() {
    let previousMousePosition = { x: 0, y: 0 };
    let mouseDownPosition = { x: 0, y: 0 };
    let actuallyDragged = false;

    const canvas = document.getElementById('canvas');

    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        actuallyDragged = false; // Reset drag tracking
        previousMousePosition = { x: e.clientX, y: e.clientY };
        mouseDownPosition = { x: e.clientX, y: e.clientY }; // Track initial position

        // Sync camera angles with current position before starting drag
        // This ensures dragging continues from current orientation
        syncCameraAnglesFromPosition();

        // If user starts dragging during locked follow mode, unlock it
        if (followMode && followLocked) {
            followLocked = false;
            updateFollowButtonText();
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const deltaX = e.clientX - previousMousePosition.x;
            const deltaY = e.clientY - previousMousePosition.y;

            // Calculate total distance moved from initial mousedown
            const totalDeltaX = e.clientX - mouseDownPosition.x;
            const totalDeltaY = e.clientY - mouseDownPosition.y;
            const totalDistance = Math.sqrt(totalDeltaX * totalDeltaX + totalDeltaY * totalDeltaY);

            // Only consider it "dragging" if moved more than 5 pixels
            if (totalDistance > 5) {
                actuallyDragged = true;
            }

            cameraAngleX += deltaX * 0.005;
            cameraAngleY = Math.max(0.1, Math.min(Math.PI / 2, cameraAngleY - deltaY * 0.005));

            // Update camera only if not in locked follow mode
            if (!followMode || !followLocked) {
                const followTarget = followMode && followedAircraftHex ?
                    aircraftMeshes.get(followedAircraftHex)?.position : new THREE.Vector3(0, 0, 0);
                updateCameraPosition(followTarget);
            }

            previousMousePosition = { x: e.clientX, y: e.clientY };
        }
    });

    canvas.addEventListener('mouseup', () => {
        wasDragging = actuallyDragged; // Only set if actually moved significantly
        isDragging = false;
        actuallyDragged = false;
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();

        // Sync camera angles with current position before zooming
        // This ensures zooming continues from current orientation
        syncCameraAnglesFromPosition();

        // If user zooms during locked follow mode, unlock it
        if (followMode && followLocked) {
            followLocked = false;
            updateFollowButtonText();
        }

        const oldDistance = cameraDistance;
        // Zoom limits: 10 (close-up) to 1200 (wide view for large-area feeders)
        cameraDistance = Math.max(10, Math.min(1200, cameraDistance + e.deltaY * 0.1));

        // Update camera only if not in locked follow mode
        if (!followMode || !followLocked) {
            const followTarget = followMode && followedAircraftHex ?
                aircraftMeshes.get(followedAircraftHex)?.position : new THREE.Vector3(0, 0, 0);
            updateCameraPosition(followTarget);
        }
    });

    // Touch controls for mobile devices
    setupTouchControls(canvas);
}

// Setup touch controls for mobile
function setupTouchControls(canvas) {
    let touchStartPositions = [];
    let initialPinchDistance = null;
    let initialCameraDistance = null;
    let touchStartTime = 0;
    let touchMoved = false;
    let wasTouchDragging = false;

    // Add long-press and double-tap support
    let longPressTimer = null;
    let lastTapTime = 0;
    const LONG_PRESS_TIME = 500; // milliseconds
    const DOUBLE_TAP_TIME = 300; // milliseconds

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        touchStartPositions = Array.from(e.touches).map(touch => ({
            x: touch.clientX,
            y: touch.clientY
        }));
        touchStartTime = Date.now();
        touchMoved = false;

        if (e.touches.length === 1) {
            // Single touch - prepare for rotation and long-press detection
            isDragging = true;
            syncCameraAnglesFromPosition();

            // Start long-press timer
            longPressTimer = setTimeout(() => {
                // Long-press detected - show aircraft context menu
                const touch = e.touches[0];
                const raycaster = new THREE.Raycaster();
                const mouse = new THREE.Vector2();

                mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
                mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;

                raycaster.setFromCamera(mouse, camera);
                const intersects = raycaster.intersectObjects(scene.children, true);

                if (intersects.length > 0) {
                    // Found an aircraft - show context menu
                    showAircraftContextMenu(touch.clientX, touch.clientY, intersects[0]);
                }

                longPressTimer = null;
            }, LONG_PRESS_TIME);

            // Unlock follow mode if active
            if (followMode && followLocked) {
                followLocked = false;
                updateFollowButtonText();
            }
        } else if (e.touches.length === 2) {
            // Two finger touch - prepare for pinch/zoom
            isDragging = false;

            // Cancel long-press when switching to two fingers
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
            initialCameraDistance = cameraDistance;
            // console.log(`[Mobile Zoom] Start pinch - initial distance: ${initialCameraDistance.toFixed(0)}, pinch: ${initialPinchDistance.toFixed(0)}`);

            syncCameraAnglesFromPosition();

            // Unlock follow mode if active
            if (followMode && followLocked) {
                followLocked = false;
                updateFollowButtonText();
            }
        }
    });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();

        // Mark as moved if touch position changed significantly
        if (e.touches.length > 0 && touchStartPositions.length > 0) {
            const deltaX = e.touches[0].clientX - touchStartPositions[0].x;
            const deltaY = e.touches[0].clientY - touchStartPositions[0].y;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            if (distance > 10) {  // 10px threshold for tap vs drag
                touchMoved = true;

                // Cancel long-press if user moves finger
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            }
        }

        if (e.touches.length === 1 && isDragging) {
            // Single finger drag - rotate camera
            const touch = e.touches[0];
            const deltaX = touch.clientX - touchStartPositions[0].x;
            const deltaY = touch.clientY - touchStartPositions[0].y;

            cameraAngleX += deltaX * 0.005;
            cameraAngleY = Math.max(0.1, Math.min(Math.PI / 2, cameraAngleY - deltaY * 0.005));

            // Update camera only if not in locked follow mode
            if (!followMode || !followLocked) {
                const followTarget = followMode && followedAircraftHex ?
                    aircraftMeshes.get(followedAircraftHex)?.position : new THREE.Vector3(0, 0, 0);
                updateCameraPosition(followTarget);
            }

            touchStartPositions = [{ x: touch.clientX, y: touch.clientY }];
        } else if (e.touches.length === 2) {
            // Two finger pinch - zoom
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const currentDistance = Math.sqrt(dx * dx + dy * dy);

            if (initialPinchDistance !== null) {
                const scale = currentDistance / initialPinchDistance;
                // Standard mobile behavior: spread fingers (scale > 1) = zoom IN (decrease distance)
                // pinch fingers (scale < 1) = zoom OUT (increase distance)
                // So we divide by scale
                const newDistance = initialCameraDistance / scale;

                // Apply zoom with same limits as desktop
                // When hitting the max, clamp to max instead of resetting
                const oldCameraDistance = cameraDistance;
                // Pinch zoom limits: 10 (close) to 1200 (far) - supports large-area feeders
                cameraDistance = Math.max(10, Math.min(1200, newDistance));

                // Debug logging disabled after fixing zoom issues
                // console.log(`[Mobile Zoom] Pinch - scale: ${scale.toFixed(2)}, old: ${oldCameraDistance.toFixed(0)}, new: ${cameraDistance.toFixed(0)}, initial: ${initialCameraDistance.toFixed(0)}`);

                // Update camera only if not in locked follow mode
                if (!followMode || !followLocked) {
                    const followTarget = followMode && followedAircraftHex ?
                        aircraftMeshes.get(followedAircraftHex)?.position : new THREE.Vector3(0, 0, 0);
                    updateCameraPosition(followTarget);
                }
            }
        }
    });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();

        // Clear long-press timer if active
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        // Capture drag state before resetting
        wasTouchDragging = touchMoved;

        // Detect tap (quick touch without movement)
        const touchDuration = Date.now() - touchStartTime;
        const wasTap = !wasTouchDragging && touchDuration < 300 && touchStartPositions.length === 1;

        // Check for double-tap to reset camera
        const currentTime = Date.now();
        if (wasTap && currentTime - lastTapTime < DOUBLE_TAP_TIME && currentTime - lastTapTime > 0) {
            // Double-tap detected - reset camera
            resetCamera();
            lastTapTime = 0; // Reset to prevent triple tap
            return; // Don't process as single tap
        } else if (wasTap) {
            lastTapTime = currentTime;
        }

        if (wasTap && e.changedTouches.length > 0) {
            // This was a tap - perform aircraft selection
            const touch = e.changedTouches[0];
            const rect = canvas.getBoundingClientRect();
            const mouse = {
                x: ((touch.clientX - rect.left) / rect.width) * 2 - 1,
                y: -((touch.clientY - rect.top) / rect.height) * 2 + 1
            };

            // Update raycaster with tap position
            raycaster.setFromCamera(mouse, camera);

            // Check for intersections with aircraft meshes, labels, airports, historical tracks, and endpoints
            const aircraftArray = Array.from(aircraftMeshes.values());
            const labelArray = Array.from(aircraftLabels.values());
            // Only include tracks and endpoints that are IN THE SCENE (have a parent)
            const historicalTracksArray = Array.from(HistoricalState.trackMeshes.values())
                .filter(tm => tm.line.parent)
                .map(tm => tm.line);
            const endpointsArray = (HistoricalState.endpointMeshes || [])
                .filter(endpoint => endpoint.parent);
            const allClickableObjects = [...aircraftArray, ...labelArray, ...airportMeshes, ...historicalTracksArray, ...endpointsArray];
            const intersects = raycaster.intersectObjects(allClickableObjects, true);

            if (intersects.length > 0) {
                const tappedObject = intersects[0].object;

                // Check if we tapped a historical endpoint
                if (tappedObject.userData && tappedObject.userData.isHistoricalEndpoint) {
                    showHistoricalTrackDetail(tappedObject.userData);
                    return;
                }

                // Check if we tapped a historical track line
                if (tappedObject.userData && tappedObject.userData.isHistoricalTrack) {
                    showHistoricalTrackDetail(tappedObject.userData);
                    return;
                }

                // Check if we tapped an airport label
                for (const airportSprite of airportMeshes) {
                    if (airportSprite === tappedObject && airportSprite.userData.isAirportLabel) {
                        showAirportDetail(airportSprite.userData.airport);
                        return;
                    }
                }

                // Check if we tapped an aircraft label
                for (const [hex, labelGroup] of aircraftLabels.entries()) {
                    if (labelGroup === tappedObject || labelGroup.children.includes(tappedObject)) {
                        showAircraftDetail(hex);
                        return;
                    }
                }

                // Otherwise, find the parent Group (aircraft) for this tapped mesh
                let aircraftGroup = tappedObject;
                while (aircraftGroup && aircraftGroup.parent && aircraftGroup.parent.type !== 'Scene') {
                    aircraftGroup = aircraftGroup.parent;
                }

                // Find the hex for this aircraft group
                // Check the tapped object, its parent, and all ancestors
                for (const [hex, mesh] of aircraftMeshes.entries()) {
                    if (mesh === aircraftGroup ||
                        mesh === tappedObject ||
                        mesh.children.includes(tappedObject) ||
                        tappedObject.parent === mesh) {
                        console.log(`[Tap] Detected tap on aircraft ${hex}, showing details`);
                        showAircraftDetail(hex);
                        break;
                    }
                }
            }
        }

        if (e.touches.length === 0) {
            // All fingers lifted
            // console.log(`[Mobile Zoom] All fingers lifted - final distance: ${cameraDistance.toFixed(0)}`);
            isDragging = false;
            initialPinchDistance = null;
            initialCameraDistance = null;
            touchStartPositions = [];
            touchMoved = false;
            wasTouchDragging = false;
        } else if (e.touches.length === 1) {
            // One finger remaining - reset for single touch
            // console.log(`[Mobile Zoom] One finger remaining - current distance: ${cameraDistance.toFixed(0)}`);
            touchStartPositions = [{
                x: e.touches[0].clientX,
                y: e.touches[0].clientY
            }];
            initialPinchDistance = null;
            initialCameraDistance = null;
            touchStartTime = Date.now();
            touchMoved = false;
            wasTouchDragging = false;
        }
    });

    canvas.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        isDragging = false;
        initialPinchDistance = null;
        initialCameraDistance = null;
        touchStartPositions = [];
    });
}

// Update follow button text based on current state
function updateFollowButtonText() {
    const followBtn = document.getElementById('toggle-follow');
    if (!followBtn) return;

    if (!followMode) {
        followBtn.textContent = 'Follow: OFF';
    } else if (followLocked) {
        followBtn.textContent = 'Follow: 🔒 Locked';
    } else {
        followBtn.textContent = 'Follow: 🔓 Free';
    }
}

// Show/hide unfollow button
function showUnfollowButton() {
    const unfollowBtn = document.getElementById('unfollow-btn');
    if (unfollowBtn) {
        unfollowBtn.style.display = 'block';
    }
}

function hideUnfollowButton() {
    const unfollowBtn = document.getElementById('unfollow-btn');
    if (unfollowBtn) {
        unfollowBtn.style.display = 'none';
    }
}

// Reset camera to default position and stop following
function resetCamera() {
    // Turn off follow mode FIRST to prevent interference with animation
    if (followMode) {
        followMode = false;
        followedAircraftHex = null;
        const followBtn = document.getElementById('toggle-follow');
        if (followBtn) {
            followBtn.style.display = 'none';
        }
        updateFollowButtonText();
        hideUnfollowButton();
    }

    // Smooth camera animation to default position (facing north)
    const homePos = new THREE.Vector3(0, 50, 100);
    const homeLookAt = new THREE.Vector3(0, 0, 0);

    animateCameraToPosition(homePos, homeLookAt, 1000, () => {
        // Animation complete - update camera angles
        cameraAngleX = 0; // Facing north
        cameraAngleY = Math.PI / 6;
        cameraDistance = 100;
    });
}

/**
 * Sanitize HTML to prevent XSS attacks
 * Escapes HTML special characters that could be used for injection
 * @param {string} str - The string to sanitize
 * @returns {string} Sanitized string safe for HTML insertion
 */
function sanitizeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Safe localStorage wrapper with error handling
 * Prevents crashes in private browsing mode or when quota is exceeded
 */
const SafeStorage = {
    /**
     * Safely get an item from localStorage
     * @param {string} key - The storage key
     * @param {*} defaultValue - Default value if retrieval fails
     * @returns {string|null} The stored value or default
     */
    getItem(key, defaultValue = null) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            console.warn(`[Storage] Failed to read ${key}:`, e.message);
            return defaultValue;
        }
    },

    /**
     * Safely set an item in localStorage
     * @param {string} key - The storage key
     * @param {string} value - The value to store
     * @returns {boolean} True if successful, false otherwise
     */
    setItem(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (e) {
            console.warn(`[Storage] Failed to save ${key}:`, e.message);
            // Common errors: QuotaExceededError in private browsing
            if (e.name === 'QuotaExceededError') {
                console.warn('[Storage] Storage quota exceeded. Consider clearing old data.');
            }
            return false;
        }
    },

    /**
     * Safely remove an item from localStorage
     * @param {string} key - The storage key
     * @returns {boolean} True if successful, false otherwise
     */
    removeItem(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            console.warn(`[Storage] Failed to remove ${key}:`, e.message);
            return false;
        }
    },

    /**
     * Check if localStorage is available
     * @returns {boolean} True if localStorage is available
     */
    isAvailable() {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            return false;
        }
    }
};

/**
 * Setup aircraft search bar with fuzzy matching
 * Allows users to quickly find aircraft by callsign, ICAO, tail number, or type
 */
function setupAircraftSearch() {
    const searchInput = document.getElementById('aircraft-search');
    const clearBtn = document.getElementById('aircraft-search-clear');

    if (!searchInput || !clearBtn) {
        console.warn('[Search] Search elements not found');
        return;
    }

    // Show/hide clear button based on input
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();

        if (query.length > 0) {
            clearBtn.classList.add('visible');
        } else {
            clearBtn.classList.remove('visible');
        }

        filterAircraftList(query);
    });

    // Clear button functionality
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.classList.remove('visible');
        filterAircraftList('');
        searchInput.focus();
    });

    // Clear search on Escape key
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            clearBtn.classList.remove('visible');
            filterAircraftList('');
            searchInput.blur();
        }
    });
}

/**
 * Filter aircraft list based on search query
 * Uses fuzzy matching for flexible searching
 * @param {string} query - The search query
 */
function filterAircraftList(query) {
    const aircraftItems = document.querySelectorAll('.aircraft-item');

    if (!query || query.length === 0) {
        // No query - show all aircraft
        aircraftItems.forEach(item => {
            item.classList.remove('search-hidden', 'search-match');
        });
        return;
    }

    const queryLower = query.toLowerCase();
    let matchCount = 0;

    aircraftItems.forEach(item => {
        const hex = item.dataset.hex;
        if (!hex) return;

        // Get aircraft data
        const aircraft = aircraftData.aircraft?.find(ac => ac.hex?.toLowerCase() === hex.toLowerCase());
        if (!aircraft) {
            item.classList.add('search-hidden');
            item.classList.remove('search-match');
            return;
        }

        // Build searchable string from all relevant fields
        const searchFields = [
            aircraft.hex,
            aircraft.flight,
            aircraft.r,  // registration/tail
            aircraft.t,  // type
            aircraft.desc,  // description
        ].filter(Boolean).map(f => String(f).toLowerCase());

        // Check if any field matches the query (fuzzy match)
        const matches = searchFields.some(field => {
            // Exact match
            if (field.includes(queryLower)) return true;

            // Fuzzy match - allow for typos (simple implementation)
            // Check if query characters appear in order
            let queryIndex = 0;
            for (let i = 0; i < field.length && queryIndex < queryLower.length; i++) {
                if (field[i] === queryLower[queryIndex]) {
                    queryIndex++;
                }
            }
            return queryIndex === queryLower.length;
        });

        if (matches) {
            item.classList.remove('search-hidden');
            item.classList.add('search-match');
            matchCount++;
        } else {
            item.classList.add('search-hidden');
            item.classList.remove('search-match');
        }
    });

    // Update aircraft count to reflect filtered results
    const countEl = document.getElementById('aircraft-count');
    if (countEl && matchCount < aircraftItems.length) {
        // Show filtered count
        countEl.textContent = `${matchCount}/${aircraftItems.length}`;
        countEl.style.color = 'var(--accent-primary)';
    } else if (countEl) {
        // Reset to normal count
        countEl.textContent = aircraftItems.length;
        countEl.style.color = '';
    }
}

function setupUIControls() {
    // Aircraft Search Bar
    setupAircraftSearch();

    // Reset camera button
    document.getElementById('reset-camera').addEventListener('click', () => {
        resetCamera();
    });

    // Unfollow button
    const unfollowBtn = document.getElementById('unfollow-btn');
    if (unfollowBtn) {
        unfollowBtn.addEventListener('click', () => {
            resetCamera();
        });
    }

    document.getElementById('toggle-trails-container').addEventListener('click', (e) => {
        showTrails = !showTrails;
        e.currentTarget.classList.toggle('active');
        trails.forEach(trail => trail.line.visible = showTrails);
        staleTrails.forEach(trail => {
            trail.line.visible = showTrails;
            if (trail.gapLine) trail.gapLine.visible = showTrails;
        });
    });

    document.getElementById('toggle-labels-container').addEventListener('click', (e) => {
        showLabels = !showLabels;
        e.currentTarget.classList.toggle('active');
        aircraftLabels.forEach(label => label.visible = showLabels);
    });

    document.getElementById('toggle-altitude-lines-container').addEventListener('click', (e) => {
        showAltitudeLines = !showAltitudeLines;
        e.currentTarget.classList.toggle('active');
        altitudeLines.forEach(line => line.visible = showAltitudeLines);
    });

    document.getElementById('toggle-mini-radar-container').addEventListener('click', (e) => {
        showMiniRadar = !showMiniRadar;
        e.currentTarget.classList.toggle('active');
        const miniRadar = document.getElementById('mini-radar');
        if (miniRadar) {
            miniRadar.style.display = showMiniRadar ? 'flex' : 'none';
        }
        // Save preference
        SafeStorage.setItem('showMiniRadar', showMiniRadar);
    });

    // Compass rose toggle
    document.getElementById('toggle-compass-container').addEventListener('click', (e) => {
        showCompass = !showCompass;
        e.currentTarget.classList.toggle('active');
        const compass = document.getElementById('compass-rose');
        if (compass) {
            compass.style.display = showCompass ? 'block' : 'none';
        }
        // Save preference
        SafeStorage.setItem('showCompass', showCompass);
    });

    // Auto-fade trails toggle
    document.getElementById('toggle-trail-fade-container').addEventListener('click', (e) => {
        autoFadeTrails = !autoFadeTrails;
        e.currentTarget.classList.toggle('active');
        const fadeSelector = document.getElementById('trail-fade-time-selector');
        if (fadeSelector) {
            fadeSelector.style.display = autoFadeTrails ? 'block' : 'none';
        }
        // Save preference
        SafeStorage.setItem('autoFadeTrails', autoFadeTrails);
        console.log(`[TrailFade] Auto-fade ${autoFadeTrails ? 'enabled' : 'disabled'}`);
    });

    // Sprite mode toggle
    document.getElementById('toggle-sprite-mode-container').addEventListener('click', (e) => {
        useSpriteMode = !useSpriteMode;
        e.currentTarget.classList.toggle('active');

        // Save preference
        SafeStorage.setItem('useSpriteMode', useSpriteMode);

        // Clear all aircraft to force re-render with new mode
        aircraftMeshes.forEach((mesh, hex) => {
            removeAircraft(hex);
        });
        aircraftMeshes.clear();

        console.log(`[Sprites] Mode switched to: ${useSpriteMode ? 'sprites' : 'spheres'}`);
    });

    // Home tower toggle
    document.getElementById('toggle-home-tower-container').addEventListener('click', (e) => {
        showHomeTower = !showHomeTower;
        e.currentTarget.classList.toggle('active');

        // Update visibility
        if (homeMarkerGroup) {
            homeMarkerGroup.visible = showHomeTower;
        }

        // Save preference
        SafeStorage.setItem('showHomeTower', showHomeTower);
        console.log(`[HomeTower] ${showHomeTower ? 'Visible' : 'Hidden'}`);
    });

    // Tron mode toggle
    document.getElementById('toggle-tron-mode-container').addEventListener('click', (e) => {
        showTronMode = !showTronMode;
        e.currentTarget.classList.toggle('active');

        // Save preference
        SafeStorage.setItem('showTronMode', showTronMode);
        console.log(`[TronMode] ${showTronMode ? 'Enabled' : 'Disabled'}`);

        if (showTronMode) {
            // Create curtains for all existing trails (live mode)
            trails.forEach(trail => {
                if (trail.positions.length >= 2) {
                    updateTronCurtain(trail);
                }
            });
            staleTrails.forEach(trail => {
                if (trail.positions.length >= 2) {
                    updateTronCurtain(trail);
                }
            });

            // Create curtains for visible historical tracks
            if (currentMode === 'historical' && HistoricalState.trackMeshes.size > 0) {
                let curtainsCreated = 0;
                HistoricalState.trackMeshes.forEach(({line, trail}) => {
                    // Only create curtain if the track is visible (in the scene)
                    if (line && line.parent && trail && trail.positions.length > 1) {
                        updateTronCurtain(trail);
                        curtainsCreated++;
                    }
                });
                console.log(`[TronMode] Created ${curtainsCreated} historical curtains`);
            }
        } else {
            // Remove all Tron curtains and dispose of resources
            const curtainsToRemove = [];
            scene.traverse((child) => {
                if (child.userData.isTronCurtain) {
                    curtainsToRemove.push(child);
                }
            });

            curtainsToRemove.forEach(curtain => {
                scene.remove(curtain);
                if (curtain.geometry) curtain.geometry.dispose();
                if (curtain.material) curtain.material.dispose();
            });

            // Clear curtain references from trails
            trails.forEach(trail => {
                if (trail.tronCurtain) {
                    trail.tronCurtain = null;
                }
            });
            staleTrails.forEach(trail => {
                if (trail.tronCurtain) {
                    trail.tronCurtain = null;
                }
            });

            // Clear curtain references from historical tracks
            HistoricalState.trackMeshes.forEach(({trail}) => {
                if (trail && trail.tronCurtain) {
                    trail.tronCurtain = null;
                }
            });

            console.log(`[TronMode] Removed ${curtainsToRemove.length} curtains`);
        }

        // Update URL to reflect state
        URLState.updateFromCurrentState();

        // Check for conflict with preload time
        validateFadePreloadConflict();
    });

    // Trail fade time dropdown
    document.getElementById('trail-fade-time').addEventListener('change', (e) => {
        trailFadeTime = parseInt(e.target.value);
        SafeStorage.setItem('trailFadeTime', trailFadeTime);
        console.log(`[TrailFade] Fade time set to ${trailFadeTime === 0 ? 'Never' : trailFadeTime / 60 + ' minutes'}`);

        // Check for conflict with preload time
        validateFadePreloadConflict();
    });

    // Altitude scale selector
    document.getElementById('altitude-scale').addEventListener('change', (e) => {
        const newScale = parseFloat(e.target.value);
        const oldScale = CONFIG.altitudeExaggeration;
        CONFIG.altitudeExaggeration = newScale;
        SafeStorage.setItem('altitudeScale', newScale);
        console.log(`[AltitudeScale] Scale changed from ${oldScale}x to ${newScale}x`);

        // Reposition all aircraft with new scale
        aircraftMeshes.forEach((mesh, hex) => {
            if (mesh.userData && typeof mesh.userData.alt_baro === 'number') {
                const altFeet = mesh.userData.alt_baro;
                const newAltitude = Math.max(1.0, (altFeet - CONFIG.homeLocation.alt) * 0.3048 * CONFIG.scale * CONFIG.altitudeExaggeration);
                mesh.position.y = newAltitude;

                // Update sprite position if exists
                if (mesh.userData.sprite) {
                    mesh.userData.sprite.position.copy(mesh.position);
                }
            }
        });

        // Reposition all trail points
        trails.forEach((trail) => {
            if (trail.line && trail.positions.length > 0) {
                const positions = trail.line.geometry.attributes.position.array;

                // Update each position's Y coordinate
                trail.positions.forEach((pos, i) => {
                    if (pos.altFeet !== undefined) {
                        const newY = Math.max(1.0, (pos.altFeet - CONFIG.homeLocation.alt) * 0.3048 * CONFIG.scale * CONFIG.altitudeExaggeration);
                        positions[i * 3 + 1] = newY;
                        pos.y = newY; // Update stored position too
                    }
                });

                trail.line.geometry.attributes.position.needsUpdate = true;
            }
        });

        // Reposition altitude lines if they exist
        scene.traverse((object) => {
            if (object.userData && object.userData.isAltitudeLine) {
                const altFeet = object.userData.altitudeFeet;
                if (altFeet !== undefined) {
                    const newY = ((altFeet - CONFIG.homeLocation.alt) * 0.3048 / 1000) * CONFIG.altitudeExaggeration;
                    object.position.y = newY;

                    // Update label position if exists
                    if (object.userData.label) {
                        object.userData.label.position.y = newY + 0.05;
                    }
                }
            }
        });

        // Update Tron curtains if in Tron mode
        if (showTronMode) {
            aircraftMeshes.forEach((mesh, hex) => {
                if (mesh.userData && mesh.userData.tronCurtain) {
                    const curtain = mesh.userData.tronCurtain;
                    scene.remove(curtain);
                    disposeGeometry(curtain.geometry);
                    disposeMaterial(curtain.material);
                    delete mesh.userData.tronCurtain;
                }
            });

            // Recreate curtains with new scale
            aircraftMeshes.forEach((mesh) => {
                updateTronCurtain(mesh);
            });
        }

        // Update historical tracks if in historical mode
        if (currentMode === 'historical' && HistoricalState.trackMeshes) {
            console.log(`[AltitudeScale] Updating ${HistoricalState.trackMeshes.size} historical tracks for new scale ${newScale}x`);

            HistoricalState.trackMeshes.forEach((trackData, icao) => {
                const { line, track, trail, endpointMesh } = trackData;

                if (!track || !track.positions) return;

                const smoothedPositions = smoothAltitudes(track.positions);

                // Update track line geometry
                if (line && line.geometry) {
                    const positions = line.geometry.attributes.position.array;

                    smoothedPositions.forEach((pos, i) => {
                        const alt = pos.alt || pos.altitude || 0;
                        const altitude = (alt - CONFIG.homeLocation.alt) * 0.3048 * CONFIG.scale * CONFIG.altitudeExaggeration;
                        const y = Math.max(1.0, altitude);

                        // Update Y coordinate only (X and Z stay the same)
                        positions[i * 3 + 1] = y;
                    });

                    line.geometry.attributes.position.needsUpdate = true;
                }

                // Update trail positions array (for Tron curtains)
                if (trail && trail.positions) {
                    trail.positions.forEach((pos) => {
                        if (pos.altFeet !== undefined) {
                            const altitude = (pos.altFeet - CONFIG.homeLocation.alt) * 0.3048 * CONFIG.scale * CONFIG.altitudeExaggeration;
                            pos.y = Math.max(1.0, altitude);
                        }
                    });

                    // Recreate Tron curtain if in Tron mode
                    if (showTronMode && trail.tronCurtain) {
                        // Remove old curtain
                        scene.remove(trail.tronCurtain);
                        disposeGeometry(trail.tronCurtain.geometry);
                        disposeMaterial(trail.tronCurtain.material);
                        trail.tronCurtain = null;

                        // Create new curtain with updated positions
                        updateTronCurtain(trail);
                    }
                }

                // Update endpoint sphere position
                if (endpointMesh && endpointMesh.userData && endpointMesh.userData.altFeet !== undefined) {
                    const altFeet = endpointMesh.userData.altFeet;
                    const newY = Math.max(1.0, (altFeet - CONFIG.homeLocation.alt) * 0.3048 * CONFIG.scale * CONFIG.altitudeExaggeration);
                    endpointMesh.position.y = newY;
                }
            });

            console.log(`[AltitudeScale] Historical tracks updated successfully`);
        }

        // Regenerate flight corridors if they exist and are visible
        if (currentMode === 'historical' && HistoricalState.heatmapMeshes.length > 0) {
            console.log(`[AltitudeScale] Regenerating flight corridors with new scale ${newScale}x`);
            generateFlightCorridors(); // Will clear old meshes and create new ones with correct altitude
        }
    });

    // Trail color mode selector (altitude vs speed)
    document.querySelectorAll('input[name="trail-color-mode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            trailColorMode = e.target.value;
            SafeStorage.setItem('trailColorMode', trailColorMode);
            console.log(`[TrailColor] Mode changed to ${trailColorMode}`);

            // Rebuild all live trail colors
            trails.forEach((trail) => {
                if (!trail || !trail.positions || trail.positions.length === 0) return;

                const colors = trail.line.geometry.attributes.color.array;

                trail.positions.forEach((pos, i) => {
                    // Get color based on new mode
                    let colorValue;
                    if (trailColorMode === 'speed') {
                        colorValue = getSpeedColor(pos.groundSpeed);
                    } else {
                        colorValue = getAltitudeColor(pos.y);
                    }
                    const trailColor = new THREE.Color(colorValue);
                    colors[i * 3] = trailColor.r;
                    colors[i * 3 + 1] = trailColor.g;
                    colors[i * 3 + 2] = trailColor.b;
                });

                trail.line.geometry.attributes.color.needsUpdate = true;

                // Update stored original colors for hover restore
                trail.originalColors = new Float32Array(colors);

                // Rebuild Tron curtain if active
                if (showTronMode && trail.tronCurtain) {
                    updateTronCurtain(trail);
                }
            });

            // Rebuild historical track colors if in historical mode
            if (currentMode === 'historical' && HistoricalState.trackMeshes) {
                console.log(`[TrailColor] Updating ${HistoricalState.trackMeshes.size} historical tracks for new color mode`);

                HistoricalState.trackMeshes.forEach((trackData, icao) => {
                    const { line, track, trail } = trackData;

                    if (!track || !track.positions) return;

                    const isMilitary = track.is_military || false;
                    const smoothedPositions = smoothAltitudes(track.positions);

                    // Update track line colors
                    if (line && line.geometry && line.geometry.attributes.color) {
                        const colors = line.geometry.attributes.color.array;

                        smoothedPositions.forEach((pos, i) => {
                            const alt = pos.alt || pos.altitude || 0;
                            const altitude = (alt - CONFIG.homeLocation.alt) * 0.3048 * CONFIG.scale * CONFIG.altitudeExaggeration;
                            const y = Math.max(1.0, altitude);
                            const speed = pos.speed || pos.gs || 0;

                            // Get color based on new mode
                            let colorValue;
                            if (isMilitary) {
                                colorValue = CONFIG.militaryColor;
                            } else if (trailColorMode === 'speed') {
                                colorValue = getSpeedColor(speed);
                            } else {
                                colorValue = getAltitudeColor(y);
                            }
                            const color = new THREE.Color(colorValue);
                            colors[i * 3] = color.r;
                            colors[i * 3 + 1] = color.g;
                            colors[i * 3 + 2] = color.b;
                        });

                        line.geometry.attributes.color.needsUpdate = true;

                        // Update stored original colors
                        line.userData.originalColors = new Float32Array(colors);
                    }

                    // Rebuild Tron curtain if active
                    if (showTronMode && trail && trail.tronCurtain) {
                        updateTronCurtain(trail);
                    }
                });

                console.log(`[TrailColor] Historical tracks updated successfully`);
            }
        });
    });

    // Keyboard help modal
    // NEW: Keyboard help sidebar (improved UX)
    const keyboardHelpSidebar = document.getElementById('keyboard-help-sidebar');
    const keyboardHelpOverlay = document.getElementById('keyboard-help-overlay');

    document.getElementById('show-keyboard-help').addEventListener('click', () => {
        keyboardHelpSidebar.classList.add('show');
        keyboardHelpOverlay.classList.add('show');
    });

    document.getElementById('close-keyboard-help-sidebar').addEventListener('click', () => {
        keyboardHelpSidebar.classList.remove('show');
        keyboardHelpOverlay.classList.remove('show');
    });

    // Close sidebar when clicking overlay
    keyboardHelpOverlay.addEventListener('click', () => {
        keyboardHelpSidebar.classList.remove('show');
        keyboardHelpOverlay.classList.remove('show');
    });

    // Legacy modal support
    document.getElementById('close-keyboard-help').addEventListener('click', () => {
        document.getElementById('keyboard-help-modal').classList.remove('show');
    });

    // Single click toggles follow on/off, double-click toggles locked/free
    let followClickTimeout = null;
    const toggleFollowBtn = document.getElementById('toggle-follow');
    if (toggleFollowBtn) {
        toggleFollowBtn.addEventListener('click', (e) => {
        if (followClickTimeout) {
            // Double-click detected - toggle locked/free mode
            clearTimeout(followClickTimeout);
            followClickTimeout = null;

            if (followMode) {
                if (followLocked) {
                    // Switching from locked to free - sync angles first
                    syncCameraAnglesFromPosition();
                }
                followLocked = !followLocked;
                updateFollowButtonText();
            }
        } else {
            // Single click - set timeout to detect double-click
            followClickTimeout = setTimeout(() => {
                followClickTimeout = null;

                // Toggle follow mode on/off
                followMode = !followMode;

                if (followMode && selectedAircraft) {
                    followedAircraftHex = selectedAircraft;
                    followLocked = true; // Start in locked mode
                    cameraReturnInProgress = false;
                    // Hide aircraft detail panel during follow mode so it doesn't block view
                    document.getElementById('aircraft-detail').style.display = 'none';
                } else {
                    followMode = false;
                    followedAircraftHex = null;

                    // Smooth camera animation to initial position (same as reset button)
                    const homePos = new THREE.Vector3(0, 50, 100);
                    const homeLookAt = new THREE.Vector3(0, 0, 0);

                    animateCameraToPosition(homePos, homeLookAt, 1000, () => {
                        // Animation complete - update camera angles
                        cameraAngleX = 0; // Facing north
                        cameraAngleY = Math.PI / 6;
                        cameraDistance = 100;
                        cameraReturnInProgress = false;

                        // Show aircraft detail panel again when follow mode ends
                        if (selectedAircraft) {
                            document.getElementById('aircraft-detail').style.display = 'block';
                        }
                    });
                }

                updateFollowButtonText();
            }, 250); // 250ms window for double-click
        }
        });
    }

    document.getElementById('toggle-airports-container').addEventListener('click', (e) => {
        showAirportsEnabled = !showAirportsEnabled;
        e.currentTarget.classList.toggle('active');
        airportMeshes.forEach(mesh => mesh.visible = showAirportsEnabled);
    });

    document.getElementById('toggle-runways-container').addEventListener('click', (e) => {
        showRunwaysEnabled = !showRunwaysEnabled;
        e.currentTarget.classList.toggle('active');
        runwayMeshes.forEach(mesh => mesh.visible = showRunwaysEnabled);
    });

    // About modal
    // Footer about link
    document.getElementById('footer-about-link').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('about-modal').classList.add('show');
    });

    document.getElementById('close-about').addEventListener('click', () => {
        document.getElementById('about-modal').classList.remove('show');
    });

    // Close about modal when clicking outside content
    document.getElementById('about-modal').addEventListener('click', (e) => {
        if (e.target.id === 'about-modal') {
            document.getElementById('about-modal').classList.remove('show');
        }
    });

    // Collapseable panel functionality
    setupCollapseablePanels();

    // Historical controls (if feature enabled)
    setupHistoricalControls();
    setupPlaybackControls();

    // Keyboard shortcuts
    setupKeyboardShortcuts();
}

// Setup collapseable panel functionality
function setupCollapseablePanels() {
    const collapseButtons = document.querySelectorAll('.collapse-btn');
    const headerButtons = document.querySelectorAll('.panel-header-btn');

    console.log('[Collapse] Setup called - Found', collapseButtons.length, 'collapse buttons and', headerButtons.length, 'header buttons');

    // Check if we're on mobile
    const isMobile = window.innerWidth <= 768;

    // Load saved collapse states from localStorage
    const savedStates = JSON.parse(SafeStorage.getItem('panelCollapseStates') || '{}');

    // Handle old-style collapse buttons
    collapseButtons.forEach(btn => {
        const panelId = btn.getAttribute('data-panel');
        const panel = document.getElementById(panelId);

        console.log('[Collapse] Processing collapse button for panel:', panelId, 'Found panel:', !!panel, 'Already initialized:', btn.dataset.initialized);

        if (panel) {
            // Skip if already initialized (prevent duplicate listeners)
            if (btn.dataset.initialized === 'true') {
                console.log('[Collapse] Skipping already initialized button for:', panelId);
                return;
            }
            btn.dataset.initialized = 'true';

            // Apply saved state or default mobile state
            if (savedStates[panelId] !== undefined) {
                if (savedStates[panelId]) {
                    panel.classList.add('collapsed');
                    btn.textContent = '+';
                }
            } else if (isMobile) {
                // Collapse panels by default on mobile EXCEPT aircraft-list
                // Keep aircraft list open so users can see nearby aircraft
                if (panelId !== 'aircraft-list') {
                    panel.classList.add('mobile-collapsed');
                    btn.textContent = '+';
                }
            }

            // Add click handler
            btn.addEventListener('click', () => {
                console.log('[Collapse] Button CLICK EVENT FIRED for panel:', panelId);
                // Remove mobile-collapsed if present, then toggle collapsed
                panel.classList.remove('mobile-collapsed');
                const wasCollapsed = panel.classList.contains('collapsed');
                panel.classList.toggle('collapsed');

                console.log('[Collapse] Panel collapsed state after toggle:', panel.classList.contains('collapsed'));

                // Change button text from − to + (or vice versa) during animation
                // Wait for half the rotation (90deg) then change symbol
                setTimeout(() => {
                    btn.textContent = wasCollapsed ? '−' : '+';
                }, 150); // Half of 0.3s transition

                // Save state to localStorage
                const states = JSON.parse(SafeStorage.getItem('panelCollapseStates') || '{}');
                states[panelId] = panel.classList.contains('collapsed');
                SafeStorage.setItem('panelCollapseStates', JSON.stringify(states));
            });

            console.log('[Collapse] Event listener attached for panel:', panelId);
        }
    });

    // Handle new-style header buttons
    headerButtons.forEach(btn => {
        const panelId = btn.getAttribute('data-panel');
        const panel = document.getElementById(panelId);
        const indicator = btn.querySelector('.collapse-indicator');

        console.log('[Collapse] Setting up header button for panel:', panelId, 'Found panel:', !!panel, 'Found indicator:', !!indicator);

        if (panel && indicator) {
            // Apply saved state or default mobile state
            if (savedStates[panelId] !== undefined) {
                if (savedStates[panelId]) {
                    panel.classList.add('collapsed');
                    indicator.textContent = '+';
                }
            } else if (isMobile) {
                // Collapse panels by default on mobile
                panel.classList.add('mobile-collapsed');
                indicator.textContent = '+';
            }

            // Add click handler
            btn.addEventListener('click', (e) => {
                console.log('[Collapse] Header button CLICK EVENT FIRED for panel:', panelId);
                e.preventDefault();
                e.stopPropagation();

                // Remove mobile-collapsed if present, then toggle collapsed
                panel.classList.remove('mobile-collapsed');
                const wasCollapsed = panel.classList.contains('collapsed');
                panel.classList.toggle('collapsed');

                console.log('[Collapse] Panel collapsed state:', panel.classList.contains('collapsed'));

                // Change indicator text from − to + (or vice versa) during animation
                setTimeout(() => {
                    indicator.textContent = wasCollapsed ? '−' : '+';
                }, 150); // Half of 0.3s transition

                // Save state to localStorage
                const states = JSON.parse(SafeStorage.getItem('panelCollapseStates') || '{}');
                states[panelId] = panel.classList.contains('collapsed');
                SafeStorage.setItem('panelCollapseStates', JSON.stringify(states));
            });
        }
    });

    // Handle window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const nowMobile = window.innerWidth <= 768;

            // Remove mobile-collapsed class when resizing to desktop
            if (!nowMobile) {
                document.querySelectorAll('.mobile-collapsed').forEach(panel => {
                    panel.classList.remove('mobile-collapsed');
                });
            }
        }, 250);
    });
}

// Setup keyboard shortcuts
function setupKeyboardShortcuts() {
    const keyboardHint = document.getElementById('keyboard-hint');
    let hintTimeout;

    function showKeyboardHint(text) {
        keyboardHint.innerHTML = text;
        keyboardHint.classList.add('show');
        clearTimeout(hintTimeout);
        hintTimeout = setTimeout(() => {
            keyboardHint.classList.remove('show');
        }, 2000);
    }

    document.addEventListener('keydown', (e) => {
        // Ignore if typing in an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch(e.key.toLowerCase()) {
            case 'r':
                // Reset camera
                document.getElementById('reset-camera').click();
                showKeyboardHint('Camera Reset <kbd>R</kbd>');
                break;
            case 't':
                // Toggle trails
                document.getElementById('toggle-trails-container').click();
                showKeyboardHint(`Trails ${showTrails ? 'ON' : 'OFF'} <kbd>T</kbd>`);
                break;
            case 'l':
                // Toggle labels
                document.getElementById('toggle-labels-container').click();
                showKeyboardHint(`Labels ${showLabels ? 'ON' : 'OFF'} <kbd>L</kbd>`);
                break;
            case 'a':
                // Toggle airports
                document.getElementById('toggle-airports-container').click();
                showKeyboardHint(`Airports ${showAirportsEnabled ? 'ON' : 'OFF'} <kbd>A</kbd>`);
                break;
            case 'h':
                // Toggle runways (H for helipads/runways)
                document.getElementById('toggle-runways-container').click();
                showKeyboardHint(`Runways ${showRunwaysEnabled ? 'ON' : 'OFF'} <kbd>H</kbd>`);
                break;
            case 'v':
                // Toggle altitude lines
                document.getElementById('toggle-altitude-lines-container').click();
                showKeyboardHint(`Alt Lines ${showAltitudeLines ? 'ON' : 'OFF'} <kbd>V</kbd>`);
                break;
            case '?':
                // Show keyboard help
                document.getElementById('keyboard-help-modal').classList.add('show');
                break;
            case 's':
                // Shift+S: Toggle sprite/SVG mode (shows aircraft shapes instead of spheres)
                if (e.shiftKey) {
                    console.log(`[SVG Aircraft] Toggle requested, SVG system available=${!!window.AircraftSVGSystem}, current mode=${useSpriteMode ? 'aircraft shapes' : 'spheres'}`);

                    if (!window.AircraftSVGSystem) {
                        console.warn('[SVG Aircraft] SVG system not loaded, cannot enable aircraft shapes');
                        showKeyboardHint('⚠️ Aircraft shapes not loaded <kbd>Shift+S</kbd>');
                        return;
                    }

                    useSpriteMode = !useSpriteMode;
                    SafeStorage.setItem('useSpriteMode', useSpriteMode);

                    console.log(`[SVG Aircraft] Mode now: ${useSpriteMode ? 'aircraft shapes' : 'spheres'}`);
                    console.log(`[SVG Aircraft] Clearing ${aircraftMeshes.size} aircraft for re-render`);

                    // Clear all aircraft to force re-render with new mode
                    aircraftMeshes.forEach((mesh, hex) => {
                        removeAircraft(hex);
                    });
                    aircraftMeshes.clear();

                    const mode = useSpriteMode ? 'Aircraft Shapes (SVG)' : 'Spheres';
                    showKeyboardHint(`✈️ Aircraft Mode: ${mode} <kbd>Shift+S</kbd>`);
                    console.log(`[SVG Aircraft] Mode switched to: ${mode}, waiting for aircraft to reload...`);
                }
                break;
            case 'k':
                // Secret: Ctrl+K: Show aircraft shape reference
                if (e.ctrlKey) {
                    e.preventDefault(); // Prevent browser search
                    console.log('[Secret] Aircraft Shape Reference activated!');
                    showAircraftShapeReference();
                }
                break;
            case 'escape':
                // Close keyboard help modal if open
                const keyboardHelpModal = document.getElementById('keyboard-help-modal');
                if (keyboardHelpModal.classList.contains('show')) {
                    keyboardHelpModal.classList.remove('show');
                    showKeyboardHint('Help Closed <kbd>ESC</kbd>');
                }
                // Close about modal if open
                else {
                    const aboutModal = document.getElementById('about-modal');
                    if (aboutModal.classList.contains('show')) {
                        aboutModal.classList.remove('show');
                        showKeyboardHint('About Closed <kbd>ESC</kbd>');
                    }
                    // Deselect aircraft and exit follow mode
                    else if (followMode) {
                        document.getElementById('toggle-follow').click();
                        showKeyboardHint('Follow Mode OFF <kbd>ESC</kbd>');
                    } else if (selectedAircraft) {
                        deselectAircraft();
                        showKeyboardHint('Aircraft Deselected <kbd>ESC</kbd>');
                    }
                }
                break;
        }
    });
}

// Secret: Aircraft Shape Reference Viewer
function showAircraftShapeReference() {
    if (!window.AircraftSVGSystem) {
        console.warn('[Shape Reference] SVG system not loaded');
        return;
    }

    // Create modal if it doesn't exist
    let modal = document.getElementById('aircraft-shape-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'aircraft-shape-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.9);
            backdrop-filter: blur(10px);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            animation: fadeIn 0.3s ease;
        `;
        modal.innerHTML = `
            <div style="background: var(--panel-bg); border: 1px solid var(--panel-border); border-radius: 8px; max-width: 900px; max-height: 85vh; overflow-y: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
                <div style="padding: 20px; border-bottom: 1px solid var(--panel-border); display: flex; justify-content: space-between; align-items: center;">
                    <h2 style="margin: 0; color: var(--text-primary);">Aircraft Shape Reference</h2>
                    <button onclick="document.getElementById('aircraft-shape-modal').style.display='none'" style="background: none; border: none; color: var(--text-primary); font-size: 24px; cursor: pointer; padding: 0 10px;">&times;</button>
                </div>
                <div id="aircraft-shape-grid" style="padding: 20px;">
                    <p style="text-align: center; color: #888;">Loading shapes...</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Build the shape reference grid
    const shapeGrid = document.getElementById('aircraft-shape-grid');
    const shapes = window.AircraftSVGSystem.AIRCRAFT_SHAPES;

    let html = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px;">';

    // Get example aircraft for each shape (comprehensive mapping)
    const shapeExamples = {
        // Airbus family
        'a319': ['A319'], 'a320': ['A320'], 'a321': ['A321'],
        'a332': ['A332'], 'a333': ['A333'], 'a359': ['A359'],
        'a380': ['A380'], 'a400': ['A400M'],

        // Boeing family
        'b737': ['B737'], 'b738': ['B738'], 'b739': ['B739'],
        'b747': ['B747'], 'b752': ['B752'], 'b763': ['B763'],
        'b772': ['B772'], 'b77l': ['B77L'], 'b77w': ['B77W'],
        'b788': ['B788'], 'b789': ['B789'], 'b78x': ['B78X'],
        'b707': ['B707'], 'b52': ['B52'],

        // Military/Special purpose
        'p8': ['P8'], 'e737': ['E737'], 'e3awacs': ['E3 AWACS'],
        'p3_orion': ['P3 Orion'], 'kc135': ['KC135'], 'kc46': ['KC46'],
        'c130': ['C130'], 'c17': ['C17'], 'c5': ['C5'], 'c2': ['C2'],

        // Fighters
        'f16': ['F16'], 'f18': ['F18'], 'f35': ['F35'],
        'hi_perf': ['F15', 'F22'], 'f5_tiger': ['F5'],
        'a10': ['A10'], 'mirage': ['Mirage'], 'rafale': ['Rafale'],
        'typhoon': ['Typhoon'], 'sb39': ['JAS 39'], 'harrier': ['Harrier'],

        // Helicopters
        'helicopter': ['Generic'], 'blackhawk': ['UH-60'],
        'apache': ['AH-64'], 'chinook': ['CH-47'],
        's61': ['S61'], 'ec145': ['H145'],

        // General aviation
        'cessna': ['C172', 'C152'], 'cirrus_sr22': ['SR22'],
        'pa24': ['PA24'], 'rutan_veze': ['Veze'],

        // Business/Regional
        'crj2': ['CRJ2'], 'crj9': ['CRJ9'], 'e170': ['E170'],
        'e190': ['E190'], 'e75l': ['E175'],

        // Cargo/Heavy
        'heavy_2e': ['B777', 'A330'], 'heavy_4e': ['B747', 'A340'],
        'md11': ['MD11'], 'c97': ['Super Guppy'], 'beluga': ['Beluga'],

        // Reconnaissance/Special
        'u2': ['U2'], 'wb57': ['WB-57'], 't38': ['T-38'],

        // Tiltrotor
        'v22_slow': ['V22 (slow)'], 'v22_fast': ['V22 (fast)'],

        // Other
        'glider': ['Glider'], 'balloon': ['Balloon'], 'blimp': ['Blimp'],
        'uav': ['UAV/Drone'], 'gyrocopter': ['Gyrocopter'],
        'ground_vehicle': ['Ground Vehicle'], 'ground_unknown': ['Ground Unknown'],
        'airliner': ['Generic Jet'],

        // Special shapes
        'pumpkin': ['Pumpkin'], 'witchl': ['Witch (left)'], 'witchr': ['Witch (right)']
    };

    for (const [shapeName, shape] of Object.entries(shapes)) {
        const canvas = document.createElement('canvas');
        canvas.width = 150;
        canvas.height = 150;
        const ctx = canvas.getContext('2d');

        // Draw shape to canvas
        const viewBox = shape.viewBox.split(' ').map(Number);
        const vbX = viewBox[0];
        const vbY = viewBox[1];
        const vbW = viewBox[2];
        const vbH = viewBox[3];

        const scale = Math.min(120 / vbW, 120 / vbH);
        const offsetX = 75 - (vbX + vbW / 2) * scale;
        const offsetY = 75 - (vbY + vbH / 2) * scale;

        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        const svgPath = new Path2D(shape.path);
        ctx.fillStyle = '#00aaff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = (shape.strokeScale || 1) / scale;
        ctx.fill(svgPath);
        ctx.stroke(svgPath);

        // Handle accent (secondary path, if present - e.g., fuselage windows on P8)
        if (shape.accent) {
            const accentPaths = Array.isArray(shape.accent) ? shape.accent : [shape.accent];
            const accentMult = shape.accentMult || 1;

            accentPaths.forEach(accentPath => {
                const accentSvgPath = new Path2D(accentPath);
                ctx.lineWidth = ((shape.strokeScale || 1) / scale) * accentMult;
                ctx.stroke(accentSvgPath);
            });
        }

        ctx.restore();

        const dataUrl = canvas.toDataURL();
        const examples = shapeExamples[shapeName] || [];
        const exampleText = examples.length > 0 ? examples.join(', ') : 'N/A';

        html += `
            <div style="border: 1px solid #333; padding: 15px; border-radius: 8px; text-align: center; background: rgba(0,0,0,0.3);">
                <img src="${dataUrl}" style="width: 150px; height: 150px; image-rendering: pixelated;" alt="${shapeName}">
                <div style="margin-top: 10px; font-weight: bold; color: #00aaff;">${shapeName}</div>
                <div style="margin-top: 5px; font-size: 11px; color: #888;">Examples: ${exampleText}</div>
            </div>
        `;
    }

    html += '</div>';
    shapeGrid.innerHTML = html;

    // Show modal
    modal.style.display = 'flex';
    console.log(`[Shape Reference] Displayed ${Object.keys(shapes).length} aircraft shapes`);
}

// Route cache management
function getRouteCache() {
    try {
        const cached = SafeStorage.getItem(ROUTE_CACHE_KEY);
        return cached ? JSON.parse(cached) : {};
    } catch (e) {
        console.warn('Failed to read route cache:', e);
        return {};
    }
}

function setRouteCache(cache) {
    try {
        SafeStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.warn('Failed to write route cache:', e);
    }
}

function getCachedRoute(callsign) {
    const cache = getRouteCache();
    const entry = cache[callsign];

    if (!entry) return null;

    // Check if cache entry is expired
    const now = Date.now();
    if (now - entry.timestamp > ROUTE_CACHE_DURATION) {
        return null;
    }

    return entry.data;
}

function cacheRoute(callsign, data) {
    const cache = getRouteCache();
    cache[callsign] = {
        data: data,
        timestamp: Date.now()
    };
    setRouteCache(cache);
}

// Fetch route information from adsbdb.com API with rate limiting
async function fetchRouteInfo(callsign) {
    if (!callsign) return null;

    // Clean up callsign (remove whitespace)
    callsign = callsign.trim();
    if (!callsign) return null;

    // Check cache first
    const cached = getCachedRoute(callsign);
    if (cached) {
        return cached;
    }

    // Check if request is already in flight
    if (pendingRouteRequests.has(callsign)) {
        return pendingRouteRequests.get(callsign);
    }

    // Rate limiting - ensure minimum time between API calls
    const now = Date.now();
    const timeSinceLastCall = now - lastAPICall;
    if (timeSinceLastCall < API_RATE_LIMIT_MS) {
        const waitTime = API_RATE_LIMIT_MS - timeSinceLastCall;
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // Create the request promise
    const requestPromise = (async () => {
        try {
            lastAPICall = Date.now();
            const response = await fetch(`https://api.adsbdb.com/v0/callsign/${callsign}`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (data.response === 'unknown callsign' || !data.response?.flightroute) {
                // Cache null result to avoid repeated lookups
                cacheRoute(callsign, null);
                return null;
            }

            const route = data.response.flightroute;
            cacheRoute(callsign, route);
            return route;

        } catch (error) {
            console.warn(`Failed to fetch route for ${callsign}:`, error.message);
            return null;
        } finally {
            pendingRouteRequests.delete(callsign);
        }
    })();

    pendingRouteRequests.set(callsign, requestPromise);
    return requestPromise;
}

// Fetch aircraft information including photo from adsbdb.com API
async function fetchAircraftInfo(hex) {
    if (!hex) return null;

    // Check cache first (using same cache as routes with different key)
    const cacheKey = `aircraft_${hex}`;
    const cached = getCachedRoute(cacheKey);
    if (cached) {
        return cached;
    }

    // Check if request is already in flight
    if (pendingRouteRequests.has(cacheKey)) {
        return pendingRouteRequests.get(cacheKey);
    }

    // Rate limiting
    const now = Date.now();
    const timeSinceLastCall = now - lastAPICall;
    if (timeSinceLastCall < API_RATE_LIMIT_MS) {
        const waitTime = API_RATE_LIMIT_MS - timeSinceLastCall;
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    const requestPromise = (async () => {
        try {
            lastAPICall = Date.now();
            const response = await fetch(`https://api.adsbdb.com/v0/aircraft/${hex}`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!data.response?.aircraft) {
                cacheRoute(cacheKey, null);
                return null;
            }

            const aircraft = data.response.aircraft;
            cacheRoute(cacheKey, aircraft);
            return aircraft;

        } catch (error) {
            console.warn(`Failed to fetch aircraft info for ${hex}:`, error.message);
            return null;
        } finally {
            pendingRouteRequests.delete(cacheKey);
        }
    })();

    pendingRouteRequests.set(cacheKey, requestPromise);
    return requestPromise;
}

// Deselect currently selected aircraft
function deselectAircraft() {
    selectedAircraft = null;
    document.getElementById('aircraft-detail').style.display = 'none';

    const followBtn = document.getElementById('toggle-follow');
    if (followBtn) {
        followBtn.style.display = 'none';
    }

    // Remove selected class from all list items
    document.querySelectorAll('.aircraft-item').forEach(item => {
        item.classList.remove('selected');
    });
}

// Convert lat/lon to scene coordinates (simple equirectangular projection)
function latLonToXZ(lat, lon) {
    const homeLat = CONFIG.homeLocation.lat;
    const homeLon = CONFIG.homeLocation.lon;

    // Use Web Mercator projection to match the map tiles
    // This converts lat/lon to Web Mercator meters, then scales to km
    const latToMercatorY = (lat) => {
        const latRad = lat * Math.PI / 180;
        return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    };

    // Earth's radius in km
    const R = 6371;

    // Convert both points to Web Mercator
    const homeMercY = latToMercatorY(homeLat);
    const mercY = latToMercatorY(lat);

    // X is still based on longitude difference, but adjusted for latitude
    const avgLat = (homeLat + lat) / 2;
    const avgLatRad = avgLat * Math.PI / 180;
    const dLon = (lon - homeLon) * Math.PI / 180;
    const x = dLon * Math.cos(avgLatRad) * R;

    // Z uses Web Mercator Y difference
    const z = -(mercY - homeMercY) * R;

    return { x, z };
}

// Fetch aircraft data from Ultrafeeder
let fetchErrorCount = 0;
const MAX_FETCH_ERRORS = 5;

async function fetchAircraftData() {
    try {
        // Use BASE_PATH from config.js, default to '' if not defined
        const basePath = window.ADSB_CONFIG?.BASE_PATH || '';
        const response = await fetch(`${basePath}/data/aircraft.json`);

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
            updateSidebarAircraftList(data);
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
 * Update aircraft positions and render them in the 3D scene
 * Main function called every second to update all aircraft from ADS-B data
 * @param {Array<Object>} aircraft - Array of aircraft objects from feeder
 * @param {string} aircraft[].hex - ICAO hex code (unique identifier)
 * @param {number} aircraft[].lat - Latitude in decimal degrees
 * @param {number} aircraft[].lon - Longitude in decimal degrees
 * @param {number} aircraft[].alt_baro - Barometric altitude in feet
 * @param {string} [aircraft[].flight] - Flight callsign
 * @param {number} [aircraft[].track] - Track/heading in degrees
 * @param {number} [aircraft[].gs] - Ground speed in knots
 * @returns {void}
 */
function updateAircraft(aircraft) {
    // Don't update if not in live mode
    if (currentMode !== 'live') {
        return;
    }

    const currentHexes = new Set();

    // Validate aircraft is an array
    if (!Array.isArray(aircraft)) {
        console.warn('Aircraft data is not an array:', aircraft);
        return;
    }

    // Reset real-time stats for this update
    StatsState.currentCount = 0;
    StatsState.militaryCount = 0;
    StatsState.highestAircraft = null;
    StatsState.lowestAircraft = null;
    StatsState.totalAltitude = 0;

    aircraft.forEach(ac => {
        // Validate required fields and data types
        if (!ac || typeof ac !== 'object') return;
        if (!ac.hex || typeof ac.hex !== 'string') return;
        if (typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return;
        if (typeof ac.alt_baro !== 'number') return;

        // Validate coordinate ranges
        if (ac.lat < -90 || ac.lat > 90) return;
        if (ac.lon < -180 || ac.lon > 180) return;
        if (ac.alt_baro < -1000 || ac.alt_baro > 100000) return; // Reasonable altitude range

        currentHexes.add(ac.hex);

        // Update statistics
        StatsState.currentCount++;
        StatsState.totalAltitude += ac.alt_baro;

        // Track unique aircraft today
        if (!StatsState.uniqueToday.has(ac.hex)) {
            StatsState.uniqueToday.add(ac.hex);
            saveUniqueToday(); // Save to localStorage
        }

        // Military aircraft count
        if (isMilitaryAircraft(ac.hex)) {
            StatsState.militaryCount++;
        }

        // Track highest aircraft
        if (!StatsState.highestAircraft || ac.alt_baro > StatsState.highestAircraft.altitude) {
            StatsState.highestAircraft = {
                hex: ac.hex,
                tail: ac.flight?.trim() || ac.r || ac.hex,
                altitude: ac.alt_baro
            };
        }

        // Track lowest aircraft (above 100ft to avoid ground clutter)
        if (ac.alt_baro > 100) {
            if (!StatsState.lowestAircraft || ac.alt_baro < StatsState.lowestAircraft.altitude) {
                StatsState.lowestAircraft = {
                    hex: ac.hex,
                    tail: ac.flight?.trim() || ac.r || ac.hex,
                    altitude: ac.alt_baro
                };
            }
        }

        const pos = latLonToXZ(ac.lat, ac.lon);
        // feet to meters to scene units, with exaggeration for visibility
        let altitude = (ac.alt_baro - CONFIG.homeLocation.alt) * 0.3048 * CONFIG.scale * CONFIG.altitudeExaggeration;

        // Altitude smoothing: detect and filter out temporary zero/low altitude glitches
        // Common ADS-B issue where altitude data is briefly lost
        const existingMesh = aircraftMeshes.get(ac.hex);
        if (existingMesh && existingMesh.userData.lastValidAltitude) {
            const lastValidAlt = existingMesh.userData.lastValidAltitude;

            // If new altitude is suspiciously low (< 100 ft) but last altitude was normal (> 1000 ft),
            // this is likely a data glitch - use last valid altitude instead
            if (ac.alt_baro < 100 && existingMesh.userData.alt_baro > 1000) {
                altitude = lastValidAlt;
                // Keep the old alt_baro value in userData so it doesn't update display
                ac.alt_baro = existingMesh.userData.alt_baro;
            }
        }

        // Minimum altitude constraint - keep aircraft above ground
        // Use 1.0 units as minimum to ensure visibility
        const isVeryLow = altitude < 2.0; // Flag for aircraft below 2 units
        altitude = Math.max(1.0, altitude);

        // Check if aircraft is reappearing after being lost
        const wasStale = staleTrails.has(ac.hex);

        // Create or update aircraft mesh
        if (!aircraftMeshes.has(ac.hex)) {
            createAircraft(ac.hex, pos.x, altitude, pos.z, ac.t, ac, isVeryLow);

            // If aircraft was stale, restore its trail and add dashed gap line
            if (wasStale) {
                const staleTrail = staleTrails.get(ac.hex);
                if (staleTrail && staleTrail.positions.length > 0) {
                    // Get last known position
                    const lastPos = staleTrail.positions[staleTrail.positions.length - 1];

                    // Create a dashed line showing uncertainty gap
                    const gapGeometry = new THREE.BufferGeometry();
                    const gapPositions = new Float32Array([
                        lastPos.x, lastPos.y, lastPos.z,
                        pos.x, altitude, pos.z
                    ]);
                    gapGeometry.setAttribute('position', new THREE.BufferAttribute(gapPositions, 3));

                    const gapMaterial = new THREE.LineDashedMaterial({
                        color: getAltitudeColor(altitude),
                        transparent: true,
                        opacity: 0.4,
                        dashSize: 2,
                        gapSize: 1
                    });

                    const gapLine = new THREE.Line(gapGeometry, gapMaterial);
                    gapLine.computeLineDistances(); // Required for dashed lines
                    scene.add(gapLine);

                    // Store gap line with the trail
                    staleTrail.gapLine = gapLine;
                }

                // Move trail back to active trails
                trails.set(ac.hex, staleTrails.get(ac.hex));
                staleTrails.delete(ac.hex);
            }
        } else {
            const mesh = aircraftMeshes.get(ac.hex);

            // Check/update military status (in case database loaded after creation)
            const isMilitary = isMilitaryAircraft(ac.hex);
            const militaryInfo = isMilitary ? getMilitaryInfo(ac.hex) : null;

            // Calculate updated signal quality
            const signalQuality = getSignalQuality(ac);

            // Update aircraft data BEFORE updateAircraftPosition so vertical indicator has current baro_rate
            mesh.userData = ac;
            mesh.userData.isVeryLow = isVeryLow; // Preserve isVeryLow flag
            mesh.userData.isMilitary = isMilitary; // Update military status
            mesh.userData.militaryInfo = militaryInfo; // Update military info
            mesh.userData.lastValidAltitude = altitude; // Store for altitude smoothing
            mesh.userData.signalQuality = signalQuality; // Update signal quality

            // Update opacity based on signal quality
            mesh.traverse((child) => {
                if (child.isMesh && child.material) {
                    // Update opacity for ghost-like effect on poor signals
                    child.material.opacity = signalQuality.opacity;
                    if (signalQuality.score < 40) {
                        // Extra transparent for very poor signals
                        child.material.opacity = Math.min(child.material.opacity, 0.4);
                    }
                }
            });

            // Update sprite rotation if in sprite mode and heading changed
            if (useSpriteMode && ac.track !== undefined) {
                mesh.children.forEach(child => {
                    if (child.userData.isSprite) {
                        const oldHeading = child.userData.spriteHeading || 0;
                        const newHeading = ac.track;

                        // Update if heading changed by more than 2 degrees
                        if (Math.abs(newHeading - oldHeading) > 2.0) {
                            // Rotate around Y axis for horizontal plane, negative like runways
                            // NOTE: -90° SVG offset is baked into geometry, so only apply heading here
                            child.rotation.y = -(newHeading * Math.PI / 180);
                            child.userData.spriteHeading = newHeading;

                            // Log rotation updates (sample 1% to avoid spam)
                            if (Math.random() < 0.01) {
                                console.log(`[Sprites] Rotating ${ac.hex}: ${oldHeading.toFixed(1)}° → ${newHeading.toFixed(1)}°`);
                            }
                        }
                    }
                });
            }

            // Update color if military status changed
            if (CONFIG.highlightMilitary && isMilitary) {
                mesh.traverse((child) => {
                    if (child.isMesh && child.material) {
                        // Check if this is a shader material (sprite) or standard material
                        if (child.material.type === 'ShaderMaterial' && child.material.uniforms && child.material.uniforms.tintColor) {
                            // For shader material sprites, update tintColor uniform
                            child.material.uniforms.tintColor.value.setHex(CONFIG.militaryColor);
                        } else if (child.material.color) {
                            // For standard materials (spheres)
                            child.material.color.setHex(CONFIG.militaryColor);
                            if (child.material.emissive) {
                                child.material.emissive.setHex(CONFIG.militaryColor);
                            }
                        }
                    }
                });

                // Create military indicator if it doesn't exist yet (database loaded after aircraft creation)
                if (!militaryIndicators.has(ac.hex) && militaryInfo) {
                    const militaryIcon = createMilitaryIndicator();
                    militaryIcon.position.set(pos.x - 4, altitude + 4, pos.z);
                    scene.add(militaryIcon);
                    militaryIndicators.set(ac.hex, militaryIcon);
                }
            }

            updateAircraftPosition(ac.hex, pos.x, altitude, pos.z);
        }

        // Update trail (pass altitude in feet and ground speed for color changes)
        updateTrail(ac.hex, pos.x, altitude, pos.z, ac.alt_baro, ac.gs);
    });

    // Remove aircraft that are no longer visible
    aircraftMeshes.forEach((mesh, hex) => {
        if (!currentHexes.has(hex)) {
            removeAircraft(hex);
        }
    });

    // Defensive cleanup: Remove any orphaned altitude lines for aircraft that no longer exist
    altitudeLines.forEach((line, hex) => {
        if (!aircraftMeshes.has(hex)) {
            console.warn(`[Cleanup] Removing orphaned altitude line for ${hex}`);
            scene.remove(line);
            line.geometry.dispose();
            line.material.dispose();
            altitudeLines.delete(hex);
        }
    });

    // Defensive cleanup: Remove any orphaned labels for aircraft that no longer exist
    aircraftLabels.forEach((label, hex) => {
        if (!aircraftMeshes.has(hex)) {
            console.warn(`[Cleanup] Removing orphaned label for ${hex}`);
            scene.remove(label);
            if (label.material) {
                if (label.material.map) label.material.map.dispose();
                label.material.dispose();
            }
            aircraftLabels.delete(hex);
        }
    });

    // Defensive cleanup: Remove any orphaned military indicators for aircraft that no longer exist
    militaryIndicators.forEach((icon, hex) => {
        if (!aircraftMeshes.has(hex)) {
            console.warn(`[Cleanup] Removing orphaned military indicator for ${hex}`);
            scene.remove(icon);
            if (icon.material) {
                if (icon.material.map) icon.material.map.dispose();
                icon.material.dispose();
            }
            militaryIndicators.delete(hex);
        }
    });

    // Check URL parameters on first load
    if (!urlParamsChecked) {
        urlParamsChecked = true;
        checkUrlParameters();
    }

}

// Create aircraft model - sphere or sprite based on mode
function createAircraftModel(color, aircraftData = null) {
    const group = new THREE.Group();

    // SVG mode: Use accurate aircraft shapes from tar1090 (replacing sprite mode)
    if (useSpriteMode && window.AircraftSVGSystem) {
        // Get aircraft type and heading
        const typeDesignator = aircraftData?.t || null;
        const category = aircraftData?.category || null;
        const heading = aircraftData?.track !== undefined ? aircraftData.track : 0;

        // Additional fields for enhanced matching (from tar1090 aircraft database)
        // dbFlags is a bitmask that contains typeDescription when available
        const typeDescription = aircraftData?.desc_short || null; // ICAO type description (e.g., "L2J")
        const wtc = aircraftData?.wtc || null; // Wake turbulence category (L/M/H/J)
        const altitude = aircraftData?.alt_baro === "ground" ? "ground" : null;

        // Get the appropriate marker using tar1090's matching logic
        const [shapeName, scaling] = window.AircraftSVGSystem.getBaseMarker(
            category,
            typeDesignator,
            typeDescription,
            wtc,
            altitude
        );

        // Debug logging
        if (aircraftData?.hex) {
            console.log(`[SVG] Aircraft ${aircraftData.hex}: type=${typeDesignator}, category=${category}, typeDesc=${typeDescription}, wtc=${wtc}, shape=${shapeName}, scaling=${scaling}`);
        }

        // Generate or get cached texture (gray fill with white border, tinted by shader)
        const texture = window.AircraftSVGSystem.svgShapeToTexture(
            shapeName,
            '#ffffff',       // Ignored - SVG uses gray fill
            '#000000',       // Ignored - SVG uses white border only
            0.5,             // Stroke width multiplier
            scaling          // Shape-specific scaling
        );

        if (texture) {
            // Create horizontal plane with texture
            const size = 14;  // Increased size for better visibility at distance
            const geometry = new THREE.PlaneGeometry(size, size);
            geometry.rotateX(-Math.PI / 2); // Rotate to horizontal
            // After rotateX: plane is horizontal, texture "up" now points +Z (south)

            // Create shader material that preserves white outline while tinting and glowing the aircraft
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    map: { value: texture },
                    tintColor: { value: new THREE.Color(color) },
                    emissiveIntensity: { value: 0.4 }
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform sampler2D map;
                    uniform vec3 tintColor;
                    uniform float emissiveIntensity;
                    varying vec2 vUv;
                    void main() {
                        vec4 texColor = texture2D(map, vUv);

                        // If pixel is white or very bright (border), keep it white
                        float brightness = (texColor.r + texColor.g + texColor.b) / 3.0;
                        if (brightness > 0.7) {
                            gl_FragColor = texColor; // Keep white border white
                        } else {
                            // Apply tint to darker pixels (the aircraft shape) + emissive glow
                            vec3 tintedColor = texColor.rgb * tintColor;
                            vec3 emissiveGlow = tintColor * emissiveIntensity;
                            gl_FragColor = vec4(tintedColor + emissiveGlow, texColor.a);
                        }
                    }
                `,
                transparent: true,
                alphaTest: 0.1,
                side: THREE.DoubleSide,
                depthWrite: true,
                depthTest: true
            });

            const plane = new THREE.Mesh(geometry, material);

            // Check if this shape should not be rotated (balloons, ground vehicles)
            const shapeInfo = window.AircraftSVGSystem.AIRCRAFT_SHAPES[shapeName];
            const noRotate = shapeInfo && shapeInfo.noRotate === true;

            // NOTE: Rotation will be applied to the GROUP (parent), not the plane child
            // This is handled in createAircraft() after the group is created
            // Don't rotate the child here - just store the heading for later

            // Store metadata for updates (use spriteHeading for consistency with update code)
            plane.userData.aircraftShape = shapeName;
            plane.userData.aircraftType = typeDesignator;
            plane.userData.aircraftCategory = category;
            plane.userData.noRotate = noRotate; // Store for later updates
            plane.userData.spriteHeading = heading;  // Changed from aircraftHeading to spriteHeading
            plane.userData.isSprite = true;  // Keep compatibility

            group.add(plane);
        } else {
            // Fallback to sphere if texture generation failed
            console.warn(`[SVG] Failed to generate texture for ${shapeName}, falling back to sphere`);
            const material = new THREE.MeshPhongMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.3,
                shininess: 100
            });
            const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16), material);
            group.add(sphere);
        }
    }
    // Sphere mode: Use 3D spheres (original behavior)
    else {
        const material = new THREE.MeshPhongMaterial({
            color: color,
            emissive: new THREE.Color(color), // Glow with altitude color
            emissiveIntensity: 0.4, // Subtle glow to enhance visibility
            shininess: 100
        });

        // Main aircraft sphere with increased size for better visibility
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 16), material);
        group.add(sphere);
    }

    return group;
}

function createAircraft(hex, x, y, z, aircraftType, aircraftData, isVeryLow = false) {
    // Check if aircraft is MLAT-positioned
    const isMLAT = aircraftData.mlat && aircraftData.mlat.length > 0;

    // Check if aircraft is military
    const isMilitary = isMilitaryAircraft(hex);
    const militaryInfo = isMilitary ? getMilitaryInfo(hex) : null;

    // Create aircraft sphere or sprite with altitude-based or military color
    const aircraftColor = (CONFIG.highlightMilitary && isMilitary) ? CONFIG.militaryColor : getAltitudeColor(y);
    const mesh = createAircraftModel(aircraftColor, aircraftData);
    mesh.position.set(x, y, z);

    // Check if any child has sprite metadata (set in createAircraftModel)
    let isSprite = false;
    let noRotate = false;
    mesh.traverse((child) => {
        if (child.userData.isSprite) isSprite = true;
        if (child.userData.noRotate) noRotate = true;
    });

    // Calculate signal quality and apply opacity
    const signalQuality = getSignalQuality(aircraftData);

    mesh.userData = aircraftData;
    mesh.userData.isMLAT = isMLAT;
    mesh.userData.isVeryLow = isVeryLow;
    mesh.userData.isMilitary = isMilitary;
    mesh.userData.militaryInfo = militaryInfo;
    mesh.userData.lastValidAltitude = y; // Store for altitude smoothing
    mesh.userData.isSprite = isSprite; // Copy from child for rotation logic
    mesh.userData.noRotate = noRotate; // Copy from child for rotation logic
    mesh.userData.signalQuality = signalQuality; // Store signal quality for detail display

    // Apply initial rotation to the GROUP (not the child plane)
    // Geometry already has rotateX baked in, making it horizontal with nose pointing +Z (south)
    // We only need to rotate around Y axis for heading

    if (!noRotate && aircraftData.track !== undefined) {
        const trackRad = aircraftData.track * Math.PI / 180;
        // If backwards with trackRad, try negative rotation
        mesh.rotation.y = -trackRad;
    } else if (!noRotate) {
        mesh.rotation.y = 0; // Default pointing south (will update when track available)
    }
    // For noRotate shapes, leave rotation at 0

    // DEBUG: Log aircraft creation with detailed info
    console.log(`[Create] hex=${hex}, flight=${aircraftData.flight?.trim()}, track=${aircraftData.track}°, quality=${signalQuality.quality} (${signalQuality.score}%), opacity=${signalQuality.opacity.toFixed(2)}`);

    // Apply opacity based on signal quality - makes poor signal aircraft "ghost-like"
    mesh.traverse((child) => {
        if (child.isMesh && child.material) {
            // Clone material to avoid affecting other aircraft
            child.material = child.material.clone();
            child.material.transparent = true;
            child.material.opacity = signalQuality.opacity;

            // Add subtle wireframe for very poor signals
            if (signalQuality.score < 40) {
                child.material.wireframe = false; // Don't use wireframe, too confusing
                // Instead, make them extra transparent
                child.material.opacity = Math.min(child.material.opacity, 0.4);
            }
        }
    });

    scene.add(mesh);
    aircraftMeshes.set(hex, mesh);

    // Clean up any existing altitude line before creating a new one (defensive)
    const existingAltLine = altitudeLines.get(hex);
    if (existingAltLine) {
        scene.remove(existingAltLine);
        existingAltLine.geometry.dispose();
        existingAltLine.material.dispose();
        altitudeLines.delete(hex);
    }

    // Create altitude line from ground to aircraft
    const altLineGeometry = new THREE.BufferGeometry();
    const altLinePositions = new Float32Array([
        x, 0, z,  // Ground point
        x, y, z   // Aircraft position
    ]);
    altLineGeometry.setAttribute('position', new THREE.BufferAttribute(altLinePositions, 3));
    const altLineMaterial = new THREE.LineBasicMaterial({
        color: CONFIG.homeMarker,
        transparent: true,
        opacity: 0.3
    });
    const altLine = new THREE.Line(altLineGeometry, altLineMaterial);
    altLine.visible = showAltitudeLines;
    scene.add(altLine);
    altitudeLines.set(hex, altLine);

    // Clean up any existing label before creating a new one (defensive)
    const existingLabel = aircraftLabels.get(hex);
    if (existingLabel) {
        scene.remove(existingLabel);
        if (existingLabel.material.map) existingLabel.material.map.dispose();
        existingLabel.material.dispose();
        aircraftLabels.delete(hex);
    }

    // Create text label sprite
    const label = createTextLabel('');
    label.position.set(x, y + 3, z); // Float above aircraft
    scene.add(label);
    aircraftLabels.set(hex, label);

    // Clean up any existing military indicator before creating a new one (defensive)
    // This handles edge cases where an aircraft reappears after going stale
    const existingMilitaryIcon = militaryIndicators.get(hex);
    if (existingMilitaryIcon) {
        scene.remove(existingMilitaryIcon);
        if (existingMilitaryIcon.material.map) existingMilitaryIcon.material.map.dispose();
        existingMilitaryIcon.material.dispose();
        militaryIndicators.delete(hex);
    }

    // Create military indicator if this is a military aircraft
    if (isMilitary && militaryInfo) {
        const militaryIcon = createMilitaryIndicator();
        militaryIcon.position.set(x - 4, y + 4, z); // Float to the left of the label
        scene.add(militaryIcon);
        militaryIndicators.set(hex, militaryIcon);
    }

    // Create trail with initial capacity (will grow as needed)
    const trailGeometry = new THREE.BufferGeometry();
    const initialCapacity = 1000; // Start with space for 1000 points
    const positions = new Float32Array(initialCapacity * 3);
    const colors = new Float32Array(initialCapacity * 3); // RGB for each vertex
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    trailGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const trailMaterial = new THREE.LineBasicMaterial({
        vertexColors: true, // Use vertex colors instead of single color
        transparent: true,
        opacity: 0.6
    });

    const trail = new THREE.Line(trailGeometry, trailMaterial);
    trail.visible = showTrails;
    scene.add(trail);
    trails.set(hex, {
        line: trail,
        positions: [],
        capacity: initialCapacity,
        originalColors: null  // Will store original colors for hover restore
    });
}

// Create text label as sprite
function createTextLabel(text) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 320;
    canvas.height = 80;

    // Draw background box
    context.fillStyle = 'rgba(0, 0, 0, 0.6)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Add white border around the label box
    context.strokeStyle = 'rgba(255, 255, 255, 0.9)'; // White border
    context.lineWidth = 6; // Thicker border for visibility from distance
    context.strokeRect(0, 0, canvas.width, canvas.height);

    // Draw text (no outline - better readability)
    context.font = 'Bold 28px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(10, 2.5, 1);
    sprite.visible = showLabels;

    // Add larger invisible hitbox for easier clicking
    // Create a plane geometry that's larger than the visible label
    const hitboxGeometry = new THREE.PlaneGeometry(12, 3.5);  // Larger than sprite (10x2.5)
    const hitboxMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,  // Invisible
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false
    });
    const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);

    // Create a group containing both the visible sprite and invisible hitbox
    const labelGroup = new THREE.Group();
    labelGroup.add(sprite);
    labelGroup.add(hitbox);
    labelGroup.visible = showLabels;

    // Store reference to sprite for updating text
    labelGroup.userData.sprite = sprite;

    return labelGroup;
}

// Update label text
function updateLabelText(labelGroup, text) {
    // labelGroup is now a Group containing sprite + hitbox
    // Get the actual sprite from userData
    const sprite = labelGroup.userData.sprite;

    // Store text in userData for highlight function
    labelGroup.userData.text = text;

    const canvas = sprite.material.map.image;
    const context = canvas.getContext('2d');

    // Clear and redraw
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(0, 0, 0, 0.6)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.font = 'Bold 28px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    // Handle multi-line text (split by \n)
    const lines = text.split('\n');
    const lineHeight = 32;
    const totalHeight = lines.length * lineHeight;
    const startY = (canvas.height - totalHeight) / 2 + lineHeight / 2;

    lines.forEach((line, index) => {
        context.fillText(line, canvas.width / 2, startY + index * lineHeight);
    });

    sprite.material.map.needsUpdate = true;
}

// Create military indicator sprite (shield emoji)
function createMilitaryIndicator() {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 128;
    canvas.height = 128;

    // Draw red background circle
    context.fillStyle = 'rgba(204, 0, 0, 0.9)';
    context.beginPath();
    context.arc(64, 64, 60, 0, Math.PI * 2);
    context.fill();

    // Draw shield emoji
    context.font = 'Bold 70px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('🛡️', 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(3, 3, 1); // Small but visible
    return sprite;
}

function updateAircraftPosition(hex, x, y, z) {
    const mesh = aircraftMeshes.get(hex);
    if (!mesh) return;

    // Update position
    mesh.position.set(x, y, z);

    // Update altitude line position
    const altLine = altitudeLines.get(hex);
    if (altLine) {
        const positions = altLine.geometry.attributes.position.array;
        positions[0] = x; positions[1] = 0; positions[2] = z; // Ground point
        positions[3] = x; positions[4] = y; positions[5] = z; // Aircraft position
        altLine.geometry.attributes.position.needsUpdate = true;
    }

    // Update label position (float above aircraft)
    const label = aircraftLabels.get(hex);
    if (label) {
        label.position.set(x, y + 3, z);

        // Update military indicator position if present
        const militaryIcon = militaryIndicators.get(hex);
        if (militaryIcon) {
            militaryIcon.position.set(x - 4, y + 4, z);
        }

        // Update label text with callsign and altitude
        const callsign = mesh.userData.flight?.trim() || mesh.userData.hex || hex;
        const altitude = mesh.userData.alt_baro ? `${Math.round(mesh.userData.alt_baro)}ft` : '';
        const isMLAT = mesh.userData.mlat && mesh.userData.mlat.length > 0;
        const isMilitary = mesh.userData.isMilitary || false;

        // Build prefix: military takes precedence over MLAT
        let prefix = '';
        if (isMilitary) {
            prefix = 'MIL ';
        } else if (isMLAT) {
            prefix = 'MLAT ';
        }

        // Add vertical rate indicator (ascending/descending)
        // Use baro_rate if available, otherwise fall back to geom_rate
        let verticalIndicator = '';
        const verticalRate = mesh.userData.baro_rate ?? mesh.userData.geom_rate;
        if (verticalRate) {
            if (verticalRate > 64) {
                verticalIndicator = ' ▲'; // Ascending (>64 ft/min threshold to filter out noise)
            } else if (verticalRate < -64) {
                verticalIndicator = ' ▼'; // Descending
            }
            // If between -64 and 64, level flight, no indicator
        }

        const labelText = altitude ? `${prefix}${callsign}${verticalIndicator}\n${altitude}` : `${prefix}${callsign}${verticalIndicator}`;

        // Only update label if text actually changed (cache optimization)
        if (!label.userData.cachedText || label.userData.cachedText !== labelText) {
            label.userData.cachedText = labelText;
            updateLabelText(label, labelText);
        }
    }

    // Update color based on altitude (mesh is a Group, update all children)
    const color = getAltitudeColor(y);
    mesh.traverse((child) => {
        if (child.isMesh && child.material) {
            // Check if this is a shader material (sprite with white outline) or standard material
            if (child.material.type === 'ShaderMaterial' && child.material.uniforms && child.material.uniforms.tintColor) {
                // For shader material sprites, update tintColor uniform
                child.material.uniforms.tintColor.value.setHex(color);
            } else if (child.material.color) {
                // For standard materials (spheres), update color directly
                child.material.color.setHex(color);
                // Only set emissive if the material supports it (sphere mode)
                if (child.material.emissive) {
                    child.material.emissive.setHex(color);
                }
            }
        }
    });

    // Update rotation based on track (heading)
    // Skip rotation for shapes that shouldn't rotate (balloons, ground vehicles, etc.)
    if (mesh.userData.noRotate !== true && mesh.userData.track !== undefined) {
        const trackRad = mesh.userData.track * Math.PI / 180;

        // DEBUG: Log rotation calculation for first few frames
        if (Math.random() < 0.01) {
            console.log(`[Rotation Debug] hex=${hex}, track=${mesh.userData.track}°, isSprite=${mesh.userData.isSprite}, rotation.y=${trackRad * 180 / Math.PI}`);
        }

        // Geometry has rotateX baked in, only need Y rotation
        // Testing: negative trackRad
        mesh.rotation.y = -trackRad;
    } else if (mesh.userData.noRotate !== true) {
        // Default orientation if no track data
        mesh.rotation.y = 0;
    }
    // If noRotate is true, leave rotation unchanged (0,0,0)

    // Reapply highlight if this aircraft is currently hovered on canvas
    if (currentlyHoveredCanvasAircraft === hex) {
        highlightAircraft(hex, true);
    }
}

function updateTrail(hex, x, y, z, altFeet, groundSpeed) {
    const trail = trails.get(hex);
    if (!trail) return;

    trail.positions.push({ x, y, z, altFeet, groundSpeed, timestamp: Date.now() });

    // Check if we need to grow the buffer
    if (trail.positions.length > trail.capacity) {
        // Double the capacity
        trail.capacity *= 2;
        const newPositions = new Float32Array(trail.capacity * 3);
        const newColors = new Float32Array(trail.capacity * 3);

        // Copy existing positions and colors
        const oldPositions = trail.line.geometry.attributes.position.array;
        const oldColors = trail.line.geometry.attributes.color.array;
        newPositions.set(oldPositions);
        newColors.set(oldColors);

        // Create new buffer attributes
        trail.line.geometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
        trail.line.geometry.setAttribute('color', new THREE.BufferAttribute(newColors, 3));
    }

    // Update trail geometry positions and colors
    const positions = trail.line.geometry.attributes.position.array;
    const colors = trail.line.geometry.attributes.color.array;

    trail.positions.forEach((pos, i) => {
        positions[i * 3] = pos.x;
        positions[i * 3 + 1] = pos.y;
        positions[i * 3 + 2] = pos.z;

        // Get color based on current mode (altitude or speed)
        let colorValue;
        if (trailColorMode === 'speed') {
            colorValue = getSpeedColor(pos.groundSpeed);
        } else {
            colorValue = getAltitudeColor(pos.y);
        }
        const trailColor = new THREE.Color(colorValue);
        colors[i * 3] = trailColor.r;
        colors[i * 3 + 1] = trailColor.g;
        colors[i * 3 + 2] = trailColor.b;
    });

    trail.line.geometry.attributes.position.needsUpdate = true;
    trail.line.geometry.attributes.color.needsUpdate = true;
    trail.line.geometry.setDrawRange(0, trail.positions.length);

    // Store a copy of the current colors for hover restore
    trail.originalColors = new Float32Array(colors);

    // Update Tron curtain if enabled
    if (showTronMode) {
        updateTronCurtain(trail);
    }
}

// Create or update vertical altitude curtains (Tron mode)
function updateTronCurtain(trail) {
    if (!trail || trail.positions.length < 2) return;

    // Remove old curtain if it exists
    if (trail.tronCurtain) {
        // console.log('[TronMode] Removing old curtain before creating new one, scene has', scene.children.length, 'children');
        const removed = scene.remove(trail.tronCurtain);
        // console.log('[TronMode] Remove result:', removed ? 'success' : 'FAILED', 'scene now has', scene.children.length, 'children');
        if (trail.tronCurtain.geometry) trail.tronCurtain.geometry.dispose();
        if (trail.tronCurtain.material) trail.tronCurtain.material.dispose();
        trail.tronCurtain = null;
    }

    // Build vertical ribbons connecting ground to altitude at each trail point
    const positions = [];
    const colors = [];
    const alphas = []; // Per-vertex alpha values
    const indices = [];

    for (let i = 0; i < trail.positions.length - 1; i++) {
        const p1 = trail.positions[i];
        const p2 = trail.positions[i + 1];

        // Detect gaps in data (large distance or time jumps)
        // Skip creating curtains for gap segments to avoid vertical artifacts
        const distance = Math.sqrt(
            Math.pow(p2.x - p1.x, 2) +
            Math.pow(p2.y - p1.y, 2) +
            Math.pow(p2.z - p1.z, 2)
        );
        const hasTimestamp = p1.timestamp && p2.timestamp;
        const timeDiff = hasTimestamp ? Math.abs(p2.timestamp - p1.timestamp) : 0;

        // Skip if gap detected (>10km distance OR >5min time gap)
        const MAX_DISTANCE = 10000; // 10km in scene units
        const MAX_TIME_GAP = 5 * 60 * 1000; // 5 minutes
        if (distance > MAX_DISTANCE || (hasTimestamp && timeDiff > MAX_TIME_GAP)) {
            continue; // Skip this segment, no curtain
        }

        // Get colors for gradient based on current mode (altitude or speed)
        let colorValue1, colorValue2;
        if (trailColorMode === 'speed') {
            colorValue1 = getSpeedColor(p1.groundSpeed);
            colorValue2 = getSpeedColor(p2.groundSpeed);
        } else {
            colorValue1 = getAltitudeColor(p1.y);
            colorValue2 = getAltitudeColor(p2.y);
        }
        const color1 = new THREE.Color(colorValue1);
        const color2 = new THREE.Color(colorValue2);
        const groundColor = new THREE.Color(0x333333); // Dark gray for ground

        // Calculate alpha values based on altitude
        // Ground: very transparent (0.05)
        // Top: more opaque (0.5)
        const maxAltitude = Math.max(p1.y, p2.y);
        const alpha1Top = Math.min(0.05 + (p1.y / 10000) * 0.45, 0.5);
        const alpha2Top = Math.min(0.05 + (p2.y / 10000) * 0.45, 0.5);
        const alphaGround = 0.05; // Very transparent at ground level

        // Create a quad between two consecutive points
        // Each quad has 4 vertices (bottom-left, bottom-right, top-right, top-left)
        const vertexOffset = positions.length / 3;

        // Bottom vertices (ground level)
        positions.push(p1.x, 0, p1.z); // Bottom-left
        colors.push(groundColor.r, groundColor.g, groundColor.b);
        alphas.push(alphaGround);

        positions.push(p2.x, 0, p2.z); // Bottom-right
        colors.push(groundColor.r, groundColor.g, groundColor.b);
        alphas.push(alphaGround);

        // Top vertices (aircraft altitude)
        positions.push(p2.x, p2.y, p2.z); // Top-right
        colors.push(color2.r, color2.g, color2.b);
        alphas.push(alpha2Top);

        positions.push(p1.x, p1.y, p1.z); // Top-left
        colors.push(color1.r, color1.g, color1.b);
        alphas.push(alpha1Top);

        // Create two triangles for the quad
        // Triangle 1: bottom-left, bottom-right, top-right
        indices.push(vertexOffset + 0, vertexOffset + 1, vertexOffset + 2);
        // Triangle 2: bottom-left, top-right, top-left
        indices.push(vertexOffset + 0, vertexOffset + 2, vertexOffset + 3);
    }

    // If no curtains to create (all segments were gaps), return early
    if (positions.length === 0) {
        return;
    }

    // Create geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('alpha', new THREE.Float32BufferAttribute(alphas, 1)); // Per-vertex alpha
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Create custom shader material that supports per-vertex alpha
    const material = new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        vertexShader: `
            attribute float alpha;
            varying vec3 vColor;
            varying float vAlpha;
            void main() {
                vColor = color;
                vAlpha = alpha;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            varying float vAlpha;
            void main() {
                gl_FragColor = vec4(vColor, vAlpha);
            }
        `,
        vertexColors: true
    });

    // Create mesh and add to scene
    const curtain = new THREE.Mesh(geometry, material);
    curtain.renderOrder = -1; // Render before trails
    curtain.name = 'tronCurtain'; // Mark as Tron curtain for easier cleanup
    curtain.userData.isTronCurtain = true; // Additional marker
    scene.add(curtain);

    // Store reference in trail object
    trail.tronCurtain = curtain;
    // console.log(`[TronMode] Created curtain with ${positions.length / 3} vertices`);
}

/**
 * Remove an aircraft from the 3D scene and clean up resources
 * Called when aircraft disappears from ADS-B feed
 * @param {string} hex - ICAO hex code of aircraft to remove
 * @returns {void}
 */
function removeAircraft(hex) {
    const mesh = aircraftMeshes.get(hex);
    if (mesh) {
        scene.remove(mesh);
        // Dispose all geometries and materials in the group
        mesh.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            }
        });
        aircraftMeshes.delete(hex);
    }

    const label = aircraftLabels.get(hex);
    if (label) {
        scene.remove(label);
        if (label.material) {
            if (label.material.map) label.material.map.dispose();
            label.material.dispose();
        }
        aircraftLabels.delete(hex);
    }

    const militaryIcon = militaryIndicators.get(hex);
    if (militaryIcon) {
        scene.remove(militaryIcon);
        if (militaryIcon.material) {
            if (militaryIcon.material.map) militaryIcon.material.map.dispose();
            militaryIcon.material.dispose();
        }
        militaryIndicators.delete(hex);
    }

    const altLine = altitudeLines.get(hex);
    if (altLine) {
        scene.remove(altLine);
        altLine.geometry.dispose();
        altLine.material.dispose();
        altitudeLines.delete(hex);
    }

    const trail = trails.get(hex);
    if (trail) {
        // Move trail to staleTrails instead of deleting it
        // Keep it visible to show where the aircraft was
        trail.stale = true;
        trail.lastUpdate = Date.now();
        staleTrails.set(hex, trail);
        trails.delete(hex);
        // Trail stays in the scene - don't remove or dispose!
    }
}

// HSL to RGB conversion for tar1090 colors
function hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const r = Math.round(255 * f(0));
    const g = Math.round(255 * f(8));
    const b = Math.round(255 * f(4));
    return (r << 16) | (g << 8) | b;
}

/**
 * Get altitude-based color for aircraft and trails (tar1090 color scheme)
 * Converts scene units to feet and returns RGB color value
 * @param {number} altitudeSceneUnits - Altitude in Three.js scene units
 * @returns {number} RGB color value as hex number (e.g., 0xff0000 for red)
 */
function getAltitudeColor(altitudeSceneUnits) {
    // Convert scene units back to actual feet for color determination
    // Reverse: scene units / exaggeration / scale / 0.3048 + home alt
    const altitudeFeet = (altitudeSceneUnits / CONFIG.altitudeExaggeration / CONFIG.scale / 0.3048) + CONFIG.homeLocation.alt;

    // tar1090 exact color scheme using HSL interpolation
    // Ground/Unknown
    if (altitudeFeet < 500) {
        return hslToRgb(0, 0, 45); // Ground - gray
    }

    // tar1090 altitude color scale (from config.js)
    // Key waypoints: 2000ft (H=20), 10000ft (H=140), 40000ft (H=300)
    // Adjusted S=100%, L=65% (maximum saturation, rich vibrant colors on dark map)
    const saturation = 100;
    const lightness = 65;
    let hue;

    if (altitudeFeet <= 2000) {
        hue = 20; // Orange
    } else if (altitudeFeet <= 10000) {
        // Interpolate from 20 (orange) to 140 (light green)
        const ratio = (altitudeFeet - 2000) / (10000 - 2000);
        hue = 20 + ratio * (140 - 20);
    } else if (altitudeFeet <= 40000) {
        // Interpolate from 140 (light green) to 300 (magenta)
        const ratio = (altitudeFeet - 10000) / (40000 - 10000);
        hue = 140 + ratio * (300 - 140);
    } else {
        hue = 300; // Magenta for >40000ft
    }

    return hslToRgb(hue, saturation, lightness);
}

/**
 * Get speed-based color for trails (green to red gradient)
 * @param {number} groundSpeed - Ground speed in knots
 * @returns {number} RGB color value as hex number (e.g., 0x00ff00 for green)
 */
function getSpeedColor(groundSpeed) {
    // Speed-based color scheme: Green → Yellow-green → Yellow-orange → Orange-red
    // 0-100 kts: Green (H=120)
    // 100-250 kts: Yellow-green (H=90)
    // 250-400 kts: Yellow-orange (H=45)
    // 400-600+ kts: Orange-red (H=15)

    const saturation = 100;
    const lightness = 65;
    let hue;

    // Handle unknown/zero speed
    if (!groundSpeed || groundSpeed < 1) {
        return hslToRgb(0, 0, 45); // Gray for unknown speed
    }

    if (groundSpeed <= 100) {
        hue = 120; // Green
    } else if (groundSpeed <= 250) {
        // Interpolate from 120 (green) to 90 (yellow-green)
        const ratio = (groundSpeed - 100) / (250 - 100);
        hue = 120 - ratio * (120 - 90);
    } else if (groundSpeed <= 400) {
        // Interpolate from 90 (yellow-green) to 45 (yellow-orange)
        const ratio = (groundSpeed - 250) / (400 - 250);
        hue = 90 - ratio * (90 - 45);
    } else if (groundSpeed <= 600) {
        // Interpolate from 45 (yellow-orange) to 15 (orange-red)
        const ratio = (groundSpeed - 400) / (600 - 400);
        hue = 45 - ratio * (45 - 15);
    } else {
        hue = 15; // Orange-red for >600 kts
    }

    return hslToRgb(hue, saturation, lightness);
}

function updateUI(data) {
    const totalAircraft = data.aircraft?.length || 0;

    // Update both main count and header count
    document.getElementById('aircraft-count').textContent = totalAircraft;
    document.getElementById('aircraft-count-header').textContent = `(${totalAircraft})`;

    const now = new Date();
    document.getElementById('last-update').textContent = now.toLocaleTimeString();

    // Update aircraft list
    const listContainer = document.getElementById('aircraft-items');
    listContainer.innerHTML = '';

    // Find highest/fastest/closest BEFORE rendering list
    const validAircraft = (data.aircraft || []).filter(ac => ac.lat && ac.lon && ac.alt_baro);

    // Update aircraft with positions count
    document.getElementById('aircraft-with-positions').textContent = validAircraft.length;

    // Edge case: No aircraft detected
    if (validAircraft.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.style.cssText = `
            padding: 20px;
            text-align: center;
            color: var(--text-secondary);
            font-size: 13px;
            line-height: 1.6;
        `;
        emptyMessage.innerHTML = `
            <div style="font-size: 32px; margin-bottom: 10px; opacity: 0.5;">✈️</div>
            <div style="font-weight: bold; margin-bottom: 5px;">No Aircraft Detected</div>
            <div style="font-size: 12px; opacity: 0.7;">
                Waiting for aircraft to appear in range...<br>
                <span style="font-size: 11px;">Check your ADS-B receiver is running</span>
            </div>
        `;
        listContainer.appendChild(emptyMessage);
        return; // Exit early, no aircraft to render
    }

    // Edge case: Very high aircraft count (500+)
    // Add performance warning to help users understand potential lag
    if (validAircraft.length >= 500) {
        const perfWarning = document.createElement('div');
        perfWarning.style.cssText = `
            padding: 8px 12px;
            margin-bottom: 10px;
            background: rgba(255, 165, 0, 0.15);
            border-left: 3px solid #ff9500;
            border-radius: 4px;
            font-size: 12px;
            line-height: 1.5;
            color: var(--text-primary);
        `;
        perfWarning.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 3px;">⚡ High Traffic Detected</div>
            <div style="font-size: 11px; opacity: 0.9;">
                ${validAircraft.length} aircraft in range. Performance may be affected.
                <br><span style="font-size: 10px; opacity: 0.7;">Tip: Reduce update frequency if experiencing lag</span>
            </div>
        `;
        listContainer.appendChild(perfWarning);
    }
    let highestHex = null, fastestHex = null, closestHex = null;

    if (validAircraft.length > 0) {
        // Find highest
        const highest = validAircraft.reduce((max, ac) => (ac.alt_baro > max.alt_baro) ? ac : max);
        highestHex = highest.hex;

        // Find fastest
        const withSpeed = validAircraft.filter(ac => ac.gs);
        if (withSpeed.length > 0) {
            const fastest = withSpeed.reduce((max, ac) => (ac.gs > max.gs) ? ac : max);
            fastestHex = fastest.hex;
        }

        // Find closest
        const withDistance = validAircraft.filter(ac => ac.r_dst);
        if (withDistance.length > 0) {
            const closest = withDistance.reduce((min, ac) => (ac.r_dst < min.r_dst) ? ac : min);
            closestHex = closest.hex;
        }
    }

    (data.aircraft || [])
        .filter(ac => ac.lat && ac.lon)
        .sort((a, b) => (a.r_dst || 999) - (b.r_dst || 999))
        .slice(0, 20)
        .forEach(ac => {
            const item = document.createElement('div');
            item.className = 'aircraft-item';

            // Sanitize external data to prevent XSS
            const callsign = sanitizeHTML(ac.flight?.trim() || ac.hex);
            const type = sanitizeHTML(ac.t || 'Unknown');
            const alt = ac.alt_baro ? `${ac.alt_baro.toLocaleString()}ft` : 'N/A';
            const dist = ac.r_dst ? `${ac.r_dst.toFixed(1)}nmi` : 'N/A'; // r_dst is already in nautical miles
            const speed = ac.gs ? `${ac.gs.toFixed(0)}kts` : 'N/A';

            // Add vertical rate indicator (ascending/descending)
            let verticalIndicator = '';
            const verticalRate = ac.baro_rate ?? ac.geom_rate;
            if (verticalRate) {
                if (verticalRate > 64) {
                    verticalIndicator = ' ▲'; // Ascending (>64 ft/min threshold to filter out noise)
                } else if (verticalRate < -64) {
                    verticalIndicator = ' ▼'; // Descending
                }
            }

            // Check military status first (takes precedence)
            const isMilitary = isMilitaryAircraft(ac.hex);
            const isMLAT = ac.mlat && ac.mlat.length > 0;

            // Build badges
            let badges = '';

            // Military badge (red) - highest priority
            if (isMilitary) {
                badges += '<span class="badge badge-military">🛡️ MIL</span>';
            }

            // MLAT badge (orange) - if not military
            if (!isMilitary && isMLAT) {
                badges += '<span class="badge badge-mlat">MLAT</span>';
            }

            // Stats badges (blue)
            if (ac.hex === highestHex) {
                badges += '<span class="badge badge-stat">HIGHEST</span>';
            }
            if (ac.hex === fastestHex) {
                badges += '<span class="badge badge-stat">FASTEST</span>';
            }
            if (ac.hex === closestHex) {
                badges += '<span class="badge badge-stat">CLOSEST</span>';
            }

            item.innerHTML = `
                <div class="aircraft-callsign">${callsign}${verticalIndicator} ${badges}</div>
                <div class="aircraft-details">
                    ${type} • ${alt} • ${speed} • ${dist}
                </div>
            `;

            // Store hex for cross-referencing
            item.dataset.hex = ac.hex;

            // Mark as selected if this is the selected aircraft
            if (ac.hex === selectedAircraft) {
                item.classList.add('selected');
            }

            item.addEventListener('click', () => {
                selectAircraft(ac.hex);
            });

            // Hover effect - highlight aircraft in 3D scene
            item.addEventListener('mouseenter', () => {
                currentlyHoveredListItem = ac.hex;
                highlightAircraft(ac.hex, true);
            });

            item.addEventListener('mouseleave', () => {
                currentlyHoveredListItem = null;
                highlightAircraft(ac.hex, false);
            });

            listContainer.appendChild(item);
        });

    // Reapply highlight if user was hovering over an aircraft when list rebuilt
    if (currentlyHoveredListItem) {
        // Check if the hovered aircraft still exists in the new list
        const hoveredStillExists = (data.aircraft || []).some(ac => ac.hex === currentlyHoveredListItem);
        if (hoveredStillExists) {
            // Reapply highlight immediately to prevent flash
            highlightAircraft(currentlyHoveredListItem, true);
        } else {
            // Aircraft disappeared, clear hover state
            currentlyHoveredListItem = null;
        }
    }

    // Update mini statistics
    updateMiniStatistics(data.aircraft || []);
}

// Reusable smooth camera animation function
// Uses ease-in-out cubic for smooth acceleration and deceleration
function animateCameraToPosition(targetPosition, targetLookAt, duration = 1500, onComplete = null) {
    const startPos = camera.position.clone();
    const startLookAt = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(camera.quaternion)
        .add(camera.position);
    const startTime = Date.now();

    function easeInOutCubic(t) {
        return t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease-in-out cubic for smooth start and end
        const easeProgress = easeInOutCubic(progress);

        // Smoothly interpolate both position and look-at target
        const currentPos = new THREE.Vector3().lerpVectors(startPos, targetPosition, easeProgress);
        const currentLookAt = new THREE.Vector3().lerpVectors(startLookAt, targetLookAt, easeProgress);

        camera.position.copy(currentPos);
        camera.lookAt(currentLookAt);

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // Animation complete - ensure final position is exact
            camera.position.copy(targetPosition);
            camera.lookAt(targetLookAt);
            if (onComplete) {
                onComplete();
            }
        }
    }

    animate();
}

/**
 * Select an aircraft and show its detail panel
 * Highlights the aircraft and displays information without moving camera
 * @param {string} hex - ICAO hex code of aircraft to select
 * @returns {void}
 */
function selectAircraft(hex) {
    const mesh = aircraftMeshes.get(hex);
    if (!mesh) return;

    // Show aircraft details (this will update the URL)
    showAircraftDetail(hex);

    // Highlight the aircraft visually
    highlightAircraft(hex, true);
}

function focusOnAircraft(hex) {
    const mesh = aircraftMeshes.get(hex);
    if (!mesh) return;

    // Show aircraft details
    showAircraftDetail(hex);

    // Smooth camera transition to aircraft
    const targetPos = mesh.position;
    const distance = 30; // Distance from aircraft
    const height = 15; // Height above aircraft

    // Calculate new camera position
    const newCameraPos = targetPos.clone().add(new THREE.Vector3(distance, height, distance));

    // Use reusable camera animation function
    animateCameraToPosition(newCameraPos, targetPos, 1000, () => {
        // Animation complete - enable follow mode in free orbit
        followMode = true;
        followedAircraftHex = hex;
        followLocked = false; // Free orbit mode, not locked
        cameraReturnInProgress = false;

        // Sync camera angles from current position for smooth free orbit
        syncCameraAnglesFromPosition();

        // Update follow button to show it's active in free orbit mode
        updateFollowButtonText();

        // Keep the detail panel visible (unlike locked follow mode)
        document.getElementById('aircraft-detail').style.display = 'block';

        // Show unfollow button
        showUnfollowButton();
    });
}

/**
 * Highlight or unhighlight an aircraft in the 3D scene
 * Scales aircraft, changes colors, and updates trail/label visibility
 * @param {string} hex - ICAO hex code of aircraft to highlight
 * @param {boolean} highlight - True to highlight, false to unhighlight
 * @returns {void}
 */
function highlightAircraft(hex, highlight) {
    const mesh = aircraftMeshes.get(hex);
    const trail = trails.get(hex);
    const label = aircraftLabels.get(hex);

    console.log(`[Highlight] Aircraft ${hex}, highlight=${highlight}, mesh=${!!mesh}, trail=${!!trail}, label=${!!label}`);

    if (mesh) {
        // Scale up aircraft when highlighted
        mesh.scale.setScalar(highlight ? 1.5 : 1);

        // Store/restore original colors and change aircraft color
        mesh.children.forEach(child => {
            if (child.material) {
                // Check if this is a shader material (sprites) or standard material (spheres)
                const isShaderMaterial = child.material.type === 'ShaderMaterial';

                if (highlight) {
                    if (isShaderMaterial) {
                        // For sprites with shader material, modify tintColor uniform
                        if (child.material.uniforms && child.material.uniforms.tintColor) {
                            if (!child.userData.originalTintColor) {
                                child.userData.originalTintColor = child.material.uniforms.tintColor.value.clone();
                            }
                            child.material.uniforms.tintColor.value.setHex(0xffffff);
                        }
                    } else {
                        // For spheres with standard material
                        if (!child.userData.originalColor) {
                            child.userData.originalColor = child.material.color.clone();
                            // Only store emissive if it exists
                            if (child.material.emissive) {
                                child.userData.originalEmissive = child.material.emissive.clone();
                            }
                        }
                        // Change to white
                        child.material.color.setHex(0xffffff);
                        // Only modify emissive properties if they exist (sphere mode)
                        if (child.material.emissive) {
                            child.material.emissive.setHex(0xffffff);
                            child.material.emissiveIntensity = 1.0;
                        }
                    }
                } else {
                    if (isShaderMaterial) {
                        // Restore sprite tint color
                        if (child.material.uniforms && child.material.uniforms.tintColor && child.userData.originalTintColor) {
                            child.material.uniforms.tintColor.value.copy(child.userData.originalTintColor);
                        }
                    } else {
                        // Restore sphere colors
                        if (child.userData.originalColor) {
                            child.material.color.copy(child.userData.originalColor);
                            // Only restore emissive if it exists
                            if (child.material.emissive && child.userData.originalEmissive) {
                                child.material.emissive.copy(child.userData.originalEmissive);
                                child.material.emissiveIntensity = 0.3;
                            }
                        }
                    }
                }
            }
        });
    }

    if (label) {
        // Make label more visible when highlighted
        label.scale.setScalar(highlight ? 1.4 : 1);

        const sprite = label.userData.sprite;
        if (sprite && sprite.material) {
            // Increase label opacity
            sprite.material.opacity = highlight ? 1.0 : 0.9;

            // Add a bright background glow when highlighted
            if (highlight && !label.userData.highlighted) {
                // Store original state
                label.userData.highlighted = true;
                // Redraw canvas with highlighted style
                updateLabelAppearance(hex, true);
            } else if (!highlight && label.userData.highlighted) {
                // Restore original appearance
                label.userData.highlighted = false;
                updateLabelAppearance(hex, false);
            }
        }
    }

    if (trail && trail.line) {
        // Make trail more visible when highlighted
        trail.line.material.opacity = highlight ? 1.0 : 0.6;
        trail.line.material.linewidth = highlight ? 2 : 1;

        // Change trail colors
        if (trail.line.geometry.attributes.color) {
            const colorArray = trail.line.geometry.attributes.color.array;
            const drawRange = trail.line.geometry.drawRange.count;

            if (highlight) {
                // Set all visible trail points to white
                for (let i = 0; i < drawRange * 3; i++) {
                    colorArray[i] = 1.0;  // White
                }
            } else {
                // Restore original colors
                if (trail.originalColors) {
                    // Only restore the visible portion
                    for (let i = 0; i < drawRange * 3; i++) {
                        colorArray[i] = trail.originalColors[i];
                    }
                }
            }

            trail.line.geometry.attributes.color.needsUpdate = true;
        }
    }

    // Highlight/unhighlight in aircraft list
    const listItems = document.querySelectorAll(`.aircraft-item[data-hex="${hex}"]`);
    listItems.forEach(item => {
        if (highlight) {
            item.style.backgroundColor = 'rgba(74, 158, 255, 0.3)';
            item.style.transform = 'scale(1.02)';
        } else {
            item.style.backgroundColor = '';
            item.style.transform = '';
        }
    });

    // Highlight/unhighlight in quick stats
    const statElements = document.querySelectorAll(`[data-hex="${hex}"]`);
    statElements.forEach(el => {
        if (highlight) {
            el.style.fontWeight = 'bold';
            el.style.color = '#4a9eff';
        } else {
            el.style.fontWeight = '';
            el.style.color = '';
        }
    });
}

// Update label appearance for highlighting
function updateLabelAppearance(hex, highlighted) {
    const labelGroup = aircraftLabels.get(hex);
    if (!labelGroup) return;

    const sprite = labelGroup.userData.sprite;
    if (!sprite || !sprite.material.map) return;

    // Get the current text
    const text = labelGroup.userData.text || hex;

    const canvas = sprite.material.map.image;
    const ctx = canvas.getContext('2d');

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background with glow effect when highlighted
    if (highlighted) {
        ctx.fillStyle = 'rgba(74, 158, 255, 0.9)';
        ctx.shadowColor = 'rgba(74, 158, 255, 1)';
        ctx.shadowBlur = 20;
    } else {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.shadowBlur = 0;
    }

    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.shadowBlur = 0;

    // Add white border around the label box
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'; // White border
    ctx.lineWidth = 6; // Thicker border for visibility from distance
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    // Draw text (no outline - better readability)
    ctx.font = 'Bold 28px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Handle multi-line text
    const lines = text.split('\n');
    const lineHeight = 32;
    const totalHeight = lines.length * lineHeight;
    const startY = (canvas.height - totalHeight) / 2 + lineHeight / 2;

    lines.forEach((line, index) => {
        const yPos = startY + index * lineHeight;
        ctx.fillText(line, canvas.width / 2, yPos);
    });

    sprite.material.map.needsUpdate = true;
}

// Update mini statistics panel
function updateMiniStatistics(aircraftList) {
    const validAircraft = aircraftList.filter(ac => ac.lat && ac.lon && ac.alt_baro);

    if (validAircraft.length === 0) {
        document.getElementById('stat-highest').textContent = '--';
        document.getElementById('stat-fastest').textContent = '--';
        document.getElementById('stat-closest').textContent = '--';
        return;
    }

    // Find highest aircraft
    const highest = validAircraft.reduce((max, ac) =>
        (ac.alt_baro > max.alt_baro) ? ac : max
    );
    const highestCallsign = highest.flight?.trim() || highest.hex.slice(-4).toUpperCase();
    const highestEl = document.getElementById('stat-highest');
    highestEl.textContent = `${highestCallsign} @ ${highest.alt_baro.toLocaleString()}ft`;
    highestEl.dataset.hex = highest.hex;
    highestEl.style.cursor = 'pointer';
    highestEl.onclick = () => focusOnAircraft(highest.hex);
    highestEl.onmouseenter = () => highlightAircraft(highest.hex, true);
    highestEl.onmouseleave = () => highlightAircraft(highest.hex, false);

    // Find fastest aircraft
    const withSpeed = validAircraft.filter(ac => ac.gs);
    if (withSpeed.length > 0) {
        const fastest = withSpeed.reduce((max, ac) =>
            (ac.gs > max.gs) ? ac : max
        );
        const fastestCallsign = fastest.flight?.trim() || fastest.hex.slice(-4).toUpperCase();
        const fastestEl = document.getElementById('stat-fastest');
        fastestEl.textContent = `${fastestCallsign} @ ${fastest.gs.toFixed(0)}kts`;
        fastestEl.dataset.hex = fastest.hex;
        fastestEl.style.cursor = 'pointer';
        fastestEl.onclick = () => focusOnAircraft(fastest.hex);
        fastestEl.onmouseenter = () => highlightAircraft(fastest.hex, true);
        fastestEl.onmouseleave = () => highlightAircraft(fastest.hex, false);
    } else {
        const fastestEl = document.getElementById('stat-fastest');
        fastestEl.textContent = '--';
        fastestEl.dataset.hex = '';
        fastestEl.style.cursor = '';
        fastestEl.onclick = null;
        fastestEl.onmouseenter = null;
        fastestEl.onmouseleave = null;
    }

    // Find closest aircraft
    const withDistance = validAircraft.filter(ac => ac.r_dst);
    if (withDistance.length > 0) {
        const closest = withDistance.reduce((min, ac) =>
            (ac.r_dst < min.r_dst) ? ac : min
        );
        const closestCallsign = closest.flight?.trim() || closest.hex.slice(-4).toUpperCase();
        const closestEl = document.getElementById('stat-closest');
        closestEl.textContent = `${closestCallsign} @ ${closest.r_dst.toFixed(1)}nmi`; // r_dst is already in nautical miles
        closestEl.dataset.hex = closest.hex;
        closestEl.style.cursor = 'pointer';
        closestEl.onclick = () => focusOnAircraft(closest.hex);
        closestEl.onmouseenter = () => highlightAircraft(closest.hex, true);
        closestEl.onmouseleave = () => highlightAircraft(closest.hex, false);
    } else {
        const closestEl = document.getElementById('stat-closest');
        closestEl.textContent = '--';
        closestEl.dataset.hex = '';
        closestEl.style.cursor = '';
        closestEl.onclick = null;
        closestEl.onmouseenter = null;
        closestEl.onmouseleave = null;
    }
}

// Last sky update time
let lastSkyUpdate = 0;
let lastStaleTrailCleanup = 0;

// Mini Radar Rendering
function updateMiniRadar(cameraYawDegrees) {
    if (!showMiniRadar) return; // Don't render if disabled

    const canvas = document.getElementById('radar-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRange = 150; // nautical miles (150nm scale)

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Save context for rotation
    ctx.save();

    // Rotate canvas based on camera yaw (negative for counter-rotation like compass)
    ctx.translate(centerX, centerY);
    ctx.rotate((-cameraYawDegrees * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);

    // Draw range rings (50nm, 100nm, 150nm)
    const ringColor = CONFIG.distanceRing1Color || 0x4a9eff;
    const rgbColor = `rgba(${(ringColor >> 16) & 255}, ${(ringColor >> 8) & 255}, ${ringColor & 255}, 0.3)`;

    ctx.strokeStyle = rgbColor;
    ctx.lineWidth = 1;

    [50, 100, 150].forEach(range => {
        const radius = (range / maxRange) * (width / 2 - 10);
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();
    });

    // Draw crosshairs for home position
    ctx.strokeStyle = rgbColor;
    ctx.lineWidth = 2;
    const crossSize = 6;
    ctx.beginPath();
    ctx.moveTo(centerX - crossSize, centerY);
    ctx.lineTo(centerX + crossSize, centerY);
    ctx.moveTo(centerX, centerY - crossSize);
    ctx.lineTo(centerX, centerY + crossSize);
    ctx.stroke();

    // Draw north indicator (fixed at top after rotation)
    ctx.fillStyle = CONFIG.compassNorth || '#ff4444';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', centerX, 15);

    // Draw aircraft dots (always use live data, even in historical mode)
    const homeLatLon = CONFIG.homeLocation;

    liveRadarData.forEach((ac) => {
        if (!ac || !ac.lat || !ac.lon || typeof ac.alt_baro !== 'number') return;

        const lat = ac.lat;
        const lon = ac.lon;
        const altFeet = ac.alt_baro; // Altitude in feet
        const isMilitary = isMilitaryAircraft(ac.hex); // Check if military using hex code

        // Calculate distance and bearing from home
        const latDiff = (lat - homeLatLon.lat) * 60; // Convert to nautical miles (1 deg lat ≈ 60nm)
        const lonDiff = (lon - homeLatLon.lon) * 60 * Math.cos((homeLatLon.lat * Math.PI) / 180);

        const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);

        // Skip if out of range
        if (distance > maxRange) return;

        // Calculate position on radar (North = -Y, East = +X)
        const scale = (width / 2 - 10) / maxRange;
        const x = centerX + lonDiff * scale;
        const y = centerY - latDiff * scale; // Invert Y (North is up)

        // Use same color logic as aircraft meshes
        let colorValue;
        if (CONFIG.highlightMilitary && isMilitary) {
            colorValue = CONFIG.militaryColor;
        } else {
            // Use altitude in feet directly - same as tar1090 color scheme
            const saturation = 88;
            const lightness = 44;
            let hue;

            if (altFeet < 500) {
                colorValue = 0x737373; // Gray for ground/unknown
            } else if (altFeet <= 2000) {
                hue = 20; // Orange
                colorValue = hslToRgb(hue, saturation, lightness);
            } else if (altFeet <= 10000) {
                // Interpolate from 20 (orange) to 140 (light green)
                const ratio = (altFeet - 2000) / (10000 - 2000);
                hue = 20 + ratio * (140 - 20);
                colorValue = hslToRgb(hue, saturation, lightness);
            } else if (altFeet <= 40000) {
                // Interpolate from 140 (light green) to 300 (magenta)
                const ratio = (altFeet - 10000) / (40000 - 10000);
                hue = 140 + ratio * (300 - 140);
                colorValue = hslToRgb(hue, saturation, lightness);
            } else {
                hue = 300; // Magenta for >40000ft
                colorValue = hslToRgb(hue, saturation, lightness);
            }
        }

        // Convert hex color to CSS
        const color = new THREE.Color(colorValue);
        const dotColor = `rgb(${Math.floor(color.r * 255)}, ${Math.floor(color.g * 255)}, ${Math.floor(color.b * 255)})`;

        // Always draw aircraft sprites on mini radar if texture is loaded
        if (spriteTexture && spriteTexture.image && spriteTexture.image.complete) {
            // Get aircraft heading
            const heading = ac.track || 0;

            // Get sprite position (for now, use default twin jet for all)
            const spritePos = getSpritePosition('jet_twin');
            const spriteWidth = SPRITE_CONFIG.spriteWidth;
            const spriteHeight = SPRITE_CONFIG.spriteHeight;

            // Calculate source position in sprite sheet
            const sourceX = spritePos.col * spriteWidth;
            const sourceY = spritePos.row * spriteHeight;

            // Save context state for rotation
            ctx.save();

            // Move to aircraft position and rotate
            ctx.translate(x, y);
            ctx.rotate((-heading * Math.PI) / 180); // Negative for correct heading

            // Draw colored background circle first
            ctx.fillStyle = dotColor;
            ctx.beginPath();
            ctx.arc(0, 0, 6, 0, Math.PI * 2);
            ctx.fill();

            // Draw the sprite on top (slightly larger, no tint)
            const drawSize = 10; // Size on radar (10px square)
            ctx.drawImage(
                spriteTexture.image,
                sourceX, sourceY, spriteWidth, spriteHeight, // source
                -drawSize/2, -drawSize/2, drawSize, drawSize  // destination (centered)
            );

            // Restore context
            ctx.restore();
        } else {
            // Fallback to dots if sprites not available
            ctx.fillStyle = dotColor;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();

            // Add smaller glow for visibility (3px radius instead of 5px)
            ctx.strokeStyle = dotColor;
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    });

    // Restore context
    ctx.restore();
}

// Frame rate limiting variables
let lastFrameTime = 0;
const targetFPS = 30;  // Limit to 30fps instead of 60fps
const frameInterval = 1000 / targetFPS;

function animate() {
    requestAnimationFrame(animate);

    // Limit frame rate to reduce GPU usage
    const now = Date.now();
    const deltaTime = now - lastFrameTime;

    if (deltaTime < frameInterval) {
        return;  // Skip this frame
    }

    lastFrameTime = now - (deltaTime % frameInterval);

    // Update sky colors every 60 seconds
    if (now - lastSkyUpdate > 60000) {
        updateSkyColors();
        lastSkyUpdate = now;
    }

    // Clean up old stale trails to prevent memory leak
    // Remove trails from aircraft that disappeared more than 30 minutes ago
    if (now - lastStaleTrailCleanup > 60000) { // Check every minute
        const thirtyMinutes = 30 * 60 * 1000;
        staleTrails.forEach((trail, hex) => {
            if (now - trail.lastUpdate > thirtyMinutes) {
                // Remove from scene
                scene.remove(trail.line);
                if (trail.gapLine) scene.remove(trail.gapLine);
                if (trail.tronCurtain) scene.remove(trail.tronCurtain);

                // Dispose geometries and materials
                trail.line.geometry.dispose();
                trail.line.material.dispose();
                if (trail.gapLine) {
                    trail.gapLine.geometry.dispose();
                    trail.gapLine.material.dispose();
                }
                if (trail.tronCurtain) {
                    trail.tronCurtain.geometry.dispose();
                    trail.tronCurtain.material.dispose();
                }

                // Remove from map
                staleTrails.delete(hex);
            }
        });
        lastStaleTrailCleanup = now;
    }

    // Pulse the home beacon light
    if (window.homeBeacon) {
        const time = Date.now() * 0.002; // Slow pulse
        const intensity = 0.5 + Math.sin(time) * 0.5; // Oscillate between 0 and 1
        window.homeBeacon.material.emissiveIntensity = intensity;
    }

    // Update compass rose rotation based on camera orientation
    const compassRose = document.getElementById('compass-rose');
    if (compassRose) {
        // Calculate camera's yaw angle (horizontal rotation)
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);

        // Calculate angle from north (-Z axis)
        // atan2 gives us the angle in radians, we convert to degrees
        const yaw = Math.atan2(cameraDirection.x, -cameraDirection.z);
        let yawDegrees = yaw * 180 / Math.PI;

        // Normalize to 0-360 range for heading indicator
        let heading = yawDegrees;
        if (heading < 0) heading += 360;
        heading = Math.round(heading) % 360;

        // Update heading indicator (aviation format: 3 digits)
        const headingIndicator = document.getElementById('heading-indicator');
        if (headingIndicator) {
            headingIndicator.textContent = heading.toString().padStart(3, '0');
        }

        // Rotate compass rose opposite to camera direction
        compassRose.style.transform = `rotate(${-yawDegrees}deg)`;

        // Update mini radar with same rotation
        updateMiniRadar(yawDegrees);
    }

    // Handle follow mode camera
    if (followMode && followedAircraftHex) {
        const aircraft = aircraftMeshes.get(followedAircraftHex);

        if (aircraft) {
            const targetPos = aircraft.position.clone();

            if (followLocked) {
                // Locked mode - camera stays directly behind aircraft
                const track = aircraft.userData.track || 0;
                const trackRad = track * Math.PI / 180;

                // Calculate position directly behind aircraft
                const distanceBehind = 50;
                const heightAbove = 30;

                // Behind the aircraft is opposite to its heading
                // track=0 (North, -Z) means behind is +Z (South)
                // track=90 (East, +X) means behind is -X (West)
                const offsetX = -Math.sin(trackRad) * distanceBehind;
                const offsetZ = Math.cos(trackRad) * distanceBehind;
                const offset = new THREE.Vector3(offsetX, heightAbove, offsetZ);

                const cameraTarget = targetPos.clone().add(offset);

                // Use faster lerp for more responsive tracking (0.2 instead of 0.08)
                camera.position.lerp(cameraTarget, 0.2);

                // Look directly at the aircraft
                camera.lookAt(targetPos);
            } else {
                // Free orbit mode - maintain camera angles but follow aircraft position
                updateCameraPosition(targetPos);
            }

            cameraReturnInProgress = false;
        } else {
            // Aircraft disappeared - turn off follow mode and smoothly return camera
            followMode = false;
            followedAircraftHex = null;
            const followBtn = document.getElementById('toggle-follow');
            if (followBtn) {
                followBtn.style.display = 'none';
            }
            hideUnfollowButton();
            document.getElementById('aircraft-detail').style.display = 'none';
            selectedAircraft = null;

            // Clear URL parameter since aircraft is no longer visible
            const url = new URL(window.location);
            url.searchParams.delete('icao');
            window.history.replaceState({}, '', url);

            // Smooth camera animation to initial position
            const homePos = new THREE.Vector3(0, 50, 100);
            const homeLookAt = new THREE.Vector3(0, 0, 0);

            animateCameraToPosition(homePos, homeLookAt, 1000, () => {
                // Animation complete - update camera angles
                cameraAngleX = 0; // Facing north
                cameraAngleY = Math.PI / 6;
                cameraDistance = 100;
            });

            updateFollowButtonText();
        }
    }

    // Smooth camera return to home position
    if (cameraReturnInProgress) {
        const homePos = new THREE.Vector3(0, 50, 100);
        const homeLookAt = new THREE.Vector3(0, 0, 0);

        // Lerp camera position
        camera.position.lerp(homePos, 0.02); // Slower return

        // Smoothly adjust camera direction
        const currentLookAt = new THREE.Vector3();
        camera.getWorldDirection(currentLookAt);
        currentLookAt.multiplyScalar(100).add(camera.position);

        const targetDirection = homeLookAt.clone().sub(camera.position).normalize();
        const currentDirection = currentLookAt.clone().sub(camera.position).normalize();

        // Lerp the direction
        currentDirection.lerp(targetDirection, 0.02);
        const newLookAt = camera.position.clone().add(currentDirection.multiplyScalar(100));
        camera.lookAt(newLookAt);

        // Stop when close enough to home
        if (camera.position.distanceTo(homePos) < 1) {
            camera.position.copy(homePos);
            camera.lookAt(homeLookAt);
            cameraReturnInProgress = false;
        }
    }

    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Setup aircraft click interaction
function setupAircraftClick() {
    const canvas = document.getElementById('canvas');
    let hoveredAircraft = null;
    let hoveredEndpoint = null;  // Track hovered historical endpoint
    let hoverCheckScheduled = false;
    let lastMouseEvent = null;

    // Throttled raycasting check for hover effects (runs at ~15fps for CPU efficiency)
    // Reduced from 60fps to 15fps for 30-40% CPU reduction during mouse movement
    function checkHover() {
        if (!lastMouseEvent) {
            hoverCheckScheduled = false;
            return;
        }

        const event = lastMouseEvent;
        lastMouseEvent = null;

        // Calculate mouse position in normalized device coordinates
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Update raycaster
        raycaster.setFromCamera(mouse, camera);

        // Check for intersections with aircraft meshes and historical endpoints
        const aircraftArray = Array.from(aircraftMeshes.values());
        // Only include endpoints that are IN THE SCENE (have a parent)
        const endpointsArray = (HistoricalState.endpointMeshes || [])
            .filter(endpoint => endpoint.parent);
        const allHoverableObjects = [...aircraftArray, ...endpointsArray];
        const intersects = raycaster.intersectObjects(allHoverableObjects, true);

        // Reset previously hovered endpoint
        if (hoveredEndpoint) {
            const endpoint = hoveredEndpoint.endpoint;
            const trackLine = hoveredEndpoint.trackLine;

            // Restore endpoint color
            endpoint.material.color.copy(endpoint.userData.originalColor);

            // Restore track line colors
            if (trackLine && trackLine.geometry.attributes.color && trackLine.userData.originalColors) {
                trackLine.geometry.attributes.color.array.set(trackLine.userData.originalColors);
                trackLine.geometry.attributes.color.needsUpdate = true;
            }

            hoveredEndpoint = null;
        }

        // Reset previously hovered aircraft
        if (hoveredAircraft && hoveredAircraft !== selectedAircraft) {
            // Use highlightAircraft to consistently unhighlight (including list item)
            highlightAircraft(hoveredAircraft, false);
            hoveredAircraft = null;
            currentlyHoveredCanvasAircraft = null; // Clear canvas hover tracking
        }

        // Default cursor
        canvas.style.cursor = 'default';

        if (intersects.length > 0) {
            const intersectedObject = intersects[0].object;

            // Check if we're hovering over a historical endpoint
            if (intersectedObject.userData && intersectedObject.userData.isHistoricalEndpoint) {
                hoveredEndpoint = {
                    endpoint: intersectedObject,
                    trackLine: intersectedObject.userData.trackLine
                };

                // Change endpoint to white
                intersectedObject.material.color.setHex(0xffffff);

                // Change track line to white
                const trackLine = intersectedObject.userData.trackLine;
                if (trackLine && trackLine.geometry.attributes.color) {
                    const colorArray = trackLine.geometry.attributes.color.array;
                    for (let i = 0; i < colorArray.length; i++) {
                        colorArray[i] = 1.0;  // Set all RGB to white
                    }
                    trackLine.geometry.attributes.color.needsUpdate = true;
                }

                // Change cursor to pointer
                canvas.style.cursor = 'pointer';

                hoverCheckScheduled = false;
                return;  // Don't check for aircraft hover
            }
        }

        if (intersects.length > 0) {
            // Find the hex for the hovered aircraft
            let aircraftGroup = intersects[0].object;
            while (aircraftGroup && aircraftGroup.parent && aircraftGroup.parent.type !== 'Scene') {
                aircraftGroup = aircraftGroup.parent;
            }

            for (const [hex, mesh] of aircraftMeshes.entries()) {
                if (mesh === aircraftGroup && hex !== selectedAircraft) {
                    hoveredAircraft = hex;
                    currentlyHoveredCanvasAircraft = hex; // Track canvas hover
                    canvas.style.cursor = 'pointer';

                    // Use highlightAircraft to get consistent highlighting (including list item)
                    highlightAircraft(hex, true);

                    break;
                }
            }
        }

        hoverCheckScheduled = false;
    }

    // Mouse move for hover effects - throttled to 15fps (~66ms) for CPU efficiency
    canvas.addEventListener('mousemove', (event) => {
        lastMouseEvent = event;

        if (!hoverCheckScheduled) {
            hoverCheckScheduled = true;
            // Use setTimeout instead of requestAnimationFrame for controlled frequency
            // 66ms = ~15fps, reduces CPU usage by 30-40% vs 60fps raycasting
            setTimeout(checkHover, 66);
        }
    });

    canvas.addEventListener('click', (event) => {
        // Ignore clicks that happened after camera dragging
        if (wasDragging) {
            wasDragging = false;
            console.log('[Click] Ignoring click due to dragging');
            return;
        }

        console.log('[Click] Processing click, hoveredAircraft:', hoveredAircraft);

        // If we're hovering over an aircraft, select it directly (bypass raycasting issues)
        if (hoveredAircraft) {
            console.log('[Click] Using hoveredAircraft shortcut:', hoveredAircraft);
            selectAircraft(hoveredAircraft);
            return;
        }

        // Calculate mouse position in normalized device coordinates
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Update raycaster
        raycaster.setFromCamera(mouse, camera);

        // Check for intersections with aircraft meshes, labels, airport labels, historical tracks, AND endpoints
        const aircraftArray = Array.from(aircraftMeshes.values());
        const labelArray = Array.from(aircraftLabels.values());
        // Only include tracks and endpoints that are IN THE SCENE (have a parent)
        const historicalTracksArray = Array.from(HistoricalState.trackMeshes.values())
            .filter(tm => tm.line.parent)
            .map(tm => tm.line);
        const endpointsArray = (HistoricalState.endpointMeshes || [])
            .filter(endpoint => endpoint.parent);
        const allClickableObjects = [...aircraftArray, ...labelArray, ...airportMeshes, ...historicalTracksArray, ...endpointsArray];
        const intersects = raycaster.intersectObjects(allClickableObjects, true);

        if (intersects.length > 0) {
            const clickedObject = intersects[0].object;

            // Check if we clicked a historical endpoint
            if (clickedObject.userData && clickedObject.userData.isHistoricalEndpoint) {
                showHistoricalTrackDetail(clickedObject.userData);
                return;
            }

            // Check if we clicked a historical track line
            if (clickedObject.userData && clickedObject.userData.isHistoricalTrack) {
                showHistoricalTrackDetail(clickedObject.userData);
                return;
            }

            // Check if we clicked an airport label
            for (const airportSprite of airportMeshes) {
                if (airportSprite === clickedObject && airportSprite.userData.isAirportLabel) {
                    showAirportDetail(airportSprite.userData.airport);
                    return;
                }
            }

            // Check if we clicked an aircraft label (label group or any of its children)
            for (const [hex, labelGroup] of aircraftLabels.entries()) {
                if (labelGroup === clickedObject || labelGroup.children.includes(clickedObject)) {
                    selectAircraft(hex);  // Use selectAircraft instead of showAircraftDetail
                    return;
                }
            }

            // Otherwise, find the parent Group (aircraft) for this clicked mesh
            let aircraftGroup = clickedObject;
            while (aircraftGroup && aircraftGroup.parent && aircraftGroup.parent.type !== 'Scene') {
                aircraftGroup = aircraftGroup.parent;
            }

            // Find the hex for this aircraft group
            // Check the clicked object, its parent, and all ancestors
            for (const [hex, mesh] of aircraftMeshes.entries()) {
                if (mesh === aircraftGroup ||
                    mesh === clickedObject ||
                    mesh.children.includes(clickedObject) ||
                    clickedObject.parent === mesh) {
                    console.log(`[Click] Detected click on aircraft ${hex}, selecting aircraft`);
                    selectAircraft(hex);  // Use selectAircraft instead of showAircraftDetail
                    break;
                }
            }
        }
    });

    // Close detail panel
    document.getElementById('close-detail').addEventListener('click', () => {
        document.getElementById('aircraft-detail').style.display = 'none';

        // Keep follow mode active if it was enabled
        // Only clear selectedAircraft display state
        // Follow mode and followedAircraftHex remain unchanged
        // The follow button also remains visible if follow mode is active
        if (!followMode) {
            // Only hide follow button if follow mode is not active
            const followBtn = document.getElementById('toggle-follow');
            if (followBtn) {
                followBtn.style.display = 'none';
            }

            // Only clear URL if not following
            const url = new URL(window.location);
            url.searchParams.delete('icao');
            window.history.pushState({}, '', url);
        }
        // If following, keep the URL so the aircraft link remains shareable

        selectedAircraft = null;
    });
}

// ============================================================================
// MOBILE TOUCH UX ENHANCEMENTS
// ============================================================================

/**
 * Setup mobile-specific touch enhancements
 * - Long-press context menu for aircraft
 * - Double-tap to reset camera
 * - Visual feedback for touch actions
 */
function setupMobileTouchUX() {
    const isMobile = window.innerWidth <= 768;
    if (!isMobile) return; // Only on mobile

    // Long-press detection for aircraft
    // Removed duplicate touch handlers - now integrated into setupTouchControls()
    console.log('[Mobile] Touch UX enhancements enabled via unified handler');
}

/**
 * Show context menu for aircraft (mobile long-press)
 */
function showAircraftContextMenu(x, y, intersection) {
    // Find the aircraft hex from the mesh
    let aircraftHex = null;

    // Check if it's an aircraft line or label
    if (intersection.object.userData?.aircraftHex) {
        aircraftHex = intersection.object.userData.aircraftHex;
    } else {
        // Traverse parent to find aircraft hex
        let obj = intersection.object;
        while (obj && !aircraftHex) {
            if (obj.userData?.aircraftHex) {
                aircraftHex = obj.userData.aircraftHex;
                break;
            }
            obj = obj.parent;
        }
    }

    if (!aircraftHex) return;

    // Create temporary context menu
    const menu = document.createElement('div');
    menu.style.position = 'fixed';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.background = 'var(--panel-bg-solid)';
    menu.style.border = '1px solid var(--panel-border)';
    menu.style.borderRadius = '8px';
    menu.style.zIndex = '10000';
    menu.style.minWidth = '160px';
    menu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    menu.style.animation = 'slideUp 0.2s ease';

    const actions = [
        { label: '👁️ Select', action: () => selectAircraftByHex(aircraftHex) },
        { label: '📍 Follow', action: () => { selectAircraftByHex(aircraftHex); toggleFollowMode(); } },
        { label: 'ℹ️ Info', action: () => showAircraftDetails(aircraftHex) },
    ];

    actions.forEach(({ label, action }) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.display = 'block';
        btn.style.width = '100%';
        btn.style.padding = '12px 16px';
        btn.style.background = 'none';
        btn.style.border = 'none';
        btn.style.borderBottom = '1px solid var(--panel-border)';
        btn.style.color = 'var(--text-primary)';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '14px';
        btn.style.textAlign = 'left';
        btn.style.transition = 'background 0.2s ease';

        btn.onmouseover = () => btn.style.background = 'var(--accent-primary-dim)';
        btn.onmouseout = () => btn.style.background = 'none';

        btn.onclick = () => {
            action();
            document.body.removeChild(menu);
        };

        menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    // Close menu when clicking outside
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            if (document.body.contains(menu)) {
                document.body.removeChild(menu);
            }
            document.removeEventListener('click', closeMenu);
            document.removeEventListener('touchstart', closeMenu);
        }
    };

    setTimeout(() => {
        document.addEventListener('click', closeMenu);
        document.addEventListener('touchstart', closeMenu);
    }, 10);
}

/**
 * Select aircraft by hex code
 */
function selectAircraftByHex(hex) {
    const aircraft = aircraftData.aircraft?.find(ac => ac.hex?.toUpperCase() === hex?.toUpperCase());
    if (aircraft) {
        showAircraftDetails(aircraft.hex);
    }
}

// Initialize mobile UX when DOM is ready
if (window.innerWidth <= 768) {
    // Will be called from init() after Three.js setup
}

// Check URL parameters on page load
function checkUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const icao = urlParams.get('icao');
    const tronMode = urlParams.get('tron');

    // Handle Tron mode parameter
    if (tronMode === '1' || tronMode === 'true') {
        // console.log('[URL] Enabling Tron mode from URL parameter');
        showTronMode = true;
        const tronToggle = document.getElementById('toggle-tron-mode-container');
        if (tronToggle) {
            tronToggle.classList.add('active');
        }
        // Don't create curtains here - they will be created when trails are loaded/updated
        // Creating them here causes doubles when historical trails are loaded
    }

    if (icao) {
        // Convert to lowercase for comparison (aircraft hex codes are stored lowercase internally)
        const hexLower = icao.toLowerCase();
        let trailsLoaded = false; // Flag to prevent double-loading

        // Check if this aircraft exists
        if (aircraftMeshes.has(hexLower)) {
            console.log(`[URL] Loading aircraft from URL: ${icao}`);
            // Use focusOnAircraft instead of showAircraftDetail to get camera animation
            focusOnAircraft(hexLower);

            // If Track API is available, load 5min of recent trails
            if (AppFeatures.historical) {
                console.log(`[URL] Auto-loading 5min of recent trails for ${icao}`);
                const now = Math.floor(Date.now() / 1000);
                const fiveMinutesAgo = now - (5 * 60);
                loadRecentTrails(fiveMinutesAgo, now);
                trailsLoaded = true; // Mark as loaded
            }
        } else {
            console.log(`[URL] Aircraft ${icao} not currently visible, will retry...`);
            // Aircraft not yet loaded, try again in a moment
            setTimeout(() => {
                if (aircraftMeshes.has(hexLower) && !trailsLoaded) {
                    focusOnAircraft(hexLower);

                    if (AppFeatures.historical) {
                        console.log(`[URL] Auto-loading 5min of recent trails for ${icao}`);
                        const now = Math.floor(Date.now() / 1000);
                        const fiveMinutesAgo = now - (5 * 60);
                        loadRecentTrails(fiveMinutesAgo, now);
                        trailsLoaded = true; // Mark as loaded
                    }
                } else if (!aircraftMeshes.has(hexLower)) {
                    // Aircraft still not found after 2 seconds - show error message
                    console.warn(`[URL] Aircraft ${icao} not found`);
                    showAircraftNotFoundMessage(icao.toUpperCase());
                }
            }, 2000);
        }
    }
}

// Show a message when aircraft from URL is not found
function showAircraftNotFoundMessage(icao) {
    // Create a temporary notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(255, 68, 68, 0.95);
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        font-size: 14px;
        z-index: 10000;
        animation: slideDown 0.3s ease-out;
    `;
    notification.innerHTML = `
        <strong>✈️ Aircraft Not Found</strong><br>
        <span style="font-size: 12px;">ICAO: ${icao} is not currently visible in the area.</span>
    `;

    document.body.appendChild(notification);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        notification.style.animation = 'slideUp 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 5000);

    // Clear the URL parameter
    const url = new URL(window.location);
    url.searchParams.delete('icao');
    window.history.replaceState({}, '', url);
}

// Show aircraft detail panel
async function showAircraftDetail(hex) {
    const mesh = aircraftMeshes.get(hex);
    if (!mesh || !mesh.userData) return;

    const data = mesh.userData;
    const panel = document.getElementById('aircraft-detail');
    const callsign = data.flight?.trim() || data.hex || hex;

    // Use textContent (not innerHTML) for callsign to prevent XSS
    document.getElementById('detail-callsign').textContent = callsign;

    // Build detail grid
    const details = [];

    // Add MLAT status at the top if applicable
    // Signal Quality Information
    const signalQuality = mesh.userData.signalQuality || getSignalQuality(data);
    if (signalQuality) {
        // Create quality badge with color based on score
        let qualityColor = '#4caf50'; // Green for good
        if (signalQuality.score < 40) qualityColor = '#f44336'; // Red for poor
        else if (signalQuality.score < 60) qualityColor = '#ff9800'; // Orange for fair
        else if (signalQuality.score < 80) qualityColor = '#ffc107'; // Yellow for moderate

        const qualityBadge = `<span style="background: ${qualityColor}; padding: 2px 6px; border-radius: 3px; color: white;">${signalQuality.quality} (${signalQuality.score}%)</span>`;
        details.push({ label: 'Signal Quality', value: qualityBadge });

        // Add RSSI if available
        if (signalQuality.rssi !== undefined) {
            const rssiColor = signalQuality.rssi < -38 ? '#ff9800' : '#4caf50';
            details.push({ label: 'Signal Strength', value: `<span style="color: ${rssiColor}">${signalQuality.rssi.toFixed(1)} dBm</span>` });
        }

        // Add data age
        if (signalQuality.seen !== undefined) {
            const seenColor = signalQuality.seen > 10 ? '#ff9800' : '#4caf50';
            details.push({ label: 'Data Age', value: `<span style="color: ${seenColor}">${signalQuality.seen.toFixed(1)}s ago</span>` });
        }

        // Add any issues as a note
        if (signalQuality.issues && signalQuality.issues.length > 0) {
            const issuesText = signalQuality.issues.join(', ');
            details.push({ label: 'Data Issues', value: `<span style="color: #ff9800; font-size: 11px">${issuesText}</span>` });
        }
    }

    const isMLAT = data.mlat && data.mlat.length > 0;
    if (isMLAT) {
        details.push({ label: 'Position Source', value: `<span style="background: #ff6600; padding: 2px 6px; border-radius: 3px; color: white;">MLAT</span>` });
    }

    // Add military status if applicable
    const isMilitary = mesh.userData.isMilitary || false;
    const militaryInfo = mesh.userData.militaryInfo;
    if (isMilitary) {
        const militaryBgColor = getCSSVar('military-color');
        const militaryLabel = `<span style="background: ${militaryBgColor}; padding: 2px 6px; border-radius: 3px; color: white; font-weight: bold;">MILITARY AIRCRAFT</span>`;
        details.push({ label: 'Classification', value: militaryLabel });

        if (militaryInfo) {
            if (militaryInfo.tail) details.push({ label: 'Military Tail', value: sanitizeHTML(militaryInfo.tail) });
            if (militaryInfo.type) details.push({ label: 'Military Type', value: sanitizeHTML(militaryInfo.type) });
            if (militaryInfo.description) details.push({ label: 'Description', value: sanitizeHTML(militaryInfo.description) });
        }
    }

    // Aircraft info (like tar1090) - sanitize all external data
    if (data.desc) {
        // Show year + description if available (e.g., "2019 BOEING 757-200")
        const year = data.year ? sanitizeHTML(String(data.year)) : '';
        const desc = sanitizeHTML(data.desc);
        const aircraftInfo = year ? `${year} ${desc}` : desc;
        details.push({ label: 'Aircraft', value: aircraftInfo });
    }
    if (data.ownOp) details.push({ label: 'Operator', value: sanitizeHTML(data.ownOp) });
    if (data.r) details.push({ label: 'Registration', value: sanitizeHTML(data.r) });
    if (data.t) details.push({ label: 'Type Code', value: sanitizeHTML(data.t) });

    // === Aircraft Specifications ===
    if (data.t) {
        const specs = getAircraftSpecs(data.t);
        if (specs) {
            // Add section header
            details.push({ label: 'Performance Specifications', value: '', header: true });

            details.push({
                label: 'Cruise Speed',
                value: `${specs.cruise} kts`
            });

            details.push({
                label: 'Max Altitude',
                value: `${specs.maxAlt.toLocaleString()} ft`
            });

            details.push({
                label: 'Range',
                value: `${specs.range.toLocaleString()} nm`
            });
        }
    }

    // Add route placeholder (will be populated async)
    details.push({ label: 'Route', value: '<span id="route-loading">Loading...</span>' });

    // Flight data
    if (data.alt_baro) details.push({ label: 'Altitude', value: `${data.alt_baro.toLocaleString()} ft` });
    if (data.alt_geom) details.push({ label: 'Geometric Alt', value: `${data.alt_geom.toLocaleString()} ft` });
    if (data.gs) details.push({ label: 'Ground Speed', value: `${data.gs.toFixed(0)} knots` });
    if (data.tas) details.push({ label: 'True Airspeed', value: `${data.tas.toFixed(0)} knots` });
    if (data.track) details.push({ label: 'Track/Heading', value: `${data.track.toFixed(0)}°` });

    // Show vertical rate (prefer baro_rate, fall back to geom_rate)
    const vertRate = data.baro_rate ?? data.geom_rate;
    if (vertRate) details.push({ label: 'Vertical Rate', value: `${vertRate > 0 ? '+' : ''}${vertRate} ft/min` });

    if (data.r_dst) details.push({ label: 'Distance', value: `${data.r_dst.toFixed(1)} nmi` }); // r_dst is already in nautical miles
    if (data.category) details.push({ label: 'Category', value: data.category });
    if (data.squawk) details.push({ label: 'Squawk', value: data.squawk });
    if (data.emergency) details.push({ label: 'Emergency', value: data.emergency });

    const contentHtml = details.map(d => {
        if (d.header) {
            // Header row for sections (e.g., "Performance Specifications")
            return `<div class="detail-header">${d.label}</div>`;
        } else {
            // Regular label:value pair
            return `<div class="detail-label">${d.label}:</div><div class="detail-value">${d.value}</div>`;
        }
    }).join('');

    document.getElementById('detail-content').innerHTML = contentHtml +
        '<div id="aircraft-photo-container" style="grid-column: 1 / -1; margin-top: 10px; text-align: center;"></div>';
    panel.style.display = 'block';

    // Show and configure the detail panel Follow button
    // Only show in live mode or historical playback mode (not in historical show-all)
    const detailFollowBtn = document.getElementById('detail-follow-btn');
    if (detailFollowBtn) {
        // Hide follow button in historical "show all" mode - there's nothing to follow
        const shouldShowFollow = currentMode === 'live' ||
                                (currentMode === 'historical' && HistoricalState.displayMode === 'playback');

        if (shouldShowFollow) {
            detailFollowBtn.style.display = 'block';
            detailFollowBtn.onclick = () => {
                // Use focusOnAircraft to zoom and follow
                focusOnAircraft(hex);
                detailFollowBtn.textContent = '✓ Following';
                detailFollowBtn.style.background = '#28a745';
                console.log(`[Follow] Now following aircraft ${hex}`);
            };

            // Update button state if already following
            if (followMode && followedAircraftHex === hex) {
                detailFollowBtn.textContent = '✓ Following';
                detailFollowBtn.style.background = '#28a745';
            } else {
                detailFollowBtn.textContent = '📍 Follow Aircraft';
                detailFollowBtn.style.background = 'var(--accent-primary)';
            }
        } else {
            // Hide button in historical "show all" mode
            detailFollowBtn.style.display = 'none';
        }
    }

    // Show follow button when aircraft is selected (if it exists)
    // Only in modes where following makes sense
    const followBtn = document.getElementById('toggle-follow');
    if (followBtn) {
        const shouldShowFollow = currentMode === 'live' ||
                                (currentMode === 'historical' && HistoricalState.displayMode === 'playback');
        followBtn.style.display = shouldShowFollow ? 'inline-block' : 'none';
    }

    selectedAircraft = hex;

    // Update URL with icao parameter (for shareable links)
    const url = new URL(window.location);
    url.searchParams.set('icao', hex.toUpperCase());
    window.history.pushState({}, '', url);

    // Fetch route info asynchronously
    if (callsign && callsign !== hex) {
        fetchRouteInfo(callsign).then(route => {
            const routeEl = document.getElementById('route-loading');
            if (!routeEl) return; // Panel may have closed

            if (route && route.origin && route.destination) {
                const originCode = route.origin.iata_code || route.origin.icao_code || '???';
                const destCode = route.destination.iata_code || route.destination.icao_code || '???';
                const originName = route.origin.municipality || route.origin.name || originCode;
                const destName = route.destination.municipality || route.destination.name || destCode;

                routeEl.innerHTML = `<strong>${originCode}</strong> → <strong>${destCode}</strong><br>
                    <span style="font-size: 11px; color: #888;">${originName} → ${destName}</span><br>
                    <span style="font-size: 10px; color: #666; font-style: italic;">⚠️ Typical route, may not match current flight</span>`;
            } else {
                routeEl.textContent = 'Unknown';
            }
        });
    } else {
        const routeEl = document.getElementById('route-loading');
        if (routeEl) routeEl.textContent = 'N/A';
    }

    // Fetch aircraft photo asynchronously from adsbdb.com
    fetchAircraftInfo(hex).then(aircraftInfo => {
        const photoContainer = document.getElementById('aircraft-photo-container');
        if (!photoContainer) return; // Panel may have closed

        if (aircraftInfo && aircraftInfo.url_photo_thumbnail) {
            // Proxy image URLs through our nginx to avoid CORS issues
            const photoUrl = aircraftInfo.url_photo || aircraftInfo.url_photo_thumbnail;
            const thumbUrl = aircraftInfo.url_photo_thumbnail;

            // Replace airport-data.com domain with our proxy path
            const proxiedThumbUrl = thumbUrl.replace('https://airport-data.com/images/', '/images/');
            const proxiedPhotoUrl = photoUrl.replace('https://airport-data.com/images/', '/images/');

            // Create image element with error handling
            const img = new Image();
            img.onload = () => {
                // Image loaded successfully
                if (!document.getElementById('aircraft-photo-container')) return; // Panel may have closed
                photoContainer.innerHTML = `
                    <a href="${proxiedPhotoUrl}" target="_blank" rel="noopener noreferrer">
                        <img src="${proxiedThumbUrl}" alt="Aircraft photo" style="max-width: 100%; border-radius: 6px; margin-top: 8px;">
                    </a>
                    <div style="font-size: 10px; color: #888; margin-top: 4px;">Photo via <a href="https://airport-data.com/" target="_blank" rel="noopener noreferrer" style="color: #4a9eff;">Airport-Data.com</a></div>
                `;
            };
            img.onerror = () => {
                // Image failed to load (404, etc.)
                console.log(`[Photo] Image not available for ${hex}: ${proxiedThumbUrl}`);
                if (!document.getElementById('aircraft-photo-container')) return; // Panel may have closed
                photoContainer.innerHTML = `
                    <div style="font-size: 11px; color: #666; margin-top: 8px; font-style: italic;">📷 Photo not available</div>
                `;
            };
            // Start loading the image
            img.src = proxiedThumbUrl;
        }
    });
}

// Show historical track detail panel
function showHistoricalTrackDetail(userData) {
    const track = userData.track;
    const icao = userData.icao;
    const panel = document.getElementById('aircraft-detail');

    // Use callsign or ICAO as title
    const displayName = track.callsign?.trim() || track.registration || icao || 'Unknown';
    document.getElementById('detail-callsign').textContent = displayName;

    // Build detail grid
    const details = [];

    // Add military status if applicable
    if (userData.isMilitary) {
        const militaryBgColor = getCSSVar('military-color');
        const militaryLabel = `<span style="background: ${militaryBgColor}; padding: 2px 6px; border-radius: 3px; color: white; font-weight: bold;">MILITARY AIRCRAFT</span>`;
        details.push({ label: 'Classification', value: militaryLabel });
    }

    // Basic track info
    if (track.callsign) details.push({ label: 'Callsign', value: track.callsign.trim() });
    if (track.registration) details.push({ label: 'Registration', value: track.registration });
    details.push({ label: 'ICAO Hex', value: icao });

    // Aircraft type info
    if (track.aircraft_type) details.push({ label: 'Aircraft Type', value: track.aircraft_type });

    // Position count
    if (track.positions && track.positions.length > 0) {
        details.push({ label: 'Positions', value: `${track.positions.length} data points` });

        // Time range
        const firstPos = track.positions[0];
        const lastPos = track.positions[track.positions.length - 1];

        if (firstPos.time && lastPos.time) {
            const startTime = new Date(firstPos.time);
            const endTime = new Date(lastPos.time);
            const duration = (endTime - startTime) / 1000 / 60; // minutes

            details.push({
                label: 'First Seen',
                value: startTime.toLocaleTimeString()
            });
            details.push({
                label: 'Last Seen',
                value: endTime.toLocaleTimeString()
            });
            details.push({
                label: 'Duration',
                value: `${Math.round(duration)} minutes`
            });
        }

        // Altitude range
        const altitudes = track.positions
            .map(p => p.alt || p.altitude)
            .filter(a => a != null);

        if (altitudes.length > 0) {
            const minAlt = Math.min(...altitudes);
            const maxAlt = Math.max(...altitudes);
            details.push({
                label: 'Altitude Range',
                value: `${Math.round(minAlt).toLocaleString()} - ${Math.round(maxAlt).toLocaleString()} ft`
            });
        }

        // Speed (if available in any position)
        const speeds = track.positions
            .map(p => p.gs || p.ground_speed)
            .filter(s => s != null);

        if (speeds.length > 0) {
            const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
            details.push({
                label: 'Avg Speed',
                value: `${Math.round(avgSpeed)} kts`
            });
        }
    }

    // Render detail grid
    const detailGrid = document.getElementById('detail-content');
    if (!detailGrid) {
        console.error('[Historical] detail-content element not found in DOM');
        return;
    }
    detailGrid.innerHTML = details.map(d => `
        <div class="detail-label">${d.label}</div>
        <div class="detail-value">${d.value}</div>
    `).join('');

    // Show panel
    panel.style.display = 'block';

    // Hide follow button for historical tracks
    const followBtn = document.getElementById('toggle-follow');
    if (followBtn) {
        followBtn.style.display = 'none';
    }

    // Hide photo section for historical tracks
    const photoContainer = document.getElementById('aircraft-photo');
    if (photoContainer) {
        photoContainer.innerHTML = '<div style="font-size: 11px; color: #888; margin-top: 8px;">Historical track data</div>';
    }

    console.log('[Historical] Showing detail for track:', icao);
}

// Show airport detail panel when airport label is clicked
async function showAirportDetail(airport) {
    const panel = document.getElementById('aircraft-detail');
    const name = airport.name || 'Unknown Airport';
    const ident = airport.ident || airport.icao_code || 'N/A';

    document.getElementById('detail-callsign').textContent = `${ident} - ${name}`;

    // Build detail grid
    const details = [];

    // Airport information
    if (airport.type) {
        const typeLabel = airport.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
        details.push({ label: 'Type', value: typeLabel });
    }
    if (airport.municipality) details.push({ label: 'City', value: airport.municipality });
    if (airport.iso_region) details.push({ label: 'Region', value: airport.iso_region });
    if (airport.latitude_deg && airport.longitude_deg) {
        details.push({
            label: 'Coordinates',
            value: `${parseFloat(airport.latitude_deg).toFixed(4)}, ${parseFloat(airport.longitude_deg).toFixed(4)}`
        });
    }
    if (airport.elevation_ft) {
        details.push({ label: 'Elevation', value: `${airport.elevation_ft} ft` });
    }
    if (airport.iata_code) details.push({ label: 'IATA Code', value: airport.iata_code });
    if (airport.icao_code) details.push({ label: 'ICAO Code', value: airport.icao_code });
    if (airport.gps_code) details.push({ label: 'GPS Code', value: airport.gps_code });

    // Count runways for this airport
    const airportRunways = runways.filter(r => r.airport_ref === airport.id);
    if (airportRunways.length > 0) {
        details.push({ label: 'Runways', value: airportRunways.length.toString() });
    }

    // Add placeholder for active flights
    details.push({ label: 'Active Flights', value: '<span id="airport-flights-loading">Checking...</span>' });

    const detailContent = document.getElementById('detail-content');
    detailContent.innerHTML = details.map(d =>
        `<div class="detail-label">${d.label}:</div><div class="detail-value">${d.value}</div>`
    ).join('');

    panel.style.display = 'block';

    // Don't show follow button for airports
    const followBtn = document.getElementById('toggle-follow');
    if (followBtn) {
        followBtn.style.display = 'none';
    }

    selectedAircraft = null; // Clear selected aircraft

    // Check for active flights to/from this airport
    const airportCodes = [airport.icao_code, airport.iata_code, airport.gps_code].filter(c => c);
    const departures = [];
    const arrivals = [];

    // Check all currently tracked aircraft
    for (const [hex, mesh] of aircraftMeshes.entries()) {
        const data = mesh.userData;
        const callsign = data.flight?.trim();

        if (callsign) {
            // Fetch route info for this aircraft
            const route = await fetchRouteInfo(callsign);

            if (route) {
                // Check if departing from this airport
                const originCodes = [route.origin?.icao_code, route.origin?.iata_code].filter(c => c);
                if (originCodes.some(code => airportCodes.includes(code))) {
                    departures.push({ callsign, hex, destination: route.destination?.iata_code || route.destination?.icao_code || '???' });
                }

                // Check if arriving at this airport
                const destCodes = [route.destination?.icao_code, route.destination?.iata_code].filter(c => c);
                if (destCodes.some(code => airportCodes.includes(code))) {
                    arrivals.push({ callsign, hex, origin: route.origin?.iata_code || route.origin?.icao_code || '???' });
                }
            }
        }
    }

    // Update the active flights section
    const flightsEl = document.getElementById('airport-flights-loading');
    if (flightsEl) {
        if (departures.length === 0 && arrivals.length === 0) {
            flightsEl.textContent = 'None currently tracked';
        } else {
            let html = '';

            if (departures.length > 0) {
                html += `<div style="margin-bottom: 8px;"><strong style="color: #4a9eff;">Departures (${departures.length}):</strong><br>`;
                html += departures.map(d =>
                    `<span style="font-size: 11px; color: #ccc;">${d.callsign} → ${d.destination}</span>`
                ).join('<br>');
                html += '</div>';
            }

            if (arrivals.length > 0) {
                html += `<div><strong style="color: #4a9eff;">Arrivals (${arrivals.length}):</strong><br>`;
                html += arrivals.map(a =>
                    `<span style="font-size: 11px; color: #ccc;">${a.origin} → ${a.callsign}</span>`
                ).join('<br>');
                html += '</div>';
            }

            flightsEl.innerHTML = html;
        }
    }
}

// Initialize theme system FIRST (before any DOM rendering)
initializeTheme();

// Start the application with feature detection
initializeApp();

// Load military aircraft database (async, non-blocking)
loadMilitaryDatabase();

// ============================================================================
// THEME UI EVENT LISTENERS
// ============================================================================

function setupThemeUI() {
    console.log('[Theme] Setting up theme UI event listeners...');

    // Show theme modal
    const showThemesBtn = document.getElementById('show-themes');
    if (showThemesBtn) {
        console.log('[Theme] Found show-themes button:', showThemesBtn);
        showThemesBtn.addEventListener('click', (e) => {
            console.log('[Theme] Themes button clicked!', e);
            const modal = document.getElementById('theme-modal');
            console.log('[Theme] Theme modal element:', modal);
            if (modal) {
                modal.classList.add('show');
                console.log('[Theme] Added "show" class to modal');
            } else {
                console.error('[Theme] Modal not found!');
            }

            // Update active theme indicator
            const currentTheme = getCurrentTheme();
            console.log('[Theme] Current theme:', currentTheme);
            document.querySelectorAll('.theme-card').forEach(card => {
                card.classList.remove('active');
                if (card.dataset.theme === currentTheme) {
                    card.classList.add('active');
                }
            });
        });
        console.log('[Theme] Show themes button listener attached');
    } else {
        console.warn('[Theme] show-themes button not found');
    }

    // Close theme modal
    const closeModalBtn = document.getElementById('close-theme-modal');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            document.getElementById('theme-modal').classList.remove('show');
        });
        console.log('[Theme] Close modal button listener attached');
    }

    // Close theme modal on background click
    const themeModal = document.getElementById('theme-modal');
    if (themeModal) {
        themeModal.addEventListener('click', (e) => {
            if (e.target.id === 'theme-modal') {
                document.getElementById('theme-modal').classList.remove('show');
            }
        });
        console.log('[Theme] Background click listener attached');
    }

    // Theme card click handlers
    const themeCards = document.querySelectorAll('.theme-card');
    if (themeCards.length > 0) {
        themeCards.forEach(card => {
            card.addEventListener('click', () => {
                const themeName = card.dataset.theme;

                // Apply theme
                applyTheme(themeName);

                // Update active indicators
                document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');

                // Optional: Close modal after selection
                setTimeout(() => {
                    document.getElementById('theme-modal').classList.remove('show');
                }, 300);
            });
        });
        console.log(`[Theme] Theme card listeners attached (${themeCards.length} cards)`);
    } else {
        console.warn('[Theme] No theme cards found');
    }

    // Close modals with ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('theme-modal');
            if (modal) {
                modal.classList.remove('show');
            }
        }
    });
    console.log('[Theme] ESC key listener attached');
}
