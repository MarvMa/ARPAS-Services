// src/services/dockerMetricsService.ts

import axios from 'axios';

export interface DockerMetricsRequest {
    start_time: number;
    end_time: number;
    simulation_type: 'optimized' | 'unoptimized';
}

export interface DockerMetricsResponse {
    simulation_type: string;
    start_time: number;
    end_time: number;
    duration_ms: number;
    services: string[];
    metrics: {
        [serviceName: string]: DockerServiceMetrics[];
    };
}

export interface DockerServiceMetrics {
    timestamp: number;
    container_name: string;
    cpu: {
        percent: number;
    };
    memory: {
        usage: number;
        limit: number;
        percent: number;
    };
    network: {
        rxRate: number;
        txRate: number;
        rxBytes: number;
        txBytes: number;
    };
}

export interface DockerMetricsTestResponse {
    status: 'success' | 'error';
    prometheus_url?: string;
    prometheus_healthy?: boolean;
    active_targets?: number;
    message: string;
}

// Enhanced Docker time series data structure
export interface EnhancedDockerTimeSeries {
    [containerName: string]: Array<{
        timestamp: number;
        cpu: {
            usage: number;
            percent: number;
        };
        memory: {
            usage: number;
            limit: number;
            percent: number;
        };
        network: {
            rxBytes: number;
            txBytes: number;
            rxRate: number;
            txRate: number;
        };
    }>;
}

/**
 * Service for Docker metrics collection via Prometheus
 */
export class DockerMetricsService {
    private readonly API_BASE = 'http://localhost/api/docker/metrics';

