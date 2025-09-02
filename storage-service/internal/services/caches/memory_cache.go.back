package caches

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	lru "github.com/hashicorp/golang-lru/v2"
)

type MemoryCache struct {
	cache *lru.Cache[string, *CacheEntry]

	// Cache configuration
	maxItems    int
	maxSize     int64
	currentSize atomic.Int64
	ttl         time.Duration

	// Statistics
	hits   atomic.Int64
	misses atomic.Int64

	// Cleanup control
	stopCleanup chan struct{}
	cleanupDone sync.WaitGroup

	sizeMu sync.RWMutex
}

// CacheEntry holds metadata for cached items
type CacheEntry struct {
	Data        []byte
	Size        int64
	CreatedAt   time.Time
	AccessCount atomic.Int64
	mu          sync.RWMutex
}

// NewMemoryCache creates a new memory cache
func NewMemoryCache(maxSizeBytes int64, ttl time.Duration) *MemoryCache {
	maxItems := 30

	mc := &MemoryCache{
		maxItems:    maxItems,
		maxSize:     maxSizeBytes,
		ttl:         ttl,
		stopCleanup: make(chan struct{}),
	}

	cache, err := lru.NewWithEvict(maxItems, mc.onEvict)
	if err != nil {
		panic(fmt.Sprintf("Failed to create LRU cache: %v", err))
	}
	mc.cache = cache

	if ttl > 0 {
		mc.cleanupDone.Add(1)
		go mc.cleanupRoutine()
	}

	return mc
}

func (mc *MemoryCache) onEvict(key string, value *CacheEntry) {
	if value != nil {
		mc.currentSize.Add(-value.Size)
		value.Data = nil
	}
}

// Store adds an object to the cache
func (mc *MemoryCache) Store(objectID uuid.UUID, readerFunc func() (io.ReadCloser, int64, error)) error {
	key := objectID.String()

	if mc.cache.Contains(key) {
		return nil
	}

	reader, size, err := readerFunc()
	if err != nil {
		return err
	}
	defer reader.Close()

	if size > 50*1024*1024 { // > 50MB
		return fmt.Errorf("object too large for cache: %d bytes", size)
	}

	currentSize := mc.currentSize.Load()
	if currentSize+size > mc.maxSize {
		for mc.currentSize.Load()+size > mc.maxSize && mc.cache.Len() > 0 {
			mc.cache.RemoveOldest()
		}
	}

	data := make([]byte, size)
	n, err := io.ReadFull(reader, data)
	if err != nil {
		return fmt.Errorf("failed to read: %v", err)
	}
	if int64(n) != size {
		return fmt.Errorf("incomplete read: %d/%d bytes", n, size)
	}

	item := &CacheEntry{
		Data:      data,
		Size:      size,
		CreatedAt: time.Now(),
	}

	evicted := mc.cache.Add(key, item)
	if !evicted {
		mc.currentSize.Add(size)
	}

	return nil
}

func (mc *MemoryCache) GetCache(objectID uuid.UUID) ([]byte, bool) {
	key := objectID.String()
	item, ok := mc.cache.Get(key)
	if !ok {
		mc.misses.Add(1)
		return nil, false
	}

	mc.hits.Add(1)
	item.AccessCount.Add(1)

	return item.Data, true
}
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
	return mc.cache.Contains(key), nil
}

func (mc *MemoryCache) Delete(objectID uuid.UUID) error {
	key := objectID.String()
	mc.cache.Remove(key)
	return nil
}

// Clear removes all objects from the cache
func (mc *MemoryCache) Clear() error {
	mc.cache.Purge()
	mc.currentSize.Store(0)
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
	return mc.currentSize.Load()
}

func (mc *MemoryCache) cleanupRoutine() {
	defer mc.cleanupDone.Done()

	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-mc.stopCleanup:
			return
		case <-ticker.C:
			mc.cleanupExpired()
		}
	}
}

// cleanupExpired removes items that have exceeded TTL
func (mc *MemoryCache) cleanupExpired() {
	if mc.ttl <= 0 {
		return
	}

	expiredCount := 0
	now := time.Now()

	// Get all keys
	keys := mc.cache.Keys()

	for _, key := range keys {
		// Peek doesn't update LRU order
		if item, ok := mc.cache.Peek(key); ok {
			if now.Sub(item.CreatedAt) > mc.ttl {
				mc.cache.Remove(key)
				expiredCount++
			}
		}
	}

	if expiredCount > 0 {
		log.Printf("Memory cache: removed %d expired objects", expiredCount)
	}
}

// Close stops the cleanup routine
func (mc *MemoryCache) Close() error {
	close(mc.stopCleanup)
	mc.cleanupDone.Wait()
	return nil
}
