package services

import (
	"context"
	"fmt"
	"io"
	"storage-service/internal/services/caches"
	"storage-service/internal/utils"
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
	bufferPool  *utils.BufferPool

	preloadQueue      chan preloadTask
	preloadInFlight   sync.Map
	preloadWorkers    int32
	maxPreloadWorkers int32
}

type preloadTask struct {
	ObjectID   uuid.UUID
	StorageKey string
	Priority   int
}
type PreloadObject struct {
	ID         uuid.UUID
	StorageKey string
	Size       int64
}

func NewCacheService(minio *minio.Client, bucketName string, maxSizeBytes int64, ttl time.Duration) *CacheService {
	cs := &CacheService{
		minio:             minio,
		bucketName:        bucketName,
		preloadQueue:      make(chan preloadTask, 1000),
		maxPreloadWorkers: 5,
		bufferPool:        utils.NewBufferPool(),
	}
	cs.memoryCache = caches.NewMemoryCache(maxSizeBytes, ttl, cs.bufferPool)
	// Start preload workers
	for i := 0; i < 5; i++ {
		go cs.preloadWorker()
	}

	return cs
}

func (cs *CacheService) preloadWorker() {
	for task := range cs.preloadQueue {
		if exists, _ := cs.memoryCache.Exists(task.ObjectID); exists {
			continue
		}

		if _, loading := cs.preloadInFlight.LoadOrStore(task.ObjectID, true); loading {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)

		stat, err := cs.minio.StatObject(ctx, cs.bucketName, task.StorageKey, minio.StatObjectOptions{})
		if err != nil {
			cancel()
			cs.preloadInFlight.Delete(task.ObjectID)
			continue
		}

		err = cs.memoryCache.Store(task.ObjectID, func() (io.ReadCloser, int64, error) {
			object, err := cs.minio.GetObject(ctx, cs.bucketName, task.StorageKey, minio.GetObjectOptions{})
			if err != nil {
				return nil, 0, err
			}
			return object, stat.Size, nil
		})

		cancel()
		cs.preloadInFlight.Delete(task.ObjectID)
	}
}

func (cs *CacheService) PreloadObjects(_ context.Context, objectIDs []uuid.UUID, storageKeys []string) error {
	if len(objectIDs) != len(storageKeys) {
		return fmt.Errorf("objectIDs and storageKeys must have the same length")
	}

	for i, objectID := range objectIDs {
		if exists, _ := cs.memoryCache.Exists(objectID); exists {
			continue
		}

		if _, loading := cs.preloadInFlight.Load(objectID); loading {
			continue
		}

		select {
		case cs.preloadQueue <- preloadTask{ObjectID: objectID, StorageKey: storageKeys[i]}:
		default:
		}
	}

	return nil
}

func (cs *CacheService) QueuePreload(objectID uuid.UUID, storageKey string, priority int) {
	select {
	case cs.preloadQueue <- preloadTask{
		ObjectID:   objectID,
		StorageKey: storageKey,
		Priority:   priority,
	}:
	default:
	}
}

func (cs *CacheService) GetFromCache(objectID uuid.UUID) ([]byte, bool) {
	return cs.memoryCache.GetCache(objectID)
}

// InvalidateObject removes from cache
func (cs *CacheService) InvalidateObject(objectID uuid.UUID) error {
	return cs.memoryCache.Delete(objectID)
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
