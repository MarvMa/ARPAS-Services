package utils

import (
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// EnhancedMetrics provides comprehensive metrics for multi-layer caching
type EnhancedMetrics struct {
	// Layer-specific metrics
	layerHits        *prometheus.CounterVec
	layerMisses      *prometheus.CounterVec
	layerSize        *prometheus.GaugeVec
	layerObjectCount *prometheus.GaugeVec
	layerLatency     *prometheus.HistogramVec

	// Strategy metrics
	strategySelection  *prometheus.CounterVec
	strategyEfficiency *prometheus.GaugeVec
	promotionEvents    *prometheus.CounterVec

	// Performance metrics
	downloadLatency    prometheus.Histogram
	e2eLatency         prometheus.Histogram
	throughput         *prometheus.GaugeVec
	concurrentRequests prometheus.Gauge

	// Cache lifecycle metrics
	evictionEvents  *prometheus.CounterVec
	preloadSuccess  *prometheus.CounterVec
	preloadFailure  *prometheus.CounterVec
	preloadDuration prometheus.Histogram

	// System resource metrics
	memoryUsage      prometheus.Gauge
	diskUsage        prometheus.Gauge
	redisConnections prometheus.Gauge

	// Business metrics
	costSavings    *prometheus.CounterVec
	bandwidthSaved *prometheus.CounterVec

	mu sync.RWMutex
}

// NewEnhancedMetrics creates and registers all enhanced cache metrics
func NewEnhancedMetrics() *EnhancedMetrics {
	return &EnhancedMetrics{
		// Layer-specific metrics
		layerHits: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cache_layer_hits_total",
				Help: "Total number of cache hits per layer",
			},
			[]string{"layer", "object_size_class"},
		),
		layerMisses: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cache_layer_misses_total",
				Help: "Total number of cache misses per layer",
			},
			[]string{"layer", "object_size_class"},
		),
		layerSize: promauto.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "cache_layer_size_bytes",
				Help: "Current size of each cache layer in bytes",
			},
			[]string{"layer"},
		),
		layerObjectCount: promauto.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "cache_layer_objects_count",
				Help: "Number of objects in each cache layer",
			},
			[]string{"layer"},
		),
		layerLatency: promauto.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "cache_layer_latency_ms",
				Help:    "Latency of cache operations per layer in milliseconds",
				Buckets: []float64{0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250},
			},
			[]string{"layer", "operation"},
		),

		// Strategy metrics
		strategySelection: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cache_strategy_selection_total",
				Help: "Total number of cache strategy selections",
			},
			[]string{"strategy", "file_size_class"},
		),
		strategyEfficiency: promauto.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "cache_strategy_efficiency_percent",
				Help: "Efficiency percentage of each cache strategy",
			},
			[]string{"strategy"},
		),
		promotionEvents: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cache_promotion_events_total",
				Help: "Total number of cache layer promotion events",
			},
			[]string{"from_layer", "to_layer"},
		),

		// Performance metrics
		downloadLatency: promauto.NewHistogram(
			prometheus.HistogramOpts{
				Name:    "download_e2e_latency_ms",
				Help:    "End-to-end download latency in milliseconds",
				Buckets: []float64{1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000},
			},
		),
		e2eLatency: promauto.NewHistogram(
			prometheus.HistogramOpts{
				Name:    "request_e2e_latency_ms",
				Help:    "Complete request end-to-end latency in milliseconds",
				Buckets: []float64{1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000},
			},
		),
		throughput: promauto.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "cache_throughput_mbps",
				Help: "Current throughput in MB/s",
			},
			[]string{"layer", "direction"},
		),
		concurrentRequests: promauto.NewGauge(
			prometheus.GaugeOpts{
				Name: "cache_concurrent_requests",
				Help: "Current number of concurrent cache requests",
			},
		),

		// Cache lifecycle metrics
		evictionEvents: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cache_eviction_events_total",
				Help: "Total number of cache eviction events",
			},
			[]string{"layer", "reason"},
		),
		preloadSuccess: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cache_preload_success_total",
				Help: "Total number of successful preload operations",
			},
			[]string{"layer", "file_size_class"},
		),
		preloadFailure: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cache_preload_failure_total",
				Help: "Total number of failed preload operations",
			},
			[]string{"layer", "reason"},
		),
		preloadDuration: promauto.NewHistogram(
			prometheus.HistogramOpts{
				Name:    "cache_preload_duration_ms",
				Help:    "Duration of preload operations in milliseconds",
				Buckets: []float64{10, 50, 100, 500, 1000, 5000, 10000, 30000},
			},
		),

		// System resource metrics
		memoryUsage: promauto.NewGauge(
			prometheus.GaugeOpts{
				Name: "cache_memory_usage_bytes",
				Help: "Current memory usage by cache in bytes",
			},
		),
		diskUsage: promauto.NewGauge(
			prometheus.GaugeOpts{
				Name: "cache_disk_usage_bytes",
				Help: "Current disk usage by cache in bytes",
			},
		),
		redisConnections: promauto.NewGauge(
			prometheus.GaugeOpts{
				Name: "cache_redis_connections",
				Help: "Current number of Redis connections",
			},
		),

		// Business metrics
		costSavings: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cache_cost_savings_total",
				Help: "Total cost savings from cache usage",
			},
			[]string{"metric_type"}, // bandwidth, latency, requests
		),
		bandwidthSaved: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cache_bandwidth_saved_bytes",
				Help: "Total bandwidth saved by cache in bytes",
			},
			[]string{"layer"},
		),
	}
}

func (em *EnhancedMetrics) RecordLayerHit(layer, sizeClass string) {
	em.layerHits.WithLabelValues(layer, sizeClass).Inc()
}

