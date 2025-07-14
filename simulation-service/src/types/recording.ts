export interface LocationData {
    speed: string;
    bearing: string;
    sensor: string;
    bearingAccuracy: string;
    longitude: string;
    latitude: string;
    verticalAccuracy: string;
    altitudeAboveMeanSeaLevel: string;
    speedAccuracy: string;
    altitude: string;
    seconds_elapsed: string;
    horizontalAccuracy: string;
    time: string;
}

export interface MetadataEntry {
    "device id": string;
    version: string;
    sensor: string;
    "device name": string;
    sampleRateMs: string;
    "recording epoch time": string;
    "recording time": string;
    platform: string;
    standardisation: string;
    "recording timezone": string;
    appVersion: string;
    sensors: string;
}

export interface RecordingEntry extends LocationData {}

export interface RecordingData extends Array<LocationData | MetadataEntry> {}

export interface RecordingMetadata {
    deviceId?: string;
    deviceName?: string;
    platform?: string;
    appVersion?: string;
    recordingTime?: string;
    timezone?: string;
    version?: string;
    sensors?: string;
}

export interface ProcessedRecording {
    id: string;
    originalFilename: string;
    color: string;
    duration: number;
    pointCount: number;
    bounds: {
        minLat: number;
        maxLat: number;
        minLon: number;
        maxLon: number;
    };
    metadata?: RecordingMetadata;
    createdAt: Date;
}

export interface PathPoint {
    latitude: number;
    longitude: number;
    altitude: number;
    timestamp: Date;
    speed?: number;
    bearing?: number;
    horizontalAccuracy?: number;
    verticalAccuracy?: number;
}