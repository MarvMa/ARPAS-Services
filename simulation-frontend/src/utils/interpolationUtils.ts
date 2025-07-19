/**
 * Position interpolation utilities for smooth animation
 * Provides linear and spherical interpolation for GPS coordinates
 */

export interface Position {
    latitude: number;
    longitude: number;
    altitude: number;
    timestamp: number;
    speed?: number;
    heading?: number;
}

export interface InterpolatedFrame {
    position: Position;
    progress: number; // 0-1 between two points
    segmentIndex: number; // Index of the segment being interpolated
}

/**
 * Converts degrees to radians
 * @param degrees - Angle in degrees
 * @returns Angle in radians
 */
const toRadians = (degrees: number): number => degrees * (Math.PI / 180);

/**
 * Converts radians to degrees
 * @param radians - Angle in radians
 * @returns Angle in degrees
 */
const toDegrees = (radians: number): number => radians * (180 / Math.PI);

/**
 * Calculates the great circle distance between two GPS coordinates using Haversine formula
 * @param pos1 - First position
 * @param pos2 - Second position
 * @returns Distance in meters
 */
export const calculateDistance = (pos1: Position, pos2: Position): number => {
    const R = 6371000; // Earth's radius in meters
    const dLat = toRadians(pos2.latitude - pos1.latitude);
    const dLon = toRadians(pos2.longitude - pos1.longitude);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(pos1.latitude)) * Math.cos(toRadians(pos2.latitude)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

/**
 * Performs linear interpolation between two values
 * @param start - Starting value
 * @param end - Ending value
 * @param t - Interpolation factor (0-1)
 * @returns Interpolated value
 */
const lerp = (start: number, end: number, t: number): number => {
    return start + (end - start) * t;
};

/**
 * Performs spherical linear interpolation between two GPS coordinates
 * More accurate than linear interpolation for geographic coordinates
 * @param pos1 - Starting position
 * @param pos2 - Ending position
 * @param t - Interpolation factor (0-1)
 * @returns Interpolated position
 */
export const interpolatePosition = (pos1: Position, pos2: Position, t: number): Position => {
    // Clamp t to valid range
    t = Math.max(0, Math.min(1, t));

    // For short distances, linear interpolation is sufficient and faster
    const distance = calculateDistance(pos1, pos2);
    if (distance < 100) { // Less than 100 meters
        return {
            latitude: lerp(pos1.latitude, pos2.latitude, t),
            longitude: lerp(pos1.longitude, pos2.longitude, t),
            altitude: lerp(pos1.altitude, pos2.altitude, t),
            timestamp: lerp(pos1.timestamp, pos2.timestamp, t),
            speed: pos1.speed !== undefined && pos2.speed !== undefined
                ? lerp(pos1.speed, pos2.speed, t)
                : pos1.speed,
            heading: pos1.heading !== undefined && pos2.heading !== undefined
                ? lerp(pos1.heading, pos2.heading, t)
                : pos1.heading
        };
    }

    // Spherical interpolation for longer distances using proper SLERP
    const lat1 = toRadians(pos1.latitude);
    const lon1 = toRadians(pos1.longitude);
    const lat2 = toRadians(pos2.latitude);
    const lon2 = toRadians(pos2.longitude);

    // Calculate the angular distance between the two points
    const angularDistance = distance / 6371000; // Convert to radians
    
    if (angularDistance < 0.001) {
        // Very close points, use linear interpolation to avoid numerical issues
        return {
            latitude: lerp(pos1.latitude, pos2.latitude, t),
            longitude: lerp(pos1.longitude, pos2.longitude, t),
            altitude: lerp(pos1.altitude, pos2.altitude, t),
            timestamp: lerp(pos1.timestamp, pos2.timestamp, t),
            speed: pos1.speed !== undefined && pos2.speed !== undefined
                ? lerp(pos1.speed, pos2.speed, t)
                : pos1.speed,
            heading: pos1.heading !== undefined && pos2.heading !== undefined
                ? lerp(pos1.heading, pos2.heading, t)
                : pos1.heading
        };
    }

    // Proper spherical linear interpolation
    const a = Math.sin((1 - t) * angularDistance) / Math.sin(angularDistance);
    const b = Math.sin(t * angularDistance) / Math.sin(angularDistance);

    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);

    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lon = Math.atan2(y, x);

    return {
        latitude: toDegrees(lat),
        longitude: toDegrees(lon),
        altitude: lerp(pos1.altitude, pos2.altitude, t),
        timestamp: lerp(pos1.timestamp, pos2.timestamp, t),
        speed: pos1.speed !== undefined && pos2.speed !== undefined
            ? lerp(pos1.speed, pos2.speed, t)
            : pos1.speed,
        heading: pos1.heading !== undefined && pos2.heading !== undefined
            ? lerp(pos1.heading, pos2.heading, t)
            : pos1.heading
    };
};

