import axios from 'axios';
import {
    Profile,
    DataPoint,
    SimulationConfig,
    SimulationState,
    ProfileSimulationState,
    ObjectMetric,
    SimulationResults
} from '../types/simulation';
import { interpolatePoints } from '../utils/interpolation';
import { DataCollector } from './dataCollector';

export class SimulationService {
    private dataCollector: DataCollector;
    private simulationState: SimulationState | null = null;
    private intervalIds: Map<string, NodeJS.Timeout> = new Map();

    constructor() {
        this.dataCollector = new DataCollector();
    }

    /**
     * Starts a new simulation with the given configuration
     */
    async startSimulation(config: SimulationConfig): Promise<string> {
        if (this.simulationState?.isRunning) {
            throw new Error('Simulation is already running');
        }

        const simulationId = this.generateSimulationId();

        this.simulationState = {
            isRunning: true,
            currentTime: Date.now(),
            startTime: Date.now(),
            profileStates: new Map()
        };

        // Initialize profile states
        for (const profile of config.profiles) {
            const profileState: ProfileSimulationState = {
                profileId: profile.id,
                currentIndex: 0,
                downloadedObjects: new Set(),
                metrics: []
            };

            if (config.optimized) {
                await this.establishWebSocketConnection(profileState, profile);
            }

            this.simulationState.profileStates.set(profile.id, profileState);
        }

        // Start simulation loops for each profile
        for (const profile of config.profiles) {
            this.startProfileSimulation(profile, config, simulationId);
        }

        return simulationId;
    }

    /**
     * Stops the current simulation and returns results
     */
    async stopSimulation(): Promise<SimulationResults | null> {
        if (!this.simulationState) {
            return null;
        }

        // Stop all intervals
        this.intervalIds.forEach(intervalId => clearInterval(intervalId));
        this.intervalIds.clear();

        // Close WebSocket connections
        this.simulationState.profileStates.forEach(profileState => {
            if (profileState.websocket) {
                profileState.websocket.close();
            }
        });

        const results = this.collectSimulationResults();

        // Save results to file
        await this.dataCollector.saveResults(results);

        this.simulationState = null;
        return results;
    }

    /**
     * Gets the current simulation state
     */
    getSimulationState(): SimulationState | null {
        return this.simulationState;
    }

