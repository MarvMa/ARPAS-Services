package services

import (
	"context"
	"fmt"
	"io"
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

	preloadQueue     chan preloadTask
	preloadInFlight  sync.Map
	preloadSemaphore chan struct{}
	activePreloads   atomic.Int32
}

type preloadTask struct {
	ObjectID   uuid.UUID
	StorageKey string
	Priority   int
	Size       int64
}
type PreloadObject struct {
	ID         uuid.UUID
	StorageKey string
	Size       int64
}

func NewCacheService(minio *minio.Client, bucketName string, maxSizeBytes int64, ttl time.Duration) *CacheService {
	cs := &CacheService{
		minio:            minio,
		bucketName:       bucketName,
		preloadQueue:     make(chan preloadTask, 20),
		preloadSemaphore: make(chan struct{}, 1),
	}
	cs.memoryCache = caches.NewMemoryCache(maxSizeBytes, ttl)

	for i := 0; i < 8; i++ {
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
		defer cs.preloadInFlight.Delete(task.ObjectID)

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		stat, err := cs.minio.StatObject(ctx, cs.bucketName, task.StorageKey, minio.StatObjectOptions{})
		if err != nil {
			continue
		}

		cs.memoryCache.Store(task.ObjectID, func() (io.ReadCloser, int64, error) {
			object, err := cs.minio.GetObject(ctx, cs.bucketName, task.StorageKey, minio.GetObjectOptions{})
			if err != nil {
				return nil, 0, err
			}
			return object, stat.Size, nil
		})
	}
}
func (cs *CacheService) PreloadObjects(_ context.Context, objectIDs []uuid.UUID, storageKeys []string) error {
	if len(objectIDs) != len(storageKeys) {
		return fmt.Errorf("objectIDs and storageKeys must have the same length")
	}

	for i, id := range objectIDs {
		cs.QueuePreload(id, storageKeys[i], 0)
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
