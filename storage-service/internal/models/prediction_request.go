package models

import "github.com/google/uuid"

type PredictionRequest struct {
	ObjectIDs []uuid.UUID `json:"objectIds"`
}
