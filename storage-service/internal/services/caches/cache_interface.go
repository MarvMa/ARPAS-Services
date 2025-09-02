package caches

import (
	"io"
	"time"

	"github.com/google/uuid"
)

// CacheInterface defines the common interface for all cache implementations
type CacheInterface interface {
	Store(objectID uuid.UUID, data []byte) error
	GetStream(objectID uuid.UUID) (io.ReadCloser, int64, error)
	Exists(objectID uuid.UUID) (bool, error)
	Delete(objectID uuid.UUID) error
	Clear() error
	MaxSize() int64
	CurrentSize() int64
	Close() error
}

// CacheType represents the type of cache implementation
type CacheType string

const (
	CacheTypeSharded   CacheType = "sharded"
	CacheTypeLRU       CacheType = "lru"
	CacheTypeRistretto CacheType = "ristretto"
)

// NewCache creates a cache implementation based on the specified type
func NewCache(cacheType CacheType, maxSizeBytes int64, ttl time.Duration) CacheInterface {
	switch cacheType {
	case CacheTypeSharded:
		return NewShardedMemoryCache(maxSizeBytes, ttl)
	case CacheTypeLRU:
		return NewLRUMemoryCache(maxSizeBytes, ttl)
	case CacheTypeRistretto:
		return NewRistrettoCache(maxSizeBytes, ttl)
	default:
		return NewShardedMemoryCache(maxSizeBytes, ttl)
	}
}
