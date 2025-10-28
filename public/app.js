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
    mapTileGridSize: 9, // Load NxN grid of tiles (increased from 5 for better coverage)
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
    try {
        localStorage.setItem('adsb3d-theme', themeName);
        console.log(`[Theme] Saved preference: ${themeName}`);
    } catch (e) {
        console.warn('[Theme] Could not save to localStorage:', e);
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
    try {
        const saved = localStorage.getItem('adsb3d-theme');
        if (saved && THEMES[saved]) {
            return saved;
        }
    } catch (e) {
        console.warn('[Theme] Could not read from localStorage:', e);
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
        return {
            // Mode
            mode: params.get('mode'), // 'live' or 'historical'

            // Historical time range
            start: params.get('start'), // ISO 8601 datetime
            end: params.get('end'), // ISO 8601 datetime
            preset: params.get('preset'), // Time preset (1, 4, 8, 12, 24, or 'custom')

            // Display settings
            tron: params.get('tron'), // Tron mode ('1' or null)
            display: params.get('display'), // Display mode ('all' or 'playback')
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
                    await switchToLiveMode();
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
                    await switchToLiveMode();
                    return false;
                }

                // Validate date range is reasonable (not in future, not too far in past)
                const now = new Date();
                const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

                if (startDate > now) {
                    console.warn('[URL State] Start time is in the future - falling back to live mode');
                    await switchToLiveMode();
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
                    await switchToLiveMode();
                    return false;
                }

                // Switch to historical mode first
                await switchToHistoricalMode();

                // Set preset or custom mode with validation
                if (urlParams.preset && urlParams.preset !== 'custom') {
                    // Validate preset value
                    const validPresets = ['1', '4', '8', '12', '24'];
                    if (validPresets.includes(urlParams.preset)) {
                        const presetRadio = document.querySelector(`input[name="time-preset"][value="${urlParams.preset}"]`);
                        if (presetRadio) {
                            presetRadio.checked = true;
                            const customRange = document.getElementById('custom-time-range');
                            if (customRange) customRange.style.display = 'none';
                        }
                    } else {
                        console.warn('[URL State] Invalid preset value:', urlParams.preset, '- using custom');
                    }
                } else {
                    // Select custom mode
                    const customRadio = document.querySelector('input[name="time-preset"][value="custom"]');
                    if (customRadio) {
                        customRadio.checked = true;
                        const customRange = document.getElementById('custom-time-range');
                        if (customRange) customRange.style.display = 'block';
                    }
                }

                // Populate custom time fields (correct IDs: start-time and end-time)
                const startTimeInput = document.getElementById('start-time');
                const endTimeInput = document.getElementById('end-time');
                if (startTimeInput) startTimeInput.value = urlParams.start;
                if (endTimeInput) endTimeInput.value = urlParams.end;

                // Apply tron mode if specified
                if (urlParams.tron === '1' || urlParams.tron === 'true') {
                    const tronCheckbox = document.getElementById('historical-tron-mode');
                    if (tronCheckbox) tronCheckbox.checked = true;
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
                        if (input) input.value = altMax;
                    } else {
                        console.warn('[URL State] Invalid altmax value:', urlParams.altmax);
                    }
                }

                if (urlParams.minpos) {
                    const minPos = parseInt(urlParams.minpos);
                    if (!isNaN(minPos) && minPos >= 2 && minPos <= 10000) {
                        const input = document.getElementById('filter-min-positions');
                        if (input) input.value = minPos;
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
                        }, 1000);
                    }, 500);
                }

                console.log('[URL State] Applied historical mode from URL');
                return true;
            }

            // Mode is explicitly 'live' or unrecognized
            if (urlParams.mode === 'live') {
                await switchToLiveMode();
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
                await switchToLiveMode();
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

            if (HistoricalState.tronMode) state.tron = '1';

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
        const currentTheme = localStorage.getItem('selectedTheme');
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
    tronMode: false,         // Tron mode for historical tracks (altitude curtains)
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
    icaos: new Set()         // Track which aircraft have recent trails loaded
};

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
        const cached = localStorage.getItem(CACHE_KEY);
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
            localStorage.setItem('military_aircraft_db', JSON.stringify({
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
let showTronMode = false; // Tron mode: vertical altitude curtains beneath trails
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

        // Render the tracks
        renderHistoricalTracks();

        // Apply filters immediately to show tracks (defaults show all)
        console.log('[Historical] Auto-applying filters to display tracks...');
        console.log('[Historical] trackMeshes size before filter:', HistoricalState.trackMeshes.size);
        console.log('[Historical] Scene children count:', scene.children.length);

        // Check if lines are actually in the scene
        let linesInScene = 0;
        scene.children.forEach(child => {
            if (child.type === 'Line') linesInScene++;
        });
        console.log('[Historical] Line objects in scene:', linesInScene);

        applyHistoricalFilters();
        console.log('[Historical] Tracks should now be visible on the map');

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

// Clear all trails from the scene (used when loading recent trails)
function clearAllTrails() {
    trails.forEach((trail, icao) => {
        // Remove trail line
        if (trail.line) {
            scene.remove(trail.line);
            if (trail.line.geometry) trail.line.geometry.dispose();
            if (trail.line.material) trail.line.material.dispose();
        }
        // Remove Tron curtain if present
        if (trail.tronCurtain) {
            scene.remove(trail.tronCurtain);
            if (trail.tronCurtain.geometry) trail.tronCurtain.geometry.dispose();
            if (trail.tronCurtain.material) trail.tronCurtain.material.dispose();
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
            if (curtain.geometry) curtain.geometry.dispose();
            if (curtain.material) curtain.material.dispose();
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
                    if (trail.line.geometry) trail.line.geometry.dispose();
                    if (trail.line.material) trail.line.material.dispose();
                }
                if (trail.tronCurtain) {
                    scene.remove(trail.tronCurtain);
                    if (trail.tronCurtain.geometry) trail.tronCurtain.geometry.dispose();
                    if (trail.tronCurtain.material) trail.tronCurtain.material.dispose();
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
                    if (trail.line.geometry) trail.line.geometry.dispose();
                    if (trail.line.material) trail.line.material.dispose();
                }
                if (trail.gapLine) {
                    scene.remove(trail.gapLine);
                    if (trail.gapLine.geometry) trail.gapLine.geometry.dispose();
                    if (trail.gapLine.material) trail.gapLine.material.dispose();
                }
                if (trail.tronCurtain) {
                    scene.remove(trail.tronCurtain);
                    if (trail.tronCurtain.geometry) trail.tronCurtain.geometry.dispose();
                    if (trail.tronCurtain.material) trail.tronCurtain.material.dispose();
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
        const color = getAltitudeColor(pos.y);
        const rgb = new THREE.Color(color);
        colors.push(rgb.r, rgb.g, rgb.b);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Dispose old geometry and update
    if (trail.line.geometry) trail.line.geometry.dispose();
    trail.line.geometry = geometry;

    // Rebuild Tron curtain if it exists
    if (showTronMode && trail.tronCurtain) {
        // Remove old curtain
        scene.remove(trail.tronCurtain);
        if (trail.tronCurtain.geometry) trail.tronCurtain.geometry.dispose();
        if (trail.tronCurtain.material) trail.tronCurtain.material.dispose();
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
            trail.positions.push({
                x: posXZ.x,
                y: Math.max(1.0, altitude),
                z: posXZ.z,
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

                // Get color for this altitude
                const altColor = new THREE.Color(getAltitudeColor(pos.y));
                colors[i * 3] = altColor.r;
                colors[i * 3 + 1] = altColor.g;
                colors[i * 3 + 2] = altColor.b;
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

        // Use the same coordinate conversion as live mode (latLonToXZ function)
        const posXZ = latLonToXZ(lat, lon);

        // Use the same altitude calculation as live mode
        const altitude = (alt - CONFIG.homeLocation.alt) * 0.3048 * CONFIG.scale * CONFIG.altitudeExaggeration;
        const y = Math.max(1.0, altitude);  // Same minimum as live mode

        points.push(new THREE.Vector3(posXZ.x, y, posXZ.z));

        // Get color for this altitude (pass scene units, not feet!)
        const colorValue = isMilitary ? CONFIG.militaryColor : getAltitudeColor(y);
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
        endpointMesh.userData = {
            isHistoricalEndpoint: true,
            trackLine: line,
            originalColor: endColor.clone(),
            icao: track.hex || track.icao,
            track: track
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
                timestamp: smoothedPositions[i].time ? new Date(smoothedPositions[i].time).getTime() : null
            })),
            tronCurtain: null  // Will be populated by updateTronCurtain
        };

        // Create Tron curtain if enabled
        if (HistoricalState.tronMode) {
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

    console.log('[Historical] Cleanup complete');
}

// Apply filters to loaded historical tracks
function applyHistoricalFilters() {
    console.log('[Historical] Applying filters');

    // Get filter values
    const militaryOnly = document.getElementById('filter-military-only').checked;
    const minAlt = parseInt(document.getElementById('filter-altitude-min').value) || 0;
    const maxAlt = parseInt(document.getElementById('filter-altitude-max').value) || 999999;
    const minPositions = parseInt(document.getElementById('filter-min-positions').value) || 0;
    const minSpeed = parseInt(document.getElementById('filter-speed-min').value) || 0;
    const maxSpeed = parseInt(document.getElementById('filter-speed-max').value) || 999999;

    console.log('[Historical] Filter settings:', { militaryOnly, minAlt, maxAlt, minPositions, minSpeed, maxSpeed });

    let visibleCount = 0;
    let hiddenCount = 0;

    // Apply filters to each track mesh
    HistoricalState.trackMeshes.forEach(({ line, points, track, instanceIndices, endpointMesh, trail }, icao) => {
        let visible = true;

        // Military filter
        if (militaryOnly && !track.is_military) {
            visible = false;
        }

        // Minimum positions filter
        if (track.positions && track.positions.length < minPositions) {
            visible = false;
        }

        // Altitude filter (exclude if ANY position is outside range)
        if (track.positions && track.positions.length > 0) {
            const allAltitudesInRange = track.positions.every(pos => {
                const alt = pos.alt || pos.altitude || 0;
                return alt >= minAlt && alt <= maxAlt;
            });
            if (!allAltitudesInRange) {
                visible = false;
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
            // Add Tron curtain if enabled
            if (trail && trail.tronCurtain && !trail.tronCurtain.parent) {
                scene.add(trail.tronCurtain);
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
            // Remove Tron curtain from scene
            if (trail && trail.tronCurtain && trail.tronCurtain.parent) {
                scene.remove(trail.tronCurtain);
            }
            hiddenCount++;
        }
    });

    console.log(`[Historical] Filters applied: ${visibleCount} visible, ${hiddenCount} hidden`);

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

    // Play/Pause
    playPauseBtn.addEventListener('click', togglePlayback);

    // Restart
    restartBtn.addEventListener('click', restartPlayback);

    // Speed change
    speedSelect.addEventListener('change', (e) => {
        PlaybackState.speed = parseFloat(e.target.value);
        console.log(`[Playback] Speed changed to ${PlaybackState.speed}x`);
    });

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
                errorMessage += 'Cannot reach Track API. Check if track-api container is running.';
            } else if (error.message.includes('404')) {
                errorMessage += 'Track API endpoint not found. Check API version.';
            } else if (error.message.includes('500')) {
                errorMessage += 'Track API error. Check track-api logs for details.';
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

        // Initialize playback system
        initializePlayback();

        console.log('[Display Mode] Switched to Playback mode');

        // Update URL with current app state
        URLState.updateFromCurrentState();
    });

    // Tron Mode toggle
    const historicalTronToggle = document.getElementById('historical-tron-mode');
    if (historicalTronToggle) {
        historicalTronToggle.addEventListener('change', (e) => {
            HistoricalState.tronMode = e.target.checked;
            console.log('[Historical Tron] Mode', HistoricalState.tronMode ? 'enabled' : 'disabled');

            // Update URL with current app state
            URLState.updateFromCurrentState();

            if (HistoricalState.tronMode) {
                // Create curtains for all existing tracks
                let curtainsCreated = 0;
                HistoricalState.trackMeshes.forEach(({trail}) => {
                    if (trail && trail.positions.length > 1) {
                        updateTronCurtain(trail);
                        curtainsCreated++;
                    }
                });
                console.log(`[Historical Tron] Created ${curtainsCreated} curtains`);
            } else {
                // Remove all curtains
                let curtainsRemoved = 0;
                HistoricalState.trackMeshes.forEach(({trail}) => {
                    if (trail && trail.tronCurtain) {
                        scene.remove(trail.tronCurtain);
                        if (trail.tronCurtain.geometry) trail.tronCurtain.geometry.dispose();
                        if (trail.tronCurtain.material) trail.tronCurtain.material.dispose();
                        trail.tronCurtain = null;
                        curtainsRemoved++;
                    }
                });
                console.log(`[Historical Tron] Removed ${curtainsRemoved} curtains`);
            }
        });
    }
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
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
    });
    aircraftMeshes.clear();

    // Remove aircraft labels
    aircraftLabels.forEach(label => {
        scene.remove(label);
        if (label.material) {
            if (label.material.map) label.material.map.dispose();
            label.material.dispose();
        }
        if (label.geometry) label.geometry.dispose();
    });
    aircraftLabels.clear();

    // Remove military indicators
    militaryIndicators.forEach(icon => {
        scene.remove(icon);
        if (icon.material) {
            if (icon.material.map) icon.material.map.dispose();
            icon.material.dispose();
        }
        if (icon.geometry) icon.geometry.dispose();
    });
    militaryIndicators.clear();

    // Remove altitude lines
    altitudeLines.forEach(line => {
        scene.remove(line);
        if (line.geometry) line.geometry.dispose();
        if (line.material) line.material.dispose();
    });
    altitudeLines.clear();

    // Remove trails (using Map methods)
    let trailsRemoved = 0;
    trails.forEach(trail => {
        if (trail.line) {
            scene.remove(trail.line);
            if (trail.line.geometry) trail.line.geometry.dispose();
            if (trail.line.material) trail.line.material.dispose();
            trailsRemoved++;
        }
        // Remove Tron curtain if it exists
        if (trail.tronCurtain) {
            scene.remove(trail.tronCurtain);
            if (trail.tronCurtain.geometry) trail.tronCurtain.geometry.dispose();
            if (trail.tronCurtain.material) trail.tronCurtain.material.dispose();
        }
    });
    trails.clear();

    // Remove stale trails (aircraft that disappeared but trails remain visible)
    let staleTrailsRemoved = 0;
    staleTrails.forEach(trail => {
        if (trail.line) {
            scene.remove(trail.line);
            if (trail.line.geometry) trail.line.geometry.dispose();
            if (trail.line.material) trail.line.material.dispose();
            staleTrailsRemoved++;
        }
        // Also remove gap line if it exists
        if (trail.gapLine) {
            scene.remove(trail.gapLine);
            if (trail.gapLine.geometry) trail.gapLine.geometry.dispose();
            if (trail.gapLine.material) trail.gapLine.material.dispose();
        }
        // Remove Tron curtain if it exists
        if (trail.tronCurtain) {
            scene.remove(trail.tronCurtain);
            if (trail.tronCurtain.geometry) trail.tronCurtain.geometry.dispose();
            if (trail.tronCurtain.material) trail.tronCurtain.material.dispose();
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
async function switchToLiveMode() {
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

    // Update URL to reflect live mode
    URLState.updateFromCurrentState();
}

// Switch to historical mode
async function switchToHistoricalMode() {
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

    // Update URL to reflect historical mode (without dates yet - user needs to load data)
    URLState.updateFromCurrentState();
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
    const checkbox = document.getElementById('enable-tron-mode');

    if (!checkbox) {
        // console.log('[TronMode] UI element not found, skipping listener setup');
        return;
    }

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
    const savedRadar = localStorage.getItem('showMiniRadar');
    if (savedRadar !== null) {
        showMiniRadar = savedRadar === 'true';
        const toggleContainer = document.getElementById('toggle-mini-radar-container');
        const miniRadar = document.getElementById('mini-radar');
        if (!showMiniRadar) {
            toggleContainer.classList.remove('active');
            if (miniRadar) miniRadar.style.display = 'none';
        }
    }

    // Load trail fade preferences
    const savedAutoFade = localStorage.getItem('autoFadeTrails');
    if (savedAutoFade !== null) {
        autoFadeTrails = savedAutoFade === 'true';
        const toggleContainer = document.getElementById('toggle-trail-fade-container');
        const fadeSelector = document.getElementById('trail-fade-time-selector');
        if (autoFadeTrails) {
            toggleContainer.classList.add('active');
            if (fadeSelector) fadeSelector.style.display = 'block';
        }
    }

    const savedFadeTime = localStorage.getItem('trailFadeTime');
    if (savedFadeTime !== null) {
        trailFadeTime = parseInt(savedFadeTime);
        const fadeTimeSelect = document.getElementById('trail-fade-time');
        if (fadeTimeSelect) fadeTimeSelect.value = trailFadeTime.toString();
    }

    // Load compass preference
    const savedCompass = localStorage.getItem('showCompass');
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
function init() {
    const canvas = document.getElementById('canvas');

    // Scene
    scene = new THREE.Scene();

    // Create sky with gradient
    createSky();

    // Improved fog for depth perception (reduced density for better long-distance visibility)
    scene.fog = new THREE.FogExp2(CONFIG.sceneFog, 0.0008);

    // Camera
    camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        5000  // Increased from 1000 to allow more zoom out
    );
    // Start facing north (-Z direction) at an angle
    // Camera south of origin (positive Z) looking toward north (negative Z)
    camera.position.set(0, 50, 100);
    camera.lookAt(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

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
    const homeMarkerGroup = new THREE.Group();

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

    scene.add(homeMarkerGroup);

    // Store beacon reference for pulsing animation
    window.homeBeacon = beacon;

    // Mouse controls
    setupMouseControls();

    // Window resize
    window.addEventListener('resize', onWindowResize);

    // Setup UI controls
    setupUIControls();

    // Setup aircraft click interaction
    setupAircraftClick();

    // Hide loading
    document.getElementById('loading').style.display = 'none';

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
}

// Create realistic sky with gradient
function createSky() {
    const skyGeometry = new THREE.SphereGeometry(500, 32, 15);

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

    const canvas = document.getElementById('canvas');

    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        previousMousePosition = { x: e.clientX, y: e.clientY };

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
        wasDragging = isDragging;
        isDragging = false;
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
        cameraDistance = Math.max(20, Math.min(600, cameraDistance + e.deltaY * 0.1));

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

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        touchStartPositions = Array.from(e.touches).map(touch => ({
            x: touch.clientX,
            y: touch.clientY
        }));
        touchStartTime = Date.now();
        touchMoved = false;

        if (e.touches.length === 1) {
            // Single touch - prepare for rotation
            isDragging = true;
            syncCameraAnglesFromPosition();

            // Unlock follow mode if active
            if (followMode && followLocked) {
                followLocked = false;
                updateFollowButtonText();
            }
        } else if (e.touches.length === 2) {
            // Two finger touch - prepare for pinch/zoom
            isDragging = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
            initialCameraDistance = cameraDistance;

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
                cameraDistance = Math.max(20, Math.min(600, initialCameraDistance / scale));

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

        // Capture drag state before resetting
        wasTouchDragging = touchMoved;

        // Detect tap (quick touch without movement)
        const touchDuration = Date.now() - touchStartTime;
        const wasTap = !wasTouchDragging && touchDuration < 300 && touchStartPositions.length === 1;

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
                for (const [hex, mesh] of aircraftMeshes.entries()) {
                    if (mesh === aircraftGroup || mesh.children.includes(tappedObject)) {
                        showAircraftDetail(hex);
                        break;
                    }
                }
            }
        }

        if (e.touches.length === 0) {
            // All fingers lifted
            isDragging = false;
            initialPinchDistance = null;
            initialCameraDistance = null;
            touchStartPositions = [];
            touchMoved = false;
            wasTouchDragging = false;
        } else if (e.touches.length === 1) {
            // One finger remaining - reset for single touch
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

function setupUIControls() {
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
        localStorage.setItem('showMiniRadar', showMiniRadar);
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
        localStorage.setItem('showCompass', showCompass);
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
        localStorage.setItem('autoFadeTrails', autoFadeTrails);
        console.log(`[TrailFade] Auto-fade ${autoFadeTrails ? 'enabled' : 'disabled'}`);

        // Check for conflict with preload time
        validateFadePreloadConflict();
    });

    // Trail fade time dropdown
    document.getElementById('trail-fade-time').addEventListener('change', (e) => {
        trailFadeTime = parseInt(e.target.value);
        localStorage.setItem('trailFadeTime', trailFadeTime);
        console.log(`[TrailFade] Fade time set to ${trailFadeTime === 0 ? 'Never' : trailFadeTime / 60 + ' minutes'}`);

        // Check for conflict with preload time
        validateFadePreloadConflict();
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
    const savedStates = JSON.parse(localStorage.getItem('panelCollapseStates') || '{}');

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
                const states = JSON.parse(localStorage.getItem('panelCollapseStates') || '{}');
                states[panelId] = panel.classList.contains('collapsed');
                localStorage.setItem('panelCollapseStates', JSON.stringify(states));
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
                const states = JSON.parse(localStorage.getItem('panelCollapseStates') || '{}');
                states[panelId] = panel.classList.contains('collapsed');
                localStorage.setItem('panelCollapseStates', JSON.stringify(states));
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

// Route cache management
function getRouteCache() {
    try {
        const cached = localStorage.getItem(ROUTE_CACHE_KEY);
        return cached ? JSON.parse(cached) : {};
    } catch (e) {
        console.warn('Failed to read route cache:', e);
        return {};
    }
}

function setRouteCache(cache) {
    try {
        localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(cache));
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
        }
    } catch (error) {
        fetchErrorCount++;
        console.error(`Error fetching aircraft data (${fetchErrorCount}/${MAX_FETCH_ERRORS}):`, error);

        // Show error in UI if repeated failures
        if (fetchErrorCount >= MAX_FETCH_ERRORS) {
            const infoDiv = document.getElementById('aircraft-count');
            if (infoDiv) {
                infoDiv.textContent = 'Connection Error';
                infoDiv.style.color = '#ff4444';
            }
        }
    }
}

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

            // Update aircraft data BEFORE updateAircraftPosition so vertical indicator has current baro_rate
            mesh.userData = ac;
            mesh.userData.isVeryLow = isVeryLow; // Preserve isVeryLow flag
            mesh.userData.isMilitary = isMilitary; // Update military status
            mesh.userData.militaryInfo = militaryInfo; // Update military info
            mesh.userData.lastValidAltitude = altitude; // Store for altitude smoothing

            // Update color if military status changed
            if (CONFIG.highlightMilitary && isMilitary) {
                mesh.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.color.setHex(CONFIG.militaryColor);
                        child.material.emissive.setHex(CONFIG.militaryColor);
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

        // Update trail
        updateTrail(ac.hex, pos.x, altitude, pos.z);
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

// Create simple 3D sphere for aircraft
function createAircraftModel(color) {
    const group = new THREE.Group();

    const material = new THREE.MeshPhongMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.5,
        shininess: 100
    });

    // Main aircraft sphere
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16), material);
    group.add(sphere);

    return group;
}

function createAircraft(hex, x, y, z, aircraftType, aircraftData, isVeryLow = false) {
    // Check if aircraft is MLAT-positioned
    const isMLAT = aircraftData.mlat && aircraftData.mlat.length > 0;

    // Check if aircraft is military
    const isMilitary = isMilitaryAircraft(hex);
    const militaryInfo = isMilitary ? getMilitaryInfo(hex) : null;

    // Create aircraft sphere with altitude-based or military color
    const aircraftColor = (CONFIG.highlightMilitary && isMilitary) ? CONFIG.militaryColor : getAltitudeColor(y);
    const mesh = createAircraftModel(aircraftColor);
    mesh.position.set(x, y, z);
    mesh.userData = aircraftData;
    mesh.userData.isMLAT = isMLAT;
    mesh.userData.isVeryLow = isVeryLow;
    mesh.userData.isMilitary = isMilitary;
    mesh.userData.militaryInfo = militaryInfo;
    mesh.userData.lastValidAltitude = y; // Store for altitude smoothing

    // Add visual indicator for MLAT aircraft (wireframe overlay)
    if (isMLAT) {
        mesh.traverse((child) => {
            if (child.isMesh && child.material) {
                // Make MLAT aircraft slightly transparent to distinguish them
                child.material.transparent = true;
                child.material.opacity = 0.7;
            }
        });
    }

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

    // Draw text
    context.fillStyle = 'rgba(0, 0, 0, 0.6)';
    context.fillRect(0, 0, canvas.width, canvas.height);

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
            child.material.color.setHex(color);
            child.material.emissive.setHex(color);
        }
    });

    // Update rotation based on track (heading)
    if (mesh.userData.track !== undefined) {
        // Track is in degrees (0=North, 90=East, 180=South, 270=West)
        // In our coordinate system: +X=East, -Z=North, +Y=Up
        // Aircraft models already have fuselages horizontal, pointing along +Z (south) by default
        // So we only need to rotate around Y axis to match the track
        // track=0 (north) needs to point -Z, so rotation.y = PI
        // track=180 (south) needs to point +Z, so rotation.y = 0
        // Formula: rotation.y = PI - trackRad
        const trackRad = mesh.userData.track * Math.PI / 180;
        mesh.rotation.y = Math.PI - trackRad;
    } else {
        // Default orientation if no track data (point north)
        mesh.rotation.y = Math.PI;
    }

    // Reapply highlight if this aircraft is currently hovered on canvas
    if (currentlyHoveredCanvasAircraft === hex) {
        highlightAircraft(hex, true);
    }
}

function updateTrail(hex, x, y, z) {
    const trail = trails.get(hex);
    if (!trail) return;

    trail.positions.push({ x, y, z, timestamp: Date.now() });

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

        // Get color for this altitude
        const altColor = new THREE.Color(getAltitudeColor(pos.y));
        colors[i * 3] = altColor.r;
        colors[i * 3 + 1] = altColor.g;
        colors[i * 3 + 2] = altColor.b;
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

        // Get altitude colors for gradient
        const color1 = new THREE.Color(getAltitudeColor(p1.y));
        const color2 = new THREE.Color(getAltitudeColor(p2.y));
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
    // All with S=88%, L=44%
    const saturation = 88;
    const lightness = 44;
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

function updateUI(data) {
    document.getElementById('aircraft-count').textContent = data.aircraft?.length || 0;

    const now = new Date();
    document.getElementById('last-update').textContent = now.toLocaleTimeString();

    // Update aircraft list
    const listContainer = document.getElementById('aircraft-items');
    listContainer.innerHTML = '';

    // Find highest/fastest/closest BEFORE rendering list
    const validAircraft = (data.aircraft || []).filter(ac => ac.lat && ac.lon && ac.alt_baro);
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

            const callsign = ac.flight?.trim() || ac.hex;
            const type = ac.t || 'Unknown';
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

// Show aircraft detail panel and highlight without moving camera
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

// Highlight/unhighlight aircraft in 3D scene
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
                if (highlight) {
                    // Store original colors
                    if (!child.userData.originalColor) {
                        child.userData.originalColor = child.material.color.clone();
                        child.userData.originalEmissive = child.material.emissive.clone();
                    }
                    // Change to white
                    child.material.color.setHex(0xffffff);
                    child.material.emissive.setHex(0xffffff);
                    child.material.emissiveIntensity = 1.0;
                } else {
                    // Restore original colors
                    if (child.userData.originalColor) {
                        child.material.color.copy(child.userData.originalColor);
                        child.material.emissive.copy(child.userData.originalEmissive);
                    }
                    child.material.emissiveIntensity = 0.5;
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

    // Text
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
        ctx.fillText(line, canvas.width / 2, startY + index * lineHeight);
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

        // Draw smaller dot (2px radius instead of 3px)
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
    });

    // Restore context
    ctx.restore();
}

function animate() {
    requestAnimationFrame(animate);

    // Update sky colors every 60 seconds
    const now = Date.now();
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
        const yawDegrees = yaw * 180 / Math.PI;

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

    // Throttled raycasting check for hover effects (runs at ~60fps max)
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

    // Mouse move for hover effects - throttled with requestAnimationFrame
    canvas.addEventListener('mousemove', (event) => {
        lastMouseEvent = event;

        if (!hoverCheckScheduled) {
            hoverCheckScheduled = true;
            requestAnimationFrame(checkHover);
        }
    });

    canvas.addEventListener('click', (event) => {
        // Ignore clicks that happened after camera dragging
        if (wasDragging) {
            wasDragging = false;
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
                    showAircraftDetail(hex);
                    return;
                }
            }

            // Otherwise, find the parent Group (aircraft) for this clicked mesh
            let aircraftGroup = clickedObject;
            while (aircraftGroup && aircraftGroup.parent && aircraftGroup.parent.type !== 'Scene') {
                aircraftGroup = aircraftGroup.parent;
            }

            // Find the hex for this aircraft group
            for (const [hex, mesh] of aircraftMeshes.entries()) {
                if (mesh === aircraftGroup || mesh.children.includes(clickedObject)) {
                    showAircraftDetail(hex);
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
    let longPressTimer = null;
    let longPressTarget = null;
    const LONG_PRESS_TIME = 500; // milliseconds

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            longPressTimer = setTimeout(() => {
                // Long-press detected
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
                    navigator.vibrate?.(50); // Haptic feedback if supported
                }

                longPressTimer = null;
            }, LONG_PRESS_TIME);
        }
    });

    canvas.addEventListener('touchend', () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });

    canvas.addEventListener('touchmove', () => {
        // Cancel long-press if user moves finger
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });

    // Double-tap to reset camera to home
    let lastTap = 0;
    canvas.addEventListener('touchend', (e) => {
        const now = Date.now();
        const timeSinceLastTap = now - lastTap;

        if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
            // Double-tap detected
            e.preventDefault();
            resetCamera();
            navigator.vibrate?.(100); // Haptic feedback
        }

        lastTap = now;
    });

    console.log('[Mobile] Touch UX enhancements enabled');
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
        const checkbox = document.getElementById('enable-tron-mode');
        if (checkbox) {
            checkbox.checked = true;
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

    document.getElementById('detail-callsign').textContent = callsign;

    // Build detail grid
    const details = [];

    // Add MLAT status at the top if applicable
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
            if (militaryInfo.tail) details.push({ label: 'Military Tail', value: militaryInfo.tail });
            if (militaryInfo.type) details.push({ label: 'Military Type', value: militaryInfo.type });
            if (militaryInfo.description) details.push({ label: 'Description', value: militaryInfo.description });
        }
    }

    // Aircraft info (like tar1090)
    if (data.desc) {
        // Show year + description if available (e.g., "2019 BOEING 757-200")
        const aircraftInfo = data.year ? `${data.year} ${data.desc}` : data.desc;
        details.push({ label: 'Aircraft', value: aircraftInfo });
    }
    if (data.ownOp) details.push({ label: 'Operator', value: data.ownOp });
    if (data.r) details.push({ label: 'Registration', value: data.r });
    if (data.t) details.push({ label: 'Type Code', value: data.t });

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

    const contentHtml = details.map(d =>
        `<div class="detail-label">${d.label}:</div><div class="detail-value">${d.value}</div>`
    ).join('');

    document.getElementById('detail-content').innerHTML = contentHtml +
        '<div id="aircraft-photo-container" style="grid-column: 1 / -1; margin-top: 10px; text-align: center;"></div>';
    panel.style.display = 'block';

    // Show and configure the detail panel Follow button
    const detailFollowBtn = document.getElementById('detail-follow-btn');
    if (detailFollowBtn) {
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
    }

    // Show follow button when aircraft is selected (if it exists)
    const followBtn = document.getElementById('toggle-follow');
    if (followBtn) {
        followBtn.style.display = 'inline-block';
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
