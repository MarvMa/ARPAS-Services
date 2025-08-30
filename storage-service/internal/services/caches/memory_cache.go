package caches

import (
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
	metadata    sync.Map // map[string]*CacheEntry
	mu          sync.RWMutex
	maxSize     int64
	currentSize int64
	ttl         time.Duration

	// Statistics
	hits   atomic.Int64
	misses atomic.Int64

	// Cleanup control
	stopCleanup chan struct{}
	cleanupDone sync.WaitGroup
}

// CacheEntry holds metadata for cached items
type CacheEntry struct {
	Size        int64
	CreatedAt   time.Time
	LastAccess  time.Time
	AccessCount atomic.Int64
}

// NewMemoryCache creates a new memory cache
func NewMemoryCache(maxSizeBytes int64, ttl time.Duration) *MemoryCache {
	mc := &MemoryCache{
		maxSize:     maxSizeBytes,
		ttl:         ttl,
		stopCleanup: make(chan struct{}),
	}

	// Start background cleanup
	mc.cleanupDone.Add(1)
	go mc.cleanupRoutine()

	return mc
}

// Name returns the cache name
func (mc *MemoryCache) Name() string {
	return "MEMORY"
}

// Store adds an object to the cache
func (mc *MemoryCache) Store(objectID uuid.UUID, data []byte) error {
	key := objectID.String()
	size := int64(len(data))

	// Fast path: check if object already exists without deletion
	if _, exists := mc.data.Load(key); exists {
		// Already cached, skip to avoid unnecessary work
		return nil
	}

	// Check space before any operations
	neededSpace := size
	currentTotal := atomic.LoadInt64(&mc.currentSize) + neededSpace

	// Batch eviction if needed - more efficient than one-by-one
	if currentTotal > mc.maxSize {
		if !mc.makeSpace(neededSpace) {
			return fmt.Errorf("unable to free space for object of size %d bytes (max: %d, current: %d)",
				size, mc.maxSize, atomic.LoadInt64(&mc.currentSize))
		}
	}

	// Store data and metadata atomically
	mc.data.Store(key, data)
	mc.metadata.Store(key, &CacheEntry{
		Size:       size,
		CreatedAt:  time.Now(),
		LastAccess: time.Now(),
	})

	atomic.AddInt64(&mc.currentSize, size)

	return nil
}

func (mc *MemoryCache) makeSpace(needed int64) bool {
	targetSize := mc.maxSize - needed

	for atomic.LoadInt64(&mc.currentSize) > targetSize {
		if !mc.evictLRU() {
			return false
		}
	}
	return true
}

// GetStream returns a reader for the cached object
func (mc *MemoryCache) GetStream(objectID uuid.UUID) (io.ReadCloser, int64, error) {
	key := objectID.String()

	// Direct access without going through Get() to avoid unnecessary operations
	value, ok := mc.data.Load(key)
	if !ok {
		mc.misses.Add(1)
		return nil, 0, fmt.Errorf("object not found in memory cache")
	}

	data := value.([]byte)

	// Update access in background to not block streaming
	go mc.updateAccess(key)
	mc.hits.Add(1)

	return &directReader{
		data: data,
		pos:  0,
	}, int64(len(data)), nil
}

// directReader provides zero-copy streaming from byte slice
type directReader struct {
	data []byte
	pos  int
}

func (r *directReader) Read(p []byte) (n int, err error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	n = copy(p, r.data[r.pos:])
	r.pos += n
	return n, nil
}

func (r *directReader) Close() error {
	r.data = nil
	return nil
}

// Exists checks if an object is in the cache
func (mc *MemoryCache) Exists(objectID uuid.UUID) (bool, error) {
	key := objectID.String()
	_, exists := mc.data.Load(key)
	return exists, nil
}

// Delete removes an object from the cache
func (mc *MemoryCache) Delete(objectID uuid.UUID) error {
	key := objectID.String()

	metaValue, ok := mc.metadata.LoadAndDelete(key)
	if !ok {
		return nil // Object not in cache
	}

	entry := metaValue.(*CacheEntry)
	mc.data.Delete(key)
	atomic.AddInt64(&mc.currentSize, -entry.Size)

	log.Printf("Memory cache: deleted object %s (%d bytes)", objectID, entry.Size)
	return nil
}

// Clear removes all objects from the cache
func (mc *MemoryCache) Clear() error {
	// Clear all data
	mc.data.Range(func(key, _ interface{}) bool {
		mc.data.Delete(key)
		return true
	})

	// Clear all metadata
	mc.metadata.Range(func(key, _ interface{}) bool {
		mc.metadata.Delete(key)
		return true
	})

	atomic.StoreInt64(&mc.currentSize, 0)
	mc.hits.Store(0)
	mc.misses.Store(0)

	log.Printf("Memory cache: cleared all objects")
	return nil
}

// GetStats returns cache statistics
func (mc *MemoryCache) GetStats() cache.LayerStats {
	hits := mc.hits.Load()
	misses := mc.misses.Load()
	total := hits + misses

	var hitRate float64
	if total > 0 {
		hitRate = float64(hits) / float64(total) * 100
	}

	objectCount := 0
	mc.data.Range(func(_, _ interface{}) bool {
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

// MaxSize returns the maximum cache size in bytes
func (mc *MemoryCache) MaxSize() int64 {
	return mc.maxSize
}

// CurrentSize returns the current cache size in bytes
func (mc *MemoryCache) CurrentSize() int64 {
	return atomic.LoadInt64(&mc.currentSize)
}

// updateAccess updates the last access time and count for an entry
func (mc *MemoryCache) updateAccess(key string) {
	if metaValue, ok := mc.metadata.Load(key); ok {
		entry := metaValue.(*CacheEntry)
		now := time.Now()
		if now.Sub(entry.LastAccess) > time.Second {
			entry.LastAccess = now
		}
		entry.AccessCount.Add(1)
	}
}

// evictLRU removes the least recently used item
func (mc *MemoryCache) evictLRU() bool {
	var (
		oldestKey  string
		oldestTime = time.Now() // Start with current time
		found      bool
	)

	// Find LRU item
	mc.metadata.Range(func(key, value interface{}) bool {
		entry := value.(*CacheEntry)
		if entry.LastAccess.Before(oldestTime) {
			oldestKey = key.(string)
			oldestTime = entry.LastAccess
			found = true
		}
		return true
	})

	if !found {
		return false
	}

	metaValue, ok := mc.metadata.LoadAndDelete(oldestKey)
	if !ok {
		return false
	}

	entry := metaValue.(*CacheEntry)
	mc.data.Delete(oldestKey)
	atomic.AddInt64(&mc.currentSize, -entry.Size)

	return true
}

// cleanupRoutine periodically removes expired items
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
		return // No TTL set
	}

	var expiredKeys []string

	mc.metadata.Range(func(key, value interface{}) bool {
		entry := value.(*CacheEntry)
		if time.Since(entry.CreatedAt) > mc.ttl {
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

// Close stops the cleanup routine
func (mc *MemoryCache) Close() error {
	close(mc.stopCleanup)
	mc.cleanupDone.Wait()
	return nil
}
