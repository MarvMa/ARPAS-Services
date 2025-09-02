package handlers

import (
	"errors"
	"fmt"
	"io"
	"log"
	"storage-service/internal/models"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"

	"storage-service/internal/services"
)

const (
	InvalidUuidError     = "invalid UUID"
	ObjectNotFoundError  = "object not found"
	HeaderDownloadSource = "X-Download-Source"
	HeaderCacheHit       = "X-Cache-Hit"
	HeaderCacheStrategy  = "X-Cache-Strategy"
)

// ObjectHandler handles object-related endpoints
type ObjectHandler struct {
	Service      *services.ObjectService
	CacheService *services.CacheService

	// Performance metrics
	totalRequests atomic.Int64
	cacheHits     atomic.Int64
	cacheMisses   atomic.Int64
	totalLatency  atomic.Int64 // microseconds
}

// NewObjectHandler creates a new object handler
func NewObjectHandler(service *services.ObjectService, cacheService *services.CacheService) *ObjectHandler {
	return &ObjectHandler{
		Service:      service,
		CacheService: cacheService,
	}
}

// ListObjects handles GET /objects
func (h *ObjectHandler) ListObjects(c *fiber.Ctx) error {
	objects, err := h.Service.ListObjects()
	if err != nil {
		log.Printf("Error listing objects: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": err.Error(),
		})
	}
	log.Printf("Successfully listed %d objects", len(objects))
	return c.JSON(objects)
}

// GetObject handles GET /objects/:id
func (h *ObjectHandler) GetObject(c *fiber.Ctx) error {
	idStr := c.Params("id")
	log.Printf("Getting object - ID: %s, Method: %s, Path: %s, IP: %s", idStr, c.Method(), c.Path(), c.IP())

	objectID, err := uuid.Parse(idStr)
	if err != nil {
		log.Printf("Invalid UUID format: %s - Error: %v", idStr, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": InvalidUuidError,
		})
	}

	object, err := h.Service.GetObject(objectID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("Object not found: ID=%s", objectID)
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": true, "message": ObjectNotFoundError,
			})
		}
		log.Printf("Error fetching object: ID=%s, Error=%v", objectID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": err.Error(),
		})
	}

	log.Printf("Successfully retrieved object: ID=%s, Name=%s", objectID, object.OriginalFilename)
	return c.JSON(object)
}

// UploadObject handles POST /objects/upload
func (h *ObjectHandler) UploadObject(c *fiber.Ctx) error {
	log.Printf("Uploading GLB object - Method: %s, Path: %s, IP: %s", c.Method(), c.Path(), c.IP())

	fileHeader, err := c.FormFile("file")
	if err != nil {
		log.Printf("Failed to read file: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": "failed to read file: " + err.Error(),
		})
	}

	// Parse location parameters from form data
	var latitude, longitude, altitude *float64

	if latStr := c.FormValue("latitude"); latStr != "" {
		if lat, err := strconv.ParseFloat(latStr, 64); err == nil {
			latitude = &lat
		}
	}

	if lngStr := c.FormValue("longitude"); lngStr != "" {
		if lng, err := strconv.ParseFloat(lngStr, 64); err == nil {
			longitude = &lng
		}
	}

	if altStr := c.FormValue("altitude"); altStr != "" {
		if alt, err := strconv.ParseFloat(altStr, 64); err == nil {
			altitude = &alt
		}
	}
	log.Printf("Processing GLB upload: %s (%d bytes)", fileHeader.Filename, fileHeader.Size)

	object, err := h.Service.CreateObject(fileHeader, latitude, longitude, altitude)
	if err != nil {
		log.Printf("GLB upload failed: %v", err)
		status := fiber.StatusInternalServerError
		msg := err.Error()
		if strings.Contains(msg, "only GLB files are supported") {
			status = fiber.StatusBadRequest
		}
		return c.Status(status).JSON(fiber.Map{
			"error": true, "message": msg,
		})
	}

	log.Printf("Successfully created GLB object: ID=%s, Name=%s", object.ID, object.OriginalFilename)
	return c.Status(fiber.StatusCreated).JSON(object)
}

// DeleteObject handles DELETE /objects/:id
func (h *ObjectHandler) DeleteObject(c *fiber.Ctx) error {
	idStr := c.Params("id")
	log.Printf("Deleting object - ID: %s, Method: %s, Path: %s, IP: %s", idStr, c.Method(), c.Path(), c.IP())

	objectID, err := uuid.Parse(idStr)
	if err != nil {
		log.Printf("Invalid UUID format for delete: %s - Error: %v", idStr, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": InvalidUuidError,
		})
	}

	// Invalidate cache first
	_ = h.CacheService.InvalidateObject(objectID)

	err = h.Service.DeleteObject(objectID)
	if err != nil {
		log.Printf("Object not found for delete: ID=%s", objectID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": true, "message": ObjectNotFoundError,
			})
		}
		log.Printf("Error deleting object: ID=%s, Error=%v", objectID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": err.Error(),
		})
	}

	log.Printf("Successfully deleted object: ID=%s", objectID)
	return c.SendStatus(fiber.StatusNoContent)
}

