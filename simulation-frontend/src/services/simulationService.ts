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
import {DockerMetricsService} from "./dockerMetricsService.ts";

interface PredictionResponse {
    status: string;
    message: string;
    objectIds: (string | number | null)[];
}


export class SimulationService {
    private dataCollector: DataCollector;
    private simulationState: SimulationState | null = null;
    private simulationIntervalId: number | null = null;
    private profileWebSockets: Map<string, WebSocket> = new Map();
    private availableObjects: Object3D[] = [];
    private profiles: Profile[] = [];
    private downloadedObjectsPerProfile: Map<string, Set<string>> = new Map();
    private dockerMetricsService?: DockerMetricsService;
    private activeDownloads = new Map<string, Promise<void>>();
    private webSocketThrottling = new Map<string, {
        lastSent: number;
        pendingPoint?: DataPoint;
        throttleTimer?: number;
    }>();

    private readonly WS_THROTTLE_MS = 150; // Max one message per 150ms per profile

    // Scientific tracking
    private objectDownloadTracking: Map<string, Map<string, Set<string>>> = new Map();
    private baselineMetrics: Map<string, ObjectMetric[]> = new Map();

    constructor() {
        this.dataCollector = new DataCollector();
    }

    setDockerMetricsService(service: DockerMetricsService): void {
        this.dockerMetricsService = service;
        console.log('Docker metrics service configured for simulation tracking');
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
        this.baselineMetrics.clear();

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

        // Stop all intervals and timers
        if (this.simulationIntervalId) {
            clearInterval(this.simulationIntervalId);
            this.simulationIntervalId = null;
        }

        // Clear WebSocket throttling timers
        this.webSocketThrottling.forEach((throttleData) => {
            if (throttleData.throttleTimer) {
                clearTimeout(throttleData.throttleTimer);
            }
        });
        this.webSocketThrottling.clear();

        const closePromises = Array.from(this.profileWebSockets.entries()).map(([_, ws]) => {
            return new Promise<void>((resolve) => {
                if (ws.readyState === WebSocket.CLOSED) {
                    resolve();
                    return;
                }

                const cleanup = () => {
                    ws.removeEventListener('close', cleanup);
                    ws.removeEventListener('error', cleanup);
                    resolve();
                };

                ws.addEventListener('close', cleanup);
                ws.addEventListener('error', cleanup);

                // Force close if not already closing/closed
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                    ws.close(1000, 'Simulation stopped');
                }

                // Fallback timeout
                setTimeout(cleanup, 1000);
            });
        });

        // Wait for all WebSockets to close
        await Promise.all(closePromises);
        this.profileWebSockets.clear();

        // CLEANUP 4: Clear all download tracking
        this.activeDownloads.clear();
        this.downloadedObjectsPerProfile.clear();
        this.objectDownloadTracking.clear();
        this.baselineMetrics.clear();


        console.log('Stopping simulation and collecting scientific metrics...');

        // Store simulation timing for Docker metrics collection
        const simulationStartTime = this.simulationState.startTime;
        const simulationEndTime = Date.now();
        const simulationType = this.simulationState.optimized ? 'optimized' : 'unoptimized';

        // Stop intervals
        if (this.simulationIntervalId) {
            clearInterval(this.simulationIntervalId);
            this.simulationIntervalId = null;
        }

