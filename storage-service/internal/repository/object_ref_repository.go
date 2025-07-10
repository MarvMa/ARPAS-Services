// storage-service/internal/repository/object_ref_repository.go
package repository

import (
	"fmt"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"storage-service/internal/models"
	"storage-service/internal/utils"
)

// ObjectRefRepository interface defines methods for object reference operations
type ObjectRefRepository interface {
	CreateObjectRef(objectRef *models.ObjectRef) error
	GetObjectRef(id uuid.UUID) (*models.ObjectRef, error)
	ListObjectRefs() ([]models.ObjectRef, error)
	UpdateObjectRef(objectRef *models.ObjectRef) error
	DeleteObjectRef(id uuid.UUID) error
	FindObjectRefsWithinRadius(lat, lng, radiusMeters float64) ([]models.ObjectRef, error)
	FindObjectRefsWithinRadiusSimple(lat, lng, radiusMeters float64) ([]models.ObjectRef, error)
	GetObjectRefsByProjectID(projectID uuid.UUID) ([]models.ObjectRef, error)
}

// ObjectRefRepositoryImpl provides methods to interact with the ObjectRef model in the database.
type ObjectRefRepositoryImpl struct {
	db *gorm.DB
}

// NewObjectRefRepository creates a new ObjectRefRepositoryImpl instance with the provided GORM database connection.
func NewObjectRefRepository(db *gorm.DB) *ObjectRefRepositoryImpl {
	return &ObjectRefRepositoryImpl{db: db}
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

// GetObjectRef retrieves an ObjectRef by its ID from the database.
func (r *ObjectRefRepositoryImpl) GetObjectRef(id uuid.UUID) (*models.ObjectRef, error) {
	var objectRef models.ObjectRef
	err := r.db.First(&objectRef, "id = ?", id).Error
	return &objectRef, err
}

// ListObjectRefs retrieves all ObjectRefs from the database.
func (r *ObjectRefRepositoryImpl) ListObjectRefs() ([]models.ObjectRef, error) {
	var objectRefs []models.ObjectRef
	err := r.db.Find(&objectRefs).Error
	return objectRefs, err
}

// UpdateObjectRef updates an existing ObjectRef in the database.
func (r *ObjectRefRepositoryImpl) UpdateObjectRef(objectRef *models.ObjectRef) error {
	// Update location field for PostGIS if position is provided
	if objectRef.Position != nil {
		objectRef.Location = fmt.Sprintf("POINT(%f %f)",
			objectRef.Position.Longitude, objectRef.Position.Latitude)
	}
	return r.db.Save(objectRef).Error
}

// DeleteObjectRef deletes an ObjectRef by its ID from the database.
func (r *ObjectRefRepositoryImpl) DeleteObjectRef(id uuid.UUID) error {
	return r.db.Delete(&models.ObjectRef{}, "id = ?", id).Error
}

// GetObjectRefsByProjectID retrieves all ObjectRefs for a specific project.
func (r *ObjectRefRepositoryImpl) GetObjectRefsByProjectID(projectID uuid.UUID) ([]models.ObjectRef, error) {
	var objectRefs []models.ObjectRef
	err := r.db.Where("project_id = ?", projectID).Find(&objectRefs).Error
	return objectRefs, err
}
