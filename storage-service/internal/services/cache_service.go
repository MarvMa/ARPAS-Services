package services

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"storage-service/internal/storage"
	"storage-service/internal/utils"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
)

// CacheStats holds statistics for a cached object
type CacheStats struct {
	Size       int64
	Hits       int64
	LastAccess time.Time
}

// CacheStatistics represents overall cache statistics
type CacheStatistics struct {
	TotalObjects int               `json:"totalObjects"`
	TotalSize    int64             `json:"totalSize"`
	Objects      []ObjectCacheInfo `json:"objects"`
	HitRate      float64           `json:"hitRate"`
	AvgLatency   float64           `json:"avgLatency"`
}

// ObjectCacheInfo represents cache information for a single object
type ObjectCacheInfo struct {
	ID         string    `json:"id"`
	Size       int64     `json:"size"`
	Updated    time.Time `json:"updated"`
	Hits       int64     `json:"hits"`
	LastAccess time.Time `json:"lastAccess"`
}

type CacheService struct {
	redis      *storage.RedisClient
	minio      *minio.Client
	bucketName string
	objectTTL  time.Duration
	stats      sync.Map // map[string]*CacheStats
	metrics    *utils.Metrics

	totalHits   atomic.Int64
	totalMisses atomic.Int64
}

const (
	diskMirrorDir     = "/tmp/cache"
	diskMirrorMinSize = 32 << 20
	rangeChunkBytes   = 16 << 20
)

func NewCacheService(redis *storage.RedisClient, minio *minio.Client, bucketName string, ttl time.Duration) *CacheService {
	m := &CacheService{
		redis:      redis,
		minio:      minio,
		bucketName: bucketName,
		objectTTL:  ttl,
		metrics:    utils.NewMetrics(),
	}

	// Start background metrics collection
	//go m.collectMetrics()

	return m
}

// PreloadObjects preloads multiple objects into the cache
func (m *CacheService) PreloadObjects(ctx context.Context, objectIDs []uuid.UUID, storageKeys []string) error {
	if len(objectIDs) != len(storageKeys) {
		return fmt.Errorf("objectIDs and storageKeys must have the same length")
	}

	log.Printf("Preloading %d objects to Redis cache", len(objectIDs))
	startTime := time.Now()

	// Use goroutines for parallel preloading with a worker pool
	const maxWorkers = 10
	sem := make(chan struct{}, maxWorkers)
	errChan := make(chan error, len(objectIDs))
	var wg sync.WaitGroup

	for i := range objectIDs {
		wg.Add(1)
		go func(id uuid.UUID, storageKey string) {
			defer wg.Done()
			sem <- struct{}{}        // Acquire semaphore
			defer func() { <-sem }() // Release semaphore

			// Check if already cached
			if exists, _ := m.isObjectCached(id); exists {
				log.Printf("Object %s already in cache", id)
				return
			}

			// Download from MinIO
			downloadStart := time.Now()
			data, err := m.downloadFromStorage(ctx, storageKey)
			if err != nil {
				errChan <- fmt.Errorf("failed to download object %s: %w", id, err)
				return
			}
			m.metrics.RecordDownloadLatency(time.Since(downloadStart).Milliseconds())

			// Cache the object
			if err := m.cacheObject(id, data); err != nil {
				errChan <- fmt.Errorf("failed to cache object %s: %w", id, err)
				return
			}
			go m.saveDiskMirror(id, data) // Save to disk mirror asynchronously for large objects

			log.Printf("Object %s cached successfully (%d bytes)", id, len(data))
		}(objectIDs[i], storageKeys[i])
	}

	wg.Wait()
	close(errChan)

	var errs []error
	for err := range errChan {
		errs = append(errs, err)
	}

	duration := time.Since(startTime)
	log.Printf("Preload completed in %v with %d errors", duration, len(errs))

	if len(errs) > 0 {
		return fmt.Errorf("preload had %d errors: %v", len(errs), errs[0])
	}

	return nil
}