func (em *EnhancedMetrics) RecordLayerMiss(layer, sizeClass string) {
	em.layerMisses.WithLabelValues(layer, sizeClass).Inc()
}

func (em *EnhancedMetrics) UpdateLayerSize(layer string, sizeBytes int64) {
	em.layerSize.WithLabelValues(layer).Set(float64(sizeBytes))
}

func (em *EnhancedMetrics) UpdateLayerObjectCount(layer string, count int) {
	em.layerObjectCount.WithLabelValues(layer).Set(float64(count))
}

func (em *EnhancedMetrics) RecordLayerLatency(layer, operation string, latencyMs int64) {
	em.layerLatency.WithLabelValues(layer, operation).Observe(float64(latencyMs))
}

func (em *EnhancedMetrics) RecordStrategySelection(strategy, sizeClass string) {
	em.strategySelection.WithLabelValues(strategy, sizeClass).Inc()
}

func (em *EnhancedMetrics) UpdateStrategyEfficiency(strategy string, efficiency float64) {
	em.strategyEfficiency.WithLabelValues(strategy).Set(efficiency)
}

func (em *EnhancedMetrics) RecordPromotion(fromLayer, toLayer string) {
	em.promotionEvents.WithLabelValues(fromLayer, toLayer).Inc()
}

func (em *EnhancedMetrics) RecordDownloadLatency(latencyMs int64) {
	em.downloadLatency.Observe(float64(latencyMs))
}

func (em *EnhancedMetrics) RecordE2ELatency(latencyMs int64) {
	em.e2eLatency.Observe(float64(latencyMs))
}

func (em *EnhancedMetrics) UpdateThroughput(layer, direction string, mbps float64) {
	em.throughput.WithLabelValues(layer, direction).Set(mbps)
}

func (em *EnhancedMetrics) SetConcurrentRequests(count int) {
	em.concurrentRequests.Set(float64(count))
}

func (em *EnhancedMetrics) RecordEviction(layer, reason string) {
	em.evictionEvents.WithLabelValues(layer, reason).Inc()
}

func (em *EnhancedMetrics) RecordPreloadSuccess(layer, sizeClass string) {
	em.preloadSuccess.WithLabelValues(layer, sizeClass).Inc()
}

func (em *EnhancedMetrics) RecordPreloadFailure(layer, reason string) {
	em.preloadFailure.WithLabelValues(layer, reason).Inc()
}

func (em *EnhancedMetrics) RecordPreloadDuration(durationMs int64) {
	em.preloadDuration.Observe(float64(durationMs))
}

func (em *EnhancedMetrics) UpdateMemoryUsage(bytes int64) {
	em.memoryUsage.Set(float64(bytes))
}

func (em *EnhancedMetrics) UpdateDiskUsage(bytes int64) {
	em.diskUsage.Set(float64(bytes))
}

func (em *EnhancedMetrics) UpdateRedisConnections(count int) {
	em.redisConnections.Set(float64(count))
}

func (em *EnhancedMetrics) RecordCostSaving(metricType string, amount float64) {
	em.costSavings.WithLabelValues(metricType).Add(amount)
}

func (em *EnhancedMetrics) RecordBandwidthSaved(layer string, bytes int64) {
	em.bandwidthSaved.WithLabelValues(layer).Add(float64(bytes))
}

func (em *EnhancedMetrics) GetFileSizeClass(sizeBytes int64) string {
	switch {
	case sizeBytes <= 1<<20: // 1MB
		return "small"
	case sizeBytes <= 8<<20: // 8MB
		return "medium-small"
	case sizeBytes <= 32<<20: // 32MB
		return "medium"
	case sizeBytes <= 100<<20: // 100MB
		return "large"
	default:
		return "xlarge"
	}
}

type PerformanceTracker struct {
	startTime time.Time
	metrics   *EnhancedMetrics
	operation string
	layer     string
}

func (em *EnhancedMetrics) StartTracking(operation, layer string) *PerformanceTracker {
	em.concurrentRequests.Inc()
	return &PerformanceTracker{
		startTime: time.Now(),
		metrics:   em,
		operation: operation,
		layer:     layer,
	}
}

func (pt *PerformanceTracker) Finish() {
	duration := time.Since(pt.startTime)
	pt.metrics.RecordLayerLatency(pt.layer, pt.operation, duration.Milliseconds())
	pt.metrics.concurrentRequests.Dec()
}

func (pt *PerformanceTracker) FinishWithSize(sizeBytes int64) {
	duration := time.Since(pt.startTime)
	pt.metrics.RecordLayerLatency(pt.layer, pt.operation, duration.Milliseconds())
	pt.metrics.concurrentRequests.Dec()

	// Calculate throughput in MB/s
	if duration.Seconds() > 0 {
		mbps := float64(sizeBytes) / (1024 * 1024) / duration.Seconds()
		pt.metrics.UpdateThroughput(pt.layer, "read", mbps)
	}
}

type AggregatedMetrics struct {
	TotalHits          int64              `json:"totalHits"`
	TotalMisses        int64              `json:"totalMisses"`
	OverallHitRate     float64            `json:"overallHitRate"`
	LayerHitRates      map[string]float64 `json:"layerHitRates"`
	AverageLatency     float64            `json:"averageLatencyMs"`
	TotalSizeBytes     int64              `json:"totalSizeBytes"`
	TotalObjects       int                `json:"totalObjects"`
	StrategyEfficiency map[string]float64 `json:"strategyEfficiency"`
}

func (em *EnhancedMetrics) GetAggregatedMetrics() *AggregatedMetrics {
	return &AggregatedMetrics{
		LayerHitRates:      make(map[string]float64),
		StrategyEfficiency: make(map[string]float64),
	}
}
