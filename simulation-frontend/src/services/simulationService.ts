import axios from 'axios';
import {
    Profile,
    DataPoint,
    SimulationConfig,
    SimulationState,
    ProfileSimulationState,
    ObjectMetric,
    SimulationResults,
    Object3D
} from '../types/simulation';
import { DataCollector } from './dataCollector';

export class SimulationService {
    private dataCollector: DataCollector;
    private simulationState: SimulationState | null = null;
    private simulationIntervalId: number | null = null;
    private profileWebSockets: Map<string, WebSocket> = new Map();
    private downloadedObjects: Set<string> = new Set(); // Global cache for downloaded objects
    private availableObjects: Object3D[] = []; // Cache of all 3D objects for distance calculation

    constructor() {
        this.dataCollector = new DataCollector();
    }

    /**
     * Sets the available 3D objects for distance-based detection
     */
    setAvailableObjects(objects: Object3D[]): void {
        this.availableObjects = objects;
    }

    /**
     * Starts a new real-time simulation with the given configuration
     */
    async startSimulation(config: SimulationConfig): Promise<string> {
        if (this.simulationState?.isRunning) {
            throw new Error('Simulation is already running');
        }

        const simulationId = this.generateSimulationId();
        console.log(`Starting ${config.optimized ? 'optimized' : 'unoptimized'} simulation: ${simulationId}`);

        // Clear previous data
        this.downloadedObjects.clear();
        this.profileWebSockets.clear();

        // Calculate the earliest start time across all profiles for synchronized playback
        const allStartTimes = config.profiles
            .filter(p => p.data.length > 0)
            .map(p => Math.min(...p.data.map(d => d.timestamp)));

        const earliestStartTime = allStartTimes.length > 0 ? Math.min(...allStartTimes) : Date.now();
        const simulationStartTime = Date.now();

        // Initialize simulation state
        this.simulationState = {
            isRunning: true,
            currentTime: simulationStartTime,
            startTime: simulationStartTime,
            profileStates: {}
        };

        // Initialize profile states and WebSocket connections for optimized mode
        for (const profile of config.profiles) {
            if (profile.data.length === 0) continue;

            // Sort profile data by timestamp
            const sortedData = [...profile.data].sort((a, b) => a.timestamp - b.timestamp);

            const profileState: ProfileSimulationState = {
                profileId: profile.id,
                currentIndex: 0,
                downloadedObjects: [],
                metrics: []
            };

            if (config.optimized) {
                await this.establishWebSocketConnection(profile.id, profile.name);
            }

            this.simulationState.profileStates[profile.id] = profileState;
        }

        // Start real-time simulation loop
        this.startRealTimeSimulation(config, earliestStartTime, simulationStartTime);

        return simulationId;
    }

