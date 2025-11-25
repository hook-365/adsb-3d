/**
 * Camera & Rendering Module
 * Handles all camera controls, mouse/touch interactions, and the main rendering loop
 *
 * Phase 7 of app.js refactoring - extracted camera and rendering functions
 */

/**
 * Initialize Camera & Rendering module with dependencies
 * Returns object with all camera and rendering functions
 * @param {Object} deps - Dependencies from app.js
 * @returns {Object} Public API for camera & rendering functions
 */
export function initCameraRendering(deps) {
    const {
        // Three.js core
        scene,
        camera,
        renderer,
        THREE,
        // State objects (modified directly by this module)
        CameraState,
        FollowState,
        TrailConfig,
        // Collections
        aircraftMeshes,
        staleTrails,
        // Config
        CONFIG,
        TIMING,
        // Selected aircraft access
        getSelectedAircraft,
        setSelectedAircraft,
        // Functions
        updateSkyColors,
        updateSidebarMiniRadar,
        updateSidebarHeading,
        updateFollowButtonText,
        hideUnfollowButton,
        showAircraftContextMenu,
        showAircraftDetail,
        selectAircraft
    } = deps;

    // ============================================================================
    // CAMERA POSITION & ANGLE MANAGEMENT
    // ============================================================================

    /**
     * Sync camera angles from current camera position (for smooth transition to free orbit)
     */
    function syncCameraAnglesFromPosition() {
        const centerPoint = FollowState.mode && FollowState.hex ?
            aircraftMeshes.get(FollowState.hex)?.position : new THREE.Vector3(0, 0, 0);

        if (!centerPoint) return;

        // Calculate relative position
        const relativePos = camera.position.clone().sub(centerPoint);

        // Calculate distance
        CameraState.distance = relativePos.length();

        // Calculate angles (must match updateCameraPosition formula)
        const horizontalDist = Math.sqrt(relativePos.x * relativePos.x + relativePos.z * relativePos.z);
        CameraState.angleY = Math.atan2(horizontalDist, relativePos.y);
        CameraState.angleX = Math.atan2(relativePos.z, relativePos.x);
    }

    /**
     * Update camera position based on current angles and distance
     */
    function updateCameraPosition(centerPoint = new THREE.Vector3(0, 0, 0)) {
        const x = centerPoint.x + CameraState.distance * Math.sin(CameraState.angleY) * Math.cos(CameraState.angleX);
        const y = centerPoint.y + CameraState.distance * Math.cos(CameraState.angleY);
        const z = centerPoint.z + CameraState.distance * Math.sin(CameraState.angleY) * Math.sin(CameraState.angleX);

        camera.position.set(x, y, z);
        camera.lookAt(centerPoint);
    }

    // ============================================================================
    // MOUSE CONTROLS
    // ============================================================================

    function setupMouseControls() {
        let previousMousePosition = { x: 0, y: 0 };
        let mouseDownPosition = { x: 0, y: 0 };
        let actuallyDragged = false;

        const canvas = document.getElementById('canvas');

        canvas.addEventListener('mousedown', (e) => {
            CameraState.isDragging = true;
            actuallyDragged = false;
            previousMousePosition = { x: e.clientX, y: e.clientY };
            mouseDownPosition = { x: e.clientX, y: e.clientY };

            syncCameraAnglesFromPosition();

            if (FollowState.mode && FollowState.locked) {
                FollowState.locked = false;
                updateFollowButtonText();
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (CameraState.isDragging) {
                const deltaX = e.clientX - previousMousePosition.x;
                const deltaY = e.clientY - previousMousePosition.y;

                const totalDeltaX = e.clientX - mouseDownPosition.x;
                const totalDeltaY = e.clientY - mouseDownPosition.y;
                const totalDistance = Math.sqrt(totalDeltaX * totalDeltaX + totalDeltaY * totalDeltaY);

                if (totalDistance > 5) {
                    actuallyDragged = true;
                }

                CameraState.angleX += deltaX * 0.005;
                CameraState.angleY = Math.max(0.1, Math.min(Math.PI / 2, CameraState.angleY - deltaY * 0.005));

                if (!FollowState.mode || !FollowState.locked) {
                    const followTarget = FollowState.mode && FollowState.hex ?
                        aircraftMeshes.get(FollowState.hex)?.position : new THREE.Vector3(0, 0, 0);
                    updateCameraPosition(followTarget);
                }

                previousMousePosition = { x: e.clientX, y: e.clientY };
            }
        });

        canvas.addEventListener('mouseup', () => {
            CameraState.wasDragging = actuallyDragged;
            CameraState.isDragging = false;
            actuallyDragged = false;
        });

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();

            syncCameraAnglesFromPosition();

            if (FollowState.mode && FollowState.locked) {
                FollowState.locked = false;
                updateFollowButtonText();
            }

            CameraState.distance = Math.max(10, Math.min(1200, CameraState.distance + e.deltaY * 0.1));

            if (!FollowState.mode || !FollowState.locked) {
                const followTarget = FollowState.mode && FollowState.hex ?
                    aircraftMeshes.get(FollowState.hex)?.position : new THREE.Vector3(0, 0, 0);
                updateCameraPosition(followTarget);
            }
        });

        setupTouchControls(canvas);
    }

    // ============================================================================
    // TOUCH CONTROLS (MOBILE)
    // ============================================================================

    function setupTouchControls(canvas) {
        let touchStartPositions = [];
        let initialPinchDistance = null;
        let initialCameraDistance = null;
        let touchStartTime = 0;
        let touchMoved = false;
        let wasTouchDragging = false;

        let longPressTimer = null;
        let lastTapTime = 0;
        const LONG_PRESS_TIME = 500;
        const DOUBLE_TAP_TIME = 300;

        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            touchStartPositions = Array.from(e.touches).map(touch => ({
                x: touch.clientX,
                y: touch.clientY
            }));
            touchStartTime = Date.now();
            touchMoved = false;

            if (e.touches.length === 1) {
                CameraState.isDragging = true;
                syncCameraAnglesFromPosition();

                longPressTimer = setTimeout(() => {
                    const touch = e.touches[0];
                    const raycaster = new THREE.Raycaster();
                    const mouse = new THREE.Vector2();

                    mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
                    mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;

                    raycaster.setFromCamera(mouse, camera);
                    const intersects = raycaster.intersectObjects(scene.children, true);

                    if (intersects.length > 0) {
                        showAircraftContextMenu(touch.clientX, touch.clientY, intersects[0]);
                    }

                    longPressTimer = null;
                }, LONG_PRESS_TIME);

                if (FollowState.mode && FollowState.locked) {
                    FollowState.locked = false;
                    updateFollowButtonText();
                }
            } else if (e.touches.length === 2) {
                CameraState.isDragging = false;

                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }

                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
                initialCameraDistance = CameraState.distance;

                if (FollowState.mode && FollowState.locked) {
                    FollowState.locked = false;
                    updateFollowButtonText();
                }
            }
        });

        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();

            // Only consider it "moved" if finger moved more than 10 pixels (tap tolerance)
            if (touchStartPositions.length > 0 && e.touches.length > 0) {
                const dx = e.touches[0].clientX - touchStartPositions[0].x;
                const dy = e.touches[0].clientY - touchStartPositions[0].y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance > 10) {
                    touchMoved = true;
                }
            }

            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }

            if (e.touches.length === 1) {
                if (CameraState.isDragging && touchStartPositions.length > 0) {
                    wasTouchDragging = true;
                    const deltaX = e.touches[0].clientX - touchStartPositions[0].x;
                    const deltaY = e.touches[0].clientY - touchStartPositions[0].y;

                    CameraState.angleX += deltaX * 0.005;
                    CameraState.angleY = Math.max(0.1, Math.min(Math.PI / 2, CameraState.angleY - deltaY * 0.005));

                    if (!FollowState.mode || !FollowState.locked) {
                        const followTarget = FollowState.mode && FollowState.hex ?
                            aircraftMeshes.get(FollowState.hex)?.position : new THREE.Vector3(0, 0, 0);
                        updateCameraPosition(followTarget);
                    }

                    touchStartPositions = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
                }
            } else if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const currentDistance = Math.sqrt(dx * dx + dy * dy);

                if (initialPinchDistance !== null) {
                    const scale = currentDistance / initialPinchDistance;
                    CameraState.distance = Math.max(10, Math.min(1200, initialCameraDistance / scale));

                    if (!FollowState.mode || !FollowState.locked) {
                        const followTarget = FollowState.mode && FollowState.hex ?
                            aircraftMeshes.get(FollowState.hex)?.position : new THREE.Vector3(0, 0, 0);
                        updateCameraPosition(followTarget);
                    }
                }
            }
        });

        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();

            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }

            const touchDuration = Date.now() - touchStartTime;
            const now = Date.now();

            // Capture drag state before checking for tap
            const wasTap = !touchMoved && touchDuration < 300;

            if (e.changedTouches.length === 1 && wasTap) {
                if (now - lastTapTime < DOUBLE_TAP_TIME) {
                    resetCamera();
                    lastTapTime = 0;
                } else {
                    const touch = e.changedTouches[0];
                    const raycaster = new THREE.Raycaster();
                    const mouse = new THREE.Vector2();

                    // Use canvas bounds for accurate touch coordinates
                    const rect = canvas.getBoundingClientRect();
                    mouse.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
                    mouse.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;

                    raycaster.setFromCamera(mouse, camera);

                    // Raycast against aircraft meshes
                    const aircraftArray = Array.from(aircraftMeshes.values());
                    const intersects = raycaster.intersectObjects(aircraftArray, true);

                    if (intersects.length > 0) {
                        const tappedObject = intersects[0].object;

                        // Find the hex - check tapped object and all ancestors
                        for (const [hex, mesh] of aircraftMeshes.entries()) {
                            if (mesh === tappedObject ||
                                mesh.children.includes(tappedObject) ||
                                tappedObject.parent === mesh) {
                                selectAircraft(hex);
                                break;
                            }
                        }
                    }

                    lastTapTime = now;
                }
            }

            if (e.touches.length === 0) {
                CameraState.isDragging = false;
                initialPinchDistance = null;
                initialCameraDistance = null;
                wasTouchDragging = false;
            }

            touchStartPositions = [];
        });
    }

    // ============================================================================
    // CAMERA CONTROL FUNCTIONS
    // ============================================================================

    function resetCamera() {
        CameraState.angleX = 0;
        CameraState.angleY = Math.PI / 6;
        CameraState.distance = 100;

        updateCameraPosition(new THREE.Vector3(0, 0, 0));

        FollowState.mode = false;
        FollowState.hex = null;

        const followBtn = document.getElementById('toggle-follow');
        if (followBtn) {
            followBtn.style.display = 'none';
        }
        hideUnfollowButton();

        document.getElementById('aircraft-detail').style.display = 'none';
        setSelectedAircraft(null);

        updateFollowButtonText();
    }

    function animateCameraToPosition(targetPosition, targetLookAt, duration = 1500, onComplete = null) {
        const startPosition = camera.position.clone();
        const startTime = Date.now();

        const currentLookAt = new THREE.Vector3();
        camera.getWorldDirection(currentLookAt);
        currentLookAt.multiplyScalar(100).add(camera.position);

        function animate() {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            const eased = progress < 0.5
                ? 2 * progress * progress
                : -1 + (4 - 2 * progress) * progress;

            camera.position.lerpVectors(startPosition, targetPosition, eased);

            const interpolatedLookAt = new THREE.Vector3().lerpVectors(currentLookAt, targetLookAt, eased);
            camera.lookAt(interpolatedLookAt);

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                camera.position.copy(targetPosition);
                camera.lookAt(targetLookAt);
                if (onComplete) onComplete();
            }
        }

        animate();
    }

    function focusOnAircraft(hex) {
        const aircraft = aircraftMeshes.get(hex.toLowerCase());
        if (!aircraft) return;

        const targetPos = aircraft.position.clone();
        const cameraOffset = new THREE.Vector3(30, 20, 30);
        const cameraPos = targetPos.clone().add(cameraOffset);

        animateCameraToPosition(cameraPos, targetPos, 1000, () => {
            syncCameraAnglesFromPosition();
        });
    }

    function focusOnTrack(hex) {
        const targetPos = new THREE.Vector3(0, 10, 0);
        const cameraOffset = new THREE.Vector3(30, 20, 30);
        const cameraPos = targetPos.clone().add(cameraOffset);

        animateCameraToPosition(cameraPos, targetPos, 1000, () => {
            syncCameraAnglesFromPosition();
        });
    }

    // ============================================================================
    // MAIN RENDER LOOP
    // ============================================================================

    function animate() {
        requestAnimationFrame(animate);

        const now = Date.now();
        const deltaTime = now - CameraState.lastFrameTime;

        if (deltaTime < CameraState.frameInterval) {
            return;
        }

        CameraState.lastFrameTime = now - (deltaTime % CameraState.frameInterval);

        if (now - CameraState.lastSkyUpdate > 60000) {
            updateSkyColors();
            CameraState.lastSkyUpdate = now;
        }

        if (now - CameraState.lastStaleTrailCleanup > 60000) {
            const thirtyMinutes = 30 * 60 * 1000;

            staleTrails.forEach((trail, hex) => {
                let fadeTimeMs;
                if (!TrailConfig.autoFade || TrailConfig.fadeTime === 0) {
                    fadeTimeMs = thirtyMinutes;
                } else if (TrailConfig.fadeTime === -1) {
                    fadeTimeMs = 0;
                } else {
                    fadeTimeMs = TrailConfig.fadeTime * 1000;
                }

                if (now - trail.lastUpdate > fadeTimeMs) {
                    scene.remove(trail.line);
                    if (trail.gapLine) scene.remove(trail.gapLine);
                    if (trail.tronCurtain) scene.remove(trail.tronCurtain);

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

                    staleTrails.delete(hex);
                }
            });
            CameraState.lastStaleTrailCleanup = now;
        }

        if (window.homeBeacon) {
            const time = Date.now() * 0.002;
            const intensity = 0.5 + Math.sin(time) * 0.5;
            window.homeBeacon.material.emissiveIntensity = intensity;
        }

        if (camera && CONFIG && CONFIG.homeLocation) {
            updateSidebarMiniRadar();
            updateSidebarHeading();
        }

        if (FollowState.mode && FollowState.hex) {
            const aircraft = aircraftMeshes.get(FollowState.hex);

            if (aircraft) {
                const targetPos = aircraft.position.clone();

                if (FollowState.locked) {
                    const track = aircraft.userData.track || 0;
                    const trackRad = track * Math.PI / 180;

                    const distanceBehind = 50;
                    const heightAbove = 30;

                    const offsetX = -Math.sin(trackRad) * distanceBehind;
                    const offsetZ = Math.cos(trackRad) * distanceBehind;
                    const offset = new THREE.Vector3(offsetX, heightAbove, offsetZ);

                    const cameraTarget = targetPos.clone().add(offset);

                    camera.position.lerp(cameraTarget, 0.2);
                    camera.lookAt(targetPos);
                } else {
                    updateCameraPosition(targetPos);
                }

                FollowState.returnInProgress = false;
            } else {
                FollowState.mode = false;
                FollowState.hex = null;
                const followBtn = document.getElementById('toggle-follow');
                if (followBtn) {
                    followBtn.style.display = 'none';
                }
                hideUnfollowButton();
                document.getElementById('aircraft-detail').style.display = 'none';
                setSelectedAircraft(null);

                const url = new URL(window.location);
                url.searchParams.delete('icao');
                window.history.replaceState({}, '', url);

                const homePos = new THREE.Vector3(0, 50, 100);
                const homeLookAt = new THREE.Vector3(0, 0, 0);

                animateCameraToPosition(homePos, homeLookAt, 1000, () => {
                    CameraState.angleX = 0;
                    CameraState.angleY = Math.PI / 6;
                    CameraState.distance = 100;
                });

                updateFollowButtonText();
            }
        }

        if (FollowState.returnInProgress) {
            const homePos = new THREE.Vector3(0, 50, 100);
            const homeLookAt = new THREE.Vector3(0, 0, 0);

            camera.position.lerp(homePos, 0.02);

            const currentLookAt = new THREE.Vector3();
            camera.getWorldDirection(currentLookAt);
            currentLookAt.multiplyScalar(100).add(camera.position);

            const targetDirection = homeLookAt.clone().sub(camera.position).normalize();
            const currentDirection = currentLookAt.clone().sub(camera.position).normalize();

            currentDirection.lerp(targetDirection, 0.02);
            const newLookAt = camera.position.clone().add(currentDirection.multiplyScalar(100));
            camera.lookAt(newLookAt);

            if (camera.position.distanceTo(homePos) < 1) {
                camera.position.copy(homePos);
                camera.lookAt(homeLookAt);
                FollowState.returnInProgress = false;
            }
        }

        renderer.render(scene, camera);
    }

    // ============================================================================
    // WINDOW RESIZE
    // ============================================================================

    function updateRendererSize() {
        const isLocked = document.body.classList.contains('sidebar-locked');
        const sidebar = document.getElementById('unified-sidebar');
        const sidebarWidth = sidebar ? parseInt(getComputedStyle(sidebar).width, 10) : 320;

        let width, height;

        if (isLocked) {
            width = window.innerWidth - sidebarWidth;
            height = window.innerHeight;
        } else {
            width = window.innerWidth;
            height = window.innerHeight;
        }

        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }

    function onWindowResize() {
        updateRendererSize();
    }

    // ============================================================================
    // RETURN PUBLIC API
    // ============================================================================

    return {
        syncCameraAnglesFromPosition,
        updateCameraPosition,
        setupMouseControls,
        setupTouchControls,
        resetCamera,
        animateCameraToPosition,
        focusOnAircraft,
        focusOnTrack,
        animate,
        updateRendererSize,
        onWindowResize
    };
}
