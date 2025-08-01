package handlers

import (
	"errors"
	"github.com/minio/minio-go/v7"
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"gorm.io/gorm"

	_ "storage-service/internal/models"
	"storage-service/internal/services"
)

const InvalidUuidError = "invalid UUID"
const ObjectNotFoundError = "object not found"

// ObjectHandler defines handlers for managing 3D object resources.
type ObjectHandler struct {
	Service *services.ObjectService
}

// NewObjectHandler creates a new ObjectHandler with the given ObjectService.
func NewObjectHandler(service *services.ObjectService) *ObjectHandler {
	return &ObjectHandler{Service: service}
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

// UpdateObject handles PUT /objects/:id to update an existing object's GLB file.
// @Summary Update a GLB object
// @Description Replace an existing GLB object file with a new GLB upload
// @Tags objects
// @Accept multipart/form-data
// @Produce json
// @Param id path string true "Object ID"
// @Param file formData file true "New GLB file (.glb format only)"
// @Success 200 {object} models.Object "Updated object metadata"
// @Failure 400 {object} map[string]interface{} "Bad request"
// @Failure 404 {object} map[string]interface{} "Object not found"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /objects/{id} [put]
func (h *ObjectHandler) UpdateObject(c *fiber.Ctx) error {
	idStr := c.Params("id")
	log.Printf("Updating GLB object - ID: %s, Method: %s, Path: %s, IP: %s", idStr, c.Method(), c.Path(), c.IP())
	objectID, err := uuid.Parse(idStr)
	if err != nil {
		log.Printf("Invalid UUID format for update: %s - Error: %v", idStr, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": InvalidUuidError,
		})
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		log.Printf("Failed to read GLB file for update: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": "failed to read file: " + err.Error(),
		})
	}
	log.Printf("Processing GLB update with file: %s (%d bytes)", fileHeader.Filename, fileHeader.Size)

	updatedObject, err := h.Service.UpdateObject(objectID, fileHeader)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("Object not found for update: ID=%s", objectID)
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": true, "message": ObjectNotFoundError,
			})
		}
		log.Printf("Error updating GLB object: ID=%s, Error=%v", objectID, err)
		status := fiber.StatusInternalServerError
		if strings.Contains(err.Error(), "only GLB files are supported") {
			status = fiber.StatusBadRequest
		}
		return c.Status(status).JSON(fiber.Map{
			"error": true, "message": err.Error(),
		})
	}
	log.Printf("Successfully updated GLB object: ID=%s, Name=%s", objectID, updatedObject.OriginalFilename)
	return c.JSON(updatedObject)
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

// DownloadObject handles GET /objects/:id/download to stream the GLB file content.
// @Summary Download a 3D object file
// @Description Download the GLB file for a specific 3D object
// @Tags objects
// @Accept json
// @Produce application/octet-stream
// @Param id path string true "Object ID"
// @Success 200 {file} binary "GLB file"
// @Failure 400 {object} map[string]interface{} "Invalid UUID"
// @Failure 404 {object} map[string]interface{} "Object not found"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /objects/{id}/download [get]
func (h *ObjectHandler) DownloadObject(c *fiber.Ctx) error {
	idStr := c.Params("id")
	log.Printf("Downloading object - ID: %s, Method: %s, Path: %s, IP: %s", idStr, c.Method(), c.Path(), c.IP())
	objectID, err := uuid.Parse(idStr)
	if err != nil {
		log.Printf("Invalid UUID format for download: %s - Error: %v", idStr, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": InvalidUuidError,
		})
	}
	// Get object metadata (to retrieve storage key and content type)
	obj, err := h.Service.GetObject(objectID)
	if err != nil {
		log.Printf("Object not found for download: ID=%s", objectID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": true, "message": ObjectNotFoundError,
			})
		}
		log.Printf("Error fetching object for download: ID=%s, Error=%v", objectID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": err.Error(),
		})
	}
	log.Printf("Retrieving file from storage: StorageKey=%s", obj.StorageKey)
	// Fetch the file from MinIO storage
	object, err := h.Service.Minio.GetObject(c.Context(), h.Service.BucketName, obj.StorageKey, minio.GetObjectOptions{})
	if err != nil {
		log.Printf("Failed to retrieve file from MinIO: StorageKey=%s, Error=%v", obj.StorageKey, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": "unable to retrieve file",
		})
	}
	stat, err := object.Stat()
	if err != nil {
		log.Printf("File not found in storage: StorageKey=%s, Error=%v", obj.StorageKey, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": "file not found in storage",
		})
	}
	log.Printf("Successfully streaming file: ID=%s, Size=%d bytes", objectID, stat.Size)

	// Set response headers for file download
	c.Set(fiber.HeaderContentType, obj.ContentType)
	c.Set(fiber.HeaderContentDisposition, "attachment; filename=\""+obj.ID.String()+".glb\"")
	// Stream the content to the response
	return c.Status(fiber.StatusOK).SendStream(object, int(stat.Size))
}
