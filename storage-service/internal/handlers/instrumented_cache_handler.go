package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"storage-service/internal/services"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// InstrumentedCacheHandler extends CacheHandler with metrics
type InstrumentedCacheHandler struct {
	instrumentedCache *services.InstrumentedCacheService
	objectService     *services.ObjectService
}

// NewInstrumentedCacheHandler creates a new instrumented cache handler
func NewInstrumentedCacheHandler(instrumentedCache *services.InstrumentedCacheService, objectService *services.ObjectService) *InstrumentedCacheHandler {
	return &InstrumentedCacheHandler{
		instrumentedCache: instrumentedCache,
		objectService:     objectService,
	}
}

// PreloadObjects handles POST /cache/preload with detailed metrics
func (h *InstrumentedCacheHandler) PreloadObjects(c *fiber.Ctx) error {
	startTime := time.Now()

	log.Printf("[PRELOAD] Starting instrumented preload operation")

	var request struct {
		IDs []string `json:"ids"`
	}

	if err := c.BodyParser(&request); err != nil {
		log.Printf("Invalid preload request: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"message": "Invalid request format",
			"error":   err.Error(),
		})
	}

	log.Printf("Received preload request for %d objects", len(request.IDs))

	// Parse and validate UUIDs
	var objectIDs []uuid.UUID
	var storageKeys []string
	parseErrors := 0

	for _, idStr := range request.IDs {
		// Handle both UUID and UUID.glb formats
		cleanID := strings.TrimSuffix(idStr, ".glb")

		objectID, err := uuid.Parse(cleanID)
		if err != nil {
			log.Printf("Invalid UUID in preload request: %s", idStr)
			parseErrors++
			continue
		}

		// Get object metadata to retrieve storage key
		obj, err := h.objectService.GetObject(objectID)
		if err != nil {
			log.Printf("Object not found for preload: %s", objectID)
			parseErrors++
			continue
		}

		objectIDs = append(objectIDs, objectID)
		storageKeys = append(storageKeys, obj.StorageKey)
	}

	if len(objectIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success":     false,
			"message":     "No valid object IDs provided",
			"parseErrors": parseErrors,
		})
	}

	// Preload objects with metrics
	preloadMetrics, err := h.instrumentedCache.PreloadObjectsWithMetrics(c.Context(), objectIDs, storageKeys)

	// Prepare response
	status := fiber.StatusOK
	success := true
	message := "All objects preloaded successfully"

	if err != nil {
		log.Printf("Preload error: %v", err)
		status = fiber.StatusMultiStatus
		success = false
		message = "Some objects failed to preload"
	}

	// Calculate operation latency
	operationLatency := float64(time.Since(startTime).Microseconds()) / 1000.0

	// Set detailed response headers
	c.Set("X-Preload-Total-Ms", formatFloat(operationLatency))
	c.Set("X-Preload-Object-Count", formatInt(len(objectIDs)))
	c.Set("X-Preload-Parse-Errors", formatInt(parseErrors))

	if preloadMetrics != nil {
		c.Set("X-Preload-Success-Count", formatInt(preloadMetrics.ObjectCount-preloadMetrics.ErrorCount))
		c.Set("X-Preload-Error-Count", formatInt(preloadMetrics.ErrorCount))
		c.Set("X-Preload-Total-Size-MB", formatFloat(float64(preloadMetrics.TotalSize)/(1024*1024)))

		// Add layer-specific metrics to headers
		for layerName, layerMetrics := range preloadMetrics.LayerMetrics {
			c.Set("X-Preload-"+layerName+"-Success", formatInt(layerMetrics.SuccessCount))
			c.Set("X-Preload-"+layerName+"-Failed", formatInt(layerMetrics.FailedCount))
			c.Set("X-Preload-"+layerName+"-Latency-Ms", formatFloat(layerMetrics.LatencyMs))
		}

		// Add metrics summary as JSON header
		if metricsJson, err := json.Marshal(preloadMetrics); err == nil {
			c.Set("X-Preload-Metrics", string(metricsJson))
		}
	}

	// Log summary
	if preloadMetrics != nil {
		log.Printf("Preload completed: %s", preloadMetrics.GetSummary())
	}

	return c.Status(status).JSON(fiber.Map{
		"success":          success,
		"message":          message,
		"preloaded":        len(objectIDs),
		"parseErrors":      parseErrors,
		"operationLatency": operationLatency,
		"metrics":          preloadMetrics,
	})
}

