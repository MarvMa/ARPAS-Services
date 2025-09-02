// storage-service/internal/services/cache_service.go
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

// CacheService provides high-performance caching with parallel operations
type CacheService struct {
	cache      caches.CacheInterface // Now using the interface
	minio      *minio.Client
	bucketName string
	cacheType  string // Track which implementation is being used

	// Singleflight for deduplicating concurrent loads
	loadGroup *singleflightGroup

	// Preload workers pool
	preloadWorkers int

	// Statistics
	loadLatency atomic.Int64 // cumulative microseconds
	loadCount   atomic.Int64
}

// singleflightGroup prevents duplicate function calls
type singleflightGroup struct {
	mu     sync.Mutex
	groups map[string]*singleflightCall
}

type singleflightCall struct {
	wg   sync.WaitGroup
	data []byte
	err  error
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
	AvgLoadMs    float64 `json:"avgLoadMs"`
	CacheType    string  `json:"cacheType"`
}

// NewCacheService creates a new high-performance cache service with specified cache type
func NewCacheService(minio *minio.Client, bucketName string, maxSizeBytes int64, ttl time.Duration) *CacheService {
	return NewCacheServiceWithType(minio, bucketName, maxSizeBytes, ttl, caches.CacheTypeSharded)
}

// NewCacheServiceWithType creates a cache service with a specific cache implementation
func NewCacheServiceWithType(minio *minio.Client, bucketName string, maxSizeBytes int64, ttl time.Duration, cacheType caches.CacheType) *CacheService {
	numWorkers := 32

	cache := caches.NewCache(cacheType, maxSizeBytes, ttl)

	log.Printf("Initializing cache service with %s implementation (max: %.2f MB, TTL: %v)",
		cacheType, float64(maxSizeBytes)/(1024*1024), ttl)

	return &CacheService{
		cache:          cache,
		minio:          minio,
		bucketName:     bucketName,
		cacheType:      string(cacheType),
		loadGroup:      &singleflightGroup{groups: make(map[string]*singleflightCall)},
		preloadWorkers: numWorkers,
	}
}

// GetFromCacheStream provides streaming from cache with automatic loading on miss
func (cs *CacheService) GetFromCacheStream(objectID uuid.UUID) (io.ReadCloser, int64, error) {
	reader, size, err := cs.cache.GetStream(objectID)
	if err == nil {
		return reader, size, nil
	}

	return nil, 0, err
}

// loadFromStorageDedup loads from storage with deduplication
func (cs *CacheService) loadFromStorageDedup(objectID uuid.UUID) ([]byte, error) {
	key := objectID.String()

	cs.loadGroup.mu.Lock()
	if call, ok := cs.loadGroup.groups[key]; ok {
		cs.loadGroup.mu.Unlock()
		call.wg.Wait()
		return call.data, call.err
	}

	call := &singleflightCall{}
	call.wg.Add(1)
	cs.loadGroup.groups[key] = call
	cs.loadGroup.mu.Unlock()

	start := time.Now()
	call.data, call.err = cs.loadFromStorage(objectID)

	cs.loadLatency.Add(time.Since(start).Microseconds())
	cs.loadCount.Add(1)

	if call.err == nil {
		_ = cs.cache.Store(objectID, call.data)
	}

	call.wg.Done()

	// Cleanup
	cs.loadGroup.mu.Lock()
	delete(cs.loadGroup.groups, key)
	cs.loadGroup.mu.Unlock()

	return call.data, call.err
}

// loadFromStorage loads object data from MinIO
func (cs *CacheService) loadFromStorage(objectID uuid.UUID) ([]byte, error) {
	storageKey := objectID.String() + ".glb"

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	object, err := cs.minio.GetObject(ctx, cs.bucketName, storageKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get object from storage: %w", err)
	}
	defer object.Close()

	stat, err := object.Stat()
	if err != nil {
		return nil, fmt.Errorf("failed to get object stat: %w", err)
	}

	data := make([]byte, stat.Size)
	_, err = io.ReadFull(object, data)
	if err != nil {
		return nil, fmt.Errorf("failed to read object data: %w", err)
	}

	return data, nil
}

