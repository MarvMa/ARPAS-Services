package services

import (
	"context"
	"fmt"
	"io"
	"log"
	"storage-service/internal/storage"
	"storage-service/internal/utils"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
)

// CacheService provides multi-layer caching with intelligent strategy selection
type CacheService struct {
	strategy   *CacheStrategy
	minio      *minio.Client
	bucketName string
	metrics    *utils.Metrics

	// Performance tracking
	strategyHits   map[string]int64
	strategyMisses map[string]int64
	mu             sync.RWMutex
}

func NewCacheService(redis *storage.RedisClient, minio *minio.Client, bucketName string, ttl time.Duration) *CacheService {
	return &CacheService{
		strategy:       NewCacheStrategy(redis, minio, bucketName, ttl),
		minio:          minio,
		bucketName:     bucketName,
		metrics:        utils.NewMetrics(),
		strategyHits:   make(map[string]int64),
		strategyMisses: make(map[string]int64),
	}
}

// PreloadObjects implements intelligent multi-layer preloading
func (ocs *CacheService) PreloadObjects(ctx context.Context, objectIDs []uuid.UUID, storageKeys []string) error {
	if len(objectIDs) != len(storageKeys) {
		return fmt.Errorf("objectIDs and storageKeys must have the same length")
	}

	log.Printf("Starting optimized preload for %d objects", len(objectIDs))
	startTime := time.Now()

	objectSizes := make(map[uuid.UUID]int64)
	for i, storageKey := range storageKeys {
		if stat, err := ocs.minio.StatObject(ctx, ocs.bucketName, storageKey, minio.StatObjectOptions{}); err == nil {
			objectSizes[objectIDs[i]] = stat.Size
		} else {
			log.Printf("Failed to get size for object %s: %v", objectIDs[i], err)
			objectSizes[objectIDs[i]] = 0 // Will be handled appropriately
		}
	}

	// Group objects by cache strategy
	strategyGroups := ocs.groupObjectsByStrategy(objectIDs, storageKeys, objectSizes)

	// Preload each group with optimal concurrency
	var wg sync.WaitGroup
	errChan := make(chan error, len(objectIDs))

	for strategy, objects := range strategyGroups {
		wg.Add(1)
		go func(strategy string, objects []PreloadObject) {
			defer wg.Done()
			ocs.preloadStrategyGroup(ctx, strategy, objects, errChan)
		}(strategy, objects)
	}

	wg.Wait()
	close(errChan)

	// Collect errors
	var errors []error
	for err := range errChan {
		errors = append(errors, err)
	}

	duration := time.Since(startTime)
	log.Printf("Optimized preload completed in %v with %d errors", duration, len(errors))

	if len(errors) > 0 {
		return fmt.Errorf("preload had %d errors: %v", len(errors), errors[0])
	}

	return nil
}

// GetFromCacheStream provides optimized streaming with fallback chain
func (ocs *CacheService) GetFromCacheStream(objectID uuid.UUID) (io.ReadCloser, int64, error) {
	startTime := time.Now()
	defer func() {
		ocs.metrics.RecordCacheLatency(time.Since(startTime).Milliseconds())
	}()

	if exists, _ := ocs.strategy.memoryCache.Exists(objectID); exists {
		rc, length, err := ocs.strategy.memoryCache.GetStream(objectID)
		if err == nil {
			ocs.recordStrategyHit("MEMORY")
			log.Printf("CACHE HIT: MEMORY layer for object %s (size: %d)", objectID, length)
			return rc, length, nil
		}
	}

	if exists, _ := ocs.strategy.fileCache.Exists(objectID); exists {
		rc, length, err := ocs.strategy.fileCache.GetStream(objectID)
		if err == nil {
			ocs.recordStrategyHit("FILESYSTEM")
			log.Printf("CACHE HIT: FILESYSTEM layer for object %s (size: %d)", objectID, length)

			// Async: promote to memory cache if small enough
			go ocs.promoteToMemory(objectID, length)

			return rc, length, nil
		}
	}

	if exists, _ := ocs.strategy.redisCache.Exists(objectID); exists {
		rc, length, err := ocs.strategy.redisCache.GetStream(objectID)
		if err == nil {
			ocs.recordStrategyHit("REDIS")
			log.Printf("CACHE HIT: REDIS layer for object %s (size: %d)", objectID, length)

			// Async: promote to optimal cache
			go ocs.promoteToOptimalCache(objectID, length)

			return rc, length, nil
		}
	}

	// Complete cache miss
	ocs.recordStrategyMiss("ALL_LAYERS")
	return nil, 0, fmt.Errorf("object %s not found in any cache layer", objectID)
}

// GetObjectOrLoad with intelligent caching strategy
func (ocs *CacheService) GetObjectOrLoad(ctx context.Context, objectID uuid.UUID, storageKey string) ([]byte, bool, error) {
	// Get object size for strategy decision
	size, err := ocs.getObjectSizeFromStorage(ctx, storageKey)
	if err != nil {
		return nil, false, fmt.Errorf("failed to get object size: %w", err)
	}

	return ocs.strategy.GetObject(ctx, objectID, storageKey, size)
}

// InvalidateObject removes from all layers
func (ocs *CacheService) InvalidateObject(objectID uuid.UUID) error {
	return ocs.strategy.InvalidateObject(objectID)
}

