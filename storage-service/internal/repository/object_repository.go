// internal/repository/object_repository.go (update existing file)
package repository

import (
	"fmt"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"storage-service/internal/models"
	"storage-service/internal/utils"
)

// ObjectRepositoryImpl interface defines methods for object storage operations
type ObjectRepository interface {
	CreateObject(object *models.Object) error
	GetObject(id uuid.UUID) (*models.Object, error)
	ListObjects() ([]models.Object, error)
	UpdateObject(object *models.Object) error
	DeleteObject(id uuid.UUID) error
	FindObjectRefsWithinRadius(lat, lng, radiusMeters float64) ([]models.ObjectRef, error)

	// Add alias methods to match what the service is calling
	Create(object *models.Object) error
	GetByID(id uuid.UUID) (*models.Object, error)
	List() ([]models.Object, error)
	Update(object *models.Object) error
	Delete(id uuid.UUID) error
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
func (r *ObjectRepositoryImpl) GetObjectsByLocation(lat, lon float64, radiusKm float64) ([]models.Object, error) {
	var objects []models.Object

	// Haversine formula for calculating distance
	query := `
		SELECT * FROM objects 
		WHERE (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * 
			cos(radians(longitude) - radians(?)) + 
			sin(radians(?)) * sin(radians(latitude)))) < ?
	`

	err := r.db.Raw(query, lat, lon, lat, radiusKm).Scan(&objects).Error
	return objects, err
}

// FindObjectRefsWithinRadius finds object references within a specified radius
func (r *ObjectRefRepositoryImpl) FindObjectRefsWithinRadius(lat, lng, radiusMeters float64) ([]models.ObjectRef, error) {
	var objectRefs []models.ObjectRef

	// Calculate bounding box for initial filtering
	minLat, maxLat, minLng, maxLng := utils.CalculateBoundingBox(lat, lng, radiusMeters)

	// Try PostGIS query first (more accurate)
	sqlQuery := `
        SELECT * FROM object_refs
        WHERE pos_latitude IS NOT NULL
        AND pos_longitude IS NOT NULL
        AND pos_latitude BETWEEN ? AND ?
        AND pos_longitude BETWEEN ? AND ?
        AND ST_DWithin(
            ST_SetSRID(ST_MakePoint(pos_longitude, pos_latitude), 4326)::geography,
            ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
            ?
        )
    `

	err := r.db.Raw(sqlQuery,
		minLat, maxLat, minLng, maxLng,
		lng, lat, radiusMeters,
	).Scan(&objectRefs).Error

	if err != nil {
		// Fallback to simple bounding box + Haversine calculation
		return r.FindObjectRefsWithinRadiusSimple(lat, lng, radiusMeters)
	}

	return objectRefs, nil
}

// FindObjectRefsWithinRadiusSimple fallback method using Haversine calculation
func (r *ObjectRefRepositoryImpl) FindObjectRefsWithinRadiusSimple(lat, lng, radiusMeters float64) ([]models.ObjectRef, error) {
	var objectRefs []models.ObjectRef

	// Calculate bounding box for initial filtering
	minLat, maxLat, minLng, maxLng := utils.CalculateBoundingBox(lat, lng, radiusMeters)

	// Get objects within bounding box first
	err := r.db.Where("pos_latitude IS NOT NULL AND pos_longitude IS NOT NULL").
		Where("pos_latitude BETWEEN ? AND ?", minLat, maxLat).
		Where("pos_longitude BETWEEN ? AND ?", minLng, maxLng).
		Find(&objectRefs).Error

	if err != nil {
		return nil, err
	}

	// Filter by exact distance using Haversine
	var filteredObjectRefs []models.ObjectRef
	for _, objRef := range objectRefs {
		if objRef.Position != nil {
			distance := utils.HaversineDistance(
				lat, lng,
				objRef.Position.Latitude, objRef.Position.Longitude,
			)

			if distance <= radiusMeters {
				filteredObjectRefs = append(filteredObjectRefs, objRef)
			}
		}
	}

	return filteredObjectRefs, nil
}

// CreateObjectRef creates a new object reference and sets the PostGIS location
func (r *ObjectRefRepositoryImpl) CreateObjectRef(objectRef *models.ObjectRef) error {
	// Set location field for PostGIS if position is provided
	if objectRef.Position != nil {
		objectRef.Location = fmt.Sprintf("POINT(%f %f)",
			objectRef.Position.Longitude, objectRef.Position.Latitude)
	}
	return r.db.Create(objectRef).Error
}