        // Close WebSockets
        this.profileWebSockets.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });
        this.profileWebSockets.clear();

        // Collect scientific metrics first (without Docker data)
        const preliminaryMetrics = await this.collectScientificMetrics();

        // Collect Docker metrics after simulation end
        console.log('Collecting Docker metrics from Prometheus...');
        const dockerMetrics = await this.collectDockerMetricsFromPrometheus(
            simulationStartTime,
            simulationEndTime,
            simulationType
        );

        // Combine metrics with Docker data
        const finalMetrics: ScientificMetrics = {
            ...preliminaryMetrics,
            dockerTimeSeries: dockerMetrics
        };

        this.simulationState = null;

        try {
            await this.dataCollector.saveScientificResults(finalMetrics);
            console.log('Metrics saved successfully');
        } catch (error) {
            console.error('Failed to save metrics, retrying...', error);
            // Retry once
            try {
                await new Promise(resolve => setTimeout(resolve, 1000));
                await this.dataCollector.saveScientificResults(finalMetrics);
                console.log('Metrics saved on retry');
            } catch (retryError) {
                console.error('Failed to save metrics after retry:', retryError);
                // Still return the metrics even if save failed
            }
        }

        // Clean up
        this.downloadedObjectsPerProfile.clear();
        this.simulationState = null;

        return finalMetrics;
    }

    /**
     * Collect Docker metrics from Prometheus after simulation completion
     */
    private async collectDockerMetricsFromPrometheus(
        startTime: number,
        endTime: number,
        simulationType: 'optimized' | 'unoptimized'
    ): Promise<ScientificMetrics['dockerTimeSeries']> {
        if (!this.dockerMetricsService) {
            console.warn('Docker metrics service not available, skipping Docker metrics collection');
            return {};
        }

        try {
            const response = await this.dockerMetricsService.fetchHistoricalMetrics(
                startTime,
                endTime,
                simulationType
            );

            const dockerTimeSeries = this.dockerMetricsService.transformToScientificFormat(response);

            // Log statistics for debugging
            const stats = this.dockerMetricsService.calculateDockerStats(dockerTimeSeries);
            console.log('Docker metrics statistics:', stats);

            return dockerTimeSeries;

        } catch (error) {
            console.error('Failed to collect Docker metrics:', error);
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
     * Download object from storage service by ID
     */
    private async downloadObject(objectId: string, profileId: string): Promise<void> {
        const downloadKey = `${profileId}_${objectId}`;

        // Fix Race Condition: Check if download is already in progress for this profile+object
        if (this.activeDownloads.has(downloadKey)) {
            // Wait for existing download to complete
            return this.activeDownloads.get(downloadKey)!;
        }

        if (!this.downloadedObjectsPerProfile.has(profileId)) {
            this.downloadedObjectsPerProfile.set(profileId, new Set<string>());
        }
        
        const profileDownloads = this.downloadedObjectsPerProfile.get(profileId)!;
        if (profileDownloads.has(objectId)) {
            return;
        }
        

        // Create and track download promise
        const downloadPromise = this.executeDownload(objectId, profileId);
        this.activeDownloads.set(downloadKey, downloadPromise);

        try {
            await downloadPromise;
        } finally {
            this.activeDownloads.delete(downloadKey);
        }
    }

    private async executeDownload(objectId: string, profileId: string): Promise<void> {
        const profileState = this.simulationState?.profileStates[profileId];
        if (!profileState) return;

        // Final Race-Condition Check: Ensure not already downloaded 
        const downloads = this.downloadedObjectsPerProfile.get(profileId)!;
        if (downloads.has(objectId)) {
            return;
        }

        let startTime = performance.now();
        let TTFBms = 0;
        let sawFirstByte = false;
        try {
            const headers: any = {};
            if (this.simulationState?.optimized) {
                headers['X-Optimization-Mode'] = 'optimized';
                headers['X-Profile-Id'] = profileId;
            }
            startTime = performance.now();
            const response = await axios.get(
                `http://localhost/api/storage/objects/${objectId}/download`,
                {
                    responseType: 'blob',
                    timeout: 30000,
                    headers: headers,
                    onDownloadProgress: () => {
                        if (!sawFirstByte) {
                            TTFBms = performance.now() - startTime;
                            sawFirstByte = true;
                        }
                    },
                }
            );
            const totalLatency = performance.now() - startTime;

            const sizeBytes = response.data.size || 0;

            const extractHeaderValue = (headerName: string): number => {
                const value = response.headers[headerName.toLowerCase()] ||
                    response.headers[headerName] ||
                    response.headers[headerName.toUpperCase()];
                const parsed = parseFloat(value);
                return isNaN(parsed) ? 0 : parsed;
            };

            const extractHeaderString = (headerName: string): string | undefined => {
                const value = response.headers[headerName.toLowerCase()] ||
                    response.headers[headerName] ||
                    response.headers[headerName.toUpperCase()];
                return value || undefined;
            };


            const downloadSource = extractHeaderString('x-download-source') || 'unknown';
            const serverLatency = extractHeaderValue('x-total-latency-ms');
            const cacheHit = extractHeaderString('x-cache-hit') === 'true';
            const contentLength = extractHeaderValue('content-length');


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
                timeToFirstByteMs: TTFBms,
                sizeBytes: sizeBytes,
                timestamp: Date.now(),
                simulationType: this.simulationState?.optimized ? 'optimized' : 'unoptimized',
                simulationId: this.getCurrentSimulationId(),
                downloadSource: downloadSource,
                cacheHit: cacheHit,
                success: true,
            };

            profileState.metrics.push(metric);

            console.log(`Downloaded ${objectId} for ${profileId}:`, {
                totalLatency: `${totalLatency.toFixed(2)}ms`,
                serverLatency: `${serverLatency.toFixed(2)}ms`,
                source: downloadSource,
                cacheHit: cacheHit,
                size: `${(contentLength / 1024).toFixed(2)}KB`,
                uniqueDownloads: downloads.size,
                headers: response.headers
            });
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
                timeToFirstByteMs: TTFBms,
                sizeBytes: 0,
                timestamp: Date.now(),
                simulationType: this.simulationState?.optimized ? 'optimized' : 'unoptimized',
                simulationId: this.getCurrentSimulationId(),
                downloadSource: 'error',
                success: false,
            };

            profileState.metrics.push(failureMetric);
            console.error(`Failed to download ${objectId} for ${profileId}:`, error);
        }
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

    private async sendPointToWebSocket(profileId: string, point: DataPoint): Promise<void> {
        const ws = this.profileWebSockets.get(profileId);
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const now = performance.now();
        let throttleData = this.webSocketThrottling.get(profileId);

        if (!throttleData) {
            throttleData = {lastSent: 0};
            this.webSocketThrottling.set(profileId, throttleData);
        }

        const timeSinceLastSent = now - throttleData.lastSent;

        if (timeSinceLastSent >= this.WS_THROTTLE_MS) {
            // Send immediately
            this.actualSendToWebSocket(profileId, point, ws);
            throttleData.lastSent = now;
            throttleData.pendingPoint = undefined;

            // Clear any pending timer
            if (throttleData.throttleTimer) {
                clearTimeout(throttleData.throttleTimer);
                throttleData.throttleTimer = undefined;
            }
        } else {
            // Throttle: store latest point and set timer if not already set
            throttleData.pendingPoint = point;

            if (!throttleData.throttleTimer) {
                const remainingWait = this.WS_THROTTLE_MS - timeSinceLastSent;
                throttleData.throttleTimer = window.setTimeout(() => {
                    const currentThrottleData = this.webSocketThrottling.get(profileId);
                    if (currentThrottleData?.pendingPoint) {
                        this.actualSendToWebSocket(profileId, currentThrottleData.pendingPoint, ws);
                        currentThrottleData.lastSent = performance.now();
                        currentThrottleData.pendingPoint = undefined;
                    }
                    if (currentThrottleData) {
                        currentThrottleData.throttleTimer = undefined;
                    }
                }, remainingWait);
            }
        }
    }

    private actualSendToWebSocket(profileId: string, point: DataPoint, ws: WebSocket): void {
        try {
            const data = {
                latitude: Math.round(point.lat * 1000000) / 1000000, // 6 decimal precision
                longitude: Math.round(point.lng * 1000000) / 1000000,
                timestamp: new Date(point.timestamp).toISOString(),
                speed: point.speed || 0,
                altitude: point.altitude || 0,
                heading: point.bearing
            };
            ws.send(JSON.stringify(data));
        } catch (error) {
            console.error(`WebSocket send failed for ${profileId}:`, error);
        }
    }


    /**
     * Process unoptimized detection
     */
    private async processUnoptimizedDetection(profileId: string, currentPoint: DataPoint): Promise<void> {
        const nearbyObjects = this.findObjectsWithinDistance(currentPoint, 10);

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
     * Collect comprehensive scientific metrics (without Docker data)
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
                allMetrics.push(metric);

                if (!objectMetrics[metric.objectId]) {
                    objectMetrics[metric.objectId] = {
                        downloads: [],
                        statistics: {
                            totalDownloads: 0,
                            uniqueProfiles: 0,
                            averageLatency: 0,
                            averageTTFB: 0,
                            minLatency: Infinity,
                            maxLatency: 0,
                            p95Latency: 0,
                            cacheHitRate: 0,
                            successRate: 0,
                        }
                    };
                }

                objectMetrics[metric.objectId].downloads.push({
                    profileId: metric.profileId,
                    timestamp: metric.timestamp,
                    latency: {
                        total: metric.downloadLatencyMs,
                        server: metric.serverLatencyMs || 0,
                        ttfb: metric.timeToFirstByteMs || 0
                    },
                    cacheHit: metric.cacheHit || false,
                    downloadSource: metric.downloadSource || 'unknown',
                    optimizationMode: metric.simulationType,
                    sizeBytes: metric.sizeBytes,
                    success: metric.success,
                });
            });
        });

        // Calculate per-object statistics
        Object.entries(objectMetrics).forEach(([_objectId, data]) => {
            const downloads = data.downloads;
            const latencies = downloads.map(d => d.latency.total);
            const successfulDownloads = downloads.filter(d => d.success);
            const cacheHits = downloads.filter(d => d.cacheHit);

            // data.statistics.detailedLatencies = detailedLatencyStats;
            data.statistics = {
                totalDownloads: downloads.length,
                uniqueProfiles: new Set(downloads.map(d => d.profileId)).size,
                averageLatency: this.calculateMean(latencies),
                averageTTFB: this.calculateMean(downloads.map(d => d.latency.ttfb)),
                minLatency: Math.min(...latencies),
                maxLatency: Math.max(...latencies),
                p95Latency: this.calculatePercentile(latencies, 95),
                cacheHitRate: (cacheHits.length / downloads.length) * 100,
                successRate: (successfulDownloads.length / downloads.length) * 100,
            };


        });

        // Aggregated statistics
        const successfulMetrics = allMetrics.filter(m => m.success);
        const latencies = successfulMetrics.map(m => m.downloadLatencyMs);
        const ttfbs = successfulMetrics.map(m => m.timeToFirstByteMs);
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
            timeToFirstByte:{
                mean: this.calculateMean(ttfbs),
                median: this.calculateMedian(ttfbs),
                stdDev: this.calculateStandardDeviation(ttfbs),
                p50: this.calculatePercentile(ttfbs, 50),
                p75: this.calculatePercentile(ttfbs, 75),
                p90: this.calculatePercentile(ttfbs, 90),
                p95: this.calculatePercentile(ttfbs, 95),
                p99: this.calculatePercentile(ttfbs, 99),
                min: ttfbs.length > 0 ? Math.min(...ttfbs) : 0,
                max: ttfbs.length > 0 ? Math.max(...ttfbs) : 0
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
            const profileSuccessMetrics = state.metrics.filter(m => !m.success);
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
            dockerTimeSeries: {}, // Will be filled with actual Docker data in stopSimulation
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