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

type RistrettoCache struct {
	cache   *ristretto.Cache[string, []byte]
	maxSize int64
	ttl     time.Duration
	hits    atomic.Int64
	misses  atomic.Int64
}

func NewRistrettoCache(maxSizeBytes int64, ttl time.Duration) *RistrettoCache {
	estimatedItems := maxSizeBytes / (1024 * 1024) // Estimate 1MB average
	if estimatedItems < 100 {
		estimatedItems = 100
	}

	config := &ristretto.Config[string, []byte]{
		NumCounters: estimatedItems * 10,
		MaxCost:     maxSizeBytes,
		BufferItems: 64,
		Metrics:     true,
		Cost: func(value []byte) int64 {
			return int64(len(value))
		},
	}

	cache, err := ristretto.NewCache(config)
	if err != nil {
		panic(fmt.Sprintf("Failed to create Ristretto cache: %v", err))
	}

	return &RistrettoCache{
		cache:   cache,
		maxSize: maxSizeBytes,
		ttl:     ttl,
	}
}

func (rc *RistrettoCache) Store(objectID uuid.UUID, data []byte) error {
	key := objectID.String()
	size := int64(len(data))

	var success bool
	if rc.ttl > 0 {
		success = rc.cache.SetWithTTL(key, data, size, rc.ttl)
	} else {
		success = rc.cache.Set(key, data, size)
	}

	if !success {
		log.Printf("Ristretto: Set dropped for %s (normal under load)", objectID)
	}

	// Wait for value to pass through buffers
	rc.cache.Wait()
	return nil
}

func (rc *RistrettoCache) GetStream(objectID uuid.UUID) (io.ReadCloser, int64, error) {
	key := objectID.String()

	value, found := rc.cache.Get(key)
	if !found {
		rc.misses.Add(1)
		return nil, 0, fmt.Errorf("object not found in cache")
	}

	rc.hits.Add(1)
	return &bytesReader{Reader: bytes.NewReader(value)}, int64(len(value)), nil
}

func (rc *RistrettoCache) Exists(objectID uuid.UUID) (bool, error) {
	_, found := rc.cache.Get(objectID.String())
	return found, nil
}

func (rc *RistrettoCache) Delete(objectID uuid.UUID) error {
	rc.cache.Del(objectID.String())
	return nil
}

func (rc *RistrettoCache) Clear() error {
	rc.cache.Clear()
	rc.hits.Store(0)
	rc.misses.Store(0)
	return nil
}

func (rc *RistrettoCache) MaxSize() int64 {
	return rc.maxSize
}

func (rc *RistrettoCache) CurrentSize() int64 {
	if rc.cache.Metrics != nil {
		return int64(rc.cache.Metrics.CostAdded() - rc.cache.Metrics.CostEvicted())
	}
	return 0
}

func (rc *RistrettoCache) Close() error {
	rc.cache.Close()
	return nil
}
