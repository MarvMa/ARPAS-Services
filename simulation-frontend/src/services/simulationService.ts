import axios from 'axios';
import {
    Profile,
    DataPoint,
    SimulationConfig,
    SimulationState,
    ProfileSimulationState,
    ObjectMetric,
    Object3D, ScientificMetrics
} from '../types/simulation';
import {DataCollector} from './dataCollector';

interface PredictionResponse {
    status: string;
    message: string;
    objectIds: (string | number | null)[];
}

export interface DockerStats {
    cpu_usage: number;
    memory_usage: number;
    memory_limit: number;
    network_rx_bytes: number;
    network_tx_bytes: number;
    timestamp: number;
}

interface ContainerStats {
    id: string;
    name: string;
    state: string;
    cpu_percent: number;
    mem_usage: number;
    mem_limit: number;
    mem_percent: number;
    net_rx_bytes: number;
    net_tx_bytes: number;
    block_read_bytes: number;
    block_write_bytes: number;
}

interface DockerStatsResponse {
    containers: ContainerStats[];
}

export class SimulationService {
    private dataCollector: DataCollector;
    private simulationState: SimulationState | null = null;
    private simulationIntervalId: number | null = null;
    private profileWebSockets: Map<string, WebSocket> = new Map();
    private downloadedObjectsPerProfile: Map<string, Set<string>> = new Map();
    private availableObjects: Object3D[] = [];
    private dockerStats: Map<string, DockerStats[]> = new Map();
    private baselineMetrics: Map<string, ObjectMetric[]> = new Map();
    private objectDownloadTracking: Map<string, Map<string, Set<string>>> = new Map(); // simulationId -> objectId -> profileIds
    private dockerTimeSeriesData: Map<string, any[]> = new Map(); // containerName -> timeseries
    private dockerCollectionInterval: number | null = null;
    constructor() {
        this.dataCollector = new DataCollector();
    }

    setAvailableObjects(objects: Object3D[]): void {
        this.availableObjects = objects;
        console.log(`Available objects for simulation: ${objects.length}`);
    }

    /**
     * Starts a new real-time simulation with enhanced metrics collection
     */
    async startSimulation(config: SimulationConfig): Promise<string> {
        if (this.simulationState?.isRunning) {
            throw new Error('Simulation is already running');
        }

        const simulationId = this.generateSimulationId();
        console.log(`Starting ${config.optimized ? 'optimized' : 'unoptimized'} simulation: ${simulationId}`);
        console.log(`Configuration: ${config.profiles.length} profiles, ${config.intervalMs}ms interval`);

        // Clear previous data
        this.downloadedObjectsPerProfile.clear();
        this.profileWebSockets.clear();
        this.dockerStats.clear();
        this.baselineMetrics.clear();

        // Start enhanced Docker stats collection
        this.startEnhancedDockerStatsCollection();

        // Calculate timing
        const allStartTimes = config.profiles
            .filter(p => p.data.length > 0)
            .map(p => Math.min(...p.data.map(d => d.timestamp)));

        const earliestStartTime = allStartTimes.length > 0 ? Math.min(...allStartTimes) : Date.now();
        const simulationStartTime = Date.now();

        // Initialize enhanced simulation state
        this.simulationState = {
            isRunning: true,
            currentTime: simulationStartTime,
            startTime: simulationStartTime,
            profileStates: {},
            optimized: config.optimized,
            totalDataPoints: config.profiles.reduce((sum, p) => sum + p.data.length, 0),
            processedDataPoints: 0,
            interval: config.intervalMs
        };

        // Initialize profile states and connections
        const profileSetupPromises = config.profiles.map(async (profile) => {
            if (profile.data.length === 0) return;

            const profileState: ProfileSimulationState = {
                profileId: profile.id,
                currentIndex: 0,
                downloadedObjects: [],
                metrics: [],
                totalRequests: 0,
                successfulRequests: 0,
                failedRequests: 0,
                cacheHits: 0,
                cacheMisses: 0
            };

            this.downloadedObjectsPerProfile.set(profile.id, new Set<string>());
            this.baselineMetrics.set(profile.id, []);
            this.simulationState!.profileStates[profile.id] = profileState;

            if (config.optimized) {
                try {
                    await this.establishWebSocketConnection(profile.id, profile.name);
                } catch (error) {
                    console.error(`Failed to establish WebSocket for profile ${profile.name}:`, error);
                }
            }
        });

        await Promise.all(profileSetupPromises);

        // Start simulation with enhanced monitoring
        this.startRealTimeSimulation(config, earliestStartTime, simulationStartTime);

        return simulationId;
    }
    


