package handlers

import (
	"errors"
	"fmt"
	"log"
	"storage-service/internal/models"
	_ "storage-service/internal/utils"
	"strconv"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"gorm.io/gorm"

	_ "storage-service/internal/models"
	"storage-service/internal/services"
)

const InvalidUuidError = "invalid UUID"
const ObjectNotFoundError = "object not found"
const (
	HeaderDownloadSource = "X-Download-Source"
	HeaderCacheHit       = "X-Cache-Hit"
)

// ObjectHandler handles object-related endpoints
type ObjectHandler struct {
	Service      *services.ObjectService
	CacheService *services.CacheService
}

// NewObjectHandler creates a new object handler
func NewObjectHandler(service *services.ObjectService, cacheService *services.CacheService) *ObjectHandler {
	return &ObjectHandler{
		Service:      service,
		CacheService: cacheService,
	}
}

// ListObjects handles GET /objects to retrieve a list of all 3D objects.
// @Summary List all 3D objects
// @Description Gets all 3D objects stored in the system
// @Tags objects
// @Accept json
// @Produce json
// @Success 200 {array} models.Object "List of all 3D objects"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /objects [get]
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

// GetObject handles GET /objects/:id to retrieve a single object's metadata.
// @Summary Get a 3D object by ID
// @Description Get details of a specific 3D object
// @Tags objects
// @Accept json
// @Produce json
// @Param id path string true "Object ID"
// @Success 200 {object} models.Object "Object found"
// @Failure 400 {object} map[string]interface{} "Invalid UUID"
// @Failure 404 {object} map[string]interface{} "Object not found"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /objects/{id} [get]
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

// UploadObject handles POST /objects/upload to upload a new GLB file.
// @Summary Upload a new GLB file
// @Description Upload a single GLB file (only .glb format supported)
// @Tags objects
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "GLB file (.glb format only)"
// @Success 201 {object} models.Object "Object successfully created"
// @Failure 400 {object} map[string]interface{} "Bad request"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /objects/upload [post]
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

// DeleteObject handles DELETE /objects/:id to remove an object.
// @Summary Delete a 3D object
// @Description Delete a 3D object by ID (removes both the stored file and the metadata record)
// @Tags objects
// @Accept json
// @Produce json
// @Param id path string true "Object ID"
// @Success 204 "No Content"
// @Failure 400 {object} map[string]interface{} "Invalid UUID"
// @Failure 404 {object} map[string]interface{} "Object not found"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /objects/{id} [delete]
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

func (h *ObjectHandler) DownloadObject(c *fiber.Ctx) error {
	startTime := time.Now()
	idStr := c.Params("id")
	optimizationMode := strings.ToLower(c.Get("X-Optimization-Mode"))

	log.Printf("Downloading object %s, mode: %s", idStr, optimizationMode)

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

	// Try to get from cache first if optimization mode is enabled
	if optimizationMode == "optimized" {
		rc, clen, err := h.CacheService.GetFromCacheStream(objectID)
		if err == nil && rc != nil {

			// Set response headers
			h.setResponseHeaders(c, obj, clen, true)

			// Set performance metrics
			latency := time.Since(startTime)
			c.Set(HeaderDownloadSource, "cache")
			c.Set(HeaderCacheHit, "true")
			c.Set("X-Latency-Ms", fmt.Sprintf("%.2f", float64(latency.Microseconds())/1000.0))

			// Stream from cache
			c.Context().SetBodyStream(rc, int(clen))

			log.Printf("Served object %s from cache in %v", objectID, latency)
			return nil
		}
	}

	// Fallback to MinIO
	object, err := h.Service.Minio.GetObject(c.Context(), h.Service.BucketName, obj.StorageKey, minio.GetObjectOptions{})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "unable to retrieve file",
		})
	}

	// Get object size
	stat, _ := object.Stat()
	clen := stat.Size

	// Set response headers
	h.setResponseHeaders(c, obj, clen, false)

	// Set performance metrics
	latency := time.Since(startTime)
	c.Set(HeaderDownloadSource, "minio")
	c.Set(HeaderCacheHit, "false")
	c.Set("X-Latency-Ms", fmt.Sprintf("%.2f", float64(latency.Microseconds())/1000.0))

	// Stream from MinIO
	c.Context().SetBodyStream(object, int(clen))

	log.Printf("Served object %s from storage in %v", objectID, latency)
	return nil
}

func (h *ObjectHandler) setResponseHeaders(c *fiber.Ctx, obj *models.Object, size int64, fromCache bool) {
	contentType := obj.ContentType
	if contentType == "" {
		contentType = "model/gltf-binary"
	}

	c.Set(fiber.HeaderContentType, contentType)
	c.Set(fiber.HeaderContentDisposition, fmt.Sprintf("attachment; filename=\"%s.glb\"", obj.ID))
	c.Set("Content-Encoding", "identity")

	if size > 0 {
		c.Set(fiber.HeaderContentLength, fmt.Sprintf("%d", size))
	}

	if fromCache {
		c.Set("Cache-Control", "public, max-age=3600")
		c.Set("ETag", fmt.Sprintf("\"%s\"", obj.ID))
	}

	c.Status(fiber.StatusOK)
}