/**
 * Generates interpolated frames between route points for smooth animation
 * @param positions - Array of route positions
 * @param frameInterval - Time between frames in milliseconds (default: 200ms)
 * @returns Array of interpolated frames
 */
export const generateInterpolatedFrames = (
    positions: Position[],
    frameInterval: number = 200
): InterpolatedFrame[] => {
    if (positions.length < 2) {
        return positions.map((pos, index) => ({
            position: pos,
            progress: 1,
            segmentIndex: index
        }));
    }

    const frames: InterpolatedFrame[] = [];

    for (let i = 0; i < positions.length - 1; i++) {
        const startPos = positions[i];
        const endPos = positions[i + 1];

        // Calculate time difference between points
        const timeDiff = endPos.timestamp - startPos.timestamp;
        const timeDiffMs = timeDiff > 1e10 ? timeDiff / 1e6 : timeDiff; // Handle nanoseconds

        // Calculate number of frames needed for this segment
        const frameCount = Math.max(1, Math.ceil(timeDiffMs / frameInterval));

        // Generate interpolated frames for this segment
        for (let frame = 0; frame < frameCount; frame++) {
            const t = frame / frameCount;
            const interpolatedPos = interpolatePosition(startPos, endPos, t);

            frames.push({
                position: interpolatedPos,
                progress: t,
                segmentIndex: i
            });
        }
    }

    // Add the final position
    frames.push({
        position: positions[positions.length - 1],
        progress: 1,
        segmentIndex: positions.length - 1
    });

    return frames;
};

/**
 * Calculates the total duration of a route based on timestamps
 * @param positions - Array of route positions
 * @returns Total duration in milliseconds
 */
export const calculateRouteDuration = (positions: Position[]): number => {
    if (positions.length < 2) return 0;

    const first = positions[0].timestamp;
    const last = positions[positions.length - 1].timestamp;

    // Handle nanosecond timestamps
    const timeDiff = last - first;
    return timeDiff > 1e10 ? timeDiff / 1e6 : timeDiff;
};

/**
 * Creates a smooth animation timeline for route playback
 * @param positions - Array of route positions
 * @param options - Animation options
 * @returns Animation configuration
 */
export interface AnimationOptions {
    frameInterval?: number; // Time between frames in ms
    speedMultiplier?: number; // Animation speed multiplier (1.0 = real-time)
    minFrameTime?: number; // Minimum time between frames in ms
    maxFrameTime?: number; // Maximum time between frames in ms
}

export interface AnimationTimeline {
    frames: InterpolatedFrame[];
    totalDuration: number;
    frameInterval: number;
}

export const createAnimationTimeline = (
    positions: Position[],
    options: AnimationOptions = {}
): AnimationTimeline => {
    const {
        frameInterval = 200,
        speedMultiplier = 1.0,
        minFrameTime = 100,
        maxFrameTime = 5000
    } = options;

    const frames = generateInterpolatedFrames(positions, frameInterval);
    const totalDuration = calculateRouteDuration(positions) / speedMultiplier;
    const adjustedFrameInterval = Math.max(minFrameTime, Math.min(maxFrameTime, frameInterval / speedMultiplier));

    return {
        frames,
        totalDuration,
        frameInterval: adjustedFrameInterval
    };
};
