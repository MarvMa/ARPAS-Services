package services

import (
	"context"
	"fmt"
	"io"
	"log"
	"storage-service/internal/services/cache"
	"storage-service/internal/services/caches"
	"storage-service/internal/storage"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
)

const (
	SmallFileThreshold  = 8 << 20   // 8MB - In-Memory Cache
	MediumFileThreshold = 32 << 20  // 32MB - File System Cache
	LargeFileThreshold  = 100 << 20 // 100MB - Redis Cache
)

// CacheStrategy determines the optimal caching approach based on file size and access patterns
type CacheStrategy struct {
	memoryCache *caches.MemoryCache
	fileCache   *caches.FileSystemCache
	redisCache  *caches.RedisCache
	minio       *minio.Client
	bucketName  string
}
type MultiLayerCacheStats struct {
	Memory     cache.LayerStats `json:"memory"`
	FileSystem cache.LayerStats `json:"fileSystem"`
	Redis      cache.LayerStats `json:"redis"`
	Strategy   StrategyStats    `json:"strategy"`
}

type StrategyStats struct {
	SmallFileThreshold  int64 `json:"smallFileThreshold"`
	MediumFileThreshold int64 `json:"mediumFileThreshold"`
	LargeFileThreshold  int64 `json:"largeFileThreshold"`
}

func NewCacheStrategy(redis *storage.RedisClient, minio *minio.Client, bucketName string, ttl time.Duration) *CacheStrategy {
	return &CacheStrategy{
		memoryCache: caches.NewMemoryCache(1<<30, ttl),                           // 1GB memory limit
		fileCache:   caches.NewFileSystemCache("/tmp/storage-cache", 5<<30, ttl), // 5GB disk limit
		redisCache:  caches.NewRedisCache(redis, ttl),
		minio:       minio,
		bucketName:  bucketName,
	}
}

// GetOptimalCache determines which cache layer to use based on object size
func (cs *CacheStrategy) GetOptimalCache(size int64) cache.CacheLayer {
	switch {
	case size <= SmallFileThreshold:
		log.Printf("Cache strategy: MEMORY for size %d bytes", size)
		return cs.memoryCache
	case size <= MediumFileThreshold:
		log.Printf("Cache strategy: FILESYSTEM for size %d bytes", size)
		return cs.fileCache
	case size <= LargeFileThreshold:
		log.Printf("Cache strategy: REDIS for size %d bytes", size)
		return cs.redisCache
	default:
		log.Printf("Cache strategy: DIRECT MINIO for size %d bytes (too large)", size)
		return nil // Direct MinIO access
	}
}

// PreloadObject intelligently caches object in appropriate layer
func (cs *CacheStrategy) PreloadObject(ctx context.Context, objectID uuid.UUID, storageKey string, size int64) error {
	cacheStrategy := cs.GetOptimalCache(size)
	if cacheStrategy == nil {
		return fmt.Errorf("object too large for caching: %d bytes", size)
	}

	// Check if already cached
	if exists, _ := cacheStrategy.Exists(objectID); exists {
		log.Printf("Object %s already cached in %s layer", objectID, cacheStrategy.Name())
		return nil
	}

	// Download from MinIO
	startTime := time.Now()
	data, err := cs.downloadFromMinio(ctx, storageKey)
	if err != nil {
		return fmt.Errorf("failed to download from MinIO: %w", err)
	}
	downloadLatency := time.Since(startTime)

	// Cache in appropriate layer
	cacheStart := time.Now()
	if err := cacheStrategy.Store(objectID, data); err != nil {
		return fmt.Errorf("failed to store in %s cache: %w", cacheStrategy.Name(), err)
	}
	cacheLatency := time.Since(cacheStart)

	log.Printf("Object %s preloaded to %s: download=%v, cache=%v, size=%d",
		objectID, cacheStrategy.Name(), downloadLatency, cacheLatency, len(data))

	return nil
}

// GetObject retrieves full object data
func (cs *CacheStrategy) GetObject(ctx context.Context, objectID uuid.UUID, storageKey string, size int64) ([]byte, bool, error) {
	cacheStrategy := cs.GetOptimalCache(size)
	if cacheStrategy == nil {
		// For very large files, don't load into memory
		return nil, false, fmt.Errorf("object too large for memory retrieval: %d bytes", size)
	}

	// Try cache first
	if exists, _ := cacheStrategy.Exists(objectID); exists {
		data, err := cacheStrategy.Get(objectID)
		if err == nil && data != nil {
			log.Printf("Cache HIT for %s in %s layer", objectID, cacheStrategy.Name())
			return data, true, nil
		}
	}

	// Cache miss - load from MinIO and cache
	log.Printf("Cache MISS for %s in %s layer", objectID, cacheStrategy.Name())
	data, err := cs.downloadFromMinio(ctx, storageKey)
	if err != nil {
		return nil, false, err
	}

	// Asynchronously cache for future requests
	go func() {
		if err := cacheStrategy.Store(objectID, data); err != nil {
			log.Printf("Failed to cache object %s: %v", objectID, err)
		}
	}()

	return data, false, nil
}

// InvalidateObject removes from all cache layers
func (cs *CacheStrategy) InvalidateObject(objectID uuid.UUID) error {
	var errs []error

	if err := cs.memoryCache.Delete(objectID); err != nil {
		errs = append(errs, fmt.Errorf("memory cache: %w", err))
	}
	if err := cs.fileCache.Delete(objectID); err != nil {
		errs = append(errs, fmt.Errorf("file cache: %w", err))
	}
	if err := cs.redisCache.Delete(objectID); err != nil {
		errs = append(errs, fmt.Errorf("redis cache: %w", err))
	}

	if len(errs) > 0 {
		return fmt.Errorf("invalidation errors: %v", errs)
	}
	return nil
}

// GetStatistics returns comprehensive cache statistics
func (cs *CacheStrategy) GetStatistics() (*MultiLayerCacheStats, error) {
	memStats := cs.memoryCache.GetStats()
	fileStats := cs.fileCache.GetStats()
	redisStats := cs.redisCache.GetStats()

	return &MultiLayerCacheStats{
		Memory:     memStats,
		FileSystem: fileStats,
		Redis:      redisStats,
		Strategy: StrategyStats{
			SmallFileThreshold:  SmallFileThreshold,
			MediumFileThreshold: MediumFileThreshold,
			LargeFileThreshold:  LargeFileThreshold,
		},
	}, nil
}

// ClearAll clears all cache layers
func (cs *CacheStrategy) ClearAll() error {
	var errs []error

	if err := cs.memoryCache.Clear(); err != nil {
		errs = append(errs, err)
	}
	if err := cs.fileCache.Clear(); err != nil {
		errs = append(errs, err)
	}
	if err := cs.redisCache.Clear(); err != nil {
		errs = append(errs, err)
	}

	if len(errs) > 0 {
		return fmt.Errorf("clear errors: %v", errs)
	}
	return nil
}

func (cs *CacheStrategy) downloadFromMinio(ctx context.Context, storageKey string) ([]byte, error) {
	object, err := cs.minio.GetObject(ctx, cs.bucketName, storageKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer object.Close()

	return io.ReadAll(object)
}
