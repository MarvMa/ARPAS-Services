import React, { useState, useEffect } from 'react';
import { ScientificMetrics } from '../types/simulation';
import { DataCollector } from '../services/dataCollector';

interface SimulationResultsListProps {
    dataCollector: DataCollector;
}

export const SimulationResultsList: React.FC<SimulationResultsListProps> = ({ dataCollector }) => {
    const [results, setResults] = useState<ScientificMetrics[]>([]);
    const [selectedResult, setSelectedResult] = useState<ScientificMetrics | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Load results on mount and refresh periodically
    useEffect(() => {
        const loadResults = () => {
            const allResults = dataCollector.getScientificResults();
            setResults(allResults);
        };

        loadResults();
        const interval = setInterval(loadResults, 2000);

        return () => clearInterval(interval);
    }, [dataCollector]);

    // Download individual result as JSON
    const handleDownloadResult = (result: ScientificMetrics) => {
        const filename = `simulation_${result.simulationType}_${result.simulationId}_${result.timestamp.replace(/[:.]/g, '-')}.json`;
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // Export all results
    const handleExportAll = async () => {
        setIsLoading(true);
        try {
            await dataCollector.exportScientificResults();
            alert('All results exported successfully!');
        } catch (error) {
            console.error('Export failed:', error);
            alert('Failed to export results');
        } finally {
            setIsLoading(false);
        }
    };

    // Clear all results
    const handleClearAll = () => {
        if (window.confirm('Clear all simulation results? This cannot be undone.')) {
            dataCollector.clearResults();
            setResults([]);
            setSelectedResult(null);
        }
    };

    // Format duration
    const formatDuration = (ms: number): string => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        }
        return `${seconds}s`;
    };

    // Format bytes
    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    if (results.length === 0) {
        return (
            <div className="simulation-results-list">
                <div className="results-header">
                    <h3>📊 Simulation Results</h3>
                    <div className="results-actions">
                        <button onClick={handleExportAll} className="btn-secondary btn-small" disabled>
                            Export All
                        </button>
                        <button onClick={handleClearAll} className="btn-secondary btn-small" disabled>
                            Clear All
                        </button>
                    </div>
                </div>
                <div className="no-results">
                    <p>No simulation results yet. Run a simulation to see results here.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="simulation-results-list">
            <div className="results-header">
                <h3>Simulation Results ({results.length})</h3>
                <div className="results-actions">
                    <button
                        onClick={handleExportAll}
                        className="btn-primary btn-small"
                        disabled={isLoading}
                    >
                        {isLoading ? 'Exporting...' : 'Export All'}
                    </button>
                    <button onClick={handleClearAll} className="btn-warning btn-small">
                        Clear All
                    </button>
                </div>
            </div>

            <div className="results-table">
                <table>
                    <thead>
                    <tr>
                        <th>Simulation ID</th>
                        <th>Type</th>
                        <th>Duration</th>
                        <th>Objects</th>
                        <th>Profiles</th>
                        <th>Avg Latency</th>
                        <th>Cache Hit</th>
                        <th>Success</th>
                        <th>Docker Metrics</th>
                        <th>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {results.slice().reverse().map((result) => (
                        <tr key={result.simulationId} onClick={() => setSelectedResult(result)}>
                            <td className="sim-id" title={result.simulationId}>
                                {result.simulationId.substring(0, 12)}...
                            </td>
                            <td>
                                    <span className={`sim-type ${result.simulationType}`}>
                                        {result.simulationType}
                                    </span>
                            </td>
                            <td>{formatDuration(result.duration.totalMs)}</td>
                            <td>{Object.keys(result.objectMetrics).length}</td>
                            <td>{result.configuration.profileCount}</td>
                            <td>{result.aggregatedStats.latency.mean.toFixed(1)}ms</td>
                            <td>{result.aggregatedStats.cache.hitRate.toFixed(1)}%</td>
                            <td>{result.aggregatedStats.success.rate.toFixed(1)}%</td>
                            <td>
                                {Object.keys(result.dockerTimeSeries).length} containers
                            </td>
                            <td onClick={(e) => e.stopPropagation()}>
                                <button
                                    onClick={() => handleDownloadResult(result)}
                                    className="btn-primary btn-tiny"
                                    title="Download JSON"
                                >
                                    💾
                                </button>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>

            {selectedResult && (
                <div className="result-details">
                    <h4>Simulation Details</h4>
                    <div className="details-grid">
                        <div className="detail-section">
                            <h5>Configuration</h5>
                            <p><strong>Type:</strong> {selectedResult.simulationType}</p>
                            <p><strong>Profiles:</strong> {selectedResult.configuration.profileCount}</p>
                            <p><strong>Objects:</strong> {selectedResult.configuration.objectCount}</p>
                            <p><strong>Interval:</strong> {selectedResult.configuration.intervalMs}ms</p>
                            <p><strong>Data Points:</strong> {selectedResult.configuration.totalDataPoints}</p>
                        </div>

                        <div className="detail-section">
                            <h5>Latency Statistics</h5>
                            <p><strong>Mean:</strong> {selectedResult.aggregatedStats.latency.mean.toFixed(2)}ms</p>
                            <p><strong>Median:</strong> {selectedResult.aggregatedStats.latency.median.toFixed(2)}ms</p>
                            <p><strong>P95:</strong> {selectedResult.aggregatedStats.latency.p95.toFixed(2)}ms</p>
                            <p><strong>P99:</strong> {selectedResult.aggregatedStats.latency.p99.toFixed(2)}ms</p>
                            <p><strong>Min/Max:</strong> {selectedResult.aggregatedStats.latency.min.toFixed(0)}/{selectedResult.aggregatedStats.latency.max.toFixed(0)}ms</p>
                        </div>

                        <div className="detail-section">
                            <h5>Performance</h5>
                            <p><strong>Throughput:</strong> {selectedResult.aggregatedStats.throughput.objectsPerSecond.toFixed(2)} obj/s</p>
                            <p><strong>Data Rate:</strong> {formatBytes(selectedResult.aggregatedStats.throughput.bytesPerSecond)}/s</p>
                            <p><strong>Cache Hit Rate:</strong> {selectedResult.aggregatedStats.cache.hitRate.toFixed(1)}%</p>
                            <p><strong>Success Rate:</strong> {selectedResult.aggregatedStats.success.rate.toFixed(1)}%</p>
                        </div>

                        <div className="detail-section">
                            <h5>Docker Containers</h5>
                            {Object.entries(selectedResult.dockerTimeSeries).map(([container, timeSeries]) => {
                                const avgCpu = timeSeries.reduce((sum, t) => sum + t.cpu.percent, 0) / timeSeries.length;
                                const avgMem = timeSeries.reduce((sum, t) => sum + t.memory.percent, 0) / timeSeries.length;
                                return (
                                    <p key={container}>
                                        <strong>{container}:</strong> CPU {avgCpu.toFixed(1)}%, Mem {avgMem.toFixed(1)}%
                                    </p>
                                );
                            })}
                        </div>

                        <div className="detail-section">
                            <h5>Per-Object Metrics</h5>
                            <p><strong>Total Objects:</strong> {Object.keys(selectedResult.objectMetrics).length}</p>
                            {Object.entries(selectedResult.objectMetrics).slice(0, 5).map(([objectId, metrics]) => (
                                <p key={objectId} className="object-metric">
                                    <span title={objectId}>{objectId.substring(0, 8)}...</span>:
                                    {metrics.statistics.totalDownloads} downloads,
                                    {metrics.statistics.averageLatency.toFixed(1)}ms avg,
                                    {metrics.statistics.cacheHitRate.toFixed(0)}% cache
                                </p>
                            ))}
                            {Object.keys(selectedResult.objectMetrics).length > 5 && (
                                <p className="more-objects">...and {Object.keys(selectedResult.objectMetrics).length - 5} more objects</p>
                            )}
                        </div>
                    </div>

                    <div className="detail-actions">
                        <button
                            onClick={() => handleDownloadResult(selectedResult)}
                            className="btn-primary"
                        >
                            Download Full JSON
                        </button>
                        <button
                            onClick={() => setSelectedResult(null)}
                            className="btn-secondary"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// Add styles
const styles = `
.simulation-results-list {
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    padding: 1.5rem;
    margin-top: 1rem;
}

.results-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    border-bottom: 2px solid #eee;
    padding-bottom: 1rem;
}

.results-header h3 {
    margin: 0;
    color: #333;
}

.results-actions {
    display: flex;
    gap: 0.5rem;
}

.no-results {
    text-align: center;
    padding: 2rem;
    color: #666;
    background: #f9f9f9;
    border-radius: 6px;
    border: 1px dashed #ddd;
}

.results-table {
    overflow-x: auto;
}

.results-table table {
    width: 100%;
    border-collapse: collapse;
}

.results-table th {
    background: #f5f5f5;
    padding: 0.75rem;
    text-align: left;
    font-weight: 600;
    border-bottom: 2px solid #ddd;
}

.results-table td {
    padding: 0.75rem;
    border-bottom: 1px solid #eee;
}

.results-table tbody tr {
    cursor: pointer;
    transition: background 0.2s;
}

.results-table tbody tr:hover {
    background: #f9f9f9;
}

.sim-id {
    font-family: monospace;
    font-size: 0.9rem;
}

.sim-type {
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 600;
}

.sim-type.optimized {
    background: #e8f5e8;
    color: #2e7d32;
}

.sim-type.unoptimized {
    background: #ffebee;
    color: #c62828;
}

.result-details {
    margin-top: 2rem;
    padding: 1.5rem;
    background: #f9f9f9;
    border-radius: 8px;
    border: 1px solid #ddd;
}

.result-details h4 {
    margin: 0 0 1rem 0;
    color: #333;
}

.details-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1.5rem;
    margin-bottom: 1.5rem;
}

.detail-section {
    background: white;
    padding: 1rem;
    border-radius: 6px;
    border: 1px solid #e0e0e0;
}

.detail-section h5 {
    margin: 0 0 0.75rem 0;
    color: #555;
    border-bottom: 1px solid #eee;
    padding-bottom: 0.5rem;
}

.detail-section p {
    margin: 0.5rem 0;
    font-size: 0.9rem;
}

.detail-section strong {
    color: #333;
    font-weight: 600;
}

.object-metric {
    font-size: 0.85rem;
    font-family: monospace;
    background: #f5f5f5;
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    margin: 0.25rem 0;
}

.more-objects {
    font-style: italic;
    color: #666;
    font-size: 0.85rem;
}

.detail-actions {
    display: flex;
    gap: 1rem;
    justify-content: flex-end;
    padding-top: 1rem;
    border-top: 1px solid #ddd;
}
`;

// Inject styles
if (typeof document !== 'undefined' && !document.getElementById('simulation-results-styles')) {
    const styleElement = document.createElement('style');
    styleElement.id = 'simulation-results-styles';
    styleElement.innerHTML = styles;
    document.head.appendChild(styleElement);
}