package caches

import (
	"fmt"
	"io"
	"log"
	"storage-service/internal/services/cache"
	"storage-service/internal/storage"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

type RedisCache struct {
	client *storage.RedisClient
	ttl    time.Duration

	// Statistics
	hits   atomic.Int64
	misses atomic.Int64
}

func NewRedisCache(client *storage.RedisClient, ttl time.Duration) *RedisCache {
	return &RedisCache{
		client: client,
		ttl:    ttl,
	}
}

func (rc *RedisCache) Name() string {
	return "REDIS"
}

func (rc *RedisCache) Store(objectID uuid.UUID, data []byte) error {
	key := fmt.Sprintf("obj:%s", objectID.String())

	if err := rc.client.SetBytes(key, data, rc.ttl); err != nil {
		return fmt.Errorf("failed to store in Redis: %w", err)
	}

	log.Printf("Redis cache: stored object %s (%d bytes)", objectID, len(data))
	return nil
}

func (rc *RedisCache) Get(objectID uuid.UUID) ([]byte, error) {
	key := fmt.Sprintf("obj:%s", objectID.String())

	data, err := rc.client.GetBytes(key)
	if err != nil {
		rc.misses.Add(1)
		return nil, fmt.Errorf("redis error: %w", err)
	}

	if data == nil {
		rc.misses.Add(1)
		return nil, fmt.Errorf("object not found in Redis cache")
	}

	rc.hits.Add(1)
	return data, nil
}

func (rc *RedisCache) GetStream(objectID uuid.UUID) (io.ReadCloser, int64, error) {
	key := fmt.Sprintf("obj:%s", objectID.String())

	size, err := rc.client.StrLen(key)
	if err != nil || size <= 0 {
		rc.misses.Add(1)
		return nil, 0, fmt.Errorf("object not found in Redis cache")
	}

	// Use optimized chunk reader
	reader := newRedisChunkReader(rc.client, key, size, 4<<20) // 4MB chunks
	rc.hits.Add(1)

	return reader, size, nil
}

func (rc *RedisCache) Exists(objectID uuid.UUID) (bool, error) {
	key := fmt.Sprintf("obj:%s", objectID.String())
	exists, err := rc.client.Exists(key)
	return exists > 0, err
}

func (rc *RedisCache) Delete(objectID uuid.UUID) error {
	key := fmt.Sprintf("obj:%s", objectID.String())
	return rc.client.Delete(key)
}

func (rc *RedisCache) Clear() error {
	keys, err := rc.client.Keys("obj:*")
	if err != nil {
		return err
	}

	if len(keys) > 0 {
		err = rc.client.Delete(keys...)
		if err != nil {
			return err
		}
	}

	rc.hits.Store(0)
	rc.misses.Store(0)

	log.Printf("Redis cache: cleared %d objects", len(keys))
	return nil
}

func (rc *RedisCache) GetStats() cache.LayerStats {
	hits := rc.hits.Load()
	misses := rc.misses.Load()
	total := hits + misses

	var hitRate float64
	if total > 0 {
		hitRate = float64(hits) / float64(total) * 100
	}

	// Count objects (simplified)
	keys, _ := rc.client.Keys("obj:*")
	objectCount := len(keys)

	return cache.LayerStats{
		Name:         "Redis",
		Objects:      objectCount,
		SizeBytes:    0, // Would need to calculate
		Hits:         hits,
		Misses:       misses,
		HitRate:      hitRate,
		AvgLatencyMs: 15, // Network latency
	}
}