// DownloadObject handles GET /objects/:id/download with optimized streaming
func (h *ObjectHandler) DownloadObject(c *fiber.Ctx) error {
	startTime := time.Now()
	idStr := c.Params("id")
	optimizationMode := strings.ToLower(c.Get("X-Optimization-Mode"))

	// Track request
	h.totalRequests.Add(1)

	objectID, err := uuid.Parse(idStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid UUID",
		})
	}

	// Get object metadata
	obj, err := h.Service.GetObject(objectID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "object not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "internal error",
		})
	}

	var rc io.ReadCloser
	var contentLength int64
	var fromCache bool
	var cacheStrategy string

	if optimizationMode == "optimized" {
		cacheStartTime := time.Now()

		rcCache, size, err := h.CacheService.GetFromCacheStream(objectID)

		if err == nil && rcCache != nil {
			rc = rcCache
			contentLength = size
			fromCache = true
			cacheStrategy = "memory-direct"
			h.cacheHits.Add(1)

			cacheLatency := time.Since(cacheStartTime)
			log.Printf("Cache HIT for %s - Latency: %v, Size: %d bytes",
				objectID, cacheLatency, contentLength)
		} else {
			// Cache miss
			h.cacheMisses.Add(1)
			fromCache = false
			cacheStrategy = "memory-miss-loaded"
			log.Printf("Cache MISS for %s (will be loaded): %v", objectID, err)
		}
	}

	// Fallback to direct MinIO access if not using optimization
	if rc == nil && optimizationMode != "optimized" {
		minioStartTime := time.Now()

		object, err := h.Service.Minio.GetObject(
			c.Context(),
			h.Service.BucketName,
			obj.StorageKey,
			minio.GetObjectOptions{},
		)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "unable to retrieve file",
			})
		}

		stat, err := object.Stat()
		if err != nil {
			object.Close()
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "unable to get file stats",
			})
		}

		rc = object
		contentLength = stat.Size
		fromCache = false
		cacheStrategy = "direct-minio"

		log.Printf("Direct MinIO access for %s in %v",
			objectID, time.Since(minioStartTime))
	}

	// Set response headers
	h.setOptimizedHeaders(c, obj, contentLength, fromCache, cacheStrategy)

	// Calculate total latency
	totalLatency := time.Since(startTime)
	h.totalLatency.Add(totalLatency.Microseconds())

	// Set performance metrics in headers
	c.Set("X-Total-Latency-Ms", fmt.Sprintf("%.2f", float64(totalLatency.Microseconds())/1000.0))
	c.Set("X-Content-Size-Bytes", fmt.Sprintf("%d", contentLength))

	// Stream the response
	c.Context().SetBodyStream(rc, int(contentLength))

	log.Printf("Served %s | Mode: %s | Cache: %v | Strategy: %s | Latency: %v | Size: %d bytes",
		objectID, optimizationMode, fromCache, cacheStrategy, totalLatency, contentLength)

	return nil
}

// setOptimizedHeaders sets HTTP headers optimized for performance
func (h *ObjectHandler) setOptimizedHeaders(c *fiber.Ctx, obj *models.Object, size int64, fromCache bool, strategy string) {
	contentType := obj.ContentType
	if contentType == "" {
		contentType = "model/gltf-binary"
	}

	// Core headers
	c.Set(fiber.HeaderContentType, contentType)
	c.Set(fiber.HeaderContentDisposition, fmt.Sprintf("attachment; filename=\"%s.glb\"", obj.ID))

	// Performance headers
	c.Set(HeaderDownloadSource, map[bool]string{true: "cache", false: "storage"}[fromCache])
	c.Set(HeaderCacheHit, map[bool]string{true: "true", false: "false"}[fromCache])
	c.Set(HeaderCacheStrategy, strategy)

	// Optimize transfer
	c.Set("Content-Encoding", "identity")
	c.Set("Accept-Ranges", "bytes")

	if size > 0 {
		c.Set(fiber.HeaderContentLength, fmt.Sprintf("%d", size))
	}

	// Performance metrics
	if h.totalRequests.Load() > 0 {
		hitRate := float64(h.cacheHits.Load()) / float64(h.totalRequests.Load()) * 100
		avgLatency := float64(h.totalLatency.Load()) / float64(h.totalRequests.Load()) / 1000.0

		c.Set("X-Cache-Hit-Rate", fmt.Sprintf("%.1f%%", hitRate))
		c.Set("X-Avg-Latency-Ms", fmt.Sprintf("%.2f", avgLatency))
	}

	c.Status(fiber.StatusOK)
}
