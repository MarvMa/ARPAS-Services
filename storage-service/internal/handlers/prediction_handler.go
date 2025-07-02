package handlers

import (
	"github.com/gofiber/fiber/v2"
	"net/http"
	"storage-service/internal/models"
	"storage-service/internal/services"
)

type PredictionHandler struct {
	objectService *services.ObjectService
}

func NewPredictionHandler(objectService *services.ObjectService) *PredictionHandler {
	return &PredictionHandler{
		objectService: objectService,
	}
}

// GetPredictedModels handles the prediction request to get model IDs based on the provided parameters.

func (h *PredictionHandler) GetPredictedModels(c *fiber.Ctx) error {
	if c.Method() != fiber.MethodPost {
		return c.Status(http.StatusMethodNotAllowed).JSON(fiber.Map{
			"error": "Method not allowed, use POST",
		})
	}

	var req models.PredictionRequest
	if err := c.BodyParser(&req); err != nil {
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
