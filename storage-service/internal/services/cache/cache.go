package cache

type LayerStats struct {
	Name         string  `json:"name"`
	Objects      int     `json:"objects"`
	SizeBytes    int64   `json:"sizeBytes"`
	Hits         int64   `json:"hits"`
	Misses       int64   `json:"misses"`
	HitRate      float64 `json:"hitRate"`
	AvgLatencyMs float64 `json:"avgLatencyMs"`
}