// GetCacheStats handles GET /cache/stats with enhanced metrics
func (h *InstrumentedCacheHandler) GetCacheStats(c *fiber.Ctx) error {
	startTime := time.Now()

	stats, err := h.instrumentedCache.GetStatistics()
	if err != nil {
		log.Printf("Error getting cache statistics: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   true,
			"message": "Failed to get cache statistics",
		})
	}

	// Add latency header
	latency := float64(time.Since(startTime).Microseconds()) / 1000.0
	c.Set("X-Stats-Latency-Ms", formatFloat(latency))

	// Add summary headers
	if stats != nil {
		totalObjects := stats.MultiLayer.Memory.Objects +
			stats.MultiLayer.FileSystem.Objects +
			stats.MultiLayer.Redis.Objects

		totalSizeBytes := stats.MultiLayer.Memory.SizeBytes +
			stats.MultiLayer.FileSystem.SizeBytes +
			stats.MultiLayer.Redis.SizeBytes

		c.Set("X-Cache-Total-Objects", formatInt(totalObjects))
		c.Set("X-Cache-Total-Size-MB", formatFloat(float64(totalSizeBytes)/(1024*1024)))
		c.Set("X-Cache-Memory-Hit-Rate", formatFloat(stats.MultiLayer.Memory.HitRate))
		c.Set("X-Cache-FileSystem-Hit-Rate", formatFloat(stats.MultiLayer.FileSystem.HitRate))
		c.Set("X-Cache-Redis-Hit-Rate", formatFloat(stats.MultiLayer.Redis.HitRate))
	}

	return c.JSON(stats)
}

// InvalidateObject handles DELETE /cache/object/:id with metrics
func (h *InstrumentedCacheHandler) InvalidateObject(c *fiber.Ctx) error {
	startTime := time.Now()

	idStr := c.Params("id")
	objectID, err := uuid.Parse(idStr)
	if err != nil {
		log.Printf("Invalid UUID for cache invalidation: %s", idStr)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid object ID",
		})
	}

	err = h.instrumentedCache.InvalidateObject(objectID)

	// Add latency header
	latency := float64(time.Since(startTime).Microseconds()) / 1000.0
	c.Set("X-Invalidation-Latency-Ms", formatFloat(latency))
	c.Set("X-Invalidated-Object-ID", objectID.String())

	if err != nil {
		log.Printf("Error invalidating cache for object %s: %v (latency: %.2fms)", objectID, err, latency)
		c.Set("X-Invalidation-Success", "false")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   true,
			"message": "Failed to invalidate cache",
		})
	}

	log.Printf("Successfully invalidated cache for object %s (latency: %.2fms)", objectID, latency)
	c.Set("X-Invalidation-Success", "true")

	return c.SendStatus(fiber.StatusNoContent)
}

// ClearCache handles POST /cache/clear with metrics
func (h *InstrumentedCacheHandler) ClearCache(c *fiber.Ctx) error {
	startTime := time.Now()

	log.Printf("Starting cache clear operation")

	// Get current stats before clearing
	var objectCountBefore int
	if stats, err := h.instrumentedCache.GetStatistics(); err == nil {
		objectCountBefore = stats.MultiLayer.Memory.Objects +
			stats.MultiLayer.FileSystem.Objects +
			stats.MultiLayer.Redis.Objects
	}

	err := h.instrumentedCache.ClearCache()

	// Calculate latency
	latency := float64(time.Since(startTime).Microseconds()) / 1000.0

	// Set response headers
	c.Set("X-Clear-Latency-Ms", formatFloat(latency))
	c.Set("X-Clear-Objects-Before", formatInt(objectCountBefore))

	if err != nil {
		log.Printf("Error clearing cache: %v (latency: %.2fms)", err, latency)
		c.Set("X-Clear-Success", "false")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   true,
			"message": "Failed to clear cache",
			"latency": latency,
		})
	}

	log.Printf("Successfully cleared cache - %d objects removed (latency: %.2fms)", objectCountBefore, latency)
	c.Set("X-Clear-Success", "true")

	return c.JSON(fiber.Map{
		"success":        true,
		"message":        "Cache cleared successfully",
		"objectsCleared": objectCountBefore,
		"latency":        latency,
	})
}

// Helper functions
func formatFloat(f float64) string {
	return fmt.Sprintf("%.2f", f)
}

func formatInt(i int) string {
	return fmt.Sprintf("%d", i)
}
