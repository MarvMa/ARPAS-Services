package metrics

import (
	"fmt"
	"time"
)

// PreloadMetrics tracks metrics for preload operations
type PreloadMetrics struct {
	StartTime      time.Time                       `json:"-"`
	TotalLatencyMs float64                         `json:"totalLatencyMs"`
	ObjectCount    int                             `json:"objectCount"`
	TotalSize      int64                           `json:"totalSize"`
	Success        bool                            `json:"success"`
	ErrorCount     int                             `json:"errorCount"`
	LayerMetrics   map[string]*PreloadLayerMetrics `json:"layerMetrics"`
}

// PreloadLayerMetrics tracks metrics for a specific cache layer during preload
type PreloadLayerMetrics struct {
	LayerName          string  `json:"layerName"`
	SuccessCount       int     `json:"successCount"`
	FailedCount        int     `json:"failedCount"`
	SkippedCount       int     `json:"skippedCount"`
	TotalSize          int64   `json:"totalSize"`
	LatencyMs          float64 `json:"latencyMs"`
	MaxObjectLatencyMs float64 `json:"maxObjectLatencyMs"`
}

// GetSummary returns a human-readable summary of preload metrics
func (pm *PreloadMetrics) GetSummary() string {
	successRate := float64(pm.ObjectCount-pm.ErrorCount) / float64(pm.ObjectCount) * 100

	summary := fmt.Sprintf(
		"Preload Summary: %d objects (%.2f%% success), Total Size: %.2f MB, Duration: %.2f ms",
		pm.ObjectCount, successRate, float64(pm.TotalSize)/(1024*1024), pm.TotalLatencyMs,
	)

	for layerName, layer := range pm.LayerMetrics {
		summary += fmt.Sprintf("\n  %s Layer: %d success, %d failed, %d skipped (%.2f ms)",
			layerName, layer.SuccessCount, layer.FailedCount, layer.SkippedCount, layer.LatencyMs)
	}

	return summary
}
