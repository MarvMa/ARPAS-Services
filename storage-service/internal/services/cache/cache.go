package cache

import (
	"io"

	"github.com/google/uuid"
)

type CacheLayer interface {
	Name() string
	Store(objectID uuid.UUID, data []byte) error
	Get(objectID uuid.UUID) ([]byte, error)
	GetStream(objectID uuid.UUID) (io.ReadCloser, int64, error)
	Exists(objectID uuid.UUID) (bool, error)
	Delete(objectID uuid.UUID) error
	Clear() error
	GetStats() LayerStats
}

type LayerStats struct {
	Name         string  `json:"name"`
	Objects      int     `json:"objects"`
	SizeBytes    int64   `json:"sizeBytes"`
	Hits         int64   `json:"hits"`
	Misses       int64   `json:"misses"`
	HitRate      float64 `json:"hitRate"`
	AvgLatencyMs float64 `json:"avgLatencyMs"`
}
