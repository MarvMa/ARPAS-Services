/**
 * Utility functions for route data processing - mirrors backend logic
 */

interface SensorData {
    latitude: number;
    longitude: number;
    altitude: number;
    timestamp: number;
    speed: number;
    heading?: number;
    seconds_elapsed?: number;
}

/**
 * Prepare route points from profile data for simulation.
 * This mirrors the backend's prepareRoutePoints logic to ensure consistency.
 * @param route - Original route data array
 * @param duration - Profile duration in seconds
 * @returns Filtered route points array matching backend logic
 */
export function prepareRoutePointsForFrontend(route: any[], duration: number): SensorData[] {
    if (!route || route.length === 0) {
        return [];
    }

    // Same logic as backend: Math.max(10, Math.min(route.length, duration))
    const totalPoints = Math.max(10, Math.min(route.length, duration));
    const routePoints: SensorData[] = [];

    for (let i = 0; i < totalPoints; i++) {
        const routeIndex = Math.floor((i / totalPoints) * route.length);
        const point = route[routeIndex] || route[0];

        const transformedPoint: SensorData = {
            latitude: typeof point.latitude === 'string' ? parseFloat(point.latitude) : point.latitude,
            longitude: typeof point.longitude === 'string' ? parseFloat(point.longitude) : point.longitude,
            altitude: typeof point.altitude === 'string' ? parseFloat(point.altitude) : (point.altitude || 0),
            timestamp: typeof point.time === 'string' ? parseInt(point.time) : (point.timestamp || 0),
            speed: typeof point.speed === 'string' ? parseFloat(point.speed) : point.speed,
            heading: point.bearing !== undefined ? (typeof point.bearing === 'string' ? parseFloat(point.bearing) : point.bearing) : undefined,
            seconds_elapsed: typeof point.seconds_elapsed === 'string' ? parseFloat(point.seconds_elapsed) : (point.seconds_elapsed || 0)
        };

        routePoints.push(transformedPoint);
    }

    return routePoints;
}