// GetObject retrieves an object from cache
func (m *CacheService) GetObject(ctx context.Context, objectID uuid.UUID) ([]byte, error) {
	startTime := time.Now()
	defer func() {
		m.metrics.RecordCacheLatency(time.Since(startTime).Milliseconds())
	}()

	key := fmt.Sprintf("object:%s:data", objectID.String())
	data, err := m.redis.GetBytes(key)
	if err != nil {
		return nil, fmt.Errorf("redis error: %w", err)
	}

	if data == nil {
		m.totalMisses.Add(1)
		m.metrics.IncrementCacheMisses(objectID.String())
		return nil, nil // Cache miss
	}

	// Update statistics
	m.totalHits.Add(1)
	m.metrics.IncrementCacheHits(objectID.String())
	m.updateAccessTime(objectID)

	// Update stats
	if stats, ok := m.stats.Load(objectID.String()); ok {
		cacheStats := stats.(*CacheStats)
		atomic.AddInt64(&cacheStats.Hits, 1)
		cacheStats.LastAccess = time.Now()
	}

	log.Printf("[CACHE HIT] Object %s retrieved from cache (%d bytes)", objectID, len(data))
	return data, nil
}

// GetObjectOrLoad retrieves from cache or loads from storage if not cached
func (m *CacheService) GetObjectOrLoad(ctx context.Context, objectID uuid.UUID, storageKey string) ([]byte, bool, error) {
	// Try cache first
	data, err := m.GetObject(ctx, objectID)
	if err != nil {
		return nil, false, err
	}
	if data != nil {
		return data, true, nil // Cache hit
	}

	// Cache miss - load from storage
	log.Printf("Cache miss for %s, loading from storage", objectID)
	data, err = m.downloadFromStorage(ctx, storageKey)
	if err != nil {
		return nil, false, fmt.Errorf("failed to download from storage: %w", err)
	}

	// Cache for future requests
	go func() {
		if err := m.cacheObject(objectID, data); err != nil {
			log.Printf("Failed to cache object %s: %v", objectID, err)
		}
	}()

	return data, false, nil
}

func (m *CacheService) GetFromCacheStream(objectID uuid.UUID) (io.ReadCloser, int64, error) {
	key := fmt.Sprintf("object:%s:data", objectID.String())

	size, err := m.redis.StrLen(key)
	if err != nil || size <= 0 {
		return nil, 0, fmt.Errorf("not in cache or size unknown: %w", err)
	}

	rc := newRedisChunkReader(m.redis, key, size, rangeChunkBytes)
	return rc, size, nil
}

func diskPath(id uuid.UUID) string {
	return filepath.Join(diskMirrorDir, id.String()+".glb")
}

func ensureMirrorDir() {
	_ = os.MkdirAll(diskMirrorDir, 0o755)
}

func (m *CacheService) saveDiskMirror(id uuid.UUID, data []byte) {
	if int64(len(data)) < diskMirrorMinSize {
		return
	}
	ensureMirrorDir()
	path := diskPath(id)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		log.Printf("disk-mirror: write failed for %s: %v", id, err)
	} else {
		log.Printf("disk-mirror: wrote %s (%d bytes)", path, len(data))
	}
}

// InvalidateObject removes an object from cache
func (m *CacheService) InvalidateObject(objectID uuid.UUID) error {
	keys := []string{
		fmt.Sprintf("object:%s:data", objectID.String()),
		fmt.Sprintf("object:%s:size", objectID.String()),
		fmt.Sprintf("object:%s:updated", objectID.String()),
	}

	err := m.redis.Delete(keys...)
	if err != nil {
		return fmt.Errorf("failed to invalidate cache: %w", err)
	}

	m.stats.Delete(objectID.String())
	log.Printf("Invalidated cache for object %s", objectID)
	return nil
}

