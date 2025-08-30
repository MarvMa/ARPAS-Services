package services

import (
	"context"
	"fmt"
	"io"
	"log"
	"storage-service/internal/services/caches"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
)

// CacheService provides multi-layer caching with intelligent strategy selection
type CacheService struct {
	memoryCache *caches.MemoryCache
	minio       *minio.Client
	bucketName  string
	mu          sync.RWMutex
}
type PreloadObject struct {
	ID         uuid.UUID
	StorageKey string
	Size       int64
}

type CacheStatistics struct {
	Objects      int     `json:"objects"`
	SizeBytes    int64   `json:"sizeBytes"`
	SizeMB       float64 `json:"sizeMB"`
	Hits         int64   `json:"hits"`
	Misses       int64   `json:"misses"`
	HitRate      float64 `json:"hitRate"`
	MaxSizeBytes int64   `json:"maxSizeBytes"`
	MaxSizeMB    float64 `json:"maxSizeMB"`
}

func NewCacheService(minio *minio.Client, bucketName string, maxSizeBytes int64, ttl time.Duration) *CacheService {
	return &CacheService{
		memoryCache: caches.NewMemoryCache(maxSizeBytes, ttl),
		minio:       minio,
		bucketName:  bucketName,
	}
}
func (cs *CacheService) PreloadObjects(ctx context.Context, objectIDs []uuid.UUID, storageKeys []string) error {
	if len(objectIDs) != len(storageKeys) {
		return fmt.Errorf("objectIDs and storageKeys must have the same length")
	}

	log.Printf("Starting preload for %d objects", len(objectIDs))
	startTime := time.Now()

	// Pre-filter to avoid unnecessary work
	var toLoad []struct {
		ID  uuid.UUID
		Key string
	}

	for i, objectID := range objectIDs {
		if exists, _ := cs.memoryCache.Exists(objectID); !exists {
			toLoad = append(toLoad, struct {
				ID  uuid.UUID
				Key string
			}{objectID, storageKeys[i]})
		}
	}

	if len(toLoad) == 0 {
		log.Printf("All %d objects already cached", len(objectIDs))
		return nil
	}

	const maxWorkers = 20
	sem := make(chan struct{}, maxWorkers)
	var wg sync.WaitGroup

	successCount := int32(0)
	errorCount := int32(0)

	for _, item := range toLoad {
		wg.Add(1)
		go func(id uuid.UUID, storageKey string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			object, err := cs.minio.GetObject(ctx, cs.bucketName, storageKey, minio.GetObjectOptions{})
			if err != nil {
				atomic.AddInt32(&errorCount, 1)
				return
			}
			defer object.Close()

			stat, err := object.Stat()
			if err != nil {
				atomic.AddInt32(&errorCount, 1)
				return
			}

			data := make([]byte, stat.Size)
			_, err = io.ReadFull(object, data)
			if err != nil {
				atomic.AddInt32(&errorCount, 1)
				return
			}

			// Store in memory cache
			if err := cs.memoryCache.Store(id, data); err != nil {
				atomic.AddInt32(&errorCount, 1)
				return
			}

			atomic.AddInt32(&successCount, 1)
		}(item.ID, item.Key)
	}

	wg.Wait()

	duration := time.Since(startTime)
	log.Printf("Preload completed in %v - Success: %d, Errors: %d",
		duration, successCount, errorCount)

	if errorCount > 0 {
		return fmt.Errorf("preload had %d errors", errorCount)
	}

	return nil
}

// GetFromCacheStream provides streaming from memory cache
func (cs *CacheService) GetFromCacheStream(objectID uuid.UUID) (io.ReadCloser, int64, error) {
	return cs.memoryCache.GetStream(objectID)
}

// InvalidateObject removes from cache
func (cs *CacheService) InvalidateObject(objectID uuid.UUID) error {
	return cs.memoryCache.Delete(objectID)
}

// GetStatistics returns cache statistics
func (cs *CacheService) GetStatistics() (*CacheStatistics, error) {
	stats := cs.memoryCache.GetStats()

	return &CacheStatistics{
		Objects:      stats.Objects,
		SizeBytes:    stats.SizeBytes,
		SizeMB:       float64(stats.SizeBytes) / (1024 * 1024),
		Hits:         stats.Hits,
		Misses:       stats.Misses,
		HitRate:      stats.HitRate,
		MaxSizeBytes: cs.memoryCache.MaxSize(),
		MaxSizeMB:    float64(cs.memoryCache.MaxSize()) / (1024 * 1024),
	}, nil
}

// ClearCache clears the cache
func (cs *CacheService) ClearCache() error {
	return cs.memoryCache.Clear()
}

// CheckCached checks if an object is cached
func (cs *CacheService) CheckCached(objectID uuid.UUID) bool {
	exists, _ := cs.memoryCache.Exists(objectID)
	return exists
}
