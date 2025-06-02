package repository

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"storage-service/internal/models"
)

// ObjectRepository provides data access for Object records.
type ObjectRepository struct {
	DB *gorm.DB
}

// NewObjectRepository creates a new repository with the given gorm DB.
func NewObjectRepository(db *gorm.DB) *ObjectRepository {
	return &ObjectRepository{DB: db}
}

// Create inserts a new Object record into the database.
func (r *ObjectRepository) Create(object *models.Object) error {
	return r.DB.Create(object).Error
}

// GetByID retrieves an Object by its ID.
func (r *ObjectRepository) GetByID(id uuid.UUID) (*models.Object, error) {
	var object models.Object
	result := r.DB.First(&object, "id = ?", id)
	if result.Error != nil {
		return nil, result.Error
	}
	return &object, nil
}

// List fetches all Object records from the database.
func (r *ObjectRepository) List() ([]models.Object, error) {
	var objects []models.Object
	err := r.DB.Find(&objects).Error
	return objects, err
}

// Update saves changes to an existing Object record.
func (r *ObjectRepository) Update(object *models.Object) error {
	return r.DB.Save(object).Error
}

// Delete removes an Object record by ID.
func (r *ObjectRepository) Delete(id uuid.UUID) error {
	return r.DB.Delete(&models.Object{}, "id = ?", id).Error
}
