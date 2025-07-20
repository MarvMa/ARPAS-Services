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

// Union type for entries in the JSON array
export type LocationEntry = RawLocationData | LocationMetadata;

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
}

export interface ProfileSimulationState {
    profileId: string;
    currentIndex: number;
    websocket?: WebSocket;
    downloadedObjects: string[];
    metrics: ObjectMetric[];
}

export interface ObjectMetric {
    objectId: string;
    profileId: string;
    downloadLatencyMs: number;
    sizeBytes: number;
    timestamp: number;
    simulationType: 'optimized' | 'unoptimized';
    simulationId: string;
}

export interface SimulationResults {
    simulationId: string;
    simulationType: 'optimized' | 'unoptimized';
    startTime: number;
    endTime: number;
    profiles: Profile[];
    metrics: ObjectMetric[];
    totalObjects: number;
    uniqueObjects: number;
    averageLatency: number;
    totalDataSize: number;
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