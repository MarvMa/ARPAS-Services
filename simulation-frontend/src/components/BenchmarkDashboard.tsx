import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ObjectMetric, PerformanceAnalysis, SimulationResults, SimulationState} from '../types/simulation';
import {DataCollector} from '../services/dataCollector';

interface BenchmarkDashboardProps {
    dataCollector: DataCollector;
    simulationState: SimulationState | null;
    onExportResults: () => Promise<void>;
    onClearResults: () => void;
}

interface RealTimeMetrics {
    currentLatency: number;
    averageLatency: number;
    throughput: number;
    cacheHitRate: number;
    objectsDownloaded: number;
    requestsPerSecond: number;
    errorRate: number;
}

export const BenchmarkDashboard: React.FC<BenchmarkDashboardProps> = ({
                                                                          dataCollector,
                                                                          simulationState,
                                                                          onExportResults,
                                                                          onClearResults
                                                                      }) => {
    const [allResults, setAllResults] = useState<SimulationResults[]>([]);
    const [analysis, setAnalysis] = useState<PerformanceAnalysis | null>(null);
    const [realTimeMetrics, setRealTimeMetrics] = useState<RealTimeMetrics | null>(null);
    const [selectedChart, setSelectedChart] = useState<string>('latency');
    const [showRawData, setShowRawData] = useState<boolean>(false);

    // Update results when simulation completes
    useEffect(() => {
        const updateResults = () => {
            const results = dataCollector.getAllResults();
            setAllResults(results);

            if (results.length > 0) {
                const newAnalysis = dataCollector.analyzeResults();
                setAnalysis(newAnalysis);
            }
        };

        updateResults();
        const interval = setInterval(updateResults, 2000);
        return () => clearInterval(interval);
    }, [dataCollector]);

    // Real-time metrics calculation
    useEffect(() => {
        if (!simulationState?.isRunning) {
            setRealTimeMetrics(null);
            return;
        }

        const calculateRealTimeMetrics = () => {
            const allMetrics: ObjectMetric[] = [];
            const allRequests: number[] = [];
            let totalCacheHits = 0;
            let totalCacheMisses = 0;
            let totalErrors = 0;

            Object.values(simulationState.profileStates).forEach(state => {
                allMetrics.push(...state.metrics);
                allRequests.push(state.totalRequests || 0);
                totalCacheHits += state.cacheHits || 0;
                totalCacheMisses += state.cacheMisses || 0;
                totalErrors += state.failedRequests || 0;
            });

            const validMetrics = allMetrics.filter(m => !m.error && !m.isBaseline);
            const duration = (Date.now() - simulationState.startTime) / 1000; // seconds

            const currentLatency = validMetrics.length > 0
                ? validMetrics[validMetrics.length - 1].downloadLatencyMs
                : 0;

            const averageLatency = validMetrics.length > 0
                ? validMetrics.reduce((sum, m) => sum + m.downloadLatencyMs, 0) / validMetrics.length
                : 0;

            const totalRequests = allRequests.reduce((sum, r) => sum + r, 0);
            const cacheTotal = totalCacheHits + totalCacheMisses;

            setRealTimeMetrics({
                currentLatency,
                averageLatency,
                throughput: duration > 0 ? validMetrics.length / duration : 0,
                cacheHitRate: cacheTotal > 0 ? (totalCacheHits / cacheTotal) * 100 : 0,
                objectsDownloaded: validMetrics.length,
                requestsPerSecond: duration > 0 ? totalRequests / duration : 0,
                errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0
            });
        };

        calculateRealTimeMetrics();
        const interval = setInterval(calculateRealTimeMetrics, 1000);
        return () => clearInterval(interval);
    }, [simulationState]);

    // Chart data generation
    const chartData = useMemo(() => {
        if (!analysis) return null;

        const charts: Record<string, any> = {};

        // Latency comparison chart
        charts.latency = {
            type: 'bar',
            data: {
                labels: ['Optimized', 'Unoptimized'],
                datasets: [{
                    label: 'Average Latency (ms)',
                    data: [analysis.optimized.averageLatency, analysis.unoptimized.averageLatency],
                    backgroundColor: ['#4CAF50', '#f44336'],
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: {display: true, text: 'Latency Comparison'},
                    legend: {display: false}
                },
                scales: {
                    y: {beginAtZero: true, title: {display: true, text: 'Latency (ms)'}}
                }
            }
        };

        // Cache performance pie chart
        const cacheHits = analysis.optimized.totalObjects * (analysis.optimized.cacheHitRate / 100);
        const cacheMisses = analysis.optimized.totalObjects - cacheHits;

        charts.cache = {
            type: 'pie',
            data: {
                labels: ['Cache Hits', 'Cache Misses'],
                datasets: [{
                    data: [cacheHits, cacheMisses],
                    backgroundColor: ['#4CAF50', '#ff9800'],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: {display: true, text: 'Cache Performance (Optimized Mode)'},
                    legend: {position: 'bottom'}
                }
            }
        };

        // Throughput comparison
        charts.throughput = {
            type: 'bar',
            data: {
                labels: ['Optimized', 'Unoptimized'],
                datasets: [{
                    label: 'Throughput (objects/sec)',
                    data: [analysis.optimized.throughput, analysis.unoptimized.throughput],
                    backgroundColor: ['#2196F3', '#ff5722'],
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: {display: true, text: 'Throughput Comparison'},
                    legend: {display: false}
                },
                scales: {
                    y: {beginAtZero: true, title: {display: true, text: 'Objects/sec'}}
                }
            }
        };

        // Latency distribution histogram
        if (allResults.length > 0) {
            const allLatencies = allResults
                .flatMap(r => r.metrics.filter(m => !m.isBaseline && !m.error))
                .map(m => m.downloadLatencyMs);

            const histogram = createHistogram(allLatencies, 15);

            charts.distribution = {
                type: 'bar',
                data: {
                    labels: histogram.map(h => h.range),
                    datasets: [{
                        label: 'Frequency',
                        data: histogram.map(h => h.count),
                        backgroundColor: '#9C27B0',
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        title: {display: true, text: 'Latency Distribution'},
                        legend: {display: false}
                    },
                    scales: {
                        x: {title: {display: true, text: 'Latency Range (ms)'}},
                        y: {beginAtZero: true, title: {display: true, text: 'Frequency'}}
                    }
                }
            };
        }

        return charts;
    }, [analysis, allResults]);

    // Real-time chart for current simulation
    const realTimeChart = useMemo(() => {
        if (!simulationState?.isRunning || !realTimeMetrics) return null;

        return {
            type: 'line',
            data: {
                labels: ['Current', 'Average'],
                datasets: [{
                    label: 'Latency (ms)',
                    data: [realTimeMetrics.currentLatency, realTimeMetrics.averageLatency],
                    borderColor: '#4CAF50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    borderWidth: 3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: {display: true, text: 'Real-time Performance'},
                    legend: {display: false}
                },
                scales: {
                    y: {beginAtZero: true}
                }
            }
        };
    }, [simulationState, realTimeMetrics]);

    // Export functions
    const handleExportComprehensive = useCallback(async () => {
        try {
            await dataCollector.exportComprehensiveBenchmarkReport();
            alert('Comprehensive benchmark report exported successfully!');
        } catch (error) {
            console.error('Export failed:', error);
            alert('Failed to export comprehensive report. Check console for details.');
        }
    }, [dataCollector]);

    const handleExportScientific = useCallback(async () => {
        try {
            await dataCollector.exportScientificData();
            alert('Scientific data exported in multiple formats!');
        } catch (error) {
            console.error('Scientific export failed:', error);
            alert('Failed to export scientific data. Check console for details.');
        }
    }, [dataCollector]);

    // Utility function for histogram
    const createHistogram = (values: number[], bins: number) => {
        if (values.length === 0) return [];

        const min = Math.min(...values);
        const max = Math.max(...values);
        const binSize = (max - min) / bins;

        const histogram = Array(bins).fill(0).map((_, i) => ({
            range: `${(min + i * binSize).toFixed(0)}-${(min + (i + 1) * binSize).toFixed(0)}`,
            count: 0
        }));

        values.forEach(value => {
            const binIndex = Math.min(Math.floor((value - min) / binSize), bins - 1);
            histogram[binIndex].count++;
        });

        return histogram;
    };

    // Chart rendering component
    const ChartRenderer: React.FC<{ chart: any; title: string }> = ({chart, title}) => (
        <div className="chart-container">
            <h4>{title}</h4>
            <div className="chart-placeholder">
                <div className="chart-info">
                    <strong>Chart Type:</strong> {chart.type}<br/>
                    <strong>Data Points:</strong> {chart.data.datasets?.[0]?.data?.length || 0}
                </div>
                <div className="chart-note">
                    Chart visualization would be rendered here with Chart.js or similar library
                </div>
            </div>
        </div>
    );

    return (
        <div className="benchmark-dashboard">
            <div className="dashboard-header">
                <h2>Benchmark Dashboard</h2>
                <div className="dashboard-controls">
                    <button
                        onClick={handleExportComprehensive}
                        className="btn-primary"
                        disabled={allResults.length === 0}
                    >
                        📊 Export Full Report
                    </button>
                    <button
                        onClick={handleExportScientific}
                        className="btn-secondary"
                        disabled={allResults.length === 0}
                    >
                        🔬 Export Scientific Data
                    </button>
                    <button
                        onClick={onExportResults}
                        className="btn-secondary"
                        disabled={allResults.length === 0}
                    >
                        📋 Export Results
                    </button>
                    <button
                        onClick={onClearResults}
                        className="btn-warning"
                    >
                        🗑️ Clear Results
                    </button>
                </div>
            </div>

            {/* Real-time Metrics */}
            {simulationState?.isRunning && realTimeMetrics && (
                <div className="real-time-section">
                    <h3>📈 Real-time Performance</h3>
                    <div className="metrics-grid">
                        <div className="metric-card">
                            <div className="metric-value">{realTimeMetrics.currentLatency.toFixed(1)}ms</div>
                            <div className="metric-label">Current Latency</div>
                        </div>
                        <div className="metric-card">
                            <div className="metric-value">{realTimeMetrics.averageLatency.toFixed(1)}ms</div>
                            <div className="metric-label">Average Latency</div>
                        </div>
                        <div className="metric-card">
                            <div className="metric-value">{realTimeMetrics.throughput.toFixed(2)}</div>
                            <div className="metric-label">Objects/sec</div>
                        </div>
                        <div className="metric-card">
                            <div className="metric-value">{realTimeMetrics.cacheHitRate.toFixed(1)}%</div>
                            <div className="metric-label">Cache Hit Rate</div>
                        </div>
                        <div className="metric-card">
                            <div className="metric-value">{realTimeMetrics.objectsDownloaded}</div>
                            <div className="metric-label">Objects Downloaded</div>
                        </div>
                        <div className="metric-card">
                            <div className="metric-value">{realTimeMetrics.errorRate.toFixed(1)}%</div>
                            <div className="metric-label">Error Rate</div>
                        </div>
                    </div>

                    {realTimeChart && (
                        <div className="real-time-chart">
                            <ChartRenderer chart={realTimeChart} title="Real-time Latency"/>
                        </div>
                    )}
                </div>
            )}

            {/* Summary Statistics */}
            {analysis && (
                <div className="summary-section">
                    <h3>📊 Performance Summary</h3>
                    <div className="summary-grid">
                        <div className="summary-card">
                            <h4>Overall Performance</h4>
                            <div className="summary-content">
                                <p><strong>Total Simulations:</strong> {analysis.totalSimulations}</p>
                                <p><strong>Performance
                                    Gain:</strong> {analysis.comparison.performanceGain.replace('_', ' ')}</p>
                                <p><strong>Latency
                                    Improvement:</strong> {analysis.comparison.latencyImprovementPercent.toFixed(1)}%
                                </p>
                            </div>
                        </div>

                        <div className="summary-card">
                            <h4>Optimized Mode</h4>
                            <div className="summary-content">
                                <p><strong>Average Latency:</strong> {analysis.optimized.averageLatency.toFixed(1)}ms
                                </p>
                                <p><strong>Cache Hit Rate:</strong> {analysis.optimized.cacheHitRate.toFixed(1)}%</p>
                                <p><strong>Throughput:</strong> {analysis.optimized.throughput.toFixed(2)} obj/sec</p>
                            </div>
                        </div>

                        <div className="summary-card">
                            <h4>Unoptimized Mode</h4>
                            <div className="summary-content">
                                <p><strong>Average Latency:</strong> {analysis.unoptimized.averageLatency.toFixed(1)}ms
                                </p>
                                <p><strong>Cache Hit Rate:</strong> {analysis.unoptimized.cacheHitRate.toFixed(1)}%</p>
                                <p><strong>Throughput:</strong> {analysis.unoptimized.throughput.toFixed(2)} obj/sec</p>
                            </div>
                        </div>
                    </div>

                    <div className="executive-summary">
                        <h4>Executive Summary</h4>
                        <p>{analysis.summary}</p>
                    </div>
                </div>
            )}

            {/* Charts Section */}
            {chartData && (
                <div className="charts-section">
                    <h3>📈 Performance Charts</h3>
                    <div className="chart-selector">
                        <button
                            className={`chart-tab ${selectedChart === 'latency' ? 'active' : ''}`}
                            onClick={() => setSelectedChart('latency')}
                        >
                            Latency
                        </button>
                        <button
                            className={`chart-tab ${selectedChart === 'cache' ? 'active' : ''}`}
                            onClick={() => setSelectedChart('cache')}
                        >
                            Cache
                        </button>
                        <button
                            className={`chart-tab ${selectedChart === 'throughput' ? 'active' : ''}`}
                            onClick={() => setSelectedChart('throughput')}
                        >
                            Throughput
                        </button>
                        {chartData.distribution && (
                            <button
                                className={`chart-tab ${selectedChart === 'distribution' ? 'active' : ''}`}
                                onClick={() => setSelectedChart('distribution')}
                            >
                                Distribution
                            </button>
                        )}
                    </div>

                    <div className="chart-display">
                        {chartData[selectedChart] && (
                            <ChartRenderer
                                chart={chartData[selectedChart]}
                                title={`${selectedChart.charAt(0).toUpperCase() + selectedChart.slice(1)} Analysis`}
                            />
                        )}
                    </div>
                </div>
            )}

            {/* Raw Data Section */}
            <div className="raw-data-section">
                <div className="raw-data-header">
                    <h3>📋 Simulation Results ({allResults.length})</h3>
                    <button
                        className="btn-secondary btn-small"
                        onClick={() => setShowRawData(!showRawData)}
                    >
                        {showRawData ? 'Hide' : 'Show'} Raw Data
                    </button>
                </div>

                {showRawData && (
                    <div className="raw-data-table">
                        <table>
                            <thead>
                            <tr>
                                <th>Simulation ID</th>
                                <th>Type</th>
                                <th>Duration</th>
                                <th>Objects</th>
                                <th>Avg Latency</th>
                                <th>Cache Hit Rate</th>
                                <th>Success Rate</th>
                            </tr>
                            </thead>
                            <tbody>
                            {allResults.slice(-10).map((result) => (
                                <tr key={result.simulationId}>
                                    <td title={result.simulationId}>
                                        {result.simulationId.substring(0, 8)}...
                                    </td>
                                    <td>
                                            <span className={`simulation-type ${result.simulationType}`}>
                                                {result.simulationType}
                                            </span>
                                    </td>
                                    <td>{((result.duration || 0) / 1000).toFixed(1)}s</td>
                                    <td>{result.totalObjects}</td>
                                    <td>{result.averageLatency.toFixed(1)}ms</td>
                                    <td>{(result.cacheHitRate || 0).toFixed(1)}%</td>
                                    <td>{(result.successRate || 0).toFixed(1)}%</td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                        {allResults.length > 10 && (
                            <div className="table-note">
                                Showing latest 10 of {allResults.length} simulations
                            </div>
                        )}
                    </div>
                )}
            </div>

            {allResults.length === 0 && (
                <div className="no-data">
                    <h3>📊 No Benchmark Data Available</h3>
                    <p>Run some simulations to see performance analysis and charts here.</p>
                </div>
            )}
        </div>
    );
};