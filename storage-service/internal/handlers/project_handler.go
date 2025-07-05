// internal/handlers/project_handler.go
package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"log"
	"storage-service/internal/models"
	"storage-service/internal/services"
)

type ProjectHandler struct {
	projectService *services.ProjectService
	objectService  *services.ObjectService
}

func NewProjectHandler(projectService *services.ProjectService, objectService *services.ObjectService) *ProjectHandler {
	return &ProjectHandler{
		projectService: projectService,
		objectService:  objectService,
	}
}

// CreateProject creates a new project
// @Summary Create a new project
// @Description Create a new AR project with title and description
// @Tags projects
// @Accept json
// @Produce json
// @Param project body models.Project true "Project data"
// @Success 201 {object} models.Project "Project successfully created"
// @Failure 400 {object} map[string]interface{} "Bad request - Invalid project data"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /projects [post]
func (h *ProjectHandler) CreateProject(c *fiber.Ctx) error {
	var project models.Project
	if err := c.BodyParser(&project); err != nil {
		log.Printf("Error parsing project data: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid request format",
			"details": err.Error(),
		})
	}

	if err := h.projectService.CreateProject(&project); err != nil {
		log.Printf("Error creating project: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   true,
			"message": "Failed to create project",
			"details": err.Error(),
		})
	}

	return c.Status(fiber.StatusCreated).JSON(project)
}

// GetProject returns a project by ID
// @Summary Get a project by ID
// @Description Get details of a specific project
// @Tags projects
// @Accept json
// @Produce json
// @Param id path string true "Project ID" Format(uuid)
// @Success 200 {object} models.Project "Project found"
// @Failure 400 {object} map[string]interface{} "Invalid UUID"
// @Failure 404 {object} map[string]interface{} "Project not found"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /projects/{id} [get]
func (h *ProjectHandler) GetProject(c *fiber.Ctx) error {
	idStr := c.Params("id")
	projectID, err := uuid.Parse(idStr)
	if err != nil {
		log.Printf("Invalid project UUID format: %s - Error: %v", idStr, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid UUID",
			"details": err.Error(),
		})
	}

	project, err := h.projectService.GetProject(projectID)
	if err != nil {
		log.Printf("Error fetching project: ID=%s, Error=%v", projectID, err)
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error":   true,
			"message": "Project not found",
			"id":      projectID.String(),
		})
	}

	return c.JSON(project)
}

// GetProjectWithObjects returns a project with its objects
// @Summary Get a project with its objects
// @Description Get a project including all associated 3D objects and their transformations
// @Tags projects
// @Accept json
// @Produce json
// @Param id path string true "Project ID" Format(uuid)
// @Success 200 {object} models.Project "Project with objects found"
// @Failure 400 {object} map[string]interface{} "Invalid UUID"
// @Failure 404 {object} map[string]interface{} "Project not found"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /projects/{id}/objects [get]
func (h *ProjectHandler) GetProjectWithObjects(c *fiber.Ctx) error {
	idStr := c.Params("id")
	projectID, err := uuid.Parse(idStr)
	if err != nil {
		log.Printf("Invalid project UUID format: %s - Error: %v", idStr, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid UUID",
			"details": err.Error(),
		})
	}

	project, err := h.projectService.GetProjectWithObjects(projectID)
	if err != nil {
		log.Printf("Error fetching project with objects: ID=%s, Error=%v", projectID, err)
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error":   true,
			"message": "Project not found",
			"id":      projectID.String(),
		})
	}

	return c.JSON(project)
}

