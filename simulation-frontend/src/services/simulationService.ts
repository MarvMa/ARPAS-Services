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
import {DataCollector} from './dataCollector';

interface PredictionResponse {
    status: string;
    message: string;
    objectIds: (string | number | null)[];
}

interface DockerStats {
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
    private dockerStatsInterval: number | null = null;
    private dockerStats: Map<string, DockerStats[]> = new Map();
    private baselineMetrics: Map<string, ObjectMetric[]> = new Map();

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

    async stopSimulation(): Promise<SimulationResults | null> {
        if (!this.simulationState) {
            return null;
        }

        console.log('Stopping simulation and collecting comprehensive results...');

        // Stop simulation loop
        if (this.simulationIntervalId) {
            clearInterval(this.simulationIntervalId);
            this.simulationIntervalId = null;
        }

        // Stop Docker stats collection
        this.stopDockerStatsCollection();

        // Close WebSocket connections
        this.profileWebSockets.forEach((ws, profileId) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });
        this.profileWebSockets.clear();

        const results = await this.collectEnhancedSimulationResults();
        await this.dataCollector.saveResults(results);

        this.downloadedObjectsPerProfile.clear();
        this.baselineMetrics.clear();
        this.simulationState = null;
        return results;
    }

    /**
     * Enhanced Docker stats collection with error handling
     */
    private startEnhancedDockerStatsCollection(): void {
        console.log('Starting enhanced Docker stats collection...');

        this.dockerStatsInterval = window.setInterval(async () => {
            try {
                const stats = await this.fetchDockerStats();
                const timestamp = Date.now();

                Object.entries(stats).forEach(([containerName, containerStats]) => {
                    if (!this.dockerStats.has(containerName)) {
                        this.dockerStats.set(containerName, []);
                    }

                    const enhancedStats: DockerStats = {
                        ...containerStats,
                        timestamp
                    };

                    this.dockerStats.get(containerName)!.push(enhancedStats);

                    // Keep only last 1000 entries to prevent memory issues
                    const statsArray = this.dockerStats.get(containerName)!;
                    if (statsArray.length > 1000) {
                        statsArray.splice(0, statsArray.length - 1000);
                    }
                });

                console.log(`Collected Docker stats for ${Object.keys(stats).length} containers`);
            } catch (error) {
                console.warn('Failed to collect Docker stats:', error);
                // Continue simulation even if Docker stats fail
            }
        }, 1000);
    }

    private stopDockerStatsCollection(): void {
        if (this.dockerStatsInterval) {
            clearInterval(this.dockerStatsInterval);
            this.dockerStatsInterval = null;
            console.log('Stopped Docker stats collection');
        }
    }

    /**
     * Enhanced Docker stats fetching with retry logic
     */
    private async fetchDockerStats(): Promise<Record<string, DockerStats>> {
        const maxRetries = 3;
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await axios.get<DockerStatsResponse>('/api/docker/stats', {
                    timeout: 5000
                });

                // Transform the response to our expected format
                const transformedStats: Record<string, DockerStats> = {};

                if (response.data && response.data.containers) {
                    response.data.containers.forEach(container => {
                        transformedStats[container.name] = {
                            cpu_usage: container.cpu_percent,
                            memory_usage: container.mem_usage,
                            memory_limit: container.mem_limit,
                            network_rx_bytes: container.net_rx_bytes,
                            network_tx_bytes: container.net_tx_bytes,
                            timestamp: Date.now()
                        };
                    });
                }

                return transformedStats;
            } catch (error) {
                lastError = error as Error;
                if (attempt < maxRetries) {
                    console.warn(`Docker stats fetch attempt ${attempt} failed, retrying...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
        }

        throw new Error(`Failed to fetch Docker stats after ${maxRetries} attempts: ${lastError?.message}`);
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

    /**
     * Enhanced object download with comprehensive metrics
     */
    private async downloadObject(objectId: string, profileId: string): Promise<void> {
        const startTime = performance.now();
        const profileState = this.simulationState?.profileStates[profileId];
        if (!profileState) return;

        try {
            const headers: any = {};
            if (this.simulationState?.optimized) {
                headers['X-Optimization-Mode'] = 'optimized';
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
            const cacheHit = downloadSource === 'cache';

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
                clientLatencyMs: totalLatency - serverLatency,
                sizeBytes,
                timestamp: Date.now(),
                simulationType: this.simulationState?.optimized ? 'optimized' : 'unoptimized',
                simulationId: this.getCurrentSimulationId(),
                downloadSource,
                cacheHit,
                networkLatencyMs: totalLatency - serverLatency,
                compressionRatio: sizeBytes > 0 ? 1.0 : 0,
                isBaseline: false
            };

            profileState.metrics.push(metric);
            console.log(`Downloaded ${objectId} for ${profileId}: ${totalLatency.toFixed(2)}ms total (server: ${serverLatency}ms, client: ${(totalLatency - serverLatency).toFixed(2)}ms) from ${downloadSource}, cache hit: ${cacheHit}`);

        } catch (error) {
            const endTime = performance.now();
            const latency = endTime - startTime;

            profileState.failedRequests++;

            // Record failed download metric
            const failureMetric: ObjectMetric = {
                objectId,
                profileId,
                downloadLatencyMs: latency,
                serverLatencyMs: 0,
                clientLatencyMs: latency,
                sizeBytes: 0,
                timestamp: Date.now(),
                simulationType: this.simulationState?.optimized ? 'optimized' : 'unoptimized',
                simulationId: this.getCurrentSimulationId(),
                downloadSource: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
                isBaseline: false
            };

            profileState.metrics.push(failureMetric);
            console.error(`Failed to download object ${objectId} for profile ${profileId}:`, error);
        }
    }

    /**
     * Enhanced simulation results collection
     */
    private async collectEnhancedSimulationResults(): Promise<SimulationResults> {
        if (!this.simulationState) {
            throw new Error('No simulation state available');
        }

        console.log('Collecting enhanced simulation results...');

        const allMetrics: ObjectMetric[] = [];
        const profileStats = new Map<string, any>();

        // Collect all metrics including baseline
        Object.entries(this.simulationState.profileStates).forEach(([profileId, profileState]) => {
            allMetrics.push(...profileState.metrics);

            const profileUnique = new Set(profileState.downloadedObjects);
            const totalRequests = profileState.totalRequests || 0;
            const successfulRequests = profileState.successfulRequests || 0;
            const cacheHits = profileState.cacheHits || 0;
            const cacheMisses = profileState.cacheMisses || 0;

            profileStats.set(profileId, {
                downloads: profileState.downloadedObjects.length,
                unique: profileUnique.size,
                totalRequests,
                successfulRequests,
                failedRequests: profileState.failedRequests || 0,
                successRate: totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0,
                cacheHits,
                cacheMisses,
                cacheHitRate: (cacheHits + cacheMisses) > 0 ? (cacheHits / (cacheHits + cacheMisses)) * 100 : 0
            });
        });

        // Calculate comprehensive statistics
        const realMetrics = allMetrics.filter(m => !m.isBaseline);
        const baselineMetrics = allMetrics.filter(m => m.isBaseline);
        const successfulMetrics = realMetrics.filter(m => !m.error);
        const failedMetrics = realMetrics.filter(m => !!m.error);

        const totalRequests = allMetrics.length;
        const successfulDownloads = successfulMetrics.length;
        const globalUniqueObjects = new Set(successfulMetrics.map(m => m.objectId));

        // Latency statistics
        const latencies = successfulMetrics.map(m => m.downloadLatencyMs);
        const serverLatencies = successfulMetrics.map(m => m.serverLatencyMs || 0);
        const clientLatencies = successfulMetrics.map(m => m.clientLatencyMs || 0);

        const averageLatency = latencies.length > 0 ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length : 0;
        const averageServerLatency = serverLatencies.length > 0 ? serverLatencies.reduce((sum, l) => sum + l, 0) / serverLatencies.length : 0;
        const averageClientLatency = clientLatencies.length > 0 ? clientLatencies.reduce((sum, l) => sum + l, 0) / clientLatencies.length : 0;

        // Cache statistics
        const cacheHits = successfulMetrics.filter(m => m.cacheHit).length;
        const cacheMisses = successfulMetrics.filter(m => !m.cacheHit && !m.error).length;
        const cacheHitRate = (cacheHits + cacheMisses) > 0 ? (cacheHits / (cacheHits + cacheMisses)) * 100 : 0;

        // Data transfer statistics
        const totalDataSize = successfulMetrics.reduce((sum, m) => sum + m.sizeBytes, 0);
        const averageObjectSize = successfulMetrics.length > 0 ? totalDataSize / successfulMetrics.length : 0;

        // Performance metrics
        const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
        const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;
        const medianLatency = this.calculateMedian(latencies);
        const p95Latency = this.calculatePercentile(latencies, 95);
        const p99Latency = this.calculatePercentile(latencies, 99);

        // Docker statistics summary
        const dockerStatsSummary = this.processDockerStats();

        const simulationType = this.simulationState.optimized ? 'optimized' : 'unoptimized';

        const enhancedResults: SimulationResults = {
            simulationId: this.getCurrentSimulationId(),
            simulationType,
            startTime: this.simulationState.startTime,
            endTime: Date.now(),
            duration: Date.now() - this.simulationState.startTime,
            profiles: [], // Simplified for export
            metrics: allMetrics,

            // Basic counters
            totalObjects: successfulDownloads,
            uniqueObjects: globalUniqueObjects.size,
            totalRequests,
            successfulRequests: successfulDownloads,
            failedRequests: failedMetrics.length,
            baselineRequests: baselineMetrics.length,

            // Latency statistics
            averageLatency,
            averageServerLatency,
            averageClientLatency,
            minLatency,
            maxLatency,
            medianLatency,
            p95Latency,
            p99Latency,
            latencyStandardDeviation: this.calculateStandardDeviation(latencies),

            // Cache performance
            cacheHitRate,
            cacheHits,
            cacheMisses,
            cacheEfficiency: cacheHitRate / 100,

            // Data transfer
            totalDataSize,
            averageObjectSize,
            totalDataTransferred: totalDataSize,

            // Success rates
            successRate: totalRequests > 0 ? (successfulDownloads / totalRequests) * 100 : 0,
            errorRate: totalRequests > 0 ? (failedMetrics.length / totalRequests) * 100 : 0,

            // Performance insights
            throughput: this.calculateThroughput(),
            requestsPerSecond: this.calculateRequestsPerSecond(),

            // Infrastructure metrics
            dockerStats: dockerStatsSummary,
            detailedDockerStats: Object.fromEntries(this.dockerStats),

            // Profile-specific statistics
            profileStatistics: Object.fromEntries(profileStats),

            // Configuration
            configuration: {
                optimized: this.simulationState.optimized,
                interval: this.simulationState.interval,
                profileCount: Object.keys(this.simulationState.profileStates).length,
                totalDataPoints: this.simulationState.totalDataPoints,
                processedDataPoints: this.simulationState.processedDataPoints
            }
        };

        console.log(`Enhanced results collected: ${successfulDownloads} successful downloads, ${cacheHitRate.toFixed(1)}% cache hit rate, ${averageLatency.toFixed(2)}ms avg latency`);
        return enhancedResults;
    }

    /**
     * Process Docker statistics for analysis
     */
    private processDockerStats(): any {
        const summary: any = {};

        for (const [container, stats] of this.dockerStats.entries()) {
            if (stats.length === 0) continue;

            const cpuValues = stats.map(s => s.cpu_usage);
            const memoryValues = stats.map(s => s.memory_usage);
            const networkRxValues = stats.map(s => s.network_rx_bytes);
            const networkTxValues = stats.map(s => s.network_tx_bytes);

            summary[container] = {
                sampleCount: stats.length,
                cpu: {
                    average: this.calculateAverage(cpuValues),
                    min: Math.min(...cpuValues),
                    max: Math.max(...cpuValues),
                    median: this.calculateMedian(cpuValues),
                    standardDeviation: this.calculateStandardDeviation(cpuValues)
                },
                memory: {
                    average: this.calculateAverage(memoryValues),
                    min: Math.min(...memoryValues),
                    max: Math.max(...memoryValues),
                    median: this.calculateMedian(memoryValues),
                    peak: Math.max(...memoryValues),
                    limit: stats[0]?.memory_limit || 0
                },
                network: {
                    totalRx: Math.max(...networkRxValues) - Math.min(...networkRxValues),
                    totalTx: Math.max(...networkTxValues) - Math.min(...networkTxValues),
                    avgRxRate: this.calculateNetworkRate(networkRxValues, stats),
                    avgTxRate: this.calculateNetworkRate(networkTxValues, stats)
                }
            };
        }

        return summary;
    }

    // Utility methods for statistical calculations
    private calculateAverage(values: number[]): number {
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
        const avg = this.calculateAverage(values);
        const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    private calculateThroughput(): number {
        if (!this.simulationState) return 0;
        const duration = (Date.now() - this.simulationState.startTime) / 1000; // seconds
        const totalObjects = Object.values(this.simulationState.profileStates)
            .reduce((sum, state) => sum + state.downloadedObjects.length, 0);
        return duration > 0 ? totalObjects / duration : 0;
    }

    private calculateRequestsPerSecond(): number {
        if (!this.simulationState) return 0;
        const duration = (Date.now() - this.simulationState.startTime) / 1000;
        const totalRequests = Object.values(this.simulationState.profileStates)
            .reduce((sum, state) => sum + (state.totalRequests || 0), 0);
        return duration > 0 ? totalRequests / duration : 0;
    }

    private calculateNetworkRate(values: number[], stats: DockerStats[]): number {
        if (values.length < 2 || stats.length < 2) return 0;
        const timeDiff = (stats[stats.length - 1].timestamp - stats[0].timestamp) / 1000; // seconds
        const dataDiff = Math.max(...values) - Math.min(...values);
        return timeDiff > 0 ? dataDiff / timeDiff : 0;
    }

    // Existing methods (sendPointToWebSocket, processObjectIds, etc.) remain unchanged
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
}