// GetStatistics returns cache statistics
func (m *CacheService) GetStatistics() (*CacheStatistics, error) {
	pattern := "object:*:data"
	keys, err := m.redis.Keys(pattern)
	if err != nil {
		return nil, err
	}

	stats := &CacheStatistics{
		TotalObjects: len(keys),
		Objects:      make([]ObjectCacheInfo, 0, len(keys)),
	}

	for _, key := range keys {
		// Extract UUID from key
		var id string
		fmt.Sscanf(key, "object:%s:data", &id)

		sizeStr, _ := m.redis.Get(fmt.Sprintf("object:%s:size", id))
		updatedStr, _ := m.redis.Get(fmt.Sprintf("object:%s:updated", id))

		var size int64
		var updated time.Time

		if sizeStr != "" {
			fmt.Sscanf(sizeStr, "%d", &size)
			stats.TotalSize += size
		}

		if updatedStr != "" {
			var updatedUnix int64
			fmt.Sscanf(updatedStr, "%d", &updatedUnix)
			updated = time.Unix(0, updatedUnix*int64(time.Millisecond))
		}

		objInfo := ObjectCacheInfo{
			ID:      id,
			Size:    size,
			Updated: updated,
		}

		// Get stats from memory
		if s, ok := m.stats.Load(id); ok {
			cacheStats := s.(*CacheStats)
			objInfo.Hits = atomic.LoadInt64(&cacheStats.Hits)
			objInfo.LastAccess = cacheStats.LastAccess
		}

		stats.Objects = append(stats.Objects, objInfo)
	}

	// Calculate hit rate
	totalHits := m.totalHits.Load()
	totalMisses := m.totalMisses.Load()
	total := totalHits + totalMisses
	if total > 0 {
		stats.HitRate = float64(totalHits) / float64(total) * 100
	}

	return stats, nil
}

// Private helper methods

func (m *CacheService) isObjectCached(objectID uuid.UUID) (bool, error) {
	key := fmt.Sprintf("object:%s:data", objectID.String())
	exists, err := m.redis.Exists(key)
	return exists > 0, err
}

func (m *CacheService) downloadFromStorage(ctx context.Context, storageKey string) ([]byte, error) {
	object, err := m.minio.GetObject(ctx, m.bucketName, storageKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer object.Close()

	// Read the object data
	var data []byte
	buf := make([]byte, 1024*1024) // 1MB buffer
	for {
		n, err := object.Read(buf)
		if n > 0 {
			data = append(data, buf[:n]...)
		}
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			return nil, err
		}
	}

	return data, nil
}

func (m *CacheService) cacheObject(objectID uuid.UUID, data []byte) error {
	now := time.Now()

	// Use pipeline for atomic operations
	pipe := m.redis.Pipeline()
	ctx := context.Background()

	// Cache the data
	dataKey := fmt.Sprintf("object:%s:data", objectID.String())
	pipe.Set(ctx, dataKey, data, m.objectTTL)

	// Cache metadata
	sizeKey := fmt.Sprintf("object:%s:size", objectID.String())
	pipe.Set(ctx, sizeKey, fmt.Sprintf("%d", len(data)), m.objectTTL)

	updatedKey := fmt.Sprintf("object:%s:updated", objectID.String())
	pipe.Set(ctx, updatedKey, fmt.Sprintf("%d", now.UnixMilli()), m.objectTTL)

	// Update access time
	pipe.ZAdd(ctx, "object:access", &redis.Z{
		Score:  float64(now.Unix()),
		Member: objectID.String(),
	})

	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to cache object: %w", err)
	}

	// Update in-memory stats
	m.stats.Store(objectID.String(), &CacheStats{
		Size:       int64(len(data)),
		Hits:       0,
		LastAccess: now,
	})

	m.metrics.UpdateCacheSize(int64(len(data)))
	return nil
}

func (m *CacheService) updateAccessTime(objectID uuid.UUID) {
	m.redis.ZAdd("object:access", &redis.Z{
		Score:  float64(time.Now().Unix()),
		Member: objectID.String(),
	})
}

func (m *CacheService) collectMetrics() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		stats, err := m.GetStatistics()
		if err != nil {
			log.Printf("Error collecting metrics: %v", err)
			continue
		}

		m.metrics.SetCacheSize(stats.TotalSize)
		m.metrics.SetCacheObjectCount(int64(stats.TotalObjects))
	}
}

// ClearCache removes all cached objects
func (m *CacheService) ClearCache() error {
	keys, err := m.redis.Keys("object:*")
	if err != nil {
		return err
	}

	if len(keys) > 0 {
		err = m.redis.Delete(keys...)
		if err != nil {
			return err
		}
	}

	// Clear in-memory stats
	m.stats.Range(func(key, value interface{}) bool {
		m.stats.Delete(key)
		return true
	})

	m.totalHits.Store(0)
	m.totalMisses.Store(0)

	log.Printf("Cleared cache (%d keys removed)", len(keys))
	return nil
}