    /**
     * Enhanced WebSocket connection with better error handling
     */
    private async establishWebSocketConnection(profileId: string, profileName: string): Promise<void> {
        return new Promise((resolve) => {
            const wsUrl = 'ws://localhost/ws/predict';
            const ws = new WebSocket(wsUrl);
            let connectionTimeout: number;

            const cleanup = () => {
                if (connectionTimeout) {
                    clearTimeout(connectionTimeout);
                }
            };

            ws.onopen = () => {
                console.log(`WebSocket connected for profile: ${profileName} (${profileId})`);
                this.profileWebSockets.set(profileId, ws);
                cleanup();
                resolve();
            };

            ws.onmessage = async (event) => {
                try {
                    const response = JSON.parse(event.data);
                    let objectIds: string[] = [];

                    if (response.objectIds && Array.isArray(response.objectIds)) {
                        objectIds = (response as PredictionResponse).objectIds
                            .filter((id): id is string | number => id !== null && id !== undefined)
                            .map(id => String(id));
                    } else if (Array.isArray(response)) {
                        objectIds = (response as (string | number | null)[])
                            .filter((id): id is string | number => id !== null && id !== undefined)
                            .map(id => String(id));
                    }

                    const profileState = this.simulationState?.profileStates[profileId];
                    if (profileState) {
                        profileState.totalRequests++;
                        if (objectIds.length > 0) {
                            profileState.successfulRequests++;
                            console.log(`Received ${objectIds.length} object IDs for ${profileName}`);
                            await this.processObjectIds(objectIds, profileId);
                        } else {
                            // Record baseline metric for requests with no objects
                            await this.recordBaselineMetric(profileId);
                        }
                    }
                } catch (error) {
                    console.error(`Error processing WebSocket message for ${profileName}:`, error);
                    const profileState = this.simulationState?.profileStates[profileId];
                    if (profileState) {
                        profileState.failedRequests++;
                    }
                }
            };

            ws.onerror = (error) => {
                console.error(`WebSocket error for profile ${profileName}:`, error);
                cleanup();
                resolve();
            };

            ws.onclose = () => {
                console.log(`WebSocket closed for profile: ${profileName}`);
                this.profileWebSockets.delete(profileId);
                cleanup();
            };

            connectionTimeout = window.setTimeout(() => {
                console.warn(`WebSocket connection timeout for ${profileName}`);
                ws.close();
                resolve();
            }, 10000);
        });
    }

