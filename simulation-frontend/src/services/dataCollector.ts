import {
    SimulationResults,
    ObjectMetric,
    PerformanceAnalysis,
    StatisticalAnalysis,
    ComparisonResults,
    ChartData,
    BenchmarkReport,
    DockerContainerStats
} from '../types/simulation';

/**
 * Enhanced service for collecting, analyzing and managing simulation results
 * with comprehensive scientific analysis capabilities
 */
export class DataCollector {
    private results: SimulationResults[] = [];
    private readonly STORAGE_KEY = 'simulation_results_v3';
    private readonly VERSION = '3.0.0';

    /**
     * Saves simulation results and automatically generates analysis
     */
    async saveResults(results: SimulationResults): Promise<void> {
        try {
            this.results.push(results);
            this.saveToLocalStorage();

            // Generate immediate individual report
            await this.downloadIndividualReport(results);

            console.log(`Saved and analyzed simulation: ${results.simulationId} 
                (${results.totalObjects} objects, ${results.averageLatency.toFixed(2)}ms avg latency, 
                ${results.cacheHitRate?.toFixed(1) || 0}% cache hit rate)`);
        } catch (error) {
            console.error('Failed to save simulation results:', error);
            throw new Error('Failed to save simulation results');
        }
    }

    /**
     * Generates comprehensive scientific benchmark report
     */
    async exportComprehensiveBenchmarkReport(): Promise<void> {
        try {
            console.log('Generating comprehensive benchmark report...');

            const analysis = this.analyzeResults();
            const report = this.generateBenchmarkReport(analysis);

            // Export multiple formats
            await Promise.all([
                this.downloadJson(report, `benchmark_report_comprehensive_${this.generateTimestamp()}.json`),
                this.downloadCsvData(analysis),
                this.downloadExcelReport(report),
                this.downloadMarkdownReport(report)
            ]);

            console.log('Comprehensive benchmark report exported successfully');
        } catch (error) {
            console.error('Failed to export comprehensive report:', error);
            throw new Error('Failed to export comprehensive benchmark report');
        }
    }

    /**
     * Exports data in multiple scientific formats
     */
    async exportScientificData(): Promise<void> {
        try {
            const analysis = this.analyzeResults();

            await Promise.all([
                this.exportRawDataCsv(),
                this.exportAggregatedStatsCsv(),
                this.exportLatencyDistribution(),
                this.exportCachePerformanceCsv(),
                this.exportInfrastructureMetrics()
            ]);

            console.log('Scientific data exported in multiple formats');
        } catch (error) {
            console.error('Failed to export scientific data:', error);
            throw error;
        }
    }
    /**
     * Exports all results in comprehensive scientific formats
     */
    async exportAllResults(): Promise<void> {
        if (this.results.length === 0) {
            throw new Error('No results to export');
        }
        await this.exportComprehensiveBenchmarkReport();
        await this.exportScientificData();
    }
    /**
     * Analyzes simulation results with comprehensive statistics
     */
    analyzeResults(): PerformanceAnalysis {
        const optimizedResults = this.getResultsByType('optimized');
        const unoptimizedResults = this.getResultsByType('unoptimized');

        const optimizedAnalysis = this.calculateStatisticalAnalysis(optimizedResults);
        const unoptimizedAnalysis = this.calculateStatisticalAnalysis(unoptimizedResults);
        const comparison = this.compareResults(optimizedAnalysis, unoptimizedAnalysis);
        const charts = this.generateChartData(optimizedResults, unoptimizedResults);

        return {
            optimized: optimizedAnalysis,
            unoptimized: unoptimizedAnalysis,
            comparison,
            totalSimulations: this.results.length,
            summary: this.generateExecutiveSummary(optimizedAnalysis, unoptimizedAnalysis, comparison),
            charts
        };
    }

