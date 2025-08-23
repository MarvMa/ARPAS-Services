package services

import (
	"context"
	"fmt"
	"io"
	"log"
	"storage-service/internal/metrics"
	"storage-service/internal/storage"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
)

// InstrumentedCacheService wraps CacheService with metrics collection
type InstrumentedCacheService struct {
	*CacheService
}

// NewInstrumentedCacheService creates a new instrumented cache service
func NewInstrumentedCacheService(redis *storage.RedisClient, minio *minio.Client, bucketName string, ttl time.Duration) *InstrumentedCacheService {
	return &InstrumentedCacheService{
		CacheService: NewCacheService(redis, minio, bucketName, ttl),
	}
}

// GetFromCacheStreamWithMetrics provides optimized streaming with detailed metrics
func (ics *InstrumentedCacheService) GetFromCacheStreamWithMetrics(ctx context.Context, objectID uuid.UUID, metrics *metrics.LatencyMetrics) (io.ReadCloser, int64, error, string) {
	// Try Memory Cache
	memoryLayer := metrics.StartCacheLayerAttempt("MEMORY")
	if exists, _ := ics.strategy.memoryCache.Exists(objectID); exists {
		rc, length, err := ics.strategy.memoryCache.GetStream(objectID)
		metrics.EndCacheLayerAttempt(memoryLayer, err == nil, err, length)

		if err == nil {
			ics.recordStrategyHit("MEMORY")
			log.Printf("CACHE HIT: MEMORY layer for object %s (size: %d)", objectID, length)
			return rc, length, nil, "MEMORY"
		}
	} else {
		metrics.EndCacheLayerAttempt(memoryLayer, false, fmt.Errorf("not exists"), 0)
	}

	// Try FileSystem Cache
	fileLayer := metrics.StartCacheLayerAttempt("FILESYSTEM")
	if exists, _ := ics.strategy.fileCache.Exists(objectID); exists {
		rc, length, err := ics.strategy.fileCache.GetStream(objectID)
		metrics.EndCacheLayerAttempt(fileLayer, err == nil, err, length)

		if err == nil {
			ics.recordStrategyHit("FILESYSTEM")
			log.Printf("CACHE HIT: FILESYSTEM layer for object %s (size: %d)", objectID, length)

			// Async: promote to memory cache if small enough
			go ics.promoteToMemoryWithMetrics(objectID, length, metrics)

			return rc, length, nil, "FILESYSTEM"
		}
	} else {
		metrics.EndCacheLayerAttempt(fileLayer, false, fmt.Errorf("not exists"), 0)
	}

	// Try Redis Cache
	redisLayer := metrics.StartCacheLayerAttempt("REDIS")
	if exists, _ := ics.strategy.redisCache.Exists(objectID); exists {
		rc, length, err := ics.strategy.redisCache.GetStream(objectID)
		metrics.EndCacheLayerAttempt(redisLayer, err == nil, err, length)

		if err == nil {
			ics.recordStrategyHit("REDIS")
			log.Printf("CACHE HIT: REDIS layer for object %s (size: %d)", objectID, length)

			// Async: promote to optimal cache
			go ics.promoteToOptimalCacheWithMetrics(objectID, length, metrics)

			return rc, length, nil, "REDIS"
		}
	} else {
		metrics.EndCacheLayerAttempt(redisLayer, false, fmt.Errorf("not exists"), 0)
	}

	// Complete cache miss
	ics.recordStrategyMiss("ALL_LAYERS")
	return nil, 0, fmt.Errorf("object %s not found in any cache layer", objectID), "NO_CACHE"
}

// promoteToMemoryWithMetrics promotes with latency tracking
func (ics *InstrumentedCacheService) promoteToMemoryWithMetrics(objectID uuid.UUID, size int64, metrics *metrics.LatencyMetrics) {
	if size > SmallFileThreshold {
		return
	}

	startTime := time.Now()
	defer func() {
		metrics.RecordPromotion(time.Since(startTime))
	}()

	// Get data from filesystem cache
	data, err := ics.strategy.fileCache.Get(objectID)
	if err != nil {
		return
	}

	// Store in memory cache
	if err := ics.strategy.memoryCache.Store(objectID, data); err != nil {
		log.Printf("Failed to promote object %s to memory: %v", objectID, err)
	} else {
		log.Printf("Promoted object %s to memory cache (took %.2fms)", objectID, float64(time.Since(startTime).Microseconds())/1000.0)
	}
}

