import React, {useState, useEffect, useRef} from 'react';
import axios from 'axios';
import {formatTime, calculateElapsedTime, calculateTotalDuration} from '../utils/timeUtils';
import { 
    createAnimationTimeline, 
    AnimationTimeline, 
    InterpolatedFrame,
    Position 
} from '../utils/interpolationUtils';

interface SimulationStatus {
    running: boolean;
    currentIndex?: number;
    totalPoints?: number;
    progress?: number;
}

interface SensorData {
    latitude: number;
    longitude: number;
    altitude: number;
    timestamp: number;
    speed: number;
    heading?: number;
}

interface ControlsProps {
    profileIds: string[];
    onSimulationPosition?: (profileId: string, index: number) => void;
    routePointsByProfile: { [id: string]: SensorData[] };
    profilesById: { [id: string]: { duration: number } };
}

const Controls: React.FC<ControlsProps> = ({profileIds, onSimulationPosition, routePointsByProfile, profilesById}) => {
    const [statuses, setStatuses] = useState<{ [id: string]: SimulationStatus }>({});
    const wsRefs = useRef<{ [id: string]: WebSocket | null }>({});
    const intervalRefs = useRef<{ [id: string]: ReturnType<typeof setTimeout> | null }>({});
    const currentIndexRefs = useRef<{ [id: string]: number }>({});
    
    // Store animation timelines for each profile
    const animationTimelines = useRef<{ [profileId: string]: AnimationTimeline }>({});
    const animationFrameRefs = useRef<{ [profileId: string]: number }>({});

    // Get prediction service WebSocket URL from environment variables
    const getWebSocketURL = () => {
        const gatewayPort = (import.meta as any).env.VITE_API_GATEWAY_PORT || '80';
        if (window.location.hostname !== 'localhost') {
            return `ws://${window.location.hostname}:${gatewayPort}/ws/predict`;
        }
        return (import.meta as any).env.VITE_PREDICTION_WS_URL || `ws://localhost:${gatewayPort}/ws/predict`;
    };

    const PREDICTION_WS_URL = getWebSocketURL();

    // Poll simulation status less frequently to avoid 429 errors - only for backend sync
    useEffect(() => {
        const intervals: ReturnType<typeof setInterval>[] = [];
        profileIds.forEach(profileId => {
            if (!profileId) return;
            const interval = setInterval(async () => {
                try {
                    const res = await axios.get(`/api/simulation/${profileId}/status`);
                    const newStatus = res.data;

                    // Update status state
                    setStatuses(prev => ({...prev, [profileId]: newStatus}));

                    // Check if simulation is complete
                    if (newStatus.currentIndex >= newStatus.totalPoints && !newStatus.running) {
                        console.log(`Simulation completed for profile ${profileId}. Stopping polling and WebSocket.`);

                        // Clear the polling interval for this profile
                        clearInterval(interval);

                        // Close WebSocket connection
                        if (wsRefs.current[profileId]) {
                            wsRefs.current[profileId]!.close();
                            wsRefs.current[profileId] = null;
                        }

                        // Clear any pending timeouts
                        if (intervalRefs.current[profileId]) {
                            clearTimeout(intervalRefs.current[profileId]!);
                            intervalRefs.current[profileId] = null;
                        }

                        return; // Stop further polling for this profile
                    }

                    // Don't override WebSocket-driven position updates here
                    // Only sync if WebSocket is not active or behind
                    const wsIndex = currentIndexRefs.current[profileId] || 0;
                    const statusIndex = newStatus.currentIndex || 0;

                    // Only update if backend is ahead (WebSocket stopped or failed)
                    if (statusIndex > wsIndex) {
                        currentIndexRefs.current[profileId] = statusIndex;
                        if (onSimulationPosition) {
                            onSimulationPosition(profileId, statusIndex);
                        }
                    }
                } catch (error) {
                    console.debug('Status polling error for profile', profileId, ':', error);
                }
            }, 10000); // Reduced frequency to 10 seconds - only for sync, not animation
            intervals.push(interval);
        });
        return () => intervals.forEach(clearInterval);
    }, [profileIds, onSimulationPosition]);

    // Create WebSocket connection to prediction service
    const createWebSocketConnection = (profileId: string) => {
        if (!profileId) return null;

        const ws = new WebSocket(PREDICTION_WS_URL);

        ws.onopen = () => {
            console.log('Connected to prediction service WebSocket for profile:', profileId);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Received prediction data:', data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        ws.onclose = () => {
            console.log('WebSocket connection closed for profile:', profileId);
        };

        return ws;
    };

    const sendSimulationDataWithTiming = (profileId: string) => {
        const ws = wsRefs.current[profileId];
        const points = routePointsByProfile[profileId] || [];
        let idx = currentIndexRefs.current[profileId] || 0;
        if (!ws || !profileId || idx >= points.length) return;

        const sendNext = () => {
            if (!ws || idx >= points.length) return;
            const currentPoint = points[idx];
            if (!currentPoint) return;

            try {
                const message = JSON.stringify({profileId, ...currentPoint, timestamp: Date.now()});
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(message);
                }
            } catch {
            }

            idx++;
            currentIndexRefs.current[profileId] = idx;

            // Update UI immediately for fluent animation
            if (onSimulationPosition) {
                onSimulationPosition(profileId, idx);
            }

            // Force UI update for smooth status bar animation
            setStatuses(prev => ({
                ...prev,
                [profileId]: {
                    ...prev[profileId],
                    currentIndex: idx,
                    totalPoints: points.length,
                    progress: (idx / points.length) * 100,
                    running: idx < points.length
                }
            }));

            if (idx < points.length) {
                // Use real timestamp differences for authentic simulation timing
                const currentTimestamp = currentPoint.timestamp;
                const nextPoint = points[idx];

                if (nextPoint) {
                    // Calculate time difference in milliseconds
                    const currentTimeNs = typeof currentTimestamp === 'string' ? parseInt(currentTimestamp) : currentTimestamp;
                    const nextTimeNs = typeof nextPoint.timestamp === 'string' ? parseInt(nextPoint.timestamp) : nextPoint.timestamp;

                    // Convert nanoseconds to milliseconds for setTimeout
                    let timeDiffMs = (nextTimeNs - currentTimeNs) / 1e6;

                    // Clamp the timing to reasonable bounds (min 100ms, max 5000ms)
                    timeDiffMs = Math.max(100, Math.min(timeDiffMs, 5000));

                    console.debug(`Real timing for ${profileId}: ${timeDiffMs}ms between points ${idx - 1} and ${idx}`);
                    intervalRefs.current[profileId] = setTimeout(sendNext, timeDiffMs);
                } else {
                    // Fallback to 1 second if no next point
                    intervalRefs.current[profileId] = setTimeout(sendNext, 1000);
                }
            } else {
                // Simulation completed
                console.log(`WebSocket simulation completed for profile ${profileId}`);
                setStatuses(prev => ({
                    ...prev,
                    [profileId]: {
                        ...prev[profileId],
                        currentIndex: idx,
                        totalPoints: points.length,
                        progress: 100,
                        running: false
                    }
                }));
            }
        };
        sendNext();
    };

    /**
     * Creates smooth interpolated animation for a profile using real GPS data timing
     * Sends interpolated positions to WebSocket every 200ms for fluid movement
     * @param profileId - Unique identifier for the simulation profile
     */
    const startInterpolatedAnimation = (profileId: string) => {
        const ws = wsRefs.current[profileId];
        const points = routePointsByProfile[profileId] || [];
        
        if (!ws || !profileId || points.length < 2) {
            console.warn(`Cannot start interpolated animation for ${profileId}: insufficient data`);
            return;
        }

        // Convert route points to Position format for interpolation
        const positions: Position[] = points.map(point => ({
            latitude: point.latitude,
            longitude: point.longitude,
            altitude: point.altitude,
            timestamp: point.timestamp,
            speed: point.speed,
            heading: point.heading
        }));

        // Create animation timeline with 200ms frame intervals
        const timeline = createAnimationTimeline(positions, {
            frameInterval: 200,
            speedMultiplier: 1.0, // Real-time speed
            minFrameTime: 100,
            maxFrameTime: 1000
        });

        animationTimelines.current[profileId] = timeline;
        animationFrameRefs.current[profileId] = 0;

        console.log(`Starting interpolated animation for ${profileId}: ${timeline.frames.length} frames, ${timeline.totalDuration}ms total`);

        /**
         * Processes the next frame in the animation sequence
         * Updates UI and sends WebSocket data at 200ms intervals
         */
        const processNextFrame = () => {
            const frameIndex = animationFrameRefs.current[profileId];
            const currentTimeline = animationTimelines.current[profileId];
            
            if (!currentTimeline || frameIndex >= currentTimeline.frames.length) {
                // Animation completed
                console.log(`Interpolated animation completed for profile ${profileId}`);
                setStatuses(prev => ({
                    ...prev,
                    [profileId]: {
                        ...prev[profileId],
                        currentIndex: points.length,
                        totalPoints: points.length,
                        progress: 100,
                        running: false
                    }
                }));
                return;
            }

            const frame = currentTimeline.frames[frameIndex];
            const interpolatedPos = frame.position;

            // Send interpolated position to WebSocket
            try {
                const message = JSON.stringify({
                    profileId,
                    latitude: interpolatedPos.latitude,
                    longitude: interpolatedPos.longitude,
                    altitude: interpolatedPos.altitude,
                    timestamp: Date.now(),
                    speed: interpolatedPos.speed || 0,
                    heading: interpolatedPos.heading || 0
                });

                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(message);
                    console.debug(`Sent interpolated frame ${frameIndex}/${currentTimeline.frames.length} for ${profileId}`);
                }
            } catch (error) {
                console.error(`Error sending interpolated data for ${profileId}:`, error);
            }

            // Update UI with smooth progress
            const originalPointIndex = Math.floor((frameIndex / currentTimeline.frames.length) * points.length);
            const smoothProgress = frameIndex / currentTimeline.frames.length;

            // Update map position - use frame index for smooth movement
            if (onSimulationPosition) {
                onSimulationPosition(profileId, frameIndex);
            }

            // Update status with smooth progress
            setStatuses(prev => ({
                ...prev,
                [profileId]: {
                    ...prev[profileId],
                    currentIndex: originalPointIndex,
                    totalPoints: points.length,
                    progress: smoothProgress * 100,
                    running: true
                }
            }));

            // Schedule next frame
            animationFrameRefs.current[profileId] = frameIndex + 1;
            intervalRefs.current[profileId] = setTimeout(processNextFrame, 200); // 200ms intervals
        };

        // Start the animation
        processNextFrame();
    };

    const start = async () => {
        for (const profileId of profileIds) {
            try {
                // Start simulation state management on backend
                await axios.post(`/api/simulation/${profileId}/start`);

                // Create WebSocket connection to prediction service
                wsRefs.current[profileId] = createWebSocketConnection(profileId);

                // Wait for WebSocket to connect before starting data transmission
                if (wsRefs.current[profileId]) {
                    wsRefs.current[profileId]!.onopen = () => {
                        console.log('WebSocket connected, starting data transmission');
                        currentIndexRefs.current[profileId] = 0;

                        // Start sending data every second
                        sendSimulationDataWithTiming(profileId);
                    };
                }
            } catch {
            }
        }
    };

    const stop = () => {
        profileIds.forEach(profileId => {
            if (intervalRefs.current[profileId]) clearTimeout(intervalRefs.current[profileId]!);
            if (wsRefs.current[profileId]) wsRefs.current[profileId]!.close();
        });
    };

    const reset = async () => {
        // Stop all current animations and connections
        stop();

        // Reset all indices to 0
        profileIds.forEach(profileId => {
            currentIndexRefs.current[profileId] = 0;
            wsRefs.current[profileId] = null;
            intervalRefs.current[profileId] = null;
        });

        // Reset status state
        setStatuses({});

        // Reset simulation positions on map
        profileIds.forEach(profileId => {
            if (onSimulationPosition) {
                onSimulationPosition(profileId, 0);
            }
        });

        // Reset backend simulation state
        for (const profileId of profileIds) {
            try {
                await axios.post(`/api/simulation/${profileId}/reset`);
                console.log(`Reset simulation for profile ${profileId}`);
            } catch (error) {
                console.debug('Reset error for profile', profileId, ':', error);
            }
        }

        console.log('Simulation reset completed');
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            profileIds.forEach(profileId => {
                if (wsRefs.current[profileId]) {
                    wsRefs.current[profileId].close();
                }
                if (intervalRefs.current[profileId]) {
                    clearInterval(intervalRefs.current[profileId]);
                }
            });
        };
    }, []);

    return (
        <div>
            <button onClick={start} disabled={profileIds.length === 0}>Simulation starten</button>
            <button onClick={stop} disabled={profileIds.length === 0}>Simulation stoppen</button>
            <button onClick={reset} disabled={profileIds.length === 0}>Simulation zurücksetzen</button>
            <div style={{marginTop: 16}}>
                {profileIds.map(profileId => {
                    const points = routePointsByProfile[profileId] || [];
                    const status = statuses[profileId];

                    // Use frontend points length as source of truth for total points
                    // Backend totalPoints might be incorrect or include extra metadata
                    const actualTotalPoints = points.length;
                    const currentIndex = status?.currentIndex ?? currentIndexRefs.current[profileId] ?? 0;
                    const progress = actualTotalPoints > 0 ? currentIndex / actualTotalPoints : 0;

                    // Calculate time using utility functions with better error handling
                    const elapsed = calculateElapsedTime(points, currentIndex);
                    const totalDuration = calculateTotalDuration(points);

                    // Use calculated duration from actual route points
                    const duration = totalDuration;

                    // Debug logging for timestamp analysis
                    if (points.length > 0) {
                        console.debug(`Profile ${profileId}:`, {
                            pointsLength: points.length,
                            backendTotalPoints: status?.totalPoints,
                            currentIndex,
                            firstTimestamp: points[0]?.timestamp,
                            lastTimestamp: points[points.length - 1]?.timestamp,
                            elapsed,
                            totalDuration
                        });
                    }

                    // Debug logging for data discrepancy analysis
                    if (points.length > 0) {
                        console.debug(`Profile ${profileId} data analysis:`, {
                            frontendPointsLength: points.length, // Original route data (should be 31)
                            backendTotalPoints: status?.totalPoints, // Backend processed points (28)
                            currentIndex,
                            firstTimestamp: points[0]?.timestamp,
                            lastTimestamp: points[points.length - 1]?.timestamp,
                            elapsed,
                            totalDuration,
                            dataDiscrepancy: points.length !== status?.totalPoints
                        });
                    }

                    // Debug-Ausgaben für Ladezustand
                    if (points.length < 2) {
                        console.debug('Profil', profileId, 'zeigt "Wird geladen..." an, points.length:', points.length, points);
                        return (
                            <div key={profileId}
                                 style={{marginBottom: 16, padding: 8, border: '1px solid #eee', borderRadius: 4}}>
                                <strong>Profil {profileId.slice(0, 8)}</strong><br/>
                                <span style={{color: '#888'}}>Wird geladen...</span>
                            </div>
                        );
                    }

                    return (
                        <div key={profileId}
                             style={{marginBottom: 16, padding: 8, border: '1px solid #eee', borderRadius: 4}}>
                            <strong>Profil {profileId.slice(0, 8)}</strong><br/>
                            Status: {status?.running ? 'Läuft' : 'Gestoppt'}<br/>
                            <div style={{display: 'flex', alignItems: 'center', margin: '8px 0'}}>
                                <div style={{
                                    flex: 1,
                                    height: 18,
                                    background: '#eee',
                                    borderRadius: 8,
                                    overflow: 'hidden',
                                    marginRight: 8
                                }}>
                                    <div style={{
                                        width: `${progress * 100}%`,
                                        height: '100%',
                                        background: '#4caf50',
                                        transition: 'width 0.3s'
                                    }}></div>
                                </div>
                                <span style={{
                                    minWidth: 80,
                                    fontSize: 13
                                }}>{currentIndex} / {actualTotalPoints} Punkte</span>
                            </div>
                            <div style={{fontSize: 13, color: '#555'}}>
                                Zeit: {formatTime(elapsed)} / {formatTime(duration)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default Controls;
