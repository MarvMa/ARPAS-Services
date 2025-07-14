import { LocationData, PathPoint } from '@/types/recording';

export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Earth's radius in kilometers
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c * 1000; // Convert to meters
};

export const calculatePathLength = (points: PathPoint[]): number => {
    if (points.length < 2) return 0;

    let totalDistance = 0;
    for (let i = 1; i < points.length; i++) {
        totalDistance += calculateDistance(
            points[i - 1].latitude,
            points[i - 1].longitude,
            points[i].latitude,
            points[i].longitude
        );
    }
    return totalDistance;
};

export const calculateBounds = (points: PathPoint[]): { minLat: number; maxLat: number; minLon: number; maxLon: number } => {
    if (points.length === 0) {
        return { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };
    }

    let minLat = points[0].latitude;
    let maxLat = points[0].latitude;
    let minLon = points[0].longitude;
    let maxLon = points[0].longitude;

    for (const point of points) {
        minLat = Math.min(minLat, point.latitude);
        maxLat = Math.max(maxLat, point.latitude);
        minLon = Math.min(minLon, point.longitude);
        maxLon = Math.max(maxLon, point.longitude);
    }

    return { minLat, maxLat, minLon, maxLon };
};

const toRadians = (degrees: number): number => {
    return degrees * (Math.PI / 180);
};