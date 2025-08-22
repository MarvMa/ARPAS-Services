package caches

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"storage-service/internal/services/cache"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

type MemoryCache struct {
	data        sync.Map // map[string][]byte
	metadata    sync.Map // map[string]*MemoryCacheEntry
	maxSize     int64
	currentSize int64
	ttl         time.Duration

	// Statistics
	hits   atomic.Int64
	misses atomic.Int64
}

type MemoryCacheEntry struct {
	Size        int64
	CreatedAt   time.Time
	LastAccess  time.Time
	AccessCount atomic.Int64
}

func NewMemoryCache(maxSizeBytes int64, ttl time.Duration) *MemoryCache {
	mc := &MemoryCache{
		maxSize: maxSizeBytes,
		ttl:     ttl,
	}

	// Start cleanup goroutine
	go mc.cleanupExpired()

	return mc
}

func (mc *MemoryCache) Name() string {
	return "MEMORY"
}

func (mc *MemoryCache) Store(objectID uuid.UUID, data []byte) error {
	key := objectID.String()
	size := int64(len(data))

	// Check if we need to evict objects to make space
	for atomic.LoadInt64(&mc.currentSize)+size > mc.maxSize {
		if !mc.evictLRU() {
			return fmt.Errorf("unable to free space for object of size %d", size)
		}
	}

	// Store data and metadata
	mc.data.Store(key, data)
	mc.metadata.Store(key, &MemoryCacheEntry{
		Size:        size,
		CreatedAt:   time.Now(),
		LastAccess:  time.Now(),
		AccessCount: atomic.Int64{},
	})

	atomic.AddInt64(&mc.currentSize, size)
	log.Printf("Memory cache: stored object %s (%d bytes)", objectID, size)

	return nil
}

func (mc *MemoryCache) Get(objectID uuid.UUID) ([]byte, error) {
	key := objectID.String()

	if value, ok := mc.data.Load(key); ok {
		data := value.([]byte)
		mc.updateAccess(key)
		mc.hits.Add(1)
		return data, nil
	}

	mc.misses.Add(1)
	return nil, fmt.Errorf("object not found in memory cache")
}

func (mc *MemoryCache) GetStream(objectID uuid.UUID) (io.ReadCloser, int64, error) {
	data, err := mc.Get(objectID)
	if err != nil {
		return nil, 0, err
	}

	reader := io.NopCloser(bytes.NewReader(data))
	return reader, int64(len(data)), nil
}

func (mc *MemoryCache) Exists(objectID uuid.UUID) (bool, error) {
	key := objectID.String()
	_, exists := mc.data.Load(key)
	return exists, nil
}

func (mc *MemoryCache) Delete(objectID uuid.UUID) error {
	key := objectID.String()

	if meta, ok := mc.metadata.LoadAndDelete(key); ok {
		entry := meta.(*MemoryCacheEntry)
		atomic.AddInt64(&mc.currentSize, -entry.Size)
		mc.data.Delete(key)
		log.Printf("Memory cache: deleted object %s (%d bytes)", objectID, entry.Size)
	}

	return nil
}

func (mc *MemoryCache) Clear() error {
	mc.data.Range(func(key, value interface{}) bool {
		mc.data.Delete(key)
		return true
	})
	mc.metadata.Range(func(key, value interface{}) bool {
		mc.metadata.Delete(key)
		return true
	})
	atomic.StoreInt64(&mc.currentSize, 0)
	mc.hits.Store(0)
	mc.misses.Store(0)

	log.Printf("Memory cache: cleared all objects")
	return nil
}

func (mc *MemoryCache) GetStats() cache.LayerStats {
	hits := mc.hits.Load()
	misses := mc.misses.Load()
	total := hits + misses

	var hitRate float64
	if total > 0 {
		hitRate = float64(hits) / float64(total) * 100
	}

	objectCount := 0
	mc.data.Range(func(key, value interface{}) bool {
		objectCount++
		return true
	})

	return cache.LayerStats{
		Name:         "Memory",
		Objects:      objectCount,
		SizeBytes:    atomic.LoadInt64(&mc.currentSize),
		Hits:         hits,
		Misses:       misses,
		HitRate:      hitRate,
		AvgLatencyMs: 0.1, // Memory access is very fast
	}
}

func (mc *MemoryCache) updateAccess(key string) {
	if meta, ok := mc.metadata.Load(key); ok {
		entry := meta.(*MemoryCacheEntry)
		entry.LastAccess = time.Now()
		entry.AccessCount.Add(1)
	}
}

func (mc *MemoryCache) evictLRU() bool {
	var oldestKey string
	var oldestTime time.Time

	mc.metadata.Range(func(key, value interface{}) bool {
		entry := value.(*MemoryCacheEntry)
		if oldestKey == "" || entry.LastAccess.Before(oldestTime) {
			oldestKey = key.(string)
			oldestTime = entry.LastAccess
		}
		return true
	})

	if oldestKey != "" {
		if objectID, err := uuid.Parse(oldestKey); err == nil {
			mc.Delete(objectID)
			return true
		}
	}

	return false
}

func (mc *MemoryCache) cleanupExpired() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		var expiredKeys []string

		mc.metadata.Range(func(key, value interface{}) bool {
			entry := value.(*MemoryCacheEntry)
			if now.Sub(entry.CreatedAt) > mc.ttl {
				expiredKeys = append(expiredKeys, key.(string))
			}
			return true
		})

		for _, key := range expiredKeys {
			if objectID, err := uuid.Parse(key); err == nil {
				mc.Delete(objectID)
			}
		}

		if len(expiredKeys) > 0 {
			log.Printf("Memory cache: cleaned up %d expired objects", len(expiredKeys))
		}
	}
}
