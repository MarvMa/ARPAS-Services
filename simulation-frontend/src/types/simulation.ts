// Bereinigte types/simulation.ts - nur essenzielle Types

export interface Profile {
    id: string;
    name: string;
    data: DataPoint[];
    color: string;
    isVisible: boolean;
}

export interface DataPoint {
    lat: number;
    lng: number;
    timestamp: number;
    speed?: number;
    altitude?: number;
    bearing?: number;
    horizontalAccuracy?: number;
    verticalAccuracy?: number;
}

export interface Object3D {
    ID: string;
    OriginalFilename: string;
    ContentType: string;
    Size: number;
    StorageKey: string;
    UploadedAt: string;
    latitude?: number;
    longitude?: number;
    altitude?: number;
}

export interface InterpolatedPoint extends DataPoint {
    isInterpolated: boolean;
}

export interface SimulationConfig {
    profiles: Profile[];
    optimized: boolean;
    intervalMs: number;
}

export interface SimulationState {
    isRunning: boolean;
    currentTime: number;
    startTime: number;
    profileStates: Record<string, ProfileSimulationState>;
    optimized?: boolean;
    totalDataPoints?: number;
    processedDataPoints?: number;
    interval?: number;
}

export interface ProfileSimulationState {
    profileId: string;
    currentIndex: number;
    websocket?: WebSocket;
    downloadedObjects: string[];
    metrics: ObjectMetric[];
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    cacheHits: number;
    cacheMisses: number;
}

export interface ObjectMetric {
    objectId: string;
    profileId: string;
    downloadLatencyMs: number;
    serverLatencyMs?: number;
    clientLatencyMs?: number;
    networkLatencyMs?: number;
    sizeBytes: number;
    timestamp: number;
    simulationType: 'optimized' | 'unoptimized';
    simulationId: string;
    downloadSource?: 'cache' | 'minio' | 'unknown' | 'baseline' | 'error';
    cacheHit?: boolean;
    compressionRatio?: number;
    error?: string;
    isBaseline?: boolean;
}

export interface ScientificMetrics {
    simulationId: string;
    simulationType: 'optimized' | 'unoptimized';
    timestamp: string;
    duration: {
        startTime: number;
        endTime: number;
        totalMs: number;
    };
    configuration: {
        profileCount: number;
        intervalMs: number;
        totalDataPoints: number;
        objectCount: number;
    };

    objectMetrics: {
        [objectId: string]: {
            downloads: Array<{
                profileId: string;
                timestamp: number;
                latency: {
                    total: number;
                    server: number;
                    client: number;
                    network: number;
                };
                cacheHit: boolean;
                downloadSource: string;
                sizeBytes: number;
                success: boolean;
                error?: string;
            }>;
            statistics: {
                totalDownloads: number;
                uniqueProfiles: number;
                averageLatency: number;
                minLatency: number;
                maxLatency: number;
                p95Latency: number;
                cacheHitRate: number;
                successRate: number;
            };
        };
    };

    // Docker metrics time series (per second)
    dockerTimeSeries: {
        [containerName: string]: Array<{
            timestamp: number;
            cpu: {
                usage: number;
                percent: number;
            };
            memory: {
                usage: number;
                limit: number;
                percent: number;
            };
            network: {
                rxBytes: number;
                txBytes: number;
                rxRate: number;
                txRate: number;
            };
        }>;
    };

    // Aggregated statistics
    aggregatedStats: {
        latency: {
            mean: number;
            median: number;
            stdDev: number;
            p50: number;
            p75: number;
            p90: number;
            p95: number;
            p99: number;
            min: number;
            max: number;
        };
        throughput: {
            objectsPerSecond: number;
            bytesPerSecond: number;
            requestsPerSecond: number;
        };
        cache: {
            hitRate: number;
            totalHits: number;
            totalMisses: number;
            efficiency: number;
        };
        success: {
            rate: number;
            totalSuccess: number;
            totalFailure: number;
        };
    };

    // Profile-specific metrics
    profileMetrics: {
        [profileId: string]: {
            name: string;
            totalObjects: number;
            uniqueObjects: number;
            totalLatency: number;
            averageLatency: number;
            cacheHitRate: number;
            errorRate: number;
            dataTransferred: number;
        };
    };
}

export interface StorageObjectResponse {
    ID: string;
    OriginalFilename: string;
    ContentType: string;
    Size: number;
    StorageKey: string;
    UploadedAt: string;
    latitude?: number;
    longitude?: number;
    altitude?: number;
}

export function isValidStorageObject(obj: any): obj is StorageObjectResponse {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        typeof obj.ID === 'string' &&
        typeof obj.OriginalFilename === 'string' &&
        typeof obj.ContentType === 'string' &&
        typeof obj.Size === 'number' &&
        typeof obj.StorageKey === 'string' &&
        typeof obj.UploadedAt === 'string' &&
        (obj.latitude === undefined || typeof obj.latitude === 'number') &&
        (obj.longitude === undefined || typeof obj.longitude === 'number') &&
        (obj.altitude === undefined || typeof obj.altitude === 'number')
    );
}