// UpdateProject updates a project
// @Summary Update a project
// @Description Update project title and description
// @Tags projects
// @Accept json
// @Produce json
// @Param id path string true "Project ID" Format(uuid)
// @Param project body models.Project true "Updated project data"
// @Success 200 {object} models.Project "Updated project"
// @Failure 400 {object} map[string]interface{} "Bad request - Invalid UUID or data"
// @Failure 404 {object} map[string]interface{} "Project not found"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /projects/{id} [put]
func (h *ProjectHandler) UpdateProject(c *fiber.Ctx) error {
	idStr := c.Params("id")
	projectID, err := uuid.Parse(idStr)
	if err != nil {
		log.Printf("Invalid project UUID format: %s - Error: %v", idStr, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid UUID",
			"details": err.Error(),
		})
	}

	existingProject, err := h.projectService.GetProject(projectID)
	if err != nil {
		log.Printf("Project not found for update: ID=%s, Error=%v", projectID, err)
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error":   true,
			"message": "Project not found",
			"id":      projectID.String(),
		})
	}

	var updatedProject models.Project
	if err := c.BodyParser(&updatedProject); err != nil {
		log.Printf("Error parsing project update data: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid request format",
			"details": err.Error(),
		})
	}

	// Update only allowed fields
	existingProject.Title = updatedProject.Title
	existingProject.Description = updatedProject.Description

	if err := h.projectService.UpdateProject(existingProject); err != nil {
		log.Printf("Error updating project: ID=%s, Error=%v", projectID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   true,
			"message": "Failed to update project",
			"details": err.Error(),
		})
	}

	return c.JSON(existingProject)
}

// DeleteProject deletes a project
// @Summary Delete a project
// @Description Delete a project and all its object references
// @Tags projects
// @Accept json
// @Produce json
// @Param id path string true "Project ID" Format(uuid)
// @Success 200 {object} map[string]interface{} "Project deleted successfully"
// @Failure 400 {object} map[string]interface{} "Invalid UUID"
// @Failure 404 {object} map[string]interface{} "Project not found"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /projects/{id} [delete]
func (h *ProjectHandler) DeleteProject(c *fiber.Ctx) error {
	idStr := c.Params("id")
	projectID, err := uuid.Parse(idStr)
	if err != nil {
		log.Printf("Invalid project UUID format: %s - Error: %v", idStr, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid UUID",
			"details": err.Error(),
		})
	}

	if err := h.projectService.DeleteProject(projectID); err != nil {
		log.Printf("Error deleting project: ID=%s, Error=%v", projectID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   true,
			"message": "Failed to delete project",
			"details": err.Error(),
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "Project deleted successfully",
		"id":      projectID.String(),
	})
}

// ListProjects returns all projects
// @Summary List all projects
// @Description Get a list of all projects in the system
// @Tags projects
// @Accept json
// @Produce json
// @Success 200 {array} models.Project "List of all projects"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /projects [get]
func (h *ProjectHandler) ListProjects(c *fiber.Ctx) error {
	projects, err := h.projectService.ListProjects()
	if err != nil {
		log.Printf("Error listing projects: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   true,
			"message": "Failed to list projects",
			"details": err.Error(),
		})
	}

	return c.JSON(projects)
}

// AddObjectToProject adds an object to a project with position, rotation, and scale
// @Summary Add object to project
// @Description Add a 3D object to a project with transformation properties (position, rotation, scale)
// @Tags projects
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID" Format(uuid)
// @Param objectRef body models.ObjectRef true "Object reference with transformation data"
// @Success 201 {object} models.ObjectRef "Object successfully added to project"
// @Failure 400 {object} map[string]interface{} "Bad request - Invalid UUID or data"
// @Failure 404 {object} map[string]interface{} "Object or project not found"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /projects/{projectId}/objects [post]
func (h *ProjectHandler) AddObjectToProject(c *fiber.Ctx) error {
	projectIDStr := c.Params("projectId")
	projectID, err := uuid.Parse(projectIDStr)
	if err != nil {
		log.Printf("Invalid project UUID format: %s - Error: %v", projectIDStr, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid project UUID",
			"details": err.Error(),
		})
	}

	var objRef models.ObjectRef
	if err := c.BodyParser(&objRef); err != nil {
		log.Printf("Error parsing object reference data: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid request format",
			"details": err.Error(),
		})
	}

	// Validate object exists
	_, err = h.objectService.GetObject(objRef.ObjectID)
	if err != nil {
		log.Printf("Object not found: ID=%s, Error=%v", objRef.ObjectID, err)
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error":   true,
			"message": "Object not found",
			"id":      objRef.ObjectID.String(),
		})
	}

	// Set project ID from path parameter
	objRef.ProjectID = projectID

	if err := h.projectService.AddObjectToProject(&objRef); err != nil {
		log.Printf("Error adding object to project: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   true,
			"message": "Failed to add object to project",
			"details": err.Error(),
		})
	}

	return c.Status(fiber.StatusCreated).JSON(objRef)
}

