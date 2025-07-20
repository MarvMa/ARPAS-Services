import { SimulationResults, ObjectMetric } from '../types/simulation';

/**
 * Streamlined service for collecting and managing simulation results
 * Handles data persistence, export, and analysis
 */
export class DataCollector {
    private results: SimulationResults[] = [];
    private readonly STORAGE_KEY = 'simulation_results_v2';

    /**
     * Saves simulation results and automatically exports to file
     */
    async saveResults(results: SimulationResults): Promise<void> {
        try {
            this.results.push(results);
            this.saveToLocalStorage();
            await this.downloadResultsAsJson(results);

            console.log(`Saved and exported simulation results: ${results.simulationId} (${results.totalObjects} objects, ${results.averageLatency.toFixed(2)}ms avg latency)`);
        } catch (error) {
            console.error('Failed to save simulation results:', error);
            throw new Error('Failed to save simulation results');
        }
    }

    /**
     * Gets all stored simulation results
     */
    getAllResults(): SimulationResults[] {
        return [...this.results];
    }

    /**
     * Gets results filtered by simulation type
     */
    getResultsByType(type: 'optimized' | 'unoptimized'): SimulationResults[] {
        return this.results.filter(result => result.simulationType === type);
    }

    /**
     * Analyzes and compares simulation performance
     */
    analyzeResults(): AnalysisResults {
        const optimizedResults = this.getResultsByType('optimized');
        const unoptimizedResults = this.getResultsByType('unoptimized');

        const optimizedAnalysis = this.calculateAnalysis(optimizedResults);
        const unoptimizedAnalysis = this.calculateAnalysis(unoptimizedResults);
        const comparison = this.compareResults(optimizedAnalysis, unoptimizedAnalysis);

        return {
            optimized: optimizedAnalysis,
            unoptimized: unoptimizedAnalysis,
            comparison,
            totalSimulations: this.results.length,
            summary: this.generateSummary(optimizedAnalysis, unoptimizedAnalysis, comparison)
        };
    }

