package handlers

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"

	"storage-service/internal/models"
	"storage-service/internal/services"
)

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
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": err.Error(),
		})
	}
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
	objectID, err := uuid.Parse(idStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": "invalid UUID",
		})
	}
	object, err := h.Service.GetObject(objectID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": true, "message": "object not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": err.Error(),
		})
	}
	return c.JSON(object)
}

// UploadObject handles POST /objects/upload to upload a new 3D object (single file or files with resources).
// @Summary Upload a new 3D object
// @Description Upload one or more 3D model files (formats: .fbx, .obj, .dae, .stl, .gltf). Multiple files can be provided for a model with external resources (e.g. textures).
// @Tags objects
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "3D model file(s)"
// @Success 201 {object} models.Object "Object successfully created"
// @Failure 400 {object} map[string]interface{} "Bad request"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /objects/upload [post]
func (h *ObjectHandler) UploadObject(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": "failed to read form data: " + err.Error(),
		})
	}
	files := form.File["file"] // all files under field "file"
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": "no files provided",
		})
	}

	// Determine if single or multiple files
	var object *models.Object
	if len(files) == 1 {
		fileHeader := files[0]
		object, err = h.Service.CreateObject(fileHeader)
	} else {
		object, err = h.Service.CreateObjectFromFiles(files)
	}
	if err != nil {
		// Return 400 for client errors (unsupported format, multiple model files, etc.), else 500
		status := fiber.StatusInternalServerError
		msg := err.Error()
		if strings.Contains(msg, "unsupported file format") ||
			strings.Contains(msg, "unsupported archive format") ||
			strings.Contains(msg, "multiple model files provided") ||
			strings.Contains(msg, "no primary 3d model file found") {
			status = fiber.StatusBadRequest
		}
		return c.Status(status).JSON(fiber.Map{
			"error": true, "message": msg,
		})
	}
	return c.Status(fiber.StatusCreated).JSON(object)
}

// UploadArchive handles POST /objects/upload-archive to upload a 3D object from an archive.
// @Summary Upload a new 3D object via archive
// @Description Upload a .zip or .rar archive containing a 3D model and its resources. The archive will be extracted and the model converted to GLB.
// @Tags objects
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "Archive file (.zip or .rar) containing the model"
// @Success 201 {object} models.Object "Object successfully created"
// @Failure 400 {object} map[string]interface{} "Bad request"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /objects/upload-archive [post]
func (h *ObjectHandler) UploadArchive(c *fiber.Ctx) error {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": "failed to read archive file: " + err.Error(),
		})
	}
	object, err := h.Service.CreateObjectFromArchive(fileHeader)
	if err != nil {
		status := fiber.StatusInternalServerError
		msg := err.Error()
		if strings.Contains(msg, "unsupported archive format") ||
			strings.Contains(msg, "unsupported file format") ||
			strings.Contains(msg, "multiple model files provided") ||
			strings.Contains(msg, "no 3d model file found") {
			status = fiber.StatusBadRequest
		}
		return c.Status(status).JSON(fiber.Map{
			"error": true, "message": msg,
		})
	}
	return c.Status(fiber.StatusCreated).JSON(object)
}

// UpdateObject handles PUT /objects/:id to update an existing object's file.
// @Summary Update a 3D object
// @Description Replace an existing 3D object file with a new upload
// @Tags objects
// @Accept multipart/form-data
// @Produce json
// @Param id path string true "Object ID"
// @Param file formData file true "New 3D model file"
// @Success 200 {object} models.Object "Updated object metadata"
// @Failure 400 {object} map[string]interface{} "Bad request"
// @Failure 404 {object} map[string]interface{} "Object not found"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /objects/{id} [put]
func (h *ObjectHandler) UpdateObject(c *fiber.Ctx) error {
	idStr := c.Params("id")
	objectID, err := uuid.Parse(idStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": "invalid UUID",
		})
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": "failed to read file: " + err.Error(),
		})
	}
	updatedObject, err := h.Service.UpdateObject(objectID, fileHeader)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": true, "message": "object not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": err.Error(),
		})
	}
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
	objectID, err := uuid.Parse(idStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": "invalid UUID",
		})
	}
	err = h.Service.DeleteObject(objectID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": true, "message": "object not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": err.Error(),
		})
	}
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
	objectID, err := uuid.Parse(idStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": "invalid UUID",
		})
	}
	// Get object metadata (to retrieve storage key and content type)
	obj, err := h.Service.GetObject(objectID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": true, "message": "object not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": err.Error(),
		})
	}
	// Fetch the file from MinIO storage
	object, err := h.Service.Minio.GetObject(c.Context(), h.Service.BucketName, obj.StorageKey, minio.GetObjectOptions{})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": "unable to retrieve file",
		})
	}
	stat, err := object.Stat()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": "file not found in storage",
		})
	}
	// Set response headers for file download
	c.Set(fiber.HeaderContentType, obj.ContentType)
	c.Set(fiber.HeaderContentDisposition, "attachment; filename=\""+obj.ID.String()+".glb\"")
	// Stream the content to the response
	return c.Status(fiber.StatusOK).SendStream(object, int(stat.Size))
}