// promoteToOptimalCacheWithMetrics promotes with latency tracking
func (ics *InstrumentedCacheService) promoteToOptimalCacheWithMetrics(objectID uuid.UUID, size int64, metrics *metrics.LatencyMetrics) {
	optimal := ics.strategy.GetOptimalCache(size)
	if optimal == nil || optimal.Name() == "REDIS" {
		return
	}

	startTime := time.Now()
	defer func() {
		metrics.RecordPromotion(time.Since(startTime))
	}()

	// Get data from Redis cache
	data, err := ics.strategy.redisCache.Get(objectID)
	if err != nil {
		return
	}

	// Store in optimal cache
	if err := optimal.Store(objectID, data); err != nil {
		log.Printf("Failed to promote object %s to %s: %v", objectID, optimal.Name(), err)
	} else {
		log.Printf("Promoted object %s to %s cache (took %.2fms)", objectID, optimal.Name(), float64(time.Since(startTime).Microseconds())/1000.0)
	}
}

// PreloadObjectsWithMetrics implements intelligent multi-layer preloading with metrics
func (ics *InstrumentedCacheService) PreloadObjectsWithMetrics(ctx context.Context, objectIDs []uuid.UUID, storageKeys []string) (*metrics.PreloadMetrics, error) {
	if len(objectIDs) != len(storageKeys) {
		return nil, fmt.Errorf("objectIDs and storageKeys must have the same length")
	}

	preloadMetrics := &metrics.PreloadMetrics{
		StartTime:    time.Now(),
		ObjectCount:  len(objectIDs),
		LayerMetrics: make(map[string]*metrics.PreloadLayerMetrics),
	}

	log.Printf("Starting optimized preload for %d objects", len(objectIDs))

	objectSizes := make(map[uuid.UUID]int64)
	for i, storageKey := range storageKeys {
		if stat, err := ics.minio.StatObject(ctx, ics.bucketName, storageKey, minio.StatObjectOptions{}); err == nil {
			objectSizes[objectIDs[i]] = stat.Size
			preloadMetrics.TotalSize += stat.Size
		} else {
			log.Printf("Failed to get size for object %s: %v", objectIDs[i], err)
			objectSizes[objectIDs[i]] = 0
		}
	}

	// Group objects by cache strategy
	strategyGroups := ics.groupObjectsByStrategy(objectIDs, storageKeys, objectSizes)

	// Initialize layer metrics
	for strategy := range strategyGroups {
		preloadMetrics.LayerMetrics[strategy] = &metrics.PreloadLayerMetrics{
			LayerName: strategy,
		}
	}

	// Preload each group with optimal concurrency
	var wg sync.WaitGroup
	errChan := make(chan error, len(objectIDs))

	for strategy, objects := range strategyGroups {
		wg.Add(1)
		go func(strategy string, objects []PreloadObject) {
			defer wg.Done()
			layerStart := time.Now()
			ics.preloadStrategyGroupWithMetrics(ctx, strategy, objects, errChan, preloadMetrics.LayerMetrics[strategy])
			preloadMetrics.LayerMetrics[strategy].LatencyMs = float64(time.Since(layerStart).Microseconds()) / 1000.0
		}(strategy, objects)
	}

	wg.Wait()
	close(errChan)

	// Collect errors
	var errors []error
	for err := range errChan {
		errors = append(errors, err)
		preloadMetrics.ErrorCount++
	}

	preloadMetrics.TotalLatencyMs = float64(time.Since(preloadMetrics.StartTime).Microseconds()) / 1000.0
	preloadMetrics.Success = len(errors) == 0

	log.Printf("Optimized preload completed in %.2fms with %d errors", preloadMetrics.TotalLatencyMs, len(errors))

	if len(errors) > 0 {
		return preloadMetrics, fmt.Errorf("preload had %d errors: %v", len(errors), errors[0])
	}

	return preloadMetrics, nil
}

// preloadStrategyGroupWithMetrics preloads with metrics tracking
func (ics *InstrumentedCacheService) preloadStrategyGroupWithMetrics(ctx context.Context, strategy string, objects []PreloadObject, errChan chan<- error, layerMetrics *metrics.PreloadLayerMetrics) {
	if strategy == "SKIP" {
		log.Printf("Skipping preload for %d oversized objects", len(objects))
		layerMetrics.SkippedCount = len(objects)
		return
	}

	maxWorkers := ics.getOptimalWorkerCount(strategy)
	sem := make(chan struct{}, maxWorkers)
	var wg sync.WaitGroup

	log.Printf("Preloading %d objects using %s strategy with %d workers", len(objects), strategy, maxWorkers)

	for _, obj := range objects {
		wg.Add(1)
		go func(object PreloadObject) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			objStart := time.Now()
			if err := ics.strategy.PreloadObject(ctx, object.ID, object.StorageKey, object.Size); err != nil {
				errChan <- fmt.Errorf("failed to preload %s: %w", object.ID, err)
				layerMetrics.FailedCount++
			} else {
				layerMetrics.SuccessCount++
				layerMetrics.TotalSize += object.Size
			}

			// Track individual object latency
			objLatency := float64(time.Since(objStart).Microseconds()) / 1000.0
			if objLatency > layerMetrics.MaxObjectLatencyMs {
				layerMetrics.MaxObjectLatencyMs = objLatency
			}
		}(obj)
	}

	wg.Wait()
}
