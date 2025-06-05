package models

import (
	"time"

	"github.com/google/uuid"
)

// Object represents a 3D object stored in the system
// @Description 3D object information
type Object struct {
	ID               uuid.UUID `json:"id" gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
	OriginalFilename string    `json:"original_filename"`
	ContentType      string    `json:"content_type"`
	Size             int64     `json:"size"`
	StorageKey       string    `json:"storage_key" gorm:"unique"`
	UploadedAt       time.Time `json:"uploaded_at" gorm:"autoCreateTime"`
}
