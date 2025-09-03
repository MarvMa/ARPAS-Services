package handlers

import (
	"context"
	"fmt"
	"log"
	"runtime"
	"storage-service/internal/models"
	"storage-service/internal/services"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// CacheHandler handles cache-related endpoints with high performance
type CacheHandler struct {
	cacheService  *services.CacheService
	objectService *services.ObjectService
}

// NewCacheHandler creates a new cache handler
func NewCacheHandler(cacheService *services.CacheService, objectService *services.ObjectService) *CacheHandler {
	return &CacheHandler{
		cacheService:  cacheService,
		objectService: objectService,
	}
}

// PreloadObjects handles POST /cache/preload with location-based prediction
func (h *CacheHandler) PreloadObjects(c *fiber.Ctx) error {
	var request models.PredictionRequest
	if err := c.BodyParser(&request); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "invalid request body",
			"details": err.Error(),
		})
	}
	if len(request.ObjectIDs) == 0 {
		return c.SendStatus(403)
	}

	log.Printf("Received preload request for %d objects", len(request.ObjectIDs))

	// Prepare for parallel preloading
	var objectIDs []uuid.UUID
	var storageKeys []string
	var skipped int

	// Check which objects need preloading
	for _, id := range request.ObjectIDs {
		if h.cacheService.CheckCached(id) {
			skipped++
			continue
		}

		obj, err := h.objectService.GetObject(id)
		if err != nil {
			log.Printf("Object not found for preload: %s", id)
			continue
		}
		objectIDs = append(objectIDs, id)
		storageKeys = append(storageKeys, obj.StorageKey)
	}

	// Create context with timeout for preloading
	ctx, cancel := context.WithTimeout(c.Context(), 30*time.Second)
	defer cancel()

	// Perform parallel preload
	err := h.cacheService.PreloadObjects(ctx, objectIDs, storageKeys)
	if err != nil {
		log.Printf("Error during preload: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "failed to preload objects",
			"details": err.Error(),
		})
	}

	log.Printf("Preload completed: %d preloaded, %d skipped (already cached)", len(objectIDs), skipped)

	return c.JSON(objectIDs)
}

// PreloadAll handles POST /cache/preload-all with parallel loading
func (h *CacheHandler) PreloadAll(c *fiber.Ctx) error {
	log.Printf("Starting full cache preload (CPUs: %d)", runtime.NumCPU())

	// Get all objects from database
	objects, err := h.objectService.ListObjects()
	if err != nil {
		log.Printf("Failed to list objects for preload: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "Failed to list objects",
			"details": err.Error(),
		})
	}

	if len(objects) == 0 {
		return c.JSON(fiber.Map{
			"message": "No objects to preload",
			"count":   0,
		})
	}

	log.Printf("Found %d total objects", len(objects))

	// Parallel cache checking to determine what needs loading
	var mu sync.Mutex
	var objectIDs []uuid.UUID
	var storageKeys []string
	var totalSize int64
	var alreadyCached int32

	// Use worker pool for cache checking
	checkWorkers := runtime.NumCPU() * 2
	if checkWorkers > len(objects) {
		checkWorkers = len(objects)
	}

	work := make(chan models.Object, len(objects))
	for _, obj := range objects {
		work <- obj
	}
	close(work)

	var wg sync.WaitGroup
	for i := 0; i < checkWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for obj := range work {
				if h.cacheService.CheckCached(obj.ID) {
					atomic.AddInt32(&alreadyCached, 1)
					continue
				}

				mu.Lock()
				objectIDs = append(objectIDs, obj.ID)
				storageKeys = append(storageKeys, obj.StorageKey)
				totalSize += obj.Size
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	cached := int(atomic.LoadInt32(&alreadyCached))

	if len(objectIDs) == 0 {
		return c.JSON(fiber.Map{
			"message":     "All objects already cached",
			"totalCount":  len(objects),
			"cachedCount": len(objects),
		})
	}

	log.Printf("Preloading %d objects (%.2f MB), %d already cached",
		len(objectIDs), float64(totalSize)/(1024*1024), cached)

	// Create context with reasonable timeout
	timeout := time.Duration(len(objectIDs)) * time.Second
	if timeout < 30*time.Second {
		timeout = 30 * time.Second
	}
	if timeout > 5*time.Minute {
		timeout = 5 * time.Minute
	}

	ctx, cancel := context.WithTimeout(c.Context(), timeout)
	defer cancel()

	// Perform the parallel preload
	preloadStart := time.Now()
	err = h.cacheService.PreloadObjects(ctx, objectIDs, storageKeys)
	preloadDuration := time.Since(preloadStart)

	// Calculate throughput
	throughputMBps := float64(totalSize) / (1024 * 1024) / preloadDuration.Seconds()

	// Prepare response
	response := fiber.Map{
		"totalObjects":    len(objects),
		"preloadedCount":  len(objectIDs),
		"alreadyCached":   cached,
		"preloadDuration": preloadDuration.String(),
		"throughputMBps":  throughputMBps,
	}

	// Set performance headers

	if err != nil {
		log.Printf("Preload all completed with errors %v: ", err)
		response["error"] = err.Error()
		response["status"] = "partial"
		return c.Status(fiber.StatusMultiStatus).JSON(response)
	}

	response["status"] = "success"
	return c.JSON(response)
}

// InvalidateObject handles DELETE /cache/object/:id
func (h *CacheHandler) InvalidateObject(c *fiber.Ctx) error {
	idStr := c.Params("id")
	objectID, err := uuid.Parse(idStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid object ID",
		})
	}

	startTime := time.Now()
	err = h.cacheService.InvalidateObject(objectID)
	duration := time.Since(startTime)

	if err != nil {
		log.Printf("Error invalidating cache for object %s: %v", objectID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to invalidate cache",
		})
	}

	log.Printf("Successfully invalidated cache for object %s in %v", objectID, duration)

	c.Set("X-Invalidation-Duration-Ms", fmt.Sprintf("%.2f", float64(duration.Microseconds())/1000.0))

	return c.JSON(fiber.Map{
		"message":    "Cache invalidated successfully",
		"objectId":   objectID.String(),
		"durationMs": float64(duration.Microseconds()) / 1000.0,
	})
}

// ClearCache handles POST /cache/clear
func (h *CacheHandler) ClearCache(c *fiber.Ctx) error {
	err := h.cacheService.ClearCache()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to clear cache",
		})
	}

	response := fiber.Map{
		"message": "Cache cleared successfully",
	}

	return c.JSON(response)
}