    /**
     * Stops the current simulation and returns results
     */
    async stopSimulation(): Promise<SimulationResults | null> {
        if (!this.simulationState) {
            return null;
        }

        console.log('Stopping simulation...');

        // Stop simulation loop
        if (this.simulationIntervalId) {
            clearInterval(this.simulationIntervalId);
            this.simulationIntervalId = null;
        }

        // Close all WebSocket connections
        this.profileWebSockets.forEach((ws, profileId) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
                console.log(`Closed WebSocket for profile: ${profileId}`);
            }
        });
        this.profileWebSockets.clear();

        const results = this.collectSimulationResults();
        await this.dataCollector.saveResults(results);

        this.simulationState = null;
        return results;
    }

    /**
     * Gets the current simulation state
     */
    getSimulationState(): SimulationState | null {
        return this.simulationState ? { ...this.simulationState } : null;
    }

    /**
     * Establishes WebSocket connection for a specific profile
     */
    private async establishWebSocketConnection(profileId: string, profileName: string): Promise<void> {
        return new Promise((resolve) => {
            const wsUrl = 'ws://localhost/ws/predict';
            const ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log(`WebSocket connected for profile: ${profileName} (${profileId})`);
                this.profileWebSockets.set(profileId, ws);
                resolve();
            };

            ws.onmessage = async (event) => {
                try {
                    const objectIds: string[] = JSON.parse(event.data);
                    await this.processObjectIds(objectIds, profileId);
                } catch (error) {
                    console.error(`Error processing WebSocket message for ${profileName}:`, error);
                }
            };

            ws.onerror = (error) => {
                console.error(`WebSocket error for profile ${profileName}:`, error);
                console.warn(`Continuing simulation for ${profileName} without WebSocket`);
                resolve();
            };

            ws.onclose = () => {
                console.log(`WebSocket closed for profile: ${profileName}`);
                this.profileWebSockets.delete(profileId);
            };

            // Connection timeout
            setTimeout(() => {
                if (ws.readyState === WebSocket.CONNECTING) {
                    console.warn(`WebSocket connection timeout for ${profileName}`);
                    ws.close();
                    resolve();
                }
            }, 5000);
        });
    }

    /**
     * Starts the real-time simulation loop that respects original timing exactly
     */
    private startRealTimeSimulation(
        config: SimulationConfig,
        earliestStartTime: number,
        simulationStartTime: number
    ): void {
        // Prepare profile timing data
        const profileTimings = new Map<string, {
            profile: Profile;
            sortedData: DataPoint[];
            startTime: number;
            endTime: number;
            currentSegmentIndex: number;
            lastUpdateTime: number;
        }>();

        // Initialize timing data for each profile
        config.profiles.forEach(profile => {
            if (profile.data.length < 1) return;

            const sortedData = [...profile.data].sort((a, b) => a.timestamp - b.timestamp);
            profileTimings.set(profile.id, {
                profile,
                sortedData,
                startTime: sortedData[0].timestamp,
                endTime: sortedData[sortedData.length - 1].timestamp,
                currentSegmentIndex: 0,
                lastUpdateTime: simulationStartTime
            });
        });

        // Main simulation loop - runs at the specified interval
        this.simulationIntervalId = window.setInterval(async () => {
            if (!this.simulationState?.isRunning) {
                if (this.simulationIntervalId) {
                    clearInterval(this.simulationIntervalId);
                    this.simulationIntervalId = null;
                }
                return;
            }

            const currentRealTime = Date.now();
            const elapsedRealTime = currentRealTime - simulationStartTime;

            // Update current time in state
            this.simulationState.currentTime = currentRealTime;

            // Process each profile based on real elapsed time
            for (const [profileId, timing] of profileTimings) {
                const profileState = this.simulationState.profileStates[profileId];
                if (!profileState) continue;

                // Calculate where we should be in the original timeline
                const currentSimulationTime = earliestStartTime + elapsedRealTime;

                // Find the current segment based on simulation time
                let newSegmentIndex = timing.currentSegmentIndex;

                // Advance through segments if we've passed their timestamps
                while (newSegmentIndex < timing.sortedData.length - 1 &&
                timing.sortedData[newSegmentIndex + 1].timestamp <= currentSimulationTime) {
                    newSegmentIndex++;

                    // Send data point for this segment
                    const currentPoint = timing.sortedData[newSegmentIndex];

                    if (config.optimized) {
                        await this.sendPointToWebSocket(profileId, currentPoint);
                    } else {
                        await this.processUnoptimizedDetection(profileId, currentPoint);
                    }
                }

                // Update profile state
                timing.currentSegmentIndex = newSegmentIndex;
                profileState.currentIndex = newSegmentIndex;
                timing.lastUpdateTime = currentRealTime;
            }

            // Check if all profiles have finished
            const allFinished = Array.from(profileTimings.values()).every(timing =>
                timing.currentSegmentIndex >= timing.sortedData.length - 1
            );

            if (allFinished) {
                console.log('All profiles completed, stopping simulation');
                await this.stopSimulation();
            }

        }, config.intervalMs);
    }

    /**
     * Sends a data point to the appropriate WebSocket
     */
    private async sendPointToWebSocket(profileId: string, point: DataPoint): Promise<void> {
        const ws = this.profileWebSockets.get(profileId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({
                    lat: point.lat,
                    lng: point.lng,
                    timestamp: point.timestamp,
                    speed: point.speed,
                    altitude: point.altitude,
                    bearing: point.bearing
                }));
            } catch (error) {
                console.error(`Failed to send data to WebSocket for profile ${profileId}:`, error);
            }
        }
    }

    /**
     * Processes unoptimized object detection (distance-based, 10m radius)
     */
    private async processUnoptimizedDetection(profileId: string, currentPoint: DataPoint): Promise<void> {
        const nearbyObjects = this.findObjectsWithinDistance(currentPoint, 10); // 10 meters

        if (nearbyObjects.length > 0) {
            const objectIds = nearbyObjects.map(obj => obj.ID);
            await this.processObjectIds(objectIds, profileId);
        }
    }

    /**
     * Finds 3D objects within a specified distance of a point
     */
    private findObjectsWithinDistance(point: DataPoint, maxDistanceMeters: number): Object3D[] {
        return this.availableObjects.filter(obj => {
            if (obj.latitude === undefined || obj.longitude === undefined) {
                return false;
            }

            const distance = this.calculateDistance(
                point.lat, point.lng,
                obj.latitude, obj.longitude
            );

            return distance <= maxDistanceMeters;
        });
    }

    /**
     * Calculates distance between two geographic points using Haversine formula
     */
    private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const R = 6371000; // Earth's radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a =
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    /**
     * Processes object IDs received from WebSocket or distance detection
     */
    private async processObjectIds(objectIds: string[], profileId: string): Promise<void> {
        const profileState = this.simulationState?.profileStates[profileId];
        if (!profileState) return;

        const downloadPromises = objectIds.map(async (objectId) => {
            // Check global cache first to avoid duplicate downloads
            if (!this.downloadedObjects.has(objectId)) {
                await this.downloadObject(objectId, profileId);
                this.downloadedObjects.add(objectId);
            }

            // Add to profile's downloaded list if not already there
            if (!profileState.downloadedObjects.includes(objectId)) {
                profileState.downloadedObjects.push(objectId);
            }
        });

        await Promise.all(downloadPromises);
    }

    /**
     * Downloads a 3D object and measures latency
     */
    private async downloadObject(objectId: string, profileId: string): Promise<void> {
        const startTime = performance.now();
        const profileState = this.simulationState?.profileStates[profileId];
        if (!profileState) return;

        try {
            const response = await axios.get(
                `http://localhost/api/storage/objects/${objectId}/download`,
                {
                    responseType: 'blob',
                    timeout: 30000 // 30 second timeout
                }
            );

            const endTime = performance.now();
            const latency = endTime - startTime;
            const sizeBytes = response.data.size || 0;

            const metric: ObjectMetric = {
                objectId,
                profileId,
                downloadLatencyMs: latency,
                sizeBytes,
                timestamp: Date.now(),
                simulationType: this.profileWebSockets.has(profileId) ? 'optimized' : 'unoptimized',
                simulationId: this.getCurrentSimulationId()
            };

            profileState.metrics.push(metric);
            console.log(`Downloaded object ${objectId} for profile ${profileId} in ${latency.toFixed(2)}ms (${(sizeBytes / 1024).toFixed(1)}KB)`);

        } catch (error) {
            console.error(`Failed to download object ${objectId} for profile ${profileId}:`, error);
        }
    }

    /**
     * Collects simulation results for export
     */
    private collectSimulationResults(): SimulationResults {
        if (!this.simulationState) {
            throw new Error('No simulation state available');
        }

        const allMetrics: ObjectMetric[] = [];
        Object.values(this.simulationState.profileStates).forEach((profileState) => {
            allMetrics.push(...profileState.metrics);
        });

        const uniqueObjects = new Set(allMetrics.map(m => m.objectId)).size;
        const averageLatency = allMetrics.length > 0
            ? allMetrics.reduce((sum, m) => sum + m.downloadLatencyMs, 0) / allMetrics.length
            : 0;
        const totalDataSize = allMetrics.reduce((sum, m) => sum + m.sizeBytes, 0);

        const simulationType = this.profileWebSockets.size > 0 ? 'optimized' : 'unoptimized';

        return {
            simulationId: this.getCurrentSimulationId(),
            simulationType,
            startTime: this.simulationState.startTime,
            endTime: Date.now(),
            profiles: [], // We don't need to store full profile data in results
            metrics: allMetrics,
            totalObjects: allMetrics.length,
            uniqueObjects,
            averageLatency,
            totalDataSize
        };
    }

    /**
     * Generates a unique simulation ID
     */
    private generateSimulationId(): string {
        return `sim_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * Gets the current simulation ID
     */
    private getCurrentSimulationId(): string {
        return this.simulationState
            ? `sim_${this.simulationState.startTime}_${Math.random().toString(36).substring(2, 11)}`
            : 'unknown';
    }
}