// GetStatistics returns comprehensive multi-layer statistics
func (ocs *CacheService) GetStatistics() (*OptimizedCacheStatistics, error) {
	strategyStats, err := ocs.strategy.GetStatistics()
	if err != nil {
		return nil, err
	}

	ocs.mu.RLock()
	hitsByStrategy := make(map[string]int64)
	missesByStrategy := make(map[string]int64)
	for k, v := range ocs.strategyHits {
		hitsByStrategy[k] = v
	}
	for k, v := range ocs.strategyMisses {
		missesByStrategy[k] = v
	}
	ocs.mu.RUnlock()

	return &OptimizedCacheStatistics{
		MultiLayer:        *strategyStats,
		HitsByStrategy:    hitsByStrategy,
		MissesByStrategy:  missesByStrategy,
		OptimalCacheUsage: ocs.calculateOptimalCacheUsage(),
	}, nil
}

// ClearCache clears all cache layers
func (ocs *CacheService) ClearCache() error {
	return ocs.strategy.ClearAll()
}

// Private helper methods

type PreloadObject struct {
	ID         uuid.UUID
	StorageKey string
	Size       int64
}

func (ocs *CacheService) groupObjectsByStrategy(objectIDs []uuid.UUID, storageKeys []string, sizes map[uuid.UUID]int64) map[string][]PreloadObject {
	groups := make(map[string][]PreloadObject)

	for i, id := range objectIDs {
		size := sizes[id]
		cache := ocs.strategy.GetOptimalCache(size)

		var strategyName string
		if cache != nil {
			strategyName = cache.Name()
		} else {
			strategyName = "SKIP" // Too large for caching
		}

		groups[strategyName] = append(groups[strategyName], PreloadObject{
			ID:         id,
			StorageKey: storageKeys[i],
			Size:       size,
		})
	}

	return groups
}

func (ocs *CacheService) preloadStrategyGroup(ctx context.Context, strategy string, objects []PreloadObject, errChan chan<- error) {
	if strategy == "SKIP" {
		log.Printf("Skipping preload for %d oversized objects", len(objects))
		return
	}

	// Adjust concurrency based on strategy
	maxWorkers := ocs.getOptimalWorkerCount(strategy)
	sem := make(chan struct{}, maxWorkers)
	var wg sync.WaitGroup

	log.Printf("Preloading %d objects using %s strategy with %d workers", len(objects), strategy, maxWorkers)

	for _, obj := range objects {
		wg.Add(1)
		go func(object PreloadObject) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			if err := ocs.strategy.PreloadObject(ctx, object.ID, object.StorageKey, object.Size); err != nil {
				errChan <- fmt.Errorf("failed to preload %s: %w", object.ID, err)
			}
		}(obj)
	}

	wg.Wait()
}

func (ocs *CacheService) getOptimalWorkerCount(strategy string) int {
	switch strategy {
	case "MEMORY":
		return 20 // Memory operations are fast, can handle more concurrency
	case "FILESYSTEM":
		return 10 // Disk I/O limited
	case "REDIS":
		return 5 // Network limited
	default:
		return 5
	}
}

func (ocs *CacheService) promoteToMemory(objectID uuid.UUID, size int64) {
	if size > SmallFileThreshold {
		return // Too large for memory cache
	}

	// Get data from filesystem cache
	data, err := ocs.strategy.fileCache.Get(objectID)
	if err != nil {
		return
	}

	// Store in memory cache
	if err := ocs.strategy.memoryCache.Store(objectID, data); err != nil {
		log.Printf("Failed to promote object %s to memory: %v", objectID, err)
	} else {
		log.Printf("Promoted object %s to memory cache", objectID)
	}
}

func (ocs *CacheService) promoteToOptimalCache(objectID uuid.UUID, size int64) {
	optimal := ocs.strategy.GetOptimalCache(size)
	if optimal == nil || optimal.Name() == "REDIS" {
		return // Already in optimal layer or too large
	}

	// Get data from Redis cache
	data, err := ocs.strategy.redisCache.Get(objectID)
	if err != nil {
		return
	}

	// Store in optimal cache
	if err := optimal.Store(objectID, data); err != nil {
		log.Printf("Failed to promote object %s to %s: %v", objectID, optimal.Name(), err)
	} else {
		log.Printf("Promoted object %s to %s cache", objectID, optimal.Name())
	}
}

func (ocs *CacheService) getObjectSizeFromStorage(ctx context.Context, storageKey string) (int64, error) {
	stat, err := ocs.minio.StatObject(ctx, ocs.bucketName, storageKey, minio.StatObjectOptions{})
	if err != nil {
		return 0, err
	}
	return stat.Size, nil
}

func (ocs *CacheService) recordStrategyHit(strategy string) {
	ocs.mu.Lock()
	ocs.strategyHits[strategy]++
	ocs.mu.Unlock()
}

func (ocs *CacheService) recordStrategyMiss(strategy string) {
	ocs.mu.Lock()
	ocs.strategyMisses[strategy]++
	ocs.mu.Unlock()
}

func (ocs *CacheService) calculateOptimalCacheUsage() map[string]float64 {
	ocs.mu.RLock()
	defer ocs.mu.RUnlock()

	usage := make(map[string]float64)

	for strategy := range ocs.strategyHits {
		hits := ocs.strategyHits[strategy]
		misses := ocs.strategyMisses[strategy]
		total := hits + misses

		if total > 0 {
			usage[strategy] = float64(hits) / float64(total) * 100
		}
	}

	return usage
}

// OptimizedCacheStatistics represents comprehensive cache statistics
type OptimizedCacheStatistics struct {
	MultiLayer        MultiLayerCacheStats `json:"multiLayer"`
	HitsByStrategy    map[string]int64     `json:"hitsByStrategy"`
	MissesByStrategy  map[string]int64     `json:"missesByStrategy"`
	OptimalCacheUsage map[string]float64   `json:"optimalCacheUsage"`
}
