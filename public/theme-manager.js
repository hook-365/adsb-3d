// ============================================================================
// THEME MANAGER MODULE
// ============================================================================
// Manages theme presets and dynamic theme switching for the ADSB 3D app
// Self-contained module with no external dependencies (except SafeStorage)

// ============================================================================
// THEME DEFINITIONS
// ============================================================================
// All available theme presets with colors and styles

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
// PUBLIC API
// ============================================================================

/**
 * Apply a theme to the application
 * @param {string} themeName - Name of theme from THEMES object
 * @param {Object} [sceneRef] - Optional Three.js scene reference for dynamic updates
 * @param {Object} [configRef] - Optional CONFIG reference for scene colors
 */
export function applyTheme(themeName, sceneRef = null, configRef = null) {
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
    if (typeof SafeStorage !== 'undefined' && SafeStorage.setItem('adsb3d-theme', themeName)) {
        console.log(`[Theme] Saved preference: ${themeName}`);
    }

    // Trigger scene updates if scene exists (for dynamic theme switching)
    if (sceneRef && configRef) {
        updateSceneColors(sceneRef, configRef);
    }
}

/**
 * Update Three.js scene colors after theme change
 * This forces re-evaluation of CONFIG getters
 * @param {Object} scene - Three.js scene reference
 * @param {Object} CONFIG - CONFIG object reference
 */
export function updateSceneColors(scene, CONFIG) {
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
export function getCurrentTheme() {
    if (typeof SafeStorage !== 'undefined') {
        const saved = SafeStorage.getItem('adsb3d-theme');
        if (saved && THEMES[saved]) {
            return saved;
        }
    }
    return 'modern'; // Default theme
}

/**
 * Initialize theme system on page load
 * @param {Object} [sceneRef] - Optional Three.js scene reference
 * @param {Object} [configRef] - Optional CONFIG reference
 */
export function initializeTheme(sceneRef = null, configRef = null) {
    const currentTheme = getCurrentTheme();
    console.log(`[Theme] Initializing with theme: ${currentTheme}`);
    applyTheme(currentTheme, sceneRef, configRef);
}

/**
 * Get all available themes
 * @returns {Object} THEMES object
 */
export function getThemes() {
    return THEMES;
}

/**
 * Get a specific theme by name
 * @param {string} themeName - Name of theme
 * @returns {Object|null} Theme object or null if not found
 */
export function getTheme(themeName) {
    return THEMES[themeName] || null;
}

// Expose ThemeManager globally for smoke tests and backward compatibility
window.ThemeManager = {
    applyTheme,
    updateSceneColors,
    getCurrentTheme,
    initializeTheme,
    getThemes,
    getTheme
};
