package repository

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
	"storage-service/internal/models"
)

// ProjectRepository provides methods to interact with the Project model in the database.
type ProjectRepository struct {
	db *gorm.DB
}

// NewProjectRepository creates a new ProjectRepository instance with the provided GORM database connection.
func NewProjectRepository(db *gorm.DB) *ProjectRepository {
	return &ProjectRepository{db: db}
}

// CreateProject creates a new Project in the database.
func (r *ProjectRepository) CreateProject(project *models.Project) error {
	return r.db.Create(project).Error
}

// GetProject retrieves a Project by its ID from the database.
func (r *ProjectRepository) GetProject(id uuid.UUID) (*models.Project, error) {
	var project models.Project
	err := r.db.First(&project, "id = ?", id).Error
	return &project, err
}

// GetProjectWithObjects retrieves a Project by its ID along with its associated Objects.
func (r *ProjectRepository) GetProjectWithObjects(id uuid.UUID) (*models.Project, error) {
	var project models.Project
	err := r.db.Preload("Objects").Preload("Objects.Object").First(&project, "id = ?", id).Error
	return &project, err
}

// UpdateProject updates an existing Project in the database.
func (r *ProjectRepository) UpdateProject(project *models.Project) error {
	return r.db.Save(project).Error
}

// DeleteProject deletes a Project by its ID from the database.
func (r *ProjectRepository) DeleteProject(id uuid.UUID) error {
	// First delete all object references
	if err := r.db.Where("project_id = ?", id).Delete(&models.ObjectRef{}).Error; err != nil {
		return err
	}
	// Then delete the project
	return r.db.Delete(&models.Project{}, "id = ?", id).Error
}

// ListProjects retrieves all Projects from the database.
func (r *ProjectRepository) ListProjects() ([]models.Project, error) {
	var projects []models.Project
	err := r.db.Find(&projects).Error
	return projects, err
}

// AddObjectToProject adds an ObjectRef to a Project.
func (r *ProjectRepository) AddObjectToProject(objRef *models.ObjectRef) error {
	return r.db.Create(objRef).Error
}

// RemoveObjectFromProject removes an ObjectRef from a Project by its IDs.
func (r *ProjectRepository) RemoveObjectFromProject(projectID, objectID uuid.UUID) error {
	return r.db.Where("project_id = ? AND object_id = ?", projectID, objectID).Delete(&models.ObjectRef{}).Error
}

// UpdateObjectInProject updates an existing ObjectRef in a Project.
func (r *ProjectRepository) UpdateObjectInProject(objRef *models.ObjectRef) error {
	return r.db.Save(objRef).Error
}
