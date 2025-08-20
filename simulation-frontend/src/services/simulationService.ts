import axios from 'axios';
import {
    Profile,
    DataPoint,
    SimulationConfig,
    SimulationState,
    ProfileSimulationState,
    ObjectMetric,
    Object3D,
    ScientificMetrics
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
    private availableObjects: Object3D[] = [];
    private profiles: Profile[] = [];
    private downloadedObjectsPerProfile: Map<string, Set<string>> = new Map();

    // Scientific tracking
    private objectDownloadTracking: Map<string, Map<string, Set<string>>> = new Map();
    private dockerTimeSeriesData: Map<string, any[]> = new Map();
    private dockerCollectionInterval: number | null = null;
    private baselineMetrics: Map<string, ObjectMetric[]> = new Map();
    
    

    constructor() {
        this.dataCollector = new DataCollector();
    }

    setAvailableObjects(objects: Object3D[]): void {
        this.availableObjects = objects;
        console.log(`Available objects for simulation: ${objects.length}`);
    }

    setProfiles(profiles: Profile[]): void {
        this.profiles = profiles;
    }

    /**
     * Starts a new real-time simulation
     */
    async startSimulation(config: SimulationConfig): Promise<string> {
        if (this.simulationState?.isRunning) {
            throw new Error('Simulation is already running');
        }

        const simulationId = this.generateSimulationId();
        console.log(`Starting ${config.optimized ? 'optimized' : 'unoptimized'} simulation: ${simulationId}`);

        // Clear previous data
        this.downloadedObjectsPerProfile.clear();
        this.objectDownloadTracking.clear();
        this.profileWebSockets.clear();
        this.dockerTimeSeriesData.clear();
        this.baselineMetrics.clear();

        // Start Docker stats collection
        this.startEnhancedDockerStatsCollection();

        const simulationStartTime = Date.now();

        // Initialize simulation state
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

        // Initialize profile states
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

        // Start simulation
        const allStartTimes = config.profiles
            .filter(p => p.data.length > 0)
            .map(p => Math.min(...p.data.map(d => d.timestamp)));
        const earliestStartTime = allStartTimes.length > 0 ? Math.min(...allStartTimes) : Date.now();

        this.startRealTimeSimulation(config, earliestStartTime, simulationStartTime);

        return simulationId;
    }

    /**
     * Stop simulation and collect scientific metrics
     */
    async stopSimulation(): Promise<ScientificMetrics | null> {
        if (!this.simulationState) {
            return null;
        }

        console.log('Stopping simulation and collecting scientific metrics...');

        // Collect metrics BEFORE clearing state
        const metrics = await this.collectScientificMetrics();

        // Stop intervals
        if (this.simulationIntervalId) {
            clearInterval(this.simulationIntervalId);
            this.simulationIntervalId = null;
        }

        if (this.dockerCollectionInterval) {
            clearInterval(this.dockerCollectionInterval);
            this.dockerCollectionInterval = null;
        }

        // Close WebSockets
        this.profileWebSockets.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });
        this.profileWebSockets.clear();

        try {
            await this.dataCollector.saveScientificResults(metrics);
            console.log('Metrics saved successfully');
        } catch (error) {
            console.error('Failed to save metrics, retrying...', error);
            // Retry once
            try {
                await new Promise(resolve => setTimeout(resolve, 1000));
                await this.dataCollector.saveScientificResults(metrics);
                console.log('Metrics saved on retry');
            } catch (retryError) {
                console.error('Failed to save metrics after retry:', retryError);
                // Still return the metrics even if save failed
            }
        }

        // Save to data collector
        await this.dataCollector.saveScientificResults(metrics);

        // Clean up
        this.downloadedObjectsPerProfile.clear();
        this.dockerTimeSeriesData.clear();
        this.simulationState = null;

        return metrics;
    }

    /**
     * Enhanced Docker stats collection - every second
     */
    private startEnhancedDockerStatsCollection(): void {
        const simulationType = this.simulationState?.optimized ? 'optimized' : 'unoptimized';
        console.log(`Starting Docker metrics collection for ${simulationType} simulation`);

        this.dockerTimeSeriesData.clear();

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
                            rxRate: 0,
                            txRate: 0
                        }
                    };

                    const timeSeries = this.dockerTimeSeriesData.get(containerName)!;
                    if (timeSeries.length > 0) {
                        const previous = timeSeries[timeSeries.length - 1];
                        const timeDiff = (timestamp - previous.timestamp) / 1000;
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
     * Fetch Docker stats for specific containers
     */
    private async fetchFilteredDockerStats(containerNames: string[]): Promise<Record<string, DockerStats>> {
        try {
            const response = await axios.get<DockerStatsResponse>('http://localhost/api/docker/stats', {
                timeout: 5000
            });

            const filteredStats: Record<string, DockerStats> = {};

            if (response.data?.containers) {
                response.data.containers.forEach(container => {
                    const shouldMonitor = containerNames.some(name =>
                        container.name.toLowerCase().includes(name.toLowerCase())
                    );

                    if (shouldMonitor) {
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
     * Establish WebSocket connection for optimized mode
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
                console.log(`WebSocket connected for profile: ${profileName}`);
                this.profileWebSockets.set(profileId, ws);
                cleanup();
                resolve();
            };

            ws.onmessage = async (event) => {
                try {
                    const response: PredictionResponse = JSON.parse(event.data);
                    let objectIds: string[] = [];

                    if (response.objectIds && Array.isArray(response.objectIds)) {
                        objectIds = response.objectIds
                            .filter((id): id is string | number => id !== null && id !== undefined)
                            .map(id => String(id));
                    } else if (Array.isArray(response)) {
                        objectIds = response
                            .filter((id): id is string | number => id !== null && id !== undefined)
                            .map(id => String(id));
                    }

                    const profileState = this.simulationState?.profileStates[profileId];
                    if (profileState) {
                        profileState.totalRequests++;
                        if (objectIds.length > 0) {
                            profileState.successfulRequests++;
                            await this.processObjectIds(objectIds, profileId);
                        } else {
                            await this.recordBaselineMetric(profileId);
                        }
                    }
                } catch (error) {
                    console.error(`Error processing WebSocket message:`, error);
                    const profileState = this.simulationState?.profileStates[profileId];
                    if (profileState) {
                        profileState.failedRequests++;
                    }
                }
            };

            ws.onerror = (error) => {
                console.error(`WebSocket error for ${profileName}:`, error);
                cleanup();
                resolve();
            };

            ws.onclose = () => {
                console.log(`WebSocket closed for: ${profileName}`);
                this.profileWebSockets.delete(profileId);
                cleanup();
            };

            connectionTimeout = window.setTimeout(() => {
                console.warn(`WebSocket timeout for ${profileName}`);
                ws.close();
                resolve();
            }, 10000);
        });
    }

    /**
     * Process object IDs received from prediction
     */
    private async processObjectIds(objectIds: string[], profileId: string): Promise<void> {
        const downloadPromises = objectIds.map(objectId =>
            this.downloadObject(objectId, profileId)
        );
        await Promise.all(downloadPromises);
    }

    /**
     * Download object with deduplication
     */
    private async downloadObject(objectId: string, profileId: string): Promise<void> {
        // Check if this profile has already downloaded this object
        const profileDownloads = this.downloadedObjectsPerProfile.get(profileId);
        if (!profileDownloads) {
            this.downloadedObjectsPerProfile.set(profileId, new Set<string>());
        }

        const downloads = this.downloadedObjectsPerProfile.get(profileId)!;
        if (downloads.has(objectId)) {
            console.log(`Object ${objectId} already downloaded for profile ${profileId}, skipping`);
            return;
        }

        const startTime = performance.now();
        const profileState = this.simulationState?.profileStates[profileId];
        if (!profileState) return;

        try {
            const headers: any = {};
            if (this.simulationState?.optimized) {
                headers['X-Optimization-Mode'] = 'optimized';
                headers['X-Profile-Id'] = profileId;
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

            const downloadSource = response.headers['x-download-source'] || 'unknown';
            const serverLatency = parseInt(response.headers['x-download-latency-ms'] || '0');
            const networkLatency = parseInt(response.headers['x-network-latency-ms'] || '0');
            const cacheHit = downloadSource === 'cache';

            // Mark as downloaded for this profile
            downloads.add(objectId);
            profileState.downloadedObjects.push(objectId);

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
                clientLatencyMs: Math.max(0, totalLatency - serverLatency - networkLatency),
                networkLatencyMs: networkLatency,
                sizeBytes,
                timestamp: Date.now(),
                simulationType: this.simulationState?.optimized ? 'optimized' : 'unoptimized',
                simulationId: this.getCurrentSimulationId(),
                downloadSource,
                cacheHit,
                isBaseline: false
            };

            profileState.metrics.push(metric);
            console.log(`Downloaded ${objectId} for ${profileId}: ${totalLatency.toFixed(2)}ms from ${downloadSource} (${downloads.size} unique downloads for this profile)`);

        } catch (error) {
            const endTime = performance.now();
            const latency = endTime - startTime;

            // Still mark as attempted to avoid retry
            downloads.add(objectId);
            profileState.failedRequests++;

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
                simulationId: this.getCurrentSimulationId(),
                downloadSource: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
                isBaseline: false
            };

            profileState.metrics.push(failureMetric);
            console.error(`Failed to download ${objectId} for ${profileId}:`, error);
        }
    }

    /**
     * Record baseline metric when no objects found
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

        this.baselineMetrics.get(profileId)?.push(baselineMetric);
    }

    /**
     * Start real-time simulation
     */
    private startRealTimeSimulation(
        config: SimulationConfig,
        _earliestStartTime: number,
        simulationStartTime: number
    ): void {
        const profileTimings = new Map<string, {
            profile: Profile;
            sortedData: DataPoint[];
            currentSegmentIndex: number;
            lastUpdateTime: number;
        }>();

        config.profiles.forEach(profile => {
            if (profile.data.length < 1) return;
            const sortedData = [...profile.data].sort((a, b) => a.timestamp - b.timestamp);
            profileTimings.set(profile.id, {
                profile,
                sortedData,
                currentSegmentIndex: 0,
                lastUpdateTime: simulationStartTime
            });
        });

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

                    const currentSimulationTime = timing.sortedData[0].timestamp + elapsedRealTime;
                    let currentSegmentIndex = timing.currentSegmentIndex;

                    while (currentSegmentIndex < timing.sortedData.length - 1 &&
                    timing.sortedData[currentSegmentIndex + 1].timestamp <= currentSimulationTime) {
                        currentSegmentIndex++;
                        if (this.simulationState) {
                            this.simulationState.processedDataPoints =
                                (this.simulationState.processedDataPoints || 0) + 1;
                        }
                    }

                    timing.currentSegmentIndex = currentSegmentIndex;
                    profileState.currentIndex = currentSegmentIndex;

                    if (currentSegmentIndex >= timing.sortedData.length - 1) {
                        return;
                    }

                    const currentPoint = timing.sortedData[currentSegmentIndex];
                    const nextPoint = timing.sortedData[currentSegmentIndex + 1];
                    const segmentDuration = nextPoint.timestamp - currentPoint.timestamp;
                    const segmentElapsed = currentSimulationTime - currentPoint.timestamp;
                    const progress = segmentDuration > 0 ? Math.max(0, Math.min(1, segmentElapsed / segmentDuration)) : 0;

                    const interpolatedPoint: DataPoint = {
                        lat: currentPoint.lat + (nextPoint.lat - currentPoint.lat) * progress,
                        lng: currentPoint.lng + (nextPoint.lng - currentPoint.lng) * progress,
                        timestamp: currentSimulationTime,
                        speed: this.interpolateValue(currentPoint.speed, nextPoint.speed, progress),
                        altitude: this.interpolateValue(currentPoint.altitude, nextPoint.altitude, progress),
                        bearing: this.interpolateBearing(currentPoint.bearing, nextPoint.bearing, progress)
                    };

                    if (config.optimized) {
                        await this.sendPointToWebSocket(profileId, interpolatedPoint);
                    } else {
                        await this.processUnoptimizedDetection(profileId, interpolatedPoint);
                    }
                }
            );

            await Promise.all(profileProcessingPromises);

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
     * Send point to WebSocket
     */
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
                console.error(`Failed to send data to WebSocket:`, error);
            }
        }
    }

    /**
     * Process unoptimized detection
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
        } else {
            await this.recordBaselineMetric(profileId, detectionLatency);
        }
    }

    /**
     * Find objects within distance
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
     * Collect comprehensive scientific metrics
     */
    private async collectScientificMetrics(): Promise<ScientificMetrics> {
        if (!this.simulationState) {
            throw new Error('No simulation state available');
        }

        const simulationId = this.getCurrentSimulationId();
        const simulationType = this.simulationState.optimized ? 'optimized' : 'unoptimized';

        // Build object metrics
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
        Object.entries(objectMetrics).forEach(([_objectId, data]) => {
            const downloads = data.downloads;
            const latencies = downloads.map(d => d.latency.total);
            const successfulDownloads = downloads.filter(d => d.success);
            const cacheHits = downloads.filter(d => d.cacheHit);

            data.statistics = {
                totalDownloads: downloads.length,
                uniqueProfiles: new Set(downloads.map(d => d.profileId)).size,
                averageLatency: this.calculateMean(latencies),
                minLatency: Math.min(...latencies),
                maxLatency: Math.max(...latencies),
                p95Latency: this.calculatePercentile(latencies, 95),
                cacheHitRate: (cacheHits.length / downloads.length) * 100,
                successRate: (successfulDownloads.length / downloads.length) * 100
            };
        });

        // Docker time series
        const dockerTimeSeries: ScientificMetrics['dockerTimeSeries'] = {};
        this.dockerTimeSeriesData.forEach((timeSeries, containerName) => {
            dockerTimeSeries[containerName] = timeSeries;
        });

        // Aggregated statistics
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
                hitRate: successfulMetrics.length > 0
                    ? (successfulMetrics.filter(m => m.cacheHit).length / successfulMetrics.length) * 100
                    : 0,
                totalHits: successfulMetrics.filter(m => m.cacheHit).length,
                totalMisses: successfulMetrics.filter(m => !m.cacheHit).length,
                efficiency: 0
            },
            success: {
                rate: allMetrics.length > 0 ? (successfulMetrics.length / allMetrics.length) * 100 : 0,
                totalSuccess: successfulMetrics.length,
                totalFailure: allMetrics.length - successfulMetrics.length
            }
        };

        // Profile metrics
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
                cacheHitRate: (state.cacheHits + state.cacheMisses) > 0
                    ? (state.cacheHits / (state.cacheHits + state.cacheMisses)) * 100
                    : 0,
                errorRate: state.totalRequests > 0
                    ? (state.failedRequests / state.totalRequests) * 100
                    : 0,
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

    // Helper methods
    private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    private interpolateValue(start?: number, end?: number, progress: number = 0): number | undefined {
        if (start === undefined || end === undefined) return start || end;
        return start + (end - start) * progress;
    }

    private interpolateBearing(start?: number, end?: number, progress: number = 0): number | undefined {
        if (start === undefined || end === undefined) return start || end;
        let diff = end - start;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        let result = start + diff * progress;
        if (result < 0) result += 360;
        if (result >= 360) result -= 360;
        return result;
    }

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