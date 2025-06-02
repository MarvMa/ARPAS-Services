package main

import (
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/adaptor"
	"github.com/joho/godotenv"
	"github.com/minio/minio-go/v7"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/gorm"
	"log"
	"storage-service/internal/config"
	"storage-service/internal/handlers"
	"storage-service/internal/models"
	"storage-service/internal/repository"
	"storage-service/internal/services"
	"storage-service/internal/storage"
)

func main() {
	loadDotenv()
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
	api := app.Group("/api/v1")
	api.Get("/objects", h.ListObjects)
	api.Get("/objects/:id", h.GetObject)
	api.Post("/objects", h.CreateObject)
	api.Put("/objects/:id", h.UpdateObject)
	api.Delete("/objects/:id", h.DeleteObject)
	api.Get("/objects/:id/download", h.DownloadObject)

	// Start the Fiber server
	port := cfg.AppPort
	if port == "" {
		port = "8080"
	}
	log.Printf("Server listening on port %s", port)
	log.Fatal(app.Listen(":" + port))
}

func loadDotenv() {
	err := godotenv.Load()
	if err != nil {
		log.Fatalf("Error loading .env file")
	}
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
