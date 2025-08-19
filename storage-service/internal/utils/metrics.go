package utils

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Metrics holds all Prometheus metrics for the cache
type Metrics struct {
	cacheHits        *prometheus.CounterVec
	cacheMisses      *prometheus.CounterVec
	cacheSize        prometheus.Gauge
	cacheObjectCount prometheus.Gauge
	downloadLatency  prometheus.Histogram
	cacheLatency     prometheus.Histogram
}

// NewMetrics creates and registers all cache metrics
func NewMetrics() *Metrics {
	return &Metrics{
		cacheHits: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cache_hits_total",
				Help: "Total number of cache hits",
			},
			[]string{"object_id"},
		),
		cacheMisses: promauto.NewCounterVec(
			prometheus.CounterOpts{
				Name: "cache_misses_total",
				Help: "Total number of cache misses",
			},
			[]string{"object_id"},
		),
		cacheSize: promauto.NewGauge(
			prometheus.GaugeOpts{
				Name: "cache_size_bytes",
				Help: "Current cache size in bytes",
			},
		),
		cacheObjectCount: promauto.NewGauge(
			prometheus.GaugeOpts{
				Name: "cache_object_count",
				Help: "Number of objects in cache",
			},
		),
		downloadLatency: promauto.NewHistogram(
			prometheus.HistogramOpts{
				Name:    "cache_download_latency_ms",
				Help:    "Latency of downloads from storage service in milliseconds",
				Buckets: []float64{10, 25, 50, 100, 250, 500, 1000, 2500, 5000},
			},
		),
		cacheLatency: promauto.NewHistogram(
			prometheus.HistogramOpts{
				Name:    "cache_retrieval_latency_ms",
				Help:    "Latency of cache retrievals in milliseconds",
				Buckets: []float64{0.1, 0.5, 1, 2, 5, 10, 25, 50, 100},
			},
		),
	}
}

// IncrementCacheHits increments the cache hits counter
func (m *Metrics) IncrementCacheHits(objectID string) {
	m.cacheHits.WithLabelValues(objectID).Inc()
}

// IncrementCacheMisses increments the cache misses counter
func (m *Metrics) IncrementCacheMisses(objectID string) {
	m.cacheMisses.WithLabelValues(objectID).Inc()
}

// SetCacheSize sets the current cache size
func (m *Metrics) SetCacheSize(bytes int64) {
	m.cacheSize.Set(float64(bytes))
}

// UpdateCacheSize adds to the current cache size
func (m *Metrics) UpdateCacheSize(delta int64) {
	m.cacheSize.Add(float64(delta))
}

// SetCacheObjectCount sets the number of cached objects
func (m *Metrics) SetCacheObjectCount(count int64) {
	m.cacheObjectCount.Set(float64(count))
}

// RecordDownloadLatency records the latency of a download operation
func (m *Metrics) RecordDownloadLatency(milliseconds int64) {
	m.downloadLatency.Observe(float64(milliseconds))
}

// RecordCacheLatency records the latency of a cache retrieval
func (m *Metrics) RecordCacheLatency(milliseconds int64) {
	m.cacheLatency.Observe(float64(milliseconds))
}
