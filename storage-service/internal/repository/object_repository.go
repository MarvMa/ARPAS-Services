package repository

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"storage-service/internal/models"
)

// ObjectRepository defines the database operations for Object metadata.
type ObjectRepository interface {
	Create(obj *models.Object) error
	GetByID(id uuid.UUID) (*models.Object, error)
	List() ([]models.Object, error)
	Update(obj *models.Object) error
	Delete(id uuid.UUID) error
}

// PostgresObjectRepository is a concrete repository using GORM with PostgreSQL.
type PostgresObjectRepository struct {
	DB *gorm.DB
}

// NewObjectRepository constructs a PostgresObjectRepository.
func NewObjectRepository(db *gorm.DB) *PostgresObjectRepository {
	return &PostgresObjectRepository{DB: db}
}

// Create inserts a new Object record into the database.
func (r *PostgresObjectRepository) Create(obj *models.Object) error {
	return r.DB.Create(obj).Error
}

// GetByID finds an Object by its UUID. Returns an error if not found.
func (r *PostgresObjectRepository) GetByID(id uuid.UUID) (*models.Object, error) {
	var object models.Object
	result := r.DB.First(&object, "id = ?", id)
	if result.Error != nil {
		return nil, result.Error
	}
	return &object, nil
}

// List retrieves all Object records from the database.
func (r *PostgresObjectRepository) List() ([]models.Object, error) {
	var objects []models.Object
	result := r.DB.Find(&objects)
	return objects, result.Error
}

// Update saves changes to an existing Object record.
func (r *PostgresObjectRepository) Update(obj *models.Object) error {
	return r.DB.Save(obj).Error
}

// Delete removes an Object record by ID.
func (r *PostgresObjectRepository) Delete(id uuid.UUID) error {
	return r.DB.Delete(&models.Object{}, "id = ?", id).Error
}
