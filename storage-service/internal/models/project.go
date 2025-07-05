package models

import (
	"github.com/google/uuid"
	"time"
)

type Project struct {
	ID          uuid.UUID   `json:"id" gorm:"primaryKey;type:uuid;default:gen_random_uuid()"`
	Title       string      `json:"title" gorm:"not null"`
	Description string      `json:"description"`
	CreatedAt   time.Time   `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time   `json:"updated_at" gorm:"autoUpdateTime"`
	Objects     []ObjectRef `json:"objects,omitempty" gorm:"foreignKey:ProjectID"`
}