    /**
     * Enhanced real-time simulation with better tracking
     */
    private startRealTimeSimulation(
        config: SimulationConfig,
        earliestStartTime: number,
        simulationStartTime: number
    ): void {
        const profileTimings = new Map<string, {
            profile: Profile;
            sortedData: DataPoint[];
            startTime: number;
            endTime: number;
            currentSegmentIndex: number;
            lastUpdateTime: number;
        }>();

        // Initialize timing data
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

        let processedDataPoints = 0;
        const totalDataPoints = this.simulationState!.totalDataPoints;

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
            this.simulationState.currentTime = currentRealTime;

            const profileProcessingPromises = Array.from(profileTimings.entries()).map(
                async ([profileId, timing]) => {
                    const profileState = this.simulationState!.profileStates[profileId];
                    if (!profileState) return;

                    const currentSimulationTime = timing.startTime + elapsedRealTime;
                    let currentSegmentIndex = timing.currentSegmentIndex;

                    // Advance segments
                    while (currentSegmentIndex < timing.sortedData.length - 1 &&
                    timing.sortedData[currentSegmentIndex + 1].timestamp <= currentSimulationTime) {
                        currentSegmentIndex++;
                        processedDataPoints++;
                    }

                    timing.currentSegmentIndex = currentSegmentIndex;
                    profileState.currentIndex = currentSegmentIndex;

                    // Update progress
                    this.simulationState!.processedDataPoints = processedDataPoints;

                    if (currentSegmentIndex >= timing.sortedData.length - 1) {
                        if (timing.lastUpdateTime < currentRealTime - config.intervalMs) {
                            const lastPoint = timing.sortedData[timing.sortedData.length - 1];
                            if (config.optimized) {
                                await this.sendPointToWebSocket(profileId, lastPoint);
                            } else {
                                await this.processUnoptimizedDetection(profileId, lastPoint);
                            }
                            timing.lastUpdateTime = currentRealTime;
                        }
                        return;
                    }

                    // Interpolate current position
                    const currentPoint = timing.sortedData[currentSegmentIndex];
                    const nextPoint = timing.sortedData[currentSegmentIndex + 1];
                    const segmentDuration = nextPoint.timestamp - currentPoint.timestamp;
                    const segmentElapsed = currentSimulationTime - currentPoint.timestamp;
                    const progress = segmentDuration > 0 ? Math.max(0, Math.min(1, segmentElapsed / segmentDuration)) : 0;

                    const interpolatedPoint: DataPoint = {
                        lat: currentPoint.lat + (nextPoint.lat - currentPoint.lat) * progress,
                        lng: currentPoint.lng + (nextPoint.lng - currentPoint.lng) * progress,
                        timestamp: currentSimulationTime,
                        speed: currentPoint.speed && nextPoint.speed
                            ? currentPoint.speed + (nextPoint.speed - currentPoint.speed) * progress
                            : currentPoint.speed || nextPoint.speed,
                        altitude: currentPoint.altitude && nextPoint.altitude
                            ? currentPoint.altitude + (nextPoint.altitude - currentPoint.altitude) * progress
                            : currentPoint.altitude || nextPoint.altitude,
                        bearing: currentPoint.bearing !== undefined && nextPoint.bearing !== undefined
                            ? currentPoint.bearing + ((nextPoint.bearing - currentPoint.bearing) * progress)
                            : currentPoint.bearing || nextPoint.bearing
                    };

                    if (config.optimized) {
                        await this.sendPointToWebSocket(profileId, interpolatedPoint);
                    } else {
                        await this.processUnoptimizedDetection(profileId, interpolatedPoint);
                    }

                    timing.lastUpdateTime = currentRealTime;
                }
            );

            await Promise.all(profileProcessingPromises);

            // Check completion
            const allFinished = Array.from(profileTimings.values()).every(timing =>
                timing.currentSegmentIndex >= timing.sortedData.length - 1 &&
                timing.lastUpdateTime < Date.now() - config.intervalMs
            );

            if (allFinished) {
                console.log('All profiles completed, stopping simulation');
                await this.stopSimulation();
            }

        }, config.intervalMs);
    }

    /**
     * Enhanced unoptimized detection with baseline metrics
     */
    private async processUnoptimizedDetection(profileId: string, currentPoint: DataPoint): Promise<void> {
        const detectionStartTime = performance.now();
        const nearbyObjects = this.findObjectsWithinDistance(currentPoint, 10);
        const detectionEndTime = performance.now();
        const detectionLatency = detectionEndTime - detectionStartTime;

        const profileState = this.simulationState?.profileStates[profileId];
        if (profileState) {
            profileState.totalRequests++;
        }

        if (nearbyObjects.length > 0) {
            const objectIds = nearbyObjects.map(obj => obj.ID);
            await this.processObjectIds(objectIds, profileId);
            if (profileState) {
                profileState.successfulRequests++;
            }
            console.log(`Unoptimized detection found ${nearbyObjects.length} objects within 10m for profile ${profileId}`);
        } else {
            // CRITICAL FIX: Record baseline metric even when no objects found
            await this.recordBaselineMetric(profileId, detectionLatency);
            console.log(`Unoptimized detection found 0 objects within 10m for profile ${profileId} (detection took ${detectionLatency.toFixed(2)}ms)`);
        }
    }

    /**
     * Record baseline metrics for scientific comparison
     */
    private async recordBaselineMetric(profileId: string, detectionLatency: number = 0): Promise<void> {
        const baselineMetric: ObjectMetric = {
            objectId: 'BASELINE_NO_OBJECTS',
            profileId,
            downloadLatencyMs: detectionLatency,
            serverLatencyMs: 0,
            clientLatencyMs: detectionLatency,
            sizeBytes: 0,
            timestamp: Date.now(),
            simulationType: this.simulationState?.optimized ? 'optimized' : 'unoptimized',
            simulationId: this.getCurrentSimulationId(),
            downloadSource: 'baseline',
            isBaseline: true
        };

        const profileState = this.simulationState?.profileStates[profileId];
        if (profileState) {
            profileState.metrics.push(baselineMetric);
        }

        const baselineArray = this.baselineMetrics.get(profileId);
        if (baselineArray) {
            baselineArray.push(baselineMetric);
        }
    }

    
    private async sendPointToWebSocket(profileId: string, point: DataPoint): Promise<void> {
        const ws = this.profileWebSockets.get(profileId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                const data = {
                    latitude: point.lat,
                    longitude: point.lng,
                    timestamp: new Date(point.timestamp).toISOString(),
                    speed: point.speed || 0,
                    altitude: point.altitude || 0,
                    heading: point.bearing
                };

                ws.send(JSON.stringify(data));
            } catch (error) {
                console.error(`Failed to send data to WebSocket for profile ${profileId}:`, error);
            }
        }
    }

    private async processObjectIds(objectIds: string[], profileId: string): Promise<void> {
        const profileState = this.simulationState?.profileStates[profileId];
        if (!profileState) return;

        let profileDownloadCache = this.downloadedObjectsPerProfile.get(profileId);
        if (!profileDownloadCache) {
            profileDownloadCache = new Set<string>();
            this.downloadedObjectsPerProfile.set(profileId, profileDownloadCache);
        }

        const downloadPromises = objectIds.map(async (objectId) => {
            if (!profileDownloadCache!.has(objectId)) {
                await this.downloadObject(objectId, profileId);
                profileDownloadCache!.add(objectId);
            }

            if (!profileState.downloadedObjects.includes(objectId)) {
                profileState.downloadedObjects.push(objectId);
            }
        });

        await Promise.all(downloadPromises);
    }

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

    private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const R = 6371000; // Earth's radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    private generateSimulationId(): string {
        return `sim_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    private getCurrentSimulationId(): string {
        return this.simulationState
            ? `sim_${this.simulationState.startTime}_${Math.random().toString(36).substring(2, 11)}`
            : 'unknown';
    }

    public getSimulationState(): SimulationState | null {
        return this.simulationState;
    }

    /**
     * Enhanced Docker stats collection - every second
     */
    private startEnhancedDockerStatsCollection(): void {
        const simulationType = this.simulationState?.optimized ? 'optimized' : 'unoptimized';
        console.log(`Starting Docker metrics collection for ${simulationType} simulation`);

        // Clear previous data
        this.dockerTimeSeriesData.clear();

        // Define which containers to monitor based on simulation type
        const containersToMonitor = this.simulationState?.optimized
            ? ['storage-service', 'redis', 'minio', 'cache-service', 'prediction-service']
            : ['storage-service', 'minio'];

        this.dockerCollectionInterval = window.setInterval(async () => {
            try {
                const stats = await this.fetchFilteredDockerStats(containersToMonitor);
                const timestamp = Date.now();

                Object.entries(stats).forEach(([containerName, containerStats]) => {
                    if (!this.dockerTimeSeriesData.has(containerName)) {
                        this.dockerTimeSeriesData.set(containerName, []);
                    }

                    const timeSeriesEntry = {
                        timestamp,
                        cpu: {
                            usage: containerStats.cpu_usage,
                            percent: containerStats.cpu_usage
                        },
                        memory: {
                            usage: containerStats.memory_usage,
                            limit: containerStats.memory_limit,
                            percent: (containerStats.memory_usage / containerStats.memory_limit) * 100
                        },
                        network: {
                            rxBytes: containerStats.network_rx_bytes,
                            txBytes: containerStats.network_tx_bytes,
                            rxRate: 0, // Will be calculated from previous entry
                            txRate: 0
                        }
                    };

                    // Calculate network rates
                    const timeSeries = this.dockerTimeSeriesData.get(containerName)!;
                    if (timeSeries.length > 0) {
                        const previous = timeSeries[timeSeries.length - 1];
                        const timeDiff = (timestamp - previous.timestamp) / 1000; // seconds
                        if (timeDiff > 0) {
                            timeSeriesEntry.network.rxRate = (timeSeriesEntry.network.rxBytes - previous.network.rxBytes) / timeDiff;
                            timeSeriesEntry.network.txRate = (timeSeriesEntry.network.txBytes - previous.network.txBytes) / timeDiff;
                        }
                    }

                    timeSeries.push(timeSeriesEntry);
                });

            } catch (error) {
                console.warn('Failed to collect Docker metrics:', error);
            }
        }, 1000); // Every second
    }

    /**
     * Fetch Docker stats for specific containers only
     */
    private async fetchFilteredDockerStats(containerNames: string[]): Promise<Record<string, DockerStats>> {
        try {
            const response = await axios.get<DockerStatsResponse>('http://localhost/api/docker/stats', {
                timeout: 5000,
                headers: {
                    'Accept': 'application/json'
                }
            });

            const filteredStats: Record<string, DockerStats> = {};

            if (response.data && response.data.containers) {
                response.data.containers.forEach(container => {
                    // Check if this container should be monitored
                    const shouldMonitor = containerNames.some(name =>
                        container.name.toLowerCase().includes(name.toLowerCase())
                    );

                    if (shouldMonitor) {
                        // Simplify container name for easier reference
                        const simpleName = containerNames.find(name =>
                            container.name.toLowerCase().includes(name.toLowerCase())
                        ) || container.name;

                        filteredStats[simpleName] = {
                            cpu_usage: container.cpu_percent,
                            memory_usage: container.mem_usage,
                            memory_limit: container.mem_limit,
                            network_rx_bytes: container.net_rx_bytes,
                            network_tx_bytes: container.net_tx_bytes,
                            timestamp: Date.now()
                        };
                    }
                });
            }

            return filteredStats;
        } catch (error) {
            console.warn('Failed to fetch Docker stats:', error);
            return {};
        }
    }

    /**
     * Enhanced object download with deduplication
     */
    private async downloadObject(objectId: string, profileId: string): Promise<void> {
        // Check if this object has already been downloaded for this profile in this simulation
        const simulationId = this.getCurrentSimulationId();

        if (!this.objectDownloadTracking.has(simulationId)) {
            this.objectDownloadTracking.set(simulationId, new Map());
        }

        const objectTracking = this.objectDownloadTracking.get(simulationId)!;
        if (!objectTracking.has(objectId)) {
            objectTracking.set(objectId, new Set());
        }

        const profilesForObject = objectTracking.get(objectId)!;
        if (profilesForObject.has(profileId)) {
            console.log(`Object ${objectId} already downloaded for profile ${profileId}, skipping`);
            return; // Already downloaded for this profile
        }

        const startTime = performance.now();
        const profileState = this.simulationState?.profileStates[profileId];
        if (!profileState) return;

        try {
            const headers: any = {};
            if (this.simulationState?.optimized) {
                headers['X-Optimization-Mode'] = 'optimized';
                headers['X-Profile-Id'] = profileId; // Add profile ID for tracking
            }

            const response = await axios.get(
                `http://localhost/api/storage/objects/${objectId}/download`,
                {
                    responseType: 'blob',
                    timeout: 30000,
                    headers
                }
            );

            const endTime = performance.now();
            const totalLatency = endTime - startTime;
            const sizeBytes = response.data.size || 0;

            // Extract enhanced metrics from response headers
            const downloadSource = response.headers['x-download-source'] || 'unknown';
            const serverLatency = parseInt(response.headers['x-download-latency-ms'] || '0');
            const networkLatency = parseInt(response.headers['x-network-latency-ms'] || '0');
            const cacheHit = downloadSource === 'cache';

            // Mark as downloaded for this profile
            profilesForObject.add(profileId);

            // Update cache statistics
            if (cacheHit) {
                profileState.cacheHits++;
            } else {
                profileState.cacheMisses++;
            }

            const metric: ObjectMetric = {
                objectId,
                profileId,
                downloadLatencyMs: totalLatency,
                serverLatencyMs: serverLatency,
                clientLatencyMs: totalLatency - serverLatency - networkLatency,
                networkLatencyMs: networkLatency,
                sizeBytes,
                timestamp: Date.now(),
                simulationType: this.simulationState?.optimized ? 'optimized' : 'unoptimized',
                simulationId,
                downloadSource,
                cacheHit,
                compressionRatio: 1.0,
                isBaseline: false
            };

            profileState.metrics.push(metric);
            console.log(`Downloaded ${objectId} for ${profileId}: ${totalLatency.toFixed(2)}ms (server: ${serverLatency}ms, network: ${networkLatency}ms, client: ${(totalLatency - serverLatency - networkLatency).toFixed(2)}ms) from ${downloadSource}`);

        } catch (error) {
            const endTime = performance.now();
            const latency = endTime - startTime;

            profileState.failedRequests++;

            // Still mark as attempted for this profile to avoid retry
            profilesForObject.add(profileId);

            // Record failed download metric
            const failureMetric: ObjectMetric = {
                objectId,
                profileId,
                downloadLatencyMs: latency,
                serverLatencyMs: 0,
                clientLatencyMs: latency,
                networkLatencyMs: 0,
                sizeBytes: 0,
                timestamp: Date.now(),
                simulationType: this.simulationState?.optimized ? 'optimized' : 'unoptimized',
                simulationId,
                downloadSource: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
                isBaseline: false
            };

            profileState.metrics.push(failureMetric);
            console.error(`Failed to download object ${objectId} for profile ${profileId}:`, error);
        }
    }

    /**
     * Collect comprehensive scientific metrics
     */
    private async collectScientificMetrics(): Promise<ScientificMetrics> {
        if (!this.simulationState) {
            throw new Error('No simulation state available');
        }

        const simulationId = this.getCurrentSimulationId();
        const simulationType = this.simulationState.optimized ? 'optimized' : 'unoptimized';

        // Build object-centric metrics
        const objectMetrics: ScientificMetrics['objectMetrics'] = {};
        const allMetrics: ObjectMetric[] = [];

        Object.values(this.simulationState.profileStates).forEach(profileState => {
            profileState.metrics.forEach(metric => {
                if (!metric.isBaseline) {
                    allMetrics.push(metric);

                    if (!objectMetrics[metric.objectId]) {
                        objectMetrics[metric.objectId] = {
                            downloads: [],
                            statistics: {
                                totalDownloads: 0,
                                uniqueProfiles: 0,
                                averageLatency: 0,
                                minLatency: Infinity,
                                maxLatency: 0,
                                p95Latency: 0,
                                cacheHitRate: 0,
                                successRate: 0
                            }
                        };
                    }

                    objectMetrics[metric.objectId].downloads.push({
                        profileId: metric.profileId,
                        timestamp: metric.timestamp,
                        latency: {
                            total: metric.downloadLatencyMs,
                            server: metric.serverLatencyMs || 0,
                            client: metric.clientLatencyMs || 0,
                            network: metric.networkLatencyMs || 0
                        },
                        cacheHit: metric.cacheHit || false,
                        downloadSource: metric.downloadSource || 'unknown',
                        sizeBytes: metric.sizeBytes,
                        success: !metric.error,
                        error: metric.error
                    });
                }
            });
        });

        // Calculate per-object statistics
        Object.entries(objectMetrics).forEach(([objectId, data]) => {
            const downloads = data.downloads;
            const latencies = downloads.map(d => d.latency.total);
            const successfulDownloads = downloads.filter(d => d.success);
            const cacheHits = downloads.filter(d => d.cacheHit);

            data.statistics = {
                totalDownloads: downloads.length,
                uniqueProfiles: new Set(downloads.map(d => d.profileId)).size,
                averageLatency: latencies.reduce((sum, l) => sum + l, 0) / latencies.length,
                minLatency: Math.min(...latencies),
                maxLatency: Math.max(...latencies),
                p95Latency: this.calculatePercentile(latencies, 95),
                cacheHitRate: (cacheHits.length / downloads.length) * 100,
                successRate: (successfulDownloads.length / downloads.length) * 100
            };
        });

        // Build Docker time series data
        const dockerTimeSeries: ScientificMetrics['dockerTimeSeries'] = {};
        this.dockerTimeSeriesData.forEach((timeSeries, containerName) => {
            dockerTimeSeries[containerName] = timeSeries;
        });

        // Calculate aggregated statistics
        const successfulMetrics = allMetrics.filter(m => !m.error);
        const latencies = successfulMetrics.map(m => m.downloadLatencyMs);
        const duration = Date.now() - this.simulationState.startTime;

        const aggregatedStats: ScientificMetrics['aggregatedStats'] = {
            latency: {
                mean: this.calculateMean(latencies),
                median: this.calculateMedian(latencies),
                stdDev: this.calculateStandardDeviation(latencies),
                p50: this.calculatePercentile(latencies, 50),
                p75: this.calculatePercentile(latencies, 75),
                p90: this.calculatePercentile(latencies, 90),
                p95: this.calculatePercentile(latencies, 95),
                p99: this.calculatePercentile(latencies, 99),
                min: latencies.length > 0 ? Math.min(...latencies) : 0,
                max: latencies.length > 0 ? Math.max(...latencies) : 0
            },
            throughput: {
                objectsPerSecond: successfulMetrics.length / (duration / 1000),
                bytesPerSecond: successfulMetrics.reduce((sum, m) => sum + m.sizeBytes, 0) / (duration / 1000),
                requestsPerSecond: allMetrics.length / (duration / 1000)
            },
            cache: {
                hitRate: (successfulMetrics.filter(m => m.cacheHit).length / successfulMetrics.length) * 100,
                totalHits: successfulMetrics.filter(m => m.cacheHit).length,
                totalMisses: successfulMetrics.filter(m => !m.cacheHit).length,
                efficiency: 0 // Calculate based on your efficiency metric
            },
            success: {
                rate: (successfulMetrics.length / allMetrics.length) * 100,
                totalSuccess: successfulMetrics.length,
                totalFailure: allMetrics.length - successfulMetrics.length
            }
        };

        // Build profile metrics
        const profileMetrics: ScientificMetrics['profileMetrics'] = {};
        Object.entries(this.simulationState.profileStates).forEach(([profileId, state]) => {
            const profileSuccessMetrics = state.metrics.filter(m => !m.error && !m.isBaseline);
            profileMetrics[profileId] = {
                name: this.profiles.find(p => p.id === profileId)?.name || profileId,
                totalObjects: state.downloadedObjects.length,
                uniqueObjects: new Set(state.downloadedObjects).size,
                totalLatency: profileSuccessMetrics.reduce((sum, m) => sum + m.downloadLatencyMs, 0),
                averageLatency: profileSuccessMetrics.length > 0
                    ? profileSuccessMetrics.reduce((sum, m) => sum + m.downloadLatencyMs, 0) / profileSuccessMetrics.length
                    : 0,
                cacheHitRate: state.cacheHits > 0 ? (state.cacheHits / (state.cacheHits + state.cacheMisses)) * 100 : 0,
                errorRate: state.failedRequests > 0 ? (state.failedRequests / state.totalRequests) * 100 : 0,
                dataTransferred: profileSuccessMetrics.reduce((sum, m) => sum + m.sizeBytes, 0)
            };
        });

        return {
            simulationId,
            simulationType,
            timestamp: new Date().toISOString(),
            duration: {
                startTime: this.simulationState.startTime,
                endTime: Date.now(),
                totalMs: duration
            },
            configuration: {
                profileCount: Object.keys(this.simulationState.profileStates).length,
                intervalMs: this.simulationState.interval || 200,
                totalDataPoints: this.simulationState.totalDataPoints || 0,
                objectCount: this.availableObjects.length
            },
            objectMetrics,
            dockerTimeSeries,
            aggregatedStats,
            profileMetrics
        };
    }

    // Statistical helper methods
    private calculateMean(values: number[]): number {
        return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
    }

    private calculateMedian(values: number[]): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }

    private calculatePercentile(values: number[], percentile: number): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    private calculateStandardDeviation(values: number[]): number {
        if (values.length <= 1) return 0;
        const mean = this.calculateMean(values);
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    // Update stopSimulation to use scientific metrics
    async stopSimulation(): Promise<ScientificMetrics | null> {
        if (!this.simulationState) {
            return null;
        }

        console.log('Stopping simulation and collecting scientific metrics...');

        // Stop simulation loop
        if (this.simulationIntervalId) {
            clearInterval(this.simulationIntervalId);
            this.simulationIntervalId = null;
        }

        // Stop Docker stats collection
        if (this.dockerCollectionInterval) {
            clearInterval(this.dockerCollectionInterval);
            this.dockerCollectionInterval = null;
        }

        // Close WebSocket connections
        this.profileWebSockets.forEach((ws, profileId) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });
        this.profileWebSockets.clear();

        // Collect scientific metrics
        const metrics = await this.collectScientificMetrics();

        // Save to data collector
        await this.dataCollector.saveScientificResults(metrics);

        // Clean up
        this.objectDownloadTracking.clear();
        this.dockerTimeSeriesData.clear();
        this.simulationState = null;

        return metrics;
    }

    // Store profiles reference for name resolution
    private profiles: Profile[] = [];

    setProfiles(profiles: Profile[]): void {
        this.profiles = profiles;
    }

}