    /**
     * Exports comprehensive analysis to JSON file
     */
    async exportAllResults(): Promise<void> {
        try {
            const analysis = this.analyzeResults();
            const exportData = {
                exportTimestamp: new Date().toISOString(),
                version: '2.0',
                analysis,
                detailedResults: this.results.map(result => ({
                    ...result,
                    // Include only essential profile data to reduce file size
                    profiles: result.profiles.map(p => ({ id: p.id, name: p.name, dataPoints: p.data.length }))
                }))
            };

            const filename = `simulation_analysis_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;
            await this.downloadJson(exportData, filename);

            console.log(`Exported comprehensive analysis: ${filename}`);
        } catch (error) {
            console.error('Failed to export results:', error);
            throw new Error('Failed to export analysis results');
        }
    }

    /**
     * Loads results from localStorage on initialization
     */
    loadFromLocalStorage(): void {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                const parsedData = JSON.parse(stored);
                // Validate stored data structure
                if (Array.isArray(parsedData)) {
                    this.results = parsedData.filter(this.isValidSimulationResult);
                    console.log(`Loaded ${this.results.length} previous simulation results`);
                }
            }
        } catch (error) {
            console.error('Failed to load simulation results from localStorage:', error);
            // Clear corrupted data
            localStorage.removeItem(this.STORAGE_KEY);
        }
    }

    /**
     * Clears all stored results
     */
    clearResults(): void {
        this.results = [];
        localStorage.removeItem(this.STORAGE_KEY);
        console.log('Cleared all simulation results');
    }

    /**
     * Gets latest simulation result
     */
    getLatestResult(): SimulationResults | null {
        return this.results.length > 0 ? this.results[this.results.length - 1] : null;
    }

    /**
     * Gets performance metrics summary
     */
    getPerformanceMetrics(): PerformanceMetrics {
        const allMetrics = this.results.flatMap(r => r.metrics);

        if (allMetrics.length === 0) {
            return {
                totalDownloads: 0,
                averageLatency: 0,
                minLatency: 0,
                maxLatency: 0,
                totalDataTransferred: 0,
                uniqueObjectsDownloaded: 0
            };
        }

        const latencies = allMetrics.map(m => m.downloadLatencyMs);
        const totalData = allMetrics.reduce((sum, m) => sum + m.sizeBytes, 0);
        const uniqueObjects = new Set(allMetrics.map(m => m.objectId)).size;

        return {
            totalDownloads: allMetrics.length,
            averageLatency: latencies.reduce((sum, l) => sum + l, 0) / latencies.length,
            minLatency: Math.min(...latencies),
            maxLatency: Math.max(...latencies),
            totalDataTransferred: totalData,
            uniqueObjectsDownloaded: uniqueObjects
        };
    }

    /**
     * Private method to save results to localStorage
     */
    private saveToLocalStorage(): void {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.results));
        } catch (error) {
            console.error('Failed to save results to localStorage:', error);
            // If storage is full, remove oldest results and try again
            if (this.results.length > 10) {
                this.results = this.results.slice(-10); // Keep only last 10 results
                try {
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.results));
                } catch (retryError) {
                    console.error('Failed to save even after cleanup:', retryError);
                }
            }
        }
    }

    /**
     * Downloads individual simulation results as JSON
     */
    private async downloadResultsAsJson(results: SimulationResults): Promise<void> {
        const filename = `simulation_${results.simulationType}_${results.simulationId}_${Date.now()}.json`;
        await this.downloadJson(results, filename);
    }

    /**
     * Generic JSON download utility
     */
    private async downloadJson(data: any, filename: string): Promise<void> {
        try {
            const jsonString = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            URL.revokeObjectURL(url);
        } catch (error) {
            console.error(`Failed to download ${filename}:`, error);
            throw error;
        }
    }

    /**
     * Calculates statistical analysis for a set of results
     */
    private calculateAnalysis(results: SimulationResults[]): StatisticalAnalysis {
        if (results.length === 0) {
            return {
                totalSimulations: 0,
                averageLatency: 0,
                minLatency: 0,
                maxLatency: 0,
                latencyStandardDeviation: 0,
                totalObjects: 0,
                uniqueObjects: 0,
                totalDataSize: 0,
                averageDataSize: 0,
                cacheHitRate: 0
            };
        }

        const allMetrics = results.flatMap(r => r.metrics);
        const latencies = allMetrics.map(m => m.downloadLatencyMs);
        const sizes = allMetrics.map(m => m.sizeBytes);

        const averageLatency = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
        const variance = latencies.reduce((sum, l) => sum + Math.pow(l - averageLatency, 2), 0) / latencies.length;

        const totalObjects = allMetrics.length;
        const uniqueObjects = new Set(allMetrics.map(m => m.objectId)).size;
        const cacheHitRate = totalObjects > 0 ? ((totalObjects - uniqueObjects) / totalObjects) * 100 : 0;

        return {
            totalSimulations: results.length,
            averageLatency,
            minLatency: latencies.length > 0 ? Math.min(...latencies) : 0,
            maxLatency: latencies.length > 0 ? Math.max(...latencies) : 0,
            latencyStandardDeviation: Math.sqrt(variance),
            totalObjects,
            uniqueObjects,
            totalDataSize: sizes.reduce((sum, s) => sum + s, 0),
            averageDataSize: sizes.length > 0 ? sizes.reduce((sum, s) => sum + s, 0) / sizes.length : 0,
            cacheHitRate
        };
    }

    /**
     * Compares optimized vs unoptimized performance
     */
    private compareResults(optimized: StatisticalAnalysis, unoptimized: StatisticalAnalysis): ComparisonResults {
        const latencyImprovement = unoptimized.averageLatency > 0
            ? ((unoptimized.averageLatency - optimized.averageLatency) / unoptimized.averageLatency) * 100
            : 0;

        const dataSizeReduction = unoptimized.totalDataSize > 0
            ? ((unoptimized.totalDataSize - optimized.totalDataSize) / unoptimized.totalDataSize) * 100
            : 0;

        return {
            latencyImprovementPercent: latencyImprovement,
            dataSizeReductionPercent: dataSizeReduction,
            cacheEffectiveness: optimized.cacheHitRate,
            performanceGain: latencyImprovement > 5 ? 'significant_improvement' :
                latencyImprovement > 0 ? 'moderate_improvement' : 'no_improvement'
        };
    }

    /**
     * Generates human-readable summary
     */
    private generateSummary(
        optimized: StatisticalAnalysis,
        unoptimized: StatisticalAnalysis,
        comparison: ComparisonResults
    ): string {
        if (optimized.totalSimulations === 0 && unoptimized.totalSimulations === 0) {
            return 'No simulation data available for analysis.';
        }

        if (optimized.totalSimulations === 0) {
            return `Only unoptimized simulations available (${unoptimized.totalSimulations} runs). Average latency: ${unoptimized.averageLatency.toFixed(2)}ms.`;
        }

        if (unoptimized.totalSimulations === 0) {
            return `Only optimized simulations available (${optimized.totalSimulations} runs). Average latency: ${optimized.averageLatency.toFixed(2)}ms, cache hit rate: ${optimized.cacheHitRate.toFixed(1)}%.`;
        }

        const improvementText = comparison.latencyImprovementPercent > 0
            ? `${comparison.latencyImprovementPercent.toFixed(1)}% faster`
            : `${Math.abs(comparison.latencyImprovementPercent).toFixed(1)}% slower`;

        return `Comparison of ${optimized.totalSimulations} optimized vs ${unoptimized.totalSimulations} unoptimized simulations: ` +
            `Optimized mode is ${improvementText} (${optimized.averageLatency.toFixed(2)}ms vs ${unoptimized.averageLatency.toFixed(2)}ms average latency). ` +
            `Cache hit rate: ${optimized.cacheHitRate.toFixed(1)}%. Data efficiency: ${comparison.dataSizeReductionPercent.toFixed(1)}% reduction.`;
    }

    /**
     * Validates simulation result structure
     */
    private isValidSimulationResult(result: any): result is SimulationResults {
        return (
            result &&
            typeof result.simulationId === 'string' &&
            typeof result.simulationType === 'string' &&
            typeof result.startTime === 'number' &&
            typeof result.endTime === 'number' &&
            Array.isArray(result.metrics) &&
            typeof result.totalObjects === 'number' &&
            typeof result.averageLatency === 'number'
        );
    }
}

// Type definitions for analysis results
interface StatisticalAnalysis {
    totalSimulations: number;
    averageLatency: number;
    minLatency: number;
    maxLatency: number;
    latencyStandardDeviation: number;
    totalObjects: number;
    uniqueObjects: number;
    totalDataSize: number;
    averageDataSize: number;
    cacheHitRate: number;
}

interface ComparisonResults {
    latencyImprovementPercent: number;
    dataSizeReductionPercent: number;
    cacheEffectiveness: number;
    performanceGain: 'significant_improvement' | 'moderate_improvement' | 'no_improvement';
}

interface AnalysisResults {
    optimized: StatisticalAnalysis;
    unoptimized: StatisticalAnalysis;
    comparison: ComparisonResults;
    totalSimulations: number;
    summary: string;
}

interface PerformanceMetrics {
    totalDownloads: number;
    averageLatency: number;
    minLatency: number;
    maxLatency: number;
    totalDataTransferred: number;
    uniqueObjectsDownloaded: number;
}