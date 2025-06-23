package models

import (
	"time"

	"github.com/google/uuid"
)

// Object represents a 3D object stored in the system
// @Description 3D object information
type Object struct {
	ID               uuid.UUID `gorm:"type:uuid;primaryKey"` // Unique identifier (UUID)
	OriginalFilename string    `gorm:"type:text"`            // Original uploaded file name
	ContentType      string    `gorm:"type:text"`            // MIME type (model/gltf-binary for GLB)
	Size             int64     `gorm:"type:bigint"`          // File size in bytes
	StorageKey       string    `gorm:"type:text"`            // Key or name used in object storage (MinIO)
	UploadedAt       time.Time `gorm:"autoCreateTime"`       // Timestamp of upload
}
