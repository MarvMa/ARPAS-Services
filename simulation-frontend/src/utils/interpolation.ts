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
                interpolatedPoints.push(interpolatedPoint);
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
 * Interpolates a single point between two given points at a specific timestamp
 */
function interpolateBetweenPoints(
    startPoint: DataPoint,
    endPoint: DataPoint,
    targetTimestamp: number
): InterpolatedPoint {
    const timeDiff = endPoint.timestamp - startPoint.timestamp;
    const targetDiff = targetTimestamp - startPoint.timestamp;
    const ratio = timeDiff > 0 ? targetDiff / timeDiff : 0;

    // Clamp ratio between 0 and 1
    const clampedRatio = Math.max(0, Math.min(1, ratio));

    return {
        lat: lerp(startPoint.lat, endPoint.lat, clampedRatio),
        lng: lerp(startPoint.lng, endPoint.lng, clampedRatio),
        timestamp: targetTimestamp,
        speed: interpolateOptional(startPoint.speed, endPoint.speed, clampedRatio),
        altitude: interpolateOptional(startPoint.altitude, endPoint.altitude, clampedRatio),
        isInterpolated: true
    };
}

/**
 * Linear interpolation between two numbers
 */
function lerp(start: number, end: number, ratio: number): number {
    return start + (end - start) * ratio;
}

/**
 * Interpolates optional numeric values
 */
function interpolateOptional(
    start: number | undefined,
    end: number | undefined,
    ratio: number
): number | undefined {
    if (start === undefined || end === undefined) {
        return start !== undefined ? start : end;
    }
    return lerp(start, end, ratio);
}

/**
 * Smooths a series of points using a simple moving average
 */
export function smoothPoints(
    points: InterpolatedPoint[],
    windowSize: number = 3
): InterpolatedPoint[] {
    if (points.length <= windowSize) {
        return points;
    }

    const smoothedPoints: InterpolatedPoint[] = [];
    const halfWindow = Math.floor(windowSize / 2);

    for (let i = 0; i < points.length; i++) {
        const windowStart = Math.max(0, i - halfWindow);
        const windowEnd = Math.min(points.length - 1, i + halfWindow);
        const windowPoints = points.slice(windowStart, windowEnd + 1);

        if (windowPoints.length === 0) {
            smoothedPoints.push(points[i]);
            continue;
        }

        const avgLat = windowPoints.reduce((sum, p) => sum + p.lat, 0) / windowPoints.length;
        const avgLng = windowPoints.reduce((sum, p) => sum + p.lng, 0) / windowPoints.length;
        const avgSpeed = windowPoints
                .filter(p => p.speed !== undefined)
                .reduce((sum, p) => sum + (p.speed || 0), 0) /
            Math.max(1, windowPoints.filter(p => p.speed !== undefined).length);
        const avgAltitude = windowPoints
                .filter(p => p.altitude !== undefined)
                .reduce((sum, p) => sum + (p.altitude || 0), 0) /
            Math.max(1, windowPoints.filter(p => p.altitude !== undefined).length);

        smoothedPoints.push({
            ...points[i],
            lat: avgLat,
            lng: avgLng,
            speed: windowPoints.some(p => p.speed !== undefined) ? avgSpeed : undefined,
            altitude: windowPoints.some(p => p.altitude !== undefined) ? avgAltitude : undefined
        });
    }

    return smoothedPoints;
}

/**
 * Calculates the distance between two geographic points in meters
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

/**
 * Calculates speed between consecutive points
 */
export function calculateSpeeds(points: InterpolatedPoint[]): InterpolatedPoint[] {
    if (points.length < 2) return points;

    const pointsWithSpeed = [...points];

    for (let i = 1; i < pointsWithSpeed.length; i++) {
        const prev = pointsWithSpeed[i - 1];
        const curr = pointsWithSpeed[i];

        const distance = calculateDistance(prev, curr);
        const timeDiff = (curr.timestamp - prev.timestamp) / 1000; // Convert to seconds

        if (timeDiff > 0) {
            pointsWithSpeed[i].speed = distance / timeDiff; // meters per second
        }
    }

    return pointsWithSpeed;
}