// UpdateObjectInProject updates an object's properties within a project
// @Summary Update object in project
// @Description Update transformation properties of an object within a project
// @Tags projects
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID" Format(uuid)
// @Param objectRefId path string true "Object Reference ID" Format(uuid)
// @Param objectRef body models.ObjectRef true "Updated object reference data"
// @Success 200 {object} models.ObjectRef "Object successfully updated in project"
// @Failure 400 {object} map[string]interface{} "Bad request - Invalid UUID or data"
// @Failure 404 {object} map[string]interface{} "Object reference not found"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /projects/{projectId}/objects/{objectRefId} [put]
func (h *ProjectHandler) UpdateObjectInProject(c *fiber.Ctx) error {
	projectIDStr := c.Params("projectId")
	objectRefIDStr := c.Params("objectRefId")

	projectID, err := uuid.Parse(projectIDStr)
	if err != nil {
		log.Printf("Invalid project UUID format: %s - Error: %v", projectIDStr, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid project UUID",
			"details": err.Error(),
		})
	}

	objectRefID, err := uuid.Parse(objectRefIDStr)
	if err != nil {
		log.Printf("Invalid object reference UUID format: %s - Error: %v", objectRefIDStr, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid object reference UUID",
			"details": err.Error(),
		})
	}

	var updatedObjRef models.ObjectRef
	if err := c.BodyParser(&updatedObjRef); err != nil {
		log.Printf("Error parsing object reference update data: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid request format",
			"details": err.Error(),
		})
	}

	// Ensure IDs match the URL parameters
	updatedObjRef.ID = objectRefID
	updatedObjRef.ProjectID = projectID

	if err := h.projectService.UpdateObjectInProject(&updatedObjRef); err != nil {
		log.Printf("Error updating object in project: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   true,
			"message": "Failed to update object in project",
			"details": err.Error(),
		})
	}

	return c.JSON(updatedObjRef)
}

// RemoveObjectFromProject removes an object from a project
// @Summary Remove object from project
// @Description Remove an object reference from a project
// @Tags projects
// @Accept json
// @Produce json
// @Param projectId path string true "Project ID" Format(uuid)
// @Param objectId path string true "Object ID" Format(uuid)
// @Success 200 {object} map[string]interface{} "Object successfully removed from project"
// @Failure 400 {object} map[string]interface{} "Invalid UUID"
// @Failure 404 {object} map[string]interface{} "Object reference not found"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /projects/{projectId}/objects/{objectId} [delete]
func (h *ProjectHandler) RemoveObjectFromProject(c *fiber.Ctx) error {
	projectIDStr := c.Params("projectId")
	objectIDStr := c.Params("objectId")

	projectID, err := uuid.Parse(projectIDStr)
	if err != nil {
		log.Printf("Invalid project UUID format: %s - Error: %v", projectIDStr, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid project UUID",
			"details": err.Error(),
		})
	}

	objectID, err := uuid.Parse(objectIDStr)
	if err != nil {
		log.Printf("Invalid object UUID format: %s - Error: %v", objectIDStr, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   true,
			"message": "Invalid object UUID",
			"details": err.Error(),
		})
	}

	if err := h.projectService.RemoveObjectFromProject(projectID, objectID); err != nil {
		log.Printf("Error removing object from project: ProjectID=%s, ObjectID=%s, Error=%v", projectID, objectID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   true,
			"message": "Failed to remove object from project",
			"details": err.Error(),
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "Object removed from project successfully",
	})
}
