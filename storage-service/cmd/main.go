package main

import (
	"log"
	"os"
	"storage-service/docs"
	"storage-service/internal/config"
	"storage-service/internal/handlers"
	"storage-service/internal/models"
	"storage-service/internal/repository"
	"storage-service/internal/services"
	"storage-service/internal/storage"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/adaptor"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/swagger"
	"github.com/minio/minio-go/v7"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/gorm"
)

// @title Storage Service API
// @version 1.0
// @description Storage Service API for managing 3D objects
// @host localhost:8080
// @BasePath /api/storage
func main() {
	cfg := InitConfig()
	db := ConnectDatabase(cfg)
	MigrateDatabase(db)

	minioClient := InitMinIOClient(cfg)

	objectRepo := repository.NewObjectRepository(db)
	objectService := services.NewObjectService(objectRepo, minioClient, cfg.MinioBucket)
	predictionHandler := handlers.NewPredictionHandler(objectService)

	// Configure Swagger metadata
	docs.SwaggerInfo.Title = "Storage Service API"
	docs.SwaggerInfo.Version = "1.0"
	docs.SwaggerInfo.Description = "Storage Service API for managing 3D objects"
	docs.SwaggerInfo.Host = "localhost:8080"
	docs.SwaggerInfo.BasePath = "/api/storage"

	app := fiber.New(fiber.Config{
		BodyLimit:        500 * 1024 * 1024, // 500 MB
		ReadTimeout:      5 * time.Minute,
		WriteTimeout:     5 * time.Minute,
		ServerHeader:     "Storage Service",
		DisableKeepalive: false,
	})

	// Logger Middleware
	app.Use(logger.New(logger.Config{
		Format:     "[${time}] ${status} - ${method} ${path} ${query} - ${ip} - ${latency}\n",
		TimeFormat: "2006-01-02 15:04:05",
		Output:     os.Stdout,
	}))

	// Register Prometheus metrics endpoint
	app.Get("/metrics", adaptor.HTTPHandler(promhttp.Handler()))

	// Health check endpoint
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.SendStatus(fiber.StatusOK)
	})

	app.Use(logger.New(logger.Config{
		Format:     "[${time}] ${status} - ${method} ${path} ${query} - ${ip} - ${latency} - ${error}\n",
		TimeFormat: "2006-01-02 15:04:05",
		Output:     os.Stdout,
	}))

	// initialize handlers
	objHandler := handlers.NewObjectHandler(objectService)

	// API routes
	api := app.Group("/api/storage")

	api.Post("/predict", predictionHandler.GetPredictedModels)

	api.Get("/objects", objHandler.ListObjects)
	api.Get("/objects/:id", objHandler.GetObject)
	api.Post("/objects/upload", objHandler.UploadObject)
	api.Delete("/objects/:id", objHandler.DeleteObject)
	api.Get("/objects/:id/download", objHandler.DownloadObject)

	// Swagger documentation
	// Configure swagger to serve the pre-generated docs
	app.Get("/swagger/*", swagger.New(swagger.Config{
		URL:          "/swagger/doc.json",
		DeepLinking:  false,
		DocExpansion: "none",
		OAuth: &swagger.OAuthConfig{
			AppName: "Storage Service API",
		},
	}))

	// Log registered routes
	routes := app.GetRoutes()
	log.Println("Registered routes:")
	for _, r := range routes {
		log.Printf("  %s %s\n", r.Method, r.Path)
	}

	// Start the server
	port := os.Getenv("STORAGE_PORT")
	if port == "" {
		port = cfg.AppPort
		if port == "" {
			port = "8000"
			log.Printf("Defaulting to port %s", port)
		}
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
