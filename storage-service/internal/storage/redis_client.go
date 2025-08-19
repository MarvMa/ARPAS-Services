package storage

import (
	"context"
	"fmt"
	"time"

	"github.com/go-redis/redis/v8"
)

// RedisClient wraps the Redis client with application-specific methods
type RedisClient struct {
	client *redis.Client
	ctx    context.Context
}

// NewRedisClient creates a new Redis client
func NewRedisClient(host string, port string) (*RedisClient, error) {
	client := redis.NewClient(&redis.Options{
		Addr:         fmt.Sprintf("%s:%s", host, port),
		PoolSize:     200,
		MinIdleConns: 20,
		DialTimeout:  10 * time.Second,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		MaxRetries:   3,
	})

	ctx := context.Background()

	// Test connection
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}

	return &RedisClient{
		client: client,
		ctx:    ctx,
	}, nil
}

// Get retrieves a string value from Redis
func (r *RedisClient) Get(key string) (string, error) {
	val, err := r.client.Get(r.ctx, key).Result()
	if err == redis.Nil {
		return "", nil
	}
	return val, err
}

func (r *RedisClient) StrLen(key string) (int64, error) { return r.client.StrLen(r.ctx, key).Result() }

func (r *RedisClient) GetRange(key string, start, end int64) ([]byte, error) {
	return r.client.GetRange(r.ctx, key, start, end).Bytes()
}

// Set stores a string value in Redis
func (r *RedisClient) Set(key string, value string, expiration time.Duration) error {
	return r.client.Set(r.ctx, key, value, expiration).Err()
}

// GetBytes retrieves binary data from Redis
func (r *RedisClient) GetBytes(key string) ([]byte, error) {
	val, err := r.client.Get(r.ctx, key).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	return val, err
}

// SetBytes stores binary data in Redis
func (r *RedisClient) SetBytes(key string, value []byte, expiration time.Duration) error {
	return r.client.Set(r.ctx, key, value, expiration).Err()
}

// Exists checks if a key exists in Redis
func (r *RedisClient) Exists(keys ...string) (int64, error) {
	return r.client.Exists(r.ctx, keys...).Result()
}

// Expire sets expiration time for a key
func (r *RedisClient) Expire(key string, expiration time.Duration) error {
	return r.client.Expire(r.ctx, key, expiration).Err()
}

// ZAdd adds a member with score to a sorted set
func (r *RedisClient) ZAdd(key string, members ...*redis.Z) error {
	return r.client.ZAdd(r.ctx, key, members...).Err()
}

// Keys returns all keys matching the pattern
func (r *RedisClient) Keys(pattern string) ([]string, error) {
	return r.client.Keys(r.ctx, pattern).Result()
}

// Delete removes keys from Redis
func (r *RedisClient) Delete(keys ...string) error {
	return r.client.Del(r.ctx, keys...).Err()
}

// Close closes the Redis connection
func (r *RedisClient) Close() error {
	return r.client.Close()
}

// Pipeline creates a new pipeline for batch operations
func (r *RedisClient) Pipeline() redis.Pipeliner {
	return r.client.Pipeline()
}

// Watch watches keys for changes (used for transactions)
func (r *RedisClient) Watch(fn func(*redis.Tx) error, keys ...string) error {
	return r.client.Watch(r.ctx, fn, keys...)
}

// FlushDB flushes the current database
func (r *RedisClient) FlushDB() error {
	return r.client.FlushDB(r.ctx).Err()
}

// DBSize returns the number of keys in the database
func (r *RedisClient) DBSize() (int64, error) {
	return r.client.DBSize(r.ctx).Result()
}
