// Bereinigte dataCollector.ts - nur essenzielle Methoden

import { ScientificMetrics } from '../types/simulation';

export class DataCollector {
    private scientificResults: ScientificMetrics[] = [];
    private readonly STORAGE_KEY = 'scientific_simulation_results_v1';

    /**
     * Save scientific metrics from a completed simulation
     */
    async saveScientificResults(metrics: ScientificMetrics): Promise<void> {
        try {
            this.scientificResults.push(metrics);
            this.saveToLocalStorage();

            console.log(`Saved scientific metrics for simulation ${metrics.simulationId}:
                Type: ${metrics.simulationType}
                Duration: ${metrics.duration.totalMs}ms
                Objects: ${Object.keys(metrics.objectMetrics).length}
                Profiles: ${metrics.configuration.profileCount}
                Docker Containers: ${Object.keys(metrics.dockerTimeSeries).length}
                Avg Latency: ${metrics.aggregatedStats.latency.mean.toFixed(2)}ms
                Cache Hit Rate: ${metrics.aggregatedStats.cache.hitRate.toFixed(1)}%
            `);

            // Auto-download individual result
            await this.downloadIndividualResult(metrics);

        } catch (error) {
            console.error('Failed to save scientific results:', error);
            throw new Error('Failed to save simulation results');
        }
    }

