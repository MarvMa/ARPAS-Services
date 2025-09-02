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

type LRUMemoryCache struct {
	cache *lru.Cache[string, *LRUCacheEntry]

	maxSize     int64
	currentSize atomic.Int64
	ttl         time.Duration
	hits        atomic.Int64
	misses      atomic.Int64

	mu          sync.RWMutex
	stopCleanup chan struct{}
	cleanupDone sync.WaitGroup
}

type LRUCacheEntry struct {
	Data      []byte
	Size      int64
	CreatedAt time.Time
}

func NewLRUMemoryCache(maxSizeBytes int64, ttl time.Duration) *LRUMemoryCache {
	maxItems := 20

	mc := &LRUMemoryCache{
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

func (mc *LRUMemoryCache) onEvict(key string, value *LRUCacheEntry) {
	if value != nil {
		mc.currentSize.Add(-value.Size)
	}
}

func (mc *LRUMemoryCache) Store(objectID uuid.UUID, data []byte) error {
	key := objectID.String()
	size := int64(len(data))

	mc.mu.Lock()
	defer mc.mu.Unlock()

	// Check space
	for mc.currentSize.Load()+size > mc.maxSize && mc.cache.Len() > 0 {
		mc.cache.RemoveOldest()
	}

	entry := &LRUCacheEntry{
		Data:      data,
		Size:      size,
		CreatedAt: time.Now(),
	}

	evicted := mc.cache.Add(key, entry)
	if !evicted {
		mc.currentSize.Add(size)
	}

	return nil
}

func (mc *LRUMemoryCache) GetStream(objectID uuid.UUID) (io.ReadCloser, int64, error) {
	key := objectID.String()

	mc.mu.RLock()
	entry, ok := mc.cache.Get(key)
	mc.mu.RUnlock()

	if !ok {
		mc.misses.Add(1)
		return nil, 0, fmt.Errorf("object not found in cache")
	}

	mc.hits.Add(1)
	return &bytesReader{Reader: bytes.NewReader(entry.Data)}, entry.Size, nil
}

func (mc *LRUMemoryCache) Exists(objectID uuid.UUID) (bool, error) {
	mc.mu.RLock()
	defer mc.mu.RUnlock()
	return mc.cache.Contains(objectID.String()), nil
}

func (mc *LRUMemoryCache) Delete(objectID uuid.UUID) error {
	mc.mu.Lock()
	defer mc.mu.Unlock()
	mc.cache.Remove(objectID.String())
	return nil
}

func (mc *LRUMemoryCache) Clear() error {
	mc.mu.Lock()
	defer mc.mu.Unlock()
	mc.cache.Purge()
	mc.currentSize.Store(0)
	mc.hits.Store(0)
	mc.misses.Store(0)
	return nil
}

func (mc *LRUMemoryCache) MaxSize() int64 {
	return mc.maxSize
}

func (mc *LRUMemoryCache) CurrentSize() int64 {
	return mc.currentSize.Load()
}

func (mc *LRUMemoryCache) cleanupRoutine() {
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

func (mc *LRUMemoryCache) cleanupExpired() {
	if mc.ttl <= 0 {
		return
	}

	mc.mu.Lock()
	defer mc.mu.Unlock()

	now := time.Now()
	keys := mc.cache.Keys()
	expired := 0

	for _, key := range keys {
		if entry, ok := mc.cache.Peek(key); ok {
			if now.Sub(entry.CreatedAt) > mc.ttl {
				mc.cache.Remove(key)
				expired++
			}
		}
	}

	if expired > 0 {
		log.Printf("LRU cache: removed %d expired objects", expired)
	}
}

func (mc *LRUMemoryCache) Close() error {
	close(mc.stopCleanup)
	mc.cleanupDone.Wait()
	return nil
}
