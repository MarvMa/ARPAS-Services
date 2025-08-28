import {DataPoint, InterpolatedPoint} from '../types/simulation';

/**
 * Interpolates between data points to create a smooth timeline with consistent intervals
 */
export function interpolatePoints(
    originalPoints: DataPoint[],
    intervalMs: number
): InterpolatedPoint[] {
    if (originalPoints.length < 2) {
        return originalPoints.map(point => ({...point, isInterpolated: false}));
    }

    // Sort points by timestamp to ensure correct order
    const sortedPoints = [...originalPoints].sort((a, b) => a.timestamp - b.timestamp);
    const interpolatedPoints: InterpolatedPoint[] = [];

    const startTime = sortedPoints[0].timestamp;
    const endTime = sortedPoints[sortedPoints.length - 1].timestamp;
    const totalDuration = endTime - startTime;

    if (totalDuration <= 0) {
        return sortedPoints.map(point => ({...point, isInterpolated: false}));
    }

    // Add the first point
    interpolatedPoints.push({...sortedPoints[0], isInterpolated: false});

    let currentTime = startTime + intervalMs;
    let currentSegmentIndex = 0;

    while (currentTime < endTime) {
        // Find the segment containing currentTime
        while (
            currentSegmentIndex < sortedPoints.length - 1 &&
            sortedPoints[currentSegmentIndex + 1].timestamp <= currentTime
            ) {
            // Add original points that fall within our timeline
            const originalPoint = sortedPoints[currentSegmentIndex + 1];
            interpolatedPoints.push({...originalPoint, isInterpolated: false});
            currentSegmentIndex++;
        }

        // If we're still in a valid segment, interpolate
        if (currentSegmentIndex < sortedPoints.length - 1) {
            const startPoint = sortedPoints[currentSegmentIndex];
            const endPoint = sortedPoints[currentSegmentIndex + 1];

            // Skip if current time exactly matches an existing point
            if (currentTime !== endPoint.timestamp) {
                const interpolatedPoint = interpolateBetweenPoints(
                    startPoint,
                    endPoint,
                    currentTime
                );

                if (interpolatedPoint) {
                    interpolatedPoints.push({...interpolatedPoint, isInterpolated: true});
                }
            }
        }

        currentTime += intervalMs;
    }

    // Add the last point
    const lastPoint = sortedPoints[sortedPoints.length - 1];
    if (interpolatedPoints[interpolatedPoints.length - 1]?.timestamp !== lastPoint.timestamp) {
        interpolatedPoints.push({...lastPoint, isInterpolated: false});
    }

    return interpolatedPoints;
}

/**
 * Interpolates a single point between two data points at a specific time
 */
export function interpolateBetweenPoints(
    startPoint: DataPoint,
    endPoint: DataPoint,
    targetTime: number
): InterpolatedPoint | null {
    const timeDiff = endPoint.timestamp - startPoint.timestamp;
    if (timeDiff <= 0) return null;

    const ratio = (targetTime - startPoint.timestamp) / timeDiff;
    const clampedRatio = Math.max(0, Math.min(1, ratio));

    return {
        lat: startPoint.lat + (endPoint.lat - startPoint.lat) * clampedRatio,
        lng: startPoint.lng + (endPoint.lng - startPoint.lng) * clampedRatio,
        timestamp: targetTime,
        speed: interpolateOptionalValue(clampedRatio, startPoint.speed, endPoint.speed),
        altitude: interpolateOptionalValue(clampedRatio, startPoint.altitude, endPoint.altitude),
        bearing: interpolateBearing(clampedRatio, startPoint.bearing, endPoint.bearing),
        horizontalAccuracy: interpolateOptionalValue(clampedRatio, startPoint.horizontalAccuracy, endPoint.horizontalAccuracy),
        verticalAccuracy: interpolateOptionalValue(clampedRatio, startPoint.verticalAccuracy, endPoint.verticalAccuracy),
        isInterpolated: true
    };
}


/**
 * Interpolates bearing/heading values handling circular nature (0-360 degrees)
 */
function interpolateBearing(ratio: number, start?: number, end?: number): number | undefined {
    if (start === undefined || end === undefined) return start || end;

    // Handle the circular nature of bearings
    let diff = end - start;
    if (diff > 180) {
        diff -= 360;
    } else if (diff < -180) {
        diff += 360;
    }

    let result = start + diff * ratio;
    if (result < 0) result += 360;
    if (result >= 360) result -= 360;

    return result;
}

/**
 * Interpolates optional numeric values
 */
function interpolateOptionalValue(ratio: number, start?: number, end?: number): number | undefined {
    if (start === undefined || end === undefined) return start || end;
    return start + (end - start) * ratio;
}

/**
 * Advanced smoothing for data point arrays with configurable window size
 */
export function smoothPoints(points: InterpolatedPoint[], windowSize: number = 3): InterpolatedPoint[] {
    if (points.length < windowSize || windowSize < 2) return points;

    const smoothed: InterpolatedPoint[] = [];
    const halfWindow = Math.floor(windowSize / 2);

    for (let i = 0; i < points.length; i++) {
        const start = Math.max(0, i - halfWindow);
        const end = Math.min(points.length - 1, i + halfWindow);

        let latSum = 0;
        let lngSum = 0;
        let speedSum = 0;
        let altitudeSum = 0;
        let horizontalAccuracySum = 0;
        let verticalAccuracySum = 0;
        let count = 0;
        let speedCount = 0;
        let altitudeCount = 0;
        let horizontalAccuracyCount = 0;
        let verticalAccuracyCount = 0;

        for (let j = start; j <= end; j++) {
            const point = points[j];
            latSum += point.lat;
            lngSum += point.lng;
            count++;

            if (point.speed !== undefined) {
                speedSum += point.speed;
                speedCount++;
            }
            if (point.altitude !== undefined) {
                altitudeSum += point.altitude;
                altitudeCount++;
            }
            if (point.horizontalAccuracy !== undefined) {
                horizontalAccuracySum += point.horizontalAccuracy;
                horizontalAccuracyCount++;
            }
            if (point.verticalAccuracy !== undefined) {
                verticalAccuracySum += point.verticalAccuracy;
                verticalAccuracyCount++;
            }
        }

        smoothed.push({
            ...points[i],
            lat: latSum / count,
            lng: lngSum / count,
            speed: speedCount > 0 ? speedSum / speedCount : points[i].speed,
            altitude: altitudeCount > 0 ? altitudeSum / altitudeCount : points[i].altitude,
            horizontalAccuracy: horizontalAccuracyCount > 0 ? horizontalAccuracySum / horizontalAccuracyCount : points[i].horizontalAccuracy,
            verticalAccuracy: verticalAccuracyCount > 0 ? verticalAccuracySum / verticalAccuracyCount : points[i].verticalAccuracy,
        });
    }

    return smoothed;
}


/**
 * Calculates distance between two points using Haversine formula
 */
export function calculateDistance(point1: DataPoint, point2: DataPoint): number {
    const R = 6371000; // Earth's radius in meters
    const lat1Rad = (point1.lat * Math.PI) / 180;
    const lat2Rad = (point2.lat * Math.PI) / 180;
    const deltaLatRad = ((point2.lat - point1.lat) * Math.PI) / 180;
    const deltaLngRad = ((point2.lng - point1.lng) * Math.PI) / 180;

    const a =
        Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) *
        Math.sin(deltaLngRad / 2) * Math.sin(deltaLngRad / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