    /**
     * Download individual simulation result
     */
    private async downloadIndividualResult(metrics: ScientificMetrics): Promise<void> {
        const filename = `simulation_${metrics.simulationType}_${metrics.simulationId}_${metrics.timestamp.replace(/[:.]/g, '-')}.json`;
        const blob = new Blob([JSON.stringify(metrics, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        console.log(`Auto-downloaded: ${filename}`);
    }

    /**
     * Get all scientific results
     */
    getScientificResults(): ScientificMetrics[] {
        return [...this.scientificResults];
    }

    /**
     * Export all scientific results as comprehensive JSON
     */
    async exportScientificResults(): Promise<void> {
        if (this.scientificResults.length === 0) {
            throw new Error('No results to export');
        }

        const exportData = {
            exportDate: new Date().toISOString(),
            totalSimulations: this.scientificResults.length,
            optimizedSimulations: this.scientificResults.filter(r => r.simulationType === 'optimized').length,
            unoptimizedSimulations: this.scientificResults.filter(r => r.simulationType === 'unoptimized').length,
            simulations: this.scientificResults,
            comparison: this.generateComparativeAnalysis(),
            metadata: {
                version: '1.0.0',
                exportFormat: 'scientific_analysis',
                dataStructure: {
                    perObjectMetrics: true,
                    dockerTimeSeries: true,
                    profileSpecificMetrics: true,
                    aggregatedStatistics: true
                }
            }
        };

        const filename = `scientific_analysis_export_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        console.log(`Exported ${this.scientificResults.length} simulations to ${filename}`);
    }

    /**
     * Export as CSV for scientific analysis tools
     */
    async exportAsCSV(): Promise<void> {
        if (this.scientificResults.length === 0) {
            throw new Error('No results to export');
        }

        const headers = [
            'simulationId', 'simulationType', 'timestamp', 'durationMs',
            'profileCount', 'objectCount', 'intervalMs',
            'meanLatency', 'medianLatency', 'p95Latency', 'p99Latency',
            'minLatency', 'maxLatency', 'stdDevLatency',
            'cacheHitRate', 'successRate', 'throughput',
            'totalObjects', 'totalDataBytes'
        ];

        const rows = this.scientificResults.map(result => [
            result.simulationId,
            result.simulationType,
            result.timestamp,
            result.duration.totalMs,
            result.configuration.profileCount,
            result.configuration.objectCount,
            result.configuration.intervalMs,
            result.aggregatedStats.latency.mean.toFixed(2),
            result.aggregatedStats.latency.median.toFixed(2),
            result.aggregatedStats.latency.p95.toFixed(2),
            result.aggregatedStats.latency.p99.toFixed(2),
            result.aggregatedStats.latency.min.toFixed(2),
            result.aggregatedStats.latency.max.toFixed(2),
            result.aggregatedStats.latency.stdDev.toFixed(2),
            result.aggregatedStats.cache.hitRate.toFixed(2),
            result.aggregatedStats.success.rate.toFixed(2),
            result.aggregatedStats.throughput.objectsPerSecond.toFixed(2),
            Object.keys(result.objectMetrics).length,
            result.aggregatedStats.throughput.bytesPerSecond * (result.duration.totalMs / 1000)
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const filename = `simulation_metrics_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        console.log(`Exported ${this.scientificResults.length} simulations to CSV: ${filename}`);
    }

    /**
     * Generate comparative analysis between optimized and unoptimized
     */
    private generateComparativeAnalysis(): any {
        const optimized = this.scientificResults.filter(r => r.simulationType === 'optimized');
        const unoptimized = this.scientificResults.filter(r => r.simulationType === 'unoptimized');

        if (optimized.length === 0 || unoptimized.length === 0) {
            return { message: 'Insufficient data for comparison' };
        }

        const calculateAverages = (results: ScientificMetrics[]) => {
            const latencies = results.map(r => r.aggregatedStats.latency.mean);
            const cacheRates = results.map(r => r.aggregatedStats.cache.hitRate);
            const throughputs = results.map(r => r.aggregatedStats.throughput.objectsPerSecond);
            const successRates = results.map(r => r.aggregatedStats.success.rate);

            const avg = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

            return {
                avgLatency: avg(latencies),
                avgCacheHitRate: avg(cacheRates),
                avgThroughput: avg(throughputs),
                avgSuccessRate: avg(successRates),
                sampleSize: results.length
            };
        };

        const optimizedAvg = calculateAverages(optimized);
        const unoptimizedAvg = calculateAverages(unoptimized);

        return {
            optimized: optimizedAvg,
            unoptimized: unoptimizedAvg,
            improvements: {
                latencyReduction: ((unoptimizedAvg.avgLatency - optimizedAvg.avgLatency) / unoptimizedAvg.avgLatency) * 100,
                throughputIncrease: ((optimizedAvg.avgThroughput - unoptimizedAvg.avgThroughput) / unoptimizedAvg.avgThroughput) * 100,
                cacheEffectiveness: optimizedAvg.avgCacheHitRate,
                successRateImprovement: optimizedAvg.avgSuccessRate - unoptimizedAvg.avgSuccessRate
            },
            recommendation: this.generateRecommendation(optimizedAvg, unoptimizedAvg)
        };
    }

    /**
     * Generate recommendation based on comparison
     */
    private generateRecommendation(optimized: any, unoptimized: any): string {
        const latencyImprovement = ((unoptimized.avgLatency - optimized.avgLatency) / unoptimized.avgLatency) * 100;

        if (latencyImprovement > 30) {
            return 'Significant performance improvement with optimization. Strongly recommend using optimized mode.';
        } else if (latencyImprovement > 15) {
            return 'Moderate performance improvement with optimization. Recommend using optimized mode for production.';
        } else if (latencyImprovement > 5) {
            return 'Minor performance improvement with optimization. Consider based on specific use case requirements.';
        } else {
            return 'Minimal performance difference. Evaluate based on infrastructure costs and complexity.';
        }
    }

    /**
     * Save to localStorage
     */
    private saveToLocalStorage(): void {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.scientificResults));
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
            if (this.scientificResults.length > 10) {
                this.scientificResults = this.scientificResults.slice(-10);
                try {
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.scientificResults));
                } catch (retryError) {
                    console.error('Failed to save even after cleanup:', retryError);
                }
            }
        }
    }

    /**
     * Load from localStorage
     */
    public loadFromLocalStorage(): void {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                this.scientificResults = JSON.parse(stored);
                console.log(`Loaded ${this.scientificResults.length} scientific simulation results from storage`);
            }
        } catch (error) {
            console.error('Failed to load from localStorage:', error);
            localStorage.removeItem(this.STORAGE_KEY);
        }
    }
    
    /**
     * Clear all results
     */
    public clearResults(): void {
        this.scientificResults = [];
        localStorage.removeItem(this.STORAGE_KEY);
        console.log('All scientific results cleared');
    }
    
}