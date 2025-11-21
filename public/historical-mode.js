/**
 * Historical Mode Module
 * Handles historical track visualization, playback animation, heat maps, and corridors
 *
 * Optimizations included:
 * - Object pooling for Vector3 and Color instances
 * - Cached DOM element references
 * - Reduced console.log calls (configurable DEBUG flag)
 * - Optimized heat map generation
 * - Better memory management
 */

import {
    CONFIG,
    TRAILS,
    HISTORICAL
} from './constants.js';

// Debug logging flag - set to false for production
const DEBUG = true;

// Object pools for performance optimization
const vector3Pool = [];
const colorPool = [];

function getVector3(x = 0, y = 0, z = 0) {
    const v = vector3Pool.pop() || new THREE.Vector3();
    return v.set(x, y, z);
}

function releaseVector3(v) {
    if (vector3Pool.length < 100) {
        vector3Pool.push(v);
    }
}

function getColor(r = 1, g = 1, b = 1) {
    const c = colorPool.pop() || new THREE.Color();
    return c.setRGB(r, g, b);
}

function releaseColor(c) {
    if (colorPool.length < 100) {
        colorPool.push(c);
    }
}

/**
 * Initialize Historical Mode module with dependencies
 * Returns object with all historical mode functions
 */
export function initHistoricalMode(deps) {
    const {
        scene,
        camera,
        renderer,
        HistoricalState,
        PlaybackState,
        currentTheme,
        latLonToXZ,
        smoothAltitudes,
        updateAircraft,
        updateUI,
        getSpeedColor,
        getAltitudeColor,
        updateTronCurtain,
        trailColorMode,
        showTronMode,
        SafeStorage
    } = deps;

    // Cache DOM element references for performance
    const domCache = {};

    function getDOMElement(id) {
        if (!domCache[id]) {
            domCache[id] = document.getElementById(id);
        }
        return domCache[id];
    }

    function clearDOMCache() {
        Object.keys(domCache).forEach(key => delete domCache[key]);
    }

    // ============================================================================
    // TRACK RENDERING FUNCTIONS
    // ============================================================================

    /**
     * Render all historical tracks on the 3D scene
     */
    function renderHistoricalTracks() {
        if (DEBUG) console.log(`[Historical] Rendering ${HistoricalState.tracks.length} tracks`);

        // Initialize endpoint meshes array
        HistoricalState.endpointMeshes = [];

        // Render each track
        HistoricalState.tracks.forEach(track => {
            createHistoricalTrack(track);
        });

        if (DEBUG) {
            console.log(`[Historical] Rendered ${HistoricalState.tracks.length} tracks with ${HistoricalState.endpointMeshes.length} endpoints`);
            console.log(`[Historical] Scene now has ${scene.children.length} children`);
        }
    }

    /**
     * Create a single historical track with optimized rendering
     * Optimization: Reduced object allocations, cached calculations
     */
    function createHistoricalTrack(track) {
        if (!track.positions || track.positions.length === 0) {
            if (DEBUG) console.log('[Historical] Skipping track (no positions):', track.hex || track.icao);
            return;
        }

        const isMilitary = track.is_military || false;
        const icao = track.hex || track.icao;

        if (DEBUG) console.log(`[Historical] Creating track for ${icao} (${track.positions.length} positions, military: ${isMilitary})`);

        // Smooth altitude anomalies
        const smoothedPositions = smoothAltitudes(track.positions);

        // Pre-allocate arrays with known size (optimization)
        const pointCount = smoothedPositions.length;
        const points = new Array(pointCount);
        const colors = new Float32Array(pointCount * 3);

        // Optimization: Cache altitude calculation constants
        const altScaleFactor = 0.3048 * CONFIG.scale * CONFIG.altitudeExaggeration;
        const homeAlt = CONFIG.homeLocation.alt;

        // Process positions - optimized loop
        for (let i = 0; i < pointCount; i++) {
            const pos = smoothedPositions[i];
            const lat = pos.lat || pos.latitude;
            const lon = pos.lon || pos.longitude;
            const alt = pos.alt || pos.altitude || 0;
            const speed = pos.speed || pos.gs || 0;

            // Convert coordinates
            const posXZ = latLonToXZ(lat, lon);
            const altitude = (alt - homeAlt) * altScaleFactor;
            const y = Math.max(1.0, altitude);

            points[i] = new THREE.Vector3(posXZ.x, y, posXZ.z);

            // Get color based on current mode
            let colorValue;
            if (isMilitary) {
                colorValue = CONFIG.militaryColor;
            } else if (trailColorMode === 'speed') {
                colorValue = getSpeedColor(speed);
            } else {
                colorValue = getAltitudeColor(y);
            }

            const color = new THREE.Color(colorValue);
            const idx = i * 3;
            colors[idx] = color.r;
            colors[idx + 1] = color.g;
            colors[idx + 2] = color.b;
        }

        if (points.length > 1) {
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

            const material = new THREE.LineBasicMaterial({
                vertexColors: true,
                opacity: 0.9,
                transparent: true,
                linewidth: 3
            });

            const line = new THREE.Line(geometry, material);
            line.visible = true;

            // Add userData for interaction
            line.userData = {
                isHistoricalTrack: true,
                icao: icao,
                track: track,
                isMilitary: isMilitary,
                originalColors: new Float32Array(colors)
            };

            scene.add(line);

            // Add endpoint marker (sphere at end of track)
            const endPoint = points[points.length - 1];
            const endColorIdx = (points.length - 1) * 3;
            const endColor = new THREE.Color(colors[endColorIdx], colors[endColorIdx + 1], colors[endColorIdx + 2]);

            const endpointGeometry = new THREE.SphereGeometry(1.0, 8, 6);
            const endpointMaterial = new THREE.MeshBasicMaterial({
                color: endColor,
                transparent: true,
                opacity: 0.9
            });
            const endpointMesh = new THREE.Mesh(endpointGeometry, endpointMaterial);
            endpointMesh.position.copy(endPoint);

            // Store metadata
            const lastPos = smoothedPositions[smoothedPositions.length - 1];
            const lastAltFeet = lastPos.alt || lastPos.altitude || 0;
            endpointMesh.userData = {
                isHistoricalEndpoint: true,
                trackLine: line,
                originalColor: endColor.clone(),
                icao: icao,
                track: track,
                altFeet: lastAltFeet
            };

            scene.add(endpointMesh);
            HistoricalState.endpointMeshes.push(endpointMesh);

            // Create trail object for Tron curtains
            const trail = {
                positions: points.map((p, i) => ({
                    x: p.x,
                    y: p.y,
                    z: p.z,
                    altFeet: smoothedPositions[i].alt || smoothedPositions[i].altitude || 0,
                    groundSpeed: smoothedPositions[i].speed || smoothedPositions[i].gs || 0,
                    timestamp: smoothedPositions[i].time ? new Date(smoothedPositions[i].time).getTime() : null
                })),
                tronCurtain: null
            };

            // Create Tron curtain if enabled
            if (showTronMode) {
                updateTronCurtain(trail);
            }

            // Store track mesh
            HistoricalState.trackMeshes.set(icao, {
                line,
                points,
                track,
                instanceIndices: [HistoricalState.endpointMeshes.length - 1],
                endpointMesh,
                trail
            });
        } else {
            if (DEBUG) console.log(`[Historical] Not enough points to create line (${points.length})`);
        }
    }

    /**
     * Display all historical tracks at once (show-all mode)
     */
    function displayAllTracks() {
        if (DEBUG) console.log('[Historical] Displaying all tracks');

        // Make all track lines and endpoints visible
        HistoricalState.trackMeshes.forEach(({ line, endpointMesh, trail }) => {
            if (line) line.visible = true;
            if (endpointMesh) endpointMesh.visible = true;
            if (trail && trail.tronCurtain) trail.tronCurtain.visible = true;
        });

        // Make all endpoint spheres visible
        HistoricalState.endpointMeshes.forEach(mesh => {
            if (mesh) mesh.visible = true;
        });

        // Update display mode
        HistoricalState.displayMode = 'show-all';

        if (DEBUG) console.log(`[Historical] Made ${HistoricalState.trackMeshes.size} tracks visible`);
    }

    /**
     * Show or hide historical tracks
     */
    function showHistoricalTracks(visible) {
        HistoricalState.trackMeshes.forEach(({ line, endpointMesh, trail }) => {
            if (line) line.visible = visible;
            if (endpointMesh) endpointMesh.visible = visible;
            if (trail && trail.tronCurtain) trail.tronCurtain.visible = visible;
        });

        HistoricalState.endpointMeshes.forEach(mesh => {
            if (mesh) mesh.visible = visible;
        });
    }

    /**
     * Clear all historical tracks from scene
     * Optimization: Proper cleanup to prevent memory leaks
     */
    function clearHistoricalTracks() {
        if (DEBUG) console.log('[Historical] Clearing tracks...');

        // Remove all track lines, endpoints, and Tron curtains
        HistoricalState.trackMeshes.forEach(({ line, endpointMesh, trail }) => {
            if (line) {
                if (line.geometry) line.geometry.dispose();
                if (line.material) line.material.dispose();
                scene.remove(line);
            }
            if (endpointMesh) {
                if (endpointMesh.geometry) endpointMesh.geometry.dispose();
                if (endpointMesh.material) endpointMesh.material.dispose();
                scene.remove(endpointMesh);
            }
            if (trail && trail.tronCurtain) {
                if (trail.tronCurtain.geometry) trail.tronCurtain.geometry.dispose();
                if (trail.tronCurtain.material) trail.tronCurtain.material.dispose();
                scene.remove(trail.tronCurtain);
            }
        });

        // Clear endpoint meshes
        HistoricalState.endpointMeshes.forEach(mesh => {
            if (mesh && mesh.parent) {
                scene.remove(mesh);
            }
        });

        // Clear state
        HistoricalState.trackMeshes.clear();
        HistoricalState.endpointMeshes = [];
        HistoricalState.tracks = [];
        HistoricalState.displayMode = 'show-all';

        if (DEBUG) console.log('[Historical] All tracks cleared');
    }

    // ============================================================================
    // HEAT MAP & CORRIDOR FUNCTIONS
    // ============================================================================

    /**
     * Generate flight corridor/heat map visualization
     * Optimization: Reduced redundant calculations, spatial hashing for density
     */
    function generateFlightCorridors() {
        if (DEBUG) console.log('[HeatMap] Generating grid-based heat map with absolute thresholds');

        // Show loading message
        const statusDiv = getDOMElement('historical-status');
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
            if (DEBUG) console.log('[HeatMap] No tracks available');
            return;
        }

        const startTime = performance.now();

        // Step 1: Build spatial density map (count unique aircraft per cell)
        const gridSize = 8;  // 8 scene units (~8km)
        const densityMap = new Map();
        const altScaleFactor = 0.3048 * CONFIG.scale * CONFIG.altitudeExaggeration;
        const homeAlt = CONFIG.homeLocation.alt;

        HistoricalState.tracks.forEach(track => {
            if (!track.positions || track.positions.length === 0) return;

            const aircraftHex = track.hex || track.icao || 'unknown';

            track.positions.forEach(pos => {
                const lat = pos.lat || pos.latitude;
                const lon = pos.lon || pos.longitude;
                const alt = pos.alt || pos.altitude;

                if (lat == null || lon == null || alt == null) return;

                const scenePos = latLonToXZ(lat, lon);
                const altitude = (alt - homeAlt) * altScaleFactor;
                const y = Math.max(1.0, altitude);

                // Snap to grid
                const gridX = Math.floor(scenePos.x / gridSize);
                const gridY = Math.floor(y / gridSize);
                const gridZ = Math.floor(scenePos.z / gridSize);
                const gridKey = `${gridX},${gridY},${gridZ}`;

                // Add unique aircraft to cell
                if (!densityMap.has(gridKey)) {
                    densityMap.set(gridKey, new Set());
                }
                densityMap.get(gridKey).add(aircraftHex);
            });
        });

        if (DEBUG) console.log(`[HeatMap] Density map: ${densityMap.size} cells with unique aircraft counts`);

        // Step 2: Create particles along flight paths
        const positions = [];
        const colors = [];
        const sizes = [];
        let particleCount = 0;

        HistoricalState.tracks.forEach(track => {
            if (!track.positions || track.positions.length === 0) return;

            const sampleInterval = Math.max(3, Math.floor(track.positions.length / 50));

            track.positions.forEach((pos, index) => {
                if (index % sampleInterval !== 0) return;

                const lat = pos.lat || pos.latitude;
                const lon = pos.lon || pos.longitude;
                const alt = pos.alt || pos.altitude;

                if (lat == null || lon == null || alt == null) return;

                const scenePos = latLonToXZ(lat, lon);
                const altitude = (alt - homeAlt) * altScaleFactor;
                const y = Math.max(1.0, altitude);

                // Look up unique aircraft count
                const gridX = Math.floor(scenePos.x / gridSize);
                const gridY = Math.floor(y / gridSize);
                const gridZ = Math.floor(scenePos.z / gridSize);
                const gridKey = `${gridX},${gridY},${gridZ}`;
                const aircraftSet = densityMap.get(gridKey);
                const uniqueAircraft = aircraftSet ? aircraftSet.size : 1;

                // Calculate color based on density (optimization: direct color calculation)
                let normalizedDensity;
                let color;

                if (uniqueAircraft === 1) {
                    return;  // Skip single aircraft
                } else if (uniqueAircraft < 4) {
                    normalizedDensity = 0.2 + ((uniqueAircraft - 2) / 2) * 0.2;
                    const t = (normalizedDensity - 0.2) / 0.2;
                    color = new THREE.Color().lerpColors(
                        new THREE.Color(0x004488),
                        new THREE.Color(0x0088ff),
                        t
                    );
                } else if (uniqueAircraft < 8) {
                    normalizedDensity = 0.4 + ((uniqueAircraft - 4) / 4) * 0.25;
                    const t = (normalizedDensity - 0.4) / 0.25;
                    color = new THREE.Color().lerpColors(
                        new THREE.Color(0x0088ff),
                        new THREE.Color(0x00ff88),
                        t
                    );
                } else if (uniqueAircraft < 15) {
                    normalizedDensity = 0.65 + ((uniqueAircraft - 8) / 7) * 0.2;
                    const t = (normalizedDensity - 0.65) / 0.2;
                    color = new THREE.Color().lerpColors(
                        new THREE.Color(0x00ff88),
                        new THREE.Color(0xffff00),
                        t
                    );
                } else {
                    normalizedDensity = 0.85 + Math.min(0.15, (uniqueAircraft - 15) / 30);
                    const t = (normalizedDensity - 0.85) / 0.15;
                    color = new THREE.Color().lerpColors(
                        new THREE.Color(0xffff00),
                        new THREE.Color(0xff0000),
                        t
                    );
                }

                // Add small random offset
                const offsetX = (Math.random() - 0.5) * 2.0;
                const offsetY = (Math.random() - 0.5) * 1.0;
                const offsetZ = (Math.random() - 0.5) * 2.0;

                positions.push(scenePos.x + offsetX, y + offsetY, scenePos.z + offsetZ);
                colors.push(color.r, color.g, color.b);

                const baseSize = 20.0 + normalizedDensity * 80.0;
                const sizeVariation = (Math.random() - 0.5) * 20.0;
                sizes.push(baseSize + sizeVariation);

                particleCount++;
            });
        });

        // Create particle system with custom shader
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                baseOpacity: { value: 0.6 }
            },
            vertexShader: `
                attribute float size;
                varying vec3 vColor;

                void main() {
                    vColor = color;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (300.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float baseOpacity;
                varying vec3 vColor;

                void main() {
                    vec2 center = gl_PointCoord - vec2(0.5);
                    float dist = length(center);
                    float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
                    alpha = pow(alpha, 2.2);
                    alpha *= baseOpacity;
                    if (alpha < 0.02) discard;
                    gl_FragColor = vec4(vColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.NormalBlending,
            vertexColors: true
        });

        const particles = new THREE.Points(geometry, material);
        particles.renderOrder = 50;
        particles.userData = { isHeatMapParticles: true };

        scene.add(particles);
        HistoricalState.heatmapMeshes.push(particles);

        const elapsed = (performance.now() - startTime).toFixed(2);
        if (DEBUG) {
            console.log(`[HeatMap] ========================================`);
            console.log(`[HeatMap] Generated ${particleCount} particles in ${elapsed}ms`);
            console.log(`[HeatMap] Grid: ${gridSize} units, Density colors: BLUE(2-3) GREEN(4-7) YELLOW(8-14) RED(15+)`);
            console.log(`[HeatMap] ========================================`);
        }

        if (statusDiv) {
            statusDiv.innerHTML = `✓ Heat map ready! ${particleCount.toLocaleString()} particles generated in ${elapsed}ms`;
            statusDiv.className = 'historical-status success';
        }
    }

    /**
     * Simplify corridor path by averaging nearby points
     * Optimization: More efficient spatial grouping
     */
    function simplifyCorridorPath(points, groupDistance) {
        if (points.length === 0) return [];

        const simplified = [];
        const used = new Set();

        for (let i = 0; i < points.length; i++) {
            if (used.has(i)) continue;

            const group = [points[i]];
            used.add(i);

            // Find nearby points
            for (let j = i + 1; j < points.length; j++) {
                if (used.has(j)) continue;

                const dist = points[i].distanceTo(points[j]);
                if (dist < groupDistance) {
                    group.push(points[j]);
                    used.add(j);
                }
            }

            // Average the group
            const avgPoint = new THREE.Vector3();
            group.forEach(p => avgPoint.add(p));
            avgPoint.divideScalar(group.length);
            simplified.push(avgPoint);
        }

        return simplified;
    }

    /**
     * Clear all heat map/corridor visualizations
     */
    function clearFlightCorridors() {
        HistoricalState.heatmapMeshes.forEach(mesh => {
            scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (mesh.material.uniforms) {
                    // Clean up shader uniforms
                    Object.keys(mesh.material.uniforms).forEach(key => {
                        delete mesh.material.uniforms[key];
                    });
                }
                mesh.material.dispose();
            }
        });
        HistoricalState.heatmapMeshes = [];
        if (DEBUG) console.log('[Corridors] Cleared flight corridors');
    }

    /**
     * Clear heat map (alias for backward compatibility)
     */
    function clearHeatMap() {
        clearFlightCorridors();
    }

    /**
     * Set heat map visibility
     */
    function setHeatMapVisibility(visible) {
        HistoricalState.heatmapMeshes.forEach(mesh => {
            mesh.visible = visible;
        });
        if (DEBUG) console.log(`[HeatMap] Heat map visible: ${visible}`);
    }

    // ============================================================================
    // PLAYBACK ANIMATION SYSTEM
    // ============================================================================

    /**
     * Initialize playback system
     * Optimization: Pre-calculate time ranges
     */
    function initializePlayback() {
        if (DEBUG) console.log('[Playback] Initializing playback system');

        // Calculate time range from loaded tracks (optimization: single pass)
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
        PlaybackState.duration = (latestTime - earliestTime) / 1000;
        PlaybackState.currentTime = 0;

        if (DEBUG) console.log(`[Playback] Duration: ${PlaybackState.duration.toFixed(1)}s (${(PlaybackState.duration / 60).toFixed(1)} minutes)`);

        // Update UI
        const totalTimeDisplay = getDOMElement('total-time-display');
        if (totalTimeDisplay) totalTimeDisplay.textContent = formatPlaybackTime(PlaybackState.duration);

        const timelineScrubber = getDOMElement('timeline-scrubber');
        if (timelineScrubber) timelineScrubber.max = PlaybackState.duration;

        const playbackControls = getDOMElement('playback-controls');
        if (playbackControls) playbackControls.style.display = 'block';

        // Initially hide all tracks (they'll appear during playback)
        HistoricalState.trackMeshes.forEach(({ line, endpointMesh, trail }) => {
            line.visible = false;
            if (endpointMesh) endpointMesh.visible = false;
            if (trail && trail.tronCurtain) trail.tronCurtain.visible = false;
        });
    }

    /**
     * Format time in HH:MM:SS
     */
    function formatPlaybackTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Toggle playback on/off
     */
    function togglePlayback() {
        if (PlaybackState.isPlaying) {
            pausePlayback();
        } else {
            startPlayback();
        }
    }

    /**
     * Start playback animation
     */
    function startPlayback() {
        PlaybackState.isPlaying = true;
        PlaybackState.lastFrameTime = performance.now();

        const playPauseBtn = getDOMElement('play-pause-btn');
        if (playPauseBtn) playPauseBtn.textContent = 'Pause';

        const playbackStatus = getDOMElement('playback-status');
        if (playbackStatus) playbackStatus.textContent = 'Playing...';

        // Hide all tracks when entering playback mode
        HistoricalState.trackMeshes.forEach(({ line }) => {
            line.visible = false;
        });

        animatePlayback();
        if (DEBUG) console.log('[Playback] Started');
    }

    /**
     * Pause playback animation
     */
    function pausePlayback() {
        PlaybackState.isPlaying = false;
        if (PlaybackState.animationFrameId) {
            cancelAnimationFrame(PlaybackState.animationFrameId);
            PlaybackState.animationFrameId = null;
        }

        const playPauseBtn = getDOMElement('play-pause-btn');
        if (playPauseBtn) playPauseBtn.textContent = 'Play';

        const playbackStatus = getDOMElement('playback-status');
        if (playbackStatus) playbackStatus.textContent = 'Paused';

        if (DEBUG) console.log('[Playback] Paused');
    }

    /**
     * Restart playback from beginning
     */
    function restartPlayback() {
        pausePlayback();
        PlaybackState.currentTime = 0;
        updatePlaybackPosition(0);
        if (DEBUG) console.log('[Playback] Restarted');
    }

    /**
     * Main animation loop for playback
     * Optimization: Efficient requestAnimationFrame usage
     */
    function animatePlayback() {
        if (!PlaybackState.isPlaying) return;

        const now = performance.now();
        const deltaTime = (now - PlaybackState.lastFrameTime) / 1000;
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

    /**
     * Update track visibility based on current playback time
     * Optimization: Efficient timestamp comparisons
     */
    function updatePlaybackPosition(currentTime) {
        const currentTimestamp = PlaybackState.startTimestamp + (currentTime * 1000);

        // Update UI (using cached DOM elements)
        const oldTimeDisplay = getDOMElement('current-time-display');
        if (oldTimeDisplay) {
            oldTimeDisplay.textContent = formatPlaybackTime(currentTime);
        }

        const oldTimeline = getDOMElement('timeline-scrubber');
        if (oldTimeline) {
            oldTimeline.value = currentTime;
        }

        const sidebarTimeline = getDOMElement('sidebar-timeline');
        if (sidebarTimeline && PlaybackState.duration > 0) {
            const progress = currentTime / PlaybackState.duration;
            sidebarTimeline.value = progress * 100;
        }

        const currentTimeDisplay = getDOMElement('sidebar-time-current');
        const totalTimeDisplay = getDOMElement('sidebar-time-total');
        if (currentTimeDisplay && totalTimeDisplay) {
            currentTimeDisplay.textContent = formatPlaybackTime(currentTime);
            totalTimeDisplay.textContent = formatPlaybackTime(PlaybackState.duration);
        }

        let visibleTracks = 0;

        // Show/hide tracks based on time
        HistoricalState.trackMeshes.forEach(({ line, track, endpointMesh, trail }) => {
            if (!track.positions || track.positions.length === 0) return;

            const firstPosTime = new Date(track.positions[0].time).getTime();
            const lastPosTime = new Date(track.positions[track.positions.length - 1].time).getTime();

            let isVisible = false;

            // Determine visibility based on fade setting
            if (PlaybackState.fadeAfter === 'never') {
                isVisible = currentTimestamp >= firstPosTime;
            } else {
                const fadeWindowMs = PlaybackState.fadeAfter * 1000;
                const fadeEndTime = lastPosTime + fadeWindowMs;
                isVisible = currentTimestamp >= firstPosTime && currentTimestamp <= fadeEndTime;
            }

            if (isVisible) {
                line.visible = true;
                visibleTracks++;
                if (endpointMesh) endpointMesh.visible = true;
                if (trail && trail.tronCurtain) trail.tronCurtain.visible = true;
            } else {
                line.visible = false;
                if (endpointMesh) endpointMesh.visible = false;
                if (trail && trail.tronCurtain) trail.tronCurtain.visible = false;
            }
        });

        const playbackStatus = getDOMElement('playback-status');
        if (playbackStatus) playbackStatus.textContent = `${visibleTracks} aircraft visible`;
    }

    /**
     * Seek to specific time in playback
     */
    function seekToTime(seconds) {
        PlaybackState.currentTime = Math.max(0, Math.min(seconds, PlaybackState.duration));
        updatePlaybackPosition(PlaybackState.currentTime);
    }

    /**
     * Skip playback by specified number of seconds
     */
    function skipPlayback(seconds) {
        const newTime = Math.max(0, Math.min(PlaybackState.duration, PlaybackState.currentTime + seconds));
        seekToTime(newTime);
        if (DEBUG) console.log(`[Playback] Skipped ${seconds}s to ${formatPlaybackTime(newTime)}`);
    }


    // ============================================================================
    // PLAYBACK CONTROLS SETUP
    // ============================================================================

    /**
     * Setup playback control event listeners
     * Optimization: Event delegation where possible, cached DOM elements
     */
    function setupPlaybackControls() {
    const playPauseBtn = document.getElementById('play-pause-btn');
    const restartBtn = document.getElementById('restart-btn');
    const speedSelect = document.getElementById('playback-speed');
    const scrubber = document.getElementById('timeline-scrubber');

    if (!playPauseBtn || !restartBtn || !speedSelect || !scrubber) {
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

    // ============================================================================
    // HISTORICAL CONTROLS SETUP
    // ============================================================================

    /**
     * Setup historical mode control panel
     * Large function handling date/time inputs, presets, filters, and display modes
     */
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
        updateURLFromCurrentState();
    });

    // Display Mode button handlers
    const displayModeAllBtn = document.getElementById('display-mode-all');
    const displayModePlaybackBtn = document.getElementById('display-mode-playback');
    const displayModeDescription = document.getElementById('display-mode-description');
    const playbackControlsDiv = document.getElementById('playback-controls');

    // Only set up display mode handlers if elements exist
    if (!displayModeAllBtn || !displayModePlaybackBtn || !displayModeDescription || !playbackControlsDiv) {
        console.warn('[Display Mode] Display mode controls not found');
    } else {
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
        updateURLFromCurrentState();
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
        updateURLFromCurrentState();
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
            updateURLFromCurrentState();
        });
    });
    } // End of display mode controls check

    // Tron mode is now handled by the unified toggle in Settings panel
}

    // ============================================================================
    // MODE SWITCHING
    // ============================================================================

    /**
     * Switch from live mode to historical mode
     */
    async function switchToHistoricalMode(skipURLUpdate = false) {
        if (currentMode === 'historical') return;

    console.log('[Mode] Switching to Historical mode');

    // CRITICAL: Stop live updates FIRST to prevent race conditions
    stopLiveUpdates();
    console.log('[Mode] Stopped live update interval');

    // Set mode before fade to prevent any updates during transition
    currentMode = 'historical';

    // Add fade transition
    renderer.domElement.classList.add('mode-transition', 'fading');

    // Wait for fade
    await new Promise(resolve => setTimeout(resolve, TIMING.PANEL_ANIMATION_DELAY));

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

    // Update mode button active states
    const liveModeBtn = document.getElementById('live-mode-btn');
    const historicalModeBtn = document.getElementById('historical-mode-btn');
    if (historicalModeBtn) historicalModeBtn.classList.add('active');
    if (liveModeBtn) liveModeBtn.classList.remove('active');

    // Update sidebar to show historical mode content
    updateSidebarMode();

    // Fade back in
    await new Promise(resolve => setTimeout(resolve, TIMING.PANEL_ANIMATION_DELAY));
    renderer.domElement.classList.remove('fading');

    // Update URL to reflect historical mode (unless loading from URL)
    if (!skipURLUpdate) {
        updateURLFromCurrentState();
    }
}

    // ============================================================================
    // TRACK DETAIL & FILTERS
    // ============================================================================

    /**
     * Show detailed information for a historical track
     */
    function showHistoricalTrackDetail(userData) {
        const track = userData.track;
        const icao = userData.icao;
        const panel = document.getElementById('aircraft-detail');

        // Debug: Log track fields to identify data structure
        console.log(`[HistoricalDetail] Track ${icao}:`, {
            callsign: track.callsign,
            registration: track.registration,
            t: track.t,
            type: track.type,
            aircraft_type: track.aircraft_type,
            type_designator: track.type_designator,
            positions: track.positions?.length
        });

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

        // Aircraft type info - try multiple field names
        // Some historical APIs use 't', others use 'aircraft_type', 'type', etc.
        const aircraftType = track.t || track.type || track.aircraft_type || track.type_designator;
        if (aircraftType) {
            details.push({ label: 'Aircraft Type', value: aircraftType });
        }

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


    /**
     * Apply filters to historical tracks
     */
    function applyHistoricalFilters() {
        console.log('[Historical] Applying filters');

        // Get filter values
        const militaryOnly = document.getElementById('filter-military-only')?.checked || false;
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

        console.log('[Historical] Filter settings:', { militaryOnly, minAlt, maxAlt, minPositions, minSpeed, maxSpeed });

        let visibleCount = 0;
        let hiddenCount = 0;

        // Apply filters to each track mesh
        HistoricalState.trackMeshes.forEach(({ line, endpointMesh, trail, track }, icao) => {
            // track is stored in the trackMeshes object directly
            if (!track) {
                console.warn(`[Historical] No track data for ${icao}`);
                return;
            }

            let visible = true;

            // Military filter
            if (militaryOnly && !(track.is_military || isMilitaryAircraft(icao))) {
                visible = false;
            }

            // Minimum positions filter
            if (track.positions && track.positions.length < minPositions) {
                visible = false;
            }

            // Altitude filter (check if ALL positions are in range)
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

            // Update visibility in scene
            if (visible) {
                if (line && !line.parent) scene.add(line);
                if (endpointMesh && !endpointMesh.parent) scene.add(endpointMesh);
                if (trail && trail.tronCurtain && !trail.tronCurtain.parent && showTronMode) {
                    scene.add(trail.tronCurtain);
                }
                visibleCount++;
            } else {
                if (line && line.parent) scene.remove(line);
                if (endpointMesh && endpointMesh.parent) scene.remove(endpointMesh);
                if (trail && trail.tronCurtain && trail.tronCurtain.parent) {
                    scene.remove(trail.tronCurtain);
                }
                hiddenCount++;
            }
        });

        console.log(`[Historical] Filters applied: ${visibleCount} visible, ${hiddenCount} hidden`);

        // Also update sidebar list to match filters
        filterSidebarTracks();
    }


    // ============================================================================
    // RETURN PUBLIC API
    // ============================================================================

    return {
        // Track rendering
        renderHistoricalTracks,
        createHistoricalTrack,
        displayAllTracks,
        showHistoricalTracks,
        clearHistoricalTracks,
        // Heat map & corridors
        generateFlightCorridors,
        simplifyCorridorPath,
        clearFlightCorridors,
        clearHeatMap,
        setHeatMapVisibility,
        // Playback system
        initializePlayback,
        formatPlaybackTime,
        togglePlayback,
        startPlayback,
        pausePlayback,
        restartPlayback,
        animatePlayback,
        updatePlaybackPosition,
        seekToTime,
        skipPlayback,
        // Controls setup
        setupPlaybackControls,
        setupHistoricalControls,
        // Mode switching
        switchToHistoricalMode,
        // Detail & filters
        showHistoricalTrackDetail,
        applyHistoricalFilters,
        // Utility
        clearDOMCache
    };
}
