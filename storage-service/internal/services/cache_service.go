package services

import (
	"context"
	"fmt"
	"io"
	"log"
	"storage-service/internal/services/caches"
	"sync"
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

	successCount := 0
	skipCount := 0
	errorCount := 0

	// Process objects with controlled concurrency
	const maxWorkers = 10
	sem := make(chan struct{}, maxWorkers)
	var wg sync.WaitGroup
	errChan := make(chan error, len(objectIDs))

	for i, objectID := range objectIDs {
		wg.Add(1)
		go func(id uuid.UUID, storageKey string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			// Check if already cached to avoid duplicate work
			if exists, _ := cs.memoryCache.Exists(id); exists {
				log.Printf("Object %s already cached, skipping", id)
				skipCount++
				return
			}

			// Download from MinIO
			object, err := cs.minio.GetObject(ctx, cs.bucketName, storageKey, minio.GetObjectOptions{})
			if err != nil {
				errChan <- fmt.Errorf("failed to get object %s from storage: %w", id, err)
				errorCount++
				return
			}
			defer object.Close()

			data, err := io.ReadAll(object)
			if err != nil {
				errChan <- fmt.Errorf("failed to read object %s: %w", id, err)
				errorCount++
				return
			}

			// Store in memory cache
			if err := cs.memoryCache.Store(id, data); err != nil {
				errChan <- fmt.Errorf("failed to cache object %s: %w", id, err)
				errorCount++
				return
			}

			successCount++
			log.Printf("Preloaded object %s (%d bytes)", id, len(data))
		}(objectID, storageKeys[i])
	}

	wg.Wait()
	close(errChan)

	// Collect errors
	var errors []error
	for err := range errChan {
		errors = append(errors, err)
	}

	duration := time.Since(startTime)
	log.Printf("Preload completed in %v - Success: %d, Skipped: %d, Errors: %d",
		duration, successCount, skipCount, errorCount)

	if len(errors) > 0 {
		return fmt.Errorf("preload had %d errors: %v", len(errors), errors[0])
	}

	return nil
}

// GetFromCacheStream provides streaming from memory cache
func (cs *CacheService) GetFromCacheStream(objectID uuid.UUID) (io.ReadCloser, int64, error) {
	rc, length, err := cs.memoryCache.GetStream(objectID)
	if err == nil {
		log.Printf("Cache HIT for object %s (size: %d)", objectID, length)
		return rc, length, nil
	}

	log.Printf("Cache MISS for object %s", objectID)
	return nil, 0, fmt.Errorf("object %s not found in cache", objectID)
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
