package models

import (
	"github.com/google/uuid"
	"time"
)

type ObjectRef struct {
	ID        uuid.UUID `json:"id" gorm:"primaryKey;type:uuid;default:gen_random_uuid()"`
	ProjectID uuid.UUID `json:"project_id" gorm:"type:uuid;not null"`
	ObjectID  uuid.UUID `json:"object_id" gorm:"type:uuid;not null"`
	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt time.Time `json:"updated_at" gorm:"autoUpdateTime"`

	Position *Position `json:"position,omitempty" gorm:"embedded;embedded_prefix:pos_"`

	RotationX float64 `json:"rotation_x" gorm:"type:decimal(10,6)"`
	RotationY float64 `json:"rotation_y" gorm:"type:decimal(10,6)"`
	RotationZ float64 `json:"rotation_z" gorm:"type:decimal(10,6)"`

	ScaleX float64 `json:"scale_x" gorm:"type:decimal(10,6);default:1.0"`
	ScaleY float64 `json:"scale_y" gorm:"type:decimal(10,6);default:1.0"`
	ScaleZ float64 `json:"scale_z" gorm:"type:decimal(10,6);default:1.0"`

	Location string `gorm:"type:geography(POINT,4326)" json:"-"`

	Object  *Object  `json:"object,omitempty" gorm:"foreignKey:ObjectID"`
	Project *Project `json:"project,omitempty" gorm:"foreignKey:ProjectID"`
}

type Position struct {
	Latitude  float64 `json:"latitude" gorm:"type:decimal(10,6)"`
	Longitude float64 `json:"longitude" gorm:"type:decimal(10,6)"`
	Altitude  float64 `json:"altitude" gorm:"type:decimal(10,6)"`
}