    /**
     * Establishes WebSocket connection for a profile
     */
    private async establishWebSocketConnection(
        profileState: ProfileSimulationState,
        profile: Profile
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://localhost/ws/predict`);

            ws.onopen = () => {
                console.log(`WebSocket connected for profile ${profile.name}`);
                profileState.websocket = ws;
                resolve();
            };

            ws.onmessage = async (event) => {
                try {
                    const objectIds: string[] = JSON.parse(event.data);
                    await this.processObjectIds(objectIds, profileState);
                } catch (error) {
                    console.error('Error processing WebSocket message:', error);
                }
            };

            ws.onerror = (error) => {
                console.error(`WebSocket error for profile ${profile.name}:`, error);
                // Don't reject immediately, try to continue without WebSocket
                console.warn(`Continuing simulation for ${profile.name} without WebSocket`);
                resolve();
            };

            ws.onclose = () => {
                console.log(`WebSocket closed for profile ${profile.name}`);
            };

            // Set a timeout for connection
            setTimeout(() => {
                if (ws.readyState === WebSocket.CONNECTING) {
                    console.warn(`WebSocket connection timeout for ${profile.name}`);
                    ws.close();
                    resolve(); // Continue without WebSocket
                }
            }, 5000);
        });
    }

    /**
     * Processes object IDs received from WebSocket
     */
    private async processObjectIds(
        objectIds: string[],
        profileState: ProfileSimulationState
    ): Promise<void> {
        const promises = objectIds.map(async (objectId) => {
            if (!profileState.downloadedObjects.has(objectId)) {
                await this.downloadObject(objectId, profileState);
            }
        });

        await Promise.all(promises);
    }

    /**
     * Downloads a 3D object and measures latency
     */
    private async downloadObject(
        objectId: string,
        profileState: ProfileSimulationState
    ): Promise<void> {
        const startTime = performance.now();

        try {
            const response = await axios.get(
                `http://localhost/api/storage/objects/${objectId}/download`,
                { responseType: 'blob' }
            );

            const endTime = performance.now();
            const latency = endTime - startTime;
            const sizeBytes = response.data.size || 0;

            const metric: ObjectMetric = {
                objectId,
                profileId: profileState.profileId,
                downloadLatencyMs: latency,
                sizeBytes,
                timestamp: Date.now(),
                simulationType: this.simulationState?.profileStates.get(profileState.profileId)?.websocket
                    ? 'optimized'
                    : 'unoptimized',
                simulationId: this.getCurrentSimulationId()
            };

            profileState.metrics.push(metric);
            profileState.downloadedObjects.add(objectId);

            console.log(`Downloaded object ${objectId} for profile ${profileState.profileId} in ${latency.toFixed(2)}ms`);
        } catch (error) {
            console.error(`Failed to download object ${objectId}:`, error);
        }
    }

    /**
     * Starts simulation for a specific profile
     */
    private startProfileSimulation(
        profile: Profile,
        config: SimulationConfig,
        simulationId: string
    ): void {
        const interpolatedPoints = interpolatePoints(profile.data, config.intervalMs);
        let currentIndex = 0;

        const intervalId = setInterval(async () => {
            if (!this.simulationState?.isRunning || currentIndex >= interpolatedPoints.length) {
                clearInterval(intervalId);
                this.intervalIds.delete(profile.id);
                return;
            }

            const point = interpolatedPoints[currentIndex];
            const profileState = this.simulationState.profileStates.get(profile.id);

            if (profileState) {
                // Send point to WebSocket if optimized mode and connection exists
                if (config.optimized && profileState.websocket && profileState.websocket.readyState === WebSocket.OPEN) {
                    this.sendPointToWebSocket(profileState.websocket, point);
                } else if (!config.optimized) {
                    // Simulate object detection in unoptimized mode
                    await this.simulateUnoptimizedObjectDetection(profileState);
                }

                profileState.currentIndex = currentIndex;
            }

            currentIndex++;
        }, config.intervalMs);

        this.intervalIds.set(profile.id, intervalId);
    }

    /**
     * Sends a data point to WebSocket
     */
    private sendPointToWebSocket(ws: WebSocket, point: DataPoint): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(point));
        }
    }

    /**
     * Simulates object detection for unoptimized mode
     */
    private async simulateUnoptimizedObjectDetection(
        profileState: ProfileSimulationState
    ): Promise<void> {
        // Generate random object IDs to simulate detection
        const numObjects = Math.floor(Math.random() * 3) + 1; // 1-3 objects
        const objectIds = Array.from(
            { length: numObjects },
            () => `obj_${Math.random().toString(36).substr(2, 9)}`
        );

        await this.processObjectIds(objectIds, profileState);
    }

    /**
     * Collects simulation results
     */
    private collectSimulationResults(): SimulationResults {
        if (!this.simulationState) {
            throw new Error('No simulation state available');
        }

        const allMetrics: ObjectMetric[] = [];
        const profiles: Profile[] = [];

        this.simulationState.profileStates.forEach((profileState, profileId) => {
            allMetrics.push(...profileState.metrics);
        });

        const uniqueObjects = new Set(allMetrics.map(m => m.objectId)).size;
        const averageLatency = allMetrics.length > 0
            ? allMetrics.reduce((sum, m) => sum + m.downloadLatencyMs, 0) / allMetrics.length
            : 0;
        const totalDataSize = allMetrics.reduce((sum, m) => sum + m.sizeBytes, 0);

        return {
            simulationId: this.getCurrentSimulationId(),
            simulationType: allMetrics.length > 0 ? allMetrics[0].simulationType : 'unoptimized',
            startTime: this.simulationState.startTime,
            endTime: Date.now(),
            profiles,
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
        return `sim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Gets the current simulation ID
     */
    private getCurrentSimulationId(): string {
        return this.simulationState ?
            `sim_${this.simulationState.startTime}_${Math.random().toString(36).substr(2, 9)}` :
            'unknown';
    }
}