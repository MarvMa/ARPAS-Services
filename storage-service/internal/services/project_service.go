package services

import (
	"github.com/google/uuid"
	"storage-service/internal/models"
	"storage-service/internal/repository"
)

type ProjectService struct {
	repo          *repository.ProjectRepository
	objectService *ObjectService
}

func NewProjectService(repo *repository.ProjectRepository, objectService *ObjectService) *ProjectService {
	return &ProjectService{
		repo:          repo,
		objectService: objectService,
	}
}

func (s *ProjectService) CreateProject(project *models.Project) error {
	return s.repo.CreateProject(project)
}

func (s *ProjectService) GetProject(id uuid.UUID) (*models.Project, error) {
	return s.repo.GetProject(id)
}

func (s *ProjectService) GetProjectWithObjects(id uuid.UUID) (*models.Project, error) {
	return s.repo.GetProjectWithObjects(id)
}

func (s *ProjectService) UpdateProject(project *models.Project) error {
	return s.repo.UpdateProject(project)
}

func (s *ProjectService) DeleteProject(id uuid.UUID) error {
	project, err := s.repo.GetProjectWithObjects(id)
	if err != nil {
		return err
	}

	// Delete associated objects if needed
	if project.Objects != nil {
		for _, objRef := range project.Objects {
			// Use the object service to delete the actual objects
			_ = s.objectService.DeleteObject(objRef.ObjectID)
		}
	}
	return s.repo.DeleteProject(id)
}

func (s *ProjectService) ListProjects() ([]models.Project, error) {
	return s.repo.ListProjects()
}

func (s *ProjectService) AddObjectToProject(objRef *models.ObjectRef) error {
	return s.repo.AddObjectToProject(objRef)
}

func (s *ProjectService) RemoveObjectFromProject(projectID, objectID uuid.UUID) error {
	return s.repo.RemoveObjectFromProject(projectID, objectID)
}

func (s *ProjectService) UpdateObjectInProject(objRef *models.ObjectRef) error {
	return s.repo.UpdateObjectInProject(objRef)
}
