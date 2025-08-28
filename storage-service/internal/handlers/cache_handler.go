package handlers

import (
	"fmt"
	"log"
	"storage-service/internal/models"
	"storage-service/internal/services"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// CacheHandler handles cache-related endpoints
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

// PreloadObjects handles POST /cache/preload
func (h *CacheHandler) PreloadObjects(c *fiber.Ctx) error {
	startTime := time.Now()

	var request models.PredictionRequest
	if err := c.BodyParser(&request); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "invalid request body",
			"details": err.Error(),
		})
	}

	// Get predicted models based on location
	predictedModelIDs, err := h.objectService.GetPredictedModels(request)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "Failed to predict models",
			"details": err.Error(),
		})
	}

	// Prepare storage keys for preloading
	var objectIDs []uuid.UUID
	var storageKeys []string

	for _, id := range predictedModelIDs {
		obj, err := h.objectService.GetObject(id)
		if err != nil {
			log.Printf("Object not found for preload: %s", id)
			continue
		}
		objectIDs = append(objectIDs, id)
		storageKeys = append(storageKeys, obj.StorageKey)
	}

	if len(objectIDs) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"message": "No objects found for preloading",
		})
	}

	err = h.cacheService.PreloadObjects(c.Context(), objectIDs, storageKeys)

	duration := time.Since(startTime)

	// Set response headers
	c.Set("X-Preload-Duration-Ms", fmt.Sprintf("%.2f", float64(duration.Microseconds())/1000.0))
	c.Set("X-Preload-Object-Count", fmt.Sprintf("%d", len(objectIDs)))

	if err != nil {
		log.Printf("Preload error: %v", err)
		return c.Status(fiber.StatusMultiStatus).JSON(fiber.Map{
			"message":     "Partial preload completed",
			"error":       err.Error(),
			"objectCount": len(objectIDs),
			"duration":    duration.String(),
		})
	}

	log.Printf("Preload completed for %d objects in %v", len(objectIDs), duration)

	// Return the list of preloaded object IDs
	var responseIDs []string
	for _, id := range objectIDs {
		responseIDs = append(responseIDs, id.String())
	}

	return c.JSON(responseIDs)
}

func (h *CacheHandler) PreloadAll(c *fiber.Ctx) error {
	startTime := time.Now()

	log.Printf("Starting full cache preload of all objects")

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

	log.Printf("Found %d objects to preload", len(objects))

	var objectIDs []uuid.UUID
	var storageKeys []string
	totalSize := int64(0)

	for _, obj := range objects {
		// Check if already cached
		if h.cacheService.CheckCached(obj.ID) {
			continue
		}

		objectIDs = append(objectIDs, obj.ID)
		storageKeys = append(storageKeys, obj.StorageKey)
		totalSize += obj.Size
	}

	if len(objectIDs) == 0 {
		return c.JSON(fiber.Map{
			"message":     "All objects already cached",
			"totalCount":  len(objects),
			"cachedCount": len(objects),
			"duration":    time.Since(startTime).String(),
		})
	}

	// Perform the preload
	err = h.cacheService.PreloadObjects(c.Context(), objectIDs, storageKeys)

	duration := time.Since(startTime)

	// Prepare response
	response := fiber.Map{
		"totalObjects":   len(objects),
		"preloadedCount": len(objectIDs),
		"alreadyCached":  len(objects) - len(objectIDs),
		"duration":       duration.String(),
		"totalSizeMB":    float64(totalSize) / (1024 * 1024),
	}

	// Get updated cache statistics
	if updatedStats, err := h.cacheService.GetStatistics(); err == nil {
		response["cacheStats"] = updatedStats
	}

	if err != nil {
		log.Printf("Preload all completed with errors after %v: %v", duration, err)
		response["error"] = err.Error()
		response["status"] = "partial"
		return c.Status(fiber.StatusMultiStatus).JSON(response)
	}

	log.Printf("Successfully preloaded all %d objects in %v", len(objectIDs), duration)
	response["status"] = "success"

	return c.JSON(response)
}

// GetCacheStats handles GET /cache/stats
func (h *CacheHandler) GetCacheStats(c *fiber.Ctx) error {
	stats, err := h.cacheService.GetStatistics()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to get cache statistics",
		})
	}

	return c.JSON(stats)
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

	err = h.cacheService.InvalidateObject(objectID)
	if err != nil {
		log.Printf("Error invalidating cache for object %s: %v", objectID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to invalidate cache",
		})
	}

	log.Printf("Successfully invalidated cache for object %s", objectID)
	return c.SendStatus(fiber.StatusNoContent)
}

// ClearCache handles POST /cache/clear
func (h *CacheHandler) ClearCache(c *fiber.Ctx) error {
	err := h.cacheService.ClearCache()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to clear cache",
		})
	}

	log.Printf("Cache cleared successfully")
	return c.JSON(fiber.Map{
		"message": "Cache cleared successfully",
	})
}
