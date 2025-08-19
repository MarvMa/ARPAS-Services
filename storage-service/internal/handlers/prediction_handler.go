package handlers

import (
	"log"
	"net/http"
	"storage-service/internal/models"
	"storage-service/internal/services"

	"github.com/gofiber/fiber/v2"
)

type PredictionHandler struct {
	objectService *services.ObjectService
}

func NewPredictionHandler(objectService *services.ObjectService) *PredictionHandler {
	return &PredictionHandler{
		objectService: objectService,
	}
}

// GetPredictedModels handles POST requests for model predictions based on position and viewing direction
// @Summary Get predicted 3D models
// @Description Predict which 3D models should be visible based on user position and viewing direction
// @Tags predictions
// @Accept json
// @Produce json
// @Param request body models.PredictionRequest true "Position and viewing direction data"
// @Success 200 {array} string "Array of predicted model IDs"
// @Failure 400 {object} map[string]interface{} "Bad request - Invalid request format"
// @Failure 405 {object} map[string]interface{} "Method not allowed - Use POST"
// @Failure 500 {object} map[string]interface{} "Internal server error"
// @Router /predictions [post]
func (h *PredictionHandler) GetPredictedModels(c *fiber.Ctx) error {

	if c.Method() != fiber.MethodPost {
		log.Fatalf("Method not allowed: %s for prediction endpoint", c.Method())
		return c.Status(http.StatusMethodNotAllowed).JSON(fiber.Map{
			"error": "Method not allowed, use POST",
		})
	}

	var req models.PredictionRequest
	if err := c.BodyParser(&req); err != nil {
		log.Fatalf("Invalid prediction request format: %v", err)
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request format",
		})
	}

	modelIDs, err := h.objectService.GetPredictedModels(req)

	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to get predicted models",
		})
	}

	return c.JSON(modelIDs)
}
