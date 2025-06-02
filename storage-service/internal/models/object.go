package models

import (
	"time"

	"github.com/google/uuid"
)

// Object represents the metadata of an uploaded 3D object stored in the database.
type Object struct {
	ID               uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	OriginalFilename string    `json:"original_filename"`
	ContentType      string    `json:"content_type"`
	Size             int64     `json:"size"`
	UploadedAt       time.Time `json:"uploaded_at"`
	StorageKey       string    `json:"storage_key"`
}
