/**
 * Utility functions for time formatting and calculations
 */

/**
 * Formats seconds into a human-readable time string
 * @param seconds - Time in seconds
 * @returns Formatted time string (e.g., "1:23.4" or "15.2s")
 */
export const formatTime = (seconds: number): string => {
    if (seconds < 0 || !isFinite(seconds)) return "0.0s";

    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    if (mins > 0) {
        return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
    }
    return `${secs.toFixed(1)}s`;
};

/**
 * Normalizes timestamp to seconds
 * Handles nanosecond, millisecond and second timestamps automatically
 * @param timestamp - Timestamp (can be in ns, ms or s)
 * @returns Timestamp in seconds
 */
export const normalizeTimestamp = (timestamp: number): number => {
    if (timestamp > 1e15) {
        return timestamp / 1e9; // Convert from nanoseconds to seconds
    }
    if (timestamp > 1e10) {
        return timestamp / 1000; // Convert from milliseconds to seconds
    }
    return timestamp;
};

/**
 * Calculates elapsed time based on route points and current index
 * Prefers seconds_elapsed field if available, falls back to timestamp calculation
 * @param points - Array of route points with timestamps and optional seconds_elapsed
 * @param currentIndex - Current position in the route
 * @returns Elapsed time in seconds
 */
export const calculateElapsedTime = (
    points: Array<{ timestamp: number; seconds_elapsed?: number }>,
    currentIndex: number
): number => {
    if (!points || points.length === 0 || currentIndex <= 0) {
        return 0;
    }

    // If we're at the end or beyond
    if (currentIndex >= points.length) {
        const lastPoint = points[points.length - 1];
        // Prefer seconds_elapsed if available
        if (lastPoint.seconds_elapsed !== undefined) {
            return lastPoint.seconds_elapsed;
        }
        // Fall back to timestamp calculation
        const firstTimestamp = normalizeTimestamp(points[0].timestamp);
        const lastTimestamp = normalizeTimestamp(lastPoint.timestamp);
        return lastTimestamp - firstTimestamp;
    }

    // Current position (0-based index, so currentIndex-1 is the last completed point)
    const currentPoint = points[currentIndex - 1];

    // Prefer seconds_elapsed if available
    if (currentPoint.seconds_elapsed !== undefined) {
        return currentPoint.seconds_elapsed;
    }

    // Fall back to timestamp calculation
    const firstTimestamp = normalizeTimestamp(points[0].timestamp);
    const currentTimestamp = normalizeTimestamp(currentPoint.timestamp);
    return currentTimestamp - firstTimestamp;
};

/**
 * Calculates total duration from route points
 * Prefers seconds_elapsed field if available, falls back to timestamp calculation
 * @param points - Array of route points with timestamps and optional seconds_elapsed
 * @returns Total duration in seconds
 */
export const calculateTotalDuration = (points: Array<{ timestamp: number; seconds_elapsed?: number }>): number => {
    if (!points || points.length < 2) {
        return 0;
    }

    const lastPoint = points[points.length - 1];

    if (lastPoint.seconds_elapsed !== undefined) {
        return lastPoint.seconds_elapsed;
    }

    const firstTimestamp = normalizeTimestamp(points[0].timestamp);
    const lastTimestamp = normalizeTimestamp(lastPoint.timestamp);

    return lastTimestamp - firstTimestamp;
};