// PreloadObjects loads multiple objects into cache in parallel
func (cs *CacheService) PreloadObjects(ctx context.Context, objectIDs []uuid.UUID, storageKeys []string) error {
	if len(objectIDs) != len(storageKeys) {
		return fmt.Errorf("objectIDs and storageKeys must have same length")
	}

	log.Printf("Starting parallel preload for %d objects with %d workers (using %s cache)",
		len(objectIDs), cs.preloadWorkers, cs.cacheType)

	start := time.Now()

	type workItem struct {
		ID  uuid.UUID
		Key string
	}

	work := make(chan workItem, len(objectIDs))

	for i := range objectIDs {
		if exists, _ := cs.cache.Exists(objectIDs[i]); exists {
			continue
		}
		work <- workItem{ID: objectIDs[i], Key: storageKeys[i]}
	}
	close(work)

	var successCount, errorCount atomic.Int32
	var totalBytes atomic.Int64

	var wg sync.WaitGroup
	for i := 0; i < cs.preloadWorkers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()

			for item := range work {
				select {
				case <-ctx.Done():
					return
				default:
				}

				loadCtx, cancel := context.WithTimeout(ctx, 10*time.Second)

				object, err := cs.minio.GetObject(loadCtx, cs.bucketName, item.Key, minio.GetObjectOptions{})
				if err != nil {
					cancel()
					errorCount.Add(1)
					log.Printf("Worker %d: Failed to get object %s: %v", workerID, item.ID, err)
					continue
				}

				stat, err := object.Stat()
				if err != nil {
					object.Close()
					cancel()
					errorCount.Add(1)
					continue
				}

				// Read data
				data := make([]byte, stat.Size)
				_, err = io.ReadFull(object, data)
				object.Close()
				cancel()

				if err != nil {
					errorCount.Add(1)
					continue
				}

				if err := cs.cache.Store(item.ID, data); err != nil {
					errorCount.Add(1)
					log.Printf("Worker %d: Failed to cache object %s: %v", workerID, item.ID, err)
					continue
				}

				successCount.Add(1)
				totalBytes.Add(stat.Size)
			}
		}(i)
	}

	wg.Wait()

	duration := time.Since(start)
	success := int(successCount.Load())
	errors := int(errorCount.Load())
	bytes := totalBytes.Load()

	log.Printf("Preload completed in %v - Cache: %s, Success: %d, Errors: %d, Total: %.2f MB, Rate: %.2f MB/s",
		duration, cs.cacheType, success, errors,
		float64(bytes)/(1024*1024),
		float64(bytes)/(1024*1024)/duration.Seconds())

	if errors > 0 {
		return fmt.Errorf("preload completed with %d errors", errors)
	}

	return nil
}

// InvalidateObject removes an object from cache
func (cs *CacheService) InvalidateObject(objectID uuid.UUID) error {
	return cs.cache.Delete(objectID)
}

// ClearCache clears all cached objects
func (cs *CacheService) ClearCache() error {
	return cs.cache.Clear()
}

// CheckCached checks if an object exists in cache
func (cs *CacheService) CheckCached(objectID uuid.UUID) bool {
	exists, _ := cs.cache.Exists(objectID)
	return exists
}

// GetCacheType returns the active cache implementation type
func (cs *CacheService) GetCacheType() string {
	return cs.cacheType
}

// bytesCloser provides a simple reader for byte slices
type bytesCloser struct {
	data []byte
	pos  int
}

func (b *bytesCloser) Read(p []byte) (n int, err error) {
	if b.pos >= len(b.data) {
		return 0, io.EOF
	}
	n = copy(p, b.data[b.pos:])
	b.pos += n
	return n, nil
}

func (b *bytesCloser) Close() error {
	b.data = nil
	return nil
}
