package metrics

import (
	"fmt"
	"sync"
	"time"
)

// LatencyMetrics holds detailed latency measurements for the download pipeline
type LatencyMetrics struct {
	mu sync.RWMutex

	// Overall metrics
	TotalStartTime time.Time `json:"-"`
	TotalLatencyMs float64   `json:"totalLatencyMs"`

	// Database lookup
	DBLookupStartTime time.Time `json:"-"`
	DBLookupLatencyMs float64   `json:"dbLookupLatencyMs"`

	// Cache layer metrics
	CacheLayers []LayerMetrics `json:"cacheLayers"`

	// MinIO metrics
	MinIOStartTime time.Time `json:"-"`
	MinIOLatencyMs float64   `json:"minioLatencyMs,omitempty"`

	// Stream metrics
	FirstByteLatencyMs float64   `json:"firstByteLatencyMs"`
	StreamStartTime    time.Time `json:"-"`
	StreamLatencyMs    float64   `json:"streamLatencyMs,omitempty"`

	// Cache promotion metrics
	PromotionLatencyMs float64 `json:"promotionLatencyMs,omitempty"`

	// Additional metadata
	ObjectID         string `json:"objectId"`
	ObjectSize       int64  `json:"objectSize"`
	CacheHit         bool   `json:"cacheHit"`
	CacheLayerUsed   string `json:"cacheLayerUsed"`
	OptimizationMode string `json:"optimizationMode"`

	// Detailed timing breakdown
	Timings map[string]float64 `json:"timings"`
}

// LayerMetrics represents metrics for a single cache layer attempt
type LayerMetrics struct {
	LayerName  string    `json:"layerName"`
	StartTime  time.Time `json:"-"`
	LatencyMs  float64   `json:"latencyMs"`
	Hit        bool      `json:"hit"`
	Error      string    `json:"error,omitempty"`
	ObjectSize int64     `json:"objectSize,omitempty"`
}

// NewLatencyMetrics creates a new metrics collector
func NewLatencyMetrics(objectID string) *LatencyMetrics {
	return &LatencyMetrics{
		TotalStartTime: time.Now(),
		ObjectID:       objectID,
		CacheLayers:    make([]LayerMetrics, 0),
		Timings:        make(map[string]float64),
	}
}

// StartDBLookup marks the start of database lookup
func (m *LatencyMetrics) StartDBLookup() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.DBLookupStartTime = time.Now()
}

// EndDBLookup marks the end of database lookup
func (m *LatencyMetrics) EndDBLookup() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.DBLookupStartTime.IsZero() {
		m.DBLookupLatencyMs = float64(time.Since(m.DBLookupStartTime).Microseconds()) / 1000.0
		m.Timings["db_lookup"] = m.DBLookupLatencyMs
	}
}

// StartCacheLayerAttempt starts timing for a cache layer attempt
func (m *LatencyMetrics) StartCacheLayerAttempt(layerName string) *LayerMetrics {
	layer := LayerMetrics{
		LayerName: layerName,
		StartTime: time.Now(),
	}
	return &layer
}

// EndCacheLayerAttempt ends timing for a cache layer attempt
func (m *LatencyMetrics) EndCacheLayerAttempt(layer *LayerMetrics, hit bool, err error, size int64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !layer.StartTime.IsZero() {
		layer.LatencyMs = float64(time.Since(layer.StartTime).Microseconds()) / 1000.0
		layer.Hit = hit
		layer.ObjectSize = size

		if err != nil {
			layer.Error = err.Error()
		}

		m.CacheLayers = append(m.CacheLayers, *layer)
		m.Timings["cache_"+layer.LayerName] = layer.LatencyMs

		if hit {
			m.CacheHit = true
			m.CacheLayerUsed = layer.LayerName
		}
	}
}

// StartMinIO marks the start of MinIO operation
func (m *LatencyMetrics) StartMinIO() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.MinIOStartTime = time.Now()
}

// EndMinIO marks the end of MinIO operation
func (m *LatencyMetrics) EndMinIO() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.MinIOStartTime.IsZero() {
		m.MinIOLatencyMs = float64(time.Since(m.MinIOStartTime).Microseconds()) / 1000.0
		m.Timings["minio"] = m.MinIOLatencyMs
	}
}