    /**
     * Test Docker metrics service connectivity and Prometheus health
     */
    async testConnection(): Promise<DockerMetricsTestResponse> {
        try {
            console.log('Testing Docker metrics service connectivity...');

            const response = await axios.get<DockerMetricsTestResponse>(
                `${this.API_BASE}/test`,
                {
                    timeout: 10000,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log('Docker metrics service test result:', response.data);
            return response.data;

        } catch (error) {
            console.error('Docker metrics test failed:', error);

            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNREFUSED') {
                    throw new Error('Cannot connect to Docker metrics service - service may be down');
                } else if (error.code === 'ECONNABORTED') {
                    throw new Error('Docker metrics service test timed out');
                } else {
                    const errorMessage = error.response?.data?.message || error.message;
                    throw new Error(`Docker metrics service test failed: ${errorMessage}`);
                }
            }

            throw new Error(`Docker metrics service test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Fetch historical Docker metrics for a simulation time range
     */
    async fetchHistoricalMetrics(
        startTime: number,
        endTime: number,
        simulationType: 'optimized' | 'unoptimized'
    ): Promise<DockerMetricsResponse> {
        try {
            const request: DockerMetricsRequest = {
                start_time: startTime,
                end_time: endTime,
                simulation_type: simulationType
            };

            const duration = endTime - startTime;
            console.log(`Fetching Docker metrics for ${simulationType} simulation:`, {
                startTime: new Date(startTime).toISOString(),
                endTime: new Date(endTime).toISOString(),
                duration: `${Math.round(duration / 1000)}s`,
                expectedDataPoints: Math.round(duration / 5000) // Expecting data every 5 seconds
            });

            const response = await axios.post<DockerMetricsResponse>(
                `${this.API_BASE}/historical`,
                request,
                {
                    timeout: 60000, // 60 second timeout for historical data
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.status === 200 && response.data.metrics) {
                console.log(`Successfully retrieved Docker metrics:`, {
                    simulationType: response.data.simulation_type,
                    services: response.data.services,
                    duration: `${response.data.duration_ms}ms`,
                    dataPointsPerService: Object.entries(response.data.metrics).map(([service, data]) => ({
                        service,
                        points: data.length
                    }))
                });

                return response.data;
            } else {
                throw new Error('Invalid response format from Docker metrics service');
            }

        } catch (error) {
            console.error('Failed to fetch historical Docker metrics:', error);

            if (axios.isAxiosError(error)) {
                if (error.response?.status === 404) {
                    throw new Error(`No Docker metrics found for the specified time range (${simulationType} simulation)`);
                } else if (error.response?.status === 400) {
                    throw new Error(`Invalid request parameters: ${error.response.data?.error || 'Bad request'}`);
                } else if (error.code === 'ECONNREFUSED') {
                    throw new Error('Cannot connect to Docker metrics service - check if service is running');
                } else if (error.code === 'ECONNABORTED') {
                    throw new Error('Docker metrics request timed out - large time range may take longer');
                } else {
                    const errorMessage = error.response?.data?.error || error.message;
                    throw new Error(`Docker metrics API error (${error.response?.status}): ${errorMessage}`);
                }
            }

            throw new Error(`Failed to fetch Docker metrics: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Transform Docker metrics response to ScientificMetrics format
     */
    transformToScientificFormat(response: DockerMetricsResponse): EnhancedDockerTimeSeries {
        console.log('Transforming Docker metrics to scientific format...');

        const dockerTimeSeries: EnhancedDockerTimeSeries = {};
        let totalDataPoints = 0;

        Object.entries(response.metrics).forEach(([serviceName, timeSeriesData]) => {
            dockerTimeSeries[serviceName] = timeSeriesData.map(dataPoint => ({
                timestamp: dataPoint.timestamp,
                cpu: {
                    usage: dataPoint.cpu.percent, // Using percent as usage for compatibility
                    percent: dataPoint.cpu.percent
                },
                memory: {
                    usage: dataPoint.memory.usage,
                    limit: dataPoint.memory.limit,
                    percent: dataPoint.memory.percent
                },
                network: {
                    rxBytes: dataPoint.network.rxBytes,
                    txBytes: dataPoint.network.txBytes,
                    rxRate: dataPoint.network.rxRate,
                    txRate: dataPoint.network.txRate
                }
            }));

            totalDataPoints += dockerTimeSeries[serviceName].length;
            console.log(`Transformed ${dockerTimeSeries[serviceName].length} data points for ${serviceName}`);
        });

        console.log(`Docker metrics transformation complete: ${totalDataPoints} total data points for ${Object.keys(dockerTimeSeries).length} services`);
        return dockerTimeSeries;
    }

    /**
     * Calculate comprehensive Docker metrics statistics
     */
    calculateDockerStats(dockerTimeSeries: EnhancedDockerTimeSeries): {
        [serviceName: string]: {
            avgCpuPercent: number;
            maxCpuPercent: number;
            minCpuPercent: number;
            avgMemoryPercent: number;
            maxMemoryPercent: number;
            avgMemoryUsageBytes: number;
            totalNetworkRx: number;
            totalNetworkTx: number;
            avgNetworkRxRate: number;
            avgNetworkTxRate: number;
            dataPoints: number;
            timeSpan: {
                start: number;
                end: number;
                durationMs: number;
            };
        };
    } {
        console.log('Calculating Docker metrics statistics...');

        const stats: any = {};

        Object.entries(dockerTimeSeries).forEach(([serviceName, timeSeries]) => {
            if (timeSeries.length === 0) {
                console.warn(`No data points for service: ${serviceName}`);
                return;
            }

            const cpuPercentages = timeSeries.map(t => t.cpu.percent);
            const memoryPercentages = timeSeries.map(t => t.memory.percent);
            const memoryUsages = timeSeries.map(t => t.memory.usage);
            const networkRxRates = timeSeries.map(t => t.network.rxRate);
            const networkTxRates = timeSeries.map(t => t.network.txRate);
            const timestamps = timeSeries.map(t => t.timestamp);

            // Calculate cumulative network bytes
            const firstPoint = timeSeries[0];
            const lastPoint = timeSeries[timeSeries.length - 1];
            const totalRxBytes = lastPoint.network.rxBytes - firstPoint.network.rxBytes;
            const totalTxBytes = lastPoint.network.txBytes - firstPoint.network.txBytes;

            stats[serviceName] = {
                avgCpuPercent: this.calculateAverage(cpuPercentages),
                maxCpuPercent: Math.max(...cpuPercentages),
                minCpuPercent: Math.min(...cpuPercentages),
                avgMemoryPercent: this.calculateAverage(memoryPercentages),
                maxMemoryPercent: Math.max(...memoryPercentages),
                avgMemoryUsageBytes: this.calculateAverage(memoryUsages),
                totalNetworkRx: Math.max(0, totalRxBytes),
                totalNetworkTx: Math.max(0, totalTxBytes),
                avgNetworkRxRate: this.calculateAverage(networkRxRates),
                avgNetworkTxRate: this.calculateAverage(networkTxRates),
                dataPoints: timeSeries.length,
                timeSpan: {
                    start: Math.min(...timestamps),
                    end: Math.max(...timestamps),
                    durationMs: Math.max(...timestamps) - Math.min(...timestamps)
                }
            };

            console.log(`Statistics for ${serviceName}:`, {
                avgCpu: `${stats[serviceName].avgCpuPercent.toFixed(2)}%`,
                maxCpu: `${stats[serviceName].maxCpuPercent.toFixed(2)}%`,
                avgMemory: `${stats[serviceName].avgMemoryPercent.toFixed(2)}%`,
                dataPoints: stats[serviceName].dataPoints,
                duration: `${Math.round(stats[serviceName].timeSpan.durationMs / 1000)}s`
            });
        });

        return stats;
    }

    /**
     * Validate metrics data quality
     */
    validateMetricsQuality(dockerTimeSeries: EnhancedDockerTimeSeries, expectedDurationMs: number): {
        isValid: boolean;
        issues: string[];
        coverage: number;
        recommendations: string[];
    } {
        const issues: string[] = [];
        const recommendations: string[] = [];
        const expectedDataPoints = Math.floor(expectedDurationMs / 5000); // Expecting data every 5 seconds

        Object.entries(dockerTimeSeries).forEach(([serviceName, timeSeries]) => {
            const actualDataPoints = timeSeries.length;
            const coverage = actualDataPoints / expectedDataPoints;

            if (coverage < 0.8) {
                issues.push(`${serviceName}: Low data coverage (${Math.round(coverage * 100)}%)`);
                recommendations.push(`Check ${serviceName} container health during simulation`);
            }

            // Check for gaps in timestamps
            if (timeSeries.length > 1) {
                const timestamps = timeSeries.map(t => t.timestamp).sort((a, b) => a - b);
                let gapCount = 0;

                for (let i = 1; i < timestamps.length; i++) {
                    const gap = timestamps[i] - timestamps[i - 1];
                    if (gap > 10000) { // More than 10 seconds gap
                        gapCount++;
                    }
                }

                if (gapCount > 0) {
                    issues.push(`${serviceName}: ${gapCount} significant gaps in data`);
                }
            }

            // Check for unrealistic values
            const cpuValues = timeSeries.map(t => t.cpu.percent);
            const maxCpu = Math.max(...cpuValues);
            if (maxCpu > 100) {
                issues.push(`${serviceName}: Unrealistic CPU values (max: ${maxCpu.toFixed(2)}%)`);
            }
        });

        const totalCoverage = Object.values(dockerTimeSeries).reduce((sum, timeSeries) => {
            return sum + (timeSeries.length / expectedDataPoints);
        }, 0) / Object.keys(dockerTimeSeries).length;

        const isValid = issues.length === 0 && totalCoverage >= 0.8;

        if (!isValid) {
            recommendations.push('Consider increasing Prometheus scrape frequency');
            recommendations.push('Verify cAdvisor is properly monitoring all containers');
        }

        return {
            isValid,
            issues,
            coverage: totalCoverage,
            recommendations
        };
    }

    /**
     * Helper method to calculate average
     */
    private calculateAverage(values: number[]): number {
        if (values.length === 0) return 0;
        return values.reduce((sum, val) => sum + val, 0) / values.length;
    }

    /**
     * Get expected services for a simulation type
     */
    getExpectedServices(simulationType: 'optimized' | 'unoptimized'): string[] {
        if (simulationType === 'optimized') {
            return ['prediction_service', 'storage-service', 'redis', 'minio'];
        } else {
            return ['storage-service', 'minio'];
        }
    }

    /**
     * Format file size for display
     */
    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}