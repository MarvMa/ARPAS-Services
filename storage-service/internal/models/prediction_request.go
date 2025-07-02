package models

type PredictionRequest struct {
	Position struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		Altitude  float64 `json:"altitude"`
	} `json:"position"`
	ViewingDirection struct {
		Heading float64 `json:"heading"`
		Pitch   float64 `json:"pitch"`
	} `json:"viewingDirection"`
	Frustum struct {
		FovHorizontal float64 `json:"fovHorizontal"`
		FovVertical   float64 `json:"fovVertical"`
		ViewDistance  float64 `json:"viewDistance"`
	} `json:"frustum"`
}
