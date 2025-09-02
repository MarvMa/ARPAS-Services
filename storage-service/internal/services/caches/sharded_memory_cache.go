package caches

import (
	"bytes"
	"fmt"
	"hash/fnv"
	"io"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

const (
	numShards         = 256
	evictionBatchSize = 10
)

// ShardedMemoryCache provides a high-performance cache with lock sharding
type ShardedMemoryCache struct {
	shards [numShards]*cacheShard

	totalSize atomic.Int64
	maxSize   int64
	ttl       time.Duration
	hits      atomic.Int64
	misses    atomic.Int64

	// Singleflight for deduplication
	sf *singleflight

	// Background cleanup
	stopCleanup chan struct{}
	cleanupDone sync.WaitGroup
}

// cacheShard represents a single cache shard
type cacheShard struct {
	mu   sync.RWMutex
	data map[string]*cacheItem
	lru  *lruList
	size int64
}

// cacheItem holds the cached data and metadata
type cacheItem struct {
	data        []byte
	size        int64
	lastAccess  time.Time
	createdAt   time.Time
	accessCount atomic.Int64
	lruNode     *lruNode
}

// lruNode for the LRU list
type lruNode struct {
	key  string
	prev *lruNode
	next *lruNode
}

// lruList maintains the LRU order
type lruList struct {
	head *lruNode
	tail *lruNode
}

// NewShardedMemoryCache creates a new sharded memory cache
func NewShardedMemoryCache(maxSizeBytes int64, ttl time.Duration) *ShardedMemoryCache {
	c := &ShardedMemoryCache{
		maxSize:     maxSizeBytes,
		ttl:         ttl,
		sf:          newSingleflight(),
		stopCleanup: make(chan struct{}),
	}

	// Initialize shards
	for i := 0; i < numShards; i++ {
		c.shards[i] = &cacheShard{
			data: make(map[string]*cacheItem),
			lru:  &lruList{},
		}
	}

	// Start background cleanup
	c.cleanupDone.Add(1)
	go c.cleanupRoutine()

	return c
}

// getShard returns the shard for a given key
func (c *ShardedMemoryCache) getShard(key string) *cacheShard {
	h := fnv.New32a()
	h.Write([]byte(key))
	return c.shards[h.Sum32()%numShards]
}

// Store adds an object to the cache
func (c *ShardedMemoryCache) Store(objectID uuid.UUID, data []byte) error {
	key := objectID.String()
	size := int64(len(data))

	// Check if we need to make space
	if c.totalSize.Load()+size > c.maxSize {
		if !c.makeSpace(size) {
			return fmt.Errorf("insufficient cache space for %d bytes", size)
		}
	}

	shard := c.getShard(key)

	// Create the cache item
	item := &cacheItem{
		data:       data,
		size:       size,
		lastAccess: time.Now(),
		createdAt:  time.Now(),
	}

	shard.mu.Lock()
	defer shard.mu.Unlock()

	// Check if already exists
	if existing, exists := shard.data[key]; exists {
		c.totalSize.Add(-existing.size)
		shard.size -= existing.size
		shard.lru.remove(existing.lruNode)
	}

	// Add to shard
	shard.data[key] = item
	item.lruNode = shard.lru.pushFront(key)
	shard.size += size
	c.totalSize.Add(size)

	return nil
}

// GetStream returns a reader for the cached object
func (c *ShardedMemoryCache) GetStream(objectID uuid.UUID) (io.ReadCloser, int64, error) {
	key := objectID.String()
	shard := c.getShard(key)

	// Use RLock for reading
	shard.mu.RLock()
	item, exists := shard.data[key]
	if !exists {
		shard.mu.RUnlock()
		c.misses.Add(1)
		return nil, 0, fmt.Errorf("object not found in cache")
	}

	// Create a copy of the data reference (not the data itself)
	data := item.data
	size := item.size
	shard.mu.RUnlock()

	// Update access stats asynchronously
	go func() {
		item.accessCount.Add(1)
		now := time.Now()
		shard.mu.Lock()
		item.lastAccess = now
		shard.lru.moveToFront(item.lruNode)
		shard.mu.Unlock()
	}()

	c.hits.Add(1)

	// Return a reader that operates on the data slice
	return &bytesReader{
		Reader: bytes.NewReader(data),
	}, size, nil
}

// bytesReader wraps bytes.Reader with Close method
type bytesReader struct {
	*bytes.Reader
}

func (r *bytesReader) Close() error {
	return nil
}

// Exists checks if an object is in the cache
func (c *ShardedMemoryCache) Exists(objectID uuid.UUID) (bool, error) {
	key := objectID.String()
	shard := c.getShard(key)

	shard.mu.RLock()
	_, exists := shard.data[key]
	shard.mu.RUnlock()

	return exists, nil
}

// Delete removes an object from the cache
func (c *ShardedMemoryCache) Delete(objectID uuid.UUID) error {
	key := objectID.String()
	shard := c.getShard(key)

	shard.mu.Lock()
	defer shard.mu.Unlock()

	item, exists := shard.data[key]
	if !exists {
		return nil
	}

	delete(shard.data, key)
	shard.lru.remove(item.lruNode)
	shard.size -= item.size
	c.totalSize.Add(-item.size)

	return nil
}

// Clear removes all objects from the cache
func (c *ShardedMemoryCache) Clear() error {
	// Clear each shard
	for i := 0; i < numShards; i++ {
		shard := c.shards[i]
		shard.mu.Lock()
		shard.data = make(map[string]*cacheItem)
		shard.lru = &lruList{}
		shard.size = 0
		shard.mu.Unlock()
	}

	c.totalSize.Store(0)
	c.hits.Store(0)
	c.misses.Store(0)

	log.Printf("Cache cleared")
	return nil
}

// MaxSize returns the maximum cache size
func (c *ShardedMemoryCache) MaxSize() int64 {
	return c.maxSize
}

// CurrentSize returns the current cache size
func (c *ShardedMemoryCache) CurrentSize() int64 {
	return c.totalSize.Load()
}

// makeSpace tries to free up space for new data
func (c *ShardedMemoryCache) makeSpace(needed int64) bool {
	target := c.maxSize - needed

	var wg sync.WaitGroup
	evicted := atomic.Int64{}

	for i := 0; i < numShards && c.totalSize.Load() > target; i++ {
		wg.Add(1)
		go func(shardIdx int) {
			defer wg.Done()
			shard := c.shards[shardIdx]
			c.evictFromShard(shard, &evicted, target)
		}(i)
	}

	wg.Wait()
	return c.totalSize.Load() <= target
}

// evictFromShard evicts LRU items from a single shard
func (c *ShardedMemoryCache) evictFromShard(shard *cacheShard, evicted *atomic.Int64, target int64) {
	shard.mu.Lock()
	defer shard.mu.Unlock()

	for i := 0; i < evictionBatchSize && c.totalSize.Load() > target; i++ {
		if shard.lru.tail == nil {
			break
		}

		key := shard.lru.tail.key
		item := shard.data[key]
		if item == nil {
			continue
		}

		delete(shard.data, key)
		shard.lru.remove(item.lruNode)
		shard.size -= item.size
		c.totalSize.Add(-item.size)
		evicted.Add(1)
	}
}

// cleanupRoutine periodically removes expired items
func (c *ShardedMemoryCache) cleanupRoutine() {
	defer c.cleanupDone.Done()

	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-c.stopCleanup:
			return
		case <-ticker.C:
			c.cleanupExpired()
		}
	}
}

