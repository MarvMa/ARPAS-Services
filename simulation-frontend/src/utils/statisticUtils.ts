import { SimulationState } from "../types/simulation";
import { DockerStats } from "../services/simulationService";

export function calculateAverage(values: number[]): number {
    return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

export function calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
}

export function calculateStandardDeviation(values: number[]): number {
    if (values.length <= 1) return 0;
    const avg = calculateAverage(values);
    const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
    return Math.sqrt(variance);
}

export function calculateThroughput(simulationState: SimulationState): number {
    if (!simulationState) return 0;
    const duration = (Date.now() - simulationState.startTime) / 1000; // seconds
    const totalObjects = Object.values(simulationState.profileStates)
        .reduce((sum, state) => sum + state.downloadedObjects.length, 0);
    return duration > 0 ? totalObjects / duration : 0;
}

export function calculateRequestsPerSecond(simulationState: SimulationState): number {
    if (!simulationState) return 0;
    const duration = (Date.now() - simulationState.startTime) / 1000;
    const totalRequests = Object.values(simulationState.profileStates)
        .reduce((sum, state) => sum + (state.totalRequests || 0), 0);
    return duration > 0 ? totalRequests / duration : 0;
}

export function calculateNetworkRate(values: number[], stats: DockerStats[]): number {
    if (values.length < 2 || stats.length < 2) return 0;
    const timeDiff = (stats[stats.length - 1].timestamp - stats[0].timestamp) / 1000; // seconds
    const dataDiff = Math.max(...values) - Math.min(...values);
    return timeDiff > 0 ? dataDiff / timeDiff : 0;
}