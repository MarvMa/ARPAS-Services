package main

import (
	"log"
	"storage-service/internal/config"
	"storage-service/internal/handlers"
	"storage-service/internal/models"
	"storage-service/internal/repository"
	"storage-service/internal/services"
	"storage-service/internal/storage"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/adaptor"
	"github.com/gofiber/swagger"
	"github.com/minio/minio-go/v7"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/gorm"
)

func main() {
	cfg := InitConfig()
	db := ConnectDatabase(cfg)
	MigrateDatabase(db)
	minioClient := InitMinIOClient(cfg)

	objectRepo := repository.NewObjectRepository(db)
	objectService := services.NewObjectService(objectRepo, minioClient, cfg.MinioBucket)

	app := fiber.New()

	//Register Prometheus metrics endpoint
	app.Get("/metrics", adaptor.HTTPHandler(promhttp.Handler()))

	// Set up routes for 3D object CRUD operations
	h := handlers.NewObjectHandler(objectService)
	api := app.Group("/api/storage")
	api.Get("/objects", h.ListObjects)
	api.Get("/objects/:id", h.GetObject)
	api.Post("/objects", h.CreateObject)
	api.Put("/objects/:id", h.UpdateObject)
	api.Delete("/objects/:id", h.DeleteObject)
	api.Get("/objects/:id/download", h.DownloadObject)

	api.Get("/swagger/*", swagger.HandlerDefault)

	// Add Health check endpoint
	api.Get("/health", func(c *fiber.Ctx) error {
		return c.SendStatus(fiber.StatusOK)
	})

	routes := app.GetRoutes()
	log.Println("Registered routes:")
	for _, r := range routes {
		log.Printf("  %s %s\n", r.Method, r.Path)
	}

	// Start the Fiber server
	port := cfg.AppPort
	if port == "" {
		port = "8080"
		log.Printf("Defaulting to port %s", port)
	}
	log.Printf("Server listening on port %s", port)
	log.Fatal(app.Listen(":" + port))
}

func InitConfig() *config.Config {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Config error: %v", err)
	}
	return cfg
}

func ConnectDatabase(cfg *config.Config) *gorm.DB {
	db, err := config.ConnectDatabase(cfg)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	return db
}

func MigrateDatabase(db *gorm.DB) {
	err := db.AutoMigrate(&models.Object{})
	if err != nil {
		log.Fatalf("Database migration failed: %v", err)
	}
}

func InitMinIOClient(cfg *config.Config) *minio.Client {
	minioClient, err := storage.NewMinioClient(cfg)
	if err != nil {
		log.Fatalf("MinIO client initialization failed: %v", err)
	}
	return minioClient
}
