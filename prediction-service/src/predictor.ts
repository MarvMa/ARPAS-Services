import KalmanFilter from "kalmanjs";


export interface SensorData {
    latitude: number;
    longitude: number;
    altitude: number;
    timestamp: string;
    speed: number;
    heading?: number;
}

interface SmoothedData {
    latitude: number;
    longitude: number;
    altitude: number;
    timestamp: string;
}

interface Velocity {
    latitudeVelocity: number;
    longitudeVelocity: number;
    altitudeVelocity: number;
}

export interface PredictionResult {
    position: {
        latitude: number;
        longitude: number;
        altitude: number;
    };
}

export class Predictor {
    history: SensorData[] = [];
    private readonly maxHistorySize: number = 30;
    private readonly smoothedHistory: SmoothedData[] = [];


    private readonly latPositionKalman: KalmanFilter;
    private readonly lonPositionKalman: KalmanFilter;
    private readonly altPositionKalman: KalmanFilter;

    // Optional: Kalman filters for velocity smoothing
    private readonly latVelocityKalman: KalmanFilter;
    private readonly lonVelocityKalman: KalmanFilter;
    private readonly altVelocityKalman: KalmanFilter;

    // Config
    private readonly PREDICTION_TIME_SECONDS = 10;

    private readonly POSITION_KALMAN_CONFIG = {
        R: 0.000000002,  // 2 × 10^{-9}
        Q: 0.0000000000001,  // 1 × 10^{-13}
        A: 1
    };

    private readonly VELOCITY_KALMAN_CONFIG = {
        R: 0.0000000003,  // 3 × 10^{-10}
        Q: 0.00000000001,  // 1 × 10^{-11}
        A: 1
    };

    private lastPredictedPosition: { lat: number, lon: number } | null = null;
    private readonly MINIMUM_MOVEMENT_METERS = 5; // Minimum movement in meters

    constructor() {
        this.latPositionKalman = new KalmanFilter(this.POSITION_KALMAN_CONFIG);
        this.lonPositionKalman = new KalmanFilter(this.POSITION_KALMAN_CONFIG);
        this.altPositionKalman = new KalmanFilter(this.POSITION_KALMAN_CONFIG);

        this.latVelocityKalman = new KalmanFilter(this.VELOCITY_KALMAN_CONFIG);
        this.lonVelocityKalman = new KalmanFilter(this.VELOCITY_KALMAN_CONFIG);
        this.altVelocityKalman = new KalmanFilter(this.VELOCITY_KALMAN_CONFIG);
    }

    /**
     * Apply Kalman filter to smooth the Position data
     * @param sensor
     * @private
     */
    private smoothPosition(sensor: SensorData): SmoothedData {
        return {
            latitude: this.latPositionKalman.filter(sensor.latitude),
            longitude: this.lonPositionKalman.filter(sensor.longitude),
            altitude: this.altPositionKalman.filter(sensor.altitude),
            timestamp: sensor.timestamp
        };
    }


    /**
     * Calculate velocity based on position changes over time
     * @param current smoothed current data point
     * @param previous smoothed previous data point
     * @private
     */
    private calculateVelocity(current: SmoothedData, previous: SmoothedData): Velocity {
        const timeDiff = (new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 1000;

        if (timeDiff === 0) {
            return {latitudeVelocity: 0, longitudeVelocity: 0, altitudeVelocity: 0};
        }

        const rawVelocity = {
            latitudeVelocity: (current.latitude - previous.latitude) / timeDiff,
            longitudeVelocity: (current.longitude - previous.longitude) / timeDiff,
            altitudeVelocity: (current.altitude - previous.altitude) / timeDiff
        };

        // Smooth the calculated velocities
        return {
            latitudeVelocity: this.latVelocityKalman.filter(rawVelocity.latitudeVelocity),
            longitudeVelocity: this.lonVelocityKalman.filter(rawVelocity.longitudeVelocity),
            altitudeVelocity: this.altVelocityKalman.filter(rawVelocity.altitudeVelocity)
        };
    }

    public calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Predict future location based on current position and velocity
     * @param currentPosition current smoothed position
     * @param velocity smoothed velocity
     * @private
     */
    private predictPosition(currentPosition: SmoothedData, velocity: Velocity): SmoothedData {
        return {
            latitude: currentPosition.latitude + velocity.latitudeVelocity * this.PREDICTION_TIME_SECONDS,
            longitude: currentPosition.longitude + velocity.longitudeVelocity * this.PREDICTION_TIME_SECONDS,
            altitude: currentPosition.altitude + velocity.altitudeVelocity * this.PREDICTION_TIME_SECONDS,
            timestamp: new Date(new Date(currentPosition.timestamp).getTime() + this.PREDICTION_TIME_SECONDS * 1000).toISOString()
        };
    }

    /**
     * Predict future position based on incoming sensor data
     * @param sensor
     */
    public predict(sensor: SensorData): PredictionResult | null {
        this.history.push(sensor);
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }

        // Smooth the incoming GPS measurement
        const smoothedData = this.smoothPosition(sensor);
        this.smoothedHistory.push(smoothedData);
        if (this.smoothedHistory.length > this.maxHistorySize) {
            this.smoothedHistory.shift();
        }

        // Need at least 2 measurements for velocity calculation
        if (this.smoothedHistory.length < 2) {
            console.info('Insufficient data for prediction');
            return null;
        }

        const currentSmoothed = this.smoothedHistory[this.smoothedHistory.length - 1];
        const previousSmoothed = this.smoothedHistory[this.smoothedHistory.length - 2];

        // Calculate velocity from positions
        const velocity = this.calculateVelocity(currentSmoothed, previousSmoothed);

        //  Predict future position
        const predictedPosition = this.predictPosition(currentSmoothed, velocity);


        if (this.lastPredictedPosition) {
            const distance = this.calculateDistance(
                this.lastPredictedPosition.lat,
                this.lastPredictedPosition.lon,
                predictedPosition.latitude,
                predictedPosition.longitude
            );

            if (distance < this.MINIMUM_MOVEMENT_METERS) {
                return null;
            }
        }

        this.lastPredictedPosition = {
            lat: predictedPosition.latitude,
            lon: predictedPosition.longitude
        };

        console.info('Current smoothed position:', currentSmoothed.latitude, currentSmoothed.longitude, currentSmoothed.altitude);
        console.info('Smoothed velocity:', velocity);
        console.info('Predicted position:', predictedPosition.latitude, predictedPosition.longitude, predictedPosition.altitude);

        return {
            position: {
                latitude: predictedPosition.latitude,
                longitude: predictedPosition.longitude,
                altitude: predictedPosition.altitude
            }
        };
    }


}