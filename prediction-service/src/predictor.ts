import KalmanFilter from "kalmanjs";
import {StorageClient} from "./clients/storageClient";


export interface SensorData {
    latitude: number;
    longitude: number;
    altitude: number;
    timestamp: string;
    speed: number;
    heading?: number;
}

interface Velocity {
    latitudeVelocity: number;
    longitudeVelocity: number;
    altitudeVelocity: number;
}

interface PredictionResult {
    position: {
        latitude: number;
        longitude: number;
        altitude: number;
    };
    viewingDirection: {
        heading: number;
        pitch: number;
    };
    frustum: {
        fovHorizontal: number;
        fovVertical: number;
        viewDistance: number;
    }

}

export class Predictor {
    history: SensorData[] = [];
    private readonly maxHistorySize: number = 30;
    private readonly latKalman: KalmanFilter;
    private readonly lonKalman: KalmanFilter;
    private readonly altKalman: KalmanFilter;
    private readonly storageClient: StorageClient;

    // Config
    private readonly DEFAULT_FOV = 60; // degrees
    private readonly DEFAULT_VIEW_DISTANCE = 100; // meters
    private readonly PREDICTION_TIME_SECONDS = 5;
    private readonly KALMAN_CONFIG = {
        R: 0.01, // Measurement noise
        Q: 3,    // Process noise
        A: 1     // State transition
    };

    constructor() {
        // R: measurement noise, Q: process noise, A: state transition
        this.latKalman = new KalmanFilter(this.KALMAN_CONFIG);
        this.lonKalman = new KalmanFilter(this.KALMAN_CONFIG);
        this.altKalman = new KalmanFilter(this.KALMAN_CONFIG);
        this.storageClient = new StorageClient();
    }

    private calculateHeading(current: SensorData, previous: SensorData): number {
        if (current.heading !== undefined) {
            return current.heading;
        }

        const dLat = current.latitude - previous.latitude;
        const dLon = current.longitude - previous.longitude;
        return (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
    }

    private calculatePitch(current: SensorData, previous: SensorData): number {
        const dAlt = current.altitude - previous.altitude;
        const dLatLon = Math.sqrt(
            Math.pow(current.latitude - previous.latitude, 2) +
            Math.pow(current.longitude - previous.longitude, 2)
        );
        return Math.atan2(dAlt, dLatLon) * 180 / Math.PI;
    }

    private calculateVelocity(current: SensorData, previous: SensorData): Velocity {
        const timeDiff = (new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 1000; // in seconds

        return {
            latitudeVelocity: (current.latitude - previous.latitude) / timeDiff,
            longitudeVelocity: (current.longitude - previous.longitude) / timeDiff,
            altitudeVelocity: (current.altitude - previous.altitude) / timeDiff
        }
    }

    public async predict(sensor: SensorData): Promise<number[]> {
        this.history.push(sensor)
        if (this.history.length > this.maxHistorySize) {
            this.history.shift(); // Remove the oldest entry if we exceed max size
        }

        if (this.history.length < 2) {
            return []; // TODO: Return a default value or handle insufficient data
        }
        const current: SensorData = this.history[this.history.length - 1];
        const previous: SensorData = this.history[this.history.length - 2];

        const velocity: Velocity = this.calculateVelocity(current, previous);

        const predictedLat: number = this.latKalman.filter(current.latitude + velocity.latitudeVelocity * this.PREDICTION_TIME_SECONDS);
        const predictedLon: number = this.lonKalman.filter(current.longitude + velocity.longitudeVelocity * this.PREDICTION_TIME_SECONDS);
        const predictedAlt: number = this.altKalman.filter(current.altitude + velocity.altitudeVelocity * this.PREDICTION_TIME_SECONDS);

        const heading: number = this.calculateHeading(current, previous);
        const pitch: number = this.calculatePitch(current, previous);

        console.info('Predicted position:', predictedLat, predictedLon, predictedAlt);
        console.info('Predicted heading:', heading);
        console.info('Predicted pitch:', pitch);

        const prediction: PredictionResult = {
            position: {
                latitude: predictedLat,
                longitude: predictedLon,
                altitude: predictedAlt
            },
            viewingDirection: {
                heading: heading,
                pitch: pitch
            },
            frustum: {
                fovHorizontal: this.DEFAULT_FOV,
                fovVertical: this.DEFAULT_FOV * 0.75,
                viewDistance: this.DEFAULT_VIEW_DISTANCE
            }
        };

        return this.getPredictedObjectIds(prediction)
    }

    private async getPredictedObjectIds(prediction: PredictionResult): Promise<number[]> {
        try {
            return await this.storageClient.getPredictedModels(prediction);
        } catch (error) {
            console.error('Error fetching prediction from StorageClient:', error);
        }
        return [];
    }

}