// StartStream marks the start of streaming
func (m *LatencyMetrics) StartStream() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.StreamStartTime = time.Now()
}

// EndStream marks the end of streaming
func (m *LatencyMetrics) EndStream() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.StreamStartTime.IsZero() {
		m.StreamLatencyMs = float64(time.Since(m.StreamStartTime).Microseconds()) / 1000.0
		m.Timings["stream"] = m.StreamLatencyMs
	}
}

// RecordFirstByte records the time to first byte
func (m *LatencyMetrics) RecordFirstByte() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.TotalStartTime.IsZero() {
		m.FirstByteLatencyMs = float64(time.Since(m.TotalStartTime).Microseconds()) / 1000.0
		m.Timings["first_byte"] = m.FirstByteLatencyMs
	}
}

// RecordPromotion records cache promotion latency
func (m *LatencyMetrics) RecordPromotion(duration time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.PromotionLatencyMs = float64(duration.Microseconds()) / 1000.0
	m.Timings["promotion"] = m.PromotionLatencyMs
}

// Finalize calculates final metrics
func (m *LatencyMetrics) Finalize() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.TotalStartTime.IsZero() {
		m.TotalLatencyMs = float64(time.Since(m.TotalStartTime).Microseconds()) / 1000.0
		m.Timings["total"] = m.TotalLatencyMs
	}

	var cacheWaterfall float64
	for _, layer := range m.CacheLayers {
		cacheWaterfall += layer.LatencyMs
	}
	if cacheWaterfall > 0 {
		m.Timings["cache_waterfall"] = cacheWaterfall
	}
}

// SetObjectSize sets the object size
func (m *LatencyMetrics) SetObjectSize(size int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ObjectSize = size
}

// SetOptimizationMode sets the optimization mode
func (m *LatencyMetrics) SetOptimizationMode(mode string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.OptimizationMode = mode
}

// GetHeaders returns HTTP headers with latency metrics
func (m *LatencyMetrics) GetHeaders() map[string]string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	headers := make(map[string]string)

	// Basic metrics
	headers["X-Latency-Total-Ms"] = formatFloat(m.TotalLatencyMs)
	headers["X-Latency-DB-Lookup-Ms"] = formatFloat(m.DBLookupLatencyMs)
	headers["X-Latency-First-Byte-Ms"] = formatFloat(m.FirstByteLatencyMs)

	// Cache metrics
	headers["X-Cache-Hit"] = formatBool(m.CacheHit)
	if m.CacheHit {
		headers["X-Cache-Layer-Used"] = m.CacheLayerUsed
	}

	// Layer-specific latencies
	for _, layer := range m.CacheLayers {
		headerKey := "X-Latency-Cache-" + layer.LayerName + "-Ms"
		headers[headerKey] = formatFloat(layer.LatencyMs)

		if layer.Hit {
			headers["X-Cache-"+layer.LayerName+"-Hit"] = "true"
		}
	}

	// MinIO latency if used
	if m.MinIOLatencyMs > 0 {
		headers["X-Latency-MinIO-Ms"] = formatFloat(m.MinIOLatencyMs)
	}

	// Stream latency if available
	if m.StreamLatencyMs > 0 {
		headers["X-Latency-Stream-Ms"] = formatFloat(m.StreamLatencyMs)
	}

	// Promotion latency if occurred
	if m.PromotionLatencyMs > 0 {
		headers["X-Latency-Promotion-Ms"] = formatFloat(m.PromotionLatencyMs)
	}

	// Object metadata
	headers["X-Object-Size-Bytes"] = formatInt64(m.ObjectSize)
	headers["X-Optimization-Mode"] = m.OptimizationMode

	// Cache waterfall timing
	if waterfall, ok := m.Timings["cache_waterfall"]; ok && waterfall > 0 {
		headers["X-Latency-Cache-Waterfall-Ms"] = formatFloat(waterfall)
	}

	return headers
}

// Helper functions
func formatFloat(f float64) string {
	return fmt.Sprintf("%.2f", f)
}

func formatBool(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func formatInt64(i int64) string {
	return fmt.Sprintf("%d", i)
}
