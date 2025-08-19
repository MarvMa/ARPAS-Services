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

// Specific type for the raw location data format we're parsing
export interface RawLocationData {
    sensor?: string;
    latitude?: string | number;
    longitude?: string | number;
    time?: string | number;
    speed?: string | number;
    altitude?: string | number;
    altitudeAboveMeanSeaLevel?: string | number;
    bearing?: string | number;
    horizontalAccuracy?: string | number;
    verticalAccuracy?: string | number;
    bearingAccuracy?: string | number;
    speedAccuracy?: string | number;
    seconds_elapsed?: string | number;

    // Fallback for generic parsing
    lat?: string | number;
    lng?: string | number;
    lon?: string | number;
    timestamp?: string | number;
    heading?: string | number;
    accuracy?: string | number;

    [key: string]: any; // Allow additional fields
}

// Metadata entry type
export interface LocationMetadata {
    "device id"?: string;
    version?: string;
    sensor: "Metadata" | "metadata";
    "device name"?: string;
    sampleRateMs?: string;
    "recording epoch time"?: string;
    "recording time"?: string;
    platform?: string;
    standardisation?: string;
    "recording timezone"?: string;
    appVersion?: string;
    sensors?: string;
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

// Type for the raw API response from storage service
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

// Type guard to validate storage object response
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
    sizeBytes: number;
    timestamp: number;
    simulationType: 'optimized' | 'unoptimized';
    simulationId: string;
    downloadSource?: 'cache' | 'minio' | 'unknown' | 'baseline' | 'error';
    cacheHit?: boolean;
    networkLatencyMs?: number;
    compressionRatio?: number;
    error?: string;
    isBaseline?: boolean;
}

export interface SimulationResults {
    simulationId: string;
    simulationType: 'optimized' | 'unoptimized';
    startTime: number;
    endTime: number;
    duration?: number;
    profiles: Profile[];
    metrics: ObjectMetric[];

    // Basic counters
    totalObjects: number;
    uniqueObjects: number;
    totalRequests?: number;
    successfulRequests?: number;
    failedRequests?: number;
    baselineRequests?: number;

    // Latency statistics
    averageLatency: number;
    averageServerLatency?: number;
    averageClientLatency?: number;
    minLatency?: number;
    maxLatency?: number;
    medianLatency?: number;
    p95Latency?: number;
    p99Latency?: number;
    latencyStandardDeviation?: number;

    // Cache performance
    cacheHitRate?: number;
    cacheHits?: number;
    cacheMisses?: number;
    cacheEfficiency?: number;

    // Data transfer
    totalDataSize: number;
    averageObjectSize?: number;
    totalDataTransferred?: number;

    // Success rates
    successRate?: number;
    errorRate?: number;

    // Performance insights
    throughput?: number;
    requestsPerSecond?: number;

    // Infrastructure metrics
    dockerStats?: any;
    detailedDockerStats?: any;

    // Profile-specific statistics
    profileStatistics?: Record<string, any>;

    // Configuration
    configuration?: {
        optimized: boolean;
        interval: number;
        profileCount: number;
        totalDataPoints: number;
        processedDataPoints: number;
    };
}

// Validation types
export interface ParsedLocationResult {
    success: boolean;
    dataPoints: DataPoint[];
    errors: string[];
    skippedEntries: number;
    totalEntries: number;
}

export interface ProfileStatistics {
    totalPoints: number;
    duration: number; // in milliseconds
    distance: number; // in meters
    averageSpeed: number; // in m/s
    bounds: {
        minLat: number;
        maxLat: number;
        minLng: number;
        maxLng: number;
    };
    timeRange: {
        start: Date;
        end: Date;
    };
}

// Performance Analysis Types
export interface PerformanceAnalysis {
    optimized: StatisticalAnalysis;
    unoptimized: StatisticalAnalysis;
    comparison: ComparisonResults;
    totalSimulations: number;
    summary: string;
    charts: ChartData[];
}

export interface StatisticalAnalysis {
    totalSimulations: number;
    averageLatency: number;
    minLatency: number;
    maxLatency: number;
    medianLatency: number;
    p95Latency: number;
    p99Latency: number;
    latencyStandardDeviation: number;
    totalObjects: number;
    uniqueObjects: number;
    totalDataSize: number;
    averageDataSize: number;
    cacheHitRate: number;
    throughput: number;
    requestsPerSecond: number;
    errorRate: number;
    successRate: number;
}

export interface ComparisonResults {
    latencyImprovementPercent: number;
    throughputImprovementPercent: number;
    cacheEffectiveness: number;
    dataSizeReductionPercent: number;
    performanceGain: 'significant_improvement' | 'moderate_improvement' | 'no_improvement' | 'regression';
    recommendation: string;
}

export interface ChartData {
    type: 'line' | 'bar' | 'pie' | 'scatter' | 'histogram';
    title: string;
    description: string;
    data: any[];
    labels?: string[];
    datasets?: any[];
    options?: any;
}

// Docker Statistics Types
export interface DockerContainerStats {
    sampleCount: number;
    cpu: {
        average: number;
        min: number;
        max: number;
        median: number;
        standardDeviation: number;
    };
    memory: {
        average: number;
        min: number;
        max: number;
        median: number;
        peak: number;
        limit: number;
    };
    network: {
        totalRx: number;
        totalTx: number;
        avgRxRate: number;
        avgTxRate: number;
    };
}

// Benchmark Report Types
export interface BenchmarkReport {
    metadata: {
        generatedAt: string;
        version: string;
        totalSimulations: number;
        optimizedSimulations: number;
        unoptimizedSimulations: number;
    };
    executive: {
        summary: string;
        keyFindings: string[];
        recommendations: string[];
        performanceGain: string;
    };
    analysis: PerformanceAnalysis;
    rawData: {
        simulations: SimulationResults[];
        aggregatedMetrics: ObjectMetric[];
    };
    charts: ChartData[];
    infrastructure: {
        dockerStats: Record<string, DockerContainerStats>;
        systemResource: {
            averageCpuUsage: number;
            peakMemoryUsage: number;
            networkThroughput: number;
        };
    };
}