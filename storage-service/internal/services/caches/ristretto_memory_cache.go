package caches

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"sync/atomic"
	"time"

	"github.com/dgraph-io/ristretto/v2"
	"github.com/google/uuid"
)

type MemoryCache struct {
	cache *ristretto.Cache[string, []byte]

	// Cache configuration
	maxSize int64
	ttl     time.Duration

	// Statistics
	hits   atomic.Int64
	misses atomic.Int64
}

func NewRistrettoMemoryCache(maxSizeBytes int64, ttl time.Duration) *MemoryCache {
	estimatedMaxItems := maxSizeBytes / (5 * 1024 * 1024)
	if estimatedMaxItems < 100 {
		estimatedMaxItems = 100
	}

	numCounters := estimatedMaxItems * 10

	config := &ristretto.Config[string, []byte]{
		NumCounters: numCounters,
		MaxCost:     maxSizeBytes,
		BufferItems: 64,
		Metrics:     true,
		Cost: func(value []byte) int64 {
			return int64(len(value))
		},
		TtlTickerDurationInSec: 60,
	}

	cache, err := ristretto.NewCache(config)
	if err != nil {
		panic(fmt.Sprintf("Failed to create Ristretto cache: %v", err))
	}

	mc := &MemoryCache{
		cache:   cache,
		maxSize: maxSizeBytes,
		ttl:     ttl,
	}

	log.Printf("Memory cache initialized with max size: %d bytes, TTL: %v", maxSizeBytes, ttl)

	return mc
}

// Store adds an object to the cache
func (mc *MemoryCache) Store(objectID uuid.UUID, readerFunc func() (io.ReadCloser, int64, error)) error {
	key := objectID.String()

	reader, size, err := readerFunc()
	if err != nil {
		return err
	}
	defer reader.Close()

	if size > 50*1024*1024 {
		return fmt.Errorf("object too large for cache: %d bytes", size)
	}

	// Read data into memory
	data := make([]byte, size)
	n, err := io.ReadFull(reader, data)
	if err != nil {
		return fmt.Errorf("failed to read: %v", err)
	}
	if int64(n) != size {
		return fmt.Errorf("incomplete read: %d/%d bytes", n, size)
	}

	// Store in Ristretto with TTL if configured
	var success bool
	if mc.ttl > 0 {
		success = mc.cache.SetWithTTL(key, data, size, mc.ttl)
	} else {
		success = mc.cache.Set(key, data, size)
	}

	if !success {
		// Ristretto may drop sets under contention or if admission policy rejects
		// This is expected behavior for performance optimization
		log.Printf("Cache set was dropped for object %s (this is normal under load)", objectID)
	} else {
		// Wait a bit for the set to be processed (Ristretto is eventually consistent)
		time.Sleep(10 * time.Millisecond)
	}

	return nil
}

// GetCache retrieves data from cache
func (mc *MemoryCache) GetCache(objectID uuid.UUID) ([]byte, bool) {
	key := objectID.String()

	data, found := mc.cache.Get(key)
	if !found {
		mc.misses.Add(1)
		return nil, false
	}

	mc.hits.Add(1)
	return data, true
}

// GetCacheReader returns a reader for cached data
func (mc *MemoryCache) GetCacheReader(objectID uuid.UUID) (io.Reader, int64, bool) {
	data, ok := mc.GetCache(objectID)
	if !ok {
		return nil, 0, false
	}
	return bytes.NewReader(data), int64(len(data)), true
}

// Exists checks if an object is in the cache
func (mc *MemoryCache) Exists(objectID uuid.UUID) (bool, error) {
	key := objectID.String()
	_, found := mc.cache.Get(key)
	return found, nil
}

// Delete removes an object from the cache
func (mc *MemoryCache) Delete(objectID uuid.UUID) error {
	key := objectID.String()
	mc.cache.Del(key)
	return nil
}

// Clear removes all objects from the cache
func (mc *MemoryCache) Clear() error {
	mc.cache.Clear()
	mc.hits.Store(0)
	mc.misses.Store(0)

	log.Printf("Memory cache: cleared all objects")
	return nil
}

// MaxSize returns the maximum cache size in bytes
func (mc *MemoryCache) MaxSize() int64 {
	return mc.maxSize
}

// CurrentSize returns the current cache size in bytes
func (mc *MemoryCache) CurrentSize() int64 {
	// Ristretto tracks this internally through metrics
	if mc.cache.Metrics != nil {
		// CostAdded - CostEvicted gives us the current size
		return int64(mc.cache.Metrics.CostAdded() - mc.cache.Metrics.CostEvicted())
	}
	return 0
}

// Close stops the cache and cleans up resources
func (mc *MemoryCache) Close() error {
	mc.cache.Close()
	return nil
}

// GetMetrics returns cache statistics
func (mc *MemoryCache) GetMetrics() (hits, misses int64, hitRatio float64) {
	hits = mc.hits.Load()
	misses = mc.misses.Load()

	total := hits + misses
	if total > 0 {
		hitRatio = float64(hits) / float64(total)
	}

	// Also log Ristretto's internal metrics if available
	if mc.cache.Metrics != nil {
		log.Printf("Ristretto metrics - Hits: %d, Misses: %d, Ratio: %.2f%%",
			mc.cache.Metrics.Hits(),
			mc.cache.Metrics.Misses(),
			mc.cache.Metrics.Ratio()*100)
	}

	return hits, misses, hitRatio
}