// cleanupExpired removes expired items from all shards
func (c *ShardedMemoryCache) cleanupExpired() {
	if c.ttl <= 0 {
		return
	}

	now := time.Now()
	expired := 0

	for i := 0; i < numShards; i++ {
		shard := c.shards[i]
		shard.mu.Lock()

		var toDelete []string
		for key, item := range shard.data {
			if now.Sub(item.createdAt) > c.ttl {
				toDelete = append(toDelete, key)
			}
		}

		for _, key := range toDelete {
			item := shard.data[key]
			delete(shard.data, key)
			shard.lru.remove(item.lruNode)
			shard.size -= item.size
			c.totalSize.Add(-item.size)
			expired++
		}

		shard.mu.Unlock()
	}

	if expired > 0 {
		log.Printf("Cleaned up %d expired items", expired)
	}
}

// Close stops the cleanup routine
func (c *ShardedMemoryCache) Close() error {
	close(c.stopCleanup)
	c.cleanupDone.Wait()
	return nil
}

// LRU list operations
func (l *lruList) pushFront(key string) *lruNode {
	node := &lruNode{key: key}

	if l.head == nil {
		l.head = node
		l.tail = node
	} else {
		node.next = l.head
		l.head.prev = node
		l.head = node
	}

	return node
}

func (l *lruList) moveToFront(node *lruNode) {
	if node == l.head {
		return
	}

	l.remove(node)

	node.prev = nil
	node.next = l.head
	if l.head != nil {
		l.head.prev = node
	}
	l.head = node

	if l.tail == nil {
		l.tail = node
	}
}

func (l *lruList) remove(node *lruNode) {
	if node == nil {
		return
	}

	if node.prev != nil {
		node.prev.next = node.next
	} else {
		l.head = node.next
	}

	if node.next != nil {
		node.next.prev = node.prev
	} else {
		l.tail = node.prev
	}

	node.prev = nil
	node.next = nil
}

// singleflight provides request deduplication
type singleflight struct {
	mu    sync.Mutex
	calls map[string]*call
}

type call struct {
	wg  sync.WaitGroup
	val interface{}
	err error
}

func newSingleflight() *singleflight {
	return &singleflight{
		calls: make(map[string]*call),
	}
}

func (sf *singleflight) Do(key string, fn func() (interface{}, error)) (interface{}, error) {
	sf.mu.Lock()
	if c, ok := sf.calls[key]; ok {
		sf.mu.Unlock()
		c.wg.Wait()
		return c.val, c.err
	}

	c := &call{}
	c.wg.Add(1)
	sf.calls[key] = c
	sf.mu.Unlock()

	c.val, c.err = fn()
	c.wg.Done()

	sf.mu.Lock()
	delete(sf.calls, key)
	sf.mu.Unlock()

	return c.val, c.err
}
