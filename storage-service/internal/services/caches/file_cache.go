package caches

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"storage-service/internal/services/cache"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

type FileSystemCache struct {
	basePath    string
	maxSize     int64
	currentSize int64
	ttl         time.Duration
	mu          sync.RWMutex

	// Statistics
	hits   atomic.Int64
	misses atomic.Int64
}

func NewFileSystemCache(basePath string, maxSizeBytes int64, ttl time.Duration) *FileSystemCache {
	// Ensure directory exists
	os.MkdirAll(basePath, 0755)

	fsc := &FileSystemCache{
		basePath: basePath,
		maxSize:  maxSizeBytes,
		ttl:      ttl,
	}

	// Calculate current size
	fsc.calculateCurrentSize()

	// Start cleanup goroutine
	go fsc.cleanupExpired()

	return fsc
}

func (fsc *FileSystemCache) Name() string {
	return "FILESYSTEM"
}

func (fsc *FileSystemCache) Store(objectID uuid.UUID, data []byte) error {
	fsc.mu.Lock()
	defer fsc.mu.Unlock()

	size := int64(len(data))

	// Make space if needed
	for atomic.LoadInt64(&fsc.currentSize)+size > fsc.maxSize {
		if !fsc.evictOldestFile() {
			return fmt.Errorf("unable to free space for file of size %d", size)
		}
	}

	filePath := fsc.getFilePath(objectID)

	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return fmt.Errorf("failed to write cache file: %w", err)
	}

	atomic.AddInt64(&fsc.currentSize, size)
	log.Printf("File cache: stored object %s (%d bytes) at %s", objectID, size, filePath)

	return nil
}

func (fsc *FileSystemCache) Get(objectID uuid.UUID) ([]byte, error) {
	filePath := fsc.getFilePath(objectID)

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		fsc.misses.Add(1)
		return nil, fmt.Errorf("object not found in file cache")
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		fsc.misses.Add(1)
		return nil, fmt.Errorf("failed to read cache file: %w", err)
	}

	// Update access time
	os.Chtimes(filePath, time.Now(), time.Now())

	fsc.hits.Add(1)
	return data, nil
}

func (fsc *FileSystemCache) GetStream(objectID uuid.UUID) (io.ReadCloser, int64, error) {
	filePath := fsc.getFilePath(objectID)

	stat, err := os.Stat(filePath)
	if err != nil {
		fsc.misses.Add(1)
		return nil, 0, fmt.Errorf("object not found in file cache")
	}

	file, err := os.Open(filePath)
	if err != nil {
		fsc.misses.Add(1)
		return nil, 0, fmt.Errorf("failed to open cache file: %w", err)
	}

	// Update access time
	os.Chtimes(filePath, time.Now(), time.Now())

	fsc.hits.Add(1)
	return file, stat.Size(), nil
}

func (fsc *FileSystemCache) Exists(objectID uuid.UUID) (bool, error) {
	filePath := fsc.getFilePath(objectID)
	_, err := os.Stat(filePath)
	return !os.IsNotExist(err), nil
}

func (fsc *FileSystemCache) Delete(objectID uuid.UUID) error {
	filePath := fsc.getFilePath(objectID)

	if stat, err := os.Stat(filePath); err == nil {
		size := stat.Size()
		if err := os.Remove(filePath); err == nil {
			atomic.AddInt64(&fsc.currentSize, -size)
			log.Printf("File cache: deleted object %s (%d bytes)", objectID, size)
		}
	}

	return nil
}

func (fsc *FileSystemCache) Clear() error {
	fsc.mu.Lock()
	defer fsc.mu.Unlock()

	err := os.RemoveAll(fsc.basePath)
	if err == nil {
		os.MkdirAll(fsc.basePath, 0755)
		atomic.StoreInt64(&fsc.currentSize, 0)
		fsc.hits.Store(0)
		fsc.misses.Store(0)
		log.Printf("File cache: cleared all objects")
	}

	return err
}

func (fsc *FileSystemCache) GetStats() cache.LayerStats {
	hits := fsc.hits.Load()
	misses := fsc.misses.Load()
	total := hits + misses

	var hitRate float64
	if total > 0 {
		hitRate = float64(hits) / float64(total) * 100
	}

	objectCount := fsc.countFiles()

	return cache.LayerStats{
		Name:         "FileSystem",
		Objects:      objectCount,
		SizeBytes:    atomic.LoadInt64(&fsc.currentSize),
		Hits:         hits,
		Misses:       misses,
		HitRate:      hitRate,
		AvgLatencyMs: 5, // File system access
	}
}

func (fsc *FileSystemCache) getFilePath(objectID uuid.UUID) string {
	return filepath.Join(fsc.basePath, objectID.String()+".glb")
}

func (fsc *FileSystemCache) calculateCurrentSize() {
	var totalSize int64
	filepath.Walk(fsc.basePath, func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			totalSize += info.Size()
		}
		return nil
	})
	atomic.StoreInt64(&fsc.currentSize, totalSize)
}

func (fsc *FileSystemCache) countFiles() int {
	count := 0
	filepath.Walk(fsc.basePath, func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() && filepath.Ext(path) == ".glb" {
			count++
		}
		return nil
	})
	return count
}

func (fsc *FileSystemCache) evictOldestFile() bool {
	var oldestPath string
	var oldestTime time.Time

	filepath.Walk(fsc.basePath, func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() && filepath.Ext(path) == ".glb" {
			if oldestPath == "" || info.ModTime().Before(oldestTime) {
				oldestPath = path
				oldestTime = info.ModTime()
			}
		}
		return nil
	})

	if oldestPath != "" {
		if stat, err := os.Stat(oldestPath); err == nil {
			size := stat.Size()
			if os.Remove(oldestPath) == nil {
				atomic.AddInt64(&fsc.currentSize, -size)
				return true
			}
		}
	}

	return false
}

func (fsc *FileSystemCache) cleanupExpired() {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		var expiredFiles []string

		filepath.Walk(fsc.basePath, func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() && filepath.Ext(path) == ".glb" {
				if now.Sub(info.ModTime()) > fsc.ttl {
					expiredFiles = append(expiredFiles, path)
				}
			}
			return nil
		})

		for _, file := range expiredFiles {
			if stat, err := os.Stat(file); err == nil {
				size := stat.Size()
				if os.Remove(file) == nil {
					atomic.AddInt64(&fsc.currentSize, -size)
				}
			}
		}

		if len(expiredFiles) > 0 {
			log.Printf("File cache: cleaned up %d expired files", len(expiredFiles))
		}
	}
}
