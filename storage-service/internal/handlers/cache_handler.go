package handlers

import (
	"log"
	"strings"

	"storage-service/internal/services"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// CacheHandler handles cache-related HTTP endpoints
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

// PreloadObjects handles POST /cache/preload to preload objects into cache
// @Summary Preload objects into cache
// @Description Preload multiple objects into Redis cache for faster access
// @Tags cache
// @Accept json
// @Produce json
// @Param request body PreloadRequest true "List of object IDs to preload"
// @Success 200 {object} map[string]interface{} "Preload successful"
// @Failure 400 {object} map[string]interface{} "Bad request"
// @Failure 207 {object} map[string]interface{} "Partial success"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /cache/preload [post]
func (h *CacheHandler) PreloadObjects(c *fiber.Ctx) error {
	log.Printf("[PRELOAD] Preloading objects")
	var request struct {
		IDs []string `json:"ids"`
	}

	if err := c.BodyParser(&request); err != nil {
		log.Printf("Invalid preload request: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"message": "Invalid request format",
		})
	}

	log.Printf("Received preload request for %d objects", len(request.IDs))

	// Parse and validate UUIDs
	var objectIDs []uuid.UUID
	var storageKeys []string

	for _, idStr := range request.IDs {
		// Handle both UUID and UUID.glb formats
		cleanID := strings.TrimSuffix(idStr, ".glb")

		objectID, err := uuid.Parse(cleanID)
		if err != nil {
			log.Printf("Invalid UUID in preload request: %s", idStr)
			continue
		}

		// Get object metadata to retrieve storage key
		obj, err := h.objectService.GetObject(objectID)
		if err != nil {
			log.Printf("Object not found for preload: %s", objectID)
			continue
		}

		objectIDs = append(objectIDs, objectID)
		storageKeys = append(storageKeys, obj.StorageKey)
	}

	if len(objectIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"message": "No valid object IDs provided",
		})
	}

	// Preload objects
	err := h.cacheService.PreloadObjects(c.Context(), objectIDs, storageKeys)

	status := fiber.StatusOK
	success := true
	message := "All objects preloaded successfully"

	if err != nil {
		log.Printf("Preload error: %v", err)
		status = fiber.StatusMultiStatus
		success = false
		message = "Some objects failed to preload"
	}

	return c.Status(status).JSON(fiber.Map{
		"success":   success,
		"message":   message,
		"preloaded": len(objectIDs),
	})
}

// GetCacheStats handles GET /cache/stats to retrieve cache statistics
// @Summary Get cache statistics
// @Description Get detailed statistics about the cache
// @Tags cache
// @Accept json
// @Produce json
// @Success 200 {object} services.CacheStatistics "Cache statistics"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /cache/stats [get]
func (h *CacheHandler) GetCacheStats(c *fiber.Ctx) error {
	stats, err := h.cacheService.GetStatistics()
	if err != nil {
		log.Printf("Error getting cache statistics: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   true,
			"message": "Failed to get cache statistics",
		})
	}

	return c.JSON(stats)
}

// InvalidateObject handles DELETE /cache/object/:id to remove an object from cache
// @Summary Invalidate cached object
// @Description Remove a specific object from the cache
// @Tags cache
// @Accept json
// @Produce json
// @Param id path string true "Object ID"
// @Success 204 "No Content"
// @Failure 400 {object} map[string]interface{} "Invalid UUID"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /cache/object/{id} [delete]
func (h *CacheHandler) InvalidateObject(c *fiber.Ctx) error {
	idStr := c.Params("id")
	objectID, err := uuid.Parse(idStr)
	if err != nil {
		log.Printf("Invalid UUID for cache invalidation: %s", idStr)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid object ID",
		})
	}

	err = h.cacheService.InvalidateObject(objectID)
	if err != nil {
		log.Printf("Error invalidating cache for object %s: %v", objectID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   true,
			"message": "Failed to invalidate cache",
		})
	}

	return c.SendStatus(fiber.StatusNoContent)
}

// ClearCache handles POST /cache/clear to clear all cached objects
// @Summary Clear entire cache
// @Description Remove all objects from the cache
// @Tags cache
// @Accept json
// @Produce json
// @Success 200 {object} map[string]interface{} "Cache cleared"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /cache/clear [post]
func (h *CacheHandler) ClearCache(c *fiber.Ctx) error {
	err := h.cacheService.ClearCache()
	if err != nil {
		log.Printf("Error clearing cache: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   true,
			"message": "Failed to clear cache",
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Cache cleared successfully",
	})
}

// PreloadRequest represents the request body for preloading objects
type PreloadRequest struct {
	IDs []string `json:"ids"`
}
