import winston from 'winston';

// Logger setup (using Winston to log simulation events)
const logger = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.Console({format: winston.format.simple()})
    ]
});

// SensorData interface (fields for simulation route points)
interface SensorData {
    latitude: number;
    longitude: number;
    altitude: number;
    timestamp: number;
    speed: number;
    heading?: number;
}

// Structure to hold active simulation session info
interface SimulationSession {
    intervalId: NodeJS.Timeout;
    currentIndex: number;
    routePoints: SensorData[];  // precomputed route points for simulation
    running: boolean;
}

// Active simulation sessions mapped by profile ID
const sessions: { [profileId: string]: SimulationSession } = {};

/**
 * Start or resume a simulation for the given profile.
 * This only manages the simulation state - no external communication.
 */
export async function startSimulation(profile: any): Promise<void> {
    const profileId: string = profile.id;
    // Prevent starting if already running
    if (sessions[profileId] && sessions[profileId].running) {
        throw new Error('Simulation is already running for this profile.');
    }

    // Prepare route points if not already loaded
    let routePoints: SensorData[];
    if (sessions[profileId] && sessions[profileId].routePoints) {
        routePoints = sessions[profileId].routePoints;
    } else {
        routePoints = await prepareRoutePoints(profile);
    }

    const currentIndex = sessions[profileId]?.currentIndex || 0;
    
    // Create simulation session - only manage state, no external communication
    const intervalId = setInterval(() => {
        const session = sessions[profileId];
        if (!session || !session.running) return;

        if (session.currentIndex >= routePoints.length) {
            // Simulation complete
            stopSimulation(profileId);
            return;
        }

        // Just advance the index - frontend will handle data transmission
        session.currentIndex++;
        
        logger.info(`Simulation progress for profile ${profileId}: ${session.currentIndex}/${routePoints.length}`);
    }, 1000); // Update every second

    // Store session
    sessions[profileId] = {
        intervalId,
        currentIndex,
        routePoints,
        running: true
    };

    logger.info(`Simulation started for profile ${profileId}`);
}

/**
 * Stop a simulation for the given profile.
 */
export function stopSimulation(profileId: string): void {
    const session = sessions[profileId];
    if (!session) {
        throw new Error('No simulation session found for this profile.');
    }

    clearInterval(session.intervalId);
    session.running = false;

    logger.info(`Simulation stopped for profile ${profileId}`);
}

/**
 * Reset a simulation for the given profile.
 */
export function resetSimulation(profileId: string): void {
    const session = sessions[profileId];
    if (session) {
        clearInterval(session.intervalId);
        session.running = false;
        session.currentIndex = 0;
    }

    logger.info(`Simulation reset for profile ${profileId}`);
}

/**
 * Get simulation status for the given profile.
 */
export function getSimulationStatus(profileId: string): { running: boolean; currentIndex?: number; totalPoints?: number; progress?: number } {
    const session = sessions[profileId];
    if (!session) {
        return { running: false };
    }

    const progress = session.routePoints.length > 0 
        ? (session.currentIndex / session.routePoints.length) * 100 
        : 0;

    return {
        running: session.running,
        currentIndex: session.currentIndex,
        totalPoints: session.routePoints.length,
        progress: Math.min(progress, 100)
    };
}

/**
 * Get all route points for a profile (for frontend to manage WebSocket sending)
 */
export function getRoutePoints(profileId: string): SensorData[] {
    const session = sessions[profileId];
    return session?.routePoints || [];
}

/**
 * Prepare route points from profile data for simulation.
 */
async function prepareRoutePoints(profile: any): Promise<SensorData[]> {
    const route = JSON.parse(profile.routeData || '[]');
    const duration = profile.duration || 60; // Default 60 seconds
    const totalPoints = Math.max(10, Math.min(route.length, duration)); // Between 10 and duration points

    const routePoints: SensorData[] = [];
    
    for (let i = 0; i < totalPoints; i++) {
        const routeIndex = Math.floor((i / totalPoints) * route.length);
        const point = route[routeIndex] || route[0];
        
        routePoints.push({
            latitude: parseFloat(point.latitude),
            longitude: parseFloat(point.longitude),
            altitude: parseFloat(point.altitude || '100'),
            timestamp: Date.now() + (i * 1000), // Spaced 1 second apart
            speed: 10 + Math.random() * 5, // Random speed between 10-15 m/s
            heading: Math.random() * 360 // Random heading
        });
    }

    return routePoints;
}
