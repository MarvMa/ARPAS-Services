import { SimulationResults, ObjectMetric } from '../types/simulation';

export class DataCollector {
    private results: SimulationResults[] = [];

    /**
     * Saves simulation results to JSON file and local storage
     */
    async saveResults(results: SimulationResults): Promise<void> {
        this.results.push(results);

        // Save to localStorage for persistence
        this.saveToLocalStorage();

        // Generate and download JSON file
        await this.downloadResultsAsJson(results);

        console.log(`Saved simulation results for ${results.simulationId}`);
    }

    /**
     * Gets all stored simulation results
     */
    getAllResults(): SimulationResults[] {
        return [...this.results];
    }

    /**
     * Gets results by simulation type
     */
    getResultsByType(type: 'optimized' | 'unoptimized'): SimulationResults[] {
        return this.results.filter(result => result.simulationType === type);
    }

    /**
     * Analyzes and compares simulation results
     */
    analyzeResults(): {
        optimized: AnalysisResults;
        unoptimized: AnalysisResults;
        comparison: ComparisonResults;
    } {
        const optimizedResults = this.getResultsByType('optimized');
        const unoptimizedResults = this.getResultsByType('unoptimized');

        const optimizedAnalysis = this.calculateAnalysis(optimizedResults);
        const unoptimizedAnalysis = this.calculateAnalysis(unoptimizedResults);
        const comparison = this.compareResults(optimizedAnalysis, unoptimizedAnalysis);

        return {
            optimized: optimizedAnalysis,
            unoptimized: unoptimizedAnalysis,
            comparison
        };
    }

    /**
     * Exports all results to a comprehensive JSON file
     */
    async exportAllResults(): Promise<void> {
        const exportData = {
            exportTimestamp: new Date().toISOString(),
            totalSimulations: this.results.length,
            analysis: this.analyzeResults(),
            detailedResults: this.results
        };

        await this.downloadJson(exportData, `simulation_results_export_${Date.now()}.json`);
    }

    /**
     * Loads results from localStorage on initialization
     */
    loadFromLocalStorage(): void {
        try {
            const stored = localStorage.getItem('simulation_results');
            if (stored) {
                this.results = JSON.parse(stored);
                console.log(`Loaded ${this.results.length} previous simulation results`);
            }
        } catch (error) {
            console.error('Failed to load simulation results from localStorage:', error);
        }
    }

    /**
     * Clears all stored results
     */
    clearResults(): void {
        this.results = [];
        localStorage.removeItem('simulation_results');
        console.log('Cleared all simulation results');
    }

    /**
     * Saves results to localStorage
     */
    private saveToLocalStorage(): void {
        try {
            localStorage.setItem('simulation_results', JSON.stringify(this.results));
        } catch (error) {
            console.error('Failed to save results to localStorage:', error);
        }
    }

    /**
     * Downloads simulation results as JSON file
     */
    private async downloadResultsAsJson(results: SimulationResults): Promise<void> {
        const filename = `simulation_${results.simulationType}_${results.simulationId}.json`;
        await this.downloadJson(results, filename);
    }

    /**
     * Downloads data as JSON file
     */
    private async downloadJson(data: any, filename: string): Promise<void> {
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * Calculates analysis for a set of simulation results
     */
    private calculateAnalysis(results: SimulationResults[]): AnalysisResults {
        if (results.length === 0) {
            return {
                totalSimulations: 0,
                averageLatency: 0,
                minLatency: 0,
                maxLatency: 0,
                totalObjects: 0,
                uniqueObjects: 0,
                totalDataSize: 0,
                averageDataSize: 0,
                latencyStandardDeviation: 0
            };
        }

        const allMetrics = results.flatMap(r => r.metrics);
        const latencies = allMetrics.map(m => m.downloadLatencyMs);
        const sizes = allMetrics.map(m => m.sizeBytes);

        const averageLatency = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
        const latencyVariance = latencies.reduce((sum, l) => sum + Math.pow(l - averageLatency, 2), 0) / latencies.length;

        return {
            totalSimulations: results.length,
            averageLatency,
            minLatency: Math.min(...latencies),
            maxLatency: Math.max(...latencies),
            totalObjects: allMetrics.length,
            uniqueObjects: new Set(allMetrics.map(m => m.objectId)).size,
            totalDataSize: sizes.reduce((sum, s) => sum + s, 0),
            averageDataSize: sizes.reduce((sum, s) => sum + s, 0) / sizes.length,
            latencyStandardDeviation: Math.sqrt(latencyVariance)
        };
    }

    /**
     * Compares optimized vs unoptimized results
     */
    private compareResults(optimized: AnalysisResults, unoptimized: AnalysisResults): ComparisonResults {
        const latencyImprovement = unoptimized.averageLatency > 0
            ? ((unoptimized.averageLatency - optimized.averageLatency) / unoptimized.averageLatency) * 100
            : 0;

        const dataSizeReduction = unoptimized.totalDataSize > 0
            ? ((unoptimized.totalDataSize - optimized.totalDataSize) / unoptimized.totalDataSize) * 100
            : 0;

        return {
            latencyImprovementPercent: latencyImprovement,
            dataSizeReductionPercent: dataSizeReduction,
            objectCacheHitRate: optimized.uniqueObjects > 0
                ? ((optimized.totalObjects - optimized.uniqueObjects) / optimized.totalObjects) * 100
                : 0,
            performanceGain: latencyImprovement > 0 ? 'optimized_better' : 'unoptimized_better'
        };
    }
}

interface AnalysisResults {
    totalSimulations: number;
    averageLatency: number;
    minLatency: number;
    maxLatency: number;
    totalObjects: number;
    uniqueObjects: number;
    totalDataSize: number;
    averageDataSize: number;
    latencyStandardDeviation: number;
}

interface ComparisonResults {
    latencyImprovementPercent: number;
    dataSizeReductionPercent: number;
    objectCacheHitRate: number;
    performanceGain: 'optimized_better' | 'unoptimized_better';
}