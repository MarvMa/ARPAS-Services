import { DataPoint, InterpolatedPoint } from '../types/simulation';

/**
 * Interpolates between data points to create a smooth timeline with consistent intervals
 */
export function interpolatePoints(
    originalPoints: DataPoint[],
    intervalMs: number
): InterpolatedPoint[] {
    if (originalPoints.length < 2) {
        return originalPoints.map(point => ({ ...point, isInterpolated: false }));
    }

    // Sort points by timestamp
    const sortedPoints = [...originalPoints].sort((a, b) => a.timestamp - b.timestamp);
    const interpolatedPoints: InterpolatedPoint[] = [];

    const startTime = sortedPoints[0].timestamp;
    const endTime = sortedPoints[sortedPoints.length - 1].timestamp;
    const totalDuration = endTime - startTime;

    if (totalDuration <= 0) {
        return sortedPoints.map(point => ({ ...point, isInterpolated: false }));
    }

    // Add the first point
    interpolatedPoints.push({ ...sortedPoints[0], isInterpolated: false });

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
            interpolatedPoints.push({ ...originalPoint, isInterpolated: false });
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
                    interpolatedPoints.push({ ...interpolatedPoint, isInterpolated: true });
                }
            }
        }

        currentTime += intervalMs;
    }

    // Add the last point
    const lastPoint = sortedPoints[sortedPoints.length - 1];
    if (interpolatedPoints[interpolatedPoints.length - 1]?.timestamp !== lastPoint.timestamp) {
        interpolatedPoints.push({ ...lastPoint, isInterpolated: false });
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
        speed: startPoint.speed ? startPoint.speed + (endPoint.speed! - startPoint.speed) * clampedRatio : undefined,
        altitude: startPoint.altitude ? startPoint.altitude + (endPoint.altitude! - startPoint.altitude) * clampedRatio : undefined,
        bearing: interpolateBearing(startPoint.bearing, endPoint.bearing, clampedRatio),
        isInterpolated: true
    };
}

/**
 * Smooth real-time interpolation for simulation animation
 * This creates smooth movement between route points based on elapsed time
 */
export function getRealTimePosition(
    routePoints: DataPoint[],
    currentIndex: number,
    segmentProgress: number // 0 to 1, how far through the current segment
): { lat: number; lng: number; bearing?: number } | null {
    if (currentIndex >= routePoints.length - 1) {
        // At or past the last point
        const lastPoint = routePoints[routePoints.length - 1];
        return {
            lat: lastPoint.lat,
            lng: lastPoint.lng,
            bearing: lastPoint.bearing
        };
    }

    const currentPoint = routePoints[currentIndex];
    const nextPoint = routePoints[currentIndex + 1];

    // Smooth interpolation between current and next point
    const lat = currentPoint.lat + (nextPoint.lat - currentPoint.lat) * segmentProgress;
    const lng = currentPoint.lng + (nextPoint.lng - currentPoint.lng) * segmentProgress;
    const bearing = interpolateBearing(currentPoint.bearing, nextPoint.bearing, segmentProgress);

    return { lat, lng, bearing };
}

/**
 * Calculates segment progress based on timestamps and current time
 */
export function calculateSegmentProgress(
    currentPoint: DataPoint,
    nextPoint: DataPoint,
    currentTime: number
): number {
    const segmentDuration = nextPoint.timestamp - currentPoint.timestamp;
    if (segmentDuration <= 0) return 1;

    const elapsed = currentTime - currentPoint.timestamp;
    return Math.max(0, Math.min(1, elapsed / segmentDuration));
}

/**
 * Interpolates bearing/heading values handling circular nature (0-360 degrees)
 */
function interpolateBearing(start?: number, end?: number, ratio: number): number | undefined {
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
 * Smooth interpolation for data point arrays with advanced smoothing
 */
export function smoothPoints(points: InterpolatedPoint[], windowSize: number = 3): InterpolatedPoint[] {
    if (points.length < windowSize) return points;

    const smoothed: InterpolatedPoint[] = [];

    for (let i = 0; i < points.length; i++) {
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(points.length - 1, i + Math.floor(windowSize / 2));
        
        let latSum = 0;
        let lngSum = 0;
        let speedSum = 0;
        let altitudeSum = 0;
        let count = 0;

        for (let j = start; j <= end; j++) {
            latSum += points[j].lat;
            lngSum += points[j].lng;
            if (points[j].speed !== undefined) speedSum += points[j].speed!;
            if (points[j].altitude !== undefined) altitudeSum += points[j].altitude!;
            count++;
        }

        smoothed.push({
            ...points[i],
            lat: latSum / count,
            lng: lngSum / count,
            speed: points[i].speed !== undefined ? speedSum / count : undefined,
            altitude: points[i].altitude !== undefined ? altitudeSum / count : undefined,
        });
    }

    return smoothed;
}