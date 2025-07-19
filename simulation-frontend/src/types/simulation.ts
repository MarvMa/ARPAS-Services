export interface Profile {
    id: string;
    name: string;
    data: DataPoint[];
    color: string;
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

export interface RawLocationData {
    latitude: string;
    longitude: string;
    time: string;
    speed?: string;
    altitude?: string;
    bearing?: string;
    horizontalAccuracy?: string;
    verticalAccuracy?: string;
    sensor: string;
}

export interface Object3D {
    id: string;
    original_filename: string;
    content_type: string;
    size: number;
    storage_key: string;
    uploaded_at: string;
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
    profileStates: Map<string, ProfileSimulationState>;
}

export interface ProfileSimulationState {
    profileId: string;
    currentIndex: number;
    websocket?: WebSocket;
    downloadedObjects: Set<string>;
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