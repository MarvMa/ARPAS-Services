package repository

import (
	"storage-service/internal/models"
	"storage-service/internal/utils"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ObjectRepository defines the interface for interacting with the Object model in the database.
type ObjectRepository interface {
	CreateObject(object *models.Object) error
	GetObject(id uuid.UUID) (*models.Object, error)
	ListObjects() ([]models.Object, error)
	UpdateObject(object *models.Object) error
	DeleteObject(id uuid.UUID) error
}

// ObjectRepositoryImpl provides methods to interact with the Object model in the database.
type ObjectRepositoryImpl struct {
	db *gorm.DB
}

// NewObjectRepository creates a new ObjectRepositoryImpl instance with the provided GORM database connection.
func NewObjectRepository(db *gorm.DB) *ObjectRepositoryImpl {
	return &ObjectRepositoryImpl{db: db}
}

// CreateObject creates a new Object in the database.
func (r *ObjectRepositoryImpl) CreateObject(object *models.Object) error {
	return r.db.Create(object).Error
}

// GetObject retrieves an Object by its ID from the database.
func (r *ObjectRepositoryImpl) GetObject(id uuid.UUID) (*models.Object, error) {
	var object models.Object
	err := r.db.First(&object, "id = ?", id).Error
	return &object, err
}

// UpdateObject updates an existing Object in the database.
func (r *ObjectRepositoryImpl) UpdateObject(object *models.Object) error {
	return r.db.Save(object).Error
}

// DeleteObject deletes an Object by its ID from the database.
func (r *ObjectRepositoryImpl) DeleteObject(id uuid.UUID) error {
	return r.db.Delete(&models.Object{}, "id = ?", id).Error
}

// ListObjects retrieves all Objects from the database.
func (r *ObjectRepositoryImpl) ListObjects() ([]models.Object, error) {
	var objects []models.Object
	err := r.db.Find(&objects).Error
	return objects, err
}

// GetObjectsByLocation retrieves Objects within a specified radius from a given latitude and longitude using the Haversine formula.
func (r *ObjectRepositoryImpl) GetObjectsByLocation(lat, lon float64, radiusMeter float64) ([]models.Object, error) {
	var objects []models.Object

	minLat, maxLat, minLon, maxLon := utils.CalculateBoundingBox(lat, lon, radiusMeter)

	err := r.db.
		Where("latitude IS NOT NULL AND longitude IS NOT NULL").
		Where("latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?", minLat, maxLat, minLon, maxLon).
		Find(&objects).Error

	return objects, err
}