    /**
     * Calculates comprehensive statistical analysis
     */
    private calculateStatisticalAnalysis(results: SimulationResults[]): StatisticalAnalysis {
        if (results.length === 0) {
            return this.getEmptyStatisticalAnalysis();
        }

        const allMetrics = results.flatMap(r => r.metrics.filter(m => !m.isBaseline));
        const latencies = allMetrics.map(m => m.downloadLatencyMs);
        const serverLatencies = allMetrics.map(m => m.serverLatencyMs || 0);
        const sizes = allMetrics.map(m => m.sizeBytes);

        const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0) / 1000; // seconds
        const totalObjects = allMetrics.length;
        const uniqueObjects = new Set(allMetrics.map(m => m.objectId)).size;
        const cacheHits = allMetrics.filter(m => m.cacheHit).length;
        const errors = allMetrics.filter(m => m.error).length;

        return {
            totalSimulations: results.length,
            averageLatency: this.calculateMean(latencies),
            minLatency: latencies.length > 0 ? Math.min(...latencies) : 0,
            maxLatency: latencies.length > 0 ? Math.max(...latencies) : 0,
            medianLatency: this.calculateMedian(latencies),
            p95Latency: this.calculatePercentile(latencies, 95),
            p99Latency: this.calculatePercentile(latencies, 99),
            latencyStandardDeviation: this.calculateStandardDeviation(latencies),
            totalObjects,
            uniqueObjects,
            totalDataSize: sizes.reduce((sum, s) => sum + s, 0),
            averageDataSize: this.calculateMean(sizes),
            cacheHitRate: totalObjects > 0 ? (cacheHits / totalObjects) * 100 : 0,
            throughput: totalDuration > 0 ? totalObjects / totalDuration : 0,
            requestsPerSecond: totalDuration > 0 ? results.reduce((sum, r) => sum + (r.totalRequests || 0), 0) / totalDuration : 0,
            errorRate: totalObjects > 0 ? (errors / totalObjects) * 100 : 0,
            successRate: totalObjects > 0 ? ((totalObjects - errors) / totalObjects) * 100 : 0
        };
    }

    /**
     * Compares optimized vs unoptimized performance
     */
    private compareResults(optimized: StatisticalAnalysis, unoptimized: StatisticalAnalysis): ComparisonResults {
        const latencyImprovement = unoptimized.averageLatency > 0
            ? ((unoptimized.averageLatency - optimized.averageLatency) / unoptimized.averageLatency) * 100
            : 0;

        const throughputImprovement = unoptimized.throughput > 0
            ? ((optimized.throughput - unoptimized.throughput) / unoptimized.throughput) * 100
            : 0;

        const dataSizeReduction = unoptimized.totalDataSize > 0
            ? ((unoptimized.totalDataSize - optimized.totalDataSize) / unoptimized.totalDataSize) * 100
            : 0;

        let performanceGain: ComparisonResults['performanceGain'] = 'no_improvement';
        if (latencyImprovement > 25 && throughputImprovement > 20) {
            performanceGain = 'significant_improvement';
        } else if (latencyImprovement > 10 && throughputImprovement > 5) {
            performanceGain = 'moderate_improvement';
        } else if (latencyImprovement < -5 || throughputImprovement < -10) {
            performanceGain = 'regression';
        }

        return {
            latencyImprovementPercent: latencyImprovement,
            throughputImprovementPercent: throughputImprovement,
            cacheEffectiveness: optimized.cacheHitRate,
            dataSizeReductionPercent: dataSizeReduction,
            performanceGain,
            recommendation: this.generateRecommendation(performanceGain, latencyImprovement, optimized.cacheHitRate)
        };
    }

    /**
     * Generates chart data for visualization
     */
    private generateChartData(optimizedResults: SimulationResults[], unoptimizedResults: SimulationResults[]): ChartData[] {
        const charts: ChartData[] = [];

        // Latency comparison chart
        charts.push({
            type: 'bar',
            title: 'Average Latency Comparison',
            description: 'Comparison of average download latencies between optimized and unoptimized modes',
            data: [
                {
                    label: 'Optimized',
                    value: this.calculateAverageLatency(optimizedResults),
                    color: '#4CAF50'
                },
                {
                    label: 'Unoptimized',
                    value: this.calculateAverageLatency(unoptimizedResults),
                    color: '#f44336'
                }
            ]
        });

        // Cache hit rate chart
        const cacheData = this.calculateCacheStats(optimizedResults);
        charts.push({
            type: 'pie',
            title: 'Cache Performance (Optimized Mode)',
            description: 'Distribution of cache hits vs misses in optimized mode',
            data: [
                {label: 'Cache Hits', value: cacheData.hits, color: '#4CAF50'},
                {label: 'Cache Misses', value: cacheData.misses, color: '#ff9800'}
            ]
        });

        // Latency distribution histogram
        const allLatencies = [...optimizedResults, ...unoptimizedResults]
            .flatMap(r => r.metrics.filter(m => !m.isBaseline && !m.error))
            .map(m => m.downloadLatencyMs);

        charts.push({
            type: 'histogram',
            title: 'Latency Distribution',
            description: 'Distribution of download latencies across all simulations',
            data: this.createHistogramData(allLatencies, 20)
        });

        // Throughput over time
        charts.push({
            type: 'line',
            title: 'Throughput Over Time',
            description: 'Download throughput comparison between modes',
            data: this.createThroughputTimelineData(optimizedResults, unoptimizedResults)
        });

        // Infrastructure utilization
        const dockerStats = this.aggregateDockerStats();
        if (Object.keys(dockerStats).length > 0) {
            charts.push({
                type: 'bar',
                title: 'Infrastructure Utilization',
                description: 'Average CPU and memory usage across services',
                data: this.createInfrastructureChart(dockerStats)
            });
        }

        return charts;
    }

    /**
     * Generates comprehensive benchmark report
     */
    private generateBenchmarkReport(analysis: PerformanceAnalysis): BenchmarkReport {
        const metadata = {
            generatedAt: new Date().toISOString(),
            version: this.VERSION,
            totalSimulations: analysis.totalSimulations,
            optimizedSimulations: this.getResultsByType('optimized').length,
            unoptimizedSimulations: this.getResultsByType('unoptimized').length
        };

        const executive = {
            summary: analysis.summary,
            keyFindings: this.generateKeyFindings(analysis),
            recommendations: this.generateRecommendations(analysis),
            performanceGain: this.formatPerformanceGain(analysis.comparison.performanceGain)
        };

        return {
            metadata,
            executive,
            analysis,
            rawData: {
                simulations: this.results,
                aggregatedMetrics: this.results.flatMap(r => r.metrics)
            },
            charts: analysis.charts,
            infrastructure: {
                dockerStats: this.aggregateDockerStats(),
                systemResource: this.calculateSystemResourceSummary()
            }
        };
    }

    /**
     * Downloads individual simulation report
     */
    private async downloadIndividualReport(results: SimulationResults): Promise<void> {
        const report = {
            simulation: results,
            analysis: {
                summary: this.generateIndividualSummary(results),
                performance: this.analyzeIndividualPerformance(results),
                infrastructure: this.extractInfrastructureData(results)
            },
            charts: this.generateIndividualCharts(results),
            timestamp: new Date().toISOString()
        };

        const filename = `simulation_${results.simulationType}_${results.simulationId}_${Date.now()}.json`;
        await this.downloadJson(report, filename);
    }

    /**
     * Export raw data as CSV
     */
    private async exportRawDataCsv(): Promise<void> {
        const headers = [
            'simulationId', 'simulationType', 'profileId', 'objectId', 'downloadLatencyMs',
            'serverLatencyMs', 'clientLatencyMs', 'sizeBytes', 'downloadSource', 'cacheHit',
            'timestamp', 'error', 'isBaseline'
        ];

        const rows = this.results.flatMap(sim =>
            sim.metrics.map(metric => [
                sim.simulationId,
                sim.simulationType,
                metric.profileId,
                metric.objectId,
                metric.downloadLatencyMs,
                metric.serverLatencyMs || 0,
                metric.clientLatencyMs || 0,
                metric.sizeBytes,
                metric.downloadSource || 'unknown',
                metric.cacheHit || false,
                new Date(metric.timestamp).toISOString(),
                metric.error || '',
                metric.isBaseline || false
            ])
        );

        const csvContent = [headers, ...rows].map(row =>
            row.map(cell => `"${cell}"`).join(',')
        ).join('\n');

        await this.downloadCsv(csvContent, `raw_metrics_${this.generateTimestamp()}.csv`);
    }

    /**
     * Export aggregated statistics as CSV
     */
    private async exportAggregatedStatsCsv(): Promise<void> {
        const analysis = this.analyzeResults();

        const headers = [
            'simulationType', 'totalSimulations', 'averageLatency', 'medianLatency', 'p95Latency',
            'totalObjects', 'uniqueObjects', 'cacheHitRate', 'throughput', 'successRate'
        ];

        const rows = [
            ['optimized', analysis.optimized.totalSimulations, analysis.optimized.averageLatency,
                analysis.optimized.medianLatency, analysis.optimized.p95Latency, analysis.optimized.totalObjects,
                analysis.optimized.uniqueObjects, analysis.optimized.cacheHitRate, analysis.optimized.throughput,
                analysis.optimized.successRate],
            ['unoptimized', analysis.unoptimized.totalSimulations, analysis.unoptimized.averageLatency,
                analysis.unoptimized.medianLatency, analysis.unoptimized.p95Latency, analysis.unoptimized.totalObjects,
                analysis.unoptimized.uniqueObjects, analysis.unoptimized.cacheHitRate, analysis.unoptimized.throughput,
                analysis.unoptimized.successRate]
        ];

        const csvContent = [headers, ...rows].map(row =>
            row.map(cell => `"${cell}"`).join(',')
        ).join('\n');

        await this.downloadCsv(csvContent, `aggregated_stats_${this.generateTimestamp()}.csv`);
    }

    // Utility methods for statistical calculations
    private calculateMean(values: number[]): number {
        return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
    }

    private calculateMedian(values: number[]): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }

    private calculatePercentile(values: number[], percentile: number): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    private calculateStandardDeviation(values: number[]): number {
        if (values.length <= 1) return 0;
        const mean = this.calculateMean(values);
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    private createHistogramData(values: number[], bins: number): any[] {
        if (values.length === 0) return [];

        const min = Math.min(...values);
        const max = Math.max(...values);
        const binSize = (max - min) / bins;

        const histogram = Array(bins).fill(0).map((_, i) => ({
            range: `${(min + i * binSize).toFixed(0)}-${(min + (i + 1) * binSize).toFixed(0)}ms`,
            count: 0
        }));

        values.forEach(value => {
            const binIndex = Math.min(Math.floor((value - min) / binSize), bins - 1);
            histogram[binIndex].count++;
        });

        return histogram;
    }

    // Additional helper methods...
    private getEmptyStatisticalAnalysis(): StatisticalAnalysis {
        return {
            totalSimulations: 0,
            averageLatency: 0,
            minLatency: 0,
            maxLatency: 0,
            medianLatency: 0,
            p95Latency: 0,
            p99Latency: 0,
            latencyStandardDeviation: 0,
            totalObjects: 0,
            uniqueObjects: 0,
            totalDataSize: 0,
            averageDataSize: 0,
            cacheHitRate: 0,
            throughput: 0,
            requestsPerSecond: 0,
            errorRate: 0,
            successRate: 0
        };
    }

    private generateExecutiveSummary(optimized: StatisticalAnalysis, unoptimized: StatisticalAnalysis, comparison: ComparisonResults): string {
        if (optimized.totalSimulations === 0 && unoptimized.totalSimulations === 0) {
            return 'No simulation data available for analysis.';
        }

        const improvement = comparison.latencyImprovementPercent;
        const cacheRate = optimized.cacheHitRate;

        return `Performance analysis of ${optimized.totalSimulations + unoptimized.totalSimulations} simulations shows ` +
            `${improvement > 0 ? `${improvement.toFixed(1)}% latency improvement` : 'no significant improvement'} ` +
            `with optimization enabled. Cache hit rate: ${cacheRate.toFixed(1)}%. ` +
            `Recommendation: ${comparison.recommendation}`;
    }

    private generateKeyFindings(analysis: PerformanceAnalysis): string[] {
        const findings: string[] = [];

        if (analysis.comparison.latencyImprovementPercent > 10) {
            findings.push(`Significant latency reduction: ${analysis.comparison.latencyImprovementPercent.toFixed(1)}%`);
        }

        if (analysis.optimized.cacheHitRate > 70) {
            findings.push(`High cache efficiency: ${analysis.optimized.cacheHitRate.toFixed(1)}% hit rate`);
        }

        if (analysis.comparison.throughputImprovementPercent > 20) {
            findings.push(`Substantial throughput increase: ${analysis.comparison.throughputImprovementPercent.toFixed(1)}%`);
        }

        if (findings.length === 0) {
            findings.push('Optimization showed minimal performance impact');
        }

        return findings;
    }

    private generateRecommendations(analysis: PerformanceAnalysis): string[] {
        const recommendations: string[] = [];

        if (analysis.optimized.cacheHitRate < 50) {
            recommendations.push('Improve cache preloading strategy to increase hit rate');
        }

        if (analysis.optimized.errorRate > 5) {
            recommendations.push('Investigate and resolve network connectivity issues');
        }

        if (analysis.comparison.latencyImprovementPercent < 5) {
            recommendations.push('Consider alternative optimization strategies');
        } else {
            recommendations.push('Continue using optimized mode for production workloads');
        }

        return recommendations;
    }

    // Download utility methods
    private async downloadJson(data: any, filename: string): Promise<void> {
        const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
        this.downloadBlob(blob, filename);
    }

    private async downloadCsv(content: string, filename: string): Promise<void> {
        const blob = new Blob([content], {type: 'text/csv'});
        this.downloadBlob(blob, filename);
    }

    private downloadBlob(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    private generateTimestamp(): string {
        return new Date().toISOString().split('T')[0].replace(/-/g, '') + '_' + Date.now();
    }

    // Storage methods
    private saveToLocalStorage(): void {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.results));
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
            if (this.results.length > 20) {
                this.results = this.results.slice(-20);
                try {
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.results));
                } catch (retryError) {
                    console.error('Failed to save even after cleanup:', retryError);
                }
            }
        }
    }

    public loadFromLocalStorage(): void {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                this.results = JSON.parse(stored);
                console.log(`Loaded ${this.results.length} previous simulation results`);
            }
        } catch (error) {
            console.error('Failed to load from localStorage:', error);
            localStorage.removeItem(this.STORAGE_KEY);
        }
    }

    public getAllResults(): SimulationResults[] {
        return [...this.results];
    }

    public getResultsByType(type: 'optimized' | 'unoptimized'): SimulationResults[] {
        return this.results.filter(result => result.simulationType === type);
    }

    public clearResults(): void {
        this.results = [];
        localStorage.removeItem(this.STORAGE_KEY);
    }

    // Placeholder methods for additional functionality
    private async exportLatencyDistribution(): Promise<void> {
        // Implementation for latency distribution export
    }

    private async exportCachePerformanceCsv(): Promise<void> {
        // Implementation for cache performance metrics
    }

    private async exportInfrastructureMetrics(): Promise<void> {
        // Implementation for infrastructure metrics export
    }

    private async downloadCsvData(analysis: PerformanceAnalysis): Promise<void> {
        await this.exportRawDataCsv();
        await this.exportAggregatedStatsCsv();
    }

    private async downloadExcelReport(report: BenchmarkReport): Promise<void> {
        // Implementation for Excel export (would require additional library)
        console.log('Excel export would be implemented with additional library');
    }

    private async downloadMarkdownReport(report: BenchmarkReport): Promise<void> {
        const markdown = this.generateMarkdownReport(report);
        const blob = new Blob([markdown], {type: 'text/markdown'});
        this.downloadBlob(blob, `benchmark_report_${this.generateTimestamp()}.md`);
    }

    private generateMarkdownReport(report: BenchmarkReport): string {
        return `# Benchmark Report

## Executive Summary
${report.executive.summary}

## Key Findings
${report.executive.keyFindings.map(finding => `- ${finding}`).join('\n')}

## Performance Analysis
- **Latency Improvement**: ${report.analysis.comparison.latencyImprovementPercent.toFixed(1)}%
- **Cache Hit Rate**: ${report.analysis.optimized.cacheHitRate.toFixed(1)}%
- **Throughput**: ${report.analysis.optimized.throughput.toFixed(2)} objects/sec

## Recommendations
${report.executive.recommendations.map(rec => `- ${rec}`).join('\n')}

Generated at: ${report.metadata.generatedAt}
`;
    }

    // Helper methods for chart generation
    private calculateAverageLatency(results: SimulationResults[]): number {
        const allMetrics = results.flatMap(r => r.metrics.filter(m => !m.isBaseline && !m.error));
        return allMetrics.length > 0 ? this.calculateMean(allMetrics.map(m => m.downloadLatencyMs)) : 0;
    }

    private calculateCacheStats(results: SimulationResults[]): { hits: number, misses: number } {
        const allMetrics = results.flatMap(r => r.metrics.filter(m => !m.isBaseline && !m.error));
        const hits = allMetrics.filter(m => m.cacheHit).length;
        const misses = allMetrics.length - hits;
        return {hits, misses};
    }

    private createThroughputTimelineData(optimized: SimulationResults[], unoptimized: SimulationResults[]): any[] {
        // Implementation for throughput timeline
        return [];
    }

    private aggregateDockerStats(): Record<string, DockerContainerStats> {
        // Implementation for Docker stats aggregation
        return {};
    }

    private createInfrastructureChart(dockerStats: Record<string, DockerContainerStats>): any[] {
        // Implementation for infrastructure chart
        return [];
    }

    private calculateSystemResourceSummary(): any {
        return {
            averageCpuUsage: 0,
            peakMemoryUsage: 0,
            networkThroughput: 0
        };
    }

    private generateIndividualSummary(results: SimulationResults): string {
        return `${results.simulationType} simulation completed with ${results.totalObjects} objects downloaded in ${(results.duration || 0) / 1000}s`;
    }

    private analyzeIndividualPerformance(results: SimulationResults): any {
        return {
            latency: results.averageLatency,
            throughput: results.throughput || 0,
            cacheHitRate: results.cacheHitRate || 0
        };
    }

    private extractInfrastructureData(results: SimulationResults): any {
        return results.dockerStats || {};
    }

    private generateIndividualCharts(results: SimulationResults): ChartData[] {
        return [];
    }

    private formatPerformanceGain(gain: string): string {
        switch (gain) {
            case 'significant_improvement':
                return 'Significant Performance Improvement';
            case 'moderate_improvement':
                return 'Moderate Performance Improvement';
            case 'no_improvement':
                return 'No Significant Improvement';
            case 'regression':
                return 'Performance Regression';
            default:
                return 'Unknown';
        }
    }

    private generateRecommendation(gain: string, latencyImprovement: number, cacheHitRate: number): string {
        if (gain === 'significant_improvement') {
            return 'Optimization highly recommended for production use';
        } else if (gain === 'moderate_improvement') {
            return 'Optimization recommended with further tuning';
        } else if (cacheHitRate < 30) {
            return 'Improve cache strategy before enabling optimization';
        } else {
            return 'Evaluate cost-benefit of optimization implementation';
        }
    }

    /**
     * Exports comprehensive benchmark data as structured JSON
     */


    /**
     * Extract infrastructure metrics for specific containers
     */
    private extractInfrastructureMetrics(report: BenchmarkReport): any {
        const optimizedResults = this.getResultsByType('optimized');
        const unoptimizedResults = this.getResultsByType('unoptimized');

        const extractContainerStats = (results: SimulationResults[], containerNames: string[]) => {
            const allStats: Record<string, any[]> = {};

            results.forEach(result => {
                if (result.dockerStats) {
                    Object.entries(result.dockerStats).forEach(([container, stats]) => {
                        if (containerNames.some(name => container.includes(name))) {
                            if (!allStats[container]) {
                                allStats[container] = [];
                            }
                            allStats[container].push(stats);
                        }
                    });
                }
            });

            // Aggregate statistics
            const aggregated: Record<string, any> = {};
            Object.entries(allStats).forEach(([container, statsList]) => {
                const cpuValues = statsList.map(s => s.cpu?.average || 0).filter(v => v > 0);
                const memoryValues = statsList.map(s => s.memory?.average || 0).filter(v => v > 0);
                const networkRx = statsList.map(s => s.network?.totalRx || 0).filter(v => v > 0);
                const networkTx = statsList.map(s => s.network?.totalTx || 0).filter(v => v > 0);

                aggregated[container] = {
                    cpu: {
                        average: this.calculateMean(cpuValues),
                        max: cpuValues.length > 0 ? Math.max(...cpuValues) : 0,
                        median: this.calculateMedian(cpuValues)
                    },
                    memory: {
                        average: this.calculateMean(memoryValues),
                        max: memoryValues.length > 0 ? Math.max(...memoryValues) : 0,
                        median: this.calculateMedian(memoryValues)
                    },
                    network: {
                        totalRx: networkRx.reduce((sum, v) => sum + v, 0),
                        totalTx: networkTx.reduce((sum, v) => sum + v, 0),
                        avgRxRate: this.calculateMean(networkRx),
                        avgTxRate: this.calculateMean(networkTx)
                    }
                };
            });

            return aggregated;
        };

        return {
            optimized: extractContainerStats(
                optimizedResults,
                ['storage-service', 'cache-service', 'minio', 'prediction-service']
            ),
            unoptimized: extractContainerStats(
                unoptimizedResults,
                ['storage-service', 'minio']
            )
        };
    }

    /**
     * Calculate statistical significance of results
     */
    private calculateStatisticalSignificance(analysis: PerformanceAnalysis): any {
        const optimizedLatencies = this.getResultsByType('optimized')
            .flatMap(r => r.metrics.filter(m => !m.isBaseline && !m.error))
            .map(m => m.downloadLatencyMs);

        const unoptimizedLatencies = this.getResultsByType('unoptimized')
            .flatMap(r => r.metrics.filter(m => !m.isBaseline && !m.error))
            .map(m => m.downloadLatencyMs);

        if (optimizedLatencies.length < 2 || unoptimizedLatencies.length < 2) {
            return {significant: false, message: 'Insufficient data for statistical analysis'};
        }

        // Calculate t-test (simplified)
        const n1 = optimizedLatencies.length;
        const n2 = unoptimizedLatencies.length;
        const mean1 = this.calculateMean(optimizedLatencies);
        const mean2 = this.calculateMean(unoptimizedLatencies);
        const std1 = this.calculateStandardDeviation(optimizedLatencies);
        const std2 = this.calculateStandardDeviation(unoptimizedLatencies);

        const pooledStd = Math.sqrt(((n1 - 1) * std1 * std1 + (n2 - 1) * std2 * std2) / (n1 + n2 - 2));
        const tStatistic = (mean1 - mean2) / (pooledStd * Math.sqrt(1 / n1 + 1 / n2));

        return {
            significant: Math.abs(tStatistic) > 1.96, // 95% confidence
            tStatistic: tStatistic,
            sampleSizes: {optimized: n1, unoptimized: n2},
            confidenceLevel: '95%',
            message: Math.abs(tStatistic) > 1.96
                ? 'Results are statistically significant'
                : 'Results are not statistically significant'
        };
    }
}